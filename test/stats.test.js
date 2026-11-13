const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStats, dayKey } = require('../stats.js');

// 서버와 같은 분류 규칙 중 테스트에 필요한 만큼
const classifyClaude = (n) => (/^(Edit|Write)$/.test(n) ? 'typing' : /^(Read|Grep)$/.test(n) ? 'reading' : n === 'Bash' ? 'terminal' : 'working');
const classifyCodexCall = (p) => (/apply_patch/.test(`${p.name} ${p.input}`) ? 'typing' : 'terminal');

// 오늘 낮 10시를 기준으로, 분 단위로 이어지는 시각을 만든다
const base = new Date(); base.setHours(10, 0, 0, 0);
const at = (min, sec = 0) => new Date(base.getTime() + min * 60000 + sec * 1000).toISOString();
const NOW = base.getTime() + 60 * 60000; // 11:00

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

const asst = (ts, sid, tools) => ({ type: 'assistant', sessionId: sid, timestamp: ts, message: { content: tools.map((name) => ({ type: 'tool_use', name })) } });
const human = (ts, sid, text = '해줘') => ({ type: 'user', sessionId: sid, timestamp: ts, origin: { kind: 'human' }, message: { content: text } });
const result = (ts, sid) => ({ type: 'user', sessionId: sid, timestamp: ts, message: { content: [{ type: 'tool_result', content: 'ok' }] } });

function make(dir, files, opts = {}) {
  return createStats({ classifyClaude, classifyCodexCall, now: () => NOW, listFiles: () => files.map((p) => (typeof p === 'string' ? { path: p, agent: p.includes('rollout') ? 'codex' : 'claude' } : p)), ...opts });
}
const today = (s) => s.snapshot().days.at(-1);

test('Claude: 도구·유형·요청·시간대를 센다', (t) => {
  const dir = tmp(t), f = path.join(dir, 'aaaa.jsonl');
  fs.writeFileSync(f, jl([
    human(at(0), 'aaaa'),
    asst(at(1), 'aaaa', ['Edit', 'Read']),
    result(at(2), 'aaaa'),
    asst(at(3), 'aaaa', ['Bash']),
  ]));
  const s = make(dir, [f]);
  assert.equal(s.update(), true);
  const d = today(s);
  assert.deepEqual(d.tools, { claude: 3, codex: 0 });
  assert.equal(d.cats.typing, 1); assert.equal(d.cats.reading, 1); assert.equal(d.cats.terminal, 1);
  assert.equal(d.turns.claude, 1, '도구 결과는 요청이 아니다');
  assert.equal(d.hours.claude[10], 3);
  assert.equal(d.sessions.claude, 1);
  assert.equal(d.activeMs.claude, 3 * 60000, '0→3분 사이 이벤트가 이어지면 3분');
});

test('작업 시간: 5분 넘게 비면 쉰 시간으로 뺀다', (t) => {
  const dir = tmp(t), f = path.join(dir, 'aaaa.jsonl');
  fs.writeFileSync(f, jl([
    human(at(0), 'aaaa'), asst(at(2), 'aaaa', ['Read']), // 2분
    human(at(20), 'aaaa'), asst(at(21), 'aaaa', ['Read']), // 사이 18분은 제외, 1분
  ]));
  const s = make(dir, [f]); s.update();
  assert.equal(today(s).activeMs.claude, 3 * 60000);
});

test('포크로 복사된 기록(다른 sessionId)은 세지 않는다', (t) => {
  const dir = tmp(t), f = path.join(dir, 'bbbb.jsonl');
  fs.writeFileSync(f, jl([
    human(at(0), 'aaaa'), asst(at(1), 'aaaa', ['Edit', 'Edit', 'Edit']), // 원본 세션 것
    human(at(5), 'bbbb'), asst(at(6), 'bbbb', ['Bash']),                 // 복사본이 직접 한 일
  ]));
  const s = make(dir, [f]); s.update();
  const d = today(s);
  assert.equal(d.tools.claude, 1);
  assert.equal(d.turns.claude, 1);
});

