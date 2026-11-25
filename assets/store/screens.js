// capturas de tienda: pantallas de sis replicadas en html, marcos de marketing por dispositivo e
// idioma, galería de revisión y modo export (#x.<device>.<n>.<lang>) que usa render.mjs.
// la ui de sis va en inglés; solo fechas y cifras siguen el idioma (como en la app con el navegador en es).
(() => {
  'use strict';

  let LANG = 'en';
  const L = (en, es) => (LANG === 'es' ? es : en);
  // cifras con el separador de miles del idioma, como toLocaleString en la app
  const N = (n) => n.toLocaleString(LANG === 'es' ? 'es-ES' : 'en-US', { useGrouping: n >= 1000 ? 'always' : false });

  // ---------- marca ----------
  const wordmark = (h, ink = 'var(--text)') =>
    `<svg height="${h}" viewBox="-8 7.8 178 107.2" aria-label="sis" style="display:block;flex:0 0 auto"><path d="M43 48H14A7 7 0 0 0 7 55V67A7 7 0 0 0 14 74H36A7 7 0 0 1 43 81V93A7 7 0 0 1 36 100H7M81 100V48M65.88 48H81M63 100H99M155 48H126A7 7 0 0 0 119 55V67A7 7 0 0 0 126 74H148A7 7 0 0 1 155 81V93A7 7 0 0 1 148 100H119" fill="none" stroke="${ink}" stroke-width="14" stroke-linecap="square" stroke-linejoin="miter"/><rect x="72.25" y="15.8" width="17.5" height="17.5" fill="var(--accent)"/></svg>`;

  // barras del sistema (mismas piezas que las capturas de duckhunt)
  const IOS_SIGNAL = `<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx=".7" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx=".7" fill="currentColor"/><rect x="10" y="3" width="3" height="9" rx=".7" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx=".7" fill="currentColor"/></svg>`;
  const IOS_WIFI = `<svg width="16" height="12" viewBox="0 0 16 12"><path fill="currentColor" d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.2A10.2 10.2 0 0 0 8 .5 10.2 10.2 0 0 0 .8 3.4L2 4.6a8.5 8.5 0 0 1 6-2.4Zm0 3.4c1.4 0 2.6.5 3.6 1.4l1.2-1.2A6.9 6.9 0 0 0 8 3.9a6.9 6.9 0 0 0-4.8 1.9L4.4 7A5.1 5.1 0 0 1 8 5.6Zm0 3.4c.5 0 1 .2 1.3.5L8 10.8 6.7 9.5c.3-.3.8-.5 1.3-.5Z"/></svg>`;
  const IOS_BATT = `<svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2" fill="currentColor"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="currentColor" opacity=".45"/></svg>`;
  const AND_WIFI = `<svg width="15" height="12" viewBox="0 0 24 19"><path d="M12 19 0 4.5C3.3 1.8 7.5 0 12 0s8.7 1.8 12 4.5Z" fill="currentColor"/></svg>`;
  const AND_SIGNAL = `<svg width="12" height="12" viewBox="0 0 12 12"><path d="M12 0v12H0Z" fill="currentColor"/></svg>`;
  const AND_BATT = `<svg width="8" height="13" viewBox="0 0 8 13"><rect x="2.5" y="0" width="3" height="1.6" fill="currentColor"/><rect x="0" y="1.6" width="8" height="11.4" rx="1" fill="currentColor"/></svg>`;

  // ---------- siluetas procedurales: los amigos del sidebar (nada de otros usuarios reales) ----------
  const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261);
  const PALETTES = [
    ['#e0663a', '#f4c26b', '#2a1320'],
    ['#2f6fa8', '#9fd3e6', '#0d1b2c'],
    ['#7b3fa0', '#e58fd0', '#1a0f26'],
    ['#1f7a5c', '#bfe39a', '#0b1f18'],
    ['#c23b4a', '#f2d0a4', '#240c12'],
    ['#3d4fb8', '#f0b35a', '#10132e'],
    ['#d98f2b', '#2b2f5e', '#fbe6c2'],
    ['#2aa39a', '#f47e6a', '#0c2426'],
    ['#8a8f3a', '#e9e2c8', '#1c1d10'],
    ['#5a2d82', '#43c6c9', '#140b22'],
    ['#b8563a', '#6fb0c9', '#1d1411'],
    ['#264653', '#e9c46a', '#e76f51'],
  ];
  const palette = (seed) => PALETTES[hash(seed) % PALETTES.length];
  // silueta de cabeza y hombros sobre un fondo de su paleta
  const photoBg = (seed) => {
    const [a, b, c] = palette(seed);
    return `radial-gradient(circle at 50% 40%, rgb(0 0 0 / 0.42) 0 19%, transparent 19.5%), radial-gradient(ellipse 46% 34% at 50% 100%, rgb(0 0 0 / 0.42) 0 99%, transparent 100%), radial-gradient(circle at 30% 20%, ${b}, transparent 70%), linear-gradient(160deg, ${a}, ${c})`;
  };
  const photo = (seed, size) => `<div class="cv round" style="width:${size}px;height:${size}px;background:${photoBg(seed)}"></div>`;

  // portada o foto real (data/img del snapshot) sobre el fondo de la app mientras carga
  const art = (img, size, round = false) => `<div class="cv${round ? ' round' : ''}" style="width:${size}px;height:${size}px;background:var(--bg-hover) center / cover no-repeat url(${img})"></div>`;

  // ---------- datos reales de la cuenta (assets/store/data: lo genera snapshot.ts, gitignored) ----------
  // canciones, artistas, cifras y portadas de verdad; los amigos siguen siendo siluetas (nada de otros
  // usuarios). la forma de cada bloque está en la cabecera de snapshot.ts
  const D = window.SNAPSHOT;
  if (!D) throw new Error('[store] falta assets/store/data/snapshot.js: corre snapshot.ts (uso en su cabecera)');
  const LOCALE = () => (LANG === 'es' ? 'es-ES' : 'en-US');
  // fechas yyyy-mm-dd (o iso) en el idioma, a mediodía utc para que la zona no cambie el día
  const fmtDate = (iso, opts) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(LOCALE(), { timeZone: 'UTC', ...opts });
  const SHORT_DATE = { month: 'short', day: 'numeric' };
  // decimales con la coma del idioma (toLocaleString de la app)
  const dec = (n, digits = 1) => n.toLocaleString(LOCALE(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const hrs = (min) => `${dec(min / 60)}h`;
  const MIN_PER_H = 60;
  const hm = (m) => (m >= MIN_PER_H ? `${Math.floor(m / MIN_PER_H)}h ${String(m % MIN_PER_H).padStart(2, '0')}m` : `${m}m`);
  const DAYS = () => D.dashboard.last7.map((d, i, a) => (i === a.length - 1 ? 'Today' : fmtDate(d.date, { weekday: 'short' })));
  const pct = (now, before) => Math.round(((now - before) / before) * 100);
  const medal = (r) => (r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? 'bronze' : '');

  // ---------- chrome de la app ----------
  const TABS = [['~', 'listen'], ['*', 'stats'], ['!', 'highlights'], ['+', 'library'], ['=', 'feed']];
  const SIDEBAR = [
    ['stats', [['*', 'rankings'], ['%', 'charts']]],
    ['highlights', [['!', 'insights'], ['^', 'records'], ['¶', 'reports']]],
    ['library', [['+', 'playlists'], ['@', 'concerts'], ['&', 'generators']]],
  ];
  const sysbar = (dev) => {
    if (dev === 'ios-phone') return `<div class="sys ios-phone"><div class="left">9:41</div><div class="right">${IOS_SIGNAL}${IOS_WIFI}${IOS_BATT}</div></div>`;
    if (dev === 'ios-tablet') return `<div class="sys ios-tablet"><div class="left">9:41 <span style="font-weight:500">${fmtDate(D.asOf, { weekday: 'short', ...SHORT_DATE })}</span></div><div class="right">${IOS_WIFI}<span style="font-weight:500">100 %</span>${IOS_BATT}</div></div>`;
    return `<div class="sys android"><div class="left">9:41</div><div class="right">${AND_WIFI}${AND_SIGNAL}${AND_BATT}</div></div>`;
  };
  const homeInd = (dev, bg = 'var(--bg-card)') => {
    if (dev === 'ios-phone') return `<div class="home-ind" style="flex-basis:30px;background:${bg}"></div>`;
    if (dev === 'ios-tablet') return '<div class="home-ind tablet" style="flex-basis:20px;background:var(--bg)"></div>';
    return `<div class="home-ind android" style="flex-basis:${dev === 'android-phone' ? 16 : 18}px;background:${dev === 'android-phone' ? bg : 'var(--bg)'}"></div>`;
  };
  // la cuenta (sin correo: debajo del nombre, la instancia) y lo que sonaba al cerrar el snapshot
  const USER_INITIAL = D.user.name[0].toUpperCase();
  const INSTANCE = 'sis.fm';
  const NOW = D.dashboard.nowPlaying;
  const SESSION = D.dashboard.session;
  const mobileHeader = () => `<div class="mh">${wordmark(22)}<span class="search">Search...</span><span class="avatar">${USER_INITIAL}</span></div>`;
  const sessionStrip = () => {
    const seg = `session · ${SESSION.tracks} tracks · ${SESSION.minutes} min`;
    return `<div class="session-strip">${Array.from({ length: 4 }, () => `<span>${seg}</span>`).join('')}</div>`;
  };
  const mini = () => `<div class="mini">${art(NOW.img, 34)}<div class="grow"><div class="t ell">${NOW.name}</div><div class="a ell">${NOW.artist}</div></div><span class="btn">⏮</span><span class="btn play">❚❚</span><span class="btn">⏭</span><span class="btn heart">♥</span></div>`;
  const tabbar = (active) => `<div class="tabbar">${TABS.map(([i, n]) => `<span class="${n === active ? 'on' : ''}"><i>${i}</i>${n}</span>`).join('')}</div>`;
  // la tablet android (1280x800) es más baja que el ipad: menos filas y menos pie de sidebar
  const isShort = (dev) => dev === 'android-tablet';
  // duo: con el rail nativo la app quita la nav del sidebar (los mismos grupos van en el rail) y el
  // pie no se recorta
  const sidebar = (active, short = false, duo = false) => `
    <aside class="sidebar">
      <div class="sb-top"><div class="sb-logo">${wordmark(27)}<span class="sb-collapse">«</span></div><div class="sb-search"><span class="q">?</span>Search<span class="kbd">⌘K</span></div></div>
      ${duo ? '' : `<nav class="sb-nav">${SIDEBAR.map(([h, items]) => `<div class="sb-head">${h}</div>${items.map(([i, n]) => `<div class="sb-item${n === active ? ' on' : ''}"><i>${i}</i>${n}</div>`).join('')}`).join('')}</nav>`}
      <div class="sb-foot" style="padding-bottom:${duo ? 'var(--duo-bottom)' : `${TABLET_CROP}px`}">
        ${short ? '' : `<div class="sb-friends"><span class="lbl">friends</span><div class="faces">${['cy', 'sm', 'tr'].map((k) => photo(`friend-${k}`, 24)).join('')}</div></div>
        <div class="sb-sess"><span>session</span><span>${SESSION.tracks} tracks · ${SESSION.minutes} min</span></div>`}
        ${short ? '' : `<div class="np"><div class="row" style="gap:8px">${art(NOW.img, 32)}<div class="grow"><div class="t ell">${NOW.name}</div><div class="a ell">${NOW.artist}</div></div></div><div class="ctl"><span>⏮</span><span class="p">❚❚</span><span>⏭</span><span style="color:var(--like)">♥</span></div><div class="prog"><span>1:48</span><span class="bar" style="--p:52%"><i></i></span><span>3:27</span></div></div>`}
        <div class="sb-user"><span class="avatar" style="width:30px;height:30px;font-size:12px">${USER_INITIAL}</span><div><div class="n">${D.user.name}</div><div class="i">${INSTANCE}</div></div><span class="dots">⋯</span></div>
        <div class="sb-ver">26w40j · made by mier.info</div>
      </div>
    </aside>`;
  // lo que el recorte del dispositivo tapa por abajo en tablet (px lógicos)
  const TABLET_CROP = 80;
  // ---------- iPhone Duo ----------
  // la columna lateral del sistema, el rail de pestañas y los marcos son el cromo compartido de
  // platform (window.StoreDuo, platform/tooling/store/duo); aquí sis dentro, como en la app con la
  // barra nativa: cerrado, el layout móvil sin pestañas web (van en el rail) y el panel de sesión +
  // mini player al pie; abierto en apaisado, el de escritorio con el sidebar sin su nav.
  const { StoreDuo } = window;
  // los grupos de pestañas de +layout con su sf symbol (los mismos que la barra nativa)
  const DUO_TABS = [['listen', 'house'], ['stats', 'chart.bar'], ['highlights', 'star'], ['library', 'square.stack'], ['feed', 'person.2']];
  // pestaña del rail de una pantalla de escritorio: el grupo de su item del sidebar
  const groupOf = (item) => SIDEBAR.find(([, items]) => items.some(([, n]) => n === item))?.[0] ?? null;
  const duoShell = (dev, o) => {
    const back = o.backdrop ? `<div class="hero-bg" style="background:${o.backdrop}"></div>` : '';
    if (dev === StoreDuo.DEV.closed) {
      return `<div class="app duo">${back}${mobileHeader()}<div class="main m" style="${o.mainStyle ?? ''}">${o.main}</div>${sessionStrip()}${mini()}${StoreDuo.column({ camera: true, tabs: DUO_TABS, active: o.tab })}${StoreDuo.home()}</div>`;
    }
    return `<div class="app duo"><div class="body">${sidebar(o.nav, false, true)}<div class="main" style="${o.mainStyle ?? ''}">${back}${o.main}</div></div>${StoreDuo.column({ tabs: DUO_TABS, active: o.tab ?? groupOf(o.nav) })}${StoreDuo.home()}</div>`;
  };

  const shell = (dev, o) => {
    if (dev.startsWith('ios-duo')) return duoShell(dev, o);
    const phone = dev.endsWith('phone');
    const island = dev === 'ios-phone' ? '<div class="island"></div>' : dev === 'android-phone' ? '<div class="punch"></div>' : '';
    const back = o.backdrop ? `<div class="hero-bg" style="background:${o.backdrop}"></div>` : '';
    if (phone) {
      return `<div class="app">${island}${back}${sysbar(dev)}${mobileHeader()}<div class="main m" style="${o.mainStyle ?? ''}">${o.main}</div>${sessionStrip()}${mini()}${tabbar(o.tab)}${homeInd(dev)}</div>`;
    }
    return `<div class="app">${sysbar(dev)}<div class="body">${sidebar(o.nav, isShort(dev))}<div class="main" style="${o.mainStyle ?? ''}">${back}${o.main}</div></div>${homeInd(dev)}</div>`;
  };

  // ---------- piezas ----------
  const stat = (v, l, s, style = '', vStyle = '') => `<div class="stat" style="${style}"><div class="v" style="${vStyle}">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
  const delta = (pct) => (pct >= 0 ? `<span class="up">▲ ${pct}%</span>` : `<span class="down">▼ ${-pct}%</span>`);
  const weekStrip = (h) => {
    const vals = D.dashboard.last7.map((d) => d.minutes);
    const max = Math.max(...vals);
    const last = vals.length - 1;
    return `<div class="week"><div class="max">${vals[last]} min</div><div class="bars" style="height:${h}px">${vals.map((v, i) => `<i class="${i === last ? 'today' : ''}" style="height:${Math.max(4, (v / max) * h)}px"></i>`).join('')}</div><div class="days">${DAYS().map((d, i) => `<span class="${i === last ? 'today' : ''}">${d}</span>`).join('')}</div></div>`;
  };
  // x = { name, artist, img } del snapshot
  const trackRow = (r, x, main, sub, size = 36) => `<div class="tr"><span class="rk ${medal(r)}">${r}</span>${art(x.img, size)}<div class="info"><span class="t ell">${x.name}</span><span class="a ell">${x.artist}</span></div><div class="meta"><b>${main}</b><span>${sub}</span></div></div>`;
  const card = (title, body, right = '', style = '') => `<section class="card" style="${style}"><div class="sec-head"><span class="sec-title">${title}</span>${right}</div>${body}</section>`;
  const topTracks = (n, size) => `<div class="tracks">${D.dashboard.topTracksWeek.slice(0, n).map((x, i) => trackRow(i + 1, x, `${x.minutes} min`, `${x.plays} plays`, size)).join('')}</div>`;
  const COLLAGE_LABELS = 3;
  const collage = (items, round) =>
    `<div class="collage">${items
      .slice(0, 5)
      .map((x, i) => `<div style="background:var(--bg-hover) center / cover no-repeat url(${x.img})${round ? ';border-radius:0' : ''}"><span class="n ${i === 0 ? 'gold' : ''}">${i + 1}</span>${i < COLLAGE_LABELS ? `<span class="lbl">${x.name}<small>${x.minutes} min</small></span>` : ''}</div>`)
      .join('')}</div>`;
  const TABS3 = (active) => `<div class="tabs">${[['♫', 'tracks'], ['◉', 'albums'], ['♙', 'artists']].map(([i, n]) => `<span class="${n === active ? 'on' : ''}">${i} ${n}</span>`).join('')}</div>`;

  // ---------- pantallas ----------
  // las cifras del dashboard: [hoy, escuchado hoy, semana, racha, total]
  const dashStats = () => {
    const d = D.dashboard;
    return [
      stat(N(d.playsToday), 'plays today', `${N(d.playsYesterday)} yesterday`),
      stat(hrs(d.minutesToday), 'listened today', `${hrs(d.minutesYesterday)} yesterday`),
      stat(`${dec(d.weekHours)}h`, 'this week', `${delta(d.weekDeltaPct)} vs last week`),
      stat(`${d.streak}d`, 'streak', `best ${N(d.bestStreak)}d`),
      stat(N(d.totalPlays), 'total plays', `${N(d.nextMilestone - d.totalPlays)} to ${N(d.nextMilestone)}`),
    ];
  };
  const dashboardPhone = (dev) => {
    const short = dev === 'android-phone';
    const [today, listened, week, streak, total] = dashStats();
    const main = `
      <div class="stats" style="grid-template-columns:1fr 1fr">
        ${today}${listened}${short ? '' : `${week}${streak}`}
        ${total.replace('style=""', 'style="grid-column:1 / -1"')}
      </div>
      ${card('last 7 days', weekStrip(short ? 70 : 90))}
      ${card('top tracks this week', topTracks(4, 36))}`;
    return shell(dev, { tab: 'listen', main });
  };
  // el último informe cerrado, como la sección del dashboard (solo cabe en el ipad)
  const lastReport = () => {
    const r = D.report;
    const tile = (media, ey, nm, mv) => `<div class="row" style="gap:12px;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)">${media}<div class="grow" style="display:grid"><span class="muted mono" style="font-size:10px;letter-spacing:.05em;text-transform:uppercase">${ey}</span><span class="ell" style="font-size:14px;font-weight:500">${nm}</span><span class="mono" style="font-size:12px;color:var(--accent)">${mv}</span></div></div>`;
    const [ar, al, tr] = [r.topArtists[0], r.topAlbums[0], r.topTracks[0]];
    return card("last week's report", `<div class="muted" style="font-size:13px;margin-bottom:12px">Week ${r.week} · ${N(r.totals.plays)} plays · ${hrs(r.totals.minutes)} · ${N(r.totals.artists)} artists</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">${tile(art(ar.img, 48, true), 'top artist', ar.name, `${ar.minutes} min`)}${tile(art(al.img, 48), 'top album', al.name, `${al.minutes} min`)}${tile(art(tr.img, 48), 'top track', tr.name, `${tr.minutes} min`)}</div>`, '<span class="pill">week ▾</span>');
  };
  const dashboardTablet = (dev) => {
    const tall = dev === 'ios-tablet';
    const main = `
      <div class="stats" style="grid-template-columns:repeat(5,1fr)">${dashStats().join('')}</div>
      ${card('last 7 days', weekStrip(tall ? 66 : 40))}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">${card('top albums this week', collage(D.report.topAlbums, false))}${card('top artists this week', collage(D.dashboard.topArtistsWeek, true))}</div>
      ${tall ? lastReport() : ''}`;
    return shell(dev, { nav: '', tab: 'listen', main });
  };

  // ranking de temas de los últimos 30 días en barras, del color de la marca y con su portada
  const barRanking = (n, maxW, labelIn) => {
    const items = D.rankings.tracks.slice(0, n);
    const top = items[0].minutes;
    return `<div class="barlist">${items
      .map((x) => {
        const w = Math.round((x.minutes / top) * maxW);
        const inside = w > labelIn;
        return `<div class="bl">${art(x.img, 30)}<span class="bar" style="width:${w}px">${inside ? `<span class="ell">${x.name}</span>` : ''}</span><span class="out">${inside ? '' : `<span class="ell">${x.name}</span>`}<span class="v">${hm(x.minutes)}</span></span></div>`;
      })
      .join('')}</div>`;
  };
  const rankingsPhone = (dev) => {
    const main = `
      ${TABS3('tracks')}
      <div class="ranges">${['7d', '30d', '3m', '6m', '1y', 'ytd', 'all'].map((r) => `<span class="rb${r === '30d' ? ' on' : ''}">${r}</span>`).join('')}</div>
      <div class="row" style="justify-content:space-between;margin-top:-8px"><span class="rb">custom</span><span class="rb txt">+ playlist</span></div>
      <section class="card" style="padding:14px">
        <div class="row" style="justify-content:flex-end;margin-bottom:10px"><span class="pill">Top 10 ▾</span><span class="toggle2"><span class="on">Bar</span><span>Velocity</span></span></div>
        ${barRanking(10, 200, 110)}
      </section>`;
    return shell(dev, { tab: 'stats', main });
  };
  const rankingsTablet = (dev) => {
    const n = D.rankings.tracks.length;
    const main = `
      ${TABS3('tracks')}
      <div class="row" style="justify-content:space-between"><div class="ranges">${['7d', '30d', '3m', '6m', '1y', 'ytd', 'all', 'custom'].map((r) => `<span class="rb${r === '30d' ? ' on' : ''}">${r}</span>`).join('')}</div><span class="rb txt">+ playlist</span></div>
      <section class="card">
        <div class="sec-head"><span class="sec-title">${L('top tracks · last 30 days', 'top tracks · last 30 days')}</span><div class="row"><span class="pill">Top ${n} ▾</span><span class="toggle2"><span class="on">Bar</span><span>Velocity</span></span></div></div>
        ${barRanking(n, dev === StoreDuo.DEV.open ? 470 : 760, 150)}
        ${isShort(dev) ? '' : '<div class="row" style="justify-content:flex-end;margin-top:12px"><span class="pill">ZIPF α 0.52 · R² 0.98</span></div>'}
      </section>`;
    return shell(dev, { nav: 'rankings', main });
  };

  // la última semana cerrada de las charts: movimiento, pico (PEAK si está en él) y semanas en lista
  const MOVE = { new: '<small style="color:var(--new)">NEW</small>', re: '<small style="color:var(--re)">RE</small>', same: '<small class="muted">=</small>' };
  const chartRow = (x) => {
    const mv = MOVE[x.status] ?? `<small class="${x.status}">${x.status === 'up' ? '▲' : '▼'} ${x.delta}</small>`;
    const peak = x.peak >= x.pos ? '<span class="peak">PEAK</span>' : `<span class="st"><b class="${medal(x.peak)}">#${x.peak}${x.peakTimes > 1 ? `<small>×${x.peakTimes}</small>` : ''}</b><span>peak</span></span>`;
    return `<div class="ch"><span class="rk"><b class="${medal(x.pos)}">${x.pos}</b>${mv}</span>${art(x.img, 40)}<div class="info"><span class="t ell">${x.name}</span><span class="a ell">${x.artist}</span></div>${peak}<span class="st"><b>${x.weeks}</b><span>wks</span></span><div class="meta"><b>${x.minutes} min</b><span>${x.plays} plays</span></div></div>`;
  };
  const range = (a, b) => `${fmtDate(a, SHORT_DATE)} – ${fmtDate(b, SHORT_DATE)}`;
  const chartsBody = (phone, rows) => `
      ${TABS3('tracks')}
      <div class="ranges">${['week', 'month', 'year'].map((r) => `<span class="rb${r === 'week' ? ' on' : ''}">${r}</span>`).join('')}<span class="rb">‹</span><span class="rb txt">${D.charts.period} ▾</span><span class="rb">›</span>${phone ? '</div><div class="row" style="justify-content:flex-end;margin-top:-8px"><span class="rb txt">+ playlist</span>' : `<span class="muted" style="font-size:13px;margin-left:6px">${range(D.charts.start, D.charts.end)}</span><span class="rb txt" style="margin-left:auto">+ playlist</span>`}</div>
      <div class="chart">${D.charts.tracks.slice(0, rows).map(chartRow).join('')}</div>`;
  const chartsPhone = (dev) => shell(dev, { tab: 'stats', main: chartsBody(true, 9) });
  const chartsTablet = (dev) => shell(dev, { nav: 'charts', main: chartsBody(false, isShort(dev) ? 8 : D.charts.tracks.length) });

  // informe semanal: la misma semana cerrada, con su artista top detrás de la cabecera
  const R = D.report;
  const heroBg = (img) => `linear-gradient(180deg, rgb(8 10 12 / 0.45), var(--bg) 92%), center 25% / cover no-repeat url(${img})`;
  const REPORT_BG = heroBg(R.topArtists[0].img);
  const reportHead = (phone) => `
      <div class="rep-head"><span class="navbtn">‹</span><div class="grow"><div class="ey">weekly report</div><h1>Week ${R.week}, ${R.year}</h1><div class="d">${range(R.start, R.end)}</div></div>${phone ? '' : `<div class="ranges"><span class="rb on">week</span><span class="rb">month</span><span class="rb">year</span><span class="rb">chart ›</span></div>`}</div>
      ${phone ? `<div class="ranges"><span class="rb on">week</span><span class="rb">month</span><span class="rb">year</span><span class="rb">chart ›</span></div>` : ''}`;
  // en teléfono caben cuatro: la quinta (tracks) empujaría la ficha del artista top tras el reproductor
  const reportStats = (cols) => {
    const [t, p] = [R.totals, R.prevTotals];
    const rows = [[N(t.plays), 'plays', pct(t.plays, p.plays)], [hrs(t.minutes), 'listening time', pct(t.minutes, p.minutes)], [N(t.artists), 'artists', pct(t.artists, p.artists)], [N(t.albums), 'albums', pct(t.albums, p.albums)], [N(t.tracks), 'tracks', pct(t.tracks, p.tracks)]];
    return `<div class="stats" style="grid-template-columns:repeat(${cols},1fr)">${rows.slice(0, cols === 2 ? 4 : 5).map(([v, l, d]) => stat(v, `${l} ${delta(d)}`, '')).join('')}</div>`;
  };
  const topCard = (ey, media, nm, sb, x) => `<section class="card topcard"><div class="ey">${ey}</div>${media}<div class="nm">${nm}</div>${sb ? `<div class="sb">${sb}</div>` : ''}<div class="mv">${x.minutes} min</div><div class="pl">${x.plays} plays</div></section>`;
  const topArtistCard = (size) => topCard('top artist', art(R.topArtists[0].img, size, true), R.topArtists[0].name, '', R.topArtists[0]);
  const reportPhone = (dev) => shell(dev, { tab: 'highlights', main: `${reportHead(true)}${reportStats(2)}${topArtistCard(112)}`, backdrop: REPORT_BG });
  const reportTablet = (dev) => {
    const [al, tr] = [R.topAlbums[0], R.topTracks[0]];
    const share = dec((tr.plays / R.totals.plays) * 100);
    const lists = [R.topArtists.map((x) => ({ ...x, round: true })), R.topAlbums, R.topTracks].map((xs) => xs.slice(1));
    const col = (items) => `<div class="rlist">${items.map((x, i) => `<div class="rl"><span class="rk"><span class="${medal(i + 2)}">${i + 2}</span></span>${art(x.img, 36, x.round)}<div class="info"><span class="t ell">${x.name}</span>${x.artist ? `<span class="a ell">${x.artist}</span>` : ''}</div><div class="meta"><b>${x.minutes} min</b><span>${x.plays} plays</span></div></div>`).join('')}</div>`;
    const main = `
      ${reportHead(false)}
      ${reportStats(5)}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
        ${topArtistCard(104)}
        ${topCard('top album', art(al.img, 104), al.name, al.artist, al)}
        ${topCard('top track', art(tr.img, 104), tr.name, `${tr.artist} · ${share}% of plays`, tr)}
      </div>
      ${isShort(dev) ? '' : `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">${lists.map(col).join('')}</div>`}`;
    return shell(dev, { nav: 'reports', main, backdrop: REPORT_BG });
  };

  // detalle del artista nº 1 de siempre: su foto detrás y su puesto mes a mes (escala log)
  const A = D.artist;
  const ARTIST_BG = heroBg(A.background ?? A.img);
  const RANK_DECADES = 3;
  const rankHistory = (w, h) => {
    const pts = A.rankHistory.map((m) => m.rank ?? 10 ** RANK_DECADES);
    const y = (r) => 10 + (Math.log10(r) / RANK_DECADES) * (h - 34);
    const x = (i) => 44 + (i / (pts.length - 1)) * (w - 56);
    const d = pts.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r).toFixed(1)}`).join('');
    const grid = [1, 10, 100, 1000].map((r) => `<line x1="44" x2="${w - 12}" y1="${y(r)}" y2="${y(r)}" stroke="var(--border)" stroke-dasharray="3 4"/><text x="38" y="${y(r) + 3}" font-size="10" text-anchor="end" fill="var(--text-muted)" font-family="JetBrains Mono">#${r}</text>`).join('');
    // un rótulo por enero, en su mes
    const years = A.rankHistory.map((m, i) => (m.month.endsWith('-01') ? `<text x="${x(i)}" y="${h - 4}" font-size="10" text-anchor="middle" fill="var(--text-muted)" font-family="JetBrains Mono">${m.month.slice(0, 4)}</text>` : '')).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${grid}<path d="${d}L${x(pts.length - 1)},${h - 24}L${x(0)},${h - 24}Z" fill="var(--accent)" opacity=".08"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/>${pts.map((r, i) => `<circle cx="${x(i)}" cy="${y(r)}" r="2" fill="var(--accent)"/>`).join('')}${years}</svg>`;
  };
  // la rejilla del chart run: sin el historial semana a semana en el snapshot, sale sembrada con la
  // proporción real de semanas en el nº 1 (peakTimes / weeksOnChart)
  const runGrid = (cols, rows) => {
    const r = rng(7);
    const topShare = A.peakTimes / A.weeksOnChart;
    const cells = Array.from({ length: cols * rows }, () => {
      const v = r();
      if (v < 0.05) return '<i class="e"></i>';
      if (v < 0.05 + topShare) return '<i class="g">1</i>';
      const n = 2 + Math.floor(r() * 12);
      return `<i class="${n === 2 ? 'w' : n === 3 ? 'b' : ''}">${n}</i>`;
    });
    return `<div class="run" style="grid-template-columns:repeat(${cols},1fr)">${cells.join('')}</div>`;
  };
  const RANK_KEYS = [['7d', 'd7'], ['30d', 'd30'], ['ytd', 'ytd'], ['all', 'all']];
  const TOP10 = 10;
  const rankClass = (r) => (r === 1 ? 'g1' : r <= TOP10 ? 'acc' : 'w');
  const artistBody = (phone, short = false) => `
      <div class="ahero">${art(A.img, phone ? 88 : 128, true)}<h1>${A.name}</h1>${phone ? '' : '<span class="playbtn">▶</span>'}</div>
      <div class="stats" style="grid-template-columns:repeat(${phone ? 2 : 4},1fr)">
        ${stat(N(A.plays), 'plays', '')}${stat(`${N(A.minutes)} min`, 'listening time', '')}${stat(fmtDate(A.firstPlayed, { ...SHORT_DATE, year: 'numeric' }), 'first played', '')}${stat(new Date(A.lastPlayed).toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit', timeZone: D.settings.timeZone }), 'last played', '')}
      </div>
      <div class="badges">${RANK_KEYS.map(([k, key]) => `<div class="rbadge ${rankClass(A.ranks[key])}"><small>${k.toUpperCase()}</small><b>#${A.ranks[key]}</b></div>`).join('')}</div>
      ${phone && short ? '' : `<section class="card chartsvg" style="padding:${phone ? 10 : 14}px">${rankHistory(phone ? 330 : 1040, phone ? 150 : short ? 170 : 190)}</section>`}
      ${phone || short ? '' : `<div class="runstats"><div class="card"><b>${A.current ? `#${A.current}` : '—'}</b><span>current</span></div><div class="card"><b class="gold">#${A.peak} <small>×${A.peakTimes}</small></b><span>peak</span></div><div class="card"><b>${A.weeksOnChart}</b><span>weeks</span></div></div>
      ${runGrid(24, 4)}`}`;
  // el teléfono android (360x640) es el más bajo: sin la gráfica de puesto, que quedaría a medias tras el reproductor
  const artistPhone = (dev) => shell(dev, { tab: 'stats', main: artistBody(true, dev === 'android-phone'), backdrop: ARTIST_BG });
  const artistTablet = (dev) => shell(dev, { nav: '', main: artistBody(false, isShort(dev)), backdrop: ARTIST_BG });

  // insights
  const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const areaChart = (w, h, vals, ylabels, xlabels) => {
    const max = Math.max(...vals) * 1.1;
    const x = (i) => 40 + (i / (vals.length - 1)) * (w - 50);
    const y = (v) => 8 + (1 - v / max) * (h - 36);
    const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const trend = `M${x(0)},${y(vals.slice(0, 8).reduce((a, b) => a + b, 0) / 8)}L${x(vals.length - 1)},${y(vals.slice(-8).reduce((a, b) => a + b, 0) / 8)}`;
    const grid = ylabels.map((l, i) => { const yy = 8 + (i / (ylabels.length - 1)) * (h - 36); return `<line x1="40" x2="${w - 10}" y1="${yy}" y2="${yy}" stroke="var(--border)" stroke-dasharray="3 4"/><text x="34" y="${yy + 3}" font-size="9.5" text-anchor="end" fill="var(--text-muted)" font-family="JetBrains Mono">${l}</text>`; }).join('');
    const xl = xlabels.map((l, i) => `<text x="${40 + (i / (xlabels.length - 1)) * (w - 50)}" y="${h - 6}" font-size="9.5" text-anchor="middle" fill="var(--text-muted)" font-family="JetBrains Mono">${l}</text>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${grid}<path d="${d}L${x(vals.length - 1)},${h - 28}L${x(0)},${h - 28}Z" fill="var(--accent)" opacity=".1"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.6"/><path d="${trend}" stroke="var(--text-muted)" stroke-dasharray="4 4" fill="none"/>${xl}</svg>`;
  };
  const barsChart = (w, h, vals, labels, fmt) => {
    const max = Math.max(...vals) * 1.08;
    const bw = (w - 50) / vals.length;
    const bars = vals.map((v, i) => { const hh = (v / max) * (h - 30); return `<rect x="${44 + i * bw + bw * 0.18}" y="${h - 22 - hh}" width="${bw * 0.64}" height="${hh}" fill="${i === vals.length - 1 ? 'color-mix(in srgb, var(--accent) 45%, var(--bg-card))' : 'var(--accent)'}"/><text x="${44 + i * bw + bw / 2}" y="${h - 6}" font-size="9.5" text-anchor="middle" fill="var(--text-muted)" font-family="JetBrains Mono">${labels[i]}</text>`; }).join('');
    const grid = [0, 0.5, 1].map((f) => { const yy = h - 22 - f * (h - 30); return `<line x1="44" x2="${w - 6}" y1="${yy}" y2="${yy}" stroke="var(--border)" stroke-dasharray="3 4"/><text x="38" y="${yy + 3}" font-size="9.5" text-anchor="end" fill="var(--text-muted)" font-family="JetBrains Mono">${fmt(max * f)}</text>`; }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${grid}${bars}</svg>`;
  };
  const donut = (w, h, parts) => {
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.3, r = R * 0.58;
    const total = parts.reduce((a, p) => a + p[1], 0);
    let a0 = -Math.PI / 2;
    const segs = parts.map(([name, v, col]) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      const p = (a, rr) => `${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const mid = (a0 + a1) / 2;
      const lx = cx + Math.cos(mid) * (R + 22), ly = cy + Math.sin(mid) * (R + 22);
      const seg = `<path d="M${p(a0, R)}A${R},${R} 0 ${large} 1 ${p(a1, R)}L${p(a1, r)}A${r},${r} 0 ${large} 0 ${p(a0, r)}Z" fill="${col}" stroke="var(--bg-card)" stroke-width="2"/><line x1="${cx + Math.cos(mid) * (R + 3)}" y1="${cy + Math.sin(mid) * (R + 3)}" x2="${lx}" y2="${ly}" stroke="${col}"/><text x="${lx + (Math.cos(mid) >= 0 ? 4 : -4)}" y="${ly + 3}" font-size="10" text-anchor="${Math.cos(mid) >= 0 ? 'start' : 'end'}" fill="var(--text-muted)" font-family="JetBrains Mono">${name}</text>`;
      a0 = a1;
      return seg;
    });
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${segs.join('')}</svg>`;
  };
  // géneros de siempre: los ocho primeros, en verdes y azules de la marca
  const GENRE_COLORS = ['#1db954', '#1ed760', '#2fcf7a', '#18a36a', '#139a8c', '#2f8fd8', '#3b6fd0', '#8e5bd0'];
  const GENRES = D.insights.genres.map((g, i) => [g.name, g.pct, GENRE_COLORS[i % GENRE_COLORS.length]]);
  const I = D.insights;
  // n meses de horas de escucha, con el año rotulado en cada enero
  const monthsBars = (n) => I.playsMonthly.slice(-n);
  const januaryLabels = (months) => months.map((m) => (m.month.endsWith('-01') ? m.month.slice(0, 4) : ''));
  const AXIS_STEPS = 3;
  const insightsBody = (phone, short = false) => {
    const plays = I.playsMonthly.map((m) => m.plays);
    const top = Math.max(...plays) * 1.1;
    const ylabels = Array.from({ length: AXIS_STEPS + 1 }, (_, i) => N(Math.round((top * (AXIS_STEPS - i)) / AXIS_STEPS / 100) * 100));
    const years = [...new Set(I.playsMonthly.map((m) => m.month.slice(0, 4)))];
    const recent = monthsBars(36);
    const cw = phone ? 330 : 500;
    return `
      <div class="ranges">${['7d', '30d', '3m', '6m', '1y', 'ytd', 'all'].map((x) => `<span class="rb${x === 'all' ? ' on' : ''}">${x}</span>`).join('')}${phone ? '' : '<span class="rb">custom</span>'}</div>
      <div class="stats" style="grid-template-columns:repeat(${phone ? 2 : 4},1fr)">${stat(`${N(I.totalHours)}h`, 'total listening', '')}${stat(N(I.totalPlays), 'total plays', '')}${phone && short ? '' : `${stat(`${dec(I.dailyAvgHours)}h`, 'daily average', '')}${stat(String(I.currentStreak), 'current streak', '')}`}</div>
      <div style="display:grid;grid-template-columns:${phone ? '1fr' : '1fr 1fr'};gap:${phone ? 16 : 24}px">
        ${phone ? '' : `<section class="card ccard"><div class="h">Plays</div><div class="chartsvg">${areaChart(cw, 220, plays, ylabels, years)}</div></section>`}
        <section class="card ccard"><div class="h">Genre distribution</div><div class="chartsvg">${donut(cw, phone ? (short ? 190 : 230) : 220, GENRES)}</div></section>
        ${phone || short ? '' : `<section class="card ccard"><div class="h">Listening time by year</div><div class="chartsvg">${barsChart(cw, 220, I.hoursByYear.map((y) => y.hours), I.hoursByYear.map((y) => String(y.year)), (v) => `${N(Math.round(v))}h`)}</div></section>
        <section class="card ccard"><div class="h">Listening time</div><div class="chartsvg">${barsChart(cw, 220, recent.map((m) => m.hours), januaryLabels(recent), (v) => `${Math.round(v)}h`)}</div></section>`}
      </div>`;
  };
  const insightsPhone = (dev) => shell(dev, { tab: 'highlights', main: insightsBody(true, dev === 'android-phone') });
  const insightsTablet = (dev) => shell(dev, { nav: 'insights', main: insightsBody(false, isShort(dev)) });

  // conciertos (solo teléfono): los más recientes, agrupados por año; sin setlist, se dice
  const C = D.concerts;
  const concertsPhone = (dev) => {
    const byYear = Object.groupBy(C.shows, (c) => c.date.slice(0, 4));
    const row = (c) => `<div class="cl">${art(c.img, 44, true)}<div class="info"><span class="t ell">${c.artist}</span><span class="a ell">${[c.venue, c.city, c.tour].filter(Boolean).join(' · ')}</span></div><div class="meta"><b>${fmtDate(c.date, SHORT_DATE)}</b></div></div><div class="muted mono" style="font-size:11.5px;padding:0 10px 6px 68px;margin-top:-10px">${c.songs ? `${c.songs} songs · ${c.inLibrary} in library` : 'no setlist yet'}</div>`;
    const stats = [[C.stats.shows, 'shows'], [C.stats.artists, 'artists'], [C.stats.venues, 'venues'], [C.stats.countries, 'countries'], [C.stats.songsLive, 'songs live'], [`${C.stats.knewPct}%`, 'already knew']];
    const main = `
      <div class="ranges"><span class="rb on">all</span>${Object.keys(byYear).sort().reverse().map((y) => `<span class="rb">${y}</span>`).join('')}</div>
      <div class="stats" style="grid-template-columns:repeat(3,1fr)">${stats.map(([v, l]) => stat(String(v), l, '', 'padding:14px 6px')).join('')}</div>
      ${Object.entries(byYear).sort(([a], [b]) => b.localeCompare(a)).map(([y, cs]) => `<div class="yearh">${y} <span>${cs.length} shows</span></div><div>${cs.map(row).join('')}</div>`).join('')}`;
    return shell(dev, { tab: 'library', main });
  };

  // ---------- slides ----------
  // composición con el kit de platform (window.StoreKit, platform/tooling/store/kit): cada slide elige
  // layout, tono y arte. el titular es una frase con su remate, sin antetítulo ni subtítulo; las cifras
  // y nombres que cita son los de las pantallas
  const { StoreKit } = window;
  const TOTAL_PLAYS = D.dashboard.totalPlays;
  const REPORT_WEEK = R.week;
  const TOP_GENRE = R.topGenre;
  const TOP_ARTIST = A;
  const HEAD = {
    dashboard: () => L('plays. We counted every one.', 'escuchas. Las contamos todas.'),
    rankings: () => L('Settle ‘favourite band’ with <em>actual data.</em>', 'Zanja lo de «tu grupo favorito» <em>con datos.</em>'),
    charts: () => L('A Top 40 where you’re the only voter.', 'Una lista de éxitos con un solo votante: tú.'),
    reports: () => L(`Week ${REPORT_WEEK}, reviewed. <em>Mostly ${TOP_GENRE}.</em>`, `Semana ${REPORT_WEEK}, revisada. <em>Casi todo ${TOP_GENRE}.</em>`),
    artist: () => L(`${N(TOP_ARTIST.plays)} plays of ${TOP_ARTIST.name}. <em>No judgement.</em>`, `${N(TOP_ARTIST.plays)} escuchas de ${TOP_ARTIST.name}. <em>Sin juzgar.</em>`),
    insights: () => L('Statistically, you have a type.', 'Estadísticamente, tienes un tipo.'),
    concerts: () => L('Proof you were there, <em>setlist included.</em>', 'La prueba de que estuviste, <em>con setlist.</em>'),
  };

  // motivo de la serie: el historial de escuchas real (escuchas por mes) como una sola curva que cruza
  // todas las slides de un marco (cada una enseña su tramo), abajo y tenue, detrás del dispositivo
  const PANO_BAND = 0.42;
  const listening = (ctx) =>
    StoreKit.panorama(ctx, (w, h) => {
      const plays = I.playsMonthly.map((m) => m.plays);
      const max = Math.max(...plays);
      const y = (v) => h - (v / max) * h * PANO_BAND;
      const d = plays.map((v, i) => `${i ? 'L' : 'M'}${((i / (plays.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join('');
      return `<svg class="pano-line" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}L${w},${h}L0,${h}Z" class="fill"/><path d="${d}" class="stroke"/></svg>`;
    });
  const withPano = (extra) => (ctx) => listening(ctx) + (extra ? extra(ctx) : '');
  // charts sobre el verde: el «40» enorme en contorno detrás del dispositivo (solo en apaisado: en
  // vertical el dispositivo ocupa todo el ancho y lo taparía)
  const forty = (ctx) => (ctx.wide ? '<span class="art-forty">40</span>' : '');
  // artista: su foto a sangre, oscurecida hacia abajo
  const artistArt = () => `<div class="art-photo" style="background:var(--bg) center 20% / cover no-repeat url(${A.background ?? A.img})"></div>`;

  // fragmentos ampliados de lens
  const rankLens = () => `<section class="card lens-card">${barRanking(5, 190, 110)}</section>`;
  const genreLens = () => `<section class="card ccard lens-card"><div class="h">Genre distribution</div><div class="chartsvg">${donut(330, 220, GENRES)}</div></section>`;
  // la entrada del concierto, como prueba: el más reciente con setlist (artista, sala, fecha) y cuántas de
  // sus canciones conocías
  const TICKET = C.shows.find((c) => c.songs > 0);
  const ticket = () => `
    <div class="ticket">
      <div class="tk-main"><span class="tk-ey">${L('admit one', 'entrada')}</span><b>${TICKET.artist}</b><span>${TICKET.venue} · ${TICKET.city}</span><span>${fmtDate(TICKET.date, { ...SHORT_DATE, year: 'numeric' })}</span></div>
      <div class="tk-stub"><b>${TICKET.knew}<small>/${TICKET.songs}</small></b><span>${L('songs you knew', 'te sabías')}</span></div>
    </div>`;

  const SPEC = {
    dashboard: { layout: 'poster', figure: () => N(TOTAL_PLAYS), art: withPano() },
    rankings: { layout: 'lens', lens: { w: 330, html: rankLens }, art: withPano() },
    charts: { layout: 'rise', tone: 'accent', art: forty },
    reports: { layout: 'fall', art: withPano() },
    artist: { layout: 'rise', tone: 'photo', art: artistArt },
    insights: { layout: 'lens', lens: { w: 360, html: genreLens }, art: withPano() },
    concerts: { layout: 'lens', lens: { w: 330, html: ticket }, art: withPano() },
  };
  const slide = (slug, scr) => ({ slug, head: HEAD[slug], scr, ...SPEC[slug] });
  const PHONE = [slide('dashboard', dashboardPhone), slide('rankings', rankingsPhone), slide('charts', chartsPhone), slide('reports', reportPhone), slide('artist', artistPhone), slide('insights', insightsPhone), slide('concerts', concertsPhone)];
  const TABLET = [slide('dashboard', dashboardTablet), slide('rankings', rankingsTablet), slide('charts', chartsTablet), slide('reports', reportTablet), slide('artist', artistTablet), slide('insights', insightsTablet)];

  // marcos: la geometría de cada dispositivo es del kit (StoreKit.FRAME); aquí sus slides y salidas.
  // los tamaños de tienda que aceptan están en platform/tooling/store/specs.mjs.
  // salidas: <tienda>/<idioma>/<slot>/<nn>-<slug>.png, un slot por casilla de subida de la tienda
  // (nn con dos dígitos: el orden del explorador de archivos es el de subida)
  const nn = (n) => String(n).padStart(2, '0');
  const at = (store, lang, slot, name) => `${store}/${lang}/${slot}/${name}.png`;
  // el iPhone Duo es un solo slot de app store: exterior e interior comparten 10 capturas por
  // idioma. abren 5 abierto en apaisado (01-05, la interior con el layout de escritorio) y siguen 5
  // cerrado (06-10, la exterior con el móvil): primero lo que el abierto no enseña
  const DUO_PER_SCREEN = StoreDuo.PER_SCREEN;
  const bySlug = (slides, slugs) => slugs.map((slug) => slides.find((sl) => sl.slug === slug));
  const DUO_OPEN_SLIDES = bySlug(TABLET, ['dashboard', 'rankings', 'charts', 'reports', 'insights']);
  const DUO_CLOSED_SLIDES = bySlug(PHONE, ['artist', 'concerts', 'dashboard', 'charts', 'insights']);

  const FRAMES = StoreKit.frames({
    'ios-phone-m': { slides: PHONE, out: (n, s, lang) => [[at('app-store', lang, 'iphone-medium', `${nn(n)}-${s}`), 3]] },
    'ios-phone': { slides: PHONE, out: (n, s, lang) => [[at('app-store', lang, 'iphone-large', `${nn(n)}-${s}`), 3]] },
    'ios-duo-inner': { slides: DUO_OPEN_SLIDES, out: (n, s, lang) => [[at('app-store', lang, 'iphone-duo', `${nn(n)}-inner-${s}`), 3]] },
    'ios-duo-outer': { slides: DUO_CLOSED_SLIDES, out: (n, s, lang) => [[at('app-store', lang, 'iphone-duo', `${nn(n + DUO_PER_SCREEN)}-outer-${s}`), 3]] },
    'ios-tablet': { slides: TABLET, out: (n, s, lang) => [[at('app-store', lang, 'ipad-13', `${nn(n)}-${s}`), 2]] },
    'android-phone': { slides: PHONE, out: (n, s, lang) => [[at('play-store', lang, 'phone', `${nn(n)}-${s}`), 3]] },
    'android-tablet': { slides: TABLET, out: (n, s, lang) => [[at('play-store', lang, 'tablet-7in', `${nn(n)}-${s}`), 1.5], [at('play-store', lang, 'tablet-10in', `${nn(n)}-${s}`), 2]] },
  });
  const slideHtml = (key, idx) => StoreKit.slide(FRAMES[key], FRAMES[key].slides[idx], idx, FRAMES[key].slides.length);

  // dashboard de escritorio (feature graphic de play y creative de app store)
  const DESK_W = 1180;
  const deskDash = (h) => `<div class="app" style="inset:auto;left:0;top:0;width:${DESK_W}px;height:${h}px"><div class="body">${sidebar('')}<div class="main">
      <div class="stats" style="grid-template-columns:repeat(4,1fr)">${[0, 2, 3, 4].map((i) => dashStats()[i]).join('')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">${card('top tracks this week', topTracks(5, 36))}${card('top artists this week', collage(D.dashboard.topArtistsWeek, true))}</div></div></div></div>`;

  // el lema de las piezas sueltas (feature graphic y creative)
  const TAGLINE = () => L('Listening stats that live <em>on your server.</em>', 'Estadísticas de escucha que viven <em>en tu servidor.</em>');
  // muro de portadas reales: las de rankings, charts e informe sin repetir, barajadas con un paso coprimo
  const COVERS = [...new Set([...D.rankings.albums, ...D.report.topAlbums, ...D.charts.tracks, ...D.rankings.tracks, ...D.dashboard.topTracksWeek].map((x) => x.img))];
  const WALL_STEP = 7;
  const coverWall = (cols, rows, size) => `<div class="cover-wall" style="--cols:${cols};--size:${size}px">${Array.from({ length: cols * rows }, (_, i) => `<img src="${COVERS[(i * WALL_STEP) % COVERS.length]}" decoding="sync" alt="">`).join('')}</div>`;

  // feature graphic de play: marca y lema a la izquierda, el muro de portadas inclinado a la derecha
  const featureHtml = () => `<div class="slide fg" style="width:1024px;height:500px">
      <div class="fg-wall">${coverWall(8, 7, 112)}</div><div class="fg-fade"></div>
      <div class="fg-copy">${wordmark(64)}<div class="fg-line">${TAGLINE()}</div></div>
    </div>`;

  // ---------- creative de app store (ios 27+): header 21:9 y resultados de búsqueda 3:2 ----------
  // el muro de portadas a sangre y atenuado de fondo; lo clave dentro de la safe area de las plantillas
  // de apple (en px css, export a escala 2; fuente: platform/tooling/store/specs.mjs). render.mjs falla
  // si algo marcado con [data-safe] se sale de ella.
  const SAFE = { header: { x: 548.5, y: 246.5, w: 823, h: 330.5 }, search: { x: 418, y: 382.5, w: 1084, h: 515 } };
  // dashboard escalado a w x h (recortado por abajo)
  const deskFit = (w, h) => {
    const s = w / DESK_W;
    return `<div class="vp" style="width:${DESK_W}px;height:${Math.ceil(h / s)}px;transform:scale(${s})">${deskDash(Math.ceil(h / s))}</div>`;
  };
  const WALL_TILE = 180;
  const safeBox = (r, body) => `<div class="cr-safe" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">${body}</div>`;
  const creative = (w, h, body) => `<div class="slide creative" style="width:${w}px;height:${h}px">
      <div class="cr-backdrop wall">${coverWall(Math.ceil(w / WALL_TILE) + 2, Math.ceil(h / WALL_TILE) + 2, WALL_TILE)}</div><div class="cr-vignette"></div>${body}
    </div>`;
  const headerHtml = () =>
    creative(1920, 823, safeBox(SAFE.header, `
      <div data-safe="marca">${wordmark(112)}</div>
      <div class="cr-line" data-safe="lema" style="font-size:40px">${TAGLINE()}</div>`));
  const searchHtml = () =>
    creative(1920, 1280, safeBox(SAFE.search, `
      <div class="cr-line" data-safe="lema" style="font-size:46px">${TAGLINE()}</div>
      <div class="device cr-window" data-safe="dashboard" style="width:${SAFE.search.w}px;height:370px"><div class="screen">${deskFit(SAFE.search.w - 2, 368)}</div></div>`));

  // gráficos sueltos (no son capturas de un dispositivo): creative de app store + feature graphic de play
  const CREATIVE = {
    header: { os: 'ios', w: 1920, h: 823, html: headerHtml, title: () => 'header · 3840 × 1646', out: (lang) => [[at('app-store', lang, 'creative', 'header'), 2]] },
    search: { os: 'ios', w: 1920, h: 1280, html: searchHtml, title: () => `${L('search results', 'resultados de búsqueda')} · 3840 × 2560`, out: (lang) => [[at('app-store', lang, 'creative', 'search'), 2]] },
    feature: { os: 'android', w: 1024, h: 500, html: featureHtml, title: () => 'feature graphic · 1024 × 500', out: (lang) => [[at('play-store', lang, 'graphics', 'feature-graphic'), 1]] },
  };
  const outputs = (pairs) => pairs.map(([path, scale]) => ({ path, scale }));

  // ---------- manifiesto (lo consume render.mjs) ----------
  const manifest = () =>
    ['es', 'en'].flatMap((lang) => {
      const slides = Object.entries(FRAMES).flatMap(([dev, f]) => f.slides.map((sl, i) => ({ hash: `x.${dev}.${i + 1}.${lang}`, w: f.w, h: f.h, outputs: outputs(f.out(i + 1, sl.slug, lang)) })));
      const graphics = Object.entries(CREATIVE).map(([key, c]) => ({ hash: `x.${key}.1.${lang}`, w: c.w, h: c.h, outputs: outputs(c.out(lang)) }));
      return [...slides, ...graphics];
    });

  // ---------- galería / export ----------
  const state = { os: 'ios', lang: 'en' };
  try {
    Object.assign(state, JSON.parse(localStorage.getItem('sis-store-screens') ?? '{}'));
  } catch (e) {
    console.warn('[store] preferencias no disponibles:', e);
  }
  const renderSlide = (dev, i, lang) => {
    LANG = lang;
    return CREATIVE[dev] ? CREATIVE[dev].html() : slideHtml(dev, i);
  };
  const fitThumbs = () => {
    document.querySelectorAll('.thumb .frame').forEach((fr) => {
      fr.style.setProperty('--k', String(fr.clientWidth / Number(fr.dataset.w)));
    });
  };
  const thumb = (dev, i, lang, w, h, name) =>
    `<figure class="thumb" tabindex="0" data-dev="${dev}" data-i="${i}"><div class="frame" data-w="${w}" style="--ar:${w} / ${h}">${renderSlide(dev, i, lang)}</div><figcaption>${name}</figcaption></figure>`;
  const renderGallery = () => {
    const { os, lang } = state;
    LANG = lang;
    const devs = os === 'ios' ? ['ios-phone-m', 'ios-phone', 'ios-duo-inner', 'ios-duo-outer', 'ios-tablet'] : ['android-phone', 'android-tablet'];
    const title = {
      'ios-phone-m': `iPhone · 1206 × 2622 (${L('required', 'obligatorio')})`,
      'ios-phone': 'iPhone · 1320 × 2868',
      'ios-duo-inner': `iPhone Duo 01–05 · ${L('open, inner display', 'abierto, pantalla interior')} · 2853 × 2007`,
      'ios-duo-outer': `iPhone Duo 06–10 · ${L('closed, outer display', 'cerrado, pantalla exterior')} · 1398 × 2034`,
      'ios-tablet': 'iPad · 2732 × 2048',
      'android-phone': `${L('phone', 'teléfono')} · 1080 × 1920`,
      'android-tablet': 'tablet · 1920 × 1200 / 2560 × 1600',
    };
    const sections = devs
      .map((dev) => {
        const f = FRAMES[dev];
        const figs = f.slides.map((sl, i) => thumb(dev, i, lang, f.w, f.h, f.out(i + 1, sl.slug, lang)[0][0])).join('');
        return `<section class="g-section"><h2>${title[dev]}</h2><div class="g-grid${FRAMES[dev].w > FRAMES[dev].h ? ' wide' : ''}">${figs}</div></section>`;
      })
      .join('');
    const feature = Object.entries(CREATIVE)
      .filter(([, c]) => c.os === os)
      .map(([key, c]) => `<section class="g-section"><h2>${c.title()}</h2><div class="g-grid wide">${thumb(key, 0, lang, c.w, c.h, c.out(lang)[0][0])}</div></section>`)
      .join('');
    const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-k="${key}" data-v="${v}" aria-pressed="${state[key] === v}">${l}</button>`).join('')}</div>`;
    document.getElementById('app').innerHTML = `<div class="gallery">
      <header class="g-head"><h1 class="g-title">${wordmark(30)}<small>store screens</small></h1><div class="g-controls">${seg('os', [['ios', 'App Store'], ['android', 'Google Play']])}${seg('lang', [['en', 'English'], ['es', 'Español']])}</div></header>
      ${sections}${feature}</div>`;
    requestAnimationFrame(fitThumbs);
  };
  const openLightbox = (dev, i) => {
    const f = CREATIVE[dev] ?? FRAMES[dev];
    const k = Math.min((innerWidth - 32) / f.w, (innerHeight - 32) / f.h);
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `<div class="frame" style="width:${f.w * k}px;height:${f.h * k}px;--k:${k}">${renderSlide(dev, i, state.lang)}</div>`;
    const close = () => {
      lb.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => e.key === 'Escape' && close();
    lb.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.append(lb);
  };

  const boot = () => {
    const m = location.hash.match(/^#x\.([a-z-]+)\.(\d+)\.(en|es)$/);
    if (m) {
      document.body.classList.add('export');
      document.getElementById('app').innerHTML = renderSlide(m[1], Number(m[2]) - 1, m[3]);
      return;
    }
    renderGallery();
    const root = document.getElementById('app');
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (b) {
        state[b.dataset.k] = b.dataset.v;
        try {
          localStorage.setItem('sis-store-screens', JSON.stringify(state));
        } catch (err) {
          console.warn('[store] no se pudo guardar la preferencia:', err);
        }
        renderGallery();
        return;
      }
      const t = e.target.closest('.thumb');
      if (t) openLightbox(t.dataset.dev, Number(t.dataset.i));
    });
    root.addEventListener('keydown', (e) => {
      const t = e.target.closest?.('.thumb');
      if (t && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openLightbox(t.dataset.dev, Number(t.dataset.i));
      }
    });
    addEventListener('resize', fitThumbs);
  };

  window.STORE = { manifest };
  boot();
  addEventListener('hashchange', () => location.reload());
})();
