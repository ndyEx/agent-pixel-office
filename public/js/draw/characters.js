// 캐릭터 그리기 (도트 캔버스): 몸, 자세, 손에 든 소품, 의자·소파 등받이.
// 말풍선·이름표 같은 글씨는 draw/labels.js가 글씨 캔버스에 따로 그린다.
//
// 그릴 대상(sprite)은 에이전트와 사람이 같은 모양이다:
//   { x, y, look, moving, dir, seed, data: { agent: 'claude'|'codex'|'human', state, isSub, title }, act?, isMe?, band? }
import { Sprites } from '../lib/sprites.js';
import { ctx, S, scenery } from '../canvas.js';
import { SEATS, SPOTS, dirFrom } from '../world.js';
import { humanLook } from '../looks.js';
import { hash } from '../util.js';
import { state } from '../state.js';

/** 사람(people의 항목 또는 나) → 그릴 대상 */
export function personSprite(p, isMe) {
  return { x: p.x, y: p.y, look: humanLook(p.name), moving: p.moving, dir: p.dir || 'down', act: p.act || null, seed: hash(p.name) % 1000,
    say: p.say, sayAt: p.sayAt, isMe, data: { title: p.name, state: 'human', agent: 'human', isSub: false } };
}

/** 멈춰 있을 때의 자세: 방향, 앉음, 동작(type/coffee/...), 앞에 덧그릴 등받이 */
export function poseOf(a) {
  if (a.data.agent === 'human') {
    const x = a.act;
    // c: 앞쪽에 등받이를 덧그림 (책상이면 의자, 휴게실 아래쪽 소파면 소파 등받이)
    const back = x?.c ? (x.id?.startsWith('sofa') ? 'sofa' : 'chair') : null;
    return x ? { dir: x.d, sit: x.p === 'sit', anim: x.a, back } : { dir: a.dir || 'down' };
  }
  const st = a.data.state;
  if (st === 'idle') {
    const seat = SEATS[a.spotRank || 0];
    return seat ? { dir: seat.d, sit: true, anim: 'coffee', back: seat.back ? 'sofa' : null } : { dir: 'down', anim: 'coffee' };
  }
  if (st === 'reading') return { dir: 'up', anim: 'read' };
  if (st === 'terminal') return { dir: 'up', anim: 'type' };
  if (st === 'meeting') return { dir: dirFrom(SPOTS.meeting.x - a.x, SPOTS.meeting.y - 3 - a.y) };
  if (a.deskIndex != null) return { dir: 'up', sit: true, back: 'chair', anim: st === 'typing' || st === 'working' ? 'type' : null };
  return { dir: 'down' };
}

/** 몸통을 그리고, 글씨를 붙일 머리 위치(a._top)를 기록한다 */
export function drawBody(a, t) {
  const st = a.data.state;
  const sc = a.data.isSub ? 0.75 : 1;
  const P = S * sc; // 도트 1개의 화면 크기
  const pose = a.moving ? { dir: a.dir || 'down' } : poseOf(a);
  const dir = pose.dir || 'down';
  const frame = a.moving ? Math.floor((t + a.seed * 37) / 110) % 4 : 0;
  const blink = (t + a.seed * 997) % 4200 < 130;
  // 팔 움직임: 타이핑은 빠르게, 판서·책 고르기는 천천히
  const armSpeed = { type: 110, write: 260, read: 700 }[pose.anim];
  const type = !!armSpeed && Math.floor(t / armSpeed) % 2 === 1;
  const spr = Sprites.get(a.look, { kind: a.data.agent, dir, frame, blink, type, sit: pose.sit });
  const w = spr.width * sc, h = spr.height * sc;
  let yOff = 0;
  if (a.moving && frame % 2 === 0) yOff = -P;                                       // 걸을 때 위아래 출렁임
  else if (!a.moving && st === 'waiting') yOff = Math.floor(t / 450) % 2 ? -P : 0;  // 승인 대기: 제자리 콩콩
  else if (!a.moving && st === 'thinking') yOff = Math.floor(t / 900) % 2 ? -P * 0.5 : 0;
  const sx = Math.round(a.x * S - w / 2), sy = Math.round(a.y * S - h + yOff);

  // 그림자
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(a.x * S, a.y * S - 1, 17 * sc, 5 * sc, 0, 0, Math.PI * 2); ctx.fill();
  if (dir === 'left') { ctx.save(); ctx.translate(sx + w, sy); ctx.scale(-1, 1); ctx.drawImage(spr, 0, 0, w, h); ctx.restore(); }
  else ctx.drawImage(spr, sx, sy, w, h);

  // 뒷모습으로 앉으면 등받이가 허리 아래를 가린다 (휴게실 아래쪽 소파, 책상 의자)
  if (pose.sit && pose.back === 'sofa' && dir === 'up') scenery.sofaBackPiece(ctx, a.x, 141);
  if (pose.sit && pose.back === 'chair' && dir === 'up') drawChairBack(a, P);
  if (!a.moving) drawProps(a, pose, sx, sy, P, t, spr.width / Sprites.PX);
  a._top = sy + (pose.sit ? 2 * P : 0); // 앉은 스프라이트는 위 2줄이 비어 있음
}

