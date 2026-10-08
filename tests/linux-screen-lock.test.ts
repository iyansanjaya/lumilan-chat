import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { LinuxScreenLock } from '../src/main/linux-screen-lock.js';
class TestProcess extends EventEmitter {
  stdout = new PassThrough();
  killed = false;
  constructor(readonly name: string, readonly path: string) { super(); }
  kill() { this.killed = true; }
  line(line: string) { this.stdout.write(line + '\n'); }
  owner(owner: string) { this.line(`The name ${this.name} is owned by ${owner}`); }
  absent() { this.line(`The name ${this.name} does not have an owner`); }
  signal(active: boolean) { this.line(`${this.path}: ${this.name}.ActiveChanged (${active},)`); }
}
interface TestQuery { callback: (error: Error | null, output: string) => void; args: string[]; killed: boolean; kill(): void }


test('Linux lock follows desktop state, rejects stale replies, fails closed and never polls idle', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const power = new EventEmitter(), events: string[] = [], children: TestProcess[] = [], calls: TestQuery[] = [];
  power.on('lock-screen', () => events.push('lock'));
  power.on('unlock-screen', () => events.push('unlock'));
  const monitor = new LinuxScreenLock(power, {
    spawnProcess(command, args, options) {
      assert.equal(command, 'gdbus'); assert.equal(options.env.LC_ALL, 'C');
      const child = new TestProcess(args[args.indexOf('--dest') + 1]!, args.at(-1)!);
      children.push(child); return child;
    },
    call(command, args, options, callback) {
      assert.equal(command, 'gdbus'); assert.equal(options.timeout, 3000); assert.equal(options.maxBuffer, 4096);
      const request = { callback, args, killed: false, kill() { this.killed = true; } }; calls.push(request); return request;
    },
  });
  const childAt = (index: number) => { const child = children[index]; assert(child); return child; };
  const callAt = (index: number) => { const call = calls.at(index); assert(call); return call; };
  try {
    assert.equal(monitor.locked, true); assert.deepEqual(events, ['lock']);
    childAt(0).owner(':1.10'); childAt(1).absent(); childAt(2).absent();
    assert.equal(callAt(0).args[callAt(0).args.indexOf('--dest') + 1], ':1.10', 'Read from the observed owner, not a replacement service');
    callAt(0).callback(null, '(true,)\n'); assert.equal(monitor.locked, true, 'Startup already locked');
    childAt(0).signal(false); assert.equal(monitor.locked, false); assert.equal(monitor.supported, true);
    childAt(0).line('/wrong: org.gnome.ScreenSaver.ActiveChanged (true,)');
    childAt(0).line(`${childAt(0).path}: org.fake.ScreenSaver.ActiveChanged (true,)`);
    childAt(0).line(`${childAt(0).path}: org.gnome.ScreenSaver.ActiveChanged ('true',)`);
    assert.equal(monitor.locked, false, 'Unrelated/malformed signals changed lock state');
    childAt(0).owner(':1.11'); assert.equal(monitor.locked, true);
    const old = callAt(-1); childAt(0).signal(true); old.callback(null, '(false,)');
    assert.equal(monitor.locked, true, 'A stale initial reply unlocked a newer lock signal');
    childAt(0).owner(':1.12'); const replaced = callAt(-1);
    childAt(0).owner(':1.13'); replaced.callback(null, '(false,)');
    assert.equal(monitor.locked, true, 'A previous service owner unlocked its replacement');
    callAt(-1).callback(null, '(false,)'); assert.equal(monitor.locked, false);
    childAt(1).owner(':1.14'); callAt(-1).callback(null, '(true,)');
    assert.equal(monitor.locked, true, 'One unlocked provider overrode a locked provider');
    childAt(1).signal(false); assert.equal(monitor.locked, false);
    const idleCalls = calls.length;
    t.mock.timers.tick(3600000);
    assert.equal(children.length, 3); assert.equal(calls.length, idleCalls);
    childAt(0).emit('error', new Error('desktop bus disconnected'));
    assert.equal(monitor.locked, true, 'Loss of observation exposed private content');
    power.emit('resume'); assert.equal(children.length, 6);
    assert(children.slice(0, 3).every(c => c.killed));
    childAt(3).owner(':1.20'); childAt(4).absent(); childAt(5).absent();
    callAt(-1).callback(null, '(false,)'); assert.equal(monitor.locked, false);
    childAt(3).owner(':1.21'); callAt(-1).callback(new Error('GetActive failed'), '');
    assert.equal(monitor.locked, true); assert.equal(monitor.supported, false);
    childAt(3).signal(false); assert.equal(monitor.locked, false);
    children.slice(3).forEach(c => c.absent()); assert.equal(monitor.locked, true); assert.equal(monitor.supported, false);
    childAt(3).stdout.write('x'.repeat(16385)); assert(childAt(3).killed, 'Unbounded helper output');
  } finally { monitor.dispose(); }
  assert.equal(power.listenerCount('resume'), 0); assert(children.every(c => c.killed));
  const before = events.length; childAt(3).owner(':1.99'); power.emit('resume');
  assert.equal(events.length, before, 'Disposed monitor still delivered events');
});
