// 매 프레임 그리기 (requestAnimationFrame)
//   1. 움직이기: 에이전트, 다른 사람, 나
//   2. 도트 캔버스: 배경 → 캐릭터(아래쪽이 앞) → 덧그림(김·밤 색조 등)
//   3. 글씨 캔버스: 말풍선·이름표·카드
import { canvas, ctx, scenery } from './canvas.js';
import { state, people } from './state.js';
import { moveAgents, deskScreens } from './agents.js';
import { moveMe, movePeople } from './players.js';
import { drawBody, personSprite } from './draw/characters.js';
import { drawLabels } from './draw/labels.js';

let last = performance.now();

export function startLoop() {
  requestAnimationFrame(frame);
}

function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t; // 탭이 잠깐 멈췄다 돌아와도 순간이동하지 않게
  const { me, viewRoom } = state;

  // 1. 움직이기 (에이전트는 화면에 안 보여도 사무실 안에서 계속 움직인다)
  const agentList = moveAgents(dt);
  movePeople(dt);
  moveMe(dt);

  // 2. 배경 + 움직이는 소품 (책상 모니터는 앉아 있는 에이전트 상태를 따름)
  const sky = scenery.sky();
  const info = { stats: state.statsSnap };
  if (viewRoom === 'office') info.desks = deskScreens(agentList);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  scenery.drawBase(ctx, viewRoom, t, dt, sky, info);

  const sprites = viewRoom === 'office' ? [...agentList] : [];
  for (const p of people.values()) if (p.room === viewRoom && (!me || p.name !== me.name)) sprites.push(personSprite(p, false));
  if (me && me.placed && me.room === viewRoom) {
    const mine = people.get(me.name); // 내 채팅 말풍선은 서버가 보낸 people 쪽에 있다
    sprites.push(personSprite({ ...me, say: mine?.say, sayAt: mine?.sayAt }, true));
  }
  sprites.sort((p, q) => p.y - q.y); // 아래쪽이 앞에 보이도록
  sprites.forEach((a) => drawBody(a, t));
  scenery.drawOver(ctx, viewRoom, dt, sky); // 김·먼지, 밤 색조, 빛번짐, 비네팅

  // 3. 글씨
  drawLabels(sprites, t, agentList.length);

  requestAnimationFrame(frame);
}
