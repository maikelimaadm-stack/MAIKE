/**
 * E2E satélite com WebGL real e Map Tiles API INTERCEPTADA (fixture sintética,
 * não é imagem Google). Prova o caminho completo: createSession → tiles raster
 * pintados no canvas → atribuição do viewport; e falhas (404/403/timeout).
 * Uso: VITE_GOOGLE_MAPS_API_KEY=e2e-chave-ficticia npx vite --config tests/e2e/harness/vite.e2e.config.mjs
 *      node tests/e2e/harness/run-satelite.cjs
 */
const { chromium, devices } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const OUT = process.env.E2E_OUT || path.resolve(__dirname, '../../../docs/engineering/evidencias/maplibre-areas');
const URL = process.env.E2E_URL || 'http://localhost:5199/';
const TILE = fs.readFileSync(path.join(__dirname, 'tile-sintetico.png'));
const COPYRIGHT = 'Imagens ©2026 Airbus, CNES / Airbus, Maxar Technologies, Planet.com — Dados do mapa ©2026';

async function rotear(page, modo) {
  const conta = { sessao: 0, tiles: 0, viewport: 0, chaveNaUrl: true };
  await page.route('https://tile.googleapis.com/**', async (route) => {
    const u = route.request().url();
    if (u.includes('/v1/createSession')) {
      conta.sessao += 1;
      if (modo === 'sessao403') return route.fulfill({ status: 403, body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: `SESS${conta.sessao}`, expiry: '9999999999', tileWidth: 256, imageFormat: 'png' }) });
    }
    if (u.includes('/v1/2dtiles/')) {
      conta.tiles += 1;
      if (modo === 'tiles404') return route.fulfill({ status: 404, body: '' });
      if (modo === 'tilesTimeout') return; // nunca responde
      return route.fulfill({ status: 200, contentType: 'image/png', body: TILE, headers: { 'access-control-allow-origin': '*' } });
    }
    if (u.includes('/tile/v1/viewport')) {
      conta.viewport += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ copyright: COPYRIGHT, maxZoomRects: [] }) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return conta;
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const res = {};

  // S01/S02/S04 — sucesso: desktop
  {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    const conta = await rotear(p, 'ok');
    await p.goto(URL + '?cena=geral');
    await p.waitForFunction(() => document.querySelectorAll('.mg-area-label').length >= 3, null, { timeout: 30000 });
    await p.waitForSelector('[data-testid=basemap-atribuicao-texto]', { timeout: 30000 });
    await p.waitForFunction((c) => document.querySelector('[data-testid=basemap-atribuicao-texto]')?.textContent.includes(c), COPYRIGHT.slice(0, 20), { timeout: 15000 });
    await p.waitForTimeout(1200);
    res.S01_sessoes = conta.sessao;
    res.S01_tiles = conta.tiles;
    res.S04_atribuicao = await p.textContent('[data-testid=basemap-atribuicao-texto]');
    res.S04_atribuicao_visivel = await p.isVisible('[data-testid=basemap-atribuicao-texto]');
    res.S01_carregando_visivel = await p.isVisible('text=Carregando satélite');
    res.S01_alertas = await p.$$eval('[role=alert]', (els) => els.map((e) => e.textContent));
    await p.screenshot({ path: path.join(OUT, 'satelite-sintetico-desktop.png') });
    // S02: alterna 3x — overlays permanecem, sem nova sessão
    for (let i = 0; i < 3; i += 1) {
      await p.click('button:has-text("Mapa")');
      await p.waitForTimeout(300);
      await p.click('button:has-text("Satélite")');
      await p.waitForTimeout(500);
    }
    res.S02_labels_apos_trocas = await p.$$eval('.mg-area-label', (els) => els.length);
    res.S02_lotes_apos_trocas = await p.$$eval('.mg-lote-count', (els) => els.map((e) => e.textContent));
    res.S02_sessoes_apos_trocas = conta.sessao;
    await p.click('button:has-text("Mapa")');
    await p.waitForTimeout(800);
    await p.screenshot({ path: path.join(OUT, 'satelite-sintetico-voltou-mapa.png') });
    res.S02_atribuicao_some_em_ruas = !(await p.isVisible('[data-testid=basemap-atribuicao]'));
    await p.close();
  }

  // S04 mobile — copyright longo atrás de "Fontes de dados" acessível
  {
    const ctx = await b.newContext({ ...devices['iPhone 13'] });
    const p = await ctx.newPage();
    await rotear(p, 'ok');
    await p.goto(URL + '?cena=geral');
    await p.waitForSelector('button:has-text("Fontes de dados")', { timeout: 30000 });
    res.S04_mobile_botao = await p.getAttribute('button:has-text("Fontes de dados")', 'aria-expanded');
    await p.tap('button:has-text("Fontes de dados")');
    await p.waitForTimeout(300);
    res.S04_mobile_texto_integral = await p.textContent('#basemap-fontes-dados');
    res.S04_mobile_overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await p.screenshot({ path: path.join(OUT, 'satelite-sintetico-mobile-fontes.png') });
    await ctx.close();
  }

  // S03 — tiles 404: não fica "pronto"; volta a Mapa com aviso; overlays intactos
  for (const modo of ['tiles404', 'sessao403', 'tilesTimeout']) {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    await rotear(p, modo);
    await p.goto(URL + '?cena=geral');
    await p.waitForFunction(() => document.querySelectorAll('.mg-area-label').length >= 3, null, { timeout: 30000 });
    await p.waitForSelector('[role=alert]', { timeout: 25000 });
    res[`S03_${modo}_alerta`] = await p.textContent('[role=alert]');
    res[`S03_${modo}_satelite_ativo`] = await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Satélite')?.className.includes('bg-black'));
    res[`S03_${modo}_labels`] = await p.$$eval('.mg-area-label', (els) => els.length);
    if (modo === 'tiles404') await p.screenshot({ path: path.join(OUT, 'satelite-falha-404.png') });
    await p.close();
  }

  // Editor: satélite ok preserva desenho
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    await rotear(p, 'ok');
    await p.goto(URL + '?cena=editar');
    await p.waitForSelector('[data-testid=medidas-area]', { timeout: 30000 });
    await p.waitForTimeout(1200);
    const antes = await p.textContent('[data-testid=medidas-area]');
    await p.click('button:has-text("Satélite")');
    await p.waitForSelector('[data-testid=basemap-atribuicao]', { timeout: 15000 });
    await p.waitForTimeout(800);
    res.S02_editor_area_mantida = antes === (await p.textContent('[data-testid=medidas-area]'));
    await p.screenshot({ path: path.join(OUT, 'satelite-sintetico-editor.png') });
    await p.close();
  }
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})().catch((e) => { console.error('FALHA', e); process.exit(1); });
