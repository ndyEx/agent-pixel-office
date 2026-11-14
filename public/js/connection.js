// 서버와의 실시간 연결 (socket.io). 서버가 보내는 이벤트를 각 모듈로 나눠 준다.
// 이벤트 목록은 server/realtime.js 맨 위 주석 참고.
import { state } from './state.js';
import { setAvatar, avatars } from './looks.js';
import { syncAgents } from './agents.js';
import { syncPeople, syncOwnPosition, discardPendingMove, stopInput } from './players.js';
import { onHistory, onChat, onChatCleared } from './ui/chat.js';
import { onStats } from './ui/stats-card.js';
import { renderTabs } from './ui/tabs.js';
import { renderAuth } from './ui/auth.js';
import { flash } from './util.js';

/** 새로 연결한다. 로그인·로그아웃하면 새 쿠키로 다시 연결해야 서버가 누구인지 안다 */
export function connect() {
  if (state.socket) state.socket.disconnect();
  const socket = io({ forceNew: true }); // io: /socket.io/socket.io.js 가 만든 전역 함수
  state.socket = socket;
  const conn = document.getElementById('conn');

  socket.on('connect', () => {
    conn.textContent = '● 실시간 연결됨'; conn.style.color = '#7bd88f';
    // 다시 연결되면 서버가 기억한 내 자리를 따른다 (그사이 다른 탭에서 움직였을 수 있음)
    if (state.me) { state.me.placed = false; discardPendingMove(); }
  });
  socket.on('disconnect', () => { conn.textContent = '○ 재연결 중…'; conn.style.color = '#ff5c7a'; });

  socket.on('agents', syncAgents);
  socket.on('stats', onStats);
  socket.on('players', syncPeople);
  socket.on('playerMoved', syncOwnPosition);
  socket.on('history', onHistory);
  socket.on('chat', onChat);
  socket.on('chatCleared', onChatCleared);
  socket.on('avatars', (map) => { avatars.clear(); for (const [name, av] of Object.entries(map || {})) setAvatar(name, av); });
  socket.on('avatar', ({ name, avatar }) => setAvatar(name, avatar));
  socket.on('sessionExpired', () => { // 로그아웃(다른 탭)·만료
    state.me = null; discardPendingMove(); stopInput();
    renderAuth(); renderTabs();
    flash('로그인 세션이 종료됐어요. 다시 로그인해주세요.');
    connect();
  });
}
