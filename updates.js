export function startUpdates({ app, updater, dialog, getWindow, beforeInstall }) {
  let checking;
  let manualCheck = false;
  let downloading = false;
  let downloadedVersion;
  let promptOpen = false;

  async function offerInstall() {
    if (promptOpen || !downloadedVersion) return;
    promptOpen = true;
    try {
      const { response } = await dialog.showMessageBox(getWindow(), {
        type: 'info',
        title: 'Pembaruan Lumilan Chat siap',
        message: `Lumilan Chat ${downloadedVersion} siap dipasang.`,
        detail: 'Aplikasi akan dimulai ulang. Percakapan dan identitas perangkat tetap tersimpan.',
        buttons: ['Nanti', 'Mulai ulang dan pasang'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      if (response === 1) {
        beforeInstall();
        updater.quitAndInstall(false, true);
      }
    } finally { promptOpen = false; }
  }

  async function check(manual = false) {
    if (!app.isPackaged) {
      if (manual) await dialog.showMessageBox(getWindow(), { message: 'Pembaruan hanya dapat diperiksa dari Lumilan Chat yang sudah dipasang.' });
      return;
    }
    if (downloadedVersion) return manual ? offerInstall() : undefined;
    if (downloading) {
      if (manual) await dialog.showMessageBox(getWindow(), { message: 'Pembaruan Lumilan Chat sedang diunduh.' });
      return;
    }
    if (checking) return checking;
    manualCheck = manual;
    checking = (async () => {
      try {
        const result = await updater.checkForUpdates();
        result?.downloadPromise?.catch(error => { downloading = false; console.warn('Unduhan pembaruan gagal:', error); });
      } catch (error) {
        console.warn('Pemeriksaan pembaruan gagal:', error);
        if (manual) await dialog.showMessageBox(getWindow(), {
          type: 'warning', title: 'Pembaruan Lumilan Chat',
          message: 'Pembaruan belum dapat diperiksa.',
          detail: 'Periksa koneksi internet atau coba lagi nanti.',
        });
      } finally { checking = undefined; manualCheck = false; }
    })();
    return checking;
  }

  if (app.isPackaged) {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.on('update-available', () => { downloading = true; });
    updater.on('update-not-available', () => {
      if (manualCheck) void dialog.showMessageBox(getWindow(), {
        type: 'info', title: 'Pembaruan Lumilan Chat', message: `Lumilan Chat ${app.getVersion()} sudah versi terbaru.`,
      }).catch(error => console.warn('Dialog pembaruan gagal:', error));
    });
    updater.on('update-downloaded', info => {
      downloading = false;
      if (downloadedVersion === info.version) return;
      downloadedVersion = info.version;
      void offerInstall().catch(error => console.warn('Dialog pembaruan gagal:', error));
    });
    updater.on('error', error => { downloading = false; console.warn('Pembaruan Lumilan Chat gagal:', error); });
    setTimeout(() => { void check(); }, 15_000).unref();
    setInterval(() => { void check(); }, 6 * 60 * 60_000).unref();
  }

  return check;
}
