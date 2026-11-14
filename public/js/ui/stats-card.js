// 페이지의 "📊 오늘의 통계" 카드. 그리는 일은 lib/stats-ui.js가 한다.
import { state } from '../state.js';
import { StatsUI } from '../lib/stats-ui.js';

const REDRAW_MS = 60_000; // 새 집계가 없어도 1분마다 다시 그려 '지금' 시간대 표시를 옮긴다

export function initStatsCard() {
  setInterval(() => { if (state.statsSnap) renderStatsCard(); }, REDRAW_MS);
}

/** 서버의 'stats' 이벤트 */
export function onStats(snap) {
  state.statsSnap = snap;
  renderStatsCard();
}

function renderStatsCard() {
  StatsUI.render(document.getElementById('stats'), state.statsSnap);
}
