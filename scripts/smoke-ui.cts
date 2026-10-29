import cdp = require('./cdp.cjs');
import type { Message, Snapshot } from '../src/shared/model.js';
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { createHash }: typeof import('node:crypto') = require('node:crypto');
const { spawn }: typeof import('node:child_process') = require('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync }: typeof import('node:fs') = require('node:fs');
const { rm }: typeof import('node:fs/promises') = require('node:fs/promises');
const { createServer }: typeof import('node:net') = require('node:net');
const { tmpdir }: typeof import('node:os') = require('node:os');
const { basename, dirname, join, resolve }: typeof import('node:path') = require('node:path');
const sharp: typeof import('sharp') = require('sharp');

async function main() {
  const root = resolve(__dirname, '../..');
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

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const bounded = <T,>(promise: Promise<T>, ms: number, message: string) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  const timeoutAt = Date.now() + 90_000;
  const server = createServer();
  server.listen(0, '127.0.0.1');
  const port = await new Promise<number>(resolve => server.once('listening', () => { const address = server.address(); assert(address && typeof address !== 'string'); resolve(address.port); }));
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

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
  const childClosed = new Promise<void>(resolve => child.once('close', () => resolve()));
  let launchError: Error | undefined;
  child.once('error', error => { launchError = error; });
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
  const handlerErrors = cdp.handlerErrors(child.stderr);
  let socket: WebSocket | undefined, quit: (() => Promise<unknown>) | undefined;
  let stickerPeer: import('../src/main/peer.js').LumilanPeer | undefined;
  let passed = false;
  try {
    let page: cdp.DebugPage | undefined;
    while (Date.now() < timeoutAt) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Application exited with ${child.exitCode}: ${logs}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
        page = cdp.debugPages(await response.json()).find(item => item.type === 'page' && item.url === 'lumilan://app/index.html');
        if (page?.webSocketDebuggerUrl) break;
      } catch { /* DevTools is starting. */ }
      await delay(200);
    }
    assert(page?.webSocketDebuggerUrl, `Application page did not open: ${logs}`);
    console.log('Smoke: application page found');
    const failures: string[] = [];
    const remote = await cdp.connect(page.webSocketDebuggerUrl, failures, false, 5000);
    socket = remote.socket;
    console.log('Smoke: DevTools connected');
    const send = remote.send;
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Network.enable');
    await send('Page.enable');
    let state: { ready?: string; appVisible?: boolean; joinVisible?: boolean; joinReady?: boolean; name?: string } | undefined;
    while (Date.now() < timeoutAt) {
      try {
        const result = await send('Runtime.evaluate', {
          // An element that does not exist yet (the initial blank document) is not visible.
          expression: "({ ready: document.readyState, appVisible: document.querySelector('#app')?.hidden === false, joinVisible: document.querySelector('#join-screen')?.hidden === false })",
          returnByValue: true,
        });
        state = result.result.value as typeof state;
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
      state = result.result.value as typeof state;
      if (state?.appVisible && state.name === 'UI Smoke') break;
      await delay(200);
    }
    assert(state?.appVisible && state.name === 'UI Smoke', `Chat screen did not render: ${JSON.stringify(state)}; ${failures.join('; ')}; ${logs}`);
    const chatScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-smoke-chat.png'), Buffer.from(chatScreenshot.data, 'base64'));
    const evaluate = <T = unknown,>(expression: string, awaitPromise = false) => remote.evaluate<T>(expression, awaitPromise);
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
    const setViewport = async (width: number, height: number) => {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      // The CDP reply can precede resize handlers/layout. Wait for rendering, not wall-clock time.
      const size = await evaluate<{ width: number; height: number; visibility: string }>(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() =>
        resolve({ width: innerWidth, height: innerHeight, visibility: document.visibilityState }))))`, true);
      assert(size.width === width && size.height === height, `Viewport did not resize: ${JSON.stringify(size)}`);
    };
    await setViewport(1100, 800);
    const detailLayout = await evaluate<{ inputBottom:number; saveTop:number; removeTop:number; saveBottom:number; removeBottom:number; saveRight:number; removeRight:number; detailRight:number; buttonHeight:number; buttonFont:number; contrast:number; overflow:boolean }>(`(() => {
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
    const fullWidthSave = await evaluate<boolean>(`(() => { const remove = document.querySelector('#contact-label-remove'); remove.hidden = true;
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
      settingsOpen = result.result.value === true;
      if (settingsOpen) break;
      await delay(200);
    }
    assert(settingsOpen, `Settings did not open: ${failures.join('; ')}; ${logs}`);
    await setViewport(375, 812);
    // Settings shows one category at a time: a check of a section first opens its category, as a person would.
    const showPane = (selector: string) => `document.querySelector('#settings-nav [aria-controls="' + document.querySelector('${selector}').closest('[role=tabpanel]').id + '"]').click();`;
    // A category scrolls on its own, so its overflow never reaches the dialog's scroll size.
    const settingsOverflow = "[dialog, document.querySelector('#settings-panes')].some(e => e.scrollWidth > e.clientWidth)";
    const narrow = await evaluate<{ viewport:number; left:number; right:number; dialogOverflow:boolean; pageOverflow:boolean; orientation:string|null; tabsAbove:boolean }>(`(() => { const dialog = document.querySelector('#settings-dialog');
      ${showPane('#notifications-form')}
      document.querySelector('#test-notification-button').textContent = 'Uji notifikasi sistem sekarang';
      document.querySelector('#notifications-form button[type="submit"]').textContent = 'Simpan semua pengaturan notifikasi';
      const rect = dialog.getBoundingClientRect(), nav = document.querySelector('#settings-nav'), tabs = nav.getBoundingClientRect();
      return { viewport: innerWidth, left: rect.left, right: rect.right, dialogOverflow: ${settingsOverflow},
        pageOverflow: document.documentElement.scrollWidth > innerWidth, orientation: nav.getAttribute('aria-orientation'),
        tabsAbove: tabs.right <= rect.right && tabs.bottom <= document.querySelector('#settings-panes').getBoundingClientRect().top + 1 }; })()`);
    // On a narrow window the categories become a row of tabs above the open one.
    assert(narrow.left >= 0 && narrow.right <= narrow.viewport && !narrow.dialogOverflow && !narrow.pageOverflow && narrow.orientation === 'horizontal' && narrow.tabsAbove,
      `Settings overflow in a narrow window: ${JSON.stringify(narrow)}`);
    await evaluate("document.querySelector('#notifications-form').scrollIntoView({ block: 'center' })");
    const narrowScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-settings-narrow.png'), Buffer.from(narrowScreenshot.data, 'base64'));
    const narrowShell = await evaluate<{ topbarOverflow:boolean; brandHeight:number; topbarHeight:number; pageOverflow:boolean }>(`(() => { document.querySelector('#settings-dialog').close();
      const topbar = document.querySelector('.topbar'); const brand = topbar.querySelector('strong');
      return { topbarOverflow: topbar.scrollWidth > topbar.clientWidth, brandHeight: brand.getBoundingClientRect().height, topbarHeight: topbar.getBoundingClientRect().height,
        pageOverflow: document.documentElement.scrollWidth > innerWidth }; })()`);
    assert(!narrowShell.topbarOverflow && !narrowShell.pageOverflow && narrowShell.brandHeight < narrowShell.topbarHeight,
      `Top bar overflows a narrow window: ${JSON.stringify(narrowShell)}`);
    const narrowChatScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-chat-narrow.png'), Buffer.from(narrowChatScreenshot.data, 'base64'));
    // Search filters the conversation list, so it sits on the list: in the sidebar above the filter tabs, and the top
    // bar stays one row at every width.
    for (const [width, height] of [[1100, 800], [375, 812], [320, 700]] as const) {
      await setViewport(width, height);
      const search = await evaluate<{ inSidebar:boolean; aboveTabs:boolean; inside:boolean; topbarHeight:number }>(`(() => {
        document.body.classList.add('show-list');
        const box = document.querySelector('.search-box'), sidebar = document.querySelector('.sidebar');
        const b = box.getBoundingClientRect(), t = sidebar.querySelector('.filter-bar').getBoundingClientRect(), s = sidebar.getBoundingClientRect();
        return { inSidebar: sidebar.contains(box), aboveTabs: b.height > 0 && b.bottom <= t.top + 1, inside: b.left >= s.left && b.right <= s.right,
          topbarHeight: document.querySelector('.topbar').getBoundingClientRect().height }; })()`);
      assert(search.inSidebar && search.aboveTabs && search.inside && search.topbarHeight <= 57, `Search is not on the conversation list at ${width} px: ${JSON.stringify(search)}`);
    }
    await setViewport(375, 812);
    // Focus from the main window: the real setting, start, status broadcast and restore, plus the shared select style
    // and long translated text in light/dark narrow windows.
    // One request may outlast a slow frame (the first CJK font fallback on a fresh CI machine took over 5 s on Windows);
    // the condition is then asked again until the wait's own deadline instead of failing on that request.
    const waitFor = async (expression: string, label: string, ms = 10_000) => {
      for (const end = Date.now() + ms; Date.now() < end; await delay(100)) {
        try { if (await evaluate<boolean>(expression, true)) return; }
        catch (error) { if (!(error instanceof Error && error.message.startsWith('Runtime.evaluate timed out'))) throw error; }
      }
      throw new Error(`Timed out: ${label}`);
    };
    await evaluate("document.querySelector('#settings-dialog').showModal(); document.querySelector('#focus-select').value = '25'; document.querySelector('#focus-select').dispatchEvent(new Event('change'))");
    await waitFor("window.lumilan.notificationSettings().then(s => s.focus === 25)", 'focus setting saved');
    const statusBefore = await evaluate<string>("window.lumilan.state().then(s => s.me.status)", true);
    await evaluate("document.querySelector('#focus-start').click()");
    await waitFor("window.lumilan.state().then(s => s.me.status === 'dnd' && !document.querySelector('#focus-end').hidden && document.querySelector('#focus-start').hidden)", 'focus session started');
    assert.match(await evaluate<string>("document.querySelector('#focus-status').textContent"), /\d/, 'Focus status did not show the end time');
    for (const width of [375, 320]) for (const theme of ['light', 'dark']) {
      await setViewport(width, 700);
      const focusLayout = await evaluate<{ appearance: string; arrow: string; paddingRight: number; inside: boolean; overflow: boolean; buttons: boolean; textOverlap: boolean }>(`(() => {
        document.documentElement.dataset.theme = '${theme}';
        document.querySelector('#focus-status').textContent = 'Focus session paused · 180 min left. Your previous status returns when the session ends.';
        document.querySelector('#focus-toggle').textContent = 'Resume focus session'; document.querySelector('#focus-end').textContent = 'Finish focus session now';
        const dialog = document.querySelector('#settings-dialog'), select = document.querySelector('#focus-select'), style = getComputedStyle(select);
        ${showPane('#focus-select')} select.closest('section').scrollIntoView({ block: 'center' });
        const box = dialog.getBoundingClientRect(), field = select.getBoundingClientRect();
        const buttons = [...select.closest('section').querySelectorAll('.dialog-actions button')].filter(button => !button.hidden).map(button => button.getBoundingClientRect());
        return { appearance: style.appearance, arrow: style.backgroundImage, paddingRight: parseFloat(style.paddingRight),
          inside: field.left >= box.left && field.right <= box.right, overflow: ${settingsOverflow},
          buttons: buttons.every(button => button.left >= box.left && button.right <= box.right),
          textOverlap: buttons.some((a, i) => buttons.some((b, j) => i < j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)) }; })()`);
      assert(['none', 'base-select'].includes(focusLayout.appearance) && focusLayout.arrow !== 'none' && focusLayout.paddingRight >= 32 && focusLayout.inside && !focusLayout.overflow && focusLayout.buttons && !focusLayout.textOverlap,
        `Focus settings are inconsistent at ${width} px in ${theme}: ${JSON.stringify(focusLayout)}`);
      await delay(400); // Let the theme's color transitions finish before the review screenshot.
      const focusShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
      writeFileSync(join(dist, `ui-audit-focus-${theme}-${width}.png`), Buffer.from(focusShot.data, 'base64'));
    }
    await evaluate("document.documentElement.dataset.theme = 'light'; document.querySelector('#focus-end').click()");
    await waitFor(`window.lumilan.state().then(s => s.me.status === ${JSON.stringify(statusBefore)} && !document.querySelector('#focus-start').hidden)`, 'focus session ended and status restored');
    await evaluate("document.querySelector('#focus-select').value = '0'; document.querySelector('#focus-select').dispatchEvent(new Event('change'))");
    await waitFor("window.lumilan.notificationSettings().then(s => s.focus === 0)", 'focus setting off');
    await evaluate("document.querySelector('#settings-dialog').close()");
    assert.equal(failures.length, 0, `Renderer errors after focus: ${failures.join('; ')}`);
    console.log('Focus: main-window start/end with status broadcast and restore, shared select style, light/dark 375/320 px passed');
    // Work breaks in Settings: lengths apply on change, the toggle turns reminders on, and the shared select style holds
    // with long translated text in light/dark narrow windows. The break screen itself is covered by the notch smoke.
    await setViewport(1100, 800);
    await evaluate("document.querySelector('#settings-button').click()");
    await waitFor("document.querySelector('#settings-dialog').open && document.querySelector('#break-work').options.length === 5 && document.querySelector('#break-length').options.length === 4", 'break settings filled');
    assert.deepEqual(await evaluate("window.lumilan.breaksState().then(v => [v.settings, v.phase])", true), [{ enabled: false, workMinutes: 45, breakMinutes: 10 }, 'work'], 'Breaks did not start off with their defaults');
    await evaluate("document.querySelector('#break-work').value = '30'; document.querySelector('#break-work').dispatchEvent(new Event('change'))");
    await waitFor("window.lumilan.breaksState().then(v => v.settings.workMinutes === 30 && !v.settings.enabled)", 'work length saved while off');
    await evaluate("document.querySelector('#break-enabled').click()");
    await waitFor("window.lumilan.breaksState().then(v => v.settings.enabled && v.nextAt > Date.now() + 29 * 60000 && /\\d/.test(document.querySelector('#break-status').textContent))", 'break reminders on with the next time shown');
    for (const width of [375, 320]) for (const theme of ['light', 'dark']) {
      await setViewport(width, 700);
      const breakLayout = await evaluate<{ appearance: string; arrow: string; paddingRight: number; inside: boolean; overflow: boolean; buttons: boolean }>(`(() => {
        document.documentElement.dataset.theme = '${theme}';
        document.querySelector('#break-status').textContent = 'Next break at 16:00 · a long translated line that must wrap inside the dialog without overlapping';
        const dialog = document.querySelector('#settings-dialog'), select = document.querySelector('#break-length'), style = getComputedStyle(select);
        ${showPane('#break-length')} select.closest('section').scrollIntoView({ block: 'center' });
        const box = dialog.getBoundingClientRect(), fields = [...select.closest('section').querySelectorAll('select')].map(field => field.getBoundingClientRect());
        const buttons = [...select.closest('section').querySelectorAll('.dialog-actions button')].map(button => button.getBoundingClientRect());
        return { appearance: style.appearance, arrow: style.backgroundImage, paddingRight: parseFloat(style.paddingRight),
          inside: fields.every(field => field.left >= box.left && field.right <= box.right), overflow: ${settingsOverflow},
          buttons: buttons.every(button => button.left >= box.left && button.right <= box.right) }; })()`);
      assert(['none', 'base-select'].includes(breakLayout.appearance) && breakLayout.arrow !== 'none' && breakLayout.paddingRight >= 32 && breakLayout.inside && !breakLayout.overflow && breakLayout.buttons,
        `Break settings are inconsistent at ${width} px in ${theme}: ${JSON.stringify(breakLayout)}`);
      await delay(400);
      const breakShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
      writeFileSync(join(dist, `ui-audit-breaks-${theme}-${width}.png`), Buffer.from(breakShot.data, 'base64'));
    }
    // Every language at the narrowest width: labels, lengths and the button stay inside the dialog.
    // The language is chosen in the open dialog, as a person would; the lengths must relabel without reopening it.
    const languageBefore = await evaluate<string>("document.querySelector('#language-select').value");
    const chooseLanguage = (value: string) => evaluate(`document.querySelector('#language-select').value = ${JSON.stringify(value)}; document.querySelector('#language-select').dispatchEvent(new Event('change'))`);
    let englishFooter = '';
    for (const language of ['en', 'ms', 'es', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'id']) {
      await setViewport(320, 700);
      const switched = Date.now();
      await chooseLanguage(language);
      await waitFor(`document.documentElement.lang === ${JSON.stringify(language)} && (document.querySelector('#break-work').options[0]?.textContent === '25 menit') === ${language === 'id'}`, `breaks relabeled in ${language}`, 30_000);
      if (Date.now() - switched > 2000) console.log(`Language switch to ${language} took ${((Date.now() - switched) / 1000).toFixed(1)} s`);
      // Breaks, and Lumi with its turn-off and hide wording.
      for (const id of ['#break-section', '#lumi-section']) {
        const fits = await evaluate<{ inside: boolean; overflow: boolean; clipped: string[] }>(`(() => {
          const dialog = document.querySelector('#settings-dialog'), section = document.querySelector('${id}');
          ${showPane(id)} section.scrollIntoView({ block: 'center' });
          const box = dialog.getBoundingClientRect(), parts = [...section.querySelectorAll('select, label, button, h3, small, .setting-note')].filter(e => e.getClientRects().length);
          return { inside: parts.every(e => { const b = e.getBoundingClientRect(); return b.left >= box.left && b.right <= box.right; }), overflow: ${settingsOverflow},
            clipped: [...section.querySelectorAll('select, button')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.id) }; })()`);
        assert(fits.inside && !fits.overflow && !fits.clipped.length, `${id} does not fit at 320 px in ${language}: ${JSON.stringify(fits)}`);
      }
      // The sidebar tabs stay whole at every width that shows the sidebar: the last one was once cut off behind a hidden scroll.
      // The footer relabels with the language instead of waiting for the next network event.
      for (const width of [1440, 1160, 980, 800, 390]) {
        await setViewport(width, 700);
        const sidebar = await evaluate<{ scrolls: boolean; cut: unknown[]; footer: string }>(`(() => {
          const listed = document.body.classList.contains('show-list'); document.body.classList.add('show-list');
          const bar = document.querySelector('.sidebar .filter-bar'), box = bar.getBoundingClientRect();
          const result = { scrolls: bar.scrollWidth > bar.clientWidth + 1, footer: document.querySelector('#connection-text').textContent,
            cut: [...bar.querySelectorAll('.filter')].map(tab => { const b = tab.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(tab);
              const text = range.getBoundingClientRect();
              return [tab.textContent, +(b.right - box.right).toFixed(2), +(text.right - box.right).toFixed(2), tab.scrollWidth - tab.clientWidth, bar.dataset.fit || '']; })
              // Text must be whole; the tab's own edge may lose under a pixel of padding, the tolerance fitFilterBar allows.
              .filter(([, tabOut, textOut, inner]) => tabOut > 1 || textOut > 0 || inner > 1) };
          document.body.classList.toggle('show-list', listed);
          return result; })()`);
        assert(!sidebar.scrolls && !sidebar.cut.length, `Sidebar tabs cut off at ${width} px in ${language}: ${JSON.stringify(sidebar)}`);
        // The Settings categories are a fixed-width column on wide windows: every translated label fits whole.
        if (width > 700) assert.deepEqual(await evaluate<string[]>("[...document.querySelectorAll('#settings-nav [role=tab] > span:last-child')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent)"), [],
          `Settings categories cut off at ${width} px in ${language}`);
        if (language === 'en') englishFooter = sidebar.footer;
        else assert.notEqual(sidebar.footer, englishFooter, `Footer stayed in English after switching to ${language}`);
      }
    }
    await chooseLanguage(languageBefore);
    await waitFor(`document.querySelector('#language-select').value === ${JSON.stringify(languageBefore)}`, 'language restored');
    await evaluate("document.documentElement.dataset.theme = 'light'; document.querySelector('#break-enabled').click()");
    await waitFor("window.lumilan.breaksState().then(v => !v.settings.enabled && v.nextAt === undefined)", 'break reminders off');
    // Lumi has its own section and saves each change at once, without the Notifications form; restored afterwards.
    const lumiBefore = await evaluate<string>("window.lumilan.notificationSettings().then(s => s.notchIdle)", true);
    const chooseIdle = (value: string) => evaluate(`document.querySelector('#notch-idle-select').value = ${JSON.stringify(value)}; document.querySelector('#notch-idle-select').dispatchEvent(new Event('change'))`);
    await chooseIdle(lumiBefore === 'away' ? 'always' : 'away');
    await waitFor(`window.lumilan.notificationSettings().then(s => s.notchIdle === ${JSON.stringify(lumiBefore === 'away' ? 'always' : 'away')})`, 'Lumi section saves at once');
    await chooseIdle(lumiBefore);
    await waitFor(`window.lumilan.notificationSettings().then(s => s.notchIdle === ${JSON.stringify(lumiBefore)})`, 'Lumi setting restored');
    await evaluate("document.querySelector('#settings-dialog').close()");
    assert.equal(failures.length, 0, `Renderer errors after breaks: ${failures.join('; ')}`);
    console.log('Breaks: main-window lengths and toggle, shared select style, light/dark 375/320 px passed; sidebar tabs and footer in 8 languages at 1440–390 px passed; Lumi section fits and saves at once');
    // Routine and Tasks in Settings: the main-window home of Lumi's pages for Wayland and for people who turn Lumi off.
    await setViewport(1100, 800);
    await evaluate("document.querySelector('#settings-button').click()");
    await waitFor("document.querySelector('#settings-dialog').open && document.querySelector('#routine-serving').options.length > 0 && document.querySelector('#routine-end').options.length === 24", 'routine settings filled');
    await evaluate(`(() => { for (const [id, value] of [['#routine-serving', '250'], ['#routine-goal', '1500'], ['#routine-start', '8'], ['#routine-end', '22'], ['#routine-interval', '60']])
      document.querySelector(id).value = value; document.querySelector('#routine-enabled').checked = true; document.querySelector('#routine-save').click(); })()`);
    await waitFor("window.lumilan.routineState().then(v => v.settings.enabled && v.settings.goalMl === 1500 && v.settings.intervalMinutes === 60)", 'routine saved');
    await evaluate("document.querySelector('#routine-start').value = '20'; document.querySelector('#routine-end').value = '9'; document.querySelector('#routine-save').click()");
    await delay(300);
    assert.equal(await evaluate<number>("window.lumilan.routineState().then(v => v.settings.startHour)", true), 8, 'An end time before the start time was saved');
    await evaluate("document.querySelector('#routine-drink').click()");
    await waitFor("window.lumilan.routineState().then(v => v.todayMl === 250 && /0[.,][23]/.test(document.querySelector('#routine-status').textContent))", 'drink logged in Settings');
    await evaluate("document.querySelector('#tasks-title').value = 'Kirim laporan mingguan'; document.querySelector('#tasks-form').requestSubmit()");
    await waitFor("window.lumilan.tasksState().then(v => v.total === 1 && document.querySelectorAll('#tasks-list li').length === 1)", 'task added');
    await evaluate("document.querySelector('#tasks-list input').click()");
    await waitFor("window.lumilan.tasksState().then(v => v.done === 1 && document.querySelector('#tasks-list li').classList.contains('done'))", 'task done');
    // A due time is backed by a local reminder; removing the due time withdraws it.
    await evaluate(`(() => { const d = new Date(Date.now() + 2 * 3600_000), p = n => String(n).padStart(2, '0');
      document.querySelector('#tasks-title').value = 'Tugas berwaktu'; document.querySelector('#tasks-due').value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
      document.querySelector('#tasks-form').requestSubmit(); })()`);
    await waitFor("window.lumilan.reminders().then(r => r.some(x => x.title === 'Tugas berwaktu' && x.status === 'scheduled'))", 'due task scheduled as a reminder');
    await evaluate("[...document.querySelectorAll('#tasks-list li')].find(li => li.textContent.includes('Tugas berwaktu')).querySelector('.task-actions button').click()");
    await waitFor("!document.querySelector('#tasks-cancel').hidden && document.querySelector('#tasks-title').value === 'Tugas berwaktu' && document.querySelector('#tasks-due').value !== ''", 'task edit form');
    await evaluate("document.querySelector('#tasks-due').value = ''; document.querySelector('#tasks-form').requestSubmit()");
    await waitFor("window.lumilan.reminders().then(r => !r.some(x => x.title === 'Tugas berwaktu') && document.querySelector('#tasks-cancel').hidden)", 'removing the due time withdrew the reminder');
    for (const width of [375, 320]) for (const theme of ['light', 'dark']) {
      await setViewport(width, 700);
      const pageLayout = await evaluate<{ appearance: string; arrow: string; paddingRight: number; inside: boolean; overflow: boolean; rows: boolean; buttons: boolean }>(`(() => {
        document.documentElement.dataset.theme = '${theme}';
        document.querySelector('#routine-status').textContent = 'Today 0.3 of 1.5 L · Next at 16:00 · a long translated line that must wrap inside the dialog';
        const dialog = document.querySelector('#settings-dialog'), select = document.querySelector('#routine-interval'), style = getComputedStyle(select);
        ${showPane('#tasks-section')} document.querySelector('#tasks-section').scrollIntoView({ block: 'center' });
        const box = dialog.getBoundingClientRect(), field = select.getBoundingClientRect();
        const rows = [...document.querySelectorAll('#tasks-list li')].map(row => row.getBoundingClientRect());
        const buttons = [...document.querySelectorAll('#tasks-list button, #routine-section .dialog-actions button, #tasks-form button')].filter(button => !button.hidden).map(button => button.getBoundingClientRect());
        return { appearance: style.appearance, arrow: style.backgroundImage, paddingRight: parseFloat(style.paddingRight),
          inside: field.left >= box.left && field.right <= box.right, overflow: ${settingsOverflow},
          rows: rows.every(row => row.left >= box.left && row.right <= box.right),
          buttons: buttons.every(button => button.left >= box.left && button.right <= box.right) && !buttons.some((a, i) => buttons.some((b, j) => i < j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)) }; })()`);
      assert(['none', 'base-select'].includes(pageLayout.appearance) && pageLayout.arrow !== 'none' && pageLayout.paddingRight >= 32 && pageLayout.inside && !pageLayout.overflow && pageLayout.rows && pageLayout.buttons,
        `Routine and Tasks settings are inconsistent at ${width} px in ${theme}: ${JSON.stringify(pageLayout)}`);
      await delay(400);
      const pageShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
      writeFileSync(join(dist, `ui-audit-routine-tasks-${theme}-${width}.png`), Buffer.from(pageShot.data, 'base64'));
    }
    await evaluate("document.documentElement.dataset.theme = 'light'");
    await evaluate("window.lumilan.tasksState().then(async v => { for (const item of v.items) await window.lumilan.tasks({ action: 'delete', value: item.id }); })");
    await evaluate(`window.lumilan.routine({ action: 'settings', value: { enabled: false, servingMl: 250, goalMl: 2000, startHour: 8, endHour: 22, intervalMinutes: 60 } })`);
    await waitFor("window.lumilan.tasksState().then(v => v.total === 0 && document.querySelectorAll('#tasks-list li').length === 0)", 'tasks cleaned up');
    await evaluate("document.querySelector('#settings-dialog').close()");
    assert.equal(failures.length, 0, `Renderer errors after routine and tasks: ${failures.join('; ')}`);
    console.log('Routine and Tasks: Settings save/validation, drink, add/done/edit/delete, due task reminder link, shared select style, light/dark 375/320 px passed');
    // Settings → Shelf: the main-window home of Lumi's shelf. A file dropped here is listed, opened and removed; the file stays.
    const shelfFile = join(profile, 'smoke-shelf.txt');
    writeFileSync(shelfFile, 'Lumilan shelf smoke');
    await setViewport(1100, 800);
    await evaluate("document.querySelector('#settings-button').click()");
    await waitFor("document.querySelector('#settings-dialog').open && document.querySelectorAll('#shelf-items li.empty').length === 1", 'empty shelf in Settings');
    await evaluate("(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'smoke-shelf-input'; input.hidden = true; document.querySelector('#shelf-section').append(input); return true; })()");
    const shelfDom = await send('DOM.getDocument');
    const shelfNode = await send('DOM.querySelector', { nodeId: shelfDom.root.nodeId, selector: '#smoke-shelf-input' });
    await send('DOM.setFileInputFiles', { nodeId: shelfNode.nodeId, files: [shelfFile] });
    await evaluate(`(() => { const d = new DataTransfer(); d.items.add(document.querySelector('#smoke-shelf-input').files[0]); const zone = document.querySelector('#shelf-drop-zone');
      for (const type of ['dragenter', 'dragover', 'drop']) zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: d })); return true; })()`);
    await waitFor("window.lumilan.shelf({ op: 'list' }).then(v => v.items.length === 1 && v.items[0].name === 'smoke-shelf.txt' && document.querySelectorAll('#shelf-items li:not(.empty)').length === 1)", 'file shelved from Settings');
    assert(!(await evaluate<string>("window.lumilan.shelf({ op: 'list' }).then(v => JSON.stringify(v))", true)).includes('lumilan-ui-smoke-'), 'A path reached the Settings view');
    for (const theme of ['light', 'dark']) {
      await setViewport(320, 700);
      const shelfLayout = await evaluate<{ inside: boolean; overflow: boolean }>(`(() => { document.documentElement.dataset.theme = '${theme}';
        const dialog = document.querySelector('#settings-dialog'), box = dialog.getBoundingClientRect(); ${showPane('#shelf-section')} document.querySelector('#shelf-section').scrollIntoView({ block: 'center' });
        const parts = [document.querySelector('#shelf-drop-zone'), ...document.querySelectorAll('#shelf-items li, #shelf-items button')].map(e => e.getBoundingClientRect());
        return { inside: parts.every(r => r.left >= box.left && r.right <= box.right), overflow: ${settingsOverflow} }; })()`);
      assert(shelfLayout.inside && !shelfLayout.overflow, `Settings shelf overflows at 320 px in ${theme}: ${JSON.stringify(shelfLayout)}`);
      await delay(400);
      const shelfShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
      writeFileSync(join(dist, `ui-audit-shelf-${theme}-320.png`), Buffer.from(shelfShot.data, 'base64'));
    }
    await evaluate("document.documentElement.dataset.theme = 'light'; [...document.querySelectorAll('#shelf-items .task-actions button')][1].click()");
    await waitFor("window.lumilan.shelf({ op: 'list' }).then(v => v.items.length === 0 && document.querySelectorAll('#shelf-items li.empty').length === 1)", 'shelf item removed in Settings');
    assert(existsSync(shelfFile), 'Removing from the shelf deleted the file');
    await evaluate("document.querySelector('#settings-dialog').close()");
    assert.equal(failures.length, 0, `Renderer errors after the Settings shelf: ${failures.join('; ')}`);
    console.log('Shelf: Settings drop, list without paths, remove keeps the file, light/dark 320 px passed');
    await setViewport(320, 700);
    const minimumShell = await evaluate<{ topbarOverflow:boolean; pageOverflow:boolean }>(`(() => { const topbar = document.querySelector('.topbar');
      return { topbarOverflow: topbar.scrollWidth > topbar.clientWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth }; })()`);
    assert(!minimumShell.topbarOverflow && !minimumShell.pageOverflow, `Top bar overflows at 320 px: ${JSON.stringify(minimumShell)}`);
    await setViewport(1100, 800);
    await evaluate("document.querySelector('#settings-dialog').showModal()");
    const avatarResult = await send('Runtime.evaluate', {
      expression: "(async () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; canvas.getContext('2d').fillRect(0, 0, 2, 2); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); const { readAvatar } = await import('/avatar.js'); return readAvatar(new File([blob], 'smoke.png', { type: 'image/png' }), value => value); })()",
      awaitPromise: true,
      returnByValue: true,
    });
    assert.match(String(avatarResult.result.value), /^data:image\/webp;base64,/, `Avatar processing failed: ${JSON.stringify(avatarResult.exceptionDetails)}`);
    assert.equal(failures.length, 0, `Renderer errors: ${failures.join('; ')}`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-smoke.png'), Buffer.from(screenshot.data, 'base64'));
    const roomLayout = await evaluate<{ open:boolean; right:number; viewport:number; overflow:boolean; gap:number; appearance:string; arrow:string; paddingRight:number }>(`(() => { document.querySelector('#settings-dialog').close();
      document.documentElement.dataset.theme = 'light'; document.querySelector('#create-room-button').click();
      const dialog = document.querySelector('#room-dialog'); const select = getComputedStyle(document.querySelector('#room-type'));
      const rect = dialog.getBoundingClientRect();
      const gap = document.querySelector('#room-type').getBoundingClientRect().top - document.querySelector('label[for="room-type"]').getBoundingClientRect().bottom;
      return { open: dialog.open, right: rect.right, viewport: innerWidth, overflow: dialog.scrollWidth > dialog.clientWidth,
        gap, appearance: select.appearance, arrow: select.backgroundImage, paddingRight: parseFloat(select.paddingRight) }; })()`);
    assert(roomLayout.open && roomLayout.right <= roomLayout.viewport && !roomLayout.overflow &&
      roomLayout.gap >= 6.5 && ['none', 'base-select'].includes(roomLayout.appearance) && roomLayout.arrow !== 'none' && roomLayout.paddingRight >= 32,
      `Room dialog or select control is inconsistent: ${JSON.stringify(roomLayout)}`);
    const roomScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-room-light.png'), Buffer.from(roomScreenshot.data, 'base64'));
    await setViewport(320, 700);
    for (const theme of ['light', 'dark']) {
      const narrowRoom = await evaluate<{gap:number;overflow:boolean}>(`(() => {
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
    const transientControls = await evaluate<{ buttons:Array<{text:string;height:number;left:number;right:number;font:number}>; callLeft:number;callRight:number;overflow:boolean;motionSafe:boolean }>(`(() => {
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
    const dragStart = await evaluate<{left:number;top:number;x:number;y:number}>(`(() => { const card = document.querySelector('#call-panel').getBoundingClientRect();
      const handle = document.querySelector('#call-drag').getBoundingClientRect();
      return { left: card.left, top: card.top, x: Math.floor(handle.left + handle.width / 2), y: Math.floor(handle.top + handle.height / 2) }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x, y: dragStart.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragStart.x, y: dragStart.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x - 50, y: dragStart.y + 150, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragStart.x - 50, y: dragStart.y + 150, button: 'left', clickCount: 1 });
    const dragged = await evaluate<{left:number;top:number;right:number;bottom:number}>(`(() => { const rect = document.querySelector('#call-panel').getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; })()`);
    assert(dragged.top > dragStart.top + 100 && dragged.left < dragStart.left && dragged.left >= 8 && dragged.right <= 312 && dragged.bottom <= 692,
      `Call card did not drag or stay in the viewport: ${JSON.stringify({ dragStart, dragged })}`);
    await evaluate("document.querySelector('#call-drag').focus()");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
    const keyboardTop = await evaluate<number>("document.querySelector('#call-panel').getBoundingClientRect().top");
    assert.equal(keyboardTop, dragged.top - 20, 'Arrow keys did not move the call card');
    await setViewport(320, 240);
    const resized = await evaluate<{left:number;top:number;right:number;bottom:number;height:number;visibility:string;position:string}>(`(() => { const rect = document.querySelector('#call-panel').getBoundingClientRect();
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
      noteCount = await evaluate<number>("document.querySelectorAll('#messages .message').length");
      if (noteCount === 40) break;
      await delay(100);
    }
    assert.equal(noteCount, 40, 'Scroll test messages did not render');
    const oldPosition = await evaluate<{id:string;top:number;rowTop:number;distance:number}>(`(() => { const list = document.querySelector('#messages');
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
      reacted = await evaluate<boolean>(`Boolean(document.querySelector('#${oldPosition.id} .message-reactions button'))`);
      if (reacted) break;
      await delay(100);
    }
    assert(reacted, 'Reaction did not appear on the older message');
    const reactionPosition = await evaluate<{top:number;rowTop:number}>(`(() => { const list = document.querySelector('#messages');
      return { top: list.scrollTop, rowTop: document.querySelector('#${oldPosition.id}').getBoundingClientRect().top }; })()`);
    assert(Math.abs(reactionPosition.top - oldPosition.top) <= 2 && Math.abs(reactionPosition.rowTop - oldPosition.rowTop) <= 5,
      `Reacting to an older message changed the viewport: ${JSON.stringify({ oldPosition, reactionPosition })}`);
    await evaluate(`document.querySelector('#${oldPosition.id} .message-reactions button').click()`);
    while (Date.now() < timeoutAt) {
      reacted = await evaluate<boolean>(`Boolean(document.querySelector('#${oldPosition.id} .message-reactions button'))`);
      if (!reacted) break;
      await delay(100);
    }
    assert(!reacted, 'Reaction chip did not toggle off');
    const afterToggle = await evaluate<number>("document.querySelector('#messages').scrollTop");
    assert(Math.abs(afterToggle - oldPosition.top) <= 2, `Toggling a reaction chip changed the viewport: ${afterToggle}`);
    await send('Runtime.evaluate', { expression: "window.lumilan.note('Pesan baru tanpa menggeser pembaca')", awaitPromise: true });
    while (Date.now() < timeoutAt) {
      noteCount = await evaluate<number>("document.querySelectorAll('#messages .message').length");
      if (noteCount === 41) break;
      await delay(100);
    }
    assert.equal(noteCount, 41, 'New message did not render');
    const afterIncoming = await evaluate<number>("document.querySelector('#messages').scrollTop");
    assert(Math.abs(afterIncoming - oldPosition.top) <= 2, `A new message moved a reader away from older messages: ${afterIncoming}`);
    await evaluate("document.querySelector('#messages').scrollTop = document.querySelector('#messages').scrollHeight");
    await send('Runtime.evaluate', { expression: "window.lumilan.note('Pesan baru saat pembaca di bawah')", awaitPromise: true });
    while (Date.now() < timeoutAt) {
      noteCount = await evaluate<number>("document.querySelectorAll('#messages .message').length");
      if (noteCount === 42) break;
      await delay(100);
    }
    const bottomDistance = await evaluate<number>("(() => { const list = document.querySelector('#messages'); return list.scrollHeight - list.scrollTop - list.clientHeight })()");
    assert.equal(noteCount, 42, 'Newest message did not render');
    assert(bottomDistance <= 2, `Chat did not follow new messages while already at the bottom: ${bottomDistance}`);
    // Offscreen contacts must not give their visually hidden status labels a document-sized containing block.
    const scrollState = await evaluate<{theme:string;list:boolean}>(`(() => {
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
        for (const [width, height, list] of [[1100, 800, false], [1100, 480, false], [320, 700, false], [320, 700, true]] as const) {
          await evaluate(`document.documentElement.dataset.theme = '${theme}'; document.body.classList.toggle('show-list', ${list})`);
          await setViewport(width, height);
          const scrollLayout = await evaluate<{height:number;documentHeight:number;scrollY:number;controls:boolean;detailsEnd:boolean;internal:Array<{name:string;top:number;independent:boolean}>;focusedContact:boolean;statusLabels:boolean}>(`(() => {
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
    // Preserve the exact multiline draft when the shared message renderer creates a bubble.
    await evaluate("document.querySelector('#message-input').focus()");
    for (const [index, text] of ['test', 'satu', 'dua'].entries()) {
      if (index) for (let line = 0; line < 2; line++) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8, text: '\r', unmodifiedText: '\r' });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 });
      }
      await send('Input.insertText', { text });
    }
    const multiline = 'test\n\nsatu\n\ndua';
    assert.equal(await evaluate("document.querySelector('#message-input').value"), multiline, 'Shift+Enter changed the multiline draft');
    await evaluate("document.querySelector('#message-form').requestSubmit()");
    let multilineNote: Message | undefined;
    for (let attempt = 0; attempt < 100 && !multilineNote; attempt++) {
      multilineNote = await evaluate<Message | undefined>(`window.lumilan.state().then(state=>state.messages.find(message=>message.text===${JSON.stringify(multiline)}))`, true);
      if (!multilineNote) await delay(100);
    }
    assert(multilineNote, 'The submitted multiline message was not stored intact');
    for (const theme of ['light', 'dark']) for (const width of [1100, 320]) {
      await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.classList.remove('show-list')`);
      await setViewport(width, 800);
      const lines = await evaluate<{breaks:number;positions:number[];lineHeight:number}|null>(`(()=>{const paragraph=document.querySelector('#message-${multilineNote.id} .message-markdown p');
        if(!paragraph)return null;
        const positions=Array.from(paragraph.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE&&node.textContent).map(node=>{
          const range=document.createRange();range.selectNodeContents(node);return range.getBoundingClientRect().top;
        });return{breaks:paragraph.querySelectorAll('br').length,positions,lineHeight:parseFloat(getComputedStyle(paragraph).lineHeight)};})()`);
      assert(lines && lines.breaks === 4 && lines.positions.length === 3 && lines.positions.every((top, index) => !index ||
        Math.abs(top - lines.positions[index - 1]! - 2 * lines.lineHeight) < 2), `Multiline message collapsed (${theme}, ${width}px): ${JSON.stringify(lines)}`);
    }
    await setViewport(1100, 800);
    console.log('Message line breaks: native Shift+Enter, stored draft and five-line bubble passed in light/dark desktop/narrow layouts');
    // Escape leaves the open conversation like WhatsApp or Telegram, after what sits on top of it: a dialog, then a reply.
    // The draft stays, focus lands on the conversation's row, and a narrow window shows the list.
    const pressEscape = async () => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    };
    const notesOpen = "document.querySelector('#notes-button').classList.contains('active')";
    await evaluate("document.querySelector('#message-input').value='Esc draft';document.querySelector('#message-input').focus();document.querySelector('#settings-dialog').showModal()");
    await pressEscape();
    assert(await evaluate(`!document.querySelector('#settings-dialog').open&&${notesOpen}`), 'Escape in a dialog also closed the conversation');
    await evaluate(`document.querySelector('#message-${multilineNote.id} .message-select-button').click();document.querySelector('#selection-reply').click()`);
    assert(await evaluate("!document.querySelector('#reply-preview').hidden"), 'The reply did not start');
    await pressEscape();
    assert(await evaluate(`document.querySelector('#reply-preview').hidden&&${notesOpen}`), 'Escape closed the conversation before canceling the reply');
    await pressEscape();
    const home = await evaluate<{open:boolean;composer:boolean;focus:boolean;list:boolean}>(`({open:${notesOpen},composer:!document.querySelector('#message-form').hidden,
      focus:document.activeElement===document.querySelector('#notes-button'),list:document.body.classList.contains('show-list')})`);
    assert(!home.open && !home.composer && home.focus && home.list, `Escape did not return to the home view: ${JSON.stringify(home)}`);
    await evaluate("document.querySelector('#notes-button').click()");
    assert.equal(await evaluate("document.querySelector('#message-input').value"), 'Esc draft', 'Escape lost the conversation draft');
    await evaluate("document.querySelector('#message-input').value=''");
    console.log('Escape: dialog and reply first, then the home view with the draft kept, focus on the row and the list on narrow windows');
    const droppedBytes = Buffer.alloc(21 * 1024 * 1024, 0x5a);
    const droppedPaths: [string, string] = [join(profile, 'drop-large.bin'), join(profile, 'laporan_日本語.txt')];
    writeFileSync(droppedPaths[0], droppedBytes);
    writeFileSync(droppedPaths[1], 'Native file drop');
    const dragData = { items: [], files: droppedPaths, dragOperationsMask: 1 };
    const dropPoint = async () => evaluate<{x:number;y:number}>(`(()=>{const rect=document.querySelector('#messages').getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()`);
    await evaluate("document.querySelector('#message-input').value='Keep this draft';document.body.classList.remove('show-list')");
    for (const theme of ['light','dark']) for (const width of [1100,320]) {
      await setViewport(width,800);
      await evaluate(`document.documentElement.dataset.theme='${theme}'`);
      const point = await dropPoint();
      await send('Input.dispatchDragEvent', { type: 'dragEnter', ...point, data: dragData });
      await send('Input.dispatchDragEvent', { type: 'dragOver', ...point, data: dragData });
      const overlay = await evaluate<{visible:boolean;title:string;inBounds:boolean;noOuterScroll:boolean}>(`(()=>{const element=document.querySelector('#file-drop-overlay'),rect=element.getBoundingClientRect();return{visible:!element.hidden,title:document.querySelector('#file-drop-title').textContent,inBounds:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight,noOuterScroll:document.scrollingElement.scrollHeight<=innerHeight+1};})()`);
      assert(overlay.visible && overlay.inBounds && overlay.noOuterScroll && /menyimpan|save files/.test(overlay.title), `Drop feedback failed (${theme}, ${width}px): ${JSON.stringify(overlay)}`);
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(join(dist, `ui-audit-drop-${theme}-${width}.png`), Buffer.from(screenshot.data,'base64'));
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      // CDP dragCancel resets its injected drag without emitting DOM dragleave/dragend.
      await send('Input.dispatchDragEvent', { type: 'dragCancel', ...point, data: dragData });
      assert(await evaluate("document.querySelector('#file-drop-overlay').hidden"), 'Escape-canceled drag left drop feedback visible');
    }
    await setViewport(1100,800);
    const point = await dropPoint();
    for (const type of ['dragEnter','dragOver','drop']) await send('Input.dispatchDragEvent', { type, ...point, data: dragData });
    let droppedMessages: Message[] = [];
    while (Date.now() < timeoutAt) {
      droppedMessages = await evaluate<Message[]>("window.lumilan.state().then(state=>state.messages.filter(message=>message.note&&['drop-large.bin','laporan_日本語.txt'].includes(message.name)))", true);
      if (droppedMessages.length === 2 && await evaluate("document.querySelector('#transfer-progress').hidden")) break;
      await delay(30);
    }
    assert.equal(droppedMessages.length,2,'Native multi-file body drop did not store both files');
    const droppedLarge = droppedMessages.find(message=>message.name==='drop-large.bin'); assert(droppedLarge);
    assert.equal(createHash('sha256').update(readFileSync(join(profile,'lumilan','files',droppedLarge.id))).digest('hex'),createHash('sha256').update(droppedBytes).digest('hex'),'Large dropped file content changed during local saving');
    assert(await evaluate("document.querySelector('#message-input').value==='Keep this draft'&&document.querySelector('#file-drop-overlay').hidden"),'Drop cleared the draft or left feedback visible');
    const beforeRejectedDrop = await evaluate<number>('window.lumilan.state().then(state=>state.messages.length)', true);
    for (const target of [await evaluate<{x:number;y:number}>("(()=>{const r=document.querySelector('.sidebar').getBoundingClientRect();return{x:r.left+20,y:r.top+20};})()"), point]) {
      const data = target === point ? { ...dragData, files: [profile, droppedPaths[0]] } : dragData;
      for (const type of ['dragEnter','dragOver','drop']) await send('Input.dispatchDragEvent', { type, ...target, data });
    }
    assert.equal(await evaluate('window.lumilan.state().then(state=>state.messages.length)', true),beforeRejectedDrop,'Outside/folder drop sent a partial selection');
    await evaluate("document.querySelector('#message-input').value=''");
    console.log('File drop: real disk-backed 21 MB binary and Unicode-named file saved with SHA-256; draft, canceled drag, folder/outside rejection and light/dark narrow feedback passed');
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
    let gifPreview: string | null | undefined;
    while (Date.now() < timeoutAt) {
      gifPreview = await evaluate<string | null>(`(() => { const row = [...document.querySelectorAll('#messages .message')]
        .find(item => item.textContent.includes('smoke-animated.gif')); row?.scrollIntoView({ block: 'nearest' }); const image = row?.querySelector('.image-preview');
        return image?.complete && image.naturalWidth ? image.src : null; })()`);
      if (gifPreview) break;
      await delay(100);
    }
    assert(gifPreview);
    assert.match(gifPreview || '', /^data:image\/webp;base64,/, 'Animated GIF preview did not render');
    assert.equal((await sharp(Buffer.from(gifPreview.split(',')[1]!, 'base64')).metadata()).pages, 2);
    const gifPosition = await evaluate<{x:number;y:number;width:number;height:number}>(`(() => { const image = [...document.querySelectorAll('#messages .message')]
      .find(item => item.textContent.includes('smoke-animated.gif')).querySelector('.image-preview');
      image.scrollIntoView({ block: 'center' }); const bounds = image.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, width: innerWidth, height: innerHeight }; })()`);
    // Screenshot latency can repeatedly sample one phase of a loop. Inspect actual
    // compositor frames, acknowledging promptly so capture does not stall playback.
    const gifFrames: string[] = [], playbackColors = new Set<string>(); let red = false, white = false;
    const onGifFrame = (event: MessageEvent<unknown>) => {
      const message = cdp.cdpEvent(event.data);
      if (message?.method !== 'Page.screencastFrame' || typeof message.params.data !== 'string' || typeof message.params.sessionId !== 'number') return;
      if (gifFrames.length < 8) gifFrames.push(message.params.data);
      send('Page.screencastFrameAck', { sessionId: message.params.sessionId }).catch(error => failures.push(error instanceof Error ? error.message : String(error)));
    };
    socket.addEventListener('message', onGifFrame);
    try {
      await send('Page.startScreencast', { format: 'png', maxWidth: gifPosition.width, maxHeight: gifPosition.height, everyNthFrame: 1 });
      const playbackDeadline = Date.now() + 5000;
      while (Date.now() < playbackDeadline && !(red && white)) {
        const frame = gifFrames.shift();
        if (!frame) { await delay(20); continue; }
        const screenshot = sharp(Buffer.from(frame, 'base64')), size = await screenshot.metadata();
        const pixel = await screenshot.extract({ left: Math.floor(gifPosition.x * size.width! / gifPosition.width),
          top: Math.floor(gifPosition.y * size.height! / gifPosition.height), width: 1, height: 1 }).raw().toBuffer();
        playbackColors.add(pixel.subarray(0, 3).join(','));
        red ||= pixel[0]! > 220 && pixel[1]! < 30 && pixel[2]! < 30;
        white ||= pixel[0]! > 220 && pixel[1]! > 220 && pixel[2]! > 220;
      }
    } finally {
      await send('Page.stopScreencast');
      socket.removeEventListener('message', onGifFrame);
    }
    assert(red && white, `Animated GIF did not move in Chromium: ${JSON.stringify([...playbackColors])}`);
    const gifDialog = await evaluate<{open:boolean;samePreview:boolean}>(`(() => { const row = [...document.querySelectorAll('#messages .message')]
      .find(item => item.textContent.includes('smoke-animated.gif')); row.querySelector('.image-preview-button').click();
      return { open: document.querySelector('#image-dialog').open,
        samePreview: document.querySelector('#image-dialog-image').src === row.querySelector('.image-preview').src }; })()`);
    assert(gifDialog.open && gifDialog.samePreview, `Animated GIF dialog failed: ${JSON.stringify(gifDialog)}`);
    const gifScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
    writeFileSync(join(dist, 'ui-audit-gif-preview.png'), Buffer.from(gifScreenshot.data, 'base64'));
    const previewCenter = await evaluate<{x:number;y:number}>(`(() => { const rect = document.querySelector('#image-dialog-image').getBoundingClientRect();
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
    const quickReopen = await evaluate<{open:boolean;samePreview:boolean}>(`new Promise(resolve => {
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
    const pressKey = async (key: string, code: string, windowsVirtualKeyCode: number) => {
      // Enter's generated character is needed for native HTML button activation.
      const text = key === 'Enter' ? '\r' : undefined;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, text, unmodifiedText: text });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    };
    const capturePolish = async (name: string) => {
      if (process.env.LUMILAN_UI_SCREENSHOTS !== '1') return;
      await settleAnimations();
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
      writeFileSync(join(dist, `ui-polish-${name}.png`), Buffer.from(shot.data, 'base64'));
    };
    const originalTheme = await evaluate<string>('document.documentElement.dataset.theme');
    await setViewport(1100, 800);
    await evaluate(`(() => { const input = document.querySelector('#message-input'); input.value = 'AB';
      input.setSelectionRange(1, 1); input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#emoji-button').click(); })()`);
    const emojiLayout = await evaluate<{open:boolean;count:number;unique:number;accessible:boolean;focusedFirst:boolean;expanded:string;scrollable:boolean;overflowX:boolean;finiteMotion:boolean;top:number;left:number;right:number;bottom:number}>(`(() => { const picker = document.querySelector('#emoji-picker');
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
    const lastEmoji = await evaluate<{emoji:string;focused:boolean;scroll:number;inside:boolean}>(`(() => { const picker = document.querySelector('#emoji-picker');
      const last = picker.lastElementChild, a = last.getBoundingClientRect(), b = picker.getBoundingClientRect();
      return { emoji: last.dataset.emoji, focused: document.activeElement === last, scroll: picker.scrollTop,
        inside: a.top >= b.top && a.bottom <= b.bottom + 1 }; })()`);
    assert(lastEmoji.focused && lastEmoji.scroll > 0 && lastEmoji.inside, `Last emoji is unreachable: ${JSON.stringify(lastEmoji)}`);
    const emojiMessageCount = await evaluate<number>("document.querySelectorAll('#messages .message').length");
    await pressKey('Enter', 'Enter', 13);
    const insertedEmoji = await evaluate<{value:string;caret:number;focused:boolean;closed:boolean;expanded:string;count:number}>(`(() => { const input = document.querySelector('#message-input');
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
    const shortEmoji = await evaluate<{open:boolean;top:number;bottom:number;left:number;right:number;scrollable:boolean;overflow:boolean}>(`(() => { const picker = document.querySelector('#emoji-picker'), r = picker.getBoundingClientRect();
      return { open: !picker.hidden, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
        scrollable: picker.scrollHeight > picker.clientHeight, overflow: document.documentElement.scrollWidth > innerWidth }; })()`);
    assert(shortEmoji.open && shortEmoji.top >= 7 && shortEmoji.bottom <= 480 && shortEmoji.left >= 0 && shortEmoji.right <= 320 &&
      shortEmoji.scrollable && !shortEmoji.overflow, `Emoji picker escaped after resizing: ${JSON.stringify(shortEmoji)}`);
    await pressKey('Escape', 'Escape', 27);
    await evaluate("document.querySelector('#message-input').value = ''; document.querySelector('#message-input').dispatchEvent(new Event('input', { bubbles: true }))");

    // The categories follow the tabs pattern: arrows move and select (wrapping at the ends), Home and End jump, only the
    // selected tab is in the Tab order, and exactly its panel shows.
    await setViewport(1100, 800);
    await evaluate("document.querySelector('#settings-dialog').showModal(); document.querySelector('#settings-tab-profile').click(); document.querySelector('#settings-tab-profile').focus(); true");
    const selectedPane = `(() => { const tabs = [...document.querySelectorAll('#settings-nav [role=tab]')], selected = tabs.filter(tab => tab.getAttribute('aria-selected') === 'true');
      const shown = [...document.querySelectorAll('#settings-panes [role=tabpanel]')].filter(panel => !panel.hidden);
      return selected.length === 1 && document.activeElement === selected[0] && tabs.filter(tab => tab.tabIndex === 0).length === 1 && selected[0].tabIndex === 0 &&
        shown.length === 1 && shown[0].id === selected[0].getAttribute('aria-controls') ? selected[0].dataset.pane : 'invalid'; })()`;
    for (const [key, keyCode, pane] of [['ArrowDown', 40, 'display'], ['End', 35, 'app'], ['ArrowDown', 40, 'profile'], ['ArrowUp', 38, 'app'], ['Home', 36, 'profile']] as const) {
      await pressKey(key, key, keyCode);
      assert.equal(await evaluate<string>(selectedPane), pane, `Settings categories: ${key} did not select ${pane}`);
    }
    await evaluate("document.querySelector('#settings-dialog').close()");
    // Exercise the runner's accessibility setting and both explicit motion modes.
    for (const [theme, motion] of ['native', 'no-preference', 'reduce'].flatMap(motion => ['light', 'dark'].map(theme => [theme, motion]))) {
      await send('Emulation.setEmulatedMedia', { features: motion === 'native' ? [] : [{ name: 'prefers-reduced-motion', value: motion }] });
      await evaluate(`document.documentElement.dataset.theme = '${theme}'`);
      for (const [width, height] of [[1100, 800], [375, 812], [320, 700]] as const) {
        await setViewport(width, height);
        await evaluate("document.querySelector('#settings-dialog').showModal()");
        const settingsSpacing = await evaluate<{left:number;right:number;gutter:number;overflow:boolean;inside:boolean;placed:boolean;heights:number[]}>(`(() => {
          const dialog = document.querySelector('#settings-dialog'), panes = document.querySelector('#settings-panes'), nav = document.querySelector('#settings-nav');
          // The dialog keeps its size whichever category is open, so switching never makes it jump.
          const heights = ['app', 'stickers', 'profile'].map(pane => { document.querySelector('#settings-tab-' + pane).click(); return Math.round(dialog.getBoundingClientRect().height); });
          const d = dialog.getBoundingClientRect(), a = panes.getBoundingClientRect(), n = nav.getBoundingClientRect(), b = document.querySelector('#profile-form').getBoundingClientRect();
          const gutter = panes.offsetWidth - panes.clientWidth;
          return { left: b.left - a.left, right: a.right - gutter - b.right, gutter, overflow: ${settingsOverflow}, heights,
            inside: d.left >= 0 && d.right <= innerWidth && d.top >= 0 && d.bottom <= innerHeight,
            placed: ${width} > 700 ? n.right <= a.left + 1 && n.top >= d.top && n.bottom <= d.bottom + 1 : n.bottom <= a.top + 1 }; })()`);
        // Categories sit beside the open one on wide windows and above it on narrow ones; its content keeps equal side margins.
        assert(settingsSpacing.inside && !settingsSpacing.overflow && settingsSpacing.placed && new Set(settingsSpacing.heights).size === 1 &&
          Math.abs(settingsSpacing.left - settingsSpacing.right) <= 1 && Math.abs(settingsSpacing.left - (width > 700 ? 28 : 16)) <= 1,
        `Settings layout is off (${theme}, ${width}px): ${JSON.stringify(settingsSpacing)}`);
        if (width !== 375) await capturePolish(`settings-${theme}-${width}-${motion}`);
        await evaluate("document.querySelector('#settings-dialog').close()");
      }
      await setViewport(1100, 800);
      await pressKey('Tab', 'Tab', 9);
      await evaluate("document.querySelector('#message-input').focus()");
      await settleAnimations();
      const borders = await evaluate<{visibleFocus:boolean;focusWidth:number;targetWidth:number;typedWidth?:number;dpr:number;visibility:string;pageHidden?:string;reducedMotion:boolean;focusSurface:number;focusChat:number;selection:number;outgoing:number;outgoingNearWhite:boolean;inputTransitions:number[];inputProperties:string[]}>(`(() => {
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
          // An outgoing bubble's edge shows through its outline or, for a filled bubble, its fill against the conversation.
          selection: contrast(selected.borderTopColor, selected.backgroundColor), outgoing: Math.max(contrast(own.borderTopColor, own.backgroundColor), contrast(own.backgroundColor, chat)),
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
    const reducedMotion = await evaluate<{styles:boolean;backdrop:boolean;running:number;animations:unknown[]}>(`(() => {
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
    const idleAnimations = await evaluate<unknown[]>(`document.getAnimations().filter(animation => animation.playState === 'running').map(animation => ({
      name: animation.animationName || animation.transitionProperty || animation.constructor.name,
      target: animation.effect?.target?.id || animation.effect?.target?.className || animation.effect?.target?.tagName,
      pending: animation.pending, currentTime: animation.currentTime, timing: animation.effect?.getTiming() }))`);
    assert.deepEqual(idleAnimations, [], 'Closed UI controls animate while idle');
    await send('Performance.enable');
    const idleBefore = Object.fromEntries((await send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
    await delay(1000);
    const idleAfter = Object.fromEntries((await send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
    const idleHeap = (idleAfter.JSHeapUsedSize ?? NaN) / 1024 / 1024, idleTasks = (idleAfter.TaskDuration ?? NaN) - (idleBefore.TaskDuration ?? NaN);
    assert(Number.isFinite(idleHeap) && Number.isFinite(idleTasks) && idleHeap <= 96 && idleTasks <= .25,
      `Renderer idle budget exceeded: ${JSON.stringify({ jsHeapMiB: idleHeap, taskSeconds: idleTasks })}`);
    console.log(`UI polish: scrollable accessible emoji, Settings categories (keyboard, fixed size, equal margins), focus/selection contrast and reduced motion passed; idle renderer JS heap ${idleHeap.toFixed(2)} MiB, task time ${idleTasks.toFixed(3)} s/1 s`);
    // Stickers: import a pack in Settings, send from the picker in Personal notes, receive an animated sticker from a
    // loopback peer without a consent step, send one back, save the received one, then delete every pack. The page only
    // ever gets WebP data URLs; the peer runs in this process on a random loopback port with discovery off.
    const stickerDir = join(profile, 'smoke-stickers');
    mkdirSync(stickerDir);
    const stickerFiles = [join(stickerDir, 'merah.png'), join(stickerDir, 'biru.png'), join(stickerDir, 'gerak.gif')];
    writeFileSync(stickerFiles[0]!, await sharp({ create: { width: 640, height: 480, channels: 4, background: { r: 220, g: 40, b: 60, alpha: 1 } } }).png().toBuffer());
    writeFileSync(stickerFiles[1]!, await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 30, g: 90, b: 220, alpha: 0.7 } } }).png().toBuffer());
    const stickerFrames = Buffer.alloc(96 * 96 * 2 * 3);
    stickerFrames.fill(255, 0, 96 * 96 * 3);
    const animatedSticker = await sharp(stickerFrames, { raw: { width: 96, height: 192, pageHeight: 96, channels: 3 } }).gif({ delay: [150, 150], loop: 0 }).toBuffer();
    writeFileSync(stickerFiles[2]!, animatedSticker);
    const notAnImage = join(stickerDir, 'bukan-gambar.png');
    writeFileSync(notAnImage, 'not an image');
    await setViewport(1100, 800);
    await evaluate("document.documentElement.dataset.theme = 'light'; document.querySelector('#settings-button').click(); true");
    await waitFor("document.querySelector('#settings-dialog').open && document.querySelectorAll('#sticker-packs li.empty').length === 1", 'empty sticker library in Settings');
    await evaluate(`${showPane('#stickers-section')} document.querySelector('#stickers-section').scrollIntoView({ block: 'start' }); document.querySelector('#sticker-pack-name').value = 'Smoke'; true`);
    const stickerDom = await send('DOM.getDocument');
    const stickerInput = await send('DOM.querySelector', { nodeId: stickerDom.root.nodeId, selector: '#sticker-files' });
    await send('DOM.setFileInputFiles', { nodeId: stickerInput.nodeId, files: [...stickerFiles, notAnImage] });
    await evaluate("document.querySelector('#sticker-files').dispatchEvent(new Event('change', { bubbles: true })); true");
    await waitFor("window.lumilan.stickers({ op: 'list' }).then(v => v.packs.length === 1 && v.packs[0].count === 3 && !v.job && document.querySelectorAll('#sticker-packs li:not(.empty)').length === 1)", 'sticker pack imported', 30_000);
    assert(!(await evaluate<string>("window.lumilan.stickers({ op: 'list' }).then(v => JSON.stringify(v))", true)).includes('lumilan-ui-smoke-'), 'A path reached the sticker view');
    await waitFor(`(() => { const rows = document.querySelectorAll('#sticker-skipped li'); return !document.querySelector('#sticker-import-result').hidden && rows.length === 1 &&
      rows[0].querySelector('strong').textContent === 'bukan-gambar.png' && rows[0].querySelector('small').textContent.includes('PNG') && !rows[0].textContent.includes('lumilan-ui-smoke-'); })()`,
      'the skipped file is named with its reason');
    const stickerData = join(profile, 'lumilan', 'stickers');
    assert.equal(readdirSync(stickerData).length, 1, 'One pack folder after the import');
    for (const theme of ['light', 'dark']) {
      await setViewport(320, 700);
      const layout = await evaluate<{ inside: boolean; overflow: boolean }>(`(() => { document.documentElement.dataset.theme = '${theme}';
        const dialog = document.querySelector('#settings-dialog'), box = dialog.getBoundingClientRect(); ${showPane('#stickers-section')} document.querySelector('#stickers-section').scrollIntoView({ block: 'center' });
        const parts = [...document.querySelectorAll('#stickers-section input:not([type=file]), #sticker-drop-zone, #sticker-choose, #sticker-packs li, #sticker-packs button, #sticker-import-result, #sticker-skipped li')].map(e => e.getBoundingClientRect());
        return { inside: parts.every(r => r.left >= box.left && r.right <= box.right), overflow: ${settingsOverflow} }; })()`);
      assert(layout.inside && !layout.overflow, `Settings stickers overflow at 320 px in ${theme}: ${JSON.stringify(layout)}`);
      await delay(400);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
      writeFileSync(join(dist, `ui-stickers-settings-${theme}-320.png`), Buffer.from(shot.data, 'base64'));
    }
    await setViewport(1100, 800);
    await evaluate("document.documentElement.dataset.theme = 'light'; document.querySelector('#settings-dialog').close(); document.querySelector('#notes-button').click(); true");
    await waitFor("!document.querySelector('#sticker-button').hidden", 'sticker button in Personal notes');
    await evaluate("document.querySelector('#sticker-button').click(); true");
    const pickerReady = "!document.querySelector('#sticker-picker').hidden && document.querySelectorAll('#sticker-grid img').length === 3 && [...document.querySelectorAll('#sticker-grid img')].every(i => i.complete && i.naturalWidth > 0)";
    await waitFor(pickerReady, 'sticker picker thumbnails');
    for (const [theme, width, height] of [['light', 1100, 800], ['dark', 1100, 800], ['light', 375, 760], ['dark', 375, 760]] as const) {
      await setViewport(width, height);
      const layout = await evaluate<{ inside: boolean; above: boolean; columns: number }>(`(() => { document.documentElement.dataset.theme = '${theme}';
        const picker = document.querySelector('#sticker-picker').getBoundingClientRect(), main = document.querySelector('.conversation').getBoundingClientRect();
        const composer = document.querySelector('#message-form').getBoundingClientRect(), cells = [...document.querySelectorAll('#sticker-grid button')].map(e => e.getBoundingClientRect());
        return { inside: picker.left >= main.left && picker.right <= main.right && picker.top >= 0, above: picker.bottom <= composer.bottom,
          columns: new Set(cells.map(r => Math.round(r.left))).size }; })()`);
      assert(layout.inside && layout.above && layout.columns === 3, `Sticker picker misplaced at ${width} px in ${theme}: ${JSON.stringify(layout)}`);
      await settleAnimations();
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
      writeFileSync(join(dist, `ui-stickers-picker-${theme}-${width}.png`), Buffer.from(shot.data, 'base64'));
    }
    await setViewport(1100, 800);
    await evaluate("document.documentElement.dataset.theme = 'light'; document.querySelector('#sticker-grid button').click(); true");
    await waitFor("window.lumilan.state().then(s => s.messages.some(m => m.note && m.sticker)) && [...document.querySelectorAll('#messages .sticker-image')].some(i => i.complete && i.naturalWidth > 0)", 'sticker sent to Personal notes');
    await waitFor("document.querySelectorAll('#sticker-tabs button').length === 2 && document.querySelector('#sticker-tabs button').getAttribute('aria-label') !== null", 'recent tab after sending');
    for (const index of [1, 0]) {
      const center = await evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelectorAll('#sticker-tabs button')[${index}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...center });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...center, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...center, button: 'left', clickCount: 1 });
      await waitFor(`(() => { const tab = document.querySelectorAll('#sticker-tabs button')[${index}]; return !document.querySelector('#sticker-picker').hidden && tab.getAttribute('aria-pressed') === 'true' &&
        document.activeElement === tab && document.querySelectorAll('#sticker-grid img').length > 0; })()`, `picker stays open on tab ${index}`);
    }
    await evaluate("document.querySelector('#sticker-grid button').focus(); true");
    await pressKey('Escape', 'Escape', 27);
    await waitFor("document.querySelector('#sticker-picker').hidden && document.activeElement === document.querySelector('#sticker-button') && document.querySelector('#notes-button').classList.contains('active')", 'Escape closes the picker and keeps the conversation');
    await evaluate("document.querySelector('#settings-tab-profile').click(); document.querySelector('#sticker-button').click(); true");
    await waitFor("!document.querySelector('#sticker-picker').hidden", 'picker open again');
    await evaluate("document.querySelector('#sticker-manage').click(); true");
    await waitFor("document.querySelector('#settings-dialog').open && document.querySelector('#sticker-picker').hidden && document.querySelector('#settings-tab-stickers').getAttribute('aria-selected') === 'true' && !document.querySelector('#settings-pane-stickers').hidden && document.activeElement === document.querySelector('#sticker-pack-name')",
      'Manage stickers opens the sticker category');
    await evaluate("document.querySelector('#settings-dialog').close(); true");
    // Saving a sticker that is already in the library changes nothing.
    await evaluate("[...document.querySelectorAll('#messages .message')].reverse().find(row => row.querySelector('.sticker-image')).querySelector('.message-select-button').click(); true");
    await waitFor("!document.querySelector('#selection-save-sticker').hidden", 'save sticker action for a selected sticker');
    await evaluate("document.querySelector('#selection-save-sticker').click(); true");
    await waitFor("document.querySelector('#toast').classList.contains('visible') && document.querySelector('#message-selection').hidden", 'saving a duplicate sticker answers');
    assert.equal(await evaluate<number>("window.lumilan.stickers({ op: 'list' }).then(v => v.packs.length)", true), 1, 'A duplicate sticker created a Saved pack');

    const stickerState = await evaluate<Snapshot>('window.lumilan.state()', true);
    const { LumilanPeer } = await import('../src/main/peer.js');
    const { encodeSticker } = await import('../src/main/sticker-image.js');
    const peerSide = new LumilanPeer({ dataDir: join(profile, 'sticker-peer'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0', acceptFile: async () => false });
    stickerPeer = peerSide;
    await peerSide.start(); peerSide.rename('Stiker LAN'); await peerSide.connectAddress(stickerState.addresses[0]!);
    const peerId = JSON.stringify(peerSide.id);
    await waitFor(`window.lumilan.state().then(s => s.peers.some(p => p.id === ${peerId} && p.stickers === true))`, 'sticker peer online with the sticker capability');
    // A different animation than the imported one: re-encoding the same image gives the same bytes, a duplicate.
    const peerFrames = Buffer.alloc(80 * 80 * 2 * 3);
    peerFrames.fill(90, 0, 80 * 80 * 3);
    peerFrames.fill(200, 80 * 80 * 3);
    const fromPeer = await encodeSticker(await sharp(peerFrames, { raw: { width: 80, height: 160, pageHeight: 80, channels: 3 } }).gif({ delay: [120, 120], loop: 0 }).toBuffer(), 'import');
    const received = await peerSide.sendSticker(fromPeer.bytes, fromPeer, stickerState.me.id);
    assert.equal(received.delivered, 1, 'The app did not acknowledge a sticker');
    await waitFor(`window.lumilan.fileOffers().then(offers => offers.length === 0)`, 'no consent request for a sticker');
    await evaluate(`document.querySelector('.person[data-peer=${JSON.stringify(peerSide.id)}]').click(); true`);
    const receivedImage = `document.querySelector('#message-${received.message.id} .sticker-image')`;
    await waitFor(`(() => { const image = ${receivedImage}; return Boolean(image && image.dataset.animated === 'true' && image.complete && image.naturalWidth > 0 && !document.querySelector('#message-${received.message.id} .file-bubble')); })()`, 'received animated sticker shown without a file bubble');
    await waitFor("!document.querySelector('#sticker-button').hidden", 'sticker button for a capable contact');
    // Reduced motion shows the first frame of an animated sticker instead of the animation.
    const animatedSource = await evaluate<string>(`${receivedImage}.src`);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await waitFor(`(() => { const image = ${receivedImage}; return image.complete && image.naturalWidth > 0 && image.src && image.src !== ${JSON.stringify(animatedSource)}; })()`, 'still sticker under reduced motion');
    await send('Emulation.setEmulatedMedia', { features: [] });
    await waitFor(`${receivedImage}.src === ${JSON.stringify(animatedSource)}`, 'animation back after reduced motion ends');
    // An image waiting for Accept raises its sender with a badge while another conversation is open, as a message would;
    // an answer from another surface (the same IPC Lumi and notifications use) takes the badge away.
    const offeredImage = join(profile, 'smoke-offer.png');
    writeFileSync(offeredImage, await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 120, b: 90 } } }).png().toBuffer());
    await evaluate("document.querySelector('#notes-button').click(); true");
    const offering = peerSide.sendFilePath(offeredImage, stickerState.me.id);
    offering.catch(() => {});
    const peerRow = `document.querySelector('#people-list .person[data-peer=${JSON.stringify(peerSide.id)}]')`;
    // The badge adds the waiting image to any message not yet read: the received sticker counts as read only while the
    // window is really being watched, which a test window is not always. Only contacts with news may sit above it.
    try {
      await waitFor(`Promise.all([window.lumilan.fileOffers(), window.lumilan.state()]).then(([offers, s]) => { const rows = [...document.querySelectorAll('#people-list .person')], row = ${peerRow};
        return Boolean(row) && offers.length === 1 && rows.slice(0, rows.indexOf(row)).every(other => other.querySelector('.unread-badge')) &&
          row.querySelector('.unread-badge')?.textContent === String((s.unread[${peerId}] || 0) + 1); })`, 'an image offer raises its sender with a badge');
    } catch (error) {
      const seen = await evaluate<string>(`Promise.all([window.lumilan.fileOffers(), window.lumilan.state()]).then(([offers, s]) => JSON.stringify({ offers: offers.length, unread: s.unread[${peerId}] || 0,
        rows: [...document.querySelectorAll('#people-list .person')].map(row => [row.dataset.peer === ${peerId} ? 'sender' : 'other', row.querySelector('.unread-badge')?.textContent || '']) }))`, true);
      throw new Error(`${error instanceof Error ? error.message : String(error)}: ${seen}`);
    }
    await evaluate("window.lumilan.fileOffers().then(offers => window.lumilan.decideFile(offers[0].id, false))", true);
    await waitFor(`window.lumilan.state().then(s => (${peerRow}.querySelector('.unread-badge')?.textContent || '0') === String(s.unread[${peerId}] || 0))`,
      'an answered image offer leaves only unread messages in the badge');
    await assert.rejects(offering, /menolak/);
    await evaluate(`${peerRow}.click(); true`);
    // Save the received sticker, then send one back from the picker.
    await evaluate(`document.querySelector('#message-${received.message.id} .message-select-button').click(); document.querySelector('#selection-save-sticker').click(); true`);
    await waitFor("window.lumilan.stickers({ op: 'list' }).then(v => v.packs.length === 2 && v.packs.some(p => p.saved && p.count === 1))", 'received sticker saved to the Saved pack');
    await evaluate("document.querySelector('#sticker-button').click(); true");
    await waitFor("!document.querySelector('#sticker-picker').hidden && document.querySelectorAll('#sticker-grid img').length > 0", 'picker for the contact');
    await evaluate("document.querySelector('#sticker-grid button').click(); true");
    for (const end = Date.now() + 15_000; !peerSide.state.messages.some(m => m.sticker && m.from === stickerState.me.id); await delay(100))
      assert(Date.now() < end, 'The peer did not receive the sticker sent from the picker');
    await pressKey('Escape', 'Escape', 27);
    for (const [theme, width, height] of [['light', 1100, 800], ['dark', 1100, 800], ['light', 320, 700], ['dark', 320, 700]] as const) {
      await setViewport(width, height);
      const layout = await evaluate<{ overflow: boolean; widths: number[] }>(`(() => { document.documentElement.dataset.theme = '${theme}';
        const images = [...document.querySelectorAll('#messages .sticker-image')]; images.at(-1)?.scrollIntoView({ block: 'center' });
        return { overflow: document.documentElement.scrollWidth > innerWidth, widths: images.map(i => Math.round(i.getBoundingClientRect().width)) }; })()`);
      assert(!layout.overflow && layout.widths.length >= 2 && layout.widths.every(w => w > 0 && w <= 160), `Sticker bubbles overflow at ${width} px in ${theme}: ${JSON.stringify(layout)}`);
      await settleAnimations();
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15_000);
      writeFileSync(join(dist, `ui-stickers-chat-${theme}-${width}.png`), Buffer.from(shot.data, 'base64'));
    }
    await setViewport(1100, 800);
    // Deleting every pack empties the library folder; sent and received stickers keep their own copies.
    await evaluate("document.documentElement.dataset.theme = 'light'; document.querySelector('#settings-button').click(); true");
    for (let remaining = 2; remaining > 0; remaining--) {
      await waitFor(`document.querySelector('#settings-dialog').open && document.querySelectorAll('#sticker-packs li:not(.empty)').length === ${remaining}`, 'pack rows in Settings');
      await evaluate("document.querySelector('#sticker-packs .task-actions button').click(); true");
      await waitFor("document.querySelector('#confirm-dialog').open", 'delete pack confirmation');
      await evaluate("document.querySelector('#confirm-action').click(); true");
    }
    await waitFor("window.lumilan.stickers({ op: 'list' }).then(v => v.packs.length === 0 && document.querySelectorAll('#sticker-packs li.empty').length === 1)", 'every sticker pack deleted');
    // The list empties as soon as the index is saved; the folders go right after.
    for (const end = Date.now() + 10_000; readdirSync(stickerData).length; await delay(100)) assert(Date.now() < end, `Deleted packs left files behind: ${readdirSync(stickerData).join(', ')}`);
    await evaluate("document.querySelector('#settings-dialog').close(); true");
    assert(existsSync(join(profile, 'lumilan', 'files', received.message.id)), 'A received sticker lost its file with the library');
    assert.match(await evaluate<string>(`window.lumilan.stickerImage(${JSON.stringify(received.message.id)})`, true), /^data:image\/webp;base64,/);
    await peerSide.stop();
    stickerPeer = undefined;
    assert.equal(failures.length, 0, `Renderer errors after stickers: ${failures.join('; ')}`);
    console.log('Stickers: Settings import (PNG, GIF) with a named skip reason, picker tabs stay open, Manage stickers opens its category, an image offer raises its sender with a badge until answered, picker in notes and for a contact, Escape, duplicate save, consent-free animated sticker from a loopback peer, reduced-motion still, saving, sending back, deleting packs, light/dark 1100/375/320 px passed');
    // Everything a person can click says so: no arrow over a button, a select, a switch or a clickable row.
    assert.deepEqual(await cdp.arrowCursors(remote), [], 'Clickable controls keep the arrow cursor in the main window');
    assert.deepEqual(cdp.swallowedRejections(handlerErrors), [], 'The main process rejected requests the renderer hid');
    assert.equal(failures.length, 0, `Renderer errors: ${failures.join('; ')}`);
    passed = true;
    console.log('Packaged UI rendered: welcome, chat, details, settings, room, contact dialog, call, avatar, animated GIF preview, and older-message reactions without scroll jumps');
  } catch (error) {
    console.error('UI smoke failure:', error);
    throw error;
  } finally {
    await stickerPeer?.stop().catch(() => {});
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
