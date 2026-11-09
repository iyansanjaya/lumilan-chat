import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareVersions, inline, isVersion, parseChangelog, pendingSince, unseenVersions } from '../src/main/changelog.js';
import type { ChangelogRelease } from '../src/shared/ipc.js';

const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
const plain = (runs: { text: string }[]) => runs.map(run => run.text).join('');

test('changelog inline text keeps bold and code, and links keep only their text', () => {
  assert.deepEqual(inline('Use **Settings → Lumi** and `xdg-open`, see [the Releases page](https://example.com).'), [
    { text: 'Use ' }, { text: 'Settings → Lumi', bold: true }, { text: ' and ' }, { text: 'xdg-open', code: true }, { text: ', see ' }, { text: 'the Releases page' }, { text: '.' }]);
  assert.deepEqual(inline('**[LICENSE](LICENSE) file**'), [{ text: 'LICENSE', bold: true }, { text: ' file', bold: true }]);
  // HTML stays text: the renderer builds text nodes, so nothing here can become markup.
  assert.deepEqual(inline('<img src=x onerror=alert(1)>'), [{ text: '<img src=x onerror=alert(1)>' }]);
  assert.deepEqual(inline(''), []);
});

test('changelog releases keep intros, sections and sub-items, and drop the build notes for developers', () => {
  const releases = parseChangelog(['# Changelog', '', '[Bahasa Indonesia](CHANGELOG.id.md)', '', '## 2.0.0', '', 'Changes from version 1.9.0.', '',
    '### Added', '', '- **One.** First', '  - nested', '- Two', '', '### Build and validation', '', '- New unit tests', '',
    '### Fixed', '', 'A paragraph inside a section.', '', '## Unreleased', '', '- skipped', '', '## 1.9.0', '', '- A list before any heading', ''].join('\r\n'));
  assert.deepEqual(releases.map(release => release.version), ['2.0.0', '1.9.0']);
  const [latest, older] = releases as [ChangelogRelease, ChangelogRelease];
  assert.deepEqual(latest.intro.map(plain), ['Changes from version 1.9.0.']);
  assert.deepEqual(latest.sections.map(section => section.title), ['Added', 'Fixed']);
  assert.deepEqual(latest.sections[0]!.items.map(item => [plain(item.text), item.items?.map(child => plain(child.text))]), [['One. First', ['nested']], ['Two', undefined]]);
  assert.equal(plain(latest.sections[1]!.items[0]!.text), 'A paragraph inside a section.');
  assert.deepEqual([older.sections[0]!.title, plain(older.sections[0]!.items[0]!.text)], ['', 'A list before any heading']);
});

test('the packaged changelogs list the same versions in both languages, newest first, starting with this version', () => {
  const version = JSON.parse(read('package.json')).version;
  const english = parseChangelog(read('CHANGELOG.md')), indonesian = parseChangelog(read('CHANGELOG.id.md'));
  assert.deepEqual(indonesian.map(release => release.version), english.map(release => release.version));
  assert.equal(english[0]?.version, version, `CHANGELOG.md and CHANGELOG.id.md need an entry for ${version}`);
  for (const releases of [english, indonesian]) {
    assert.ok(releases.every((release, index) => isVersion(release.version) && (index === 0 || compareVersions(releases[index - 1]!.version, release.version) > 0)));
    for (const release of releases) {
      assert.ok(release.sections.length, `${release.version} has no sections`);
      assert.ok(release.sections.every(section => section.items.length && !['Build and validation', 'Build dan validasi'].includes(section.title)), release.version);
      assert.ok(release.sections.flatMap(section => section.items).every(item => plain(item.text).trim()), release.version);
    }
  }
});

test("What's new opens once after an update, never on a new profile, and names only the versions since the last one seen", () => {
  assert.equal(pendingSince(false, undefined, '1.4.2'), undefined, 'A new profile opened it');
  assert.equal(pendingSince(true, '1.4.2', '1.4.2'), undefined, 'An already seen version opened it again');
  assert.equal(pendingSince(true, undefined, '1.4.2'), null);
  assert.equal(pendingSince(true, '1.4.0', '1.4.2'), '1.4.0');
  const releases = ['1.5.0', '1.4.2', '1.4.1', '1.4.0', '1.3.0'].map(version => ({ version, intro: [], sections: [] }));
  assert.deepEqual(unseenVersions(releases, '1.4.2', '1.3.0'), ['1.4.2', '1.4.1', '1.4.0'], 'A release newer than the app counted, or one was missed');
  assert.deepEqual(unseenVersions(releases, '1.4.2', null), ['1.4.2']);
  assert.deepEqual(unseenVersions(releases, '1.4.2', '1.4.2'), []);
  assert.deepEqual(unseenVersions(releases, '1.4.2', '1.5.0'), [], 'A downgrade pointed out older versions');
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0 && compareVersions('1.4.2', '1.4.2') === 0 && compareVersions('0.9.0', '1.0.0') < 0);
  for (const value of ['1.4', '1.4.2-beta', 'v1.4.2', 1, null]) assert.equal(isVersion(value), false, String(value));
});
