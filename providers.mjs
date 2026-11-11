import { demo } from './model.mjs';

const requested = process.env.FEED_MODE ?? 'demo';
if (!['demo', 'licensed'].includes(requested)) throw new Error('FEED_MODE inválido');
const scenario = requested === 'demo' ? demo() : null;
let cached;
let pending;

async function get(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(6500) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const data = await response.json();
  if (Object.keys(data.errors ?? {}).length) throw new Error('Erro do fornecedor');
  return data.response ?? data;
}

function footballFixture(entry) {
  const { fixture, league, teams, goals } = entry;
  const labels = [teams.home.name, 'Empate', teams.away.name];
  return {
    id: 'af-' + fixture.id, sport: 'Futebol', teams: [labels[0], labels[2]], league: league.name,
    labels, phase: fixture.status.short === 'NS' ? 'Pré-jogo' : 'Ao vivo', date: fixture.date,
    source: 'API-Football', books: [], notes: [
      fixture.status.elapsed == null ? 'A aguardar início' : fixture.status.elapsed + ' min · ' + goals.home + '–' + goals.away
    ]
  };
}

async function footballFeed() {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('Credenciais em falta');
  const api = path => get('https://v3.football.api-sports.io/' + path, { 'x-apisports-key': key });
  const ids = (process.env.FOOTBALL_FIXTURE_IDS ?? '').split(',').map(v => v.trim()).filter(v => /^\d+$/.test(v)).slice(0, 8);
  const [live, scheduled] = await Promise.all([api('fixtures?live=all'), ids.length ? api('fixtures?ids=' + ids.join('-')) : []]);
  const rows = [...new Map([...live, ...scheduled].map(row => [row.fixture.id, row])).values()];
  const active = rows.filter(row => ['NS', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(row.fixture.status.short));
  return Promise.all(active.slice(0, 12).map(async row => {
    const match = footballFixture(row);
    const id = row.fixture.id;
    const isLive = match.phase === 'Ao vivo';
    const [odds, lineups, injuries] = await Promise.allSettled([
      api((isLive ? 'odds/live' : 'odds') + '?fixture=' + id),
      ids.includes(String(id)) ? api('fixtures/lineups?fixture=' + id) : [],
      ids.includes(String(id)) ? api('injuries?fixture=' + id) : []
    ]);
    if (odds.status === 'fulfilled' && !isLive) {
      for (const item of odds.value) for (const book of item.bookmakers ?? []) {
        const market = book.bets.find(bet => bet.id === 1);
        const values = ['Home', 'Draw', 'Away'].map(label => Number(market?.values.find(v => v.value === label)?.odd));
        if (values.every(v => Number.isFinite(v) && v > 1)) match.books.push({ name: book.name, odds: values, updated: item.update });
      }
    }
    if (odds.status === 'fulfilled' && isLive) {
      for (const item of odds.value) {
        if (item.status?.blocked || item.status?.stopped || item.status?.finished) continue;
        const market = item.odds?.find(value => value.name === 'Match Winner');
        const values = ['Home', 'Draw', 'Away'].map(label => Number(market?.values.find(v => v.value === label && !v.suspended && v.handicap == null)?.odd));
        if (values.every(v => Number.isFinite(v) && v > 1)) match.books.push({ name: 'Feed API-Football', odds: values, updated: item.update });
      }
    }
    for (const lineup of lineups.value ?? []) match.notes.push(lineup.team.name + ' · ' + lineup.formation + ' · ' + lineup.startXI.map(entry => entry.player.name).join(', '));
    for (const injury of injuries.value ?? []) match.notes.push(injury.player.name + ' · ' + injury.player.reason);
    return match;
  }));
}

async function esportsFeed(path, sport) {
  const key = process.env.PANDASCORE_TOKEN;
  if (!key) throw new Error('Credenciais em falta');
  const api = type => get('https://api.pandascore.co/' + path + '/matches/' + type + '?per_page=10', { Authorization: 'Bearer ' + key });
  const lists = await Promise.all([api('running'), api('upcoming')]);
  return lists.flatMap((rows, index) => rows.filter(row => row.opponents.length === 2 && row.begin_at).map(row => {
    const teams = row.opponents.map(entry => entry.opponent.name);
    return {
      id: path + '-' + row.id, sport, teams, labels: teams, league: row.league.name,
      phase: index ? 'Pré-jogo' : 'Ao vivo', date: row.begin_at,
      updated: row.modified_at, source: 'PandaScore', books: [],
      notes: ['BO' + row.number_of_games, ...(index ? [] : row.results.map(result =>
        (row.opponents.find(entry => entry.opponent.id === result.team_id)?.opponent.name ?? 'Equipa') + ' · ' + result.score + ' mapa(s)'))]
    };
  }));
}

export async function feed() {
  if (requested === 'demo') return { mode: 'demo', matches: scenario, errors: [] };
  if (cached && Date.now() < cached.expires) return cached.data;
  pending ??= Promise.allSettled([footballFeed(), esportsFeed('csgo', 'CS2'), esportsFeed('valorant', 'VALORANT')])
    .then(results => {
      const data = {
        mode: 'licensed', matches: results.flatMap(result => result.value ?? []),
        retrieved: new Date().toISOString(),
        errors: results.flatMap((result, index) => result.status === 'rejected' ? [['Futebol', 'CS2', 'VALORANT'][index] + ': ' + result.reason.message] : [])
      };
      cached = { data, expires: Date.now() + 60000 };
      return data;
    }).finally(() => { pending = undefined; });
  return pending;
}

