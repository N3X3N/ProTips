import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demo, football, margin, opportunities, performance, series } from './model.mjs';

test('Estimativas normalizadas e estados ao vivo', () => {
  const symmetric = football(1, 1);
  assert.ok(Math.abs(symmetric[0] - symmetric[2]) < 1e-10);
  assert.ok(football(.5, .3, 1, 0)[0] > football(.5, .3)[0]);
  assert.equal(series([.5, .5, .5])[0], .5);
  assert.equal(series([.6], 1, 1)[0], .6);
  for (const game of demo()) assert.ok(Math.abs(game.p.reduce((a,b) => a+b) - 1) < 1e-10);
});
test('Melhor preço, EV, margem e sensibilidade', () => {
  const [pick] = opportunities([{ id: 'x', sport: 'CS2', teams: ['A', 'B'], labels: ['A', 'B'], p: [.6, .4], delta: .05, books: [{ name: 'Casa A', odds: [1.8, 2] }, { name: 'Casa B', odds: [1.9, 2] }] }]);
  assert.equal(pick.odd, 1.9);
  assert.equal(pick.book, 'Casa B');
  assert.equal(pick.margin, margin([1.9, 2]));
  assert.ok(Math.abs(pick.ev - .14) < 1e-10 && pick.low < pick.ev);
});
test('Liquidação e yield em cêntimos', () => {
  assert.deepEqual(performance([
    { state: 'Ganha', cents: 1000, odd: 2.2 },
    { state: 'Perdida', cents: 500, odd: 3 },
    { state: 'Pendente', cents: 900, odd: 2 },
    { state: 'Anulada', cents: 900, odd: 2 }
  ]), { staked: 1500, profit: 700, count: 2, yield: 700/1500 });
});
test('HTTP: acesso, demonstração, CRUD, isolamento e partilha agregada', { timeout: 20000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tipster-test-'));
  const server = fileURLToPath(new URL('./server.mjs', import.meta.url));
  const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', DB_PATH: join(dir, 'test.sqlite'), FEED_MODE: 'demo', NEW_USER_PASSWORD: 'example-test-12345', COOKIE_SECURE: '0', APP_ORIGIN: '' };
  delete env.APP_ORIGIN;
  let child;
  t.after(async () => {
    if (child?.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    rmSync(dir, { recursive: true, force: true });
  });
  for (const name of ['Ana', 'Bruno', 'Cris', 'Dinis', 'Eva']) execFileSync(process.execPath, [server, 'add-user', name], { env });
  assert.throws(() => execFileSync(process.execPath, [server, 'add-user', 'Filipe'], { env, stdio: 'pipe' }), /Limite de cinco contas/);
  child = spawn(process.execPath, [server], { env });
  const url = await new Promise((resolve, reject) => {
    child.stdout.once('data', data => resolve(String(data).trim().split(' ').at(-1)));
    child.once('error', reject);
    child.once('exit', code => reject(Error('Servidor terminou: ' + code)));
  });
  async function request(path, method = 'GET', data, cookie, extra = {}) {
    const response = await fetch(url + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: data ? JSON.stringify(data) : undefined });
    return [response.status, response.headers.get('set-cookie')?.split(';')[0], await response.json()];
  }
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await request('/api/bets'))[0], 401);
  assert.equal((await request('/api/login', 'POST', { name: 'Ana', password: 'errada' }))[0], 401);
  assert.equal((await request('/api/login', 'POST', {}, null, { Origin: 'https://outro.example' }))[0], 403);
  const [, ana] = await request('/api/login', 'POST', { name: 'Ana', password: env.NEW_USER_PASSWORD });
  const [, bruno] = await request('/api/login', 'POST', { name: 'Bruno', password: env.NEW_USER_PASSWORD });
  const [, , feed] = await request('/api/feed', 'GET', null, ana);
  assert.equal(feed.mode, 'demo');
  assert.ok(feed.matches.every(match => match.demo));
  assert.equal(new Set(feed.matches.map(match => match.sport)).size, 3);
  const bet = { legs: [{ sport: 'Futebol', market: '1X2', selection: 'A' }, { sport: 'CS2', market: 'Série', selection: 'B' }], cents: 2000, date: '2026-11-11', odd: 2, state: 'Pendente', tipster: 'CS2', result: '' };
  assert.equal((await request('/api/bets', 'POST', { ...bet, date: '2026-02-30' }, ana))[0], 400);
  const [created, , record] = await request('/api/bets', 'POST', bet, ana);
  assert.equal(created, 201);
  assert.deepEqual((await request('/api/bets', 'GET', null, bruno))[2], []);
  assert.equal((await request('/api/bets/' + record.id, 'PUT', bet, bruno))[0], 404);
  assert.equal((await request('/api/bets/' + record.id, 'DELETE', null, bruno))[0], 404);
  assert.equal((await request('/api/bets/' + record.id, 'PUT', { ...bet, state: 'Ganha' }, ana))[0], 200);
  assert.deepEqual((await request('/api/group', 'GET', null, bruno))[2], []);
  assert.equal((await request('/api/preferences', 'PUT', { share: true, alerts: true, threshold: 5, sports: ['CS2'] }, ana))[0], 200);
  assert.deepEqual((await request('/api/group', 'GET', null, bruno))[2], [{ name: 'Ana', summary: { profit: 2000, yield: 1, roi: 1 } }]);
  assert.equal((await request('/api/bets/' + record.id, 'DELETE', null, ana))[0], 200);
  assert.equal((await request('/api/logout', 'POST', null, ana))[0], 200);
  assert.equal((await request('/api/me', 'GET', null, ana))[0], 401);
});
