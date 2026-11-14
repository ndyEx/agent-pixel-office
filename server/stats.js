// 일일 통계: 에이전트 세션 기록(JSONL)을 날짜별로 집계한다.
// - 처음에는 최근 며칠치 기록을 처음부터 읽고(한 번에 읽는 양을 제한해 서버가 멈추지 않게 조금씩), 그 뒤에는 새로 붙은 줄만 이어서 읽는다.
// - 명령어·파일명 같은 내용은 저장하지 않고 횟수와 시간만 센다 → 로그인하지 않은 방문자에게 보여줘도 안전하다.
// - 세션 상태(agents/tracker.js)와는 따로 파일 위치를 기억하므로, 서버를 다시 켜도 같은 줄을 두 번 세지 않는다.
const fs = require('fs');
const path = require('path');

const CATS = ['typing', 'reading', 'terminal', 'browsing', 'meeting', 'working'];
const AGENTS = ['claude', 'codex'];
const IDLE_GAP_MS = 5 * 60 * 1000;   // 이벤트 사이가 이보다 길면 쉬는 시간으로 보고 작업 시간에서 뺀다
const LIST_EVERY_MS = 20 * 1000;     // 기록 파일 목록은 20초마다 새로 확인
const CARRY_LIMIT = 64 * 1024 * 1024; // 줄바꿈 없이 이어지는 비정상적으로 큰 줄은 버린다

const pad = (n) => String(n).padStart(2, '0');
// 서버가 켜진 컴퓨터의 현지 날짜 (YYYY-MM-DD)
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 사용자가 직접 보낸 요청인가. 도구 결과, 그리고 /model 같은 슬래시 명령·시스템 알림처럼
// 기록에 남지만 사람이 쓴 요청이 아닌 줄(<command-name>…, <local-command-…>, <system-reminder>…)은 뺀다.
function isHumanPrompt(e, content) {
  if (e.origin?.kind) return e.origin.kind === 'human'; // 요즘 기록은 출처가 적혀 있다
  if (content.some((c) => c.type === 'tool_result')) return false;
  const text = typeof e.message?.content === 'string' ? e.message.content : content.find((c) => c.type === 'text')?.text;
  return typeof text === 'string' && !!text.trim() && !text.trimStart().startsWith('<');
}

const zeroBy = () => ({ claude: 0, codex: 0 });
function emptyDay(date) {
  return {
    date,
    tools: zeroBy(),
    turns: zeroBy(),
    activeMs: zeroBy(),
    cats: Object.fromEntries(CATS.map((c) => [c, 0])),
    hours: { claude: new Array(24).fill(0), codex: new Array(24).fill(0) },
    sessions: { claude: new Set(), codex: new Set() },
  };
}
function serialize(day, date) {
  const d = day || emptyDay(date);
  return {
    date: d.date, tools: d.tools, turns: d.turns, activeMs: d.activeMs, cats: d.cats, hours: d.hours,
    sessions: { claude: d.sessions.claude.size, codex: d.sessions.codex.size },
  };
}

/**
 * @param {object} o
 * @param {(name: string) => string} o.classifyClaude         Claude 도구 이름 → 'typing' | 'reading' | …
 * @param {(payload: object) => string} o.classifyCodexCall    Codex *_call 기록 → 같은 분류
 * @param {() => Array<{path: string, agent: 'claude'|'codex', isSub?: boolean}>} o.listFiles  집계할 기록 파일 후보
 */
