// 글씨 레이어 (글씨 캔버스): 상태·채팅 말풍선, 이름표, 문 이름표, 마우스를 올렸을 때 뜨는 카드.
// drawLabels()가 매 프레임 한 번에 그리고, 이름표 위치를 기억해 두었다가 클릭 판정에 쓴다.
import { canvas, L, S, view, pointer, fitLabels, font, ensureFont, FONT_FAMILY } from '../canvas.js';
import { ROOMS, ROOM_BY_ID, DOOR_Y0 } from '../world.js';
import { STATE_INFO, stateInfo, stateLabel, KIND_CHIP, titleFor, shortName } from '../display.js';
import { state } from '../state.js';
import { boardHit, drawBoardLabels, drawStatsCard } from './whiteboard.js';
import { openDetail } from '../ui/detail-panel.js';

// 상태 말풍선 글자
const BUBBLE = { thinking: '…', waiting: '!', idle: '☕', meeting: '💬', terminal: '>_', reading: '📖', browsing: '🌐' };
const SAY_MS = 6000; // 채팅 말풍선이 떠 있는 시간

let lastTags = []; // 지난 프레임의 이름표 (클릭 판정용)

/** 에이전트를 클릭(탭)하면 상세 패널을 연다 */
export function initLabelClicks() {
  canvas.addEventListener('click', (e) => {
    const tg = hitTest(lastTags, e.offsetX, e.offsetY);
    if (tg?.kind && tg.a.data.id) openDetail(tg.a.data.id);
  });
}

/** 매 프레임: 글씨 레이어 전체 */
export function drawLabels(sprites, t, agentCount) {
  fitLabels();
  drawDoorLabels();
  if (state.viewRoom === 'meeting') drawBoardLabels();
  const tags = [];
  sprites.forEach((a) => drawBubbles(a, t, tags)); // 상태·채팅 말풍선 (이름표는 모아 둠)
  layoutTags(tags);                                // 겹치는 이름표는 옆으로
  drawTags(tags);
  drawCard(tags);                                  // 마우스를 올린(탭한) 캐릭터의 자세한 카드
  lastTags = tags;
  if (state.viewRoom === 'office' && !agentCount) drawNotice('최근 30분간 활동한 에이전트 세션이 없어요');
}

// 말풍선을 그리고, 이름표 정보를 tags에 모은다
function drawBubbles(a, t, tags) {
  const { k, f } = view;
  const st = a.data.state;
  const sx = a.x * S * k;
  const top = (a._top ?? (a.y - 17) * S) * k;
  const feet = a.y * S * k;
  // 상태 말풍선
  const bubble = BUBBLE[st];
  if (bubble && !a.moving) {
    const b = 0.8 * f * (st === 'waiting' ? 1 + Math.sin(t / 150) * 0.15 : 1);
    L.save(); L.translate(sx, top - 16 * 0.8 * f); L.scale(b, b);
    L.fillStyle = '#1a1b26';
    L.beginPath(); L.roundRect(-16, -14, 32, 24, 6); L.fill();
    L.fillStyle = st === 'waiting' ? '#ff5c7a' : '#f4efe1';
    L.beginPath(); L.roundRect(-14, -12, 28, 20, 5); L.fill();
    L.beginPath(); L.moveTo(-4, 8); L.lineTo(4, 8); L.lineTo(0, 14); L.fill();
    L.fillStyle = st === 'waiting' ? '#fff' : '#1b1d2a';
    L.font = `700 13px ${FONT_FAMILY}`; L.textAlign = 'center'; L.textBaseline = 'middle';
    L.fillText(st === 'thinking' ? '.'.repeat(1 + (Math.floor(t / 400) % 3)) : bubble, 0, -2);
    L.restore();
  }
  // 채팅 말풍선 (마지막 1초는 서서히 사라짐)
  const age = a.say ? Date.now() - a.sayAt : Infinity;
  if (age < SAY_MS) {
    const text = a.say.length > 22 ? a.say.slice(0, 21) + '…' : a.say;
    L.globalAlpha = Math.min(1, (SAY_MS - age) / 1000);
    ensureFont(text);
    L.font = font(12); L.textAlign = 'center'; L.textBaseline = 'middle';
    const w = L.measureText(text).width + 12 * f, h = 20 * f, by = top - h - 10 * f;
    L.fillStyle = '#1a1b26'; L.beginPath(); L.roundRect(sx - w / 2 - 2, by - 2, w + 4, h + 4, 7); L.fill();
    L.fillStyle = '#ffffff'; L.beginPath(); L.roundRect(sx - w / 2, by, w, h, 6); L.fill();
    L.beginPath(); L.moveTo(sx - 4 * f, by + h); L.lineTo(sx + 4 * f, by + h); L.lineTo(sx, by + h + 6 * f); L.fill();
    L.fillStyle = '#1b1d2a'; L.fillText(text, sx, by + h / 2 + 0.5);
    L.globalAlpha = 1;
  }
  // 이름표는 여기서 그리지 않고 모아 두었다가, 겹치지 않게 옆으로 펼친 뒤 한꺼번에 그린다
  const name = shortName(a.data.title);
  ensureFont(name);
  L.font = font(10);
  const kind = KIND_CHIP[a.data.agent];
  const dot = kind ? 7 * f : 0; // 종류 색 점 (Claude는 세션 머리띠 색, Codex는 흰색)
  const w = L.measureText(name).width + 10 * f + (dot ? dot + 4 * f : 0), h = 14 * f;
  tags.push({ a, name, kind, dot, w, h, cx: sx, x: sx, feet, top,
    y: Math.min(feet + 2 * f, canvas.clientHeight - h - 3) }); // 화면 맨 아래에서는 잘리지 않게
}

