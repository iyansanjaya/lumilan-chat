export function updateFailureDetail(error) {
  const text = String(error?.code || '') + ' ' + String(error?.message || error || '');
  if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH|ENETDOWN|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ETIMEDOUT|ECONNRESET/i.test(text))
    return 'Koneksi internet tidak tersedia atau terputus. Periksa jaringan, lalu coba lagi.';
  if (/\b404\b|not found/i.test(text))
    return 'Metadata pembaruan belum tersedia di GitHub Releases. Periksa apakah rilis dan berkas pembaruan sudah diterbitkan.';
  if (/\b401\b|\b403\b|unauthorized|forbidden/i.test(text))
    return 'Akses ke rilis pembaruan ditolak. Periksa izin repositori rilis.';
  if (/signature|code.?sign|notariz/i.test(text))
    return 'Paket pembaruan tidak lolos pemeriksaan tanda tangan aplikasi.';
  return 'Layanan pembaruan sedang bermasalah. Coba lagi nanti.';
}

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
        result?.downloadPromise?.catch(error => {
          downloading = false;
          console.warn('Unduhan pembaruan gagal:', error);
          if (manual) void dialog.showMessageBox(getWindow(), {
            type: 'warning', title: 'Unduhan pembaruan gagal', message: 'Pembaruan ditemukan, tetapi belum dapat diunduh.',
            detail: updateFailureDetail(error),
          });
        });
      } catch (error) {
        console.warn('Pemeriksaan pembaruan gagal:', error);
        if (manual) await dialog.showMessageBox(getWindow(), {
          type: 'warning', title: 'Pembaruan Lumilan Chat',
          message: 'Pembaruan belum dapat diperiksa.',
          detail: updateFailureDetail(error),
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
