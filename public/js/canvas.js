// 캔버스 두 장과 마우스 위치.
//   #office  도트 캔버스(960x600 고정). 배경·캐릭터를 그린다. 화면 폭에 맞춰 늘거나 줄어든다.
//   #labels  글씨 캔버스. 도트 캔버스 위에 겹쳐 실제 화면 해상도로 글씨를 그린다 (작은 화면에서도 글씨가 안 깨지게).
import { createScenery } from './lib/scenery.js';
import { DESKS, ROOM_BY_ID, DOOR_Y0, DOOR_Y1 } from './world.js';

export const S = 4; // 월드 1칸 = 도트 캔버스 4px

export let canvas, ctx;       // 도트 캔버스
export let L;                 // 글씨 캔버스의 그리기 도구
export let scenery;           // 방 배경·소품 (lib/scenery.js)
let labels;

/** k: 도트 캔버스 px → 화면 CSS px 배율, f: 글씨 배율 */
export const view = { k: 1, f: 1 };

/** 캔버스 위 마우스(또는 탭한) 위치. pinned는 터치로 탭해서 카드를 고정한 상태 */
export const pointer = { x: -1, y: -1, pinned: false };

export function initCanvas() {
  canvas = document.getElementById('office');
  ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  labels = document.getElementById('labels');
  L = labels.getContext('2d');
  scenery = createScenery({ S, DESKS, ROOM_BY_ID, DOOR_Y0, DOOR_Y1 });

  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { pointer.x = e.offsetX; pointer.y = e.offsetY; } });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pointer.pinned) pointer.x = pointer.y = -1; });
  canvas.addEventListener('pointerdown', (e) => { // 터치: 탭한 곳의 캐릭터 카드를 띄우고, 빈 곳을 탭하면 닫힘
    if (e.pointerType !== 'mouse') { pointer.x = e.offsetX; pointer.y = e.offsetY; pointer.pinned = true; }
  });
}

/** 매 프레임: 글씨 캔버스를 화면 크기에 맞추고 지운다 */
export function fitLabels() {
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!w) return;
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (labels.width !== bw || labels.height !== bh) {
    labels.width = bw; labels.height = bh;
    // 화면에서 줄어들 때 또렷하게(nearest) 줄이면 도트 줄이 빠져 보이므로 부드럽게 줄인다
    canvas.style.imageRendering = bw < canvas.width ? 'auto' : 'pixelated';
  }
  L.setTransform(dpr, 0, 0, dpr, 0, 0);
  L.clearRect(0, 0, w, h);
  view.k = w / canvas.width;
  view.f = Math.min(1.1, Math.max(0.82, view.k * 1.5)); // 폰에서도 9px 아래로는 안 줄어듦
}

export const FONT_FAMILY = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
export const font = (px, bold) => `${bold ? 700 : 500} ${Math.round(px * view.f)}px ${FONT_FAMILY}`;

// 캔버스 글씨는 웹폰트를 스스로 내려받지 않는다. Pretendard는 글자 범위별로 나눠 받으므로
// 캔버스에 처음 쓰는 글자(이름·채팅)가 생기면 그 글자가 든 조각을 미리 요청해 둔다.
const fontRequested = new Set();
export function ensureFont(text) {
  if (!document.fonts || fontRequested.has(text)) return;
  fontRequested.add(text);
  document.fonts.load(`500 12px "Pretendard Variable"`, text).catch(() => {});
}
