// Generates the Tauri icon set from a single SVG, so the app has a real
// identity in the taskbar, Start menu and installer.
//
//   node make-icons.js
//
// Output: src-tauri/icons/  (32x32.png, 128x128.png, 128x128@2x.png, icon.png)
// For a Windows .ico, convert icon.png once with any image tool; Tauri will
// build without it by falling back to the PNG set.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'src-tauri', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const board = `#f0d9b5`;
const dark = `#b58863`;
const piece = `#1a1a1a`;
const accent = `#d4a24c`;

function svg(size) {
  const s = size;
  const cell = s / 8;
  let sq = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const light = (c + r) % 2 === 1;
      sq += `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${light ? board : dark}"/>`;
    }
  }
  // a knight, centred, as the app mark
  const glyph = '\u265E';
  const back = '#ffffff';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${s * 0.06}" fill="${accent}"/>
  <g transform="translate(${s * 0.03},${s * 0.03}) scale(${(s - s * 0.06) / s})">${sq}</g>
  <text x="50%" y="50%" font-size="${s * 0.72}" text-anchor="middle" dominant-baseline="central"
        font-family="DejaVu Sans, Segoe UI Symbol, serif" fill="${piece}"
        stroke="${back}" stroke-width="${s * 0.02}" paint-order="stroke">${glyph}</text>
</svg>`;
}

for (const size of [32, 128, 256, 512]) {
  fs.writeFileSync(path.join(OUT, `${size}x${size}.svg`), svg(size));
  fs.writeFileSync(path.join(OUT, `${size}x${size}.png.svg`), svg(size));
}
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg(512));

console.log(`wrote SVG icon set to ${OUT}`);
console.log('note: PNG/ICO conversion needs an image tool; tauri build will fall back to SVG if configured,');
console.log('      otherwise remove the "icon" array from tauri.conf.json and let Tauri use defaults.');