// 의자 등받이 (발끝 기준). 키 작은 Claude 캐릭터는 등받이도 낮게
function drawChairBack(a, P) {
  const cx = a.x * S, fy = a.y * S, bh = a.data.agent === 'claude' ? 3 : 5;
  ctx.fillStyle = '#1a1b26'; ctx.fillRect(cx - 4.5 * P, fy - (bh + 1) * P, 9 * P, bh * P);
  ctx.fillStyle = '#3c4160'; ctx.fillRect(cx - 3.5 * P, fy - bh * P, 7 * P, (bh - 2) * P);
  ctx.fillStyle = '#4a4f72'; ctx.fillRect(cx - 3.5 * P, fy - bh * P, 7 * P, P);
  ctx.fillStyle = '#2a2d42'; ctx.fillRect(cx - P, fy - P, 2 * P, 2 * P);
}

// 손에 든 소품: 스프라이트 안의 도트 좌표(lx, ly)로 그린다. 왼쪽을 볼 때는 좌우 반전
function drawProps(a, pose, sx, sy, P, t, W) {
  const { dir, anim } = pose;
  if (!anim || dir === 'up') return;
  const flip = dir === 'left';
  const dot = (lx, ly, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(sx + (flip ? W - lx - w : lx) * P, sy + ly * P, w * P, h * P); };
  const lift = pose.sit ? 2 : 0;          // 앉으면 손 위치도 2줄 내려감
  const side = dir !== 'down';
  const L0 = Sprites.layout(a.data.agent);
  const h0 = L0.hand[side ? 'side' : 'down'], s0 = L0.sip[side ? 'side' : 'down'];
  const hand = { x: h0.x, y: h0.y + lift };
  const sip = (t + a.seed * 300) % 4200 < 900; // 4초쯤마다 한 모금

  if (anim === 'coffee' || anim === 'soda') {
    // 마실 때는 컵이 입 앞으로 올라온다
    const at = sip ? { x: s0.x, y: s0.y + lift } : { x: hand.x, y: hand.y - 1 };
    if (anim === 'coffee') {
      dot(at.x - 0.5, at.y - 0.5, 3, 3.5, '#1a1b26');
      dot(at.x, at.y, 2, 2.5, '#f4efe1');
      dot(at.x, at.y, 2, 0.75, '#6b4a2f');
      if (!sip && Math.random() < 0.025) // 커피 김
        scenery.emit((sx + (flip ? W - at.x - 1 : at.x + 1) * P) / S, (sy + at.y * P) / S - 1, { room: state.viewRoom, a: 0.35 });
    } else {
      dot(at.x - 0.5, at.y - 0.5, 2.5, 3.5, '#1a1b26');
      dot(at.x, at.y, 1.5, 2.5, '#e06c75');
      dot(at.x, at.y, 1.5, 0.75, '#d8dce8');
    }
  } else if (anim === 'pingpong') {
    // 공이 내 쪽으로 오면 라켓을 휘두른다 (lib/scenery.js의 공 궤적과 같은 식)
    const bx = 120 + Math.sin(t / 320) * 24;
    const near = a.x < 120 ? bx < 104 : bx > 136;
    const p = near ? { x: 8, y: 6 + lift } : { x: 7, y: 9 + lift };
    dot(p.x - 0.5, p.y - 0.5, 3, 3, '#1a1b26');
    dot(p.x, p.y, 2, 2, a.x < 120 ? '#c94f4f' : '#2a2d42');
    dot(p.x + 0.5, p.y + 2, 1, 1.5, '#6b4a2f');
  }
}
