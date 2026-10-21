/* Matchup Lab — My Team: connect a Sleeper / ESPN league (or paste a roster) and get optimal lineup suggestions. */
(() => {
  'use strict';
  const SEASON = 2026;
  const T = { mode: 'sleeper', league: null, teamId: null, loading: false, error: null, showConnect: true, sleeperLeagues: null, sleeperUser: null, manualPreset: 'std', manualText: '' };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  let ML, idx;

  // ---------- Slots ----------
  const LUP = globalThis.MLLineup;
  const ELIG = LUP.ELIG;
  const SLOT_LABEL = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', DEF: 'DEF', FLEX: 'FLEX', SUPER_FLEX: 'SFLEX', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', DL: 'DL', LB: 'LB', DB: 'DB', DE: 'DE', DT: 'DT', CB: 'CB', S: 'S', IDP: 'IDP', IDP_FLEX: 'IDP' };
  const PRESETS = {
    std: { label: 'Standard: QB, 2 RB, 2 WR, TE, FLEX, K, DEF', slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'] },
    wr3: { label: '3 WR: QB, 2 RB, 3 WR, TE, FLEX, K, DEF', slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'] },
    flex2: { label: '2 FLEX: QB, 2 RB, 2 WR, TE, 2 FLEX, K, DEF', slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF'] },
    sf: { label: 'Superflex: QB, 2 RB, 2 WR, TE, FLEX, SFLEX', slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'] },
  };
  const ESPN_SLOT = LUP.ESPN_SLOT;
  const ESPN_POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };

  // ---------- Name matching ----------
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.'’`-]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  function buildIndex() {
    const bySl = {}, byEspn = {}, byName = {}, byLast = {};
    for (const p of ML.state.data.players) {
      if (p.ids?.sl) bySl[p.ids.sl] = p;
      if (p.ids?.espn) byEspn[p.ids.espn] = p;
      const n = norm(p.name);
      (byName[n] = byName[n] || []).push(p);
      const parts = n.split(' '); const key = parts[0][0] + ' ' + parts.slice(1).join(' ');
      (byLast[key] = byLast[key] || []).push(p);
    }
    return { bySl, byEspn, byName, byLast };
  }
  const POS_WORDS = new Set(['qb', 'rb', 'wr', 'te', 'k', 'def', 'dst', 'flex', 'bn', 'ir', 'pk']);
  const TEAM_WORDS = () => new Set(Object.keys(ML.state.data.team_names).map(t => t.toLowerCase()).concat(['lar', 'jac', 'wsh', 'kcc', 'gbp', 'nep', 'nos', 'sfo', 'tbb', 'lvr', 'fa']));
  function matchName(raw, pos) {
    let line = String(raw).replace(/\(.*?\)/g, ' ').replace(/[,|•·\t]/g, ' ').trim();
    if (!line) return null;
    const teams = TEAM_WORDS();
    const tryKey = s => {
      const n = norm(s); if (!n) return null;
      let c = idx.byName[n];
      if (!c) { const parts = n.split(' '); if (parts.length >= 2) c = idx.byLast[parts[0][0] + ' ' + parts.slice(1).join(' ')]; }
      if (!c) return null;
      if (pos) { const f = c.filter(p => p.pos === pos); if (f.length) c = f; }
      return c.slice().sort((a, b) => b.ppr_pg - a.ppr_pg)[0];
    };
    let m = tryKey(line); if (m) return m;
    // strip position / team tokens
    const toks = norm(line).split(' ').filter(t => !POS_WORDS.has(t) && !teams.has(t));
    m = tryKey(toks.join(' ')); if (m) return m;
    return null;
  }

  // ---------- Scoring ----------
  function sleeperScoring(s) {
    const g = k => (s && typeof s[k] === 'number' ? s[k] : 0);
    const S = { name: 'League scoring', rec: g('rec'), py: g('pass_yd'), ptd: g('pass_td'), int: g('pass_int'), ry: g('rush_yd'), rtd: g('rush_td'), rcy: g('rec_yd'), rctd: g('rec_td'), fl: g('fum_lost'), two: g('rush_2pt') || g('rec_2pt') || g('pass_2pt'), bonus_TE: g('bonus_rec_te'), bonus_RB: g('bonus_rec_rb'), bonus_WR: g('bonus_rec_wr') };
    const modeled = new Set(['rec', 'pass_yd', 'pass_td', 'pass_int', 'rush_yd', 'rush_td', 'rec_yd', 'rec_td', 'fum_lost', 'rush_2pt', 'rec_2pt', 'pass_2pt', 'bonus_rec_te', 'bonus_rec_rb', 'bonus_rec_wr', 'fum']);
    const unmodeled = Object.keys(s || {}).filter(k => /^(pass|rush|rec|bonus_(pass|rush|rec))/.test(k) && !modeled.has(k) && s[k] !== 0).map(k => k.replace(/_/g, ' '));
    return { S, unmodeled };
  }
  function espnScoring(settings) {
    const items = settings?.scoringSettings?.scoringItems || [];
    const pts = id => { const it = items.find(i => i.statId === id); return it ? it.points : 0; };
    const te = items.find(i => i.statId === 53 && i.pointsOverrides && i.pointsOverrides['6'] != null);
    const S = { name: 'League scoring', rec: pts(53), py: pts(3), ptd: pts(4), int: pts(20), ry: pts(24), rtd: pts(25), rcy: pts(42), rctd: pts(43), fl: pts(72), two: pts(26) || pts(44) || pts(19), bonus_TE: te ? te.pointsOverrides['6'] - pts(53) : 0, bonus_RB: 0, bonus_WR: 0 };
    return { S, unmodeled: [] };
  }
  function scoringLabel(S) {
    const r = S.rec;
    const base = r >= 0.99 ? 'PPR' : r >= 0.49 ? 'Half-PPR' : r > 0 ? `${r} per rec` : 'Standard';
    const extras = [];
    if (S.ptd && S.ptd !== 4) extras.push(`${S.ptd}-pt pass TD`);
    if (S.bonus_TE) extras.push(`TE premium +${S.bonus_TE}`);
    return [base, ...extras].join(' · ');
  }

  // ---------- Fetch helpers ----------
  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return r.json();
  }

  // Sleeper
  async function sleeperFindLeagues(username) {
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(String(username || '').trim())) throw new Error('Sleeper usernames only contain letters, numbers, and _ . -');
    const u = await getJSON(`https://api.sleeper.app/v1/user/${encodeURIComponent(username.trim())}`);
    if (!u || !u.user_id) throw new Error(`No Sleeper user named "${username}".`);
    const leagues = await getJSON(`https://api.sleeper.app/v1/user/${u.user_id}/leagues/nfl/${SEASON}`);
    return { user: u, leagues: leagues || [] };
  }
  const isId = v => /^\d{1,20}$/.test(String(v || ''));
  async function sleeperLoadLeague(leagueId, userId) {
    if (!isId(leagueId)) throw new Error('Invalid Sleeper league ID.');
    const [lg, rosters, users] = await Promise.all([
      getJSON(`https://api.sleeper.app/v1/league/${leagueId}`),
      getJSON(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
      getJSON(`https://api.sleeper.app/v1/league/${leagueId}/users`),
    ]);
    const week = ML.state.week;
    let matchups = [];
    try { matchups = await getJSON(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`) || []; } catch (e) { /* no matchups */ }
    const userById = Object.fromEntries((users || []).map(u => [u.user_id, u]));
    const slots = LUP.slotsFromSleeper(lg.roster_positions || []);
    const { S, unmodeled } = sleeperScoring(lg.scoring_settings);
    const mk = sid => resolveSleeper(sid);
    const teams = (rosters || []).map(r => {
      const u = userById[r.owner_id] || {};
      const reserve = new Set(r.reserve || []), taxi = new Set(r.taxi || []);
      const starters = (r.starters || []);
      return {
        id: String(r.roster_id),
        name: (u.metadata && u.metadata.team_name) || u.display_name || `Team ${r.roster_id}`,
        owner: u.display_name || '',
        ownerIds: [r.owner_id, ...(r.co_owners || [])].filter(Boolean),
        players: (r.players || []).filter(sid => !taxi.has(sid)).map(sid => ({ ...mk(sid), ir: reserve.has(sid) })),
        currentSlots: starters.map((sid, i) => ({ slot: slots[i], key: sid && sid !== '0' ? 'sl:' + sid : null })),
        matchupId: (matchups.find(m => m.roster_id === r.roster_id) || {}).matchup_id ?? null,
      };
    });
    const mine = userId ? teams.find(t => t.ownerIds.includes(userId)) : null;
    return { source: 'sleeper', id: leagueId, name: lg.name, slots, S, unmodeled, teams, defaultTeamId: mine ? mine.id : null, week };
  }
  function resolveSleeper(sid) {
    const key = 'sl:' + sid;
    const p = idx.bySl[sid];
    if (p) return { key, ml: p, name: p.name, pos: p.pos, team: p.team, inj: p.sl_inj?.status || p.inj?.status || null };
    const ex = ML.state.data.sl_extra?.[sid];
    if (ex) return { key, ml: null, name: ex[1] === 'DEF' ? `${ML.tn(ex[2] || sid)} D/ST` : ex[0], pos: ex[1], team: ex[2], inj: ex[3] || null };
    if (/^[A-Z]{2,3}$/.test(sid)) return { key, ml: null, name: `${ML.tn(sid)} D/ST`, pos: 'DEF', team: sid, inj: null };
    return { key, ml: null, name: `Player #${sid}`, pos: '?', team: null, inj: null };
  }

  // ESPN
  async function espnLoadLeague(leagueId) {
    if (!isId(leagueId)) throw new Error('Invalid ESPN league ID.');
    const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${leagueId}`;
    let d;
    try { d = await getJSON(`${base}?view=mTeam&view=mRoster&view=mSettings&view=mMatchupScore`); }
    catch (e) {
      if (e.status === 401) throw new Error('This ESPN league is private. Your commissioner can turn on "Make League Viewable to Public" in League Settings, or use the paste option instead.');
      if (e.status === 404) throw new Error(`No ESPN league ${leagueId} found for the ${SEASON} season.`);
      throw e;
    }
    const slots = LUP.slotsFromEspn(d.settings?.rosterSettings?.lineupSlotCounts || {});
    const { S, unmodeled } = espnScoring(d.settings);
    const week = ML.state.week;
    const mp = d.settings?.scheduleSettings?.matchupPeriods || {};
    const period = Object.keys(mp).find(k => (mp[k] || []).includes(week));
    const games = (d.schedule || []).filter(m => String(m.matchupPeriodId) === String(period ?? week));
    const teams = (d.teams || []).map(t => {
      const entries = t.roster?.entries || [];
      const players = entries.map(e => {
        const pl = e.playerPoolEntry?.player || {};
        const pos = ESPN_POS[pl.defaultPositionId] || '?';
        const ml = idx.byEspn[String(e.playerId)] || (pos !== 'DEF' && pos !== 'K' ? matchName(pl.fullName, pos) : null);
        const inj = pl.injuryStatus && pl.injuryStatus !== 'ACTIVE' ? pl.injuryStatus.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : null;
        return { src: 'espn', key: 'espn:' + e.playerId, ml, name: pl.fullName || ml?.name || `Player #${e.playerId}`, pos, team: ml?.team || null, inj, ir: e.lineupSlotId === 21, espnSlot: e.lineupSlotId };
      });
      const currentSlots = players.filter(p => ESPN_SLOT[p.espnSlot]).map(p => ({ slot: ESPN_SLOT[p.espnSlot], key: p.key }));
      const g = games.find(m => m.home?.teamId === t.id || m.away?.teamId === t.id);
      return { id: String(t.id), name: t.name || `${t.location || ''} ${t.nickname || ''}`.trim() || `Team ${t.id}`, owner: '', players, currentSlots, matchupId: g ? g.id : null };
    });
    return { source: 'espn', id: leagueId, name: d.settings?.name || `ESPN league ${leagueId}`, slots, S, unmodeled, teams, defaultTeamId: null, week };
  }

  // Kickers & team defenses for pasted rosters
  function matchKD(line) {
    const n = norm(line.replace(/\(.*?\)/g, ' '));
    const names = ML.state.data.team_names;
    const isDef = /\b(d ?st|def|defense|defence)\b/.test(n);
    for (const [ab, full] of Object.entries(names)) {
      const f = norm(full), nick = f.split(' ').slice(-1)[0];
      const stripped = n.replace(/\b(d ?st|def|defense|defence)\b/g, '').trim();
      if (stripped === f || stripped === nick || (isDef && (stripped === ab.toLowerCase() || stripped.includes(nick))))
        return { key: 'def:' + ab, ml: null, name: `${full} D/ST`, pos: 'DEF', team: ab, inj: null };
    }
    const ex = ML.state.data.sl_extra || {};
    const cleaned = n.replace(/\b(k|pk)\b/g, '').trim();
    for (const sid in ex) { const e = ex[sid]; if (e[1] === 'K' && norm(e[0]) === cleaned) return { key: 'sl:' + sid, ml: null, name: e[0], pos: 'K', team: e[2], inj: null }; }
    return null;
  }

  // Manual
  function manualLeague(text, preset) {
    const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const players = [], unmatched = [];
    const seen = new Set();
    for (const line of lines) {
      const kd = matchKD(line);
      if (kd) { if (!seen.has(kd.key)) { seen.add(kd.key); players.push(kd); } continue; }
      const m = matchName(line);
      if (m && !seen.has(m.id)) { seen.add(m.id); players.push({ key: 'ml:' + m.id, ml: m, name: m.name, pos: m.pos, team: m.team, inj: m.sl_inj?.status || m.inj?.status || null }); }
      else if (!m) unmatched.push(line);
    }
    const S = ML.SCORING[ML.state.scoring];
    return { source: 'manual', id: 'manual', name: 'Pasted roster', slots: PRESETS[preset].slots.slice(), S, unmodeled: [], teams: [{ id: 'me', name: 'My roster', owner: '', players, currentSlots: null, matchupId: null }], defaultTeamId: 'me', week: ML.state.week, unmatched };
  }

  // ---------- Projection + lineup optimization ----------
  const OUT_RE = /^(out|ir|injured reserve|injury reserve|pup|sus|suspended|doubtful|na|cov)$/i;
  function kickoff(g) {
    if (!g) return null;
    const [y, mo, d] = g.date.split('-').map(Number);
    const nov1 = new Date(Date.UTC(y, 10, 1)); const firstSunNov = 1 + ((7 - nov1.getUTCDay()) % 7);
    const mar1 = new Date(Date.UTC(y, 2, 1)); const secondSunMar = 1 + ((7 - mar1.getUTCDay()) % 7) + 7;
    const edt = (mo > 3 && mo < 11) || (mo === 3 && d >= secondSunMar) || (mo === 11 && d < firstSunNov);
    return new Date(`${g.date}T${g.time || '13:00'}:00${edt ? '-04:00' : '-05:00'}`);
  }
  function evalPlayer(p0, S, week) {
    const p = p0.ml && p0.src !== 'espn' ? { ...p0, inj: (ML.injuryOf(p0.ml) || {}).status || null } : p0;
    const r = { ...p, proj: null, pr: null, status: 'ok', note: '', value: 0, locked: false };
    if (p.ml && p.ml.tradeOnly) { r.status = 'np'; r.note = 'No weekly projection'; }
    else if (p.ml) {
      const pr = ML.project(p.ml, week, S);
      r.pr = pr;
      if (pr.bye) { r.status = 'bye'; r.note = 'Bye'; }
      else { r.proj = pr.pts; }
      const game = pr.bye ? null : pr.game;
      const ko = kickoff(game);
      if (ko && ko.getTime() <= Date.now()) r.locked = true;
    } else if (p.pos === 'K' || p.pos === 'DEF') { r.status = 'np'; r.note = 'Not projected'; }
    else { r.status = 'np'; r.note = 'No projection (limited 2026 usage)'; }
    if (p.ir) { r.status = 'out'; r.note = 'IR slot'; }
    else if (p.inj && OUT_RE.test(String(p.inj).trim())) { r.status = 'out'; r.note = p.inj; }
    r.value = r.status === 'ok' ? Math.max(r.proj, 0.2) : r.status === 'np' ? 0.1 : -1;
    if (r.status === 'np' && (p.pos === 'K' || p.pos === 'DEF')) r.value = 0.1;
    return r;
  }

  function optimize(slots, roster, currentSlots) {
    return LUP.optimize(slots, roster, currentSlots);
  }

  function lineupStats(players) {
    let mean = 0, varsum = 0;
    for (const p of players) if (p && p.status === 'ok' && p.pr && !p.pr.bye) { mean += p.proj; varsum += p.pr.dist.sd ** 2; }
    return { mean, sd: Math.sqrt(varsum) };
  }
  const normCdf = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };

  function analyze(league, teamId) {
    const team = league.teams.find(t => t.id === teamId);
    if (!team) return null;
    const S = league.source === 'manual' ? ML.SCORING[ML.state.scoring] : league.S;
    const week = ML.state.week;
    const roster = team.players.map(p => evalPlayer(p, S, week));
    const opt = optimize(league.slots, roster, team.currentSlots);
    // Keep current K / DEF / IDP picks when not projected (optimizer treats them equally)
    const UNPROJECTED = new Set(['K', 'DEF', 'DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S', 'IDP']);
    if (team.currentSlots) {
      league.slots.forEach((s, i) => {
        if (!UNPROJECTED.has(s) && s !== 'IDP_FLEX') return;
        const cur = team.currentSlots.filter(c => c.slot === s && c.key).map(c => roster.find(p => p.key === c.key)).filter(Boolean);
        const taken = new Set(opt.filter((x, j) => j !== i && x).map(x => x.key));
        const pick = cur.find(p => !taken.has(p.key) && p.status !== 'out');
        if (pick) opt[i] = pick;
      });
    }
    const optKeys = new Set(opt.filter(Boolean).map(p => p.key));
    const current = team.currentSlots ? team.currentSlots.map(c => ({ slot: c.slot, p: c.key ? roster.find(p => p.key === c.key) || null : null })) : null;
    const curKeys = new Set((current || []).filter(c => c.p).map(c => c.p.key));
    const bench = roster.filter(p => !optKeys.has(p.key)).sort((a, b) => (b.value - a.value));
    const optStats = lineupStats(opt);
    const curStats = current ? lineupStats(current.map(c => c.p)) : null;

    // Moves: pair players entering with players leaving
    const moves = [];
    if (current) {
      const ins = opt.map((p, i) => ({ p, slot: league.slots[i] })).filter(x => x.p && !curKeys.has(x.p.key) && x.p.status === 'ok');
      const outs = current.filter(c => c.p && !optKeys.has(c.p.key)).map(c => ({ p: c.p, slot: c.slot }));
      const emptyCur = current.filter(c => !c.p).map(c => c.slot);
      const usedOut = new Set();
      for (const x of ins.sort((a, b) => b.p.proj - a.p.proj)) {
        let best = null;
        for (const o of outs) if (!usedOut.has(o.p.key) && (ELIG[o.slot]?.includes(x.p.pos) || ELIG[x.slot]?.includes(o.p.pos))) { if (!best || (o.p.value < best.p.value)) best = o; }
        if (!best) best = outs.find(o => !usedOut.has(o.p.key));
        if (best) { usedOut.add(best.p.key); moves.push({ start: x.p, sit: best.p }); }
        else if (emptyCur.length) { emptyCur.shift(); moves.push({ start: x.p, sit: null }); }
        else moves.push({ start: x.p, sit: null });
      }
      for (const o of outs) if (!usedOut.has(o.p.key)) moves.push({ start: null, sit: o.p });
    }

    // Opponent
    let opp = null;
    if (team.matchupId != null) {
      const ot = league.teams.find(t => t.id !== team.id && t.matchupId === team.matchupId);
      if (ot) {
        const orost = ot.players.map(p => evalPlayer(p, S, week));
        const oopt = optimize(league.slots, orost, ot.currentSlots);
        const os = lineupStats(oopt);
        const diff = optStats.mean - os.mean, sd = Math.sqrt(optStats.sd ** 2 + os.sd ** 2) || 1;
        opp = { team: ot, stats: os, win: normCdf(diff / sd) };
      }
    }

    // Waiver targets: an available player is an add only when they out-value
    // the least valuable player you can spare, at any position.
    let waivers = null;
    if (league.source !== 'manual' && globalThis.MLWaiver) {
      const rostered = new Set();
      for (const t of league.teams) for (const p of t.players) if (p.ml) rostered.add(p.ml.id);
      const free = [];
      for (const p of ML.state.data.players) {
        if (p.tradeOnly) continue;
        if (rostered.has(p.id)) continue;
        if (ML.isOut(p)) continue;
        if (p.last_wk < ML.state.data.meta.last_completed_week - 1) continue;
        const inj = (ML.injuryOf(p) || {}).status || null;
        const e = evalPlayer({ key: 'ml:' + p.id, ml: p, name: p.name, pos: p.pos, team: p.team, inj }, S, week);
        if (e.status !== 'ok') continue;
        free.push(e);
      }
      const scoring = S.rec >= 0.99 ? 'ppr' : S.rec >= 0.49 ? 'half' : 'std';
      const qbMode = LUP.isMultiQb(league.slots) ? 'sflex' : 'qb1';
      const perPos = {};
      const data = (globalThis.ML && ML.state && ML.state.data) || {};
      waivers = globalThis.MLWaiver.advise({
        roster, opt, slots: league.slots, freeAgents: free, scoring, qbMode,
        players: data.players || [], roles: data.roles, week,
      })
        .filter(c => (perPos[c.e.pos] = (perPos[c.e.pos] || 0) + 1) <= 2)
        .slice(0, 6);
    }
    return { team, roster, opt, current, bench, optStats, curStats, moves, opp, waivers, S };
  }

  // ---------- Rendering ----------
  const view = () => $('#view-team');
  // ---------- Saved teams (stored on this device) ----------
  const SAVE_KEY = 'matchuplab.teams.v1', LAST_KEY = 'matchuplab.lastTeam.v1';
  // Saved in this browser's localStorage only (never sent to any server).
  let persistAsked = false;
  const store = {
    get(k, d) { try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : d; } catch (e) { return d; } },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* blocked */ }
      if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); }
    },
  };
  const framed = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  const canSave = (() => {
    try { localStorage.setItem('ml_t', '1'); localStorage.removeItem('ml_t'); return true; } catch (e) { return false; }
  })();
  const SITE = 'https://matchup-lab.pplx.app/';
  function teamLink() { const h = (location.hash || '').replace(/^#/, ''); return SITE + (h ? '#' + h : ''); }
  function keepCard() {
    if (!T.league || !T.teamId) return '';
    const link = ML.esc(teamLink());
    if (!canSave) return `<div class="notice bad keep">This view can't save teams. <a href="${link}" target="_blank" rel="noopener">Open Matchup Lab in your browser</a> to save them.</div>`;
    if (framed) return `<div class="notice keep">You're viewing Matchup Lab inside another app, which may forget your team. <a href="${link}" target="_blank" rel="noopener">Open it in your browser</a> to keep it saved.</div>`;
    return '';
  }

  const savedTeams = () => { const a = store.get(SAVE_KEY, []); return Array.isArray(a) ? a.filter(x => x && typeof x.hash === 'string' && /^team=(sleeper|espn|manual)\//.test(x.hash)).slice(0, 12) : []; };
  function rememberTeam(h) {
    const L = T.league; if (!L || !h || !T.teamId) return;
    const team = L.teams.find(x => x.id === T.teamId);
    const src = L.source === 'sleeper' ? 'Sleeper' : L.source === 'espn' ? 'ESPN' : 'Pasted';
    const label = L.source === 'manual' ? `Pasted roster (${team ? team.players.length : 0} players)` : `${team ? team.name : 'Team'} · ${L.name}`;
    const key = L.source === 'manual' ? 'manual' : `${L.source}:${L.id}`;
    const list = savedTeams().filter(x => x.key !== key);
    list.unshift({ key, hash: h, label: String(label).slice(0, 80), src, at: Date.now() });
    store.set(SAVE_KEY, list.slice(0, 12)); store.set(LAST_KEY, h);
  }
  function forgetTeam(key) {
    const list = savedTeams(), gone = list.find(x => x.key === key);
    store.set(SAVE_KEY, list.filter(x => x.key !== key));
    if (gone && store.get(LAST_KEY, '') === gone.hash) store.set(LAST_KEY, list.find(x => x.key !== key)?.hash || '');
  }
  function currentKey() { const L = T.league; return !L ? null : L.source === 'manual' ? 'manual' : `${L.source}:${L.id}`; }
  function savedStrip() {
    const list = savedTeams(); if (!list.length) return '';
    const cur = currentKey();
    return `<div class="saved-strip" role="list" aria-label="Saved teams"><span class="saved-lbl">Saved teams</span>${list.map(x => `
      <span class="saved-chip${x.key === cur ? ' on' : ''}" role="listitem"><button type="button" class="saved-open" data-hash="${ML.esc(x.hash)}" title="Open ${ML.esc(x.label)}"><b>${ML.esc(x.src)}</b> ${ML.esc(x.label)}</button><button type="button" class="saved-x" data-key="${ML.esc(x.key)}" aria-label="Forget ${ML.esc(x.label)}">×</button></span>`).join('')}</div>`;
  }

  function setHash() {
    const L = T.league; let h = '';
    if (L && L.source === 'sleeper') h = `team=sleeper/${encodeURIComponent(T.sleeperUser?.username || T.sleeperUser?.display_name || '_')}/${L.id}/${T.teamId || ''}`;
    else if (L && L.source === 'espn') h = `team=espn/${L.id}/${T.teamId || ''}`;
    else if (L && L.source === 'manual') h = `team=manual/${T.manualPreset}/${encodeURIComponent(L.teams[0].players.map(p => p.name).join('|'))}`;
    try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch (e) { /* ignore */ }
    rememberTeam(h);
  }

  function connectCard() {
    const tab = (k, l) => `<button type="button" role="radio" data-mode="${k}" aria-checked="${T.mode === k}">${l}</button>`;
    let body = '';
    if (T.mode === 'sleeper') {
      body = `
        <form class="conn-form" id="slForm">
          <label class="field"><span>Sleeper username</span><input id="slUser" type="text" autocomplete="username" placeholder="e.g. joedolan" value="${ML.esc(T.sleeperUser?.username || '')}" required /></label>
          <button class="btn" type="submit">Find my leagues</button>
        </form>
        ${T.sleeperLeagues ? (T.sleeperLeagues.length ? `<div class="league-list">${T.sleeperLeagues.map(l => `<button type="button" class="league-pick" data-lid="${ML.esc(l.league_id)}"><b>${ML.esc(l.name)}</b><span>${Number(l.total_rosters) || 0} teams · ${ML.esc((l.roster_positions || []).filter(s => s !== 'BN').length)} starters</span></button>`).join('')}</div>` : `<p class="sub">No ${SEASON} NFL leagues found for this user.</p>`) : ''}
        <p class="hint">Read-only. Sleeper's public API only needs your username; no password, nothing is changed in your league.</p>`;
    } else if (T.mode === 'espn') {
      body = `
        <form class="conn-form" id="esForm">
          <label class="field"><span>ESPN league ID or league URL</span><input id="esId" type="text" inputmode="text" placeholder="fantasy.espn.com/football/league?leagueId=12345678" required /></label>
          <button class="btn" type="submit">Load league</button>
        </form>
        <p class="hint">Works with public ESPN leagues. If yours is private, the commissioner can enable "Make League Viewable to Public" under League Settings → Basic Settings, or use the Other apps tab.</p>`;
    } else {
      body = `
        <form class="conn-form col" id="mnForm">
          <label class="field"><span>Paste your roster, one player per line (Yahoo, NFL.com, CBS, Fleaflicker, anything)</span>
            <textarea id="mnText" rows="8" placeholder="Josh Allen\nBijan Robinson\nKyren Williams\nPuka Nacua\nCeeDee Lamb\nBrock Bowers\nZay Flowers\nJames Cook">${ML.esc(T.manualText)}</textarea></label>
          <div class="conn-row">
            <label class="field"><span>Lineup format</span><select id="mnPreset">${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}" ${k === T.manualPreset ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
            <button class="btn" type="submit">Optimize lineup</button>
          </div>
        </form>
        <p class="hint">Scoring follows the PPR / Half / Std toggle at the top. Position and team text like "WR · LAR" is ignored.</p>`;
    }
    return `
      <div class="card conn-card">
        <div class="conn-head">
          <div class="card-title" style="margin:0">Connect your league</div>
          <div class="segmented" role="radiogroup" aria-label="League platform" id="connTabs">${tab('sleeper', 'Sleeper')}${tab('espn', 'ESPN')}${tab('manual', 'Other apps')}</div>
        </div>
        ${body}
        ${T.error ? `<div class="notice bad" style="margin:var(--space-4) 0 0">${ML.esc(T.error)}</div>` : ''}
        ${T.loading ? `<div class="sub" style="margin-top:var(--space-3)">Loading…</div>` : ''}
      </div>`;
  }

  function slotBadge(slot) { return `<span class="slot">${ML.esc(SLOT_LABEL[slot] || slot)}</span>`; }
  function playerCell(p, opts = {}) {
    if (!p) return `<span class="sub">Empty${opts.emptyNote ? ' — ' + opts.emptyNote : ''}</span>`;
    const click = p.ml ? ` data-ml="${ML.esc(p.ml.id)}"` : '';
    const injFlag = p.inj && p.status !== 'out' ? `<span class="flag">${ML.esc(p.inj)}</span>` : '';
    const outFlag = p.status === 'out' ? `<span class="flag out">${ML.esc(p.note)}</span>` : p.status === 'bye' ? `<span class="flag">Bye</span>` : '';
    const lock = p.locked ? `<span class="flag lock" title="Game has started">Locked</span>` : '';
    const news = p.ml && ML.newsBadge ? ML.newsBadge(p.ml) : '';
    return `<div class="pcell${p.ml ? ' link' : ''}"${click}>${p.ml ? ML.avatar(p.ml, 'avatar') : `<span class="avatar"></span>`}<div><div class="name">${ML.esc(p.name)} ${outFlag}${injFlag}${lock}${news}</div><div class="meta"><span class="pos ${p.pos}">${p.pos}</span> ${ML.esc(p.team || '')}${p.pr && !p.pr.bye ? `<span class="m-only"> · ${p.pr.home ? 'vs' : '@'} ${ML.esc(p.pr.opp)}</span>` : ''}</div></div></div>`;
  }
  function matchupCell(p) {
    if (!p || !p.pr || p.pr.bye) return '<span class="sub">—</span>';
    return `<span class="matchup"><span class="vs">${p.pr.home ? 'vs' : '@'}</span> ${ML.esc(p.pr.opp)}<span class="when">${ML.fmtKick(p.pr.game)}</span>${ML.weatherChip(p.pr.game, p.pr)}</span>`;
  }
  function projCell(p) {
    if (!p) return '';
    if (p.status === 'ok') return `<span class="projv">${ML.f1(p.proj)}</span>`;
    return `<span class="sub">${p.status === 'np' ? '—' : '0.0'}</span>`;
  }
  function rangeCell(p) { return p && p.status === 'ok' ? `<span class="range"><span class="fl">${ML.f1(p.pr.floor)}</span><span class="rg-sep">–</span><span class="cl">${ML.f1(p.pr.ceil)}</span></span>` : ''; }
  function swapRow(p) {
    const inn = `<div class="swap-in"><span class="mv in">Start</span> <b>${ML.esc(p.startName)}</b> <span class="swap-proj">(${ML.esc(p.startProj)})</span></div>`;
    const out = p.kind === 'empty'
      ? `<div class="swap-out"><span class="mv out">Empty</span> <b>open slot</b></div>`
      : `<div class="swap-out"><span class="mv out">Bench</span> <b>${ML.esc(p.sitName)}</b> <span class="swap-proj">(${ML.esc(p.sitProj)})</span></div>`;
    return `<div class="move">${inn}${out}<div class="mv-why">+${ML.esc(p.gain)} pts</div></div>`;
  }

  function renderResults() {
    const L = T.league; const A = analyze(L, T.teamId);
    if (!A) return '';
    const week = ML.state.week;
    const scoreLbl = L.source === 'manual' ? ML.SCORING[ML.state.scoring].name : scoringLabel(L.S);
    const teamSel = L.teams.length > 1 ? `<label class="field inline"><span>Team</span><select id="teamSel">${L.teams.map(t => `<option value="${ML.esc(t.id)}" ${t.id === T.teamId ? 'selected' : ''}>${ML.esc(t.name)}${t.owner ? ' · ' + ML.esc(t.owner) : ''}</option>`).join('')}</select></label>` : '';
    const gain = A.curStats ? A.optStats.mean - A.curStats.mean : null;
    const swaps = A.current ? LUP.swapMoves(A.moves) : [];

    const kpis = `
      <div class="kpis">
        <div class="kpi"><div class="k">Optimal lineup</div><div class="v">${ML.f1(A.optStats.mean)}</div><div class="s">projected pts · Week ${week}</div></div>
        ${A.curStats ? `<div class="kpi"><div class="k">Current lineup</div><div class="v">${ML.f1(A.curStats.mean)}</div><div class="s">as set in ${L.source === 'sleeper' ? 'Sleeper' : 'ESPN'}</div></div>
        <div class="kpi ${gain > 0.05 ? 'up' : ''}"><div class="k">Gain from changes</div><div class="v">${gain > 0.05 ? '+' + ML.f1(gain) : '0.0'}</div><div class="s">${swaps.length ? swaps.length + ' swap' + (swaps.length > 1 ? 's' : '') + ' suggested' : 'Lineup already optimal'}</div></div>` : ''}
        ${A.opp ? `<div class="kpi"><div class="k">Win probability</div><div class="v">${ML.pct(A.opp.win)}</div><div class="s">vs ${ML.esc(A.opp.team.name)} (${ML.f1(A.opp.stats.mean)})</div></div>` : ''}
      </div>`;

    const sleeperLinks = L.source === 'sleeper' ? LUP.sleeperTeamLinks(L.id) : null;
    const sleeperBtn = sleeperLinks ? `<a class="sleeper-open" id="openSleeper" href="${ML.esc(sleeperLinks.web)}" data-app="${ML.esc(sleeperLinks.app)}" data-legacy="${ML.esc(sleeperLinks.legacyApp)}" data-intent="${ML.esc(sleeperLinks.androidIntent)}" target="_blank" rel="noopener"><img src="sleeper-mark.png" alt="" width="28" height="28" /><span>Open in Sleeper</span></a>` : '';
    const movesCard = A.current ? `
      <div class="card" id="optimal-lineup">
        <div class="optimal-head">
          <div class="card-title">Optimal lineup</div>
          ${sleeperBtn}
        </div>
        ${swaps.length ? `<div class="moves">${swaps.map(swapRow).join('')}</div>${gain > 0.05 ? `<p class="swap-total">Total projected gain: +${ML.f1(gain)} pts</p>` : ''}` : `<p class="sub">Your lineup is already optimal for Week ${week}. No swap raises the projection.</p>`}
      </div>` : '';

    const curKeys = new Set((A.current || []).filter(c => c.p).map(c => c.p.key));
    const lineupRows = L.slots.map((slot, i) => {
      const p = A.opt[i];
      let status = '';
      if (slot === 'K' || slot === 'DEF') status = `<span class="grade neutral">Not projected</span>`;
      else if (!p) status = `<span class="grade bad">Empty</span>`;
      else if (A.current) status = curKeys.has(p.key) ? `<span class="grade neutral">Starting</span>` : `<span class="grade good">Move in</span>`;
      const injNews = p && p.ml && ML.hasInjuryNews && ML.hasInjuryNews(p.ml.id);
      return `<tr${injNews ? ' class="has-news-inj"' : ''}><td>${slotBadge(slot)}</td><td>${playerCell(p, { emptyNote: slot === 'K' || slot === 'DEF' ? 'none on roster' : 'check waivers' })}</td><td class="c-mu">${matchupCell(p)}</td><td class="num">${projCell(p)}</td><td class="num c-rng">${rangeCell(p)}</td><td>${status}</td></tr>`;
    }).join('');
    const lineupCard = `
      <div class="card flush">
        <div class="card-title pad">Optimal Week ${week} lineup</div>
        <div class="tscroll"><table class="team-table"><thead><tr><th>Slot</th><th>Player</th><th class="c-mu">Matchup</th><th class="num">Proj</th><th class="num c-rng">Floor–Ceiling</th><th>Status</th></tr></thead><tbody>${lineupRows}</tbody></table></div>
      </div>`;

    const benchRows = A.bench.map(p => {
      const injNews = p && p.ml && ML.hasInjuryNews && ML.hasInjuryNews(p.ml.id);
      return `<tr${injNews ? ' class="has-news-inj"' : ''}><td>${playerCell(p)}</td><td class="c-mu">${matchupCell(p)}</td><td class="num">${projCell(p)}</td><td class="num c-rng">${rangeCell(p)}</td><td>${curKeys.has(p.key) ? '<span class="grade bad">Bench</span>' : p.note ? `<span class="sub">${ML.esc(p.note)}</span>` : ''}</td></tr>`;
    }).join('');
    const benchCard = `
      <div class="card flush">
        <div class="card-title pad">Bench</div>
        <div class="tscroll"><table class="team-table"><thead><tr><th>Player</th><th class="c-mu">Matchup</th><th class="num">Proj</th><th class="num c-rng">Floor–Ceiling</th><th>Note</th></tr></thead><tbody>${benchRows || `<tr class="empty-row"><td colspan="5">No bench players.</td></tr>`}</tbody></table></div>
      </div>`;

    const waiverCard = A.waivers ? `
      <div class="card flush">
        <div class="card-title pad">Waiver wire targets</div>
        ${A.waivers.length ? `<div class="tscroll"><table class="team-table"><thead><tr><th>Available player</th><th class="c-mu">Matchup</th><th class="num">Proj</th><th>Suggested drop</th></tr></thead><tbody>${A.waivers.map(w => `<tr><td>${playerCell(w.e)}${w.why ? `<div class="sub waiver-why">${ML.esc(w.why)}</div>` : ''}</td><td class="c-mu">${matchupCell(w.e)}</td><td class="num">${projCell(w.e)}</td><td class="drop-cell"><span class="grade good">+${ML.f1(w.gain)}</span> <span class="drop-why">${ML.esc(w.reason)}</span>${w.altReasons && w.altReasons.length ? `<div class="sub">${w.altReasons.map(r => ML.esc(r)).join('<br>')}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="sub pad">No available player is worth more than the most expendable player you can drop.</p>`}
      </div>` : '';

    const notes = [];
    if (L.unmodeled?.length) notes.push(`Not modeled from your league's scoring: ${L.unmodeled.slice(0, 6).map(ML.esc).join(', ')}${L.unmodeled.length > 6 ? '…' : ''}.`);
    if (L.unmatched?.length) notes.push(`Couldn't match: ${L.unmatched.map(ML.esc).join(', ')}. Check spelling, or they may not have enough 2026 usage to project.`);
    const np = A.roster.filter(p => p.status === 'np' && p.pos !== 'K' && p.pos !== 'DEF');
    if (np.length) notes.push(`No projection yet for ${np.map(p => ML.esc(p.name)).join(', ')} (limited 2026 usage).`);
    if (A.roster.some(p => p.locked)) notes.push('Players whose games have kicked off are locked in place.');

    return `
      <div class="team-head">
        <div>
          <div class="card-title" style="margin:0">${L.source === 'sleeper' ? 'Sleeper' : L.source === 'espn' ? 'ESPN' : 'Manual'} · ${ML.esc(L.name)}</div>
          <div class="sub">${ML.esc(scoreLbl)} · ${L.slots.map(s => ML.esc(SLOT_LABEL[s] || s)).join(', ')}</div>
        </div>
        <div class="team-actions">${teamSel}<button class="btn ghost" type="button" id="changeLeague">${T.showConnect ? 'Hide' : 'Change league'}</button></div>
      </div>
      ${kpis}
      ${movesCard}
      <div class="grid-team">${lineupCard}${benchCard}</div>
      ${waiverCard}
      ${notes.length ? `<div class="card"><div class="card-title">Notes</div><ul class="notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul></div>` : ''}`;
  }

  function render() {
    if (ML.loadWeather) ML.loadWeather(ML.state.week);
    const el = view(); if (!el || !ML) return;
    const L = T.league;
    let teamPicker = '';
    if (L && !T.teamId) {
      teamPicker = `<div class="card"><div class="card-title">Which team is yours?</div><div class="league-list">${L.teams.map(t => `<button type="button" class="league-pick team-pick" data-tid="${ML.esc(t.id)}"><b>${ML.esc(t.name)}</b><span>${t.players.length} players</span></button>`).join('')}</div></div>`;
    }
    el.innerHTML = `
      <div class="view-head"><div><h1 class="page-title">My Team · Week ${ML.state.week}</h1><p class="sub">${savedTeams().length ? 'Your teams are saved on this device and reopen automatically. Add another with Change league.' : "Link your league to get the optimal lineup from this week's projections and matchups. It's saved on this device for next time."}</p></div></div>
      ${savedStrip()}
      ${keepCard()}
      ${!L || T.showConnect ? connectCard() : ''}
      ${teamPicker}
      ${L && T.teamId ? renderResults() : ''}`;
    bind();
    if (ML.state.view === 'board' && ML.renderBoard) ML.renderBoard();
    if (ML.state.view === 'news' && ML.renderNews) ML.renderNews();
  }
  function rosterIds() {
    const L = T.league;
    if (!L || T.teamId == null) return [];
    const team = L.teams.find(t => String(t.id) === String(T.teamId));
    if (!team) return [];
    return team.players.map(p => p.ml && p.ml.id).filter(Boolean);
  }

  function bind() {
    const el = view();
    $$('.saved-open', el).forEach(b => b.addEventListener('click', () => { if (b.closest('.saved-chip').classList.contains('on')) return; openFromHash(b.dataset.hash); }));
    $$('.saved-x', el).forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.key; forgetTeam(k);
      if (k === currentKey()) { T.league = null; T.teamId = null; T.showConnect = false; try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } const nx = store.get(LAST_KEY, ''); if (nx) { openFromHash(nx); return; } }
      render();
    }));
    $$('#connTabs button', el).forEach(b => b.addEventListener('click', () => { T.mode = b.dataset.mode; T.error = null; render(); }));
    const sl = $('#slForm', el);
    if (sl) sl.addEventListener('submit', async e => {
      e.preventDefault(); const name = $('#slUser', el).value.trim(); if (!name) return;
      T.loading = true; T.error = null; T.sleeperLeagues = null; render();
      try { const { user, leagues } = await sleeperFindLeagues(name); T.sleeperUser = user; T.sleeperLeagues = leagues; if (leagues.length === 1) { await loadSleeper(leagues[0].league_id); return; } }
      catch (err) { T.error = err.message === 'HTTP 404' ? `No Sleeper user named "${name}".` : err.message.startsWith('No Sleeper user') ? err.message : `Couldn't reach Sleeper: ${err.message}`; }
      T.loading = false; render();
    });
    $$('.league-pick[data-lid]', el).forEach(b => b.addEventListener('click', () => loadSleeper(b.dataset.lid)));
    const es = $('#esForm', el);
    if (es) es.addEventListener('submit', async e => {
      e.preventDefault(); const raw = $('#esId', el).value.trim();
      const m = raw.match(/leagueId=(\d+)/i) || raw.match(/^(\d{3,12})$/);
      if (!m) { T.error = 'Enter a numeric league ID, or paste the league URL that contains leagueId=…'; render(); return; }
      await loadEspn(m[1]);
    });
    const mn = $('#mnForm', el);
    if (mn) mn.addEventListener('submit', e => {
      e.preventDefault(); T.manualText = $('#mnText', el).value; T.manualPreset = $('#mnPreset', el).value;
      const L = manualLeague(T.manualText, T.manualPreset);
      if (!L.teams[0].players.length) { T.error = 'None of those names matched a player with 2026 stats.'; render(); return; }
      T.league = L; T.teamId = 'me'; T.error = null; T.showConnect = false; setHash(); render();
    });
    $$('.team-pick', el).forEach(b => b.addEventListener('click', () => { T.teamId = b.dataset.tid; T.showConnect = false; setHash(); render(); }));
    const ts = $('#teamSel', el); if (ts) ts.addEventListener('change', () => { T.teamId = ts.value; setHash(); render(); });
    const cl = $('#changeLeague', el); if (cl) cl.addEventListener('click', () => { T.showConnect = !T.showConnect; render(); });
    $$('[data-ml]', el).forEach(n => n.addEventListener('click', () => ML.openPlayer(n.dataset.ml)));
    const open = $('#openSleeper', el);
    if (open) open.addEventListener('click', e => openSleeperTeam(e, open));
  }

  // Mobile tries the installed app on the team path, then the web team page.
  // Desktop follows the link, which is already the web team page.
  function openSleeperTeam(e, a) {
    const links = {
      web: a.getAttribute('href'),
      app: a.dataset.app,
      legacyApp: a.dataset.legacy,
      androidIntent: a.dataset.intent,
    };
    const plan = LUP.sleeperOpenPlan(links, navigator.userAgent || '');
    if (!plan || plan.kind === 'web') return;
    e.preventDefault();
    if (plan.kind === 'intent') { window.location.href = plan.url; return; }
    const start = Date.now();
    window.location.href = plan.url;
    setTimeout(() => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - start < 2000) window.location.href = plan.fallback;
    }, 900);
  }

  async function loadSleeper(lid, teamId) {
    T.loading = true; T.error = null; render();
    try {
      const L = await sleeperLoadLeague(lid, T.sleeperUser?.user_id);
      T.league = L; T.teamId = teamId && L.teams.some(t => t.id === teamId) ? teamId : L.defaultTeamId; T.showConnect = false; setHash();
    } catch (err) { T.error = `Couldn't load that Sleeper league: ${err.message}`; }
    T.loading = false; render();
  }
  async function loadEspn(lid, teamId) {
    T.loading = true; T.error = null; render();
    try {
      const L = await espnLoadLeague(lid);
      T.league = L; T.teamId = teamId && L.teams.some(t => t.id === teamId) ? teamId : (L.teams.length === 1 ? L.teams[0].id : null); T.showConnect = false; setHash();
    } catch (err) { T.error = err.message.startsWith('HTTP') || err.message.includes('fetch') ? `Couldn't reach ESPN: ${err.message}` : err.message; }
    T.loading = false; render();
  }

  // Reload league data when the week changes (matchups differ per week)
  let lastWeek = null;
  async function onRender() {
    if (T.league && lastWeek !== null && lastWeek !== ML.state.week && T.league.source !== 'manual') {
      lastWeek = ML.state.week;
      const tid = T.teamId;
      if (T.league.source === 'sleeper') await loadSleeper(T.league.id, tid); else await loadEspn(T.league.id, tid);
      return;
    }
    lastWeek = ML.state.week; render();
  }

  let opening = null;
  async function openFromHash(h) {
    if (opening === h) return true;
    opening = h;
    try { return await openFromHashInner(h); } finally { opening = null; }
  }
  async function openFromHashInner(h) {
    if (!h || h.length > 4000) return false;
    const m = h.match(/^team=(sleeper|espn|manual)\/(.*)$/);
    if (!m) return false;
    const parts = m[2].split('/');
    const okTeam = v => (/^\d{1,6}$/.test(v || '') ? v : null);
    if (m[1] === 'sleeper' && (!isId(parts[1]) || (parts[0] !== '_' && !/^[A-Za-z0-9_.-]{1,40}$/.test(parts[0] || '')))) return false;
    if (m[1] === 'espn' && !isId(parts[0])) return false;
    T.error = null;
    if (m[1] === 'sleeper') {
      T.mode = 'sleeper';
      try { if (parts[0] && parts[0] !== '_') { const r = await sleeperFindLeagues(parts[0]); T.sleeperUser = r.user; T.sleeperLeagues = r.leagues; } } catch (e) { /* ignore */ }
      await loadSleeper(parts[1], okTeam(parts[2]));
    } else if (m[1] === 'espn') {
      T.mode = 'espn'; await loadEspn(parts[0], okTeam(parts[1]));
    } else {
      T.mode = 'manual'; T.manualPreset = PRESETS[parts[0]] ? parts[0] : 'std'; T.manualText = (parts.slice(1).join('/') || '').split('|').slice(0, 60).map(s => s.slice(0, 80)).join('\n');
      const L = manualLeague(T.manualText, T.manualPreset);
      if (L.teams[0].players.length) { T.league = L; T.teamId = 'me'; T.showConnect = false; setHash(); }
      render();
    }
    return true;
  }

  async function init() {
    ML = window.ML; idx = buildIndex();
    let h = '';
    try { h = decodeURIComponent((location.hash || '').replace(/^#/, '')); } catch (e) { h = ''; }
    if (/^team=/.test(h)) { ML.setView('team'); if (await openFromHash(h)) return; }
    // No team in the link: reopen the last team saved on this device (loads quietly; board stays in front)
    const last = store.get(LAST_KEY, '');
    if (typeof last === 'string' && last) await openFromHash(last);
    else render();
  }

  window.MLTeam = { init, render: onRender, rosterIds, _analyze: (...a) => analyze(...a), _T: T };
})();
