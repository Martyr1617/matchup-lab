/* Sum the weekly model into trade values and write them onto site/data.json.
   Run from refresh.sh after the projection file exists. A failure must not
   be required for projections to publish: refresh.sh treats a non-zero exit
   as a warning. */
'use strict';
const fs = require('fs');
const path = require('path');
const { project, SCORING } = require('./site/model');
const { attachTrade, backtest, ageFromBirth } = require('./site/trade');

function loadAges(season) {
  const file = path.join(__dirname, 'data', 'sleeper_players.json');
  const ages = {};
  if (!fs.existsSync(file)) return ages;
  let sl;
  try { sl = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return ages; }
  for (const [sid, sp] of Object.entries(sl)) {
    if (!sp) continue;
    const age = ageFromBirth(sp.birth_date, season);
    if (!age) continue;
    ages[sid] = age;
    if (typeof sp.gsis_id === 'string' && sp.gsis_id) ages[sp.gsis_id] = age;
  }
  return ages;
}

function main() {
  const arg = process.argv.find(a => a.endsWith('.json'));
  const file = arg || path.join(__dirname, 'site', 'data.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ages = loadAges(data.meta && data.meta.season);
  const t0 = Date.now();
  attachTrade(data, { project, scoring: SCORING, ages });
  if (process.argv.includes('--backtest')) {
    const result = backtest(data, project, SCORING);
    data.meta.trade.backtest = { spearman: result.spearman == null ? null : Math.round(result.spearman * 1000) / 1000, n: result.n };
    console.log('backtest', JSON.stringify(data.meta.trade.backtest));
  }
  fs.writeFileSync(file, JSON.stringify(data));
  const ranked = data.players.filter(p => p.tv).sort((a, b) => b.tv.v.ppr.qb1[0] - a.tv.v.ppr.qb1[0]);
  console.log('trade', ranked.length, 'players', Date.now() - t0, 'ms', 'ages', Object.keys(ages).length);
  console.log(ranked.slice(0, 8).map(p => p.name + ' ' + p.tv.v.ppr.qb1[0] + '/' + p.tv.v.ppr.sflex[0] + ' dyn ' + p.tv.v.ppr.qb1[1]).join('\n'));
}

if (require.main === module) main();