// 같은 높이(한 줄)에 있는 이름표끼리 겹치면 왼쪽부터 차례로 옆으로 밀고, 줄 전체를 원래 중심으로 되돌린다.
// 위아래로는 움직이지 않으니 캐릭터 바로 밑에 그대로 붙어 있다.
function layoutTags(tags) {
  const gap = 3, W = canvas.clientWidth;
  const rows = [];
  for (const tg of [...tags].sort((p, q) => p.y - q.y)) {
    const row = rows.find((r) => Math.abs(r[0].y - tg.y) < tg.h);
    if (row) row.push(tg); else rows.push([tg]);
  }
  for (const row of rows) {
    row.sort((p, q) => p.cx - q.cx);
    for (let i = 1; i < row.length; i++) {
      const prev = row[i - 1], cur = row[i];
      cur.x = Math.max(cur.cx, prev.x + prev.w / 2 + gap + cur.w / 2);
    }
    const drift = row.reduce((s, tg) => s + (tg.x - tg.cx), 0) / row.length;
    for (const tg of row) tg.x = Math.min(W - tg.w / 2 - 2, Math.max(tg.w / 2 + 2, tg.x - drift));
  }
}

function drawTags(tags) {
  const f = view.f;
  for (const tg of tags) {
    const { a, x, y, w, h } = tg, x0 = x - w / 2, st = a.data.state;
    // 많이 밀려난 이름표는 캐릭터 발밑과 가는 선으로 잇는다
    if (Math.abs(x - tg.cx) > w * 0.35) {
      L.strokeStyle = '#ffffff55'; L.lineWidth = 1;
      L.beginPath(); L.moveTo(tg.cx, tg.feet); L.lineTo(x, y); L.stroke();
    }
    L.fillStyle = a.isMe ? '#f5c26be8' : '#14151fd0';
    L.beginPath(); L.roundRect(x0, y, w, h, h / 2); L.fill();
    if (tg.dot) {
      L.fillStyle = a.band || tg.kind.bg;
      L.beginPath(); L.arc(x0 + 5 * f + tg.dot / 2, y + h / 2, tg.dot / 2, 0, Math.PI * 2); L.fill();
    }
    L.font = font(10); L.textAlign = 'left'; L.textBaseline = 'middle';
    L.fillStyle = a.isMe ? '#1b1d2a' : a.data.agent === 'human' ? '#ffffff' : STATE_INFO[st]?.color || '#fff';
    L.fillText(tg.name, x0 + 5 * f + (tg.dot ? tg.dot + 4 * f : 0), y + h / 2 + 0.5);
  }
}

// 화면 좌표(px, py)에 있는 캐릭터: 위에 그려진(앞쪽) 캐릭터부터, 몸 영역 또는 이름표
function hitTest(tags, px = pointer.x, py = pointer.y) {
  if (px < 0) return null;
  const { k } = view;
  for (let i = tags.length - 1; i >= 0; i--) {
    const tg = tags[i], half = 7 * S * k;
    const onBody = px > tg.cx - half && px < tg.cx + half && py > tg.top && py < tg.feet + 2;
    const onTag = px > tg.x - tg.w / 2 && px < tg.x + tg.w / 2 && py > tg.y && py < tg.y + tg.h;
    if (onBody || onTag) return tg;
  }
  return null;
}

