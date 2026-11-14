// 회의실 화이트보드: 오늘의 통계.
// 막대(도트)는 lib/scenery.js가 그리고, 보드 위 글씨와 마우스를 올렸을 때 뜨는 자세한 카드는 여기서 그린다.
import { StatsUI } from '../lib/stats-ui.js';
import { canvas, L, S, view, pointer, scenery, font, ensureFont } from '../canvas.js';
import { state } from '../state.js';

function boardRect() {
  const B = scenery.BOARD, { k } = view;
  return { x: B.x * S * k, y: B.y * S * k, w: B.w * S * k, h: B.h * S * k };
}

/** 마우스가 보드 위에 있나 */
export function boardHit() {
  if (pointer.x < 0 || state.viewRoom !== 'meeting') return false;
  const r = boardRect();
  return pointer.x >= r.x && pointer.x <= r.x + r.w && pointer.y >= r.y && pointer.y <= r.y + r.h;
}

/** 보드 윗줄 글씨: 오늘 도구 사용 횟수 */
export function drawBoardLabels() {
  const s = StatsUI.summarize(state.statsSnap), { k } = view;
  const left = 73 * S * k, right = 167 * S * k, y = 7.6 * S * k;
  let main = '통계 집계 중…', sub = '';
  if (s?.scanning) main = `집계 중 ${Math.round(s.progress * 100)}%`;
  else if (s && !s.total) main = '오늘은 아직 조용해요';
  else if (s) { main = `오늘 도구 ${s.total}회`; sub = `Claude ${s.today.tools.claude} · Codex ${s.today.tools.codex}`; }
  ensureFont(main + sub);
  L.textBaseline = 'middle'; L.textAlign = 'left';
  L.font = font(10, true); L.fillStyle = '#2a2d42'; L.fillText(main, left, y);
  const mw = L.measureText(main).width;
  L.font = font(9);
  if (sub && right - left - mw > L.measureText(sub).width + 10) { L.textAlign = 'right'; L.fillStyle = '#55596e'; L.fillText(sub, right, y); }
}

/** 보드에 마우스를 올리면 뜨는 자세한 통계 카드 */
export function drawStatsCard() {
  const s = StatsUI.summarize(state.statsSnap), f = view.f;
  const lines = [{ text: s ? `📊 오늘의 통계 · ${StatsUI.fmtDate(s.date)}` : '📊 오늘의 통계', font: font(12, true), color: '#ffffff' }];
  if (!s) lines.push({ text: '집계를 기다리는 중…', font: font(10), color: '#9a9cb5' });
  else {
    const d = s.delta === null ? '' : `  (어제 대비 ${s.delta >= 0 ? '+' : ''}${s.delta}%)`;
    lines.push({ text: `도구 사용 ${s.total}회${d}`, font: font(11, true), color: '#f4efe1' });
    for (const a of ['claude', 'codex']) {
      const l = StatsUI.agentLine(s, a);
      lines.push({ text: `● ${l.label}  ${l.tools}회 · ${l.time} · 요청 ${l.turns}`, font: font(10), color: l.color });
    }
    const top = s.cats.filter((c) => c.n).sort((p, q) => q.n - p.n).slice(0, 4).map((c) => `${c.label} ${c.n}`).join(' · ');
    if (top) lines.push({ text: `유형  ${top}`, font: font(10), color: '#9a9cb5' });
    const A = StatsUI.AGENT, hh = s.today.hours;
    // 막대 줄: 값(아래→위로 쌓임)과 색, 앞에 붙는 이름표
    lines.push({ label: '시간대', bw: 4, bars: s.hours.map((_, i) => [[hh.codex[i], A.codex.color], [hh.claude[i], A.claude.color]]), now: new Date().getHours() });
    lines.push({ label: '7일', bw: 12, bars: s.week.map((x) => [[x.n, '#f5c26b']]), now: s.week.length - 1 });
    if (s.scanning) lines.push({ text: `집계 중 ${Math.round(s.progress * 100)}% — 지난 기록을 읽는 중이에요`, font: font(9), color: '#9a9cb5' });
  }
  const pad = 8 * f, lh = 15 * f, barH = 22 * f, LABEL_W = 44 * f;
  let w = 0;
  for (const ln of lines) {
    if (ln.bars) { ln.h = barH + 4 * f; w = Math.max(w, LABEL_W + ln.bars.length * ln.bw * f); continue; }
    ln.h = lh; ensureFont(ln.text); L.font = ln.font; w = Math.max(w, L.measureText(ln.text).width);
  }
  const cw = w + pad * 2, ch = lines.reduce((n, ln) => n + ln.h, 0) + pad * 1.4, r = boardRect();
  const cx = Math.min(canvas.clientWidth - cw - 4, Math.max(4, r.x + r.w / 2 - cw / 2)), cy = r.y + r.h + 8;
  L.fillStyle = '#14151ff2'; L.strokeStyle = '#f5c26b'; L.lineWidth = 1.5;
  L.beginPath(); L.roundRect(cx, cy, cw, ch, 8); L.fill(); L.stroke();
  L.textAlign = 'left'; L.textBaseline = 'middle';
  let y = cy + pad * 0.7;
  for (const ln of lines) {
    if (ln.bars) drawBars(ln, cx + pad, y, barH, LABEL_W, f);
    else { L.font = ln.font; L.fillStyle = ln.color; L.fillText(ln.text, cx + pad, y + ln.h / 2); }
    y += ln.h;
  }
}

// 막대 한 줄 (이름표 + 쌓인 막대 + '지금' 표시)
function drawBars(ln, x0, y, barH, LABEL_W, f) {
  const peak = Math.max(1, ...ln.bars.map((segs) => segs.reduce((n, [v]) => n + v, 0)));
  const bw = ln.bw * f, base = y + barH;
  ensureFont(ln.label); L.font = font(10); L.fillStyle = '#9a9cb5'; L.fillText(ln.label, x0, y + barH / 2);
  ln.bars.forEach((segs, i) => {
    const x = x0 + LABEL_W + i * bw, gap = Math.max(1, bw * 0.22);
    L.fillStyle = '#ffffff18'; L.fillRect(x, base - 1, bw - gap, 1);                // 바닥선
    let top = base - 1;
    for (const [v, color] of segs) {
      const hgt = (v / peak) * (barH - 2);
      if (v > 0) { L.fillStyle = color; L.fillRect(x, top - Math.max(1, hgt), bw - gap, Math.max(1, hgt)); top -= Math.max(1, hgt); }
    }
    if (i === ln.now) { L.fillStyle = '#f5c26b'; L.fillRect(x, base, bw - gap, 2 * f); } // 지금(오늘) 표시
  });
}
