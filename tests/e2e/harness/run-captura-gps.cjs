/**
 * D-PROD-363 — gravar caminhando (captura por GPS) no navegador real (Chromium + WebGL por SwiftShader), no celular
 * (Pixel 7, toque). A posição vem do Playwright (`context.setGeolocation`): a pessoa "anda" um quadrado de 60 m
 * com um passo a cada 2 m. Confere: grava sozinho, enxuga no Terminar, salva, e a tela ocupa a tela inteira.
 *
 * Uso: npx vite --config tests/e2e/harness/vite.e2e.config.mjs
 *      node tests/e2e/harness/run-captura-gps.cjs
 */
const { chromium, devices } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const OUT = process.env.E2E_OUT || path.resolve(__dirname, '../../../docs/engineering/evidencias/mapa-cadastro');
const URL = process.env.E2E_URL || 'http://localhost:5199/';
const BASE = { lat: -15.6, lng: -56.1 };
const pos = (norteM, lesteM) => ({ latitude: BASE.lat + norteM / 111320, longitude: BASE.lng + lesteM / (111320 * Math.cos((BASE.lat * Math.PI) / 180)), accuracy: 4 });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ ...devices['Pixel 7'], geolocation: pos(0, 0), permissions: ['geolocation'] });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto(URL + '?cena=captura');
  await p.waitForSelector('text=Gravar caminhando', { timeout: 30000 });
  await p.waitForTimeout(1500);
  const R = {};
  const contagem = () => p.evaluate(() => Number([...document.querySelectorAll('div')].find((d) => d.textContent === 'pontos')?.previousElementSibling?.textContent));
  await p.tap('text=Gravar caminhando');
  // anda o quadrado de 60 m: norte, leste, sul, oeste (passos de 2 m)
  const trajeto = [];
  for (let i = 0; i <= 30; i += 1) trajeto.push([i * 2, 0]);
  for (let i = 1; i <= 30; i += 1) trajeto.push([60, i * 2]);
  for (let i = 1; i <= 30; i += 1) trajeto.push([60 - i * 2, 60]);
  for (let i = 1; i <= 29; i += 1) trajeto.push([0, 60 - i * 2]);
  for (const [n, l] of trajeto) { await ctx.setGeolocation(pos(n, l)); await p.waitForTimeout(60); }
  await p.waitForTimeout(500);
  R.gravados = await contagem();
  R.gravando = await p.getAttribute('[data-mk-gravando]', 'data-mk-gravando');
  await p.screenshot({ path: path.join(OUT, 'd363-gravando-390.png') });
  await p.tap('text=Terminar');
  await p.waitForTimeout(400);
  R.depois_de_enxugar = await contagem();
  R.medida = await p.evaluate(() => [...document.querySelectorAll('div')].find((d) => /^[\d.,]+$/.test(d.textContent) && d.className.includes('text-emerald-600'))?.textContent || null);
  R.tela_inteira = await p.evaluate(() => {
    const t = document.querySelector('[data-mk-captura-gps]');
    const r = t.getBoundingClientRect();
    return t.parentElement === document.body && r.width === window.innerWidth && r.height === window.innerHeight;
  });
  R.overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await p.screenshot({ path: path.join(OUT, 'd363-terminado-390.png') });
  await p.tap('text=/Confirmar/');
  await p.waitForTimeout(400);
  R.salvos = await p.evaluate(() => (window.__E2E__.capturados || []).length);
  R.erros = erros;
  fs.writeFileSync(path.join(OUT, 'd363-resultado.json'), JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, null, 1));
  await b.close();
  const ok = R.gravados >= 20 && R.depois_de_enxugar >= 4 && R.depois_de_enxugar <= 9 && R.medida === "0,36" && R.salvos === R.depois_de_enxugar && R.tela_inteira && !R.overflow && !erros.length;
  if (!ok) { console.error('FALHA'); process.exit(1); }
})().catch((e) => { console.error('FALHA', e); process.exit(1); });
