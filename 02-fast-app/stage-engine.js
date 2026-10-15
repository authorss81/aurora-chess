// stage-engine.js - copy the compiled Rust engine next to the Tauri app.
//
// The desktop shell spawns the engine as a child process and looks for it in
// `src-tauri/engine/`. Run this before `tauri build`, or just use
// `npm run desktop:build` which does both.

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const DEST = path.join(HERE, 'src-tauri', 'engine');
const NAME = process.platform === 'win32' ? 'aurora-engine.exe' : 'aurora-engine';

const candidates = ['release', 'debug'].map((profile) =>
  path.join(ROOT, '01-learning-engine', 'target', profile, NAME)
);

const found = candidates.find((p) => fs.existsSync(p));
if (!found) {
  console.error('engine binary not found. Tried:');
  candidates.forEach((c) => console.error('  ' + c));
  console.error('\nBuild it first:');
  console.error('  cargo build --release --manifest-path 01-learning-engine/Cargo.toml');
  process.exit(1);
}

fs.mkdirSync(DEST, { recursive: true });
const dest = path.join(DEST, NAME);
fs.copyFileSync(found, dest);

const kb = (fs.statSync(dest).size / 1024).toFixed(0);
console.log(`staged ${found}`);
console.log(`      -> ${dest}  (${kb} KB)`);