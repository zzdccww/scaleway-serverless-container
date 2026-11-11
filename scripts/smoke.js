const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { WebSocket } = require('ws');

const baseUrl = new URL(process.env.SMOKE_URL || 'http://127.0.0.1:18080');
const timeout = setTimeout(() => {
  console.error('Smoke verification timed out');
  process.exit(1);
}, 90000);

function request(route) {
  return new Promise((resolve, reject) => {
    const outgoing = http.get(new URL(route, baseUrl), response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    outgoing.on('error', reject);
    outgoing.setTimeout(5000, () => outgoing.destroy(new Error('HTTP timeout')));
  });
}

async function main() {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const health = await request('/healthz');
      assert.equal(health.status, 200);
      assert.equal(health.body, 'ok\n');
      ready = true;
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  assert.ok(ready, 'Container must become ready');
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/missing')).status, 404);
  assert.equal((await request('/favicon.ico')).status, 204);
  const subscription = await request('/ci-sub');
  assert.equal(subscription.status, 200);
  assert.match(Buffer.from(subscription.body.trim(), 'base64').toString(), /vless:\/\/39d6ae78-271c-4e73-8796-c1a43b9d6e58@example\.com:443/);

  const echoServer = net.createServer(socket => socket.pipe(socket));
  echoServer.listen(0, '127.0.0.1');
  await once(echoServer, 'listening');
  const echoPort = echoServer.address().port;
  const websocketUrl = new URL('/ci-smoke', baseUrl);
  websocketUrl.protocol = 'ws:';
  const websocket = new WebSocket(websocketUrl);
  try {
    await once(websocket, 'open');
    const version = Buffer.from([0]);
    const identity = Buffer.from('39d6ae78271c4e738796c1a43b9d6e58', 'hex');
    const command = Buffer.from([0, 1, echoPort >> 8, echoPort & 255, 1, 127, 0, 0, 1]);
    const received = [];
    const exchange = new Promise((resolve, reject) => {
      websocket.on('error', reject);
      websocket.on('message', message => {
        received.push(message);
        if (Buffer.concat(received).includes(Buffer.from('smoke-echo'))) resolve();
      });
    });
    websocket.send(Buffer.concat([version, identity, command, Buffer.from('smoke-echo')]));
    await exchange;
    assert.equal(Buffer.concat(received).subarray(0, 2).toString('hex'), '0000');
    console.log('PASS: health, home, 404, subscription and WebSocket TCP round trip');
  } finally {
    websocket.terminate();
    echoServer.close();
  }
}

main().then(() => {
  clearTimeout(timeout);
  process.exit(0);
}, error => {
  console.error(error);
  process.exit(1);
});
