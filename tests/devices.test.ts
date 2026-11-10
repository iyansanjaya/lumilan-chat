import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceStatus, changes, macWifiDevice, osText, parseBluetoothctl, parseMacVolume, parseMacWifi, parseNetsh, parseNmcli, parsePactl, parseSystemProfiler,
  parseWindowsVolume, parseWpctl, type DevicesOptions } from '../src/main/devices.js';
import type { DevicesView } from '../src/shared/notch.js';

test('Wi-Fi from netsh is read by value shape, so a localized Windows reads the same', () => {
  const english = 'There is 1 interface on the system:\r\n\r\n    Name                   : Wi-Fi\r\n    State                  : connected\r\n    SSID                   : ngedenhard\r\n'
    + '    BSSID                  : aa:bb:cc:dd:ee:ff\r\n    Band                   : 2.4 GHz \r\n    Receive rate (Mbps)    : 144.4\r\n    Signal                 : 85% \r\n';
  assert.deepEqual(parseNetsh(english), { connected: true, ssid: 'ngedenhard', signal: 85, band: '2.4 GHz' });
  const indonesian = '    Nama                   : Wi-Fi\n    Status                 : tersambung\n    SSID                   : Kantor Lt 2\n    BSSID                  : 11:22:33:44:55:66\n    Pita                   : 5 GHz\n    Sinyal                 : 72%\n';
  assert.deepEqual(parseNetsh(indonesian), { connected: true, ssid: 'Kantor Lt 2', signal: 72, band: '5 GHz' });
  assert.deepEqual(parseNetsh('    Name : Wi-Fi\n    State : disconnected\n    Radio status : Hardware On\n'), { connected: false });
  // A name from the network is shown as text: controls and bidi overrides out, capped at 32 characters.
  assert.equal(parseNetsh(`    SSID : Free‮Wifi\u0007${'x'.repeat(40)}\n`).ssid, `Free Wifi ${'x'.repeat(22)}`);
});

test('Wi-Fi on Linux and macOS: escaped colons, frequency bands, and a name macOS keeps hidden', () => {
  assert.deepEqual(parseNmcli('no:Neighbour:40:2412 MHz\nyes:Lab\\:2:91:5180 MHz\n'), { connected: true, ssid: 'Lab:2', signal: 91, band: '5 GHz' });
  assert.deepEqual(parseNmcli('yes:Studio:55:5975 MHz\n'), { connected: true, ssid: 'Studio', signal: 55, band: '6 GHz' });
  assert.deepEqual(parseNmcli('no:Neighbour:40:2412 MHz\n'), { connected: false });
  assert.deepEqual(parseMacWifi('<dictionary> {\n  LinkStatusActive : TRUE\n  SSID : Rumah\n}'), { connected: true, ssid: 'Rumah' });
  assert.deepEqual(parseMacWifi('<dictionary> {\n  LinkStatusActive : TRUE\n  SSID : <redacted>\n}'), { connected: true });
  assert.deepEqual(parseMacWifi('<dictionary> {\n  LinkStatusActive : FALSE\n}'), { connected: false });
  assert.equal(macWifiDevice('Hardware Port: Ethernet\nDevice: en0\n\nHardware Port: Wi-Fi\nDevice: en1\n'), 'en1');
  assert.equal(macWifiDevice('Hardware Port: Ethernet\nDevice: en0\n'), undefined);
});

test('Bluetooth names from every system are deduplicated, cleaned and capped at eight', () => {
  assert.deepEqual(parseBluetoothctl('Device 00:1A:7D:DA:71:13 Galaxy Buds\nDevice A4:C1:38:00:00:01 Keyboard K380\nnot a device\n'), { devices: ['Galaxy Buds', 'Keyboard K380'] });
  const profiler = JSON.stringify({ SPBluetoothDataType: [{ controller_properties: {}, device_connected: [{ 'AirPods Pro': { device_address: 'x' } }, { 'Magic Mouse': {} }],
    device_not_connected: [{ 'Old Speaker': {} }] }] });
  assert.deepEqual(parseSystemProfiler(profiler), { devices: ['AirPods Pro', 'Magic Mouse'] });
  assert.deepEqual(parseSystemProfiler(JSON.stringify({ SPBluetoothDataType: [{}] })), { devices: [] });
  assert.equal(parseBluetoothctl(Array.from({ length: 12 }, (_, index) => `Device 00:1A:7D:DA:71:${String(index).padStart(2, '0')} Device ${index}`).join('\n')).devices.length, 8);
  assert.throws(() => parseSystemProfiler('not json'));
});

