// Claude Code 훅 이벤트 → 세션 상태.
// Claude Code는 승인 대기를 기록(JSONL)에 남기지 않는다. 훅(Notification·PermissionRequest 등)이
// hooks/claude-hook.sh 를 거쳐 POST /api/hook 으로 보내 주는 이벤트로 정확히 안다.
// 훅 설정은 `npm run hook-config` 가 만들어 준다.
const { toolLabel } = require('./classify');
const { pushLog } = require('./session');

// 승인(또는 사용자 선택)을 기다리게 됐다는 이벤트인가
function isPermissionEvent(h) {
  const ev = String(h.hook_event_name || ''), nt = String(h.notification_type || '');
  if (ev === 'PermissionRequest') return true;
  if (ev !== 'Notification') return false;
  if (nt) return nt === 'permission_prompt' || nt === 'elicitation_dialog';
  return /permission/i.test(String(h.message || '')); // notification_type이 없는 예전 버전
}

// 대기가 끝났다는 이벤트
const RESUME_EVENTS = new Set(['PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Stop', 'SessionEnd']);

/** 훅 이벤트 하나를 세션 상태에 반영한다 */
function applyHookEvent(s, h, now = Date.now()) {
  s.hooked = true;
  if (isPermissionEvent(h)) {
    // 🔒 알림 문구에는 작업 내용이 섞일 수 있어 그대로 쓰지 않고, 도구 이름만 뽑는다
    const tool = toolLabel(typeof h.tool_name === 'string' ? h.tool_name : (String(h.message || '').match(/permission to use (\S+)/i) || [])[1] || '');
    const text = tool ? `${tool} 승인 요청` : '사용자 승인 대기 중';
    if (!s.hookWait) pushLog(s, `❗ ${text}`, now, true);
    s.hookWait = true; s.waitDetail = text;
    s.state = 'waiting'; s.detail = text; s.lastEvent = now;
  } else if (RESUME_EVENTS.has(String(h.hook_event_name || '')) && s.hookWait) {
    s.hookWait = false;
    if (s.state === 'waiting') { s.state = 'thinking'; s.detail = '결과 확인 중…'; }
  }
}

module.exports = { applyHookEvent };
