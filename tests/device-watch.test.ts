import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DeviceWatch, WINDOWS_WATCH, type DeviceWatchOptions, type WatchProcess } from '../src/main/device-watch.js';
import type { DevicesPart } from '../src/shared/notch.js';

class FakeChild extends EventEmitter implements WatchProcess {
  stdout = new PassThrough();
  written: string[] = [];
  stdin = Object.assign(new EventEmitter(), { write: (text: string) => { this.written.push(text); return true; } });
  killed = false;
  pid = 4242;
  constructor(readonly command: string, readonly args: string[]) { super(); }
  kill() { this.killed = true; this.emit('exit', null); return true; }
  say(text: string) { this.stdout.write(text); }
}

function fixture(platform: NodeJS.Platform, failing: string[] = []) {
  const children: FakeChild[] = [], volumes: [number, boolean][] = [], reads: DevicesPart[] = [], runs: string[] = [], links: [string, boolean][] = [];
  const options: DeviceWatchOptions = {
    platform,
    run: async (command, args) => { runs.push([command, ...args].join(' ')); if (failing.includes(command)) throw new Error(`${command}: not found`); return ''; },
    onVolume: (level, muted) => volumes.push([level, muted]),
    onRead: part => reads.push(part),
    onLink: (address, connected) => links.push([address, connected]),
    spawnProcess: (command, args) => { const child = new FakeChild(command, args); children.push(child); return child; },
  };
  return { watch: new DeviceWatch(options), children, volumes, reads, runs, links };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('Windows: one hidden helper holds the audio callbacks and device events, and only reads "set" lines', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture('win32');
  f.watch.start(); f.watch.start();
  assert.equal(f.children.length, 1, 'Starting twice ran a second helper');
  const [child] = f.children;
  assert.equal(child!.command, 'powershell.exe');
  assert.deepEqual(child!.args.slice(0, 4), ['-NoProfile', '-NonInteractive', '-Mta', '-EncodedCommand']);
  const script = Buffer.from(child!.args[4]!, 'base64').toString('utf16le');
  assert.equal(script, WINDOWS_WATCH);
  for (const part of ['RegisterControlChangeNotify', 'RegisterEndpointNotificationCallback', 'fc240062-1541-49be-b463-84c4dcd7bf7f', 'CM_Register_Notification', 'Win32_DeviceChangeEvent', 'Console.In.ReadLine', 'exit 3']) assert.ok(script.includes(part), part);
  assert.deepEqual(f.reads, ['wifi', 'bluetooth'], 'Watching did not read the parts it compares');
  child!.say('V 20 0\nV 4'); await flush();
  child!.say('2 1\r\n'); await flush();
  assert.deepEqual(f.volumes, [[20, false], [42, true]], 'A line split across chunks was lost');
  child!.say(`V ${'9'.repeat(300)} 0\nV 999 0\nnoise\n`); await flush();
  assert.equal(f.volumes.length, 2, 'An overlong or malformed line was taken as a volume');
  // Several device events in a burst are one Bluetooth read.
  child!.say('D\nD\n'); await flush(); t.mock.timers.tick(1000); child!.say('D\n'); await flush();
  t.mock.timers.tick(1499); assert.deepEqual(f.reads.slice(2), []);
  t.mock.timers.tick(1); assert.deepEqual(f.reads.slice(2), ['bluetooth']);
  // A radio connection event reads soon and once more later, when Windows has caught up with the link.
  child!.say('B 70700D7DC3FD 0\nB 70700d7dc3fd 1\nB\n'); await flush();
  assert.deepEqual(f.links, [['70700D7DC3FD', false]], 'A radio link was lost or a malformed one was taken');
  t.mock.timers.tick(2000); assert.deepEqual(f.reads.slice(3), ['bluetooth']);
  t.mock.timers.tick(6000); assert.deepEqual(f.reads.slice(3), ['bluetooth', 'bluetooth'], 'The later Bluetooth read did not run');
  f.watch.setVolume(41.6); f.watch.setVolume(-5); f.watch.setVolume(Number.NaN); await flush(); await flush();
  assert.deepEqual(child!.written, ['set 42\n', 'set 0\n']);
  assert.deepEqual(f.watch.pids, [4242]);
  // Unbounded output stops the helper.
  child!.say('x'.repeat(17_000)); await flush();
  assert.equal(child!.killed, true);
});

