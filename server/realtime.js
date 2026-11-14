// 실시간 통신(socket.io): 사람 캐릭터의 위치·동작, 방별 채팅, 상세 패널 요청.
// 에이전트 상태와 통계는 app.js가 바뀔 때마다 io.emit으로 모두에게 보낸다.
//
// 서버 → 브라우저 이벤트
//   agents, stats, players, playerMoved, history, chat, chatCleared, avatars, avatar, sessionExpired
// 브라우저 → 서버 이벤트
//   move, chat(ack), clearChat(ack), agentDetail(ack)
const crypto = require('crypto');

const ROOMS = ['office', 'lounge', 'meeting'];
const SPAWN = { office: { x: 180, y: 140 }, lounge: { x: 14, y: 86 }, meeting: { x: 14, y: 86 } };
const WORLD = { w: 240, h: 150 };           // 월드 좌표 크기 (public/js/world.js와 같음)
const CHAT_GAP_MS = 300, CLEAR_GAP_MS = 3000;
const PLAYERS_FLUSH_MS = 100;               // 사람 위치는 모아서 0.1초마다 보낸다

// 앉기·마시기 같은 동작 정보는 정해진 값만 받는다
const ANIMS = new Set(['type', 'coffee', 'soda', 'read', 'write', 'pingpong']);
const DIRS = new Set(['up', 'down', 'left', 'right']);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function cleanAct(a) {
  if (!a || typeof a !== 'object') return null;
  const sx = Number(a.sx), sy = Number(a.sy);
  return {
    id: String(a.id || '').slice(0, 16),
    a: ANIMS.has(a.a) ? a.a : null,
    p: a.p === 'sit' ? 'sit' : 'stand',
    d: DIRS.has(a.d) ? a.d : 'down',
    c: !!a.c,
    sx: Number.isFinite(sx) ? clamp(sx, 0, WORLD.w) : null,  // 앉기 전 서 있던 자리
    sy: Number.isFinite(sy) ? clamp(sy, 0, WORLD.h) : null,
  };
}

/**
 * @param {import('socket.io').Server} io
 * @param {object} deps  { store, auth, tracker, getStats }
 */
