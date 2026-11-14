// 로그인·회원가입·로그아웃, 그리고 로그인한 뒤에 쓰는 '캐릭터 꾸미기' 버튼.
// 로그인은 서버가 쿠키를 심으므로, 상태가 바뀌면 실시간 연결을 새 쿠키로 다시 맺는다.
import { state } from '../state.js';
import { canvas } from '../canvas.js';
import { api, flash } from '../util.js';
import { lookFor, avatars, setAvatar } from '../looks.js';
import { AvatarEditor } from '../lib/avatar-editor.js';
import { stopInput, setJoystickVisible, isTouch } from '../players.js';
import { connect } from '../connection.js';
import { renderChat } from './chat.js';

const newMe = (name) => ({ name, room: 'office', x: 0, y: 0, placed: false }); // placed: 서버가 자리를 알려 주기 전

export function initAuth() {
  document.getElementById('auth-form').addEventListener('submit', (e) => { e.preventDefault(); doAuth('login'); });
  document.getElementById('signup').addEventListener('click', () => doAuth('signup'));
  document.getElementById('logout').addEventListener('click', async () => {
    await api('/api/logout').catch(() => {});
    state.me = null; stopInput(); renderAuth(); connect();
  });
  document.getElementById('edit-avatar').addEventListener('click', () => {
    const { me } = state;
    if (!me) return;
    stopInput();
    AvatarEditor.open({
      base: lookFor(me.name),
      current: avatars.get(me.name) || null,
      onSave: async (avatar) => {
        await api('/api/avatar', { avatar });
        setAvatar(me.name, avatar); // 서버 알림을 기다리지 않고 내 화면에 바로 반영
      },
    });
  });
}

/** 페이지를 열 때: 이미 로그인돼 있으면(쿠키) 나를 준비한다 */
export async function loadMe() {
  try {
    const { name } = await fetch('/api/me').then((r) => r.json());
    if (name) state.me = newMe(name);
  } catch { /* 서버 꺼짐 */ }
}

/** 로그인 상태에 맞게 상단바·조이스틱·채팅 입력칸을 바꾼다 */
export function renderAuth() {
  const { me } = state;
  document.getElementById('auth-out').hidden = !!me;
  document.getElementById('auth-in').hidden = !me;
  if (me) document.getElementById('me-name').textContent = me.name;
  setJoystickVisible(!!me && isTouch());
  renderChat();
}

async function doAuth(kind) {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  try {
    const { name } = await api(`/api/${kind}`, { username, password });
    state.me = newMe(name);
    document.getElementById('password').value = '';
    renderAuth(); connect(); canvas.focus();
  } catch (err) { flash(err.message); }
}
