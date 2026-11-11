export const sports = ['Futebol', 'CS2', 'VALORANT'];
export const methods = {
  Futebol: 'Poisson independente para golos restantes. O cenário considera força ofensiva e defensiva, onze, ausências, minuto e marcador.',
  CS2: 'Probabilidade de vencer a série a partir da força por mapa, veto, lado inicial, quinteto e mapas já ganhos.',
  VALORANT: 'Probabilidade de vencer a série por mapa, com composição, patch, estabilidade do plantel e mapas já ganhos.'
};
export function football(home, away, a = 0, b = 0) {
  const poisson = (rate) => {
    const mass = [Math.exp(-rate)];
    for (let k = 1; k <= 20; k++) mass.push(mass[k - 1] * rate / k);
    return mass;
  };
  const result = [0, 0, 0];
  poisson(home).forEach((x, i) => poisson(away).forEach((y, j) => {
    result[i + a > j + b ? 0 : i + a === j + b ? 1 : 2] += x * y;
  }));
  const total = result.reduce((sum, p) => sum + p, 0);
  return result.map(p => p / total);
}
export function series(maps, a = 0, b = 0) {
  function win(i, home, away) {
    if (home === 2) return 1;
    if (away === 2) return 0;
    return maps[i] * win(i + 1, home + 1, away) + (1 - maps[i]) * win(i + 1, home, away + 1);
  }
  const p = win(0, a, b);
  return [p, 1 - p];
}
export function margin(odds) {
  return odds.reduce((sum, odd) => sum + 1 / odd, -1);
}
export function opportunities(matches, minimum = 0) {
  return matches.flatMap(match => (match.p ?? []).flatMap((p, index) => {
    const books = match.books.filter(book => book.odds.length === match.p.length && book.odds.every(o => o > 1));
    const best = books.sort((a, b) => b.odds[index] - a.odds[index])[0];
    if (!best) return [];
    const odd = best.odds[index];
    const ev = p * odd - 1;
    return ev > 0 && ev >= minimum ? [{ id: match.id, sport: match.sport, phase: match.phase, selection: match.labels[index], match: match.teams.join(' × '), p, odd, ev, book: best.name, margin: margin(best.odds), low: Math.max(0, p - match.delta) * odd - 1 }] : [];
  })).sort((a, b) => b.ev - a.ev);
}
export function payout(bet) {
  if (bet.state === 'Ganha') return Math.round(bet.cents * bet.odd) - bet.cents;
  if (bet.state === 'Perdida') return -bet.cents;
  return 0;
}
export function performance(bets) {
  const settled = bets.filter(b => ['Ganha', 'Perdida'].includes(b.state));
  const staked = settled.reduce((sum, b) => sum + b.cents, 0);
  const profit = settled.reduce((sum, b) => sum + payout(b), 0);
  return { staked, profit, count: settled.length, yield: staked ? profit / staked : null };
}
export function demo(now = Date.now()) {
  const rows = [
    ['Futebol', ['Atlético do Tejo', 'União da Serra'], 'Liga Atlântica', false, football(1.75, 0.85), ['xG de referência: 1,75 / 0,85', 'Onze provável; lateral visitante indisponível', 'Sem suspensões no cenário'], [[2.08, 3.45, 3.70], [2.00, 3.60, 3.85]]],
    ['CS2', ['Orbit Five', 'Iron Foxes'], 'Circuito Nexus', true, series([0.58, 0.52], 1, 0), ['1–0 em mapas; início do segundo mapa', 'Veto: Mirage → Nuke → Inferno', 'Quintetos estáveis; pressão na defesa em Nuke'], [[1.34, 3.40], [1.40, 3.15]]],
    ['VALORANT', ['Prism Core', 'Pulse Protocol'], 'Série Horizon', false, series([0.63, 0.52, 0.54]), ['Mapas prováveis: Haven, Ascent, Lotus', 'Patch e composição incluídos no cenário', 'Prism manteve o mesmo plantel'], [[1.91, 1.92], [1.98, 1.87]]],
    ['Futebol', ['Estrela do Norte', 'Marítimo do Sul'], 'Liga Atlântica', true, football(0.62, 0.32, 1, 0), ['61 min · 1–0', 'Golos esperados restantes: 0,62 / 0,32', 'Sem expulsões no cenário'], [[1.30, 4.60, 11], [1.34, 4.20, 10]]],
    ['CS2', ['Zero Point', 'Vector Six'], 'Circuito Nexus', false, series([0.57, 0.48, 0.59]), ['BO3 · veto por confirmar', 'Anubis, Nuke e Ancient no cenário', 'Vector estreou um novo jogador'], [[2.01, 1.83], [1.96, 1.89]]],
    ['VALORANT', ['Flux Gaming', 'Night Shift'], 'Série Horizon', true, series([0.57], 1, 1), ['1–1 em mapas · início de Lotus', 'Flux inicia na defesa', 'Composição de agentes confirmada no cenário'], [[1.90, 1.95], [1.86, 2.02]]]
  ];
  return rows.map(([sport, teams, league, live, p, notes, prices], i) => ({
    id: 'demo-' + (i + 1), sport, teams, league, phase: live ? 'Ao vivo' : 'Pré-jogo',
    date: new Date(now + (live ? -1 : i + 2) * 3600000).toISOString(), updated: new Date(now).toISOString(),
    p, notes, delta: sport === 'Futebol' ? 0.06 : 0.08, demo: true, source: 'Cenário fictício',
    labels: sport === 'Futebol' ? [teams[0], 'Empate', teams[1]] : teams,
    books: prices.map((odds, n) => ({ name: ['Casa Alfa', 'Casa Beta'][n], odds }))
  }));
}
