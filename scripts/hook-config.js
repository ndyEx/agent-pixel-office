// Claude Code 설정(~/.claude/settings.json)에 붙여 넣을 hooks 블록을 출력한다
//   npm run hook-config            → 기본 포트(4321)
//   PORT=5000 npm run hook-config  → 다른 포트로 서버를 띄운 경우
const path = require('path');

const port = process.env.PORT || '4321';
const script = path.resolve(__dirname, '..', 'hooks', 'claude-hook.sh');
const env = port === '4321' ? '' : `PIXEL_OFFICE_URL=http://127.0.0.1:${port} `;
const command = `${env}sh ${JSON.stringify(script)}`;
// UserPromptSubmit: 이 세션이 훅으로 연결됐음을 알림 / Notification·PermissionRequest: 승인 대기 / Stop: 턴 종료
const EVENTS = ['UserPromptSubmit', 'Notification', 'PermissionRequest', 'Stop'];
const hooks = Object.fromEntries(EVENTS.map((e) => [e, [{ hooks: [{ type: 'command', command, timeout: 5 }] }]]));

console.log(JSON.stringify({ hooks }, null, 2));
console.error(`\n↑ 이 내용을 ~/.claude/settings.json 의 "hooks" 에 합쳐 넣으세요. (이미 hooks가 있으면 이벤트별 배열에 항목을 추가)
  훅 토큰은 서버를 처음 실행할 때 data/hook-token 에 만들어집니다.`);