// 마우스를 올린(터치는 탭한) 캐릭터나 화이트보드의 자세한 카드
function drawCard(tags) {
  const tg = hitTest(tags);
  const onBoard = !tg && boardHit(); // 캐릭터가 보드 앞에 서 있으면 캐릭터 카드가 먼저
  canvas.style.cursor = tg || onBoard ? 'pointer' : '';
  if (onBoard) { drawStatsCard(); return; }
  if (!tg) { if (pointer.pinned) { pointer.pinned = false; pointer.x = pointer.y = -1; } return; }
  const { a } = tg, d = a.data, f = view.f;
  const lines = [{ text: d.title, font: font(12, true), color: '#ffffff' }];
  if (tg.kind) {
    lines.push({ text: `${tg.kind.label} · ${titleFor(d)}`, font: font(10), color: a.band || '#c0caf5' });
    lines.push({ text: `● ${stateLabel(d)}`, font: font(10, true), color: stateInfo(d.state).color });
    if (d.detail) lines.push({ text: d.detail.length > 34 ? d.detail.slice(0, 33) + '…' : d.detail, font: font(10), color: '#9a9cb5' });
    lines.push({ text: '클릭하면 자세히 보기', font: font(9), color: '#6b7089' });
  } else {
    lines.push({ text: a.isMe ? '나' : '사람', font: font(10), color: '#c0caf5' });
  }
  let w = 0;
  for (const ln of lines) { ensureFont(ln.text); L.font = ln.font; w = Math.max(w, L.measureText(ln.text).width); }
  const pad = 8 * f, lh = 15 * f, cw = w + pad * 2, ch = lines.length * lh + pad * 1.4;
  let cx = tg.cx - cw / 2, cy = tg.top - ch - 10 * f;
  if (cy < 4) cy = tg.feet + 22 * f;                       // 위가 모자라면 발밑으로
  cx = Math.min(canvas.clientWidth - cw - 4, Math.max(4, cx));
  L.fillStyle = '#14151ff2'; L.strokeStyle = a.band || (tg.kind ? tg.kind.bg : '#f5c26b'); L.lineWidth = 1.5;
  L.beginPath(); L.roundRect(cx, cy, cw, ch, 8); L.fill(); L.stroke();
  L.textAlign = 'left'; L.textBaseline = 'middle';
  lines.forEach((ln, i) => { L.font = ln.font; L.fillStyle = ln.color; L.fillText(ln.text, cx + pad, cy + pad * 0.7 + lh * i + lh / 2); });
}

// 옆방으로 가는 문 이름표
function drawDoorLabels() {
  const { k, f } = view, idx = ROOM_BY_ID[state.viewRoom].index;
  L.font = font(11, true); L.textBaseline = 'middle'; L.textAlign = 'left';
  const y = (DOOR_Y0 - 5) * S * k;
  for (const [side, room] of [['left', ROOMS[idx - 1]], ['right', ROOMS[idx + 1]]]) {
    if (!room) continue;
    const text = side === 'right' ? `${room.name} ▶` : `◀ ${room.name}`;
    ensureFont(text);
    const w = L.measureText(text).width + 12 * f, h = 18 * f;
    const x = side === 'right' ? 233 * S * k - w : 7 * S * k;
    L.fillStyle = '#14151fc8'; L.beginPath(); L.roundRect(x, y - h / 2, w, h, 4); L.fill();
    L.fillStyle = '#f4efe1'; L.fillText(text, x + 6 * f, y + 0.5);
  }
}

// 화면 가운데 안내 한 줄
function drawNotice(msg) {
  const { k, f } = view, cx = canvas.clientWidth / 2, cy = 100 * S * k;
  L.font = font(14); L.textAlign = 'center'; L.textBaseline = 'middle';
  const w = L.measureText(msg).width + 24 * f, h = 30 * f;
  ensureFont(msg);
  L.fillStyle = '#14151fc8'; L.beginPath(); L.roundRect(cx - w / 2, cy - h / 2, w, h, 8); L.fill();
  L.fillStyle = '#f4efe1'; L.fillText(msg, cx, cy + 0.5);
}
