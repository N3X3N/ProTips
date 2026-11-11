import { createServer } from 'node:http';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { feed } from './providers.mjs';
import { opportunities, sports, performance } from './model.mjs';

const derive = promisify(scrypt);
const database = new DatabaseSync(process.env.DB_PATH ?? fileURLToPath(new URL('./tipster.sqlite', import.meta.url)));
database.exec(`
  PRAGMA foreign_keys=ON;
  PRAGMA journal_mode=WAL;
  PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE, salt TEXT, hash TEXT, prefs TEXT DEFAULT '{}');
  CREATE TRIGGER IF NOT EXISTS user_limit BEFORE INSERT ON users
  WHEN (SELECT COUNT(*) FROM users) >= 5 BEGIN SELECT RAISE(ABORT, 'Limite de cinco contas'); END;
  CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, user INTEGER REFERENCES users(id), expires INTEGER);
  CREATE TABLE IF NOT EXISTS bets (id INTEGER PRIMARY KEY, user INTEGER REFERENCES users(id), data TEXT);
`);
const defaultPrefs = { share: false, alerts: false, threshold: 5, sports };
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const secure = process.env.COOKIE_SECURE === '1';
const states = ['Pendente', 'Ganha', 'Perdida', 'Anulada'];
const tokenHash = token => createHash('sha256').update(token).digest('hex');

if (process.argv[2] === 'add-user') {
  const name = process.argv[3]?.trim();
  const password = process.env.NEW_USER_PASSWORD;
  if (!name || name.length > 40 || !password || password.length < 12 || password.length > 128) {
    throw new Error('Indica um nome e NEW_USER_PASSWORD com 12 a 128 caracteres.');
  }
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(password, salt, 64)).toString('hex');
  database.prepare('INSERT INTO users(name, salt, hash) VALUES(?,?,?)').run(name, salt, hash);
  console.log('Conta criada.');
  process.exit(0);
}

const assets = Object.fromEntries([
  ['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']
].map(([route, file, type]) => [route, { type, bytes: readFileSync(new URL('./' + file, import.meta.url)) }]));
const attempts = new Map();
const attemptTimer = setInterval(() => {
  for (const [key, value] of attempts) if (value.until <= Date.now()) attempts.delete(key);
  database.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
}, 60000);
attemptTimer.unref();

