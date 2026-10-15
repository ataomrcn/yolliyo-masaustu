# Yolliyo Masaüstü

Yolliyo panelini (https://www.yolliyo.com/panel) Windows'ta kendi penceresinde açan Electron uygulaması.

- Windows bildirimleri: yeni sipariş, teslim edilemedi/iade, WhatsApp, düşük stok, bakiye
- Sistem tepsisi, görev çubuğunda "Yeni" sipariş rozeti
- Windows açılınca tepside başlar
- Kendini günceller (GitHub Releases)

## Geliştirme

```bash
npm install
npm start
```

## Yeni sürüm yayınlama

1. `package.json` içindeki `version` değerini artırın (ör. 1.1.0 → 1.2.0).
2. `GH_TOKEN` ortam değişkeniyle `npm run yayinla` çalıştırın. Kurulum dosyası ve `latest.yml` GitHub Releases'e yüklenir.
3. Kurulu uygulamalar 6 saat içinde yeni sürümü indirir, kapanınca kurar.

Sadece kurulum dosyası üretmek için: `npm run dist` (çıktı: `dist/`).