test('슬래시 명령·시스템 알림은 요청으로 세지 않는다', (t) => {
  const dir = tmp(t), f = path.join(dir, 'aaaa.jsonl');
  const raw = (ts, content, extra = {}) => ({ type: 'user', sessionId: 'aaaa', timestamp: ts, message: { content }, ...extra });
  fs.writeFileSync(f, jl([
    human(at(0), 'aaaa'),                                                        // origin: human → 요청
    raw(at(1), '<command-name>/model</command-name>\n<command-args>x</command-args>'), // 슬래시 명령 기록
    raw(at(2), '<local-command-caveat>…</local-command-caveat>', { isMeta: true }),
    raw(at(3), '<system-reminder>알림</system-reminder>'),
    raw(at(4), '옛 형식 기록의 사람 메시지'),                                        // origin이 없는 예전 기록 → 요청
    raw(at(5), [{ type: 'text', text: '옛 형식 배열 메시지' }]),
    { ...raw(at(6), '앱이 넣은 메시지'), origin: { kind: 'system' } },
  ]));
  const s = make(dir, [f]); s.update();
  assert.equal(today(s).turns.claude, 3);
});

test('앱이 기록 파일을 다른 폴더로 옮겨도 처음부터 다시 세지 않는다', (t) => {
  const dir = tmp(t), a = path.join(dir, 'p1'), b = path.join(dir, 'p2');
  fs.mkdirSync(a); fs.mkdirSync(b);
  const from = path.join(a, 'aaaa.jsonl'), to = path.join(b, 'aaaa.jsonl');
  fs.writeFileSync(from, jl([human(at(0), 'aaaa'), asst(at(1), 'aaaa', ['Edit', 'Edit'])]));
  let where = from;
  let clock = NOW;
  const s = make(dir, [], { now: () => clock, listFiles: () => [{ path: where, agent: 'claude' }] });
  s.update();
  fs.renameSync(from, to); where = to;
  fs.appendFileSync(to, jl([asst(at(2), 'aaaa', ['Bash'])]));
  clock += 60_000; // 파일 목록을 다시 확인할 때가 됨
  s.update();
  const d = today(s);
  assert.equal(d.tools.claude, 3, '옮기기 전 2회 + 옮긴 뒤 새로 붙은 1회');
  assert.equal(d.turns.claude, 1);
});

test('같은 세션 파일이 두 곳에 있으면 한 번만 센다', (t) => {
  const dir = tmp(t), a = path.join(dir, 'p1'), b = path.join(dir, 'p2');
  fs.mkdirSync(a); fs.mkdirSync(b);
  const rows = jl([human(at(0), 'aaaa'), asst(at(1), 'aaaa', ['Edit'])]);
  fs.writeFileSync(path.join(a, 'aaaa.jsonl'), rows); fs.writeFileSync(path.join(b, 'aaaa.jsonl'), rows);
  const s = make(dir, [path.join(a, 'aaaa.jsonl'), path.join(b, 'aaaa.jsonl')]); s.update();
  assert.equal(today(s).tools.claude, 1);
  assert.equal(today(s).sessions.claude, 1);
});

