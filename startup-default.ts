import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pendingPath = (dataDir: string) => join(dataDir, 'startup-default-pending');

export function clearPendingDefaultStartup(dataDir: string) {
  const path = pendingPath(dataDir);
  if (existsSync(path)) unlinkSync(path);
}

export function enableDefaultStartup(dataDir: string, app: { isPackaged: boolean; commandLine: { hasSwitch(name: string): boolean } }, status: () => { supported: boolean }, enable: (value: boolean) => unknown, warn: (message: string, error: unknown) => void = console.warn) {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    writeFileSync(pendingPath(dataDir), '', { flag: 'wx', mode: 0o600 });
  }
  if (!existsSync(pendingPath(dataDir)) || !app.isPackaged || app.commandLine.hasSwitch('lumilan-ui-smoke')) return;
  if (process.platform === 'darwin' && (/^\/Volumes\//.test(process.execPath) || process.execPath.includes('/AppTranslocation/'))) return;
  try {
    if (status().supported) {
      enable(true);
      clearPendingDefaultStartup(dataDir);
    }
  } catch (error) {
    warn('Autostart bawaan tidak dapat diaktifkan:', error);
  }
}
