// Yolliyo masaüstü uygulaması — yolliyo.com panelini kendi penceresinde açar.
//
// Uygulama panelin kopyası değil: her açılışta canlı paneli yükler, yani
// panele gelen her güncelleme burada da anında görünür. Giriş bilgisi (oturum
// çerezi) "persist:yolliyo" bölümünde saklanır.
//
// PENCERE YAPISI: Windows'un gri başlık çubuğu yok. Pencere (BaseWindow) iki
// katmandan oluşur — üstte kendi başlık çubuğumuz (baslik.html: logo, gezinme,
// arama, sayaçlar), altında panel. Küçült/büyüt/kapat düğmeleri Windows'un
// kendi düğmeleri (titleBarOverlay), başlık çubuğumuzun sağına çizilir.
//
// Modüller:
//   bildirim.js   Windows bildirimleri
//   sayaclar.js   Yeni / teslim edilemedi sayıları + görev çubuğu rozeti
//   guncelleme.js Kendi kendini güncelleme
//   ayarlar.js    Kullanıcı tercihleri
// Ek pencereler: açılış ekranı (acilis.html), hızlı arama (arama.html),
// Depo Ekranı (panelin /depo-ekrani sayfası, tam ekran).

const {
  app, BaseWindow, BrowserWindow, WebContentsView, Menu, Tray, nativeImage, shell, session,
  ipcMain, globalShortcut, screen, powerSaveBlocker,
} = require("electron");
const path = require("path");
const fs = require("fs");
const ayarlar = require("./ayarlar");
const bildirim = require("./bildirim");
const sayaclar = require("./sayaclar");
const guncelleme = require("./guncelleme");

const TABAN = "https://www.yolliyo.com";
const PANEL_URL = `${TABAN}/panel`;
const BOLUM = "persist:yolliyo";
const IKON = path.join(__dirname, "build", "icon.png");
const BASLIK_Y = 44;
const BASLIK_RENK = "#12100e";
const ARAMA_KISAYOL = "CommandOrControl+Shift+Y";
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
// Sistemdeki uygulamaya giden bağlantılar: web (tarayıcı), tel: (telefon
// uygulaması — Teslim Edilemeyenler'deki "Ara"), mailto:, sms:, whatsapp:.
// Önceden yalnızca http(s) dışarı açılıyordu; "Ara" sessizce hiçbir şey yapmıyordu.
const disaAcilir = (url) => /^(https?|tel|mailto|sms|whatsapp):/i.test(url);
// Chromium tel:/mailto: tıklamasında gezinme olayını iki kez tetikliyor
// (ölçüldü) — telefon uygulaması iki kez açılmasın.
let sonDisAcilan = { url: "", an: 0 };
function disariAc(url) {
  if (!disaAcilir(url)) return;
  const simdi = Date.now();
  if (url === sonDisAcilan.url && simdi - sonDisAcilan.an < 1500) return;
  sonDisAcilan = { url, an: simdi };
  shell.openExternal(url);
}

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

let anaPencere = null;   // BaseWindow
let baslikView = null;   // WebContentsView — kendi başlık çubuğumuz
let panelView = null;    // WebContentsView — panel
let bulView = null;      // WebContentsView — sayfada bul çubuğu (Ctrl+F)
let acilis = null;       // açılış ekranı
let aramaPencere = null; // hızlı arama
let depoPencere = null;  // Depo Ekranı (TV)
let depoUyanik = null;   // powerSaveBlocker kimliği
let tepsi = null;
let cikiliyor = false;
let guncel = null;
let sayac = null;
let yukleniyor = false;

const panel = () => panelView?.webContents;

/* ── Sayfada bul (Ctrl+F) ─────────────────────────────────── */
// Tarayıcıdaki Ctrl+F'nin karşılığı. Chromium'un kendi arama motoru
// (findInPage) kullanılır; çubuk ayrı, şeffaf bir katman.

const BUL_G = 420;
const BUL_Y = 64;
let bulAcik = false;
let bulSon = ""; // son aranan metin — panelde F3 için
let bulIstek = 0;  // son findInPage istek no
let bulAltSinir = 1; // bundan küçük numaralı yanıtlar eski aramaya ait
let bulYedek = null;

