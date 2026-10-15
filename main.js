// Yolliyo masaüstü uygulaması — yolliyo.com panelini kendi penceresinde açar.
//
// Uygulama panelin kopyası değil: her açılışta canlı paneli yükler, yani
// panele gelen her güncelleme burada da anında görünür. Giriş bilgisi (oturum
// çerezi) "persist:yolliyo" bölümünde saklanır; kapatıp açınca tekrar giriş
// istenmez.
//
// Tarayıcıdan farkı (bu dosya + modüller):
//   - Kapatınca kapanmaz, sistem tepsisine iner; arka planda çalışmaya devam eder
//   - Yeni sipariş / kargo sorunu / WhatsApp... Windows bildirimi (bildirim.js)
//   - Görev çubuğu ikonunda "Yeni" sipariş sayısı (rozet.js)
//   - Windows açılınca tepside başlar (ayarlardan kapatılabilir)
//   - Uygulama kabuğu kendini günceller (guncelleme.js)

const { app, BrowserWindow, Menu, Tray, nativeImage, shell, session } = require("electron");
const path = require("path");
const fs = require("fs");
const ayarlar = require("./ayarlar");
const bildirim = require("./bildirim");
const rozet = require("./rozet");
const guncelleme = require("./guncelleme");

const TABAN = "https://www.yolliyo.com";
const PANEL_URL = `${TABAN}/panel`;
const BOLUM = "persist:yolliyo";
const IKON = path.join(__dirname, "build", "icon.png");
// Windows açılışında --arkaplan ile başlatılır: pencere açılmaz, tepside bekler.
const ARKAPLAN = process.argv.includes("--arkaplan");

// Uygulama içinde açılacak adresler. Bunların dışındaki her bağlantı
// (WhatsApp, Trendyol, kargo takip sayfaları...) varsayılan tarayıcıda açılır.
const IC_ALANLAR = ["yolliyo.com", "www.yolliyo.com"];

function alan(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}
const icMi = (url) => IC_ALANLAR.includes(alan(url));
// Etiket/barkod yazdırma pencereleri boş sayfa açıp içine yazıyor (BarcodeModal,
// print-barcode). Belge/PDF önizlemeleri blob: adresiyle açılıyor.
const yazdirmaMi = (url) => url === "" || url === "about:blank" || url.startsWith("blob:") || url.startsWith("data:");

// ── Pencere konumu/boyutu: kapatırken kaydet, açarken geri yükle ──────────
const durumDosyasi = () => path.join(app.getPath("userData"), "pencere.json");
function durumOku() {
  try { return JSON.parse(fs.readFileSync(durumDosyasi(), "utf8")); } catch { return null; }
}
function durumYaz(pencere) {
  try {
    const b = pencere.getNormalBounds();
    fs.writeFileSync(durumDosyasi(), JSON.stringify({ ...b, tamEkran: pencere.isMaximized() }));
  } catch { /* önemsiz */ }
}

let anaPencere = null;
let tepsi = null;
let cikiliyor = false;
let guncel = null;

