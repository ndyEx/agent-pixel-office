// 에이전트 캐릭터: 서버가 보낸 목록과 맞추고, 책상을 나눠 주고, 상태에 맞는 자리로 걸어가게 한다.
// 에이전트는 사무실에만 있고, 화면에 안 보여도 계속 움직인다.
import { state, agents, people } from './state.js';
import { DESKS, SPOTS, SEATS, dirFrom } from './world.js';
import { agentLook } from './looks.js';
import { hash } from './util.js';
import { poseOf } from './draw/characters.js';
import { renderAgentList } from './ui/agent-list.js';
import { renderTabs } from './ui/tabs.js';
import { checkAlerts } from './ui/notify.js';
import { refreshDetail } from './ui/detail-panel.js';

const WALK_SPEED = 45; // 월드 칸/초

/** 서버의 'agents' 이벤트: 목록이 바뀔 때마다 */
export function syncAgents(list) {
  state.sessions = list;
  const ids = new Set(list.map((d) => d.id));
  for (const id of agents.keys()) if (!ids.has(id)) agents.delete(id); // 퇴근
  for (const d of list) {
    let a = agents.get(d.id);
    if (!a) { // 출근: 사무실 아래 문에서 들어온다
      const look = agentLook(d.id, d.agent);
      a = { x: 120, y: 148, deskIndex: null, moving: true, dir: 'up', seed: hash(d.id) % 1000, look, band: look.band };
      agents.set(d.id, a);
    }
    a.data = d;
  }
  assignDesks();
  renderAgentList();
  renderTabs();
  checkAlerts(list);
  refreshDetail();
}

// 책상이 없는 에이전트에게 빈 책상을 준다 (서브에이전트는 책상 없이 가운데에 선다)
function assignDesks() {
  const used = new Set();
  for (const a of agents.values()) if (a.deskIndex != null) used.add(a.deskIndex);
  for (const a of agents.values()) {
    if (a.data.isSub || a.deskIndex != null) continue;
    const free = DESKS.findIndex((_, i) => !used.has(i));
    if (free >= 0) { a.deskIndex = free; used.add(free); }
  }
}

// 상태에 맞는 목표 위치. i는 같은 자리에 몰릴 때 조금씩 비켜 서게 하는 순번
function targetFor(a, i) {
  const st = a.data.state;
  const jitter = ((i * 7) % 5) * 6 - 12;
  if (SPOTS[st]) {
    const s = SPOTS[st];
    if (st === 'meeting') { // 회의 테이블을 둘러싼다
      const ang = (i / 6) * Math.PI * 2;
      return { x: s.x + Math.cos(ang) * 22, y: s.y + Math.sin(ang) * 10 };
    }
    if (st === 'idle') {
      // 쉬는 에이전트는 마주 보는 소파에 차례로 앉고, 다 차면 러그 오른쪽에 서서 쉰다
      const k = a.spotRank || 0;
      if (k < SEATS.length) return { x: SEATS[k].x, y: SEATS[k].y };
      const j = k - SEATS.length;
      return { x: 102 + (j % 3) * 9, y: 110 + (Math.floor(j / 3) % 4) * 9 };
    }
    return { x: s.x, y: s.y + jitter / 2 };
  }
  if (a.deskIndex != null) { const d = DESKS[a.deskIndex]; return { x: d.x + 19, y: d.y + 24 }; } // 의자 자리
  return { x: 120 + jitter * 2, y: 100 }; // 책상 없는 서브에이전트: 사무실 가운데
}

/** 매 프레임: 모든 에이전트를 목표 위치 쪽으로 걷게 한다 */
export function moveAgents(dt) {
  const list = [...agents.values()];
  let idleRank = 0;
  list.forEach((a) => { a.spotRank = a.data.state === 'idle' ? idleRank++ : 0; }); // 소파 몇 번째 자리
  list.forEach((a, i) => {
    const tg = targetFor(a, i);
    const dx = tg.x - a.x, dy = tg.y - a.y, dist = Math.hypot(dx, dy);
    a.moving = dist > 1;
    if (a.moving) { const sp = Math.min(dist, WALK_SPEED * dt); a.x += (dx / dist) * sp; a.y += (dy / dist) * sp; a.dir = dirFrom(dx, dy); }
    else a.dir = poseOf(a).dir;
  });
  return list;
}

/** 책상 모니터 상태 (lib/scenery.js가 그린다): 앉아 있는 에이전트 상태, 사람이 앉은 책상은 타이핑 */
export function deskScreens(list) {
  const atDeskAgent = new Map(list.filter((a) => a.deskIndex != null).map((a) => [a.deskIndex, a]));
  const humanDesks = new Set();
  for (const p of [...people.values(), state.me || {}]) if (p.room === 'office' && p.act?.id?.startsWith('desk')) humanDesks.add(+p.act.id.slice(4));
  return DESKS.map((_, i) => {
    const a = atDeskAgent.get(i);
    const atDesk = a && !a.moving && !SPOTS[a.data.state];
    if (!atDesk && humanDesks.has(i)) return { st: 'typing', occupied: true }; // 빈 의자는 감춘다
    return { st: atDesk ? a.data.state : null, occupied: !!atDesk };
  });
}

/** 그 자리를 에이전트가 쓰고 있나 (사람이 앉으려 할 때) */
export function agentUsesSpot(id) {
  for (const a of agents.values()) {
    if (id === `desk${a.deskIndex}` && !SPOTS[a.data.state]) return true;
    if (a.data.state === 'idle' && id === `sofa${a.spotRank}`) return true;
  }
  return false;
}
