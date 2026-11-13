// 방 배경과 소품
// - 움직이지 않는 부분(바닥, 벽, 가구 본체)은 방마다 오프스크린 캔버스에 한 번만 그려 둔다.
// - 움직이는 부분(창밖 하늘·구름, 시계, LED, TV, 화분, 모니터, 탁구공)은 매 프레임 그린다.
// - 김·먼지 파티클, 밤 색조, 조명 빛번짐, 비네팅은 캐릭터 위에 덧그린다.
window.createScenery = function ({ S, DESKS, ROOM_BY_ID, DOOR_Y0, DOOR_Y1 }) {
  const { shade, mix } = window.Sprites;
  const WW = 240, WH = 150;

  // ---------- 그리기 도구 (월드 좌표) ----------
  const R = (g, x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(Math.round(x) * S, Math.round(y) * S, Math.round(w) * S, Math.round(h) * S);
  };
  // 외곽선 + 윗면 하이라이트 + 아랫면 그림자가 있는 상자
  function box(g, x, y, w, h, c, { top = 1, bottom = 1 } = {}) {
    R(g, x, y, w, h, shade(c, -0.55));
    R(g, x + 1, y + 1, w - 2, h - 2, c);
    if (top) R(g, x + 1, y + 1, w - 2, top, shade(c, 0.18));
    if (bottom) R(g, x + 1, y + h - 1 - bottom, w - 2, bottom, shade(c, -0.22));
  }
  function shadow(g, x, y, w, h, a = 0.22) { g.globalAlpha = a; R(g, x, y, w, h, '#000'); g.globalAlpha = 1; }
  // 좌표로 정해지는 난수: 캐시와 매 프레임 그림이 항상 같게
  const rnd = (a, b = 0) => {
    let h = (a * 374761393 + b * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1, 7), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

  // ---------- 하늘: 실제 시각에 따라 낮·노을·밤 ----------
  function sky() {
    const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
    if (h < 5.5 || h >= 20) return { top: '#0e1430', bot: '#243063', night: true };
    if (h < 7.5) return { top: '#6f8fcf', bot: '#f2a65a', dawn: true };
    if (h < 17) return { top: '#4f9ee0', bot: '#a9dcf5', day: true };
    return { top: '#3d405b', bot: '#e07a5f', dusk: true };
  }

  // ---------- 바닥 · 벽 ----------
  function floorTiles(g, a, b, dots) {
    for (let y = 24; y < WH; y += 8) for (let x = 0; x < WW; x += 8) {
      const c = ((x + y) / 8) % 2 ? a : b;
      R(g, x, y, 8, 8, c);
      for (let k = 0; k < 3; k++) // 카펫 결
        R(g, x + Math.floor(rnd(x, y * 3 + k) * 8), y + Math.floor(rnd(y, x * 5 + k) * 8), 1, 1, shade(c, rnd(k, x + y) > 0.5 ? 0.07 : -0.08));
      if (dots) R(g, x + 3, y + 3, 2, 2, shade(c, 0.06));
    }
  }
  function floorWood(g, cols) {
    for (let y = 24; y < WH; y += 4) {
      const off = ((y / 4) % 3) * 13;
      for (let x = -off; x < WW; x += 40) {
        const c = cols[Math.floor(rnd(x + 400, y) * cols.length)];
        R(g, x, y, 40, 4, c);
        R(g, x, y, 40, 1, shade(c, 0.08));
        R(g, x, y, 1, 4, shade(c, -0.3));
        R(g, x + 6 + Math.floor(rnd(x, y) * 22), y + 2, 7, 1, shade(c, -0.1)); // 나뭇결
      }
    }
  }
  function wall(g, c) {
    R(g, 0, 0, WW, 24, c);
    for (let x = 8; x < WW; x += 16) R(g, x, 2, 1, 13, shade(c, -0.08)); // 벽판 이음새
    R(g, 0, 0, WW, 2, shade(c, -0.3));   // 천장 몰딩
    R(g, 0, 15, WW, 6, shade(c, -0.12)); // 징두리 판벽
    R(g, 0, 15, WW, 1, shade(c, 0.15));
    R(g, 0, 21, WW, 3, '#2a2d42');       // 걸레받이
    R(g, 0, 21, WW, 1, '#3a3e5a');
    shadow(g, 0, 24, WW, 2, 0.28); shadow(g, 0, 26, WW, 1, 0.12);
  }
  // 옆방으로 가는 문 + 발판 + 이름표
  function door(g, side) {
    const x = side === 'right' ? 235 : 0;
    R(g, x, DOOR_Y0 - 2, 5, DOOR_Y1 - DOOR_Y0 + 4, '#2a2d42');
    R(g, side === 'right' ? x + 1 : x, DOOR_Y0, 4, DOOR_Y1 - DOOR_Y0, '#14151f');
    g.globalAlpha = 0.25; R(g, side === 'right' ? x + 1 : x + 3, DOOR_Y0, 1, DOOR_Y1 - DOOR_Y0, '#f5c26b'); g.globalAlpha = 1;
    const mx = side === 'right' ? 222 : 6;
    R(g, mx, DOOR_Y0 + 4, 12, DOOR_Y1 - DOOR_Y0 - 8, '#4a3322');
    R(g, mx + 1, DOOR_Y0 + 5, 10, DOOR_Y1 - DOOR_Y0 - 10, '#6e4c33');
    for (let k = DOOR_Y0 + 7; k < DOOR_Y1 - 6; k += 3) R(g, mx + 2, k, 8, 1, '#5c3f2a');
    // 이름표 글씨는 선명하게 보이도록 office.js의 글씨 레이어에서 그린다
  }

  // ---------- 소품 ----------
  const BOOKS = ['#c0504d', '#4f81bd', '#9bbb59', '#8064a2', '#f79646', '#4bacc6', '#e0c060', '#7a7a8c'];
  function bookshelf(g, x, y) {
    shadow(g, x + 1, y + 25, 32, 2);
    box(g, x, y, 32, 25, '#6b4a2f', { top: 1, bottom: 0 });
    for (let r = 0; r < 3; r++) {
      const sy = y + 2 + r * 7;
      R(g, x + 2, sy, 28, 6, '#3d2a1a');
      let bx = x + 2;
      while (bx < x + 29) {
        const w = 2 + (rnd(bx, r) > 0.6 ? 1 : 0), hgt = 4 + Math.floor(rnd(r, bx) * 2);
        if (bx + w > x + 30) break;
        const c = BOOKS[Math.floor(rnd(bx * 3, r * 7) * BOOKS.length)];
        R(g, bx, sy + 6 - hgt, w, hgt, c);
        R(g, bx, sy + 6 - hgt, w, 1, shade(c, 0.25));
        R(g, bx + w - 1, sy + 7 - hgt, 1, hgt - 1, shade(c, -0.25));
        bx += w + (rnd(bx, r + 9) > 0.85 ? 1 : 0);
      }
      R(g, x + 1, sy + 6, 30, 1, '#8a6544');
    }
  }
  function rack(g, rx) {
    shadow(g, rx + 1, 53, 12, 2);
    box(g, rx, 26, 12, 27, '#1f2233', { top: 1, bottom: 0 });
    R(g, rx + 1, 27, 10, 25, '#262a3d');
    for (let l = 0; l < 6; l++) {
      R(g, rx + 2, 29 + l * 4, 8, 3, '#323750'); R(g, rx + 2, 29 + l * 4, 8, 1, '#3c4160');
      R(g, rx + 3, 30 + l * 4, 1, 1, '#1a1c28'); R(g, rx + 5, 30 + l * 4, 1, 1, '#1a1c28');
    }
  }
  function sofa(g, x, y, w, c, seats) { // y = 등받이 윗변
    shadow(g, x, y + 15, w + 2, 2);
    box(g, x, y, w, 7, shade(c, 0.06));
    box(g, x, y + 5, w, 10, c);
    const n = seats ?? Math.max(2, Math.round(w / 14)); // 방석 수 (1이면 1인용 안락의자)
    for (let i = 1; i < n; i++) R(g, x + Math.round((i * w) / n), y + 6, 1, 7, shade(c, -0.3));
    box(g, x - 2, y + 3, 4, 12, shade(c, -0.1)); box(g, x + w - 2, y + 3, 4, 12, shade(c, -0.1));
  }
  const LOUNGE_SOFA = '#8f5e9e';
  // 아래쪽 소파에 앉은 캐릭터 위로 덧그릴 등받이 한 칸 (seatX: 좌석 가운데, y: 등받이 윗변)
  function sofaBackPiece(g, seatX, y) { box(g, seatX - 8, y, 16, 7, shade(LOUNGE_SOFA, 0.06)); }
  // 위를 보는 소파(뒷모습): 방석이 위, 등받이가 아래(화면 앞쪽). y = 방석 윗변
  // 앉은 캐릭터의 허리는 office.js가 등받이 조각을 덧그려 가린다 (sofaBackPiece와 같은 색)
  function sofaUp(g, x, y, w, c, seats) {
    shadow(g, x, y + 15, w + 2, 2);
    box(g, x, y, w, 9, c);
    for (let i = 1; i < seats; i++) R(g, x + Math.round((i * w) / seats), y + 1, 1, 6, shade(c, -0.3));
    box(g, x, y + 7, w, 7, shade(c, 0.06));
    box(g, x - 2, y - 1, 4, 13, shade(c, -0.1)); box(g, x + w - 2, y - 1, 4, 13, shade(c, -0.1));
  }
  function table(g, x, y, w, h, c) {
    shadow(g, x + 1, y + h, w, 2);
    box(g, x, y, w, h, c, { top: 2, bottom: 2 });
    for (let k = 0; k < 3; k++) R(g, x + 4 + Math.floor(rnd(x + k, y) * (w - 14)), y + 3 + k * Math.max(1, Math.floor((h - 6) / 3)), 8, 1, shade(c, -0.12));
  }
  function chair(g, x, y, back) { // back: 등받이가 보이는 의자(위쪽 줄)
    shadow(g, x, y + 7, 8, 1);
    if (back) { box(g, x, y, 8, 5, '#3c4160'); box(g, x + 1, y + 4, 6, 3, '#4a4f72'); }
    else { box(g, x, y + 2, 8, 4, '#4a4f72'); R(g, x + 3, y + 6, 2, 2, '#2a2d42'); }
  }
  function plant(g, x, y, t, seed) {
    shadow(g, x + 1, y + 22, 13, 2);
    box(g, x + 2, y + 12, 10, 10, '#a0522d');
    R(g, x + 1, y + 12, 12, 2, '#b8653a'); R(g, x + 1, y + 13, 12, 1, '#7a3d20');
    const sw = Math.round(Math.sin(t / 900 + seed) * 1.2);
    R(g, x - 1, y + 5, 6, 7, '#2f6e45'); R(g, x + 9, y + 5, 6, 7, '#2f6e45');
    R(g, x + 2 + sw, y + 1, 10, 11, '#3f8a5a');
    R(g, x + 4 + sw, y - 4, 6, 7, '#4f9d69');
    R(g, x + 5 + sw * 2, y - 6, 3, 3, '#5fb87b');
    R(g, x + 1, y + 6, 2, 2, '#5fb87b'); R(g, x + 11, y + 7, 2, 2, '#5fb87b'); R(g, x + 6 + sw, y + 3, 2, 2, '#6fcf8b');
  }
  function windowPane(g, wx, t, i, sk) {
    const wy = 4, w = 28, h = 14;
    R(g, wx - 1, wy - 1, w + 2, h + 2, '#2a2d42');
    R(g, wx, wy, w, 5, sk.top); R(g, wx, wy + 5, w, 4, mix(sk.top, sk.bot, 0.5)); R(g, wx, wy + 9, w, 5, sk.bot);
    g.save(); g.beginPath(); g.rect(wx * S, wy * S, w * S, h * S); g.clip();
    if (sk.night) {
      for (let k = 0; k < 6; k++) if ((t / 700 + k * 1.7 + i) % 3 > 0.6)
        R(g, wx + rnd(i, k) * w, wy + rnd(k, i) * 7, 1, 1, '#fff7c0');
      if (i === 0) { R(g, wx + 19, wy + 2, 3, 3, '#f4efe1'); R(g, wx + 20, wy + 2, 2, 1, '#ffffff'); }
    } else {
      for (let k = 0; k < 2; k++) {
        const cx = ((t / 900 + rnd(i, k) * 60 + k * 30) % (w + 16)) - 10, cy = wy + 2 + k * 4;
        R(g, wx + cx, cy, 8, 2, '#ffffffc8'); R(g, wx + cx + 2, cy - 1, 4, 1, '#ffffffc8');
      }
    }
    for (let b = 0; b < 7; b++) { // 멀리 보이는 건물
      const bh = 2 + Math.floor(rnd(i * 7 + b, 3) * 4);
      R(g, wx + b * 4, wy + h - bh, 4, bh, sk.night ? '#141a33' : shade(sk.bot, -0.35));
      if (sk.night && rnd(b, i) > 0.4) R(g, wx + b * 4 + 1, wy + h - bh + 1, 1, 1, '#f5c26b');
    }
    g.restore();
    R(g, wx + 13, wy, 2, h, '#2a2d42'); R(g, wx, wy + 6, w, 1, '#2a2d42');
    g.globalAlpha = 0.2; R(g, wx + 2, wy + 1, 1, 4, '#fff'); R(g, wx + 3, wy + 1, 1, 2, '#fff'); g.globalAlpha = 1;
    R(g, wx - 2, wy + h + 1, w + 4, 2, '#8a8fb0'); R(g, wx - 2, wy + h + 2, w + 4, 1, '#5c6080');
  }
  function shafts(g, xs, sk) {
    if (sk.night) return;
    g.save();
    g.globalAlpha = sk.day ? 0.07 : 0.06; g.fillStyle = sk.day ? '#fff6d8' : '#ffb27a';
    for (const wx of xs) {
      g.beginPath();
      g.moveTo(wx * S, 24 * S); g.lineTo((wx + 28) * S, 24 * S);
      g.lineTo((wx + 52) * S, 74 * S); g.lineTo((wx + 24) * S, 74 * S);
      g.closePath(); g.fill();
    }
    g.restore();
  }
  // 픽셀로 그린 벽시계 (실제 시각)
  function clock(g, cx, cy, t) {
    const r = 5;
    for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d = dx * dx + dy * dy;
      if (d <= r * r) R(g, cx + dx, cy + dy, 1, 1, '#f4f6fa');
      else if (d <= (r + 1.2) * (r + 1.2)) R(g, cx + dx, cy + dy, 1, 1, '#2a2d42');
    }
    for (const [dx, dy] of [[0, -4], [4, 0], [0, 4], [-4, 0]]) R(g, cx + dx, cy + dy, 1, 1, '#8a8fa3');
    const now = new Date();
    const hand = (ang, len, c) => { for (let k = 1; k <= len; k++) R(g, cx + Math.round(Math.cos(ang) * k), cy + Math.round(Math.sin(ang) * k), 1, 1, c); };
    hand(((now.getHours() % 12) + now.getMinutes() / 60) / 12 * Math.PI * 2 - Math.PI / 2, 2, '#1d1d1d');
    hand((now.getMinutes() + now.getSeconds() / 60) / 60 * Math.PI * 2 - Math.PI / 2, 4, '#1d1d1d');
    const sa = now.getSeconds() / 60 * Math.PI * 2 - Math.PI / 2;
    R(g, cx + Math.round(Math.cos(sa) * 4), cy + Math.round(Math.sin(sa) * 4), 1, 1, '#e06c75');
    R(g, cx, cy, 1, 1, '#e06c75');
    void t;
  }

  // ---------- 모니터 ----------
  function screen(g, x, y, i, st, t) {
    const w = 10, h = 6;
    if (!st) { // 꺼짐
      R(g, x, y, w, h, '#1b1e2c');
      R(g, x + 1, y + 1, 1, 1, '#2e3248'); R(g, x + 2, y + 2, 1, 1, '#2e3248');
      return;
    }
    if (st === 'browsing') {
      R(g, x, y, w, h, '#e8eef8'); R(g, x, y, w, 1, '#7aa2f7'); R(g, x + 8, y, 1, 1, '#e06c75');
      R(g, x + 1, y + 2, 4, 3, '#f5c26b');
      for (let l = 0; l < 3; l++) R(g, x + 6, y + 2 + l, 2 + ((l + Math.floor(t / 900)) % 2), 1, '#8a8fa3');
      lights.push({ x: x + 5, y: y + 3, r: 14, c: '#9fb8ff', a: 0.22 });
      return;
    }
    if (st === 'waiting') {
      const on = Math.floor(t / 400) % 2;
      R(g, x, y, w, h, on ? '#7a2a3a' : '#5a2a35');
      if (on) { R(g, x + 4, y + 1, 2, 2, '#ffffff'); R(g, x + 4, y + 4, 2, 1, '#ffffff'); }
      lights.push({ x: x + 5, y: y + 3, r: 16, c: '#ff5c7a', a: on ? 0.3 : 0.15 });
      return;
    }
    R(g, x, y, w, h, '#16202e');
    if (st === 'thinking') {
      const k = Math.floor(t / 300) % 3;
      for (let d = 0; d < 3; d++) R(g, x + 2 + d * 3, y + 2, 2, 2, d === k ? '#c0caf5' : '#3c4160');
    } else { // typing / working: 코드가 위로 흘러감
      const scroll = Math.floor(t / 260);
      for (let l = 0; l < 5; l++) {
        const n = scroll + l + i * 3;
        const indent = (n % 4 === 1 || n % 4 === 2) ? 2 : 0;
        const len = 2 + Math.floor(rnd(n, i) * 6);
        R(g, x + 1 + indent, y + l + 0.5, Math.min(len, 8 - indent), 1, ['#7bd88f', '#c0caf5', '#f5c26b', '#bb9af7'][n % 4]);
      }
      if (Math.floor(t / 500) % 2) R(g, x + 8, y + 5, 1, 1, '#ffffff');
    }
    lights.push({ x: x + 5, y: y + 3, r: 14, c: '#7bd88f', a: 0.18 });
  }
  function desk(g, i, st, t, occupied) {
    const d = DESKS[i], x = d.x, y = d.y;
    shadow(g, x + 1, y + 22, 26, 2);
    R(g, x + 2, y + 14, 2, 8, '#4a3626'); R(g, x + 22, y + 14, 2, 8, '#4a3626');
    box(g, x, y + 8, 26, 7, '#8a6544', { top: 1, bottom: 2 });
    R(g, x + 12, y + 7, 2, 2, '#1a1c28'); R(g, x + 10, y + 9, 6, 1, '#1a1c28');
    box(g, x + 7, y, 12, 8, '#23263a', { top: 0, bottom: 0 });
    screen(g, x + 8, y + 1, i, st, t);
    R(g, x + 8, y + 11, 9, 2, '#b8bccc'); R(g, x + 8, y + 12, 9, 1, '#8a8fa3');
    if (i % 3 !== 1) { R(g, x + 20, y + 9, 3, 3, ['#e06c75', '#61afef', '#f4efe1'][i % 3]); R(g, x + 20, y + 9, 3, 1, '#3b2a20'); }
    if (i % 2 === 0) { R(g, x + 2, y + 10, 4, 3, '#e8eaf0'); R(g, x + 3, y + 9, 4, 3, '#f4f6fa'); }
    if (!occupied) chair(g, x + 15, y + 18, true);
  }

  // ---------- 방별 정적 배경 (캐시) ----------
  function buildStatic(roomId) {
    const cv = document.createElement('canvas');
    cv.width = WW * S; cv.height = WH * S;
    const g = cv.getContext('2d');
    const room = ROOM_BY_ID[roomId];
    if (roomId === 'office') {
      floorTiles(g, '#3a3f5c', '#363a55');
      wall(g, room.wall);
      bookshelf(g, 6, 26);
      rack(g, 206); rack(g, 220);
      // 회의 테이블은 오른쪽으로 옮기고, 왼쪽 아래를 넓은 휴게 공간으로
      table(g, 152, 112, 40, 12, '#7a5636');
      R(g, 156, 115, 7, 4, '#d8dce8'); R(g, 158, 114, 7, 4, '#f4f6fa'); // 회의 자료
      R(g, 178, 115, 8, 5, '#2a2d42'); R(g, 179, 116, 6, 3, '#3c4160'); // 노트북
      // 휴게실: 4인용 소파 두 개가 가운데 테이블을 사이에 두고 마주 본다
      sofa(g, 28, 106, 64, LOUNGE_SOFA, 4);                   // 위쪽: 정면을 보는 소파
      table(g, 36, 123, 48, 8, '#6b4a2f');                    // 가운데 테이블
      R(g, 42, 125, 3, 3, '#f4efe1'); R(g, 42, 125, 3, 1, '#6b4a2f'); R(g, 74, 126, 3, 3, '#f4efe1'); R(g, 74, 126, 3, 1, '#6b4a2f');
      R(g, 54, 125, 10, 4, '#e8eaf0'); R(g, 56, 124, 8, 4, '#f4f6fa');            // 잡지
      R(g, 67, 126, 4, 3, '#c94f4f'); R(g, 68, 125, 2, 1, '#e5c07b');            // 과자 봉지
      sofaUp(g, 28, 134, 64, LOUNGE_SOFA, 4);                 // 아래쪽: 등을 보이는 소파
      shadow(g, 7, 136, 10, 2);
      box(g, 6, 118, 10, 18, '#c8ccd8'); R(g, 8, 121, 6, 4, '#2a2d42'); R(g, 9, 122, 2, 1, '#7bd88f');
      R(g, 10, 127, 2, 2, '#55596e'); R(g, 9, 131, 4, 3, '#f4efe1'); R(g, 9, 131, 4, 1, '#6b4a2f'); R(g, 8, 134, 6, 1, '#7a7f99');
    } else if (roomId === 'lounge') {
      floorWood(g, ['#6b4f36', '#664b33', '#705339', '#634830']);
      wall(g, room.wall);
      R(g, 30, 66, 180, 30, '#6a3c4c'); R(g, 32, 68, 176, 26, '#8d5a6b'); R(g, 34, 70, 172, 22, '#7d4e5e');
      for (let k = 0; k < 8; k++) R(g, 44 + k * 21, 80, 6, 2, '#a8727f');
      for (let k = 30; k < 210; k += 3) { R(g, k, 64, 1, 2, '#c8a0a8'); R(g, k, 96, 1, 2, '#c8a0a8'); } // 술
      box(g, 94, 21, 52, 6, '#4a3626', { top: 1, bottom: 0 }); // TV 장
      sofa(g, 36, 46, 54, '#4f7cac'); sofa(g, 150, 46, 54, '#4f7cac');
      R(g, 50, 52, 6, 4, '#f5c26b'); R(g, 182, 52, 6, 4, '#e06c75'); // 쿠션
      table(g, 100, 74, 40, 10, '#6b4a2f');
      R(g, 110, 74, 3, 3, '#f4efe1'); R(g, 124, 74, 3, 3, '#f4efe1'); R(g, 130, 77, 6, 3, '#e8eaf0');
      for (let k = 0; k < 2; k++) {
        const vx = 196 + k * 16, c = k ? '#c94f4f' : '#3f7fbf';
        shadow(g, vx + 1, 54, 14, 2);
        box(g, vx, 26, 14, 28, c);
        R(g, vx + 2, 29, 10, 13, '#1a2433');
        for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++) {
          const pc = BOOKS[(r * 3 + cc + k * 2) % BOOKS.length];
          R(g, vx + 3 + cc * 3, 30 + r * 4, 2, 3, pc); R(g, vx + 3 + cc * 3, 30 + r * 4, 2, 1, shade(pc, 0.3));
        }
        R(g, vx + 2, 44, 10, 3, '#2a2d42'); R(g, vx + 9, 45, 2, 1, '#7bd88f');
        R(g, vx + 3, 49, 8, 3, '#14151f');
      }
      shadow(g, 91, 126, 60, 2);
      R(g, 93, 120, 2, 7, '#2a2d42'); R(g, 145, 120, 2, 7, '#2a2d42');
      box(g, 90, 106, 60, 16, '#2f7a4a', { top: 1, bottom: 2 });
      R(g, 92, 108, 56, 1, '#e8f0e8'); R(g, 92, 118, 56, 1, '#e8f0e8'); R(g, 92, 108, 1, 11, '#e8f0e8'); R(g, 147, 108, 1, 11, '#e8f0e8');
      R(g, 92, 113, 56, 1, '#bcd8c0');
      R(g, 119, 104, 2, 18, '#d8dce8'); R(g, 118, 104, 1, 2, '#55596e'); R(g, 121, 104, 1, 2, '#55596e');
      R(g, 96, 110, 3, 3, '#c94f4f'); R(g, 97, 113, 1, 2, '#6b4a2f'); R(g, 141, 114, 3, 3, '#2a2d42'); R(g, 142, 117, 1, 2, '#6b4a2f');
    } else {
      floorTiles(g, '#2f4a4a', '#2b4545', true);
      wall(g, room.wall);
      box(g, 70, 3, 100, 17, '#b8bccc', { top: 0, bottom: 0 }); R(g, 72, 5, 96, 13, '#f4f6fa');
      // 화이트보드 낙서: 상자와 화살표 다이어그램
      for (const [bx, by, c] of [[76, 7, '#61afef'], [100, 7, '#98c379'], [124, 11, '#e06c75']]) {
        R(g, bx, by, 14, 1, c); R(g, bx, by + 5, 14, 1, c); R(g, bx, by, 1, 6, c); R(g, bx + 13, by, 1, 6, c);
        R(g, bx + 3, by + 2, 8, 1, '#8a8fa3'); R(g, bx + 3, by + 3, 5, 1, '#8a8fa3');
      }
      R(g, 91, 9, 8, 1, '#3c4160'); R(g, 98, 8, 1, 3, '#3c4160');
      R(g, 115, 11, 8, 1, '#3c4160'); R(g, 122, 10, 1, 3, '#3c4160');
      R(g, 144, 7, 20, 1, '#c678dd'); R(g, 144, 10, 16, 1, '#c678dd'); R(g, 144, 13, 18, 1, '#c678dd');
      R(g, 74, 18, 96, 2, '#8a8fa3'); R(g, 80, 17, 6, 1, '#e06c75'); R(g, 88, 17, 6, 1, '#61afef');
      for (let c = 0; c < 5; c++) chair(g, 68 + c * 22, 55, true);
      table(g, 60, 62, 120, 32, '#6e4a2e');
      g.globalAlpha = 0.12; R(g, 64, 64, 112, 2, '#ffffff'); g.globalAlpha = 1;
      for (let c = 0; c < 5; c++) chair(g, 68 + c * 22, 94, false);
      shadow(g, 215, 46, 18, 2);
      box(g, 214, 26, 18, 20, '#6b4a2f', { top: 1, bottom: 0 });
      for (let r = 0; r < 2; r++) {
        R(g, 216, 28 + r * 8, 14, 6, '#3d2a1a');
        for (let b = 0; b < 4; b++) R(g, 217 + b * 3, 29 + r * 8, 2, 5, BOOKS[(b + r * 4) % BOOKS.length]);
      }
    }
    const prev = ROOM_BY_ID[Object.keys(ROOM_BY_ID).find((k) => ROOM_BY_ID[k].index === room.index - 1)];
    const next = ROOM_BY_ID[Object.keys(ROOM_BY_ID).find((k) => ROOM_BY_ID[k].index === room.index + 1)];
    if (prev) door(g, 'left');
    if (next) door(g, 'right');
    return cv;
  }
  const staticCache = {};

  // ---------- 파티클 (김, 먼지) ----------
  const parts = [];
  function emit(x, y, o = {}) {
    if (parts.length > 220) return;
    parts.push({ x, y, vx: o.vx ?? (Math.random() - 0.5) * 1.5, vy: o.vy ?? -5 - Math.random() * 3,
      life: 0, max: o.max ?? 1.4 + Math.random() * 0.6, c: o.c || '#ffffff', a: o.a ?? 0.45, room: o.room });
  }
  const chance = (rate, dt) => Math.random() < rate * dt;

  const lights = [];

  // ---------- 매 프레임: 캐릭터 아래에 그릴 것 ----------
  function drawBase(g, roomId, t, dt, sk, info = {}) {
    if (!staticCache[roomId]) staticCache[roomId] = buildStatic(roomId);
    g.drawImage(staticCache[roomId], 0, 0);
    lights.length = 0;
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].room !== roomId) parts.splice(i, 1);

    let winXs = [];
    if (roomId === 'office') {
      winXs = [40, 88, 136, 184];
      clock(g, 22, 11, t);
      for (let k = 0; k < 2; k++) for (let l = 0; l < 6; l++) { // 서버랙 LED
        const rx = 206 + k * 14, ly = 30 + l * 4;
        const on1 = Math.sin(t / 150 + l * 2 + k * 5) > 0.2, on2 = Math.sin(t / 97 + l * 3 + k) > 0.5;
        if (on1) { R(g, rx + 8, ly, 1, 1, '#7bd88f'); lights.push({ x: rx + 8.5, y: ly + 0.5, r: 3, c: '#7bd88f', a: 0.35 }); }
        if (on2) { R(g, rx + 9, ly, 1, 1, l % 2 ? '#ff9e64' : '#7aa2f7'); }
      }
      DESKS.forEach((_, i) => desk(g, i, info.desks?.[i]?.st || null, t, !!info.desks?.[i]?.occupied));
      plant(g, 220, 116, t, 1);
      if (chance(2.5, dt)) emit(10.5 + Math.random(), 129, { room: roomId });
      lights.push({ x: 11, y: 122, r: 4, c: '#7bd88f', a: 0.25 });    } else if (roomId === 'lounge') {
      winXs = [24, 174];
      // TV: 색이 흐르는 화면 + 주사선
      box(g, 92, 3, 56, 18, '#111318', { top: 0, bottom: 0 });
      for (let b = 0; b < 7; b++) R(g, 94, 5 + b * 2, 52, 2, `hsl(${(t / 30 + b * 18) % 360}, 45%, ${30 + b * 3}%)`);
      const bxp = 94 + ((Math.sin(t / 700) + 1) / 2) * 44, byp = 7 + ((Math.cos(t / 530) + 1) / 2) * 8;
      R(g, bxp, byp, 6, 3, '#f4efe1');
      // 주사선: 도트보다 가는 1px 선이라 R 대신 화면 좌표로 직접
      g.globalAlpha = 0.25; g.fillStyle = '#000';
      for (let b = 0; b < 14; b++) g.fillRect(94 * S, (5 + b) * S, 52 * S, 1);
      g.globalAlpha = 1;
      R(g, 140, 18, 1, 1, '#ff5c7a');
      lights.push({ x: 120, y: 14, r: 34, c: '#9fb8ff', a: 0.22 });
      for (let k = 0; k < 2; k++) { // 자판기 불빛
        const vx = 196 + k * 16, a = 0.12 + 0.05 * Math.sin(t / 400 + k);
        g.globalAlpha = a; R(g, vx + 2, 29, 10, 13, '#ffffff'); g.globalAlpha = 1;
        lights.push({ x: vx + 7, y: 36, r: 16, c: k ? '#ff9e9e' : '#9fd0ff', a: 0.25 });
      }
      // 탁구공: 포물선 + 그림자
      const ph = t / 320, bx = 120 + Math.sin(ph) * 24, hop = Math.abs(Math.cos(ph)) * 6;
      shadow(g, bx, 113, 1, 1, 0.35);
      R(g, bx, 112 - hop, 1, 1, '#ffffff');
      plant(g, 6, 30, t, 2); plant(g, 222, 122, t, 3);
      if (chance(1.8, dt)) emit(111 + Math.random(), 73, { room: roomId });
      if (chance(1.8, dt)) emit(125 + Math.random(), 73, { room: roomId });
    } else {
      winXs = [186];
      windowPane(g, 186, t, 5, sk);
      clock(g, 40, 11, t);
      for (let c = 0; c < 3; c++) { // 노트북
        const lx = 82 + c * 30;
        R(g, lx, 72, 10, 5, '#2a2d42'); R(g, lx - 1, 77, 12, 2, '#8a8fa3');
        const on = Math.sin(t / 700 + c * 2) > -0.3;
        R(g, lx + 1, 73, 8, 3, on ? '#2a4a7a' : '#1e3a2e');
        if (on) { R(g, lx + 2, 74, 3 + ((Math.floor(t / 400) + c) % 4), 1, '#c0caf5'); lights.push({ x: lx + 5, y: 74, r: 12, c: '#9fb8ff', a: 0.2 }); }
      }
      plant(g, 6, 126, t, 4);
    }
    if (roomId !== 'meeting') winXs.forEach((wx, i) => windowPane(g, wx, t, i, sk));
    shafts(g, winXs, sk);
    if (!sk.night && chance(3, dt) && winXs.length) { // 햇살 속 먼지
      const wx = winXs[Math.floor(Math.random() * winXs.length)], k = Math.random();
      emit(wx + 4 + k * 24 + Math.random() * 20, 28 + k * 40, { room: roomId, vx: 0.8, vy: 0.6, max: 3.5, c: '#fff6d8', a: 0.4 });
    }
  }

  // ---------- 매 프레임: 캐릭터 위에 덧그릴 것 ----------
  let vignette = null;
  function drawOver(g, roomId, dt, sk) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx += Math.sin(p.life * 3 + p.y) * dt * 2;
      if (p.life > p.max) { parts.splice(i, 1); continue; }
      g.globalAlpha = p.a * (1 - p.life / p.max);
      R(g, p.x, p.y, 1, 1, p.c);
    }
    g.globalAlpha = 1;
    if (sk.night) { g.fillStyle = 'rgba(10,14,45,0.32)'; g.fillRect(0, 0, WW * S, WH * S); }
    else if (sk.dusk || sk.dawn) { g.fillStyle = 'rgba(255,130,70,0.07)'; g.fillRect(0, 0, WW * S, WH * S); }
    // 빛번짐: 밤일수록 진하게
    const k = sk.night ? 1 : sk.day ? 0.35 : 0.65;
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const L of lights) {
      const x = L.x * S, y = L.y * S, r = L.r * S;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(L.c, L.a * k)); gr.addColorStop(1, rgba(L.c, 0));
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.restore();
    if (!vignette) {
      vignette = document.createElement('canvas'); vignette.width = WW * S; vignette.height = WH * S;
      const vg = vignette.getContext('2d');
      const gr = vg.createRadialGradient(WW * S / 2, WH * S / 2, WH * S * 0.45, WW * S / 2, WH * S / 2, WW * S * 0.62);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.38)');
      vg.fillStyle = gr; vg.fillRect(0, 0, WW * S, WH * S);
    }
    g.drawImage(vignette, 0, 0);
    void roomId;
  }

  return { sky, drawBase, drawOver, emit, sofaBackPiece };
};