test('a helper that quits restarts three times, a refused one never, and stop ends everything', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture('win32');
  f.watch.start();
  for (let attempt = 0; attempt < 3; attempt++) {
    f.children.at(-1)!.emit('exit', 1);
    t.mock.timers.tick(29_999); assert.equal(f.children.length, attempt + 1, 'A helper restarted before its wait');
    t.mock.timers.tick(1); assert.equal(f.children.length, attempt + 2);
  }
  f.children.at(-1)!.emit('exit', 1); t.mock.timers.tick(60_000);
  assert.equal(f.children.length, 4, 'A helper restarted a fourth time');
  assert.equal(f.watch.alive, false);
  f.watch.setVolume(30); await flush();
  assert.deepEqual(f.children.flatMap(child => child.written), [], 'A volume was written to a helper that quit');

  const refused = fixture('win32');
  refused.watch.start(); refused.children[0]!.emit('exit', 3); t.mock.timers.tick(60_000);
  assert.equal(refused.children.length, 1, 'A helper refused by Constrained Language Mode was retried');

  const stopped = fixture('win32');
  stopped.watch.start(); stopped.children[0]!.say('D\n'); await flush();
  stopped.watch.stop();
  t.mock.timers.tick(60_000);
  assert.deepEqual([stopped.children[0]!.killed, stopped.children.length, stopped.reads], [true, 1, ['wifi', 'bluetooth']], 'Stop left a helper, a restart or a pending read');
});

test('Linux watches pactl and BlueZ and sets the volume with wpctl, then pactl', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture('linux');
  f.watch.start();
  assert.deepEqual(f.children.map(child => [child.command, ...child.args].join(' ')), ['pactl subscribe', 'gdbus monitor --system --dest org.bluez']);
  assert.deepEqual(f.reads, ['wifi', 'bluetooth', 'volume']);
  const [pulse, bluez] = f.children;
  pulse!.say("Event 'change' on sink #56\nEvent 'change' on sink #56\nEvent 'new' on client #9\n"); await flush();
  bluez!.say("/org/bluez/hci0/dev_00_1A: org.freedesktop.DBus.Properties.PropertiesChanged ('org.bluez.Device1', {'Connected': <true>}, @as [])\n");
  bluez!.say("/org/bluez/hci0/dev_00_1A: org.freedesktop.DBus.Properties.PropertiesChanged ('org.bluez.Device1', {'RSSI': <int16 -60>}, @as [])\n"); await flush();
  t.mock.timers.tick(1000);
  assert.deepEqual(f.reads.slice(3), ['volume', 'bluetooth']);
  f.watch.setVolume(150); await flush(); await flush();
  assert.deepEqual(f.runs, ['wpctl set-volume @DEFAULT_AUDIO_SINK@ 100%', 'wpctl set-mute @DEFAULT_AUDIO_SINK@ 0']);
  const pulseOnly = fixture('linux', ['wpctl']);
  pulseOnly.watch.setVolume(30); for (let i = 0; i < 5; i++) await flush();
  assert.deepEqual(pulseOnly.runs, ['wpctl set-volume @DEFAULT_AUDIO_SINK@ 30%', 'pactl set-sink-volume @DEFAULT_SINK@ 30%', 'pactl set-sink-mute @DEFAULT_SINK@ 0']);
  f.watch.stop();
});

test('while the wheel turns, older steps the system reports do not pull the bar back', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture('win32');
  f.watch.start();
  const [child] = f.children;
  f.watch.setVolume(32); f.watch.setVolume(34); f.watch.setVolume(36); await flush();
  child!.say('V 30 0\nV 32 0\nV 34 0\n'); await flush();
  assert.deepEqual(f.volumes, [], 'An older wheel step reached the bar');
  child!.say('V 36 0\n'); await flush();
  assert.deepEqual(f.volumes, [[36, false]]);
  t.mock.timers.tick(1000);
  child!.say('V 50 1\n'); await flush();
  assert.deepEqual(f.volumes.at(-1), [50, true], 'A later outside change was dropped');
  f.watch.stop();

  const linux = fixture('linux');
  linux.watch.start();
  linux.watch.setVolume(40); for (let i = 0; i < 5; i++) await flush();
  linux.children[0]!.say("Event 'change' on sink #56\n"); await flush();
  t.mock.timers.tick(300);
  assert.deepEqual(linux.reads.slice(3), [], 'A read during the wheel pulled the bar back');
  t.mock.timers.tick(700);
  linux.children[0]!.say("Event 'change' on sink #56\n"); await flush(); t.mock.timers.tick(300);
  assert.deepEqual(linux.reads.slice(3), ['volume']);
  linux.watch.stop();
});

test('macOS has no live source: nothing runs in the background and the wheel uses osascript, latest target first', async () => {
  const f = fixture('darwin');
  f.watch.start();
  assert.deepEqual([f.children.length, f.reads], [0, ['wifi']]);
  f.watch.setVolume(50); f.watch.setVolume(52); f.watch.setVolume(54);
  for (let i = 0; i < 5; i++) await flush();
  assert.deepEqual(f.runs, ['osascript -e set volume output volume 50 -e set volume without output muted', 'osascript -e set volume output volume 54 -e set volume without output muted'],
    'Wheel steps queued behind a running command instead of keeping only the latest');
  const other = fixture('aix');
  other.watch.start(); other.watch.setVolume(10); await flush();
  assert.deepEqual([other.children.length, other.runs], [0, []]);
});
