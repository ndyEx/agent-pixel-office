// Pixel Office — Claude Code 세션 기록(JSONL)을 감시해서 상태를 브라우저로 스트리밍하는 서버
// 의존성 없음: node server.js 로 실행
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 4321;
const ROOT = path.join(os.homedir(), '.claude', 'projects');
const CODEX_ROOT = process.env.CODEX_SESSIONS || path.join(os.homedir(), '.codex', 'sessions');
const ACTIVE_WINDOW_MS = 30 * 60 * 1000; // 최근 30분 내 수정된 세션만 표시
const INITIAL_TAIL_BYTES = 256 * 1024;   // 처음 발견한 파일은 끝부분만 읽음

/** file path -> session state */
const sessions = new Map();
const clients = new Set();

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
  return name.replace(/^mcp__[^_]+__/, '');
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
    log: [],
  };
}

function pushLog(s, text) {
  s.log.push({ t: Date.now(), text });
  if (s.log.length > 6) s.log.shift();
}

function applyEntry(s, e, live) {
  const ts = e.timestamp ? Date.parse(e.timestamp) : Date.now();
  if (e.type === 'agent-name' && e.agentName) s.title = e.agentName;
  if (e.type === 'summary' && e.summary && s.title.length <= 8) s.title = e.summary;
  // 포크·사이드 채팅은 원래 대화 기록을 그대로 복사해 둔다(sessionId가 원본 것).
  // 복사된 기록은 이 세션이 한 일이 아니므로 상태 계산에서 뺀다.
  if (!s.isSub && e.sessionId && e.sessionId !== s.ownId) return;
  if (e.type === 'assistant' && e.message) {
    s.lastEvent = ts;
    const content = Array.isArray(e.message.content) ? e.message.content : [];
    const tool = [...content].reverse().find((c) => c.type === 'tool_use');
    if (tool) {
      s.state = classifyTool(tool.name);
      s.detail = describeTool(tool.name, tool.input);
      s.tools++;
      if (live) pushLog(s, s.detail);
    } else if (e.message.stop_reason === 'end_turn') {
      s.state = 'idle';
      s.detail = '작업 완료 — 다음 요청 대기';
      if (live) pushLog(s, '✔ 턴 종료');
    } else {
      s.state = 'thinking';
      s.detail = '생각 중…';
    }
  }
  if (e.type === 'user' && e.message) {
    s.lastEvent = ts;
    const c = e.message.content;
    const isToolResult = Array.isArray(c) && c.some((x) => x.type === 'tool_result');
    s.state = 'thinking';
    s.detail = isToolResult ? '결과 확인 중…' : '새 요청을 받음';
    if (!isToolResult && live) pushLog(s, '✉ 사용자 요청');
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

function applyCodex(s, e, live) {
  const ts = e.timestamp ? Date.parse(e.timestamp) : Date.now();
  const p = e.payload || {};
  if (e.type === 'session_meta' && p.cwd) s.project = path.basename(p.cwd).slice(-32);
  if (e.type === 'turn_context' && p.cwd) s.project = path.basename(p.cwd).slice(-32);
  if (e.type === 'response_item' && /call$/.test(p.type || '')) {
    const name = p.name || p.type.replace(/_call$/, '');
    const text = typeof p.input === 'string' ? p.input : typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.action || p.input || {});
    s.lastEvent = ts; s.tools++;
    s.state = classifyCodex(name, text);
    s.detail = describeCodex(name, text);
    if (live) pushLog(s, s.detail);
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
      if (!s.firstMessage && p.message) s.firstMessage = cleanCodexText(p.message);
      if (live) pushLog(s, '✉ 사용자 요청');
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
      if (live) pushLog(s, '✔ 턴 종료');
      break;
    default:
      // Codex는 승인 요청을 명시적으로 기록하므로 추정 없이 정확하게 알 수 있다
      if (/approval_request/.test(p.type || '')) {
        s.lastEvent = ts; s.state = 'waiting'; s.detail = '사용자 승인 대기 중';
        if (live) pushLog(s, '❗ 승인 요청');
      }
  }
}

function readNew(file, s, live) {
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (stat.size < s.offset) { s.offset = 0; s.partial = ''; } // 파일이 잘렸으면 처음부터
  if (stat.size === s.offset) return false;
  const start = s.offset === 0 && !live ? Math.max(0, stat.size - INITIAL_TAIL_BYTES) : s.offset;
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

// Codex 세션: 날짜별 폴더 중 최근 이틀치만 본다
function listCodexJsonl() {
  const out = [];
  for (const back of [0, 1]) {
    const d = new Date(Date.now() - back * 86400000);
    const dir = path.join(CODEX_ROOT, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) out.push(path.join(dir, f)); } catch { /* 없음 */ }
  }
  return out;
}

function snapshot() {
  const now = Date.now();
  return [...sessions.values()]
    .filter((s) => s.lastEvent && now - s.lastEvent < ACTIVE_WINDOW_MS) // 자기 활동이 최근에 있는 세션만
    .map((s) => {
      let state = s.state;
      const quiet = now - s.lastEvent;
      // 도구 호출 후 한참 응답이 없으면 권한 승인 등을 기다리는 중일 가능성이 큼
      // Claude는 승인 대기가 기록되지 않아 침묵 시간으로 추정, Codex는 명시적 이벤트 사용
      if (s.agent === 'claude' && state !== 'idle' && state !== 'thinking' && quiet > 45_000) state = 'waiting';
      if (state === 'thinking' && quiet > 120_000) state = 'idle';
      return { id: s.id, agent: s.agent, title: s.agent === 'codex' ? codexTitle(s) : s.title, project: s.project, isSub: s.isSub, state, detail: s.detail,
        lastEvent: s.lastEvent, tools: s.tools, log: s.log };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

let lastSent = '';
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
  const data = JSON.stringify(snapshot());
  if (data !== lastSent) {
    lastSent = data;
    for (const res of clients) res.write(`data: ${data}\n\n`);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const file = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!/^[\w.-]+$/.test(file)) { res.writeHead(404); return res.end(); }
  fs.readFile(path.join(__dirname, 'public', file), (err, body) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'text/plain';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    res.end(body);
  });
});

tick();
setInterval(tick, 1000);
server.listen(PORT, '127.0.0.1', () => console.log(`Pixel Office → http://localhost:${PORT}`));
