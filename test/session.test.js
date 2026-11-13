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
async function startServer(t, { home = path.join(root, 'test', 'no-home') } = {}) {
  const timers = new Set();
  const context = vm.createContext({
    __dirname: root, Buffer, URL, console: { log() {} },
    process: { env: { PORT: '0', HOST: '127.0.0.1', CODEX_SESSIONS: path.join(root, 'test', 'no-sessions'), HOOK_TOKEN: 'test-hook-token' } },
    setInterval(fn, ms) { const timer = setInterval(fn, ms); timers.add(timer); return timer; },
    clearInterval,
    require(name) {
      if (name === 'better-sqlite3') return function () { return new Database(':memory:'); };
      if (name === 'fs') return { ...fs, mkdirSync() {}, existsSync() { return false; } };
      if (name === 'os') return { homedir: () => home };
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
    async request(name, body) { // ack 응답이 있는 이벤트
      const id = ++ackId;
      ws.send('42' + id + JSON.stringify([name, body]));
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

test('chat reset and custom avatars', async t => {
  const app = await startServer(t);
  async function signup(username) {
    const res = await fetch(app.url + '/api/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'test-password' }),
    });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie').split(';')[0];
  }
  const aliceCookie = await signup('alice'), bobCookie = await signup('bob');
  const alice = await connect(t, app.url, aliceCookie);
  const bob = await connect(t, app.url, bobCookie);
  const count = (room) => app.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE room = ?').get(room).n;

  await t.test('clearing a room deletes only that room and leaves a notice for everyone', async () => {
    assert.equal((await alice.chat('office', 'hello')).ok, true);
    // 같은 연결의 이벤트는 순서대로 처리되므로 이동 직후 바로 보내도 된다 (채팅은 0.3초 간격 제한이 있어 잠깐 쉼)
    await new Promise(r => setTimeout(r, 350));
    alice.emit('move', { room: 'lounge', x: 14, y: 86, act: null });
    assert.equal((await alice.chat('lounge', 'lounge msg')).ok, true);
    alice.emit('move', { room: 'office', x: 180, y: 140, act: null });

    assert.ok((await alice.request('clearChat', { room: 'lounge' })).error, 'must be in the room being cleared');
    assert.equal((await alice.request('clearChat', { room: 'office' })).ok, true);
    const ev = await bob.event('chatCleared');
    assert.equal(ev.room, 'office');
    assert.equal(ev.notice.name, '');
    assert.match(ev.notice.text, /alice/);
    assert.equal(count('office'), 1, 'only the notice remains');
    assert.equal(count('lounge'), 1, 'other rooms are untouched');
    assert.ok((await alice.request('clearChat', { room: 'office' })).error, 'rapid repeat is throttled');
  });

  await t.test('logged-out sockets cannot clear chat', async () => {
    const guest = await connect(t, app.url);
    assert.ok((await guest.request('clearChat', { room: 'office' })).error);
  });

  await t.test('avatars are validated, saved, and broadcast', async () => {
    const rows = (r) => Array(12).fill(r);
    const avatar = { palette: ['#ff0000', '#00ff00'], pants: '#112233', views: { down: rows('..0011....'), up: rows('..0000....'), side: rows('...1111...') } };
    const post = (body, cookie) => fetch(app.url + '/api/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });

    const bad = structuredClone(avatar); bad.views.down[0] = '..0022....'; // palette has no index 2
    assert.equal((await post({ avatar: bad }, aliceCookie)).status, 400);
    assert.equal((await post({ avatar }, '')).status, 401);

    assert.equal((await post({ avatar }, aliceCookie)).status, 200);
    const ev = await bob.event('avatar');
    assert.equal(ev.name, 'alice');
    assert.deepEqual(ev.avatar.views.side, avatar.views.side);
    const late = await connect(t, app.url, bobCookie);
    assert.ok((await late.event('avatars')).alice, 'new connections receive saved avatars');

    assert.equal((await post({ avatar: null }, aliceCookie)).status, 200);
    assert.equal((await bob.event('avatar')).avatar, null);
  });
});

test('Claude Code hooks mark exact approval waits and the detail panel reads session history', async t => {
  const home = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'po-hook-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, '.claude', 'projects', '-tmp-demo');
  fs.mkdirSync(dir, { recursive: true });
  const id = '11111111-2222-3333-4444-555555555555';
  const file = path.join(dir, id + '.jsonl');
  const now = new Date().toISOString();
  const line = (o) => JSON.stringify({ sessionId: id, cwd: '/tmp/demo', timestamp: now, ...o }) + '\n';
  fs.writeFileSync(file,
    line({ type: 'user', message: { role: 'user', content: 'fix the login bug' } }) +
    line({ type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/demo/src/login.js' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }));

  const app = await startServer(t, { home });
  const hook = (body, token = 'test-hook-token') => fetch(app.url + '/api/hook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hook-Token': token }, body: JSON.stringify(body) });
  const guest = await connect(t, app.url);
  const initial = await guest.event('agents');
  assert.equal(initial[0].state, 'terminal');
  assert.equal(initial[0].waitExact, false);

  await t.test('hook requests need the token and stay inside the session folder', async () => {
    assert.equal((await hook({ hook_event_name: 'Notification', transcript_path: file }, 'wrong')).status, 403);
    const outside = await hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt', transcript_path: '/etc/passwd' });
    assert.equal((await outside.json()).ok, false);
  });

  await t.test('a permission notification turns the agent into an exact wait, and the tool result clears it', async () => {
    assert.equal((await hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt',
      message: 'Claude needs your permission to use Bash', transcript_path: file })).status, 200);
    let list = await guest.event('agents');
    assert.equal(list[0].state, 'waiting');
    assert.equal(list[0].waitExact, true);
    assert.match(list[0].detail, /permission/);

    // 기록에 다른 assistant 줄이 더 붙어도 사용자가 답하기 전까지는 대기 유지
    fs.appendFileSync(file, line({ type: 'assistant', message: { content: [{ type: 'text', text: 'hmm' }] } }));
    await hook({ hook_event_name: 'Notification', notification_type: 'idle_prompt', transcript_path: file }); // 서버가 기록을 따라잡게
    const snap = await guest.request('agentDetail', file);
    assert.equal(snap.state, 'waiting');

    fs.appendFileSync(file, line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }));
    await hook({ hook_event_name: 'Stop', transcript_path: file });
    const after = await guest.request('agentDetail', file);
    assert.equal(after.state, 'thinking');
    assert.equal(after.waitExact, false);
  });

  await t.test('agentDetail returns prompt, files and history; unknown ids return null', async () => {
    const d = await guest.request('agentDetail', file);
    assert.equal(d.lastPrompt.text, 'fix the login bug');
    assert.deepEqual(d.files.map((f) => f.path), ['src/login.js']);
    assert.equal(d.files[0].reads, 1);
    assert.ok(d.history.some((h) => /npm test/.test(h.text)));
    assert.ok(d.history.some((h) => /login\.js/.test(h.text)), 'parallel tool calls are all in the timeline');
    assert.equal(await guest.request('agentDetail', '/nope.jsonl'), null);
  });
});