function bulAc() {
  if (!anaPencere || !panelView) return;
  if (!bulView) {
    bulView = new WebContentsView({
      // backgroundThrottling kapalı: yazarken arama gecikmesi (90 ms) Chromium'un
      // arka plan yavaşlatmasıyla ~1 sn'ye çıkmasın (ölçüldü).
      webPreferences: { preload: path.join(__dirname, "baslik-preload.js"), contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    bulView.setBackgroundColor("#00000000");
    bulView.webContents.loadFile(path.join(__dirname, "bul.html"));
    bulView.webContents.on("before-input-event", (e, g) => {
      // Çubuk odaktayken de Ctrl+F metni seçsin; F3 sonraki eşleşme.
      if (g.type === "keyDown" && (g.control || g.meta) && g.key.toLowerCase() === "f") { e.preventDefault(); bulView.webContents.send("bul:gosterildi", null); }
    });
  }
  if (!bulAcik) {
    anaPencere.contentView.addChildView(bulView);
    bulAcik = true;
    yerlesim();
  }
  bulView.webContents.focus();
  const gonder = () => bulView.webContents.send("bul:gosterildi", null);
  if (bulView.webContents.isLoading()) bulView.webContents.once("did-finish-load", gonder); else gonder();
}

function bulKapat() {
  if (!bulAcik) return;
  panel()?.stopFindInPage("clearSelection");
  anaPencere?.contentView.removeChildView(bulView);
  bulAcik = false;
  panel()?.focus();
}

ipcMain.on("bul:ara", (_e, metin, secenek) => {
  const t = String(metin ?? "").slice(0, 200);
  bulSon = t;
  if (!t) { panel()?.stopFindInPage("clearSelection"); return; }
  // DİKKAT: Electron'da findNext adının tersini söyler — true = YENİ arama
  // oturumu başlat, false = mevcut aramada sonraki/önceki eşleşmeye geç.
  // Ters gönderilince Chromium hiç sonuç döndürmüyordu (ölçüldü).
  const devam = Boolean(secenek?.findNext);
  // Alt sınır çağrıdan ÖNCE kurulur: Chromium yanıtı findInPage numarayı
  // döndürmeden önce bildirebiliyor (ölçüldü); o yanıt da kabul edilmeli.
  bulAltSinir = bulIstek + 1;
  bulIstek = panel()?.findInPage(t, { forward: secenek?.forward !== false, findNext: !devam, matchCase: false }) ?? bulIstek;
  // Eşleşme yokken Chromium bazen hiç "found-in-page" göndermiyor (ölçüldü):
  // kısa sürede yanıt gelmezse "bulunamadı" say.
  clearTimeout(bulYedek);
  const no = bulIstek;
  bulYedek = setTimeout(() => {
    if (no === bulIstek) bulView?.webContents.send("bul:sonuc", { activeMatchOrdinal: 0, matches: 0 });
  }, 350);
});
ipcMain.on("bul:temizle", () => panel()?.stopFindInPage("clearSelection"));
ipcMain.on("bul:kapat", bulKapat);

/* ── Ana pencere ─────────────────────────────────────────── */

function yerlesim() {
  if (!anaPencere || anaPencere.isDestroyed()) return;
  const { width, height } = anaPencere.getContentBounds();
  const ust = anaPencere.isFullScreen() ? 0 : BASLIK_Y;
  baslikView.setBounds({ x: 0, y: 0, width, height: ust });
  panelView.setBounds({ x: 0, y: ust, width, height: Math.max(0, height - ust) });
  // Bul çubuğu panelin sağ üst köşesinde (Chrome'daki yeri); gölge payı dahil.
  bulView?.setBounds({ x: Math.max(0, width - BUL_G - 8), y: ust, width: BUL_G, height: BUL_Y });
}

function baslikDurumu() {
  if (!baslikView || baslikView.webContents.isDestroyed()) return;
  const wc = panel();
  const s = sayac?.son() ?? { oturum: false, yeni: null, sorunlu: null };
  baslikView.webContents.send("baslik:durum", {
    geriVar: Boolean(wc?.navigationHistory.canGoBack()),
    ileriVar: Boolean(wc?.navigationHistory.canGoForward()),
    yukleniyor,
    ...s,
  });
}

function pencereAc() {
  const d = durumOku();
  anaPencere = new BaseWindow({
    width: d?.width ?? 1440,
    height: d?.height ?? 900,
    x: d?.x,
    y: d?.y,
    minWidth: 1024,
    minHeight: 640,
    title: "Yolliyo",
    icon: IKON,
    backgroundColor: BASLIK_RENK,
    show: false,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: BASLIK_RENK, symbolColor: "#c6c1b9", height: BASLIK_Y },
  });
  if (d?.tamEkran) anaPencere.maximize();

  baslikView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, "baslik-preload.js"), contextIsolation: true, sandbox: true },
  });
  baslikView.setBackgroundColor(BASLIK_RENK);
  baslikView.webContents.loadFile(path.join(__dirname, "baslik.html"));
  baslikView.webContents.on("did-finish-load", baslikDurumu);

  panelView = new WebContentsView({
    webPreferences: { partition: BOLUM, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  panelView.setBackgroundColor("#ffffff");

  anaPencere.contentView.addChildView(panelView);
  anaPencere.contentView.addChildView(baslikView);
  yerlesim();
  for (const olay of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    anaPencere.on(olay, yerlesim);
  }

  // Kapat düğmesi uygulamayı kapatmaz, tepsiye indirir — bildirimler gelmeye
  // devam etsin. Gerçek çıkış tepsi menüsünden ya da Ctrl+Q.
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

  const wc = panel();
  baglantilariYonet(wc);
  kisayollar(wc);
  wc.on("found-in-page", (_e, s) => {
    // Önceki aramanın geç gelen yanıtı yeni sonucu (ve "bulunamadı" yedeğini) ezmesin.
    if (s.requestId < bulAltSinir) return;
    clearTimeout(bulYedek);
    bulView?.webContents.send("bul:sonuc", { activeMatchOrdinal: s.activeMatchOrdinal, matches: s.matches });
  });
  // Başka sayfaya geçince eski aramanın vurguları anlamsız — çubuk kapanır.
  wc.on("did-navigate", bulKapat);
  wc.on("did-start-loading", () => { yukleniyor = true; baslikDurumu(); });
  wc.on("did-stop-loading", () => { yukleniyor = false; baslikDurumu(); });
  for (const olay of ["did-navigate", "did-navigate-in-page"]) {
    wc.on(olay, () => { baslikDurumu(); sayac?.yokla(); });
  }
  wc.on("page-title-updated", (_e, baslik) => anaPencere?.setTitle(baslik ? `${baslik}` : "Yolliyo"));
  wc.on("did-fail-load", (_e, kod, _aciklama, url, anaCerceve) => {
    // -3: kullanıcı/yönlendirme iptali — hata değil
    if (!anaCerceve || kod === -3) return;
    wc.loadFile(path.join(__dirname, "cevrimdisi.html"), { query: { hedef: url || PANEL_URL } });
  });

  wc.loadURL(PANEL_URL);
}

/** Pencereyi gösterir; yol verilirse o panel sayfasını açar. */
function ac(yol) {
  if (!anaPencere) pencereAc();
  if (yol) panel().loadURL(`${TABAN}${yol}`);
  if (anaPencere.isMinimized()) anaPencere.restore();
  anaPencere.show();
  anaPencere.focus();
  panel().focus();
}

function cik() {
  cikiliyor = true;
  app.quit();
}

/* ── Açılış ekranı ───────────────────────────────────────── */

function acilisGoster() {
  acilis = new BrowserWindow({
    width: 440, height: 300, frame: false, resizable: false, movable: true, show: false,
    skipTaskbar: false, backgroundColor: "#0a0908", icon: IKON, title: "Yolliyo",
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  acilis.loadFile(path.join(__dirname, "acilis.html"), { query: { surum: app.getVersion() } });
  acilis.once("ready-to-show", () => acilis?.show());
  acilis.on("closed", () => { acilis = null; });

  const baslangic = Date.now();
  let bitti = false;
  const bitir = () => {
    if (bitti) return;
    bitti = true;
    // En az 0,9 sn göster — anında kapanırsa göz kırpması gibi görünür.
    setTimeout(async () => {
      ac();
      if (!acilis || acilis.isDestroyed()) return;
      for (let o = 1; o >= 0; o -= 0.1) { acilis?.setOpacity(Math.max(0, o)); await new Promise((r) => setTimeout(r, 16)); }
      acilis?.destroy();
    }, Math.max(0, 900 - (Date.now() - baslangic)));
  };
  panel().once("did-finish-load", bitir);
  panel().once("did-fail-load", bitir);
  setTimeout(bitir, 15_000); // panel çok yavaşsa yine de aç
}

/* ── Hızlı arama ─────────────────────────────────────────── */

const ARAMA_G = 720;

function aramaHazirla() {
  aramaPencere = new BrowserWindow({
    width: ARAMA_G, height: 200, show: false, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, minimizable: false, maximizable: false, fullscreenable: false,
    hasShadow: false, title: "Yolliyo — Hızlı arama",
    webPreferences: { preload: path.join(__dirname, "baslik-preload.js"), contextIsolation: true, sandbox: true },
  });
  aramaPencere.setAlwaysOnTop(true, "pop-up-menu");
  aramaPencere.loadFile(path.join(__dirname, "arama.html"));
  aramaPencere.on("blur", () => aramaPencere?.hide());
  aramaPencere.on("closed", () => { aramaPencere = null; });
}

/** @param {"baslik"|"genel"} nereden */
function aramaAc(nereden) {
  if (!aramaPencere) aramaHazirla();
  let x, y;
  if (nereden === "baslik" && anaPencere?.isVisible()) {
    const b = anaPencere.getContentBounds();
    x = Math.round(b.x + (b.width - ARAMA_G) / 2);
    y = b.y + BASLIK_Y - 10;
  } else {
    const ekran = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    x = Math.round(ekran.x + (ekran.width - ARAMA_G) / 2);
    y = Math.round(ekran.y + ekran.height * 0.18);
  }
  aramaPencere.setPosition(x, y);
  aramaPencere.show();
  aramaPencere.focus();
  aramaPencere.webContents.send("arama:gosterildi");
}

ipcMain.on("arama:ac", (_e, nereden) => aramaAc(nereden === "baslik" ? "baslik" : "genel"));
ipcMain.on("arama:kapat", () => aramaPencere?.hide());
ipcMain.on("arama:yukseklik", (_e, px) => {
  if (!aramaPencere) return;
  const [x, y] = aramaPencere.getPosition();
  aramaPencere.setBounds({ x, y, width: ARAMA_G, height: Math.min(640, Math.max(120, Math.round(px))) });
});
ipcMain.handle("arama:ara", async (_e, q) => {
  const metin = String(q ?? "").trim().slice(0, 80);
  if (metin.length < 2) return [];
  try {
    const r = await session.fromPartition(BOLUM).fetch(
      `${TABAN}/api/orders/search?q=${encodeURIComponent(metin)}`,
      { credentials: "include", cache: "no-store" },
    );
    if (!r.ok) return [];
    return (await r.json()).orders ?? [];
  } catch {
    return [];
  }
});
ipcMain.on("arama:siparis", (_e, id) => {
  aramaPencere?.hide();
  if (/^[\w-]{1,64}$/.test(String(id))) ac(`/panel/siparisler/${id}`);
});
ipcMain.on("arama:liste", (_e, q) => {
  aramaPencere?.hide();
  ac(`/panel/siparisler?q=${encodeURIComponent(String(q ?? "").slice(0, 80))}`);
});

/* ── Başlık çubuğu eylemleri ─────────────────────────────── */

ipcMain.on("baslik:git", (_e, yol) => { if (typeof yol === "string" && yol.startsWith("/panel")) ac(yol); });
ipcMain.on("baslik:geri", () => panel()?.navigationHistory.goBack());
ipcMain.on("baslik:ileri", () => panel()?.navigationHistory.goForward());
ipcMain.on("baslik:yenile", () => panel()?.reload());
ipcMain.on("depo-ekrani:ac", () => depoEkraniAc());

/* ── Depo Ekranı (TV modu) ───────────────────────────────── */

/** Birden fazla ekran varsa ana ekran dışındaki en büyüğü (depodaki TV). */
function depoEkrani() {
  const birincil = screen.getPrimaryDisplay();
  const digerleri = screen.getAllDisplays().filter((d) => d.id !== birincil.id);
  if (!digerleri.length) return birincil;
  return digerleri.sort((a, b) => b.size.width * b.size.height - a.size.width * a.size.height)[0];
}

function depoEkraniAc() {
  if (depoPencere && !depoPencere.isDestroyed()) { depoPencere.show(); depoPencere.focus(); return; }
  const ekran = depoEkrani();
  depoPencere = new BrowserWindow({
    x: ekran.bounds.x, y: ekran.bounds.y, width: ekran.bounds.width, height: ekran.bounds.height,
    fullscreen: true, autoHideMenuBar: true, backgroundColor: "#0a0908", icon: IKON, title: "Yolliyo — Depo Ekranı",
    webPreferences: { partition: BOLUM, contextIsolation: true, sandbox: true },
  });
  depoPencere.setMenuBarVisibility(false);
  depoPencere.on("page-title-updated", (e) => e.preventDefault()); // görev çubuğunda "Depo Ekranı" kalsın
  baglantilariYonet(depoPencere.webContents);
  // Esc tam ekrandan çıkarır, F11 geri alır; Ctrl+W kapatır.
  depoPencere.webContents.on("before-input-event", (e, g) => {
    if (g.type !== "keyDown") return;
    if (g.key === "Escape" && depoPencere.isFullScreen()) { e.preventDefault(); depoPencere.setFullScreen(false); }
    else if (g.key === "F11") { e.preventDefault(); depoPencere.setFullScreen(!depoPencere.isFullScreen()); }
    else if (g.key.toLowerCase() === "w" && g.control) { e.preventDefault(); depoPencere.close(); }
  });
  depoPencere.webContents.on("did-fail-load", (_e, kod, _a, url, anaCerceve) => {
    if (!anaCerceve || kod === -3) return;
    depoPencere.loadFile(path.join(__dirname, "cevrimdisi.html"), { query: { hedef: url || `${TABAN}/depo-ekrani` } });
  });
  depoPencere.loadURL(`${TABAN}/depo-ekrani`);
  // Ekran açıkken monitör uykuya geçmesin.
  depoUyanik = powerSaveBlocker.start("prevent-display-sleep");
  depoPencere.on("closed", () => {
    if (depoUyanik != null && powerSaveBlocker.isStarted(depoUyanik)) powerSaveBlocker.stop(depoUyanik);
    depoUyanik = null;
    depoPencere = null;
  });
}

/* ── Bağlantılar ve kısayollar ───────────────────────────── */

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
    disariAc(url);
    return { action: "deny" };
  });

  wc.on("will-navigate", (e, url) => {
    if (icMi(url) || url.startsWith("file:")) return;
    e.preventDefault();
    disariAc(url);
  });
}

// Uygulama içinde açılan yazdırma/önizleme pencereleri de aynı kurallarla.
app.on("web-contents-created", (_e, wc) => {
  if (wc.getType() === "window" && wc !== aramaPencere?.webContents) baglantilariYonet(wc);
});

/**
 * Panel kısayolları. Başlık çubuğu gizli olduğu için uygulama menüsü yok;
 * kısayollar doğrudan panel katmanında yakalanır. Kopyala/yapıştır gibi
 * düzenleme kısayollarını Chromium kendisi yapıyor.
 */
function kisayollar(wc) {
  wc.on("before-input-event", (e, g) => {
    if (g.type !== "keyDown") return;
    const k = g.key.toLowerCase();
    const ctrl = g.control || g.meta;
    let yap = null;
    if (g.key === "F5" || (ctrl && k === "r")) yap = () => wc.reload();
    else if (g.alt && g.key === "ArrowLeft") yap = () => wc.navigationHistory.goBack();
    else if (g.alt && g.key === "ArrowRight") yap = () => wc.navigationHistory.goForward();
    else if (ctrl && k === "w") yap = () => anaPencere?.close();
    else if (ctrl && k === "q") yap = cik;
    else if (ctrl && (k === "=" || k === "+")) yap = () => wc.setZoomLevel(wc.getZoomLevel() + 0.5);
    else if (ctrl && k === "-") yap = () => wc.setZoomLevel(wc.getZoomLevel() - 0.5);
    else if (ctrl && k === "0") yap = () => wc.setZoomLevel(0);
    else if (g.key === "F11") yap = () => anaPencere?.setFullScreen(!anaPencere.isFullScreen());
    else if (ctrl && k === "f") yap = bulAc;
    else if (g.key === "F3" && bulAcik && bulSon) yap = () => wc.findInPage(bulSon, { forward: !g.shift, findNext: false });
    else if (g.key === "Escape" && bulAcik) yap = bulKapat;
    else if (g.key === "F12" || (ctrl && g.shift && k === "i")) yap = () => wc.toggleDevTools();
    if (yap) { e.preventDefault(); yap(); }
  });
}

/* ── Windows ile başlama, tepsi ──────────────────────────── */

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
    { label: "Hızlı arama\tCtrl+Shift+Y", click: () => aramaAc("genel") },
    { label: "Depo Ekranı (TV)", click: depoEkraniAc },
    { type: "separator" },
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
      label: "Başlangıç",
      submenu: [
        {
          label: "Windows açılınca başlat", type: "checkbox", checked: a.windowsIleBaslat,
          click: (m) => { windowsIleBaslat(m.checked); tepsiYenile(); },
        },
        {
          label: "Açılışta Depo Ekranını aç (depo bilgisayarı)", type: "checkbox", checked: a.acilistaDepoEkrani,
          click: (m) => { ayarlar.yaz({ acilistaDepoEkrani: m.checked }); tepsiYenile(); },
        },
      ],
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

/* ── Başlangıç ───────────────────────────────────────────── */

// Tek kopya: ikinci kez açılırsa mevcut pencere öne gelir.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows bildirimlerinde uygulama adı/ikonu doğru görünsün (package.json appId).
  app.setAppUserModelId("com.yolliyo.panel");

  app.on("second-instance", () => ac());

  app.whenReady().then(() => {
    // Google gibi servisler gömülü tarayıcı imzası ("Electron/…") taşıyan
    // isteklere farklı davranabiliyor; standart Chrome kimliği gönderilir.
    const ses = session.fromPartition(BOLUM);
    ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|yolliyo-masaustu|Yolliyo)\/\S+/gi, ""));

    Menu.setApplicationMenu(null);
    tepsiKur();
    pencereAc();
    if (ARKAPLAN) {
      // Windows açılışı: pencere gösterilmez; depo bilgisayarıysa TV ekranı açılır.
      if (ayarlar.oku().acilistaDepoEkrani) depoEkraniAc();
    } else {
      acilisGoster();
    }

    // İlk açılışta varsayılan: Windows ile başlat (tepsiden kapatılabilir).
    windowsIleBaslat(ayarlar.oku().windowsIleBaslat);

    if (!globalShortcut.register(ARAMA_KISAYOL, () => aramaAc("genel"))) {
      // Başka bir program aynı kısayolu kullanıyorsa arama yine başlık çubuğundan açılır.
      console.warn("Hızlı arama kısayolu alınamadı:", ARAMA_KISAYOL);
    }
    aramaHazirla(); // ilk açılış anında olsun diye önceden yüklenir

    bildirim.baslat({ ses, taban: TABAN, ikon: IKON, ac });
    sayac = sayaclar.baslat({
      ses, taban: TABAN, pencere: () => anaPencere, tepsi: () => tepsi, degisti: baslikDurumu,
    });
    guncel = guncelleme.baslat({ ikon: IKON, onHazir: tepsiYenile });
  });

  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("before-quit", () => { cikiliyor = true; });
  // Pencereler kapansa da tepsi yaşar — uygulama yalnızca "Çıkış" ile kapanır.
  app.on("window-all-closed", () => {});
}
