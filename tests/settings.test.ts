import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettings } from '../src/main/settings.js';

test('settings default safely for a missing, empty or non-object saved file', () => {
  for (const saved of [undefined, null, {}, [], 'text', 42]) {
    assert.deepEqual(parseSettings(saved, 'ID'), { enabled: true, preview: false, silent: false, background: true, notch: true,
      notchPosition: undefined, languageMode: 'auto', language: 'id', linkPreviews: 'ask', focus: 0, notchIdle: 'always', notchOpen: 'click', notchOpened: false }, JSON.stringify(saved));
  }
  // Only an explicit false disables; only an explicit true enables privacy-sensitive previews and silence.
  const saved = parseSettings({ enabled: 0, preview: 'yes', silent: 1, background: null, notch: '' }, 'US');
  assert.deepEqual([saved.enabled, saved.preview, saved.silent, saved.background, saved.notch], [true, false, false, true, true]);
  assert.deepEqual(parseSettings({ enabled: false, preview: true, silent: true, background: false, notch: false }, 'US'),
    { ...parseSettings({}, 'US'), enabled: false, preview: true, silent: true, background: false, notch: false });
});

test('a saved Lumi position needs a safe display id and finite fraction, and is clamped to the work area', () => {
  for (const position of [{ display: 1.5, fraction: .5 }, { display: 2, fraction: Number.NaN }, { display: 2 }, { fraction: .5 },
    { display: Number.MAX_SAFE_INTEGER + 2, fraction: .5 }, { display: '2', fraction: .5 }, 'left'])
    assert.equal(parseSettings({ notchPosition: position }, 'US').notchPosition, undefined, JSON.stringify(position));
  assert.deepEqual(parseSettings({ notchPosition: { display: 7, fraction: 2 } }, 'US').notchPosition, { display: 7, fraction: .95 });
  assert.deepEqual(parseSettings({ notchPosition: { display: -3, fraction: -1 } }, 'US').notchPosition, { display: -3, fraction: .05 });
  assert.deepEqual(parseSettings({ notchPosition: { display: 7, fraction: .3, extra: true } }, 'US').notchPosition, { display: 7, fraction: .3 });
});

test('link previews accept only on or off, and a manual language survives while anything else follows the region', () => {
  for (const value of ['on', 'off'] as const) assert.equal(parseSettings({ linkPreviews: value }, 'US').linkPreviews, value);
  for (const value of ['ON', true, 'ask', 'always', undefined]) assert.equal(parseSettings({ linkPreviews: value }, 'US').linkPreviews, 'ask');
  assert.deepEqual(pick(parseSettings({ languageMode: 'manual', language: 'ja' }, 'ID')), { languageMode: 'manual', language: 'ja' });
  assert.deepEqual(pick(parseSettings({ languageMode: 'auto', language: 'ja' }, 'ID')), { languageMode: 'auto', language: 'id' });
  assert.deepEqual(pick(parseSettings({ language: 'klingon' }, 'JP')), { languageMode: 'auto', language: 'ja' });
});

function pick(value: { languageMode: string; language: string }) { return { languageMode: value.languageMode, language: value.language }; }

test('focus sessions stay off unless one of the offered default lengths was saved', () => {
  for (const value of [25, 45, 60] as const) assert.equal(parseSettings({ focus: value }, 'ID').focus, value);
  for (const value of [undefined, null, 0, 5, 30, 180, '25', true, -25, 25.5, {}])
    assert.equal(parseSettings({ focus: value }, 'ID').focus, 0, JSON.stringify(value));
});

test('the Lumi pill stays on screen unless the earlier only-while-unwatched behavior was saved', () => {
  assert.equal(parseSettings({ notchIdle: 'away' }, 'ID').notchIdle, 'away');
  for (const value of [undefined, 'always', 'ALWAYS', 'never', true, 1, null, { away: true }])
    assert.equal(parseSettings({ notchIdle: value }, 'ID').notchIdle, 'always', JSON.stringify(value));
});

test('the Lumi panel opens on click unless hover was saved, and the intro ends only after an explicit first opening', () => {
  assert.equal(parseSettings({ notchOpen: 'hover' }, 'ID').notchOpen, 'hover');
  for (const value of [undefined, 'click', 'HOVER', true, 1, null, { hover: true }])
    assert.equal(parseSettings({ notchOpen: value }, 'ID').notchOpen, 'click', JSON.stringify(value));
  assert.equal(parseSettings({ notchOpened: true }, 'ID').notchOpened, true);
  for (const value of [undefined, 'true', 1, null, {}])
    assert.equal(parseSettings({ notchOpened: value }, 'ID').notchOpened, false, JSON.stringify(value));
});
