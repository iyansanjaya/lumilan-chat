// Real packaged Electron UI + a real encrypted LAN peer. Isolated profiles only, no production test IPC.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { randomUUID } = require('node:crypto');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    const number = ++id; const timer = setTimeout(() => { pending.delete(number); reject(new Error(`${method} timed out: ${(params.expression || '').slice(0, 160)}`)); }, 15000);
    pending.set(number, { resolve, reject, timer }); socket.send(JSON.stringify({ id: number, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  if (page) { await send('Runtime.enable'); await send('Log.enable'); }
  return { send, evaluate, close: () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Debugger closed')); } socket.close(); } };
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
  const child = spawn(executable, [`--remote-debugging-port=${port}`, `--inspect=127.0.0.1:${inspectorPort}`, `--user-data-dir=${profile}`, '--lumilan-ui-smoke', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], {
    cwd: root, windowsHide: true, env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile, ELECTRON_ENABLE_LOGGING: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
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
    await browser.evaluate(`globalThis.smokeElectron=process.getBuiltinModule('module').createRequire(${JSON.stringify(join(root,'package.json'))})('electron'); globalThis.smokeMain=smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/index.html')`);
    await until(() => appPage.evaluate("!!window.lumilan && document.readyState==='complete' && !document.querySelector('#join-screen').hidden"), 'renderer ready');
    await appPage.evaluate("document.querySelector('#join-name').value='Notch Smoke'; document.querySelector('#join-form').requestSubmit()");
    await until(() => appPage.evaluate("!document.querySelector('#app').hidden"), 'chat loaded');
    console.log('Notch smoke: main renderer ready');
    await appPage.evaluate("document.querySelector('#language-select').value='id'; document.querySelector('#language-select').dispatchEvent(new Event('change'))");
    await until(() => appPage.evaluate("window.lumilan.notificationSettings().then(s=>s.language==='id')"), 'Indonesian language');
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
    const background = async () => {
      await browser.evaluate('smokeMain.close()');
      await until(() => browser.evaluate('!smokeMain.isVisible() && !smokeMain.isFocused()'), 'window hidden to tray and native focus released');
    };
    const click = async id => {
      await until(() => notchPage.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&!e.disabled})()`), `visible ${id}`);
      // Native resize and renderer layout arrive separately; fractional Windows DPI can round DIP bounds by 1 px.
      await until(async () => {
        const bounds = await browser.evaluate("smokeElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='lumilan://app/notch.html').getBounds()");
        return notchPage.evaluate(`Math.abs(innerHeight-${bounds.height})<=2 && Math.abs(innerWidth-${bounds.width})<=2`);
      }, 'notch layout after resize');
      const point = await notchPage.evaluate(`(()=>{const b=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
      await notchPage.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
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
    await peer.sendMessage('<img src=x onerror=alert(1)> hello from LAN', appState.me.id);
    await until(async () => (await selected())?.body.includes('hello from LAN'), 'message in notch');
    assert.equal(await notchPage.evaluate('document.body.dataset.mode'), 'compact', 'Ordinary notification expanded automatically');
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
    peer.sendTo = async (target, packet) => {
      if (packet.type === 'file-chunk') { chunkWaiting = true; await chunkGate.promise; }
      return sendTo(target, packet);
    };
    try {
      sending = peer.sendFilePath(source, appState.me.id, { signal: consentController.signal }); sending.catch(() => {});
      const acceptedOffer = await until(async () => { const s = await selected(); return s?.kind === 'file' && s.actionable && s; }, 'second file offer');
      await browser.evaluate(`smokeMain.webContents.send('lumilan:open-thread',${JSON.stringify(peer.id)})`);
      await until(() => appPage.evaluate("document.querySelector('.incoming-transfer .incoming-transfer-actions')?.children.length===2"), 'main chat file consent buttons');
      await click('accept');
      await until(() => chunkWaiting, 'first chunk held after acceptance');
      const active = (await appPage.evaluate('window.lumilan.fileOffers()')).find(item => item.id === acceptedOffer.key.slice('file:'.length));
      assert(active?.status === 'receiving' && active.received === 0, 'Transfer was not held at 0%');
      await until(() => appPage.evaluate("!!document.querySelector('.incoming-transfer progress') && !document.querySelector('.incoming-transfer .incoming-transfer-actions')"), 'Lumi acceptance removes main consent buttons at 0%');
      await assert.rejects(appPage.evaluate(`window.lumilan.decideFile(${JSON.stringify(active.id)},false)`), /tidak tersedia/);
      await assert.rejects(notchPage.evaluate(`window.lumi.action({type:'accept',key:${JSON.stringify(acceptedOffer.key)}})`));
    } catch (error) {
      consentController.abort(error); throw error;
    } finally {
      chunkGate.resolve(); peer.sendTo = sendTo;
      await sending.catch(error => { if (!consentController.signal.aborted) throw error; });
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
    for(const [theme,language] of [['light','en'],['dark','es'],['light','ja'],['dark','id']]){
      await appPage.send('Emulation.setDeviceMetricsOverride',{width:360,height:760,deviceScaleFactor:1,mobile:false});
      await appPage.evaluate(`document.documentElement.dataset.theme='${theme}';document.getElementById('language-select').value='${language}';document.getElementById('language-select').dispatchEvent(new Event('change'));document.getElementById('reminder-new').click()`);
      const layout=await appPage.evaluate("(()=>{const d=document.getElementById('reminders-dialog'),s=document.getElementById('reminder-recipient'),c=getComputedStyle(s);return {overflow:d.scrollWidth>d.clientWidth,selectOverflow:s.getBoundingClientRect().right>d.getBoundingClientRect().right,appearance:c.appearance,padding:parseFloat(c.paddingRight)}})()");
      assert(!layout.overflow&&!layout.selectOverflow&&layout.appearance==='none'&&layout.padding>=40,`Reminder form layout ${theme}/${language}: ${JSON.stringify(layout)}`);
      const image=await appPage.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(dist,`ui-reminders-${theme}-${language}.png`),Buffer.from(image.data,'base64'));
      await appPage.evaluate("document.getElementById('reminder-form-cancel').click()");
    }
    await appPage.send('Emulation.clearDeviceMetricsOverride');
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
    await browser.evaluate("smokeElectron.powerMonitor.emit('lock-screen');smokeElectron.powerMonitor.emit('suspend')");
    for (const r of [recovery, deferredCanceled]) await appPage.evaluate(`window.lumilan.changeReminder('${r.id}','snooze',{dueAt:Date.now()+500})`);
    await until(()=>appPage.evaluate(`window.lumilan.reminders().then(rs=>[${JSON.stringify(recovery.id)},${JSON.stringify(deferredCanceled.id)}].every(id=>rs.find(r=>r.id===id)?.status==='due'))`),'deadlines persist while locked');
    await appPage.evaluate(`window.lumilan.changeReminder('${deferredCanceled.id}','cancel')`);
    assert.equal(await appPage.evaluate('recoveryAlerts.length'),0,'Reminder alerted while blocked');
    await browser.evaluate("smokeElectron.powerMonitor.emit('resume')"); await delay(150);
    assert.equal(await notchPage.evaluate('document.visibilityState'),'hidden','Resume exposed a locked notch');
    assert.equal(await appPage.evaluate('recoveryAlerts.length'),0,'Resume alerted before screen unlock');
    await appPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:false,silent:true,background:true,notch:true})");
    await browser.evaluate("smokeElectron.powerMonitor.emit('unlock-screen')");
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
    assert.equal(await notchPage.evaluate('document.getAnimations().length'), 0, 'Reduced motion ignored');
    await notchPage.send('Emulation.setEmulatedMedia', { features: [] });
    await notchPage.evaluate("document.getElementById('drag').focus()");
    const before = await notchPage.evaluate('screenX');
    await notchPage.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
    await until(() => notchPage.evaluate(`screenX>${before}`), 'keyboard reposition');
    await click('reset');
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
    console.log(`Notch native process: ${nativeMetrics.cpu.percentCPUUsage.toFixed(2)}% CPU; ${((nativeMetrics.memory?.workingSetSize || 0) / 1024).toFixed(1)} MiB working set`);
    await notchPage.evaluate("window.lumi.action({type:'peek'})");
    await click('mascot'); await click('pause');
    assert.equal(await notchPage.evaluate('document.visibilityState'), 'hidden', 'Pause did not hide window');
    await peer.sendMessage('Should stay paused', appState.me.id); await delay(200);
    assert.equal(await notchPage.evaluate('document.visibilityState'), 'hidden', 'Incoming message canceled pause');
    await appPage.evaluate("window.lumilan.setNotificationSettings({enabled:true,preview:true,silent:true,background:true,notch:false})");
    await until(() => browser.evaluate("!smokeElectron.BrowserWindow.getAllWindows().some(w=>w.webContents.getURL()==='lumilan://app/notch.html')"), 'disabled companion releases renderer');
    const unexpected = failures.filter(text => text !== 'Permissions policy violation: microphone is not allowed in this document.');
    assert.deepEqual(unexpected, [], `Renderer errors: ${unexpected.join('; ')}`);
    console.log('Notch: idle resource budget, reduced motion, keyboard position, reset, pause, lazy renderer and disable cleanup passed');
    await appPage.evaluate('setTimeout(()=>window.lumilan.quit(),100); true');
    browser.close(); browser = null;
    await until(() => child.exitCode !== null, 'explicit quit removes companion');
    console.log('Packaged notch smoke passed');
  } catch (error) {
    console.error('Notch smoke failure:', error);
    if (browser) { try { console.error('Native notch events', await browser.evaluate('notchTrace.slice(-16)')); } catch {} }
    if (notchPage) { try { console.error('Notch state on failure', await notchPage.evaluate('window.lumi.state().then(s=>({mode:s.mode,dom:document.body.dataset.mode,revision:s.revision,width:innerWidth,height:innerHeight,dpr:devicePixelRatio}))')); } catch {} }
    if (notchPage) { try { console.error('Notch input on failure', await notchPage.evaluate('smokeInputs')); } catch {} }
    console.error(logs); throw error;
  }
  finally {
    browser?.close(); appPage?.close(); notchPage?.close(); await peer?.stop(); await third?.stop();
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await until(() => child.exitCode !== null || child.signalCode !== null, 'process stopped', 15000); }
    assert.equal(dirname(profile), tempRoot); assert(basename(profile).startsWith('lumilan-notch-smoke-'));
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
