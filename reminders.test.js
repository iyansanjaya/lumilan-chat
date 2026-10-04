import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Reminders } from './reminders.js';
import { LumilanPeer } from './peer.js';

function fixture(t) {
  let now=Date.now(), saved;
  const peer=Object.assign(new EventEmitter(),{id:'self',state:{messages:[],reminders:[],reminderTombstones:[]},online:new Set(),trusted:new Map([['other',{reminders:true}]]),
    save(){saved=structuredClone(this.state);this.emit('change');},sendTo:async()=>({})});
  const reminders=new Reminders(peer,{now:()=>now}); reminders.start();t.after(()=>reminders.stop());
  return {peer,reminders,advance:ms=>{now+=ms;},get now(){return now;},get saved(){return saved;}};
}
const packet=(f,extra={})=>({type:'reminder-request',id:randomUUID(),to:'self',title:'Rapat',note:'Catatan',dueAt:f.now+3600_000,createdAt:f.now,expiresAt:f.now+3600_000,...extra});
test('new contact reminders require an online capable peer; offline creation never changes storage',t=>{
  const f=fixture(t);
  assert.throws(()=>f.reminders.create({title:'Offline',to:'other',dueAt:f.now+10000}),/offline/);
  assert.equal(f.reminders.records.length,0);
  assert.equal(f.saved,undefined);
  f.peer.online.add('other');
  f.reminders.create({title:'Online',to:'other',dueAt:f.now+10000});
  f.peer.online.delete('other');
  assert.equal(f.reminders.records.length,1,'Disconnect discarded an in-flight request');
  assert.throws(()=>f.reminders.create({title:'Disconnected',to:'other',dueAt:f.now+10000}),/offline/);
  f.reminders.create({title:'Myself remains local',dueAt:f.now+10000});
  assert.equal(f.reminders.records.length,2);
});
async function until(check) {const end=Date.now()+6000;while(!check()){if(Date.now()>end)throw new Error('Reminder did not synchronize');await new Promise(r=>setTimeout(r,20));}}

test('pengingat lokal tahan restart, terlewat sekali, tunda, selesai, dan gagal simpan tanpa kehilangan data',t=>{
  const f=fixture(t), events=[];f.peer.on('reminder',e=>events.push(e));
  f.reminders.create({title:'Minum air',dueAt:f.now+1000});const id=f.reminders.records[0].id;
  f.advance(121000);f.reminders.tick();f.reminders.tick();assert.equal(events.length,1);assert.equal(events[0].missed,true);assert.equal(f.saved.reminders[0].status,'due');
  f.reminders.stop();f.peer.state=structuredClone(f.saved);f.reminders.start();f.reminders.tick();assert.equal(events.length,1,'Restart duplicated an already persisted alert');
  const old=structuredClone(f.peer.state);f.peer.save=()=>{throw new Error('ENOSPC');};
  assert.throws(()=>f.reminders.change(id,'done'),/ENOSPC/);assert.deepEqual(f.peer.state,old);
  f.peer.save=()=>{};f.reminders.change(id,'snooze',{dueAt:f.now+600000});f.advance(600000);f.reminders.tick();assert.equal(events.length,2);
  f.reminders.change(id,'done');f.reminders.change(id,'delete');assert.equal(f.reminders.timer,null);assert.equal(f.reminders.records.length,0);
  assert.throws(()=>f.reminders.create({title:'Past',dueAt:f.now}),/masa depan/);
  assert.throws(()=>f.reminders.create({title:'Future',dueAt:f.now+6*366*86400000}),/masa depan/);
});

test('permintaan langsung membutuhkan persetujuan, idempotensi, identitas benar, dan jadwal milik penerima',t=>{
  const f=fixture(t), p=packet(f),events=[];f.peer.on('reminder',e=>events.push(e));
  assert.equal(f.reminders.receiveRequest('other',p).status,'pending');f.reminders.receiveRequest('other',p);assert.equal(events.length,1);
  f.advance(1000);f.reminders.tick();assert.equal(f.reminders.records[0].status,'pending','No schedule before consent');
  assert.throws(()=>f.reminders.receiveRequest('attacker',p),/ID/);assert.throws(()=>f.reminders.receiveRequest('other',{...p,title:'Changed'}),/ID/);
  const chosen=f.now+7200000;f.reminders.change(p.id,'accept',{dueAt:chosen});
  assert.throws(()=>f.reminders.change(p.id,'accept',{dueAt:chosen}),/dijawab/);
  assert.equal(f.reminders.receiveCancel('other',p.id,p.expiresAt).status,'accepted');assert.equal(f.reminders.records[0].dueAt,chosen);
  f.reminders.change(p.id,'edit',{title:'My own title',note:'Private edit',dueAt:f.now+8000000});
  assert.equal(f.reminders.receiveRequest('other',p).dueAt,chosen,'Sender learns the accepted time, not private later edits');
  f.reminders.records[0].replyPending=false;f.reminders.change(p.id,'done');f.reminders.change(p.id,'delete');
  assert.equal(f.reminders.receiveRequest('other',p).status,'accepted');assert.equal(f.reminders.records.length,0,'Deleted record was revived by replay');
});

