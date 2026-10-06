import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { peerIdFromString } from '@libp2p/peer-id';
import { CODE_P2P, multiaddr } from '@multiformats/multiaddr';
import multicastDNS from 'multicast-dns';
import type { Packet, Answer } from 'dns-packet';
import type { Multiaddr } from '@multiformats/multiaddr';
import type { PeerDiscoveryEvents } from '@libp2p/interface';
import { TypedEventEmitter } from 'main-event';
import type { NetworkInterfaceInfo } from 'node:os';
export interface DiscoverySocket extends Pick<ReturnType<typeof multicastDNS>, 'query' | 'respond' | 'destroy'> { on(event: 'ready', listener: () => void): unknown; on(event: 'query' | 'response', listener: (packet: Packet) => void): unknown; on(event: 'error' | 'warning', listener: (error: Error) => void): unknown }
export interface DiscoveryComponents { addressManager: { getAddresses(): Multiaddr[] } }

const SERVICE = '_p2p._udp.local';

export function lanIPv4(ip: string) {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 192 && b === 168 || a === 172 && b! >= 16 && b! <= 31;
}

export function lanInterfaces(networks: Record<string, Pick<NetworkInterfaceInfo, 'family' | 'address' | 'internal'>[] | undefined> = networkInterfaces()) {
  return [...new Set(Object.values(networks).flatMap(addresses =>
    (addresses || []).filter(address => address.family === 'IPv4' && !address.internal && lanIPv4(address.address))
      .map(address => address.address)))];
}

export const networkSignature = () => Object.entries(networkInterfaces())
  .flatMap(([name, addresses]) => (addresses || []).filter(address => address.family === 'IPv4' && !address.internal)
    .map(address => `${name}:${address.address}/${address.netmask}`)).sort().join('|');

export function addressPriority(address: string) {
  const ip = /^\/ip4\/([^/]+)/.exec(address)?.[1];
  if (!ip) return 3;
  if (ip.startsWith('127.')) return 2;
  const number = ip.split('.').map(Number).reduce((value, byte) => (value * 256 + byte) >>> 0, 0);
  for (const addresses of Object.values(networkInterfaces())) for (const local of addresses || []) {
    if (local.family !== 'IPv4' || local.internal) continue;
    const own = local.address.split('.').map(Number).reduce((value, byte) => (value * 256 + byte) >>> 0, 0);
    const mask = local.netmask.split('.').map(Number).reduce((value, byte) => (value * 256 + byte) >>> 0, 0);
    if ((number & mask) === (own & mask)) return 0;
  }
  return 1;
}

export function localAddress(address: string) {
  const match = /^\/ip4\/(\d+\.\d+\.\d+\.\d+)\/tcp\/(\d+)\/p2p\/([a-zA-Z0-9]+)$/.exec(address);
  return Boolean(match && lanIPv4(match[1]!) && +match[2]! >= 1 && +match[2]! <= 65535);
}

export function localPeer(connection: { remotePeer: { toString(): string }; remoteAddr: { toString(): string } }) {
  const id = connection.remotePeer.toString();
  const address = connection.remoteAddr.toString();
  return localAddress(address.endsWith('/p2p/' + id) ? address : address + '/p2p/' + id);
}

export class LanDiscovery extends TypedEventEmitter<PeerDiscoveryEvents> {
  components: DiscoveryComponents;
  getInterfaces: () => string[];
  createSocket: (options: multicastDNS.Options) => DiscoverySocket;
  name: string;
  sockets: DiscoverySocket[];
  timer: ReturnType<typeof setInterval> | null;
  constructor(components: DiscoveryComponents, getInterfaces = lanInterfaces, createSocket: (options: multicastDNS.Options) => DiscoverySocket = multicastDNS) {
    super();
    this.components = components;
    this.getInterfaces = getInterfaces;
    this.createSocket = createSocket;
    this.name = randomUUID().replaceAll('-', '');
    this.sockets = [];
    this.timer = null;
  }

  start() {
    if (this.sockets.length) return;
    for (const address of this.getInterfaces()) {
      // Wildcard bind receives multicast; interface fixes the outgoing NIC.
      const socket = this.createSocket({ interface: address, bind: '0.0.0.0' });
      socket.on('ready', () => socket.query({ questions: [{ name: SERVICE, type: 'PTR' }] }));
      socket.on('query', packet => this.answer(socket, packet, address));
      socket.on('response', packet => this.receive(packet));
      socket.on('error', error => console.warn(`mDNS ${address}:`, error));
      socket.on('warning', error => console.warn(`mDNS ${address}:`, error));
      this.sockets.push(socket);
    }
    this.timer = setInterval(() => {
      for (const socket of this.sockets) socket.query({ questions: [{ name: SERVICE, type: 'PTR' }] });
    }, 15_000);
    this.timer.unref();
  }

  async stop() {
    clearInterval(this.timer ?? undefined);
    this.timer = null;
    const sockets = this.sockets.splice(0);
    await Promise.all(sockets.map(socket => new Promise<void>(resolve => socket.destroy(resolve))));
  }

  answer(socket: DiscoverySocket, packet: Pick<Packet, 'questions'>, ip: string) {
    if (!packet.questions?.some(question => question.name === SERVICE && question.type === 'PTR')) return;
    const address = this.components.addressManager.getAddresses().map(address => address.toString())
      .find(address => address.startsWith(`/ip4/${ip}/tcp/`) && /\/p2p\//.test(address));
    if (!address) return;
    const name = `${this.name}.${SERVICE}`;
    socket.respond([
      { name: SERVICE, type: 'PTR', class: 'IN', ttl: 120, data: name },
      { name, type: 'TXT', class: 'IN', ttl: 120, data: `dnsaddr=${address}` },
    ]);
  }

  receive(packet: Pick<Packet, 'answers' | 'additionals'>) {
    const ptr = packet.answers?.find(answer => answer.type === 'PTR' && answer.name === SERVICE);
    if (!ptr || !('data' in ptr) || ptr.data === `${this.name}.${SERVICE}`) return;
    const found = new Map<string, Multiaddr[]>();
    for (const answer of [...(packet.answers || []), ...(packet.additionals || [])]) {
      if (answer.type !== 'TXT' || !('data' in answer) || answer.name !== ptr.data) continue;
      for (const bytes of Array.isArray(answer.data) ? answer.data : [answer.data]) {
        const value = bytes.toString();
        if (!value.startsWith('dnsaddr=')) continue;
        try {
          const address = multiaddr(value.slice(8));
          const id = address.getComponents().findLast(component => component.code === CODE_P2P)?.value;
          if (!id) continue;
          const addresses = found.get(id) || [];
          addresses.push(address.decapsulateCode(CODE_P2P));
          found.set(id, addresses);
        } catch { /* abaikan alamat yang tidak valid */ }
      }
    }
    for (const [id, multiaddrs] of found) {
      try { this.dispatchEvent(new CustomEvent('peer', { detail: { id: peerIdFromString(id), multiaddrs } })); }
      catch { /* abaikan identitas yang tidak valid */ }
    }
  }
}
