import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { LinuxScreenLock } from './linux-screen-lock.js';

test('Linux lock follows desktop state, rejects stale replies, fails closed and never polls idle', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const power = new EventEmitter(), events = [], children = [], calls = [];
  power.on('lock-screen', () => events.push('lock'));
  power.on('unlock-screen', () => events.push('unlock'));
  const monitor = new LinuxScreenLock(power, {
    spawnProcess(command, args, options) {
      assert.equal(command, 'gdbus'); assert.equal(options.env.LC_ALL, 'C');
      const child = new EventEmitter(); child.stdout = new PassThrough();
      child.name = args[args.indexOf('--dest') + 1]; child.path = args.at(-1);
      child.kill = () => { child.killed = true; };
      child.line = line => child.stdout.write(line + '\n');
      child.owner = owner => child.line(`The name ${child.name} is owned by ${owner}`);
      child.absent = () => child.line(`The name ${child.name} does not have an owner`);
      child.signal = active => child.line(`${child.path}: ${child.name}.ActiveChanged (${active},)`);
      children.push(child); return child;
    },
    call(command, args, options, callback) {
      assert.equal(command, 'gdbus'); assert.equal(options.timeout, 3000); assert.equal(options.maxBuffer, 4096);
      const request = { callback, args, kill() { this.killed = true; } }; calls.push(request); return request;
    },
  });
  try {
    assert.equal(monitor.locked, true); assert.deepEqual(events, ['lock']);
    children[0].owner(':1.10'); children[1].absent(); children[2].absent();
    assert.equal(calls[0].args[calls[0].args.indexOf('--dest') + 1], ':1.10', 'Read from the observed owner, not a replacement service');
    calls[0].callback(null, '(true,)\n'); assert.equal(monitor.locked, true, 'Startup already locked');
    children[0].signal(false); assert.equal(monitor.locked, false); assert.equal(monitor.supported, true);
    children[0].line('/wrong: org.gnome.ScreenSaver.ActiveChanged (true,)');
    children[0].line(`${children[0].path}: org.fake.ScreenSaver.ActiveChanged (true,)`);
    children[0].line(`${children[0].path}: org.gnome.ScreenSaver.ActiveChanged ('true',)`);
    assert.equal(monitor.locked, false, 'Unrelated/malformed signals changed lock state');
    children[0].owner(':1.11'); assert.equal(monitor.locked, true);
    const old = calls.at(-1); children[0].signal(true); old.callback(null, '(false,)');
    assert.equal(monitor.locked, true, 'A stale initial reply unlocked a newer lock signal');
    children[0].owner(':1.12'); const replaced = calls.at(-1);
    children[0].owner(':1.13'); replaced.callback(null, '(false,)');
    assert.equal(monitor.locked, true, 'A previous service owner unlocked its replacement');
    calls.at(-1).callback(null, '(false,)'); assert.equal(monitor.locked, false);
    children[1].owner(':1.14'); calls.at(-1).callback(null, '(true,)');
    assert.equal(monitor.locked, true, 'One unlocked provider overrode a locked provider');
    children[1].signal(false); assert.equal(monitor.locked, false);
    const idleCalls = calls.length;
    t.mock.timers.tick(3600000);
    assert.equal(children.length, 3); assert.equal(calls.length, idleCalls);
    children[0].emit('error', new Error('desktop bus disconnected'));
    assert.equal(monitor.locked, true, 'Loss of observation exposed private content');
    power.emit('resume'); assert.equal(children.length, 6);
    assert(children.slice(0, 3).every(c => c.killed));
    children[3].owner(':1.20'); children[4].absent(); children[5].absent();
    calls.at(-1).callback(null, '(false,)'); assert.equal(monitor.locked, false);
    children[3].owner(':1.21'); calls.at(-1).callback(new Error('GetActive failed'), '');
    assert.equal(monitor.locked, true); assert.equal(monitor.supported, false);
    children[3].signal(false); assert.equal(monitor.locked, false);
    children.slice(3).forEach(c => c.absent()); assert.equal(monitor.locked, true); assert.equal(monitor.supported, false);
    children[3].stdout.write('x'.repeat(16385)); assert(children[3].killed, 'Unbounded helper output');
  } finally { monitor.dispose(); }
  assert.equal(power.listenerCount('resume'), 0); assert(children.every(c => c.killed));
  const before = events.length; children[3].owner(':1.99'); power.emit('resume');
  assert.equal(events.length, before, 'Disposed monitor still delivered events');
});