test('volume from Windows, macOS and Linux, and a reading that cannot be parsed', () => {
  assert.deepEqual(parseWindowsVolume('42 False\r\n'), { level: 42, muted: false });
  assert.deepEqual(parseWindowsVolume('100 True'), { level: 100, muted: true });
  assert.deepEqual(parseMacVolume('output volume:50, input volume:75, alert volume:100, output muted:true'), { level: 50, muted: true });
  assert.throws(() => parseMacVolume('output volume:missing value, input volume:missing value, alert volume:missing value, output muted:missing value'));
  assert.deepEqual(parseWpctl('Volume: 0.40 [MUTED]\n'), { level: 40, muted: true });
  assert.deepEqual(parseWpctl('Volume: 1.20\n'), { level: 100, muted: false }, 'Over-amplified sinks are shown as 100%');
  assert.deepEqual(parsePactl('Volume: front-left: 26214 /  40% / -23.88 dB,   front-right: 26214 /  40% / -23.88 dB', 'Mute: no'), { level: 40, muted: false });
  assert.throws(() => parseWindowsVolume('Add-Type : blocked by policy'));
  assert.equal(osText(undefined, 10), '');
});

function fixture(platform: NodeJS.Platform, outputs: Record<string, string | Error>) {
  let now = 1_000_000;
  const calls: string[] = [], views: DevicesView[] = [];
  const options: DevicesOptions = {
    platform,
    run: async command => {
      calls.push(command);
      const output = outputs[command];
      if (output === undefined || output instanceof Error) throw output ?? new Error(`${command}: not found`);
      return output;
    },
    displays: () => [{ width: 2560.4, height: 1440, scale: 1, primary: true, internal: false, label: 'DELL‮ U2719D' }, { width: 1920, height: 1080, scale: 1.25, primary: false, internal: true, label: '' }],
    onChange: view => views.push(structuredClone(view)),
    now: () => now,
  };
  return { status: new DeviceStatus(options), calls, views, advance: (ms: number) => { now += ms; } };
}

test('device status reads each part once in parallel, shows it pending, and reuses it for 30 seconds', async () => {
  const f = fixture('linux', { nmcli: 'yes:Kantor:80:2437 MHz\n', bluetoothctl: 'Device 00:1A:7D:DA:71:13 Headset\n', wpctl: 'Volume: 0.35\n' });
  assert.deepEqual(f.status.view.displays.map(display => [display.width, display.label]), [[2560, 'DELL U2719D'], [1920, '']]);
  await Promise.all([f.status.refresh(), f.status.refresh()]);
  assert.deepEqual(f.calls.sort(), ['bluetoothctl', 'nmcli', 'wpctl'], 'A second read while the first ran started the probes again');
  assert.deepEqual(f.views[0]!.pending, ['wifi', 'bluetooth', 'volume']);
  assert.deepEqual(f.views.at(-1), { displays: f.status.view.displays, wifi: { connected: true, ssid: 'Kantor', signal: 80, band: '2.4 GHz' },
    bluetooth: { devices: ['Headset'] }, volume: { level: 35, muted: false }, pending: [] });
  const published = f.views.length;
  f.advance(29_000); await f.status.refresh();
  assert.deepEqual([f.calls.length, f.views.length], [3, published], 'A read within 30 seconds probed again or published an unchanged view');
  await f.status.refresh(['volume'], true);
  assert.equal(f.calls.length, 4, 'Refresh did not read again');
  f.advance(2000); await f.status.refresh();
  assert.equal(f.calls.length, 6, 'Parts older than 30 seconds were not read again');
});

test('a failed read keeps what was known, a part never read is unavailable, and other systems read nothing', async () => {
  const outputs: Record<string, string | Error> = { netsh: '    SSID : Lab\n', 'powershell.exe': new Error('Add-Type blocked by Constrained Language Mode') };
  const f = fixture('win32', outputs);
  await f.status.refresh();
  assert.deepEqual([f.status.view.wifi, f.status.view.bluetooth, f.status.view.volume], [{ connected: true, ssid: 'Lab' }, null, null]);
  outputs.netsh = new Error('timeout');
  await f.status.refresh(['wifi'], true);
  assert.deepEqual(f.status.view.wifi, { connected: true, ssid: 'Lab' }, 'A timeout erased the last known network');
  // Linux falls back from wpctl to pactl.
  const pulse = fixture('linux', { pactl: 'Volume: front-left: 1 /  64% / 0 dB\nMute: yes' });
  await pulse.status.refresh(['volume']);
  assert.deepEqual(pulse.status.view.volume, { level: 64, muted: true });
  const other = fixture('aix', {});
  await other.status.refresh();
  assert.deepEqual([other.calls.length, other.status.view.wifi, other.status.view.bluetooth, other.status.view.volume], [0, null, null, null]);
  // Displays come from the screen, not a probe, and only a real change is published.
  const before = other.views.length;
  other.status.displaysChanged();
  assert.equal(other.views.length, before);
});