function pencereAc({ goster }) {
  const d = durumOku();
  anaPencere = new BrowserWindow({
    width: d?.width ?? 1440,
    height: d?.height ?? 900,
    x: d?.x,
    y: d?.y,
    minWidth: 1024,
    minHeight: 640,
    title: "Yolliyo",
    icon: IKON,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true, // menü Alt tuşuyla görünür
    show: false,
    webPreferences: {
      partition: BOLUM,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (d?.tamEkran) anaPencere.maximize();
  if (goster) anaPencere.once("ready-to-show", () => anaPencere.show());

  // Kapat düğmesi uygulamayı kapatmaz, tepsiye indirir — bildirimler gelmeye
  // devam etsin. Gerçek çıkış tepsi menüsünden ya da Yolliyo → Çıkış.
  anaPencere.on("close", (e) => {
    durumYaz(anaPencere);
    if (cikiliyor) return;
    e.preventDefault();
    anaPencere.hide();
    if (!ayarlar.oku().ilkKapatmaUyarisi) {
      ayarlar.yaz({ ilkKapatmaUyarisi: true });
      tepsi?.displayBalloon({
        title: "Yolliyo arka planda çalışıyor",
        content: "Bildirimler gelmeye devam edecek. Açmak için tepsideki Yolliyo simgesine tıklayın.",
        iconType: "info",
      });
    }
  });
  anaPencere.on("closed", () => { anaPencere = null; });

  baglantilariYonet(anaPencere.webContents);
  anaPencere.webContents.on("did-fail-load", (_e, kod, _aciklama, url, anaCerceve) => {
    // -3: kullanıcı/yönlendirme iptali — hata değil
    if (!anaCerceve || kod === -3) return;
    anaPencere.loadFile(path.join(__dirname, "cevrimdisi.html"), { query: { hedef: url || PANEL_URL } });
  });

  anaPencere.loadURL(PANEL_URL);
}

/** Pencereyi gösterir; yol verilirse o panel sayfasını açar. */
function ac(yol) {
  if (!anaPencere) pencereAc({ goster: true });
  if (yol) anaPencere.loadURL(`${TABAN}${yol}`);
  if (anaPencere.isMinimized()) anaPencere.restore();
  anaPencere.show();
  anaPencere.focus();
}

function cik() {
  cikiliyor = true;
  app.quit();
}

/** Pencere içi gezinti ve yeni pencere isteklerini yönetir. */
function baglantilariYonet(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (icMi(url) || yazdirmaMi(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          icon: IKON,
          webPreferences: { partition: BOLUM, contextIsolation: true, sandbox: true },
        },
      };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  wc.on("will-navigate", (e, url) => {
    if (icMi(url) || url.startsWith("file:")) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
}

// Uygulama içinde açılan yazdırma/önizleme pencereleri de aynı kurallarla.
app.on("web-contents-created", (_e, wc) => {
  if (wc.getType() === "window") baglantilariYonet(wc);
});

/** Windows açılışında başlatma — kurulu sürümde geçerli. */
function windowsIleBaslat(acik) {
  ayarlar.yaz({ windowsIleBaslat: acik });
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: acik, args: ["--arkaplan"] });
}

function tepsiMenusu() {
  const a = ayarlar.oku();
  const hazir = guncel?.hazir();
  return Menu.buildFromTemplate([
    { label: "Yolliyo'yu Aç", click: () => ac() },
    { label: "Yeni Siparişler", click: () => ac("/panel/siparisler") },
    { label: "Teslim Edilemeyenler", click: () => ac("/panel/teslim-edilemeyen") },
    { type: "separator" },
    {
      label: "Bildirimler",
      submenu: [
        {
          label: "Bildirimler açık", type: "checkbox", checked: a.bildirimler,
          click: (m) => { ayarlar.yaz({ bildirimler: m.checked }); tepsiYenile(); },
        },
        { type: "separator" },
        ...Object.entries(ayarlar.KATEGORILER).map(([k, ad]) => ({
          label: ad, type: "checkbox", checked: a.kategoriler[k], enabled: a.bildirimler,
          click: (m) => { ayarlar.yaz({ kategoriler: { ...ayarlar.oku().kategoriler, [k]: m.checked } }); tepsiYenile(); },
        })),
        { type: "separator" },
        { label: "Test bildirimi gönder", click: () => bildirim.test({ ikon: IKON, ac }) },
      ],
    },
    {
      label: "Windows açılınca başlat", type: "checkbox", checked: a.windowsIleBaslat,
      click: (m) => { windowsIleBaslat(m.checked); tepsiYenile(); },
    },
    { type: "separator" },
    hazir
      ? { label: `Yeniden başlat ve güncelle (${hazir})`, click: () => { cikiliyor = true; guncel.kur(); } }
      : {
          label: `Güncellemeleri denetle (sürüm ${app.getVersion()})`,
          click: async () => {
            const s = await guncel?.denetle();
            const metin = { var: "Yeni sürüm indiriliyor; hazır olunca haber vereceğiz.", guncel: "Yolliyo güncel.", gelistirme: "Geliştirme sürümünde güncelleme denetlenmez.", hata: "Güncelleme sunucusuna ulaşılamadı." }[s] ?? "";
            tepsi?.displayBalloon({ title: "Güncelleme", content: metin, iconType: "info" });
          },
        },
    { label: "Çıkış", click: cik },
  ]);
}
const tepsiYenile = () => tepsi?.setContextMenu(tepsiMenusu());

function tepsiKur() {
  tepsi = new Tray(nativeImage.createFromPath(IKON).resize({ width: 16, height: 16 }));
  tepsi.setToolTip("Yolliyo");
  tepsiYenile();
  tepsi.on("click", () => ac());
}

function menuKur() {
  const yenile = () => BrowserWindow.getFocusedWindow()?.webContents.reload();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Yolliyo",
      submenu: [
        { label: "Panele Git", accelerator: "CmdOrCtrl+H", click: () => ac("/panel") },
        { label: "Yenile", accelerator: "CmdOrCtrl+R", click: yenile },
        { label: "Yenile", accelerator: "F5", click: yenile, visible: false },
        { type: "separator" },
        { label: "Pencereyi Kapat (arka planda çalışır)", accelerator: "CmdOrCtrl+W", click: () => anaPencere?.hide() },
        { label: "Çıkış", accelerator: "CmdOrCtrl+Q", click: cik },
      ],
    },
    {
      label: "Düzen",
      submenu: [
        { label: "Geri Al", role: "undo" },
        { label: "Yinele", role: "redo" },
        { type: "separator" },
        { label: "Kes", role: "cut" },
        { label: "Kopyala", role: "copy" },
        { label: "Yapıştır", role: "paste" },
        { label: "Tümünü Seç", role: "selectAll" },
      ],
    },
    {
      label: "Görünüm",
      submenu: [
        { label: "Geri", accelerator: "Alt+Left", click: () => BrowserWindow.getFocusedWindow()?.webContents.navigationHistory.goBack() },
        { label: "İleri", accelerator: "Alt+Right", click: () => BrowserWindow.getFocusedWindow()?.webContents.navigationHistory.goForward() },
        { type: "separator" },
        { label: "Yakınlaştır", role: "zoomIn" },
        { label: "Uzaklaştır", role: "zoomOut" },
        { label: "Gerçek Boyut", role: "resetZoom" },
        { type: "separator" },
        { label: "Tam Ekran", role: "togglefullscreen" },
        { label: "Geliştirici Araçları", role: "toggleDevTools" },
      ],
    },
  ]));
}