test('세션이 다르면 이름이 같은 서브에이전트 기록도 따로 센다', (t) => {
  const dir = tmp(t), files = [];
  for (const sid of ['s1', 's2']) {
    const sub = path.join(dir, sid, 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    const f = path.join(sub, 'agent-1.jsonl');
    fs.writeFileSync(f, jl([asst(at(1), sid, ['Read'])]));
    files.push({ path: f, agent: 'claude', isSub: true });
  }
  const s = make(dir, files); s.update();
  assert.equal(today(s).tools.claude, 2);
});

test('서브에이전트: 도구는 세지만 요청·시간은 세지 않는다', (t) => {
  const dir = tmp(t), f = path.join(dir, 'agent-1.jsonl');
  fs.writeFileSync(f, jl([human(at(0), 'parent'), asst(at(1), 'parent', ['Read', 'Read'])]));
  const s = make(dir, [{ path: f, agent: 'claude', isSub: true }]); s.update();
  const d = today(s);
  assert.equal(d.tools.claude, 2);
  assert.equal(d.turns.claude, 0);
  assert.equal(d.activeMs.claude, 0);
  assert.equal(d.sessions.claude, 0);
});

test('Codex: 호출·턴·시간을 센다', (t) => {
  const dir = tmp(t), f = path.join(dir, 'rollout-x.jsonl');
  const row = (ts, type, payload) => JSON.stringify({ timestamp: ts, ordinal: 1, type, payload });
  fs.writeFileSync(f, [
    row(at(0), 'event_msg', { type: 'task_started' }),
    row(at(1), 'response_item', { type: 'custom_tool_call', name: 'exec', input: 'ls' }),
    row(at(1, 5), 'response_item', { type: 'custom_tool_call_output', output: 'x' }),
    row(at(2), 'response_item', { type: 'function_call', name: 'apply_patch', arguments: '{}' }),
    row(at(3), 'event_msg', { type: 'task_complete' }),
  ].join('\n') + '\n');
  const s = make(dir, [f]); s.update();
  const d = today(s);
  assert.deepEqual(d.tools, { claude: 0, codex: 2 });
  assert.equal(d.turns.codex, 1);
  assert.equal(d.cats.typing, 1); assert.equal(d.cats.terminal, 1);
  assert.equal(d.activeMs.codex, 3 * 60000);
  assert.equal(d.sessions.codex, 1);
});

test('Codex가 다른 에이전트 대화를 가져온 턴은 세지 않고, 그 뒤 진짜 턴부터 센다', (t) => {
  const dir = tmp(t), f = path.join(dir, 'rollout-imp.jsonl');
  const row = (ts, type, payload) => JSON.stringify({ timestamp: ts, type, payload });
  const imported = [];
  for (let i = 1; i <= 5; i++) imported.push(
    row(at(0), 'event_msg', { type: 'task_started', turn_id: `external-import-turn-${i}` }),
    row(at(0), 'event_msg', { type: 'user_message', message: '가져온 질문' }),
    row(at(0), 'event_msg', { type: 'task_complete' }));
  fs.writeFileSync(f, [...imported,
    row(at(10), 'event_msg', { type: 'task_started', turn_id: '01abc-real' }),
    row(at(11), 'response_item', { type: 'function_call', name: 'shell', arguments: '{}' }),
    row(at(12), 'event_msg', { type: 'task_complete' }),
  ].join('\n') + '\n');
  const s = make(dir, [f]); s.update();
  const d = today(s);
  assert.equal(d.turns.codex, 1, '가져온 5턴은 빼고 진짜 1턴만');
  assert.equal(d.tools.codex, 1);
  assert.equal(d.activeMs.codex, 2 * 60000);
});

test('가져오기만 한 Codex 세션은 세션 수에도 들어가지 않는다', (t) => {
  const dir = tmp(t), f = path.join(dir, 'rollout-imp.jsonl');
  const row = (ts, type, payload) => JSON.stringify({ timestamp: ts, type, payload });
  fs.writeFileSync(f, [
    row(at(0), 'event_msg', { type: 'task_started', turn_id: 'external-import-turn-1' }),
    row(at(0), 'event_msg', { type: 'task_complete' }),
  ].join('\n') + '\n');
  const s = make(dir, [f]); s.update();
  assert.equal(today(s).sessions.codex, 0);
  assert.equal(today(s).turns.codex, 0);
});

test('새로 붙은 줄만 이어서 센다 (다시 읽어도 중복 없음, 쓰다 만 줄은 기다림)', (t) => {
  const dir = tmp(t), f = path.join(dir, 'aaaa.jsonl');
  fs.writeFileSync(f, jl([human(at(0), 'aaaa'), asst(at(1), 'aaaa', ['Edit'])]));
  const s = make(dir, [f]); s.update();
  assert.equal(s.update(), false, '변화 없으면 false');
  assert.equal(today(s).tools.claude, 1);

  const line = JSON.stringify(asst(at(2), 'aaaa', ['Bash']));
  fs.appendFileSync(f, line.slice(0, 30));   // 줄이 반만 써진 상태
  s.update();
  assert.equal(today(s).tools.claude, 1);
  fs.appendFileSync(f, line.slice(30) + '\n');
  s.update();
  assert.equal(today(s).tools.claude, 2);

  const s2 = make(dir, [f]); s2.update();    // 서버를 다시 켠 것처럼 처음부터
  assert.equal(today(s2).tools.claude, 2, '재시작해도 같은 값');
});

test('큰 파일은 조금씩 읽으며 진행률을 알려 준다', (t) => {
  const dir = tmp(t), f = path.join(dir, 'aaaa.jsonl');
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push(asst(at(i % 50), 'aaaa', ['Read']));
  fs.writeFileSync(f, jl(rows));
  const s = make(dir, [f], { budget: 4096, chunk: 2048 });
  s.update();
  let snap = s.snapshot();
  assert.equal(snap.scanning, true);
  assert.ok(snap.progress > 0 && snap.progress < 1);
  for (let i = 0; i < 200 && s.snapshot().scanning; i++) s.update();
  snap = s.snapshot();
  assert.equal(snap.scanning, false);
  assert.equal(snap.days.at(-1).tools.claude, 200, '쪼개 읽어도 한 줄도 빠지거나 겹치지 않음');
});

test('오래된 날짜는 버리고, 어제는 따로 센다', (t) => {
  const dir = tmp(t), f = path.join(dir, 'aaaa.jsonl');
  const yesterday = new Date(base); yesterday.setDate(yesterday.getDate() - 1);
  const ancient = new Date(base); ancient.setDate(ancient.getDate() - 30);
  fs.writeFileSync(f, jl([
    asst(ancient.toISOString(), 'aaaa', ['Edit']),
    asst(yesterday.toISOString(), 'aaaa', ['Edit', 'Edit']),
    asst(at(1), 'aaaa', ['Edit']),
  ]));
  const s = make(dir, [f]); s.update();
  const snap = s.snapshot();
  assert.equal(snap.days.length, 7);
  assert.equal(snap.days.at(-1).date, dayKey(NOW));
  assert.equal(snap.days.at(-2).tools.claude, 2);
  assert.equal(snap.days.at(-1).tools.claude, 1);
  assert.equal(snap.days.reduce((n, d) => n + d.tools.claude, 0), 3, '30일 전 기록은 빠짐');
});

test('통계에는 명령어·파일명 같은 내용이 들어가지 않는다', (t) => {
  const dir = tmp(t), f = path.join(dir, 'aaaa.jsonl');
  fs.writeFileSync(f, jl([{ type: 'assistant', sessionId: 'aaaa', timestamp: at(1), message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'cat ~/비밀키.pem' } }] } }]));
  const s = make(dir, [f]); s.update();
  assert.ok(!JSON.stringify(s.snapshot()).includes('비밀키'));
});

test('깨진 줄·없는 파일이 있어도 멈추지 않는다', (t) => {
  const dir = tmp(t), f = path.join(dir, 'aaaa.jsonl');
  fs.writeFileSync(f, '{깨진 줄\n' + jl([asst(at(1), 'aaaa', ['Read'])]) + '\n{"type":"api-request","big":"' + 'x'.repeat(1000) + '"}\n');
  const s = make(dir, [f, path.join(dir, '없는파일.jsonl')]);
  assert.doesNotThrow(() => s.update());
  assert.equal(today(s).tools.claude, 1);
});
