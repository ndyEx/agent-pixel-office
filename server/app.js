// 서버 조립: 각 부품을 만들고 서로 연결한다. 실제 일은 각 모듈이 한다.
//
//   tracker   (agents/tracker.js)  세션 기록 감시 → 에이전트 상태
//   stats     (stats.js)           세션 기록 → 일일 통계
//   store     (store.js)           SQLite: 계정·채팅·캐릭터
//   auth      (auth.js)            로그인 쿠키·비밀번호
//   http      (http.js)            /api/* + 정적 파일
//   realtime  (realtime.js)        socket.io: 사람 이동·채팅
//
// 1초마다 tick(): 기록을 읽고, 에이전트 상태나 통계가 바뀌었으면 모든 브라우저에 보낸다.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { createTracker } = require('./agents/tracker');
const { classifyTool, classifyCodex, codexCallParts } = require('./agents/classify');
const { createStats } = require('./stats');
const { openStore } = require('./store');
const { createAuth, loadHookToken } = require('./auth');
const { createHttpHandler } = require('./http');
const { attachRealtime } = require('./realtime');

const TICK_MS = 1000;
const STATS_DAYS = 7; // 통계는 최근 7일치

/** @param {ReturnType<import('./config').loadConfig>} config */
function createApp(config) {
  if (config.dataDir) fs.mkdirSync(config.dataDir, { recursive: true });
  const store = openStore(config.dbFile || path.join(config.dataDir, 'office.db'), config.dataDir);
  const auth = createAuth(store.q);
  const hookToken = config.hookToken || loadHookToken(config.dataDir);

  const tracker = createTracker({ claudeRoot: config.claudeRoot, codexRoot: config.codexRoot });
  const stats = createStats({
    keepDays: STATS_DAYS,
    classifyClaude: classifyTool,
    classifyCodexCall: (p) => { const { name, text } = codexCallParts(p); return classifyCodex(name, text); },
    listFiles: () => [
      ...tracker.listClaudeFiles().map((f) => ({ path: f, agent: 'claude', isSub: f.includes(`${path.sep}subagents${path.sep}`) })),
      ...tracker.listCodexFiles(STATS_DAYS + 1).map((f) => ({ path: f, agent: 'codex' })),
    ],
  });

  // ---------- 바뀐 것만 모두에게 보내기 ----------
  let io;
  let lastAgents = '', lastStats = '';
  function broadcastAgents() {
    const data = JSON.stringify(tracker.snapshot());
    if (data !== lastAgents) { lastAgents = data; io.emit('agents', JSON.parse(data)); }
  }
  function broadcastStats() {
    try {
      stats.update();
      const data = JSON.stringify(stats.snapshot());
      if (data !== lastStats) { lastStats = data; io.emit('stats', JSON.parse(data)); }
    } catch (err) { console.error('통계 집계 오류:', err.message); } // 통계가 실패해도 에이전트 상태 표시는 계속
  }
  function tick() {
    tracker.update();
    broadcastAgents();
    broadcastStats();
  }

  // ---------- HTTP + socket.io ----------
  let realtime;
  const server = http.createServer(createHttpHandler({
    publicDir: config.publicDir,
    store, auth, hookToken,
    onHook: (body) => { const ok = tracker.applyHook(body); if (ok) broadcastAgents(); return ok; },
    onAvatarChanged: (name, avatar) => io.emit('avatar', { name, avatar }), // 모두의 화면에 바로 반영
    onLogout: (token) => realtime.disconnectToken(token),
  }));
  io = new Server(server); // /socket.io/socket.io.js 클라이언트 스크립트도 자동으로 제공
  realtime = attachRealtime(io, { store, auth, tracker, getStats: () => (lastStats ? JSON.parse(lastStats) : null) });

  let timer = null;
  return {
    server, io, db: store.db,
    /** 기록을 한 번 읽고 접속을 받기 시작한다 */
    start() {
      tick();
      timer = setInterval(tick, TICK_MS);
      return new Promise((resolve) => server.listen(config.port, config.host, () => {
        if (!config.quiet) console.log(`Pixel Office → http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${server.address().port}`);
        resolve();
      }));
    },
    async stop() {
      clearInterval(timer);
      realtime.stop();
      await new Promise((resolve) => io.close(resolve)); // HTTP 서버도 같이 닫힌다
      store.db.close();
    },
  };
}

module.exports = { createApp };
