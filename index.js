#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const dns = require('dns');
const crypto = require('crypto');
const { WebSocket, createWebSocketStream } = require('ws');

// ---- configuration -------------------------------------------------------
const ENV = process.env;
// 解析非负整数 env：缺失/非法/负数一律回退默认值（避免 '0'→默认、负数触发即时逻辑、NaN 破坏 listen）
function intEnv(raw, def) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}
const NODE_ID = ENV.UUID || crypto.randomUUID();
const NODE_ID_HEX = NODE_ID.replace(/-/g, '');
const WSPATH = ENV.WSPATH || crypto.randomBytes(8).toString('hex');
const SUB_PATH = ENV.SUB_PATH || ''; // 空 = 不启用 HTTP 订阅路由（opt-in）
const NAME = ENV.NAME || '';
const DOMAIN = ENV.DOMAIN || '';
const TG_TOKEN = ENV.TG_BOT_TOKEN || '';
const TG_CHAT = ENV.TG_CHAT_ID || '';
const TG_API_BASE = (ENV.TG_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
const SERVER_HEADER = ENV.SERVER_HEADER || 'nginx/1.24.0';
const SITE_TITLE = ENV.SITE_TITLE || '';
const SITE_THEME = ENV.SITE_THEME || '';
// A serverless container must keep its application files available for the
// lifetime of the service. Self-destruction remains opt-in for legacy use.
const SELF_DESTRUCT = String(ENV.SELF_DESTRUCT ?? 'false') === 'true';
const SELF_DESTRUCT_AFTER = intEnv(ENV.SELF_DESTRUCT_AFTER, 90);
const PORT = intEnv(ENV.PORT, 8080);
const IP_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

const SENSITIVE_ENV = [
  'UUID', 'WSPATH', 'SUB_PATH', 'NAME', 'DOMAIN',
  'TG_BOT_TOKEN', 'TG_CHAT_ID', 'TG_API_BASE', 'SERVER_HEADER', 'SITE_TITLE',
  'SITE_THEME', 'SELF_DESTRUCT', 'SELF_DESTRUCT_AFTER', 'PORT',
];

// 速率测试域名拦截（防止节点被 speedtest 探测流量打爆 / 暴露带宽特征）
const PROTECTED_HOSTS = [
  'speedtest.net', 'fast.com', 'speedtest.cn', 'speed.cloudflare.com', 'speedof.me',
  'testmy.net', 'bandwidth.place', 'speed.io', 'librespeed.org', 'speedcheck.org',
];
function isProtectedHost(host) {
  if (!host) return false;
  const h = String(host).toLowerCase();
  return PROTECTED_HOSTS.some(b => h === b || h.endsWith('.' + b));
}

// ---- node identity (domain/port/tls) —— 无外呼，启动即定 -----------------
// DOMAIN 为域名 → TLS:443；为 IPv4 → 直连:PORT。未设 DOMAIN 则节点不可用。
let metaDomain = '';
let metaPort = 443;
let metaTls = 'tls';
let metaValid = false;
if (DOMAIN) {
  metaDomain = DOMAIN;
  if (IP_RE.test(DOMAIN)) { metaTls = 'none'; metaPort = PORT; }
  else { metaTls = 'tls'; metaPort = 443; }
  metaValid = true;
}

// ---- subscription --------------------------------------------------------
function buildSubscription() {
  const namePart = NAME || 'node';
  const tlsParam = metaTls === 'tls' ? 'tls' : 'none';
  const ssTlsParam = metaTls === 'tls' ? 'tls;' : '';
  const vlsUrl = `vless://${NODE_ID}@${metaDomain}:${metaPort}?encryption=none&security=${tlsParam}&sni=${metaDomain}&fp=chrome&type=ws&host=${metaDomain}&path=%2F${WSPATH}#${namePart}`;
  const troUrl = `trojan://${NODE_ID}@${metaDomain}:${metaPort}?security=${tlsParam}&sni=${metaDomain}&fp=chrome&type=ws&host=${metaDomain}&path=%2F${WSPATH}#${namePart}`;
  const ssMethodPassword = Buffer.from(`none:${NODE_ID}`).toString('base64');
  const ssUrl = `ss://${ssMethodPassword}@${metaDomain}:${metaPort}?plugin=v2ray-plugin;mode%3Dwebsocket;host%3D${metaDomain};path%3D%2F${WSPATH};${ssTlsParam}sni%3D${metaDomain};skip-cert-verify%3Dtrue;mux%3D0#${namePart}`;
  return vlsUrl + '\n' + troUrl + '\n' + ssUrl;
}

async function deliver() {
  if (!metaValid) { console.error('DOMAIN not set; subscription skipped'); return; }
  const sub = buildSubscription();
  const b64 = Buffer.from(sub).toString('base64');
  if (TG_TOKEN && TG_CHAT) {
    try {
      const r = await fetch(`${TG_API_BASE}/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_CHAT, text: b64 }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) { console.log('subscription delivered via telegram'); return; }
      console.error(`telegram delivery failed (http ${r.status}); printing fallback`);
    } catch { console.error('telegram delivery error; printing fallback'); }
  }
  console.log('subscription (base64):\n' + b64);
  console.log(sub);
}

// ---- DNS -----------------------------------------------------------------
const DNS_CACHE = new Map();
const DNS_TTL = 10 * 60 * 1000;
const DOH_ENDPOINTS = [
  'https://dns.google/resolve',
  'https://1.1.1.1/dns-query',
  'https://cloudflare-dns.com/dns-query',
];
function pickARecord(answer) {
  if (Array.isArray(answer)) for (const a of answer) if (a.type === 1) return a.data;
  return null;
}
async function resolveHost(host) {
  if (IP_RE.test(host)) return host;
  const hit = DNS_CACHE.get(host);
  if (hit && hit.t > Date.now()) return hit.ip;
  try {
    const { address } = await dns.promises.lookup(host, { family: 4 });
    if (DNS_CACHE.size >= 512) DNS_CACHE.clear();
    DNS_CACHE.set(host, { ip: address, t: Date.now() + DNS_TTL });
    return address;
  } catch { /* 走 DoH 回退 */ }
  for (const base of DOH_ENDPOINTS) {
    try {
      const r = await fetch(`${base}?name=${encodeURIComponent(host)}&type=A`, {
        headers: { accept: 'application/dns-json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000),
      });
      const d = await r.json();
      const ip = pickARecord(d.Answer);
      if (ip) {
        if (DNS_CACHE.size >= 512) DNS_CACHE.clear();
        DNS_CACHE.set(host, { ip, t: Date.now() + DNS_TTL });
        return ip;
      }
    } catch { /* 下一端点 */ }
  }
  throw new Error(`failed to resolve ${host}`);
}

// ---- tunnel --------------------------------------------------------------
function openTunnel(sock, host, port, payload) {
  // duplex 同步创建：DNS 解析窗口期内到达的后续帧被 duplex 缓冲，不丢包
  const duplex = createWebSocketStream(sock);
  duplex.on('error', () => {});
  const attach = (target) => {
    let established = false;
    const conn = net.connect({ host: target, port }, () => {
      established = true;
      if (payload.length) conn.write(payload);
      duplex.pipe(conn).pipe(duplex);
    });
    conn.on('error', () => {
      // 仅连接建立失败时收尾整对（否则泄漏 ws+duplex）；连通后的流错误保持静默吞掉
      if (!established) { try { sock.close(); } catch { /* 忽略 */ } duplex.destroy(); }
    });
  };
  resolveHost(host).then(attach).catch(() => attach(host));
}

// ---- binary reader -------------------------------------------------------
class Reader {
  constructor(buf) { this.b = buf; this.p = 0; }
  u8() { const v = this.b[this.p]; this.p += 1; return v; }
  u16be() { const v = this.b.readUInt16BE(this.p); this.p += 2; return v; }
  take(n) { const v = this.b.slice(this.p, this.p + n); this.p += n; return v; }
  byteAt(i) { return this.b[i]; }
  u16at(i) { return this.b.readUInt16BE(i); }
  slice(a, b) { return this.b.slice(a, b); }
}

function readAddress(r) { // atyp + host，按 ATYP 顺序读
  const atyp = r.u8();
  if (atyp === 1) return r.take(4).join('.');
  if (atyp === 3) { const n = r.u8(); return r.take(n).toString('utf8'); }
  if (atyp === 4) return ipv6(r.take(16));
  throw new Error('bad address type');
}
function ipv6(buf) {
  const g = [];
  for (let k = 0; k < 16; k += 2) g.push(buf.readUInt16BE(k).toString(16));
  return g.join(':');
}

// ---- protocol handlers (返回 true=接管连接, false=不是该协议继续试) -------
function handleVless(sock, msg) {
  try {
    const r = new Reader(msg);
    const version = r.u8();
    const id = r.take(16);
    for (let k = 0; k < 16; k++) if (id[k] !== parseInt(NODE_ID_HEX.substr(k * 2, 2), 16)) return false;
    if (msg.length < 18) return false;
    const off = r.byteAt(17) + 19; // VLE-SS 偏移
    if (msg.length < off + 3) return false; // port(2) + atyp(1)
    const port = r.u16at(off);
    const atyp = r.byteAt(off + 2);
    let host = '';
    let end = off + 3;
    if (atyp === 1) {
      if (msg.length < off + 7) return false;
      host = r.slice(off + 3, off + 7).join('.'); end = off + 7;
    } else if (atyp === 2) {
      if (msg.length < off + 4) return false;
      const n = r.byteAt(off + 3);
      if (msg.length < off + 4 + n) return false;
      host = r.slice(off + 4, off + 4 + n).toString('utf8'); end = off + 4 + n;
    } else if (atyp === 3) {
      if (msg.length < off + 19) return false;
      host = ipv6(r.slice(off + 3, off + 19)); end = off + 19;
    } else {
      return false; // 未知 atyp
    }
    if (isProtectedHost(host)) { sock.close(); return true; }
    sock.send(Buffer.from([version, 0]));
    openTunnel(sock, host, port, msg.slice(end));
    return true;
  } catch { return false; }
}

function handleTrojan(sock, msg) {
  try {
    if (msg.length < 58) return false;
    if (crypto.createHash('sha224').update(NODE_ID).digest('hex') !== msg.slice(0, 56).toString()) return false;
    let off = 56;
    if (msg[off] === 0x0d && msg[off + 1] === 0x0a) off += 2;
    if (msg[off] !== 0x01) return false; // cmd
    off += 1;
    const r = new Reader(msg); r.p = off;
    const host = readAddress(r); off = r.p;
    const port = r.u16be(); off = r.p;
    if (off < msg.length && msg[off] === 0x0d && msg[off + 1] === 0x0a) off += 2;
    if (isProtectedHost(host)) { sock.close(); return true; }
    openTunnel(sock, host, port, msg.slice(off));
    return true;
  } catch { return false; }
}

function handleSs(sock, msg) {
  try {
    if (msg.length === 0) return false;
    const r = new Reader(msg);
    const atyp = r.u8();
    if (atyp !== 1 && atyp !== 3 && atyp !== 4) return false;
    r.p -= 1; // 回退，交由 readAddress 重读 atyp
    const host = readAddress(r);
    const port = r.u16be();
    // SS(v2ray-plugin ws) 地址头后无 CRLF 分隔，紧跟 payload；不能像 Trojan 那样跳 CRLF（否则吞掉以 0x0d0a 开头的真实数据）
    if (isProtectedHost(host)) { sock.close(); return true; }
    openTunnel(sock, host, port, msg.slice(r.p));
    return true;
  } catch { return false; }
}

const HANDLERS = [
  { guard: m => m.length > 17 && m[0] === 0, handle: handleVless },
  { guard: m => m.length >= 58, handle: handleTrojan },
  { guard: m => m.length > 0 && (m[0] === 1 || m[0] === 3 || m[0] === 4), handle: handleSs },
];

function dispatch(sock, msg) {
  for (const h of HANDLERS) {
    if (h.guard(msg) && h.handle(sock, msg)) return;
  }
  sock.close();
}

// ---- themed front page ---------------------------------------------------
const THEMES = [
  { name: 'green', title: 'Green Network', slogan: 'Protect Our Planet, Preserve Our Future', primary: '#2e7d32', secondary: '#4caf50', accent: '#8bc34a', dark: '#1b5e20', light: '#e8f5e9' },
  { name: 'ocean', title: 'Blue Horizon', slogan: 'Safeguarding the Seas for Tomorrow', primary: '#01579b', secondary: '#0288d1', accent: '#4fc3f7', dark: '#01378a', light: '#e1f5fe' },
  { name: 'forest', title: 'Wildwood', slogan: 'Where Every Root Tells a Story', primary: '#33691e', secondary: '#558b2f', accent: '#9ccc65', dark: '#1b5e20', light: '#f1f8e9' },
  { name: 'sunset', title: 'Golden Dunes', slogan: 'Chasing Light Across the Sands', primary: '#e65100', secondary: '#f57c00', accent: '#ffb74d', dark: '#bf360c', light: '#fff3e0' },
  { name: 'meadow', title: 'Willow Fields', slogan: 'Cultivating Calm, One Meadow at a Time', primary: '#4a148c', secondary: '#7b1fa2', accent: '#ba68c8', dark: '#311b92', light: '#f3e5f5' },
  { name: 'glacier', title: 'Northlight', slogan: 'Preserving the World\'s Last Frozen Frontiers', primary: '#37474f', secondary: '#546e7a', accent: '#90a4ae', dark: '#263238', light: '#eceff1' },
];
function pickTheme() {
  if (SITE_THEME) {
    const byName = THEMES.find(t => t.name === SITE_THEME);
    if (byName) return byName;
    const idx = parseInt(SITE_THEME, 10);
    if (!Number.isNaN(idx)) return THEMES[((idx % THEMES.length) + THEMES.length) % THEMES.length];
  }
  return THEMES[crypto.randomInt(THEMES.length)];
}
function renderHome() {
  let raw;
  try { raw = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'); }
  catch { raw = '<!doctype html><html><head><title>{{TITLE}}</title></head><body>{{SLOGAN}}</body></html>'; }
  const t = pickTheme();
  return raw
    .replace(/\{\{TITLE\}\}/g, SITE_TITLE || t.title)
    .replace(/\{\{SLOGAN\}\}/g, t.slogan)
    .replace(/\{\{PRIMARY\}\}/g, t.primary)
    .replace(/\{\{SECONDARY\}\}/g, t.secondary)
    .replace(/\{\{ACCENT\}\}/g, t.accent)
    .replace(/\{\{DARK\}\}/g, t.dark)
    .replace(/\{\{LIGHT\}\}/g, t.light);
}
const HOME_HTML = renderHome();
const NOT_FOUND_HTML = '<!DOCTYPE html>\n<html>\n<head><title>404 Not Found</title></head>\n<body>\n<center><h1>404 Not Found</h1></center>\n<hr><center>' + SERVER_HEADER + '</center>\n</body>\n</html>\n';

// ---- http + ws -----------------------------------------------------------
const server = http.createServer((req, res) => {
  const send = (code, body, type) => {
    const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    res.writeHead(code, { Server: SERVER_HEADER, 'Content-Type': type, 'Content-Length': b.length });
    res.end(b);
  };
  const p = (req.url || '/').split('?')[0];
  if (p === '/healthz') { send(200, 'ok\n', 'text/plain; charset=utf-8'); return; }
  if (p === '/') { send(200, HOME_HTML, 'text/html; charset=utf-8'); return; }
  if (p === '/favicon.ico') { res.writeHead(204, { Server: SERVER_HEADER }); res.end(); return; }
  if (p === '/robots.txt') { send(200, 'User-agent: *\nDisallow: /\n', 'text/plain'); return; }
  if (SUB_PATH && p === '/' + SUB_PATH) {
    if (!metaValid) { send(503, 'Service Unavailable\n', 'text/plain'); return; }
    send(200, Buffer.from(buildSubscription()).toString('base64') + '\n', 'text/plain');
    return;
  }
  send(404, NOT_FOUND_HTML, 'text/html; charset=utf-8');
});

const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = (req.url || '').split('?')[0];
  const wantPath = '/' + WSPATH;
  // 仅校验 path 前缀：不校验 Host，保持 CDN / Cloudflare Worker 反代兼容（且 DOMAIN 未设时不误杀）
  if (!url.startsWith(wantPath)) {
    const b = Buffer.from(NOT_FOUND_HTML);
    socket.write(`HTTP/1.1 404 Not Found\r\nServer: ${SERVER_HEADER}\r\nContent-Type: text/html\r\nContent-Length: ${b.length}\r\nConnection: close\r\n\r\n`);
    socket.write(b);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (sock) => {
    sock.once('message', msg => dispatch(sock, msg));
    sock.on('error', () => {});
  });
});

// ---- self destruct -------------------------------------------------------
function armSelfDestruct() {
  if (!SELF_DESTRUCT) return;
  setTimeout(() => {
    try {
      for (const f of ['index.js', 'index.html', 'package.json', 'package-lock.json', 'node_modules']) {
        try { fs.rmSync(path.join(__dirname, f), { recursive: true, force: true }); } catch { /* 平台差异，忽略 */ }
      }
    } catch { /* 忽略 */ }
    try { for (const k of SENSITIVE_ENV) delete process.env[k]; } catch { /* 忽略 */ }
    const noop = () => {};
    console.log = console.error = console.warn = console.info = noop;
    process.on('uncaughtException', noop);
    process.on('unhandledRejection', noop);
  }, SELF_DESTRUCT_AFTER * 1000);
}

// ---- boot ----------------------------------------------------------------
server.listen(PORT, '0.0.0.0', () => {
  console.log(`listening on ${PORT} (path /${WSPATH})`);
  deliver();
  armSelfDestruct();
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
