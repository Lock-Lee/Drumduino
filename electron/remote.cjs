// DrumDuino — iPhone / iPad as wireless drum pads.
// The app serves a pad page on the local network; the phone opens it in Safari and every tap is
// sent over a WebSocket straight into the app's sound engine (same path as the Arduino).
// Plain Node http + a minimal WebSocket implementation, so nothing extra has to be packaged.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 8765;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const PAGE_DIR = path.join(__dirname, 'remote');

function lanAddress() {
  const all = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) all.push({ name, address: a.address });
  }
  // Wi-Fi / Ethernet first (en0, en1 on macOS), private ranges first
  const score = (a) => (/^en\d/.test(a.name) ? 0 : 2) + (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address) ? 0 : 1);
  all.sort((a, b) => score(a) - score(b));
  return all[0]?.address ?? null;
}

/** Encode one server → client text frame (servers never mask). */
function frame(text) {
  const data = Buffer.from(text);
  const len = data.length;
  const head = len < 126 ? Buffer.from([0x81, len]) : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255]) : null;
  if (!head) {
    const h = Buffer.alloc(10);
    h[0] = 0x81;
    h[1] = 127;
    h.writeBigUInt64BE(BigInt(len), 2);
    return Buffer.concat([h, data]);
  }
  return Buffer.concat([head, data]);
}

function createRemote({ tokenFile, onMessage, onClients }) {
  let token;
  try {
    token = fs.readFileSync(tokenFile, 'utf8').trim();
  } catch {
    /* first run */
  }
  if (!token || !/^[a-z0-9]{6,}$/.test(token)) {
    token = crypto.randomBytes(6).toString('hex');
    try {
      fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
      fs.writeFileSync(tokenFile, token);
    } catch {
      /* keep it for this run */
    }
  }

  const clients = new Set();
  let server = null;
  let state = { pads: [], lang: 'th', kit: '' };

  const send = (sock, obj) => {
    try {
      sock.write(frame(JSON.stringify(obj)));
    } catch {
      /* closed */
    }
  };
  const broadcast = (obj) => clients.forEach((c) => send(c, obj));
  const changed = () => onClients(clients.size);

  const files = {
    '/': ['pad.html', 'text/html; charset=utf-8'],
    '/manifest.json': ['manifest.json', 'application/manifest+json'],
    '/icon.png': ['icon.png', 'image/png']
  };

  function handleHttp(req, res) {
    const url = new URL(req.url, 'http://x');
    const f = files[url.pathname];
    if (!f) {
      res.writeHead(404).end('not found');
      return;
    }
    fs.readFile(path.join(PAGE_DIR, f[0]), (err, buf) => {
      if (err) return res.writeHead(500).end();
      res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  }

  function handleUpgrade(req, sock) {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== '/ws' || url.searchParams.get('k') !== token || !key) {
      sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    sock.setNoDelay(true); // send each hit at once
    sock.setKeepAlive(true, 5000);
    clients.add(sock);
    changed();
    send(sock, { t: 'kit', ...state });

    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        const need = off + (masked ? 4 : 0) + len;
        if (buf.length < need) return;
        let data = buf.subarray(off + (masked ? 4 : 0), need);
        if (masked) {
          const m = buf.subarray(off, off + 4);
          data = Buffer.from(data.map((b, i) => b ^ m[i & 3]));
        }
        buf = buf.subarray(need);
        if (op === 0x8) {
          sock.end();
          return;
        }
        if (op === 0x9) {
          sock.write(Buffer.concat([Buffer.from([0x8a, data.length]), data]));
          continue;
        }
        if (op !== 0x1) continue;
        let msg;
        try {
          msg = JSON.parse(data.toString('utf8'));
        } catch {
          continue;
        }
        // latency check answered right here, so it measures the network only
        if (msg.t === 'ping') send(sock, { t: 'pong', id: msg.id });
        else onMessage(msg);
      }
    });
    const drop = () => {
      if (clients.delete(sock)) changed();
    };
    sock.on('close', drop);
    sock.on('error', drop);
  }

  return {
    async start() {
      const ip = lanAddress();
      if (!server) {
        server = http.createServer(handleHttp);
        server.on('upgrade', handleUpgrade);
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(PORT, '0.0.0.0', resolve);
        }).catch((e) => {
          server = null;
          throw e;
        });
      }
      return { ip, port: PORT, url: ip ? `http://${ip}:${PORT}/?k=${token}` : null, clients: clients.size };
    },
    stop() {
      clients.forEach((c) => c.destroy());
      clients.clear();
      changed();
      server?.close();
      server = null;
    },
    setState(s) {
      state = { ...state, ...s };
      broadcast({ t: 'kit', ...state });
    },
    flash(pad, v) {
      if (clients.size) broadcast({ t: 'flash', pad, v });
    }
  };
}

module.exports = { createRemote };
