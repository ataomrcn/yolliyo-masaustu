// Uygulama ikonunu (build/icon.png, 512x512) Yolliyo "Y" işaretinden üretir.
// Bir kez çalıştırılır: npm run ikon
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#111111"/>
  <g transform="translate(106 76) scale(3)">
    <path d="M5 5 L30 5 L50 48 L70 5 L95 5 L62 72 L62 115 L38 115 L38 72 Z" fill="#F5A623"/>
  </g>
</svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: true } });
  await w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
    `<html><body style="margin:0;background:transparent">${SVG}</body></html>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.mkdirSync(path.join(__dirname, "build"), { recursive: true });
  const hedef = path.join(__dirname, "build", "icon.png");
  fs.writeFileSync(hedef, img.resize({ width: 512, height: 512 }).toPNG());
  console.log("ikon yazildi:", hedef, img.getSize());
  app.quit();
});
