const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, readdirSync, realpathSync, writeFileSync } = require('node:fs');
const { rm } = require('node:fs/promises');
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
  if (process.env.LUMILAN_SMOKE_SOFTWARE_RENDERING === '1') console.log('Smoke: software rendering (sandbox enabled)');
  const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--lumilan-ui-smoke',
    ...(process.env.LUMILAN_SMOKE_SOFTWARE_RENDERING === '1' ? ['--disable-gpu'] : []),
    ...(platform === 'linux' ? [`--ozone-platform=${process.env.XDG_SESSION_TYPE === 'wayland' ? 'wayland' : 'x11'}`] : [])], {
    cwd: root,
    env: { ...process.env, APPDATA: profile, LOCALAPPDATA: profile, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // exit can precede worker/stdio shutdown; register close before the child can exit.
  const childClosed = new Promise(resolve => child.once('close', resolve));
  let launchError;
  child.once('error', error => { launchError = error; });
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
  let socket, quit;
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
    const settleAnimations = () => evaluate(`(async () => {
      // Later compositor frames or toast dismissal can start more finite effects.
      // The CDP request's timeout bounds the whole wait; infinite effects stay visible to assertions.
      for (;;) {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const finite = document.getAnimations()
          .filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity);
        if (!finite.length) return;
        await Promise.all(finite.map(animation => animation.finished.catch(() => {})));
      }
    })()`, true);
    quit = () => evaluate('setTimeout(()=>window.lumilan.quit(),100);true');
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
      const gap = document.querySelector('#room-type').getBoundingClientRect().top - document.querySelector('label[for="room-type"]').getBoundingClientRect().bottom;
      return { open: dialog.open, right: rect.right, viewport: innerWidth, overflow: dialog.scrollWidth > dialog.clientWidth,
        gap, appearance: select.appearance, arrow: select.backgroundImage, paddingRight: parseFloat(select.paddingRight) }; })()`);
    assert(roomLayout.open && roomLayout.right <= roomLayout.viewport && !roomLayout.overflow &&
      roomLayout.gap >= 6.5 && roomLayout.appearance === 'none' && roomLayout.arrow !== 'none' && roomLayout.paddingRight >= 32,
      `Room dialog or select control is inconsistent: ${JSON.stringify(roomLayout)}`);
    const roomScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-room-light.png'), Buffer.from(roomScreenshot.data, 'base64'));
    await setViewport(320, 700);
    for (const theme of ['light', 'dark']) {
      const narrowRoom = await evaluate(`(() => {
        document.documentElement.dataset.theme = '${theme}';
        const label = document.querySelector('label[for="room-type"]');
        label.textContent = 'Tipo de sala para conversar con dispositivos de la red local';
        const input = document.querySelector('#room-type');
        return { gap: input.getBoundingClientRect().top - label.getBoundingClientRect().bottom,
          overflow: document.documentElement.scrollWidth > innerWidth || document.querySelector('#room-dialog').scrollWidth > document.querySelector('#room-dialog').clientWidth };
      })()`);
      assert(narrowRoom.gap >= 6.5 && !narrowRoom.overflow, `Room label overlaps at 320 px in ${theme}: ${JSON.stringify(narrowRoom)}`);
    }
    await evaluate("document.querySelector('label[for=\"room-type\"]').textContent='Jenis Ruang'");
    await setViewport(1100, 800);
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
      const motion = call.getAnimations().map(animation => ({ timing: animation.effect.getTiming(), frames: animation.effect.getKeyframes() }));
      const value = { buttons: results, callLeft: callRect.left, callRight: callRect.right, overflow: document.documentElement.scrollWidth > innerWidth,
        motionSafe: motion.every(({ timing, frames }) => timing.iterations === 1 && timing.duration <= 180 && frames.every(frame => !frame.transform || frame.transform === 'none')) };
      fixture.remove();
      return value;
    })()`);
    assert(transientControls.callLeft >= 0 && transientControls.callRight <= 320 && !transientControls.overflow && transientControls.motionSafe &&
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
    // Offscreen contacts must not give their visually hidden status labels a document-sized containing block.
    const scrollState = await evaluate(`(() => {
      const saved = { theme: document.documentElement.dataset.theme, list: document.body.classList.contains('show-list') };
      for (let i = 0; i < 20; i++) {
        const person = document.createElement('button'); person.type = 'button'; person.className = 'person';
        person.dataset.scrollFixture = 'true'; person.dataset.status = 'active';
        person.innerHTML = '<span class="avatar">S</span><span class="person-copy"><strong>Kontak uji ' + i + '</strong><small class="presence presence-active"><span class="presence-label">Aktif</span></small></span>';
        document.querySelector('#people-list').append(person);
        const file = document.createElement('div'); file.className = 'detail-row'; file.dataset.scrollFixture = 'true';
        file.innerHTML = '<span class="detail-row-copy"><strong>File uji ' + i + '.png</strong><small>1 KiB</small></span>';
        document.querySelector('#recent-files').append(file);
      }
      return saved;
    })()`);
    try {
      for (const theme of ['light', 'dark']) {
        for (const [width, height, list] of [[1100, 800, false], [1100, 480, false], [320, 700, false], [320, 700, true]]) {
          await evaluate(`document.documentElement.dataset.theme = '${theme}'; document.body.classList.toggle('show-list', ${list})`);
          await setViewport(width, height);
          const scrollLayout = await evaluate(`(() => {
            window.scrollTo(0, document.scrollingElement.scrollHeight);
            const regions = ['#messages', '.sidebar-list', '.details'].map(selector => document.querySelector(selector))
              .filter(element => element.clientHeight > 0);
            const internal = regions.map(element => {
              for (const region of regions) region.scrollTop = 0;
              element.scrollTop = element.scrollHeight;
              const independent = regions.filter(region => region !== element).every(region => region.scrollTop === 0);
              return { name: element.id || element.className, top: element.scrollTop, independent };
            });
            const sidebar = document.querySelector('.sidebar-list');
            if (sidebar.clientHeight) document.querySelector('#people-list [data-scroll-fixture]:last-child').focus();
            const inside = selector => {
              const element = document.querySelector(selector), bounds = element.getBoundingClientRect();
              return !bounds.width || !bounds.height || bounds.top >= -1 && bounds.bottom <= innerHeight + 1;
            };
            return { height: innerHeight, documentHeight: document.scrollingElement.scrollHeight, scrollY,
              controls: ['.topbar', '.sidebar-footer', '.conversation-header', '.composer-wrap'].every(inside),
              detailsEnd: !document.querySelector('.details').clientHeight || inside('.details-footer'), internal,
              focusedContact: !sidebar.clientHeight || document.activeElement === document.querySelector('#people-list [data-scroll-fixture]:last-child'),
              statusLabels: [...document.querySelectorAll('[data-scroll-fixture] .presence-label')].every(label => label.textContent === 'Aktif') };
          })()`);
          assert(scrollLayout.documentHeight <= scrollLayout.height + 1 && scrollLayout.scrollY === 0 && scrollLayout.controls &&
            scrollLayout.detailsEnd && scrollLayout.focusedContact && scrollLayout.statusLabels &&
            scrollLayout.internal.every(region => region.top > 0 && region.independent),
          `App document scrolls or internal content is unreachable (${theme}, ${width}x${height}, list=${list}): ${JSON.stringify(scrollLayout)}`);
        }
      }
    } finally {
      await evaluate(`document.querySelectorAll('[data-scroll-fixture]').forEach(element => element.remove());
        document.documentElement.dataset.theme = ${JSON.stringify(scrollState.theme)};
        document.body.classList.toggle('show-list', ${scrollState.list}); document.querySelector('#message-input').focus({ preventScroll: true });
        document.querySelector('#messages').scrollTop = document.querySelector('#messages').scrollHeight;
        document.querySelector('.sidebar-list').scrollTop = 0; document.querySelector('.details').scrollTop = 0; window.scrollTo(0, 0)`);
      await setViewport(1100, 800);
    }
    console.log('UI scrolling: document stays within viewport; long contacts, messages and details scroll independently in light/dark and narrow windows');
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
      image.scrollIntoView({ block: 'center' }); const bounds = image.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, width: innerWidth, height: innerHeight }; })()`);
    // Screenshot latency can repeatedly sample one phase of a loop. Inspect actual
    // compositor frames, acknowledging promptly so capture does not stall playback.
    const gifFrames = [], playbackColors = new Set(); let red = false, white = false;
    const onGifFrame = event => {
      const message = JSON.parse(event.data);
      if (message.method !== 'Page.screencastFrame') return;
      if (gifFrames.length < 8) gifFrames.push(message.params.data);
      send('Page.screencastFrameAck', { sessionId: message.params.sessionId }).catch(error => failures.push(error.message));
    };
    socket.addEventListener('message', onGifFrame);
    try {
      await send('Page.startScreencast', { format: 'png', maxWidth: gifPosition.width, maxHeight: gifPosition.height, everyNthFrame: 1 });
      const playbackDeadline = Date.now() + 5000;
      while (Date.now() < playbackDeadline && !(red && white)) {
        const frame = gifFrames.shift();
        if (!frame) { await delay(20); continue; }
        const screenshot = sharp(Buffer.from(frame, 'base64')), size = await screenshot.metadata();
        const pixel = await screenshot.extract({ left: Math.floor(gifPosition.x * size.width / gifPosition.width),
          top: Math.floor(gifPosition.y * size.height / gifPosition.height), width: 1, height: 1 }).raw().toBuffer();
        playbackColors.add(pixel.subarray(0, 3).join(','));
        red ||= pixel[0] > 220 && pixel[1] < 30 && pixel[2] < 30;
        white ||= pixel[0] > 220 && pixel[1] > 220 && pixel[2] > 220;
      }
    } finally {
      await send('Page.stopScreencast');
      socket.removeEventListener('message', onGifFrame);
    }
    assert(red && white, `Animated GIF did not move in Chromium: ${JSON.stringify([...playbackColors])}`);
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
    const waitPreviewRelease = () => evaluate(`new Promise(resolve => {
      const image = document.querySelector('#image-dialog-image');
      if (!image.hasAttribute('src')) return resolve(true);
      const observer = new MutationObserver(() => { if (!image.hasAttribute('src')) finish(true); });
      const timer = setTimeout(() => finish(false), 3000);
      const finish = released => { clearTimeout(timer); observer.disconnect(); resolve(released); };
      observer.observe(image, { attributes: true, attributeFilter: ['src'] });
    })`, true);
    assert(await waitPreviewRelease(), 'Closed thumbnail dialog retained its image');
    await evaluate(`document.querySelector('.message .image-preview-button').click()`);
    assert(await evaluate("document.querySelector('#image-dialog').open"), 'Thumbnail dialog could not reopen after backdrop dismissal');
    const quickReopen = await evaluate(`new Promise(resolve => {
      const dialog = document.querySelector('#image-dialog'), image = document.querySelector('#image-dialog-image'), src = image.getAttribute('src');
      dialog.addEventListener('close', () => resolve({ open: dialog.open, samePreview: !!src && image.getAttribute('src') === src }), { once: true });
      // The native close event is queued, so a new modal can precede its callback.
      dialog.close(); dialog.showModal();
    })`, true);
    assert(quickReopen.open && quickReopen.samePreview, `Queued close cleared a reopened thumbnail: ${JSON.stringify(quickReopen)}`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    assert(await evaluate("!document.querySelector('#image-dialog').open"), 'Escape did not close the thumbnail dialog');
    assert(await waitPreviewRelease(), 'Escape-closed thumbnail retained its image after a quick reopen');
    const pressKey = async (key, code, windowsVirtualKeyCode) => {
      // Enter's generated character is needed for native HTML button activation.
      const text = key === 'Enter' ? '\r' : undefined;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, text, unmodifiedText: text });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    };
    const capturePolish = async name => {
      if (process.env.LUMILAN_UI_SCREENSHOTS !== '1') return;
      await settleAnimations();
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
      writeFileSync(join(dist, `ui-polish-${name}.png`), Buffer.from(shot.data, 'base64'));
    };
    const originalTheme = await evaluate('document.documentElement.dataset.theme');
    await setViewport(1100, 800);
    await evaluate(`(() => { const input = document.querySelector('#message-input'); input.value = 'AB';
      input.setSelectionRange(1, 1); input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#emoji-button').click(); })()`);
    const emojiLayout = await evaluate(`(() => { const picker = document.querySelector('#emoji-picker');
      const buttons = [...picker.querySelectorAll('button')], bounds = picker.getBoundingClientRect();
      return { open: !picker.hidden, count: buttons.length, unique: new Set(buttons.map(b => b.dataset.emoji)).size,
        accessible: picker.getAttribute('role') === 'group' && !!picker.getAttribute('aria-label') && buttons.every(b => !!b.getAttribute('aria-label')),
        focusedFirst: document.activeElement === buttons[0], expanded: document.querySelector('#emoji-button').getAttribute('aria-expanded'),
        scrollable: picker.scrollHeight > picker.clientHeight, overflowX: picker.scrollWidth > picker.clientWidth,
        finiteMotion: picker.getAnimations().every(a => a.effect.getTiming().iterations === 1 && a.effect.getTiming().duration <= 180),
        top: bounds.top, left: bounds.left, right: bounds.right, bottom: bounds.bottom }; })()`);
    assert(emojiLayout.open && emojiLayout.count >= 64 && emojiLayout.unique === emojiLayout.count && emojiLayout.accessible &&
      emojiLayout.focusedFirst && emojiLayout.expanded === 'true' && emojiLayout.scrollable && !emojiLayout.overflowX && emojiLayout.finiteMotion &&
      emojiLayout.top >= 7 && emojiLayout.left >= 0 && emojiLayout.right <= 1100 && emojiLayout.bottom <= 800,
    `Expanded emoji picker is inaccessible, clipped or not scrollable: ${JSON.stringify(emojiLayout)}`);
    await pressKey('ArrowDown', 'ArrowDown', 40);
    assert(await evaluate("document.activeElement === document.querySelectorAll('#emoji-picker button')[8]"), 'Emoji ArrowDown did not move one grid row');
    await pressKey('Home', 'Home', 36);
    assert(await evaluate("document.activeElement === document.querySelector('#emoji-picker button')"), 'Emoji Home did not return to the first choice');
    await pressKey('End', 'End', 35);
    const lastEmoji = await evaluate(`(() => { const picker = document.querySelector('#emoji-picker');
      const last = picker.lastElementChild, a = last.getBoundingClientRect(), b = picker.getBoundingClientRect();
      return { emoji: last.dataset.emoji, focused: document.activeElement === last, scroll: picker.scrollTop,
        inside: a.top >= b.top && a.bottom <= b.bottom + 1 }; })()`);
    assert(lastEmoji.focused && lastEmoji.scroll > 0 && lastEmoji.inside, `Last emoji is unreachable: ${JSON.stringify(lastEmoji)}`);
    const emojiMessageCount = await evaluate("document.querySelectorAll('#messages .message').length");
    await pressKey('Enter', 'Enter', 13);
    const insertedEmoji = await evaluate(`(() => { const input = document.querySelector('#message-input');
      return { value: input.value, caret: input.selectionStart, focused: document.activeElement === input,
        closed: document.querySelector('#emoji-picker').hidden, expanded: document.querySelector('#emoji-button').getAttribute('aria-expanded'),
        count: document.querySelectorAll('#messages .message').length }; })()`);
    assert(insertedEmoji.value === `A${lastEmoji.emoji}B` && insertedEmoji.caret === 1 + lastEmoji.emoji.length &&
      insertedEmoji.focused && insertedEmoji.closed && insertedEmoji.expanded === 'false' && insertedEmoji.count === emojiMessageCount,
    `Choosing an emoji altered the caret, sent a message or left the picker open: ${JSON.stringify(insertedEmoji)}`);
    await evaluate("document.querySelector('#emoji-button').click()");
    await pressKey('Escape', 'Escape', 27);
    assert(await evaluate("document.querySelector('#emoji-picker').hidden && document.activeElement === document.querySelector('#emoji-button')"),
      'Emoji Escape did not close and restore trigger focus');
    await evaluate("document.querySelector('#emoji-button').click()");
    await setViewport(320, 480);
    const shortEmoji = await evaluate(`(() => { const picker = document.querySelector('#emoji-picker'), r = picker.getBoundingClientRect();
      return { open: !picker.hidden, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
        scrollable: picker.scrollHeight > picker.clientHeight, overflow: document.documentElement.scrollWidth > innerWidth }; })()`);
    assert(shortEmoji.open && shortEmoji.top >= 7 && shortEmoji.bottom <= 480 && shortEmoji.left >= 0 && shortEmoji.right <= 320 &&
      shortEmoji.scrollable && !shortEmoji.overflow, `Emoji picker escaped after resizing: ${JSON.stringify(shortEmoji)}`);
    await pressKey('Escape', 'Escape', 27);
    await evaluate("document.querySelector('#message-input').value = ''; document.querySelector('#message-input').dispatchEvent(new Event('input', { bubbles: true }))");

    // Exercise the runner's accessibility setting and both explicit motion modes.
    for (const [theme, motion] of ['native', 'no-preference', 'reduce'].flatMap(motion => ['light', 'dark'].map(theme => [theme, motion]))) {
      await send('Emulation.setEmulatedMedia', { features: motion === 'native' ? [] : [{ name: 'prefers-reduced-motion', value: motion }] });
      await evaluate(`document.documentElement.dataset.theme = '${theme}'`);
      for (const [width, height] of [[1100, 800], [375, 812], [320, 700]]) {
        await setViewport(width, height);
        await evaluate("document.querySelector('#settings-dialog').showModal()");
        const settingsSpacing = await evaluate(`(() => { const dialog = document.querySelector('#settings-dialog'), form = document.querySelector('#profile-form');
          const a = dialog.getBoundingClientRect(), b = form.getBoundingClientRect(), s = getComputedStyle(dialog);
          return { left: b.left - a.left, right: a.right - b.right, gutter: dialog.offsetWidth - dialog.clientWidth - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth),
            scrollable: dialog.scrollHeight > dialog.clientHeight, overflow: dialog.scrollWidth > dialog.clientWidth,
            inside: a.left >= 0 && a.right <= innerWidth }; })()`);
        assert(settingsSpacing.inside && !settingsSpacing.overflow && settingsSpacing.scrollable &&
          Math.abs(settingsSpacing.left - settingsSpacing.right) <= 1 && Math.abs(settingsSpacing.left - 29) <= 1 &&
          Math.abs(settingsSpacing.right - 29) <= 1 && Math.abs(settingsSpacing.gutter - 9) <= 1,
        `Settings padding/scrollbar is asymmetric (${theme}, ${width}px): ${JSON.stringify(settingsSpacing)}`);
        if (width !== 375) await capturePolish(`settings-${theme}-${width}-${motion}`);
        await evaluate("document.querySelector('#settings-dialog').close()");
      }
      await setViewport(1100, 800);
      await pressKey('Tab', 'Tab', 9);
      await evaluate("document.querySelector('#message-input').focus()");
      await settleAnimations();
      const borders = await evaluate(`(() => {
        const luminance = value => value.match(/[\\d.]+/g).slice(0, 3).map(Number).map(n => n / 255)
          .map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
        const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
        const input = document.querySelector('#message-input'), inputStyle = getComputedStyle(input), focus = getComputedStyle(input.closest('.composer'));
        // Resolve the 2px target in the same native DPI/zoom context as the UI.
        const probe = document.createElement('span'); probe.style.cssText = 'position:fixed;visibility:hidden;outline:2px solid';
        document.body.append(probe); const targetWidth = parseFloat(getComputedStyle(probe).outlineWidth); probe.remove();
        const typedWidth = input.closest('.composer').computedStyleMap?.().get('outline-width')?.value;
        const surface = getComputedStyle(document.querySelector('.conversation-header')).backgroundColor, chat = getComputedStyle(document.querySelector('.conversation')).backgroundColor;
        const own = getComputedStyle(document.querySelector('.message.own .bubble'));
        const selected = getComputedStyle(document.querySelector('#notes-button'));
        const borderRgb = own.borderTopColor.match(/[\\d.]+/g).slice(0, 3).map(Number);
        return { visibleFocus: input.matches(':focus-visible'), focusWidth: parseFloat(focus.outlineWidth), targetWidth, typedWidth, dpr: devicePixelRatio,
          visibility: document.visibilityState, pageHidden: document.documentElement.dataset.pageHidden,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          focusSurface: contrast(focus.outlineColor, surface), focusChat: contrast(focus.outlineColor, chat),
          selection: contrast(selected.borderTopColor, selected.backgroundColor), outgoing: contrast(own.borderTopColor, own.backgroundColor),
          outgoingNearWhite: borderRgb.every(n => n > 220), inputTransitions: inputStyle.transitionDuration.split(',').map(parseFloat),
          inputProperties: inputStyle.transitionProperty.split(',').map(s => s.trim()) }; })()`);
      assert(motion === 'native' || borders.reducedMotion === (motion === 'reduce'), `Motion emulation failed (${motion}): ${JSON.stringify(borders)}`);
      // transition:none is required by the hidden/reduced-motion CSS policy.
      const motionSuppressed = borders.reducedMotion || borders.pageHidden === 'true';
      const validInputTransitions = motionSuppressed
        ? borders.inputProperties.length === 1 && borders.inputProperties[0] === 'none' && borders.inputTransitions.every(seconds => seconds === 0)
        : borders.inputTransitions.every(seconds => seconds >= 0 && seconds <= .18) &&
          borders.inputProperties.every(property => ['color', 'background-color', 'border-color', 'outline-color'].includes(property));
      assert(borders.visibleFocus && borders.targetWidth > 0 && borders.focusWidth + .01 >= borders.targetWidth &&
        borders.focusSurface >= 3 && borders.focusChat >= 3 &&
        borders.selection >= 3 && borders.outgoing >= 2 && (theme !== 'dark' || !borders.outgoingNearWhite),
      `Focus/selection/outgoing contrast failed (${theme}, ${motion}): ${JSON.stringify(borders)}`);
      assert(validInputTransitions, `Input transitions failed (${theme}, ${motion}): ${JSON.stringify(borders)}`);
      console.log(`UI focus/motion (${theme}, ${motion}): ${JSON.stringify({ resolvedWidth: borders.focusWidth, target2px: borders.targetWidth, typedWidth: borders.typedWidth, dpr: borders.dpr,
        visibility: borders.visibility, pageHidden: borders.pageHidden, reducedMotion: borders.reducedMotion, inputTransitions: borders.inputTransitions, inputProperties: borders.inputProperties })}`);
      await capturePolish(`chat-${theme}-${motion}`);
      await evaluate("document.querySelector('#emoji-button').click()");
      await capturePolish(`emoji-${theme}-${motion}`);
      await pressKey('Escape', 'Escape', 27);
    }
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await evaluate("document.querySelector('#emoji-button').click(); document.querySelector('#settings-dialog').showModal()");
    const reducedMotion = await evaluate(`(() => {
      const controls = ['#emoji-picker', '#emoji-button', '#message-input', '#settings-dialog', '#call-panel'].map(selector => getComputedStyle(document.querySelector(selector)));
      const backdrop = getComputedStyle(document.querySelector('#settings-dialog'), '::backdrop');
      const animations = document.getAnimations().filter(animation => animation.playState === 'running').map(animation => ({
        name: animation.animationName || animation.transitionProperty || animation.constructor.name,
        target: animation.effect?.target?.id || animation.effect?.target?.tagName || animation.effect?.target?.constructor.name,
        pseudo: animation.effect?.pseudoElement, timing: animation.effect?.getTiming() }));
      return { styles: controls.every(style => style.animationName === 'none' && style.transitionDuration.split(',').every(time => parseFloat(time) === 0)),
        backdrop: backdrop.animationName === 'none' && backdrop.transitionDuration.split(',').every(time => parseFloat(time) === 0),
        running: animations.length, animations }; })()`);
    assert(reducedMotion.styles && reducedMotion.backdrop && reducedMotion.running === 0, `Reduced motion still animates UI: ${JSON.stringify(reducedMotion)}`);
    await evaluate("document.querySelector('#settings-dialog').close(); document.querySelector('#emoji-button').click()");
    await send('Emulation.setEmulatedMedia', { features: [] });
    await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(originalTheme)}`);
    await settleAnimations();
    const idleAnimations = await evaluate(`document.getAnimations().filter(animation => animation.playState === 'running').map(animation => ({
      name: animation.animationName || animation.transitionProperty || animation.constructor.name,
      target: animation.effect?.target?.id || animation.effect?.target?.className || animation.effect?.target?.tagName,
      pending: animation.pending, currentTime: animation.currentTime, timing: animation.effect?.getTiming() }))`);
    assert.deepEqual(idleAnimations, [], 'Closed UI controls animate while idle');
    await send('Performance.enable');
    const idleBefore = Object.fromEntries((await send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
    await delay(1000);
    const idleAfter = Object.fromEntries((await send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
    const idleHeap = idleAfter.JSHeapUsedSize / 1024 / 1024, idleTasks = idleAfter.TaskDuration - idleBefore.TaskDuration;
    assert(Number.isFinite(idleHeap) && Number.isFinite(idleTasks) && idleHeap <= 96 && idleTasks <= .25,
      `Renderer idle budget exceeded: ${JSON.stringify({ jsHeapMiB: idleHeap, taskSeconds: idleTasks })}`);
    console.log(`UI polish: scrollable accessible emoji, symmetric Settings, focus/selection contrast and reduced motion passed; idle renderer JS heap ${idleHeap.toFixed(2)} MiB, task time ${idleTasks.toFixed(3)} s/1 s`);
    assert.equal(failures.length, 0, `Renderer errors: ${failures.join('; ')}`);
    passed = true;
    console.log('Packaged UI rendered: welcome, chat, details, settings, room, contact dialog, call, avatar, animated GIF preview, and older-message reactions without scroll jumps');
  } catch (error) {
    console.error('UI smoke failure:', error);
    throw error;
  } finally {
    if (!passed) console.error(logs);
    if (child.exitCode === null && child.signalCode === null && quit) {
      await quit().catch(() => {});
      await Promise.race([childClosed, delay(5000)]);
    }
    socket?.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    try { await bounded(childClosed, 10_000, 'Application process or stdio did not close before profile cleanup'); }
    catch (error) {
      console.error('Smoke shutdown state:', { pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode,
        stdoutClosed: child.stdout?.closed, stderrClosed: child.stderr?.closed });
      if (passed) console.error(logs);
      child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
      throw error;
    }
    assert.equal(dirname(profile), tempRoot);
    assert(basename(profile).startsWith('lumilan-ui-smoke-'));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
