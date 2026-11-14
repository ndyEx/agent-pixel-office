# 코드 구조 안내

처음 보는 개발자를 위한 지도입니다. 무엇이 어디에 있는지, 데이터가 어떻게 흐르는지, 무언가를 바꾸려면 어느 파일을 열어야 하는지 정리했습니다.

빌드 도구는 없습니다. 서버는 Node.js(CommonJS), 화면은 브라우저가 바로 읽는 ES 모듈입니다.

## 한눈에 보기

```
 ~/.claude/projects/**.jsonl ─┐
 ~/.codex/sessions/**.jsonl  ─┼─► server/agents/tracker.js ─► 에이전트 상태 ─┐
                              │      (1초마다 새 줄만 읽음)                    │
 Claude Code 훅 ──POST /api/hook──► server/agents/hooks.js ────────────────────┤
                              │                                                ├─► socket.io ─► 브라우저
                              └─► server/stats.js ─► 일일 통계 ────────────────┤      (agents, stats …)
                                                                               │
 브라우저 ─► 로그인·채팅·이동 ─► server/http.js · server/realtime.js ─► SQLite ─┘
```

브라우저는 받은 상태로 캐릭터의 목표 위치를 정하고, 매 프레임 그쪽으로 걸어가게 그립니다.

## 서버 (`server.js`, `server/`)

| 파일 | 하는 일 |
|---|---|
| `server.js` | 진입점. 설정을 읽고 앱을 시작합니다. |
| `server/config.js` | 포트, 기록 폴더 경로, 데이터 폴더 같은 설정값 |
| `server/app.js` | 부품을 만들어 서로 연결합니다. 1초마다 `tick()`으로 기록을 읽고, 바뀐 것만 모든 브라우저에 보냅니다. |
| `server/agents/tracker.js` | 기록 파일을 찾아 새로 붙은 줄만 이어 읽고, 세션 목록을 관리합니다. |
| `server/agents/claude-log.js` | Claude Code 기록 한 줄 → 세션 상태 변화 |
| `server/agents/codex-log.js` | Codex 기록 한 줄 → 세션 상태 변화, Codex 스레드 이름 |
| `server/agents/hooks.js` | Claude Code 훅 이벤트 → 승인 대기 표시 |
| `server/agents/classify.js` | 도구 이름 → 상태(타이핑·자료 조사·터미널…). 통계도 같은 기준을 씁니다. |
| `server/agents/session.js` | 세션 한 개의 상태 모양, 그리고 **브라우저로 보낼 공개 데이터**(`toPublic`) |
| `server/stats.js` | 기록을 날짜별로 세는 일일 통계 |
| `server/store.js` | SQLite: 계정, 로그인 토큰, 채팅, 직접 그린 캐릭터 |
| `server/auth.js` | 비밀번호 해시, 로그인 쿠키, 훅 토큰 |
| `server/avatar.js` | 직접 그린 캐릭터 데이터 검사 |
| `server/http.js` | `/api/*` (로그인·회원가입·캐릭터·훅)와 `public/` 정적 파일 |
| `server/realtime.js` | socket.io: 사람 이동, 채팅, 상세 패널 요청. 이벤트 목록이 파일 맨 위에 있습니다. |

### 🔒 보안 경계

이 페이지는 외부에 공개될 수 있고 누구나 가입할 수 있습니다. 그래서 **브라우저로 나가는 에이전트 데이터는 `server/agents/session.js`의 `toPublic()` / `toPublicDetail()`만 만듭니다.**

- 도구 이름, 상태, 시각, 횟수만 보냅니다.
- 명령어, 파일 경로, URL, 검색어, 요청 글은 서버에서 만들지도 않습니다(`classify.js`의 `toolLabel`).
- 세션 id도 파일 경로 대신 해시값(`publicId`)을 보냅니다.

새 필드를 화면에 보내고 싶다면 이 두 함수에 추가하고, `test/session.test.js`의 "nothing sent to browsers contains …" 테스트가 계속 통과하는지 확인하세요.

## 화면 (`public/`)

```
public/index.html        마크업
public/css/style.css     스타일
public/js/main.js        시작점: 각 모듈의 init*()를 순서대로 부르고 서버에 연결
```

**규칙: 모듈은 불러올 때 아무 일도 하지 않습니다.** DOM을 찾거나 이벤트를 다는 일은 `init*()` 함수 안에서 하고, `main.js`가 순서대로 부릅니다. 그래서 테스트에서 Node로 모듈을 바로 불러올 수 있습니다.

### 데이터와 공용

