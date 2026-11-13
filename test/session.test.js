const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const Database = require('better-sqlite3');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..');

// Run the actual HTTP/Socket.IO handlers with an isolated, in-memory SQLite DB.
async function startServer(t) {
  const timers = new Set();
  const context = vm.createContext({
    __dirname: root, Buffer, URL, console: { log() {} },
    process: { env: { PORT: '0', HOST: '127.0.0.1', CODEX_SESSIONS: path.join(root, 'test', 'no-sessions') } },
    setInterval(fn, ms) { const timer = setInterval(fn, ms); timers.add(timer); return timer; },
    clearInterval,
    require(name) {
      if (name === 'better-sqlite3') return function () { return new Database(':memory:'); };
      if (name === 'fs') return { ...fs, mkdirSync() {}, existsSync() { return false; } };
      if (name === 'os') return { homedir: () => path.join(root, 'test', 'no-home') };
      return require(name);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), context);
  const app = vm.runInContext('({ server, io, db })', context);
  t.after(async () => {
    for (const timer of timers) clearInterval(timer);
    await new Promise(resolve => app.io.close(resolve));
    app.db.close();
  });
  await once(app.server, 'listening');
  app.url = `http://127.0.0.1:${app.server.address().port}`;
  return app;
}

// A small Engine.IO/Socket.IO wire client avoids a separate client dependency.
async function connect(t, url, cookie = '') {
  const ws = new WebSocket(url.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket', { headers: { Cookie: cookie } });
  t.after(() => ws.terminate());
  const packets = [];
  let wake;
  ws.on('message', data => {
    const packet = data.toString();
    if (packet === '2') { ws.send('3'); return; }
    packets.push(packet);
    if (wake) wake();
  });
  function next(predicate) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { wake = null; reject(new Error('Socket packet timeout')); }, 4000);
      wake = () => {
        const i = packets.findIndex(predicate);
        if (i < 0) return;
        clearTimeout(timeout); wake = null;
        resolve(packets.splice(i, 1)[0]);
      };
      wake();
    });
  }
  await next(p => p.startsWith('0'));
  ws.send('40');
  await next(p => p.startsWith('40'));
  let ackId = 0;
  return {
    ws,
    event: name => next(p => p.startsWith('42') && JSON.parse(p.slice(2))[0] === name).then(p => JSON.parse(p.slice(2))[1]),
    emit: (name, body) => ws.send('42' + JSON.stringify([name, body])),
    async chat(room, text) {
      const id = ++ackId;
      ws.send('42' + id + JSON.stringify(['chat', { room, text }]));
      return JSON.parse((await next(p => p.startsWith('43' + id + '['))).slice(('43' + id).length))[0];
    },
  };
}

test('session and multi-tab regressions', async t => {
  const app = await startServer(t);
  async function auth(endpoint) {
    const res = await fetch(app.url + '/api/' + endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tester', password: 'test-password' }),
    });
    assert.equal(res.status, 200);
    await res.json();
    return res.headers.get('set-cookie').split(';')[0];
  }
  const cookie = await auth('signup');
  const a = await connect(t, app.url, cookie);
  const b = await connect(t, app.url, cookie);

  await t.test('malformed cookies do not crash connections or hide a valid session', async () => {
    const malformed = await connect(t, app.url, 'unrelated=%; ' + cookie);
    const list = await malformed.event('players');
    assert.equal(list[0].name, 'tester');
    assert.equal((await fetch(app.url + '/api/me', { headers: { Cookie: 'po_session=%' } })).status, 200);
  });

  await t.test('movement reaches other tabs and stale-room chat is rejected', async () => {
    b.emit('move', { room: 'lounge', x: 14, y: 86, act: null });
    assert.equal((await a.event('playerMoved')).room, 'lounge');
    assert.ok((await a.chat('office', 'wrong room')).error);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);
    assert.equal((await a.chat('lounge', 'correct room')).ok, true);
    assert.equal(app.db.prepare('SELECT room FROM messages').get().room, 'lounge');
  });

  await t.test('logout revokes every socket using that token', async () => {
    const res = await fetch(app.url + '/api/logout', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}',
    });
    assert.equal(res.status, 200);
    await Promise.all([a.event('sessionExpired'), b.event('sessionExpired')]);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    const guest = await connect(t, app.url, cookie);
    assert.ok((await guest.chat('lounge', 'revoked')).error);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
  });

  await t.test('idle sockets are disconnected when the session expires', async () => {
    const fresh = await auth('login');
    const idle = await connect(t, app.url, fresh);
    app.db.prepare('UPDATE sessions SET exp = 0').run();
    await idle.event('sessionExpired');
    if (idle.ws.readyState !== WebSocket.CLOSED) await once(idle.ws, 'close');
  });
});

test('other-tab movement updates the local view and clears pending movement', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'office.js'), 'utf8');
  const helper = source.slice(source.indexOf('function syncOwnPosition'), source.indexOf('function syncPeople'));
  const context = vm.createContext({ me: { name: 'tester', room: 'office', placed: true, act: {} },
    dirtyMove: true, keys: new Set(['ArrowRight']), resetJoy() {}, viewRoom: 'office',
    unread: { lounge: 3 }, renderChat() {}, renderTabs() {} });
  vm.runInContext(helper, context);
  context.syncOwnPosition({ name: 'tester', room: 'lounge', x: 14, y: 86, act: null });
  assert.equal(context.me.room, 'lounge');
  assert.equal(context.viewRoom, 'lounge');
  assert.equal(context.me.act, null);
  assert.equal(context.dirtyMove, false);
  assert.equal(context.keys.size, 0);
  assert.equal(context.unread.lounge, 0);
});