function createStats({ classifyClaude, classifyCodexCall, listFiles, now = Date.now, keepDays = 7, budget = 8 * 1024 * 1024, chunk = 1024 * 1024 }) {
  const days = new Map();
  // 세션 파일 이름(에이전트:파일명) → 읽기 상태. 경로가 아니라 이름으로 기억해야, 앱이 기록 파일을
  // 다른 폴더로 옮기거나 같은 파일이 두 곳에 있어도 처음부터 다시 세지 않는다.
  const files = new Map();
  let listed = [], lastList = -Infinity;
  let cutKey = ''; // 이 날짜보다 오래된 이벤트는 버린다 (update마다 한 번만 계산)

  const cutoffMs = () => { const d = new Date(now()); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (keepDays - 1)); return d.getTime(); };
  const cutoffKey = () => dayKey(cutoffMs());
  const dayFor = (key) => { let d = days.get(key); if (!d) { d = emptyDay(key); days.set(key, d); } return d; };

  // 세션 하나의 이벤트 시각이 이어지는 동안(IDLE_GAP 이내)만 작업 시간으로 센다. 서브에이전트는 부모와 겹쳐 돌아가므로 시간은 세지 않는다.
  function touch(f, ts, day) {
    if (!f.isSub && day && f.lastTs && ts > f.lastTs && ts - f.lastTs <= IDLE_GAP_MS) day.activeMs[f.agent] += ts - f.lastTs;
    if (ts > f.lastTs) f.lastTs = ts;
  }
  const countTool = (day, f, ts, cat) => {
    day.tools[f.agent]++;
    day.cats[CATS.includes(cat) ? cat : 'working']++;
    day.hours[f.agent][new Date(ts).getHours()]++;
  };

  function readClaudeLine(f, line) {
    // 메타 줄(api-request 등)은 아주 클 수 있으니 파싱하지 않고 건너뛴다
    if (line.startsWith('{"type":"') && !line.startsWith('{"type":"assistant"') && !line.startsWith('{"type":"user"')) return;
    let e;
    try { e = JSON.parse(line); } catch { return; }
    if (e.type !== 'assistant' && e.type !== 'user') return;
    // 포크·사이드 채팅은 원래 대화 기록을 복사해 두므로, 다른 세션의 줄은 이 세션이 한 일이 아니다
    if (!f.isSub && e.sessionId && e.sessionId !== f.ownId) return;
    const ts = Date.parse(e.timestamp);
    if (!ts) return;
    const key = dayKey(ts), day = key >= cutKey ? dayFor(key) : null;
    touch(f, ts, day);
    if (!day) return;
    if (!f.isSub) day.sessions.claude.add(f.ownId);
    const content = Array.isArray(e.message?.content) ? e.message.content : [];
    if (e.type === 'assistant') {
      for (const c of content) if (c.type === 'tool_use') countTool(day, f, ts, classifyClaude(c.name));
    } else if (!f.isSub && !e.isMeta && isHumanPrompt(e, content)) day.turns.claude++;
  }

  const CODEX_HEAD = /"type":"(response_item|event_msg)","payload":\{"type":"([a-z_]+)"/;
  function readCodexLine(f, line) {
    const ts0 = /^\{"timestamp":"([^"]+)"/.exec(line);
    if (!ts0) return;
    const m = CODEX_HEAD.exec(line.slice(0, 220));
    if (!m) return;
    const [, kind, type] = m;
    // Codex 앱은 다른 에이전트(Claude 등)의 대화를 가져와 세션을 만들기도 한다. 가져온 턴은
    // turn_id가 external-import-…이고 Codex가 한 일이 아니므로, 다음 진짜 턴이 시작될 때까지 세지 않는다.
    if (kind === 'event_msg' && type === 'task_started') f.importing = line.includes('"turn_id":"external-import');
    if (f.importing) return;
    const ts = Date.parse(ts0[1]);
    if (!ts) return;
    const key = dayKey(ts), day = key >= cutKey ? dayFor(key) : null;
    touch(f, ts, day);
    if (!day) return;
    day.sessions.codex.add(f.id);
    if (kind === 'event_msg' && type === 'task_started') day.turns.codex++; // 턴 하나 = task_started 한 번
    if (kind === 'response_item' && type.endsWith('_call')) {
      try { countTool(day, f, ts, classifyCodexCall(JSON.parse(line).payload)); } catch { countTool(day, f, ts, 'working'); }
    }
  }

  function consume(f, text) {
    const read = f.agent === 'codex' ? readCodexLine : readClaudeLine;
    for (const line of text.split('\n')) if (line) read(f, line);
  }

  function refreshList(t) {
    lastList = t;
    const since = cutoffMs();
    // 같은 세션 파일(이름이 같은 파일)이 여러 곳에 있으면 하나로 본다
    const byId = new Map();
    for (const c of listFiles()) {
      let mtime;
      try { mtime = fs.statSync(c.path).mtimeMs; } catch { continue; }
      if (mtime < since) continue;
      // 서브에이전트 기록(<세션>/subagents/<이름>.jsonl)은 이름이 세션마다 겹칠 수 있어 부모 세션까지 붙인다
      const id = `${c.agent}:${c.isSub ? `${path.basename(path.dirname(path.dirname(c.path)))}/` : ''}${path.basename(c.path)}`;
      if (!byId.has(id)) byId.set(id, { c, mtime, paths: new Set() });
      byId.get(id).paths.add(c.path);
    }
    listed = [];
    for (const [id, { c, mtime, paths }] of byId) {
      let f = files.get(id);
      if (!f) {
        f = { id, path: c.path, agent: c.agent, isSub: !!c.isSub, ownId: path.basename(c.path, '.jsonl'), offset: 0, carry: Buffer.alloc(0), lastTs: 0, size: 0, mtime };
        files.set(id, f);
      } else if (!paths.has(f.path)) f.path = c.path; // 앱이 파일을 옮겼으면 새 위치에서, 읽던 자리부터 이어간다
      f.mtime = mtime;
      listed.push(f);
    }
    for (const id of [...files.keys()]) if (!byId.has(id)) files.delete(id); // 삭제·오래된 파일은 잊는다 (이미 센 값은 남음)
  }

  /** 1초마다 불러 준다. 새로 읽은 게 있으면 true */
  function update() {
    const t = now();
    cutKey = cutoffKey();
    if (t - lastList >= LIST_EVERY_MS) refreshList(t);
    let left = budget, changed = false;
    const todo = [];
    for (const f of listed) {
      try { f.size = fs.statSync(f.path).size; } catch { continue; }
      if (f.size < f.offset) { f.offset = f.size; f.carry = Buffer.alloc(0); } // 파일이 줄어들면 다시 세지 않고 끝에서 이어감
      if (f.size > f.offset) todo.push(f);
    }
    todo.sort((a, b) => b.mtime - a.mtime); // 오늘 기록부터 먼저
    for (const f of todo) {
      if (left <= 0) break;
      let fd;
      try { fd = fs.openSync(f.path, 'r'); } catch { continue; }
      try {
        while (left > 0 && f.offset < f.size) {
          const want = Math.min(chunk, f.size - f.offset, left);
          const buf = Buffer.alloc(want);
          const len = fs.readSync(fd, buf, 0, want, f.offset);
          if (!len) break;
          f.offset += len; left -= len; changed = true;
          const all = f.carry.length ? Buffer.concat([f.carry, buf.subarray(0, len)]) : buf.subarray(0, len);
          const nl = all.lastIndexOf(10);
          if (nl < 0) { f.carry = all.length > CARRY_LIMIT ? Buffer.alloc(0) : Buffer.from(all); continue; }
          f.carry = Buffer.from(all.subarray(nl + 1));
          consume(f, all.subarray(0, nl).toString('utf8'));
        }
      } finally { fs.closeSync(fd); }
    }
    return changed;
  }

  function snapshot() {
    const t = now(), keep = cutoffKey();
    for (const k of [...days.keys()]) if (k < keep) days.delete(k);
    const out = [];
    for (let i = keepDays - 1; i >= 0; i--) {
      const d = new Date(t); d.setDate(d.getDate() - i);
      const key = dayKey(d.getTime());
      out.push(serialize(days.get(key), key));
    }
    let total = 0, done = 0;
    for (const f of listed) { total += f.size; done += Math.min(f.offset, f.size); }
    return { today: dayKey(t), days: out, scanning: total > done, progress: total ? done / total : 1 };
  }

  return { update, snapshot };
}

module.exports = { createStats, dayKey, CATS, AGENTS };
