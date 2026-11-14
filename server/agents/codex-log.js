// Codex 세션 기록(~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) 한 줄을 읽어 세션 상태를 바꾼다.
// Codex는 승인 요청을 기록에 명시적으로 남기므로 승인 대기를 추정 없이 정확하게 안다.
const fs = require('fs');
const path = require('path');
const { classifyCodex, codexCallParts, toolLabel } = require('./classify');
const { pushLog } = require('./session');

// 화면용 도구 이름: exec 래퍼 안의 tools.xxx 가 있으면 그 이름. 🔒 명령어 내용은 쓰지 않는다.
function describeCodex(name, text) {
  const inner = (text.match(/tools\.(\w+)/) || [])[1];
  return toolLabel(inner || name);
}

function applyCodexEntry(s, e, live) {
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
    pushLog(s, s.detail, ts, live);
  }
  if (e.type === 'response_item' && /call_output$/.test(p.type || '')) {
    s.lastEvent = ts; s.state = 'thinking'; s.detail = '결과 확인 중…';
  }
  if (e.type !== 'event_msg') return;

  switch (p.type) {
    case 'user_message':
      s.lastEvent = ts; s.state = 'thinking'; s.detail = '새 요청을 받음';
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
      if (/approval_request/.test(p.type || '')) {
        s.lastEvent = ts; s.state = 'waiting'; s.detail = '사용자 승인 대기 중';
        pushLog(s, '❗ 승인 요청', ts, live);
      }
  }
}

// 파일 앞부분의 도구 사용 횟수를 셀 때 쓰는 한 줄 계산
function countCodexTools(s, line) {
  if (!line.includes('_call"')) return 0;
  try { const e = JSON.parse(line); return e.type === 'response_item' && /call$/.test(e.payload?.type || '') ? 1 : 0; }
  catch { return 0; } // 잘린 줄
}

// Codex 앱 사이드바의 스레드 이름은 ~/.codex/session_index.jsonl 에 저장된다 (세션 id → thread_name).
// 파일이 바뀌었을 때만 다시 읽는다.
function createCodexNames(indexFile) {
  let names = new Map();
  let mtime = 0;
  return {
    reload() {
      try {
        const st = fs.statSync(indexFile);
        if (st.mtimeMs === mtime) return;
        mtime = st.mtimeMs;
        const m = new Map();
        for (const line of fs.readFileSync(indexFile, 'utf8').split('\n')) {
          try { const e = JSON.parse(line); if (e.id && e.thread_name) m.set(e.id, e.thread_name); } catch { /* 깨진 줄 */ }
        }
        names = m;
      } catch { /* 인덱스 없음 */ }
    },
    titleFor(s) {
      const id = (path.basename(s.id).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/) || [])[1];
      return (id && names.get(id)) || 'Codex 세션';
    },
  };
}

module.exports = { applyCodexEntry, countCodexTools, createCodexNames };
