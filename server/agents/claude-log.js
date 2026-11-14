// Claude Code 세션 기록(~/.claude/projects/<프로젝트>/<세션>.jsonl) 한 줄을 읽어 세션 상태를 바꾼다.
// 기록 형식: 한 줄 = JSON 하나. type이 assistant(도구 호출·답변) / user(요청·도구 결과) / summary 등.
const path = require('path');
const { classifyTool, toolLabel } = require('./classify');
const { pushLog } = require('./session');

// 사람이 직접 보낸 요청인가 (명령·시스템 안내는 '<'로 시작하는 글이라 뺀다). 내용은 쓰지 않는다.
function isPrompt(content) {
  const parts = typeof content === 'string' ? [content]
    : Array.isArray(content) ? content.filter((x) => x.type === 'text').map((x) => x.text || '') : [];
  return parts.some((t) => t.trim() && !t.trim().startsWith('<') && !t.trim().startsWith('[Request interrupted'));
}

// 포크·사이드 채팅은 원래 대화 기록을 그대로 복사해 둔다(sessionId가 원본 것). 이 세션이 한 일이 아니므로 뺀다.
const isCopied = (s, e) => !s.isSub && e.sessionId && e.sessionId !== s.ownId;

/**
 * 기록 한 줄을 세션 상태에 반영한다.
 * @param live false면 서버가 처음 켜질 때 지난 기록을 읽는 중 (목록 카드 로그에는 남기지 않음)
 */
function applyClaudeEntry(s, e, live) {
  const ts = e.timestamp ? Date.parse(e.timestamp) : Date.now();
  if (e.type === 'agent-name' && e.agentName) s.title = e.agentName;
  // 프로젝트 이름: 폴더 이름(경로의 /를 -로 바꾼 것)은 어디서 끊을지 모르므로, 기록에 남은 실제 작업 폴더(cwd)를 쓴다
  if (typeof e.cwd === 'string' && e.cwd) { s.cwd = e.cwd; s.project = path.basename(e.cwd.replace(/[\\/]+$/, '')).slice(-32); }
  if (e.type === 'summary' && e.summary && s.title.length <= 8) s.title = e.summary;
  if (isCopied(s, e)) return;

  if (e.type === 'assistant' && e.message) {
    s.lastEvent = ts;
    const content = Array.isArray(e.message.content) ? e.message.content : [];
    const uses = content.filter((c) => c.type === 'tool_use');
    const last = uses[uses.length - 1];
    for (const u of uses) {
      const kind = classifyTool(u.name);
      s.byState[kind] = (s.byState[kind] || 0) + 1;
      if (u !== last) pushLog(s, toolLabel(u.name), ts, live); // 한 번에 여러 도구를 부른 경우
    }
    if (last) {
      s.state = classifyTool(last.name);
      s.detail = toolLabel(last.name);
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
    s.hookWait = false; // 사용자가 승인·거절했거나 새 요청을 보냄
    s.state = 'thinking';
    s.detail = isToolResult ? '결과 확인 중…' : '새 요청을 받음';
    if (!isToolResult && !e.isMeta && isPrompt(c)) pushLog(s, '✉ 사용자 요청', ts, live);
  }
}

// 파일 앞부분(끝부분만 읽고 건너뛴 곳)의 도구 사용 횟수를 셀 때 쓰는 한 줄 계산
function countClaudeTools(s, line) {
  if (!line.includes('"tool_use"')) return 0;
  try {
    const e = JSON.parse(line);
    if (e.type !== 'assistant' || isCopied(s, e)) return 0;
    return (Array.isArray(e.message?.content) ? e.message.content : []).filter((c) => c.type === 'tool_use').length;
  } catch { return 0; } // 잘린 줄
}

module.exports = { applyClaudeEntry, countClaudeTools };
