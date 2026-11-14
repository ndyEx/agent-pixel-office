// 알림: 에이전트가 승인을 기다리거나 작업을 마치면 효과음·데스크톱 알림을 보내고, 탭 제목에 대기 수를 띄운다.
// 설정(🔔 알림, 🔊 소리)은 브라우저마다 따로 저장한다 (데스크톱 알림 권한도 브라우저마다 따로라서).
import { flash } from '../util.js';
import { openDetail } from './detail-panel.js';

const PREF_KEY = 'po_notify';
const SOUNDS = { // 8비트 효과음: [주파수 Hz, 길이 초]
  waiting: [[880, 0.09], [1175, 0.09], [880, 0.09], [1175, 0.16]],
  done: [[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.2]],
};

const pref = (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } })(); // { on, sound }
const savePref = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch { /* 저장 불가 */ } };
const canNotify = () => 'Notification' in window;
const notifyAllowed = () => canNotify() && pref.on && Notification.permission === 'granted';

let notiBtn, soundBtn;
let audio = null;
let prevStates = null; // 공개 id → 지난번 상태 (첫 수신 때는 알리지 않음)

export function initNotify() {
  notiBtn = document.getElementById('noti-btn');
  soundBtn = document.getElementById('sound-btn');
  notiBtn.addEventListener('click', async () => {
    if (pref.on) pref.on = false;
    else {
      const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (perm === 'granted') pref.on = true;
      else flash('브라우저에서 알림이 막혀 있어요. 주소창 왼쪽 사이트 설정에서 허용해 주세요');
    }
    savePref(); renderButtons();
  });
  soundBtn.addEventListener('click', () => {
    pref.sound = !pref.sound; savePref(); renderButtons();
    if (pref.sound) beep('done'); // 들려주면서 오디오도 켠다 (브라우저는 클릭 뒤에만 소리를 허용)
  });
  // 새로고침 뒤에는 첫 클릭·키 입력 때 오디오를 깨워 둔다
  for (const ev of ['pointerdown', 'keydown'])
    addEventListener(ev, () => { if (pref.sound && audio?.state === 'suspended') audio.resume(); }, { capture: true });
  renderButtons();
}

function renderButtons() {
  notiBtn.hidden = !canNotify();
  const on = notifyAllowed();
  notiBtn.textContent = on ? '🔔 알림 켬' : '🔕 알림 끔';
  notiBtn.classList.toggle('on', on);
  notiBtn.title = on ? '다른 창을 보고 있을 때 승인 대기·작업 완료를 데스크톱 알림으로 알려요' : '데스크톱 알림 켜기';
  soundBtn.textContent = pref.sound ? '🔊 소리 켬' : '🔇 소리 끔';
  soundBtn.classList.toggle('on', !!pref.sound);
}

function beep(kind) {
  if (!pref.sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    let t = audio.currentTime + 0.02;
    for (const [freq, dur] of SOUNDS[kind]) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
      t += dur * 0.85;
    }
  } catch { /* 오디오 미지원 */ }
}

/** 에이전트 목록이 올 때마다: 상태가 바뀐 에이전트를 알리고, 탭 제목을 고친다 */
export function checkAlerts(list) {
  if (prevStates) {
    for (const d of list) {
      const prev = prevStates.get(d.id);
      if (!prev) continue;
      if (d.state === 'waiting' && prev !== 'waiting') alertAgent(d, 'waiting');
      // 침묵이 길어 휴식으로 바뀐 경우가 아니라 실제로 턴을 끝냈을 때만 (조수는 끝날 때마다 울리면 시끄러움)
      else if (!d.isSub && d.state === 'idle' && prev !== 'idle' && /^작업 완료/.test(d.detail)) alertAgent(d, 'done');
    }
  }
  prevStates = new Map(list.map((d) => [d.id, d.state]));
  const waiting = list.filter((d) => d.state === 'waiting').length;
  document.title = waiting ? `(${waiting}) ❗ 승인 대기 · Pixel Office` : 'Pixel Office';
}

function alertAgent(d, kind) {
  beep(kind);
  if (!notifyAllowed() || document.hasFocus()) return; // 보고 있는 중이면 소리만
  const title = kind === 'waiting' ? `❗ ${d.title} — 승인 대기` : `✔ ${d.title} — 작업 완료`;
  const what = kind === 'done' ? '작업을 마치고 다음 요청을 기다려요'
    : d.waitExact ? d.detail || '승인을 기다려요' : '한동안 응답이 없어요 (승인을 기다리는 것 같아요)';
  try {
    const n = new Notification(title, { body: `${d.project ? `${d.project} · ` : ''}${what}`, tag: `${kind}:${d.id}`, silent: !!pref.sound });
    n.onclick = () => { window.focus(); openDetail(d.id); n.close(); };
  } catch { /* 일부 모바일 브라우저는 페이지에서 바로 알림을 못 만듦 */ }
}