function attachRealtime(io, { store, auth, tracker, getStats }) {
  const { db, q, avatarMap } = store;
  const players = new Map(); // user key -> { name, room, x, y, act, conns, lastChat, lastClear }
  let playersDirty = false;
  const playerList = () => [...players.values()].filter((p) => p.conns > 0)
    .map(({ name, room, x, y, act }) => ({ name, room, x, y, act: act || null }));
  const chatHistory = () => Object.fromEntries(ROOMS.map((r) => [r, q.recent.all(r)]));
  const newId = () => crypto.randomBytes(6).toString('hex');

  io.on('connection', (socket) => {
    // 소켓 연결 때 브라우저가 보낸 쿠키로 로그인 사용자를 알아낸다
    const user = auth.userFromCookie(socket.handshake.headers.cookie);
    socket.emit('agents', tracker.snapshot());
    const stats = getStats();
    if (stats) socket.emit('stats', stats);
    socket.emit('history', chatHistory());
    socket.emit('avatars', avatarMap());

    if (user) {
      socket.join(`session:${user.token}`); // 로그아웃 때 이 토큰의 연결을 한꺼번에 끊으려고
      socket.join(`user:${user.key}`);      // 같은 사람의 다른 탭에 내 이동을 알리려고
      let p = players.get(user.key);
      if (!p) { p = { name: user.name, room: 'office', ...SPAWN.office, conns: 0 }; players.set(user.key, p); }
      // 다시 접속하면 앉아 있던 동작은 풀고, 앉기 전 서 있던 자리로 돌려놓는다
      if (p.conns === 0 && p.act) {
        if (p.act.sx != null && p.act.sy != null) { p.x = p.act.sx; p.y = p.act.sy; }
        p.act = null;
      }
      p.conns++;
      playersDirty = true;
    }
    socket.emit('players', playerList());

    // 로그인이 아직 유효한가. 만료됐으면 알리고 연결을 끊는다
    function authenticated() {
      if (!user) return false;
      if (auth.isValid(user.token)) return true;
      socket.emit('sessionExpired');
      socket.disconnect(true);
      return false;
    }
    // 가만히 있는 연결도 로그인이 만료되면 끊는다
    const authTimer = user ? setInterval(authenticated, 1000) : null;

    // 상세 패널: 클릭한 에이전트의 긴 기록을 요청할 때만 보낸다
    socket.on('agentDetail', (id, ack) => {
      if (typeof ack !== 'function') return;
      ack(typeof id === 'string' ? tracker.detail(id) : null);
    });

    socket.on('move', (m) => {
      if (!authenticated() || !m || !ROOMS.includes(m.room)) return;
      const x = Number(m.x), y = Number(m.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const p = players.get(user.key);
      p.room = m.room; p.x = clamp(x, 0, WORLD.w); p.y = clamp(y, 0, WORLD.h);
      p.act = cleanAct(m.act);
      // 같은 사람의 다른 탭에 바로 알린다 (이 탭은 제외)
      socket.to(`user:${user.key}`).emit('playerMoved', { name: p.name, room: p.room, x: p.x, y: p.y, act: p.act });
      playersDirty = true;
    });

    socket.on('chat', (m, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!authenticated()) return ack({ error: '로그인이 필요해요' });
      const text = String(m?.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return ack({ error: '빈 메시지' });
      const p = players.get(user.key);
      if (m.room !== p.room) return ack({ error: '다른 탭에서 방이 변경됐어요. 현재 방을 확인하고 다시 보내주세요.' });
      if (Date.now() - (p.lastChat || 0) < CHAT_GAP_MS) return ack({ error: '너무 빨라요' });
      p.lastChat = Date.now();
      const msg = { id: newId(), room: p.room, name: p.name, text, t: Date.now() };
      q.addMessage.run(msg);
      io.emit('chat', msg); // 다른 방 사람도 받아서 탭에 '안 읽음' 숫자를 띄운다
      ack({ ok: true });
    });

    // 채팅 초기화: 내가 있는 방의 기록을 지우고, 누가 지웠는지 알림 한 줄을 남긴다.
    // 알림은 name이 빈 문자열인 메시지 (사용자 이름은 2글자 이상이라 사람이 흉내 낼 수 없음)
    socket.on('clearChat', (m, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      if (!authenticated()) return ack({ error: '로그인이 필요해요' });
      const p = players.get(user.key);
      if (m?.room !== p.room) return ack({ error: '다른 탭에서 방이 변경됐어요. 현재 방을 확인하고 다시 시도해주세요.' });
      if (Date.now() - (p.lastClear || 0) < CLEAR_GAP_MS) return ack({ error: '잠시 후 다시 시도해주세요' });
      p.lastClear = Date.now();
      const notice = { id: newId(), room: p.room, name: '', text: `${p.name}님이 채팅을 초기화했어요`, t: Date.now() };
      db.transaction(() => { q.clearRoom.run(p.room); q.addMessage.run(notice); })();
      io.emit('chatCleared', { room: p.room, notice });
      ack({ ok: true });
    });

    socket.on('disconnect', () => {
      if (authTimer) clearInterval(authTimer);
      if (!user) return;
      const p = players.get(user.key);
      if (p) p.conns--;
      playersDirty = true;
    });
  });

  const flushTimer = setInterval(() => {
    if (playersDirty) { playersDirty = false; io.emit('players', playerList()); }
  }, PLAYERS_FLUSH_MS);

  return {
    /** 로그아웃: 그 토큰으로 연결된 모든 탭에 알리고 연결을 끊는다 */
    disconnectToken(token) {
      const connections = io.in(`session:${token}`);
      connections.emit('sessionExpired');
      connections.disconnectSockets(true);
    },
    stop() { clearInterval(flushTimer); },
  };
}

module.exports = { attachRealtime };
