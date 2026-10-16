// Başlık çubuğu ve hızlı arama sayfalarının ana sürece açılan dar köprüsü.
// Sayfalar Node'a erişemez; yalnızca buradaki işlevleri çağırabilir.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("yolliyo", {
  // Başlık çubuğu
  git: (yol) => ipcRenderer.send("baslik:git", yol),
  geri: () => ipcRenderer.send("baslik:geri"),
  ileri: () => ipcRenderer.send("baslik:ileri"),
  yenile: () => ipcRenderer.send("baslik:yenile"),
  aramaAc: () => ipcRenderer.send("arama:ac", "baslik"),
  depoEkrani: () => ipcRenderer.send("depo-ekrani:ac"),
  durumDinle: (cb) => ipcRenderer.on("baslik:durum", (_e, d) => cb(d)),

  // Hızlı arama
  ara: (q) => ipcRenderer.invoke("arama:ara", q),
  siparisAc: (id) => ipcRenderer.send("arama:siparis", id),
  listedeAra: (q) => ipcRenderer.send("arama:liste", q),
  kapat: () => ipcRenderer.send("arama:kapat"),
  yukseklik: (px) => ipcRenderer.send("arama:yukseklik", px),
  gosterildi: (cb) => ipcRenderer.on("arama:gosterildi", () => cb()),

  // Sayfada bul (Ctrl+F)
  bulAra: (metin, secenek) => ipcRenderer.send("bul:ara", metin, secenek),
  bulTemizle: () => ipcRenderer.send("bul:temizle"),
  bulKapat: () => ipcRenderer.send("bul:kapat"),
  bulSonuc: (cb) => ipcRenderer.on("bul:sonuc", (_e, s) => cb(s)),
  bulGosterildi: (cb) => ipcRenderer.on("bul:gosterildi", (_e, secili) => cb(secili)),
});