test('pembatalan mendahului permintaan, kedaluwarsa, batas spam, dan sumber pesan divalidasi',t=>{
  const f=fixture(t),p=packet(f);f.reminders.receiveCancel('other',p.id,p.expiresAt);
  assert.equal(f.reminders.receiveRequest('other',p).status,'canceled');assert.equal(f.reminders.records.length,0);
  assert.throws(()=>f.reminders.receiveCancel('attacker',p.id,p.expiresAt),/ID/);
  const expired=packet(f,{dueAt:f.now+1000,expiresAt:f.now+1000});f.reminders.receiveRequest('other',expired);f.advance(1001);f.reminders.tick();
  assert.equal(f.reminders.records[0].status,'expired');assert.throws(()=>f.reminders.change(expired.id,'accept',{dueAt:f.now+10000}),/kedaluwarsa/);
  assert.throws(()=>f.reminders.receiveRequest('other',packet(f,{to:'wrong'})),/valid/);
  assert.throws(()=>f.reminders.receiveRequest('other',packet(f,{title:'<b>text</b>\u202e'})),/valid/);
  assert.throws(()=>f.reminders.create({title:'Old client',to:'old',dueAt:f.now+10000}),/versi/);
  const message={id:randomUUID(),from:'other',to:'self',kind:'text'};f.peer.state.messages.push(message);
  assert.throws(()=>f.reminders.create({title:'Missing source',dueAt:f.now+10000,sourceThread:'notes'}),/sumber/);
  assert.throws(()=>f.reminders.create({title:'Bad link',dueAt:f.now+10000,sourceId:message.id,sourceThread:'notes'}),/sumber/);
  f.reminders.create({title:'Link',dueAt:f.now+10000,sourceId:message.id,sourceThread:'other'});
  for(let i=0;i<8;i++)f.reminders.receiveRequest('other',packet(f));
  assert.throws(()=>f.reminders.receiveRequest('other',packet(f)),/banyak/);
});

test('jawaban pending yang terlambat tidak membatalkan pembatalan lokal; acceptance yang menang tetap diakui',async t=>{
  const f=fixture(t);let release;f.peer.sendTo=()=>new Promise(r=>{release=r;});f.peer.online.add('other');
  f.reminders.create({title:'Race',to:'other',dueAt:f.now+10000});const r=f.reminders.records[0];
  f.reminders.change(r.id,'cancel');release({reminder:{id:r.id,status:'pending'}});await until(()=>!f.reminders.syncing.size);
  assert.equal(r.status,'canceled');assert.equal(r.cancelPending,true);
  f.peer.sendTo=async(_to,p)=>{assert.equal(p.type,'reminder-cancel');return {reminder:{id:r.id,status:'accepted',dueAt:f.now+60000,decidedAt:f.now}};};
  await f.reminders.syncRemote('other');assert.equal(r.status,'accepted');assert.equal(r.cancelPending,false);
  assert.throws(()=>f.reminders.change(r.id,'cancel'),/penerima/);
});

test('selisih jam kecil didukung, status palsu ditolak, dan restart menggabungkan jadwal yang terlewat',t=>{
  const f=fixture(t);f.peer.online.add('other');f.reminders.create({title:'Clock skew',to:'other',dueAt:f.now+3600000});const r=f.reminders.records[0];
  assert.throws(()=>f.reminders.receiveStatus('other',{id:r.id,status:'accepted',dueAt:f.now+1000,decidedAt:f.now+120000}),/valid/);
  f.reminders.receiveStatus('attacker',{id:r.id,status:'accepted',dueAt:f.now+1000,decidedAt:f.now});assert.equal(r.status,'queued');
  f.reminders.receiveStatus('other',{id:r.id,status:'accepted',dueAt:f.now-1000,decidedAt:f.now-2000});assert.equal(r.status,'accepted');
  f.reminders.create({title:'Missed 1',dueAt:f.now+1000});f.reminders.create({title:'Missed 2',dueAt:f.now+2000});
  f.reminders.stop();f.advance(300000);f.peer.state=structuredClone(f.saved);const events=[];f.peer.on('reminder',e=>events.push(e));f.reminders.start();f.reminders.tick();
  assert.equal(events.length,1);assert.equal(events[0].items.length,2);assert.equal(events[0].missed,true);f.reminders.tick();assert.equal(events.length,1);
});