| 파일 | 하는 일 |
|---|---|
| `js/state.js` | 여러 모듈이 같이 쓰는 상태: 나(`state.me`), 보고 있는 방, 연결, 에이전트·사람 목록, 채팅 |
| `js/world.js` | 방 배치: 책상, 에이전트가 가는 자리, 앉을 수 있는 곳, 지나갈 수 없는 가구 |
| `js/display.js` | 상태 이름·색, 칭호, 에이전트 종류 칩 |
| `js/looks.js` | 캐릭터 외모(기본 모습, 직접 그린 캐릭터) |
| `js/util.js` | 작은 도구: HTML 이스케이프, 시간 표시, API 호출 |
| `js/connection.js` | socket.io 연결. 서버 이벤트를 각 모듈로 나눠 줍니다. |

### 움직임

| 파일 | 하는 일 |
|---|---|
| `js/agents.js` | 에이전트 목록 동기화, 책상 배정, 상태별 목표 위치, 걷기 |
| `js/players.js` | 내 캐릭터 이동(방향키·조이스틱), 자리에 앉기, 방 이동, 다른 사람 위치 맞추기 |
| `js/loop.js` | 매 프레임: 움직이기 → 배경 → 캐릭터 → 글씨 |

### 그리기 (`js/draw/`)

캔버스가 두 장입니다. 도트 캔버스(`#office`, 960×600 고정)에 배경과 캐릭터를 그리고, 그 위에 겹친 글씨 캔버스(`#labels`, 실제 화면 해상도)에 글씨를 그립니다. 작은 화면에서도 글씨가 깨지지 않게 하기 위해서입니다.

| 파일 | 하는 일 |
|---|---|
| `js/canvas.js` | 캔버스 두 장, 좌표 배율, 글꼴, 마우스 위치 |
| `js/draw/characters.js` | 캐릭터 몸, 자세, 손에 든 컵·라켓, 의자 등받이 |
| `js/draw/labels.js` | 말풍선, 이름표(겹치면 옆으로 펼침), 마우스를 올렸을 때 카드, 캐릭터 클릭 |
| `js/draw/whiteboard.js` | 회의실 화이트보드의 통계 글씨와 카드 |
| `js/lib/scenery.js` | 방 배경과 소품(창밖 하늘, 모니터, 탁구공, 밤 색조 …) |
| `js/lib/sprites.js` | 캐릭터 도트 스프라이트(문자열 도트맵 → 캔버스, 조합별 캐시) |

### 패널 (`js/ui/`)

| 파일 | 하는 일 |
|---|---|
| `ui/tabs.js` | 방 탭 (사람·에이전트 수, 안 읽은 채팅 수) |
| `ui/agent-list.js` | 세션 카드 목록 |
| `ui/chat.js` | 방별 채팅 |
| `ui/auth.js` | 로그인·회원가입·로그아웃, 캐릭터 꾸미기 버튼 |
| `ui/notify.js` | 승인 대기·작업 완료 알림(효과음, 데스크톱 알림, 탭 제목) |
| `ui/detail-panel.js` | 에이전트 상세 패널 |
| `ui/stats-card.js` | 오늘의 통계 카드 (`lib/stats-ui.js`가 그림) |
| `lib/avatar-editor.js` | 도트 캐릭터 편집기 |

## 이걸 바꾸려면 어디를?

| 하고 싶은 일 | 고칠 곳 |
|---|---|
| 새 도구를 다른 행동으로 보이게 | `server/agents/classify.js` |
| 새 상태 추가 | `classify.js` → `public/js/display.js`(이름·색) → `public/js/world.js`의 `SPOTS`(갈 곳) → `draw/characters.js`의 `poseOf`(자세) |
| 다른 에이전트(예: 새 CLI) 지원 | `server/agents/`에 `xxx-log.js`를 만들고 `tracker.js`의 `LOG_READERS`와 파일 찾기에 추가 |
| 가구 배치 변경 | 그림은 `public/js/lib/scenery.js`, 자리·충돌은 `public/js/world.js` |
| 새 서버 → 화면 이벤트 | 보내기: `server/app.js` 또는 `server/realtime.js`, 받기: `public/js/connection.js` |
| 새 API | `server/http.js` |
| DB 표 추가 | `server/store.js` (`SCHEMA`와 `q`) |
| 화면 문구·색 | 상태는 `display.js`, 그 밖에는 해당 `ui/*.js`와 `css/style.css` |

## 테스트

```bash
npm test
```

- `test/session.test.js`: 실제 서버를 임시 폴더와 메모리 DB로 띄워서 로그인, 여러 탭 동기화, 채팅, 캐릭터, 훅, 보안 경계를 확인합니다. 화면 모듈(`players.js`)도 Node에서 불러와 확인합니다.
- `test/stats.test.js`: 일일 통계 집계를 확인합니다.

서버는 `createApp(config)`로 만들어지므로, 테스트에서는 `config`의 경로와 DB만 바꿔서 그대로 띄웁니다.
