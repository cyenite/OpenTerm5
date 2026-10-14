// Renders build/icon.svg into the PNG sizes the installers and the window use.
// Run with: npm run icons
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
  const window = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await window.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const full = image.getSize().width === 1024 ? image : image.resize({ width: 1024, height: 1024, quality: 'best' });
  fs.mkdirSync(path.join(root, 'build', 'icons'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), full.toPNG());
  for (const size of sizes) {
    fs.writeFileSync(path.join(root, 'build', 'icons', `${size}x${size}.png`), full.resize({ width: size, height: size, quality: 'best' }).toPNG());
  }
  console.log(`Rendered build/icon.png and ${sizes.length} sizes in build/icons/`);
  app.quit();
});