test('live changes: a part read for the first time is silent, then volume, Bluetooth and a new Wi-Fi are announced', () => {
  const base: DevicesView = { displays: [], wifi: undefined, bluetooth: undefined, volume: undefined, pending: [] };
  const known: DevicesView = { ...base, wifi: { connected: true, ssid: 'Rumah' }, bluetooth: { devices: ['Mouse'] }, volume: { level: 20, muted: false } };
  assert.deepEqual(changes(base, known), [], 'The first reading was announced');
  assert.deepEqual(changes({ ...base, volume: null, bluetooth: null, wifi: null }, known), [], 'A part that was unavailable announced its first value');
  assert.deepEqual(changes(known, { ...known, pending: ['volume'] }), []);
  assert.deepEqual(changes(known, { ...known, volume: { level: 24, muted: false } }), [{ source: 'volume', status: 'on', level: 24 }]);
  assert.deepEqual(changes(known, { ...known, volume: { level: 20, muted: true } }), [{ source: 'volume', status: 'muted', level: 20 }]);
  assert.deepEqual(changes(known, { ...known, bluetooth: { devices: ['Galaxy Buds', 'Keyboard'] } }), [
    { source: 'bluetooth', status: 'connected', name: 'Galaxy Buds' }, { source: 'bluetooth', status: 'connected', name: 'Keyboard' },
    { source: 'bluetooth', status: 'disconnected', name: 'Mouse' }]);
  assert.deepEqual(changes(known, { ...known, wifi: { connected: true, ssid: 'Kantor', signal: 70 } }), [{ source: 'wifi', status: 'connected', name: 'Kantor' }]);
  assert.deepEqual(changes(known, { ...known, wifi: { connected: true, ssid: 'Rumah', signal: 40 } }), [], 'A signal change was announced');
  assert.deepEqual(changes(known, { ...known, wifi: { connected: false } }), [], 'Leaving Wi-Fi was announced twice with the network notice');
  assert.deepEqual(changes({ ...known, wifi: { connected: false } }, known), [{ source: 'wifi', status: 'connected', name: 'Rumah' }]);
  assert.deepEqual(changes(known, { ...known, wifi: { connected: true } }), [], 'A hidden macOS network name was announced');
});

test('Windows Bluetooth: the probe learns addresses, a radio link shows at once and wins over a probe still behind', async () => {
  const outputs: Record<string, string> = { 'powershell.exe': '70700D7DC3FD\t1\tiPhone\r\n70700D7DC3FD\t1\tiPhone\r\n9D4CFC5ACBD0\t0\tHeadset\r\nnoise\r\n5D6B8EB45725\t0\t\u0007\r\n' };
  const f = fixture('win32', outputs);
  await f.status.refresh(['bluetooth']);
  assert.deepEqual(f.status.view.bluetooth, { devices: ['iPhone'] });
  assert.deepEqual([...f.status.addresses], [['70700D7DC3FD', 'iPhone'], ['9D4CFC5ACBD0', 'Headset']]);
  f.status.link('70700d7dc3fd', false);
  assert.deepEqual(f.status.view.bluetooth, { devices: [] }, 'A known device did not leave at once');
  f.status.link('9D4CFC5ACBD0', true);
  f.status.link('AABBCCDDEEFF', true);
  assert.deepEqual(f.status.view.bluetooth, { devices: ['Headset'] }, 'An unknown address changed the list');
  // Windows still says the iPhone is connected and the headset is not: the radio is newer for 15 seconds.
  await f.status.refresh(['bluetooth'], true);
  assert.deepEqual(f.status.view.bluetooth, { devices: ['Headset'] }, 'A probe behind the radio brought the iPhone back');
  f.advance(15_000); await f.status.refresh(['bluetooth'], true);
  assert.deepEqual(f.status.view.bluetooth, { devices: ['iPhone'] }, 'The probe did not win after the radio report aged');
});

test('a forced read asked for while one runs reads once more when it ends', async () => {
  let release: (() => void) | undefined, calls = 0;
  const status = new DeviceStatus({ platform: 'linux', displays: () => [], onChange: () => {},
    run: async () => { calls++; if (calls === 1) await new Promise<void>(resolve => { release = resolve; }); return `Device 00:1A:7D:DA:71:13 ${calls === 1 ? 'Old' : 'New'}\n`; } });
  const first = status.refresh(['bluetooth'], true);
  await status.refresh(['bluetooth'], true); await status.refresh(['bluetooth'], true);
  release!(); await first;
  assert.deepEqual([calls, status.view.bluetooth], [2, { devices: ['New'] }], 'The change after the running read was lost or read twice more');
});

test('a value pushed by the watcher is fresh and published once', async () => {
  const f = fixture('win32', { 'powershell.exe': '55 False' });
  f.status.set('volume', { level: 42.4, muted: true });
  assert.deepEqual(f.status.view.volume, { level: 42, muted: true });
  const published = f.views.length;
  f.status.set('volume', { level: 42, muted: true });
  assert.equal(f.views.length, published, 'An unchanged value was published again');
  f.advance(10_000); await f.status.refresh(['volume']);
  assert.equal(f.calls.length, 0, 'A pushed value was probed again within 30 seconds');
});
