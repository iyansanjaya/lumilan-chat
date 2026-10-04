// Real packaged Electron UI + a real encrypted LAN peer. Isolated profiles only, no production test IPC.
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { randomUUID } = require('node:crypto');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const desktopCall = async (name, path, method, ...args) => (await promisify(execFile)('gdbus',
  ['call', '--session', '--dest', name, '--object-path', path, '--method', method, ...args], { timeout: 5000, maxBuffer: 65536 })).stdout;
const setLocked = async (browser, locked) => {
  if (process.platform === 'linux' && process.env.LUMILAN_DESKTOP_FIXTURE === '1') {
    await desktopCall('org.gnome.ScreenSaver', '/org/gnome/ScreenSaver', 'org.gnome.ScreenSaver.SetActive', String(locked));
    await until(() => browser.evaluate(`smokeLocked===${locked}`), 'native D-Bus lock event');
  } else await browser.evaluate(`smokeElectron.powerMonitor.emit('${locked ? 'lock' : 'unlock'}-screen')`);
};
async function until(check, label, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await check(); if (value) return value; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
async function connect(url, failures, page = true) {
  const socket = new WebSocket(url), pending = new Map(); let id = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') failures.push(message.params.exceptionDetails.text);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') failures.push(message.params.entry.text);
  });
  socket.addEventListener('close', () => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Debugger connection closed')); }
    pending.clear();
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const number = ++id; const timer = setTimeout(() => { pending.delete(number); reject(new Error(`${method} timed out: ${(params.expression || '').slice(0, 160)}`)); }, 30000);
    pending.set(number, { resolve, reject, timer }); socket.send(JSON.stringify({ id: number, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  if (page) { await send('Runtime.enable'); await send('Log.enable'); }
  return { send, evaluate, close: () => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Debugger closed')); }
    if(socket.readyState===WebSocket.CLOSED)return Promise.resolve();
    const closed=new Promise(resolve=>socket.addEventListener('close',resolve,{once:true}));socket.close();
    return closed;
  } };
}

async function main() {
  const root = resolve(__dirname, '..'), dist = resolve(root, process.env.LUMILAN_BUILD_DIR || 'dist');
  const folder = readdirSync(dist).find(name => process.platform === 'win32' ? name === 'win-unpacked' : process.platform === 'darwin' ? /^mac(?:-|$)/.test(name) : /^linux.*-unpacked$/.test(name));
  assert(folder, 'Packaged application missing');
  const executable = process.platform === 'win32' ? join(dist, folder, 'Lumilan Chat.exe') : process.platform === 'darwin' ? join(dist, folder, 'Lumilan Chat.app', 'Contents', 'MacOS', 'Lumilan Chat') : join(dist, folder, 'lumilan-chat');
  const tempRoot = realpathSync(tmpdir()), profile = mkdtempSync(join(tempRoot, 'lumilan-notch-smoke-'));
  const server = createServer(); server.listen(0, '127.0.0.1');
  const port = await new Promise(resolve => server.once('listening', () => resolve(server.address().port)));
  await new Promise(resolve => server.close(resolve));
  const inspectorServer = createServer(); inspectorServer.listen(0, '127.0.0.1');
  const inspectorPort = await new Promise(resolve => inspectorServer.once('listening', () => resolve(inspectorServer.address().port)));
  await new Promise(resolve => inspectorServer.close(resolve));
  if (process.env.LUMILAN_SMOKE_SOFTWARE_RENDERING === '1') console.log('Notch smoke: software rendering (sandbox enabled)');
  const child = spawn(executable, [`--remote-debugging-port=${port}`, `--inspect=127.0.0.1:${inspectorPort}`, `--user-data-dir=${profile}`, '--lumilan-ui-smoke', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    ...(process.env.LUMILAN_SMOKE_SOFTWARE_RENDERING === '1' ? ['--disable-gpu'] : []),
    ...(process.platform === 'linux' ? [`--ozone-platform=${process.env.XDG_SESSION_TYPE === 'wayland' ? 'wayland' : 'x11'}`] : [])], {
    cwd: root, env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile, ELECTRON_ENABLE_LOGGING: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '', launchError, peer, third, appPage, notchPage, browser; const failures = [];
  child.once('error', error => { launchError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-16000); });
  try {
    const pages = await until(async () => {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Application exited: ${logs}`);
      try {
        const all = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        return all.some(p => p.url === 'lumilan://app/index.html') && all;
      } catch { return false; }
    }, 'main page', 30000);
    appPage = await connect(pages.find(p => p.url === 'lumilan://app/index.html').webSocketDebuggerUrl, failures);
    const inspectPages = await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json();
    browser = await connect(inspectPages[0].webSocketDebuggerUrl, failures, false);
    await browser.evaluate(`globalThis.smokeElectron=process.getBuiltinModule('module').createRequire(${JSON.stringify(join(root,'package.json'))})('electron');true`);
    // DevTools can advertise the page before the native window URL converges.
    await until(() => browser.evaluate("(()=>{const main=smokeElectron.BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w.webContents.isDestroyed()&&w.webContents.getURL()==='lumilan://app/index.html');if(!main)return false;globalThis.smokeMain=main;return true;})()"),
      'native main window with exact application URL', 30000);
    await browser.evaluate("globalThis.smokeLocked=false;smokeElectron.powerMonitor.on('lock-screen',()=>smokeLocked=true);smokeElectron.powerMonitor.on('unlock-screen',()=>smokeLocked=false)");
    // CI has no microphone/TCC interaction. Exercise real WebRTC with fake devices;
    // the signed package's audio entitlement is verified separately in the workflow.
    if (process.platform === 'darwin') {
      await browser.evaluate('smokeElectron.systemPreferences.askForMediaAccess=async()=>true');
      console.log('macOS smoke: fake microphone and test-only TCC gate; physical microphone permission remains a device check');
    }
    if (process.platform === 'linux') await until(() => appPage.evaluate("window.lumilan.notificationSettings().then(s=>!s.error)"), 'Linux desktop lock service available');
    await until(() => appPage.evaluate("!!window.lumilan && document.readyState==='complete' && !document.querySelector('#join-screen').hidden"), 'renderer ready');
    await appPage.evaluate("document.querySelector('#join-name').value='Notch Smoke'; document.querySelector('#join-form').requestSubmit()");
    await until(() => appPage.evaluate("!document.querySelector('#app').hidden"), 'chat loaded');
    console.log('Notch smoke: main renderer ready');
    await appPage.evaluate("document.querySelector('#language-select').value='id'; document.querySelector('#language-select').dispatchEvent(new Event('change'))");
    await until(() => appPage.evaluate("window.lumilan.notificationSettings().then(s=>s.language==='id')"), 'Indonesian language');
    // Native OS clipboard -> Chromium paste -> sandboxed preload -> validated
    // file path -> Personal notes. Preserve the user's clipboard, never log it.
    const clipboardPng=await require('sharp')({create:{width:24,height:16,channels:4,background:'#ffd36d'}}).png().toBuffer();
    await browser.evaluate("(async()=>{globalThis.savedClipboard=[];for(const item of await smokeElectron.clipboard.read()){const data={};for(const type of item.types)data[type]=await item.getType(type);if(Object.keys(data).length)savedClipboard.push(new smokeElectron.ClipboardItem(data));}})()");
    try {
      await appPage.evaluate("document.getElementById('notes-button').click();document.getElementById('message-input').value='9. First item';document.getElementById('message-input').focus();document.getElementById('message-input').setSelectionRange(13,13)");
      await appPage.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await appPage.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      assert.equal(await appPage.evaluate("document.getElementById('message-input').value"),'9. First item\n10. ','Enter did not continue list');
      await appPage.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await appPage.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      assert.equal(await appPage.evaluate("document.getElementById('message-input').value"),'9. First item\n','Empty list item did not end list');
      await appPage.evaluate("document.getElementById('message-input').value='';document.getElementById('message-input').dispatchEvent(new Event('input',{bubbles:true}))");
      await browser.evaluate(`(async()=>{await smokeElectron.clipboard.write([new smokeElectron.ClipboardItem({'image/png':new Blob([Buffer.from('${clipboardPng.toString('base64')}','base64')],{type:'image/png'})})]);smokeMain.webContents.paste()})()`);
      await until(()=>appPage.evaluate("!document.getElementById('clipboard-preview').hidden && document.getElementById('clipboard-thumbnail').naturalWidth===24"),'native clipboard image preview');
      const notesBefore=await appPage.evaluate("window.lumilan.state().then(s=>s.messages.filter(m=>m.note&&m.kind==='file').length)");
      assert.equal(notesBefore,0,'Pasting transmitted image before Send');
      await appPage.evaluate("document.getElementById('message-form').requestSubmit()");
      await until(()=>appPage.evaluate("window.lumilan.state().then(s=>s.messages.some(m=>m.note&&m.kind==='file'))"),'pasted image stored through file pipeline');
      await until(()=>appPage.evaluate("document.getElementById('clipboard-preview').hidden"),'sent clipboard preview released');
      await assert.rejects(appPage.evaluate("window.lumilan.file(new File(['<svg/>'],'image.svg',{type:'image/svg+xml'}),'notes')"));
      await assert.rejects(appPage.evaluate("window.lumilan.clipboardImage(new File(['<svg/>'],'fake.png',{type:'image/png'}))"));
      await assert.rejects(appPage.evaluate("window.lumilan.clipboardImage(new File([new Uint8Array(20*1024*1024+1)],'oversize.png',{type:'image/png'}))"));
      await assert.rejects(appPage.evaluate("globalThis.fakeClipboardRead=false;window.lumilan.clipboardImage({type:'image/png',size:1,arrayBuffer:()=>{globalThis.fakeClipboardRead=true;throw new Error('Untrusted file method executed')}})"));
      assert.equal(await appPage.evaluate('fakeClipboardRead'),false,'Preload trusted a forged Blob method');
      console.log('Native clipboard image preview/send, unsafe image rejection and list Enter behavior passed');
      // Keep races deterministic in the packaged process. These inspector-only
      // holds preserve real Sharp decoding and note storage after release.
      const replacementPng=await require('sharp')({create:{width:31,height:17,channels:4,background:'#4169e1'}}).png().toBuffer();
      const pasteFixture=(name,bytes=clipboardPng,type='image/png')=>appPage.evaluate(`{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('${bytes.toString('base64')}'),c=>c.charCodeAt(0))],${JSON.stringify(name)},{type:${JSON.stringify(type)}}));document.getElementById('message-input').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));}`);
      const holdDecode=()=>browser.evaluate(`(async()=>{
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
      const decodeHeld=()=>until(()=>browser.evaluate('smokeClipboardDecodeHeld'), 'clipboard decoder held');
      const releaseDecode=async()=>{
        await browser.evaluate('(async()=>{await smokeReleaseClipboardDecode();return true})()');
        await appPage.evaluate('window.lumilan.state()');
      };
      const previewWidth=width=>until(()=>appPage.evaluate(`!document.getElementById('clipboard-preview').hidden&&document.getElementById('clipboard-thumbnail').naturalWidth===${width}`),'clipboard replacement preview');
      await holdDecode();await pasteFixture('first.png');await decodeHeld();
      await pasteFixture('replacement.png',replacementPng);
      await pasteFixture('invalid.svg',Buffer.from('<svg/>'),'image/svg+xml');
      await releaseDecode();await previewWidth(31);
      const replacementUrl=await appPage.evaluate("document.getElementById('clipboard-thumbnail').src");
      await appPage.evaluate("document.getElementById('toast').textContent=''");
      await pasteFixture('corrupt.png',Buffer.from('<svg/>'));
      await until(()=>appPage.evaluate("document.getElementById('toast').textContent.includes('tidak valid')"),'invalid replacement rejected');
      assert.equal(await appPage.evaluate("document.getElementById('clipboard-thumbnail').src"),replacementUrl,'Failed replacement discarded the existing draft');
      await holdDecode();await pasteFixture('pending.png');await decodeHeld();
      await pasteFixture('queued.png',replacementPng);
      await appPage.evaluate("document.getElementById('clipboard-remove').click()");
      await releaseDecode();
      assert.equal(await appPage.evaluate("document.getElementById('clipboard-preview').hidden&&!document.getElementById('clipboard-thumbnail').hasAttribute('src')"),true,'Remove resurrected a pending clipboard draft');
      await pasteFixture('sending.png');await previewWidth(24);
      await browser.evaluate(`(async()=>{
        const moduleUrl=process.getBuiltinModule('url').pathToFileURL(process.getBuiltinModule('path').join(smokeElectron.app.getAppPath(),'peer.js')).href;
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
      await appPage.evaluate("document.getElementById('message-form').requestSubmit()");
      await until(()=>browser.evaluate('smokeNotesSaveHeld'),'clipboard note storage held');
      await holdDecode();await pasteFixture('next.png',replacementPng);await decodeHeld();
      await browser.evaluate('(async()=>{await smokeReleaseNotesSave();return true})()');
      await until(()=>appPage.evaluate("!document.getElementById('send-button').disabled&&document.getElementById('clipboard-preview').hidden"),'previous Send cleanup');
      await releaseDecode();await previewWidth(31);
      await appPage.evaluate("document.getElementById('clipboard-remove').click()");
      console.log('Clipboard latest-paste queue, invalid replacement, Remove cancellation and Send/paste overlap passed');
    } finally {
      await browser.evaluate(`(async()=>{
        if(globalThis.smokeClipboardSharp&&globalThis.smokeOriginalClipboardStats)smokeClipboardSharp.prototype.stats=smokeOriginalClipboardStats;
        if(globalThis.smokeClipboardPeerPrototype&&globalThis.smokeOriginalNotesSave)smokeClipboardPeerPrototype.saveNoteFilePath=smokeOriginalNotesSave;
        await globalThis.smokeReleaseClipboardDecode?.();await globalThis.smokeReleaseNotesSave?.();
        for(const key of ['smokeClipboardSharp','smokeOriginalClipboardStats','smokeClipboardDecodeHeld','smokeReleaseClipboardDecode','smokeClipboardPeerPrototype','smokeOriginalNotesSave','smokeNotesSaveHeld','smokeReleaseNotesSave'])delete globalThis[key];
      })()`);
      await browser.evaluate("(async()=>{if(savedClipboard.length)await smokeElectron.clipboard.write(savedClipboard);else smokeElectron.clipboard.clear();delete globalThis.savedClipboard})()");
    }
    await appPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:true})");
    assert.equal(await browser.evaluate("smokeElectron.BrowserWindow.getAllWindows().some(w=>w.webContents.getURL()==='lumilan://app/notch.html')"), false, 'Notch allocated a renderer before it was needed');
    const appState = await appPage.evaluate('window.lumilan.state()');
    const { LumilanPeer } = await import('../peer.js');
    peer = new LumilanPeer({ dataDir: join(profile, 'test-peer'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
    await peer.start(); peer.rename('Alice LAN'); await peer.connectAddress(appState.addresses[0]);
    third = new LumilanPeer({ dataDir: join(profile, 'third-peer'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
    await third.start(); third.rename('Citra LAN'); await third.connectAddress(appState.addresses[0]);
    console.log('Notch smoke: peer connected');
    await until(() => appPage.evaluate(`window.lumilan.state().then(s=>s.peers.some(p=>p.id===${JSON.stringify(peer.id)}))`), 'encrypted peer connected');
    // Real peer presence drives the renderer; no fake snapshots or UI test bridge.
    const originalPeerProfile = { name: peer.state.name, status: peer.state.status, about: peer.state.about, avatar: peer.state.avatar };
    const originalUiTheme = await appPage.evaluate('document.documentElement.dataset.theme');
    const personSelector = `.person[data-peer="${peer.id}"]`;
    const rowExpression = `document.querySelector(${JSON.stringify(personSelector)})`;
    const presenceCommands = [];
    const recordPresenceCommand = command => {
      presenceCommands.push({ at: Date.now(), ...command });
      if (presenceCommands.length > 20) presenceCommands.shift();
    };
    const waitUiAnimations = () => appPage.evaluate("Promise.all(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))");
    const changeMainLanguage = async language => {
      await appPage.evaluate(`document.getElementById('language-select').value=${JSON.stringify(language)};document.getElementById('language-select').dispatchEvent(new Event('change'))`);
      await until(() => appPage.evaluate(`document.documentElement.lang===${JSON.stringify(language)}`), `main ${language} labels`);
    };
    const mainViewport = async (width, height) => {
      await appPage.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await appPage.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    };
    const tooltipState = () => appPage.evaluate(`(()=>{const row=${rowExpression},tip=document.getElementById('presence-tooltip'),r=tip.getBoundingClientRect();
      return {visible:!tip.hidden,text:tip.textContent,role:tip.getAttribute('role'),position:getComputedStyle(tip).position,
        described:row?.getAttribute('aria-describedby'),bindings:document.querySelectorAll('[aria-describedby="presence-tooltip"]').length,
        focused:document.activeElement===row,clamped:r.left>=7&&r.top>=7&&r.right<=innerWidth-7&&r.bottom<=innerHeight-7};})()`);
    let lastPresencePointer;
    const presenceDiagnostics = async () => {
      const [native, renderer] = await Promise.all([
        browser.evaluate("({visible:smokeMain.isVisible(),focused:smokeMain.isFocused(),minimized:smokeMain.isMinimized(),bounds:smokeMain.getBounds(),events:globalThis.smokePresenceNativeTrace?.slice(-20)})"),
        appPage.evaluate(`(()=>{const describe=element=>({id:element?.id,tag:element?.tagName,peer:element?.closest?.('.person[data-peer]')?.dataset.peer});
          const point=${JSON.stringify(lastPresencePointer || null)},row=${rowExpression},r=row?.getBoundingClientRect();
          return{documentFocused:document.hasFocus(),documentHidden:document.hidden,visibility:document.visibilityState,pageHidden:document.documentElement.dataset.pageHidden,
            active:describe(document.activeElement),bound:describe(document.querySelector('[aria-describedby="presence-tooltip"]')),
            pointer:point,hitTarget:describe(point&&document.elementFromPoint(point.x,point.y)),row:describe(row),rowStatus:row?.dataset.status,
            rowBounds:r&&{left:r.left,top:r.top,right:r.right,bottom:r.bottom},dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),
            trace:globalThis.smokePresenceTrace?.slice(-40)};})()`),
      ]);
      return { native, renderer, commands: presenceCommands.slice(-20) };
    };
    const assertTooltip = async (label, focused = false) => {
      const tip = await tooltipState();
      const valid = tip.visible && tip.text === label && tip.role === 'tooltip' && tip.position === 'fixed' && tip.described === 'presence-tooltip' &&
        tip.bindings === 1 && tip.clamped && (!focused || tip.focused);
      assert(valid, `Live presence tooltip failed: ${JSON.stringify({ tooltip: tip, ...(valid ? {} : { context: await presenceDiagnostics() }) })}`);
    };
    const movePointer = (x, y) => {
      lastPresencePointer = { x, y };
      recordPresenceCommand({ type: 'mouseMoved', x, y });
      return appPage.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    };
    const focusPerson = () => {
      recordPresenceCommand({ type: 'focusPerson' });
      return appPage.evaluate(`${rowExpression}.focus({preventScroll:true})`);
    };
    try {
      await browser.evaluate(`globalThis.smokePresenceNativeTrace=[];globalThis.smokePresenceNativeListeners=['focus','blur','show','hide','minimize','restore'].map(type=>{
        const handler=()=>{smokePresenceNativeTrace.push({at:Date.now(),type,visible:smokeMain.isVisible(),focused:smokeMain.isFocused(),minimized:smokeMain.isMinimized()});
          if(smokePresenceNativeTrace.length>20)smokePresenceNativeTrace.shift();};smokeMain.on(type,handler);return{type,handler};});true`);
      await appPage.evaluate(`globalThis.smokePresenceTrace=[];globalThis.smokePresenceCapture=event=>{
        const describe=element=>({id:element?.id,tag:element?.tagName,peer:element?.closest?.('.person[data-peer]')?.dataset.peer});
        smokePresenceTrace.push({at:Date.now(),type:event.type,target:describe(event.target),related:describe(event.relatedTarget),
          active:describe(document.activeElement),x:event.clientX,y:event.clientY,trusted:event.isTrusted,
          key:['Tab','Escape','Home','End','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)?event.key:undefined,
          documentFocused:document.hasFocus(),documentHidden:document.hidden,pageHidden:document.documentElement.dataset.pageHidden,
          tooltipVisible:!document.getElementById('presence-tooltip').hidden,bound:document.querySelector('[aria-describedby="presence-tooltip"]')?.dataset.peer});
        if(smokePresenceTrace.length>40)smokePresenceTrace.shift();};
        for(const type of ['focusin','focusout','pointerover','pointerout','pointermove','pointerdown','keydown','keyup','visibilitychange'])document.addEventListener(type,smokePresenceCapture,true);
        for(const type of ['resize','focus','blur'])window.addEventListener(type,smokePresenceCapture,true)`);
      await browser.evaluate('smokeMain.show();smokeMain.focus()');
      await mainViewport(1100, 800);
      const ringTarget = await appPage.evaluate(`(()=>{const probe=document.createElement('span');probe.style.cssText='position:fixed;visibility:hidden;outline:2px solid;outline-offset:1px';
        document.body.append(probe);const s=getComputedStyle(probe),result={width:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset),dpr:devicePixelRatio};probe.remove();return result;})()`);
      assert(ringTarget.width > 0 && ringTarget.offset > 0, `Native outline calibration failed: ${JSON.stringify(ringTarget)}`);
      peer.setProfile({ ...originalPeerProfile, status: 'active', about: '' });
      await until(() => appPage.evaluate(`${rowExpression}?.dataset.status==='active'`), 'presence row ready');
      await appPage.evaluate(`${rowExpression}.click()`);
      const optionLabels = new Set();
      for (const language of ['id', 'en', 'es', 'ja']) {
        await changeMainLanguage(language);
        const options = await appPage.evaluate(`(()=>{const menu=document.getElementById('thread-actions'),summary=menu.querySelector('summary'),icon=summary.querySelector('[data-icon="More"] svg'),r=icon?.getBoundingClientRect();
          return {visible:!menu.hidden,label:summary.lastElementChild.textContent.trim(),icons:summary.querySelectorAll('svg').length,width:r?.width,height:r?.height};})()`);
        assert(options.visible && options.label && options.icons === 1 && options.width > 0 && options.height > 0,
          `Conversation options lost its icon/label (${language}): ${JSON.stringify(options)}`);
        optionLabels.add(options.label);
      }
      assert(optionLabels.size >= 3, 'Conversation options did not translate with the current language');
      await changeMainLanguage('id');
      const presenceLabels = { active: 'Aktif', busy: 'Sibuk', away: 'Pergi', dnd: 'Jangan ganggu' };
      for (const [status, label] of Object.entries(presenceLabels)) {
        await movePointer(1090, 790);
        await appPage.evaluate("document.getElementById('people-search').focus()");
        peer.setProfile({ ...originalPeerProfile, status, about: '' });
        await until(() => appPage.evaluate(`${rowExpression}?.dataset.status===${JSON.stringify(status)}`), `live ${status} status`);
        const appearance = await appPage.evaluate(`(()=>{const row=${rowExpression},avatar=row.querySelector('.avatar'),presence=row.querySelector('.presence'),label=presence.querySelector('.presence-label'),s=getComputedStyle(avatar),hidden=getComputedStyle(label),r=label.getBoundingClientRect();
          return {status:row.dataset.status,avatarStatus:avatar.dataset.status,current:row.getAttribute('aria-current'),ring:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset),ringColor:s.outlineColor,
            dotColor:getComputedStyle(presence,'::before').backgroundColor,dotWidth:parseFloat(getComputedStyle(presence,'::before').width),
            hiddenLabel:r.width<=2&&r.height<=2&&hidden.overflow==='hidden'&&hidden.clipPath!=='none',a11y:label.textContent,
            visibleStatus:[...presence.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(''),title:row.hasAttribute('title')||presence.hasAttribute('title')};})()`);
        assert(appearance.status === status && appearance.avatarStatus === status && appearance.current === 'true' &&
          Math.abs(appearance.ring - ringTarget.width) <= .01 && Math.abs(appearance.offset - ringTarget.offset) <= .01 &&
          appearance.ringColor === appearance.dotColor && appearance.dotWidth > 0 && appearance.hiddenLabel && appearance.a11y === label && !appearance.visibleStatus && !appearance.title,
          `Direct-person presence is missing or exposes a duplicate status (${status}): ${JSON.stringify({ appearance, ringTarget })}`);
        const bounds = await appPage.evaluate(`(()=>{const r=${rowExpression}.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
        await movePointer(bounds.x, bounds.y);
        await assertTooltip(label); // Next protocol evaluation: no hover-delay polling.
        await movePointer(1090, 790);
        assert.equal((await tooltipState()).visible, false, 'Presence tooltip remained after pointer leave');
        await focusPerson();
        await assertTooltip(label, true);
      }
      await appPage.evaluate("document.getElementById('people-search').focus()");
      let tabReachedPerson = false;
      for (let steps = 0; steps < 20 && !tabReachedPerson; steps++) {
        await appPage.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await appPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        tabReachedPerson = await appPage.evaluate(`document.activeElement===${rowExpression}`);
      }
      assert(tabReachedPerson && await appPage.evaluate(`${rowExpression}.matches(':focus-visible')`), 'Keyboard Tab could not reach the presence row visibly');
      await assertTooltip(presenceLabels.dnd, true);
      // Keep the focused peer bound across a real encrypted profile update.
      peer.setProfile({ ...originalPeerProfile, status: 'busy', about: '' });
      await until(() => appPage.evaluate(`${rowExpression}?.dataset.status==='busy'`), 'focused presence update');
      await assertTooltip(presenceLabels.busy, true);
      await appPage.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await appPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      assert.equal((await tooltipState()).visible, false, 'Escape did not dismiss presence tooltip');
      peer.setProfile({ ...originalPeerProfile, status: 'away', about: '' });
      await until(() => appPage.evaluate(`${rowExpression}?.dataset.status==='away'`), 'dismissed presence update');
      const dismissedTip = await tooltipState();
      const dismissedTrace = await appPage.evaluate(`(()=>{const describe=element=>({id:element?.id,tag:element?.tagName,peer:element?.closest?.('.person[data-peer]')?.dataset.peer});
        const point=${JSON.stringify(lastPresencePointer)};return{active:describe(document.activeElement),bound:describe(document.querySelector('[aria-describedby="presence-tooltip"]')),
          pointer:point,pointerTarget:describe(document.elementFromPoint(point.x,point.y)),trace:smokePresenceTrace.slice(-20)};})()`);
      assert.equal(dismissedTip.visible, false, `Live render resurrected an Escape-dismissed tooltip: ${JSON.stringify({ tooltip: dismissedTip, lifecycle: dismissedTrace })}`);
      await appPage.evaluate("document.getElementById('people-search').focus()");
      await focusPerson();
      await appPage.evaluate("document.getElementById('settings-button').click()");
      await until(() => appPage.evaluate("document.getElementById('settings-dialog').open"), 'presence modal opened');
      assert.equal((await tooltipState()).visible, false, 'Settings modal left a presence tooltip above it');
      await appPage.evaluate("document.getElementById('settings-dialog').close();document.getElementById('people-search').focus()");
      for (const theme of ['light', 'dark']) {
        await appPage.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        await focusPerson();
        await assertTooltip(presenceLabels.away, true);
        await waitUiAnimations();
        if (process.env.LUMILAN_UI_SCREENSHOTS === '1' || process.env.LUMILAN_README_SCREENSHOTS === '1') {
          const shot = await appPage.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          writeFileSync(join(dist, `ui-polish-tooltip-${theme}.png`), Buffer.from(shot.data, 'base64'));
        }
        await appPage.evaluate("document.getElementById('people-search').focus()");
      }
      await focusPerson();
      await mainViewport(320, 700);
      assert.equal((await tooltipState()).visible, false, 'Resize did not close presence tooltip');
      await appPage.evaluate("document.getElementById('back-button').click();document.getElementById('people-search').focus()");
      await focusPerson();
      await assertTooltip(presenceLabels.away, true);
      await mainViewport(1100, 400);
      await appPage.evaluate(`${rowExpression}.scrollIntoView({block:'center'})`);
      await appPage.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      assert(await appPage.evaluate("document.querySelector('.sidebar-list').scrollTop>0"), 'Short viewport did not exercise actual sidebar scrolling');
      await appPage.evaluate("document.getElementById('people-search').focus()");
      await focusPerson();
      await assertTooltip(presenceLabels.away, true);
      await appPage.evaluate("document.querySelector('.sidebar-list').scrollTop=0;new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
      assert.equal((await tooltipState()).visible, false, 'Sidebar scrolling did not close presence tooltip');
      await mainViewport(1100, 800);
      await appPage.evaluate("document.getElementById('people-search').focus()");
      await focusPerson();
      await assertTooltip(presenceLabels.away, true);
      await appPage.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await appPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      assert.equal((await tooltipState()).visible, false, 'Escape did not dismiss presence before disconnect');
      await peer.stop();
      await until(() => appPage.evaluate(`!${rowExpression}`), 'offline presence removed');
      const offlineTip = await tooltipState();
      assert(!offlineTip.visible && offlineTip.bindings === 0, 'Offline peer retained a stale actionable presence tooltip');
      await peer.start();
      peer.setProfile(originalPeerProfile);
      await peer.connectAddress(appState.addresses[0]);
      await until(() => appPage.evaluate(`Boolean(${rowExpression})`), 'same peer presence reconnected');
      const restoredPresence = Object.hasOwn(presenceLabels, originalPeerProfile.status) ? originalPeerProfile.status : 'active';
      await until(() => appPage.evaluate(`${rowExpression}?.dataset.status===${JSON.stringify(restoredPresence)}`), 'reconnected presence restored');
      await focusPerson();
      await assertTooltip(presenceLabels[restoredPresence], true);
      console.log('Main UI: translated options icon, live status dot/ring and immediate accessible tooltip with lifecycle/viewport cleanup passed');
    } finally {
      peer.setProfile(originalPeerProfile);
      await appPage.evaluate("if(globalThis.smokePresenceCapture){for(const type of ['focusin','focusout','pointerover','pointerout','pointermove','pointerdown','keydown','keyup','visibilitychange'])document.removeEventListener(type,smokePresenceCapture,true);for(const type of ['resize','focus','blur'])window.removeEventListener(type,smokePresenceCapture,true);delete globalThis.smokePresenceCapture}");
      await browser.evaluate("for(const listener of globalThis.smokePresenceNativeListeners||[])smokeMain.removeListener(listener.type,listener.handler);delete globalThis.smokePresenceNativeListeners");
      await changeMainLanguage('id');
      await appPage.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(originalUiTheme)};document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.getElementById('notes-button').click()`);
      await appPage.send('Emulation.clearDeviceMetricsOverride');
    }
    peer.acceptFile = async () => true;
    const pastedTransfer = await appPage.evaluate(`window.lumilan.file(new File([Uint8Array.from(atob('${clipboardPng.toString('base64')}'),c=>c.charCodeAt(0))],'clipboard.png',{type:'image/png'}),${JSON.stringify(peer.id)})`);
    assert.equal(pastedTransfer.delivered,1,'In-memory clipboard image did not reach its LAN recipient');
    assert.equal(peer.state.messages.find(m=>m.id===pastedTransfer.message.id)?.sha256,pastedTransfer.message.sha256,'Clipboard image integrity was not verified');
    console.log('Clipboard image crossed the real encrypted LAN file approval and integrity pipeline');
    const quitPendingClipboard = async () => {
      // Exercise shutdown on every native desktop, including the Wayland fallback.
      let releaseQuitOffer;
      peer.acceptFile = () => new Promise(resolve => { releaseQuitOffer = resolve; });
      try {
        await appPage.evaluate(`window.lumilan.file(new File([Uint8Array.from(atob('${clipboardPng.toString('base64')}'),c=>c.charCodeAt(0))],'quit-pending.png',{type:'image/png'}),${JSON.stringify(peer.id)}).catch(()=>{});true`);
        await until(() => Boolean(releaseQuitOffer), 'recipient consent pending before Quit');
        const stagedClipboard = () => readdirSync(join(profile, 'lumilan', 'files')).filter(name => /^\.clipboard-[A-Za-z0-9]{6}$/.test(name));
        assert.equal(stagedClipboard().length, 1, 'Pending clipboard image has no private staging directory');
        // The Node inspector can hold process shutdown while it remains attached.
        await browser.close(); browser = null;
        await appPage.evaluate("document.querySelectorAll('dialog[open]').forEach(d=>d.close());setTimeout(()=>window.lumilan.quit(),100);true");
        await until(() => child.exitCode !== null, 'explicit quit removes companion');
        assert.equal(child.exitCode, 0, 'Quit exited abnormally');
        assert.deepEqual(stagedClipboard(), [], 'Quit left a clipboard image staging directory');
        console.log('Quit aborted pending clipboard transfer and removed private staging');
      } finally { releaseQuitOffer?.(false); }
    };
    const assertMainMotionHidden = async () => {
      await until(() => browser.evaluate('!smokeMain.isVisible()||smokeMain.isMinimized()'), 'native main hidden or minimized');
      assert.equal(await browser.evaluate('smokeMain.webContents.backgroundThrottling'), false, 'Main window throttling changed and could interrupt calls');
      await until(() => appPage.evaluate("window.lumilan.windowVisible().then(visible=>visible===false&&document.documentElement.dataset.pageHidden==='true')"), 'main hidden motion policy');
      assert(await appPage.evaluate("['#emoji-picker','#message-input','#settings-dialog','#call-panel'].every(selector=>{const s=getComputedStyle(document.querySelector(selector));return s.animationPlayState.split(',').every(v=>v.trim()==='paused')&&s.transitionDuration.split(',').every(v=>parseFloat(v)===0)})"),
        'Hidden main renderer did not pause control motion');
    };
    const assertMainMotionVisible = async () => {
      await until(() => browser.evaluate('smokeMain.isVisible()&&!smokeMain.isMinimized()'), 'native main shown or restored');
      assert.equal(await browser.evaluate('smokeMain.webContents.backgroundThrottling'), false, 'Showing the main window changed call throttling');
      await until(() => appPage.evaluate("window.lumilan.windowVisible().then(visible=>visible===true&&document.documentElement.dataset.pageHidden==='false')"), 'main shown motion policy');
      assert(await appPage.evaluate("['#emoji-picker','#message-input','#settings-dialog','#call-panel'].every(selector=>getComputedStyle(document.querySelector(selector)).animationPlayState.split(',').every(v=>v.trim()==='running'))"),
        'Shown main renderer retained hidden animation pauses');
    };
    if (process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland') {
      assert.equal((await appPage.evaluate('window.lumilan.notificationSettings()')).notchSupported, false);
      assert.equal(await browser.evaluate('smokeElectron.Notification.isSupported()'), true,
        'Wayland native notifications unavailable: check libnotify.so.4 and the private D-Bus notification service');
      await browser.evaluate('smokeMain.minimize()');
      await assertMainMotionHidden();
      const history = () => desktopCall('org.freedesktop.Notifications', '/org/freedesktop/Notifications', 'dev.lumilan.Smoke.History');
      const count = async () => Number(/(?:uint32 )?(\d+)/.exec(await desktopCall('org.freedesktop.Notifications', '/org/freedesktop/Notifications', 'dev.lumilan.Smoke.Count'))[1]);
      await peer.sendMessage('Wayland native fallback', appState.me.id);
      await until(async () => (await history()).includes('Wayland native fallback'), 'Wayland real notification D-Bus delivery');
      assert.equal(await browser.evaluate("smokeElectron.BrowserWindow.getAllWindows().some(w=>w.webContents.getURL()==='lumilan://app/notch.html')"), false);
      const beforeLock = await count();
      await setLocked(browser, true); await browser.evaluate("smokeElectron.powerMonitor.emit('suspend')");
      await peer.sendMessage('Wayland deferred private chat', appState.me.id);
      const reminder = await appPage.evaluate("window.lumilan.createReminder({title:'Wayland private reminder',dueAt:Date.now()+500}).then(rs=>rs.find(r=>r.title==='Wayland private reminder'))");
      await until(() => appPage.evaluate(`window.lumilan.reminders().then(rs=>rs.find(r=>r.id==='${reminder.id}')?.status==='due')`), 'Wayland blocked deadline');
      await browser.evaluate("smokeElectron.powerMonitor.emit('resume')"); await delay(250);
      assert.equal(await count(), beforeLock, 'Wayland exposed a locked notification');
      await appPage.evaluate('window.lumilan.setNotificationSettings({enabled:true,preview:false,silent:true,background:true,notch:true})');
      await setLocked(browser, false);
      await until(async () => (await count()) === beforeLock + 2, 'Wayland coalesced chat and reminder after unlock');
      assert(!(await history()).includes('private'), 'Wayland ignored updated preview privacy');
      await browser.evaluate("smokeElectron.powerMonitor.emit('resume')"); await delay(250);
      assert.equal(await count(), beforeLock + 2, 'Wayland repeated deferred alerts');
      assert.deepEqual(failures, []);
      await browser.evaluate('smokeMain.restore();smokeMain.show();smokeMain.focus()');
      await assertMainMotionVisible();
      console.log('Wayland: native renderer, real D-Bus notification fallback, no overlay, lock/suspend, reminder recovery and privacy passed');
      await quitPendingClipboard(); return;
    }
    const background = async () => {
      await browser.evaluate('smokeMain.close()');
      await until(() => browser.evaluate('!smokeMain.isVisible() && !smokeMain.isFocused()'), 'window hidden to tray and native focus released');
    };
    let hoverStep = 0;
    const hoverNotchHeader = async () => {
      const point = await notchPage.evaluate(`(()=>{const b=document.querySelector('header').getBoundingClientRect();return !document.hidden&&document.body.dataset.mode!=='hidden'&&b.width>0&&b.height>0&&{x:b.left+12+${hoverStep++ % 2},y:b.top+12}})()`);
      assert(point, 'Notch disappeared while preparing a native control action');
      await notchPage.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    };
    const click = async id => {
      const modes = id === 'mascot' ? ['compact', 'expanded'] : ['expanded'];
      await until(() => notchPage.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});const b=e.getBoundingClientRect();return !document.hidden&&${JSON.stringify(modes)}.includes(document.body.dataset.mode)&&b.width>0&&b.height>0&&!e.disabled})()`), `visible ${id}`);
      // Actual trusted pointer motion renews the production activity timer while
      // native resize and renderer layout converge; auto-hide cannot satisfy this wait.
      await hoverNotchHeader();
      // Native resize and renderer layout arrive separately; fractional Windows DPI can round DIP bounds by 1 px.
      const point = await until(async () => {
        await hoverNotchHeader();
        const native = await browser.evaluate("(()=>{const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html');return {visible:w.isVisible(),bounds:w.getBounds()}})()");
        assert(native.visible, `Notch auto-hid before native ${id} click`);
        return notchPage.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),b=e.getBoundingClientRect(),p={x:b.x+b.width/2,y:b.y+b.height/2};return !document.hidden&&${JSON.stringify(modes)}.includes(document.body.dataset.mode)&&!e.disabled&&b.width>0&&b.height>0&&Math.abs(innerHeight-${native.bounds.height})<=2&&Math.abs(innerWidth-${native.bounds.width})<=2&&e.contains(document.elementFromPoint(p.x,p.y))&&p})()`);
      }, `notch layout and hit target for ${id}`);
      await notchPage.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      assert(await notchPage.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});return !document.hidden&&${JSON.stringify(modes)}.includes(document.body.dataset.mode)&&!e.disabled&&e.contains(document.elementFromPoint(${point.x},${point.y}))})()`), `Native ${id} click lost its visible hit target`);
      await notchPage.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await notchPage.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const selected = () => notchPage.evaluate('window.lumi.state().then(s=>s.selected)');
    const tightPanel = async label => {
      await until(() => notchPage.evaluate("document.body.dataset.mode==='expanded' && Math.abs(innerHeight-(document.querySelector('header').getBoundingClientRect().height+document.getElementById('content').scrollHeight+3))<=2"), `${label} content height`);
      const box = await notchPage.evaluate("({height:innerHeight,gap:innerHeight-document.querySelector('footer').getBoundingClientRect().bottom,overflow:document.documentElement.scrollWidth>innerWidth,scroll:document.getElementById('content').scrollHeight-document.getElementById('content').clientHeight})");
      assert(box.gap >= 6 && box.gap <= 13 && !box.overflow && box.scroll<=0, `${label} excess space or clipped footer: ${JSON.stringify(box)}`);
    };
    await background();
    const companion = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.url==='lumilan://app/notch.html'), 'lazy companion page');
    notchPage = await connect(companion.webSocketDebuggerUrl, failures);
    await until(() => notchPage.evaluate("!!window.lumi && document.readyState==='complete'"), 'companion ready');
    // Keep this isolated test overlay away from the user's centered companion and normal pointer activity.
    await notchPage.evaluate("window.lumi.action({type:'move',delta:-400})");
    await notchPage.evaluate("globalThis.smokeInputs=[]; for(const type of ['pointermove','pointerdown','click','keydown']) document.addEventListener(type,e=>{smokeInputs.push([Date.now(),type,e.target.id,e.clientX,e.clientY,e.isTrusted]); if(smokeInputs.length>30)smokeInputs.shift()})");
    await browser.evaluate("globalThis.notchTrace=[]; const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html'); ['focus','blur','resize','show','hide'].forEach(e=>w.on(e,()=>notchTrace.push([e,Date.now(),w.getBounds(),w.isFocused()])))");
    await notchPage.evaluate("window.lumi.action({type:'peek'})");
    await until(() => notchPage.evaluate("document.body.dataset.mode==='compact'"), 'manual empty peek');
    // Windows can clamp a transparent native window to 38 DIP; its visible wake strip must still be only 5 DIP.
    // Exact 4/7-second deadlines are tested with mock timers. Allow real pointer activity to renew them on an active desktop.
    await until(() => notchPage.evaluate("document.body.dataset.mode==='hidden' && document.getElementById('island').getBoundingClientRect().height===5"), 'manual peek auto hides', 20000);
    await notchPage.evaluate("window.lumi.action({type:'peek'})");
    await click('mascot');
    await tightPanel('Empty manual panel');
    const emptyShot = await notchPage.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(dist, 'ui-notch-empty.png'), Buffer.from(emptyShot.data, 'base64'));
    for (const language of ['en', 'es', 'ja', 'id']) {
      await appPage.evaluate(`window.lumilan.setLanguage(${JSON.stringify(language)})`);
      await until(() => notchPage.evaluate(`document.documentElement.lang===${JSON.stringify(language)}`), `notch ${language} labels`);
      await tightPanel(`Empty ${language} panel`);
    }
    await until(() => notchPage.evaluate("document.body.dataset.mode==='hidden'"), 'manual expanded panel auto hides', 20000);
    await until(() => browser.evaluate("!smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html').isFocused()"), 'manual close releases native keyboard focus');
    const automaticNotificationContext = async () => {
      const [native, renderer] = await Promise.all([
        browser.evaluate("(()=>{const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html');return{mainVisible:smokeMain.isVisible(),mainFocused:smokeMain.isFocused(),mainMinimized:smokeMain.isMinimized(),notchVisible:w.isVisible(),notchFocused:w.isFocused(),events:notchTrace.slice(-12)}})()"),
        notchPage.evaluate("({mode:document.body.dataset.mode,documentHidden:document.hidden,inputs:smokeInputs.slice(-20)})"),
      ]);
      return { native, renderer };
    };
    const beforeAutomaticNotification = await automaticNotificationContext();
    assert(!beforeAutomaticNotification.native.mainVisible && !beforeAutomaticNotification.native.mainFocused,
      `Main window was revealed during the manual-panel auto-hide check: ${JSON.stringify(beforeAutomaticNotification)}`);
    await peer.sendMessage('<img src=x onerror=alert(1)> hello from LAN', appState.me.id);
    await until(async () => (await selected())?.body.includes('hello from LAN'), 'message in notch');
    // The main-process state IPC can resolve before its renderer publication.
    const automaticCard = await until(() => notchPage.evaluate("document.getElementById('body').textContent.includes('hello from LAN')&&({mode:document.body.dataset.mode})"), 'ordinary message rendered');
    const automaticMode = automaticCard.mode;
    assert.equal(automaticMode, 'compact', `Ordinary notification did not enter compact mode: ${automaticMode === 'compact' ? '' : JSON.stringify(await automaticNotificationContext())}`);
    await until(() => notchPage.evaluate('innerHeight<=70 && innerWidth<=302'), 'small compact notification');
    const focusState = await browser.evaluate("({visible:smokeMain.isVisible(),main:smokeMain.isFocused(),notch:smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html').isFocused()})");
    assert.deepEqual(focusState, { visible:false,main:false,notch:false }, `Notification stole native window focus: ${JSON.stringify(focusState)}`);
    assert.equal(await notchPage.evaluate('!!window.lumilan || !!window.require || !!window.process'), false, 'Companion exposed main bridge or Node');
    const microphone = await notchPage.evaluate("navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop()); return 'granted'},e=>e.name)");
    assert.equal(microphone, 'NotAllowedError', 'Companion was allowed to acquire the microphone');
    assert.equal(await browser.evaluate("smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html').webContents.session===smokeMain.webContents.session"), false, 'Companion shared the main session');
    assert.equal(await notchPage.evaluate('document.querySelectorAll("#body img").length'), 0, 'Untrusted message was parsed as HTML');
    const signature = await notchPage.evaluate('window.lumi.state().then(s=>s.selected.key)');
    await until(() => notchPage.evaluate("document.body.dataset.mode==='hidden'"), 'automatic message preview auto hides', 20000);
    assert.equal((await selected()).key, signature, 'Auto-hide discarded unread notification');
    assert((await appPage.evaluate('window.lumilan.state()')).unread[peer.id] > 0, 'Auto-hide marked the message read');
    await assert.rejects(notchPage.evaluate("window.lumi.action({type:'eval',path:'C:/secret'})"));
    await assert.rejects(notchPage.evaluate("window.lumi.action({type:'open',key:'message:unknown'})"));
    await appPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:false,silent:true,background:true,notch:true})");
    assert(!JSON.stringify(await selected()).includes('hello from LAN'), 'Privacy did not redact an existing card');
    await until(() => notchPage.evaluate("!document.body.textContent.includes('Alice LAN') && !document.getElementById('preview').textContent.includes('hello from LAN')"), 'compact and queued UI redacted');
    await appPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:true})");
    await peer.sendMessage('Halo, ada pesan baru untuk Anda.', appState.me.id);
    await until(async () => (await selected())?.count === 2, 'grouped messages');
    const compactShot = await notchPage.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(dist, 'ui-notch-compact.png'), Buffer.from(compactShot.data, 'base64'));
    await third.sendMessage('Unread from a different conversation', appState.me.id);
    await until(() => appPage.evaluate(`window.lumilan.state().then(s=>s.unread[${JSON.stringify(third.id)}]>0)`), 'other conversation unread');
    // Exercise the actual renderer selection while hidden, including its delayed IPC acknowledgement.
    await browser.evaluate(`smokeMain.webContents.send('lumilan:open-thread',${JSON.stringify(third.id)})`);
    await until(() => appPage.evaluate(`document.getElementById('message-input').placeholder.includes('Citra LAN')`), 'hidden conversation selected');
    assert((await appPage.evaluate('window.lumilan.state()')).unread[third.id] > 0, 'A hidden conversation was marked read');
    await notchPage.evaluate(`window.lumi.action({type:'select',key:${JSON.stringify(signature)}})`);
    await click('mascot');
    await tightPanel('Message panel');
    const shot = await notchPage.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(dist, 'ui-notch-message.png'), Buffer.from(shot.data, 'base64'));
    const layout = await notchPage.evaluate(`(()=>{const b=document.getElementById('actions').getBoundingClientRect(); const f=document.getElementById('pause').getBoundingClientRect(); return {right:b.right,width:innerWidth,bottom:f.bottom,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    assert(layout.right <= layout.width && layout.bottom <= layout.height && !layout.overflow, `Clipped controls: ${JSON.stringify(layout)}`);
    await click('open'); await until(() => browser.evaluate('smokeMain.isVisible()'), 'open conversation');
    await until(() => notchPage.evaluate('window.lumi.state().then(s=>!s.items.some(i=>i.key===' + JSON.stringify(signature) + '))'), 'read message dismissed');
    assert((await appPage.evaluate('window.lumilan.state()')).unread[third.id] > 0, 'Opening one conversation marked a different hidden conversation as read');
    console.log('Notch: message, no focus theft, privacy, inert HTML, restricted bridge, open/read passed');

    await background();
    const source = join(profile, 'sample.bin'); writeFileSync(source, Buffer.alloc(512 * 1024, 42));
    let sending = peer.sendFilePath(source, appState.me.id); sending.catch(() => {});
    const offer = await until(async () => { const s = await selected(); return s?.kind === 'file' && s.actionable && s; }, 'file offer');
    await tightPanel('File consent panel');
    const fileShot = await notchPage.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(dist, 'ui-notch-file.png'), Buffer.from(fileShot.data, 'base64'));
    await notchPage.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:-20, y:-20 });
    await until(() => notchPage.evaluate("document.body.dataset.mode==='hidden'"), 'automatic consent preview auto hides', 25000);
    assert.equal((await selected()).key, offer.key);
    assert.equal((await selected()).actionable, true, 'Auto-hide decided the file request');
    assert((await appPage.evaluate('window.lumilan.fileOffers()')).some(i=>i.id===offer.key.slice('file:'.length)), 'Pending request disappeared from main app');
    await notchPage.evaluate("window.lumi.action({type:'expand'})");
    await tightPanel('Reopened file consent panel');
    await click('decline'); await assert.rejects(sending, /menolak/);
    await assert.rejects(notchPage.evaluate(`window.lumi.action({type:'accept',key:${JSON.stringify(offer.key)}})`));
    sending = peer.sendFilePath(source, appState.me.id); sending.catch(() => {});
    const failedOffer = await until(async () => { const s = await selected(); return s?.kind === 'file' && s.actionable && s; }, 'file for setup failure');
    const collision = join(profile, 'lumilan', 'files', `.upload-${failedOffer.key.slice('file:'.length)}.part`);
    writeFileSync(collision, 'existing file must stay intact');
    await click('accept'); await assert.rejects(sending, /EEXIST/);
    await until(() => notchPage.evaluate(`window.lumi.state().then(s=>!s.items.some(i=>i.key===${JSON.stringify(failedOffer.key)}))`), 'failed accepted file removed');
    assert.equal((await appPage.evaluate('window.lumilan.fileOffers()')).length, 0, 'Failed setup left a main-window transfer active');
    assert.equal(readFileSync(collision, 'utf8'), 'existing file must stay intact');
    rmSync(collision);
    // Hold the first chunk so cross-window consent must update at exactly 0%.
    const chunkGate = Promise.withResolvers(), sendTo = peer.sendTo.bind(peer), consentController = new AbortController();
    let chunkWaiting = false;
    const staleConsent = [], consentObjectGroup = 'file-consent-callbacks';
    peer.sendTo = async (target, packet, options) => {
      if (packet.type === 'file-chunk') { chunkWaiting = true; await chunkGate.promise; }
      return sendTo(target, packet, options);
    };
    try {
      sending = peer.sendFilePath(source, appState.me.id, { signal: consentController.signal }); sending.catch(() => {});
      const acceptedOffer = await until(async () => { const s = await selected(); return s?.kind === 'file' && s.actionable && s; }, 'second file offer');
      await browser.evaluate(`smokeMain.webContents.send('lumilan:open-thread',${JSON.stringify(peer.id)})`);
      await until(() => appPage.evaluate("document.querySelector('.incoming-transfer .incoming-transfer-actions')?.children.length===2"), 'main chat file consent buttons');
      // Retain actual renderer callbacks before Lumi replaces their consent row.
      for (const [label, index] of [['Accept', 1], ['Decline', 0]]) {
        const button = await appPage.send('Runtime.evaluate', {
          expression: `document.querySelectorAll('.incoming-transfer .incoming-transfer-actions button')[${index}]`,
          objectGroup: consentObjectGroup,
        });
        assert(!button.exceptionDetails && button.result.objectId, `Missing ${label} consent button`);
        const { listeners } = await appPage.send('DOMDebugger.getEventListeners', { objectId: button.result.objectId });
        const objectId = listeners.find(listener => listener.type === 'click')?.handler?.objectId;
        assert(objectId, `${label} consent button has no click callback`);
        staleConsent.push({ label, objectId });
      }
      await click('accept');
      await until(() => chunkWaiting, 'first chunk held after acceptance');
      const active = (await appPage.evaluate('window.lumilan.fileOffers()')).find(item => item.id === acceptedOffer.key.slice('file:'.length));
      assert(active?.status === 'receiving' && active.received === 0, 'Transfer was not held at 0%');
      await until(() => appPage.evaluate("!!document.querySelector('.incoming-transfer progress') && !document.querySelector('.incoming-transfer .incoming-transfer-actions')"), 'Lumi acceptance removes main consent buttons at 0%');
      for (const { label, objectId } of staleConsent) {
        const result = await appPage.send('Runtime.callFunctionOn', {
          objectId, functionDeclaration: 'function(){return this();}', awaitPromise: true, returnByValue: true,
        });
        assert(!result.exceptionDetails, `Stale ${label} callback failed: ${JSON.stringify(result.exceptionDetails)}`);
        assert(await appPage.evaluate("!!document.querySelector('.incoming-transfer progress') && !document.querySelector('.incoming-transfer .incoming-transfer-actions')"),
          `Stale ${label} callback removed the receiving row or restored consent buttons`);
      }
      console.log('Main consent: stale Accept/Decline callbacks preserve the active 0% transfer');
      await assert.rejects(appPage.evaluate(`window.lumilan.decideFile(${JSON.stringify(active.id)},false)`), /tidak tersedia/);
      await assert.rejects(notchPage.evaluate(`window.lumi.action({type:'accept',key:${JSON.stringify(acceptedOffer.key)}})`));
    } catch (error) {
      consentController.abort(error); throw error;
    } finally {
      chunkGate.resolve(); peer.sendTo = sendTo;
      const released = await Promise.allSettled([appPage.send('Runtime.releaseObjectGroup', { objectGroup: consentObjectGroup })]);
      await sending.catch(error => { if (!consentController.signal.aborted) throw error; });
      for (const result of released) assert.equal(result.status, 'fulfilled', `Consent callback cleanup failed: ${result.reason?.message}`);
    }
    const files = await appPage.evaluate(`window.lumilan.listFiles(${JSON.stringify(peer.id)},0)`);
    assert(files.items?.some(f => f.name === 'sample.bin') || files.some?.(f => f.name === 'sample.bin'), JSON.stringify(files));
    const controller = new AbortController(); sending = peer.sendFilePath(source, appState.me.id, { signal: controller.signal }); sending.catch(() => {});
    const canceled = await until(async () => { const s = await selected(); return s?.kind === 'file' && s.actionable && s; }, 'cancel offer');
    controller.abort(new Error('Smoke cancellation')); await assert.rejects(sending);
    await until(() => notchPage.evaluate(`window.lumi.state().then(s=>!s.items.some(i=>i.key===${JSON.stringify(canceled.key)}))`), 'canceled offer removed');
    console.log('Notch: real file decline, accept at 0%, cross-window duplicate consent, setup failure, verified attachment, cancellation, stale action passed');

    const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fingerprint:sha-256 AA\r\n';
    let id = randomUUID(); await peer.sendCall({ action: 'offer', id, peerId: appState.me.id, sdp });
    await until(async () => (await selected())?.kind === 'call', 'incoming call');
    await assert.rejects(third.sendCall({ action:'offer', id:randomUUID(), peerId:appState.me.id, sdp }), /panggilan lain/);
    assert.equal((await selected()).key, `call:${id}`, 'A third caller replaced the incoming call');
    await tightPanel('Call consent panel');
    const callShot = await notchPage.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(dist, 'ui-notch-call.png'), Buffer.from(callShot.data, 'base64'));
    await click('decline'); await until(() => !peer.activeCall, 'call declined');
    await assert.rejects(notchPage.evaluate(`window.lumi.action({type:'accept',key:'call:${id}'})`));
    id = randomUUID(); await peer.sendCall({ action: 'offer', id, peerId: appState.me.id, sdp });
    await until(async () => (await selected())?.kind === 'call', 'call for cancellation');
    await peer.sendCall({ action: 'end', id, peerId: appState.me.id });
    await until(() => notchPage.evaluate(`window.lumi.state().then(s=>!s.items.some(i=>i.key==='call:${id}'))`), 'caller canceled');

    await appPage.evaluate("globalThis.savedGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('No microphone','NotFoundError')}");
    id = randomUUID(); await peer.sendCall({ action: 'offer', id, peerId: appState.me.id, sdp });
    await until(async () => (await selected())?.kind === 'call', 'device error call');
    await click('accept');
    await until(() => appPage.evaluate("document.querySelector('#call-issue').textContent.includes('Mikrofon tidak terdeteksi')"), 'microphone error clearly displayed');
    await until(() => !peer.activeCall, 'device error ended call');
    await appPage.evaluate('navigator.mediaDevices.getUserMedia=savedGetUserMedia');

    // A real browser SDP/track on the other side, relayed through the real LAN peer.
    const offerSdp = await appPage.evaluate(`(async()=>{globalThis.fixtureStream=await navigator.mediaDevices.getUserMedia({audio:true}); globalThis.fixturePc=new RTCPeerConnection({iceServers:[]}); fixtureStream.getTracks().forEach(t=>fixturePc.addTrack(t,fixtureStream)); await fixturePc.setLocalDescription(await fixturePc.createOffer()); await new Promise(r=>{if(fixturePc.iceGatheringState==='complete')r();else fixturePc.addEventListener('icegatheringstatechange',()=>{if(fixturePc.iceGatheringState==='complete')r()})});return fixturePc.localDescription.sdp})()`);
    let answer; peer.on('call', signal => { if (signal.type === 'answer') answer = signal; });
    await background(); id = randomUUID(); await peer.sendCall({ action: 'offer', id, peerId: appState.me.id, sdp: offerSdp });
    await until(async () => (await selected())?.kind === 'call', 'real audio call');
    await click('accept'); await until(() => answer, 'real audio answer');
    await appPage.evaluate(`fixturePc.setRemoteDescription({type:'answer',sdp:${JSON.stringify(answer.sdp)}})`);
    await until(() => appPage.evaluate("document.querySelector('#call-status').textContent==='Panggilan suara berlangsung'"), 'WebRTC connected', 20000);
    await peer.sendCall({ action: 'end', id, peerId: appState.me.id });
    await appPage.evaluate('fixturePc.close(); fixtureStream.getTracks().forEach(t=>t.stop())');
    console.log('Notch: call decline, caller cancellation, clear microphone failure, real WebRTC acceptance passed');

    // Reminder scheduling and consent use the production bridge, UI and encrypted LAN protocol.
    await browser.evaluate('smokeMain.show();smokeMain.focus()');
    await appPage.evaluate("document.getElementById('reminders-button').click();document.getElementById('reminder-new').click()");
    await appPage.evaluate("document.getElementById('reminder-title').value='<b>Personal reminder</b>';document.getElementById('reminder-note').value='Private note';document.getElementById('reminder-form').requestSubmit()");
    const local = await until(() => appPage.evaluate("window.lumilan.reminders().then(rs=>rs.find(r=>r.title==='<b>Personal reminder</b>'))"), 'personal reminder saved from UI');
    assert.equal(await appPage.evaluate("document.querySelectorAll('#reminder-list strong b').length"),0,'Reminder title parsed as HTML');
    await appPage.evaluate(`document.querySelector('[data-reminder-id="${local.id}"] [data-action="edit"]').click();document.getElementById('reminder-title').value='Edited locally';document.getElementById('reminder-form').requestSubmit()`);
    await until(() => appPage.evaluate(`window.lumilan.reminders().then(rs=>rs.find(r=>r.id==='${local.id}')?.title==='Edited locally')`),'edit saved');
    const recipientState = await appPage.evaluate('window.lumilan.state()');
    const recipientFixture = { ...recipientState, contacts: [
      ...Array.from({length:15},(_,i)=>({id:`historical-fixture-${i}`,name:i%2?'Budi':'Andi',reminders:false})),
      {id:peer.id,name:'Nama sama',reminders:true},{id:third.id,name:'Nama sama',reminders:true},
      {id:peer.id,name:'Nama sama',reminders:true},
    ], peers:recipientState.peers.filter(p=>p.id!==third.id) };
    await browser.evaluate(`smokeMain.webContents.send('lumilan:state',${JSON.stringify(recipientFixture)})`);
    await appPage.evaluate("document.getElementById('reminder-new').click()");
    const recipientOptions = await appPage.evaluate("[...document.getElementById('reminder-recipient').options].map(o=>({id:o.value,label:o.textContent,disabled:o.disabled}))");
    assert.equal(recipientOptions.length,2,'Offline or historical contacts cluttered reminder recipients');
    assert.deepEqual(new Set(recipientOptions.map(o=>o.id)),new Set([appState.me.id,peer.id]),'Offline capable recipient was shown');
    assert(recipientOptions.every(o=>!o.disabled),'Unsupported recipients were left as disabled options');
    const onlineFixture={...recipientFixture,peers:recipientState.peers};
    await browser.evaluate(`smokeMain.webContents.send('lumilan:state',${JSON.stringify(onlineFixture)})`);
    await until(()=>appPage.evaluate(`document.getElementById('reminder-recipient').querySelector('option[value="${third.id}"]')!==null`),'online capable recipient returns');
    const onlineOptions=await appPage.evaluate("[...document.getElementById('reminder-recipient').options].map(o=>({id:o.value,label:o.textContent}))");
    assert.equal(onlineOptions.length,3,'Same-name online devices were merged');
    assert.equal(new Set(onlineOptions.map(o=>o.label)).size,3,'Same-name online choices were ambiguous');
    await appPage.evaluate(`document.getElementById('reminder-recipient').value=${JSON.stringify(third.id)}`);
    await browser.evaluate(`smokeMain.webContents.send('lumilan:state',${JSON.stringify(recipientFixture)})`);
    await until(()=>appPage.evaluate("document.getElementById('reminder-recipient').value===''") ,'disconnected selection becomes unavailable');
    assert.equal(await appPage.evaluate(`document.getElementById('reminder-recipient').querySelector('option[value="${third.id}"]')`),null,'Offline name retained in picker');
    await browser.evaluate(`smokeMain.webContents.send('lumilan:state',${JSON.stringify(onlineFixture)})`);
    await appPage.evaluate(`document.getElementById('reminder-recipient').value=${JSON.stringify(third.id)}`);
    const unsupportedFixture={...onlineFixture,contacts:onlineFixture.contacts.map(p=>p.id===third.id?{...p,reminders:false}:p)};
    await browser.evaluate(`smokeMain.webContents.send('lumilan:state',${JSON.stringify(unsupportedFixture)})`);
    await until(()=>appPage.evaluate("document.getElementById('reminder-recipient').selectedOptions[0]?.disabled"),'selected recipient loses capability');
    assert.equal(await appPage.evaluate("document.getElementById('reminder-recipient').value"),'','Recipient capability change silently switched target to self');
    const beforeRejectedRecipient=await appPage.evaluate('window.lumilan.reminders().then(rs=>rs.length)');
    await appPage.evaluate("document.getElementById('reminder-title').value='Unsupported recipient must not save';document.getElementById('reminder-form').requestSubmit()");
    await until(()=>appPage.evaluate("!document.getElementById('reminder-error').hidden"),'incompatible selected recipient explains failure');
    assert.equal(await appPage.evaluate('window.lumilan.reminders().then(rs=>rs.length)'),beforeRejectedRecipient,'Invalid recipient created a different reminder');
    await browser.evaluate(`smokeMain.webContents.send('lumilan:state',${JSON.stringify(recipientState)})`);
    const { translate } = await import('../public/i18n.js');
    for(const [theme,language] of [['light','en'],['dark','es'],['light','ja'],['dark','id']]){
      await appPage.send('Emulation.setDeviceMetricsOverride',{width:360,height:760,deviceScaleFactor:1,mobile:false});
      await appPage.evaluate(`document.getElementById('reminder-new').click();document.getElementById('reminder-title').value='Keep this draft';document.documentElement.dataset.theme='${theme}';document.getElementById('language-select').value='${language}';document.getElementById('language-select').dispatchEvent(new Event('change'))`);
      await until(()=>appPage.evaluate(`document.documentElement.lang==='${language}'`),`reminder ${language} language ready`);
      assert.equal(await appPage.evaluate("document.getElementById('reminder-form-title').textContent"),translate(language,'Buat pengingat'),'Reminder form retained previous language');
      assert.equal(await appPage.evaluate("document.getElementById('reminder-title').value"),'Keep this draft','Language change erased reminder draft');
      await appPage.evaluate("document.getElementById('reminder-new').click()");
      const layout=await appPage.evaluate("(()=>{const d=document.getElementById('reminders-dialog'),s=document.getElementById('reminder-recipient'),c=getComputedStyle(s),f=document.getElementById('reminder-filters');return {overflow:d.scrollWidth>d.clientWidth,selectOverflow:s.getBoundingClientRect().right>d.getBoundingClientRect().right,appearance:c.appearance,padding:parseFloat(c.paddingRight),filterBorder:parseFloat(getComputedStyle(f).borderBottomWidth),tabs:[...f.children].map(b=>{const r=b.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(b);const text=range.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,textLeft:text.left,textRight:text.right,height:r.height}})}})()");
      assert(!layout.overflow&&!layout.selectOverflow&&layout.appearance==='none'&&layout.padding>=40,`Reminder form layout ${theme}/${language}: ${JSON.stringify(layout)}`);
      assert.equal(layout.filterBorder,0,'Reminder filters inherited sidebar separator');
      for(const tab of layout.tabs) assert(tab.height>=36&&tab.textLeft>=tab.left+6&&tab.textRight<=tab.right-6,`Reminder label does not fit ${theme}/${language}: ${JSON.stringify(tab)}`);
      for(let i=0;i<layout.tabs.length;i++)for(let j=i+1;j<layout.tabs.length;j++){const a=layout.tabs[i],b=layout.tabs[j];assert(!(a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom),'Reminder filter buttons overlap');}
      const image=await appPage.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(dist,`ui-reminders-${theme}-${language}.png`),Buffer.from(image.data,'base64'));
      await appPage.evaluate("document.getElementById('reminder-form-cancel').click()");
    }
    await appPage.send('Emulation.clearDeviceMetricsOverride');
    await appPage.evaluate("document.getElementById('reminder-new').click()");
    const desktopReminder=await appPage.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(dist,'ui-reminders-desktop.png'),Buffer.from(desktopReminder.data,'base64'));
    await appPage.evaluate("document.getElementById('reminders-close').click()");
    const note=await appPage.evaluate("window.lumilan.note('Reminder source').then(r=>r.message)");
    const sourceReminder=await appPage.evaluate(`window.lumilan.createReminder({title:'Source reminder',dueAt:Date.now()+3600000,sourceThread:'notes',sourceId:${JSON.stringify(note.id)}}).then(rs=>rs.find(r=>r.title==='Source reminder'))`);
    await appPage.evaluate("document.getElementById('reminders-button').click()");
    await until(()=>appPage.evaluate(`!!document.querySelector('[data-reminder-id="${sourceReminder.id}"] [data-action="source"]')`),'source card rendered');
    await appPage.evaluate(`document.querySelector('[data-reminder-id="${sourceReminder.id}"] [data-action="source"]').click()`);
    await until(()=>appPage.evaluate(`!document.getElementById('reminders-dialog').open && !!document.getElementById('message-${note.id}')`),'source message opened');
    await appPage.evaluate(`window.lumilan.deleteMessages('notes',[${JSON.stringify(note.id)}])`);
    await assert.rejects(appPage.evaluate(`window.lumilan.reminderSource('${sourceReminder.id}')`));
    await appPage.evaluate(`window.lumilan.changeReminder('${sourceReminder.id}','cancel')`);
    await background();
    peer.reminders.create({title:'Consent reminder',note:'Choose your own time',to:appState.me.id,dueAt:Date.now()+3600000});
    const request=peer.state.reminders.at(-1);
    await until(async()=>{const s=await selected();return s?.kind==='reminder'&&s.body==='Consent reminder';},'reminder request in Lumi');
    assert.equal((await selected()).actionable,false,'Lumi reminder accepted without schedule choice');
    const requestKey=(await selected()).key;
    await appPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:false,silent:true,background:true,notch:true})");
    assert(!JSON.stringify(await selected()).includes('Consent reminder'),'Queued reminder leaked after privacy change');
    await appPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:true})");
    await notchPage.evaluate(`window.lumi.action({type:'open',key:${JSON.stringify(requestKey)}})`);
    await until(()=>appPage.evaluate("document.getElementById('reminders-dialog').open"),'Lumi opens reminder center');
    await appPage.evaluate("document.querySelector('#reminder-filters [data-view=requests]').click()");
    await appPage.evaluate(`globalThis.consentInput=document.querySelector('[data-reminder-id="${request.id}"] input');consentInput.focus()`);
    const ordinary=await peer.sendMessage('Ordinary chat must preserve reminder input',appState.me.id);
    await until(()=>appPage.evaluate(`window.lumilan.state().then(s=>s.messages.some(m=>m.id===${JSON.stringify(ordinary.message.id)}))`),'ordinary snapshot while editing consent');
    assert(await appPage.evaluate(`consentInput===document.querySelector('[data-reminder-id="${request.id}"] input')`),'Unrelated chat replaced the consent form');
    await appPage.evaluate(`document.querySelector('[data-reminder-id="${request.id}"] form').requestSubmit()`);
    await until(()=>peer.state.reminders.find(r=>r.id===request.id)?.status==='accepted','recipient acceptance synchronizes');
    await assert.rejects(appPage.evaluate(`window.lumilan.changeReminder('${request.id}','accept',{dueAt:Date.now()+3600000})`));
    await until(()=>notchPage.evaluate(`window.lumi.state().then(s=>!s.items.some(i=>i.key===${JSON.stringify(requestKey)}))`),'answered reminder removed from Lumi');
    await appPage.evaluate("document.getElementById('reminders-close').click()");
    await background();
    await appPage.evaluate(`window.lumilan.changeReminder('${local.id}','snooze',{dueAt:Date.now()+500})`);
    await until(async()=>{const s=await selected();return s?.kind==='reminder'&&s.status==='due';},'scheduled reminder fires while in tray');
    await notchPage.evaluate("window.lumi.action({type:'open',key:'reminder:due'})");
    await until(()=>appPage.evaluate("document.getElementById('reminders-dialog').open"),'due reminder opens center');
    await appPage.evaluate("document.querySelector('#reminder-filters [data-view=active]').click()");
    await appPage.evaluate(`document.querySelector('[data-reminder-id="${local.id}"] [data-action="snooze"]').click()`);
    await until(()=>appPage.evaluate(`window.lumilan.reminders().then(rs=>rs.find(r=>r.id==='${local.id}')?.status==='scheduled')`),'snoozed from UI');
    await appPage.evaluate(`document.querySelector('[data-reminder-id="${local.id}"] [data-action="done"]').click()`);
    await until(()=>appPage.evaluate(`window.lumilan.reminders().then(rs=>rs.find(r=>r.id==='${local.id}')?.status==='done')`),'completed from UI');
    await appPage.evaluate("document.querySelector('#reminder-filters [data-view=history]').click()");
    await appPage.evaluate(`document.querySelector('[data-reminder-id="${local.id}"] [data-action="delete"]').click()`);
    await until(()=>appPage.evaluate(`window.lumilan.reminders().then(rs=>!rs.some(r=>r.id==='${local.id}'))`),'history deleted from UI');
    await appPage.evaluate("document.getElementById('reminders-close').click()");
    console.log('Reminders: personal create/edit/source/deleted-source, light/dark narrow multilingual forms, recipient consent, privacy, tray deadline, snooze/done/delete and stale consent passed');

    await background();
    const recovery = await appPage.evaluate("window.lumilan.createReminder({title:'Locked deadline recovery',dueAt:Date.now()+3600000}).then(rs=>rs.find(r=>r.title==='Locked deadline recovery'))");
    const deferredCanceled = await appPage.evaluate("window.lumilan.createReminder({title:'Canceled while locked',dueAt:Date.now()+3600000}).then(rs=>rs.find(r=>r.title==='Canceled while locked'))");
    await appPage.evaluate("globalThis.recoveryAlerts=[];globalThis.stopRecoveryAlerts=window.lumilan.onReminder(e=>recoveryAlerts.push(e))");
    await setLocked(browser, true); await browser.evaluate("smokeElectron.powerMonitor.emit('suspend')");
    for (const r of [recovery, deferredCanceled]) await appPage.evaluate(`window.lumilan.changeReminder('${r.id}','snooze',{dueAt:Date.now()+500})`);
    await until(()=>appPage.evaluate(`window.lumilan.reminders().then(rs=>[${JSON.stringify(recovery.id)},${JSON.stringify(deferredCanceled.id)}].every(id=>rs.find(r=>r.id===id)?.status==='due'))`),'deadlines persist while locked');
    await appPage.evaluate(`window.lumilan.changeReminder('${deferredCanceled.id}','cancel')`);
    assert.equal(await appPage.evaluate('recoveryAlerts.length'),0,'Reminder alerted while blocked');
    await browser.evaluate("smokeElectron.powerMonitor.emit('resume')"); await delay(150);
    assert.equal(await notchPage.evaluate('document.visibilityState'),'hidden','Resume exposed a locked notch');
    assert.equal(await appPage.evaluate('recoveryAlerts.length'),0,'Resume alerted before screen unlock');
    await appPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:false,silent:true,background:true,notch:true})");
    await setLocked(browser, false);
    await until(()=>appPage.evaluate('recoveryAlerts.length===1'),'deferred reminder alerted after unlock');
    const recovered = await until(()=>notchPage.evaluate("window.lumi.state().then(s=>s.items.find(i=>i.key==='reminder:due'))"),'deferred due summary in Lumi');
    assert.equal(recovered.count,1,'Canceled deferred reminder was replayed');
    assert(!JSON.stringify(recovered).includes('Locked deadline recovery'),'Deferred reminder ignored changed privacy');
    await browser.evaluate("smokeElectron.powerMonitor.emit('unlock-screen');smokeElectron.powerMonitor.emit('resume')"); await delay(150);
    assert.equal(await appPage.evaluate('recoveryAlerts.length'),1,'Repeated resume duplicated deferred notice');
    await appPage.evaluate(`window.lumilan.changeReminder('${recovery.id}','done');stopRecoveryAlerts()`);
    await appPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:true})");
    console.log('Reminders: overlapping lock/suspend, deferred catch-up once, canceled-item pruning and current privacy passed');

    await background(); await peer.sendMessage('Idle measurement', appState.me.id);
    await until(async () => (await selected())?.kind === 'message', 'idle fixture');
    await notchPage.evaluate('window.lumi.action({type:"collapse"})'); await delay(2000);
    assert.equal(await notchPage.evaluate('document.getAnimations().filter(a=>a.playState==="running").length'), 0, 'Idle animations kept running');
    await notchPage.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await notchPage.evaluate('window.lumi.action({type:"expand"})');
    await hoverNotchHeader();
    assert.equal(await notchPage.evaluate('document.getAnimations().length'), 0, 'Reduced motion ignored');
    await notchPage.send('Emulation.setEmulatedMedia', { features: [] });
    // Earlier fixtures move toward the screen edge. A 20 px move can be clamped there;
    // the later auto-hide resize must never be mistaken for successful keyboard movement.
    await click('reset');
    await until(() => appPage.evaluate('window.lumilan.notificationSettings().then(s=>s.notchPosition?.fraction===.5)'), 'centered keyboard fixture');
    await notchPage.evaluate("document.getElementById('drag').focus()");
    const before = await browser.evaluate("smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html').getBounds()");
    await notchPage.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
    await notchPage.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
    await until(async () => {
      const bounds = await browser.evaluate("smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html').getBounds()");
      assert.equal(await notchPage.evaluate('document.body.dataset.mode'), 'expanded', 'Keyboard reposition collapsed the panel');
      return bounds.width === before.width && Math.abs(bounds.x - before.x - 20) <= 1;
    }, 'keyboard reposition by 20 px without resizing');
    await click('reset');
    await until(() => appPage.evaluate('window.lumilan.notificationSettings().then(s=>s.notchPosition?.fraction===.5)'), 'reset button restores center');
    await notchPage.evaluate('window.lumi.action({type:"collapse"})');
    await notchPage.send('Performance.enable');
    const nativeExpression = "(()=>{const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html');return smokeElectron.app.getAppMetrics().find(m=>m.pid===w.webContents.getOSProcessId())})()";
    await browser.evaluate(nativeExpression);
    const metricsBefore = await notchPage.send('Performance.getMetrics'); await delay(4000);
    const metricsAfter = await notchPage.send('Performance.getMetrics');
    const metric = (result, name) => result.metrics.find(m => m.name === name)?.value || 0;
    const busySeconds = metric(metricsAfter, 'TaskDuration') - metric(metricsBefore, 'TaskDuration');
    const heap = metric(metricsAfter, 'JSHeapUsedSize');
    assert(busySeconds < .4, `Companion busy while idle: ${busySeconds}s / 4s`);
    assert(heap < 32 * 1024 * 1024, `Companion JS heap too large: ${heap}`);
    console.log(`Notch idle renderer: ${(busySeconds / 4 * 100).toFixed(2)}% task time; ${(heap / 1024 / 1024).toFixed(2)} MiB JS heap; no running animation`);
    const nativeMetrics = await browser.evaluate(nativeExpression);
    assert(nativeMetrics && nativeMetrics.cpu.percentCPUUsage < 5, 'Native renderer CPU budget exceeded');
    const nativeMemory = process.platform === 'linux'
      ? await browser.evaluate("(()=>{const w=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html');const s=process.getBuiltinModule('fs').readFileSync('/proc/'+w.webContents.getOSProcessId()+'/status','utf8');return Number(s.match(/^VmRSS:\\s+(\\d+) kB/m)?.[1])})()")
      : nativeMetrics.memory?.workingSetSize;
    console.log(`Notch native process: ${nativeMetrics.cpu.percentCPUUsage.toFixed(2)}% CPU; ${Number.isFinite(nativeMemory) ? (nativeMemory / 1024).toFixed(1) + ' MiB ' + (process.platform === 'linux' ? 'RSS' : 'working set') : 'native memory unavailable'}`);
    await notchPage.evaluate("window.lumi.action({type:'peek'})");
    await click('mascot'); await click('pause');
    assert.equal(await notchPage.evaluate('document.visibilityState'), 'hidden', 'Pause did not hide window');
    await peer.sendMessage('Should stay paused', appState.me.id); await delay(200);
    assert.equal(await notchPage.evaluate('document.visibilityState'), 'hidden', 'Incoming message canceled pause');
    await appPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:false})");
    await until(() => browser.evaluate("!smokeElectron.BrowserWindow.getAllWindows().some(w=>w.webContents.getURL()==='lumilan://app/notch.html')"), 'disabled companion releases renderer');
    // Record routing without relying on OS permission/signing or sending test banners to the user's desktop.
    await browser.evaluate("globalThis.nativeAttempts=[]; globalThis.nativeShow=smokeElectron.Notification.prototype.show; smokeElectron.Notification.prototype.show=function(){nativeAttempts.push({title:this.title,body:this.body});this.emit('show')}");
    await peer.sendMessage('Background system fallback', appState.me.id);
    if (await browser.evaluate('smokeElectron.Notification.isSupported()')) {
      await until(() => browser.evaluate("nativeAttempts.some(n=>n.body==='Background system fallback')"), 'background native notification route');
      assert((await appPage.evaluate('window.lumilan.state()')).unread[peer.id] > 0, 'Background fallback marked the message read');
    }
    await browser.evaluate(`smokeMain.show(); smokeMain.focus(); smokeMain.webContents.send('lumilan:open-thread',${JSON.stringify(peer.id)})`);
    await until(() => browser.evaluate('smokeMain.isVisible() && smokeMain.isFocused()'), 'focused chat for notification routing');
    await until(() => appPage.evaluate("document.getElementById('message-input').placeholder.includes('Alice LAN')"), 'active conversation for notification routing');
    await appPage.evaluate(`window.lumilan.currentThread(${JSON.stringify(peer.id)})`);
    const attempts = await browser.evaluate('nativeAttempts.length');
    await peer.sendMessage('Already reading this conversation', appState.me.id);
    await until(() => appPage.evaluate("document.getElementById('messages').textContent.includes('Already reading this conversation')"), 'active chat message rendered');
    assert.equal(await browser.evaluate('nativeAttempts.length'), attempts, 'Focused active chat sent a redundant notification');
    assert.equal((await appPage.evaluate('window.lumilan.state()')).unread[peer.id] || 0, 0);
    await setLocked(browser, true); await browser.evaluate("smokeElectron.powerMonitor.emit('suspend')");
    await peer.sendMessage('First locked chat', appState.me.id);
    await peer.sendMessage('Latest locked private chat', appState.me.id);
    await until(() => appPage.evaluate(`window.lumilan.state().then(s=>s.unread[${JSON.stringify(peer.id)}]===2)`), 'locked focused chat stays unread');
    assert.equal(await browser.evaluate('nativeAttempts.length'), attempts, 'Locked chat showed a native notification');
    await setLocked(browser, false); await delay(150);
    assert.equal(await browser.evaluate('nativeAttempts.length'), attempts, 'Unlock bypassed suspend');
    await browser.evaluate('smokeMain.hide()');
    await assertMainMotionHidden();
    await appPage.evaluate('window.lumilan.setNotificationSettings({enabled:true,preview:false,silent:true,background:true,notch:false})');
    await browser.evaluate("smokeElectron.powerMonitor.emit('resume')");
    if (await browser.evaluate('smokeElectron.Notification.isSupported()')) {
      await until(() => browser.evaluate(`nativeAttempts.length===${attempts + 1}`), 'locked chats coalesced once after resume');
      assert.equal(await browser.evaluate('nativeAttempts.at(-1).body'), 'Pesan baru diterima', 'Deferred chat ignored current privacy');
      await browser.evaluate("smokeElectron.powerMonitor.emit('resume')"); await delay(150);
      assert.equal(await browser.evaluate('nativeAttempts.length'), attempts + 1, 'Resume repeated deferred chats');
    }
    await browser.evaluate('smokeElectron.Notification.prototype.show=nativeShow');
    console.log('Notifications: background system fallback routing and focused conversation suppression passed (OS banner delivery not asserted)');
    await browser.evaluate('smokeMain.show();smokeMain.focus()');
    await assertMainMotionVisible();
    if (process.env.LUMILAN_README_SCREENSHOTS === '1') {
      // Export real application pixels from this disposable, loopback-only demo.
      await browser.evaluate(`smokeMain.show();smokeMain.focus();smokeMain.webContents.send('lumilan:open-thread',${JSON.stringify(peer.id)})`);
      await appPage.evaluate(`(async()=>{const s=await window.lumilan.state();const ids=s.messages.filter(m=>!m.roomId&&!m.note&&((m.from===${JSON.stringify(peer.id)}&&m.to===s.me.id)||(m.to===${JSON.stringify(peer.id)}&&m.from===s.me.id))).map(m=>m.id);if(ids.length)await window.lumilan.deleteMessages(${JSON.stringify(peer.id)},ids);await window.lumilan.rename('Design Studio');document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('#language-select').value='en';document.querySelector('#language-select').dispatchEvent(new Event('change'));})()`);
      peer.rename('Design team');
      await until(()=>appPage.evaluate("document.getElementById('message-input').placeholder.includes('Design team')"),'demo peer name');
      await appPage.evaluate("document.getElementById('call-dismiss').click()");
      assert.match(await appPage.evaluate("document.getElementById('composer-key-hint').textContent"),/Enter to send/,'Composer hint did not follow the current language');
      await peer.sendMessage('Good morning! The design review is ready. Everything stays on our local network.',appState.me.id);
      await appPage.evaluate(`window.lumilan.message(${JSON.stringify('Perfect. Let’s review the updates together.\n\n1. Check the new layout\n2. Share feedback\n3. Plan our next steps')},${JSON.stringify(peer.id)})`);
      await peer.sendMessage('Sounds good. You can also send files or start a voice call here.',appState.me.id);
      await until(()=>appPage.evaluate("document.getElementById('messages').textContent.includes('Sounds good.')"),'demo conversation');
      await until(()=>appPage.evaluate("[...document.querySelectorAll('#messages .bubble')].every(e=>getComputedStyle(e).opacity==='1')"),'demo message animations completed');
      await appPage.send('Emulation.setDeviceMetricsOverride',{width:1100,height:760,deviceScaleFactor:1,mobile:false});
      for (const theme of ['light','dark']) {
        await appPage.evaluate(`document.documentElement.dataset.theme='${theme}';new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
        await waitUiAnimations();
        const shot=await appPage.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(dist,`readme-chat-${theme}.png`),Buffer.from(shot.data,'base64'));
      }
      await appPage.evaluate("document.getElementById('settings-button').click();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
      await waitUiAnimations();
      const shot=await appPage.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
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
    const presenceFailure = {};
    if (browser) { try { presenceFailure.native = await browser.evaluate("({visible:smokeMain.isVisible(),focused:smokeMain.isFocused(),minimized:smokeMain.isMinimized(),events:globalThis.smokePresenceNativeTrace?.slice(-20)})"); } catch {} }
    if (appPage) { try { presenceFailure.renderer = await appPage.evaluate("({documentFocused:document.hasFocus(),documentHidden:document.hidden,pageHidden:document.documentElement.dataset.pageHidden,active:{id:document.activeElement?.id,tag:document.activeElement?.tagName,peer:document.activeElement?.closest?.('.person[data-peer]')?.dataset.peer},trace:globalThis.smokePresenceTrace?.slice(-40)})"); } catch {} }
    if (presenceFailure.native?.events?.length || presenceFailure.renderer?.trace?.length) {
      console.error('Main presence events on failure', presenceFailure);
      try { writeFileSync(join(dist, 'ui-polish-presence-failure.json'), JSON.stringify(presenceFailure, null, 2)); }
      catch (diagnosticError) { console.error('Could not save presence diagnostics:', diagnosticError.code); }
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
