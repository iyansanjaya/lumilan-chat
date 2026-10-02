// Desktop companion: one bounded event queue, no chat history, audio, or filesystem API in its renderer.
import { join } from 'node:path';

const URL = 'lumilan://app/notch.html';
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').slice(0, 240);
const priority = item => item.kind === 'call' ? 3 : item.kind === 'file' && item.status === 'offered' ? 2 : 1;

export function notchBounds(display, mode, fraction = .5, expandedHeight = 210) {
  const area = display.workArea;
  const width = Math.min(mode === 'expanded' ? 360 : mode === 'compact' ? 300 : 110, area.width);
  const height = Math.min(mode === 'expanded' ? expandedHeight : mode === 'compact' ? 68 : 5, area.height);
  const center = area.x + area.width * Math.min(.95, Math.max(.05, Number.isFinite(fraction) ? fraction : .5));
  return { x: Math.round(Math.min(area.x + area.width - width, Math.max(area.x, center - width / 2))), y: area.y, width, height };
}

export class LumiNotch {
  constructor({ BrowserWindow, ipcMain, screen, powerMonitor, notchSession, root, getSettings, getPeer, getMain, reveal, decideFile, acceptCall, savePosition, onFailure }) {
    Object.assign(this, { BrowserWindow, ipcMain, screen, powerMonitor, notchSession, root, getSettings, getPeer, getMain, reveal, decideFile, acceptCall, savePosition, onFailure });
    this.items = new Map();
    this.mode = 'hidden';
    this.ready = false;
    this.locked = false;
    this.powerBlocks = new Set();
    this.supported = !(process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland');
    this.timers = new Set();
    this.listeners = [];
    this.pausedUntil = 0;
    this.revision = 0;
    const listen = (emitter, event, callback) => { emitter.on(event, callback); this.listeners.push(() => emitter.removeListener(event, callback)); };
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) listen(screen, event, () => this.sync());
    for (const [event, reason] of [['lock-screen', 'locked'], ['suspend', 'suspended']]) listen(powerMonitor, event, () => {
      this.powerBlocks.add(reason); this.locked = true; this.sync();
    });
    for (const [event, reason] of [['unlock-screen', 'locked'], ['resume', 'suspended']]) listen(powerMonitor, event, () => {
      this.powerBlocks.delete(reason); this.locked = this.powerBlocks.size > 0; this.sync();
    });
    ipcMain.handle('lumi:state', event => { this.check(event); return this.snapshot(); });
    ipcMain.handle('lumi:action', (event, action) => { this.check(event); return this.action(action); });
    ipcMain.on('lumi:pointer', (event, inside) => {
      try { this.check(event); } catch { return; }
      if (typeof inside !== 'boolean' || this.pointerInside === inside) return;
      this.pointerInside = inside;
      this.win.setIgnoreMouseEvents(process.platform === 'linux' ? false : !inside && this.mode !== 'expanded', { forward: true });
    });
  }

  check(event) {
    if (!this.win || this.win.isDestroyed() || event.sender !== this.win.webContents ||
        event.senderFrame !== this.win.webContents.mainFrame || event.senderFrame?.url !== URL || event.sender.getURL() !== URL)
      throw new Error('Permintaan ditolak.');
  }

  eligible() {
    const s = this.getSettings(), main = this.getMain();
    return this.supported && s.notch !== false && s.enabled && !this.locked && Date.now() >= this.pausedUntil &&
      this.getPeer()?.state.status !== 'dnd' && main && !main.isDestroyed() && (!main.isVisible() || main.isMinimized());
  }

  later(callback, ms) {
    const timer = setTimeout(() => { this.timers.delete(timer); callback(); }, ms);
    timer.unref?.(); this.timers.add(timer); return timer;
  }

