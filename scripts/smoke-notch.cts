import cdp = require('./cdp.cjs');
import type { LumilanPeer } from '../src/main/peer.js';
import type { CallSignal, FileOffer, FileTransfer, Snapshot, Message, ReminderRecord, CallReason } from '../src/shared/model.js';
import type { NotchSnapshot, NotchVisibleItem } from '../src/shared/notch.js';
// Real packaged Electron UI + a real encrypted LAN peer. Isolated profiles only, no production test IPC.
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { spawn, execFile }: typeof import('node:child_process') = require('node:child_process');
const { promisify }: typeof import('node:util') = require('node:util');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync }: typeof import('node:fs') = require('node:fs');
const { createServer }: typeof import('node:net') = require('node:net');
const { tmpdir }: typeof import('node:os') = require('node:os');
const { join, resolve, dirname, basename }: typeof import('node:path') = require('node:path');
const { randomUUID }: typeof import('node:crypto') = require('node:crypto');

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const desktopCall = async (name: string, path: string, method: string, ...args: string[]) => (await promisify(execFile)('gdbus',
  ['call', '--session', '--dest', name, '--object-path', path, '--method', method, ...args], { timeout: 5000, maxBuffer: 65536 })).stdout;
const setLocked = async (browser: cdp.CdpConnection, locked: boolean) => {
  if (process.platform === 'linux' && process.env.LUMILAN_DESKTOP_FIXTURE === '1') {
    await desktopCall('org.gnome.ScreenSaver', '/org/gnome/ScreenSaver', 'org.gnome.ScreenSaver.SetActive', String(locked));
    await until(() => browser.evaluate(`smokeLocked===${locked}`), 'native D-Bus lock event');
  } else await browser.evaluate(`smokeElectron.powerMonitor.emit('${locked ? 'lock' : 'unlock'}-screen')`);
};
async function until<T>(check: () => T | Promise<T>, label: string, ms = 12000): Promise<Exclude<T, false | null | undefined | 0 | ''>> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await check(); if (value) return value as Exclude<T, false | null | undefined | 0 | ''>; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
const connect = cdp.connect;

