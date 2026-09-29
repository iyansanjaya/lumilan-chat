const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');

async function main() {
  const root = resolve(__dirname, '..');
  const dist = join(root, 'dist');
  const platform = process.platform;
  const directory = readdirSync(dist).find(name =>
    platform === 'darwin' ? /^mac(?:-|$)/.test(name) :
    platform === 'linux' ? /^linux.*-unpacked$/.test(name) : name === 'win-unpacked');
  assert(directory, `No packaged ${platform} application in dist`);
  const executable = platform === 'darwin'
    ? join(dist, directory, 'Lumilan Chat.app', 'Contents', 'MacOS', 'Lumilan Chat')
    : platform === 'linux' ? join(dist, directory, 'lumilan-chat')
      : join(dist, directory, 'Lumilan Chat.exe');

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const bounded = (promise, ms, message) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  const timeoutAt = Date.now() + 30_000;
  const server = createServer();
  server.listen(0, '127.0.0.1');
  const port = await new Promise(resolve => server.once('listening', () => resolve(server.address().port)));
  await new Promise(resolve => server.close(resolve));

  const tempRoot = realpathSync(tmpdir());
  const profile = mkdtempSync(join(tempRoot, 'lumilan-ui-smoke-'));
  const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--lumilan-ui-smoke'], {
    cwd: root,
    env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile, ELECTRON_ENABLE_LOGGING: '1' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let launchError;
  child.once('error', error => { launchError = error; });
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
  let socket;
  let passed = false;
  try {
    let page;
    while (Date.now() < timeoutAt) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Application exited with ${child.exitCode}: ${logs}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
        page = (await response.json()).find(item => item.type === 'page' && item.url === 'lumilan://app/index.html');
        if (page?.webSocketDebuggerUrl) break;
      } catch { /* DevTools is starting. */ }
      await delay(200);
    }
    assert(page?.webSocketDebuggerUrl, `Application page did not open: ${logs}`);
    console.log('Smoke: application page found');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await bounded(new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    }), 5000, 'DevTools WebSocket did not open');
    console.log('Smoke: DevTools connected');
    const pending = new Map();
    const failures = [];
    const requests = new Map();
    let sequence = 0;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') failures.push(message.params.exceptionDetails.text);
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') failures.push(message.params.entry.text);
      if (message.method === 'Network.requestWillBeSent') requests.set(message.params.requestId, message.params.request.url);
      if (message.method === 'Network.loadingFailed' && /\.js(?:$|\?)/.test(requests.get(message.params.requestId) || ''))
        failures.push(`${requests.get(message.params.requestId)}: ${message.params.errorText}`);
    });
    const send = (method, params = {}, timeout = 5000) => bounded(new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    }), timeout, `${method} timed out`);
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Network.enable');
    await send('Page.enable');
    let state;
    while (Date.now() < timeoutAt) {
      try {
        const result = await send('Runtime.evaluate', {
          expression: "({ ready: document.readyState, appVisible: !document.querySelector('#app')?.hidden, joinVisible: !document.querySelector('#join-screen')?.hidden })",
          returnByValue: true,
        });
        state = result.result.value;
        if (state?.appVisible || state?.joinVisible) break;
      } catch { /* The page is reloading. */ }
      await delay(200);
    }
    assert(state?.joinVisible, `Welcome screen did not render: ${JSON.stringify(state)}; ${failures.join('; ')}; ${logs}`);
    await send('Runtime.evaluate', {
      expression: "document.querySelector('#join-name').value = 'UI Smoke'; document.querySelector('#join-form').requestSubmit()",
    });
    while (Date.now() < timeoutAt) {
      const result = await send('Runtime.evaluate', {
        expression: "({ appVisible: !document.querySelector('#app')?.hidden, name: document.querySelector('#my-name')?.textContent })",
        returnByValue: true,
      });
      state = result.result.value;
      if (state?.appVisible) break;
      await delay(200);
    }
    assert(state?.appVisible && state.name === 'UI Smoke', `Chat screen did not render: ${JSON.stringify(state)}; ${failures.join('; ')}; ${logs}`);
    const chatScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-smoke-chat.png'), Buffer.from(chatScreenshot.data, 'base64'));
    await send('Runtime.evaluate', { expression: "document.querySelector('#settings-button').click()" });
    let settingsOpen = false;
    while (Date.now() < timeoutAt) {
      const result = await send('Runtime.evaluate', { expression: "document.querySelector('#settings-dialog').open", returnByValue: true });
      settingsOpen = result.result.value;
      if (settingsOpen) break;
      await delay(200);
    }
    assert(settingsOpen, `Settings did not open: ${failures.join('; ')}; ${logs}`);
    const avatarResult = await send('Runtime.evaluate', {
      expression: "(async () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; canvas.getContext('2d').fillRect(0, 0, 2, 2); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); const { readAvatar } = await import('/avatar.js'); return readAvatar(new File([blob], 'smoke.png', { type: 'image/png' }), value => value); })()",
      awaitPromise: true,
      returnByValue: true,
    });
    assert.match(avatarResult.result.value, /^data:image\/webp;base64,/, `Avatar processing failed: ${JSON.stringify(avatarResult.exceptionDetails)}`);
    assert.equal(failures.length, 0, `Renderer errors: ${failures.join('; ')}`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-smoke.png'), Buffer.from(screenshot.data, 'base64'));
    passed = true;
    console.log('Packaged UI rendered: welcome, chat, settings, and avatar processing');
  } finally {
    if (!passed) console.error(logs);
    socket?.close();
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await Promise.race([stopped, delay(5000)]);
    }
    assert.equal(dirname(profile), tempRoot);
    assert(basename(profile).startsWith('lumilan-ui-smoke-'));
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
