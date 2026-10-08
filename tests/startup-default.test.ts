import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearPendingDefaultStartup, enableDefaultStartup } from '../src/main/startup-default.js';

test('autostart bawaan hanya diaktifkan pada profil baru dari paket aplikasi', () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-startup-test-'));
  const dataDir = join(root, 'profile');
  const calls: boolean[] = [];
  const app = { isPackaged: true, commandLine: { hasSwitch: () => false } };
  const enable = (value: boolean) => calls.push(value);
  try {
    enableDefaultStartup(dataDir, app, () => ({ supported: true }), enable);
    assert.deepEqual(calls, [true]);
    assert.equal(existsSync(join(dataDir, 'startup-default-pending')), false);
    enableDefaultStartup(dataDir, app, () => ({ supported: true }), enable);
    const other = join(root, 'other');
    enableDefaultStartup(other, { ...app, isPackaged: false }, () => ({ supported: true }), enable);
    assert.equal(existsSync(join(other, 'startup-default-pending')), true);
    enableDefaultStartup(other, { ...app, commandLine: { hasSwitch: () => true } }, () => ({ supported: true }), enable);
    enableDefaultStartup(other, app, () => ({ supported: false }), enable);
    assert.deepEqual(calls, [true]);
    let warning = '';
    assert.doesNotThrow(() => enableDefaultStartup(other, app, () => ({ supported: true }),
      () => { throw new Error('blocked'); }, message => { warning = message; }));
    assert.match(warning, /Autostart/);
    enableDefaultStartup(other, app, () => ({ supported: true }), enable);
    assert.deepEqual(calls, [true, true]);
    assert.equal(existsSync(join(other, 'startup-default-pending')), false);
    const manual = join(root, 'manual');
    enableDefaultStartup(manual, { ...app, isPackaged: false }, () => ({ supported: true }), enable);
    clearPendingDefaultStartup(manual);
    enableDefaultStartup(manual, app, () => ({ supported: true }), enable);
    assert.deepEqual(calls, [true, true]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
