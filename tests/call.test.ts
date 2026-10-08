import type { CallSignal, CallPacket } from '../src/shared/model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LumilanPeer } from '../src/main/peer.js';
import { VoiceCall, type VoiceConnection, type VoiceTrack, type VoiceAudio, type VoiceMedia } from '../src/renderer/voice-call.js';


class TestPeerConnection extends EventTarget implements VoiceConnection {
  iceGatheringState: RTCIceGatheringState = 'complete';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  ontrack: VoiceConnection['ontrack'] = null;
  onconnectionstatechange: VoiceConnection['onconnectionstatechange'] = null;
  closed = false;
  constructor(config: RTCConfiguration) { super(); assert.deepEqual(config, {iceServers: []}); }
  addTrack(track: VoiceTrack) { assert.ok(track); }
  async createOffer(): Promise<RTCSessionDescriptionInit> { return {type: 'offer', sdp}; }
  async createAnswer(): Promise<RTCSessionDescriptionInit> { return {type: 'answer', sdp}; }
  async setLocalDescription(value: RTCSessionDescriptionInit) { this.localDescription = value; }
  async setRemoteDescription(value: RTCSessionDescriptionInit) { this.remoteDescription = value; }
  close() { this.closed = true; }
}
class NeverPeerConnection extends TestPeerConnection {
  constructor(config: RTCConfiguration) { super(config); throw new Error('Peer connection constructed before device validation'); }
}

const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fingerprint:sha-256 AA\r\n';

