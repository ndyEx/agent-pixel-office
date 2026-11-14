// 도구 이름 → 사무실 속 행동(상태) 분류.
// 상태 표시(tracker)와 일일 통계(stats.js)가 같은 기준을 쓰도록 여기 한곳에 둔다.
//
// 상태: typing(책상에서 타이핑) reading(책장) terminal(서버랙) browsing(파란 모니터)
//       meeting(회의 테이블) working(그 밖의 도구)

function classifyTool(name = '') {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return 'typing';
  if (/^(Read|Grep|Glob|LS)$/.test(name)) return 'reading';
  if (/^(Bash|Monitor|BashOutput|KillShell)$/.test(name) || /terminal/i.test(name)) return 'terminal';
  if (/^(WebFetch|WebSearch)$/.test(name) || /Browser|chrome/i.test(name)) return 'browsing';
  if (/^(Agent|Task|SendMessage)$/.test(name) || /start_session/.test(name)) return 'meeting';
  return 'working';
}

// Codex 도구 호출은 이름(shell, apply_patch …) 또는 JS 래퍼(exec) 안의 tools.xxx 호출로 기록된다.
// 인자(text)는 분류에만 쓰고 화면으로는 보내지 않는다.
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

// Codex *_call 기록에서 도구 이름과 인자 문자열을 꺼낸다
function codexCallParts(p) {
  const name = p.name || p.type.replace(/_call$/, '');
  const text = typeof p.input === 'string' ? p.input : typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.action || p.input || {});
  return { name, text };
}

// 화면에 보여 줄 도구 이름. "mcp__서버이름__도구" 는 도구 부분만 남긴다.
// 🔒 명령어·파일 경로 같은 인자는 절대 붙이지 않는다 (README "한계" 참고).
const toolLabel = (name = '') => String(name).replace(/^mcp__.+?__/, '').slice(0, 40);

module.exports = { classifyTool, classifyCodex, codexCallParts, toolLabel };
