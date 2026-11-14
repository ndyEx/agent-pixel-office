// 에이전트 세션 추적기: 세션 기록 파일을 찾아 새로 붙은 줄만 이어 읽고, 세션 목록을 관리한다.
//
//   update()   1초마다 불린다. 새 파일을 찾고, 기존 파일의 새 줄을 읽고, 오래된 세션을 지운다.
//   snapshot() 브라우저로 보낼 세션 목록 (보안 처리된 공개 데이터)
//   detail(id) 상세 패널용 데이터
//   applyHook(body)  Claude Code 훅 이벤트 반영
const fs = require('fs');
const path = require('path');
const { createSession, toPublic, toPublicDetail } = require('./session');
const { applyClaudeEntry, countClaudeTools } = require('./claude-log');
const { applyCodexEntry, countCodexTools, createCodexNames } = require('./codex-log');
const { applyHookEvent } = require('./hooks');

const ACTIVE_WINDOW_MS = 30 * 60 * 1000;      // 최근 30분 안에 바뀐 기록만 본다
const INITIAL_TAIL_BYTES = 256 * 1024;        // 처음 발견한 파일은 끝부분만 읽는다
const HEAD_COUNT_LIMIT = 64 * 1024 * 1024;    // 건너뛴 앞부분에서 도구 횟수를 셀 때 최대로 읽는 양
const CODEX_STATUS_DAYS = 2;                  // Codex 기록은 날짜별 폴더 중 최근 이틀치만 본다

const LOG_READERS = {
  claude: { apply: applyClaudeEntry, countTools: countClaudeTools },
  codex: { apply: applyCodexEntry, countTools: countCodexTools },
};

