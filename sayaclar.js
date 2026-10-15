// SAYAÇLAR — "Yeni" sipariş ve "teslim edilemedi" kargo sayısı.
//
// Başlık çubuğundaki çiplere ve görev çubuğu rozetine (Yeni sayısı) gider.
// Windows'ta app.setBadgeCount çalışmıyor; görev çubuğu ikonunun köşesine
// "overlay" resmi konuyor. Sayılı resim gizli bir pencerede canvas ile
// çiziliyor (nativeImage metin çizemiyor) ve sayı başına önbelleğe alınıyor.
//
// Oturum yoksa (401) sayaçlar gizlenir — giriş ekranında anlamsızlar.

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
 * @param {{ ses: Electron.Session, taban: string,
 *           pencere: () => Electron.BaseWindow | null,
 *           tepsi: () => Electron.Tray | null,
 *           degisti: (d: { oturum: boolean, yeni: number|null, sorunlu: number|null }) => void }} o
 */
function baslat({ ses, taban, pencere, tepsi, degisti }) {
  let calisiyor = false;
  let son = { oturum: false, yeni: null, sorunlu: null };

  const al = async (yol) => {
    const r = await ses.fetch(`${taban}${yol}`, { credentials: "include", cache: "no-store" });
    if (r.status === 401) return { oturumYok: true };
    if (!r.ok) return null;
    return r.json();
  };

  async function yokla() {
    if (calisiyor) return;
    calisiyor = true;
    try {
      const [sayim, sorun] = await Promise.all([
        al("/api/orders/counts").catch(() => null),
        al("/api/shipments/sorunlu?limit=1").catch(() => null),
      ]);
      if (sayim?.oturumYok) son = { oturum: false, yeni: null, sorunlu: null };
      else if (sayim) {
        son = {
          oturum: true,
          yeni: Number(sayim.pending ?? 0) || 0,
          sorunlu: sorun && !sorun.oturumYok ? Number(sorun.sayilar?.failed ?? 0) || 0 : son.sorunlu,
        };
      }
      // sayim null (ağ hatası): son bilinen değer korunur

      degisti(son);

      const w = pencere();
      if (w && !w.isDestroyed()) {
        if (son.oturum && son.yeni > 0) w.setOverlayIcon(await rozetResmi(son.yeni), `${son.yeni} yeni sipariş`);
        else w.setOverlayIcon(null, "");
      }
      const t = tepsi();
      if (t && !t.isDestroyed()) {
        const parca = [son.yeni ? `${son.yeni} yeni sipariş` : null, son.sorunlu ? `${son.sorunlu} teslim edilemedi` : null].filter(Boolean);
        t.setToolTip(parca.length ? `Yolliyo — ${parca.join(" · ")}` : "Yolliyo");
      }
    } finally {
      calisiyor = false;
    }
  }

  yokla();
  const z = setInterval(yokla, YOKLAMA_MS);
  return { yokla, son: () => son, durdur: () => clearInterval(z) };
}

module.exports = { baslat };
