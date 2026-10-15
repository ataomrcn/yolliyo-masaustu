// Kullanıcı tercihleri — userData/ayarlar.json. Bozuk/eksik dosyada varsayılanlar.
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

/** Bildirim kategorileri — tepsi menüsünde ayrı ayrı açılıp kapatılır. */
const KATEGORILER = {
  siparis: "Yeni sipariş",
  kargo_sorun: "Teslim edilemedi / iade",
  whatsapp: "WhatsApp mesajı",
  stok: "Düşük stok",
  odeme: "Bakiye ve ödemeler",
  diger: "Diğer (kargo oluşturuldu, sistem)",
};

const VARSAYILAN = {
  bildirimler: true,
  kategoriler: { siparis: true, kargo_sorun: true, whatsapp: true, stok: true, odeme: true, diger: false },
  windowsIleBaslat: true,
  ilkKapatmaUyarisi: false, // "arka planda çalışıyor" bilgisi bir kez gösterildi mi
  sonGorulen: null,         // en son işlenen bildirimin created_at'i
};

const dosya = () => path.join(app.getPath("userData"), "ayarlar.json");
let ayar = null;

function oku() {
  if (ayar) return ayar;
  let d = {};
  try { d = JSON.parse(fs.readFileSync(dosya(), "utf8")); } catch { /* ilk açılış */ }
  ayar = { ...VARSAYILAN, ...d, kategoriler: { ...VARSAYILAN.kategoriler, ...(d.kategoriler ?? {}) } };
  return ayar;
}

function yaz(degisiklik) {
  ayar = { ...oku(), ...degisiklik };
  try { fs.writeFileSync(dosya(), JSON.stringify(ayar, null, 2)); } catch { /* önemsiz */ }
  return ayar;
}

module.exports = { KATEGORILER, oku, yaz };