function createTracker({ claudeRoot, codexRoot }) {
  /** 기록 파일 경로 → 세션 상태 */
  const sessions = new Map();
  const codexNames = createCodexNames(path.join(path.dirname(codexRoot), 'session_index.jsonl'));
  const titleOf = (s) => (s.agent === 'codex' ? codexNames.titleFor(s) : s.title);

  // ---------- 기록 파일 찾기 ----------
  // Claude: <claudeRoot>/<프로젝트>/<세션>.jsonl, 서브에이전트는 <프로젝트>/<세션>/subagents/*.jsonl
  function listClaudeFiles() {
    const out = [];
    let projects = [];
    try { projects = fs.readdirSync(claudeRoot); } catch { return out; }
    for (const p of projects) {
      const dir = path.join(claudeRoot, p);
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const ent of entries) {
        if (ent.isFile() && ent.name.endsWith('.jsonl')) out.push(path.join(dir, ent.name));
        if (ent.isDirectory()) {
          const sub = path.join(dir, ent.name, 'subagents');
          try { for (const f of fs.readdirSync(sub)) if (f.endsWith('.jsonl')) out.push(path.join(sub, f)); } catch { /* 서브에이전트 없음 */ }
        }
      }
    }
    return out;
  }

  // Codex: <codexRoot>/YYYY/MM/DD/*.jsonl 중 최근 며칠치
  function listCodexFiles(days = CODEX_STATUS_DAYS) {
    const out = [];
    for (let back = 0; back < days; back++) {
      const d = new Date(Date.now() - back * 86400000);
      const dir = path.join(codexRoot, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
      try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) out.push(path.join(dir, f)); } catch { /* 없음 */ }
    }
    return out;
  }

  // ---------- 이어 읽기 ----------
  // 처음 발견한 파일은 끝부분만 읽으므로, 건너뛴 앞부분의 도구 사용 횟수는 따로 센다 (칭호가 서버 재시작에 흔들리지 않게)
  function countSkippedTools(file, end, s) {
    const limit = Math.min(end, HEAD_COUNT_LIMIT);
    const fd = fs.openSync(file, 'r');
    const chunk = Buffer.alloc(4 * 1024 * 1024);
    let pos = 0, rest = '', n = 0;
    try {
      while (pos < limit) {
        const len = fs.readSync(fd, chunk, 0, Math.min(chunk.length, limit - pos), pos);
        if (!len) break;
        pos += len;
        const lines = (rest + chunk.toString('utf8', 0, len)).split('\n');
        rest = lines.pop();
        for (const line of lines) n += LOG_READERS[s.agent].countTools(s, line);
      }
    } finally { fs.closeSync(fd); }
    return n;
  }

  /** 지난번에 읽은 곳(s.offset) 이후의 새 줄을 읽어 상태에 반영한다 */
  function readNew(file, s, live) {
    let stat;
    try { stat = fs.statSync(file); } catch { return false; }
    if (stat.size < s.offset) { s.offset = 0; s.partial = ''; } // 파일이 잘렸으면 처음부터
    if (stat.size === s.offset) return false;
    const firstRead = s.offset === 0 && !live;
    const start = firstRead ? Math.max(0, stat.size - INITIAL_TAIL_BYTES) : s.offset;
    if (firstRead && start > 0) s.tools += countSkippedTools(file, start, s);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    s.offset = stat.size;
    const lines = (s.partial + buf.toString('utf8')).split('\n');
    s.partial = lines.pop(); // 아직 줄바꿈이 안 붙은 마지막 줄은 다음에
    if (firstRead && start > 0) lines.shift(); // 중간부터 읽었으면 첫 줄은 잘렸을 수 있음
    const apply = LOG_READERS[s.agent].apply;
    for (const line of lines) {
      if (!line.trim()) continue;
      try { apply(s, JSON.parse(line), live); } catch { /* 깨진 줄 무시 */ }
    }
    return true;
  }

  function addSession(file, agent) {
    const s = createSession(file, agent);
    sessions.set(file, s);
    readNew(file, s, false);
    return s;
  }

  // ---------- 공개 API ----------
  function update() {
    const now = Date.now();
    codexNames.reload();
    const files = [...listClaudeFiles().map((f) => [f, 'claude']), ...listCodexFiles().map((f) => [f, 'codex'])];
    for (const [file, agent] of files) {
      let mtime;
      try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
      if (now - mtime > ACTIVE_WINDOW_MS) continue;
      const s = sessions.get(file);
      if (s) readNew(file, s, true); else addSession(file, agent);
    }
    // 앱에서 세션을 삭제·보관하면 기록 파일이 사라지거나 옮겨지므로 바로 퇴근 처리
    for (const file of sessions.keys()) {
      let mtime = 0;
      try { mtime = fs.statSync(file).mtimeMs; } catch { /* 삭제됨 */ }
      if (!mtime || now - mtime > ACTIVE_WINDOW_MS) sessions.delete(file);
    }
  }

  function snapshot() {
    const now = Date.now();
    return [...sessions.values()]
      .filter((s) => s.lastEvent && now - s.lastEvent < ACTIVE_WINDOW_MS) // 자기 활동이 최근에 있는 세션만
      .map((s) => toPublic(s, titleOf(s), now))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function detail(publicId) {
    const s = [...sessions.values()].find((x) => x.publicId === publicId);
    return s && s.lastEvent ? toPublicDetail(s, titleOf(s)) : null;
  }

  /** @returns {boolean} 반영했으면 true */
  function applyHook(h) {
    const file = typeof h?.transcript_path === 'string' ? path.resolve(h.transcript_path) : '';
    if (!file.startsWith(claudeRoot + path.sep) || !file.endsWith('.jsonl')) return false; // 세션 기록 폴더 밖은 읽지 않는다
    let s = sessions.get(file);
    if (!s) {
      if (!fs.existsSync(file)) return false;
      s = addSession(file, 'claude');
    } else readNew(file, s, true); // 훅보다 늦게 읽힌 기록 줄이 대기 상태를 덮어쓰지 않게 먼저 따라잡는다
    applyHookEvent(s, h);
    return true;
  }

  return { update, snapshot, detail, applyHook, listClaudeFiles, listCodexFiles };
}

module.exports = { createTracker };
