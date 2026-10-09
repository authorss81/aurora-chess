// server.js - a tiny bridge between the browser and the Rust engine.
//
// The GUI speaks plain UCI to this process over HTTP; this process speaks plain
// UCI to aurora-engine.exe over stdin/stdout. That is the whole architecture the
// book describes in Chapter 11, with HTTP standing in for a WebSocket.
//
//   node server.js
//   then open http://localhost:8420
//
// Endpoints:
//   GET  /                 the GUI
//   GET  /chess.js         rules module
//   GET  /engine.js        fallback search module
//   GET  /engine           { ready, path } - is the Rust engine available?
//   POST /uci              { lines: ["position ...", "go depth 4"] }
//   GET  /out?since=N      { pos, lines: [...] } - stdout lines since offset N
//
// No dependencies: only Node's built-in http, fs and child_process.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8420;
const HERE = __dirname;

// Where to look for the compiled engine, in order of preference.
const ENGINE_CANDIDATES = [
  path.join(HERE, '..', '01-learning-engine', 'target', 'release', 'aurora-engine.exe'),
  path.join(HERE, '..', '01-learning-engine', 'target', 'debug', 'aurora-engine.exe'),
  path.join(HERE, 'aurora-engine.exe'),
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

let enginePath = ENGINE_CANDIDATES.find((p) => fs.existsSync(p));
let child = null;
let outputLines = [];
let stderrLines = [];

function startEngine() {
  if (!enginePath) return false;
  child = spawn(enginePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let carry = '';

  child.stdout.on('data', (chunk) => {
    carry += chunk.toString();
    const parts = carry.split(/\r?\n/);
    carry = parts.pop() ?? '';
    for (const line of parts) {
      outputLines.push(line);
      if (outputLines.length > 5000) outputLines.splice(0, 1000);
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrLines.push(chunk.toString());
    if (stderrLines.length > 200) stderrLines.shift();
  });

  child.on('exit', (code) => {
    console.log(`[engine] exited with code ${code}`);
    child = null;
  });

  child.on('error', (err) => {
    console.error(`[engine] failed to start: ${err.message}`);
    child = null;
  });

  child.stdin.write('uci\n');
  return true;
}

function engineReady() {
  return outputLines.some((l) => l.trim() === 'uciok');
}

function send(lines) {
  if (!child) return false;
  for (const l of lines) child.stdin.write(l + '\n');
  return true;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (url.pathname === '/engine') {
    return json(res, 200, {
      ready: engineReady(),
      path: enginePath,
      stderr: stderrLines.slice(-5),
    });
  }

  if (url.pathname === '/uci' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let lines = [];
      try { lines = JSON.parse(body).lines || []; } catch { /* ignore */ }
      const ok = send(lines);
      json(res, 200, { ok });
    });
    return;
  }

  if (url.pathname === '/out') {
    const since = Number(url.searchParams.get('since') || 0);
    const lines = outputLines.slice(since);
    return json(res, 200, { pos: outputLines.length, lines });
  }

  // static files
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = path.join(HERE, path.normalize(file).replace(/^([/\\])+/, ''));
  if (!full.startsWith(HERE)) { res.writeHead(403); return res.end('forbidden'); }

  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Aurora Chess');
  console.log('  -------------');
  console.log(`  open:  http://localhost:${PORT}`);
  if (enginePath) {
    console.log(`  engine: ${enginePath}`);
    startEngine();
    setTimeout(() => {
      console.log(engineReady()
        ? `  engine handshake ok (${outputLines.find(l => l.startsWith('id name')) || 'aurora'})`
        : '  engine did not answer uci - the GUI will fall back to JavaScript');
    }, 500);
  } else {
    console.log('  engine not found, using the built-in JavaScript engine.');
    console.log('  build it with:  cd ..\\01-learning-engine && cargo build --release');
  }
  console.log('');
});