  clearTimers() { for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); this.publishTimer = this.dismissTimer = null; }

  armDismiss() {
    clearTimeout(this.dismissTimer); this.timers.delete(this.dismissTimer); this.dismissTimer = null;
    if (this.mode === 'hidden' || !this.eligible() || !this.ready) return;
    // Closing the preview never decides a file request or ends a call. Activity renews this one-shot timer.
    this.dismissTimer = this.later(() => { this.dismissTimer = null; this.collapse(); }, priority(this.selected() || {}) > 1 ? 7000 : 4000);
  }

  ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return;
    this.ready = false;
    this.lastBounds = this.lastPublication = undefined;
    this.win = new this.BrowserWindow({
      ...notchBounds(this.screen.getPrimaryDisplay(), 'hidden'), show: false, frame: false, transparent: true,
      minWidth: 1, minHeight: 1,
      backgroundColor: '#00000000', resizable: false, movable: false, minimizable: false, maximizable: false,
      // X11 cannot change focusable later; showInactive preserves automatic focus,
      // while an explicit expansion must still accept keyboard input.
      fullscreenable: false, skipTaskbar: true, focusable: process.platform === 'linux', hasShadow: false,
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
      title: 'Lumi · Lumilan Chat',
      webPreferences: { preload: join(this.root, 'notch-preload.cjs'), session: this.notchSession, sandbox: true, contextIsolation: true,
        nodeIntegration: false, webSecurity: true, backgroundThrottling: true, autoplayPolicy: 'no-user-gesture-required' },
    });
    this.win.setAlwaysOnTop(true, 'floating');
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.win.webContents.on('will-navigate', (event, url) => { if (url !== URL) event.preventDefault(); });
    this.win.webContents.on('will-attach-webview', event => event.preventDefault());
    this.win.webContents.on('render-process-gone', () => this.fail());
    this.win.webContents.on('did-fail-load', (_e, code) => { if (code !== -3) this.fail(); });
    this.win.webContents.once('did-finish-load', () => { this.ready = true; this.sync(); });
    this.win.on('blur', () => { if (this.mode === 'expanded') this.collapse(); });
    this.win.loadURL(URL).catch(() => this.fail());
  }

  fail() {
    this.supported = false; this.clearTimers(); this.win?.destroy(); this.ready = false;
    this.onFailure?.();
    if ([...this.items.values()].some(item => priority(item) > 1)) this.reveal();
  }

  selected() {
    const all = [...this.items.values()].sort((a, b) => priority(b) - priority(a) || b.time - a.time);
    return all.find(item => item.key === this.selectedKey) || all[0];
  }

  snapshot() {
    const s = this.getSettings(), selected = this.selected();
    // Rebuild from private raw summaries on every publication: a privacy change also redacts queued items.
    const visible = item => ({ key: item.key, kind: item.kind, status: item.status, count: item.count || 1,
      title: s.preview ? item.title : 'Lumilan Chat',
      body: s.preview || item.kind === 'notice' ? item.body : item.kind === 'reminder' ? 'Buka Pengingat untuk melihat detail.' : item.kind === 'call' ? (item.status === 'incoming' ? 'Panggilan suara masuk' : item.body) : item.kind === 'file' ? (item.status === 'offered' ? 'File masuk menunggu persetujuan.' : 'Menerima file...') : 'Pesan baru diterima',
      progress: item.progress, actionable: item.kind === 'call' ? item.status === 'incoming' : item.kind === 'file' && item.status === 'offered',
    });
    return { mode: this.mode, revision: this.revision, width: this.width, language: s.language, silent: s.silent, selected: selected && visible(selected),
      items: [...this.items.values()].sort((a, b) => priority(b) - priority(a) || b.time - a.time).slice(0, 128).map(visible),
      count: this.items.size };
  }

  publish() {
    if (this.ready && this.win && !this.win.isDestroyed()) {
      const value = this.snapshot(), signature = JSON.stringify(value);
      if (signature !== this.lastPublication) { this.lastPublication = signature; this.win.webContents.send('lumi:state', value); }
    }
  }

  sync() {
    for (const [key,item] of this.items) if (item.kind === 'reminder') {
      const reminders = this.getPeer().state.reminders || [];
      const live=reminders.filter(r=>(item.id?r.id===item.id&&r.status==='pending':item.ids.includes(r.id)&&r.status==='due') && (r.kind!=='incoming'||!this.getPeer().state.mutedThreads.includes(r.from)));
      if (!live.length) this.items.delete(key);
      else if(!item.id){item.ids=live.map(r=>r.id);item.count=live.length;item.body=live.length>1?'Buka Pengingat untuk melihat detail.':clean(live[0].title);}
    }
    if (!this.eligible()) {
      this.clearTimers(); this.mode = 'hidden'; this.pointerInside = false; this.publish();
      if (this.win && !this.win.isDestroyed()) {
        if (process.platform !== 'linux') this.win.setFocusable(false);
        if (this.getSettings().notch === false) { this.win.destroy(); this.ready = false; }
        else this.win.hide();
      }
      return false;
    }
    this.ensureWindow();
    if (!this.ready) return false; // Native notifications remain the fallback while the renderer starts.
    const s = this.getSettings(), display = this.screen.getAllDisplays().find(d => d.id === s.notchPosition?.display) || this.screen.getPrimaryDisplay();
    const bounds = notchBounds(display, this.mode, s.notchPosition?.fraction, this.expandedHeight || 210);
    this.width = bounds.width;
    const signature = JSON.stringify(bounds);
    if (signature !== this.lastBounds) { this.lastBounds = signature; this.win.setBounds(bounds); }
    if (!this.win.isVisible()) { this.pointerInside = false; this.win.setIgnoreMouseEvents(process.platform !== 'linux' && this.mode !== 'expanded', { forward: true }); this.win.showInactive(); }
    this.publish();
    if (!this.dismissTimer) this.armDismiss();
    return true;
  }

  setMode(mode) {
    if (this.mode !== mode) this.revision++;
    this.mode = mode;
    if (mode === 'hidden') this.pointerInside = false;
    if (this.win && !this.win.isDestroyed()) {
      this.win.setIgnoreMouseEvents(process.platform !== 'linux' && mode !== 'expanded' && !this.pointerInside, { forward: true });
      if (mode !== 'expanded') {
        if (process.platform !== 'linux') this.win.setFocusable(false);
        // Some Windows desktops retain native focus after setFocusable(false). Hide/showInactive releases it.
        if (this.win.isFocused()) this.win.hide();
      }
    }
    const handled = this.sync();
    this.armDismiss();
    return handled;
  }

  put(key, item, attention = true) {
    if (this.getPeer().state.mutedThreads.includes(item.thread)) return false;
    const previous = this.selected();
    this.items.set(key, { ...this.items.get(key), ...item, key, time: Date.now() });
    // Messages are bounded; pending consent and the current call must never be evicted by message spam.
    const messages = [...this.items.values()].filter(i => ['message', 'notice'].includes(i.kind));
    if (messages.length > 64) this.items.delete(messages.sort((a, b) => a.time - b.time)[0].key);
    if (!attention) { this.schedulePublish(); return this.eligible() && this.ready; }
    if (this.mode !== 'hidden' && previous && priority(previous) > priority(item)) { this.schedulePublish(); return this.eligible() && this.ready; }
    this.selectedKey = key;
    this.revision++;
    this.clearTimers();
    return this.setMode(priority(item) > 1 || this.mode === 'expanded' && this.pointerInside ? 'expanded' : 'compact');
  }

  message(message, thread, title, body) {
    const key = `message:${thread}`;
    return this.put(key, { kind: 'message', thread, title: clean(title), body: clean(body), count: (this.items.get(key)?.count || 0) + 1 });
  }

  file(offer) {
    return this.put(`file:${offer.id}`, { kind: 'file', id: offer.id, thread: offer.thread, status: 'offered',
      title: clean(offer.fromName), body: clean(`${offer.name} · ${(offer.size / 1024 / 1024).toFixed(1)} MB`), progress: 0 });
  }

  reminder(event) {
    if (event.type === 'request') {
      const r = event.items[0];
      return this.put(`reminder:${r.id}`,{kind:'reminder',id:r.id,thread:'reminders',status:'pending',title:'Permintaan pengingat',body:clean(r.title)});
    }
    const previous=this.items.get('reminder:due'), ids=[...new Set([...(previous?.ids||[]),...event.items.map(r=>r.id)])];
    return this.put('reminder:due',{kind:'reminder',thread:'reminders',ids,status:'due',title:event.missed?'Pengingat terlewat':'Pengingat jatuh tempo',
      body:ids.length>1 ? 'Buka Pengingat untuk melihat detail.' : clean(event.items[0].title),count:ids.length});
  }

  transfer(transfer) {
    const key = `file:${transfer.id}`, item = this.items.get(key);
    if (!item) return;
    if (['complete', 'canceled'].includes(transfer.status)) {
      this.remove(key);
      this.put(`done:${transfer.id}`, { kind: 'notice', thread: item.thread, title: item.title,
        body: transfer.status === 'complete' ? 'File berhasil diterima.' : 'Transfer file berhenti sebelum selesai.' });
      return;
    }
    item.status = transfer.status;
    if (Number.isFinite(transfer.received) && transfer.total > 0) item.progress = Math.max(item.progress || 0, Math.min(100, Math.floor(transfer.received / transfer.total * 100)));
    this.schedulePublish();
  }

  call(signal) {
    const key = `call:${signal.id}`;
    if (signal.type === 'end') {
      const item = this.items.get(key); this.remove(key);
      if (item && signal.reason !== 'declined') this.put(`ended:${signal.id}`, { kind: 'notice', thread: item.thread, title: item.title, body: 'Panggilan berakhir.' });
      return;
    }
    const peer = this.getPeer();
    this.put(key, { kind: 'call', id: signal.id, thread: signal.peerId, status: signal.type === 'offer' ? 'incoming' : 'connecting',
      title: clean(peer.trusted.get(signal.peerId)?.name), body: 'Panggilan suara masuk' }, signal.type === 'offer');
  }

  callPhase(state) {
    if (!state) {
      const active = this.getPeer().activeCall;
      for (const item of this.items.values()) if (item.kind === 'call' && item.id !== active?.id) this.remove(item.key);
      return;
    }
    const call = this.getPeer().activeCall;
    if (!call || state.id !== call.id || state.peerId !== call.peerId || !['incoming', 'preparing', 'ringing', 'connecting', 'active'].includes(state.phase)) return;
    const key = `call:${call.id}`;
    const body = state.audioBlocked ? 'Periksa perangkat dan coba lagi.' : ({ incoming: 'Panggilan suara masuk', preparing: 'Menyiapkan mikrofon dan koneksi...', ringing: 'Panggilan suara', connecting: 'Menghubungkan audio...', active: 'Panggilan suara berlangsung' })[state.phase];
    this.put(key, { kind: 'call', id: call.id, thread: call.peerId, title: clean(this.getPeer().trusted.get(call.peerId)?.name), status: state.phase, body }, false);
  }

  schedulePublish() {
    if (this.publishTimer) return;
    this.publishTimer = this.later(() => { this.publishTimer = null; if (this.eligible()) this.publish(); }, 150);
  }

  remove(key) {
    this.items.delete(key);
    if (!this.items.size) this.collapse(); else this.publish();
  }

  dismiss(thread) {
    for (const item of this.items.values()) if (item.thread === thread && ['message', 'notice'].includes(item.kind)) this.items.delete(item.key);
    this.sync();
  }

  prune() {
    const peer = this.getPeer();
    for (const item of this.items.values()) if (peer.state.mutedThreads.includes(item.thread)) this.items.delete(item.key);
    this.sync();
  }

  collapse() {
    this.clearTimers(); this.publishTimer = null;
    this.revision++;
    this.setMode('hidden');
  }

  async action(packet) {
    if (!packet || typeof packet !== 'object' || typeof packet.type !== 'string' || Object.keys(packet).some(k => !['type', 'key', 'delta', 'revision', 'height'].includes(k))) throw new Error('Permintaan ditolak.');
    if (packet.type === 'resize') {
      if (!Number.isInteger(packet.height) || packet.height < 140 || packet.height > 360) throw new Error('Ukuran tidak valid.');
      if (this.mode !== 'expanded' || packet.revision !== this.revision) return false;
      if (this.expandedHeight !== packet.height) { this.expandedHeight = packet.height; this.sync(); }
      return true;
    }
    if (packet.type === 'activity') {
      if (packet.revision !== this.revision) return false;
      this.armDismiss(); return true;
    }
    if (packet.type === 'peek') { if (this.mode === 'hidden') this.setMode('compact'); return true; }
    if (packet.type === 'collapse') {
      if (packet.revision !== undefined && packet.revision !== this.revision) return false;
      this.collapse(); return true;
    }
    if (packet.type === 'expand') {
      this.clearTimers(); this.publishTimer = null;
      this.revision++;
      this.pointerInside = true; this.win.setIgnoreMouseEvents(false);
      if (process.platform !== 'linux') this.win.setFocusable(true);
      this.setMode('expanded'); this.win.focus(); return true;
    }
    if (packet.type === 'launch') { this.reveal(); return true; }
    if (packet.type === 'pause') {
      this.pausedUntil = Date.now() + 30 * 60_000; this.sync(); clearTimeout(this.pauseTimer);
      this.pauseTimer = setTimeout(() => this.sync(), 30 * 60_000 + 10); this.pauseTimer.unref?.(); return true;
    }
    if (packet.type === 'reset' || packet.type === 'move') {
      const position = this.getSettings().notchPosition;
      const display = packet.type === 'reset' ? this.screen.getPrimaryDisplay() : this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint());
      if (packet.type === 'move' && (!Number.isFinite(packet.delta) || Math.abs(packet.delta) > 400)) throw new Error('Posisi tidak valid.');
      const fraction = packet.type === 'reset' ? .5 : Math.min(.95, Math.max(.05, (position?.display === display.id ? position.fraction : .5) + packet.delta / display.workArea.width));
      this.savePosition({ display: display.id, fraction }); this.sync(); return true;
    }
    const item = typeof packet.key === 'string' && this.items.get(packet.key);
    if (!item) throw new Error('Permintaan sudah tidak tersedia.');
    if (packet.type === 'select') { this.selectedKey = item.key; this.armDismiss(); this.publish(); return true; }
    if (packet.type === 'open') { this.reveal(item.thread); return true; }
    if (packet.type === 'accept' || packet.type === 'decline') {
      if (item.kind === 'file' && item.status === 'offered') {
        await this.decideFile(item.id, packet.type === 'accept');
        if (packet.type === 'accept') { item.status = 'receiving'; this.publish(); } else this.remove(item.key);
        return true;
      }
      const call = this.getPeer().activeCall;
      if (item.kind === 'call' && call?.id === item.id && call.peerId === item.thread && call.phase === 'incoming' && item.status === 'incoming') {
        item.status = 'preparing'; this.publish();
        if (packet.type === 'decline') await this.getPeer().sendCall({ action: 'end', id: call.id, peerId: call.peerId, reason: 'declined' });
        else { this.reveal(call.peerId); this.acceptCall(call.id); }
        return true;
      }
    }
    throw new Error('Permintaan ditolak.');
  }

  dispose() {
    this.clearTimers(); clearTimeout(this.pauseTimer); for (const off of this.listeners) off();
    this.ipcMain.removeHandler('lumi:state'); this.ipcMain.removeHandler('lumi:action'); this.ipcMain.removeAllListeners('lumi:pointer');
    this.win?.destroy(); this.items.clear();
  }
}
