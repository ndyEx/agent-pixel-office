// 사무실 세계의 배치 데이터: 방, 책상, 에이전트가 가는 자리, 앉을 수 있는 곳, 지나갈 수 없는 가구.
// 좌표는 '월드 칸' 단위 (240 x 150). 화면에는 1칸 = 4px로 그린다 (canvas.js의 S).
// 가구 모양을 바꾸면 lib/scenery.js(그림)와 이 파일(자리·충돌)을 함께 고친다.

export const WORLD_W = 240, WORLD_H = 150;

// 방은 왼쪽→오른쪽으로 이어져 있고, 옆 벽의 문(DOOR_Y0~DOOR_Y1)으로 오간다
export const ROOMS = [
  { id: 'office',  name: '사무실', floor: ['#3a3f5c', '#363a55'], wall: '#4a4e6e' },
  { id: 'lounge',  name: '라운지', floor: ['#5a4632', '#54412e'], wall: '#5b4a6e' },
  { id: 'meeting', name: '회의실', floor: ['#2f4a4a', '#2b4545'], wall: '#3e5a5e' },
];
export const ROOM_BY_ID = Object.fromEntries(ROOMS.map((r, i) => [r.id, { ...r, index: i }]));
export const DOOR_Y0 = 72, DOOR_Y1 = 100;
export const SPAWN = { office: { x: 180, y: 140 }, lounge: { x: 14, y: 86 }, meeting: { x: 14, y: 86 } };

// ---------- 사무실: 에이전트 자리 ----------
// 책상 8개 (2줄 x 4개). 에이전트는 들어온 순서대로 빈 책상을 하나씩 받는다
export const DESKS = [];
for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) DESKS.push({ x: 56 + c * 36, y: 38 + r * 34 });

// 상태별로 걸어가는 곳 (여기 없는 상태는 자기 책상)
export const SPOTS = {
  reading:  { x: 22, y: 56 },   // 책장
  terminal: { x: 218, y: 56 },  // 서버랙
  meeting:  { x: 172, y: 118 }, // 회의 테이블
  idle:     { x: 30, y: 132 },  // 휴게 소파
};

// 휴게 소파 좌석: 가운데 테이블을 사이에 두고 마주 보는 4인용 소파 두 개
//   위쪽 소파는 정면(down)을 보고, 아래쪽 소파는 등을 보이며(up) 테이블 쪽을 본다
export const SEATS = [
  ...[36, 52, 68, 84].map((x) => ({ x, y: 118, d: 'down' })),
  ...[36, 52, 68, 84].map((x) => ({ x, y: 145, d: 'up', back: true })),
];
const LOUNGE_ZONE = { x: 12, y: 98, w: 96, h: 51 }; // 소파 주변 어디서든 멈추면 가장 가까운 빈자리에 앉음

// ---------- 사람: 상호작용 자리 ----------
// 내 캐릭터가 zone 안에서 잠깐 멈추면 자동으로 그 자리의 행동을 한다.
// to: 옮겨 갈 위치(없으면 제자리)  d: 바라볼 방향  a: 동작  p: 'sit'이면 앉음  c: 의자 등받이를 앞에 그림
//   동작: type(타이핑) coffee(커피 마시기) soda(음료) read(책 고르기) write(판서) pingpong(탁구)
export const ACT_SPOTS = {
  office: [
    ...DESKS.map((d, i) => ({ id: `desk${i}`, zone: { x: d.x + 10, y: d.y + 19, w: 18, h: 9 }, to: { x: d.x + 19, y: d.y + 24 }, d: 'up', a: 'type', p: 'sit', c: true })),
    ...SEATS.map((s, i) => ({ id: `sofa${i}`, zone: LOUNGE_ZONE, to: { x: s.x, y: s.y }, d: s.d, a: 'coffee', p: 'sit', c: !!s.back })),
    { id: 'coffeebar', zone: { x: 18, y: 116, w: 7, h: 22 }, d: 'left', a: 'coffee' },
    { id: 'books', zone: { x: 6, y: 52, w: 32, h: 6 }, d: 'up', a: 'read' },
    { id: 'rack', zone: { x: 206, y: 54, w: 26, h: 6 }, d: 'up', a: 'type' },
  ],
  lounge: [
    ...[45, 63, 81, 159, 177, 195].map((x, i) => ({ id: `lsofa${i}`, zone: { x: x - 8, y: 64, w: 17, h: 5 }, to: { x, y: 59 }, d: 'down', a: 'coffee', p: 'sit' })),
    { id: 'vending', zone: { x: 196, y: 56, w: 32, h: 6 }, d: 'down', a: 'soda' },
    { id: 'pingL', zone: { x: 80, y: 104, w: 8, h: 24 }, d: 'right', a: 'pingpong' },
    { id: 'pingR', zone: { x: 152, y: 104, w: 8, h: 24 }, d: 'left', a: 'pingpong' },
  ],
  meeting: [
    ...[0, 1, 2, 3, 4].map((c) => ({ id: `mtop${c}`, zone: { x: 66 + c * 22, y: 50, w: 12, h: 8 }, to: { x: 72 + c * 22, y: 61 }, d: 'down', p: 'sit' })),
    ...[0, 1, 2, 3, 4].map((c) => ({ id: `mbot${c}`, zone: { x: 66 + c * 22, y: 102, w: 12, h: 6 }, to: { x: 72 + c * 22, y: 101 }, d: 'up', p: 'sit' })),
    { id: 'board', zone: { x: 70, y: 28, w: 100, h: 8 }, d: 'up', a: 'write' },
    { id: 'shelf', zone: { x: 214, y: 48, w: 18, h: 6 }, d: 'up', a: 'read' },
  ],
};

// 사람 캐릭터가 지나갈 수 없는 가구 (발 위치 기준 사각형)
const OBSTACLES = {
  office: [
    { x: 6, y: 26, w: 32, h: 26 }, { x: 206, y: 26, w: 26, h: 28 },    // 책장, 서버랙
    ...DESKS.map((d) => ({ x: d.x, y: d.y + 8, w: 26, h: 9 })),
    { x: 152, y: 110, w: 40, h: 15 },                                  // 회의 테이블
    { x: 26, y: 104, w: 68, h: 45 },                                   // 마주 보는 소파+테이블
    { x: 6, y: 118, w: 10, h: 18 }, { x: 220, y: 112, w: 14, h: 26 },
  ],
  lounge: [
    { x: 36, y: 50, w: 54, h: 12 }, { x: 150, y: 50, w: 54, h: 12 },
    { x: 196, y: 26, w: 32, h: 28 }, { x: 90, y: 104, w: 60, h: 24 },
    { x: 8, y: 26, w: 12, h: 22 }, { x: 222, y: 120, w: 12, h: 20 },
  ],
  meeting: [
    { x: 60, y: 58, w: 120, h: 42 }, { x: 214, y: 26, w: 18, h: 22 },
    { x: 8, y: 124, w: 12, h: 20 },
  ],
};

/** (x, y)에 서 있을 수 없나 (벽 밖이거나 가구 위) */
export function blocked(room, x, y) {
  if (x < 5 || x > 235 || y < 30 || y > 148) return true;
  return OBSTACLES[room].some((r) => x > r.x - 2 && x < r.x + r.w + 2 && y > r.y && y < r.y + r.h + 2);
}

export const inZone = (x, y, z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;

/** 움직이는 방향(dx, dy) → 바라보는 방향 */
export const dirFrom = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