test('undangan panggilan LAN: persetujuan, penolakan, sibuk, SDP terlarang, dan putus', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-call-'));
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const c = new LumilanPeer({ dataDir: join(root, 'c'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  try {
    await a.start(); await b.start(); await c.start();
    a.rename('Andi'); b.rename('Budi'); c.rename('Citra');
    a.discovered.set(b.id, b.addresses);
    await a.probePeer(b.id);
    c.discovered.set(b.id, b.addresses);
    await c.probePeer(b.id);
    assert.equal(a.snapshot().peers[0]!.voiceCalls, true);
    const eventsA: CallSignal[] = [], eventsB: CallSignal[] = [];
    a.on('call', signal => eventsA.push(signal));
    b.on('call', signal => eventsB.push(signal));
    const id = randomUUID();
    await a.sendCall({ action: 'offer', id, peerId: b.id, sdp });
    assert.equal(eventsB.at(-1)!.type, 'offer');
    assert.equal(b.callState()!.phase, 'incoming');
    await assert.rejects(c.sendCall({ action: 'offer', id: randomUUID(), peerId: b.id, sdp }), /panggilan lain/);
    assert.equal(c.callState(), null);
    assert.equal(b.callState()!.peerId, a.id);
    await assert.rejects(b.sendCall({ action: 'offer', id: randomUUID(), peerId: a.id, sdp }), /berlangsung/);
    await assert.rejects(b.sendCall({ action: 'answer', id, peerId: a.id, sdp: sdp + 'm=video 9\r\n' }), /tidak valid/);
    await b.sendCall({ action: 'answer', id, peerId: a.id, sdp });
    assert.equal(eventsA.at(-1)!.type, 'answer');
    assert.equal(a.callState()!.phase, 'connecting');
    await assert.rejects(c.sendCall({ action: 'offer', id: randomUUID(), peerId: b.id, sdp }), /panggilan lain/);
    await a.sendCall({ action: 'end', id, peerId: b.id });
    assert.equal(b.callState(), null);
    assert.equal((eventsB.at(-1)! as Extract<CallSignal, {type: 'end'}>).reason, 'ended');

    let releaseMicrophone: (() => void) | undefined;
    const track = { stopped: false, stop() { this.stopped = true; } };
    const voiceB = new VoiceCall({
      bridge: { callMicrophone: async () => true, call: packet => b.sendCall(packet) },
      audio: { srcObject: null, pause() {}, play: async () => {} },
      media: { getUserMedia: () => new Promise(resolve => { releaseMicrophone = () => resolve({ getTracks: () => [track], getAudioTracks: () => [track] }); }) },
      PeerConnection: NeverPeerConnection, onChange: () => {}, onEnd: () => {},
    });
    const competing = randomUUID();
    const onCompetingCall = (signal: CallSignal) => { if (signal.id === competing) voiceB.signal(signal); };
    b.on('call', onCompetingCall);
    const preparing = voiceB.start(a.id);
    await new Promise(resolve => setImmediate(resolve));
    await c.sendCall({ action: 'offer', id: competing, peerId: b.id, sdp });
    assert.equal(voiceB.state?.phase, 'incoming');
    assert.equal(voiceB.state?.peerId, c.id);
    releaseMicrophone!();
    await preparing;
    assert.equal(track.stopped, true);
    assert.equal(voiceB.state?.phase, 'incoming');
    assert.equal(b.callState()?.peerId, c.id);
    await b.sendCall({ action: 'end', id: competing, peerId: c.id, reason: 'declined' });
    assert.equal(voiceB.state, null);
    b.off('call', onCompetingCall);

    const declined = randomUUID();
    await a.sendCall({ action: 'offer', id: declined, peerId: b.id, sdp });
    await b.sendCall({ action: 'end', id: declined, peerId: a.id, reason: 'declined' });
    assert.equal((eventsA.at(-1)! as Extract<CallSignal, {type: 'end'}>).reason, 'declined');
    const unavailable = randomUUID();
    await a.sendCall({ action: 'offer', id: unavailable, peerId: b.id, sdp });
    await b.sendCall({ action: 'end', id: unavailable, peerId: a.id, reason: 'device-error' });
    assert.equal((eventsA.at(-1)! as Extract<CallSignal, {type: 'end'}>).reason, 'device-error');
    b.state.trusted.find(peer => peer.id === a.id)!.callErrorReason = false;
    const legacy = randomUUID();
    await a.sendCall({ action: 'offer', id: legacy, peerId: b.id, sdp });
    await b.sendCall({ action: 'end', id: legacy, peerId: a.id, reason: 'device-error' });
    assert.equal((eventsA.at(-1)! as Extract<CallSignal, {type: 'end'}>).reason, 'ended');
    b.state.trusted.find(peer => peer.id === a.id)!.callErrorReason = true;
    b.setProfile({ name: 'Budi', status: 'dnd', about: '', avatar: '' });
    await assert.rejects(a.sendCall({ action: 'offer', id: randomUUID(), peerId: b.id, sdp }), /Jangan ganggu/);
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
    await a.stop(); await b.stop(); await c.stop(); rmSync(root, { recursive: true, force: true });
  }
});

test('audio WebRTC langsung: hanya mikrofon, mute, akhiri, dan pembatalan izin', async () => {
  const tracks: (VoiceTrack & {stopped: boolean})[] = [];
  const createTrack = () => { const track = { enabled: true, stopped: false, stop() { this.stopped = true; } }; tracks.push(track); return track; };
  const FakePeerConnection = TestPeerConnection;
  const audio = (): VoiceAudio => ({ srcObject: null, play: async () => {}, pause() {} });
  const media = { getUserMedia: async (constraints: MediaStreamConstraints) => { assert.equal(constraints.video, false); const track = createTrack(); return { getTracks: () => [track], getAudioTracks: () => [track] }; } };
  const messages: CallPacket[] = [];
  let caller: VoiceCall, receiver: VoiceCall;
  caller = new VoiceCall({ bridge: { callMicrophone: async () => true, call: async packet => { messages.push(packet); if (packet.action === 'offer') await receiver.signal({ ...packet, type: 'offer' }); if (packet.action === 'end') await receiver.signal({ ...packet, type: 'end', reason: 'ended' }); } }, audio: audio(), media, PeerConnection: FakePeerConnection, onChange: () => {}, onEnd: () => {} });
  receiver = new VoiceCall({ bridge: { callMicrophone: async () => true, call: async packet => { if (packet.action === 'answer') await caller.signal({ ...packet, type: 'answer' }); } }, audio: audio(), media, PeerConnection: FakePeerConnection, onChange: () => {}, onEnd: () => {} });
  await caller.start('peer-b');
  assert.equal(receiver.state!.phase, 'incoming');
  assert.equal(tracks.length, 1);
  await receiver.accept();
  assert.equal(caller.call!.pc!.remoteDescription!.type, 'answer');
  assert.equal(receiver.call!.pc!.remoteDescription!.type, 'offer');
  caller.call!.pc!.connectionState = 'connected'; caller.call!.pc!.onconnectionstatechange!();
  assert.equal(caller.state!.phase, 'active');
  caller.toggleMute(); assert.equal(caller.state!.muted, true); assert.equal(tracks[0]!.enabled, false);
  caller.end();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(caller.state, null); assert.equal(receiver.state, null);
  assert.ok(tracks.every(track => track.stopped));
  assert.equal(messages.filter(packet => packet.action === 'offer').length, 1);

  const denied = new VoiceCall({ bridge: { callMicrophone: async () => false, call: async () => { throw new Error('No offer expected'); } }, audio: audio(), media, PeerConnection: FakePeerConnection, onChange: () => {}, onEnd: () => {} });
  await assert.rejects(denied.start('peer-b'), /Izin mikrofon ditolak/);
  assert.equal(denied.state, null);

  let releaseMicrophone: (() => void) | undefined;
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
  releaseMicrophone!();
  await pending;
  assert.equal(waiting.state, null);
  assert.equal(lateTrack.stopped, true);

  const blockedAudio = { srcObject: null, pause() {}, play: async () => { const error = new Error('blocked'); error.name = 'NotAllowedError'; throw error; } };
  const blocked = new VoiceCall({ bridge: { callMicrophone: async () => true, call: async () => true },
    audio: blockedAudio, media, PeerConnection: FakePeerConnection, onChange: () => {}, onEnd: () => {} });
  await blocked.start('peer-b');
  blocked.call!.pc!.ontrack!({ streams: [{}] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(blocked.state!.audioBlocked, true);
  assert.match(blocked.state!.audioIssue!, /Putar audio/);
  blocked.end();
});

test('perangkat audio tidak tersedia membatalkan undangan dan membersihkan mikrofon', async () => {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const packets: CallPacket[] = [];
  const call = new VoiceCall({
    bridge: { callMicrophone: async () => true, call: async packet => { packets.push(packet); } },
    audio: { pause() {}, srcObject: null, play: async () => {} },
    media: { getUserMedia: async () => stream, enumerateDevices: async () => [{ kind: 'audioinput' }] },
    PeerConnection: NeverPeerConnection, onChange: () => {}, onEnd: () => {},
  });
  call.incoming({ id: randomUUID(), peerId: 'peer-a', sdp });
  await assert.rejects(call.accept(), /Speaker atau perangkat keluaran audio tidak terdeteksi/);
  assert.equal(track.stopped, true);
  assert.equal(call.state, null);
  assert.equal((packets.at(-1)! as Extract<CallPacket, {action: 'end'}>).reason, 'device-error');
});

test('panggilan dibatalkan saat pemeriksaan perangkat dan speaker terlepas saat aktif', async () => {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let releaseDevices: ((devices: Pick<MediaDeviceInfo, 'kind'>[]) => void) | undefined;
  const media: EventTarget & Required<Pick<VoiceMedia, 'getUserMedia' | 'enumerateDevices'>> = Object.assign(new EventTarget(), {getUserMedia: async () => stream, enumerateDevices: async (): Promise<Pick<MediaDeviceInfo, 'kind'>[]> => []});
  media.getUserMedia = async () => stream;
  media.enumerateDevices = () => new Promise(resolve => { releaseDevices = resolve; });
  const sent: CallPacket[] = [];
  const call = new VoiceCall({ bridge: { callMicrophone: async () => true, call: async packet => { sent.push(packet); } },
    audio: { srcObject: null, pause() {}, play: async () => {} }, media, PeerConnection: NeverPeerConnection, onChange: () => {}, onEnd: () => {} });
  const pending = call.start('peer-b');
  await new Promise(resolve => setImmediate(resolve));
  call.end();
  releaseDevices!([{ kind: 'audiooutput' }]);
  await pending;
  assert.equal(track.stopped, true);
  assert.equal(call.state, null);
  assert.equal(sent.length, 0);

  const FakePeerConnection = TestPeerConnection;
  let devices: Pick<MediaDeviceInfo, 'kind'>[] = [{ kind: 'audiooutput' }];
  const nextTrack = { stop() {} };
  media.getUserMedia = async () => ({ getTracks: () => [nextTrack], getAudioTracks: () => [nextTrack] });
  media.enumerateDevices = async () => devices;
  const next = new VoiceCall({ bridge: { callMicrophone: async () => true, call: async () => true },
    audio: { srcObject: null, pause() {}, play: async () => {} }, media, PeerConnection: FakePeerConnection, onChange: () => {}, onEnd: () => {} });
  await next.start('peer-b');
  devices = [{ kind: 'audioinput' }];
  media.dispatchEvent(new Event('devicechange'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(next.state!.audioBlocked, true);
  assert.match(next.state!.audioIssue!, /Speaker atau headset terputus/);
  next.end();
});