async function main() {
  const root = resolve(__dirname, '../..'), dist = resolve(root, process.env.LUMILAN_BUILD_DIR || 'dist');
  const folder = readdirSync(dist).find(name => process.platform === 'win32' ? name === 'win-unpacked' : process.platform === 'darwin' ? /^mac(?:-|$)/.test(name) : /^linux.*-unpacked$/.test(name));
  assert(folder, 'Packaged application missing');
  const executable = process.platform === 'win32' ? join(dist, folder, 'Lumilan Chat.exe') : process.platform === 'darwin' ? join(dist, folder, 'Lumilan Chat.app', 'Contents', 'MacOS', 'Lumilan Chat') : join(dist, folder, 'lumilan-chat');
  const tempRoot = realpathSync(tmpdir()), profile = mkdtempSync(join(tempRoot, 'lumilan-notch-smoke-'));
  const server = createServer(); server.listen(0, '127.0.0.1');
  const port = await new Promise<number>(resolve => server.once('listening', () => { const address = server.address(); assert(address && typeof address !== 'string'); resolve(address.port); }));
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const inspectorServer = createServer(); inspectorServer.listen(0, '127.0.0.1');
  const inspectorPort = await new Promise<number>(resolve => inspectorServer.once('listening', () => { const address = inspectorServer.address(); assert(address && typeof address !== 'string'); resolve(address.port); }));
  await new Promise<void>((resolve, reject) => inspectorServer.close(error => error ? reject(error) : resolve()));
  if (process.env.LUMILAN_SMOKE_SOFTWARE_RENDERING === '1') console.log('Notch smoke: software rendering (sandbox enabled)');
  const child = spawn(executable, [`--remote-debugging-port=${port}`, `--inspect=127.0.0.1:${inspectorPort}`, `--user-data-dir=${profile}`, '--lumilan-ui-smoke', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    ...(process.env.LUMILAN_SMOKE_SOFTWARE_RENDERING === '1' ? ['--disable-gpu'] : []),
    ...(process.platform === 'linux' ? [`--ozone-platform=${process.env.XDG_SESSION_TYPE === 'wayland' ? 'wayland' : 'x11'}`] : [])], {
    cwd: root, env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile, ELECTRON_ENABLE_LOGGING: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  let launchError: Error | undefined, peer: LumilanPeer | undefined, third: LumilanPeer | undefined;
  let appPage: cdp.CdpConnection | undefined, notchPage: cdp.CdpConnection | undefined, browser: cdp.CdpConnection | null | undefined;
  const failures: string[] = [];
  child.once('error', error => { launchError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-16000); });
  try {
    const pages = await until(async () => {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Application exited: ${logs}`);
      try {
        const all = cdp.debugPages(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json());
        return all.some(p => p.url === 'lumilan://app/index.html') && all;
      } catch { return false; }
    }, 'main page', 30000);
    const mainPage = await connect(pages.find(p => p.url === 'lumilan://app/index.html')!.webSocketDebuggerUrl, failures);
    appPage = mainPage;
    const inspectPages = cdp.debugPages(await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json());
    const nativeBrowser = await connect(inspectPages[0]!.webSocketDebuggerUrl, failures, false);
    browser = nativeBrowser;
    await nativeBrowser.evaluate(`globalThis.smokeElectron=process.getBuiltinModule('module').createRequire(${JSON.stringify(join(root,'package.json'))})('electron');true`);
    // DevTools can advertise the page before the native window URL converges.
    await until(() => nativeBrowser.evaluate("(()=>{const main=smokeElectron.BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w.webContents.isDestroyed()&&w.webContents.getURL()==='lumilan://app/index.html');if(!main)return false;globalThis.smokeMain=main;return true;})()"),
      'native main window with exact application URL', 30000);
    await nativeBrowser.evaluate("globalThis.smokeLocked=false;smokeElectron.powerMonitor.on('lock-screen',()=>smokeLocked=true);smokeElectron.powerMonitor.on('unlock-screen',()=>smokeLocked=false)");
    // OS idle time keeps growing on an unattended desktop or CI display, and CDP input does not reset it. Check the
    // native source once, then control idle time so 'person away' happens only where a step asks for it.
    const nativeIdle = await nativeBrowser.evaluate<number>("(()=>{const seconds=smokeElectron.powerMonitor.getSystemIdleTime();globalThis.smokeIdleSeconds=0;smokeElectron.powerMonitor.getSystemIdleTime=()=>smokeIdleSeconds;return seconds})()");
    assert(typeof nativeIdle === 'number' && Number.isFinite(nativeIdle) && nativeIdle >= 0, `Native idle source returned ${String(nativeIdle)}`);
    console.log(`Attention: native idle source reports ${nativeIdle} s; smoke controls idle time`);
    // CI has no microphone/TCC interaction. Exercise real WebRTC with fake devices;
    // the signed package's audio entitlement is verified separately in the workflow.
    if (process.platform === 'darwin') {
      await nativeBrowser.evaluate('smokeElectron.systemPreferences.askForMediaAccess=async()=>true');
      console.log('macOS smoke: fake microphone and test-only TCC gate; physical microphone permission remains a device check');
    }
    if (process.platform === 'linux') await until(() => mainPage.evaluate("window.lumilan.notificationSettings().then(s=>!s.error)"), 'Linux desktop lock service available');
    await until(() => mainPage.evaluate("!!window.lumilan && document.readyState==='complete' && !document.querySelector('#join-screen').hidden"), 'renderer ready');
    await mainPage.evaluate("document.querySelector('#join-name').value='Notch Smoke'; document.querySelector('#join-form').requestSubmit()");
    await until(() => mainPage.evaluate("!document.querySelector('#app').hidden"), 'chat loaded');
    console.log('Notch smoke: main renderer ready');
    await mainPage.evaluate("document.querySelector('#language-select').value='id'; document.querySelector('#language-select').dispatchEvent(new Event('change'))");
    await until(() => mainPage.evaluate("window.lumilan.notificationSettings().then(s=>s.language==='id')"), 'Indonesian language');
    // Native OS clipboard -> Chromium paste -> sandboxed preload -> validated
    // file path -> Personal notes. Preserve the user's clipboard, never log it.
    const clipboardPng=await require('sharp')({create:{width:24,height:16,channels:4,background:'#ffd36d'}}).png().toBuffer();
    await nativeBrowser.evaluate("(async()=>{globalThis.savedClipboard=[];for(const item of await smokeElectron.clipboard.read()){const data={};for(const type of item.types)data[type]=await item.getType(type);if(Object.keys(data).length)savedClipboard.push(new smokeElectron.ClipboardItem(data));}})()");
    try {
      await until(() => nativeBrowser.evaluate('smokeMain.isVisible() && !smokeMain.isMinimized()'), 'native clipboard window shown', 30000);
      await nativeBrowser.evaluate('smokeMain.focus()');
      await until(() => nativeBrowser.evaluate('smokeMain.isFocused()'), 'native clipboard window focused');
      await mainPage.evaluate("document.getElementById('notes-button').click();document.getElementById('message-input').value='9. First item';document.getElementById('message-input').focus();document.getElementById('message-input').setSelectionRange(13,13)");
      await until(() => mainPage.evaluate("document.hasFocus() && !document.hidden && document.activeElement.id==='message-input' && !document.getElementById('message-form').hidden"), 'native clipboard input focused');
      await mainPage.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await mainPage.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      assert.equal(await mainPage.evaluate("document.getElementById('message-input').value"),'9. First item\n10. ','Enter did not continue list');
      await mainPage.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await mainPage.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      assert.equal(await mainPage.evaluate("document.getElementById('message-input').value"),'9. First item\n','Empty list item did not end list');
      await mainPage.evaluate("document.getElementById('message-input').value='';document.getElementById('message-input').dispatchEvent(new Event('input',{bubbles:true}))");
      await nativeBrowser.evaluate(`(async()=>{await smokeElectron.clipboard.write([new smokeElectron.ClipboardItem({'image/png':new Blob([Buffer.from('${clipboardPng.toString('base64')}','base64')],{type:'image/png'})})]);smokeMain.webContents.paste()})()`);
      await until(()=>mainPage.evaluate("!document.getElementById('clipboard-preview').hidden && document.getElementById('clipboard-thumbnail').naturalWidth===24"),'native clipboard image preview');
      const notesBefore=await mainPage.evaluate("window.lumilan.state().then(s=>s.messages.filter(m=>m.note&&m.kind==='file').length)");
      assert.equal(notesBefore,0,'Pasting transmitted image before Send');
      await mainPage.evaluate("document.getElementById('message-form').requestSubmit()");
      await until(()=>mainPage.evaluate("window.lumilan.state().then(s=>s.messages.some(m=>m.note&&m.kind==='file'))"),'pasted image stored through file pipeline');
      await until(()=>mainPage.evaluate("document.getElementById('clipboard-preview').hidden"),'sent clipboard preview released');
      await assert.rejects(mainPage.evaluate("window.lumilan.file(new File(['<svg/>'],'image.svg',{type:'image/svg+xml'}),'notes')"));
      await assert.rejects(mainPage.evaluate("window.lumilan.clipboardImage(new File(['<svg/>'],'fake.png',{type:'image/png'}))"));
      await assert.rejects(mainPage.evaluate("window.lumilan.clipboardImage(new File([new Uint8Array(20*1024*1024+1)],'oversize.png',{type:'image/png'}))"));
      await assert.rejects(mainPage.evaluate("globalThis.fakeClipboardRead=false;window.lumilan.clipboardImage({type:'image/png',size:1,arrayBuffer:()=>{globalThis.fakeClipboardRead=true;throw new Error('Untrusted file method executed')}})"));
      assert.equal(await mainPage.evaluate('fakeClipboardRead'),false,'Preload trusted a forged Blob method');
      console.log('Native clipboard image preview/send, unsafe image rejection and list Enter behavior passed');
      // Keep races deterministic in the packaged process. These inspector-only
      // holds preserve real Sharp decoding and note storage after release.
      const replacementPng=await require('sharp')({create:{width:31,height:17,channels:4,background:'#4169e1'}}).png().toBuffer();
      const pasteFixture=(name: string,bytes=clipboardPng,type='image/png')=>mainPage.evaluate(`{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('${bytes.toString('base64')}'),c=>c.charCodeAt(0))],${JSON.stringify(name)},{type:${JSON.stringify(type)}}));document.getElementById('message-input').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));}`);
      const holdDecode=()=>nativeBrowser.evaluate(`(async()=>{
        // Sharp 0.35 has separate import/require factories. Production imports
        // its ESM entry; hooking the CJS prototype would leave decoding running.
        const path=process.getBuiltinModule('path');
        const entry=process.getBuiltinModule('module').createRequire(path.join(smokeElectron.app.getAppPath(),'package.json')).resolve('sharp');
        const moduleUrl=process.getBuiltinModule('url').pathToFileURL(path.join(path.dirname(entry),'index.mjs')).href;
        const vm=process.getBuiltinModule('vm');
        globalThis.smokeClipboardSharp=(await vm.runInThisContext('import('+JSON.stringify(moduleUrl)+')',{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER})).default;
        globalThis.smokeOriginalClipboardStats=smokeClipboardSharp.prototype.stats;
        globalThis.smokeClipboardDecodeHeld=false;
        smokeClipboardSharp.prototype.stats=function(...args){
          const image=this, original=smokeOriginalClipboardStats;
          smokeClipboardSharp.prototype.stats=original;
          smokeClipboardDecodeHeld=true;
          let work;
          return new Promise(resolve=>{globalThis.smokeReleaseClipboardDecode=()=>{
            if(!work){work=Promise.resolve().then(()=>original.apply(image,args)).finally(()=>{smokeClipboardDecodeHeld=false});resolve(work)}
            return work;
          }});
        };
      })()`);
      const decodeHeld=()=>until(()=>nativeBrowser.evaluate('smokeClipboardDecodeHeld'), 'clipboard decoder held');
      const releaseDecode=async()=>{
        await nativeBrowser.evaluate('(async()=>{await smokeReleaseClipboardDecode();return true})()');
        await mainPage.evaluate<Snapshot>('window.lumilan.state()');
      };
      const previewWidth=(width: number)=>until(()=>mainPage.evaluate(`!document.getElementById('clipboard-preview').hidden&&document.getElementById('clipboard-thumbnail').naturalWidth===${width}`),'clipboard replacement preview');
      await holdDecode();await pasteFixture('first.png');await decodeHeld();
      await pasteFixture('replacement.png',replacementPng);
      await pasteFixture('invalid.svg',Buffer.from('<svg/>'),'image/svg+xml');
      await releaseDecode();await previewWidth(31);
      const replacementUrl=await mainPage.evaluate("document.getElementById('clipboard-thumbnail').src");
      await mainPage.evaluate("document.getElementById('toast').textContent=''");
      await pasteFixture('corrupt.png',Buffer.from('<svg/>'));
      await until(()=>mainPage.evaluate("document.getElementById('toast').textContent.includes('tidak valid')"),'invalid replacement rejected');
      assert.equal(await mainPage.evaluate("document.getElementById('clipboard-thumbnail').src"),replacementUrl,'Failed replacement discarded the existing draft');
      await holdDecode();await pasteFixture('pending.png');await decodeHeld();
      await pasteFixture('queued.png',replacementPng);
      await mainPage.evaluate("document.getElementById('clipboard-remove').click()");
      await releaseDecode();
      assert.equal(await mainPage.evaluate("document.getElementById('clipboard-preview').hidden&&!document.getElementById('clipboard-thumbnail').hasAttribute('src')"),true,'Remove resurrected a pending clipboard draft');
      await pasteFixture('sending.png');await previewWidth(24);
      await nativeBrowser.evaluate(`(async()=>{
        const moduleUrl=process.getBuiltinModule('url').pathToFileURL(process.getBuiltinModule('path').join(smokeElectron.app.getAppPath(),'out','src','main','peer.js')).href;
        const vm=process.getBuiltinModule('vm');
        globalThis.smokeClipboardPeerPrototype=(await vm.runInThisContext('import('+JSON.stringify(moduleUrl)+')',{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER})).LumilanPeer.prototype;
        globalThis.smokeOriginalNotesSave=smokeClipboardPeerPrototype.saveNoteFilePath;
        globalThis.smokeNotesSaveHeld=false;
        smokeClipboardPeerPrototype.saveNoteFilePath=function(...args){
          const peer=this, original=smokeOriginalNotesSave;
          smokeClipboardPeerPrototype.saveNoteFilePath=original;
          smokeNotesSaveHeld=true;
          let work;
          return new Promise(resolve=>{globalThis.smokeReleaseNotesSave=()=>{
            if(!work){work=Promise.resolve().then(()=>original.apply(peer,args)).finally(()=>{smokeNotesSaveHeld=false});resolve(work)}
            return work;
          }});
        };
      })()`);
      await mainPage.evaluate("document.getElementById('message-form').requestSubmit()");
      await until(()=>nativeBrowser.evaluate('smokeNotesSaveHeld'),'clipboard note storage held');
      await holdDecode();await pasteFixture('next.png',replacementPng);await decodeHeld();
      await nativeBrowser.evaluate('(async()=>{await smokeReleaseNotesSave();return true})()');
      await until(()=>mainPage.evaluate("!document.getElementById('send-button').disabled&&document.getElementById('clipboard-preview').hidden"),'previous Send cleanup');
      await releaseDecode();await previewWidth(31);
      await mainPage.evaluate("document.getElementById('clipboard-remove').click()");
      console.log('Clipboard latest-paste queue, invalid replacement, Remove cancellation and Send/paste overlap passed');
    } finally {
      await nativeBrowser.evaluate(`(async()=>{
        if(globalThis.smokeClipboardSharp&&globalThis.smokeOriginalClipboardStats)smokeClipboardSharp.prototype.stats=smokeOriginalClipboardStats;
        if(globalThis.smokeClipboardPeerPrototype&&globalThis.smokeOriginalNotesSave)smokeClipboardPeerPrototype.saveNoteFilePath=smokeOriginalNotesSave;
        await globalThis.smokeReleaseClipboardDecode?.();await globalThis.smokeReleaseNotesSave?.();
        for(const key of ['smokeClipboardSharp','smokeOriginalClipboardStats','smokeClipboardDecodeHeld','smokeReleaseClipboardDecode','smokeClipboardPeerPrototype','smokeOriginalNotesSave','smokeNotesSaveHeld','smokeReleaseNotesSave'])delete globalThis[key];
      })()`);
      await nativeBrowser.evaluate("(async()=>{if(savedClipboard.length)await smokeElectron.clipboard.write(savedClipboard);else smokeElectron.clipboard.clear();delete globalThis.savedClipboard})()");
    }
    await mainPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:true,notchIdle:'always'})");
    // Lumi's idle pill stays at the top edge over the watched main window without taking focus. Wayland has no overlay.
    if (!(process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland'))
      await until(() => nativeBrowser.evaluate("smokeMain.isFocused()&&smokeElectron.BrowserWindow.getAllWindows().some(w=>w.webContents.getURL()==='lumilan://app/notch.html'&&w.isVisible()&&!w.isFocused())"), 'idle pill over the watched main window');
    const appState = await mainPage.evaluate<Snapshot>('window.lumilan.state()');
    const { LumilanPeer } = await import('../src/main/peer.js');
    const testPeer = new LumilanPeer({ dataDir: join(profile, 'test-peer'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
    peer = testPeer;
    await testPeer.start(); testPeer.rename('Alice LAN'); await testPeer.connectAddress(appState.addresses[0]!);
    const testThird = new LumilanPeer({ dataDir: join(profile, 'third-peer'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
    third = testThird;
    await testThird.start(); testThird.rename('Citra LAN'); await testThird.connectAddress(appState.addresses[0]!);
    console.log('Notch smoke: peer connected');
    await until(() => mainPage.evaluate(`window.lumilan.state().then(s=>s.peers.some(p=>p.id===${JSON.stringify(testPeer.id)}))`), 'encrypted peer connected');
    await until(() => mainPage.evaluate(`document.querySelectorAll('#people-list .person[data-peer]').length===2`), 'both private contacts rendered');
    const originalUiTheme = await mainPage.evaluate<string>('document.documentElement.dataset.theme');
    const waitUiAnimations = () => mainPage.evaluate("Promise.all(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))");
    await mainPage.evaluate('window.lumilan.setNotificationSettings({enabled:false,preview:true,silent:true,background:true,notch:true})');
    await mainPage.evaluate("document.getElementById('notes-button').click()");
    const privateOrder = () => mainPage.evaluate<string[]>("[...document.querySelectorAll('#people-list .person[data-peer]')].map(row=>row.dataset.peer)");
    const aliceRow = `document.querySelector('.person[data-peer="${testPeer.id}"]')`;
    const citraRow = `document.querySelector('.person[data-peer="${testThird.id}"]')`;
    assert.deepEqual(await privateOrder(), [testPeer.id, testThird.id], 'Read contacts lost alphabetical order');
    await mainPage.evaluate(`${aliceRow}.focus({preventScroll:true})`);
    await testThird.sendMessage('Unread sidebar Citra', appState.me.id);
    await until(async () => (await privateOrder())[0] === testThird.id && await mainPage.evaluate(`${citraRow}.querySelector('.unread-badge')?.textContent==='1'`), 'unread contact promoted above read contact');
    assert.equal(await mainPage.evaluate(`document.activeElement===${aliceRow} && document.getElementById('notes-button').classList.contains('active')`), true, 'Unread reorder moved focus or changed the conversation');
    for (const theme of ['light', 'dark']) {
      await mainPage.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await mainPage.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
      await mainPage.evaluate("document.getElementById('back-button').click()");
      await mainPage.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      await waitUiAnimations();
      assert.deepEqual(await privateOrder(), [testThird.id, testPeer.id], `Unread order changed in narrow ${theme} UI`);
      const visibleOrder = await mainPage.evaluate<{firstTop:number;secondTop:number;width:number;nameRight:number;badgeLeft:number;badgeRight:number;rowRight:number}>(`(()=>{const first=${citraRow},second=${aliceRow},row=first.getBoundingClientRect(),badge=first.querySelector('.unread-badge').getBoundingClientRect();return{firstTop:row.top,secondTop:second.getBoundingClientRect().top,width:row.width,nameRight:first.querySelector('strong').getBoundingClientRect().right,badgeLeft:badge.left,badgeRight:badge.right,rowRight:row.right}})()`);
      assert(visibleOrder.width > 0 && visibleOrder.firstTop < visibleOrder.secondTop && visibleOrder.nameRight <= visibleOrder.badgeLeft && visibleOrder.badgeRight <= visibleOrder.rowRight, `Unread list or badge is hidden/overlapping (${theme}): ${JSON.stringify(visibleOrder)}`);
      const shot = await mainPage.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(join(dist, `ui-unread-private-${theme}.png`), Buffer.from(shot.data, 'base64'));
    }
    await mainPage.send('Emulation.clearDeviceMetricsOverride');
    await mainPage.evaluate("document.documentElement.dataset.theme='dark';document.querySelector('[data-filter=private]').click();document.getElementById('people-search').value='Citra';document.getElementById('people-search').dispatchEvent(new Event('input',{bubbles:true}))");
    assert.deepEqual(await privateOrder(), [testThird.id], 'Search ignored the unread contact');
    assert.equal((await mainPage.evaluate<Snapshot>('window.lumilan.state()')).unread[testThird.id], 1, 'Search marked an unread message read');
    await mainPage.evaluate("document.getElementById('people-search').value='';document.getElementById('people-search').dispatchEvent(new Event('input',{bubbles:true}))");
    await testPeer.sendMessage('Unread sidebar Alice', appState.me.id);
    await until(async () => (await privateOrder())[0] === testPeer.id && await mainPage.evaluate(`${aliceRow}.querySelector('.unread-badge')?.textContent==='1'`), 'multiple unread contacts kept alphabetical order');
    const unreadContacts = (await mainPage.evaluate<Snapshot>('window.lumilan.state()')).unread;
    assert.equal(unreadContacts[testPeer.id], 1); assert.equal(unreadContacts[testThird.id], 1);
    // Reading requires a watched window; native focus from an earlier step can move to another desktop window.
    await nativeBrowser.evaluate('smokeMain.focus()');
    await until(() => nativeBrowser.evaluate('smokeMain.isVisible() && !smokeMain.isMinimized() && smokeMain.isFocused()'), 'sidebar reading window focused');
    await mainPage.evaluate(`${aliceRow}.click()`);
    await until(async () => !(await mainPage.evaluate<Snapshot>('window.lumilan.state()')).unread[testPeer.id] && (await privateOrder())[0] === testThird.id, 'remaining unread contact promoted after reading');
    assert.equal((await mainPage.evaluate<Snapshot>('window.lumilan.state()')).unread[testThird.id], 1, 'Reading one contact cleared another contact');
    await mainPage.evaluate(`${citraRow}.click()`);
    await until(async () => !(await mainPage.evaluate<Snapshot>('window.lumilan.state()')).unread[testThird.id] && (await privateOrder())[0] === testPeer.id, 'alphabetical order restored after reading all messages');
    await mainPage.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(originalUiTheme)};document.querySelector('[data-filter=all]').click();document.getElementById('notes-button').click()`);
    await mainPage.evaluate('window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:true})');
    console.log('Private sidebar: native encrypted unread-first ordering, multiple unread, search, focus retention and read reset passed');
    // Real peer presence drives the renderer; no fake snapshots or UI test bridge.
    const originalPeerProfile = { name: testPeer.state.name, status: testPeer.state.status, about: testPeer.state.about, avatar: testPeer.state.avatar };
    const personSelector = `.person[data-peer="${testPeer.id}"]`;
    const rowExpression = `document.querySelector(${JSON.stringify(personSelector)})`;
    const presenceCommands: Array<{at:number;type:string;x?:number;y?:number}> = [];
    const recordPresenceCommand = (command: {type:string;x?:number;y?:number}) => {
      presenceCommands.push({ at: Date.now(), ...command });
      if (presenceCommands.length > 20) presenceCommands.shift();
    };
    const changeMainLanguage = async (language: string) => {
      await mainPage.evaluate(`document.getElementById('language-select').value=${JSON.stringify(language)};document.getElementById('language-select').dispatchEvent(new Event('change'))`);
      await until(() => mainPage.evaluate(`document.documentElement.lang===${JSON.stringify(language)}`), `main ${language} labels`);
    };
    const mainViewport = async (width: number, height: number) => {
      await mainPage.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await mainPage.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    };
    const tooltipState = () => mainPage.evaluate<{visible:boolean;text:string;role:string;position:string;described:string;bindings:number;focused:boolean;clamped:boolean}>(`(()=>{const row=${rowExpression},tip=document.getElementById('presence-tooltip'),r=tip.getBoundingClientRect();
      return {visible:!tip.hidden,text:tip.textContent,role:tip.getAttribute('role'),position:getComputedStyle(tip).position,
        described:row?.getAttribute('aria-describedby'),bindings:document.querySelectorAll('[aria-describedby="presence-tooltip"]').length,
        focused:document.activeElement===row,clamped:r.left>=7&&r.top>=7&&r.right<=innerWidth-7&&r.bottom<=innerHeight-7};})()`);
    let lastPresencePointer: {x:number;y:number} | undefined;
    const presenceDiagnostics = async () => {
      const [native, renderer] = await Promise.all([
        nativeBrowser.evaluate("({visible:smokeMain.isVisible(),focused:smokeMain.isFocused(),minimized:smokeMain.isMinimized(),bounds:smokeMain.getBounds(),events:globalThis.smokePresenceNativeTrace?.slice(-20)})"),
        mainPage.evaluate(`(()=>{const describe=element=>({id:element?.id,tag:element?.tagName,peer:element?.closest?.('.person[data-peer]')?.dataset.peer});
          const point=${JSON.stringify(lastPresencePointer || null)},row=${rowExpression},r=row?.getBoundingClientRect();
          return{documentFocused:document.hasFocus(),documentHidden:document.hidden,visibility:document.visibilityState,pageHidden:document.documentElement.dataset.pageHidden,
            active:describe(document.activeElement),bound:describe(document.querySelector('[aria-describedby="presence-tooltip"]')),
            pointer:point,hitTarget:describe(point&&document.elementFromPoint(point.x,point.y)),row:describe(row),rowStatus:row?.dataset.status,
            rowBounds:r&&{left:r.left,top:r.top,right:r.right,bottom:r.bottom},dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),
            trace:globalThis.smokePresenceTrace?.slice(-40)};})()`),
      ]);
      return { native, renderer, commands: presenceCommands.slice(-20) };
    };
    const assertTooltip = async (label: string, focused = false) => {
      const tip = await tooltipState();
      const valid = tip.visible && tip.text === label && tip.role === 'tooltip' && tip.position === 'fixed' && tip.described === 'presence-tooltip' &&
        tip.bindings === 1 && tip.clamped && (!focused || tip.focused);
      assert(valid, `Live presence tooltip failed: ${JSON.stringify({ tooltip: tip, ...(valid ? {} : { context: await presenceDiagnostics() }) })}`);
    };
    const movePointer = (x: number, y: number) => {
      lastPresencePointer = { x, y };
      recordPresenceCommand({ type: 'mouseMoved', x, y });
      return mainPage.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    };
    const focusPerson = () => {
      recordPresenceCommand({ type: 'focusPerson' });
      return mainPage.evaluate(`${rowExpression}.focus({preventScroll:true})`);
    };
    try {
      await nativeBrowser.evaluate(`globalThis.smokePresenceNativeTrace=[];globalThis.smokePresenceNativeListeners=['focus','blur','show','hide','minimize','restore'].map(type=>{
        const handler=()=>{smokePresenceNativeTrace.push({at:Date.now(),type,visible:smokeMain.isVisible(),focused:smokeMain.isFocused(),minimized:smokeMain.isMinimized()});
          if(smokePresenceNativeTrace.length>20)smokePresenceNativeTrace.shift();};smokeMain.on(type,handler);return{type,handler};});true`);
      await mainPage.evaluate(`globalThis.smokePresenceTrace=[];globalThis.smokePresenceCapture=event=>{
        const describe=element=>({id:element?.id,tag:element?.tagName,peer:element?.closest?.('.person[data-peer]')?.dataset.peer});
        smokePresenceTrace.push({at:Date.now(),type:event.type,target:describe(event.target),related:describe(event.relatedTarget),
          active:describe(document.activeElement),x:event.clientX,y:event.clientY,trusted:event.isTrusted,
          key:['Tab','Escape','Home','End','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)?event.key:undefined,
          documentFocused:document.hasFocus(),documentHidden:document.hidden,pageHidden:document.documentElement.dataset.pageHidden,
          tooltipVisible:!document.getElementById('presence-tooltip').hidden,bound:document.querySelector('[aria-describedby="presence-tooltip"]')?.dataset.peer});
        if(smokePresenceTrace.length>40)smokePresenceTrace.shift();};
        for(const type of ['focusin','focusout','pointerover','pointerout','pointermove','pointerdown','keydown','keyup','visibilitychange'])document.addEventListener(type,smokePresenceCapture,true);
        for(const type of ['resize','focus','blur'])window.addEventListener(type,smokePresenceCapture,true)`);
      await nativeBrowser.evaluate('smokeMain.show();smokeMain.focus()');
      await mainViewport(1100, 800);
      const ringTarget = await mainPage.evaluate<{width:number;offset:number;dpr:number}>(`(()=>{const probe=document.createElement('span');probe.style.cssText='position:fixed;visibility:hidden;outline:2px solid;outline-offset:1px';
        document.body.append(probe);const s=getComputedStyle(probe),result={width:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset),dpr:devicePixelRatio};probe.remove();return result;})()`);
      assert(ringTarget.width > 0 && ringTarget.offset > 0, `Native outline calibration failed: ${JSON.stringify(ringTarget)}`);
      testPeer.setProfile({ ...originalPeerProfile, status: 'active', about: '' });
      await until(() => mainPage.evaluate(`${rowExpression}?.dataset.status==='active'`), 'presence row ready');
      await mainPage.evaluate(`${rowExpression}.click()`);
      const optionLabels = new Set();
      for (const language of ['id', 'en', 'es', 'ja']) {
        await changeMainLanguage(language);
        const options = await mainPage.evaluate<{visible:boolean;label:string;icons:number;width:number;height:number}>(`(()=>{const menu=document.getElementById('thread-actions'),summary=menu.querySelector('summary'),icon=summary.querySelector('[data-icon="More"] svg'),r=icon?.getBoundingClientRect();
          return {visible:!menu.hidden,label:summary.lastElementChild.textContent.trim(),icons:summary.querySelectorAll('svg').length,width:r?.width,height:r?.height};})()`);
        assert(options.visible && options.label && options.icons === 1 && options.width > 0 && options.height > 0,
          `Conversation options lost its icon/label (${language}): ${JSON.stringify(options)}`);
        optionLabels.add(options.label);
      }
      assert(optionLabels.size >= 3, 'Conversation options did not translate with the current language');
      await changeMainLanguage('id');
      const presenceLabels = { active: 'Aktif', busy: 'Sibuk', away: 'Pergi', dnd: 'Jangan ganggu' };
      for (const status of ['active', 'busy', 'away', 'dnd'] as const) {
        const label = presenceLabels[status];
        await movePointer(1090, 790);
        await mainPage.evaluate("document.getElementById('people-search').focus()");
        testPeer.setProfile({ ...originalPeerProfile, status, about: '' });
        await until(() => mainPage.evaluate(`${rowExpression}?.dataset.status===${JSON.stringify(status)}`), `live ${status} status`);
        const appearance = await mainPage.evaluate<{status:string;avatarStatus:string;current:string;ring:number;offset:number;ringColor:string;dotColor:string;dotWidth:number;hiddenLabel:boolean;a11y:string;visibleStatus:string;title:boolean}>(`(()=>{const row=${rowExpression},avatar=row.querySelector('.avatar'),presence=row.querySelector('.presence'),label=presence.querySelector('.presence-label'),s=getComputedStyle(avatar),hidden=getComputedStyle(label),r=label.getBoundingClientRect();
          return {status:row.dataset.status,avatarStatus:avatar.dataset.status,current:row.getAttribute('aria-current'),ring:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset),ringColor:s.outlineColor,
            dotColor:getComputedStyle(presence,'::before').backgroundColor,dotWidth:parseFloat(getComputedStyle(presence,'::before').width),
            hiddenLabel:r.width<=2&&r.height<=2&&hidden.overflow==='hidden'&&hidden.clipPath!=='none',a11y:label.textContent,
            visibleStatus:[...presence.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(''),title:row.hasAttribute('title')||presence.hasAttribute('title')};})()`);
        assert(appearance.status === status && appearance.avatarStatus === status && appearance.current === 'true' &&
          Math.abs(appearance.ring - ringTarget.width) <= .01 && Math.abs(appearance.offset - ringTarget.offset) <= .01 &&
          appearance.ringColor === appearance.dotColor && appearance.dotWidth > 0 && appearance.hiddenLabel && appearance.a11y === label && !appearance.visibleStatus && !appearance.title,
          `Direct-person presence is missing or exposes a duplicate status (${status}): ${JSON.stringify({ appearance, ringTarget })}`);
        const bounds = await mainPage.evaluate<{x:number;y:number}>(`(()=>{const r=${rowExpression}.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
        await movePointer(bounds.x, bounds.y);
        await assertTooltip(label); // Next protocol evaluation: no hover-delay polling.
        await movePointer(1090, 790);
        assert.equal((await tooltipState()).visible, false, 'Presence tooltip remained after pointer leave');
        await focusPerson();
        await assertTooltip(label, true);
      }
      await mainPage.evaluate("document.getElementById('people-search').focus()");
      let tabReachedPerson = false;
      for (let steps = 0; steps < 20 && !tabReachedPerson; steps++) {
        await mainPage.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await mainPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        tabReachedPerson = await mainPage.evaluate(`document.activeElement===${rowExpression}`);
      }
      assert(tabReachedPerson && await mainPage.evaluate(`${rowExpression}.matches(':focus-visible')`), 'Keyboard Tab could not reach the presence row visibly');
      await assertTooltip(presenceLabels.dnd, true);
      // Keep the focused peer bound across a real encrypted profile update.
      testPeer.setProfile({ ...originalPeerProfile, status: 'busy', about: '' });
      await until(() => mainPage.evaluate(`${rowExpression}?.dataset.status==='busy'`), 'focused presence update');
      await assertTooltip(presenceLabels.busy, true);
      await mainPage.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await mainPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      assert.equal((await tooltipState()).visible, false, 'Escape did not dismiss presence tooltip');
      testPeer.setProfile({ ...originalPeerProfile, status: 'away', about: '' });
      await until(() => mainPage.evaluate(`${rowExpression}?.dataset.status==='away'`), 'dismissed presence update');
      const dismissedTip = await tooltipState();
      const dismissedTrace = await mainPage.evaluate(`(()=>{const describe=element=>({id:element?.id,tag:element?.tagName,peer:element?.closest?.('.person[data-peer]')?.dataset.peer});
        const point=${JSON.stringify(lastPresencePointer)};return{active:describe(document.activeElement),bound:describe(document.querySelector('[aria-describedby="presence-tooltip"]')),
          pointer:point,pointerTarget:describe(document.elementFromPoint(point.x,point.y)),trace:smokePresenceTrace.slice(-20)};})()`);
      assert.equal(dismissedTip.visible, false, `Live render resurrected an Escape-dismissed tooltip: ${JSON.stringify({ tooltip: dismissedTip, lifecycle: dismissedTrace })}`);
      await mainPage.evaluate("document.getElementById('people-search').focus()");
      await focusPerson();
      await mainPage.evaluate("document.getElementById('settings-button').click()");
      await until(() => mainPage.evaluate("document.getElementById('settings-dialog').open"), 'presence modal opened');
      assert.equal((await tooltipState()).visible, false, 'Settings modal left a presence tooltip above it');
      await mainPage.evaluate("document.getElementById('settings-dialog').close();document.getElementById('people-search').focus()");
      for (const theme of ['light', 'dark']) {
        await mainPage.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        await focusPerson();
        await assertTooltip(presenceLabels.away, true);
        await waitUiAnimations();
        if (process.env.LUMILAN_UI_SCREENSHOTS === '1' || process.env.LUMILAN_README_SCREENSHOTS === '1') {
          const shot = await mainPage.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          writeFileSync(join(dist, `ui-polish-tooltip-${theme}.png`), Buffer.from(shot.data, 'base64'));
        }
        await mainPage.evaluate("document.getElementById('people-search').focus()");
      }
      await focusPerson();
      await mainViewport(320, 700);
      assert.equal((await tooltipState()).visible, false, 'Resize did not close presence tooltip');
      await mainPage.evaluate("document.getElementById('back-button').click();document.getElementById('people-search').focus()");
      await focusPerson();
      await assertTooltip(presenceLabels.away, true);
      await mainViewport(1100, 400);
      await mainPage.evaluate(`${rowExpression}.scrollIntoView({block:'center'})`);
      await mainPage.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      assert(await mainPage.evaluate("document.querySelector('.sidebar-list').scrollTop>0"), 'Short viewport did not exercise actual sidebar scrolling');
      await mainPage.evaluate("document.getElementById('people-search').focus()");
      await focusPerson();
      await assertTooltip(presenceLabels.away, true);
      await mainPage.evaluate("document.querySelector('.sidebar-list').scrollTop=0;new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
      assert.equal((await tooltipState()).visible, false, 'Sidebar scrolling did not close presence tooltip');
      await mainViewport(1100, 800);
      await mainPage.evaluate("document.getElementById('people-search').focus()");
      await focusPerson();
      await assertTooltip(presenceLabels.away, true);
      await mainPage.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await mainPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      assert.equal((await tooltipState()).visible, false, 'Escape did not dismiss presence before disconnect');
      await testPeer.stop();
      await until(() => mainPage.evaluate(`!${rowExpression}`), 'offline presence removed');
      const offlineTip = await tooltipState();
      assert(!offlineTip.visible && offlineTip.bindings === 0, 'Offline peer retained a stale actionable presence tooltip');
      await testPeer.start();
      testPeer.setProfile(originalPeerProfile);
      await testPeer.connectAddress(appState.addresses[0]!);
      await until(() => mainPage.evaluate(`Boolean(${rowExpression})`), 'same peer presence reconnected');
      const restoredPresence = Object.hasOwn(presenceLabels, originalPeerProfile.status) ? originalPeerProfile.status : 'active';
      await until(() => mainPage.evaluate(`${rowExpression}?.dataset.status===${JSON.stringify(restoredPresence)}`), 'reconnected presence restored');
      await focusPerson();
      await assertTooltip(presenceLabels[restoredPresence], true);
      console.log('Main UI: translated options icon, live status dot/ring and immediate accessible tooltip with lifecycle/viewport cleanup passed');
    } finally {
      testPeer.setProfile(originalPeerProfile);
      await mainPage.evaluate("if(globalThis.smokePresenceCapture){for(const type of ['focusin','focusout','pointerover','pointerout','pointermove','pointerdown','keydown','keyup','visibilitychange'])document.removeEventListener(type,smokePresenceCapture,true);for(const type of ['resize','focus','blur'])window.removeEventListener(type,smokePresenceCapture,true);delete globalThis.smokePresenceCapture}");
      await nativeBrowser.evaluate("for(const listener of globalThis.smokePresenceNativeListeners||[])smokeMain.removeListener(listener.type,listener.handler);delete globalThis.smokePresenceNativeListeners");
      await changeMainLanguage('id');
      await mainPage.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(originalUiTheme)};document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.getElementById('notes-button').click()`);
      await mainPage.send('Emulation.clearDeviceMetricsOverride');
    }
    testPeer.acceptFile = async () => true;
    const pastedTransfer = await mainPage.evaluate<{delivered:number;message:Message}>(`window.lumilan.file(new File([Uint8Array.from(atob('${clipboardPng.toString('base64')}'),c=>c.charCodeAt(0))],'clipboard.png',{type:'image/png'}),${JSON.stringify(testPeer.id)})`);
    assert.equal(pastedTransfer.delivered,1,'In-memory clipboard image did not reach its LAN recipient');
    assert.equal(testPeer.state.messages.find(m=>m.id===pastedTransfer.message.id)?.sha256,pastedTransfer.message.sha256,'Clipboard image integrity was not verified');
    console.log('Clipboard image crossed the real encrypted LAN file approval and integrity pipeline');
    // A waiting consent request must leave both the composer and peer streams free.
    const outgoingOffers: Array<{id:string;name:string;resolve:(accepted:boolean)=>void}> = [];
    testPeer.acceptFile = offer => new Promise(resolve => outgoingOffers.push({ id: offer.id, name: offer.name, resolve }));
    // Match the main app's consent callback cleanup when the sender cancels.
    const cancelOutgoingOffer = ({ id, status }: FileTransfer) => {
      if (status === 'canceled') outgoingOffers.find(offer => offer.id === id)?.resolve(false);
    };
    testPeer.on('file-transfer', cancelOutgoingOffer);
    await changeMainLanguage('es');
    await mainPage.evaluate(`document.querySelector('.person[data-peer="${testPeer.id}"]').click()`);
    const nativePickerPaths: [string,string] = [join(profile, 'pending-native.bin'),join(profile,'pending-native_日本語.txt')];
    writeFileSync(nativePickerPaths[0],Buffer.alloc(21*1024*1024,0x5a));
    writeFileSync(nativePickerPaths[1],'Native private picker');
    await mainPage.evaluate("document.getElementById('message-input').value='Draft survives private picker'");
    await mainPage.send('Page.enable');
    await mainPage.send('Page.setInterceptFileChooserDialog',{enabled:true});
    const pickerPoint = await mainPage.evaluate<{x:number;y:number}>(`(()=>{const r=document.querySelector('#attach-button').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await mainPage.send('Input.dispatchMouseEvent',{type:'mousePressed',...pickerPoint,button:'left',clickCount:1});
    await mainPage.send('Input.dispatchMouseEvent',{type:'mouseReleased',...pickerPoint,button:'left',clickCount:1});
    const chooser = await until(()=>mainPage.fileChoosers.at(-1),'native attachment picker');
    assert.equal(chooser.mode,'selectMultiple','Attachment picker did not allow multiple files');
    await mainPage.send('DOM.setFileInputFiles',{backendNodeId:chooser.backendNodeId,files:nativePickerPaths});
    await mainPage.send('Page.setInterceptFileChooserDialog',{enabled:false});
    await until(()=>outgoingOffers.length===2,'two independent native picker consent offers');
    outgoingOffers.sort((a,b)=>nativePickerPaths.findIndex(path=>basename(path)===a.name)-nativePickerPaths.findIndex(path=>basename(path)===b.name));
    assert(await mainPage.evaluate("document.getElementById('message-input').value==='Draft survives private picker'"),'Native picker cleared draft');
    await mainPage.evaluate("document.getElementById('message-input').value=''");
    for (let i = 2; i < 8; i++) {
      await mainPage.evaluate(`{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('${clipboardPng.toString('base64')}'),c=>c.charCodeAt(0))],'pending-${i}.png',{type:'image/png'}));document.getElementById('message-input').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));}`);
      await until(() => mainPage.evaluate("!document.getElementById('clipboard-preview').hidden"), 'outgoing image preview');
      await mainPage.evaluate("document.getElementById('message-form').requestSubmit()");
      await until(() => outgoingOffers.length === i + 1, 'independent outgoing file offer');
      assert(await mainPage.evaluate("!document.getElementById('send-button').disabled&&!document.getElementById('attach-button').disabled&&document.getElementById('clipboard-preview').hidden"), 'Pending consent blocked the composer');
    }
    const freeChat = `chat-with-eight-pending-${randomUUID()}\n\nsatu\n\ndua`;
    await mainPage.evaluate(`document.getElementById('message-input').value=${JSON.stringify(freeChat)};document.getElementById('message-form').requestSubmit()`);
    await until(() => testPeer.state.messages.some(message => message.text === freeChat), 'chat delivered while eight offers wait');
    await until(() => mainPage.evaluate("!document.getElementById('send-button').disabled"), 'composer released after chat');
    assert(await mainPage.evaluate(`window.lumilan.state().then(state=>{
      const message=state.messages.find(item=>item.text===${JSON.stringify(freeChat)});
      return message&&document.querySelector('#message-'+message.id+' .message-markdown')?.querySelectorAll('br').length===4;
    })`), 'Outgoing private chat collapsed its blank lines');
    // DOM selection does not restore native focus after a picker or another desktop window.
    await nativeBrowser.evaluate('smokeMain.focus()');
    await until(() => nativeBrowser.evaluate('smokeMain.isVisible() && !smokeMain.isMinimized() && smokeMain.isFocused()'), 'incoming multiline native focus');
    const incomingLines = await testPeer.sendMessage('test\n\nsatu\n\ndua', appState.me.id);
    await until(() => mainPage.evaluate(`document.querySelector('#message-${incomingLines.message.id} .message-markdown')?.querySelectorAll('br').length===4`), 'incoming encrypted private multiline bubble');
    await until(() => mainPage.evaluate(`window.lumilan.state().then(s=>!s.unread[${JSON.stringify(testPeer.id)}])`), 'focused incoming multiline marked read');
    console.log('Private messages: outgoing and incoming encrypted multiline chat retain blank lines');
    const pendingRows = await mainPage.evaluate<string[]>("Array.from(document.querySelectorAll('#transfer-progress .transfer-progress'),row=>row.dataset.transferId)");
    assert.equal(new Set(pendingRows).size, 8, 'Outgoing jobs reused progress/cancel IDs');
    for (const theme of ['light', 'dark']) {
      await changeMainLanguage('es');
      await mainPage.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      for (const [width, height] of [[1100,480],[320,700]] as const) {
        await mainViewport(width, height);
        const layout = await mainPage.evaluate<{height:number;viewport:number;y:number;list:number;scroll:number;formTop:number;formBottom:number;controls:boolean[]}>(`(()=>{const list=document.getElementById('transfer-progress'),form=document.getElementById('message-form').getBoundingClientRect();
          return {height:document.documentElement.scrollHeight,viewport:innerHeight,y:scrollY,list:list.clientHeight,scroll:list.scrollHeight,
            formTop:form.top,formBottom:form.bottom,controls:Array.from(list.querySelectorAll('.transfer-progress'),row=>{
              const label=row.querySelector('span').getBoundingClientRect(),bar=row.querySelector('progress').getBoundingClientRect(),cancel=row.querySelector('button:last-child').getBoundingClientRect();
              return label.right<=bar.left&&bar.right<=cancel.left&&cancel.right<=innerWidth;
            })};})()`);
        assert(layout.height <= layout.viewport + 1 && layout.y === 0 && layout.list <= 120 && layout.scroll > layout.list
          && layout.formTop >= 0 && layout.formBottom <= height && layout.controls.every(Boolean), `Pending transfer rows overflowed the composer: ${JSON.stringify(layout)}`);
      }
    }
    await mainViewport(1100,800);
    await changeMainLanguage('id');
    await mainPage.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(originalUiTheme)}`);
    outgoingOffers[1]!.resolve(true);
    await until(() => mainPage.evaluate(`!document.querySelector('[data-transfer-id="${pendingRows[1]}"]')`), 'second image finishes independently');
    assert.equal(testPeer.pendingFileOffers.size, 7, 'Accepting the second file changed another pending consent');
    const secondReceived = testPeer.state.messages.at(-1);
    assert(secondReceived && secondReceived.sha256 && secondReceived.kind === 'file', 'Second image did not complete integrity verification');
    assert(nativePickerPaths.some(path=>basename(path)===secondReceived.name),'Accepted native picker file lost its original name');
    await mainPage.evaluate(`document.querySelector('[data-transfer-id="${pendingRows[2]}"] button:last-child').click()`);
    await until(() => mainPage.evaluate(`!document.querySelector('[data-transfer-id="${pendingRows[2]}"]')`), 'targeted outgoing cancellation');
    assert.equal(testPeer.pendingFileOffers.size, 6, 'Canceling the third file did not release its own consent');
    outgoingOffers[0]!.resolve(false);
    await until(() => mainPage.evaluate(`!document.querySelector('[data-transfer-id="${pendingRows[0]}"] button:first-of-type').hidden`), 'declined file retained for retry');
    testPeer.acceptFile = async () => true;
    await mainPage.evaluate(`document.querySelector('[data-transfer-id="${pendingRows[0]}"] button:first-of-type').click()`);
    await until(() => mainPage.evaluate(`!document.querySelector('[data-transfer-id="${pendingRows[0]}"]')&&document.querySelectorAll('#transfer-progress .transfer-progress').length===5`), 'retry of declined image completes');
    for (let i = 3; i < 8; i++) outgoingOffers[i]!.resolve(false);
    await until(() => mainPage.evaluate("Array.from(document.querySelectorAll('#transfer-progress .transfer-progress button:first-of-type')).every(button=>!button.hidden)"), 'remaining declines settled');
    await mainPage.evaluate("document.querySelectorAll('#transfer-progress .transfer-progress button:last-child').forEach(button=>button.click())");
    assert.equal(testPeer.pendingFileOffers.size, 0, 'Outgoing regression left pending consent');
    testPeer.removeListener('file-transfer', cancelOutgoingOffer);
    assert(await mainPage.evaluate("document.getElementById('transfer-progress').hidden"), 'Outgoing regression left composer rows');
    console.log('Outgoing files: eight independent consent requests, unblocked chat/images, second-first completion, targeted cancellation, retry and light/dark narrow layout passed');
    // Receiving must not rebuild the conversation for every progress step: that re-inserted thumbnails and made the
    // receiver's view jump up and down while a file arrived.
    await nativeBrowser.evaluate(`smokeMain.show();smokeMain.focus();smokeMain.webContents.send('lumilan:open-thread',${JSON.stringify(testPeer.id)})`);
    await until(() => mainPage.evaluate("document.getElementById('message-input').placeholder.includes('Alice LAN')"), 'receiving conversation open');
    const acceptIncoming = async (name: string) => {
      const row = `[...document.querySelectorAll('#messages .incoming-transfer')].find(row=>row.textContent.includes(${JSON.stringify(name)}))`;
      await until(() => mainPage.evaluate(`${row}?.querySelectorAll('button').length===2`), `incoming ${name} consent`);
      await mainPage.evaluate(`${row}.querySelectorAll('button')[1].click()`);
    };
    for (const [index, fill] of ['#4169e1', '#ffd36d'].entries()) {
      const image = join(profile, `stable-${index}.png`);
      writeFileSync(image, await require('sharp')({ create: { width: 480, height: 300 + index * 40, channels: 4, background: fill } }).png().toBuffer());
      const sending = testPeer.sendFilePath(image, appState.me.id);
      await acceptIncoming(`stable-${index}.png`); await sending;
    }
    await until(() => mainPage.evaluate("(images=>images.length===2&&images.every(i=>i.complete&&i.naturalWidth>0))([...document.querySelectorAll('#messages .image-preview')].filter(i=>i.alt.startsWith('stable-')))"), 'received thumbnails shown');
    await mainPage.evaluate(`(()=>{const l=document.getElementById('messages');l.scrollTop=l.scrollHeight;globalThis.smokeThumbs=[...l.querySelectorAll('.image-preview-button')];
      globalThis.smokeReceive={rebuilds:0,shift:0};globalThis.smokeReceiveObserver=new MutationObserver(r=>{for(const m of r)if(m.removedNodes.length>3)smokeReceive.rebuilds++});smokeReceiveObserver.observe(l,{childList:true});
      globalThis.smokeShiftObserver=new PerformanceObserver(list=>{for(const e of list.getEntries())smokeReceive.shift+=e.value});smokeShiftObserver.observe({type:'layout-shift'});true})()`);
    const largeIncoming = join(profile, 'stable-large.bin'); writeFileSync(largeIncoming, Buffer.alloc(24 * 1024 * 1024, 3));
    const sendingLarge = testPeer.sendFilePath(largeIncoming, appState.me.id);
    await acceptIncoming('stable-large.bin'); await sendingLarge;
    await until(() => mainPage.evaluate("[...document.querySelectorAll('#messages .file-bubble')].some(b=>b.textContent.includes('stable-large.bin'))&&!document.querySelector('#messages .incoming-transfer')"), 'large file received');
    const receiving = await mainPage.evaluate<{rebuilds:number;shift:number;kept:boolean}>("(smokeReceiveObserver.disconnect(),smokeShiftObserver.disconnect(),{rebuilds:smokeReceive.rebuilds,shift:smokeReceive.shift,kept:smokeThumbs.length>=2&&smokeThumbs.every(b=>b.isConnected)})");
    assert(receiving.rebuilds <= 8, `Receiving rebuilt the conversation ${receiving.rebuilds} times; progress must update in place`);
    assert(receiving.kept, 'Receiving replaced thumbnails that were already shown');
    assert(receiving.shift < 0.05, `Receiving shifted the conversation layout by ${receiving.shift}`);
    console.log(`Receiving files: progress updated in place (${receiving.rebuilds} list renders for 24 MB), shown thumbnails kept, layout shift ${receiving.shift.toFixed(3)}`);
    // Link previews: an in-process fetch fixture stands in for YouTube and Instagram, so the smoke never reaches the
    // internet. The fixture also records every request to prove ask mode, local-only platforms and the receiver stay offline.
    {
      const { SENDER_PIXELS, prepareThumbnail } = await import('../src/main/link-preview.js');
      const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
      const oembed = (id: string) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch(id))}`;
      const reelPage = '<html><head><meta property="og:title" content="Smoke reel &amp; friends"><meta property="og:url" content="https://www.instagram.com/reel/C1a2b3c4d5/"><meta property="og:image" content="https://scontent.cdninstagram.com/smoke.png"></head></html>';
      await nativeBrowser.evaluate(`(()=>{const png=Buffer.from('${clipboardPng.toString('base64')}','base64');
        const json=value=>new Response(JSON.stringify(value),{status:200});
        globalThis.smokeLinkCalls=[];globalThis.smokeLinkUnexpected=[];globalThis.smokeLinkHeld=false;
        const routes={
          ${JSON.stringify(oembed('dQw4w9WgXcQ'))}:()=>json({title:'Smoke video',author_name:'Smoke channel',thumbnail_url:'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'}),
          'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg':()=>new Response(png,{status:200}),
          ${JSON.stringify(oembed('BBBBBBBBBBB'))}:async()=>{smokeLinkHeld=true;await new Promise(resolve=>globalThis.smokeReleaseLink=resolve);smokeLinkHeld=false;return json({title:'Held video'})},
          'https://www.instagram.com/reel/C1a2b3c4d5/':()=>new Response(${JSON.stringify(reelPage)},{status:200}),
          'https://scontent.cdninstagram.com/smoke.png':()=>new Response(png,{status:200}),
          'https://www.instagram.com/p/Z9z9z9z9z9/':()=>new Response('<html><head><title>Login • Instagram</title></head></html>',{status:200}),
        };
        globalThis.smokeLinkFetch=async(url,init)=>{smokeLinkCalls.push(url);
          if(init.redirect!=='error'||init.credentials!=='omit')smokeLinkUnexpected.push('init '+url);
          const route=routes[url];if(!route){smokeLinkUnexpected.push(url);throw new Error('Unexpected smoke request')}return route()};
        globalThis.smokeOpened=[];globalThis.smokeOpenExternal=smokeElectron.shell.openExternal;smokeElectron.shell.openExternal=async url=>{smokeOpened.push(url)};
        return true})()`);
      const calls = () => nativeBrowser.evaluate<string[]>('smokeLinkCalls.slice()');
      const composerCard = () => mainPage.evaluate<{visible:boolean;consent:boolean;consentText:string;title:string;url:string;platform:string;thumbnail:number}>(`(()=>{const $=id=>document.getElementById(id),image=$('link-preview-thumbnail');
        return {visible:!$('link-preview').hidden,consent:!$('link-consent').hidden,consentText:$('link-consent-text').textContent,title:$('link-preview-title').textContent,
          url:$('link-preview-url').textContent,platform:$('link-preview-platform').textContent,thumbnail:!image.hidden&&image.complete?image.naturalWidth:0}})()`);
      const pasteLink = (text: string) => mainPage.evaluate(`{const input=document.getElementById('message-input');input.value=${JSON.stringify(text)};input.focus();
        input.setSelectionRange(input.value.length,input.value.length);input.dispatchEvent(new InputEvent('input',{inputType:'insertFromPaste',bubbles:true}))}`);
      const sendComposer = () => mainPage.evaluate("document.getElementById('message-form').requestSubmit()");
      try {
        await mainPage.evaluate("window.lumilan.setLinkPreviews('ask')");
        await mainPage.evaluate("{const input=document.getElementById('message-input');input.value='';input.focus()}");
        await mainPage.send('Input.insertText', { text: 'Tonton https://youtube.com/shorts/dQw4w9WgXcQ ya' });
        await until(async () => (await composerCard()).consent, 'typed Shorts link shows a consent card');
        const asked = await composerCard();
        assert(asked.visible && asked.consentText.includes('youtube.com') && asked.title === 'youtube.com' && asked.platform === 'YouTube', `Ask card was wrong: ${JSON.stringify(asked)}`);
        assert.deepEqual(await calls(), [], 'Ask mode contacted a host before consent');
        await mainPage.evaluate("document.getElementById('link-consent-accept').click()");
        await until(async () => { const card = await composerCard(); return card.title === 'Smoke video' && card.thumbnail === 24 && !card.consent; }, 'Turn on fetched the Shorts card');
        assert.deepEqual(await calls(), [oembed('dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg']);
        assert.equal((await mainPage.evaluate<{linkPreviews:string}>('window.lumilan.notificationSettings()')).linkPreviews, 'on');
        await sendComposer();
        const shortsText = 'Tonton https://youtube.com/shorts/dQw4w9WgXcQ ya';
        const delivered = await until(() => testPeer.state.messages.find(message => message.text === shortsText), 'Shorts card delivered');
        assert.equal(delivered.preview?.title, 'Smoke video');
        assert.equal(delivered.preview?.author, 'Smoke channel');
        await until(() => testPeer.state.messages.find(message => message.id === delivered.id)?.preview?.thumbnail, 'receiver decoded the Shorts thumbnail');
        assert(!readFileSync(join(profile, 'lumilan', 'state.json'), 'utf8').includes('base64'), 'Thumbnail bytes entered the sender state');
        await until(() => mainPage.evaluate(`(c=>c&&c.querySelector('.link-title').textContent==='Smoke video'&&c.querySelector('.link-thumbnail')?.complete&&c.querySelector('.link-thumbnail').naturalWidth===24)(document.querySelector('#message-${delivered.id} .link-card'))`), 'sent card with thumbnail');
        assert.equal((await composerCard()).visible, false, 'The sent card stayed in the composer');

        await pasteLink('Reel https://www.instagram.com/reel/C1a2b3c4d5/?igsh=smoke');
        await until(async () => (await composerCard()).title === 'Smoke reel & friends', 'Instagram Open Graph card');
        await pasteLink('Masuk dulu https://www.instagram.com/p/Z9z9z9z9z9/');
        await until(async () => { const card = await composerCard(); return card.url.endsWith('/p/Z9z9z9z9z9/') && card.title === 'instagram.com' && !card.thumbnail; }, 'Instagram login page falls back to a link card');
        const fetched = (await calls()).length;
        for (const [text, platform] of [['https://www.threads.net/@lumilan/post/C1a2b3c4d5', 'Threads'], ['https://x.com/lumilan/status/1', 'X'], ['https://www.facebook.com/watch?v=1', 'Facebook']] as const) {
          await pasteLink(`Lihat ${text}`);
          await until(async () => { const card = await composerCard(); return card.url === text && card.platform === platform; }, `${platform} local card`);
        }
        assert.equal((await calls()).length, fetched, 'A platform without a fetcher reached the network');
        await sendComposer();
        const facebook = await until(() => testPeer.state.messages.find(message => message.text === 'Lihat https://www.facebook.com/watch?v=1'), 'Facebook card delivered');
        assert.deepEqual(facebook.preview, { url: 'https://www.facebook.com/watch?v=1', platform: 'facebook' });

        const incomingThumbnail = await prepareThumbnail(await require('sharp')({ create: { width: 640, height: 360, channels: 3, background: '#4169e1' } }).png().toBuffer(), SENDER_PIXELS);
        const full = await testPeer.sendMessage('Dari Alice https://youtu.be/dQw4w9WgXcQ', appState.me.id, null, { preview: { url: 'https://youtu.be/dQw4w9WgXcQ', platform: 'youtube', title: 'Incoming video', author: 'Alice' }, thumbnail: incomingThumbnail });
        const textOnly = await testPeer.sendMessage('Reel https://www.instagram.com/reel/C1a2b3c4d5/', appState.me.id, null, { preview: { url: 'https://www.instagram.com/reel/C1a2b3c4d5/', platform: 'instagram', title: 'Reel tanpa gambar' } });
        const basic = await testPeer.sendMessage('Post https://twitter.com/lumilan/status/7', appState.me.id, null, { preview: { url: 'https://twitter.com/lumilan/status/7', platform: 'x' } });
        const cardText = (id: string) => mainPage.evaluate<string>(`document.querySelector('#message-${id} .link-card')?.textContent||''`);
        await until(() => mainPage.evaluate(`(i=>i?.complete&&i.naturalWidth===512)(document.querySelector('#message-${full.message.id} .link-thumbnail'))`), 'received card thumbnail');
        assert.match(await cardText(full.message.id), /YouTube.*Incoming video.*Alice/);
        assert.match(await cardText(textOnly.message.id), /Instagram.*Reel tanpa gambar/);
        assert.equal(await mainPage.evaluate(`!document.querySelector('#message-${textOnly.message.id} .link-thumbnail')`), true);
        assert.match(await cardText(basic.message.id), /X.*twitter\.com.*https:\/\/twitter\.com\/lumilan\/status\/7/);
        await mainPage.evaluate(`document.querySelector('#message-${basic.message.id} .link-open').click()`);
        await until(async () => (await nativeBrowser.evaluate<string[]>('smokeOpened.slice()')).length === 1, 'Open in browser');
        assert.deepEqual(await nativeBrowser.evaluate('smokeOpened.slice()'), ['https://x.com/lumilan/status/7'], 'Open in browser used something other than the stored canonical link');

        const keptThumbnail = `document.querySelector('#message-${full.message.id} .link-thumbnail')`;
        await mainPage.evaluate(`globalThis.smokeLinkThumbnail=${keptThumbnail};true`);
        const fetchedBefore = (await calls()).length;
        const later = await testPeer.sendMessage('Pesan setelah kartu', appState.me.id);
        await until(() => mainPage.evaluate(`!!document.getElementById('message-${later.message.id}')`), 'later message rendered');
        assert(await mainPage.evaluate(`smokeLinkThumbnail.isConnected&&smokeLinkThumbnail===${keptThumbnail}`), 'A rebuild replaced a shown link thumbnail');
        assert(await mainPage.evaluate("(l=>l.scrollHeight-l.scrollTop-l.clientHeight<64)(document.getElementById('messages'))"), 'A new message left the conversation away from the bottom');
        assert.equal((await calls()).length, fetchedBefore, 'Rendering received cards fetched from the network');
        await mainPage.evaluate('delete globalThis.smokeLinkThumbnail');

        await mainPage.evaluate("window.lumilan.setLinkPreviews('ask')");
        for (const theme of ['light', 'dark']) {
          await mainPage.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
          for (const [width, height] of [[1100, 760], [320, 700]] as const) {
            await mainViewport(width, height);
            await pasteLink(`Tonton https://youtu.be/dQw4w9WgXcQ dan komentar panjang untuk jendela sempit`);
            await until(async () => (await composerCard()).consent, `consent card ${theme} ${width}px`);
            await mainPage.evaluate("document.getElementById('messages').scrollTop=document.getElementById('messages').scrollHeight");
            const layout = await mainPage.evaluate<{fits:boolean;detail:unknown}>(`(()=>{const r=id=>document.getElementById(id).getBoundingClientRect(),box=r('link-preview'),remove=r('link-preview-remove'),title=r('link-preview-title');
              const buttons=['link-consent-accept','link-consent-decline'].map(r),cards=[...document.querySelectorAll('#messages .link-card')].slice(-3).map(c=>[c.getBoundingClientRect(),c.querySelector('.link-open').getBoundingClientRect()]);
              const inside=(a,b)=>a.left>=b.left-0.5&&a.right<=b.right+0.5;
              const apart=(a,b)=>a.right<=b.left+0.5||b.right<=a.left+0.5||a.bottom<=b.top+0.5||b.bottom<=a.top+0.5;
              const fits=box.left>=0&&box.right<=innerWidth&&inside(remove,box)&&title.right<=remove.left&&buttons.every(b=>inside(b,box)&&b.height>=30)&&apart(buttons[0],buttons[1])
                &&cards.length===3&&cards.every(([card,open])=>card.left>=0&&card.right<=innerWidth&&inside(open,card));
              return {fits,detail:{box,remove,title,buttons,cards,width:innerWidth}}})()`);
            assert(layout.fits, `Link preview layout overlapped (${theme}, ${width}px): ${JSON.stringify(layout.detail)}`);
            if (width === 320) {
              const shot = await mainPage.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
              writeFileSync(join(dist, `ui-link-preview-${theme}.png`), Buffer.from(shot.data, 'base64'));
            }
          }
          await mainViewport(1100, 760);
          await mainPage.evaluate(`document.getElementById('message-${full.message.id}').scrollIntoView({block:'center'})`);
          const thumbnail = await mainPage.evaluate<{width:number;height:number}>(`(r=>({width:r.width,height:r.height}))(document.querySelector('#message-${full.message.id} .link-thumbnail').getBoundingClientRect())`);
          assert(thumbnail.width > 0 && Math.abs(thumbnail.height - Math.min(180, thumbnail.width * 288 / 512)) < 1.5, `Link thumbnail lost its aspect ratio (${theme}): ${JSON.stringify(thumbnail)}`);
          const cardsShot = await mainPage.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          writeFileSync(join(dist, `ui-link-preview-cards-${theme}.png`), Buffer.from(cardsShot.data, 'base64'));
        }
        await mainViewport(1100, 800);
        await mainPage.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(originalUiTheme)}`);
        const beforeDecline = (await calls()).length;
        await mainPage.evaluate("document.getElementById('link-consent-decline').click()");
        await until(async () => { const card = await composerCard(); return card.visible && !card.consent; }, 'No thanks keeps the link card');
        assert.equal((await mainPage.evaluate<{linkPreviews:string}>('window.lumilan.notificationSettings()')).linkPreviews, 'off');
        assert.equal((await calls()).length, beforeDecline, 'No thanks fetched the link');

        await mainPage.evaluate("window.lumilan.setLinkPreviews('on')");
        await pasteLink('Tahan https://youtu.be/BBBBBBBBBBB');
        await until(() => nativeBrowser.evaluate('smokeLinkHeld'), 'link lookup held');
        await mainPage.evaluate("document.getElementById('notes-button').click()");
        await nativeBrowser.evaluate('smokeReleaseLink()');
        await until(async () => !await nativeBrowser.evaluate('smokeLinkHeld'), 'held lookup finished');
        await mainPage.evaluate('new Promise(r=>setTimeout(r,300))');
        assert.equal((await composerCard()).visible, false, 'A card from another conversation appeared in notes');
        await mainPage.evaluate(`document.querySelector('.person[data-peer="${testPeer.id}"]').click()`);
        await until(async () => (await composerCard()).title === 'Held video', 'held card returned with its conversation');
        await mainPage.evaluate("document.getElementById('link-preview-remove').click()");
        assert.equal((await composerCard()).visible, false, 'Remove kept the card');
        assert.deepEqual(await nativeBrowser.evaluate('smokeLinkUnexpected.slice()'), [], 'The app made an unexpected link request');
        console.log('Link previews: ask/Turn on/No thanks, YouTube Shorts and Instagram cards, local Threads/X/Facebook cards, receiver offline decode, Open in browser, stable thumbnails, conversation binding and light/dark narrow layout passed');
      } finally {
        await nativeBrowser.evaluate('smokeElectron.shell.openExternal=smokeOpenExternal;delete globalThis.smokeOpenExternal;delete globalThis.smokeLinkFetch;globalThis.smokeReleaseLink?.();true');
        await mainPage.evaluate("window.lumilan.setLinkPreviews('ask');document.getElementById('message-input').value='';document.getElementById('message-input').dispatchEvent(new Event('input'))");
      }
    }
    // Reading the open conversation also clears its queued Lumi activity (for example the received-file notices),
    // so the companion checks below start from the same queue on every desktop.
    await nativeBrowser.evaluate('smokeMain.focus()');
    await until(() => nativeBrowser.evaluate('smokeMain.isFocused()'), 'receiving conversation focused');
    await mainPage.evaluate(`window.lumilan.currentThread(${JSON.stringify(testPeer.id)})`);
    const quitPendingClipboard = async () => {
      // Exercise shutdown on every native desktop, including the Wayland fallback.
      const releaseQuitOffers: Array<(accepted:boolean)=>void> = [];
      testPeer.acceptFile = () => new Promise(resolve => { releaseQuitOffers.push(resolve); });
      try {
        for (let i = 0; i < 2; i++) await mainPage.evaluate(`window.lumilan.file(new File([Uint8Array.from(atob('${clipboardPng.toString('base64')}'),c=>c.charCodeAt(0))],'quit-pending-${i}.png',{type:'image/png'}),${JSON.stringify(testPeer.id)}).catch(()=>{});true`);
        await until(() => releaseQuitOffers.length === 2, 'two recipient consents pending before Quit');
        const stagedClipboard = () => readdirSync(join(profile, 'lumilan', 'files')).filter(name => /^\.clipboard-[A-Za-z0-9]{6}$/.test(name));
        assert.equal(stagedClipboard().length, 2, 'Pending clipboard images have no private staging directories');
        // The Node inspector can hold process shutdown while it remains attached.
        await nativeBrowser.close(); browser = undefined;
        await mainPage.evaluate("document.querySelectorAll('dialog[open]').forEach(d=>d.close());setTimeout(()=>window.lumilan.quit(),100);true");
        await until(() => child.exitCode !== null, 'explicit quit removes companion');
        assert.equal(child.exitCode, 0, 'Quit exited abnormally');
        assert.deepEqual(stagedClipboard(), [], 'Quit left a clipboard image staging directory');
        console.log('Quit aborted both pending clipboard transfers and removed private staging');
      } finally { for (const release of releaseQuitOffers) release(false); }
    };
    const assertMainMotionHidden = async () => {
      await until(() => nativeBrowser.evaluate('!smokeMain.isVisible()||smokeMain.isMinimized()'), 'native main hidden or minimized');
      assert.equal(await nativeBrowser.evaluate('smokeMain.webContents.backgroundThrottling'), false, 'Main window throttling changed and could interrupt calls');
      await until(() => mainPage.evaluate("window.lumilan.windowVisible().then(visible=>visible===false&&document.documentElement.dataset.pageHidden==='true')"), 'main hidden motion policy');
      assert(await mainPage.evaluate("['#emoji-picker','#message-input','#settings-dialog','#call-panel'].every(selector=>{const s=getComputedStyle(document.querySelector(selector));return s.animationPlayState.split(',').every(v=>v.trim()==='paused')&&s.transitionDuration.split(',').every(v=>parseFloat(v)===0)})"),
        'Hidden main renderer did not pause control motion');
    };
    const assertMainMotionVisible = async () => {
      await until(() => nativeBrowser.evaluate('smokeMain.isVisible()&&!smokeMain.isMinimized()'), 'native main shown or restored');
      assert.equal(await nativeBrowser.evaluate('smokeMain.webContents.backgroundThrottling'), false, 'Showing the main window changed call throttling');
      await until(() => mainPage.evaluate("window.lumilan.windowVisible().then(visible=>visible===true&&document.documentElement.dataset.pageHidden==='false')"), 'main shown motion policy');
      assert(await mainPage.evaluate("['#emoji-picker','#message-input','#settings-dialog','#call-panel'].every(selector=>getComputedStyle(document.querySelector(selector)).animationPlayState.split(',').every(v=>v.trim()==='running'))"),
        'Shown main renderer retained hidden animation pauses');
    };
    if (process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland') {
      assert.equal((await mainPage.evaluate<{notchSupported:boolean}>('window.lumilan.notificationSettings()')).notchSupported, false);
      assert.equal(await nativeBrowser.evaluate('smokeElectron.Notification.isSupported()'), true,
        'Wayland native notifications unavailable: check libnotify.so.4 and the private D-Bus notification service');
      const history = () => desktopCall('org.freedesktop.Notifications', '/org/freedesktop/Notifications', 'dev.lumilan.Smoke.History');
      const count = async () => { const match = /(?:uint32 )?(\d+)/.exec(await desktopCall('org.freedesktop.Notifications', '/org/freedesktop/Notifications', 'dev.lumilan.Smoke.Count')); assert(match); return Number(match[1]); };
      // Without Lumi, an unwatched visible window (focused but left alone, or unfocused) keeps the system banner.
      await nativeBrowser.evaluate(`smokeMain.show();smokeMain.focus();smokeMain.webContents.send('lumilan:open-thread',${JSON.stringify(testPeer.id)})`);
      await until(() => mainPage.evaluate("document.getElementById('message-input').placeholder.includes('Alice LAN')"), 'Wayland open conversation');
      await nativeBrowser.evaluate('smokeIdleSeconds=600');
      await testPeer.sendMessage('Wayland unattended window', appState.me.id);
      await until(async () => (await history()).includes('Wayland unattended window'), 'Wayland notification for an unattended window');
      assert(await mainPage.evaluate<boolean>(`window.lumilan.state().then(s=>s.unread[${JSON.stringify(testPeer.id)}]>0)`), 'Wayland marked an unattended arrival read');
      if (await nativeBrowser.evaluate('smokeMain.isFocused()')) {
        await mainPage.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
        await mainPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
        await until(() => mainPage.evaluate<boolean>(`window.lumilan.state().then(s=>!s.unread[${JSON.stringify(testPeer.id)}])`), 'Wayland confirmed return read the conversation');
        console.log('Wayland: unattended focused window kept the system banner and read the conversation after real input');
      } else console.log('Wayland: compositor did not grant window focus; unfocused window kept the system banner and unread state');
      await nativeBrowser.evaluate('smokeIdleSeconds=0');
      await nativeBrowser.evaluate('smokeMain.minimize()');
      await assertMainMotionHidden();
      await testPeer.sendMessage('Wayland native fallback', appState.me.id);
      await until(async () => (await history()).includes('Wayland native fallback'), 'Wayland real notification D-Bus delivery');
      assert.equal(await nativeBrowser.evaluate("smokeElectron.BrowserWindow.getAllWindows().some(w=>w.webContents.getURL()==='lumilan://app/notch.html')"), false);
      const beforeLock = await count();
      await setLocked(nativeBrowser, true); await nativeBrowser.evaluate("smokeElectron.powerMonitor.emit('suspend')");
      await testPeer.sendMessage('Wayland deferred private chat', appState.me.id);
      const reminder = await mainPage.evaluate<ReminderRecord>("window.lumilan.createReminder({title:'Wayland private reminder',dueAt:Date.now()+500}).then(rs=>rs.find(r=>r.title==='Wayland private reminder'))");
      await until(() => mainPage.evaluate(`window.lumilan.reminders().then(rs=>rs.find(r=>r.id==='${reminder.id}')?.status==='due')`), 'Wayland blocked deadline');
      await nativeBrowser.evaluate("smokeElectron.powerMonitor.emit('resume')"); await delay(250);
      assert.equal(await count(), beforeLock, 'Wayland exposed a locked notification');
      await mainPage.evaluate('window.lumilan.setNotificationSettings({enabled:true,preview:false,silent:true,background:true,notch:true})');
      await setLocked(nativeBrowser, false);
      await until(async () => (await count()) === beforeLock + 2, 'Wayland coalesced chat and reminder after unlock');
      assert(!(await history()).includes('private'), 'Wayland ignored updated preview privacy');
      await nativeBrowser.evaluate("smokeElectron.powerMonitor.emit('resume')"); await delay(250);
      assert.equal(await count(), beforeLock + 2, 'Wayland repeated deferred alerts');
      assert.deepEqual(failures, []);
      await nativeBrowser.evaluate('smokeMain.restore();smokeMain.show();smokeMain.focus()');
      await assertMainMotionVisible();
      console.log('Wayland: native renderer, real D-Bus notification fallback, no overlay, lock/suspend, reminder recovery and privacy passed');
      await quitPendingClipboard(); return;
    }
    const background = async () => {
      await nativeBrowser.evaluate('smokeMain.close()');
      await until(() => nativeBrowser.evaluate('!smokeMain.isVisible() && !smokeMain.isFocused()'), 'window hidden to tray and native focus released');
    };
    // The island morphs in CSS inside one fixed native window. Measure and click only after its transitions settle;
    // the finite mascot keyframes need not finish first.
    const settled = "!document.getAnimations().some(a=>a instanceof CSSTransition&&a.playState==='running')";
    const island = "document.getElementById('island').getBoundingClientRect()";
    const fixedWindow = async (label: string) => {
      const native = await nativeBrowser.evaluate<{bounds:{width:number;height:number};area:{width:number;height:number}}>("(()=>{const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html');return {bounds:w.getBounds(),area:smokeElectron.screen.getDisplayMatching(w.getBounds()).workArea}})()");
      assert(Math.abs(native.bounds.width - Math.min(680, native.area.width)) <= 1 && Math.abs(native.bounds.height - Math.min(280, native.area.height)) <= 1,
        `${label} resized the native window instead of morphing the island: ${JSON.stringify(native)}`);
    };
    // The rest of the fixed window is transparent; keep review screenshots to the island itself.
    const islandShot = async (name: string) => {
      await until(() => companionPage.evaluate(settled), `${name} morph settled`);
      const clip = await companionPage.evaluate<{x:number;y:number;width:number;height:number}>(`(()=>{const b=${island},s=parseFloat(getComputedStyle(document.body,'::before').width)||0;return {x:Math.max(0,b.x-s),y:b.y,width:Math.max(1,b.width+2*s),height:Math.max(1,b.height)}})()`);
      const shot = await companionPage.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
      writeFileSync(join(dist, name), Buffer.from(shot.data, 'base64'));
    };
    let hoverStep = 0;
    const hoverNotchHeader = async () => {
      const point = await companionPage.evaluate<{x:number;y:number} | false>(`(()=>{const b=document.querySelector('header').getBoundingClientRect();return !document.hidden&&document.body.dataset.mode!=='hidden'&&b.width>0&&b.height>0&&{x:b.left+12+${hoverStep++ % 2},y:b.top+12}})()`);
      assert(point, 'Notch disappeared while preparing a native control action');
      await companionPage.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    };
    const click = async (id: string) => {
      const modes = id === 'mascot' ? ['compact', 'expanded'] : ['expanded'];
      await until(() => companionPage.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});const b=e.getBoundingClientRect();return !document.hidden&&${JSON.stringify(modes)}.includes(document.body.dataset.mode)&&${settled}&&b.width>0&&b.height>0&&!e.disabled})()`), `visible ${id}`)
        .catch(async (error: unknown) => {
          // Name the failed condition: a renderer marked hidden by native occlusion differs from a layout or mode race.
          const state = await companionPage.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),b=e.getBoundingClientRect();return {visibility:document.visibilityState,focused:document.hasFocus(),mode:document.body.dataset.mode,rect:[b.x,b.y,b.width,b.height],disabled:e.disabled,viewport:[innerWidth,innerHeight]}})()`).catch(() => 'unavailable');
          const native = await nativeBrowser.evaluate("(()=>{const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html');return w&&{visible:w.isVisible(),focused:w.isFocused(),bounds:w.getBounds(),display:smokeElectron.screen.getDisplayMatching(w.getBounds()).workArea}})()").catch(() => 'unavailable');
          throw new Error(`${error instanceof Error ? error.message : String(error)}: ${JSON.stringify({ renderer: state, native })}`);
        });
      // Actual trusted pointer motion renews the production activity timer while
      // the island morph settles; auto-hide cannot satisfy this wait.
      await hoverNotchHeader();
      const point = await until(async () => {
        await hoverNotchHeader();
        const native = await nativeBrowser.evaluate<{visible:boolean;bounds:{x:number;y:number;width:number;height:number}}>("(()=>{const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html');return {visible:w.isVisible(),bounds:w.getBounds()}})()");
        assert(native.visible, `Notch auto-hid before native ${id} click`);
        return companionPage.evaluate<{x:number;y:number} | false>(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),b=e.getBoundingClientRect(),p={x:b.x+b.width/2,y:b.y+b.height/2};return !document.hidden&&${JSON.stringify(modes)}.includes(document.body.dataset.mode)&&!e.disabled&&b.width>0&&b.height>0&&${settled}&&e.contains(document.elementFromPoint(p.x,p.y))&&p})()`);
      }, `notch layout and hit target for ${id}`);
      await companionPage.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      assert(await companionPage.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});return !document.hidden&&${JSON.stringify(modes)}.includes(document.body.dataset.mode)&&!e.disabled&&e.contains(document.elementFromPoint(${point.x},${point.y}))})()`), `Native ${id} click lost its visible hit target`);
      await companionPage.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await companionPage.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const selected = () => companionPage.evaluate<NotchVisibleItem | undefined>('window.lumi.state().then(s=>s.selected)');
    const requireSelected = async () => { const item = await selected(); assert(item, 'Expected selected Lumi item'); return item; };
    const shapedPanels: string[] = [];
    const tightPanel = async (label: string) => {
      // The open island is as tall as its taller column, Lumi or the page: the inset, whichever column ends lower, then the
      // padding. Nothing is clipped, and nothing overflows sideways.
      await until(() => companionPage.evaluate(`document.body.dataset.mode==='expanded'&&${settled}`), `${label} settled`);
      const box = await companionPage.evaluate<{height:number;gap:number;overflow:boolean;scroll:number}>(`(()=>{const i=${island},c=document.getElementById('content');
        const ends=[...document.querySelectorAll('#mascot,#summary,#deck-nav,#deck > section[data-current="true"] > *,#error')].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().bottom);
        return {height:i.height,gap:i.bottom-Math.max(...ends),overflow:document.documentElement.scrollWidth>innerWidth,scroll:c.scrollHeight-c.clientHeight}})()`);
      assert(box.gap >= 6 && box.gap <= 16 && !box.overflow && box.scroll<=0, `${label} excess space or clipped content: ${JSON.stringify(box)}`);
      // X11 limits input to the island with a window shape; it must follow every panel and page height.
      if (process.platform === 'linux') await until(async () => {
        const [shape, isle] = await Promise.all([nativeBrowser.evaluate<Array<{x:number;y:number;width:number;height:number}> | undefined>('notchShapes.at(-1)'),
          companionPage.evaluate<{x:number;width:number;height:number}>(`(()=>{const b=${island};return {x:b.x,width:b.width,height:b.height}})()`)]);
        const [rect, band] = shape || [];
        return Boolean(rect && band && shape?.length === 2 && rect.y === 0 && Math.abs(rect.height - Math.ceil(isle.height)) <= 1 && rect.x <= isle.x && rect.x + rect.width >= isle.x + isle.width &&
          band.y === 0 && band.height === 10 && band.x <= isle.x - 10 && band.x + band.width >= isle.x + isle.width + 10);
      }, `${label}: X11 window shape follows the island and its shoulders`);
      if (process.platform === 'linux') shapedPanels.push(label);
    };
    await background();
    const companion = await until(async () => cdp.debugPages(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.url==='lumilan://app/notch.html'), 'lazy companion page');
    const companionPage = await connect(companion.webSocketDebuggerUrl, failures);
    notchPage = companionPage;
    await until(() => companionPage.evaluate("!!window.lumi && document.readyState==='complete'"), 'companion ready');
    // Keep this isolated test overlay away from the user's centered companion and normal pointer activity.
    await companionPage.evaluate("window.lumi.action({type:'move',delta:-400})");
    // Record the window shape reported by the island. Only Linux X11 applies one; elsewhere it must stay unset.
    await nativeBrowser.evaluate("(()=>{const proto=smokeElectron.BrowserWindow.prototype,original=proto.setShape;globalThis.notchShapes=[];proto.setShape=function(rects){if(this.webContents.getURL()==='lumilan://app/notch.html')notchShapes.push(rects);return original.call(this,rects)};return true})()");
    await companionPage.evaluate("globalThis.smokeInputs=[]; for(const type of ['pointermove','pointerdown','click','keydown']) document.addEventListener(type,e=>{smokeInputs.push([Date.now(),type,e.target.id,e.clientX,e.clientY,e.isTrusted]); if(smokeInputs.length>30)smokeInputs.shift()})");
    await nativeBrowser.evaluate("globalThis.notchTrace=[]; const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html'); ['focus','blur','resize','show','hide'].forEach(e=>w.on(e,()=>notchTrace.push([e,Date.now(),w.getBounds(),w.isFocused()])))");
    // Lumi's eyes blink once when the pill returns. Real pointer motion on this desktop must not decide the check, and
    // the OS animation preference is pinned to "no preference" only for it.
    await companionPage.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await companionPage.evaluate("globalThis.smokeBlink=false;document.getElementById('pill-eyes').addEventListener('animationstart',e=>{if(e.animationName==='blink')smokeBlink=true});true");
    await companionPage.evaluate("window.lumi.action({type:'peek'})");
    await until(() => companionPage.evaluate("document.body.dataset.mode==='compact'"), 'manual empty peek');
    // Idle: a black 120x30 pill attached to the top edge, or the notch-sized pill under a macOS menu bar inset,
    // flanked by two concave black shoulders.
    // Exact 4/7-second deadlines are tested with mock timers. Allow real pointer activity to renew them on an active desktop.
    await until(() => companionPage.evaluate(`document.body.dataset.mode==='hidden'&&${settled}&&(()=>{const e=document.getElementById('island'),b=e.getBoundingClientRect(),inset=parseFloat(getComputedStyle(e).paddingTop);return Math.round(b.width)===(inset?330:120)&&Math.round(b.height)===Math.max(30,inset)&&getComputedStyle(e).backgroundColor==='rgb(0, 0, 0)'&&['::before','::after'].every(p=>{const c=getComputedStyle(document.body,p);return c.width==='10px'&&c.height==='10px'&&c.backgroundImage.startsWith('radial-gradient')})})()`), 'manual peek auto hides to the idle pill', 20000);
    await until(() => companionPage.evaluate('globalThis.smokeBlink'), 'pill blink when the pill returns', 2000);
    await companionPage.send('Emulation.setEmulatedMedia', { features: [] });
    await fixedWindow('Idle pill');
    const pill = await companionPage.evaluate<{clock:string;badge:boolean;eyes:number;display:string}>("({clock:document.getElementById('pill-clock').textContent,badge:document.getElementById('pill-badge').hidden,eyes:document.querySelectorAll('#pill-eyes ellipse').length,display:getComputedStyle(document.getElementById('pill')).display})");
    const expectedClock = await companionPage.evaluate<string[]>("(()=>{const l={id:'id-ID',en:'en-US',ms:'ms-MY',es:'es-ES',ja:'ja-JP',ko:'ko-KR','zh-Hans':'zh-CN','zh-Hant':'zh-TW'}[document.documentElement.lang]||'id-ID',f=new Intl.DateTimeFormat(l,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),n=Date.now();return [f.format(n),f.format(n-60000),f.format(n+60000)]})()");
    assert(pill.display === 'flex' && pill.eyes === 2 && /^\d\d[.:]\d\d$/.test(pill.clock) && expectedClock.includes(pill.clock), `Idle pill content: ${JSON.stringify({ pill, expectedClock })}`);
    await companionPage.evaluate("window.lumi.action({type:'peek'})");
    await click('mascot');
    await tightPanel('Empty manual panel');
    if (process.platform !== 'linux') assert.equal(await nativeBrowser.evaluate('notchShapes.length'), 0, 'A window shape was applied outside Linux');
    await islandShot('ui-notch-empty.png');
    for (const language of ['en', 'es', 'ja', 'id']) {
      await mainPage.evaluate(`window.lumilan.setLanguage(${JSON.stringify(language)})`);
      await until(() => companionPage.evaluate(`document.documentElement.lang===${JSON.stringify(language)}`), `notch ${language} labels`);
      await tightPanel(`Empty ${language} panel`);
    }
    // Staying open under the pointer is covered with controlled input in tests/notch.test.ts; a real pointer on this
    // desktop may cross the overlay. Inside the fixed window but outside the island: the pointer has left.
    await companionPage.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 200 });
    await until(() => companionPage.evaluate("document.body.dataset.mode==='hidden'"), 'manual panel closes after the pointer leaves', 3000);
    await until(() => nativeBrowser.evaluate("!smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html').isFocused()"), 'manual close releases native keyboard focus');
    const automaticNotificationContext = async () => {
      const [native, renderer] = await Promise.all([
        nativeBrowser.evaluate<{mainVisible:boolean;mainFocused:boolean;mainMinimized:boolean;notchVisible:boolean;notchFocused:boolean;events:unknown[]}>("(()=>{const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html');return{mainVisible:smokeMain.isVisible(),mainFocused:smokeMain.isFocused(),mainMinimized:smokeMain.isMinimized(),notchVisible:w.isVisible(),notchFocused:w.isFocused(),events:notchTrace.slice(-12)}})()"),
        companionPage.evaluate("({mode:document.body.dataset.mode,documentHidden:document.hidden,inputs:smokeInputs.slice(-20)})"),
      ]);
      return { native, renderer };
    };
    const beforeAutomaticNotification = await automaticNotificationContext();
    assert(!beforeAutomaticNotification.native.mainVisible && !beforeAutomaticNotification.native.mainFocused,
      `Main window was revealed during the manual-panel auto-hide check: ${JSON.stringify(beforeAutomaticNotification)}`);
    await testPeer.sendMessage('<img src=x onerror=alert(1)> hello from LAN', appState.me.id);
    await until(async () => (await selected())?.body.includes('hello from LAN'), 'message in notch');
    // The main-process state IPC can resolve before its renderer publication.
    const automaticCard = await until(() => companionPage.evaluate<{mode:string} | false>("document.getElementById('body').textContent.includes('hello from LAN')&&({mode:document.body.dataset.mode})"), 'ordinary message rendered');
    const automaticMode = automaticCard.mode;
    assert.equal(automaticMode, 'compact', `Ordinary notification did not enter compact mode: ${automaticMode === 'compact' ? '' : JSON.stringify(await automaticNotificationContext())}`);
    await until(() => companionPage.evaluate(`${settled}&&(()=>{const e=document.getElementById('island'),b=e.getBoundingClientRect();return Math.round(b.width)<=320&&Math.round(b.height)<=68+parseFloat(getComputedStyle(e).paddingTop)})()`), 'small compact notification');
    await fixedWindow('Compact notification');
    const focusState = await nativeBrowser.evaluate("({visible:smokeMain.isVisible(),main:smokeMain.isFocused(),notch:smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html').isFocused()})");
    assert.deepEqual(focusState, { visible:false,main:false,notch:false }, `Notification stole native window focus: ${JSON.stringify(focusState)}`);
    assert.equal(await companionPage.evaluate('!!window.lumilan || !!window.require || !!window.process'), false, 'Companion exposed main bridge or Node');
    const microphone = await companionPage.evaluate("navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop()); return 'granted'},e=>e.name)");
    assert.equal(microphone, 'NotAllowedError', 'Companion was allowed to acquire the microphone');
    assert.equal(await nativeBrowser.evaluate("smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html').webContents.session===smokeMain.webContents.session"), false, 'Companion shared the main session');
    assert.equal(await companionPage.evaluate('document.querySelectorAll("#body img").length'), 0, 'Untrusted message was parsed as HTML');
    const signature = await companionPage.evaluate('window.lumi.state().then(s=>s.selected.key)');
    const groupedBefore = (await requireSelected()).count;
    await until(() => companionPage.evaluate("document.body.dataset.mode==='hidden'"), 'automatic message preview auto hides', 20000);
    assert.equal((await requireSelected()).key, signature, 'Auto-hide discarded unread notification');
    assert(((await mainPage.evaluate<Snapshot>('window.lumilan.state()')).unread[testPeer.id] || 0) > 0, 'Auto-hide marked the message read');
    await assert.rejects(companionPage.evaluate("window.lumi.action({type:'eval',path:'C:/secret'})"));
    await assert.rejects(companionPage.evaluate("window.lumi.action({type:'open',key:'message:unknown'})"));
    await mainPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:false,silent:true,background:true,notch:true})");
    assert(!JSON.stringify(await requireSelected()).includes('hello from LAN'), 'Privacy did not redact an existing card');
    await until(() => companionPage.evaluate("!document.body.textContent.includes('Alice LAN') && !document.getElementById('preview').textContent.includes('hello from LAN')"), 'compact and queued UI redacted');
    await mainPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:true})");
    await testPeer.sendMessage('Halo, ada pesan baru untuk Anda.', appState.me.id);
    await until(async () => (await selected())?.count === groupedBefore + 1, 'grouped messages');
    await islandShot('ui-notch-compact.png');
    await testThird.sendMessage('Unread from a different conversation', appState.me.id);
    await until(() => mainPage.evaluate(`window.lumilan.state().then(s=>s.unread[${JSON.stringify(testThird.id)}]>0)`), 'other conversation unread');
    // Exercise the actual renderer selection while hidden, including its delayed IPC acknowledgement.
    await nativeBrowser.evaluate(`smokeMain.webContents.send('lumilan:open-thread',${JSON.stringify(testThird.id)})`);
    await until(() => mainPage.evaluate(`document.getElementById('message-input').placeholder.includes('Citra LAN')`), 'hidden conversation selected');
    assert(((await mainPage.evaluate<Snapshot>('window.lumilan.state()')).unread[testThird.id] || 0) > 0, 'A hidden conversation was marked read');
    await companionPage.evaluate(`window.lumi.action({type:'select',key:${JSON.stringify(signature)}})`);
    await click('mascot');
    await tightPanel('Message panel');
    await islandShot('ui-notch-message.png');
    const layout = await companionPage.evaluate<{right:number;width:number;bottom:number;height:number;overflow:boolean}>(`(()=>{const b=document.getElementById('actions').getBoundingClientRect(); const f=document.getElementById('open').getBoundingClientRect(); const i=${island}; return {right:b.right,width:i.right,bottom:f.bottom,height:i.bottom,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    assert(layout.right <= layout.width && layout.bottom <= layout.height && !layout.overflow, `Clipped controls: ${JSON.stringify(layout)}`);
    await fixedWindow('Expanded message panel');
    await click('open'); await until(() => nativeBrowser.evaluate('smokeMain.isVisible()'), 'open conversation');
    await until(() => companionPage.evaluate('window.lumi.state().then(s=>!s.items.some(i=>i.key===' + JSON.stringify(signature) + '))'), 'read message dismissed');
    assert(((await mainPage.evaluate<Snapshot>('window.lumilan.state()')).unread[testThird.id] || 0) > 0, 'Opening one conversation marked a different hidden conversation as read');
    console.log('Notch: message, no focus theft, privacy, inert HTML, restricted bridge, open/read passed');

    // Always-on pill: over the watched main window Lumi keeps only its pill; an arrival elsewhere only raises its badge.
    const notchShown = "smokeElectron.BrowserWindow.getAllWindows().some(w=>w.webContents.getURL()==='lumilan://app/notch.html'&&w.isVisible())";
    await until(async () => await nativeBrowser.evaluate(`smokeMain.isFocused()&&${notchShown}`) && await companionPage.evaluate("document.body.dataset.mode==='hidden'"), 'pill stays over the watched main window');
    // The badge counts queued cards; a conversation that already has one groups the new message into it.
    const thirdCard = `window.lumi.state().then(s=>s.items.find(i=>i.key===${JSON.stringify(`message:${testThird.id}`)})?.count||0)`;
    const thirdBefore = await companionPage.evaluate<number>(thirdCard);
    await testThird.sendMessage('Badge only while watched', appState.me.id);
    await until(async () => await companionPage.evaluate<number>(thirdCard) > thirdBefore, 'watched arrival queued for the badge');
    await until(() => companionPage.evaluate("!document.getElementById('pill-badge').hidden&&Number(document.getElementById('pill-badge').textContent)>0"), 'pill badge shown');
    await delay(500);
    assert.equal(await companionPage.evaluate('document.body.dataset.mode'), 'hidden', 'An arrival previewed over the watched main window');
    assert.equal(await nativeBrowser.evaluate('smokeMain.isFocused()'), true, 'The badge took focus from the main window');
    // The earlier rule, chosen in Settings: no pill while the main window is watched.
    await mainPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:true,notchIdle:'away'})");
    await until(async () => !(await nativeBrowser.evaluate(notchShown)), "'away' withdrew the pill from the watched main window");
    // Attention: a visible main window behind another window, or a focused one left alone, is not being watched.
    const unreadFrom = (id: string) => mainPage.evaluate<number>(`window.lumilan.state().then(s=>s.unread[${JSON.stringify(id)}]||0)`);
    type Cue = [string, unknown];
    const cues = () => nativeBrowser.evaluate<Cue[]>('smokeCues');
    await until(() => nativeBrowser.evaluate('smokeMain.isVisible()&&!smokeMain.isMinimized()&&smokeMain.isFocused()'), 'opened conversation focused');
    await until(() => mainPage.evaluate("document.getElementById('message-input').placeholder.includes('Alice LAN')"), 'opened private conversation');
    await until(async () => (await unreadFrom(testPeer.id)) === 0, 'opened conversation read');
    const citraUnread = await unreadFrom(testThird.id);
    await nativeBrowser.evaluate(`globalThis.smokeCues=[];globalThis.smokeCueRestore=[];
      for(const name of ['flashFrame','setOverlayIcon']){const original=smokeMain[name];smokeCueRestore.push(()=>{delete smokeMain[name]});
        smokeMain[name]=function(...a){smokeCues.push(name==='flashFrame'?[name,a[0]]:[name,a[0]&&!a[0].isEmpty()?{size:a[0].getSize(),label:a[1]}:null]);return original.apply(this,a)}}
      const dock=smokeElectron.app.dock;if(dock){const bounce=dock.bounce;smokeCueRestore.push(()=>{dock.bounce=bounce});dock.bounce=function(type){smokeCues.push(['bounce',type]);return bounce.call(this,type)}}
      true`);
    // Another real native window takes focus, as Alt-Tab to another application would.
    await nativeBrowser.evaluate("globalThis.smokeOther=new smokeElectron.BrowserWindow({width:360,height:240,show:false,title:'Smoke other application',backgroundColor:'#ffffff'});smokeOther.show();smokeOther.focus();true");
    await until(() => nativeBrowser.evaluate('smokeOther.isFocused()&&!smokeMain.isFocused()&&smokeMain.isVisible()&&!smokeMain.isMinimized()'), 'main window visible behind another window');
    await testPeer.sendMessage('Arrived behind another window', appState.me.id);
    await until(async () => (await selected())?.body.includes('Arrived behind another window'), 'Lumi announced an arrival behind another window');
    await until(() => companionPage.evaluate("document.body.dataset.mode==='compact'"), 'compact preview over the visible main window');
    assert.deepEqual(await nativeBrowser.evaluate("({other:smokeOther.isFocused(),main:smokeMain.isFocused(),notch:smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html').isFocused()})"),
      { other: true, main: false, notch: false }, 'An arrival behind another window moved native focus');
    assert((await unreadFrom(testPeer.id)) > 0, 'The open conversation behind another window was marked read');
    const behindCues = await cues();
    if (process.platform === 'win32') {
      assert(behindCues.some(([name, value]) => name === 'flashFrame' && value === true), `Windows taskbar did not flash: ${JSON.stringify(behindCues)}`);
      const overlay = behindCues.filter(([name]) => name === 'setOverlayIcon').at(-1)?.[1] as { size?: { width: number; height: number }; label?: string } | null | undefined;
      assert(overlay?.size?.width === 32 && /\d+ belum dibaca/.test(overlay.label || ''), `Windows taskbar overlay missing unread state: ${JSON.stringify(behindCues)}`);
    } else if (process.platform === 'darwin') assert(behindCues.some(([name, value]) => name === 'bounce' && value === 'informational'), `Dock did not bounce once: ${JSON.stringify(behindCues)}`);
    else assert(!behindCues.some(([name, value]) => name === 'flashFrame' && value === true), 'Linux raised an urgency hint');
    await until(() => companionPage.evaluate("document.body.dataset.mode==='hidden'"), 'preview behind another window auto hides', 20000);
    await until(async () => !(await nativeBrowser.evaluate(notchShown)), 'no idle strip over a visible main window');
    await nativeBrowser.evaluate('smokeMain.focus()');
    await until(() => nativeBrowser.evaluate('smokeMain.isFocused()'), 'main window focused again');
    await until(async () => (await unreadFrom(testPeer.id)) === 0, 'focusing the window read its open conversation');
    if (process.platform === 'win32') assert((await cues()).some(([name, value]) => name === 'flashFrame' && value === false), 'Focusing the window did not stop the taskbar flash');

    await nativeBrowser.evaluate('smokeIdleSeconds=600;smokeCues.length=0');
    await testPeer.sendMessage('Arrived while away', appState.me.id);
    await until(async () => (await selected())?.body.includes('Arrived while away'), 'Lumi announced an arrival over an unattended window');
    assert.equal(await nativeBrowser.evaluate(`smokeMain.isFocused()&&${notchShown}`), true, 'Lumi did not cover the unattended window, or it took focus');
    assert((await unreadFrom(testPeer.id)) > 0, 'An unattended focused window marked the arrival read');
    assert(!(await cues()).some(([name, value]) => (name === 'flashFrame' && value === true) || name === 'bounce'), 'A focused window flashed or bounced');
    // CDP delivers trusted renderer input without resetting the OS idle counter, like an idle source that lags.
    await mainPage.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
    await mainPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
    await until(async () => (await unreadFrom(testPeer.id)) === 0 && !(await nativeBrowser.evaluate(notchShown)), 'confirmed return read the conversation and withdrew Lumi');
    assert.equal(await mainPage.evaluate('window.lumilan.present()'), false, 'An unrequested presence report was accepted');
    assert.equal(await unreadFrom(testThird.id), citraUnread, 'Returning read a conversation that was not open');
    await nativeBrowser.evaluate('smokeIdleSeconds=0');
    await testPeer.sendMessage('Read while watched', appState.me.id);
    await until(() => mainPage.evaluate("document.getElementById('messages').textContent.includes('Read while watched')"), 'watched conversation rendered the arrival');
    assert.equal(await unreadFrom(testPeer.id), 0, 'A watched conversation left an arrival unread');
    assert.equal(await nativeBrowser.evaluate(notchShown), false, 'Lumi covered a watched main window');
    if (process.platform === 'win32') {
      // Hiding to the tray removes the taskbar button; showing it again must restore the unread overlay.
      await nativeBrowser.evaluate('smokeCues.length=0;smokeMain.hide();smokeMain.show();smokeMain.focus()');
      await until(async () => (await cues()).some(([name, value]) => name === 'setOverlayIcon' && value !== null), 'unread overlay restored after showing the window');
    }
    await nativeBrowser.evaluate('smokeOther.destroy();for(const restore of smokeCueRestore)restore();true');
    await mainPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:true,notchIdle:'always'})");
    await until(() => nativeBrowser.evaluate(notchShown), 'pill restored over the main window');
    console.log("Attention: always-on pill with a badge-only watched arrival; with 'away', Lumi over a window behind others without focus theft, no idle strip, unattended arrivals unread until real input, taskbar/Dock cues passed");

    await background();
    const source = join(profile, 'sample.bin'); writeFileSync(source, Buffer.alloc(512 * 1024, 42));
    let sending = testPeer.sendFilePath(source, appState.me.id); sending.catch(() => {});
    const offer = await until(async () => { const s = await selected(); return s?.kind === 'file' && s.actionable && s; }, 'file offer');
    await tightPanel('File consent panel');
    await islandShot('ui-notch-file.png');
    await companionPage.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:-20, y:-20 });
    await until(() => companionPage.evaluate("document.body.dataset.mode==='hidden'"), 'automatic consent preview auto hides', 25000);
    assert.equal((await requireSelected()).key, offer.key);
    assert.equal((await requireSelected()).actionable, true, 'Auto-hide decided the file request');
    assert((await mainPage.evaluate<Array<FileOffer & FileTransfer>>('window.lumilan.fileOffers()')).some(i=>i.id===offer.key.slice('file:'.length)), 'Pending request disappeared from main app');
    await companionPage.evaluate("window.lumi.action({type:'expand'})");
    await tightPanel('Reopened file consent panel');
    await click('decline'); await assert.rejects(sending, /menolak/);
    await assert.rejects(companionPage.evaluate(`window.lumi.action({type:'accept',key:${JSON.stringify(offer.key)}})`));
    sending = testPeer.sendFilePath(source, appState.me.id); sending.catch(() => {});
    const failedOffer = await until(async () => { const s = await selected(); return s?.kind === 'file' && s.actionable && s; }, 'file for setup failure');
    const collision = join(profile, 'lumilan', 'files', `.upload-${failedOffer.key.slice('file:'.length)}.part`);
    writeFileSync(collision, 'existing file must stay intact');
    await click('accept'); await assert.rejects(sending, /EEXIST/);
    await until(() => companionPage.evaluate(`window.lumi.state().then(s=>!s.items.some(i=>i.key===${JSON.stringify(failedOffer.key)}))`), 'failed accepted file removed');
    assert.equal((await mainPage.evaluate<Array<FileOffer & FileTransfer>>('window.lumilan.fileOffers()')).length, 0, 'Failed setup left a main-window transfer active');
    assert.equal(readFileSync(collision, 'utf8'), 'existing file must stay intact');
    rmSync(collision);
    // Hold the first chunk so cross-window consent must update at exactly 0%.
    const chunkGate = Promise.withResolvers<void>(), sendTo = testPeer.sendTo.bind(testPeer), consentController = new AbortController();
    let chunkWaiting = false;
    const staleConsent: Array<{label:string;objectId:string}> = [], consentObjectGroup = 'file-consent-callbacks';
    testPeer.sendTo = async (target, packet, options) => {
      if (packet.type === 'file-chunk') { chunkWaiting = true; await chunkGate.promise; }
      return sendTo(target, packet, options);
    };
    try {
      sending = testPeer.sendFilePath(source, appState.me.id, { signal: consentController.signal }); sending.catch(() => {});
      const acceptedOffer = await until(async () => { const s = await selected(); return s?.kind === 'file' && s.actionable && s; }, 'second file offer');
      await nativeBrowser.evaluate(`smokeMain.webContents.send('lumilan:open-thread',${JSON.stringify(testPeer.id)})`);
      await until(() => mainPage.evaluate("document.querySelector('.incoming-transfer .incoming-transfer-actions')?.children.length===2"), 'main chat file consent buttons');
      // Retain actual renderer callbacks before Lumi replaces their consent row.
      for (const [label, index] of [['Accept', 1], ['Decline', 0]] as const) {
        const button = await mainPage.send('Runtime.evaluate', {
          expression: `document.querySelectorAll('.incoming-transfer .incoming-transfer-actions button')[${index}]`,
          objectGroup: consentObjectGroup,
        });
        assert(!button.exceptionDetails && button.result.objectId, `Missing ${label} consent button`);
        const { listeners } = await mainPage.send('DOMDebugger.getEventListeners', { objectId: button.result.objectId });
        const objectId = listeners.find(listener => listener.type === 'click')?.handler?.objectId;
        assert(objectId, `${label} consent button has no click callback`);
        staleConsent.push({ label, objectId });
      }
      await click('accept');
      await until(() => chunkWaiting, 'first chunk held after acceptance');
      const active = (await mainPage.evaluate<Array<FileOffer & FileTransfer>>('window.lumilan.fileOffers()')).find(item => item.id === acceptedOffer.key.slice('file:'.length));
      assert(active?.status === 'receiving' && active.received === 0, 'Transfer was not held at 0%');
      await until(() => mainPage.evaluate("!!document.querySelector('.incoming-transfer progress') && !document.querySelector('.incoming-transfer .incoming-transfer-actions')"), 'Lumi acceptance removes main consent buttons at 0%');
      for (const { label, objectId } of staleConsent) {
        const result = await mainPage.send('Runtime.callFunctionOn', {
          objectId, functionDeclaration: 'function(){return this();}', awaitPromise: true, returnByValue: true,
        });
        assert(!result.exceptionDetails, `Stale ${label} callback failed: ${JSON.stringify(result.exceptionDetails)}`);
        assert(await mainPage.evaluate("!!document.querySelector('.incoming-transfer progress') && !document.querySelector('.incoming-transfer .incoming-transfer-actions')"),
          `Stale ${label} callback removed the receiving row or restored consent buttons`);
      }
      console.log('Main consent: stale Accept/Decline callbacks preserve the active 0% transfer');
      await assert.rejects(mainPage.evaluate(`window.lumilan.decideFile(${JSON.stringify(active.id)},false)`), /tidak tersedia/);
      await assert.rejects(companionPage.evaluate(`window.lumi.action({type:'accept',key:${JSON.stringify(acceptedOffer.key)}})`));
    } catch (error) {
      consentController.abort(error); throw error;
    } finally {
      chunkGate.resolve(); testPeer.sendTo = sendTo;
      const released = await Promise.allSettled([mainPage.send('Runtime.releaseObjectGroup', { objectGroup: consentObjectGroup })]);
      await sending.catch(error => { if (!consentController.signal.aborted) throw error; });
      for (const result of released) assert.equal(result.status, 'fulfilled', `Consent callback cleanup failed: ${result.status === 'rejected' ? String(result.reason) : ''}`);
    }
    const files = await mainPage.evaluate<Message[] | {items: Message[];more:boolean}>(`window.lumilan.listFiles(${JSON.stringify(testPeer.id)},0)`);
    assert((Array.isArray(files) ? files : files.items).some(f => f.name === 'sample.bin'), JSON.stringify(files));
    const controller = new AbortController(); sending = testPeer.sendFilePath(source, appState.me.id, { signal: controller.signal }); sending.catch(() => {});
    const canceled = await until(async () => { const s = await selected(); return s?.kind === 'file' && s.actionable && s; }, 'cancel offer');
    controller.abort(new Error('Smoke cancellation')); await assert.rejects(sending);
    await until(() => companionPage.evaluate(`window.lumi.state().then(s=>!s.items.some(i=>i.key===${JSON.stringify(canceled.key)}))`), 'canceled offer removed');
    console.log('Notch: real file decline, accept at 0%, cross-window duplicate consent, setup failure, verified attachment, cancellation, stale action passed');

    const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fingerprint:sha-256 AA\r\n';
    let id = randomUUID(); await testPeer.sendCall({ action: 'offer', id, peerId: appState.me.id, sdp });
    await until(async () => (await selected())?.kind === 'call', 'incoming call');
    await assert.rejects(testThird.sendCall({ action:'offer', id:randomUUID(), peerId:appState.me.id, sdp }), /panggilan lain/);
    assert.equal((await requireSelected()).key, `call:${id}`, 'A third caller replaced the incoming call');
    await tightPanel('Call consent panel');
    await islandShot('ui-notch-call.png');
    await click('decline'); await until(() => !testPeer.activeCall, 'call declined');
    await assert.rejects(companionPage.evaluate(`window.lumi.action({type:'accept',key:'call:${id}'})`));
    id = randomUUID(); await testPeer.sendCall({ action: 'offer', id, peerId: appState.me.id, sdp });
    await until(async () => (await selected())?.kind === 'call', 'call for cancellation');
    await testPeer.sendCall({ action: 'end', id, peerId: appState.me.id });
    await until(() => companionPage.evaluate(`window.lumi.state().then(s=>!s.items.some(i=>i.key==='call:${id}'))`), 'caller canceled');

    await mainPage.evaluate("globalThis.savedGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('No microphone','NotFoundError')}");
    id = randomUUID(); await testPeer.sendCall({ action: 'offer', id, peerId: appState.me.id, sdp });
    await until(async () => (await selected())?.kind === 'call', 'device error call');
    await click('accept');
    await until(() => mainPage.evaluate("document.querySelector('#call-issue').textContent.includes('Mikrofon tidak terdeteksi')"), 'microphone error clearly displayed');
    await until(() => !testPeer.activeCall, 'device error ended call');
    await mainPage.evaluate('navigator.mediaDevices.getUserMedia=savedGetUserMedia');

    // A real browser SDP/track on the other side, relayed through the real LAN testPeer.
    const offerSdp = await mainPage.evaluate(`(async()=>{globalThis.fixtureStream=await navigator.mediaDevices.getUserMedia({audio:true}); globalThis.fixturePc=new RTCPeerConnection({iceServers:[]}); fixtureStream.getTracks().forEach(t=>fixturePc.addTrack(t,fixtureStream)); await fixturePc.setLocalDescription(await fixturePc.createOffer()); await new Promise(r=>{if(fixturePc.iceGatheringState==='complete')r();else fixturePc.addEventListener('icegatheringstatechange',()=>{if(fixturePc.iceGatheringState==='complete')r()})});return fixturePc.localDescription.sdp})()`);
    let answer: Extract<CallSignal, {type:'offer'|'answer'}> | undefined; testPeer.on('call', signal => { if (signal.type === 'answer') answer = signal; });
    await background(); id = randomUUID(); await testPeer.sendCall({ action: 'offer', id, peerId: appState.me.id, sdp: offerSdp });
    await until(async () => (await selected())?.kind === 'call', 'real audio call');
    await click('accept'); const acceptedAnswer = await until(() => answer, 'real audio answer');
    await mainPage.evaluate(`fixturePc.setRemoteDescription({type:'answer',sdp:${JSON.stringify(acceptedAnswer.sdp)}})`);
    await until(() => mainPage.evaluate("document.querySelector('#call-status').textContent==='Panggilan suara berlangsung'"), 'WebRTC connected', 20000);
    await testPeer.sendCall({ action: 'end', id, peerId: appState.me.id });
    await mainPage.evaluate('fixturePc.close(); fixtureStream.getTracks().forEach(t=>t.stop())');
    console.log('Notch: call decline, caller cancellation, clear microphone failure, real WebRTC acceptance passed');

    // Reminder scheduling and consent use the production bridge, UI and encrypted LAN protocol.
    await nativeBrowser.evaluate('smokeMain.show();smokeMain.focus()');
    await mainPage.evaluate("document.getElementById('reminders-button').click();document.getElementById('reminder-new').click()");
    await mainPage.evaluate("document.getElementById('reminder-title').value='<b>Personal reminder</b>';document.getElementById('reminder-note').value='Private note';document.getElementById('reminder-form').requestSubmit()");
    const local = await until(() => mainPage.evaluate<ReminderRecord | undefined>("window.lumilan.reminders().then(rs=>rs.find(r=>r.title==='<b>Personal reminder</b>'))"), 'personal reminder saved from UI');
    assert.equal(await mainPage.evaluate("document.querySelectorAll('#reminder-list strong b').length"),0,'Reminder title parsed as HTML');
    await mainPage.evaluate(`document.querySelector('[data-reminder-id="${local.id}"] [data-action="edit"]').click();document.getElementById('reminder-title').value='Edited locally';document.getElementById('reminder-form').requestSubmit()`);
    await until(() => mainPage.evaluate(`window.lumilan.reminders().then(rs=>rs.find(r=>r.id==='${local.id}')?.title==='Edited locally')`),'edit saved');
    const recipientState = await mainPage.evaluate<Snapshot>('window.lumilan.state()');
    const recipientFixture = { ...recipientState, contacts: [
      ...Array.from({length:15},(_,i)=>({id:`historical-fixture-${i}`,name:i%2?'Budi':'Andi',reminders:false})),
      {id:testPeer.id,name:'Nama sama',reminders:true},{id:testThird.id,name:'Nama sama',reminders:true},
      {id:testPeer.id,name:'Nama sama',reminders:true},
    ], peers:recipientState.peers.filter(p=>p.id!==testThird.id) };
    await nativeBrowser.evaluate(`smokeMain.webContents.send('lumilan:state',${JSON.stringify(recipientFixture)})`);
    await mainPage.evaluate("document.getElementById('reminder-new').click()");
    const recipientOptions = await mainPage.evaluate<Array<{id:string;label:string;disabled:boolean}>>("[...document.getElementById('reminder-recipient').options].map(o=>({id:o.value,label:o.textContent,disabled:o.disabled}))");
    assert.equal(recipientOptions.length,2,'Offline or historical contacts cluttered reminder recipients');
    assert.deepEqual(new Set(recipientOptions.map(o=>o.id)),new Set([appState.me.id,testPeer.id]),'Offline capable recipient was shown');
    assert(recipientOptions.every(o=>!o.disabled),'Unsupported recipients were left as disabled options');
    const onlineFixture={...recipientFixture,peers:recipientState.peers};
    await nativeBrowser.evaluate(`smokeMain.webContents.send('lumilan:state',${JSON.stringify(onlineFixture)})`);
    await until(()=>mainPage.evaluate(`document.getElementById('reminder-recipient').querySelector('option[value="${testThird.id}"]')!==null`),'online capable recipient returns');
    const onlineOptions=await mainPage.evaluate<Array<{id:string;label:string}>>("[...document.getElementById('reminder-recipient').options].map(o=>({id:o.value,label:o.textContent}))");
    assert.equal(onlineOptions.length,3,'Same-name online devices were merged');
    assert.equal(new Set(onlineOptions.map(o=>o.label)).size,3,'Same-name online choices were ambiguous');
    await mainPage.evaluate(`document.getElementById('reminder-recipient').value=${JSON.stringify(testThird.id)}`);
    await nativeBrowser.evaluate(`smokeMain.webContents.send('lumilan:state',${JSON.stringify(recipientFixture)})`);
    await until(()=>mainPage.evaluate("document.getElementById('reminder-recipient').value===''") ,'disconnected selection becomes unavailable');
    assert.equal(await mainPage.evaluate(`document.getElementById('reminder-recipient').querySelector('option[value="${testThird.id}"]')`),null,'Offline name retained in picker');
    await nativeBrowser.evaluate(`smokeMain.webContents.send('lumilan:state',${JSON.stringify(onlineFixture)})`);
    await mainPage.evaluate(`document.getElementById('reminder-recipient').value=${JSON.stringify(testThird.id)}`);
    const unsupportedFixture={...onlineFixture,contacts:onlineFixture.contacts.map(p=>p.id===testThird.id?{...p,reminders:false}:p)};
    await nativeBrowser.evaluate(`smokeMain.webContents.send('lumilan:state',${JSON.stringify(unsupportedFixture)})`);
    await until(()=>mainPage.evaluate("document.getElementById('reminder-recipient').selectedOptions[0]?.disabled"),'selected recipient loses capability');
    assert.equal(await mainPage.evaluate("document.getElementById('reminder-recipient').value"),'','Recipient capability change silently switched target to self');
    const beforeRejectedRecipient=await mainPage.evaluate('window.lumilan.reminders().then(rs=>rs.length)');
    await mainPage.evaluate("document.getElementById('reminder-title').value='Unsupported recipient must not save';document.getElementById('reminder-form').requestSubmit()");
    await until(()=>mainPage.evaluate("!document.getElementById('reminder-error').hidden"),'incompatible selected recipient explains failure');
    assert.equal(await mainPage.evaluate('window.lumilan.reminders().then(rs=>rs.length)'),beforeRejectedRecipient,'Invalid recipient created a different reminder');
    await nativeBrowser.evaluate(`smokeMain.webContents.send('lumilan:state',${JSON.stringify(recipientState)})`);
    const { translate } = await import('../src/renderer/i18n.js');
    for(const [theme,language] of [['light','en'],['dark','es'],['light','ja'],['dark','id']] as const){
      await mainPage.send('Emulation.setDeviceMetricsOverride',{width:360,height:760,deviceScaleFactor:1,mobile:false});
      await mainPage.evaluate(`document.getElementById('reminder-new').click();document.getElementById('reminder-title').value='Keep this draft';document.documentElement.dataset.theme='${theme}';document.getElementById('language-select').value='${language}';document.getElementById('language-select').dispatchEvent(new Event('change'))`);
      await until(()=>mainPage.evaluate(`document.documentElement.lang==='${language}'`),`reminder ${language} language ready`);
      assert.equal(await mainPage.evaluate("document.getElementById('reminder-form-title').textContent"),translate(language,'Buat pengingat'),'Reminder form retained previous language');
      assert.equal(await mainPage.evaluate("document.getElementById('reminder-title').value"),'Keep this draft','Language change erased reminder draft');
      await mainPage.evaluate("document.getElementById('reminder-new').click()");
      const layout=await mainPage.evaluate<{overflow:boolean;selectOverflow:boolean;appearance:string;padding:number;filterBorder:number;tabs:Array<{left:number;right:number;top:number;bottom:number;textLeft:number;textRight:number;height:number}>}>("(()=>{const d=document.getElementById('reminders-dialog'),s=document.getElementById('reminder-recipient'),c=getComputedStyle(s),f=document.getElementById('reminder-filters');return {overflow:d.scrollWidth>d.clientWidth,selectOverflow:s.getBoundingClientRect().right>d.getBoundingClientRect().right,appearance:c.appearance,padding:parseFloat(c.paddingRight),filterBorder:parseFloat(getComputedStyle(f).borderBottomWidth),tabs:[...f.children].map(b=>{const r=b.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(b);const text=range.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,textLeft:text.left,textRight:text.right,height:r.height}})}})()");
      assert(!layout.overflow&&!layout.selectOverflow&&layout.appearance==='none'&&layout.padding>=40,`Reminder form layout ${theme}/${language}: ${JSON.stringify(layout)}`);
      assert.equal(layout.filterBorder,0,'Reminder filters inherited sidebar separator');
      for(const tab of layout.tabs) assert(tab.height>=36&&tab.textLeft>=tab.left+6&&tab.textRight<=tab.right-6,`Reminder label does not fit ${theme}/${language}: ${JSON.stringify(tab)}`);
      for(let i=0;i<layout.tabs.length;i++)for(let j=i+1;j<layout.tabs.length;j++){const a=layout.tabs[i]!,b=layout.tabs[j]!;assert(!(a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom),'Reminder filter buttons overlap');}
      const image=await mainPage.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(dist,`ui-reminders-${theme}-${language}.png`),Buffer.from(image.data,'base64'));
      await mainPage.evaluate("document.getElementById('reminder-form-cancel').click()");
    }
    await mainPage.send('Emulation.clearDeviceMetricsOverride');
    await mainPage.evaluate("document.getElementById('reminder-new').click()");
    const desktopReminder=await mainPage.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(dist,'ui-reminders-desktop.png'),Buffer.from(desktopReminder.data,'base64'));
    await mainPage.evaluate("document.getElementById('reminders-close').click()");
    const note=await mainPage.evaluate<Message>("window.lumilan.note('Reminder source').then(r=>r.message)");
    const sourceReminder=await mainPage.evaluate<ReminderRecord>(`window.lumilan.createReminder({title:'Source reminder',dueAt:Date.now()+3600000,sourceThread:'notes',sourceId:${JSON.stringify(note.id)}}).then(rs=>rs.find(r=>r.title==='Source reminder'))`);
    await mainPage.evaluate("document.getElementById('reminders-button').click()");
    await until(()=>mainPage.evaluate(`!!document.querySelector('[data-reminder-id="${sourceReminder.id}"] [data-action="source"]')`),'source card rendered');
    await mainPage.evaluate(`document.querySelector('[data-reminder-id="${sourceReminder.id}"] [data-action="source"]').click()`);
    await until(()=>mainPage.evaluate(`!document.getElementById('reminders-dialog').open && !!document.getElementById('message-${note.id}')`),'source message opened');
    await mainPage.evaluate(`window.lumilan.deleteMessages('notes',[${JSON.stringify(note.id)}])`);
    await assert.rejects(mainPage.evaluate(`window.lumilan.reminderSource('${sourceReminder.id}')`));
    await mainPage.evaluate(`window.lumilan.changeReminder('${sourceReminder.id}','cancel')`);
    await background();
    testPeer.reminders.create({title:'Consent reminder',note:'Choose your own time',to:appState.me.id,dueAt:Date.now()+3600000});
    const request=testPeer.state.reminders.at(-1); assert(request);
    await until(async()=>{const s=await selected();return s?.kind==='reminder'&&s.body==='Consent reminder';},'reminder request in Lumi');
    assert.equal((await requireSelected()).actionable,false,'Lumi reminder accepted without schedule choice');
    const requestKey=(await requireSelected()).key;
    await mainPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:false,silent:true,background:true,notch:true})");
    assert(!JSON.stringify(await requireSelected()).includes('Consent reminder'),'Queued reminder leaked after privacy change');
    await mainPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:true})");
    await companionPage.evaluate(`window.lumi.action({type:'open',key:${JSON.stringify(requestKey)}})`);
    await until(()=>mainPage.evaluate("document.getElementById('reminders-dialog').open"),'Lumi opens reminder center');
    await mainPage.evaluate("document.querySelector('#reminder-filters [data-view=requests]').click()");
    await mainPage.evaluate(`globalThis.consentInput=document.querySelector('[data-reminder-id="${request.id}"] input');consentInput.focus()`);
    const ordinary=await testPeer.sendMessage('Ordinary chat must preserve reminder input',appState.me.id);
    await until(()=>mainPage.evaluate(`window.lumilan.state().then(s=>s.messages.some(m=>m.id===${JSON.stringify(ordinary.message.id)}))`),'ordinary snapshot while editing consent');
    assert(await mainPage.evaluate(`consentInput===document.querySelector('[data-reminder-id="${request.id}"] input')`),'Unrelated chat replaced the consent form');
    await mainPage.evaluate(`document.querySelector('[data-reminder-id="${request.id}"] form').requestSubmit()`);
    await until(()=>testPeer.state.reminders.find(r=>r.id===request.id)?.status==='accepted','recipient acceptance synchronizes');
    await assert.rejects(mainPage.evaluate(`window.lumilan.changeReminder('${request.id}','accept',{dueAt:Date.now()+3600000})`));
    await until(()=>companionPage.evaluate(`window.lumi.state().then(s=>!s.items.some(i=>i.key===${JSON.stringify(requestKey)}))`),'answered reminder removed from Lumi');
    await mainPage.evaluate("document.getElementById('reminders-close').click()");
    await background();
    await mainPage.evaluate(`window.lumilan.changeReminder('${local.id}','snooze',{dueAt:Date.now()+500})`);
    await until(async()=>{const s=await selected();return s?.kind==='reminder'&&s.status==='due';},'scheduled reminder fires while in tray');
    await companionPage.evaluate("window.lumi.action({type:'open',key:'reminder:due'})");
    await until(()=>mainPage.evaluate("document.getElementById('reminders-dialog').open"),'due reminder opens center');
    await mainPage.evaluate("document.querySelector('#reminder-filters [data-view=active]').click()");
    await mainPage.evaluate(`document.querySelector('[data-reminder-id="${local.id}"] [data-action="snooze"]').click()`);
    await until(()=>mainPage.evaluate(`window.lumilan.reminders().then(rs=>rs.find(r=>r.id==='${local.id}')?.status==='scheduled')`),'snoozed from UI');
    await mainPage.evaluate(`document.querySelector('[data-reminder-id="${local.id}"] [data-action="done"]').click()`);
    await until(()=>mainPage.evaluate(`window.lumilan.reminders().then(rs=>rs.find(r=>r.id==='${local.id}')?.status==='done')`),'completed from UI');
    await mainPage.evaluate("document.querySelector('#reminder-filters [data-view=history]').click()");
    await mainPage.evaluate(`document.querySelector('[data-reminder-id="${local.id}"] [data-action="delete"]').click()`);
    await until(()=>mainPage.evaluate(`window.lumilan.reminders().then(rs=>!rs.some(r=>r.id==='${local.id}'))`),'history deleted from UI');
    await mainPage.evaluate("document.getElementById('reminders-close').click()");
    console.log('Reminders: personal create/edit/source/deleted-source, light/dark narrow multilingual forms, recipient consent, privacy, tray deadline, snooze/done/delete and stale consent passed');

    await background();
    const recovery = await mainPage.evaluate<ReminderRecord>("window.lumilan.createReminder({title:'Locked deadline recovery',dueAt:Date.now()+3600000}).then(rs=>rs.find(r=>r.title==='Locked deadline recovery'))");
    const deferredCanceled = await mainPage.evaluate<ReminderRecord>("window.lumilan.createReminder({title:'Canceled while locked',dueAt:Date.now()+3600000}).then(rs=>rs.find(r=>r.title==='Canceled while locked'))");
    await mainPage.evaluate("globalThis.recoveryAlerts=[];globalThis.stopRecoveryAlerts=window.lumilan.onReminder(e=>recoveryAlerts.push(e))");
    await setLocked(nativeBrowser, true); await nativeBrowser.evaluate("smokeElectron.powerMonitor.emit('suspend')");
    for (const r of [recovery, deferredCanceled]) await mainPage.evaluate(`window.lumilan.changeReminder('${r.id}','snooze',{dueAt:Date.now()+500})`);
    await until(()=>mainPage.evaluate(`window.lumilan.reminders().then(rs=>[${JSON.stringify(recovery.id)},${JSON.stringify(deferredCanceled.id)}].every(id=>rs.find(r=>r.id===id)?.status==='due'))`),'deadlines persist while locked');
    await mainPage.evaluate(`window.lumilan.changeReminder('${deferredCanceled.id}','cancel')`);
    assert.equal(await mainPage.evaluate('recoveryAlerts.length'),0,'Reminder alerted while blocked');
    await nativeBrowser.evaluate("smokeElectron.powerMonitor.emit('resume')"); await delay(150);
    assert.equal(await companionPage.evaluate('document.visibilityState'),'hidden','Resume exposed a locked notch');
    assert.equal(await mainPage.evaluate('recoveryAlerts.length'),0,'Resume alerted before screen unlock');
    await mainPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:false,silent:true,background:true,notch:true})");
    await setLocked(nativeBrowser, false);
    await until(()=>mainPage.evaluate('recoveryAlerts.length===1'),'deferred reminder alerted after unlock');
    const recovered = await until(()=>companionPage.evaluate<NotchVisibleItem | undefined>("window.lumi.state().then(s=>s.items.find(i=>i.key==='reminder:due'))"),'deferred due summary in Lumi');
    assert.equal(recovered.count,1,'Canceled deferred reminder was replayed');
    assert(!JSON.stringify(recovered).includes('Locked deadline recovery'),'Deferred reminder ignored changed privacy');
    await nativeBrowser.evaluate("smokeElectron.powerMonitor.emit('unlock-screen');smokeElectron.powerMonitor.emit('resume')"); await delay(150);
    assert.equal(await mainPage.evaluate('recoveryAlerts.length'),1,'Repeated resume duplicated deferred notice');
    await mainPage.evaluate(`window.lumilan.changeReminder('${recovery.id}','done');stopRecoveryAlerts()`);
    await mainPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:true})");
    console.log('Reminders: overlapping lock/suspend, deferred catch-up once, canceled-item pruning and current privacy passed');

    // Focus: Lumi's own start button, Do not disturb broadcast over the real LAN, a held message, the idle pill
    // countdown, pause without reopening, then a deadline passed during lock + suspend: the session ends on resume and
    // its single summary waits for unlock without marking anything read.
    const statusBefore = await mainPage.evaluate<string>('window.lumilan.state().then(s=>s.me.status)');
    assert.notEqual(statusBefore, 'dnd', 'Focus fixture must start outside Do not disturb');
    await mainPage.evaluate('window.lumilan.setFocus(25)');
    await background();
    await companionPage.evaluate("window.lumi.action({type:'expand'})");
    await until(() => companionPage.evaluate("document.body.dataset.mode==='expanded'&&!document.getElementById('dots').hidden&&[...document.querySelectorAll('#dots button')].map(b=>b.dataset.page).join()==='activity,focus,routine,tasks,shelf'"), 'deck offers Activity, Focus, Routine, Tasks and Shelf');
    await click('tab-focus');
    await until(() => companionPage.evaluate("document.getElementById('page-focus').dataset.current==='true'&&!document.getElementById('focus').hidden&&document.getElementById('tab-focus').getAttribute('aria-selected')==='true'"), 'focus page with its buttons');
    await tightPanel('Focus page');
    await islandShot('ui-notch-deck-focus.png');
    // Keyboard and a horizontal swipe turn pages too.
    await companionPage.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft' });
    await companionPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft' });
    await until(() => companionPage.evaluate("document.getElementById('page-activity').dataset.current==='true'"), 'ArrowLeft returns to Activity');
    const deckPoint = await companionPage.evaluate<{x:number;y:number}>("(()=>{const b=document.getElementById('deck').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+Math.min(20,b.height/2)}})()");
    await companionPage.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...deckPoint, deltaX: 60, deltaY: 0 });
    await until(() => companionPage.evaluate("document.getElementById('page-focus').dataset.current==='true'"), 'horizontal wheel turns to Focus');
    await click('focus-25');
    await until(() => mainPage.evaluate("window.lumilan.state().then(s=>s.me.status==='dnd')"), 'focus sets Do not disturb');
    await until(() => testPeer.trusted.get(appState.me.id)?.status === 'dnd', 'contact sees Do not disturb');
    const focusCard = await requireSelected();
    assert(focusCard.kind === 'focus' && focusCard.status === 'running' && typeof focusCard.until === 'number' && Math.abs(focusCard.until - Date.now() - 25 * 60_000) < 60_000,
      `Unexpected focus card: ${JSON.stringify(focusCard)}`);
    await until(() => companionPage.evaluate("!document.getElementById('clock').hidden&&/^\\d+:\\d\\d$/.test(document.getElementById('clock').textContent)"), 'expanded countdown');
    await islandShot('notch-focus-expanded.png');
    await companionPage.evaluate('window.lumi.action({type:"collapse"})');
    await until(() => companionPage.evaluate("document.body.dataset.mode==='hidden'&&!document.hidden&&getComputedStyle(document.getElementById('timer')).display==='flex'&&/\\d/.test(document.getElementById('timer').textContent)"), 'idle pill countdown');
    await islandShot('notch-focus-pill.png');
    // Over a macOS camera notch the countdown must clear a 200 pt camera. Hosted Macs have no notch menu bar: on macOS the
    // screen reports a 37 pt one, so main places the status panel at the screen edge over it; elsewhere only the renderer
    // layout is simulated. A physical notch still needs a notched Mac.
    const simulateNotch = (on: boolean) => process.platform === 'darwin'
      ? nativeBrowser.evaluate(on
        ? "(()=>{const s=smokeElectron.screen,o=globalThis.smokeScreen=[s.getPrimaryDisplay,s.getAllDisplays],notched=d=>({...d,workArea:{...d.workArea,y:d.bounds.y+37,height:d.bounds.height-37}});s.getPrimaryDisplay=()=>notched(o[0].call(s));s.getAllDisplays=()=>o[1].call(s).map(notched);s.emit('display-metrics-changed');return true})()"
        : "(()=>{const s=smokeElectron.screen;[s.getPrimaryDisplay,s.getAllDisplays]=smokeScreen;delete globalThis.smokeScreen;s.emit('display-metrics-changed');return true})()")
      : companionPage.evaluate(`document.body.dataset.notch='${on}';document.body.style.setProperty('--inset','${on ? 37 : 0}px')`);
    await simulateNotch(true);
    let camera: {clear:number;height:number};
    try {
      await until(() => companionPage.evaluate(`document.body.dataset.notch==='true'&&${settled}&&Math.round(${island}.width)===330&&Math.round(${island}.height)===37`), 'pill over a simulated camera notch');
      if (process.platform === 'darwin') {
        const placed = await nativeBrowser.evaluate<{y:number;top:number;focused:boolean}>("(()=>{const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html');return {y:w.getBounds().y,top:smokeElectron.screen.getPrimaryDisplay().bounds.y,focused:w.isFocused()}})()");
        assert(placed.y === placed.top && !placed.focused, `Lumi did not cover the simulated notch menu bar: ${JSON.stringify(placed)}`);
        await islandShot('ui-notch-mac-pill.png');
      }
      camera = await companionPage.evaluate<{clear:number;height:number}>("(()=>{const i=document.getElementById('island').getBoundingClientRect(),r=document.createRange();r.selectNodeContents(document.getElementById('timer'));const t=r.getBoundingClientRect();return {clear:t.left-(i.left+i.width/2+100),height:t.height}})()");
    } finally { await simulateNotch(false); }
    await until(() => companionPage.evaluate(`document.body.dataset.notch==='false'&&${settled}&&Math.round(${island}.width)===120`), 'pill restored');
    assert(camera.clear >= 4 && camera.height > 0, `Focus countdown would sit under the camera notch: ${JSON.stringify(camera)}`);
    if (process.platform === 'darwin') console.log('macOS: simulated 37 pt notch menu bar placed the 330 pt pill at the screen edge without focus; countdown clears the camera');
    await testPeer.sendMessage('Held during focus', appState.me.id);
    await until(() => mainPage.evaluate(`window.lumilan.state().then(s=>(s.unread[${JSON.stringify(testPeer.id)}]||0)>0)`), 'held message stored unread');
    await delay(500);
    assert.equal(await companionPage.evaluate('document.body.dataset.mode'), 'hidden', 'A message interrupted the focus session');
    await mainPage.evaluate("window.lumilan.focus({type:'pause'})");
    await until(() => companionPage.evaluate("(t=>t.length>0&&!/\\d/.test(t))(document.getElementById('timer').textContent)"), 'paused pill');
    assert.equal(await companionPage.evaluate('document.body.dataset.mode'), 'hidden', 'Pausing reopened the hidden preview');
    await mainPage.evaluate("window.lumilan.focus({type:'resume'})");
    await nativeBrowser.evaluate('globalThis.smokeRealNow=Date.now;true');
    try {
      await setLocked(nativeBrowser, true); await nativeBrowser.evaluate("smokeElectron.powerMonitor.emit('suspend')");
      // The device slept past the deadline: move the main-process wall clock, then wake it.
      await nativeBrowser.evaluate("Date.now=()=>smokeRealNow()+26*60000;smokeElectron.powerMonitor.emit('resume');true");
      await until(() => mainPage.evaluate(`window.lumilan.state().then(s=>s.me.status===${JSON.stringify(statusBefore)})`), 'deadline passed during sleep ends on resume');
      await until(() => testPeer.trusted.get(appState.me.id)?.status === statusBefore, 'contact sees the previous status');
      await delay(300);
      assert.equal(await companionPage.evaluate("window.lumi.state().then(s=>s.items.some(i=>i.key==='focus:done'))"), false, 'Focus summary appeared on a locked screen');
      await setLocked(nativeBrowser, false);
      const focusSummary = await until(() => companionPage.evaluate<NotchVisibleItem | undefined>("window.lumi.state().then(s=>s.items.find(i=>i.key==='focus:done'))"), 'focus summary after unlock');
      assert(focusSummary.count === 1 && focusSummary.title === 'Sesi fokus selesai' && /1/.test(focusSummary.body) && !focusSummary.body.includes('Held during focus'),
        `Unexpected focus summary: ${JSON.stringify(focusSummary)}`);
    } finally { await nativeBrowser.evaluate('if(globalThis.smokeRealNow){Date.now=smokeRealNow;delete globalThis.smokeRealNow}true'); }
    await nativeBrowser.evaluate("smokeElectron.powerMonitor.emit('unlock-screen');smokeElectron.powerMonitor.emit('resume')"); await delay(300);
    assert.equal(await companionPage.evaluate("window.lumi.state().then(s=>s.items.filter(i=>i.kind==='focus').length)"), 1, 'A repeated unlock or resume duplicated the summary');
    assert(await mainPage.evaluate(`window.lumilan.state().then(s=>(s.unread[${JSON.stringify(testPeer.id)}]||0)>0)`), 'The focus summary marked the held message read');
    await companionPage.evaluate("window.lumi.action({type:'open',key:'focus:done'})");
    await until(() => companionPage.evaluate("window.lumi.state().then(s=>!s.items.some(i=>i.kind==='focus'))"), 'summary removed after opening');
    await mainPage.evaluate('window.lumilan.setFocus(0)');
    console.log('Focus: Lumi start, LAN Do not disturb broadcast/restore, held message, idle pill countdown, pause without reopening, lock → suspend → resume → unlock summary once passed');

    // Routine and Tasks: a water reminder due while the window is closed, Drink from Lumi, the hourly chart, and a task
    // added, finished and deleted from Lumi while typing keeps the panel open.
    await mainPage.evaluate("window.lumilan.routine({action:'settings',value:{enabled:true,servingMl:250,goalMl:500,startHour:0,endHour:24,intervalMinutes:15}})");
    await background();
    await nativeBrowser.evaluate('globalThis.smokeRealNow=Date.now;true');
    try {
      // One interval later: move the main-process clock and wake the timer the way a resume does.
      await nativeBrowser.evaluate("Date.now=()=>smokeRealNow()+16*60000;smokeElectron.powerMonitor.emit('resume');true");
      const water = await until(async () => { const item = await selected(); return item?.key === 'routine:water' && item; }, 'water reminder in Lumi');
      assert(water.kind === 'routine' && water.title === 'Waktunya minum' && /0[.,]0 \/ 0[.,]5 L/.test(water.body), `Unexpected water card: ${JSON.stringify(water)}`);
      await until(() => companionPage.evaluate("document.body.dataset.mode==='compact'"), 'water reminder previewed');
    } finally { await nativeBrowser.evaluate('if(globalThis.smokeRealNow){Date.now=smokeRealNow;delete globalThis.smokeRealNow}true'); }
    await click('mascot');
    await until(() => companionPage.evaluate("document.getElementById('page-routine').dataset.current==='true'"), 'water preview opens the Routine page');
    await until(() => companionPage.evaluate("document.querySelectorAll('#routine-bars rect').length===24&&!document.querySelector('#routine-bars rect.filled')"), 'empty hourly chart');
    await click('routine-drink');
    await until(() => mainPage.evaluate('window.lumilan.routineState().then(v=>v.todayMl===250)'), 'drink logged from Lumi');
    await until(() => companionPage.evaluate("window.lumi.state().then(s=>!s.items.some(i=>i.key==='routine:water'))&&document.querySelectorAll('#routine-bars rect.filled').length===1"), 'drink answered the card and filled the chart');
    await tightPanel('Routine page');
    await islandShot('notch-routine.png');
    await click('tab-tasks');
    await until(() => companionPage.evaluate("document.getElementById('page-tasks').dataset.current==='true'"), 'Tasks page');
    await companionPage.evaluate("document.getElementById('tasks-input').focus()");
    await companionPage.send('Input.insertText', { text: 'Balas pesan Dina' });
    // Typing holds the panel open even when the pointer leaves the island.
    await companionPage.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 200 });
    await delay(1000);
    assert.equal(await companionPage.evaluate('document.body.dataset.mode'), 'expanded', 'The pointer leaving closed a panel the person was typing in');
    await companionPage.evaluate("document.getElementById('tasks-form').requestSubmit()");
    await until(() => mainPage.evaluate("window.lumilan.tasksState().then(v=>v.total===1&&v.items[0].title==='Balas pesan Dina')"), 'task added from Lumi');
    await until(() => companionPage.evaluate("document.querySelectorAll('#tasks-list li').length===1&&document.getElementById('tasks-input').value===''"), 'task row shown');
    await companionPage.evaluate("document.querySelector('#tasks-list input').click()");
    await until(() => companionPage.evaluate("document.getElementById('tasks-count').textContent==='1/1'&&document.querySelector('#tasks-list li').classList.contains('done')"), 'task done from Lumi');
    await tightPanel('Tasks page');
    await islandShot('notch-tasks.png');
    await companionPage.evaluate("document.querySelector('#tasks-list button').click()");
    await until(() => mainPage.evaluate('window.lumilan.tasksState().then(v=>v.total===0)'), 'task deleted from Lumi');
    for (const action of ["{type:'tasks',action:'add',value:{title:'x',path:'C:/secret'}}", "{type:'routine',action:'drink',value:1,extra:2}", "{type:'tasks',action:'eval'}"])
      await assert.rejects(companionPage.evaluate(`window.lumi.action(${action})`), action);
    // Leaving the field ends the typing hold; the pointer is already outside, so the panel closes.
    await companionPage.evaluate("document.activeElement.blur()");
    await until(() => companionPage.evaluate("document.body.dataset.mode==='hidden'"), 'panel closes once typing ends', 3000);
    await mainPage.evaluate("window.lumilan.routine({action:'settings',value:{enabled:false,servingMl:250,goalMl:2000,startHour:8,endHour:22,intervalMinutes:60}})");
    console.log('Routine and Tasks: water reminder after a resume, Drink from Lumi with chart, add/done/delete while typing holds the panel, refused page actions passed');

    // Shelf: real files dropped on the island (paths read by the Lumi preload, never by the page), open and drag-out
    // through the stored path, a consented send to the loopback peer, cancel while waiting, save to notes, and remove.
    const shelfDir = join(profile, 'shelf-files'); mkdirSync(shelfDir);
    const shelfText = join(shelfDir, 'rak-a.txt'), shelfImage = join(shelfDir, 'rak-b.png'), shelfEmpty = join(shelfDir, 'empty.bin'), shelfBig = join(shelfDir, 'rak-c.bin');
    writeFileSync(shelfText, 'Lumilan shelf '.repeat(220));
    writeFileSync(shelfImage, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5ff0000000049454e44ae426082', 'hex'));
    writeFileSync(shelfEmpty, ''); writeFileSync(shelfBig, Buffer.alloc(2 * 1024 * 1024, 7));
    await background();
    await companionPage.evaluate("(()=>{const i=document.createElement('input');i.type='file';i.multiple=true;i.id='smoke-shelf-files';i.hidden=true;document.body.append(i);return true})()");
    // Click a row's action once the row shows it; a failure names what the row showed instead.
    const rowAction = async (name: string, action: string) => {
      const row = `[...document.querySelectorAll('#shelf-list li')].find(li=>li.querySelector('.name')?.textContent===${JSON.stringify(name)})`;
      await until(() => companionPage.evaluate(`(r=>!!r?.querySelector('[data-action=${action}]'))(${row})`), `${name} offers ${action}`)
        .catch(async (error: unknown) => { throw new Error(`${error instanceof Error ? error.message : String(error)}: ${await companionPage.evaluate(`(r=>r?r.innerText:'missing row')(${row})`)}`); });
      await companionPage.evaluate(`${row}.querySelector('[data-action=${action}]').click()`);
    };
    const shelfInput = async (paths: string[]) => {
      const dom = await companionPage.send('DOM.getDocument');
      const node = await companionPage.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#smoke-shelf-files' });
      await companionPage.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: paths });
    };
    // A synthetic drag carrying those File objects over the island centre.
    const dragFiles = (type: string) => companionPage.evaluate(`(()=>{const d=new DataTransfer();for(const f of document.getElementById('smoke-shelf-files').files)d.items.add(f);
      const b=document.getElementById('island').getBoundingClientRect();document.getElementById('island').dispatchEvent(new DragEvent(${JSON.stringify(type)},{bubbles:true,cancelable:true,dataTransfer:d,clientX:b.left+b.width/2,clientY:b.top+Math.min(20,b.height/2)}));return true})()`);
    await shelfInput([shelfText, shelfImage, shelfEmpty]);
    await dragFiles('dragenter');
    await until(() => companionPage.evaluate("document.body.dataset.mode==='expanded'&&document.getElementById('page-shelf').dataset.current==='true'"), 'dragging files over Lumi opens the shelf');
    assert.equal(await nativeBrowser.evaluate("smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html').isFocused()"), false, 'Opening the shelf for a drag took focus');
    await until(() => companionPage.evaluate(settled), 'shelf settled');
    await dragFiles('drop');
    await until(() => companionPage.evaluate("document.querySelectorAll('#shelf-list li').length===2&&/2.*0.*1/.test(document.getElementById('shelf-status').textContent)"), 'two files shelved, the empty one skipped');
    assert.deepEqual(await companionPage.evaluate<string[]>("[...document.querySelectorAll('#shelf-list li > svg use')].map(u=>u.getAttribute('href'))"), ['#g-image', '#g-document']);
    assert(!(await companionPage.evaluate<string>('window.lumi.state().then(s=>JSON.stringify(s))')).includes('shelf-files'), 'A shelf path reached the Lumi renderer');
    const savedShelf = JSON.parse(readFileSync(join(profile, 'lumilan', 'shelf.json'), 'utf8')) as Array<Record<string, unknown>>;
    assert(savedShelf.length === 2 && savedShelf.every(item => Object.keys(item).sort().join() === 'addedAt,id,name,path,size'), `Unexpected shelf.json: ${JSON.stringify(savedShelf)}`);
    await tightPanel('Shelf page');
    await islandShot('ui-notch-shelf.png');
    // Open and drag out reach the stored path in main; both native calls are recorded instead of acting on the desktop.
    await nativeBrowser.evaluate(`(()=>{globalThis.smokeOpened=[];globalThis.smokeOpenPath=smokeElectron.shell.openPath;smokeElectron.shell.openPath=async p=>{smokeOpened.push(p);return ''};
      const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html');globalThis.smokeDrags=[];
      w.webContents.startDrag=item=>{smokeDrags.push({file:item.file,icon:!item.icon.isEmpty()})};return true})()`);
    try {
      await companionPage.evaluate("[...document.querySelectorAll('#shelf-list li')].find(li=>li.textContent.includes('rak-a.txt')).querySelector('.name').click()");
      await until(async () => (await nativeBrowser.evaluate<string[]>('smokeOpened')).includes(shelfText), 'shelf opens the stored file');
      await companionPage.evaluate("[...document.querySelectorAll('#shelf-list li')].find(li=>li.textContent.includes('rak-b.png')).dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true}))");
      await until(async () => JSON.stringify(await nativeBrowser.evaluate('smokeDrags')) === JSON.stringify([{ file: shelfImage, icon: true }]), 'drag out starts a native file drag');
    } finally { await nativeBrowser.evaluate('if(globalThis.smokeOpenPath){smokeElectron.shell.openPath=smokeOpenPath;delete globalThis.smokeOpenPath}true'); }
    // Send to a contact: the picker lists online contacts only after Send; the recipient still consents and verifies.
    assert.equal(await companionPage.evaluate('window.lumi.state().then(s=>s.pages.shelf.picker)'), undefined, 'Contacts were listed before the picker opened');
    testPeer.acceptFile = async () => true;
    const textRow = "[...document.querySelectorAll('#shelf-list li')].find(li=>li.textContent.includes('rak-a.txt'))";
    await rowAction('rak-a.txt', 'pick');
    await until(() => companionPage.evaluate("!document.getElementById('shelf-picker').hidden&&[...document.querySelectorAll('#shelf-contacts button')].some(b=>b.textContent==='Alice LAN')"), 'recipient picker');
    await companionPage.evaluate("[...document.querySelectorAll('#shelf-contacts button')].find(b=>b.textContent==='Alice LAN').click()");
    await until(() => testPeer.state.messages.some(m => m.kind === 'file' && m.name === 'rak-a.txt'), 'shelf file received by the contact');
    await until(() => companionPage.evaluate(`${textRow}.querySelector('.meta').textContent.includes('Alice LAN')`), 'sent notice on the shelf row');
    // Cancel while the recipient has not answered yet.
    testPeer.acceptFile = () => new Promise<boolean>(() => {});
    await shelfInput([shelfBig]); await dragFiles('dragenter'); await dragFiles('drop');
    const bigRow = "[...document.querySelectorAll('#shelf-list li')].find(li=>li.textContent.includes('rak-c.bin'))";
    await until(() => companionPage.evaluate(`!!${bigRow}`), 'large file shelved');
    await rowAction('rak-c.bin', 'pick');
    await until(() => companionPage.evaluate("!document.getElementById('shelf-picker').hidden"), 'picker for the large file');
    await companionPage.evaluate("[...document.querySelectorAll('#shelf-contacts button')].find(b=>b.textContent==='Alice LAN').click()");
    await until(() => companionPage.evaluate("window.lumi.state().then(s=>s.pages.shelf.items.some(i=>i.name==='rak-c.bin'&&i.job?.status==='waiting'))"), 'waiting for consent');
    await rowAction('rak-c.bin', 'cancel');
    await until(() => companionPage.evaluate("window.lumi.state().then(s=>s.pages.shelf.items.some(i=>i.name==='rak-c.bin'&&!i.job&&i.failed))"), 'canceled send reported on the row');
    testPeer.acceptFile = async () => true;
    // Save to Personal notes: a local copy, no network.
    await rowAction('rak-b.png', 'note');
    await until(() => mainPage.evaluate("window.lumilan.listMessages('notes',null).then(m=>m.some(x=>x.kind==='file'&&x.name==='rak-b.png'))"), 'shelf file saved to Personal notes');
    // Remove leaves the file on disk.
    await until(() => companionPage.evaluate("window.lumi.state().then(s=>s.pages.shelf.items.some(i=>i.name==='rak-b.png'&&!i.job))"), 'save to notes finished');
    await rowAction('rak-b.png', 'remove');
    await until(() => companionPage.evaluate("![...document.querySelectorAll('#shelf-list li')].some(li=>li.textContent.includes('rak-b.png'))"), 'file removed from the shelf');
    assert(existsSync(shelfImage), 'Removing from the shelf deleted the file');
    await assert.rejects(companionPage.evaluate("window.lumi.shelve('C:/secret.txt')"));
    await assert.rejects(companionPage.evaluate("window.lumi.action({type:'shelf',action:'open',value:'not-an-id'})"));
    await assert.rejects(companionPage.evaluate(`window.lumi.action({type:'shelf',action:'send',value:{id:${JSON.stringify(savedShelf[0]!.id)},to:'../x'}})`));
    await companionPage.evaluate('window.lumi.action({type:"collapse"})');
    console.log('Shelf: drop on Lumi with paths kept in main, open and native drag-out, consented send with notice, cancel while waiting, save to notes, remove keeps the file, refused actions passed');
    if (process.platform === 'linux') console.log(`X11: window shape followed ${shapedPanels.length} panels and pages (${[...new Set(shapedPanels)].join(', ')})`);

    await background();
    const countBeforePower = await companionPage.evaluate<number>('window.lumi.state().then(s=>s.count)');
    await nativeBrowser.evaluate("smokeElectron.powerMonitor.emit('on-battery');true");
    await until(async () => (await selected())?.key === 'device:power' && await companionPage.evaluate("document.body.dataset.mode==='compact'"), 'charger notice preview');
    const powerRevision = await companionPage.evaluate<number>('window.lumi.state().then(s=>s.revision)');
    await nativeBrowser.evaluate("smokeElectron.powerMonitor.emit('on-battery');smokeElectron.powerMonitor.emit('on-ac');true"); await delay(300);
    const powerCard = await requireSelected();
    assert(powerCard.key === 'device:power' && powerCard.status === 'ac' && await companionPage.evaluate<number>('window.lumi.state().then(s=>s.revision)') === powerRevision,
      `A repeated power event took attention again: ${JSON.stringify(powerCard)}`);
    assert.equal(await companionPage.evaluate('window.lumi.state().then(s=>s.count)'), countBeforePower, 'A device notice raised the activity badge');
    console.log(`Device: charger notice once per window passed; renderer battery API ${await companionPage.evaluate("navigator.getBattery?navigator.getBattery().then(b=>'level '+Math.round(b.level*100)+'%',e=>'refused: '+e.name):'absent'")}`);
    await companionPage.evaluate('window.lumi.action({type:"collapse"})');
    await testPeer.sendMessage('Idle measurement', appState.me.id);
    await until(async () => (await selected())?.kind === 'message', 'idle fixture');
    await companionPage.evaluate('window.lumi.action({type:"collapse"})'); await delay(2000);
    assert.equal(await companionPage.evaluate('document.getAnimations().filter(a=>a.playState==="running").length'), 0, 'Idle animations kept running');
    await companionPage.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await companionPage.evaluate('window.lumi.action({type:"expand"})');
    // The renderer publication and layout follow the action separately.
    await until(() => companionPage.evaluate("!document.hidden&&document.body.dataset.mode==='expanded'&&getComputedStyle(document.querySelector('header')).visibility==='visible'"), 'reduced-motion panel expanded');
    await hoverNotchHeader();
    assert.equal(await companionPage.evaluate('document.getAnimations().length'), 0, 'Reduced motion ignored');
    await companionPage.send('Emulation.setEmulatedMedia', { features: [] });
    // The options menu opens from the bar with focus on its first item, inside the island that grows to hold it; Escape
    // closes the menu, not the panel, and returns focus to its button. Activity is the shortest page.
    await click('tab-activity'); await click('more');
    await until(() => companionPage.evaluate(`document.getElementById('menu').matches(':popover-open')&&document.activeElement?.id==='reset'&&${settled}&&(()=>{const m=document.getElementById('menu').getBoundingClientRect(),i=${island};return m.bottom<=i.bottom-6&&m.right<=i.right&&m.top>=i.top})()`), 'options menu open inside the island');
    await islandShot('ui-notch-menu.png');
    await companionPage.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await companionPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(() => companionPage.evaluate("!document.getElementById('menu').matches(':popover-open')&&document.body.dataset.mode==='expanded'&&document.activeElement?.id==='more'"), 'Escape closes only the menu');
    // Earlier fixtures move toward the screen edge. A 20 px move can be clamped there;
    // the later auto-hide resize must never be mistaken for successful keyboard movement.
    await click('more'); await click('reset');
    await until(() => mainPage.evaluate('window.lumilan.notificationSettings().then(s=>s.notchPosition?.fraction===.5)'), 'centered keyboard fixture');
    await companionPage.evaluate("document.getElementById('drag').focus()");
    const pageBeforeMove = await companionPage.evaluate<string>("document.querySelector('#deck > section[data-current=\"true\"]').dataset.page");
    const before = await nativeBrowser.evaluate<{x:number;y:number;width:number;height:number}>("smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html').getBounds()");
    await companionPage.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
    await companionPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
    await until(async () => {
      const bounds = await nativeBrowser.evaluate<{x:number;y:number;width:number;height:number}>("smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html').getBounds()");
      assert.equal(await companionPage.evaluate('document.body.dataset.mode'), 'expanded', 'Keyboard reposition collapsed the panel');
      assert.equal(await companionPage.evaluate("document.querySelector('#deck > section[data-current=\"true\"]').dataset.page"), pageBeforeMove, 'Arrow keys on the position handle turned the page');
      return bounds.width === before.width && Math.abs(bounds.x - before.x - 20) <= 1;
    }, 'keyboard reposition by 20 px without resizing');
    await click('more'); await click('reset');
    await until(() => mainPage.evaluate('window.lumilan.notificationSettings().then(s=>s.notchPosition?.fraction===.5)'), 'reset button restores center');
    await companionPage.evaluate('window.lumi.action({type:"collapse"})');
    await companionPage.send('Performance.enable');
    const nativeExpression = "(()=>{const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html');return smokeElectron.app.getAppMetrics().find(m=>m.pid===w.webContents.getOSProcessId())})()";
    await nativeBrowser.evaluate(nativeExpression);
    const metricsBefore = await companionPage.send('Performance.getMetrics'); await delay(4000);
    const metricsAfter = await companionPage.send('Performance.getMetrics');
    const metric = (result: cdp.Metrics, name: string) => result.metrics.find(m => m.name === name)?.value || 0;
    const busySeconds = metric(metricsAfter, 'TaskDuration') - metric(metricsBefore, 'TaskDuration');
    const heap = metric(metricsAfter, 'JSHeapUsedSize');
    assert(busySeconds < .4, `Companion busy while idle: ${busySeconds}s / 4s`);
    assert(heap < 32 * 1024 * 1024, `Companion JS heap too large: ${heap}`);
    console.log(`Notch idle renderer: ${(busySeconds / 4 * 100).toFixed(2)}% task time; ${(heap / 1024 / 1024).toFixed(2)} MiB JS heap; no running animation`);
    const nativeMetrics = await nativeBrowser.evaluate<{cpu:{percentCPUUsage:number};memory?:{workingSetSize:number}} | undefined>(nativeExpression);
    assert(nativeMetrics && nativeMetrics.cpu.percentCPUUsage < 5, 'Native renderer CPU budget exceeded');
    const nativeMemory = process.platform === 'linux'
      ? await nativeBrowser.evaluate<number>("(()=>{const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html');const s=process.getBuiltinModule('fs').readFileSync('/proc/'+w.webContents.getOSProcessId()+'/status','utf8');return Number(s.match(/^VmRSS:\\s+(\\d+) kB/m)?.[1])})()")
      : nativeMetrics.memory?.workingSetSize;
    console.log(`Notch native process: ${nativeMetrics.cpu.percentCPUUsage.toFixed(2)}% CPU; ${typeof nativeMemory === 'number' && Number.isFinite(nativeMemory) ? (nativeMemory / 1024).toFixed(1) + ' MiB ' + (process.platform === 'linux' ? 'RSS' : 'working set') : 'native memory unavailable'}`);
    await companionPage.evaluate("window.lumi.action({type:'peek'})");
    await click('mascot'); await click('more'); await click('pause');
    // Trusted input completion does not await IPC or Chromium's visibility update.
    const pausedWindow = "(()=>{const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html');return !!w&&!w.isVisible()&&!w.isFocused()})()";
    await until(async () => await nativeBrowser.evaluate(pausedWindow) &&
      await companionPage.evaluate("document.visibilityState==='hidden'&&document.body.dataset.mode==='hidden'"), 'paused native window and renderer hidden', 5000);
    assert.equal(await companionPage.evaluate('document.visibilityState'), 'hidden', 'Pause did not hide window');
    await testPeer.sendMessage('Should stay paused', appState.me.id); await delay(200);
    assert(await nativeBrowser.evaluate(pausedWindow), 'Incoming message exposed or focused the paused native window');
    assert.equal(await companionPage.evaluate('document.visibilityState'), 'hidden', 'Incoming message canceled pause');
    // Real renderer crash: Lumi is permanently unavailable afterwards, so this runs after its other checks.
    // The tray's Show Lumi ends the pause; a crash while locked must wait for unlock and open the pending request once.
    const notchWindow = "smokeElectron.BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL()==='lumilan://app/notch.html')";
    await nativeBrowser.evaluate("globalThis.smokeMenus=[];globalThis.smokeBuildMenu=smokeElectron.Menu.buildFromTemplate;smokeElectron.Menu.buildFromTemplate=function(...a){const m=smokeBuildMenu.apply(this,a);smokeMenus.push(m);return m}");
    await mainPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:true})");
    await until(() => nativeBrowser.evaluate("smokeMenus.some(m=>m.items.some(i=>/\\bLumi$/.test(i.label)&&i.enabled))"), 'tray Show Lumi item');
    await nativeBrowser.evaluate("smokeElectron.Menu.buildFromTemplate=smokeBuildMenu;smokeMenus.at(-1).items.find(i=>/\\bLumi$/.test(i.label)).click();true");
    await until(() => nativeBrowser.evaluate(`!!${notchWindow}?.isVisible()`), 'tray Show Lumi ends the pause');
    await setLocked(nativeBrowser, true);
    await until(() => nativeBrowser.evaluate(`!${notchWindow}?.isVisible()`), 'locked Lumi hidden but alive');
    const crashSource = join(profile, 'crash.bin'); writeFileSync(crashSource, Buffer.alloc(64 * 1024, 7));
    const crashSending = testPeer.sendFilePath(crashSource, appState.me.id); crashSending.catch(() => {});
    const crashOffer = await until(async () => (await mainPage.evaluate<Array<FileOffer & FileTransfer>>('window.lumilan.fileOffers()')).find(i => i.name === 'crash.bin'), 'request pending behind locked Lumi');
    // forcefullyCrashRenderer() kills the renderer on Windows/macOS but only asks a Linux renderer to crash itself, which
    // was not reported gone before the deadline on the X11 runner. Kill it on every OS; the trace records how it ended.
    await nativeBrowser.evaluate(`(()=>{const w=${notchWindow};w.webContents.once('render-process-gone',(_e,d)=>notchTrace.push(['render-process-gone',Date.now(),d.reason,d.exitCode]));w.once('closed',()=>notchTrace.push(['closed',Date.now()]));process.kill(w.webContents.getOSProcessId(),'SIGKILL');return true})()`);
    await until(() => nativeBrowser.evaluate(`!${notchWindow}`), 'crashed Lumi renderer released');
    await delay(300);
    assert.equal(await nativeBrowser.evaluate('smokeMain.isVisible()'), false, 'A Lumi crash revealed the app on a locked screen');
    await setLocked(nativeBrowser, false);
    await until(() => nativeBrowser.evaluate('smokeMain.isVisible()'), 'unlock hands the pending request to the main window');
    await until(() => mainPage.evaluate("[...document.querySelectorAll('#messages .incoming-transfer')].some(e=>e.textContent.includes('crash.bin'))"), 'pending request opened in its conversation');
    await mainPage.evaluate(`window.lumilan.decideFile(${JSON.stringify(crashOffer.id)},false)`); await assert.rejects(crashSending, /menolak/);
    await background(); await delay(300);
    assert.equal(await nativeBrowser.evaluate('smokeMain.isVisible()'), false, 'The Lumi failure handoff repeated');
    console.log('Notch: renderer crash while locked kept the app hidden, then opened the pending request once after unlock');
    await mainPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:false})");
    await until(() => nativeBrowser.evaluate("!smokeElectron.BrowserWindow.getAllWindows().some(w=>w.webContents.getURL()==='lumilan://app/notch.html')"), 'disabled companion releases renderer');
    // Record routing without relying on OS permission/signing or sending test banners to the user's desktop.
    await nativeBrowser.evaluate("globalThis.nativeAttempts=[]; globalThis.nativeShow=smokeElectron.Notification.prototype.show; smokeElectron.Notification.prototype.show=function(){nativeAttempts.push({title:this.title,body:this.body});this.emit('show')}");
    await testPeer.sendMessage('Background system fallback', appState.me.id);
    if (await nativeBrowser.evaluate('smokeElectron.Notification.isSupported()')) {
      await until(() => nativeBrowser.evaluate("nativeAttempts.some(n=>n.body==='Background system fallback')"), 'background native notification route');
      assert(((await mainPage.evaluate<Snapshot>('window.lumilan.state()')).unread[testPeer.id] || 0) > 0, 'Background fallback marked the message read');
    }
    await nativeBrowser.evaluate(`smokeMain.show(); smokeMain.focus(); smokeMain.webContents.send('lumilan:open-thread',${JSON.stringify(testPeer.id)})`);
    await until(() => nativeBrowser.evaluate('smokeMain.isVisible() && smokeMain.isFocused()'), 'focused chat for notification routing');
    await until(() => mainPage.evaluate("document.getElementById('message-input').placeholder.includes('Alice LAN')"), 'active conversation for notification routing');
    await mainPage.evaluate(`window.lumilan.currentThread(${JSON.stringify(testPeer.id)})`);
    const attempts = await nativeBrowser.evaluate<number>('nativeAttempts.length');
    await testPeer.sendMessage('Already reading this conversation', appState.me.id);
    await until(() => mainPage.evaluate("document.getElementById('messages').textContent.includes('Already reading this conversation')"), 'active chat message rendered');
    assert.equal(await nativeBrowser.evaluate('nativeAttempts.length'), attempts, 'Focused active chat sent a redundant notification');
    assert.equal((await mainPage.evaluate<Snapshot>('window.lumilan.state()')).unread[testPeer.id] || 0, 0);
    await setLocked(nativeBrowser, true); await nativeBrowser.evaluate("smokeElectron.powerMonitor.emit('suspend')");
    await testPeer.sendMessage('First locked chat', appState.me.id);
    await testPeer.sendMessage('Latest locked private chat', appState.me.id);
    await until(() => mainPage.evaluate(`window.lumilan.state().then(s=>s.unread[${JSON.stringify(testPeer.id)}]===2)`), 'locked focused chat stays unread');
    assert.equal(await nativeBrowser.evaluate('nativeAttempts.length'), attempts, 'Locked chat showed a native notification');
    await setLocked(nativeBrowser, false); await delay(150);
    assert.equal(await nativeBrowser.evaluate('nativeAttempts.length'), attempts, 'Unlock bypassed suspend');
    await nativeBrowser.evaluate('smokeMain.hide()');
    await assertMainMotionHidden();
    await mainPage.evaluate('window.lumilan.setNotificationSettings({enabled:true,preview:false,silent:true,background:true,notch:false})');
    await nativeBrowser.evaluate("smokeElectron.powerMonitor.emit('resume')");
    if (await nativeBrowser.evaluate('smokeElectron.Notification.isSupported()')) {
      await until(() => nativeBrowser.evaluate(`nativeAttempts.length===${attempts + 1}`), 'locked chats coalesced once after resume');
      assert.equal(await nativeBrowser.evaluate('nativeAttempts.at(-1).body'), 'Pesan baru diterima', 'Deferred chat ignored current privacy');
      await nativeBrowser.evaluate("smokeElectron.powerMonitor.emit('resume')"); await delay(150);
      assert.equal(await nativeBrowser.evaluate('nativeAttempts.length'), attempts + 1, 'Resume repeated deferred chats');
    }
    await nativeBrowser.evaluate('smokeElectron.Notification.prototype.show=nativeShow');
    console.log('Notifications: background system fallback routing and focused conversation suppression passed (OS banner delivery not asserted)');
    await nativeBrowser.evaluate('smokeMain.show();smokeMain.focus()');
    await assertMainMotionVisible();
    if (process.env.LUMILAN_README_SCREENSHOTS === '1') {
      // Export real application pixels from this disposable, loopback-only demo.
      await nativeBrowser.evaluate(`smokeMain.show();smokeMain.focus();smokeMain.webContents.send('lumilan:open-thread',${JSON.stringify(testPeer.id)})`);
      await mainPage.evaluate(`(async()=>{const s=await window.lumilan.state();const ids=s.messages.filter(m=>!m.roomId&&!m.note&&((m.from===${JSON.stringify(testPeer.id)}&&m.to===s.me.id)||(m.to===${JSON.stringify(testPeer.id)}&&m.from===s.me.id))).map(m=>m.id);if(ids.length)await window.lumilan.deleteMessages(${JSON.stringify(testPeer.id)},ids);await window.lumilan.rename('Design Studio');document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('#language-select').value='en';document.querySelector('#language-select').dispatchEvent(new Event('change'));})()`);
      testPeer.rename('Design team');
      await until(()=>mainPage.evaluate("document.getElementById('message-input').placeholder.includes('Design team')"),'demo peer name');
      await mainPage.evaluate("document.getElementById('call-dismiss').click()");
      assert.match(await mainPage.evaluate("document.getElementById('composer-key-hint').textContent"),/Enter to send/,'Composer hint did not follow the current language');
      await testPeer.sendMessage('Good morning! The design review is ready. Everything stays on our local network.',appState.me.id);
      await mainPage.evaluate(`window.lumilan.message(${JSON.stringify('Perfect. Let’s review the updates together.\n\n1. Check the new layout\n2. Share feedback\n3. Plan our next steps')},${JSON.stringify(testPeer.id)})`);
      await testPeer.sendMessage('Sounds good. You can also send files or start a voice call here.',appState.me.id);
      await until(()=>mainPage.evaluate("document.getElementById('messages').textContent.includes('Sounds good.')"),'demo conversation');
      await until(()=>mainPage.evaluate("[...document.querySelectorAll('#messages .bubble')].every(e=>getComputedStyle(e).opacity==='1')"),'demo message animations completed');
      await mainPage.send('Emulation.setDeviceMetricsOverride',{width:1100,height:760,deviceScaleFactor:1,mobile:false});
      for (const theme of ['light','dark']) {
        await mainPage.evaluate(`document.documentElement.dataset.theme='${theme}';new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        await waitUiAnimations();
        const shot=await mainPage.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(dist,`readme-chat-${theme}.png`),Buffer.from(shot.data,'base64'));
      }
      await mainPage.evaluate("document.getElementById('settings-button').click();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
      await waitUiAnimations();
      const shot=await mainPage.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      writeFileSync(join(dist,'readme-settings.png'),Buffer.from(shot.data,'base64'));
      console.log('README: real light/dark chat and settings screenshots exported from isolated demo');
    }
    const unexpected = failures.filter(text => text !== 'Permissions policy violation: microphone is not allowed in this document.');
    assert.deepEqual(unexpected, [], `Renderer errors: ${unexpected.join('; ')}`);
    console.log('Notch: idle resource budget, reduced motion, keyboard position, reset, pause, lazy renderer and disable cleanup passed');
    await quitPendingClipboard();
    console.log('Packaged notch smoke passed');
  } catch (error) {
    console.error('Notch smoke failure:', error);
    // The main presence suite runs before the lazy notch renderer exists.
    const presenceFailure: {native?:{events?:unknown[]};renderer?:{trace?:unknown[]}} = {};
    if (browser) { try { presenceFailure.native = await browser.evaluate<{events?:unknown[]}>("({visible:smokeMain.isVisible(),focused:smokeMain.isFocused(),minimized:smokeMain.isMinimized(),events:globalThis.smokePresenceNativeTrace?.slice(-20)})"); } catch {} }
    if (appPage) { try { presenceFailure.renderer = await appPage.evaluate<{trace?:unknown[]}>("({documentFocused:document.hasFocus(),documentHidden:document.hidden,pageHidden:document.documentElement.dataset.pageHidden,active:{id:document.activeElement?.id,tag:document.activeElement?.tagName,peer:document.activeElement?.closest?.('.person[data-peer]')?.dataset.peer},trace:globalThis.smokePresenceTrace?.slice(-40)})"); } catch {} }
    if (presenceFailure.native?.events?.length || presenceFailure.renderer?.trace?.length) {
      console.error('Main presence events on failure', presenceFailure);
      try { writeFileSync(join(dist, 'ui-polish-presence-failure.json'), JSON.stringify(presenceFailure, null, 2)); }
      catch (diagnosticError) { console.error('Could not save presence diagnostics:', diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)); }
    }
    if (browser) { try { console.error('Native notch events', await browser.evaluate('notchTrace.slice(-16)')); } catch {} }
    if (notchPage) { try { console.error('Notch state on failure', await notchPage.evaluate('window.lumi.state().then(s=>({mode:s.mode,dom:document.body.dataset.mode,revision:s.revision,width:innerWidth,height:innerHeight,dpr:devicePixelRatio}))')); } catch {} }
    if (notchPage) { try { console.error('Notch input on failure', await notchPage.evaluate('smokeInputs')); } catch {} }
    console.error(logs); throw error;
  }
  finally {
    if (child.exitCode === null && child.signalCode === null) {
      try { await appPage?.evaluate('setTimeout(()=>window.lumilan.quit(),100);true'); } catch {}
    }
    await browser?.close(); appPage?.close(); notchPage?.close(); await peer?.stop(); await third?.stop();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      try { await until(() => child.exitCode !== null || child.signalCode !== null, 'process stopped', 15000); }
      catch (error) {
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
        throw error;
      }
    }
    assert.equal(dirname(profile), tempRoot); assert(basename(profile).startsWith('lumilan-notch-smoke-'));
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
