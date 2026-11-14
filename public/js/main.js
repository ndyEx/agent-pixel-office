// Pixel Office 화면의 시작점.
// 각 모듈은 불러올 때 아무 일도 하지 않고, 여기서 init*()를 차례로 불러 준비한다.
// 모듈 지도는 ARCHITECTURE.md 참고.
import { initCanvas } from './canvas.js';
import { initPlayers } from './players.js';
import { initLabelClicks } from './draw/labels.js';
import { initTabs, renderTabs } from './ui/tabs.js';
import { initAgentList } from './ui/agent-list.js';
import { initChat } from './ui/chat.js';
import { initAuth, loadMe, renderAuth } from './ui/auth.js';
import { initNotify } from './ui/notify.js';
import { initDetailPanel } from './ui/detail-panel.js';
import { initStatsCard } from './ui/stats-card.js';
import { connect } from './connection.js';
import { startLoop } from './loop.js';

// 1. 화면 요소 준비 (이벤트 연결)
initCanvas();
initPlayers();
initLabelClicks();
initTabs();
initAgentList();
initChat();
initAuth();
initNotify();
initDetailPanel();
initStatsCard();

// 2. 그리기 시작
startLoop();

// 3. 로그인 상태를 확인하고 서버에 연결
await loadMe();
renderAuth();
renderTabs();
connect();
