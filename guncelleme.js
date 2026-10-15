// KENDİ KENDİNİ GÜNCELLEME — electron-updater.
//
// Panel her açılışta canlıdan yüklendiği için zaten güncel; bu yalnızca
// uygulama kabuğu (bildirim, tepsi, rozet...) için. Yeni sürüm package.json
// "build.publish" adresinden kontrol edilir, arka planda indirilir ve
// uygulama kapanınca (ya da tepsiden "Yeniden başlat") kurulur.
//
// Sürüm yayınlanmamışsa ya da adrese ulaşılamazsa sessizce geçilir.

const { app, Notification } = require("electron");
const { autoUpdater } = require("electron-updater");

const KONTROL_MS = 6 * 60 * 60 * 1000;
let hazirSurum = null;
let degisince = () => {};

function baslat({ ikon, onHazir }) {
  // Geliştirme (npm start) sırasında güncelleme denetlenmez.
  if (!app.isPackaged) return { denetle: async () => "gelistirme", hazir: () => null, kur: () => {} };
  degisince = onHazir ?? degisince;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("update-downloaded", (bilgi) => {
    hazirSurum = bilgi.version;
    degisince(hazirSurum);
    if (Notification.isSupported()) {
      new Notification({
        title: `Yolliyo ${bilgi.version} hazır`,
        body: "Uygulama kapanınca güncellenecek. Hemen kurmak için tepsiden \"Yeniden başlat ve güncelle\".",
        icon: ikon,
      }).show();
    }
  });
  autoUpdater.on("error", () => { /* yayın yok / ağ yok — sessiz */ });

  const denetle = async () => {
    try {
      const r = await autoUpdater.checkForUpdates();
      return r?.isUpdateAvailable ? "var" : "guncel";
    } catch {
      return "hata";
    }
  };
  denetle();
  setInterval(denetle, KONTROL_MS);

  return {
    denetle,
    hazir: () => hazirSurum,
    kur: () => autoUpdater.quitAndInstall(true, true),
  };
}

module.exports = { baslat };
