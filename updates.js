import { translate as localize } from './public/i18n.js';

export function updateFailureDetail(error, translate = (source, values) => localize('id', source, values)) {
  const text = [error?.code, error?.cause?.code, error?.message, error?.cause?.message].filter(Boolean).join(' ');
  if (error?.code === 'RELEASE_NOT_FOUND') return translate('Rilis publik belum tersedia atau repositori rilis tidak dapat diakses.');
  if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH|ENETDOWN|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ETIMEDOUT|ECONNRESET|UND_ERR_CONNECT_TIMEOUT|AbortError|TimeoutError/i.test(text))
    return translate('Koneksi internet tidak tersedia atau terputus. Periksa jaringan, lalu coba lagi.');
  if (/\b404\b|not found/i.test(text))
    return translate('Metadata pembaruan belum tersedia di GitHub Releases. Periksa apakah rilis dan berkas pembaruan sudah diterbitkan.');
  if (/\b401\b|\b403\b|unauthorized|forbidden/i.test(text))
    return translate('Akses ke rilis pembaruan ditolak. Periksa izin repositori rilis.');
  if (/signature|code.?sign|notariz/i.test(text))
    return translate('Paket pembaruan tidak lolos pemeriksaan tanda tangan aplikasi.');
  return translate('Layanan pembaruan sedang bermasalah. Coba lagi nanti.');
}

export function startUpdates({ app, updater, dialog, getWindow, beforeInstall, translate = (source, values) => localize('id', source, values), platform = process.platform, arch = process.arch, fetchRelease = fetch, openRelease = async () => {} }) {
  const t = translate;
  const releasePage = 'https://github.com/iyansanjaya/lumilan-chat/releases/latest';
  async function checkMacRelease(manual) {
    try {
      const response = await fetchRelease('https://api.github.com/repos/iyansanjaya/lumilan-chat/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lumilan-chat' }, signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        const error = new Error(`GitHub API ${response.status}`);
        if (response.status === 404) error.code = 'RELEASE_NOT_FOUND';
        throw error;
      }
      const release = await response.json();
      const latest = String(release.tag_name || '').replace(/^v/, '');
      const parse = value => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
      const installed = parse(app.getVersion());
      const published = parse(latest);
      if (!installed || !published) throw new Error('Versi rilis tidak valid.');
      const newer = published.some((part, index) => part > installed[index] && published.slice(0, index).every((previous, offset) => previous === installed[offset]));
      if (!manual || !newer) {
        if (manual) await dialog.showMessageBox(getWindow(), { type: 'info', title: t('Pembaruan Lumilan Chat'), message: t('Lumilan Chat {version} sudah versi terbaru.', { version: app.getVersion() }) });
        return;
      }
      const name = arch === 'arm64' ? 'Apple Silicon' : 'Intel';
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const hasPackage = assets.some(asset => /\.dmg$/i.test(asset.name) && (arch === 'arm64' ? /arm64|universal/i.test(asset.name) : /x64|intel|universal/i.test(asset.name)));
      const { response: action } = await dialog.showMessageBox(getWindow(), {
        type: 'info', title: t('Pembaruan Lumilan Chat'),
        message: hasPackage ? t('Lumilan Chat {version} tersedia.', { version: latest }) : t('Lumilan Chat {version} tersedia, tetapi paket macOS {arch} belum diterbitkan.', { version: latest, arch: name }),
        detail: hasPackage ? t('Unduh dan pasang paket macOS secara manual dari halaman rilis.') : t('Periksa kembali setelah paket macOS diterbitkan.'),
        buttons: [t('Tutup'), t('Buka halaman rilis')], defaultId: hasPackage ? 1 : 0, cancelId: 0,
      });
      if (action === 1) await openRelease(release.html_url?.startsWith('https://github.com/iyansanjaya/lumilan-chat/releases/') ? release.html_url : releasePage);
    } catch (error) {
      console.warn('Pemeriksaan rilis macOS gagal:', error);
      if (manual) await dialog.showMessageBox(getWindow(), {
        type: 'warning', title: t('Pembaruan Lumilan Chat'), message: t('Pembaruan belum dapat diperiksa.'), detail: updateFailureDetail(error, t),
      });
    }
  }

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
        title: t('Pembaruan Lumilan Chat siap'),
        message: t('Lumilan Chat {version} siap dipasang.', { version: downloadedVersion }),
        detail: t('Aplikasi akan dimulai ulang. Percakapan dan identitas perangkat tetap tersimpan.'),
        buttons: [t('Nanti'), t('Mulai ulang dan pasang')],
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
      if (manual) await dialog.showMessageBox(getWindow(), { message: t('Pembaruan hanya dapat diperiksa dari Lumilan Chat yang sudah dipasang.') });
      return;
    }
    if (platform === 'darwin') return checkMacRelease(manual);
    if (downloadedVersion) return manual ? offerInstall() : undefined;
    if (downloading) {
      if (manual) await dialog.showMessageBox(getWindow(), { message: t('Pembaruan Lumilan Chat sedang diunduh.') });
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
            type: 'warning', title: t('Unduhan pembaruan gagal'), message: t('Pembaruan ditemukan, tetapi belum dapat diunduh.'),
            detail: updateFailureDetail(error, t),
          });
        });
      } catch (error) {
        console.warn('Pemeriksaan pembaruan gagal:', error);
        if (manual) await dialog.showMessageBox(getWindow(), {
          type: 'warning', title: t('Pembaruan Lumilan Chat'),
          message: t('Pembaruan belum dapat diperiksa.'),
          detail: updateFailureDetail(error, t),
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
        type: 'info', title: t('Pembaruan Lumilan Chat'), message: t('Lumilan Chat {version} sudah versi terbaru.', { version: app.getVersion() }),
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
