import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATES = new Set(['queued', 'pending', 'scheduled', 'due', 'done', 'canceled', 'accepted', 'declined', 'expired']);
const DECISIONS = new Set(['pending', 'accepted', 'declined', 'expired', 'canceled']);
const DAY = 86400_000;
const text = (v, max) => typeof v === 'string' && v.length <= max ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim() : '';
const future = (v, now) => Number.isSafeInteger(v) && v > now && v <= now + 5 * 366 * DAY;
const terminal = r => ['done', 'canceled', 'accepted', 'declined', 'expired'].includes(r.status);

// One persisted source of truth for local schedules and authenticated direct requests.
export class Reminders {
  constructor(peer, { now = Date.now } = {}) {
    this.peer = peer; this.now = now; this.running = false; this.syncing = new Set(); this.retryAt = new Map();
  }
  get records() { return Array.isArray(this.peer.state.reminders) ? this.peer.state.reminders : []; }
  start() {
    this.generation=(this.generation||0)+1;
    const seen=new Set();
    this.peer.state.reminders = (Array.isArray(this.records) ? this.records : []).filter(r => r && UUID.test(r.id) &&
      ['local', 'incoming', 'outgoing'].includes(r.kind) && STATES.has(r.status) && typeof r.from === 'string' && r.from.length<=160 && typeof r.to === 'string' && r.to.length<=160 &&
      text(r.title, 160) && typeof r.note === 'string' && r.note.length <= 1000 && Number.isSafeInteger(r.dueAt) && r.dueAt>0 && r.dueAt<=this.now()+5*366*DAY+60_000 &&
      Number.isSafeInteger(r.createdAt) && (r.kind === 'local' ? r.from === this.peer.id && r.to === this.peer.id :
        Number.isSafeInteger(r.expiresAt) && r.expiresAt<=r.createdAt+7*DAY && (r.kind === 'incoming' ? r.to === this.peer.id : r.from === this.peer.id)))
      .filter(r=>!(r.kind==='outgoing'?['scheduled','due','done']:r.kind==='local'?['queued','pending','accepted','declined','expired']:['queued','accepted']).includes(r.status))
      .filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return true;}).slice(0,512);
    this.peer.state.reminderTombstones = (Array.isArray(this.peer.state.reminderTombstones) ? this.peer.state.reminderTombstones : []).filter(r => r && UUID.test(r.id) &&
      typeof r.from === 'string' && DECISIONS.has(r.decision) && Number.isSafeInteger(r.expiresAt) && r.expiresAt > this.now()).slice(0, 1024);
    this.running = true; this.schedule();
  }
  stop() { this.running = false; this.generation=(this.generation||0)+1; clearTimeout(this.timer); this.timer = null; this.retryAt.clear(); this.syncing.clear(); }
  list() { return this.records.map(({ replyPending, requestTitle, requestNote, ...r }) => ({ ...r, ackPending:Boolean((replyPending||r.cancelPending)&&r.expiresAt>this.now()) })); }
  commit(change) {
    const before = structuredClone([this.records, this.peer.state.reminderTombstones]);
    change();
    try { this.peer.save(); }
    catch (error) { [this.peer.state.reminders, this.peer.state.reminderTombstones] = before; this.schedule(); throw error; }
    this.schedule();
  }
  fields(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['title', 'note', 'dueAt', 'to', 'sourceThread', 'sourceId'].includes(k))) throw new Error('Pengingat tidak valid.');
    const title = text(value.title, 160), note = value.note === undefined ? '' : text(value.note, 1000);
    if (!title || value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 1000) || !future(value.dueAt, this.now())) throw new Error('Isi judul dan pilih waktu pengingat di masa depan (maksimal 5 tahun).');
    if((value.sourceId!==undefined||value.sourceThread!==undefined)&&(!UUID.test(value.sourceId)||typeof value.sourceThread!=='string')) throw new Error('Pesan sumber pengingat tidak tersedia.');
    const source = value.sourceId && this.peer.state.messages.find(m => m.id === value.sourceId);
    if (value.sourceId && (!source || !this.inThread(source,value.sourceThread))) throw new Error('Pesan sumber pengingat tidak tersedia.');
    return { title, note, dueAt: value.dueAt, ...(source ? { sourceId: source.id, sourceThread: value.sourceThread } : {}) };
  }
  inThread(m, thread) {
    return thread === 'notes' ? m.kind === 'note' || m.note === true : thread === 'announcements' ? m.kind === 'announcement' :
      typeof thread === 'string' && thread.startsWith('room:') ? m.roomId === thread.slice(5) :
      !m.roomId && !m.note && (m.from === this.peer.id && m.to === thread || m.from === thread && m.to === this.peer.id);
  }
  source(id) {
    const r=this.records.find(r=>r.id===id), index=this.peer.state.messages.findIndex(m=>m.id===r?.sourceId && this.inThread(m,r.sourceThread));
    if(index<0) throw new Error('Pesan sumber pengingat tidak tersedia.');
    return {thread:r.sourceThread,id:r.sourceId,messages:this.peer.listMessages(r.sourceThread,this.peer.state.messages[index+1]?.id || null)};
  }
  create(value) {
    if (this.records.length >= 512) throw new Error('Batas 512 pengingat tercapai. Hapus riwayat pengingat yang selesai.');
    const data = this.fields(value), to = value.to || this.peer.id;
    if (to !== this.peer.id && (!this.peer.trusted.has(to) || this.peer.trusted.get(to).reminders !== true)) throw new Error('Kontak belum mendukung pengingat. Gunakan versi Lumilan terbaru pada kedua perangkat.');
    if (to !== this.peer.id && !this.peer.online.has(to)) throw new Error('Penerima sedang offline.');
    if (to !== this.peer.id && this.records.filter(r => r.to === to && ['queued', 'pending'].includes(r.status)).length >= 10) throw new Error('Maksimal 10 permintaan pengingat yang belum dijawab per kontak.');
    const now = this.now(), r = { ...data, id: randomUUID(), kind: to === this.peer.id ? 'local' : 'outgoing', from: this.peer.id, to,
      createdAt: now, status: to === this.peer.id ? 'scheduled' : 'queued', ...(to !== this.peer.id ? { expiresAt: Math.min(data.dueAt, now + 7 * DAY), decision: 'pending' } : {}) };
    this.commit(() => this.records.push(r)); this.syncRemote(to); return this.list();
  }
  change(id, action, value) {
    const r = this.records.find(item => item.id === id);
    if (!r) throw new Error('Pengingat sudah tidak tersedia.');
    if (action === 'accept' || action === 'decline') {
      if (r.kind !== 'incoming' || r.status !== 'pending' || r.expiresAt <= this.now()) throw new Error('Permintaan pengingat sudah kedaluwarsa atau dijawab.');
      if (action === 'accept' && !future(value?.dueAt, this.now())) throw new Error('Pilih waktu pengingat di masa depan.');
      this.commit(() => { r.decision = action === 'accept' ? 'accepted' : 'declined'; r.status = action === 'accept' ? 'scheduled' : 'declined';
        r.decidedAt = this.now(); if (action === 'accept') { r.dueAt = value.dueAt; r.acceptedDueAt = value.dueAt; } r.replyPending = true; });
      this.syncRemote(r.from);
    } else if (action === 'edit' || action === 'snooze') {
      if (r.kind === 'outgoing' || !['scheduled', 'due'].includes(r.status)) throw new Error('Pengingat ini tidak dapat diubah.');
      const data = action === 'edit' ? this.fields(value) : { dueAt: value?.dueAt };
      if (!future(data.dueAt, this.now())) throw new Error('Pilih waktu pengingat di masa depan.');
      this.commit(() => { Object.assign(r, data); r.status = 'scheduled'; delete r.firedAt; });
    } else if (action === 'done') {
      if (r.kind === 'outgoing' || !['scheduled', 'due'].includes(r.status)) throw new Error('Pengingat ini tidak dapat diselesaikan.');
      this.commit(() => { r.status = 'done'; r.completedAt = this.now(); });
    } else if (action === 'cancel') {
      if (r.kind === 'incoming' && r.status === 'pending') return this.change(id, 'decline');
      if (r.kind === 'outgoing' ? !['queued', 'pending'].includes(r.status) : !['scheduled', 'due'].includes(r.status)) throw new Error('Jadwal yang telah diterima hanya dapat diubah oleh penerima.');
      this.commit(() => { r.status = 'canceled'; if (r.kind === 'outgoing') r.cancelPending = true; }); this.syncRemote(r.to);
    } else if (action === 'delete') {
      if (!terminal(r) || (r.replyPending || r.cancelPending) && r.expiresAt>this.now()) throw new Error('Selesaikan atau batalkan pengingat sebelum menghapusnya.');
      if (r.kind === 'incoming' && r.expiresAt > this.now() && this.peer.state.reminderTombstones.length >= 1024) throw new Error('Riwayat permintaan masih diperlukan. Coba hapus lagi nanti.');
      this.commit(() => {
        this.peer.state.reminderTombstones = this.peer.state.reminderTombstones.filter(r=>r.expiresAt>this.now());
        if (r.kind === 'incoming' && r.expiresAt > this.now()) this.peer.state.reminderTombstones.push({ id:r.id, from:r.from, expiresAt:r.expiresAt, decision:r.decision, acceptedDueAt:r.acceptedDueAt, decidedAt:r.decidedAt, receivedAt:r.receivedAt });
        this.peer.state.reminders = this.records.filter(item => item !== r);
      });
    } else throw new Error('Tindakan pengingat tidak valid.');
    return this.list();
  }
  response(r) { return { id:r.id, status:r.decision || 'pending', ...(r.acceptedDueAt ? { dueAt:r.acceptedDueAt } : {}), ...(r.decidedAt ? { decidedAt:r.decidedAt } : {}) }; }
  receiveRequest(from, packet) {
    if (!packet || Object.keys(packet).some(k => !['type', 'id', 'to', 'title', 'note', 'dueAt', 'createdAt', 'expiresAt'].includes(k)) || !UUID.test(packet.id) || packet.to !== this.peer.id) throw new Error('Permintaan pengingat tidak valid.');
    const old = this.records.find(r => r.id === packet.id), tombstone = this.peer.state.reminderTombstones.find(r => r.id === packet.id);
    if (old || tombstone) {
      const prior = old || tombstone;
      if (prior.from !== from || old && (old.kind !== 'incoming' || old.requestTitle !== packet.title || old.requestNote !== packet.note || old.proposedDueAt !== packet.dueAt || old.createdAt !== packet.createdAt || old.expiresAt !== packet.expiresAt)) throw new Error('ID pengingat sudah digunakan.');
      return this.response(prior);
    }
    const now = this.now();
    if (!text(packet.title,160) || text(packet.title,160) !== packet.title || typeof packet.note !== 'string' || packet.note.length > 1000 || text(packet.note,1000) !== packet.note ||
      !future(packet.dueAt,now) || !Number.isSafeInteger(packet.createdAt) || packet.createdAt > now + 60_000 || packet.createdAt < now - 7*DAY ||
      !Number.isSafeInteger(packet.expiresAt) || packet.expiresAt <= now || packet.expiresAt > Math.min(packet.dueAt,packet.createdAt+7*DAY)) throw new Error('Permintaan pengingat sudah kedaluwarsa atau tidak valid.');
    if (this.records.length >= 512 || this.records.filter(r => r.kind === 'incoming' && r.status === 'pending').length >= 64 ||
      [...this.records,...this.peer.state.reminderTombstones].filter(r => r.from === from && (r.status === 'pending' || r.receivedAt > now - 60_000)).length >= 10) throw new Error('Terlalu banyak permintaan pengingat. Coba lagi nanti.');
    const r = { id:packet.id, kind:'incoming', from, to:this.peer.id, title:packet.title, note:packet.note, dueAt:packet.dueAt,
      requestTitle:packet.title, requestNote:packet.note, proposedDueAt:packet.dueAt, createdAt:packet.createdAt, receivedAt:now, expiresAt:packet.expiresAt, status:'pending', decision:'pending' };
    this.commit(() => this.records.push(r)); this.peer.emit('reminder', { type:'request', items:[{...r}] }); return this.response(r);
  }
  receiveStatus(from, packet) {
    if (!packet || Object.keys(packet).some(k => !['type','id','status','dueAt','decidedAt'].includes(k)) || !UUID.test(packet.id) || !DECISIONS.has(packet.status)) throw new Error('Status pengingat tidak valid.');
    const r = this.records.find(r => r.id === packet.id && r.kind === 'outgoing' && r.to === from);
    if (!r || !['queued','pending','expired'].includes(r.status) && !(r.status === 'canceled' && r.cancelPending)) return;
    if (packet.status === 'accepted' && (!Number.isSafeInteger(packet.dueAt) || packet.dueAt <= packet.decidedAt || packet.dueAt > this.now()+5*366*DAY+60_000 ||
      !Number.isSafeInteger(packet.decidedAt) || packet.decidedAt > r.expiresAt || packet.decidedAt > this.now()+60_000 || packet.decidedAt < r.createdAt-60_000)) throw new Error('Jadwal penerima tidak valid.');
    if (packet.status === 'pending' && (r.status === 'expired' || r.cancelPending)) return;
    this.commit(() => { r.status = packet.status; r.decision = packet.status; if (packet.status === 'accepted') r.recipientDueAt = packet.dueAt; });
  }
  receiveCancel(from, id, expiresAt) {
    if (!UUID.test(id) || !Number.isSafeInteger(expiresAt) || expiresAt > this.now()+7*DAY) throw new Error('Pengingat tidak valid.');
    const old=this.records.find(r=>r.id===id) || this.peer.state.reminderTombstones.find(r=>r.id===id);
    if(old && (old.from!==from || old.kind && old.kind!=='incoming')) throw new Error('ID pengingat sudah digunakan.');
    const r = this.records.find(r => r.id === id && r.kind === 'incoming' && r.from === from);
    if (r?.status === 'pending') this.commit(() => { r.status = r.decision = 'canceled'; });
    if (!r && expiresAt > this.now() && !this.peer.state.reminderTombstones.some(t => t.id === id)) {
      if (this.peer.state.reminderTombstones.length >= 1024) throw new Error('Terlalu banyak permintaan pengingat.');
      if(this.peer.state.reminderTombstones.filter(t=>t.from===from&&t.receivedAt>this.now()-60_000).length>=10) throw new Error('Terlalu banyak permintaan pengingat.');
      this.commit(() => this.peer.state.reminderTombstones.push({ id, from, expiresAt, receivedAt:this.now(), decision:'canceled' }));
    }
    // Accepted schedules belong to the recipient; sender cancellation cannot remove them.
    return r || old ? this.response(r || old) : {id,status:'canceled'};
  }
  async syncRemote(target) {
    if (!this.running || target === this.peer.id || !this.peer.online.has(target) || this.peer.trusted.get(target)?.reminders !== true || this.syncing.has(target)) return;
    this.syncing.add(target);
    const generation=this.generation;
    try {
      for (const r of [...this.records]) {
        if (!this.running || generation!==this.generation) break;
        if (r.kind === 'outgoing' && r.to === target && !r.cancelPending && ['queued','pending'].includes(r.status) && r.expiresAt > this.now()) {
          const reply = await this.peer.sendTo(target, { type:'reminder-request', id:r.id, to:r.to, title:r.title, note:r.note, dueAt:r.dueAt, createdAt:r.createdAt, expiresAt:r.expiresAt });
          if(!this.running || generation!==this.generation) break;
          if (!reply.reminder) throw new Error('Kontak belum mendukung pengingat.');
          this.receiveStatus(target,reply.reminder);
        } else if (r.kind === 'incoming' && r.from === target && r.replyPending) {
          await this.peer.sendTo(target,{ type:'reminder-status', ...this.response(r) });
          if(!this.running || generation!==this.generation) break;
          if (this.records.includes(r)) this.commit(() => { r.replyPending = false; });
        } else if (r.kind === 'outgoing' && r.to === target && r.cancelPending) {
          const reply = await this.peer.sendTo(target,{ type:'reminder-cancel', id:r.id, expiresAt:r.expiresAt });
          if(!this.running || generation!==this.generation) break;
          if (reply.reminder) this.receiveStatus(target,reply.reminder);
          if (this.records.includes(r)) this.commit(() => { r.cancelPending = false; });
        }
      }
      if(!this.running || generation!==this.generation) return;
      this.retryAt.delete(target);
      if(this.records.some(r=>(r.to===target||r.from===target)&&r.deliveryPending)) this.commit(()=>{for(const r of this.records) if(r.to===target||r.from===target) delete r.deliveryPending;});
    } catch {
      if(!this.running || generation!==this.generation) return;
      this.retryAt.set(target,this.now()+30_000);
      try { if(this.records.some(r=>(r.kind==='outgoing'&&r.to===target||r.kind==='incoming'&&r.from===target&&r.replyPending)&&!r.deliveryPending)) this.commit(()=>{
        for(const r of this.records) if(r.kind==='outgoing'&&r.to===target&&['queued','pending'].includes(r.status)||r.kind==='incoming'&&r.from===target&&r.replyPending) r.deliveryPending=true;
      }); } catch { /* Keep the persisted request unchanged if storage is unavailable. */ }
    }
    finally {
      if(generation!==this.generation) return;
      this.syncing.delete(target);
      if (!this.retryAt.has(target) && this.records.some(r => r.kind === 'outgoing' && r.to === target && (r.status === 'queued' || r.cancelPending) || r.kind === 'incoming' && r.from === target && r.replyPending)) this.retryAt.set(target,this.now()+1000);
      this.schedule();
    }
  }
  tick() {
    if (!this.running) return;
    const now = this.now(), due = this.records.filter(r => r.status === 'scheduled' && r.dueAt <= now);
    const expired = this.records.filter(r => ['queued','pending'].includes(r.status) && r.expiresAt <= now);
    const released = this.records.filter(r => r.cancelPending && r.expiresAt <= now);
    if (due.length || expired.length || released.length) {
      this.commit(() => {
        for (const r of due) { r.status = 'due'; r.firedAt = now; }
        for (const r of expired) { r.status = r.decision = 'expired'; if (r.kind === 'incoming') { r.decidedAt = now; r.replyPending = true; } }
        for (const r of released) { r.cancelPending=false; delete r.deliveryPending; }
        this.peer.state.reminderTombstones = this.peer.state.reminderTombstones.filter(r => r.expiresAt > now);
      });
      if (due.length) this.peer.emit('reminder',{ type:'due', items:due.map(r => ({...r})), missed:due.some(r => now-r.dueAt>60_000) });
    }
    for (const [target,time] of this.retryAt) if (time<=now) { this.retryAt.delete(target); this.syncRemote(target); }
    for (const r of expired) if (r.kind === 'incoming') this.syncRemote(r.from);
    this.schedule();
  }
  schedule() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.running) return;
    const times = this.records.flatMap(r => r.status === 'scheduled' ? [r.dueAt] : ['queued','pending'].includes(r.status)||r.cancelPending ? [r.expiresAt] : []);
    for (const [target,time] of this.retryAt) if (this.peer.online.has(target)) times.push(time);
    if (!times.length) return;
    // Recheck active deadlines at most once/minute to handle wall-clock changes. No idle interval.
    this.timer = setTimeout(() => { try { this.tick(); } catch (error) { console.warn('Pengingat gagal disimpan:',error); this.timer=setTimeout(()=>this.schedule(),30_000); this.timer.unref?.(); } }, Math.max(1,Math.min(60_000,Math.min(...times)-this.now())));
    this.timer.unref?.();
  }
}