// Tek kopya: ikinci kez açılırsa mevcut pencere öne gelir.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows bildirimlerinde uygulama adı/ikonu doğru görünsün (package.json appId).
  app.setAppUserModelId("com.yolliyo.panel");

  app.on("second-instance", () => ac());

  app.whenReady().then(() => {
    // Google, gömülü tarayıcı imzası ("Electron/…") taşıyan isteklere farklı
    // davranabiliyor; standart Chrome kimliği gönderilir.
    const ses = session.fromPartition(BOLUM);
    ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|yolliyo-masaustu|Yolliyo)\/\S+/gi, ""));

    menuKur();
    tepsiKur();
    pencereAc({ goster: !ARKAPLAN });

    // İlk açılışta varsayılan: Windows ile başlat (tepsiden kapatılabilir).
    windowsIleBaslat(ayarlar.oku().windowsIleBaslat);

    bildirim.baslat({ ses, taban: TABAN, ikon: IKON, ac });
    const r = rozet.baslat({ ses, taban: TABAN, pencere: () => anaPencere, tepsi: () => tepsi });
    // Sipariş işlendikçe rozet hemen düşsün: panelde her sayfa geçişinde yenile.
    anaPencere.webContents.on("did-navigate-in-page", () => r.yokla());
    anaPencere.webContents.on("did-navigate", () => r.yokla());

    guncel = guncelleme.baslat({ ikon: IKON, onHazir: tepsiYenile });
  });

  app.on("before-quit", () => { cikiliyor = true; });
  // Pencereler kapansa da tepsi yaşar — uygulama yalnızca "Çıkış" ile kapanır.
  app.on("window-all-closed", () => {});
}
