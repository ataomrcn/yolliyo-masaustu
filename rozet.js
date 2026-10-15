// GÖREV ÇUBUĞU ROZETİ — "Yeni" sekmesindeki sipariş sayısı.
//
// Windows'ta app.setBadgeCount çalışmıyor; görev çubuğu ikonunun köşesine
// "overlay" resmi konuyor. Sayılı resim gizli bir pencerede canvas ile
// çiziliyor (nativeImage SVG/metin çizemiyor) ve sayı başına önbelleğe alınıyor.

const { BrowserWindow, nativeImage } = require("electron");

const YOKLAMA_MS = 60_000;
let cizici = null;
const onbellek = new Map();

async function rozetResmi(sayi) {
  const metin = sayi > 99 ? "99+" : String(sayi);
  if (onbellek.has(metin)) return onbellek.get(metin);
  if (!cizici) {
    cizici = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { offscreen: true } });
    await cizici.loadURL("data:text/html,<canvas id=c width=64 height=64></canvas>");
  }
  const url = await cizici.webContents.executeJavaScript(`(() => {
    const c = document.getElementById("c"), x = c.getContext("2d");
    x.clearRect(0, 0, 64, 64);
    x.fillStyle = "#E5484D"; x.beginPath(); x.arc(32, 32, 31, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
    const t = ${JSON.stringify(metin)};
    x.font = "bold " + (t.length >= 3 ? 26 : t.length === 2 ? 34 : 42) + "px Segoe UI, Arial";
    x.fillText(t, 32, 35);
    return c.toDataURL("image/png");
  })()`);
  const img = nativeImage.createFromDataURL(url);
  onbellek.set(metin, img);
  return img;
}

/**
 * @param {{ ses: Electron.Session, taban: string, pencere: () => BrowserWindow | null, tepsi: () => Electron.Tray | null }} o
 */
function baslat({ ses, taban, pencere, tepsi }) {
  async function yokla() {
    let sayi = null;
    try {
      const res = await ses.fetch(`${taban}/api/orders/counts`, { credentials: "include", cache: "no-store" });
      if (res.ok) sayi = Number((await res.json())?.pending ?? 0) || 0;
    } catch { /* ağ yok */ }

    const w = pencere();
    if (w && !w.isDestroyed()) {
      if (sayi && sayi > 0) w.setOverlayIcon(await rozetResmi(sayi), `${sayi} yeni sipariş`);
      else w.setOverlayIcon(null, "");
    }
    const t = tepsi();
    if (t && !t.isDestroyed()) t.setToolTip(sayi ? `Yolliyo — ${sayi} yeni sipariş` : "Yolliyo");
  }

  yokla();
  const z = setInterval(yokla, YOKLAMA_MS);
  return { yokla, durdur: () => clearInterval(z) };
}

module.exports = { baslat };
