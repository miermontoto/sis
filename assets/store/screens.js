// capturas de tienda: pantallas de sis replicadas en html, marcos de marketing por dispositivo e
// idioma, galería de revisión y modo export (#x.<device>.<n>.<lang>) que usa render.mjs.
// la ui de sis va en inglés; solo fechas y cifras siguen el idioma (como en la app con el navegador en es).
(() => {
  'use strict';

  let LANG = 'en';
  const L = (en, es) => (LANG === 'es' ? es : en);
  // el marco en curso dibuja la dynamic island; el iPhone Duo no (su cámara no va arriba al centro)
  let ISLAND = true;
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

  // ---------- portadas y fotos procedurales (nunca arte real) ----------
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
  const coverBg = (seed) => {
    const h = hash(seed);
    const [a, b, c] = palette(seed);
    const x = 18 + ((h >>> 5) % 64);
    const y = 18 + ((h >>> 11) % 64);
    const ang = (h >>> 3) % 180;
    switch ((h >>> 17) % 5) {
      case 0:
        return `radial-gradient(circle at ${x}% ${y}%, ${b} 0 19%, transparent 19.5%), linear-gradient(${ang}deg, ${a}, ${c})`;
      case 1:
        return `radial-gradient(circle at ${x}% 52%, ${b} 0 14%, transparent 14.5%), linear-gradient(180deg, ${a} 0 56%, ${c} 56%)`;
      case 2:
        return `radial-gradient(circle at ${x}% ${y}%, ${b} 0 22%, transparent 22.5%), repeating-linear-gradient(${ang}deg, ${a} 0 11%, ${c} 11% 22%)`;
      case 3:
        return `radial-gradient(ellipse at ${x}% ${y}%, ${b}, transparent 58%), radial-gradient(circle at ${100 - x}% ${100 - y}%, ${a}, transparent 62%), ${c}`;
      default:
        return `linear-gradient(${b}, ${b}) ${x}% ${y}% / 24% 24% no-repeat, linear-gradient(${ang}deg, ${a} 0 50%, ${c} 50%)`;
    }
  };
  // foto de artista: silueta de cabeza y hombros sobre un fondo de su paleta
  const photoBg = (seed) => {
    const [a, b, c] = palette(seed);
    return `radial-gradient(circle at 50% 40%, rgb(0 0 0 / 0.42) 0 19%, transparent 19.5%), radial-gradient(ellipse 46% 34% at 50% 100%, rgb(0 0 0 / 0.42) 0 99%, transparent 100%), radial-gradient(circle at 30% 20%, ${b}, transparent 70%), linear-gradient(160deg, ${a}, ${c})`;
  };
  const cover = (seed, size) => `<div class="cv" style="width:${size}px;height:${size}px;background:${coverBg(seed)}"></div>`;
  const photo = (seed, size) => `<div class="cv round" style="width:${size}px;height:${size}px;background:${photoBg(seed)}"></div>`;

  // ---------- datos de ejemplo (artistas ficticios, los mismos de las capturas anteriores) ----------
  const ART = { nw: 'The North Wing', vl: 'Violet Lake', mf: 'Marina Foss', ep: 'Empty Pools', ha: 'Hours Apart', ab: 'Aria Bloom', cy: 'Cobalt Youth', ld: 'Lumen Drive', sg: 'Static Gardens', vt: 'Velvet Transit', sm: 'Solar Motel', tr: 'Tidal Rooms' };
  const ALB = { nw: 'Northern Lines', vl: 'Slow Horizons', mf: 'Harbor Lights', ep: 'Low Tide', ha: 'Rooms', ab: 'Signal', cy: 'Summer Static', ld: 'Night Drive', sg: 'Greenhouse', vt: 'Last Train', sm: 'Vacancy', tr: 'Undertow' };
  const TRACKS = [
    ['Neon Tide', 'vl'], ['Paper Cities', 'nw'], ['Glass Harbor', 'mf'], ['Saltwater Run', 'ep'], ['Night Drive', 'ld'],
    ['Low Ceiling', 'ha'], ['Heatwave', 'cy'], ['Cold Signal', 'ab'], ['Half Light', 'nw'], ['Greenhouse', 'sg'],
    ['Pale Static', 'mf'], ['Last Train Home', 'vt'], ['First Frost', 'vl'], ['No Vacancy', 'sm'], ['Undertow', 'tr'],
    ['Open Water', 'ep'], ['Blue Hours', 'ha'],
  ].map(([t, a]) => ({ t, a: ART[a], k: a, alb: ALB[a] }));
  const ALBUMS = ['vl', 'nw', 'mf', 'ld', 'ep', 'cy', 'ha', 'ab', 'sg'].map((k) => ({ t: ALB[k], a: ART[k], k }));
  const ARTISTS = ['vl', 'nw', 'mf', 'ld', 'ep', 'ha', 'cy', 'ab', 'sg', 'vt'].map((k) => ({ t: ART[k], k }));
  const DAYS = () => L(['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Today'], ['mié', 'jue', 'vie', 'sáb', 'dom', 'lun', 'Today']);
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
    if (dev === 'ios-tablet') return `<div class="sys ios-tablet"><div class="left">9:41 <span style="font-weight:500">${L('Tue Sep 29', 'mar 29 sept')}</span></div><div class="right">${IOS_WIFI}<span style="font-weight:500">100 %</span>${IOS_BATT}</div></div>`;
    return `<div class="sys android"><div class="left">9:41</div><div class="right">${AND_WIFI}${AND_SIGNAL}${AND_BATT}</div></div>`;
  };
  const homeInd = (dev, bg = 'var(--bg-card)') => {
    if (dev === 'ios-phone') return `<div class="home-ind" style="flex-basis:30px;background:${bg}"></div>`;
    if (dev === 'ios-tablet') return '<div class="home-ind tablet" style="flex-basis:20px;background:var(--bg)"></div>';
    return `<div class="home-ind android" style="flex-basis:${dev === 'android-phone' ? 16 : 18}px;background:${dev === 'android-phone' ? bg : 'var(--bg)'}"></div>`;
  };
  const NOW = { t: 'Night Drive', a: ART.ld, k: 'ld' };
  const mobileHeader = () => `<div class="mh">${wordmark(22)}<span class="search">Search...</span><span class="avatar">J</span></div>`;
  const sessionStrip = () => {
    const seg = L('session · 4 tracks · 14 min', 'session · 4 tracks · 14 min');
    return `<div class="session-strip">${Array.from({ length: 4 }, () => `<span>${seg}</span>`).join('')}</div>`;
  };
  const mini = () => `<div class="mini">${cover(ALB[NOW.k], 34)}<div class="grow"><div class="t ell">${NOW.t}</div><div class="a ell">${NOW.a}</div></div><span class="btn">⏮</span><span class="btn play">❚❚</span><span class="btn">⏭</span><span class="btn heart">♥</span></div>`;
  const tabbar = (active) => `<div class="tabbar">${TABS.map(([i, n]) => `<span class="${n === active ? 'on' : ''}"><i>${i}</i>${n}</span>`).join('')}</div>`;
  // la tablet android (1280x800) es más baja que el ipad: menos filas y menos pie de sidebar
  const isShort = (dev) => dev === 'android-tablet';
  const sidebar = (active, short = false) => `
    <aside class="sidebar">
      <div class="sb-top"><div class="sb-logo">${wordmark(27)}<span class="sb-collapse">«</span></div><div class="sb-search"><span class="q">?</span>Search<span class="kbd">⌘K</span></div></div>
      <nav class="sb-nav">${SIDEBAR.map(([h, items]) => `<div class="sb-head">${h}</div>${items.map(([i, n]) => `<div class="sb-item${n === active ? ' on' : ''}"><i>${i}</i>${n}</div>`).join('')}`).join('')}</nav>
      <div class="sb-foot" style="padding-bottom:${TABLET_CROP}px">
        ${short ? '' : `<div class="sb-friends"><span class="lbl">friends</span><div class="faces">${['cy', 'sm', 'tr'].map((k) => photo(`friend-${k}`, 24)).join('')}</div></div>
        <div class="sb-sess"><span>session</span><span>4 tracks · 14 min</span></div>`}
        ${short ? '' : `<div class="np"><div class="row" style="gap:8px">${cover(ALB[NOW.k], 32)}<div class="grow"><div class="t ell">${NOW.t}</div><div class="a ell">${NOW.a}</div></div></div><div class="ctl"><span>⏮</span><span class="p">❚❚</span><span>⏭</span><span style="color:var(--like)">♥</span></div><div class="prog"><span>1:48</span><span class="bar" style="--p:52%"><i></i></span><span>3:27</span></div></div>`}
        <div class="sb-user"><span class="avatar" style="width:30px;height:30px;font-size:12px">J</span><div><div class="n">jonathan</div><div class="i">jonathan@mier.info</div></div><span class="dots">⋯</span></div>
        <div class="sb-ver">26w40j · made by mier.info</div>
      </div>
    </aside>`;
  // lo que el recorte del dispositivo tapa por abajo en tablet (px lógicos)
  const TABLET_CROP = 80;
  const shell = (dev, o) => {
    const phone = dev.endsWith('phone');
    const island = dev === 'ios-phone' ? (ISLAND ? '<div class="island"></div>' : '') : dev === 'android-phone' ? '<div class="punch"></div>' : '';
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
    const vals = [212, 268, 188, 154, 22, 196, 231];
    const max = Math.max(...vals);
    return `<div class="week"><div class="max">${vals[6]} min</div><div class="bars" style="height:${h}px">${vals.map((v, i) => `<i class="${i === 6 ? 'today' : ''}" style="height:${Math.max(4, (v / max) * h)}px"></i>`).join('')}</div><div class="days">${DAYS().map((d, i) => `<span class="${i === 6 ? 'today' : ''}">${d}</span>`).join('')}</div></div>`;
  };
  const trackRow = (r, x, main, sub, art = 36) => `<div class="tr"><span class="rk ${medal(r)}">${r}</span>${cover(x.alb ?? x.t, art)}<div class="info"><span class="t ell">${x.t}</span><span class="a ell">${x.a}</span></div><div class="meta"><b>${main}</b><span>${sub}</span></div></div>`;
  const card = (title, body, right = '', style = '') => `<section class="card" style="${style}"><div class="sec-head"><span class="sec-title">${title}</span>${right}</div>${body}</section>`;
  const topTracks = (n, art) => {
    const mins = [152, 118, 96, 81, 74, 63];
    const plays = [41, 33, 27, 22, 20, 17];
    return `<div class="tracks">${TRACKS.slice(0, n).map((x, i) => trackRow(i + 1, x, `${mins[i]} min`, `${plays[i]} plays`, art)).join('')}</div>`;
  };
  const collage = (items, round) =>
    `<div class="collage">${items
      .slice(0, 5)
      .map((x, i) => `<div style="background:${round ? photoBg(x.t) : coverBg(x.t)}"><span class="n ${i === 0 ? 'gold' : ''}">${i + 1}</span>${i < 3 ? `<span class="lbl">${x.t}<small>${[236, 184, 162][i]} min</small></span>` : ''}</div>`)
      .join('')}</div>`;
  const TABS3 = (active) => `<div class="tabs">${[['♫', 'tracks'], ['◉', 'albums'], ['♙', 'artists']].map(([i, n]) => `<span class="${n === active ? 'on' : ''}">${i} ${n}</span>`).join('')}</div>`;

  // ---------- pantallas ----------
  const dashboardPhone = (dev) => {
    const short = dev === 'android-phone';
    const main = `
      <div class="stats" style="grid-template-columns:1fr 1fr">
        ${stat('64', 'plays today', `71 yesterday`)}
        ${stat(L('3.9h', '3,9h'), 'listened today', L('4.6h yesterday', '4,6h yesterday'))}
        ${short ? '' : stat(L('24.6h', '24,6h'), 'this week', `${delta(12)} vs last week`)}
        ${short ? '' : stat('42d', 'streak', 'best 180d')}
        ${stat(N(48213), 'total plays', `${N(1787)} to ${N(50000)}`, 'grid-column:1 / -1')}
      </div>
      ${card('last 7 days', weekStrip(short ? 70 : 90))}
      ${card('top tracks this week', topTracks(4, 36))}`;
    return shell(dev, { tab: 'listen', main });
  };
  // resumen del último informe cerrado, como la sección del dashboard (solo cabe en el ipad)
  const lastReport = () => {
    const tile = (media, ey, nm, mv) => `<div class="row" style="gap:12px;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)">${media}<div class="grow" style="display:grid"><span class="muted mono" style="font-size:10px;letter-spacing:.05em;text-transform:uppercase">${ey}</span><span class="ell" style="font-size:14px;font-weight:500">${nm}</span><span class="mono" style="font-size:12px;color:var(--accent)">${mv}</span></div></div>`;
    return card(L("last week's report", "last week's report"), `<div class="muted" style="font-size:13px;margin-bottom:12px">${L('Week 39 · 612 plays · 38.2h · 142 artists', 'Week 39 · 612 plays · 38,2h · 142 artists')}</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">${tile(photo(ART.vl, 48), 'top artist', ART.vl, '184 min')}${tile(cover(ALB.nw, 48), 'top album', ALB.nw, '121 min')}${tile(cover(ALB.ld, 48), 'top track', 'Night Drive', '64 min')}</div>`, '<span class="pill">week ▾</span>');
  };
  const dashboardTablet = (dev) => {
    const tall = dev === 'ios-tablet';
    const main = `
      <div class="stats" style="grid-template-columns:repeat(5,1fr)">
        ${stat('64', 'plays today', '71 yesterday')}
        ${stat(L('3.9h', '3,9h'), 'listened today', L('4.6h yesterday', '4,6h yesterday'))}
        ${stat(L('24.6h', '24,6h'), 'this week', `${delta(12)} vs last week`)}
        ${stat('42d', 'streak', 'best 180d')}
        ${stat(N(48213), 'total plays', `${N(1787)} to ${N(50000)}`)}
      </div>
      ${card('last 7 days', weekStrip(tall ? 66 : 40))}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">${card('top albums this week', collage(ALBUMS.map((a) => ({ t: a.t })), false))}${card('top artists this week', collage(ARTISTS, true))}</div>
      ${tall ? lastReport() : ''}`;
    return shell(dev, { nav: '', main });
  };

  const barRanking = (n, maxW, labelIn) => {
    const mins = [152, 111, 98, 84, 71, 66, 65, 62, 61, 53, 49, 44, 41, 38, 35];
    const fmt = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);
    return `<div class="barlist">${TRACKS.slice(0, n)
      .map((x, i) => {
        const w = Math.round((mins[i] / mins[0]) * maxW);
        const inside = w > labelIn;
        const col = palette(x.alb)[0];
        return `<div class="bl">${cover(x.alb, 30)}<span class="bar" style="width:${w}px;background:linear-gradient(90deg, ${col}, color-mix(in srgb, ${col} 55%, var(--bg-card)))">${inside ? `<span class="ell">${x.t}</span>` : ''}</span><span class="out">${inside ? '' : `<span class="ell">${x.t}</span>`}<span class="v">${fmt(mins[i])}</span></span></div>`;
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
    const n = isShort(dev) ? 10 : 14;
    const main = `
      ${TABS3('tracks')}
      <div class="row" style="justify-content:space-between"><div class="ranges">${['7d', '30d', '3m', '6m', '1y', 'ytd', 'all', 'custom'].map((r) => `<span class="rb${r === '30d' ? ' on' : ''}">${r}</span>`).join('')}</div><span class="rb txt">+ playlist</span></div>
      <section class="card">
        <div class="sec-head"><span class="sec-title">${L('top tracks · last 30 days', 'top tracks · last 30 days')}</span><div class="row"><span class="pill">Top ${n} ▾</span><span class="toggle2"><span class="on">Bar</span><span>Velocity</span></span></div></div>
        ${barRanking(n, 760, 150)}
        ${isShort(dev) ? '' : '<div class="row" style="justify-content:flex-end;margin-top:12px"><span class="pill">ZIPF α 0.52 · R² 0.98</span></div>'}
      </section>`;
    return shell(dev, { nav: 'rankings', main });
  };

  const CHART = () => [
    [1, 'new', TRACKS[4], 'peak', [1, 1], 144, 41],
    [2, '▲ 3', TRACKS[0], ['#2', 2], [6, 1], 118, 33],
    [3, 're', TRACKS[6], 'peak', [3, 1], 96, 27],
    [4, '▼ 1', TRACKS[1], ['#1', 4], [11, 2], 81, 22],
    [5, 'new', TRACKS[9], 'peak', [1, 1], 74, 20],
    [6, '▲ 5', TRACKS[2], ['#3', 1], [4, 1], 63, 17],
    [7, '=', TRACKS[5], ['#5', 2], [9, 1], 58, 16],
    [8, 're', TRACKS[11], ['#4', 1], [3, 2], 52, 14],
    [9, '▼ 4', TRACKS[7], ['#2', 3], [14, 1], 47, 13],
    [10, 'new', TRACKS[13], 'peak', [1, 1], 44, 12],
    [11, '▲ 2', TRACKS[3], ['#6', 1], [5, 1], 41, 11],
    [12, 're', TRACKS[14], ['#9', 2], [2, 2], 38, 10],
  ];
  const chartRow = ([r, mv, x, pk, [wk, runs], mins, plays], phone) => {
    const mvHtml = mv === 'new' ? '<small style="color:var(--new)">NEW</small>' : mv === 're' ? '<small style="color:var(--re)">RE</small>' : mv === '=' ? '<small class="muted">=</small>' : `<small class="${mv.startsWith('▲') ? 'up' : 'down'}">${mv}</small>`;
    const peak = pk === 'peak' ? '<span class="peak">PEAK</span>' : `<span class="st"><b class="${medal(Number(pk[0].slice(1)))}">${pk[0]}${pk[1] > 1 ? `<small>×${pk[1]}</small>` : ''}</b><span>peak</span></span>`;
    return `<div class="ch"><span class="rk"><b class="${medal(r)}">${r}</b>${mvHtml}</span>${cover(x.alb, phone ? 40 : 40)}<div class="info"><span class="t ell">${x.t}</span><span class="a ell">${x.a}</span></div>${peak}<span class="st"><b>${wk}<small>(${runs})</small></b><span>wks</span></span><div class="meta"><b>${mins} min</b><span>${plays} plays</span></div></div>`;
  };
  const chartsBody = (phone, rows) => `
      ${TABS3('tracks')}
      <div class="ranges">${['week', 'month', 'year'].map((r) => `<span class="rb${r === 'week' ? ' on' : ''}">${r}</span>`).join('')}<span class="rb">‹</span><span class="rb txt">2026-W39 ▾</span><span class="rb">›</span>${phone ? '</div><div class="row" style="justify-content:flex-end;margin-top:-8px"><span class="rb txt">+ playlist</span>' : `<span class="muted" style="font-size:13px;margin-left:6px">${L('Sep 21 – 27, 2026', '21 – 27 sept 2026')}</span><span class="rb txt" style="margin-left:auto">+ playlist</span>`}</div>
      <div class="chart">${CHART().slice(0, rows).map((c) => chartRow(c, phone)).join('')}</div>`;
  const chartsPhone = (dev) => shell(dev, { tab: 'stats', main: chartsBody(true, 9) });
  const chartsTablet = (dev) => shell(dev, { nav: 'charts', main: chartsBody(false, isShort(dev) ? 8 : 12) });

  // informe semanal
  const REPORT_BG = `radial-gradient(ellipse 70% 90% at 70% 0%, ${palette(ART.vl)[0]}, transparent 70%), linear-gradient(180deg, color-mix(in srgb, ${palette(ART.vl)[2]} 70%, #000), transparent)`;
  const reportHead = (phone) => `
      <div class="rep-head"><span class="navbtn">‹</span><div class="grow"><div class="ey">weekly report</div><h1>${L('Week 39, 2026', 'Week 39, 2026')}</h1><div class="d">${L('Sep 21 – Sep 27', '21 sept – 27 sept')}</div></div>${phone ? '' : `<div class="ranges"><span class="rb on">week</span><span class="rb">month</span><span class="rb">year</span><span class="rb">chart ›</span></div>`}</div>
      ${phone ? `<div class="ranges"><span class="rb on">week</span><span class="rb">month</span><span class="rb">year</span><span class="rb">chart ›</span></div>` : ''}`;
  // en teléfono caben cuatro: la quinta (tracks) empujaría la ficha del artista top tras el reproductor
  const reportStats = (cols) => `<div class="stats" style="grid-template-columns:repeat(${cols},1fr)">${[
    ['612', 'plays', 4], [L('38.2h', '38,2h'), 'listening time', 6], ['142', 'artists', 8], ['211', 'albums', 2], ['356', 'tracks', -3],
  ].slice(0, cols === 2 ? 4 : 5).map(([v, l, d]) => stat(v, `${l} ${d >= 0 ? '<span class="up">▲ ' + d + '%</span>' : '<span class="down">▼ ' + -d + '%</span>'}`, '')).join('')}</div>`;
  const topCard = (ey, media, nm, sb, mv, pl, ch) => `<section class="card topcard"><div class="ey">${ey}</div>${media}<div class="nm">${nm}</div>${sb ? `<div class="sb">${sb}</div>` : ''}<div class="mv">${mv}</div><div class="pl">${pl}</div>${ch}</section>`;
  const reportPhone = (dev) => {
    const main = `${reportHead(true)}${reportStats(2)}${topCard('top artist', photo(ART.vl, 112), ART.vl, '', '184 min', '52 plays', '<span class="ch2 up">▲ 3</span>')}`;
    return shell(dev, { tab: 'highlights', main, backdrop: REPORT_BG });
  };
  const reportTablet = (dev) => {
    const lists = [
      ARTISTS.slice(1, 7).map((x, i) => ({ t: x.t, a: '', art: photo(x.t, 36), mv: ['▲ 2', '▼ 1', 'RE', '▲ 6', '=', '▼ 2'][i], m: [162, 141, 118, 96, 88, 71][i], p: [44, 38, 31, 26, 24, 19][i] })),
      ALBUMS.slice(1, 7).map((x, i) => ({ t: x.t, a: x.a, art: cover(x.t, 36), mv: ['RE', '▲ 4', 'NEW', '▼ 3', 'RE', '▲ 1'][i], m: [83, 77, 69, 61, 55, 49][i], p: [24, 22, 19, 17, 15, 14][i] })),
      TRACKS.slice(1, 7).map((x, i) => ({ t: x.t, a: x.a, art: cover(x.alb, 36), mv: ['▲ 5', 'NEW', 'RE', '▲ 12', '▼ 2', 'NEW'][i], m: [58, 49, 44, 41, 37, 33][i], p: [17, 14, 13, 12, 11, 10][i] })),
    ];
    const mvc = (mv) => (mv === 'NEW' ? 'color:var(--new)' : mv === 'RE' ? 'color:var(--re)' : mv === '=' ? 'color:var(--text-muted)' : mv.startsWith('▲') ? 'color:var(--accent)' : 'color:var(--danger)');
    const col = (items) => `<div class="rlist">${items.map((x, i) => `<div class="rl"><span class="rk"><span class="${medal(i + 2)}">${i + 2}</span><small style="${mvc(x.mv)}">${x.mv}</small></span>${x.art}<div class="info"><span class="t ell">${x.t}</span>${x.a ? `<span class="a ell">${x.a}</span>` : ''}</div><div class="meta"><b>${x.m} min</b><span>${x.p} plays</span></div></div>`).join('')}</div>`;
    const main = `
      ${reportHead(false)}
      ${reportStats(5)}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
        ${topCard('top artist', photo(ART.vl, 104), ART.vl, '', '184 min', '52 plays', '<span class="ch2 up">▲ 3</span>')}
        ${topCard('top album', cover(ALB.nw, 104), ALB.nw, ART.nw, '121 min', '34 plays', '<span class="ch2" style="color:var(--re)">RE</span>')}
        ${topCard('top track', cover(ALB.ld, 104), 'Night Drive', `${ART.ld} · ${L('3.1% of plays', '3,1% of plays')}`, '64 min', '19 plays', '<span class="ch2" style="color:var(--new)">NEW</span>')}
      </div>
      ${isShort(dev) ? '' : `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">${lists.map(col).join('')}</div>`}`;
    return shell(dev, { nav: 'reports', main, backdrop: REPORT_BG });
  };

  // detalle de artista
  const ARTIST_BG = `radial-gradient(ellipse 80% 100% at 80% 0%, ${palette(ART.nw)[0]}, transparent 70%), linear-gradient(180deg, color-mix(in srgb, ${palette(ART.nw)[2]} 60%, #000), transparent)`;
  const rankHistory = (w, h) => {
    const pts = [900, 700, 420, 160, 60, 38, 22, 14, 9, 7, 5, 4, 4, 3, 3, 2, 2, 2, 1, 1, 1, 2, 1, 1];
    const y = (r) => 10 + (Math.log10(r) / 3) * (h - 34);
    const x = (i) => 44 + (i / (pts.length - 1)) * (w - 56);
    const d = pts.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r).toFixed(1)}`).join('');
    const grid = [1, 10, 100, 1000].map((r) => `<line x1="44" x2="${w - 12}" y1="${y(r)}" y2="${y(r)}" stroke="var(--border)" stroke-dasharray="3 4"/><text x="38" y="${y(r) + 3}" font-size="10" text-anchor="end" fill="var(--text-muted)" font-family="JetBrains Mono">#${r}</text>`).join('');
    const years = ['2021', '2022', '2023', '2024', '2025', '2026'].map((t, i, a) => `<text x="${44 + (i / (a.length - 1)) * (w - 56)}" y="${h - 4}" font-size="10" text-anchor="middle" fill="var(--text-muted)" font-family="JetBrains Mono">${t}</text>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${grid}<path d="${d}L${x(pts.length - 1)},${h - 24}L${x(0)},${h - 24}Z" fill="var(--accent)" opacity=".08"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/>${pts.map((r, i) => `<circle cx="${x(i)}" cy="${y(r)}" r="2" fill="var(--accent)"/>`).join('')}${years}</svg>`;
  };
  const runGrid = (cols, rows) => {
    const r = (() => {
      let s = 7;
      return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    })();
    const cells = Array.from({ length: cols * rows }, () => {
      const v = r();
      if (v < 0.07) return '<i class="e"></i>';
      if (v < 0.24) return '<i class="g">1</i>';
      const n = 2 + Math.floor(r() * 24);
      return `<i class="${n > 15 ? 's' : n === 2 ? 'w' : n === 3 ? 'b' : ''}">${n}</i>`;
    });
    return `<div class="run" style="grid-template-columns:repeat(${cols},1fr)">${cells.join('')}</div>`;
  };
  const artistBody = (phone, short = false) => `
      <div class="ahero">${photo(ART.nw, phone ? 88 : 128)}<h1>${ART.nw}</h1>${phone ? '' : `<span class="playbtn">▶</span><span class="acco">♛<span>×4</span> ♛<span>×2</span></span>`}</div>
      <div class="stats" style="grid-template-columns:repeat(${phone ? 2 : 4},1fr)">
        ${stat(N(4812), 'plays', '')}${stat(`${N(16904)} min`, 'listening time', '')}${stat(L('Mar 12 2021', '12 mar 2021'), 'first played', '')}${stat('10:41', 'last played', '')}
      </div>
      <div class="badges">${[['7d', '#1', 'g1'], ['30d', '#1', 'g1'], ['ytd', '#2', 'acc'], ['all', '#4', 'w']].map(([k, v, c]) => `<div class="rbadge ${c}"><small>${k.toUpperCase()}</small><b>${v}</b></div>`).join('')}</div>
      ${phone && short ? '' : `<section class="card chartsvg" style="padding:${phone ? 10 : 14}px">${rankHistory(phone ? 330 : 1040, phone ? 150 : short ? 170 : 190)}</section>`}
      ${phone || short ? '' : `<div class="runstats"><div class="card"><b>#3</b><span>current</span></div><div class="card"><b class="gold">#1 <small>×38</small></b><span>peak</span></div><div class="card"><b>214 <small>(71)</small></b><span>weeks</span></div></div>
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
  const GENRES = [['indie pop', 26, '#1db954'], ['dream pop', 18, '#1ed760'], ['synthpop', 15, '#2fcf7a'], ['shoegaze', 11, '#18a36a'], ['indie rock', 10, '#139a8c'], ['electronic', 9, '#2f8fd8'], ['alt r&b', 6, '#3b6fd0'], ['post-punk', 5, '#8e5bd0']];
  const insightsBody = (phone, short = false) => {
    const r = rng(11);
    const plays = Array.from({ length: 60 }, (_, i) => 1400 + Math.sin(i / 5) * 500 + r() * 700 + (i > 40 ? 400 : 0));
    const xl = ['2021', '2022', '2023', '2024', '2025', '2026'];
    const cw = phone ? 330 : 500;
    return `
      <div class="ranges">${['7d', '30d', '3m', '6m', '1y', 'ytd', 'all'].map((x) => `<span class="rb${x === 'all' ? ' on' : ''}">${x}</span>`).join('')}${phone ? '' : '<span class="rb">custom</span>'}</div>
      <div class="stats" style="grid-template-columns:repeat(${phone ? 2 : 4},1fr)">${stat(L('2,948.6h', '2948,6h'), 'total listening', '')}${stat(N(48213), 'total plays', '')}${phone && short ? '' : `${stat(L('3.4h', '3,4h'), 'daily average', '')}${stat('42', 'current streak', '')}`}</div>
      <div style="display:grid;grid-template-columns:${phone ? '1fr' : '1fr 1fr'};gap:${phone ? 16 : 24}px">
        ${phone ? '' : `<section class="card ccard"><div class="h">Plays<small>R² = 0.31</small></div><div class="chartsvg">${areaChart(cw, 220, plays, ['2,400', '1,600', '800', '0'].map((v) => (LANG === 'es' ? v.replace(',', '.') : v)), xl)}</div></section>`}
        <section class="card ccard"><div class="h">Genre distribution</div><div class="chartsvg">${donut(cw, phone ? (short ? 190 : 230) : 220, GENRES)}</div></section>
        ${phone || short ? '' : `<section class="card ccard"><div class="h">Listening time by year<small>R² = 0.42</small></div><div class="chartsvg">${barsChart(cw, 220, [212, 318, 402, 455, 498, 531, 604, 388], ['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'], (v) => `${Math.round(v)}h`)}</div></section>
        <section class="card ccard"><div class="h">Listening time<small>R² = 0.18</small></div><div class="chartsvg">${barsChart(cw, 220, Array.from({ length: 36 }, (_, i) => 20 + Math.abs(Math.sin(i / 3)) * 30 + r() * 25), Array.from({ length: 36 }, (_, i) => (i % 6 === 0 ? xl[i / 6] : '')), (v) => `${Math.round(v)}h`)}</div></section>`}
      </div>`;
  };
  const insightsPhone = (dev) => shell(dev, { tab: 'highlights', main: insightsBody(true, dev === 'android-phone') });
  const insightsTablet = (dev) => shell(dev, { nav: 'insights', main: insightsBody(false, isShort(dev)) });

  // conciertos (solo teléfono)
  const concertsPhone = (dev) => {
    const shows = [
      [ART.vl, L('Teatro Norte · Madrid · Slow Horizons Tour', 'Teatro Norte · Madrid · Slow Horizons Tour'), L('Sep 12', '12 sept'), '21 songs · 19 in library'],
      [ART.nw, 'Sala Faro · Gijón', L('Aug 2', '2 ago'), '18 songs · 16 in library'],
      [ART.ld, L('Parque del Puerto · Bilbao', 'Parque del Puerto · Bilbao'), L('Jul 19', '19 jul'), '16 songs · 12 in library'],
      [ART.mf, 'Arena Sur · Sevilla', L('Jun 7', '7 jun'), '22 songs · 20 in library'],
    ];
    const main = `
      <div class="ranges"><span class="rb on">all</span><span class="rb">2026</span><span class="rb">2025</span><span class="rb">2024</span></div>
      <div class="stats" style="grid-template-columns:repeat(3,1fr)">${[['9', 'shows'], ['8', 'artists'], ['7', 'venues'], ['2', 'countries'], ['164', 'songs live'], ['86%', 'already knew']].map(([v, l]) => stat(v, l, '', 'padding:14px 6px')).join('')}</div>
      <div class="yearh">2026 <span>5 shows</span></div>
      <div>${shows.map(([a, v, d, s]) => `<div class="cl">${photo(a, 44)}<div class="info"><span class="t ell">${a}</span><span class="a ell">${v}</span></div><div class="meta"><b>${d}</b></div></div><div class="muted mono" style="font-size:11.5px;padding:0 10px 6px 68px;margin-top:-10px">${s}</div>`).join('')}</div>`;
    return shell(dev, { tab: 'library', main });
  };

  // ---------- slides ----------
  const COPY = {
    dashboard: { k: () => 'dashboard', h: () => L('your music, <em>logged in real time</em>', 'tu música, <em>registrada al momento</em>'), s: () => L('every play saved to your own server, with today, this week and your streak at a glance', 'cada escucha guardada en tu servidor, con hoy, la semana y tu racha de un vistazo') },
    rankings: { k: () => 'rankings', h: () => L('your top, <em>by plays or time</em>', 'tu top, <em>por escuchas o tiempo</em>'), s: () => L('tracks, albums and artists over any range, from last week to all time', 'temas, álbumes y artistas en cualquier rango, de la última semana a siempre') },
    charts: { k: () => 'charts', h: () => L('weekly charts, <em>like the real ones</em>', 'listas semanales, <em>como las de verdad</em>'), s: () => L('new entries, re-entries, peaks and weeks on chart', 'entradas nuevas, reentradas, picos y semanas en lista') },
    reports: { k: () => 'reports', h: () => L('every week, <em>wrapped</em>', 'cada semana, <em>resumida</em>'), s: () => L('weekly, monthly and yearly reports with your top artists, albums and tracks', 'informes semanales, mensuales y anuales con tus artistas, álbumes y temas top') },
    artist: { k: () => L('artists', 'artistas'), h: () => L('every artist, <em>in depth</em>', 'cada artista, <em>a fondo</em>'), s: () => L('plays, rank over time and the full chart run', 'escuchas, su puesto en el tiempo y su historial en listas') },
    insights: { k: () => 'insights', h: () => L('see <em>how you listen</em>', 'descubre <em>cómo escuchas</em>'), s: () => L('trends, genres and listening time, year after year', 'tendencias, géneros y tiempo de escucha, año tras año') },
    concerts: { k: () => L('concerts', 'conciertos'), h: () => L('the shows <em>you have seen</em>', 'los conciertos <em>que has visto</em>'), s: () => L('log every show with its setlist and see how many songs you already knew', 'apunta cada concierto con su setlist y mira cuántas canciones ya conocías') },
  };
  const slide = (slug, scr) => ({ slug, ...COPY[slug], scr });
  const PHONE = [slide('dashboard', dashboardPhone), slide('rankings', rankingsPhone), slide('charts', chartsPhone), slide('reports', reportPhone), slide('artist', artistPhone), slide('insights', insightsPhone), slide('concerts', concertsPhone)];
  const TABLET = [slide('dashboard', dashboardTablet), slide('rankings', rankingsTablet), slide('charts', chartsTablet), slide('reports', reportTablet), slide('artist', artistTablet), slide('insights', insightsTablet)];

  // marcos: lienzo en px css; export multiplica por scale. rLog = radio de pantalla en px lógicos.
  // base = dispositivo cuyas pantallas pinta un marco derivado (otro tamaño de iphone, el Duo);
  // los tamaños de tienda que aceptan están en platform/tooling/store/specs.mjs.
  // salidas: <tienda>/<idioma>/<slot>/<nn>-<slug>.png, un slot por casilla de subida de la tienda
  // (nn con dos dígitos: el orden del explorador de archivos es el de subida)
  const nn = (n) => String(n).padStart(2, '0');
  const at = (store, lang, slot, name) => `${store}/${lang}/${slot}/${name}.png`;
  // el iPhone Duo es un solo slot de app store: exterior e interior comparten 10 capturas por
  // idioma. abren las 5 primeras slides desplegado (01-05) y siguen las 5 últimas plegado (06-10)
  const DUO_PER_SCREEN = 5;

  const FRAMES = {
    // dynamic island mediano (iPhone 17 Pro, 1206x2622): el obligatorio de app store
    'ios-phone-m': { base: 'ios-phone', w: 402, h: 874, screen: { w: 402, h: 874 }, bezel: 9, rLog: 55, pad: 32, padTop: 47, kicker: 11, head: 25, sub: 14, copyH: 210, bottom: 28, dot: 21, slides: PHONE, out: (n, s, lang) => [[at('app-store', lang, 'iphone-medium', `${nn(n)}-${s}`), 3]] },
    // dynamic island grande (iPhone 17 Pro Max, 1320x2868): la casilla de 6,5"/6,7"/6,9" de app
    // store connect, que no acepta el 1284x2778 del face id grande
    'ios-phone': { w: 440, h: 956, screen: { w: 440, h: 956 }, bezel: 9, rLog: 55, pad: 34, padTop: 50, kicker: 12, head: 27, sub: 15, copyH: 222, bottom: 30, dot: 22, slides: PHONE, out: (n, s, lang) => [[at('app-store', lang, 'iphone-large', `${nn(n)}-${s}`), 3]] },
    // iPhone Duo: interior (2007x2853) y exterior (1398x2034), un solo slot de 10 (ver DUO_PER_SCREEN)
    'ios-duo-inner': { base: 'ios-phone', island: false, w: 669, h: 951, screen: { w: 669, h: 951 }, bezel: 12, rLog: 36, pad: 48, padTop: 56, kicker: 14, head: 36, sub: 19, copyH: 250, bottom: 34, dot: 26, slides: PHONE.slice(0, DUO_PER_SCREEN), out: (n, s, lang) => [[at('app-store', lang, 'iphone-duo', `${nn(n)}-inner-${s}`), 3]] },
    'ios-duo-outer': { base: 'ios-phone', island: false, w: 466, h: 678, screen: { w: 466, h: 678 }, bezel: 9, rLog: 40, pad: 34, padTop: 40, kicker: 11, head: 25, sub: 14, copyH: 184, bottom: 24, dot: 22, slides: PHONE.slice(-DUO_PER_SCREEN), out: (n, s, lang) => [[at('app-store', lang, 'iphone-duo', `${nn(n + DUO_PER_SCREEN)}-outer-${s}`), 3]] },
    'ios-tablet': { w: 1366, h: 1024, screen: { w: 1366, h: 1024 }, bezel: 14, rLog: 20, pad: 80, padTop: 58, kicker: 14, head: 40, sub: 20, copyH: 190, devW: 1206, dot: 28, slides: TABLET, out: (n, s, lang) => [[at('app-store', lang, 'ipad-13', `${nn(n)}-${s}`), 2]] },
    'android-phone': { w: 360, h: 640, screen: { w: 360, h: 640 }, bezel: 7, rLog: 22, pad: 26, padTop: 32, kicker: 10, head: 20, sub: 12.5, copyH: 162, bottom: 18, dot: 18, slides: PHONE, out: (n, s, lang) => [[at('play-store', lang, 'phone', `${nn(n)}-${s}`), 3]] },
    'android-tablet': { w: 1280, h: 800, screen: { w: 1280, h: 800 }, bezel: 12, rLog: 16, pad: 72, padTop: 42, kicker: 12, head: 34, sub: 17, copyH: 158, devW: 1136, dot: 26, slides: TABLET, out: (n, s, lang) => [[at('play-store', lang, 'tablet-7in', `${nn(n)}-${s}`), 1.5], [at('play-store', lang, 'tablet-10in', `${nn(n)}-${s}`), 2]] },
  };
  const geom = (f) => {
    if (f.devW) {
      const s = (f.devW - 2 * f.bezel) / f.screen.w;
      return { x: (f.w - f.devW) / 2, y: f.copyH, dw: f.devW, dh: f.screen.h * s + 2 * f.bezel, s };
    }
    const dh = f.h - f.copyH - f.bottom;
    const s = (dh - 2 * f.bezel) / f.screen.h;
    const dw = f.screen.w * s + 2 * f.bezel;
    return { x: (f.w - dw) / 2, y: f.copyH, dw, dh, s };
  };
  // ecualizador de fondo en la esquina superior derecha
  const eq = (f) => {
    const n = 14;
    const bw = f.w * 0.018;
    const r = rng(5);
    const bars = Array.from({ length: n }, (_, i) => `<i class="${i === n - 2 ? 'on' : ''}" style="width:${bw}px;height:${(0.25 + r() * 0.75) * f.h * 0.16}px"></i>`).join('');
    return `<div class="eq" style="right:${f.pad}px;top:${f.padTop}px;gap:${bw * 0.7}px;height:${f.h * 0.16}px">${bars}</div>`;
  };
  const slideHtml = (key, idx) => {
    const f = FRAMES[key];
    const dev = f.base ?? key;
    ISLAND = f.island ?? true;
    const sl = f.slides[idx];
    const g = geom(f);
    const rIn = f.rLog * g.s;
    const phone = dev.endsWith('phone');
    return `<div class="slide" style="width:${f.w}px;height:${f.h}px;--pad:${f.pad}px;--pad-top:${f.padTop}px;--kicker:${f.kicker}px;--head:${f.head}px;--sub:${f.sub}px;--dot:${f.dot}px;--sub-max:none">
      <div class="copy"><span class="kicker">${sl.k(dev)}</span><h1 class="headline">${sl.h(dev)}</h1><p class="sub">${sl.s(dev)}</p></div>
      <div class="device" style="box-sizing:border-box;left:${g.x}px;top:${g.y}px;width:${g.dw}px;height:${g.dh}px;border-radius:${rIn + f.bezel}px">
        <div class="screen" style="left:${f.bezel - 1}px;top:${f.bezel - 1}px;width:${f.screen.w * g.s}px;height:${f.screen.h * g.s}px;border-radius:${rIn}px">
          <div class="vp" style="width:${f.screen.w}px;height:${f.screen.h}px;transform:scale(${g.s})">${sl.scr(dev)}</div>
        </div>
      </div>
    </div>`;
  };

  // dashboard de escritorio (feature graphic de play y creative de app store)
  const DESK_W = 1180;
  const deskDash = (h) => `<div class="app" style="inset:auto;left:0;top:0;width:${DESK_W}px;height:${h}px"><div class="body">${sidebar('')}<div class="main">
      <div class="stats" style="grid-template-columns:repeat(4,1fr)">${stat('64', 'plays today', '71 yesterday')}${stat(L('24.6h', '24,6h'), 'this week', `${delta(12)} vs last week`)}${stat('42d', 'streak', 'best 180d')}${stat(N(48213), 'total plays', '')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">${card('top tracks this week', topTracks(5, 36))}${card('top artists this week', collage(ARTISTS, true))}</div></div></div></div>`;

  // feature graphic de play: marca + dashboard recortado
  const featureHtml = () => {
    const board = deskDash(760);
    return `<div class="slide" style="width:1024px;height:500px;--dot:22px">
      <div style="position:absolute;left:60px;top:0;bottom:0;display:grid;align-content:center;gap:22px;width:360px">
        ${wordmark(64)}
        <div class="headline" style="font-size:25px;line-height:1.2">${L('your music, <em>logged in real time</em>', 'tu música, <em>registrada al momento</em>')}</div>
        <div class="sub" style="font-size:14px">${L('self-hosted listening stats', 'estadísticas de escucha en tu servidor')}</div>
      </div>
      <div class="device" style="left:450px;top:60px;width:680px;height:520px;border-radius:14px;box-sizing:border-box"><div class="screen" style="left:8px;top:8px;width:680px;height:520px;border-radius:8px"><div class="vp" style="width:1180px;height:760px;transform:scale(.6)">${board}</div></div></div>
    </div>`;
  };

  // ---------- creative de app store (ios 27+): header 21:9 y resultados de búsqueda 3:2 ----------
  // el dashboard de escritorio a sangre y atenuado de fondo; lo clave dentro de la safe area de las
  // plantillas de apple (en px css, export a escala 2; fuente: platform/tooling/store/specs.mjs).
  // render.mjs falla si algo marcado con [data-safe] se sale de ella.
  const SAFE = { header: { x: 548.5, y: 246.5, w: 823, h: 330.5 }, search: { x: 418, y: 382.5, w: 1084, h: 515 } };
  // dashboard escalado a w x h (recortado por abajo)
  const deskFit = (w, h) => {
    const s = w / DESK_W;
    return `<div class="vp" style="width:${DESK_W}px;height:${Math.ceil(h / s)}px;transform:scale(${s})">${deskDash(Math.ceil(h / s))}</div>`;
  };
  const safeBox = (r, body) => `<div class="cr-safe" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">${body}</div>`;
  const creative = (w, h, body) => `<div class="slide creative" style="width:${w}px;height:${h}px;--dot:30px">
      <div class="cr-backdrop">${deskFit(w, h)}</div><div class="cr-vignette"></div>${body}
    </div>`;
  const headerHtml = () =>
    creative(1920, 823, safeBox(SAFE.header, `
      <div data-safe="marca">${wordmark(112)}</div>
      <div class="headline cr-line" data-safe="lema" style="font-size:38px">${L('your music, <em>logged in real time</em>', 'tu música, <em>registrada al momento</em>')}</div>`));
  const searchHtml = () =>
    creative(1920, 1280, safeBox(SAFE.search, `
      <div class="headline cr-line" data-safe="lema" style="font-size:44px">${L('self-hosted <em>listening stats</em>', 'estadísticas de escucha <em>en tu servidor</em>')}</div>
      <div class="device cr-window" data-safe="dashboard" style="width:${SAFE.search.w}px;height:420px"><div class="screen">${deskFit(SAFE.search.w - 2, 418)}</div></div>`));

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
      'ios-duo-inner': `iPhone Duo 01–05 · ${L('inner display', 'pantalla interior')} · 2007 × 2853`,
      'ios-duo-outer': `iPhone Duo 06–10 · ${L('outer display', 'pantalla exterior')} · 1398 × 2034`,
      'ios-tablet': 'iPad · 2732 × 2048',
      'android-phone': `${L('phone', 'teléfono')} · 1080 × 1920`,
      'android-tablet': 'tablet · 1920 × 1200 / 2560 × 1600',
    };
    const sections = devs
      .map((dev) => {
        const f = FRAMES[dev];
        const figs = f.slides.map((sl, i) => thumb(dev, i, lang, f.w, f.h, f.out(i + 1, sl.slug, lang)[0][0])).join('');
        return `<section class="g-section"><h2>${title[dev]}</h2><div class="g-grid${dev.endsWith('tablet') ? ' wide' : ''}">${figs}</div></section>`;
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
