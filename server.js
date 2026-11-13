// Pixel Office — Claude Code 세션 기록(JSONL)을 감시해서 상태를 브라우저로 스트리밍하는 서버
// 실시간 전송은 socket.io, 계정·로그인·채팅 저장은 SQLite(data/office.db)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 4321;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.join(os.homedir(), '.claude', 'projects');
const CODEX_ROOT = process.env.CODEX_SESSIONS || path.join(os.homedir(), '.codex', 'sessions');
const ACTIVE_WINDOW_MS = 30 * 60 * 1000; // 최근 30분 내 수정된 세션만 표시
const INITIAL_TAIL_BYTES = 256 * 1024;   // 처음 발견한 파일은 끝부분만 읽음

/** file path -> session state */
const sessions = new Map();
let io; // socket.io 서버 (아래에서 생성)

function classifyTool(name = '') {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return 'typing';
  if (/^(Read|Grep|Glob|LS)$/.test(name)) return 'reading';
  if (/^(Bash|Monitor|BashOutput|KillShell)$/.test(name) || /terminal/i.test(name)) return 'terminal';
  if (/^(WebFetch|WebSearch)$/.test(name) || /Browser|chrome/i.test(name)) return 'browsing';
  if (/^(Agent|Task|SendMessage)$/.test(name) || /start_session/.test(name)) return 'meeting';
  return 'working';
}

function describeTool(name, input = {}) {
  const short = (s, n = 60) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);
  if (input.description) return `${name}: ${short(input.description)}`;
  if (input.file_path) return `${name}: ${path.basename(input.file_path)}`;
  if (input.pattern) return `${name}: ${short(input.pattern)}`;
  if (input.command) return `${name}: ${short(input.command)}`;
  if (input.url) return `${name}: ${short(input.url)}`;
  if (input.query) return `${name}: ${short(input.query)}`;
  return name.replace(/^mcp__.+?__/, '');
}

function newSession(file, agent) {
  const isSub = file.includes(`${path.sep}subagents${path.sep}`);
  const project = agent === 'codex' ? '' : path.basename(path.dirname(isSub ? path.dirname(path.dirname(file)) : file));
  return {
    id: file,
    ownId: path.basename(file, '.jsonl'),
    agent,
    title: isSub ? 'subagent' : agent === 'codex' ? 'Codex' : path.basename(file, '.jsonl').slice(0, 8),
    firstMessage: '',
    project: project.replace(/^-Users-[^-]+-/, '').slice(-32),
    isSub,
    state: 'idle',
    detail: '',
    lastEvent: 0,
    offset: 0,
    partial: '',
    tools: 0,
    log: [],        // 목록 카드용: 서버가 지켜보는 동안 생긴 일 최근 6개
    history: [],    // 상세 패널용: 기록에 남은 시각으로 최근 HISTORY_MAX개 (처음 읽은 끝부분 포함)
    files: new Map(), // 만진 파일: 경로 -> { path, edits, reads, t } (최근 것이 뒤)
    byState: {},    // 도구 종류별 횟수 (읽은 범위 기준)
    cwd: '',
    lastPrompt: null, // { text, t }
    startedAt: (() => { try { return fs.statSync(file).birthtimeMs || 0; } catch { return 0; } })(),
    hooked: false,  // Claude Code 훅 이벤트를 한 번이라도 받았나 (받았으면 침묵 추정을 끈다)
    hookWait: false, // 훅이 알려 준 승인 대기 중
    waitDetail: '',
  };
}

const HISTORY_MAX = 60, FILES_MAX = 40;
function pushLog(s, text, ts = Date.now(), live = true) {
  s.history.push({ t: ts, text });
  if (s.history.length > HISTORY_MAX) s.history.shift();
  if (!live) return;
  s.log.push({ t: Date.now(), text });
  if (s.log.length > 6) s.log.shift();
}

function touchFile(s, file, kind, ts) {
  if (!file || typeof file !== 'string') return;
  const f = s.files.get(file) || { path: file, edits: 0, reads: 0, t: 0 };
  if (kind === 'edit') f.edits++; else f.reads++;
  f.t = Math.max(f.t, ts);
  s.files.delete(file); s.files.set(file, f); // 최근에 만진 파일이 뒤로
  if (s.files.size > FILES_MAX) s.files.delete(s.files.keys().next().value);
}

// 사용자 요청 글: 문자열이거나 text 조각 배열. '<'로 시작하는 조각은 명령·시스템 안내라 뺀다
function promptText(c) {
  const parts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text || '') : [];
  const clean = parts.map((t) => t.trim()).filter((t) => t && !t.startsWith('<') && !t.startsWith('[Request interrupted'))
    .join(' ').replace(/\s+/g, ' ').trim();
  return clean.slice(0, 400);
}

function setPrompt(s, text, ts) {
  if (!text) return;
  s.lastPrompt = { text, t: ts };
  if (!s.firstMessage) s.firstMessage = text;
}

