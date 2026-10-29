/* Matchup Lab — weekly fantasy projections. Vanilla JS, data from data.json (nflverse). */
(() => {
  'use strict';

  // ---------- State ----------
  const state = { data: null, week: null, scoring: 'ppr', pos: 'ALL', liveInj: null, view: 'board', player: null, theme: null, appearance: 'system', team: 'ml', news: null, newsByPlayer: {}, newsFilter: 'all', defSort: { key: 'fp_RB', dir: 1 } };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  if (!window.MLModel) throw new Error('model.js must load before app.js');
  const SCORING = window.MLModel.SCORING;
  function makeDist(mean, cv) { return window.MLModel.makeDist(mean, cv); }
  function gameFor(team, week) { return window.MLModel.gameFor(team, week, state.data); }
  function project(pl, week, scoringKey) { return window.MLModel.project(pl, week, scoringKey, state); }
  function workloadOf(pl) {
    if (!pl || !window.MLModel.fullWorkload) return null;
    try { return window.MLModel.fullWorkload(pl, state.week, state.scoring, state); }
    catch (e) { return null; }
  }
  function workloadNote(full) {
    let text = 'Projection discounts his injury-shortened games; this is his number at a normal healthy workload.';
    if (full && full.practice) text += ' Practice: ' + full.practice + '.';
    return text;
  }
  function workloadMark(pl) {
    const full = workloadOf(pl);
    if (!full) return '';
    const note = esc(workloadNote(full));
    return `<span class="full-work" data-gl="If full workload" title="${note}">${f1(full.pts)} if full workload</span>`;
  }
  function workloadHero(pl, pr) {
    const full = workloadOf(pl);
    if (!full) return '';
    const note = esc(workloadNote(full));
    return `<div class="full-work-line"><span class="full-work" data-gl="If full workload" title="${note}">${f1(pr.pts)} proj · ${f1(full.pts)} if full workload</span><span class="full-work-why">${note}</span></div>`;
  }
  function propMean(o, yards) { return window.MLModel.propMean(o, yards); }

  // ---------- Theme ----------
  const APPEAR_KEY = 'ml-appearance';
  const TEAM_KEY = 'ml-team';
  let settingsReturn = null;

  function themeRecord(id) {
    const list = window.MLThemes || [];
    return list.find(t => t.id === id) || list[0] || null;
  }
  function resolvedMode(appearance) {
    if (appearance === 'dark' || appearance === 'light') return appearance;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme() {
    const mode = resolvedMode(state.appearance);
    state.theme = mode;
    const root = document.documentElement;
    root.setAttribute('data-theme', mode);
    root.setAttribute('data-appearance', state.appearance);
    root.setAttribute('data-team', state.team);
    try { localStorage.setItem(APPEAR_KEY, state.appearance); localStorage.setItem(TEAM_KEY, state.team); } catch (e) {}
    const rec = themeRecord(state.team);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && rec && rec.chrome && rec.chrome[mode]) meta.setAttribute('content', rec.chrome[mode]);
    syncSettingsUI();
    if (state.view === 'player' && state.player) renderPlayer(state.player);
  }
  function setAppearance(value) {
    if (value !== 'light' && value !== 'dark' && value !== 'system') return;
    state.appearance = value;
    applyTheme();
  }
  function setTeam(id) {
    if (!themeRecord(id) || themeRecord(id).id !== id) return;
    state.team = id;
    applyTheme();
  }
  function syncSettingsUI() {
    $$('#appearSeg [data-appearance]').forEach(b => b.setAttribute('aria-checked', b.dataset.appearance === state.appearance ? 'true' : 'false'));
    $$('#themeList .theme-pick').forEach(b => b.setAttribute('aria-pressed', b.dataset.team === state.team ? 'true' : 'false'));
    const splashBox = $('#splashToggle');
    const soundBox = $('#splashSoundToggle');
    if (splashBox) splashBox.checked = splashPrefOn(SPLASH_KEY);
    if (soundBox) soundBox.checked = splashPrefOn(SPLASH_SOUND_KEY);
  }
  function renderThemeList() {
    const host = $('#themeList');
    if (!host || !window.MLThemes) return;
    const q = (($('#themeSearch') && $('#themeSearch').value) || '').trim().toLowerCase();
    const themes = window.MLThemes.filter(t => !q || t.name.toLowerCase().includes(q) || (t.division || '').toLowerCase().includes(q));
    const order = [];
    const by = new Map();
    themes.forEach(t => {
      const g = t.id === 'ml' ? 'Default' : (t.division || 'Teams');
      if (!by.has(g)) { by.set(g, []); order.push(g); }
      by.get(g).push(t);
    });
    host.innerHTML = order.length ? order.map(g => `<div class="theme-group"><div class="theme-div">${esc(g)}</div>${by.get(g).map(t => `<button type="button" class="theme-pick" data-team="${esc(t.id)}" aria-pressed="${t.id === state.team ? 'true' : 'false'}"><span class="swatch" aria-hidden="true"><i style="background:${esc(t.primary)}"></i><i style="background:${esc(t.secondary)}"></i></span><span class="theme-name">${esc(t.name)}</span></button>`).join('')}</div>`).join('') : '<p class="sub">No teams match that search.</p>';
    host.querySelectorAll('.theme-pick').forEach(b => b.addEventListener('click', () => setTeam(b.dataset.team)));
  }
  function settingsItems() {
    const dialog = $('#settingsDialog');
    if (!dialog) return [];
    return [...dialog.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && !el.closest('[hidden]') && el.offsetParent !== null);
  }
  function openSettings() {
    const dialog = $('#settingsDialog');
    if (!dialog || !dialog.hidden) return;
    settingsReturn = document.activeElement;
    dialog.hidden = false;
    const btn = $('#settingsBtn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    const app = $('.app');
    if (app) app.setAttribute('inert', '');
    const current = $('#appearSeg [aria-checked="true"]') || dialog.querySelector('button, input');
    if (current) current.focus();
  }
  function closeSettings() {
    const dialog = $('#settingsDialog');
    if (!dialog || dialog.hidden) return;
    dialog.hidden = true;
    const btn = $('#settingsBtn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    const app = $('.app');
    if (app) app.removeAttribute('inert');
    if (settingsReturn && settingsReturn.focus) settingsReturn.focus();
  }
  function onSettingsKey(e) {
    const dialog = $('#settingsDialog');
    if (!dialog || dialog.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSettings(); return; }
    if (e.key !== 'Tab') return;
    const items = settingsItems();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function initTheme() {
    const boot = window.MLThemeBoot || {};
    state.appearance = boot.appearance || 'system';
    state.team = boot.team || document.documentElement.getAttribute('data-team') || 'ml';
    state.theme = boot.mode || document.documentElement.getAttribute('data-theme') || resolvedMode(state.appearance);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => { if (state.appearance === 'system') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
    const btn = $('#settingsBtn');
    if (btn) btn.addEventListener('click', openSettings);
    document.addEventListener('keydown', onSettingsKey);
    const dialog = $('#settingsDialog');
    if (dialog) dialog.addEventListener('click', e => { if (e.target.closest('[data-settings-close]')) closeSettings(); });
    $$('#appearSeg [data-appearance]').forEach(b => b.addEventListener('click', () => setAppearance(b.dataset.appearance)));
    const search = $('#themeSearch');
    if (search) search.addEventListener('input', renderThemeList);
    const splashBox = $('#splashToggle');
    const soundBox = $('#splashSoundToggle');
    if (splashBox) splashBox.addEventListener('change', () => setSplashPref(SPLASH_KEY, splashBox.checked));
    if (soundBox) soundBox.addEventListener('change', () => setSplashPref(SPLASH_SOUND_KEY, soundBox.checked));
    renderThemeList();
    syncSettingsUI();
  }
  const SPLASH_KEY = 'ml-splash';
  const SPLASH_SOUND_KEY = 'ml-splash-sound';
  function splashPrefOn(key) {
    try { return localStorage.getItem(key) !== '0'; } catch (e) { return true; }
  }
  function setSplashPref(key, on) {
    try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) {}
    if (key === SPLASH_KEY && !on) {
      const el = $('#splash');
      if (el) el.hidden = true;
    }
  }
  function wavBlob(buffer) {
    const samples = buffer.getChannelData(0);
    const n = samples.length;
    const out = new ArrayBuffer(44 + n * 2);
    const view = new DataView(out);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, n * 2, true);
    let off = 44;
    for (let i = 0; i < n; i++) {
      const x = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      off += 2;
    }
    return new Blob([out], { type: 'audio/wav' });
  }
  function synthChant(team) {
    const seconds = 1.6;
    const rate = 22050;
    const ctx = new OfflineAudioContext(1, Math.floor(rate * seconds), rate);
    let hash = 7;
    const id = String(team || 'ml');
    for (let i = 0; i < id.length; i++) hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
    const root = 174 + (hash % 14) * 18;
    const beats = 3 + (hash % 3);
    const master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);
    for (let i = 0; i < beats; i++) {
      const t = 0.08 + i * (1.25 / beats);
      const noise = ctx.createBuffer(1, Math.floor(rate * 0.09), rate);
      const data = noise.getChannelData(0);
      for (let s = 0; s < data.length; s++) data[s] = (Math.random() * 2 - 1) * (1 - s / data.length);
      const hit = ctx.createBufferSource();
      hit.buffer = noise;
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.85, t);
      hg.gain.exponentialRampToValueAtTime(0.01, t + 0.09);
      hit.connect(hg); hg.connect(master); hit.start(t);
      const osc = ctx.createOscillator();
      osc.type = (hash + i) % 2 ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime(root * (i % 2 ? 1.25 : 1), t);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.001, t);
      og.gain.exponentialRampToValueAtTime(0.28, t + 0.03);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc.connect(og); og.connect(master); osc.start(t); osc.stop(t + 0.28);
    }
    return ctx.startRendering();
  }
  function playAudioBlob(blob) {
    return new Promise(resolve => {
      try {
        const audio = new Audio();
        audio.volume = 0.4;
        if (audio.muted || audio.volume === 0) { resolve(false); return; }
        const url = URL.createObjectURL(blob);
        audio.src = url;
        const done = ok => { URL.revokeObjectURL(url); resolve(ok); };
        const started = audio.play();
        if (started && started.then) started.then(() => done(true)).catch(() => done(false));
        else done(true);
      } catch (e) { resolve(false); }
    });
  }
  let splashSoundPlayed = false;
  let splashSoundBusy = false;
  async function playSplashSound(team) {
    if (splashSoundPlayed || splashSoundBusy || !splashPrefOn(SPLASH_SOUND_KEY)) return;
    splashSoundBusy = true;
    let ok = false;
    try {
      try {
        const res = await fetch('audio/chants/' + encodeURIComponent(team || 'ml') + '.m4a');
        if (res.ok) ok = await playAudioBlob(await res.blob());
      } catch (e) { /* a missing clip falls through to the synth */ }
      if (!ok) {
        try { ok = await playAudioBlob(wavBlob(await synthChant(team))); } catch (e) { /* stay silent */ }
      }
    } finally {
      splashSoundBusy = false;
    }
    if (ok) splashSoundPlayed = true;
  }
  function installedApp() {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.navigator.standalone) return true;
    } catch (e) {}
    return false;
  }
  function initSplash() {
    if (!splashPrefOn(SPLASH_SOUND_KEY)) return;
    if (document.documentElement.getAttribute('data-splash') === 'off') return;
    const team = window.MLSplashTeam || state.team || 'ml';
    const start = () => { playSplashSound(team); };
    if (installedApp() || window.MLSplashTap) start();
    const once = () => { window.MLSplashTap = true; start(); };
    document.addEventListener('pointerdown', once, { capture: true, once: true });
    document.addEventListener('keydown', once, { capture: true, once: true });
    setTimeout(() => {
      document.removeEventListener('pointerdown', once, true);
      document.removeEventListener('keydown', once, true);
    }, 2200);
  }

  const NA = '<span class="na">Unavailable</span>';
  const pv = (x, fn = pct) => x == null ? NA : fn(x);
  const sgn = (x, fn = f2) => x == null ? NA : (x > 0 ? '+' : '') + fn(x);
  function fmtSpread(s) { return s === 0 ? 'PK' : (s > 0 ? '+' : '\u2212') + f1(Math.abs(s)).replace(/\.0$/, ''); }
  const PROP_LABEL = { pass_att: 'Pass att', pass_yds: 'Pass yds', rush_yds: 'Rush yds', rec: 'Receptions', rec_yds: 'Rec yds' };
  function keyProp(pl, pr) {
    const p = pr.pm; if (!p) return null;
    const order = pl.pos === 'QB' ? ['pass_yds', 'pass_att', 'rush_yds'] : pl.pos === 'RB' ? ['rush_yds', 'rec_yds', 'rec'] : ['rec_yds', 'rec'];
    for (const k of order) if (p[k]) return { k, label: PROP_LABEL[k], line: p[k].line, model: { pass_att: pr.modelC.pa, pass_yds: pr.modelC.py, rush_yds: pr.modelC.ry, rec: pr.modelC.rc, rec_yds: pr.modelC.rcy }[k] };
    if (p.atd) return { k: 'atd', label: 'Anytime TD', line: null, p: p.atd.p };
    return null;
  }
  // Compact opportunity summary per position
  function oppSummary(pl) {
    const A = pl.adv || {};
    if (pl.pos === 'QB') return [['Dsgn runs/g', A.designed_runs_pg != null ? f1(A.designed_runs_pg) : null], ['Scrm/g', A.scrambles_pg != null ? f1(A.scrambles_pg) : null], ['RZ share', A.rz20_share != null ? pct(A.rz20_share) : null]];
    if (pl.pos === 'RB') return [['Opp share', A.opp_share != null ? pct(A.opp_share) : null], ['RZ20', A.rz20_share != null ? pct(A.rz20_share) : null], ['Tgt share', A.tgt_share != null ? pct(A.tgt_share) : null]];
    return [['WOPR', A.wopr != null ? f2(A.wopr) : null], ['TPRR*', A.tprr != null ? pct(A.tprr) : null], ['RZ20', A.rz20_share != null ? pct(A.rz20_share) : null]];
  }
  // Side-by-side comparison rows used by Compare and My Team
  function compareRows(pl, pr) {
    const A = pl.adv || {}, vg = pr.vg, p = pr.pm || {};
    const eff = pl.pos === 'QB' ? ['EPA / dropback', A.epa_db != null ? sgn(A.epa_db) : NA] : pl.pos === 'RB' ? ['RYOE / att', A.ryoe_att != null ? sgn(A.ryoe_att) : NA] : ['EPA / target', A.epa_tgt != null ? sgn(A.epa_tgt) : NA];
    const prop = k => p[k] ? f1(p[k].line) : '<span class="na">No line</span>';
    const rows = [
      ['Implied team total', vg ? f1(vg.itt) : NA],
      ['Spread · total', vg ? `${fmtSpread(vg.teamSpread)} · ${f1(vg.total)}` : NA],
    ];
    if (pl.pos === 'QB') rows.push(['Pass yds prop', prop('pass_yds')], ['Pass att prop', prop('pass_att')], ['Rush yds prop', prop('rush_yds')]);
    else if (pl.pos === 'RB') rows.push(['Rush yds prop', prop('rush_yds')], ['Rec yds prop', prop('rec_yds')]);
    else rows.push(['Rec yds prop', prop('rec_yds')], ['Receptions prop', prop('rec')]);
    rows.push(['Anytime TD (market)', p.atd ? pct(p.atd.p) : '<span class="na">No line</span>']);
    if (pl.pos === 'QB') rows.push(['Designed run rate', pv(A.designed_run_rate)], ['Designed runs / g', A.designed_runs_pg != null ? f1(A.designed_runs_pg) : NA]);
    else rows.push(['WOPR', A.wopr != null ? f2(A.wopr) : NA], ['TPRR (est.)', pv(A.tprr)], ['YPRR (est.)', A.yprr != null ? f2(A.yprr) : NA]);
    if (pl.pos === 'RB') rows.push(['Opportunity share', pv(A.opp_share)]);
    rows.push(['Red-zone share (in 20 / in 10)', A.rz20_share != null ? `${pct(A.rz20_share)} / ${pv(A.rz10_share)}` : NA], eff,
      ['xFP / g · FPOE / g', A.xfp_pg != null ? `${f1(A.xfp_pg)} · ${sgn(A.fpoe_pg, f1)}` : NA],
      ['Projection', f1(pr.pts)], ['Market-implied pts', pr.mktPts != null ? f1(pr.mktPts) : '<span class="na">No props</span>'],
      ['Floor–Ceiling', `<span class="range"><span class="fl">${f1(pr.floor)}</span><span class="rg-sep">–</span><span class="cl">${f1(pr.ceil)}</span></span>`], ['Boom · bust', `${pct(pr.bb.boom)} · ${pct(pr.bb.bust)}`]);
    return rows;
  }
  function gameScriptNote(pl, vg) {
    if (!vg) return '';
    const n = [];
    if (vg.margin >= 6.5) n.push(pl.pos === 'RB' ? 'Large favorite: positive script for late-game carries.' : 'Large favorite: pass volume may dip if the lead grows.');
    else if (vg.margin <= -6.5) n.push(pl.pos === 'RB' ? 'Big underdog: rushing volume at risk if trailing; receiving work matters more.' : 'Big underdog: trailing script favors pass volume.');
    else if (vg.margin <= -3) n.push(pl.pos === 'RB' ? 'Underdog: lean pass-heavy script.' : 'Underdog: slight pass-volume boost.');
    else if (vg.margin >= 3) n.push(pl.pos === 'RB' ? 'Favorite: slight rushing-volume boost.' : 'Favorite: slightly fewer pass attempts.');
    if (vg.total >= 48) n.push('High total: shootout environment raises pass volume and TD odds.');
    else if (vg.total <= 40) n.push('Low total: fewer scoring chances.');
    return n.join(' ');
  }

  // ---------- Formatting ----------
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const f2 = n => (Math.round(n * 100) / 100).toFixed(2);
  const pct = n => Math.round(n * 100) + '%';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tn = ab => state.data.team_names[ab] || ab;
  function fmtKick(g) {
    const d = new Date(g.date + 'T12:00:00');
    const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const [h, m] = (g.time || '13:00').split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM'; const hh = ((h + 11) % 12) + 1;
    return `${day} · ${hh}:${String(m).padStart(2, '0')} ${ampm} ET`;
  }

  // ---------- Weather (live Open-Meteo forecast at kickoff) ----------
  // [lat, lon, roof] — roof: 'dome' (fixed roof), 'retract' (retractable, treated as covered), 'open'
  const STADIUMS = {
    'MetLife Stadium': [40.8135, -74.0745, 'open'], 'SoFi Stadium': [33.9535, -118.3392, 'dome'], 'Lumen Field': [47.5952, -122.3316, 'open'],
    'Bank of America Stadium': [35.2258, -80.8528, 'open'], 'U.S. Bank Stadium': [44.9737, -93.2575, 'dome'], 'Lincoln Financial Field': [39.9008, -75.1675, 'open'],
    'Soldier Field': [41.8623, -87.6167, 'open'], 'Raymond James Stadium': [27.9759, -82.5033, 'open'], 'Lambeau Field': [44.5013, -88.0622, 'open'],
    'Paycor Stadium': [39.0955, -84.5161, 'open'], 'Ford Field': [42.34, -83.0456, 'dome'], 'Acrisure Stadium': [40.4468, -80.0158, 'open'],
    'Nissan Stadium': [36.1665, -86.7713, 'open'], 'Allegiant Stadium': [36.0909, -115.1833, 'dome'], 'GEHA Field at Arrowhead Stadium': [39.0489, -94.4839, 'open'],
    'Highmark Stadium': [42.7738, -78.787, 'open'], 'M&T Bank Stadium': [39.278, -76.6227, 'open'], 'Gillette Stadium': [42.0909, -71.2643, 'open'],
    'Empower Field at Mile High': [39.7439, -105.0201, 'open'], "Levi's Stadium": [37.403, -121.97, 'open'], 'Huntington Bank Field': [41.5061, -81.6995, 'open'],
    'Hard Rock Stadium': [25.958, -80.2389, 'open'], 'Northwest Stadium': [38.9078, -76.8645, 'open'], 'Caesars Superdome': [29.9511, -90.0812, 'dome'],
    'State Farm Stadium': [33.5276, -112.2626, 'retract'], 'EverBank Stadium': [30.3239, -81.6373, 'open'], 'Mercedes-Benz Stadium': [33.7554, -84.4008, 'retract'],
    'Lucas Oil Stadium': [39.7601, -86.1639, 'retract'], 'AT&T Stadium': [32.7473, -97.0945, 'retract'], 'Reliant Stadium': [29.6847, -95.4107, 'retract'],
    'NRG Stadium': [29.6847, -95.4107, 'retract'], 'Wembley Stadium': [51.556, -0.2796, 'open'], 'Tottenham Hotspur Stadium': [51.6043, -0.0664, 'open'],
    'Maracana Stadium': [-22.9121, -43.2302, 'open'], 'Estadio Banorte': [19.3029, -99.1505, 'open'], 'Bernabeu': [40.4531, -3.6883, 'retract'],
    'FC Bayern Munich Stadium': [48.2188, 11.6247, 'open'], 'Stade de France': [48.9245, 2.3602, 'open'], 'Melbourne Cricket Ground': [-37.82, 144.9834, 'open'],
  };
  function stadiumOf(g) { return STADIUMS[g.stadium] || null; }
  function kickoffUTC(g) {
    // nflverse times are US Eastern; EDT (UTC-4) from 2nd Sunday of March to 1st Sunday of November, else EST (UTC-5)
    const [y, mo, d] = g.date.split('-').map(Number); const [h, mi] = (g.time || '13:00').split(':').map(Number);
    const nthSun = (yy, m, n) => { const f = new Date(Date.UTC(yy, m, 1)).getUTCDay(); return 1 + ((7 - f) % 7) + 7 * (n - 1); };
    const dstStart = Date.UTC(y, 2, nthSun(y, 2, 2)), dstEnd = Date.UTC(y, 10, nthSun(y, 10, 1));
    const local = Date.UTC(y, mo - 1, d);
    const off = local >= dstStart && local < dstEnd ? 4 : 5;
    return new Date(Date.UTC(y, mo - 1, d, h + off, mi));
  }
  state.wx = {}; state.wxWeeks = {};
  async function loadWeather(week) {
    if (state.wxWeeks[week]) return;
    state.wxWeeks[week] = 'loading';
    const games = (state.data.schedule[week] || []).filter(g => g.home_score == null);
    const now = Date.now(), horizon = now + 15.5 * 864e5;
    const todo = [];
    for (const g of games) {
      const st = stadiumOf(g);
      if (!st) { state.wx[g.id] = { status: 'unknown' }; continue; }
      if (st[2] !== 'open') { state.wx[g.id] = { status: 'indoor', roof: st[2] }; continue; }
      const k = kickoffUTC(g);
      if (k.getTime() > horizon) { state.wx[g.id] = { status: 'later' }; continue; }
      if (k.getTime() + 4 * 36e5 < now) continue;
      todo.push({ g, st, k });
    }
    if (todo.length) {
      const days = todo.map(t => t.k.toISOString().slice(0, 10)).sort();
      const end = new Date(new Date(days[days.length - 1] + 'T00:00:00Z').getTime() + 864e5).toISOString().slice(0, 10);
      const q = new URLSearchParams({
        latitude: todo.map(t => t.st[0]).join(','), longitude: todo.map(t => t.st[1]).join(','),
        hourly: 'temperature_2m,precipitation,precipitation_probability,snowfall,wind_speed_10m,wind_gusts_10m,weather_code',
        temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch', timezone: 'GMT',
        start_date: days[0], end_date: end,
      });
      try {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 10000);
        const r = await fetch('https://api.open-meteo.com/v1/forecast?' + q, { signal: ctl.signal }); clearTimeout(to);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        let arr = await r.json(); if (!Array.isArray(arr)) arr = [arr];
        todo.forEach((t, i) => {
          const H = (arr[i] || {}).hourly; if (!H || !H.time) return;
          const k0 = t.k.toISOString().slice(0, 13) + ':00';
          let s = H.time.indexOf(k0); if (s < 0) return;
          const idx = [s, s + 1, s + 2, s + 3].filter(j => j < H.time.length);
          const avg = a => idx.reduce((x, j) => x + (Number(H[a][j]) || 0), 0) / idx.length;
          const sum = a => idx.reduce((x, j) => x + (Number(H[a][j]) || 0), 0);
          const max = a => Math.max(...idx.map(j => Number(H[a][j]) || 0));
          state.wx[t.g.id] = { status: 'ok', temp: avg('temperature_2m'), wind: avg('wind_speed_10m'), gust: max('wind_gusts_10m'),
            precip: sum('precipitation'), snow: sum('snowfall'), pop: max('precipitation_probability'), code: Number(H.weather_code[s]) || 0 };
        });
      } catch (e) { todo.forEach(t => { if (!state.wx[t.g.id]) state.wx[t.g.id] = { status: 'error' }; }); }
    }
    state.wxWeeks[week] = 'done';
    rerender();
  }
  // Multipliers on volume/efficiency. Grounded in public studies: passing falls steadily above ~10 mph wind and
  // sharply above 20 mph; rain trims passing ~5-12% and adds a carry or so for the lead back; heavy snow is the largest effect.
  const WX_CODES = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms', 99: 'Thunderstorms' };
  function weatherText(g) {
    const w = g && state.wx[g.id];
    if (!w) return state.wxWeeks[state.week] === 'loading' ? 'Loading forecast…' : '';
    if (w.status === 'indoor') return w.roof === 'retract' ? 'Retractable roof' : 'Indoors';
    if (w.status === 'later') return 'Forecast not out yet';
    if (w.status !== 'ok') return '';
    const sky = WX_CODES[w.code] || '';
    const rain = w.pop >= 30 && (w.precip > 0.01 || w.snow > 0) ? ` · ${Math.round(w.pop)}% ${w.snow > 0.1 ? 'snow' : 'rain'}` : '';
    return `${Math.round(w.temp)}°F · ${sky ? sky + ' · ' : ''}${Math.round(w.wind)} mph wind${rain}`;
  }
  function weatherChip(g, pr) {
    const txt = weatherText(g); if (!txt) return '';
    const a = pr && pr.wx;
    const delta = a && pr.wxDelta ? pr.wxDelta : 0;
    const cls = delta <= -0.5 ? 'wx bad' : delta >= 0.5 ? 'wx good' : 'wx';
    const d = Math.abs(delta) >= 0.1 ? ` <b>${delta > 0 ? '+' : '−'}${f1(Math.abs(delta))}</b>` : '';
    return `<span class="${cls}" title="Game-time forecast (Open-Meteo)${a && a.tags.length ? ': ' + esc(a.tags.join(', ')) : ''}">${esc(txt)}${d}</span>`;
  }
  function rkCls(rk) { return rk >= 22 ? 'good' : rk <= 11 ? 'bad' : 'neutral'; } // for offense: high rank (generous D) is good
  function rkOrd(rk) { const s = ['th', 'st', 'nd', 'rd'], v = rk % 100; return rk + (s[(v - 20) % 10] || s[v] || s[0]); }
  function avatar(pl, cls = '') {
    return pl.headshot ? `<img class="${cls}" src="${esc(pl.headshot)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${cls || 'avatar'}'}))">` : `<span class="${cls || 'avatar'}"></span>`;
  }
  // ---------- Injury status (live ESPN feed when available, weekly snapshot otherwise) ----------
  const OUT_STATUS = /^(out|ir|injured reserve|injury reserve|pup|sus|suspended|suspension|doubtful|na|cov)$/i;
  const pretty = s => String(s).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/^Ir$/, 'IR');
  function injuryOf(pl) {
    const sl = pl.sl_inj && pl.sl_inj.status ? { status: pretty(pl.sl_inj.status), injury: pl.sl_inj.body || null } : null;
    if (state.liveInj) {
      const live = pl.ids && pl.ids.espn ? state.liveInj[pl.ids.espn] : null;
      if (live) return { status: pretty(live), injury: sl ? sl.injury : null, live: true };
      // ESPN's live feed only lists Out / IR; keep weekly Doubtful / Questionable / Suspended tags
      if (sl && !/^(out|ir|injured reserve)$/i.test(sl.status)) return sl;
      return null;
    }
    if (sl) return sl;
    if (pl.inj && pl.inj.status) return { status: pl.inj.status, injury: pl.inj.injury };
    return null;
  }
  const isOut = pl => { const i = injuryOf(pl); return !!(i && OUT_STATUS.test(i.status.trim())); };
  function hadGame(team, week) { return !!(state.data.schedule[week] || []).find(g => g.home === team || g.away === team); }
  const missedLast = pl => { const lc = state.data.meta.last_completed_week; return pl.last_wk < lc && hadGame(pl.team, lc); };
  function practiceBack(pl) {
    const inj = pl && pl.tv && pl.tv.inj;
    return !!(inj && inj.practice && !inj.long);
  }
  function statusFlag(pl) {
    const lc = state.data.meta.last_completed_week;
    if (practiceBack(pl)) return `<span class="flag">${esc(pl.tv.inj.practice)}</span>`;
    const inj = injuryOf(pl);
    if (inj && OUT_STATUS.test(inj.status.trim())) return `<span class="flag out">${esc(inj.status)}${inj.injury ? ' · ' + esc(inj.injury) : ''}</span>`;
    if (inj) return `<span class="flag">${esc(inj.status)}${inj.injury ? ' · ' + esc(inj.injury) : ''}</span>`;
    if (missedLast(pl)) return `<span class="flag">Missed Wk ${lc}</span>`;
    return '';
  }
  function newsItemsFor(id) { return (id && state.newsByPlayer[id]) || []; }
  function hasInjuryNews(id) { return newsItemsFor(id).some(item => item.injury); }
  function rosterIds() { return (window.MLTeam && window.MLTeam.rosterIds) ? window.MLTeam.rosterIds() : []; }
  function newsBadge(pl) {
    if (!pl) return '';
    const items = newsItemsFor(pl.id);
    if (!items.length) return '';
    const inj = items.some(item => item.injury);
    const title = esc(items[0].headline || '');
    return `<span class="news-badge${inj ? ' inj' : ''}" title="${title}">${inj ? 'Injury' : 'News'}</span>`;
  }
  function ago(ts) {
    const t = Date.parse(ts || '');
    if (!Number.isFinite(t)) return '';
    const min = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (min < 60) return (min || 1) + 'm ago';
    const hr = Math.round(min / 60);
    if (hr < 36) return hr + 'h ago';
    return Math.round(hr / 24) + 'd ago';
  }
  function newsCard(item) {
    const who = [item.player, item.team].filter(Boolean).join(' · ');
    const when = ago(item.ts);
    return `<a class="news-card${item.injury ? ' inj' : ''}" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">
      <span class="news-hl">${esc(item.headline)}</span>
      <span class="news-meta">${esc(item.source || 'News')}${when ? ' · ' + when : ''}${who ? ' · ' + esc(who) : ''}</span>
    </a>`;
  }
  function indexNews() {
    const by = {};
    for (const item of (state.news && state.news.items) || []) {
      if (!item || !item.player_id) continue;
      (by[item.player_id] || (by[item.player_id] = [])).push(item);
    }
    state.newsByPlayer = by;
  }
  function playerNewsCard(pl) {
    const items = newsItemsFor(pl.id).slice(0, 4);
    if (!items.length) return '';
    const inj = items.some(item => item.injury);
    return `<div class="card news-player${inj ? ' inj' : ''}"><div class="card-title">${inj ? 'Injury news' : 'Latest news'}</div><div class="news-list">${items.map(newsCard).join('')}</div></div>`;
  }
  function renderNews() {
    const box = $('#newsList');
    if (!box) return;
    const doc = state.news;
    const status = $('#newsStatus');
    if (!doc || !Array.isArray(doc.items)) {
      if (status) { status.hidden = false; status.className = 'notice'; status.textContent = 'News is not available right now. Projections are unchanged.'; }
      box.innerHTML = '';
      return;
    }
    if (status) {
      status.hidden = !doc.stale;
      status.className = 'notice';
      status.textContent = doc.stale ? (doc.stale_reason || 'Showing the last news file. The latest fetch failed.') : '';
    }
    const worked = (doc.sources || []).filter(s => s.ok).map(s => s.label);
    const skipped = (doc.sources || []).find(s => s.id === 'x');
    const sub = $('#newsSub');
    if (sub) {
      const when = doc.generated ? `Updated ${doc.generated}. ` : '';
      sub.textContent = `${when}${worked.length ? worked.join(', ') + '.' : 'No feeds responded.'} ${skipped ? 'X posts are not included.' : ''}`.trim();
    }
    const roster = new Set(rosterIds());
    let items = doc.items.slice();
    if (state.newsFilter === 'injury') items = items.filter(item => item.injury);
    if (state.newsFilter === 'roster') items = items.filter(item => item.player_id && roster.has(item.player_id));
    if (!items.length) {
      box.innerHTML = `<p class="sub">${state.newsFilter === 'roster' && !roster.size ? 'Connect a team on My Team to see news for your roster.' : 'No headlines in this filter.'}</p>`;
      return;
    }
    box.innerHTML = items.map(newsCard).join('');
  }
  async function loadPracticeReports() {
    if (!window.MLTrade || !window.MLTrade.applyPractice || !state.data) return;
    try {
      const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries');
      if (!r.ok) return;
      const n = window.MLTrade.applyPractice(state.data, await r.json());
      if (n) rerender();
    } catch (e) { /* the baked injury tag stays */ }
  }
  async function loadLiveInjuries() {
    const F = JSON.stringify({ players: { filterInjured: { value: true }, filterSlotIds: { value: [0, 2, 4, 6] }, filterStatsForExternalIds: { value: [2099] }, sortPercOwned: { sortAsc: false, sortPriority: 1 }, limit: 600 } });
    try {
      const r = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${state.data.meta.season}/segments/0/leaguedefaults/3?view=kona_player_info`, { headers: { 'X-Fantasy-Filter': F } });
      if (!r.ok) return;
      const d = await r.json();
      const map = {};
      for (const e of (d.players || [])) { const p = e.player || {}; if (p.id && p.injuryStatus && p.injuryStatus !== 'ACTIVE') map[String(p.id)] = p.injuryStatus; }
      if (Object.keys(map).length < 5) return; // sanity check
      state.liveInj = map;
      state.liveInjAt = new Date();
      rerender();
    } catch (e) { /* fall back to weekly snapshot */ }
  }

  // ---------- Board ----------
  function rankedPlayers(week, scoring, pos) {
    const lc = state.data.meta.last_completed_week;
    const rows = [];
    for (const pl of state.data.players) {
      if (pl.tradeOnly) continue;
      if (pos !== 'ALL' && pl.pos !== pos) continue;
      if (isOut(pl)) continue;
      const pr = project(pl, week, scoring);
      if (pr.bye) continue;
      rows.push({ pl, pr });
    }
    rows.sort((a, b) => b.pr.pts - a.pr.pts);
    return rows;
  }

  function usageChips(pl) {
    const w = pl.w, t = pl.t, g = pl.g;
    const c = [];
    if (pl.pos === 'QB') {
      c.push(`<span class="chip"><b>${f1(w.pa)}</b> att</span>`, `<span class="chip"><b>${Math.round(w.py)}</b> pass yds</span>`, `<span class="chip"><b>${Math.round(w.ry)}</b> rush yds</span>`);
    } else if (pl.pos === 'RB') {
      c.push(`<span class="chip"><b>${f1(w.ca)}</b> car</span>`, `<span class="chip"><b>${t.ca ? f1(t.ry / t.ca) : '—'}</b> YPC</span>`, `<span class="chip"><b>${f1(w.tg)}</b> tgt</span>`);
    } else {
      c.push(`<span class="chip"><b>${f1(w.tg)}</b> tgt</span>`, `<span class="chip"><b>${w.ts != null ? pct(w.ts) : '—'}</b> share</span>`, `<span class="chip"><b>${t.tg ? f1(t.airy / t.tg) : '—'}</b> aDOT</span>`);
    }
    return c.join('');
  }

  function renderBoard() {
    loadWeather(state.week);
    const week = state.week, lc = state.data.meta.last_completed_week;
    $('#boardWeekLabel').textContent = `Week ${week}`;
    const rows = rankedPlayers(week, state.scoring, state.pos).slice(0, 20);
    const posTxt = state.pos === 'ALL' ? 'across all positions' : `among ${state.pos}s`;
    $('#boardSub').textContent = `Expected ${SCORING[state.scoring].name} points vs. each player's Week ${week} opponent, ranked ${posTxt}. Includes everyone with a Week ${week} game; players on bye or ruled Out / IR are left off. Based on Weeks 1–${lc}. ITT = implied team total from the betting line; TPRR* is estimated from snap share.${state.liveInj ? ' Injury statuses live from ESPN.' : ''}`;
    const body = $('#boardBody');
    const mk = state.market && state.market.week === week;
    const staleNote = state.market && state.market.stale
      ? ` <b>These lines are stale</b> (${esc(state.market.stale_reason || 'the last odds fetch failed')}).`
      : '';
    $('#boardMarketNote').innerHTML = mk ? `Vegas lines and player props: ${esc((state.market.books || []).length > 1 ? 'consensus of ' + state.market.books.join(', ') : (state.market.books || ['DraftKings'])[0])}, as of ${esc(new Date(state.market.as_of).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}.${staleNote} Props are posted gradually during the week, so many players have no line yet.`
      : `Sportsbook player props aren't loaded for Week ${week}; spreads and totals come from the nflverse schedule where posted.${staleNote}`;
    if (!rows.length) { body.innerHTML = `<tr class="empty-row"><td colspan="9">No projections for this week.</td></tr>`; $('#boardExtras').innerHTML = ''; return; }
    body.innerHTML = rows.map(({ pl, pr }, i) => {
      const vg = pr.vg, kp = keyProp(pl, pr);
      const vegasLine = vg ? `<span class="vegas" data-gl="ITT">ITT <b>${f1(vg.itt)}</b> · ${esc(pl.team)} ${fmtSpread(vg.teamSpread)} · O/U ${f1(vg.total)}</span>` : `<span class="vegas na">No line yet</span>`;
      const propCell = kp ? (kp.k === 'atd' ? `<div class="kp"><span class="kp-l">${kp.label}</span><b>${pct(kp.p)}</b></div>`
        : `<div class="kp"><span class="kp-l">${kp.label}</span><b>${f1(kp.line)}</b><span class="kp-m">model ${f1(kp.model)}</span></div>${pr.pm.atd ? `<div class="kp-sub">ATD ${pct(pr.pm.atd.p)}</div>` : ''}`) : '<span class="na">No props yet</span>';
      const opp = oppSummary(pl).map(([k, v]) => `<span class="chip">${k} <b>${v ?? '—'}</b></span>`).join('');
      const flags = [pr.reg ? `<span class="flagc ${pr.reg.type}" title="${esc(pr.reg.why)}">${pr.reg.type === 'buy' ? 'Regression: up' : 'Fade'}</span>` : '',
        pr.diverge ? `<span class="flagc mkt" title="Market-implied ${f1(pr.mktPts)} vs model ${f1(pr.modelPts)}">Market ${pr.diverge}</span>` : ''].join('');
      const onRoster = rosterIds().includes(pl.id);
      const injNews = onRoster && hasInjuryNews(pl.id);
      return `
      <tr class="${injNews ? 'has-news-inj' : ''}" data-id="${esc(pl.id)}" tabindex="0" role="link" aria-label="Open ${esc(pl.name)}">
        <td class="num rank">${i + 1}</td>
        <td><div class="pcell">${avatar(pl, 'avatar')}<div><div class="name">${esc(pl.name)} ${statusFlag(pl)} ${newsBadge(pl)}</div><div class="meta"><span class="pos ${pl.pos}">${pl.pos}</span> ${esc(pl.team)}<span class="m-only"> · ${pr.home ? 'vs' : '@'} ${esc(pr.opp)}${vg ? ` · ITT ${f1(vg.itt)}` : ''}</span></div></div></div></td>
        <td class="matchup"><span class="vs">${pr.home ? 'vs' : '@'}</span> ${esc(pr.opp)} <span class="grade ${pr.grade.cls} sm">${pr.grade.label}</span><span class="when">${fmtKick(pr.game)}</span>${vegasLine}${weatherChip(pr.game, pr)}</td>
        <td>${propCell}</td>
        <td><div class="chips">${opp}</div></td>
        <td class="num"><div class="proj-stack"><span class="projv">${f1(pr.pts)}</span>${workloadMark(pl)}${pr.mktPts != null ? `<div class="mktv" data-gl="mkt">mkt ${f1(pr.mktPts)}</div>` : ''}</div></td>
        <td class="num"><span class="range"><span class="fl">${f1(pr.floor)}</span><span class="rg-sep">–</span><span class="cl">${f1(pr.ceil)}</span></span></td>
        <td class="num bbcell"><span class="boom">${pct(pr.bb.boom)}</span> / <span class="bust">${pct(pr.bb.bust)}</span></td>
        <td><div class="flags">${flags || '<span class="na">—</span>'}</div></td>
      </tr>`; }).join('');
    $$('tr[data-id]', body).forEach(tr => {
      const open = () => openPlayer(tr.dataset.id);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    renderRegression(week);
  }

  function renderRegression(week) {
    const playing = r => window.MLModel.regRole(r.pl, week, state.data);
    const all = rankedPlayers(week, state.scoring, state.pos).filter(r => r.pl.g >= 2 && r.pr.pts >= 8 && playing(r));
    const buys = all.filter(r => r.pr.reg && r.pr.reg.type === 'buy').sort((a, b) => a.pl.adv.fpoe_pg - b.pl.adv.fpoe_pg).slice(0, 8);
    const fades = all.filter(r => r.pr.reg && r.pr.reg.type === 'fade').sort((a, b) => b.pl.adv.fpoe_pg - a.pl.adv.fpoe_pg).slice(0, 8);
    const li = ({ pl, pr }) => `<li data-id="${esc(pl.id)}" tabindex="0"><span class="pos ${pl.pos}">${pl.pos}</span> <b>${esc(pl.name)}</b> <span class="meta">${esc(pl.team)} · proj ${f1(pr.pts)}</span><div class="why">${esc(pr.reg.why)}${pr.vg ? ` · ITT ${f1(pr.vg.itt)}` : ''}</div></li>`;
    const el = $('#boardExtras');
    el.innerHTML = `<div class="grid-2">
      <div class="card"><div class="card-title">Positive regression candidates · strong usage, soft results</div>${buys.length ? `<ul class="reglist">${buys.map(li).join('')}</ul>` : '<p class="sub">None this week.</p>'}</div>
      <div class="card"><div class="card-title">Fades · production running ahead of usage</div>${fades.length ? `<ul class="reglist">${fades.map(li).join('')}</ul>` : '<p class="sub">None this week.</p>'}</div>
    </div><p class="sub">Based on expected fantasy points (xFP) from <a href="https://github.com/ffverse/ffopportunity" target="_blank" rel="noopener">ffopportunity</a>, which prices every target and carry by down, distance, field position and depth. FPOE = actual minus expected PPR points per game. Only a current role is listed: the starting quarterback, and skill players with a real snap or touch share in the team's last two games. Backups, players who are out, and garbage-time cameos are left off.</p>`;
    $$('li[data-id]', el).forEach(x => { const o = () => openPlayer(x.dataset.id); x.addEventListener('click', o); x.addEventListener('keydown', e => { if (e.key === 'Enter') o(); }); });
  }

  // ---------- Player view ----------
  let chart = null;
  function openPlayer(id) {
    const pl = state.data.players.find(p => p.id === id);
    if (!pl) return;
    state.player = pl;
    $('#playerTab').disabled = false;
    $('#playerTab').textContent = pl.name;
    setView('player');
    renderPlayer(pl);
  }

  function posMetrics(pl) {
    const w = pl.w, t = pl.t, g = pl.g, L = state.data.league;
    const m = [];
    const M = (k, v, s) => m.push({ k, v, s });
    if (pl.pos === 'QB') {
      M('Pass att / g', f1(w.pa), 'recency-wtd');
      M('Pass yds / g', f1(w.py), 'recency-wtd');
      M('Comp %', t.pa ? pct(t.pc / t.pa) : '—', `lg ${pct(L.comp_pct)}`);
      M('Yds / att', t.pa ? f1(t.py / t.pa) : '—', `lg ${f1(L.ypa)}`);
      M('TD rate', t.pa ? f1(100 * t.ptd / t.pa) + '%' : '—', `lg ${f1(100 * L.pass_td_rate)}%`);
      M('INT rate', t.pa ? f1(100 * t.int / t.pa) + '%' : '—', `lg ${f1(100 * L.int_rate)}%`);
      M('Rush att / g', f1(w.ca), 'recency-wtd');
      M('Rush yds / g', f1(w.ry), `${t.rtd} rush TD`);
      M('CPOE', t.cpoe != null ? (t.cpoe > 0 ? '+' : '') + f1(t.cpoe) : '—', 'comp % over exp.');
      M('Sacks / g', f1(t.sk / g), '');
    } else if (pl.pos === 'RB') {
      M('Carries / g', f1(w.ca), 'recency-wtd');
      M('Yds / carry', t.ca ? f2(t.ry / t.ca) : '—', `lg ${f2(L.ypc)}`);
      M('Rush yds / g', f1(w.ry), `${t.rtd} rush TD`);
      M('10+ yd runs', t.r10, `${t.ca ? pct(t.r10 / t.ca) : '—'} of carries`);
      M('Targets / g', f1(w.tg), 'recency-wtd');
      M('Target share', w.ts != null ? pct(w.ts) : '—', 'of team targets');
      M('Rec / g', f1(w.rc), `${t.tg ? pct(t.rc / t.tg) : '—'} catch rate`);
      M('Rec yds / g', f1(w.rcy), `${t.rctd} rec TD`);
      M('Touches / g', f1(w.ca + w.rc), '');
      M('Fumbles lost', t.fl, 'season');
    } else {
      M('Targets / g', f1(w.tg), 'recency-wtd');
      M('Target share', w.ts != null ? pct(w.ts) : '—', 'of team targets');
      M('aDOT', t.tg ? f1(t.airy / t.tg) : '—', 'avg depth of target');
      M('Air-yds share', t.ays != null ? pct(t.ays) : '—', 'of team air yds');
      M('WOPR', t.wopr != null ? f2(t.wopr) : '—', 'wtd opportunity');
      M('Catch rate', t.tg ? pct(t.rc / t.tg) : '—', `${t.rc} / ${t.tg}`);
      M('Yds / target', t.tg ? f1(t.rcy / t.tg) : '—', `lg ${f1(L.ypt)}`);
      M('YAC / rec', t.rc ? f1(t.yac / t.rc) : '—', 'after catch');
      M('Rec yds / g', f1(w.rcy), `${t.rctd} rec TD`);
      M('20+ yd catches', t.rc20, 'season');
      if (t.ca >= 3) M('Carries / g', f1(w.ca), `${t.ry} yds`);
    }
    return m;
  }

  function defenseProfile(def, pos) {
    const a = def.allowed, r = def.ranks, L = state.data.league, P = def.pos[pos], LP = state.data.league_pos[pos];
    const items = [
      { k: 'Points allowed / g', v: f1(a.pts_pg), rk: r.pts },
      { k: `Fantasy pts to ${pos} / g (PPR)`, v: f1(P.ppr_pg), rk: r['fp_' + pos], lg: f1(LP.ppr_pg) },
    ];
    if (pos === 'QB') items.push(
      { k: 'Pass yds allowed / g', v: f1(a.pass_yds_pg), rk: r.pass_yds, lg: f1(L.passing_yards) },
      { k: 'Yds / attempt allowed', v: f1(a.ypa), rk: r.ypa, lg: f1(L.ypa) },
      { k: 'Pass TD allowed / g', v: f2(a.pass_td_pg), rk: r.pass_td, lg: f2(L.passing_tds) },
      { k: 'Interceptions / g', v: f2(a.int_pg), rk: r.int, lg: f2(L.passing_interceptions), inv: true },
      { k: 'Sacks / g', v: f2(a.sacks_pg), rk: r.sacks, lg: f2(L.sacks_suffered), inv: true },
      { k: 'Rush yds allowed / g', v: f1(a.rush_yds_pg), rk: r.rush_yds, lg: f1(L.rushing_yards) },
    );
    else if (pos === 'RB') items.push(
      { k: 'Rush yds allowed / g', v: f1(a.rush_yds_pg), rk: r.rush_yds, lg: f1(L.rushing_yards) },
      { k: 'Yds / carry allowed', v: f2(a.ypc), rk: r.ypc, lg: f2(L.ypc) },
      { k: 'Rush att faced / g', v: f1(a.rush_att_pg), rk: null, lg: f1(L.carries) },
      { k: 'Rush TD allowed / g', v: f2(a.rush_td_pg), rk: r.rush_td, lg: f2(L.rushing_tds) },
      { k: 'RB rec yds allowed / g', v: f1(P.rec_yds_pg), rk: r.rec_yds_RB, lg: f1(LP.rec_yds_pg) },
      { k: 'RB receptions allowed / g', v: f1(P.rec_pg), rk: null, lg: f1(LP.rec_pg) },
    );
    else items.push(
      { k: 'Pass yds allowed / g', v: f1(a.pass_yds_pg), rk: r.pass_yds, lg: f1(L.passing_yards) },
      { k: 'Yds / attempt allowed', v: f1(a.ypa), rk: r.ypa, lg: f1(L.ypa) },
      { k: 'Completion % allowed', v: pct(a.comp_pct), rk: null, lg: pct(L.comp_pct) },
      { k: `${pos} rec yds allowed / g`, v: f1(P.rec_yds_pg), rk: r['rec_yds_' + pos], lg: f1(LP.rec_yds_pg) },
      { k: `${pos} targets faced / g`, v: f1(P.tgt_pg), rk: null, lg: f1(LP.tgt_pg) },
      { k: 'Pass TD allowed / g', v: f2(a.pass_td_pg), rk: r.pass_td, lg: f2(L.passing_tds) },
      { k: 'Interceptions / g', v: f2(a.int_pg), rk: r.int, lg: f2(L.passing_interceptions), inv: true },
    );
    return items;
  }

  function strengthsWeaknesses(def) {
    const r = def.ranks, a = def.allowed;
    const all = [
      { rk: r.pass_yds, good: `Limits passing yards (${f1(a.pass_yds_pg)}/g, ${rkOrd(r.pass_yds)})`, bad: `Leaks passing yards (${f1(a.pass_yds_pg)}/g, ${rkOrd(r.pass_yds)})` },
      { rk: r.ypa, good: `Stingy per attempt (${f1(a.ypa)} Y/A)`, bad: `Gives up chunk passes (${f1(a.ypa)} Y/A)` },
      { rk: r.rush_yds, good: `Stout run defense (${f1(a.rush_yds_pg)} yds/g)`, bad: `Soft run defense (${f1(a.rush_yds_pg)} yds/g)` },
      { rk: r.ypc, good: `Wins at the line (${f2(a.ypc)} YPC allowed)`, bad: `Loses at the line (${f2(a.ypc)} YPC allowed)` },
      { rk: r.pass_td, good: `Few passing TDs allowed (${f2(a.pass_td_pg)}/g)`, bad: `Passing TDs come easy (${f2(a.pass_td_pg)}/g)` },
      { rk: r.rush_td, good: `Red-zone run stops (${f2(a.rush_td_pg)} rush TD/g)`, bad: `Gives up rushing TDs (${f2(a.rush_td_pg)}/g)` },
      { rk: r.int, good: `Ball-hawking (${f2(a.int_pg)} INT/g, ${rkOrd(r.int)})`, bad: `Rarely takes it away (${f2(a.int_pg)} INT/g)` },
      { rk: r.sacks, good: `Gets after the QB (${f2(a.sacks_pg)} sacks/g)`, bad: `Weak pass rush (${f2(a.sacks_pg)} sacks/g)` },
      { rk: r.fp_QB, good: `Tough on QBs (${rkOrd(r.fp_QB)} fewest pts)`, bad: `Generous to QBs (${rkOrd(r.fp_QB)} most pts allowed)` },
      { rk: r.fp_RB, good: `Tough on RBs (${rkOrd(r.fp_RB)} fewest pts)`, bad: `Generous to RBs (${rkOrd(r.fp_RB)})` },
      { rk: r.fp_WR, good: `Tough on WRs (${rkOrd(r.fp_WR)} fewest pts)`, bad: `Generous to WRs (${rkOrd(r.fp_WR)})` },
      { rk: r.fp_TE, good: `Tough on TEs (${rkOrd(r.fp_TE)} fewest pts)`, bad: `Generous to TEs (${rkOrd(r.fp_TE)})` },
    ];
    const strengths = all.filter(x => x.rk <= 10).sort((x, y) => x.rk - y.rk).slice(0, 4).map(x => x.good);
    const weaknesses = all.filter(x => x.rk >= 23).sort((x, y) => y.rk - x.rk).slice(0, 4).map(x => x.bad);
    return { strengths, weaknesses };
  }

  function renderPlayer(pl) {
    loadWeather(state.week);
    const view = $('#view-player');
    const pr = project(pl, state.week, state.scoring);
    const S = SCORING[state.scoring];
    const lc = state.data.meta.last_completed_week;

    const head = `
      <button class="back" id="backBtn" type="button">← Back to Top 20</button>
      <div class="player-hero">
        <div class="player-id">
          ${avatar(pl, 'avatar-lg')}
          <div>
            <h1>${esc(pl.name)}</h1>
            <div class="line"><span class="pos ${pl.pos}">${pl.pos}</span><span>${esc(tn(pl.team))}</span><span>·</span><span>${pl.g} games · ${f1(state.scoring === 'std' ? pl.std_pg : pl.ppr_pg)} ${state.scoring === 'std' ? 'std' : 'PPR'} pts/g</span>${statusFlag(pl)} ${newsBadge(pl)}</div>
          </div>
        </div>
        ${pr.bye ? '' : `<div class="proj-hero">
          <div class="lbl">Week ${state.week} projection · ${S.name}</div>
          <div class="big">${f1(pr.pts)}</div>
          ${workloadHero(pl, pr)}
          <div class="rng"><span class="band floor"><span data-gl="Floor">Floor</span> <b>${f1(pr.floor)}</b></span><span class="band ceil">Ceiling <b>${f1(pr.ceil)}</b></span><span class="rng-meta">Boom ${pct(pr.bb.boom)} · Bust ${pct(pr.bb.bust)}${pr.mktPts != null ? ` · Market ${f1(pr.mktPts)}` : ''} &nbsp;|&nbsp; ${pr.home ? 'vs' : '@'} ${esc(tn(pr.opp))} · ${fmtKick(pr.game)}</span></div>
          ${weatherText(pr.game) ? `<div class="rng wx-line">Weather: ${esc(weatherText(pr.game))}${pr.wx && pr.wx.tags.length ? ` — ${esc(pr.wx.tags.join(', '))}, projection ${pr.wxDelta < 0 ? 'lowered' : 'raised'} ${f1(Math.abs(pr.wxDelta))} pts` : ''}</div>` : ''}
        </div>`}
      </div>`;

    if (pr.bye) {
      view.innerHTML = head + playerNewsCard(pl) + `<div class="card bye">${esc(pl.name)} is on bye in Week ${state.week}. Choose another week to see a projection.</div>` + gameLogCard(pl);
      bindPlayerView();
      return;
    }

    const injP = injuryOf(pl);
    const outP = injP && OUT_STATUS.test(injP.status.trim());
    const injTxt = injP ? `${esc(injP.status)}${injP.injury ? ' (' + esc(injP.injury) + ')' : ''}${injP.live ? ' per ESPN' : ''}` : '';
    const missedNote = practiceBack(pl) ? `<div class="notice">${esc(pl.tv.inj.note || pl.tv.inj.practice)}</div>`
      : outP ? `<div class="notice bad">⚠ ${esc(pl.name)} is listed ${injTxt}. Projection shows his output if he were active.</div>`
      : missedLast(pl) ? `<div class="notice">⚠ ${esc(pl.name)} did not play in Week ${lc}${injP ? ' — currently ' + injTxt : ''}. Projection assumes a normal workload; verify status before kickoff.</div>`
      : injP ? `<div class="notice">⚠ Injury status: ${injTxt}.</div>` : '';

    const d = pr.dist;
    const pctLabel = { 0.1: 'Floor', 0.25: 'P25', 0.5: 'P50', 0.75: 'P75', 0.9: 'Ceiling' };
    const pcts = [0.1, 0.25, 0.5, 0.75, 0.9].map(p => {
      const cls = p === 0.1 ? ' floor' : p === 0.9 ? ' ceil' : p === 0.5 ? ' mid' : '';
      const v = p === 0.1 ? pr.floor : d.quantile(p);
      return `<div class="pct${cls}"><div class="k">${pctLabel[p]}</div><div class="v">${f1(v)}</div></div>`;
    }).join('');
    const ths = [10, 15, 20, 25, 30].map(x => { const p = d.pOver(x); return `<div class="th-row"><span>≥ ${x} pts</span><div class="bar"><i style="width:${Math.round(p * 100)}%"></i></div><span class="v">${pct(p)}</span></div>`; }).join('');

    const compRows = compRowsFor(pl, pr, S);
    const metrics = posMetrics(pl).map(m => `<div class="metric"><div class="k">${m.k}</div><div class="v">${m.v}</div>${m.s ? `<div class="s">${m.s}</div>` : ''}</div>`).join('');
    const prof = defenseProfile(pr.def, pl.pos);
    const sw = strengthsWeaknesses(pr.def);
    const defItems = prof.map(it => {
      let rkHtml = '';
      if (it.rk) { const cls = it.inv ? (it.rk <= 11 ? 'bad' : it.rk >= 22 ? 'good' : 'neutral') : rkCls(it.rk); rkHtml = `<span class="rk ${cls}">${rkOrd(it.rk)}</span>`; }
      return `<div class="def-item"><span>${it.k}</span><span class="v">${it.v}${it.lg ? ` <span style="color:var(--color-text-faint)">(lg ${it.lg})</span>` : ''}</span>${rkHtml || '<span></span>'}</div>`;
    }).join('');
    const off = state.data.team_off[pl.team] || {};

    view.innerHTML = head + missedNote + playerNewsCard(pl) + layerCards(pl, pr) + `
      <div class="grid-2">
        <div class="card">
          <div class="card-title">Fantasy point distribution · P(outcome)</div>
          <div class="chart-wrap"><canvas id="distChart" role="img" aria-label="Probability distribution of projected fantasy points"></canvas></div>
          <div class="pct-row">${pcts}</div>
        </div>
        <div class="card">
          <div class="card-title">Probability of clearing</div>
          <div class="thresholds">${ths}</div>
          <div class="bb-row"><div><span class="k">Boom</span> <b class="boom">${pct(pr.bb.boom)}</b> <span class="s">≥ ${pr.bb.boomAt} pts</span></div><div><span class="k">Bust</span> <b class="bust">${pct(pr.bb.bust)}</b> <span class="s">&lt; ${pr.bb.bustAt} pts</span></div></div>
          <p class="sub" style="margin-top:var(--space-4)">Spread reflects ${esc(pl.name.split(' ').slice(-1)[0])}'s week-to-week volatility (CV ${f2(pl.cv)}) blended with a ${pl.pos} prior, widened 1.25× for forecast error. Matchup: <span class="grade ${pr.grade.cls}">${pr.grade.label} · ${rkOrd(pr.grade.rk)} most pts allowed to ${pl.pos}</span></p>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-title">Projection build-up · baseline → vs ${esc(pr.opp)}</div>
          <table class="comp-table"><thead><tr><th>Component</th><th class="num">Baseline</th><th class="num">Adjusted</th><th class="num">Pts</th></tr></thead><tbody>${compRows}</tbody></table>
          <p class="sub" style="margin-top:var(--space-3)">Opponent adjustment: ${pr.pts >= pr.basePts ? '+' : ''}${f1(pr.pts - pr.basePts)} pts vs. a league-average defense${pr.home ? ' · home (+2% volume)' : ' · away (−2% volume)'}.</p>
        </div>
        <div class="card">
          <div class="card-title">Box-score averages · Weeks 1–${lc}</div>
          <div class="metrics">${metrics}</div>
          <p class="sub" style="margin-top:var(--space-3)">${esc(pl.team)} offense: ${off.plays_pg ?? '—'} plays/g · ${off.pass_rate != null ? pct(off.pass_rate) : '—'} pass rate · ${off.pts_pg ?? '—'} pts/g</p>
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-5)">
        <div class="card-title">Opponent · ${esc(tn(pr.opp))} defense${pr.home ? '' : ' (home)'}</div>
        <div class="sw">
          <div><h3><span class="dot bad"></span>Good at <span style="color:var(--color-text-faint);font-weight:400">· works against him</span></h3>${sw.strengths.length ? `<ul>${sw.strengths.map(s => `<li>${s}</li>`).join('')}</ul>` : '<p class="sub">No top-10 marks yet.</p>'}</div>
          <div><h3><span class="dot good"></span>Bad at <span style="color:var(--color-text-faint);font-weight:400">· works in his favor</span></h3>${sw.weaknesses.length ? `<ul>${sw.weaknesses.map(s => `<li>${s}</li>`).join('')}</ul>` : '<p class="sub">No bottom-10 marks yet.</p>'}</div>
        </div>
        <div class="def-list">${defItems}</div>
        <p class="sub" style="margin-top:var(--space-3)">Rank 1 = toughest, 32 = most generous. Green ranks favor ${esc(pl.name.split(' ').slice(-1)[0])}; red ranks work against him.</p>
      </div>

      ${gameLogCard(pl)}
    `;
    bindPlayerView();
    drawDist(pr);
  }

  function mrow(k, v, s) { return `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`; }
  function layerCards(pl, pr) {
    const A = pl.adv || {}, vg = pr.vg, p = pr.pm, TC = state.data.team_ctx || {}, me = TC[pl.team] || {}, op = TC[pr.opp] || {};
    const last = pl.name.split(' ').slice(-1)[0];
    // 1. Vegas & market
    let vegas;
    if (vg) {
      vegas = `<div class="metrics">${mrow('Implied team total', `<span class="hl">${f1(vg.itt)}</span>`, `${esc(pl.team)} · opp ${f1(vg.oppItt)}`)}${mrow('Spread', fmtSpread(vg.teamSpread), vg.margin > 0 ? 'favored' : vg.margin < 0 ? 'underdog' : 'pick’em')}${mrow('Game total', f1(vg.total), vg.src === 'book' ? 'sportsbook consensus' : 'schedule line')}${mrow('Vegas effect', `${pr.itt && pr.itt.f >= 1 ? '+' : ''}${pct(pr.itt ? pr.itt.f - 1 : 0)}`, `ITT vs model team pts ${pr.itt ? f1(pr.itt.modelTP) : '—'}`)}</div>
        ${gameScriptNote(pl, vg) ? `<p class="sub script">${esc(gameScriptNote(pl, vg))}</p>` : ''}`;
    } else vegas = `<p class="sub">Spread and total aren't posted for this game yet. Projection uses the model's team-strength estimate.</p>`;
    const propRows = [];
    const PR = [['pass_att', 'Pass attempts', 'pa', false], ['pass_yds', 'Pass yards', 'py', true], ['rush_yds', 'Rush yards', 'ry', true], ['rec', 'Receptions', 'rc', false], ['rec_yds', 'Rec yards', 'rcy', true]];
    const relevant = pl.pos === 'QB' ? ['pass_att', 'pass_yds', 'rush_yds'] : pl.pos === 'RB' ? ['rush_yds', 'rec', 'rec_yds'] : ['rec', 'rec_yds'];
    for (const [k, label, c, yds] of PR) {
      if (!relevant.includes(k) && !(p && p[k])) continue;
      const o = p && p[k];
      if (!o) { if (relevant.includes(k)) propRows.push(`<tr><td>${label}</td><td class="num"><span class="na">No line</span></td><td class="num">${f1(pr.modelC[c])}</td><td class="num">—</td></tr>`); continue; }
      const mm = propMean(o, yds), d = pr.modelC[c] - mm, big = Math.abs(d) / Math.max(mm, 1) >= 0.15;
      propRows.push(`<tr><td>${label}</td><td class="num">${f1(o.line)}${o.p_over != null ? ` <span class="s">o ${pct(o.p_over)}</span>` : ''}</td><td class="num">${f1(pr.modelC[c])}</td><td class="num"><span class="delta ${big ? (d > 0 ? 'up' : 'down') : 'flat'}">${d > 0 ? '+' : ''}${f1(d)}${big ? ' !' : ''}</span></td></tr>`);
    }
    const atdModel = 1 - Math.exp(-(pr.modelC.rtd + (pl.pos === 'QB' ? 0 : pr.modelC.rctd)));
    propRows.push(`<tr><td>Anytime TD</td><td class="num">${p && p.atd ? pct(p.atd.p) : '<span class="na">No line</span>'}</td><td class="num">${pct(atdModel)}</td><td class="num">${p && p.atd ? `<span class="delta ${Math.abs(atdModel - p.atd.p) >= 0.08 ? (atdModel > p.atd.p ? 'up' : 'down') : 'flat'}">${atdModel - p.atd.p > 0 ? '+' : ''}${Math.round((atdModel - p.atd.p) * 100)} pts</span>` : '—'}</td></tr>`);
    const divTxt = pr.mktPts != null ? `<p class="sub">Market-implied: <b>${f1(pr.mktPts)}</b> pts vs model <b>${f1(pr.modelPts)}</b>. ${pr.diverge ? `<span class="flagc mkt">Market ${pr.diverge} by ${f1(Math.abs(pr.mktPts - pr.modelPts))}</span> — worth a second look.` : 'Model and market broadly agree.'} Final projection blends each posted prop 50/50 with the model.</p>`
      : `<p class="sub">No player props posted for ${esc(last)} yet, so the projection is model-only. Props usually appear mid-week.</p>`;
    const card1 = `<div class="card layer"><div class="card-title"><span class="lnum">1</span>Vegas &amp; market</div>${vegas}
      <table class="comp-table props"><thead><tr><th>Prop</th><th class="num">Line</th><th class="num">Model</th><th class="num">Model − mkt</th></tr></thead><tbody>${propRows.join('')}</tbody></table>${divTxt}</div>`;
    // 2. Opportunity
    let o = '';
    if (pl.pos === 'QB') {
      o += mrow('Dropbacks / g (team)', me.db_pg != null ? f1(me.db_pg) : NA, '') + mrow('Designed run rate', pv(A.designed_run_rate), 'of his plays (excl. scrambles)') + mrow('Designed runs / g', A.designed_runs_pg != null ? f1(A.designed_runs_pg) : NA, '') + mrow('Scrambles / g', A.scrambles_pg != null ? f1(A.scrambles_pg) : NA, 'tracked separately')
        + mrow('Red-zone rush share', pv(A.rz20_share), `inside 10: ${pv(A.rz10_share)}`) + mrow('Snap share', pv(A.snap_pct), '');
    } else {
      if (pl.pos === 'RB') o += mrow('Opportunity share', `<span class="hl">${pv(A.opp_share)}</span>`, 'carries + targets / team');
      o += mrow('Target share', pv(A.tgt_share), '') + mrow('Air-yards share', pv(A.ay_share), '') + mrow('WOPR', A.wopr != null ? `<span class="hl">${f2(A.wopr)}</span>` : NA, '1.5×TS + 0.7×AYS')
        + mrow('Snap share', pv(A.snap_pct), `last 2: ${pv(A.snap_pct_l2)} · route proxy`) + mrow('TPRR (est.)', pv(A.tprr), 'targets / est. routes') + mrow('YPRR (est.)', A.yprr != null ? f2(A.yprr) : NA, 'yards / est. routes')
        + mrow('Red-zone share (in 20)', pv(A.rz20_share), `${A.rz20_opps ?? 0} opps`) + mrow('Inside-10 share', pv(A.rz10_share), `${A.rz10_opps ?? 0} opps`);
      if (pl.pos === 'RB') o += mrow('Red-zone snap share', NA, 'needs participation data (not public)');
      o += mrow('Route participation', NA, 'true routes not public; snap share used');
    }
    const card2 = `<div class="card layer"><div class="card-title"><span class="lnum">2</span>Opportunity</div><div class="metrics">${o}</div></div>`;
    // 3. Efficiency / over expected
    let e = '';
    if (pl.pos === 'QB') e += mrow('EPA / dropback', sgn(A.epa_db), '') + mrow('CPOE', A.cpoe != null ? sgn(A.cpoe, f1) : NA, `NGS: ${A.ngs_cpoe != null ? sgn(A.ngs_cpoe, f1) : 'n/a'}`) + mrow('Rush EPA / designed run', sgn(A.epa_rush), '');
    else if (pl.pos === 'RB') e += mrow('EPA / carry', sgn(A.epa_rush), '') + mrow('RYOE / att', A.ryoe_att != null ? sgn(A.ryoe_att) : NA, `${A.ryoe != null ? sgn(A.ryoe, x => Math.round(x)) + ' total' : 'NGS min. sample'}`) + mrow('Missed tackles forced', A.bt_per_touch != null ? pct(A.bt_per_touch) : NA, 'broken tackles / touch (PFR)') + mrow('8+ in box', A.box8 != null ? f1(A.box8) + '%' : NA, '') + mrow('EPA / target', sgn(A.epa_tgt), '');
    else e += mrow('EPA / target', sgn(A.epa_tgt), '') + mrow('Separation', A.sep != null ? f2(A.sep) + ' yd' : NA, 'NGS') + mrow('YAC over exp.', A.yac_oe != null ? sgn(A.yac_oe) : NA, 'NGS') + mrow('Missed tackles forced', A.bt_per_touch != null ? pct(A.bt_per_touch) : NA, 'broken tackles / touch');
    e += mrow('xFP / g', A.xfp_pg != null ? f1(A.xfp_pg) : NA, `last 3: ${A.xfp_l3 != null ? f1(A.xfp_l3) : '—'} (PPR)`) + mrow('FPOE / g', A.fpoe_pg != null ? `<span class="${A.fpoe_pg > 0 ? 'up' : 'down'}">${sgn(A.fpoe_pg, f1)}</span>` : NA, 'actual − expected');
    const reg = pr.reg ? `<p class="sub"><span class="flagc ${pr.reg.type}">${pr.reg.label}</span> ${esc(pr.reg.why)}.</p>` : '';
    const card3 = `<div class="card layer"><div class="card-title"><span class="lnum">3</span>Efficiency · over expected</div><div class="metrics">${e}</div>${reg}</div>`;
    // 4. Context
    const rk = (v, n) => v != null ? ` <span class="s">(${rkOrd(v)}${n ? ' ' + n : ''})</span>` : '';
    let c = mrow('Neutral pass rate', me.neutral_pass_rate != null ? pct(me.neutral_pass_rate) + rk(me.neutral_pass_rate_rk) : NA, `PROE ${me.proe != null ? sgn(me.proe, f1) + '%' : 'n/a'}`)
      + mrow('Pace (neutral)', me.sec_per_play != null ? f1(me.sec_per_play) + 's' + rk(me.sec_per_play_rk, 'fastest') : NA, `${me.plays_pg ?? '—'} plays/g · opp ${op.sec_per_play != null ? f1(op.sec_per_play) + 's' : 'n/a'}`)
      + mrow('Pressure allowed', me.pressure_allowed != null ? pct(me.pressure_allowed) + rk(me.pressure_allowed_rk, 'best') : NA, `${esc(pl.team)} OL`)
      + mrow('Opp pressure rate', op.pressure_generated != null ? pct(op.pressure_generated) + rk(op.pressure_generated_rk, 'most') : NA, `${esc(pr.opp)} pass rush`);
    if (pl.pos === 'QB') c += mrow('Time to throw', A.ttt != null ? f2(A.ttt) + 's' : NA, 'NGS') + mrow('Pressured rate', pv(A.pressured_rate), 'his dropbacks');
    const d = pr.dist;
    c += mrow('Floor / Median / Ceiling', `<span class="fl">${f1(pr.floor)}</span> / ${f1(d.quantile(0.5))} / <span class="cl">${f1(pr.ceil)}</span>`, '') + mrow('Boom / bust', `<span class="boom">${pct(pr.bb.boom)}</span> / <span class="bust">${pct(pr.bb.bust)}</span>`, `≥${pr.bb.boomAt} / <${pr.bb.bustAt} pts`);
    const card4 = `<div class="card layer"><div class="card-title"><span class="lnum">4</span>Context &amp; distribution</div><div class="metrics">${c}</div></div>`;
    return `<div class="grid-2 layers">${card1}${card2}${card3}${card4}</div>`;
  }

  function compRowsFor(pl, pr, S) {
    const c = pr.comps, b = pr.base;
    const rows = [];
    const add = (label, bk, ak, mult, fmt = f1) => {
      const bv = b[bk], av = c[ak];
      if (Math.abs(bv) < 0.005 && Math.abs(av) < 0.005) return;
      const dlt = av - bv, cls = Math.abs(dlt) < 0.01 * Math.max(1, Math.abs(bv)) ? 'flat' : dlt > 0 ? 'up' : 'down';
      rows.push(`<tr><td>${label}</td><td class="num">${fmt(bv)}</td><td class="num">${fmt(av)} <span class="delta ${cls}">${dlt > 0 ? '▲' : dlt < 0 ? '▼' : '•'}${fmt(Math.abs(dlt))}</span></td><td class="num">${f1(av * mult)}</td></tr>`);
    };
    if (pl.pos === 'QB') { add('Pass attempts', 'pa', 'pa', 0); add('Pass yards', 'py', 'py', S.py); add('Pass TD', 'ptd', 'ptd', S.ptd, f2); add('Interceptions', 'int', 'int', S.int, f2); }
    add('Carries', 'ca', 'ca', 0); add('Rush yards', 'ry', 'ry', S.ry); add('Rush TD', 'rtd', 'rtd', S.rtd, f2);
    if (pl.pos !== 'QB') { add('Targets', 'tg', 'tg', 0); add('Receptions', 'rc', 'rc', S.rec); add('Rec yards', 'rcy', 'rcy', S.rcy); add('Rec TD', 'rctd', 'rctd', S.rctd, f2); }
    add('Fumbles lost', 'fl', 'fl', S.fl, f2);
    rows.push(`<tr><td><b>Total</b></td><td class="num"><b>${f1(pr.basePts)}</b></td><td class="num"><b>${f1(pr.pts)}</b></td><td class="num"><b>${f1(pr.pts)}</b></td></tr>`);
    return rows.join('');
  }

  function gameLogCard(pl) {
    const S = SCORING[state.scoring];
    const rows = pl.log.slice().reverse().map(l => {
      const fp = l.py * S.py + l.ptd * S.ptd + l.int * S.int + l.ry * S.ry + l.rtd * S.rtd + l.rc * S.rec + l.rcy * S.rcy + l.rctd * S.rctd + l.fl * S.fl;
      const stat = pl.pos === 'QB' ? `${l.pc}/${l.pa}, ${l.py} yds, ${l.ptd} TD, ${l.int} INT · ${l.ca} car, ${l.ry} yds${l.rtd ? ', ' + l.rtd + ' TD' : ''}`
        : pl.pos === 'RB' ? `${l.ca} car, ${l.ry} yds${l.rtd ? ', ' + l.rtd + ' TD' : ''} · ${l.rc}/${l.tg} tgt, ${l.rcy} yds${l.rctd ? ', ' + l.rctd + ' TD' : ''}`
        : `${l.rc}/${l.tg} tgt, ${l.rcy} yds${l.rctd ? ', ' + l.rctd + ' TD' : ''}${l.ts != null ? ' · ' + pct(l.ts) + ' tgt share' : ''}${l.ca ? ' · ' + l.ca + ' car, ' + l.ry + ' yds' : ''}`;
      return `<tr><td>Wk ${l.wk}</td><td>${esc(l.opp)}</td><td>${stat}</td><td class="num fp">${f1(fp)}</td></tr>`;
    }).join('');
    return `<div class="card"><div class="card-title">Game log · ${SCORING[state.scoring].name}</div><div style="overflow-x:auto"><table class="log-table"><thead><tr><th>Week</th><th>Opp</th><th>Line</th><th class="num">Pts</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  function bindPlayerView() {
    const b = $('#backBtn'); if (b) b.addEventListener('click', () => setView('board'));
  }

  function drawDist(pr) {
    const canvas = $('#distChart'); if (!canvas || !window.Chart) return;
    if (chart) { chart.destroy(); chart = null; }
    const d = pr.dist;
    const xMax = Math.ceil(d.quantile(0.995) / 5) * 5;
    const xs = [], ys = [];
    for (let x = 0; x <= xMax; x += xMax / 120) { xs.push(x); ys.push(d.pdf(x)); }
    const css = getComputedStyle(document.documentElement);
    const line = css.getPropertyValue('--chart-line').trim(), fill = css.getPropertyValue('--chart-fill').trim();
    const muted = css.getPropertyValue('--color-text-muted').trim(), grid = css.getPropertyValue('--color-divider').trim();
    const floorC = css.getPropertyValue('--chart-floor').trim(), ceilC = css.getPropertyValue('--chart-ceil').trim(), meanC = css.getPropertyValue('--chart-mean').trim();
    const tipBg = css.getPropertyValue('--color-field-deep').trim();
    const p20 = pr.floor, p80 = pr.ceil, mean = d.mean;
    const markers = {
      id: 'markers',
      afterDatasetsDraw(c) {
        const { ctx, chartArea, scales } = c;
        const draw = (x, label, dash, align, dx, color) => {
          const px = scales.x.getPixelForValue(x);
          ctx.save(); ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(px, chartArea.top); ctx.lineTo(px, chartArea.bottom); ctx.stroke();
          ctx.fillStyle = color; ctx.font = '700 11px Satoshi, sans-serif'; ctx.textAlign = align;
          ctx.fillText(label, px + dx, chartArea.top - 4); ctx.restore();
        };
        draw(p20, `Floor ${f1(p20)}`, [4, 3], 'right', -5, floorC); draw(mean, `Proj ${f1(mean)}`, [], 'center', 0, meanC); draw(p80, `Ceiling ${f1(p80)}`, [4, 3], 'left', 5, ceilC);
      }
    };
    chart = new Chart(canvas, {
      type: 'line',
      data: { labels: xs, datasets: [{ data: ys, borderColor: line, backgroundColor: fill, fill: true, pointRadius: 0, borderWidth: 2, tension: 0.35 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
        layout: { padding: { top: 18 } },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: tipBg, titleColor: line, bodyColor: meanC, borderColor: grid, borderWidth: 1, callbacks: { title: items => `${f1(items[0].parsed.x)} pts`, label: item => `P(≥ this) ${pct(d.pOver(item.parsed.x))}` } } },
        scales: {
          x: { type: 'linear', min: 0, max: xMax, ticks: { color: muted, maxTicksLimit: 9, callback: v => v }, grid: { color: grid }, title: { display: true, text: 'Fantasy points', color: muted, font: { size: 11 } } },
          y: { display: false, min: 0 },
        },
      },
      plugins: [markers],
    });
  }

  // ---------- Defense table ----------
  const DEF_COLS = [
    { key: 'team', label: 'Defense', sortable: true },
    { key: 'pts', label: 'Pts/g', val: d => d.allowed.pts_pg, fmt: f1, rk: 'pts' },
    { key: 'fp_QB', label: 'vs QB', val: d => d.pos.QB.ppr_pg, fmt: f1, rk: 'fp_QB' },
    { key: 'fp_RB', label: 'vs RB', val: d => d.pos.RB.ppr_pg, fmt: f1, rk: 'fp_RB' },
    { key: 'fp_WR', label: 'vs WR', val: d => d.pos.WR.ppr_pg, fmt: f1, rk: 'fp_WR' },
    { key: 'fp_TE', label: 'vs TE', val: d => d.pos.TE.ppr_pg, fmt: f1, rk: 'fp_TE' },
    { key: 'rush_yds', label: 'Rush yds/g', val: d => d.allowed.rush_yds_pg, fmt: f1, rk: 'rush_yds' },
    { key: 'ypc', label: 'YPC', val: d => d.allowed.ypc, fmt: f2, rk: 'ypc' },
    { key: 'pass_yds', label: 'Pass yds/g', val: d => d.allowed.pass_yds_pg, fmt: f1, rk: 'pass_yds' },
    { key: 'ypa', label: 'Y/A', val: d => d.allowed.ypa, fmt: f1, rk: 'ypa' },
    { key: 'pass_td', label: 'Pass TD/g', val: d => d.allowed.pass_td_pg, fmt: f2, rk: 'pass_td' },
    { key: 'rush_td', label: 'Rush TD/g', val: d => d.allowed.rush_td_pg, fmt: f2, rk: 'rush_td' },
    { key: 'sacks', label: 'Sacks/g', val: d => d.allowed.sacks_pg, fmt: f2, rk: 'sacks', inv: true },
    { key: 'int', label: 'INT/g', val: d => d.allowed.int_pg, fmt: f2, rk: 'int', inv: true },
  ];
  function renderDefense() {
    $('#defThroughWeek').textContent = `Week ${state.data.meta.last_completed_week}`;
    const head = $('#defHead');
    head.innerHTML = `<tr>${DEF_COLS.map(c => `<th data-key="${c.key}" class="${state.defSort.key === c.key ? 'sorted' : ''}">${c.label}${state.defSort.key === c.key ? (state.defSort.dir > 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr>`;
    $$('th', head).forEach(th => th.addEventListener('click', () => {
      const k = th.dataset.key;
      if (state.defSort.key === k) state.defSort.dir *= -1; else state.defSort = { key: k, dir: 1 };
      renderDefense();
    }));
    const teams = Object.keys(state.data.defense);
    const col = DEF_COLS.find(c => c.key === state.defSort.key);
    teams.sort((a, b) => {
      if (col.key === 'team') return state.defSort.dir * a.localeCompare(b);
      return state.defSort.dir * (col.val(state.data.defense[b]) - col.val(state.data.defense[a]));
    });
    $('#defBody').innerHTML = teams.map(tm => {
      const d = state.data.defense[tm];
      return `<tr><td class="tm">${esc(tm)} <span style="color:var(--color-text-muted);font-weight:400">${esc(tn(tm))}</span></td>${DEF_COLS.slice(1).map(c => {
        const rk = d.ranks[c.rk]; const cls = c.inv ? (rk <= 11 ? 'bad' : rk >= 22 ? 'good' : 'neutral') : rkCls(rk);
        return `<td><span class="cellrk">${c.fmt(c.val(d))} <span class="rk ${cls}">${rk}</span></span></td>`;
      }).join('')}</tr>`;
    }).join('');
  }

  // ---------- Search ----------
  function initSearch() {
    const input = $('#searchInput'), list = $('#searchResults');
    let items = [], active = -1;
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    const render = () => {
      list.innerHTML = items.length ? items.map((it, i) => {
        const pr = project(it, state.week, state.scoring);
        const full = pr.bye ? null : workloadOf(it);
        const fullHtml = full ? `<span class="full-work" data-gl="If full workload" title="${esc(workloadNote(full))}">${f1(full.pts)} if full workload</span>` : '';
        return `<li role="option" data-id="${esc(it.id)}" aria-selected="${i === active}">${avatar(it)}<div><div>${esc(it.name)}</div><div class="meta"><span class="pos ${it.pos}">${it.pos}</span> ${esc(it.team)} · ${pr.bye ? 'BYE' : (pr.home ? 'vs ' : '@ ') + pr.opp}</div></div><span class="proj">${pr.bye ? '—' : f1(pr.pts)}${fullHtml}</span></li>`;
      }).join('') : `<li class="empty">No players match. Try a last name.</li>`;
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
      $$('li[data-id]', list).forEach(li => li.addEventListener('mousedown', e => { e.preventDefault(); openPlayer(li.dataset.id); input.value = ''; close(); }));
    };
    const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '');
    input.addEventListener('input', () => {
      const q = norm(input.value.trim());
      if (q.length < 2) { close(); return; }
      const toks = q.split(/\s+/);
      items = state.data.players.filter(p => { if (p.tradeOnly) return false; const n = norm(p.name); return toks.every(t => n.includes(t)); })
        .sort((a, b) => (norm(b.name).startsWith(q) - norm(a.name).startsWith(q)) || (b.ppr_pg - a.ppr_pg)).slice(0, 8);
      active = items.length ? 0 : -1; render();
    });
    input.addEventListener('keydown', e => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) { openPlayer(items[active].id); input.value = ''; close(); } }
      else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2) input.dispatchEvent(new Event('input')); });
  }

  // ---------- Compare ----------
  state.cmp = state.cmp || [null, null];
  function miniSearch(input, onPick) {
    const list = input.nextElementSibling; let items = [];
    const nm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '');
    input.addEventListener('input', () => {
      const q = nm(input.value.trim()); if (q.length < 2) { list.hidden = true; return; }
      const toks = q.split(/\s+/);
      items = state.data.players.filter(p => !p.tradeOnly && toks.every(t => nm(p.name).includes(t))).sort((a, b) => b.ppr_pg - a.ppr_pg).slice(0, 6);
      list.innerHTML = items.length ? items.map(p => `<li data-id="${esc(p.id)}"><span class="pos ${p.pos}">${p.pos}</span> ${esc(p.name)} <span class="meta">${esc(p.team)}</span></li>`).join('') : '<li class="empty">No match</li>';
      list.hidden = false;
      $$('li[data-id]', list).forEach(li => li.addEventListener('mousedown', e => { e.preventDefault(); list.hidden = true; input.value = ''; onPick(li.dataset.id); }));
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && items[0]) { e.preventDefault(); list.hidden = true; input.value = ''; onPick(items[0].id); } });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
  }
  function compareTable(a, b, week) {
    const pa = project(a, week, state.scoring), pb = project(b, week, state.scoring);
    if (pa.bye || pb.bye) return `<p class="sub">${esc((pa.bye ? a : b).name)} is on bye in Week ${week}.</p>`;
    const ra = compareRows(a, pa), rb = compareRows(b, pb);
    const fa = workloadOf(a), fb = workloadOf(b);
    if (fa || fb) {
      const cell = f => f ? `<span class="full-work" data-gl="If full workload" title="${esc(workloadNote(f))}">${f1(f.pts)}</span>` : '<span class="na">—</span>';
      ra.push(['If full workload', cell(fa)]);
      rb.push(['If full workload', cell(fb)]);
    }
    const keys = [...new Set(ra.map(r => r[0]).concat(rb.map(r => r[0])))];
    const ga = Object.fromEntries(ra), gb = Object.fromEntries(rb);
    const winner = pa.pts >= pb.pts ? a : b;
    return `<div class="cmp-verdict">Start <b>${esc(winner.name)}</b> · ${f1(Math.max(pa.pts, pb.pts))} vs ${f1(Math.min(pa.pts, pb.pts))} projected ${SCORING[state.scoring].name} pts</div>
      <table class="cmp-table"><thead><tr><th></th><th>${esc(a.name)} <span class="pos ${a.pos}">${a.pos}</span> ${newsBadge(a)}<div class="meta">${pa.home ? 'vs' : '@'} ${esc(pa.opp)}</div></th><th>${esc(b.name)} <span class="pos ${b.pos}">${b.pos}</span> ${newsBadge(b)}<div class="meta">${pb.home ? 'vs' : '@'} ${esc(pb.opp)}</div></th></tr></thead>
      <tbody>${keys.map(k => `<tr><td>${k}</td><td>${ga[k] ?? '<span class="na">—</span>'}</td><td>${gb[k] ?? '<span class="na">—</span>'}</td></tr>`).join('')}</tbody></table>`;
  }
  function renderCompare() {
    const v = $('#view-compare');
    if (!v.dataset.init) {
      v.dataset.init = '1';
      v.innerHTML = `<div class="view-head"><div><h1 class="page-title">Compare players</h1><p class="sub">Side by side: implied team total, props, opportunity (WOPR / TPRR / YPRR / red-zone share) and one efficiency metric.</p></div></div>
        <div class="cmp-pickers">${[0, 1].map(i => `<div class="cmp-pick"><div class="cmp-cur" id="cmpCur${i}"></div><div class="search mini"><input type="search" id="cmpIn${i}" placeholder="Player ${i + 1}…" autocomplete="off" aria-label="Compare player ${i + 1}" /><ul class="search-results" hidden></ul></div></div>`).join('')}</div>
        <div class="card" id="cmpOut"></div>`;
      [0, 1].forEach(i => miniSearch($('#cmpIn' + i), id => { state.cmp[i] = id; renderCompare(); }));
    }
    if (!state.cmp[0] && state.player) state.cmp[0] = state.player.id;
    const P = state.cmp.map(id => id && state.data.players.find(p => p.id === id));
    [0, 1].forEach(i => { $('#cmpCur' + i).innerHTML = P[i] ? `${avatar(P[i], 'avatar')}<b>${esc(P[i].name)}</b> <span class="meta">${P[i].pos} · ${esc(P[i].team)}</span>` : '<span class="na">Pick a player</span>'; });
    $('#cmpOut').innerHTML = P[0] && P[1] ? compareTable(P[0], P[1], state.week) : '<p class="sub">Search for two players to compare.</p>';
  }

  // ---------- Views & controls ----------
  function setView(v) {
    state.view = v;
    $$('.view').forEach(el => { el.hidden = el.id !== 'view-' + v; });
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === v));
    const activeTab = document.querySelector('.tab.is-active');
    try { if (activeTab && activeTab.scrollIntoView) activeTab.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (e) { /* older browsers keep the tab bar as it is */ }
    $('#main').scrollTop = 0;
    if (v === 'board') renderBoard();
    if (v === 'defense') renderDefense();
    if (v === 'player' && state.player) renderPlayer(state.player);
    if (v === 'team' && window.MLTeam) window.MLTeam.render();
    if (v === 'live' && window.MLTeam && window.MLTeam.showLive) window.MLTeam.showLive();
    if (v === 'compare') renderCompare();
    if (v === 'news') renderNews();
    if (v === 'trade' && window.MLTrade) window.MLTrade.render();
  }
  function rerender() { if (state.view === 'board') renderBoard(); else if (state.view === 'player' && state.player) renderPlayer(state.player); else if ((state.view === 'team' || state.view === 'live') && window.MLTeam) window.MLTeam.render(); else if (state.view === 'compare') renderCompare(); else if (state.view === 'news') renderNews(); else if (state.view === 'trade' && window.MLTrade) window.MLTrade.render(); }

  function fillWeeks(preserve) {
    const sel = $('#weekSelect');
    if (!sel || !state.data) return;
    const prev = preserve ? state.week : null;
    let weeks = Object.keys(state.data.schedule).map(Number).filter(w => w >= state.data.meta.next_week).sort((a, b) => a - b);
    if (!weeks.length) { weeks = [state.data.meta.last_completed_week]; state.data.meta.next_week = weeks[0]; } // season over: show last week
    sel.innerHTML = weeks.map(w => `<option value="${w}">Week ${w}${w === state.data.meta.next_week ? ' (next)' : ''}</option>`).join('');
    const pick = prev != null && weeks.includes(prev) ? prev : state.data.meta.next_week;
    state.week = pick;
    sel.value = String(state.week);
    const weekLabel = $('#boardWeekLabel');
    if (weekLabel && state.view === 'board') weekLabel.textContent = `Week ${state.week}`;
  }
  function renderCurrent() {
    // Every tab reads the data this refresh just loaded, including a tab that
    // is hidden. My Team's render uses the roster reloadLeague already fetched.
    if (window.MLTeam && window.MLTeam.render) window.MLTeam.render();
    renderBoard();
    renderDefense();
    if (state.player) renderPlayer(state.player);
    renderCompare();
    renderNews();
    if (window.MLTrade && window.MLTrade.render) window.MLTrade.render();
    const stamp = $('#genStamp');
    if (stamp && state.data && state.data.meta) stamp.textContent = state.data.meta.generated;
  }
  function initControls() {
    fillWeeks(false);
    const sel = $('#weekSelect');
    sel.addEventListener('change', () => { state.week = Number(sel.value); rerender(); });

    const seg = (id, onChange) => {
      const root = $(id);
      $$('button', root).forEach(b => b.addEventListener('click', () => {
        $$('button', root).forEach(x => x.setAttribute('aria-checked', String(x === b)));
        onChange(b.dataset.val);
      }));
    };
    seg('#scoringSeg', v => { state.scoring = v; rerender(); });
    seg('#newsSeg', v => { state.newsFilter = v; renderNews(); });
    seg('#posSeg', v => { state.pos = v; renderBoard(); });
    $$('.tab').forEach(t => t.addEventListener('click', () => { if (!t.disabled) setView(t.dataset.view); }));
    $('#brandLink').addEventListener('click', e => { e.preventDefault(); setView('board'); });
    $('#genStamp').textContent = state.data.meta.generated;
  }

  // ---------- Boot ----------
  const REMOTE = 'https://raw.githubusercontent.com/Martyr1617/matchup-lab/data/';
  const STALE_HOURS = 12;
  function parseGenerated(s) {
    if (!s) return null;
    const t = Date.parse(String(s).trim().replace(/ UTC$/, 'Z').replace(' ', 'T'));
    return Number.isFinite(t) ? t : null;
  }
  function agePhrase(then) {
    const h = (Date.now() - then) / 36e5;
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes`;
    if (h < 36) return `${Math.round(h)} hours`;
    return `${Math.round(h / 24)} days`;
  }
  function rememberGenerated(data) {
    const g = data && data.meta && data.meta.generated;
    if (!g) return;
    try { localStorage.setItem('ml-data-generated', g); } catch (e) { /* private mode */ }
  }
  function storedGeneratedAge() {
    try {
      const t = parseGenerated(localStorage.getItem('ml-data-generated'));
      return t == null ? '' : ` The last copy this browser loaded was generated ${agePhrase(t)} ago.`;
    } catch (e) { return ''; }
  }
  function showDataStatus(text, bad) {
    const el = $('#dataStatus');
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.className = bad === 'ok' ? 'notice ok' : bad ? 'notice bad' : 'notice';
    el.textContent = text;
  }
  function noteDataFreshness(data, src) {
    const t = parseGenerated(data.meta && data.meta.generated);
    const bits = [];
    if (src === 'local') bits.push('Showing the bundled fallback because the live data file could not be loaded.');
    if (t != null && (Date.now() - t) > STALE_HOURS * 36e5) {
      bits.push(`This data was generated ${agePhrase(t)} ago (${data.meta.generated}), more than ${STALE_HOURS} hours old.`);
    }
    rememberGenerated(data);
    showDataStatus(bits.join(' '), false);
  }
  function usableData(d) {
    return !!(d && Array.isArray(d.players) && d.players.length >= 100 && d.meta);
  }
  function sanitizeData(data) {
    const POS = /^(QB|RB|WR|TE)$/, TM = /^[A-Z]{2,3}$/;
    data.players = data.players.filter(p => POS.test(p.pos)).map(p => ({ ...p, team: TM.test(p.team) ? p.team : '' }));
    for (const wk in data.schedule) data.schedule[wk] = (data.schedule[wk] || []).filter(g => TM.test(g.home) && TM.test(g.away));
    return data;
  }
  const REFRESH_HOLD_MS = 4000;
  let refreshFadeGen = 0;
  let refreshFadeTimer = 0;
  function paintRefreshStatus(mode) {
    refreshFadeGen += 1;
    const gen = refreshFadeGen;
    if (refreshFadeTimer) { clearTimeout(refreshFadeTimer); refreshFadeTimer = 0; }
    const text = $('#refreshStatusText');
    const more = $('#refreshStatusMore');
    const btn = $('#refreshBtn');
    const host = $('#refreshStatus');
    if (host) host.classList.remove('is-fading');
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    let visible = '';
    if (mode === 'busy') visible = 'Refreshing…';
    else if (mode === 'fail') visible = offline ? "You're offline" : "Couldn't refresh";
    else if (mode === 'same') visible = 'Already up to date';
    else if (mode === 'ok') visible = 'Updated';
    if (text) text.textContent = visible;
    if (more) more.textContent = '';
    if (host) {
      host.classList.toggle('is-busy', mode === 'busy');
      host.classList.toggle('is-ok', mode === 'ok' || mode === 'same');
      host.classList.toggle('is-fail', mode === 'fail');
    }
    if (btn) {
      btn.setAttribute('aria-label', 'Refresh data');
      btn.title = 'Refresh data';
    }
    if (mode === 'ok' || mode === 'same' || mode === 'fail') {
      refreshFadeTimer = setTimeout(() => fadeRefreshStatus(gen), REFRESH_HOLD_MS);
    }
  }
  function fadeRefreshStatus(gen) {
    if (gen !== refreshFadeGen) return;
    const host = $('#refreshStatus');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clear = () => {
      if (gen !== refreshFadeGen) return;
      if (host) host.classList.remove('is-fading', 'is-busy', 'is-ok', 'is-fail');
      const text = $('#refreshStatusText');
      const more = $('#refreshStatusMore');
      if (text) text.textContent = '';
      if (more) more.textContent = '';
      const btn = $('#refreshBtn');
      if (btn) {
        btn.setAttribute('aria-label', 'Refresh data');
        btn.title = 'Refresh data';
      }
    };
    if (reduce || !host) { clear(); return; }
    host.classList.add('is-fading');
    refreshFadeTimer = setTimeout(clear, 400);
  }
  function setRefreshBusy(on) {
    const btn = $('#refreshBtn');
    if (!btn) return;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    btn.disabled = !!on;
    if (on) paintRefreshStatus('busy');
  }
  async function fetchJson(url, ms, fresh) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), ms == null ? 15000 : ms);
    try {
      const res = await fetch(url, { cache: fresh ? 'reload' : 'no-cache', signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(to); }
  }
  // The main pane is its own scroller, so a pull gesture would fight that
  // scroll and the installed app. Refresh stays on the header button.
  const SESSION_KEY = 'ml-refresh-session';
  function saveSession(extra) {
    let trade = null;
    try { if (window.MLTrade && window.MLTrade.snapshot) trade = window.MLTrade.snapshot(); } catch (e) { trade = null; }
    const blob = {
      at: Date.now(),
      view: state.view,
      week: state.week,
      scoring: state.scoring,
      pos: state.pos,
      newsFilter: state.newsFilter,
      defSort: state.defSort,
      playerId: state.player && state.player.id,
      cmp: state.cmp || null,
      trade,
    };
    if (extra) Object.assign(blob, extra);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(blob)); } catch (e) { /* private mode */ }
  }
  function takeSession() {
    let raw = null;
    try { raw = sessionStorage.getItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (!data || !data.at || Date.now() - data.at > 60000) return null;
      return data;
    } catch (e) { return null; }
  }
  function syncSeg(id, val) {
    const root = $(id);
    if (!root || val == null) return;
    $$('button', root).forEach(b => b.setAttribute('aria-checked', String(b.dataset.val === val)));
  }
  function applySession(saved) {
    if (!saved) return;
    if (saved.scoring) state.scoring = saved.scoring;
    if (saved.pos) state.pos = saved.pos;
    if (saved.newsFilter) state.newsFilter = saved.newsFilter;
    if (saved.defSort && saved.defSort.key) state.defSort = saved.defSort;
    if (Array.isArray(saved.cmp)) state.cmp = saved.cmp;
    syncSeg('#scoringSeg', state.scoring);
    syncSeg('#posSeg', state.pos);
    syncSeg('#newsSeg', state.newsFilter);
    if (saved.week != null) {
      const sel = $('#weekSelect');
      const has = sel && Array.from(sel.options).some(o => Number(o.value) === Number(saved.week));
      if (has) { state.week = Number(saved.week); sel.value = String(state.week); }
    }
    if (saved.playerId && state.data) {
      const pl = state.data.players.find(p => p.id === saved.playerId);
      if (pl) {
        state.player = pl;
        const tab = $('#playerTab');
        if (tab) { tab.disabled = false; tab.textContent = pl.name; }
      }
    }
    try { if (saved.trade && window.MLTrade && window.MLTrade.restore) window.MLTrade.restore(saved.trade); } catch (e) { /* trade still renders empty */ }
    if (saved.view && saved.view !== 'board') setView(saved.view);
    else if (state.view === 'board') renderBoard();
    if (saved.banner) paintRefreshStatus(saved.banner);
  }
  async function activateWaitingApp(banner) {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return false;
    let reg;
    try { reg = await navigator.serviceWorker.getRegistration(); } catch (e) { return false; }
    if (!reg) return false;
    try { await reg.update(); } catch (e) { /* the data refresh still stands */ }
    let worker = reg.waiting;
    if (!worker && reg.installing) {
      worker = await new Promise(resolve => {
        const installing = reg.installing;
        const timer = setTimeout(() => resolve(null), 4000);
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed') { clearTimeout(timer); resolve(reg.waiting || installing); }
          else if (installing.state === 'redundant') { clearTimeout(timer); resolve(null); }
        });
      });
    }
    if (!worker) return false;
    saveSession({ banner: banner || '' });
    let reloaded = false;
    const drop = setTimeout(() => {
      if (!reloaded) { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* keep the page as it is */ } }
    }, 8000);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      clearTimeout(drop);
      location.reload();
    });
    worker.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }
  let refreshing = false;
  let booted = false;
  const AUTO_MS = 30 * 60 * 1000;
  const EDIT_RETRY_MS = 60 * 1000;
  let lastRefreshAt = 0;
  let refreshTimer = 0;
  function userIsEditing() {
    const el = document.activeElement;
    if (el && el.isContentEditable) return true;
    if (el && el.tagName === 'TEXTAREA') return true;
    if (el && el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (!/^(button|submit|reset|checkbox|radio|file|range|color)$/.test(type)) return true;
    }
    // Team connect fields are rebuilt on render, so unsaved text has to wait.
    for (const id of ['slUser', 'esId', 'mnText']) {
      const field = document.getElementById(id);
      if (field && field.value !== field.defaultValue) return true;
    }
    return false;
  }
  function armAutoRefresh(delay) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(runAutoRefresh, delay);
  }
  async function runAutoRefresh() {
    refreshTimer = 0;
    if (document.hidden) return;
    if (!booted || refreshing || userIsEditing()) { armAutoRefresh(EDIT_RETRY_MS); return; }
    await refreshData({ silent: true });
  }
  function onVisibility() {
    if (document.hidden) {
      if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = 0; }
      return;
    }
    const elapsed = lastRefreshAt ? Date.now() - lastRefreshAt : AUTO_MS;
    if (elapsed >= AUTO_MS) runAutoRefresh();
    else armAutoRefresh(AUTO_MS - elapsed);
  }
  function bindAutoRefresh() {
    if (document.documentElement.dataset.autoRefresh) return;
    document.documentElement.dataset.autoRefresh = '1';
    if (!lastRefreshAt) lastRefreshAt = Date.now();
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) armAutoRefresh(AUTO_MS);
  }
  async function refreshData(opts) {
    const silent = !!(opts && opts.silent);
    if (refreshing) return;
    refreshing = true;
    if (!silent) setRefreshBusy(true);
    const started = Date.now();
    const q = '?t=' + Date.now() + '&fresh=1';
    const previous = state.data;
    let refreshed = false;
    let dataReady = false;
    let mode = 'fail';
    try {
      const d = await fetchJson(REMOTE + 'data.json' + q, 12000, true);
      if (!usableData(d)) throw new Error('bad remote');
      sanitizeData(d);
      const view = state.view;
      const week = state.week;
      const scoring = state.scoring;
      const pos = state.pos;
      const playerId = state.player && state.player.id;
      state.data = d;
      state.dataSrc = 'remote';
      state.view = view;
      state.scoring = scoring;
      state.pos = pos;
      state.week = week;
      if (playerId) {
        const fresh = state.data.players.find(p => p.id === playerId);
        if (fresh) state.player = fresh;
      }
      try { state.market = await fetchJson(REMOTE + 'market.json' + q, 8000, true); } catch (e) { /* keep the odds already on screen */ }
      try { state.news = await fetchJson(REMOTE + 'news.json' + q, 8000, true); } catch (e) { /* keep the news already on screen */ }
      indexNews();
      if (window.MLTrade) window.MLTrade.ensure(state.data);
      noteDataFreshness(state.data, 'remote');
      dataReady = true;
      let roster = true;
      if (booted) {
        fillWeeks(true);
        // Opening the app loads the Sleeper roster. The button used to skip
        // that and redraw the lineup already in memory, so a change on Sleeper
        // stayed put until the app was closed. Reload it the same way, unless
        // a connect field is mid-edit.
        if (!(silent && userIsEditing()) && window.MLTeam && window.MLTeam.reload) {
          roster = await window.MLTeam.reload();
        }
        if (roster !== false && !(silent && userIsEditing())) renderCurrent();
        loadPracticeReports();
      } else {
        startUi();
      }
      const beforeGen = previous && previous.meta && previous.meta.generated;
      const afterGen = state.data.meta && state.data.meta.generated;
      // A lineup can change while the projection file is unchanged. Say so.
      mode = roster === false ? 'fail' : roster === 'league' || !(beforeGen && beforeGen === afterGen) ? 'ok' : 'same';
      refreshed = roster !== false;
      const wait = silent ? 0 : 800 - (Date.now() - started);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (!silent) paintRefreshStatus(mode);
    } catch (e) {
      if (previous) state.data = previous;
      if (!silent) paintRefreshStatus('fail');
    } finally {
      refreshing = false;
      lastRefreshAt = Date.now();
      if (!silent) {
        setRefreshBusy(false);
        const label = $('#refreshStatusText') && $('#refreshStatusText').textContent;
        if (label === 'Refreshing…') paintRefreshStatus(state.data ? 'idle' : 'fail');
      }
      if (!document.hidden) armAutoRefresh(AUTO_MS);
    }
    if (refreshed && silent && userIsEditing()) {
      if (!document.hidden) armAutoRefresh(EDIT_RETRY_MS);
    } else if (dataReady) {
      await activateWaitingApp(refreshed && !silent ? mode : '');
    }
  }
  function bindRefresh() {
    const btn = $('#refreshBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => { refreshData(); });
  }
  function startUi() {
    if (booted) return;
    booted = true;
    const saved = takeSession();
    const safe = (fn, name) => { try { fn(); } catch (e) { console.error(name, e); } };
    safe(initControls, 'controls');
    safe(initSearch, 'search');
    safe(renderBoard, 'board');
    if (!refreshing && !(saved && saved.banner)) paintRefreshStatus('idle');
    bindAutoRefresh();
    loadLiveInjuries();
    loadPracticeReports();
    window.ML = { state, SCORING, weatherChip, weatherText, loadWeather, injuryOf, isOut, project, makeDist, gameFor, f1, f2, pct, esc, avatar, statusFlag, newsBadge, hasInjuryNews, openPlayer, rkOrd, fmtKick, tn, setView, compareRows, compareTable, renderNews, renderBoard, refreshData };
    if (window.MLTrade && saved && saved.trade && window.MLTrade.restore) window.MLTrade.restore(saved.trade);
    const teamReady = window.MLTeam ? window.MLTeam.init() : null;
    if (window.MLTrade) window.MLTrade.init();
    const finish = () => { if (saved) applySession(saved); };
    if (teamReady && teamReady.then) teamReady.then(finish, finish);
    else finish();
  }
  async function boot() {
    initTheme();
    initSplash();
    bindRefresh();
    $('#boardBody').innerHTML = Array.from({ length: 8 }, () => `<tr><td colspan="9"><div class="skeleton" style="height:40px">&nbsp;</div></td></tr>`).join('');
    const get = (url, ms) => fetchJson(url, ms, false);
    // Fresh data is rebuilt every few hours; the copy shipped with the site is the fallback.
    try {
      const d = await get(REMOTE + 'data.json?t=' + Math.floor(Date.now() / 6e5), 8000);
      if (booted) return;
      if (!usableData(d)) throw new Error('bad remote');
      state.data = d; state.dataSrc = 'remote';
    } catch (e0) {
      if (booted) return;
      try {
        const d = await get('data.json?v=' + (window.ML_VER || Date.now()));
        if (booted) return;
        if (!usableData(d)) throw new Error('bad local');
        state.data = d; state.dataSrc = 'local';
      } catch (e1) {
        if (booted) return;
        const why = e0.name === 'AbortError' ? 'timed out' : (e0.message || 'request failed');
        const msg = `Data unavailable. Live projections could not be loaded (${why}), and this page has no usable bundled data.json.${storedGeneratedAge()}`;
        showDataStatus(msg, true);
        $('#boardBody').innerHTML = `<tr class="empty-row"><td colspan="9">${esc(msg)} <a href="" onclick="location.reload();return false">Try again</a></td></tr>`;
        return;
      }
    }
    if (booted) return;
    sanitizeData(state.data);
    noteDataFreshness(state.data, state.dataSrc);
    let market = null;
    try { market = await get(REMOTE + 'market.json?t=' + Math.floor(Date.now() / 6e5), 15000); } catch (e) { try { market = await get('market.json?v=' + (window.ML_VER || Date.now()), 15000); } catch (e2) { market = null; } }
    if (booted) return;
    state.market = market;
    let news = null;
    try { news = await get(REMOTE + 'news.json?t=' + Math.floor(Date.now() / 6e5), 15000); } catch (e) { try { news = await get('news.json?v=' + (window.ML_VER || Date.now()), 15000); } catch (e2) { news = null; } }
    if (booted) return;
    state.news = news;
    indexNews();
    if (window.MLTrade) window.MLTrade.ensure(state.data);
    startUi();
  }
  boot();
})();
