import { spawn, execFile } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';

export interface LockProcess extends Pick<EventEmitter, 'once'> {
  kill(): unknown;
  stdout: Pick<Readable, 'setEncoding' | 'on'>;
}
export interface LockQuery { kill(): unknown }
export interface LockDependencies {
  spawnProcess?: (command: string, args: string[], options: { env: NodeJS.ProcessEnv; windowsHide: boolean; stdio: ['ignore', 'pipe', 'ignore'] }) => LockProcess;
  call?: (command: string, args: string[], options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number; windowsHide: boolean }, callback: (error: Error | null, output: string) => void) => LockQuery;
}
interface LockProvider {
  name: string; path: string; revision: number;
  active: boolean | null | undefined;
  owner: string | null;
  query: LockQuery | null;
  child: LockProcess | undefined;
}


const services = [
  ['org.gnome.ScreenSaver', '/org/gnome/ScreenSaver'],
  ['org.freedesktop.ScreenSaver', '/org/freedesktop/ScreenSaver'],
  ['org.xfce.ScreenSaver', '/org/xfce/ScreenSaver'],
] as const;

// Electron has no Linux lock-screen events. Subscribe to the desktop's real state,
// not logind's Lock request or an idle timer. No shell, network, or idle polling.
export class LinuxScreenLock {
  readonly powerMonitor: Pick<EventEmitter, 'prependListener' | 'removeListener' | 'emit'>;
  readonly spawnProcess: NonNullable<LockDependencies['spawnProcess']>;
  readonly call: NonNullable<LockDependencies['call']>;
  readonly providers: LockProvider[];
  readonly resume: () => void;
  disposed = false;
  supported = false;
  locked: boolean | undefined;
  env: NodeJS.ProcessEnv = {};

  constructor(powerMonitor: LinuxScreenLock['powerMonitor'], { spawnProcess = spawn, call = execFile }: LockDependencies = {}) {
    this.powerMonitor = powerMonitor;
    this.spawnProcess = spawnProcess;
    this.call = call;
    this.providers = services.map(([name, path]) => ({ name, path, revision: 0, active: undefined, owner: null, query: null, child: undefined }));
    this.resume = () => this.refresh();
    // Recheck before Electron's resume listeners can expose a previously unlocked panel.
    powerMonitor.prependListener('resume', this.resume);
    this.refresh();
  }

  update() {
    if (this.disposed) return;
    const known = this.providers.filter(p => typeof p.active === 'boolean');
    this.supported = known.length > 0 && !this.providers.some(p => p.active === undefined);
    const locked = !this.supported || this.providers.some(p => p.active === undefined || p.active === true);
    if (this.locked !== locked) {
      this.locked = locked;
      this.powerMonitor.emit(locked ? 'lock-screen' : 'unlock-screen');
    }
  }

  query(p: LockProvider) {
    if (!p.owner) return;
    const revision = ++p.revision;
    p.query?.kill();
    p.active = undefined; this.update();
    p.query = this.call('gdbus', ['call', '--session', '--dest', p.owner, '--object-path', p.path,
      '--method', `${p.name}.GetActive`], { env: this.env, timeout: 3000, maxBuffer: 4096, windowsHide: true }, (error, output) => {
      if (this.disposed || p.revision !== revision) return;
      p.query = null;
      const value = /^\((true|false),\)\s*$/.exec(output || '');
      p.active = !error && value ? value[1] === 'true' : undefined;
      this.update();
    });
  }

  refresh() {
    if (this.disposed) return;
    this.env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
    for (const p of this.providers) {
      p.revision++; p.query?.kill(); p.child?.kill();
      p.owner = null; p.active = undefined;
    }
    this.update();
    for (const p of this.providers) {
      const child = this.spawnProcess('gdbus', ['monitor', '--session', '--dest', p.name, '--object-path', p.path],
        { env: this.env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      p.child = child;
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (this.disposed || p.child !== child) return;
        buffer += chunk;
        // Only these small fixed-format signals are needed. Bound partial/malicious output.
        if (buffer.length > 16384) {
          p.revision++; p.query?.kill(); p.query = null; p.active = undefined; this.update();
          child.kill(); return;
        }
        let end;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
          const prefix = `The name ${p.name} is owned by `;
          if (line.startsWith(prefix) && /^:\d+\.\d+$/.test(line.slice(prefix.length))) {
            p.owner = line.slice(prefix.length); this.query(p);
          } else if (line === `The name ${p.name} does not have an owner`) {
            p.revision++; p.query?.kill(); p.query = null; p.owner = null; p.active = null; this.update();
          } else if (p.owner && (line === `${p.path}: ${p.name}.ActiveChanged (true,)` || line === `${p.path}: ${p.name}.ActiveChanged (false,)`)) {
            p.revision++; p.query?.kill(); p.query = null;
            p.active = line.endsWith('(true,)'); this.update();
          }
        }
      });
      const lost = () => {
        if (this.disposed || p.child !== child) return;
        p.revision++; p.query?.kill(); p.query = null; p.owner = null; p.active = undefined;
        this.update();
      };
      // ponytail: no idle retry loop; resume restarts failed helpers, a new session bus requires an app restart.
      child.once('error', lost); child.once('exit', lost);
    }
  }

  dispose() {
    this.disposed = true;
    this.powerMonitor.removeListener('resume', this.resume);
    for (const p of this.providers) { p.query?.kill(); p.child?.kill(); }
  }
}