function applyEntry(s, e, live) {
  const ts = e.timestamp ? Date.parse(e.timestamp) : Date.now();
  if (e.type === 'agent-name' && e.agentName) s.title = e.agentName;
  // 프로젝트 이름: 폴더 이름(경로의 /를 -로 바꾼 것)은 어디서 끊어야 할지 모르므로, 기록에 남은 실제 작업 폴더(cwd)를 쓴다
  if (typeof e.cwd === 'string' && e.cwd) { s.cwd = e.cwd; s.project = path.basename(e.cwd.replace(/[\\/]+$/, '')).slice(-32); }
  if (e.type === 'summary' && e.summary && s.title.length <= 8) s.title = e.summary;
  // 포크·사이드 채팅은 원래 대화 기록을 그대로 복사해 둔다(sessionId가 원본 것).
  // 복사된 기록은 이 세션이 한 일이 아니므로 상태 계산에서 뺀다.
  if (!s.isSub && e.sessionId && e.sessionId !== s.ownId) return;
  if (e.type === 'assistant' && e.message) {
    s.lastEvent = ts;
    const content = Array.isArray(e.message.content) ? e.message.content : [];
    const uses = content.filter((c) => c.type === 'tool_use');
    const tool = uses[uses.length - 1];
    for (const u of uses) {
      const kind = classifyTool(u.name), input = u.input || {};
      s.byState[kind] = (s.byState[kind] || 0) + 1;
      const file = input.file_path || input.notebook_path;
      if (kind === 'typing') touchFile(s, file, 'edit', ts);
      else if (u.name === 'Read') touchFile(s, file, 'read', ts);
      if (u !== tool) pushLog(s, describeTool(u.name, input), ts, live); // 한 번에 여러 도구를 부른 경우
    }
    if (tool) {
      s.state = classifyTool(tool.name);
      s.detail = describeTool(tool.name, tool.input);
      s.tools++;
      pushLog(s, s.detail, ts, live);
    } else if (e.message.stop_reason === 'end_turn') {
      s.state = 'idle';
      s.detail = '작업 완료 — 다음 요청 대기';
      pushLog(s, '✔ 턴 종료', ts, live);
    } else {
      s.state = 'thinking';
      s.detail = '생각 중…';
    }
    // 훅이 승인 대기라고 알려 줬으면, 사용자가 답하기(tool_result) 전까지는 대기로 둔다
    if (s.hookWait) { s.state = 'waiting'; s.detail = s.waitDetail; }
  }
  if (e.type === 'user' && e.message) {
    s.lastEvent = ts;
    const c = e.message.content;
    const isToolResult = Array.isArray(c) && c.some((x) => x.type === 'tool_result');
    s.hookWait = false;
    s.state = 'thinking';
    s.detail = isToolResult ? '결과 확인 중…' : '새 요청을 받음';
    if (!isToolResult && !e.isMeta) {
      const text = promptText(c);
      setPrompt(s, text, ts);
      if (text) pushLog(s, '✉ 사용자 요청', ts, live);
    }
  }
}

// ---------- Codex (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) ----------
// Codex 도구 호출은 이름(shell, apply_patch …) 또는 JS 래퍼(exec) 안의 tools.xxx 호출로 기록된다
function classifyCodex(name = '', text = '') {
  const all = `${name} ${text}`;
  if (/apply_patch|write_file|edit_file/.test(all)) return 'typing';
  if (/web_search|browser|fetch_url/i.test(all)) return 'browsing';
  if (/spawn_agent|send_input|wait_agent/.test(all)) return 'meeting';
  const cmd = (text.match(/"?(?:cmd|command)"?\s*:\s*\[?\s*"([^"]+)/) || [])[1] || '';
  if (/^(cat|sed|head|tail|rg|grep|ls|find|nl|wc)\b/.test(cmd) || /read_file|list_dir|grep_files/.test(all)) return 'reading';
  if (/shell|exec_command|local_shell/.test(all) || cmd) return 'terminal';
  return 'working';
}

function describeCodex(name, text) {
  const cmd = (text.match(/"?(?:cmd|command)"?\s*:\s*\[?\s*"([^"]+)/) || [])[1];
  const inner = (text.match(/tools\.(\w+)/) || [])[1];
  const label = inner || name;
  const s = cmd ? `${label}: ${cmd}` : label;
  return s.length > 64 ? s.slice(0, 63) + '…' : s;
}

// "[@Linear](plugin://...)" 같은 플러그인 멘션 마크업을 "@Linear"로 정리
function cleanCodexText(t) {
  return t.replace(/\[@([^\]]+)\]\([^)]*\)/g, '@$1').replace(/\s+/g, ' ').trim();
}

