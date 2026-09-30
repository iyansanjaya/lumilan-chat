import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pendingPath = dataDir => join(dataDir, 'startup-default-pending');

export function clearPendingDefaultStartup(dataDir) {
  const path = pendingPath(dataDir);
  if (existsSync(path)) unlinkSync(path);
}

export function enableDefaultStartup(dataDir, app, status, enable, warn = console.warn) {
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
