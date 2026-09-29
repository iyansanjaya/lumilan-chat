import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LumilanPeer } from './peer.js';
import { VoiceCall } from './public/voice-call.js';

const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fingerprint:sha-256 AA\r\n';

test('undangan panggilan LAN: persetujuan, penolakan, sibuk, SDP terlarang, dan putus', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-call-'));
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  try {
    await a.start(); await b.start();
    a.rename('Andi'); b.rename('Budi');
    a.discovered.set(b.id, b.addresses);
    await a.probePeer(b.id);
    assert.equal(a.snapshot().peers[0].voiceCalls, true);
    const eventsA = [], eventsB = [];
    a.on('call', signal => eventsA.push(signal));
    b.on('call', signal => eventsB.push(signal));
    const id = randomUUID();
    await a.sendCall({ action: 'offer', id, peerId: b.id, sdp });
    assert.equal(eventsB.at(-1).type, 'offer');
    assert.equal(b.callState().phase, 'incoming');
    await assert.rejects(b.sendCall({ action: 'offer', id: randomUUID(), peerId: a.id, sdp }), /berlangsung/);
    await assert.rejects(b.sendCall({ action: 'answer', id, peerId: a.id, sdp: sdp + 'm=video 9\r\n' }), /tidak valid/);
    await b.sendCall({ action: 'answer', id, peerId: a.id, sdp });
    assert.equal(eventsA.at(-1).type, 'answer');
    assert.equal(a.callState().phase, 'connecting');
    await a.sendCall({ action: 'end', id, peerId: b.id });
    assert.equal(b.callState(), null);
    assert.equal(eventsB.at(-1).reason, 'ended');

    const declined = randomUUID();
    await a.sendCall({ action: 'offer', id: declined, peerId: b.id, sdp });
    await b.sendCall({ action: 'end', id: declined, peerId: a.id, reason: 'declined' });
    assert.equal(eventsA.at(-1).reason, 'declined');
    b.setProfile({ name: 'Budi', status: 'dnd', about: '', avatar: '' });
    await assert.rejects(a.sendCall({ action: 'offer', id: randomUUID(), peerId: b.id, sdp }), /tidak tersedia/);
    assert.equal(a.callState(), null);
    b.setProfile({ name: 'Budi', status: 'active', about: '', avatar: '' });
    await assert.rejects(a.sendCall({ action: 'offer', id: randomUUID(), peerId: b.id, sdp: 'v=0\r\nm=video 9\r\n' }), /tidak valid/);

    const disconnected = randomUUID();
    await a.sendCall({ action: 'offer', id: disconnected, peerId: b.id, sdp });
    await b.stop();
    assert.equal(b.callState(), null);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(a.callState(), null);
  } finally {
    await a.stop(); await b.stop(); rmSync(root, { recursive: true, force: true });
  }
});

test('audio WebRTC langsung: hanya mikrofon, mute, akhiri, dan pembatalan izin', async () => {
  const tracks = [];
  const createTrack = () => { const track = { enabled: true, stopped: false, stop() { this.stopped = true; } }; tracks.push(track); return track; };
  class FakePeerConnection extends EventTarget {
    constructor(config) { super(); assert.deepEqual(config, { iceServers: [] }); this.iceGatheringState = 'complete'; this.connectionState = 'new'; }
    addTrack(track) { assert.ok(track); }
    async createOffer() { return { type: 'offer', sdp }; }
    async createAnswer() { return { type: 'answer', sdp }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    close() { this.closed = true; }
  }
  const audio = () => ({ srcObject: null, play: async () => {}, pause() {} });
  const media = { getUserMedia: async constraints => { assert.equal(constraints.video, false); const track = createTrack(); return { getTracks: () => [track], getAudioTracks: () => [track] }; } };
  const messages = [];
  let caller, receiver;
  caller = new VoiceCall({ bridge: { callMicrophone: async () => true, call: async packet => { messages.push(packet); if (packet.action === 'offer') await receiver.signal({ ...packet, type: 'offer' }); if (packet.action === 'end') await receiver.signal({ ...packet, type: 'end', reason: 'ended' }); } }, audio: audio(), media, PeerConnection: FakePeerConnection, onChange: () => {}, onEnd: () => {} });
  receiver = new VoiceCall({ bridge: { callMicrophone: async () => true, call: async packet => { if (packet.action === 'answer') await caller.signal({ ...packet, type: 'answer' }); } }, audio: audio(), media, PeerConnection: FakePeerConnection, onChange: () => {}, onEnd: () => {} });
  await caller.start('peer-b');
  assert.equal(receiver.state.phase, 'incoming');
  assert.equal(tracks.length, 1);
  await receiver.accept();
  assert.equal(caller.call.pc.remoteDescription.type, 'answer');
  assert.equal(receiver.call.pc.remoteDescription.type, 'offer');
  caller.call.pc.connectionState = 'connected'; caller.call.pc.onconnectionstatechange();
  assert.equal(caller.state.phase, 'active');
  caller.toggleMute(); assert.equal(caller.state.muted, true); assert.equal(tracks[0].enabled, false);
  caller.end();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(caller.state, null); assert.equal(receiver.state, null);
  assert.ok(tracks.every(track => track.stopped));
  assert.equal(messages.filter(packet => packet.action === 'offer').length, 1);

  const denied = new VoiceCall({ bridge: { callMicrophone: async () => false, call: async () => { throw new Error('No offer expected'); } }, audio: audio(), media, PeerConnection: FakePeerConnection, onChange: () => {}, onEnd: () => {} });
  await assert.rejects(denied.start('peer-b'), /Izin mikrofon ditolak/);
  assert.equal(denied.state, null);

  let releaseMicrophone;
  const lateTrack = createTrack();
  const waiting = new VoiceCall({
    bridge: { callMicrophone: async () => true, call: async () => { throw new Error('Offer sent after cancel'); } },
    audio: audio(), PeerConnection: FakePeerConnection,
    media: { getUserMedia: () => new Promise(resolve => { releaseMicrophone = () => resolve({ getTracks: () => [lateTrack], getAudioTracks: () => [lateTrack] }); }) },
    onChange: () => {}, onEnd: () => {},
  });
  const pending = waiting.start('peer-b');
  await new Promise(resolve => setImmediate(resolve));
  waiting.end();
  releaseMicrophone();
  await pending;
  assert.equal(waiting.state, null);
  assert.equal(lateTrack.stopped, true);
});