// Codex 앱 사이드바에 보이는 스레드 이름은 ~/.codex/session_index.jsonl 에 저장된다 (id → thread_name)
const CODEX_INDEX = path.join(path.dirname(CODEX_ROOT), 'session_index.jsonl');
let codexNames = new Map();
let codexIndexMtime = 0;
function loadCodexNames() {
  try {
    const st = fs.statSync(CODEX_INDEX);
    if (st.mtimeMs === codexIndexMtime) return;
    codexIndexMtime = st.mtimeMs;
    const m = new Map();
    for (const line of fs.readFileSync(CODEX_INDEX, 'utf8').split('\n')) {
      try { const e = JSON.parse(line); if (e.id && e.thread_name) m.set(e.id, e.thread_name); } catch { /* skip */ }
    }
    codexNames = m;
  } catch { /* 인덱스 없음 */ }
}

function codexTitle(s) {
  const id = (path.basename(s.id).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/) || [])[1];
  const name = id && codexNames.get(id);
  if (name) return name;
  if (s.firstMessage) return s.firstMessage.length > 40 ? s.firstMessage.slice(0, 39) + '…' : s.firstMessage;
  return 'Codex 세션';
}

// Codex *_call 기록에서 도구 이름과 인자 문자열을 꺼낸다 (상태 표시와 일일 통계가 같이 쓴다)
function codexCallParts(p) {
  const name = p.name || p.type.replace(/_call$/, '');
  const text = typeof p.input === 'string' ? p.input : typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.action || p.input || {});
  return { name, text };
}

