// 서버 설정: 환경변수와 기본 경로를 한곳에서 정한다.
// 테스트는 이 값을 직접 만들어 createApp()에 넘긴다 (임시 폴더·메모리 DB 등).
const os = require('os');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

function loadConfig(env = process.env, home = os.homedir()) {
  return {
    port: Number(env.PORT || 4321),
    host: env.HOST || '127.0.0.1',                       // 기본은 이 컴퓨터에서만 접속 가능
    claudeRoot: path.join(home, '.claude', 'projects'),  // Claude Code 세션 기록
    codexRoot: env.CODEX_SESSIONS || path.join(home, '.codex', 'sessions'), // Codex 세션 기록
    dataDir: path.join(ROOT_DIR, 'data'),               // 계정·채팅 DB, 훅 토큰 (git에 올리지 않음)
    dbFile: null,                                        // null이면 dataDir/office.db
    publicDir: path.join(ROOT_DIR, 'public'),           // 브라우저에 보내는 파일
    hookToken: env.HOOK_TOKEN || null,                   // null이면 dataDir/hook-token 을 쓰거나 새로 만든다
    quiet: false,                                        // true면 시작 메시지 등을 출력하지 않음
  };
}

module.exports = { loadConfig };
