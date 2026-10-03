const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');
const sharp = require('sharp');

async function main() {
  const root = resolve(__dirname, '..');
  const dist = resolve(root, process.env.LUMILAN_BUILD_DIR || 'dist');
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
  const timeoutAt = Date.now() + 45_000;
  const server = createServer();
  server.listen(0, '127.0.0.1');
  const port = await new Promise(resolve => server.once('listening', () => resolve(server.address().port)));
  await new Promise(resolve => server.close(resolve));

  const tempRoot = realpathSync(tmpdir());
  const profile = mkdtempSync(join(tempRoot, 'lumilan-ui-smoke-'));
  const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--lumilan-ui-smoke',
    ...(platform === 'linux' ? [`--ozone-platform=${process.env.XDG_SESSION_TYPE === 'wayland' ? 'wayland' : 'x11'}`] : [])], {
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
    }), timeout, `${method} timed out: ${(params.expression || '').slice(0, 160)}`);
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
        if (state?.joinVisible) {
          const form = await send('Runtime.evaluate', { expression: "document.querySelector('#join-form')" });
          if (form.result.objectId) {
            const { listeners } = await send('DOMDebugger.getEventListeners', { objectId: form.result.objectId });
            await send('Runtime.releaseObject', { objectId: form.result.objectId });
            state.joinReady = listeners.some(listener => listener.type === 'submit');
          }
        }
        if (state?.appVisible || state?.joinReady) break;
      } catch { /* The page is reloading. */ }
      await delay(200);
    }
    assert(state?.joinVisible && state.joinReady, `Welcome screen did not initialize: ${JSON.stringify(state)}; ${failures.join('; ')}; ${logs}`);
    await send('Runtime.evaluate', {
      expression: "document.querySelector('#join-name').value = 'UI Smoke'; document.querySelector('#join-form').requestSubmit()",
    });
    while (Date.now() < timeoutAt) {
      const result = await send('Runtime.evaluate', {
        expression: "({ appVisible: !document.querySelector('#app')?.hidden, name: document.querySelector('#my-name')?.textContent })",
        returnByValue: true,
      });
      state = result.result.value;
      if (state?.appVisible && state.name === 'UI Smoke') break;
      await delay(200);
    }
    assert(state?.appVisible && state.name === 'UI Smoke', `Chat screen did not render: ${JSON.stringify(state)}; ${failures.join('; ')}; ${logs}`);
    const chatScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-smoke-chat.png'), Buffer.from(chatScreenshot.data, 'base64'));
    const evaluate = async (expression, awaitPromise = false) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      assert(!result.exceptionDetails, `UI inspection failed: ${result.exceptionDetails?.text}`);
      return result.result.value;
    };
    const setViewport = async (width, height) => {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      // The CDP reply can precede resize handlers/layout. Wait for rendering, not wall-clock time.
      const size = await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() =>
        resolve({ width: innerWidth, height: innerHeight, visibility: document.visibilityState }))))`, true);
      assert(size.width === width && size.height === height, `Viewport did not resize: ${JSON.stringify(size)}`);
    };
    await setViewport(1100, 800);
    const detailLayout = await evaluate(`(() => {
      document.documentElement.dataset.theme = 'light';
      const section = document.querySelector('#contact-label-section');
      section.hidden = false;
      document.querySelector('#contact-label-input').value = 'pc rdp';
      document.querySelector('#contact-label-remove').hidden = false;
      document.querySelector('#contact-label-current').textContent = 'Tanda saat ini: pc rdp';
      const input = document.querySelector('#contact-label-input').getBoundingClientRect();
      const save = section.querySelector('button[type="submit"]');
      const saveRect = save.getBoundingClientRect();
      const removeRect = document.querySelector('#contact-label-remove').getBoundingClientRect();
      const detailRect = document.querySelector('.details').getBoundingClientRect();
      const channels = value => value.match(/[\\d.]+/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
      const luminance = value => channels(value).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const css = getComputedStyle(save);
      const a = luminance(css.color), b = luminance(css.backgroundColor);
      return { inputBottom: input.bottom, saveTop: saveRect.top, removeTop: removeRect.top, saveBottom: saveRect.bottom,
        removeBottom: removeRect.bottom, saveRight: saveRect.right, removeRight: removeRect.right, detailRight: detailRect.right,
        buttonHeight: saveRect.height, buttonFont: parseFloat(css.fontSize), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
        overflow: document.documentElement.scrollWidth > innerWidth };
    })()`);
    assert(detailLayout.inputBottom < detailLayout.saveTop && Math.abs(detailLayout.saveTop - detailLayout.removeTop) < 2 &&
      detailLayout.saveRight <= detailLayout.detailRight && detailLayout.removeRight <= detailLayout.detailRight &&
      detailLayout.buttonHeight >= 38 && detailLayout.buttonFont >= 12 && detailLayout.contrast >= 4.5 && !detailLayout.overflow,
    `Contact controls are cramped or low contrast: ${JSON.stringify(detailLayout)}`);
    const lightDetailScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-details-light.png'), Buffer.from(lightDetailScreenshot.data, 'base64'));
    const fullWidthSave = await evaluate(`(() => { const remove = document.querySelector('#contact-label-remove'); remove.hidden = true;
      const input = document.querySelector('#contact-label-input').getBoundingClientRect();
      const save = document.querySelector('#contact-label-form button[type="submit"]').getBoundingClientRect();
      return Math.abs(input.width - save.width) < 2; })()`);
    assert(fullWidthSave, 'Contact Save button should fill the row when Remove is unavailable');
    await evaluate("document.querySelector('#contact-label-remove').hidden = false; document.documentElement.dataset.theme = 'dark'");
    const detailScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-details-dark.png'), Buffer.from(detailScreenshot.data, 'base64'));
    await send('Runtime.evaluate', { expression: "document.querySelector('#settings-button').click()" });
    let settingsOpen = false;
    while (Date.now() < timeoutAt) {
      const result = await send('Runtime.evaluate', { expression: "document.querySelector('#settings-dialog').open", returnByValue: true });
      settingsOpen = result.result.value;
      if (settingsOpen) break;
      await delay(200);
    }
    assert(settingsOpen, `Settings did not open: ${failures.join('; ')}; ${logs}`);
    await setViewport(375, 812);
    const narrow = await evaluate(`(() => { const dialog = document.querySelector('#settings-dialog');
      document.querySelector('#test-notification-button').textContent = 'Uji notifikasi sistem sekarang';
      document.querySelector('#notifications-form button[type="submit"]').textContent = 'Simpan semua pengaturan notifikasi';
      const rect = dialog.getBoundingClientRect();
      return { viewport: innerWidth, left: rect.left, right: rect.right, dialogOverflow: dialog.scrollWidth > dialog.clientWidth,
        pageOverflow: document.documentElement.scrollWidth > innerWidth }; })()`);
    assert(narrow.left >= 0 && narrow.right <= narrow.viewport && !narrow.dialogOverflow && !narrow.pageOverflow,
      `Settings overflow in a narrow window: ${JSON.stringify(narrow)}`);
    await evaluate("document.querySelector('#notifications-form').scrollIntoView({ block: 'center' })");
    const narrowScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-settings-narrow.png'), Buffer.from(narrowScreenshot.data, 'base64'));
    const narrowShell = await evaluate(`(() => { document.querySelector('#settings-dialog').close();
      const topbar = document.querySelector('.topbar'); const brand = topbar.querySelector('strong');
      return { topbarOverflow: topbar.scrollWidth > topbar.clientWidth, brandHeight: brand.getBoundingClientRect().height, topbarHeight: topbar.getBoundingClientRect().height,
        pageOverflow: document.documentElement.scrollWidth > innerWidth }; })()`);
    assert(!narrowShell.topbarOverflow && !narrowShell.pageOverflow && narrowShell.brandHeight < narrowShell.topbarHeight,
      `Top bar overflows a narrow window: ${JSON.stringify(narrowShell)}`);
    const narrowChatScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-chat-narrow.png'), Buffer.from(narrowChatScreenshot.data, 'base64'));
    await setViewport(320, 700);
    const minimumShell = await evaluate(`(() => { const topbar = document.querySelector('.topbar');
      return { topbarOverflow: topbar.scrollWidth > topbar.clientWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth }; })()`);
    assert(!minimumShell.topbarOverflow && !minimumShell.pageOverflow, `Top bar overflows at 320 px: ${JSON.stringify(minimumShell)}`);
    await setViewport(1100, 800);
    await evaluate("document.querySelector('#settings-dialog').showModal()");
    const avatarResult = await send('Runtime.evaluate', {
      expression: "(async () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; canvas.getContext('2d').fillRect(0, 0, 2, 2); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); const { readAvatar } = await import('/avatar.js'); return readAvatar(new File([blob], 'smoke.png', { type: 'image/png' }), value => value); })()",
      awaitPromise: true,
      returnByValue: true,
    });
    assert.match(avatarResult.result.value, /^data:image\/webp;base64,/, `Avatar processing failed: ${JSON.stringify(avatarResult.exceptionDetails)}`);
    assert.equal(failures.length, 0, `Renderer errors: ${failures.join('; ')}`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-smoke.png'), Buffer.from(screenshot.data, 'base64'));
    const roomLayout = await evaluate(`(() => { document.querySelector('#settings-dialog').close();
      document.documentElement.dataset.theme = 'light'; document.querySelector('#create-room-button').click();
      const dialog = document.querySelector('#room-dialog'); const select = getComputedStyle(document.querySelector('#room-type'));
      const rect = dialog.getBoundingClientRect();
      return { open: dialog.open, right: rect.right, viewport: innerWidth, overflow: dialog.scrollWidth > dialog.clientWidth,
        appearance: select.appearance, arrow: select.backgroundImage, paddingRight: parseFloat(select.paddingRight) }; })()`);
    assert(roomLayout.open && roomLayout.right <= roomLayout.viewport && !roomLayout.overflow &&
      roomLayout.appearance === 'none' && roomLayout.arrow !== 'none' && roomLayout.paddingRight >= 32,
      `Room dialog or select control is inconsistent: ${JSON.stringify(roomLayout)}`);
    const roomScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-room-light.png'), Buffer.from(roomScreenshot.data, 'base64'));
    await evaluate(`document.querySelector('#room-dialog').close(); document.documentElement.dataset.theme = 'dark';
      document.querySelector('#contact-label-dialog').showModal();
      document.querySelector('#contact-label-dialog-input').value = 'pc rdp';
      document.querySelector('#contact-label-dialog-remove').hidden = false`);
    const labelScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-label-dialog-dark.png'), Buffer.from(labelScreenshot.data, 'base64'));
    await setViewport(320, 700);
    const transientControls = await evaluate(`(() => {
      document.querySelector('#contact-label-dialog').close();
      document.body.classList.remove('show-list');
      const call = document.querySelector('#call-panel');
      call.hidden = false;
      document.querySelector('#call-name').textContent = 'Pengguna dengan nama yang cukup panjang';
      document.querySelector('#call-status').textContent = 'Panggilan suara masuk';
      document.querySelector('#call-accept').hidden = false;
      document.querySelector('#call-dismiss').hidden = false;
      const fixture = document.createElement('div');
      fixture.style.cssText = 'position:fixed;left:8px;bottom:8px;width:304px;z-index:40;background:var(--surface)';
      fixture.innerHTML = '<div class="room-invite-actions"><button>Terima undangan Ruang</button><button>Tolak undangan Ruang</button></div><div class="incoming-transfer-actions"><button>Tolak pengiriman</button><button>Terima pengiriman file</button></div>';
      document.body.append(fixture);
      const buttons = [...call.querySelectorAll('.call-actions button:not([hidden])'), ...fixture.querySelectorAll('button')];
      const results = buttons.map(button => { const rect = button.getBoundingClientRect(); const css = getComputedStyle(button);
        return { text: button.textContent.trim(), height: rect.height, left: rect.left, right: rect.right, font: parseFloat(css.fontSize) }; });
      const callRect = call.getBoundingClientRect();
      const value = { buttons: results, callLeft: callRect.left, callRight: callRect.right, overflow: document.documentElement.scrollWidth > innerWidth };
      fixture.remove();
      return value;
    })()`);
    assert(transientControls.callLeft >= 0 && transientControls.callRight <= 320 && !transientControls.overflow &&
      transientControls.buttons.every(button => button.height >= 38 && button.font >= 12 && button.left >= 0 && button.right <= 320),
      `Call, invitation, or file controls overflow or are too small: ${JSON.stringify(transientControls)}`);
    const dragStart = await evaluate(`(() => { const card = document.querySelector('#call-panel').getBoundingClientRect();
      const handle = document.querySelector('#call-drag').getBoundingClientRect();
      return { left: card.left, top: card.top, x: Math.floor(handle.left + handle.width / 2), y: Math.floor(handle.top + handle.height / 2) }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x, y: dragStart.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragStart.x, y: dragStart.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x - 50, y: dragStart.y + 150, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragStart.x - 50, y: dragStart.y + 150, button: 'left', clickCount: 1 });
    const dragged = await evaluate(`(() => { const rect = document.querySelector('#call-panel').getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; })()`);
    assert(dragged.top > dragStart.top + 100 && dragged.left < dragStart.left && dragged.left >= 8 && dragged.right <= 312 && dragged.bottom <= 692,
      `Call card did not drag or stay in the viewport: ${JSON.stringify({ dragStart, dragged })}`);
    await evaluate("document.querySelector('#call-drag').focus()");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
    const keyboardTop = await evaluate("document.querySelector('#call-panel').getBoundingClientRect().top");
    assert.equal(keyboardTop, dragged.top - 20, 'Arrow keys did not move the call card');
    await setViewport(320, 240);
    const resized = await evaluate(`(() => { const rect = document.querySelector('#call-panel').getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, height: innerHeight,
        visibility: document.visibilityState, position: document.querySelector('#call-panel').style.cssText }; })()`);
    assert(resized.left >= 8 && resized.top >= 8 && resized.right <= 312 && resized.bottom <= 232,
      `Dragged call card escaped after resize: ${JSON.stringify(resized)}`);
    await setViewport(320, 700);
    const callScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-call-dragged.png'), Buffer.from(callScreenshot.data, 'base64'));
    await evaluate("document.documentElement.dataset.theme = 'light'");
    const lightCallScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-call-dragged-light.png'), Buffer.from(lightCallScreenshot.data, 'base64'));
    await evaluate("document.documentElement.dataset.theme = 'dark'");
    await evaluate("document.querySelector('#call-dismiss').click()");
    assert(await evaluate("document.querySelector('#call-panel').hidden"), 'Call dismissal stopped working after dragging');
    await setViewport(1100, 800);
    await evaluate("document.querySelector('#notes-button').click()");
    const notesResult = await send('Runtime.evaluate', {
      expression: "(async () => { for (let i = 0; i < 40; i++) await window.lumilan.note('Pesan lama untuk uji posisi ' + i); return true })()",
      awaitPromise: true, returnByValue: true,
    }, 30_000);
    assert(!notesResult.exceptionDetails && notesResult.result.value, 'Could not create scroll test messages');
    let noteCount = 0;
    while (Date.now() < timeoutAt) {
      noteCount = await evaluate("document.querySelectorAll('#messages .message').length");
      if (noteCount === 40) break;
      await delay(100);
    }
    assert.equal(noteCount, 40, 'Scroll test messages did not render');
    const oldPosition = await evaluate(`(() => { const list = document.querySelector('#messages');
      list.scrollTop = Math.floor((list.scrollHeight - list.clientHeight) / 3);
      const y = list.getBoundingClientRect().top + 100;
      const row = [...list.querySelectorAll('.message')].find(item => item.getBoundingClientRect().bottom > y);
      row.querySelector('.message-select-button').click();
      document.querySelector('#selection-react').click();
      return { id: row.id, top: list.scrollTop, rowTop: row.getBoundingClientRect().top,
        distance: list.scrollHeight - list.scrollTop - list.clientHeight }; })()`);
    assert(oldPosition.distance > 64, `Test message is too close to the bottom: ${JSON.stringify(oldPosition)}`);
    await evaluate("document.querySelector('#reaction-picker button').click()");
    let reacted = false;
    while (Date.now() < timeoutAt) {
      reacted = await evaluate(`Boolean(document.querySelector('#${oldPosition.id} .message-reactions button'))`);
      if (reacted) break;
      await delay(100);
    }
    assert(reacted, 'Reaction did not appear on the older message');
    const reactionPosition = await evaluate(`(() => { const list = document.querySelector('#messages');
      return { top: list.scrollTop, rowTop: document.querySelector('#${oldPosition.id}').getBoundingClientRect().top }; })()`);
    assert(Math.abs(reactionPosition.top - oldPosition.top) <= 2 && Math.abs(reactionPosition.rowTop - oldPosition.rowTop) <= 5,
      `Reacting to an older message changed the viewport: ${JSON.stringify({ oldPosition, reactionPosition })}`);
    await evaluate(`document.querySelector('#${oldPosition.id} .message-reactions button').click()`);
    while (Date.now() < timeoutAt) {
      reacted = await evaluate(`Boolean(document.querySelector('#${oldPosition.id} .message-reactions button'))`);
      if (!reacted) break;
      await delay(100);
    }
    assert(!reacted, 'Reaction chip did not toggle off');
    const afterToggle = await evaluate("document.querySelector('#messages').scrollTop");
    assert(Math.abs(afterToggle - oldPosition.top) <= 2, `Toggling a reaction chip changed the viewport: ${afterToggle}`);
    await send('Runtime.evaluate', { expression: "window.lumilan.note('Pesan baru tanpa menggeser pembaca')", awaitPromise: true });
    while (Date.now() < timeoutAt) {
      noteCount = await evaluate("document.querySelectorAll('#messages .message').length");
      if (noteCount === 41) break;
      await delay(100);
    }
    assert.equal(noteCount, 41, 'New message did not render');
    const afterIncoming = await evaluate("document.querySelector('#messages').scrollTop");
    assert(Math.abs(afterIncoming - oldPosition.top) <= 2, `A new message moved a reader away from older messages: ${afterIncoming}`);
    await evaluate("document.querySelector('#messages').scrollTop = document.querySelector('#messages').scrollHeight");
    await send('Runtime.evaluate', { expression: "window.lumilan.note('Pesan baru saat pembaca di bawah')", awaitPromise: true });
    while (Date.now() < timeoutAt) {
      noteCount = await evaluate("document.querySelectorAll('#messages .message').length");
      if (noteCount === 42) break;
      await delay(100);
    }
    const bottomDistance = await evaluate("(() => { const list = document.querySelector('#messages'); return list.scrollHeight - list.scrollTop - list.clientHeight })()");
    assert.equal(noteCount, 42, 'Newest message did not render');
    assert(bottomDistance <= 2, `Chat did not follow new messages while already at the bottom: ${bottomDistance}`);
    const gifPixels = Buffer.alloc(32 * 32 * 2 * 3);
    gifPixels.fill(255, 0, 32 * 32 * 3);
    for (let pixel = 32 * 32 * 3; pixel < gifPixels.length; pixel += 3) gifPixels[pixel] = 255;
    const gifPath = join(profile, 'smoke-animated.gif');
    writeFileSync(gifPath, await sharp(gifPixels, { raw: { width: 32, height: 64, pageHeight: 32, channels: 3 } })
      .gif({ delay: [120, 240], loop: 0 }).toBuffer());
    const dom = await send('DOM.getDocument');
    const fileInput = await send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#file-input' });
    assert(fileInput.nodeId, 'File input is unavailable');
    await send('DOM.setFileInputFiles', { nodeId: fileInput.nodeId, files: [gifPath] });
    await evaluate("document.querySelector('#file-input').dispatchEvent(new Event('change', { bubbles: true }))");
    let gifPreview;
    while (Date.now() < timeoutAt) {
      gifPreview = await evaluate(`(() => { const row = [...document.querySelectorAll('#messages .message')]
        .find(item => item.textContent.includes('smoke-animated.gif')); const image = row?.querySelector('.image-preview');
        return image?.complete && image.naturalWidth ? image.src : null; })()`);
      if (gifPreview) break;
      await delay(100);
    }
    assert.match(gifPreview || '', /^data:image\/webp;base64,/, 'Animated GIF preview did not render');
    assert.equal((await sharp(Buffer.from(gifPreview.split(',')[1], 'base64')).metadata()).pages, 2);
    const gifPosition = await evaluate(`(() => { const image = [...document.querySelectorAll('#messages .message')]
      .find(item => item.textContent.includes('smoke-animated.gif')).querySelector('.image-preview');
      const bounds = image.getBoundingClientRect();
      return { left: Math.floor(bounds.left + bounds.width / 2), top: Math.floor(bounds.top + bounds.height / 2) }; })()`);
    const playbackColors = new Set();
    for (let frame = 0; frame < 8; frame++) {
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
      const pixel = await sharp(Buffer.from(screenshot.data, 'base64'))
        .extract({ left: gifPosition.left, top: gifPosition.top, width: 1, height: 1 }).raw().toBuffer();
      playbackColors.add(pixel.subarray(0, 3).join(','));
      await delay(90);
    }
    assert(playbackColors.size >= 2, `Animated GIF did not move in Chromium: ${JSON.stringify([...playbackColors])}`);
    const gifDialog = await evaluate(`(() => { const row = [...document.querySelectorAll('#messages .message')]
      .find(item => item.textContent.includes('smoke-animated.gif')); row.querySelector('.image-preview-button').click();
      return { open: document.querySelector('#image-dialog').open,
        samePreview: document.querySelector('#image-dialog-image').src === row.querySelector('.image-preview').src }; })()`);
    assert(gifDialog.open && gifDialog.samePreview, `Animated GIF dialog failed: ${JSON.stringify(gifDialog)}`);
    const gifScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-gif-preview.png'), Buffer.from(gifScreenshot.data, 'base64'));
    const previewCenter = await evaluate(`(() => { const rect = document.querySelector('#image-dialog-image').getBoundingClientRect();
      return { x: Math.floor(rect.left + rect.width / 2), y: Math.floor(rect.top + rect.height / 2) }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...previewCenter, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...previewCenter, button: 'left', clickCount: 1 });
    assert(await evaluate("document.querySelector('#image-dialog').open"), 'Clicking the thumbnail closed its dialog');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 4, y: 4, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 4, y: 4, button: 'left', clickCount: 1 });
    assert(await evaluate("!document.querySelector('#image-dialog').open"), 'Clicking the backdrop did not close the thumbnail dialog');
    await delay(50);
    assert(await evaluate("!document.querySelector('#image-dialog-image').hasAttribute('src')"), 'Closed thumbnail dialog retained its image');
    await evaluate(`document.querySelector('.message .image-preview-button').click()`);
    assert(await evaluate("document.querySelector('#image-dialog').open"), 'Thumbnail dialog could not reopen after backdrop dismissal');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    assert(await evaluate("!document.querySelector('#image-dialog').open"), 'Escape did not close the thumbnail dialog');
    passed = true;
    console.log('Packaged UI rendered: welcome, chat, details, settings, room, contact dialog, call, avatar, animated GIF preview, and older-message reactions without scroll jumps');
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
