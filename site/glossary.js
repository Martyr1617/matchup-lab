/* Matchup Lab glossary: tap/click any metric label to see what it means. */
(() => {
  'use strict';
  // [title, matcher for the label text (anchored), explanation]
  const G = [
    // Vegas & market
    ['Key prop', /^key prop$/i, 'The most important posted player prop for this player\'s position (pass yards for QBs, rush yards for RBs, receiving yards for WR/TE), shown next to the model\'s own number for that stat.'],
    ['Prop line', /\bprop$/i, 'A sportsbook player prop line (DraftKings): the over/under number for that stat. Treated as the market\'s expectation and blended 50/50 with the model. "No line" means the book hasn\'t posted it yet.'],
    ['ITT · Implied team total', /^(itt\b|implied team total)/i, 'How many points the betting market expects this team to score. It equals half the game total minus half the team\'s spread. A higher number means more scoring chances, so more touchdown upside for the team\'s players.'],
    ['Spread', /^spread$/i, 'The sportsbook point spread for this team. Negative means favored by that many points; positive means underdog. Big favorites tend to run more late in games, while underdogs tend to throw more to catch up.'],
    ['Spread · total', /^spread · total$/i, 'The team\'s point spread (negative = favored) and the game\'s over/under total (combined points both teams are expected to score).'],
    ['Game total (O/U)', /^(game total|o\/u)/i, 'The over/under: combined points the market expects both teams to score. High totals (48+) signal a shootout with more plays and touchdowns; low totals (40 or less) mean fewer scoring chances.'],
    ['Vegas effect', /^vegas effect$/i, 'How much the betting environment moved this projection. It compares the implied team total with the model\'s own team-points estimate, then applies the difference to touchdowns (strongly) and yardage (lightly).'],
    ['Model − market', /^model − mkt$/i, 'The model\'s number minus the market-implied number for that stat. Large gaps (15%+, marked "!") mean the model and the sportsbook disagree. Worth a second look.'],
    ['Market-implied points', /^(market-implied pts|mkt\b)/i, 'Fantasy points you\'d get by plugging the posted prop lines into the scoring system in place of the model\'s numbers. It\'s what the betting market implies this player will score.'],
    ['Anytime TD', /^anytime td/i, 'The chance the player scores at least one touchdown. The market version comes from sportsbook odds (when available); the model version comes from projected rushing and receiving TDs.'],
    ['Matchup · Vegas', /^matchup · vegas$/i, 'Opponent, kickoff time, a matchup grade (how many fantasy points that defense allows to the position), the betting line (implied team total, spread, over/under) and the weather.'],
    // Opportunity
    ['Opportunity', /^opportunity$/i, 'How much of the team\'s work this player gets: shares of targets, carries and red-zone chances. Opportunity is the most stable predictor of fantasy points from week to week.'],
    ['WOPR · Weighted opportunity rating', /^wopr/i, 'Weighted Opportunity Rating = 1.5 × target share + 0.7 × air-yards share. It blends how often a player is targeted with how far downfield, and is one of the best single predictors of WR/TE fantasy output. Around 0.5+ is elite; 0.3–0.5 is a solid starter.'],
    ['Target share', /^(tgt share|target share)/i, 'The percentage of the team\'s pass targets that went to this player. 25%+ is a true No. 1 option.'],
    ['Air-yards share', /^air-(yards|yds) share/i, 'The percentage of the team\'s total air yards (how far passes travel past the line of scrimmage) thrown to this player. A high share means valuable downfield looks.'],
    ['TPRR · Targets per route run', /^tprr/i, 'Targets per route run: how often a player draws a target when he runs a route. 25%+ is excellent. Shown as an estimate (est.) because route data isn\'t public, so routes are estimated as team dropbacks × snap share.'],
    ['YPRR · Yards per route run', /^yprr/i, 'Yards per route run: receiving yards divided by routes run. It measures efficiency and volume together; 2.0+ is excellent. Estimated (est.) because routes are approximated from team dropbacks × snap share.'],
    ['Snap share', /^snap share/i, 'The percentage of the team\'s offensive plays this player was on the field for. Used here as a stand-in for route participation, which isn\'t public.'],
    ['Route participation', /^route participation/i, 'The share of team pass plays on which a player runs a route. It needs player-tracking data that isn\'t publicly released, so snap share is shown instead.'],
    ['RZ20 · Red-zone share', /^(rz20|rz share|red-zone share|red-zone rush share)/i, 'The player\'s share of the team\'s red-zone opportunities (targets + carries inside the opponent\'s 20-yard line). Red-zone work drives touchdowns.'],
    ['Inside-10 share', /^inside-10 share/i, 'The player\'s share of the team\'s targets + carries inside the opponent\'s 10-yard line, where touchdown odds are highest.'],
    ['Red-zone snap share', /^red-zone snap share/i, 'How often an RB is on the field in the red zone. It requires play-participation data that isn\'t public for this season, so it\'s marked unavailable.'],
    ['Opportunity share', /^(opp share|opportunity share)/i, 'For running backs: carries + targets as a share of the team\'s total carries + targets. It captures the RB\'s whole workload, rushing and receiving.'],
    ['Dropbacks per game', /^dropbacks/i, 'Average team pass plays per game (passes, sacks and scrambles). More dropbacks means more passing volume for the QB and receivers.'],
    ['Designed runs', /^(dsgn runs|designed runs)/i, 'Planned QB runs per game (option keepers, sneaks, draws), counted separately from scrambles. Designed runs are a repeatable part of the game plan, so they\'re more predictable than scrambles.'],
    ['Designed run rate', /^designed run rate/i, 'Designed QB runs as a share of all his plays (dropbacks + designed runs). It measures how much the offense uses the QB as a runner on purpose.'],
    ['Scrambles', /^(scrm|scrambles)/i, 'QB runs on plays that were designed as passes. They\'re less predictable than designed runs.'],
    // Efficiency
    ['EPA · Expected points added', /^(epa|rush epa)/i, 'Expected Points Added: how much each play changed the team\'s expected points, based on down, distance and field position. Above 0 is good; +0.15 per dropback is very good for a QB. Shown per dropback (QB), per carry (RB) or per target (WR/TE).'],
    ['CPOE · Completion % over expected', /^cpoe/i, 'Completion Percentage Over Expected: how much more often a QB completes passes than expected, given throw depth, coverage and pressure. Positive means accurate; +3 or more is excellent.'],
    ['RYOE · Rush yards over expected', /^ryoe/i, 'Rush Yards Over Expected per attempt (NFL Next Gen Stats): yards gained beyond what a typical back would get, given blocking and defender positions. Positive means the back is creating extra yards.'],
    ['Missed tackles forced', /^missed tackles forced/i, 'Broken tackles per touch (Pro Football Reference), used as the missed-tackles-forced measure. It shows a player\'s ability to make defenders miss and create yards after contact.'],
    ['8+ in the box', /^8\+ in box/i, 'The percentage of carries where the defense had 8 or more players near the line (NFL Next Gen Stats). Heavy boxes make running harder.'],
    ['Separation', /^separation/i, 'Average distance (yards) between the receiver and the nearest defender when the pass arrives (NFL Next Gen Stats). More separation means easier catches.'],
    ['YAC over expected', /^yac over/i, 'Yards after catch beyond what\'s expected, given where and how the ball was caught (NFL Next Gen Stats). Positive means the player creates extra yards after the catch.'],
    ['xFP · Expected fantasy points', /^xfp/i, 'Expected Fantasy Points (PPR) per game: what a player\'s targets and carries are worth on average, based on down, distance, field position and depth of target (from ffopportunity). It measures the quality of the opportunity, not the result.'],
    ['FPOE · Fantasy points over expected', /^fpoe/i, 'Fantasy Points Over Expected per game: actual points minus expected points (xFP). Big positive numbers often cool off (fade risk); big negatives with strong usage tend to bounce back (positive regression).'],
    // Context
    ['Neutral pass rate', /^neutral pass rate/i, 'How often the team passes when the game is close and not late in a half: win probability 20–80%, downs 1–3, and outside the final two minutes of each half. It shows true play-calling tendency. PROE (pass rate over expected) is how much more the team passes than expected in those situations.'],
    ['Pace', /^pace/i, 'Seconds per play in neutral situations. Lower means faster, which means more plays and more fantasy opportunities for both teams.'],
    ['Pressure allowed', /^pressure allowed/i, 'How often this offense\'s QBs are pressured (hurried, hit or sacked) per dropback (Pro Football Reference). Lower is better.'],
    ['Opponent pressure rate', /^opp pressure rate/i, 'How often the opposing defense pressures QBs per dropback. A strong pass rush can lower passing efficiency and raise sack and turnover risk.'],
    ['Time to throw', /^time to throw/i, 'Average seconds from snap to throw (NFL Next Gen Stats). Quick throwers are less affected by pressure; longer times mean more deep shots but more sacks.'],
    ['Pressured rate', /^pressured rate/i, 'How often this QB was pressured on his dropbacks.'],
    // Distribution
    ['Proj · Projection', /^(proj|projection)$/i, 'Expected fantasy points this week in your scoring format. It\'s the average of the player\'s projected outcome range, after the Vegas, prop, opportunity, matchup and weather adjustments.'],
    ['Floor–Ceiling', /^floor(\s*[–-]\s*ceiling|\s*\/\s*median\s*\/\s*ceiling)?$|^ceiling$/i, 'The floor is a bad-week score the player finishes below about 10% of the time. The ceiling is a great-week score they top about 10% of the time, so roughly 80% of weeks land between them. Where a third number is shown, it is the median. A wider gap means a more volatile week.'],
    ['Percentile', /^p(25|50|75)$/i, 'A point on the projected outcome range. P25 means a 25% chance of scoring less than this number, P50 is the median, and P75 means a 25% chance of scoring more.'],
    ['Boom / Bust', /^boom/i, 'Boom = chance of a big week; bust = chance of a dud. PPR thresholds: QB boom 25+, bust under 12; RB and WR boom 20+, bust under 8; TE boom 15+, bust under 5. Thresholds for non-QBs drop 10% in Half-PPR and 20% in Standard.'],
    ['Bust', /^bust$/i, 'Chance of a dud week, below the position\'s bust threshold (PPR: QB under 12, RB and WR under 8, TE under 5).'],
    ['Flags', /^flags$/i, 'Alerts: "Regression: up" = strong usage but soft results (likely to improve); "Fade" = production running well ahead of usage (likely to cool off); "Market higher/lower" = sportsbook props imply notably more or fewer points than the model.'],
    ['Positive regression', /^(regression: up|positive regression)/i, 'The player\'s usage (xFP) says he should be scoring more than he has. Results usually catch up to opportunity, so he\'s a buy-low or start candidate.'],
    ['Fade', /^fade/i, 'The player is scoring well above what his usage supports (high FPOE), usually from long TDs or unusual efficiency. Expect him to cool off.'],
    ['Market higher / lower', /^market (higher|lower)/i, 'The sportsbook prop lines imply at least 15% (and 2+ points) more or fewer fantasy points than the model. It\'s a sign to double-check news, role changes or injuries.'],
    // Box score
    ['Pass attempts per game', /^pass att/i, 'Average pass attempts per game, recency-weighted (recent games count more).'],
    ['Pass yards per game', /^pass yds/i, 'Average passing yards per game, recency-weighted. In the defense table: passing yards allowed per game.'],
    ['Comp % · Completion percentage', /^comp(letion)? %/i, 'Completed passes divided by attempts.'],
    ['Y/A · Yards per attempt', /^(yds \/ att|y\/a)/i, 'Passing yards per pass attempt. In the defense table: yards per attempt allowed (lower is a tougher pass defense).'],
    ['TD rate', /^td rate/i, 'Passing touchdowns per pass attempt.'],
    ['INT rate', /^int rate/i, 'Interceptions per pass attempt.'],
    ['Rush attempts per game', /^(rush att|carries \/ g)/i, 'Average carries per game, recency-weighted.'],
    ['YPC · Yards per carry', /^(yds \/ carry|ypc)/i, 'Rushing yards per carry. In the defense table: yards per carry allowed.'],
    ['Rush yards per game', /^rush yds/i, 'Average rushing yards per game. In the defense table: rushing yards allowed per game.'],
    ['aDOT · Average depth of target', /^adot/i, 'Average Depth of Target: how far past the line of scrimmage the player\'s targets travel in the air. Higher means a downfield role (big plays); lower means short, high-catch-rate targets.'],
    ['Catch rate', /^catch rate/i, 'Receptions divided by targets.'],
    ['Yards per target', /^yds \/ target/i, 'Receiving yards per target. It measures efficiency per look.'],
    ['YAC per reception', /^yac \/ rec/i, 'Yards after the catch per reception.'],
    ['Touches per game', /^touches/i, 'Carries + receptions per game.'],
    ['Targets per game', /^targets \/ g/i, 'Average pass targets per game, recency-weighted.'],
    ['Receptions per game', /^rec \/ g/i, 'Average catches per game, recency-weighted.'],
    ['Receiving yards per game', /^rec yds/i, 'Average receiving yards per game, recency-weighted.'],
    ['10+ yard runs', /^10\+ yd runs/i, 'Carries that gained 10 or more yards. It shows big-play ability.'],
    ['20+ yard catches', /^20\+ yd catches/i, 'Receptions that gained 20 or more yards.'],
    ['Sacks per game', /^sacks/i, 'Sacks taken per game. In the defense table: sacks generated per game (higher is a better pass rush).'],
    ['Fumbles lost', /^fumbles lost/i, 'Fumbles recovered by the defense. Each costs 2 fantasy points.'],
    // Defense table
    ['Receiving yards allowed', /^(rb|wr|te) rec yds allowed/i, 'Receiving yards this defense allows per game to that position.'],
    ['Targets faced', /^(rb|wr|te) (targets faced|receptions allowed)/i, 'Targets (or catches) this defense allows per game to that position. More means more volume for players at that position.'],
    ['Points allowed per game', /^(pts\/g|points allowed)/i, 'Points the defense allows per game.'],
    ['Fantasy points allowed', /^(vs (qb|rb|wr|te)|fantasy pts to)/i, 'PPR fantasy points this defense allows per game to that position. Higher means an easier matchup.'],
    ['Pass TD allowed per game', /^pass td/i, 'Passing touchdowns allowed per game.'],
    ['Rush TD allowed per game', /^rush td/i, 'Rushing touchdowns allowed per game.'],
    ['Interceptions per game', /^(int\/g|interceptions)/i, 'Interceptions the defense makes per game.'],
  ];
  const find = text => { const t = text.replace(/\s+/g, ' ').trim(); if (!t || t.length > 40) return null; return G.find(g => g[1].test(t)) || null; };
  const SEL = '.def-item > span:first-child, .metric .k, .cmp-table td:first-child, .chip, .kp-l, .pct .k, .comp-table.props th, .flagc, .bb-row .k, [data-gl]';
  const HEAD_SEL = '.board thead th, .deftable thead th';

  function annotate(root) {
    root.querySelectorAll(SEL).forEach(el => {
      if (el.dataset.term) return;
      const g = find(el.dataset.gl || el.childNodes[0]?.textContent || el.textContent);
      if (!g) return;
      el.dataset.term = g[0]; el.classList.add('term'); el.tabIndex = 0; el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${el.textContent.trim()}: what this means`);
    });
    root.querySelectorAll(HEAD_SEL).forEach(th => {
      if (th.querySelector('.term-i')) return;
      const g = find(th.textContent.replace(/[▾▴]/g, ''));
      if (!g) return;
      const b = document.createElement('span');
      b.className = 'term-i'; b.dataset.term = g[0]; b.tabIndex = 0; b.setAttribute('role', 'button'); b.setAttribute('aria-label', `What is ${g[0]}?`); b.textContent = 'i';
      th.appendChild(b);
    });
  }

  let pop = null, anchor = null;
  function close() { if (pop) { pop.remove(); pop = null; } if (anchor) { anchor.setAttribute('aria-expanded', 'false'); anchor = null; } }
  function open(el) {
    const g = G.find(x => x[0] === el.dataset.term); if (!g) return;
    if (anchor === el) { close(); return; }
    close();
    pop = document.createElement('div');
    pop.className = 'gloss'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', g[0]);
    const h = document.createElement('div'); h.className = 'gloss-t'; h.textContent = g[0];
    const p = document.createElement('p'); p.textContent = g[2];
    const x = document.createElement('button'); x.type = 'button'; x.className = 'gloss-x'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
    x.addEventListener('click', e => { e.stopPropagation(); close(); });
    pop.append(x, h, p);
    document.body.appendChild(pop);
    anchor = el; el.setAttribute('aria-expanded', 'true');
    const r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), vw - pw - 8);
    let top = r.bottom + 8; if (top + ph > vh - 8) top = Math.max(8, r.top - ph - 8);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  // Capture phase so a tap on a term inside a clickable row/header doesn't also open the player or re-sort
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[data-term]');
    if (t) { e.preventDefault(); e.stopPropagation(); open(t); return; }
    if (pop && !pop.contains(e.target)) close();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    const t = e.target.closest && e.target.closest('[data-term]');
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); open(t); }
  }, true);
  window.addEventListener('resize', close);
  document.addEventListener('scroll', close, true);

  function glossaryPage() {
    const host = document.getElementById('glossaryList'); if (!host || host.dataset.done) return;
    host.dataset.done = '1';
    host.innerHTML = '';
    G.forEach(([t, , d]) => { const dt = document.createElement('dt'); dt.textContent = t; const dd = document.createElement('dd'); dd.textContent = d; host.append(dt, dd); });
  }
  function start() {
    const main = document.getElementById('main'); if (!main) return;
    let q = false;
    const run = () => { q = false; annotate(main); };
    new MutationObserver(() => { if (!q) { q = true; requestAnimationFrame(run); } }).observe(main, { childList: true, subtree: true });
    run(); glossaryPage();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.MLGloss = { find, G };
})();