function error(status, message) {
  throw Object.assign(new Error(message), { status });
}
async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') error(415, 'Formato inválido.');
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16000) error(413, 'Pedido demasiado longo.');
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    return parsed;
  } catch { error(400, 'Dados inválidos.'); }
}
function clean(value, max) {
  return typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
}
function validateBet(data) {
  const legs = Array.isArray(data.legs) ? data.legs.map(leg => ({
    sport: leg?.sport, market: clean(leg?.market, 150), selection: clean(leg?.selection, 150)
  })) : [];
  const result = clean(data.result, 200);
  if (!legs.length || legs.length > 12 || legs.some(leg => !sports.includes(leg.sport) || !leg.market || !leg.selection)
      || !Number.isInteger(data.cents) || data.cents < 1 || data.cents > 100000000
      || !Number.isFinite(data.odd) || data.odd <= 1 || data.odd > 100000
      || (data.currency && !['EUR', 'COINS'].includes(data.currency))
      || !states.includes(data.state) || !/^\d{4}-\d\d-\d\d$/.test(data.date ?? '')
      || !Number.isFinite(Date.parse(data.date)) || new Date(data.date).toISOString().slice(0, 10) !== data.date
      || (data.tipster && !sports.includes(data.tipster))) error(400, 'Revê os dados da aposta.');
  return { legs, cents: data.cents, currency: data.currency || 'EUR', odd: data.odd, state: data.state, date: data.date, tipster: data.tipster || '', result };
}
function listBets(id) {
  return database.prepare('SELECT id, data FROM bets WHERE user=? ORDER BY id DESC').all(id).map(row => ({ ...JSON.parse(row.data), id: row.id }));
}
function cookie(token, age) {
  return 'tipster=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + (secure ? '; Secure' : '');
}
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net; worker-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('Cache-Control', 'no-store');
  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && Object.hasOwn(assets, path)) {
      res.writeHead(200, { 'Content-Type': assets[path].type + '; charset=utf-8' });
      return res.end(assets[path].bytes);
    }
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== (process.env.APP_ORIGIN ?? ('http://' + req.headers.host)))) error(403, 'Origem inválida.');
    }
    if (req.method === 'POST' && path === '/api/login') {
      const key = req.socket.remoteAddress;
      const now = Date.now();
      const current = attempts.get(key);
      const attempt = current?.until > now ? current : { until: now + 600000, count: 0 };
      if (attempt.count >= 15) error(429, 'Demasiadas tentativas. Tenta mais tarde.');
      attempt.count++;
      attempts.set(key, attempt);
      const input = await body(req);
      const password = cleanPassword(input.password);
      const user = database.prepare('SELECT * FROM users WHERE name=?').get(clean(input.name, 40));
      const hash = await derive(password, user?.salt ?? 'invalid-username-salt', 64);
      if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) error(401, 'Credenciais inválidas.');
      const token = randomBytes(32).toString('hex');
      const ttl = 86400 * 7;
      database.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token), user.id, now + ttl * 1000);
      res.setHeader('Set-Cookie', cookie(token, ttl));
      attempts.delete(key);
      return json({ name: user.name });
    }
    const token = req.headers.cookie?.match(/(?:^|;\s*)tipster=([a-f0-9]{64})(?:;|$)/)?.[1];
    const digest = token && tokenHash(token);
    const user = digest && database.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user WHERE digest=? AND expires>?').get(digest, Date.now());
    if (!user) error(401, 'Inicia sessão.');
    const prefs = { ...defaultPrefs, ...JSON.parse(user.prefs) };
    if (req.method === 'POST' && path === '/api/logout') {
      database.prepare('DELETE FROM sessions WHERE digest=?').run(digest);
      res.setHeader('Set-Cookie', cookie('', 0));
      return json({});
    }
    if (req.method === 'GET' && path === '/api/me') return json({ name: user.name, prefs });
    if (req.method === 'GET' && path === '/api/feed') {
      const data = await feed();
      return json({ ...data, opportunities: opportunities(data.matches) });
    }
    if (req.method === 'GET' && path === '/api/bets') return json(listBets(user.id));
    if (req.method === 'POST' && path === '/api/bets') {
      const data = validateBet(await body(req));
      const entry = database.prepare('INSERT INTO bets(user, data) VALUES(?,?)').run(user.id, JSON.stringify(data));
      return json({ ...data, id: entry.lastInsertRowid }, 201);
    }
    const bet = path.match(/^\/api\/bets\/(\d+)$/);
    if (bet && req.method === 'PUT') {
      const data = validateBet(await body(req));
      const changed = database.prepare('UPDATE bets SET data=? WHERE id=? AND user=?').run(JSON.stringify(data), bet[1], user.id);
      if (!changed.changes) error(404, 'Aposta indisponível.');
      return json(data);
    }
    if (bet && req.method === 'DELETE') {
      const changed = database.prepare('DELETE FROM bets WHERE id=? AND user=?').run(bet[1], user.id);
      if (!changed.changes) error(404, 'Aposta indisponível.');
      return json({});
    }
    if (req.method === 'PUT' && path === '/api/preferences') {
      const data = await body(req);
      if (typeof data.share !== 'boolean' || typeof data.alerts !== 'boolean' || !Number.isFinite(data.threshold) || data.threshold < 0 || data.threshold > 100
          || !Array.isArray(data.sports) || data.sports.length > 3 || data.sports.some(s => !sports.includes(s))) error(400, 'Preferências inválidas.');
      const updated = { share: data.share, alerts: data.alerts, threshold: data.threshold, sports: [...new Set(data.sports)] };
      database.prepare('UPDATE users SET prefs=? WHERE id=?').run(JSON.stringify(updated), user.id);
      return json(updated);
    }
    if (req.method === 'GET' && path === '/api/group') {
      return json(database.prepare('SELECT id,name,prefs FROM users').all().filter(row => JSON.parse(row.prefs).share === true)
        .map(row => {
          const items = listBets(row.id).filter(entry => (entry.currency || 'EUR') === 'EUR');
          const { profit, yield: yieldRate } = performance(items);
          const total = items.reduce((sum, entry) => sum + entry.cents, 0);
          return { name: row.name, summary: { profit, yield: yieldRate, roi: total ? profit / total : null } };
        }));
    }
    error(404, 'Página indisponível.');
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) json({ error: err.status ? err.message : 'Erro interno.' }, err.status ?? 500);
  }
});
function cleanPassword(value) {
  return typeof value === 'string' && value.length <= 128 ? value : '';
}
server.listen(port, host, () => console.log('Pro Tipster em http://' + host + ':' + server.address().port));

