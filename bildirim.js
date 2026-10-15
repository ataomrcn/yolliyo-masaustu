// BİLDİRİMLER — panelin notifications kaydını yoklar, yenileri Windows
// bildirimi olarak gösterir.
//
// Oturum: istekler pencerenin oturumuyla (persist:yolliyo) gider; kullanıcı
// panele giriş yapmışsa çerez otomatik eklenir. Giriş yoksa (401) sessizce
// beklenir.
//
// İlk açılışta geçmiş bildirimler gösterilmez: o anki en yeni bildirim
// "görüldü" sayılır, yalnızca SONRAKİLER bildirilir. Aynı yoklamada çok
// sayıda bildirim gelirse (ör. sabah açılışı, toplu sipariş akışı) tek tek
// değil kategori başına tek özet bildirim gösterilir.

const { Notification } = require("electron");
const ayarlar = require("./ayarlar");

const YOKLAMA_MS = 30_000;
const TEK_TEK_SINIR = 3; // bir kategoride bundan fazlası özetlenir

/** Bildirim kaydı → kategori. */
function kategori(n) {
  const t = n.type ?? "";
  if (t === "order") return "siparis";
  if (t === "kargo_sorun") return "kargo_sorun";
  if (n.data?.conversation_id) return "whatsapp";
  if (t === "low_stock") return "stok";
  if (/^(topup|cod|refund|kargo|shipment_charge)/.test(t)) return "odeme";
  return "diger";
}

/** Bildirime tıklanınca açılacak panel sayfası. */
function hedefYol(n) {
  const d = n.data ?? {};
  switch (kategori(n)) {
    case "siparis":
      return d.order_id ? `/panel/siparisler/${d.order_id}` : "/panel/siparisler";
    case "kargo_sorun":
      return d.order_id ? `/panel/siparisler/${d.order_id}` : "/panel/teslim-edilemeyen";
    case "whatsapp": return "/panel/mesajlar";
    case "stok": return "/panel/stok";
    case "odeme": return "/panel/bakiye";
    default:
      if (d.shipment_id) return `/panel/gonderiler/${d.shipment_id}`;
      return d.order_id ? `/panel/siparisler/${d.order_id}` : "/panel";
  }
}

const OZET_YOLU = {
  siparis: "/panel/siparisler",
  kargo_sorun: "/panel/teslim-edilemeyen",
  whatsapp: "/panel/mesajlar",
  stok: "/panel/stok",
  odeme: "/panel/bakiye",
  diger: "/panel",
};
const OZET_BASLIK = {
  siparis: (k) => `${k} yeni sipariş`,
  kargo_sorun: (k) => `${k} kargoda sorun var`,
  whatsapp: (k) => `${k} yeni WhatsApp mesajı`,
  stok: (k) => `${k} üründe stok azaldı`,
  odeme: (k) => `${k} bakiye/ödeme hareketi`,
  diger: (k) => `${k} yeni bildirim`,
};

function goster({ baslik, govde, yol, ikon, ac }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: baslik, body: govde ?? "", icon: ikon, silent: false });
  n.on("click", () => ac(yol));
  n.show();
}

/**
 * @param {{ ses: Electron.Session, taban: string, ikon: string, ac: (yol: string) => void }} o
 */
function baslat({ ses, taban, ikon, ac }) {
  let calisiyor = false;

  async function yokla() {
    if (calisiyor) return;
    calisiyor = true;
    try {
      const res = await ses.fetch(`${taban}/api/notifications?limit=50`, { credentials: "include", cache: "no-store" });
      if (!res.ok) return; // giriş yok (401) ya da geçici hata
      const liste = await res.json();
      if (!Array.isArray(liste) || !liste.length) return;

      const a = ayarlar.oku();
      const enYeni = liste.reduce((m, n) => (n.created_at > m ? n.created_at : m), "");
      if (!a.sonGorulen) { ayarlar.yaz({ sonGorulen: enYeni }); return; } // ilk açılış: geçmişi gösterme

      const yeniler = liste
        .filter((n) => n.created_at > a.sonGorulen)
        .sort((x, y) => (x.created_at < y.created_at ? -1 : 1));
      if (!yeniler.length) return;
      ayarlar.yaz({ sonGorulen: enYeni });
      if (!a.bildirimler) return;

      const gruplar = {};
      for (const n of yeniler) {
        const k = kategori(n);
        if (!a.kategoriler[k]) continue;
        (gruplar[k] ??= []).push(n);
      }
      for (const [k, ns] of Object.entries(gruplar)) {
        if (ns.length > TEK_TEK_SINIR) {
          const son = ns[ns.length - 1];
          goster({ baslik: OZET_BASLIK[k](ns.length), govde: `Son: ${son.title}`, yol: OZET_YOLU[k], ikon, ac });
        } else {
          for (const n of ns) goster({ baslik: n.title, govde: n.message, yol: hedefYol(n), ikon, ac });
        }
      }
    } catch {
      /* ağ yok — bir sonraki turda tekrar */
    } finally {
      calisiyor = false;
    }
  }

  yokla();
  const zamanlayici = setInterval(yokla, YOKLAMA_MS);
  return { yokla, durdur: () => clearInterval(zamanlayici) };
}

/** Tepsi menüsündeki "Test bildirimi" için. */
function test({ ikon, ac }) {
  goster({ baslik: "Yolliyo bildirimleri çalışıyor", govde: "Yeni sipariş ve kargo sorunlarında burada haber vereceğiz.", yol: "/panel", ikon, ac });
}

module.exports = { baslat, test, kategori, hedefYol };
