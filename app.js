const sports = ['Futebol', 'CS2', 'VALORANT'];
const phases = ['Pré-jogo', 'Ao vivo'];
const states = ['Pendente', 'Ganha', 'Perdida', 'Anulada'];
const descriptions = {
  Futebol: 'Golos esperados e distribuição de Poisson. No cenário ao vivo, a estimativa usa o marcador e os golos esperados até ao fim.',
  CS2: 'Probabilidades por mapa combinadas numa série BO3. O cenário usa veto, quintetos, lado inicial e mapas ganhos.',
  VALORANT: 'Probabilidades por mapa numa série BO3. O cenário considera patch, composição, estabilidade do plantel e marcador da série.'
};
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const currency = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const number = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('pt-PT', { style: 'percent', maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Lisbon' });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateTime = value => value && Number.isFinite(Date.parse(value)) ? clock.format(new Date(value)) : 'Sem timestamp da fonte';
const pct = value => value == null ? '—' : percent.format(value);
const money = cents => currency.format(cents / 100);
const stakeText = bet => bet.currency === 'COINS' ? number.format(bet.cents / 100) + ' moedas' : money(bet.cents);
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Lisbon' }).format();
const empty = message => '<p class="empty">' + esc(message) + '</p>';
const flag = (label, css = '') => '<span class="chip ' + css + '">' + esc(label) + '</span>';
const btn = (action, label, value = '', css = '') => '<button type="button" class="' + css + '" data-action="' + action + '" data-value="' + esc(value) + '">' + esc(label) + '</button>';
const option = (value, current, label = value) => '<option value="' + esc(value) + '"' + (value === current ? ' selected' : '') + '>' + esc(label) + '</option>';
const select = (name, all, values, current) => '<select aria-label="' + esc(all) + '" data-filter="' + name + '">' + option('', current, all) + values.map(v => option(v, current)).join('') + '</select>';
const formSelect = (name, values, selected) => '<select name="' + name + '">' + values.map(v => option(v, selected, v || 'Sem tipster')).join('') + '</select>';
const metric = (label, value, note = '') => '<div class="metric"><small>' + esc(label) + '</small><strong>' + esc(value) + '</strong>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</div>';
const table = (headers, rows) => '<div class="table"><table><thead><tr>' + headers.map(h => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
const cells = (...items) => '<tr>' + items.map(item => '<td>' + item + '</td>').join('') + '</tr>';
let me, feed, bets = [], group = [], page = 'Painel', filters = {}, message = '', editing = null, busy = false, feedError = '';
const links = ['Painel', ...sports, 'Oportunidades', 'Histórico', 'Tipsters', 'Grupo', 'Definições'];

async function api(path, method = 'GET', data) {
  const response = await fetch('/api/' + path, {
    method, ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}
async function refresh() {
  try {
    feed = await api('feed');
    feedError = '';
  } catch (error) {
    if (error.status === 401) throw error;
    feedError = 'Falha ao atualizar a fonte. Recarrega para tentar novamente.';
    feed = null;
  }
}
function login(error = '') {
  me = null; feed = null; bets = []; group = []; editing = null; page = 'Painel'; filters = {}; message = '';
  if (dialog.open) dialog.close();
  dialog.replaceChildren();
  app.innerHTML = '<main class="login"><div class="brand"><span class="logo">↗</span>Pro Tipster</div><h1>Sala privada</h1><p class="muted">Futebol, CS2 e VALORANT</p><form id="login" class="panel"><label>Utilizador<input name="name" autocomplete="username" required maxlength="40"></label><label>Palavra-passe<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label><button class="primary">Iniciar sessão</button><div class="error" role="alert">' + esc(error) + '</div></form></main>';
}
async function enter() {
  me = await api('me');
  [bets] = await Promise.all([api('bets'), refresh()]);
  render();
}
function ledger(items, currencyCode = 'EUR') {
  const sameCurrency = items.filter(b => (b.currency || 'EUR') === currencyCode);
  const settled = sameCurrency.filter(b => ['Ganha', 'Perdida'].includes(b.state));
  const stake = settled.reduce((s, b) => s + b.cents, 0);
  const total = sameCurrency.reduce((s, b) => s + b.cents, 0);
  const profit = settled.reduce((s, b) => s + (b.state === 'Ganha' ? Math.round(b.cents * b.odd) - b.cents : -b.cents), 0);
  return { profit, stake, total, yield: stake ? profit / stake : null, roi: total ? profit / total : null };
}
function metrics(items) {
  return ['EUR', 'COINS'].filter(code => items.some(b => (b.currency || 'EUR') === code)).map(code => {
    const result = ledger(items, code);
    const display = amount => code === 'COINS' ? number.format(amount / 100) + ' moedas' : money(amount);
    return '<small>Valores em ' + (code === 'COINS' ? 'moedas CSGOEmpire' : 'euros') + '</small><div class="grid">' + metric('Resultado líquido', display(result.profit), 'Apostas liquidadas') + metric('Yield', pct(result.yield), 'Resultado / stake liquidada') + metric('ROI do registo', pct(result.roi), 'Resultado / stake registada') + '</div>';
  }).join('') || '<p class="muted">Sem apostas registadas.</p>';
}
function header(title, copy) {
  return '<section class="hero"><small>PRO TIPSTER / SALA PRIVADA</small><h1>' + esc(title) + '</h1><p class="muted">' + esc(copy) + '</p></section>';
}
function matchCards(matches) {
  if (!matches.length) return empty('Sem jogos para estes filtros.');
  return '<div class="grid">' + matches.map(m => '<article class="match"><div class="bar">' + flag(m.sport, 'neutral') + flag(m.demo && m.phase === 'Ao vivo' ? 'Ao vivo · simulado' : m.phase, m.phase === 'Ao vivo' ? 'live' : '') + '</div><small>' + esc(m.league) + '</small><h3>' + esc(m.teams.join(' × ')) + '</h3><small>' + esc(dateTime(m.date)) + ' · ' + esc(m.source) + '</small>' + btn('match', 'Ver análise →', m.id, 'quiet') + '</article>').join('') + '</div>';
}
function filteredOpp(list) {
  return list.filter(o => (!filters.sport || filters.sport === o.sport) && (!filters.phase || filters.phase === o.phase) && o.ev * 100 >= Number(filters.min ?? 0));
}
function oppTable(list) {
  if (!list.length) return empty(feed?.mode === 'licensed' ? 'Ainda não há um modelo validado ligado às fontes licenciadas.' : 'Sem oportunidades para estes filtros.');
  return table(['Seleção', 'Odd', 'Probabilidade', 'EV', 'EV no cenário baixo', 'Margem'], list.map(o => cells(
    btn('match', o.selection, o.id, 'link') + '<small>' + esc(o.match) + ' · ' + esc(o.sport) + '</small>',
    number.format(o.odd) + '<small>' + esc(o.book) + '</small>', pct(o.p),
    '<strong class="positive">' + pct(o.ev) + '</strong>', pct(o.low), pct(o.margin)
  )));
}
function opportunityAlerts() {
  if (!me.prefs.alerts) return '';
  const found = (feed?.opportunities ?? []).filter(o => me.prefs.sports.includes(o.sport) && o.ev * 100 >= me.prefs.threshold);
  if (!found.length) return '';
  return '<section class="section"><h2>Alertas' + (feed.mode === 'demo' ? ' de demonstração' : '') + '</h2>' +
    found.map(o => '<div class="message alert">' + btn('match', o.sport + ' · ' + o.selection + ' · EV ' + pct(o.ev), o.id, 'link') + '</div>').join('') + '</section>';
}
function games() {
  const matches = feed?.matches ?? [];
  if (page === 'Painel') {
    return header('Painel de análise', 'Acompanha jogos, compara odds e consulta o desempenho do teu registo.') +
      '<div class="grid">' + metric('Jogos em análise', matches.length) + metric(feed?.mode === 'demo' ? 'Ao vivo · simulado' : 'Ao vivo', matches.filter(m => m.phase === 'Ao vivo').length) + metric('Oportunidades com EV positivo', feed?.opportunities.length ?? 0) + '</div>' +
      opportunityAlerts() + '<section class="section"><div class="bar"><h2>Oportunidades em destaque</h2>' + btn('nav', 'Ver oportunidades', 'Oportunidades', 'quiet') + '</div>' + oppTable((feed?.opportunities ?? []).slice(0, 5)) + '</section>' +
      '<section class="section"><h2>Jogos acompanhados</h2>' + matchCards(matches) + '</section>';
  }
  if (page === 'Oportunidades') {
    return header(page, 'O EV compara a probabilidade do cenário com a melhor odd observada. O cenário baixo testa a sensibilidade à incerteza.') +
      '<div class="filters">' + select('sport', 'Todas as modalidades', sports, filters.sport) + select('phase', 'Todas as fases', phases, filters.phase) +
      '<label>EV mínimo (%)<input type="number" min="0" max="100" data-filter="min" value="' + esc(filters.min ?? 0) + '"></label></div>' + oppTable(filteredOpp(feed?.opportunities ?? []));
  }
  return header('Pro Tipster ' + page, descriptions[page]) +
    '<div class="filters">' + select('phase', 'Todas as fases', phases, filters.phase) + '</div>' +
    matchCards(matches.filter(m => m.sport === page && (!filters.phase || m.phase === filters.phase)));
}
function history() {
  const items = bets.filter(b => (!filters.state || b.state === filters.state) &&
    (!filters.sport || b.legs.some(l => l.sport === filters.sport)) &&
    (!filters.type || filters.type === (b.legs.length === 1 ? 'Simples' : 'Múltipla')) &&
    (!filters.from || b.date >= filters.from) && (!filters.to || b.date <= filters.to));
  return header('Histórico de apostas', 'Consulta o teu registo e atualiza a liquidação das apostas.') + metrics(items) +
    '<section class="section"><div class="bar"><h2>As minhas apostas</h2><div class="bar">' + btn('import-image', 'Importar captura', '', 'quiet') + btn('bet', '＋ Registar aposta', '', 'primary') + '</div></div>' +
    '<div class="filters">' + select('state', 'Todos os estados', states, filters.state) + select('sport', 'Todas as modalidades', sports, filters.sport) +
    select('type', 'Todos os tipos', ['Simples', 'Múltipla'], filters.type) +
    ['from', 'to'].map((key, i) => '<label>' + ['Desde', 'Até'][i] + '<input type="date" data-filter="' + key + '" value="' + esc(filters[key]) + '"></label>').join('') + '</div>' +
    (items.length ? table(['Data / tipo', 'Seleções', 'Stake', 'Odd total', 'Estado', 'Resultado líquido', ''], items.map(b => cells(
      esc(b.date) + '<small>' + (b.legs.length === 1 ? 'Simples' : 'Múltipla · ' + b.legs.length + ' seleções') + '</small>',
      '<div class="selection">' + b.legs.map(l => '<div>' + esc(l.sport + ' · ' + l.market + ' · ' + l.selection) + '</div>').join('') + '</div>',
      stakeText(b), number.format(b.odd), esc(b.state) + (b.result ? '<small>' + esc(b.result) + '</small>' : ''),
      b.state === 'Pendente' ? '—' : stakeText({ cents: ledger([b]).profit, currency: b.currency }), btn('bet', 'Editar', b.id, 'link')
    ))) : empty('Sem apostas para estes filtros.')) + '</section>';
}
function tipsters() {
  return header('Desempenho por tipster', 'Resultados das apostas que associaste a cada persona. As estimativas de demonstração não foram calibradas nem auditadas.') +
    sports.map(s => '<section class="section"><h2>Pro Tipster ' + s + '</h2><p class="muted">' + esc(descriptions[s]) + '</p>' + metrics(bets.filter(b => b.tipster === s)) + '</section>').join('');
}
function settings() {
  return header('Definições', 'Configura a visibilidade do teu resumo e os alertas dentro da aplicação.') +
    '<form id="prefs" class="panel settings"><label class="check"><input name="share" type="checkbox" ' + (me.prefs.share ? 'checked' : '') + '> Partilhar o meu resumo financeiro com o grupo</label>' +
    '<label class="check"><input name="alerts" type="checkbox" ' + (me.prefs.alerts ? 'checked' : '') + '> Mostrar alertas de EV no painel</label>' +
    '<label>EV mínimo (%)<input name="threshold" type="number" min="0" max="100" step="0.1" required value="' + me.prefs.threshold + '"></label>' +
    '<fieldset><legend>Modalidades dos alertas</legend>' + sports.map(s => '<label class="check"><input type="checkbox" name="sport" value="' + s + '" ' + (me.prefs.sports.includes(s) ? 'checked' : '') + '>' + s + '</label>').join('') +
    '</fieldset><button class="primary">Guardar preferências</button><div class="error" role="alert"></div></form>';
}
function groupPage() {
  return header('Painel do grupo', 'Mostra os totais dos membros que ativaram a partilha nas definições.') +
    (group.length ? group.map(g => '<article class="panel group"><h2>' + esc(g.name) + '</h2><div class="grid">' +
      metric('Resultado líquido', money(g.summary.profit)) + metric('Yield', pct(g.summary.yield)) + metric('ROI do registo', pct(g.summary.roi)) + '</div></article>').join('') : empty('Ainda ninguém ativou a partilha.'));
}
function render() {
  const active = name => '<button data-action="nav" data-value="' + esc(name) + '" aria-current="' + (page === name) + '">' + esc(name) + '</button>';
  const content = { 'Histórico': history, Tipsters: tipsters, Grupo: groupPage, 'Definições': settings }[page] ?? games;
  app.innerHTML = '<div class="shell"><aside class="rail"><div class="brand"><span class="logo">↗</span>Pro Tipster</div><nav aria-label="Navegação principal">' +
    active(links[0]) + '<small>Modalidades</small>' + links.slice(1, 4).map(active).join('') + '<small>Registo e análise</small>' + links.slice(4).map(active).join('') +
    '</nav><div class="rail-footer"><small>Área privada · 5 contas</small></div></aside><main class="content"><div class="top"><span class="badge">' +
    (feed?.mode === 'demo' ? 'Demonstração · dados fictícios' : feed?.mode === 'licensed' ? 'Fontes licenciadas' : 'Fonte indisponível') +
    '</span><div class="bar"><small>' + esc(me.name) + '</small>' + btn('refresh', 'Atualizar', '', 'quiet') + btn('logout', 'Sair', '', 'quiet') + '</div></div>' +
    (message ? '<div class="message" role="status">' + esc(message) + '</div>' : '') +
    (feedError ? '<p class="error">' + esc(feedError) + '</p>' : '') +
    (feed?.retrieved ? '<small>Consulta às fontes · ' + esc(dateTime(feed.retrieved)) + '</small>' : '') +
    (feed?.errors ?? []).map(error => '<p class="error">' + esc(error) + '</p>').join('') + content() + '</main></div>';
}
function open(title, content) {
  dialog.innerHTML = '<div class="bar dialog-head"><h2 id="dialog-title">' + esc(title) + '</h2>' + btn('close', 'Fechar') + '</div>' + content;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  if (!dialog.open) dialog.showModal();
}
function detail(id) {
  const m = feed?.matches.find(match => match.id === id);
  if (!m) return;
  open(m.teams.join(' × '), '<div class="bar">' + flag(m.sport, 'neutral') + flag(m.demo && m.phase === 'Ao vivo' ? 'Ao vivo · simulado' : m.phase, m.phase === 'Ao vivo' ? 'live' : '') + '</div>' +
    '<p class="muted">' + esc(m.league + ' · ' + m.source) + '<br>Início · ' + esc(dateTime(m.date)) + '<br>Atualização · ' + esc(dateTime(m.updated)) + '</p>' +
    (m.demo ? '<p class="message">Cenário fictício. As bandas são testes de sensibilidade de ±' + pct(m.delta) + ' em pontos percentuais, sem interpretação de intervalo de confiança.</p>' : '') +
    '<ul>' + m.notes.map(note => '<li>' + esc(note) + '</li>').join('') + '</ul><p>' + esc(descriptions[m.sport]) + '</p>' +
    (m.p ? table(['Seleção', 'Prob. estimada', 'Cenário baixo – alto', 'Odd justa'], m.p.map((p, i) => cells(esc(m.labels[i]), pct(p), pct(Math.max(0, p - m.delta)) + ' – ' + pct(Math.min(1, p + m.delta)), number.format(1 / p)))) : empty('Probabilidade do modelo indisponível.')) +
    '<section class="section"><h2>Comparação de odds</h2>' + (m.books.length ? table(['Fonte', ...m.labels, 'Margem', 'Atualização'], m.books.map(book => cells(
      esc(book.name), ...book.odds.map(o => number.format(o)), pct(book.odds.reduce((sum, o) => sum + 1 / o, -1)), esc(dateTime(book.updated ?? m.updated))
    ))) : empty('Sem odds disponíveis para este jogo.')) + '</section>');
}
function legMarkup(leg = {}) {
  return '<div class="fields leg"><label>Modalidade' + formSelect('sport', sports, leg.sport) + '</label><label>Mercado<input name="market" maxlength="150" required value="' + esc(leg.market) + '"></label><label>Seleção<input name="selection" maxlength="150" required value="' + esc(leg.selection) + '"></label>' + btn('remove-leg', 'Retirar') + '</div>';
}
function betForm(id) {
  editing = bets.find(b => String(b.id) === id) ?? null;
  const b = editing ?? { legs: [{}], date: today(), state: 'Pendente' };
  open(editing ? 'Editar aposta' : 'Registar aposta', '<form id="betform"><div class="fields"><label>Data<input type="date" name="date" required value="' + esc(b.date) + '"></label>' +
    '<label>Stake<input name="stake" type="number" min=".01" max="1000000" step=".01" required value="' + (b.cents ? b.cents / 100 : '') + '"></label>' +
    '<label>Moeda' + formSelect('currency', ['EUR', 'COINS'], b.currency || 'EUR') + '</label>' +
    '<label>Odd decimal total<input type="number" name="odd" min="1.001" max="100000" step="any" required value="' + esc(b.odd) + '"></label>' +
    '<label>Estado' + formSelect('state', states, b.state) + '</label><label>Tipster' + formSelect('tipster', ['', ...sports], b.tipster) + '</label>' +
    '<label>Resultado / notas<input name="result" maxlength="200" value="' + esc(b.result) + '"></label></div>' +
    '<div><h3>Seleções</h3><p class="muted">Para uma múltipla, adiciona cada seleção e indica a odd total do boletim.</p><div id="legs">' + b.legs.map(legMarkup).join('') + '</div>' +
    btn('add-leg', '＋ Adicionar seleção') + '</div><div class="bar"><button class="primary">Guardar aposta</button>' +
    (editing ? btn('delete', 'Eliminar aposta', editing.id, 'quiet negative') : '') + '</div><div class="error" role="alert"></div></form>');
}
function imageImport() {
  open('Importar captura do boletim', '<form id="imageform"><label>Imagem do boletim<input type="file" name="image" accept="image/png,image/jpeg,image/webp" required></label><p class="muted">O reconhecimento é feito no navegador. Confirma sempre os campos reconhecidos antes de guardar.</p><button class="primary">Ler texto da imagem</button><div class="error" role="status"></div></form>');
}
function importedForm(text) {
  open('Rever múltipla reconhecida', '<form id="importform"><div class="fields"><label>Modalidade' + formSelect('sport', sports, 'CS2') + '</label><label>Stake<input type="number" name="stake" min=".01" step=".01" required></label><label>Moeda' + formSelect('currency', ['COINS', 'EUR'], 'COINS') + '</label><label>Odd total<input type="number" name="odd" min="1.001" step="any" required></label><label>Data<input type="date" name="date" required value="' + today() + '"></label><label>Estado' + formSelect('state', states, 'Pendente') + '</label></div><label>Texto reconhecido. Edita e deixa uma seleção por linha<textarea name="entries" rows="9" required>' + esc(text) + '</textarea></label><label>Resultado / notas<input name="result" maxlength="200"></label><p class="muted">Cada linha será importada como uma seleção. Remove cabeçalhos e texto que não sejam seleções. A imagem não é guardada.</p><button class="primary">Confirmar e guardar múltipla</button><div class="error" role="alert"></div></form>');
}
document.addEventListener('change', event => {
  const name = event.target.dataset.filter;
  if (!name || !me) return;
  filters[name] = event.target.value;
  render();
  document.querySelector('[data-filter="' + name + '"]')?.focus();
});
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target || busy) return;
  const { action, value } = target.dataset;
  if (action === 'close') return dialog.close();
  if (action === 'match') return detail(value);
  if (action === 'bet') return betForm(value);
  if (action === 'import-image') return imageImport();
  if (action === 'add-leg') {
    if (document.querySelectorAll('.leg').length < 12) document.querySelector('#legs').insertAdjacentHTML('beforeend', legMarkup());
    return;
  }
  if (action === 'remove-leg') {
    if (document.querySelectorAll('.leg').length > 1) target.closest('.leg').remove();
    return;
  }
  busy = true;
  message = '';
  try {
    if (action === 'nav') {
      if (value === 'Grupo') group = await api('group');
      page = value;
      filters = {};
    }
    if (action === 'logout') { await api('logout', 'POST'); return login(); }
    if (action === 'refresh') { await refresh(); message = feedError ? '' : 'Dados atualizados.'; }
    if (action === 'delete') {
      if (!window.confirm('Eliminar esta aposta do histórico?')) return;
      await api('bets/' + value, 'DELETE');
      bets = bets.filter(b => String(b.id) !== value);
      dialog.close();
      message = 'Aposta eliminada.';
    }
    render();
  } catch (error) {
    if (error.status === 401) return login('A sessão terminou.');
    if (dialog.open) dialog.querySelector('.error').textContent = error.message;
    else { message = error.message; render(); }
  } finally { busy = false; }
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const form = event.target;
  const data = new FormData(form);
  const submit = form.querySelector('button:not([type=button])');
  if (submit) submit.disabled = true;
  try {
    if (form.id === 'login') {
      await api('login', 'POST', Object.fromEntries(data));
      await enter();
    }
    if (form.id === 'prefs') {
      me.prefs = await api('preferences', 'PUT', { share: data.has('share'), alerts: data.has('alerts'), threshold: Number(data.get('threshold')), sports: data.getAll('sport') });
      message = 'Preferências guardadas.';
      render();
    }
    if (form.id === 'betform') {
      const legs = [...form.querySelectorAll('.leg')].map(row => Object.fromEntries([...row.querySelectorAll('[name]')].map(field => [field.name, field.value])));
      const payload = { legs, cents: Math.round(Number(data.get('stake')) * 100), currency: data.get('currency'), odd: Number(data.get('odd')), date: data.get('date'), state: data.get('state'), tipster: data.get('tipster'), result: data.get('result') };
      if (editing) {
        const updated = await api('bets/' + editing.id, 'PUT', payload);
        bets = bets.map(b => b.id === editing.id ? { ...updated, id: b.id } : b);
      } else bets.unshift(await api('bets', 'POST', payload));
      message = 'Aposta guardada.';
      dialog.close();
      render();
    }
    if (form.id === 'imageform') {
      const file = data.get('image');
      if (!file || !file.size || file.size > 12000000) throw new Error('Escolhe uma imagem até 12 MB.');
      if (!window.Tesseract) throw new Error('O reconhecimento precisa de ligação à Internet para carregar o motor de OCR.');
      form.querySelector('button').textContent = 'A reconhecer…';
      const result = await Tesseract.recognize(file, 'por+eng');
      if (!result.data.text.trim()) throw new Error('Não consegui reconhecer texto nesta imagem.');
      importedForm(result.data.text.trim());
    }
    if (form.id === 'importform') {
      const sport = data.get('sport');
      const legs = String(data.get('entries')).split(/\n+/).map(line => line.trim()).filter(Boolean).slice(0, 12).map(selection => ({ sport, market: 'Boletim CSGOEmpire', selection }));
      if (!legs.length) throw new Error('Indica pelo menos uma seleção.');
      const payload = { legs, cents: Math.round(Number(data.get('stake')) * 100), currency: data.get('currency'), odd: Number(data.get('odd')), date: data.get('date'), state: data.get('state'), tipster: '', result: data.get('result') };
      bets.unshift(await api('bets', 'POST', payload));
      message = 'Múltipla importada e guardada.';
      dialog.close();
      render();
    }
  } catch (error) {
    if (error.status === 401 && form.id !== 'login') return login('A sessão terminou.');
    form.querySelector('.error').textContent = error.message;
  } finally {
    busy = false;
    if (submit) submit.disabled = false;
  }
});
enter().catch(error => login(error.status === 401 ? '' : 'Não foi possível abrir a aplicação.'));
setInterval(async () => {
  if (!me || busy || dialog.open || document.hidden || !['Painel', ...sports, 'Oportunidades'].includes(page) || document.activeElement?.matches('input,select')) return;
  busy = true;
  try { await refresh(); render(); }
  catch { login('A sessão terminou.'); }
  finally { busy = false; }
}, 60000);

