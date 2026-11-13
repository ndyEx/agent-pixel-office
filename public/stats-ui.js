// 일일 통계 화면: 서버가 보낸 집계(snap)를 숫자 요약으로 바꾸고, 페이지의 통계 카드를 그린다.
// 회의실 화이트보드(scenery.js)와 마우스를 올렸을 때 뜨는 카드(office.js)도 같은 요약을 쓴다.
window.StatsUI = (function () {
  // 도구 유형: 에이전트 상태 색과 같은 색을 써서 화면 속 행동과 짝을 맞춘다
  const CATS = [
    { id: 'typing', label: '타이핑', color: '#7bd88f' },
    { id: 'reading', label: '자료 조사', color: '#f5c26b' },
    { id: 'terminal', label: '터미널', color: '#ff9e64' },
    { id: 'browsing', label: '브라우징', color: '#7aa2f7' },
    { id: 'meeting', label: '회의', color: '#bb9af7' },
    { id: 'working', label: '기타', color: '#7dcfff' },
  ];
  const AGENT = { claude: { label: 'Claude', color: '#d97757' }, codex: { label: 'Codex', color: '#e6e6f0' } };
  const sum = (d) => d.tools.claude + d.tools.codex;

  function fmtDur(ms) {
    if (!ms) return '0분';
    const m = Math.round(ms / 60000);
    if (m < 1) return '1분 미만';
    return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
  }
  const fmtDate = (key) => new Date(`${key}T00:00:00`).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  const weekday = (key) => new Date(`${key}T00:00:00`).toLocaleDateString('ko-KR', { weekday: 'short' });

  function summarize(snap) {
    const days = snap?.days;
    if (!days?.length) return null;
    const today = days[days.length - 1], yest = days[days.length - 2];
    const total = sum(today), yTotal = yest ? sum(yest) : 0;
    return {
      date: today.date, today, total, yTotal,
      delta: yTotal ? Math.round(((total - yTotal) / yTotal) * 100) : null, // 어제 기록이 없으면 비교하지 않음
      hours: today.hours.claude.map((c, i) => c + today.hours.codex[i]),
      cats: CATS.map((c) => ({ ...c, n: today.cats[c.id] || 0 })),
      week: days.map((d) => ({ date: d.date, n: sum(d) })),
      scanning: !!snap.scanning, progress: snap.progress ?? 1,
    };
  }

  function agentLine(s, a) {
    const d = s.today;
    return { label: AGENT[a].label, color: AGENT[a].color, tools: d.tools[a], time: fmtDur(d.activeMs[a]), turns: d.turns[a], sessions: d.sessions[a] };
  }

  // ---------- 페이지의 통계 카드 ----------
  function render(el, snap) {
    const s = summarize(snap);
    if (!s) { el.innerHTML = '<div class="stats-head"><h2>📊 오늘의 통계</h2></div><div class="detail">집계를 기다리는 중…</div>'; return; }
    const maxCat = Math.max(1, ...s.cats.map((c) => c.n));
    const maxHour = Math.max(1, ...s.hours);
    const maxWeek = Math.max(1, ...s.week.map((w) => w.n));
    const nowH = new Date().getHours();
    const delta = s.delta === null ? '<span class="delta">어제 기록 없음</span>'
      : `<span class="delta ${s.delta >= 0 ? 'up' : 'down'}">어제보다 ${s.delta >= 0 ? '+' : ''}${s.delta}%</span>`;
    const agents = ['claude', 'codex'].map((a) => {
      const l = agentLine(s, a);
      return `<div class="stats-agent"><span class="who ${a}">${l.label}</span><span><b>${l.tools}</b>회 · ${l.time} · 요청 ${l.turns} · 세션 ${l.sessions}</span></div>`;
    }).join('');
    const pct = (n, max) => (n ? Math.max(6, (n / max) * 100) : 0); // 0이 아니면 최소 높이는 보이게
    const cats = s.cats.map((c) => `<div class="stats-cat"><span>${c.label}</span>
      <span class="track"><span class="fill" style="width:${(c.n / maxCat) * 100}%;background:${c.color}"></span></span><b>${c.n}</b></div>`).join('');
    const hours = s.hours.map((n, i) => {
      const c = s.today.hours.claude[i], x = s.today.hours.codex[i];
      return `<div class="bar${i === nowH ? ' now' : ''}" title="${i}시 · ${n}회 (Claude ${c} · Codex ${x})">
        <span class="col" style="height:${pct(n, maxHour)}%"><span class="cl" style="flex:${c}"></span><span class="cx" style="flex:${x}"></span></span></div>`;
    }).join('');
    const week = s.week.map((w, i) => `<div class="wk${i === s.week.length - 1 ? ' today' : ''}" title="${w.date} · ${w.n}회">
      <b>${w.n || ''}</b><span class="col" style="height:${pct(w.n, maxWeek)}%"></span><span class="day">${weekday(w.date)}</span></div>`).join('');
    const peakHour = s.hours.indexOf(Math.max(...s.hours));
    el.innerHTML = `
      <div class="stats-head"><h2>📊 오늘의 통계</h2><span class="muted">${fmtDate(s.date)}</span>
        ${s.scanning ? `<span class="scan">집계 중 ${Math.round(s.progress * 100)}%</span>` : ''}</div>
      <div class="stats-big"><b>${s.total}</b>회 도구 사용 ${delta}</div>
      ${agents}
      <div class="stats-sub">도구 유형</div>${cats}
      <div class="stats-sub">시간대별 <small><span class="sw-c"></span>Claude <span class="sw-x"></span>Codex</small></div>
      <div class="bars" role="img" aria-label="시간대별 도구 사용${s.total ? `, 가장 바빴던 때 ${peakHour}시 ${s.hours[peakHour]}회` : ', 기록 없음'}">${hours}</div>
      <div class="bars-axis" aria-hidden="true"><span>0시</span><span>6시</span><span>12시</span><span>18시</span><span>24시</span></div>
      <div class="stats-sub">최근 7일</div>
      <div class="week" role="img" aria-label="최근 7일 도구 사용: ${s.week.map((w) => `${weekday(w.date)} ${w.n}회`).join(', ')}">${week}</div>`;
  }

  return { summarize, agentLine, fmtDur, fmtDate, render, CATS, AGENT };
})();
