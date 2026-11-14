// Pixel Office 서버 진입점 (`npm start`)
// Claude Code·Codex 세션 기록을 감시해서 에이전트 상태를 픽셀 사무실로 실시간 전송한다.
// 구조 설명은 ARCHITECTURE.md, 실제 조립은 server/app.js 에 있다.
const { loadConfig } = require('./server/config');
const { createApp } = require('./server/app');

createApp(loadConfig()).start();