test('jam mundur menunda jadwal UTC dan jam maju memicu sekali tanpa menghidupkan pengingat selesai',t=>{
  const f=fixture(t),events=[];f.peer.on('reminder',e=>events.push(e));
  f.reminders.create({title:'Clock adjustment',dueAt:f.now+60_000});const r=f.reminders.records[0], deadline=r.dueAt;
  f.advance(-3600_000);f.reminders.tick();assert.equal(r.status,'scheduled');assert.equal(r.dueAt,deadline);assert.equal(events.length,0);
  f.advance(7200_000);f.reminders.tick();assert.equal(r.status,'due');assert.equal(events.length,1);assert.equal(events[0].missed,true);
  f.advance(-7200_000);f.reminders.tick();f.advance(10800_000);f.reminders.tick();assert.equal(events.length,1);
  f.reminders.change(r.id,'done');f.reminders.stop();f.peer.state=structuredClone(f.saved);f.reminders.start();f.reminders.tick();
  assert.equal(f.reminders.records[0].status,'done');assert.equal(events.length,1);
});

test('jawaban jaringan dari proses yang dihentikan tidak menulis ulang penyimpanan setelah restart',async t=>{
  const f=fixture(t);let release;f.peer.online.add('other');f.peer.sendTo=()=>new Promise(r=>{release=r;});
  f.reminders.create({title:'In flight',to:'other',dueAt:f.now+3600000});const id=f.reminders.records[0].id;
  f.reminders.stop();f.reminders.start();const before=structuredClone(f.peer.state);
  release({reminder:{id,status:'accepted',dueAt:f.now+7200000,decidedAt:f.now}});await new Promise(r=>setTimeout(r,20));
  assert.deepEqual(f.peer.state,before);assert.equal(f.reminders.records[0].status,'queued');
});

test('riwayat pembatalan offline dapat dihapus setelah permintaannya kedaluwarsa',t=>{
  const f=fixture(t);f.peer.online.add('other');f.reminders.create({title:'Canceled offline',to:'other',dueAt:f.now+1000});f.peer.online.delete('other');const r=f.reminders.records[0];f.reminders.change(r.id,'cancel');
  assert.throws(()=>f.reminders.change(r.id,'delete'),/menghapus/);f.advance(1001);f.reminders.tick();assert.equal(r.cancelPending,false);
  f.reminders.change(r.id,'delete');assert.equal(f.reminders.records.length,0);assert.equal(f.reminders.timer,null);
});

test('peer LAN retries an in-flight request after restart, synchronizes decisions and preserves recipient ownership',async()=>{
  const root=mkdtempSync(join(tmpdir(),'lumilan-reminders-'));let a,b;
  try{
    a=new LumilanPeer({dataDir:join(root,'a'),discovery:false,listen:'/ip4/127.0.0.1/tcp/0'});b=new LumilanPeer({dataDir:join(root,'b'),discovery:false,listen:'/ip4/127.0.0.1/tcp/0'});
    await Promise.all([a.start(),b.start()]);a.rename('Alice');b.rename('Bob');await a.connectAddress(b.snapshot().addresses[0]);await until(()=>a.trusted.get(b.id)?.reminders && b.trusted.get(a.id)?.reminders);
    await a.stop();a=new LumilanPeer({dataDir:join(root,'a'),discovery:false,listen:'/ip4/127.0.0.1/tcp/0'});await a.start();
    await a.connectAddress(b.snapshot().addresses[0]);await until(()=>a.online.has(b.id));
    const originalSend=a.sendTo;a.sendTo=async()=>{throw new Error('Connection dropped during delivery');};
    a.reminders.create({title:'In-flight request',to:b.id,dueAt:Date.now()+3600000});const id=a.state.reminders[0].id;
    await until(()=>!a.reminders.syncing.size);a.sendTo=originalSend;assert.equal(a.state.reminders[0].status,'queued');
    await a.stop();a=new LumilanPeer({dataDir:join(root,'a'),discovery:false,listen:'/ip4/127.0.0.1/tcp/0'});await a.start();await a.connectAddress(b.snapshot().addresses[0]);
    await until(()=>b.state.reminders?.some(r=>r.id===id));await until(()=>a.state.reminders[0].status==='pending');
    b.reminders.change(id,'accept',{dueAt:Date.now()+7200000});await until(()=>a.state.reminders[0].status==='accepted');
    assert.throws(()=>a.reminders.change(id,'edit',{title:'Overwrite',dueAt:Date.now()+10000}),/diubah/);
    assert.throws(()=>a.reminders.change(id,'cancel'),/penerima/);
    const chosen=b.state.reminders[0].dueAt;await a.sendTo(b.id,{type:'reminder-cancel',id,expiresAt:a.state.reminders[0].expiresAt});assert.equal(b.state.reminders[0].dueAt,chosen);
    const request=a.state.reminders[0];await a.sendTo(b.id,{type:'reminder-request',id,to:b.id,title:request.title,note:request.note,dueAt:request.dueAt,createdAt:request.createdAt,expiresAt:request.expiresAt});assert.equal(b.state.reminders.length,1);
    a.reminders.create({title:'Decline',to:b.id,dueAt:Date.now()+3600000});const declined=a.state.reminders.at(-1).id;await until(()=>b.state.reminders.some(r=>r.id===declined));b.reminders.change(declined,'decline');await until(()=>a.state.reminders.at(-1).status==='declined');
  }finally{await Promise.allSettled([a?.stop(),b?.stop()]);rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});
