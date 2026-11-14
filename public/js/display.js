// 화면 표시 규칙: 상태 이름·색, 에이전트 종류 칩, 칭호. 캔버스와 HTML 패널이 같이 쓴다.

// 상태 → 이름과 색 (서버 server/agents/classify.js의 상태와 짝)
export const STATE_INFO = {
  typing:   { label: '타이핑',   color: '#7bd88f' },
  reading:  { label: '자료 조사', color: '#f5c26b' },
  terminal: { label: '터미널',   color: '#ff9e64' },
  browsing: { label: '브라우징', color: '#7aa2f7' },
  meeting:  { label: '회의',     color: '#bb9af7' },
  working:  { label: '작업 중',  color: '#7dcfff' },
  thinking: { label: '생각 중',  color: '#c0caf5' },
  waiting:  { label: '승인 대기', color: '#ff5c7a' },
  idle:     { label: '휴식',     color: '#6b7089' },
};
export const stateInfo = (state) => STATE_INFO[state] || STATE_INFO.working;

// 승인 대기는 확실할 때(Codex 이벤트·Claude 훅)와 침묵 시간으로 추정할 때 이름을 다르게
export const stateLabel = (d) => (d.state === 'waiting' && !d.waitExact ? '대기(승인?)' : stateInfo(d.state).label);

// 에이전트 종류 칩 (Claude 칩은 그 세션 머리띠 색으로 칠해 화면 속 캐릭터와 짝을 맞춘다)
export const KIND_CHIP = {
  claude: { label: 'Claude', bg: '#d97757', fg: '#1b1d2a' },
  codex:  { label: 'Codex',  bg: '#e6e6f0', fg: '#111318' },
};

// 칭호: 서브에이전트는 '조수', 나머지는 이 세션에서 쓴 도구 횟수로
export function titleFor(d) {
  if (d.isSub) return '🧩 조수';
  const n = d.tools || 0;
  if (n >= 300) return '👑 전설';
  if (n >= 120) return '🏅 베테랑';
  if (n >= 40) return '⚡ 숙련';
  if (n >= 10) return '🌱 신입';
  return '🐣 인턴';
}

// 이름표용 짧은 이름 (한글도 글자 단위로 자른다)
const NAME_MAX = 8;
export const shortName = (s = '') => { const c = [...s.trim()]; return c.length > NAME_MAX ? c.slice(0, NAME_MAX - 1).join('') + '…' : c.join(''); };