function applyCodex(s, e, live) {
  const ts = e.timestamp ? Date.parse(e.timestamp) : Date.now();
  const p = e.payload || {};
  if ((e.type === 'session_meta' || e.type === 'turn_context') && p.cwd) { s.cwd = p.cwd; s.project = path.basename(p.cwd).slice(-32); }
  // 다른 에이전트 대화를 가져온 턴(turn_id: external-import-…)은 Codex가 한 일이 아니다 (포크 복사본과 같은 취급)
  if (e.type === 'event_msg' && p.type === 'task_started') s.importing = String(p.turn_id || '').startsWith('external-import');
  if (s.importing) return;
  if (e.type === 'response_item' && /call$/.test(p.type || '')) {
    const { name, text } = codexCallParts(p);
    s.lastEvent = ts; s.tools++;
    s.state = classifyCodex(name, text);
    s.detail = describeCodex(name, text);
    s.byState[s.state] = (s.byState[s.state] || 0) + 1;
    // apply_patch 본문의 "*** Update File: 경로" 줄에서 고친 파일을 뽑는다
    for (const m of text.matchAll(/\*\*\* (?:Add|Update|Delete) File: ([^\n"\\]+)/g)) touchFile(s, path.resolve(s.cwd || '/', m[1].trim()), 'edit', ts);
    pushLog(s, s.detail, ts, live);
  }
  if (e.type === 'response_item' && /call_output$/.test(p.type || '')) {
    s.lastEvent = ts; s.state = 'thinking'; s.detail = '결과 확인 중…';
  }
  if (e.type !== 'event_msg') return;
  // 첫 메시지가 user_message 대신 item_completed(UserMessage)로만 남는 경우도 있다
  if (p.type === 'item_completed' && p.item?.type === 'UserMessage' && !s.firstMessage) {
    const t = (p.item.content || []).map((c) => c.text || '').join(' ');
    if (t.trim()) s.firstMessage = cleanCodexText(t);
  }
  switch (p.type) {
    case 'user_message':
      s.lastEvent = ts; s.state = 'thinking'; s.detail = '새 요청을 받음';
      if (p.message) setPrompt(s, cleanCodexText(p.message).slice(0, 400), ts);
      pushLog(s, '✉ 사용자 요청', ts, live);
      break;
    case 'task_started':
      s.lastEvent = ts; s.state = 'thinking'; s.detail = '생각 중…';
      break;
    case 'agent_message':
      s.lastEvent = ts; if (s.state === 'idle') break; s.state = 'thinking'; s.detail = '답변 작성 중…';
      break;
    case 'task_complete':
    case 'turn_aborted':
      s.lastEvent = ts; s.state = 'idle'; s.detail = '작업 완료 — 다음 요청 대기';
      pushLog(s, '✔ 턴 종료', ts, live);
      break;
    default:
      // Codex는 승인 요청을 명시적으로 기록하므로 추정 없이 정확하게 알 수 있다
      if (/approval_request/.test(p.type || '')) {
        s.lastEvent = ts; s.state = 'waiting'; s.detail = '사용자 승인 대기 중';
        pushLog(s, '❗ 승인 요청', ts, live);
      }
  }
}

// 처음 발견한 파일은 끝부분만 읽으므로, 앞부분의 도구 사용 횟수는 따로 세어 둔다 (칭호가 서버 재시작에 흔들리지 않게)
// 사용자 요청(첫 요청·최근 요청)도 앞부분에 있을 수 있어 함께 줍는다
const HEAD_COUNT_LIMIT = 64 * 1024 * 1024;
function countHeadTools(file, end, s) {
  const limit = Math.min(end, HEAD_COUNT_LIMIT);
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(4 * 1024 * 1024);
  let pos = 0, rest = '', n = 0;
  const countLine = (line) => {
    if (s.agent === 'codex') {
      if (line.includes('"user_message"')) {
        try { const e = JSON.parse(line); if (e.payload?.type === 'user_message' && e.payload.message) setPrompt(s, cleanCodexText(e.payload.message).slice(0, 400), Date.parse(e.timestamp) || 0); } catch { /* 잘린 줄 */ }
        return;
      }
      if (!line.includes('_call"')) return;
      try { const e = JSON.parse(line); if (e.type === 'response_item' && /call$/.test(e.payload?.type || '')) n++; } catch { /* 잘린 줄 */ }
    } else {
      if (line.includes('"type":"user"') && !line.includes('"tool_result"')) {
        try {
          const e = JSON.parse(line);
          if (e.type === 'user' && !e.isMeta && (s.isSub || !e.sessionId || e.sessionId === s.ownId)) setPrompt(s, promptText(e.message?.content), Date.parse(e.timestamp) || 0);
        } catch { /* 잘린 줄 */ }
        return;
      }
      if (!line.includes('"tool_use"')) return;
      try {
        const e = JSON.parse(line);
        if (e.type !== 'assistant' || (!s.isSub && e.sessionId && e.sessionId !== s.ownId)) return; // 복사된 기록 제외
        n += (Array.isArray(e.message?.content) ? e.message.content : []).filter((c) => c.type === 'tool_use').length;
      } catch { /* 잘린 줄 */ }
    }
  };
  try {
    while (pos < limit) {
      const len = fs.readSync(fd, chunk, 0, Math.min(chunk.length, limit - pos), pos);
      if (!len) break;
      pos += len;
      const lines = (rest + chunk.toString('utf8', 0, len)).split('\n');
      rest = lines.pop();
      lines.forEach(countLine);
    }
  } finally { fs.closeSync(fd); }
  return n;
}

function readNew(file, s, live) {
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (stat.size < s.offset) { s.offset = 0; s.partial = ''; } // 파일이 잘렸으면 처음부터
  if (stat.size === s.offset) return false;
  const start = s.offset === 0 && !live ? Math.max(0, stat.size - INITIAL_TAIL_BYTES) : s.offset;
  if (s.offset === 0 && !live && start > 0) s.tools += countHeadTools(file, start, s);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(stat.size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  s.offset = stat.size;
  const lines = (s.partial + buf.toString('utf8')).split('\n');
  s.partial = lines.pop();
  if (start > 0 && !live) lines.shift(); // 중간부터 읽었으면 첫 줄은 잘렸을 수 있음
  for (const line of lines) {
    if (!line.trim()) continue;
    try { (s.agent === 'codex' ? applyCodex : applyEntry)(s, JSON.parse(line), live); } catch { /* 깨진 줄 무시 */ }
  }
  return true;
}

function listJsonl() {
  const out = [];
  let projects = [];
  try { projects = fs.readdirSync(ROOT); } catch { return out; }
  for (const p of projects) {
    const dir = path.join(ROOT, p);
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (ent.isFile() && ent.name.endsWith('.jsonl')) out.push(path.join(dir, ent.name));
      if (ent.isDirectory()) {
        const sub = path.join(dir, ent.name, 'subagents');
        try {
          for (const f of fs.readdirSync(sub)) if (f.endsWith('.jsonl')) out.push(path.join(sub, f));
        } catch { /* 서브에이전트 없음 */ }
      }
    }
  }
  return out;
}

// Codex 세션: 날짜별 폴더 중 최근 며칠치만 본다 (상태 표시는 이틀, 통계는 더 길게)
function listCodexJsonl(days = 2) {
  const out = [];
  for (let back = 0; back < days; back++) {
    const d = new Date(Date.now() - back * 86400000);
    const dir = path.join(CODEX_ROOT, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) out.push(path.join(dir, f)); } catch { /* 없음 */ }
  }
  return out;
}

function viewOf(s, now = Date.now()) {
  let state = s.state;
  const quiet = now - s.lastEvent;
  // 도구 호출 후 한참 응답이 없으면 권한 승인 등을 기다리는 중일 가능성이 큼
  // Claude는 승인 대기가 기록되지 않아 침묵 시간으로 추정(훅을 연결한 세션은 훅이 알려 줌), Codex는 명시적 이벤트 사용
  if (s.agent === 'claude' && !s.hooked && state !== 'idle' && state !== 'thinking' && quiet > 45_000) state = 'waiting';
  if (state === 'thinking' && quiet > 120_000) state = 'idle';
  return { id: s.id, agent: s.agent, title: s.agent === 'codex' ? codexTitle(s) : s.title, project: s.project, isSub: s.isSub, state, detail: s.detail,
    lastEvent: s.lastEvent, tools: s.tools, log: s.log,
    waitExact: state === 'waiting' && (s.agent === 'codex' || s.hookWait), hooked: s.hooked };
}

function snapshot() {
  const now = Date.now();
  return [...sessions.values()]
    .filter((s) => s.lastEvent && now - s.lastEvent < ACTIVE_WINDOW_MS) // 자기 활동이 최근에 있는 세션만
    .map((s) => viewOf(s, now))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// 상세 패널: 클릭한 세션의 긴 기록. 파일 경로는 작업 폴더 기준 상대 경로(밖이면 ~로 줄임)로 보낸다
function shortPath(s, file) {
  if (s.cwd && file.startsWith(s.cwd.replace(/[\\/]+$/, '') + path.sep)) return path.relative(s.cwd, file);
  const home = os.homedir();
  return file.startsWith(home + path.sep) ? '~' + file.slice(home.length) : file;
}
function detailOf(s) {
  return { ...viewOf(s), startedAt: s.startedAt, firstMessage: s.firstMessage, lastPrompt: s.lastPrompt, byState: s.byState,
    files: [...s.files.values()].reverse().map((f) => ({ ...f, path: shortPath(s, f.path) })),
    history: s.history.slice().reverse() };
}

// ---------- 일일 통계 ----------
const { createStats } = require(path.join(__dirname, 'stats.js'));
const STATS_DAYS = 7;
const stats = createStats({
  keepDays: STATS_DAYS,
  classifyClaude: classifyTool,
  classifyCodexCall: (p) => { const { name, text } = codexCallParts(p); return classifyCodex(name, text); },
  listFiles: () => [
    ...listJsonl().map((f) => ({ path: f, agent: 'claude', isSub: f.includes(`${path.sep}subagents${path.sep}`) })),
    ...listCodexJsonl(STATS_DAYS + 1).map((f) => ({ path: f, agent: 'codex' })),
  ],
});
let lastStats = '';
function tickStats() {
  try {
    stats.update();
    const data = JSON.stringify(stats.snapshot());
    if (data !== lastStats) { lastStats = data; io.emit('stats', JSON.parse(data)); }
  } catch (err) { console.error('통계 집계 오류:', err.message); } // 통계가 실패해도 에이전트 상태 표시는 계속
}

let lastSent = '';
function broadcast() {
  const data = JSON.stringify(snapshot());
  if (data !== lastSent) {
    lastSent = data;
    io.emit('agents', JSON.parse(data));
  }
}

// ---------- Claude Code 훅 ----------
// 승인 대기는 기록(JSONL)에 남지 않으므로, 훅(Notification·PermissionRequest 등)이 보내 주는 이벤트로 정확히 안다.
// 훅 설정은 `npm run hook-config` 가 만들어 준다.
function isPermissionEvent(h) {
  const ev = String(h.hook_event_name || ''), nt = String(h.notification_type || '');
  if (ev === 'PermissionRequest') return true;
  if (ev !== 'Notification') return false;
  if (nt) return nt === 'permission_prompt' || nt === 'elicitation_dialog';
  return /permission/i.test(String(h.message || '')); // notification_type이 없는 예전 버전
}

function applyHook(h) {
  const tp = typeof h?.transcript_path === 'string' ? path.resolve(h.transcript_path) : '';
  if (!tp.startsWith(ROOT + path.sep) || !tp.endsWith('.jsonl')) return false; // 세션 기록 폴더 밖은 읽지 않는다
  let s = sessions.get(tp);
  if (!s) {
    if (!fs.existsSync(tp)) return false;
    s = newSession(tp, 'claude'); sessions.set(tp, s); readNew(tp, s, false);
  } else readNew(tp, s, true); // 훅보다 늦게 읽힌 기록 줄이 대기 상태를 덮어쓰지 않게 먼저 따라잡는다
  s.hooked = true;
  const now = Date.now(), ev = String(h.hook_event_name || '');
  if (isPermissionEvent(h)) {
    const tool = typeof h.tool_name === 'string' ? h.tool_name.replace(/^mcp__.+?__/, '') : '';
    const msg = String(h.message || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const text = msg || (tool ? `${tool} 승인 요청` : '사용자 승인 대기 중');
    if (!s.hookWait) pushLog(s, `❗ ${text}`, now, true);
    s.hookWait = true; s.waitDetail = text;
    s.state = 'waiting'; s.detail = text; s.lastEvent = now;
  } else if (['PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Stop', 'SessionEnd'].includes(ev) && s.hookWait) {
    s.hookWait = false;
    if (s.state === 'waiting') { s.state = 'thinking'; s.detail = '결과 확인 중…'; }
  }
  broadcast();
  return true;
}

// 훅 요청은 data/hook-token 의 비밀값을 함께 보내야 받는다 (외부 공개 시 아무나 상태를 조작하지 못하게)
function loadHookToken(dir) {
  if (process.env.HOOK_TOKEN) return process.env.HOOK_TOKEN;
  const file = path.join(dir, 'hook-token');
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (t) return t; } catch { /* 처음 실행 */ }
  const t = crypto.randomBytes(24).toString('hex');
  try { fs.writeFileSync(file, t + '\n', { mode: 0o600 }); } catch { /* 저장 못 해도 이번 실행에서는 동작 */ }
  return t;
}

function tick() {
  const now = Date.now();
  loadCodexNames();
  const files = [...listJsonl().map((f) => [f, 'claude']), ...listCodexJsonl().map((f) => [f, 'codex'])];
  for (const [file, agent] of files) {
    let mtime;
    try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
    if (now - mtime > ACTIVE_WINDOW_MS) continue;
    let s = sessions.get(file);
    if (!s) { s = newSession(file, agent); sessions.set(file, s); readNew(file, s, false); }
    else readNew(file, s, true);
  }
  for (const [file, s] of sessions) {
    // 앱에서 세션을 삭제·보관하면 기록 파일이 사라지거나 옮겨지므로 바로 퇴근 처리
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { /* 삭제됨 */ }
    if (!mtime || now - mtime > ACTIVE_WINDOW_MS) sessions.delete(file);
  }
  broadcast();
  tickStats();
}

// ---------- 저장소: SQLite ----------
// 계정·로그인 토큰·채팅을 data/office.db 한 파일에 저장. 비밀번호는 scrypt 해시로만 보관한다.
const Database = require('better-sqlite3');
const { Server } = require('socket.io');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'office.db'));
const HOOK_TOKEN = loadHookToken(DATA_DIR);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    key TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, key TEXT NOT NULL REFERENCES users(key), exp INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, room TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, t INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS messages_room_t ON messages(room, t);
`);
// 직접 그린 도트 캐릭터(JSON). 예전 DB에는 칸이 없으므로 없을 때만 추가
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');

const q = {
  getUser: db.prepare('SELECT * FROM users WHERE key = ?'),
  addUser: db.prepare('INSERT INTO users (key, name, salt, hash, created) VALUES (?, ?, ?, ?, ?)'),
  getSession: db.prepare('SELECT s.key, u.name FROM sessions s JOIN users u ON u.key = s.key WHERE s.token = ? AND s.exp > ?'),
  addSession: db.prepare('INSERT OR IGNORE INTO sessions (token, key, exp) VALUES (?, ?, ?)'),
  delSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE exp <= ?'),
  addMessage: db.prepare('INSERT INTO messages (id, room, name, text, t) VALUES (@id, @room, @name, @text, @t)'),
  recent: db.prepare('SELECT * FROM (SELECT * FROM messages WHERE room = ? ORDER BY t DESC LIMIT 100) ORDER BY t'),
  setAvatar: db.prepare('UPDATE users SET avatar = ? WHERE key = ?'),
  clearRoom: db.prepare('DELETE FROM messages WHERE room = ?'),
  allAvatars: db.prepare('SELECT name, avatar FROM users WHERE avatar IS NOT NULL'),
};

// ---------- 직접 그린 캐릭터 ----------
// { v: 1, palette: ['#rrggbb' x 최대 16], pants: '#rrggbb', views: { down|up|side: 12줄 x 10칸 } }
// 칸 글자: '.' = 빈칸, '0'~'f' = palette 번호. 머리·몸(12줄)만 그리고 다리는 바지 색으로 자동 생성
const AV_ROWS = 12, AV_COLS = 10;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
function cleanAvatar(a) {
  if (a === null) return null;
  if (!a || typeof a !== 'object' || !Array.isArray(a.palette) || !a.views) throw new Error('bad avatar');
  const palette = a.palette.slice(0, 16).map(String);
  if (!palette.length || !palette.every((c) => HEX_COLOR.test(c))) throw new Error('bad palette');
  if (!HEX_COLOR.test(String(a.pants))) throw new Error('bad pants');
  const cell = new RegExp(`^[.${'0123456789abcdef'.slice(0, palette.length)}]{${AV_COLS}}$`);
  const views = {};
  for (const dir of ['down', 'up', 'side']) {
    const rows = a.views[dir];
    if (!Array.isArray(rows) || rows.length !== AV_ROWS || !rows.every((r) => typeof r === 'string' && cell.test(r))) throw new Error(`bad view ${dir}`);
    views[dir] = rows;
  }
  return { v: 1, palette: palette.map((c) => c.toLowerCase()), pants: String(a.pants).toLowerCase(), views };
}
const avatarMap = () => Object.fromEntries(q.allAvatars.all().map((r) => { try { return [r.name, JSON.parse(r.avatar)]; } catch { return null; } }).filter(Boolean));

// 이전 버전의 JSON 파일(users.json, sessions.json)이 있으면 한 번만 옮겨 담는다
(function migrateJson() {
  const usersFile = path.join(DATA_DIR, 'users.json'), tokensFile = path.join(DATA_DIR, 'sessions.json');
  if (!fs.existsSync(usersFile)) return;
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
  db.transaction(() => {
    for (const [key, u] of Object.entries(read(usersFile)))
      if (!q.getUser.get(key)) q.addUser.run(key, u.name, u.salt, u.hash, u.created || Date.now());
    for (const [tok, s] of Object.entries(read(tokensFile)))
      if (q.getUser.get(s.key) && s.exp > Date.now()) q.addSession.run(tok, s.key, s.exp);
  })();
  for (const f of [usersFile, tokensFile]) if (fs.existsSync(f)) fs.renameSync(f, f + '.migrated');
  console.log('JSON 계정 데이터를 SQLite로 옮김');
})();

// ---------- 로그인 ----------
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
function checkPw(u, pw) {
  const a = Buffer.from(hashPw(pw, u.salt), 'hex'), b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
    catch { /* Ignore malformed cookies without rejecting the connection. */ }
  }
  return out;
}

function userFromCookie(header) {
  const token = parseCookies(header).po_session;
  const row = token && q.getSession.get(token, Date.now());
  return row ? { key: row.key, name: row.name, token } : null;
}

function issueToken(res, key) {
  const token = crypto.randomBytes(24).toString('hex');
  q.purgeSessions.run(Date.now());
  q.addSession.run(token, key, Date.now() + TOKEN_TTL_MS);
  res.setHeader('Set-Cookie', `po_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TOKEN_TTL_MS / 1000}`);
}

function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > limit) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

// 로그인 관련 요청만 HTTP로 받는다 (쿠키를 심어야 하므로). 이동·채팅은 socket.io로.
const sameSecret = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

async function handleApi(req, res, pathname) {
  if (pathname === '/api/hook') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST만 가능' });
    if (!sameSecret(req.headers['x-hook-token'] || '', HOOK_TOKEN)) return json(res, 403, { error: '훅 토큰이 맞지 않아요' });
    let body;
    try { body = await readJson(req, 1024 * 1024); } catch { return json(res, 400, { error: '잘못된 요청' }); }
    return json(res, 200, { ok: applyHook(body) });
  }
  const user = userFromCookie(req.headers.cookie);
  if (pathname === '/api/me') return json(res, 200, { name: user ? user.name : null });
  if (pathname === '/api/avatar' && req.method === 'POST') {
    if (!user) return json(res, 401, { error: '로그인이 필요해요' });
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'JSON만 가능' });
    let avatar;
    try { avatar = cleanAvatar((await readJson(req, 8192)).avatar); } catch { return json(res, 400, { error: '캐릭터 데이터가 올바르지 않아요' }); }
    q.setAvatar.run(avatar ? JSON.stringify(avatar) : null, user.key);
    io.emit('avatar', { name: user.name, avatar }); // 모두의 화면에 바로 반영
    return json(res, 200, { ok: true });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST만 가능' });
  // JSON 본문만 받는다(다른 사이트의 폼 전송으로 요청을 위조하는 것을 막음)
  if (!/^application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'JSON만 가능' });
  const body = await readJson(req);

  if (pathname === '/api/signup' || pathname === '/api/login') {
    const name = String(body.username || '').trim();
    const pw = String(body.password || '');
    const key = name.toLowerCase();
    let u = q.getUser.get(key);
    if (pathname === '/api/signup') {
      if (!/^[\w가-힣]{2,16}$/.test(name)) return json(res, 400, { error: '이름은 2~16자 한글·영문·숫자·_ 만 가능해요' });
      if (pw.length < 4 || pw.length > 128) return json(res, 400, { error: '비밀번호는 4자 이상이어야 해요' });
      if (u) return json(res, 409, { error: '이미 있는 이름이에요' });
      const salt = crypto.randomBytes(16).toString('hex');
      q.addUser.run(key, name, salt, hashPw(pw, salt), Date.now());
      u = q.getUser.get(key);
    } else if (!u || !checkPw(u, pw)) {
      return json(res, 401, { error: '이름 또는 비밀번호가 틀렸어요' });
    }
    issueToken(res, key);
    return json(res, 200, { name: u.name });
  }

  if (pathname === '/api/logout') {
    if (user) {
      q.delSession.run(user.token);
      const connections = io.in(`session:${user.token}`);
      connections.emit('sessionExpired');
      connections.disconnectSockets(true);
    }
    res.setHeader('Set-Cookie', 'po_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch(() => { if (!res.headersSent) json(res, 400, { error: '잘못된 요청' }); });
    return;
  }
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^[\w.-]+$/.test(file)) { res.writeHead(404); return res.end(); }
  fs.readFile(path.join(__dirname, 'public', file), (err, body) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'text/plain';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    res.end(body);
  });
});

// ---------- 실시간: socket.io ----------
const ROOMS = ['office', 'lounge', 'meeting'];
const SPAWN = { office: { x: 180, y: 140 }, lounge: { x: 14, y: 86 }, meeting: { x: 14, y: 86 } };
const players = new Map(); // user key -> { name, room, x, y, conns, lastChat }
let playersDirty = false;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const playerList = () => [...players.values()].filter((p) => p.conns > 0)
  .map(({ name, room, x, y, act }) => ({ name, room, x, y, act: act || null }));

// 앉기·마시기 같은 동작 정보는 정해진 값만 받는다
const ANIMS = new Set(['type', 'coffee', 'soda', 'read', 'write', 'pingpong']);
const DIRS = new Set(['up', 'down', 'left', 'right']);
function cleanAct(a) {
  if (!a || typeof a !== 'object') return null;
  const sx = Number(a.sx), sy = Number(a.sy);
  return {
    id: String(a.id || '').slice(0, 16),
    a: ANIMS.has(a.a) ? a.a : null,
    p: a.p === 'sit' ? 'sit' : 'stand',
    d: DIRS.has(a.d) ? a.d : 'down',
    c: !!a.c,
    sx: Number.isFinite(sx) ? clamp(sx, 0, 240) : null,
    sy: Number.isFinite(sy) ? clamp(sy, 0, 150) : null,
  };
}
const history = () => Object.fromEntries(ROOMS.map((r) => [r, q.recent.all(r)]));

io = new Server(server); // /socket.io/socket.io.js 클라이언트 스크립트도 자동으로 제공

io.on('connection', (socket) => {
  // 소켓 연결 때 브라우저가 보낸 쿠키로 로그인 사용자를 알아낸다
  const user = userFromCookie(socket.handshake.headers.cookie);
  socket.emit('agents', snapshot());
  if (lastStats) socket.emit('stats', JSON.parse(lastStats));
  socket.emit('history', history());
  socket.emit('avatars', avatarMap());
  if (user) {
    socket.join(`session:${user.token}`);
    socket.join(`user:${user.key}`);
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

  function authenticated() {
    if (!user) return false;
    if (q.getSession.get(user.token, Date.now())) return true;
    socket.emit('sessionExpired');
    socket.disconnect(true);
    return false;
  }
  // Idle connections must also lose access when their session expires.
  const authTimer = user ? setInterval(authenticated, 1000) : null;

  // 상세 패널: 클릭한 에이전트의 긴 기록을 요청할 때만 보낸다
  socket.on('agentDetail', (id, ack) => {
    if (typeof ack !== 'function') return;
    const s = typeof id === 'string' && sessions.get(id);
    ack(s && s.lastEvent ? detailOf(s) : null);
  });

  socket.on('move', (m) => {
    if (!authenticated() || !m || !ROOMS.includes(m.room)) return;
    const x = Number(m.x), y = Number(m.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const p = players.get(user.key);
    p.room = m.room; p.x = clamp(x, 0, 240); p.y = clamp(y, 0, 150);
    p.act = cleanAct(m.act);
    // Send authoritative movement to this user's other tabs, excluding this one.
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
    if (Date.now() - (p.lastChat || 0) < 300) return ack({ error: '너무 빨라요' });
    p.lastChat = Date.now();
    const msg = { id: crypto.randomBytes(6).toString('hex'), room: p.room, name: p.name, text, t: Date.now() };
    q.addMessage.run(msg);
    io.emit('chat', msg); // 다른 방 사람도 받아서 탭에 '안 읽음' 숫자를 띄운다
    ack({ ok: true });
  });

  // 채팅 초기화: 내가 있는 방의 기록을 DB에서 지우고, 누가 지웠는지 알림 한 줄을 남긴다.
  // 알림은 name이 빈 문자열인 메시지(사용자 이름은 2글자 이상이라 사람이 흉내 낼 수 없음)
  socket.on('clearChat', (m, ack) => {
    if (typeof ack !== 'function') ack = () => {};
    if (!authenticated()) return ack({ error: '로그인이 필요해요' });
    const p = players.get(user.key);
    if (m?.room !== p.room) return ack({ error: '다른 탭에서 방이 변경됐어요. 현재 방을 확인하고 다시 시도해주세요.' });
    if (Date.now() - (p.lastClear || 0) < 3000) return ack({ error: '잠시 후 다시 시도해주세요' });
    p.lastClear = Date.now();
    const notice = { id: crypto.randomBytes(6).toString('hex'), room: p.room, name: '', text: `${p.name}님이 채팅을 초기화했어요`, t: Date.now() };
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

setInterval(() => { if (playersDirty) { playersDirty = false; io.emit('players', playerList()); } }, 100);

tick();
setInterval(tick, 1000);
server.listen(PORT, HOST, () => console.log(`Pixel Office → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));

