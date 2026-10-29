/**
 * E2E com WebGL real (Chromium + SwiftShader) sobre o harness Vite com stubs de dados.
 * Uso: npx vite --config tests/e2e/harness/vite.e2e.config.mjs  &&  node tests/e2e/harness/run-webgl.cjs
 * Saída: JSON de resultados + screenshots em docs/engineering/evidencias/maplibre-areas/.
 */
const { chromium, devices } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:path').resolve(__dirname, '../../../docs/engineering/evidencias/maplibre-areas');
const URL = process.env.E2E_URL || 'http://localhost:5199/';
const log = (...a) => console.log(...a);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const res = {};
  // ── Mapa Geral desktop
  {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    const erros = [];
    p.on('pageerror', (e) => erros.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
    await p.goto(URL + '?cena=geral');
    await p.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
    await p.waitForFunction(() => document.querySelectorAll('.mg-area-label').length >= 3, null, { timeout: 30000 });
    await p.waitForTimeout(2500);
    res.geral_labels = await p.$$eval('.mg-area-label', (els) => els.map((e) => e.textContent));
    res.geral_lotes = await p.$$eval('.mg-lote-count', (els) => els.map((e) => e.textContent));
    res.geral_marcadores = await p.$$eval('.mg-marker', (els) => els.length);
    res.geral_satelite_msg = await p.$$eval('[role=alert]', (els) => els.map((e) => e.textContent));
    await p.screenshot({ path: OUT + '/geral-desktop.png' });
    // pixel do canvas pintado (WebGL real)
    res.geral_canvas = await p.evaluate(() => { const c = document.querySelector('.maplibregl-canvas'); return { w: c.width, h: c.height, gl: !!(c.getContext('webgl2') || c.getContext('webgl')) }; });
    // troca Mapa/Satélite (sem chave → erro honesto, mapa permanece)
    const sat = await p.$('button:has-text("Satélite")');
    if (sat) { await sat.click(); await p.waitForTimeout(800); }
    res.geral_apos_satelite_labels = await p.$$eval('.mg-area-label', (els) => els.length);
    res.geral_erros = erros.filter((e) => !/favicon|ERR_/.test(e)).slice(0, 8);
    await p.close();
  }
  // ── Mapa Geral mobile
  {
    const ctx = await b.newContext({ ...devices['iPhone 13'] });
    const p = await ctx.newPage();
    await p.goto(URL + '?cena=geral');
    await p.waitForFunction(() => document.querySelectorAll('.mg-area-label').length >= 3, null, { timeout: 30000 });
    await p.waitForTimeout(2000);
    await p.screenshot({ path: OUT + '/geral-mobile-390.png' });
    res.geral_mobile_overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await ctx.close();
  }
  // ── Editor: desenhar, navegar, editar, mover, desfazer
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const erros = [];
    p.on('pageerror', (e) => erros.push(String(e)));
    await p.goto(URL + '?cena=desenho');
    await p.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
    await p.waitForSelector('text=Toque para desenhar a área', { timeout: 30000 });
    await p.waitForTimeout(1500);
    const canvas = await p.$('.maplibregl-canvas');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const clique = async (x, y) => { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(250); };
    // D01: arrastar em DESENHAR com área vazia não cria ponto (pan)
    await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + 80, cy + 40, { steps: 8 }); await p.mouse.up();
    await p.waitForTimeout(400);
    res.D01_sem_ponto_apos_pan = await p.isVisible('text=Toque para desenhar a área');
    // D02: 4 pontos + fechar no primeiro
    const pts = [[cx - 120, cy - 80], [cx + 120, cy - 80], [cx + 120, cy + 80], [cx - 120, cy + 80]];
    for (const [x, y] of pts) await clique(x, y);
    res.D02_area_antes = await p.textContent('[data-testid=medidas-area]');
    await clique(pts[0][0] + 2, pts[0][1] + 2);
    await p.waitForTimeout(300);
    res.D02_area_fechada = await p.textContent('[data-testid=medidas-area]');
    res.D02_modo_editar = await p.getAttribute('[aria-label="Editar pontos"]', 'aria-pressed');
    // D03/D04: navegar → pan → pontos preservados
    await p.click('[aria-label="Navegar no mapa"]');
    await p.mouse.move(cx + 200, cy + 200); await p.mouse.down(); await p.mouse.move(cx + 260, cy + 230, { steps: 10 }); await p.mouse.up();
    await p.waitForTimeout(400);
    res.D03_area_apos_pan = await p.textContent('[data-testid=medidas-area]');
    // clique no vazio em NAVEGAR não cria ponto
    await clique(cx + 300, cy - 200);
    res.D03_area_apos_clique_navegar = await p.textContent('[data-testid=medidas-area]');
    await p.screenshot({ path: OUT + '/editor-fechado-navegar.png' });
    // D04: editar → arrastar vértice (posição deslocada pelo pan de +60,+30)
    await p.click('[aria-label="Editar pontos"]');
    const v = [pts[1][0] + 60, pts[1][1] + 30];
    await p.mouse.move(v[0], v[1]); await p.mouse.down(); await p.mouse.move(v[0] + 60, v[1] - 40, { steps: 10 }); await p.mouse.up();
    await p.waitForTimeout(400);
    res.D04_area_apos_arrastar = await p.textContent('[data-testid=medidas-area]');
    // D08 desfazer volta à área anterior
    await p.click('button:has-text("Desfazer")');
    await p.waitForTimeout(300);
    res.D08_area_apos_desfazer = await p.textContent('[data-testid=medidas-area]');
    await p.click('button:has-text("Refazer")');
    await p.waitForTimeout(300);
    res.D08_area_apos_refazer = await p.textContent('[data-testid=medidas-area]');
    // D07: mover área inteira com a mão
    await p.click('[aria-label="Mover área inteira"]');
    const centro = [cx + 60, cy + 30];
    await p.mouse.move(centro[0], centro[1]); await p.mouse.down(); await p.mouse.move(centro[0] - 100, centro[1] + 50, { steps: 12 }); await p.mouse.up();
    await p.waitForTimeout(400);
    res.D07_area_apos_mover = await p.textContent('[data-testid=medidas-area]');
    await p.screenshot({ path: OUT + '/editor-movido.png' });
    // régua
    await p.click('[aria-label="Alternar régua"]');
    await p.waitForTimeout(300);
    res.regua_segmentos = await p.$$eval('.maplibregl-marker', (els) => els.map((e) => e.textContent).filter((t) => / m$|km$/.test(t)));
    // D05: selecionar vértice (toque sem arrasto) e remover
    await p.click('[aria-label="Editar pontos"]');
    // vértice 3 (index 2) depois do mover (-100,+50)
    const v3 = [pts[2][0] + 60 - 100, pts[2][1] + 30 + 50];
    await clique(v3[0], v3[1]);
    res.D05_selecionado = await p.isVisible('button:has-text("Remover ponto")');
    if (res.D05_selecionado) { await p.click('button:has-text("Remover ponto")'); await p.waitForTimeout(300); }
    res.D05_area_apos_remover = await p.textContent('[data-testid=medidas-area]');
    await p.screenshot({ path: OUT + '/editor-regua-removido.png' });
    // S05: satélite sem chave → aviso honesto, desenho intacto
    await p.click('button:has-text("Satélite")');
    await p.waitForTimeout(600);
    res.S05_alerta = await p.$$eval('[role=alert]', (els) => els.map((e) => e.textContent));
    res.S05_area_mantida = await p.textContent('[data-testid=medidas-area]');
    // sair com alterações pede confirmação
    await p.click('[aria-label="Fechar editor"]');
    res.D09_confirmar_saida = await p.isVisible('text=Descartar o desenho não salvo?');
    await p.click('text=Voltar ao desenho');
    res.D09_cancelados = await p.evaluate(() => window.__E2E__.cancelados);
    res.editor_erros = erros.slice(0, 8);
    await p.close();
  }
  // ── Editor mobile (toque): pan não cria ponto, toque curto cria
  {
    const ctx = await b.newContext({ ...devices['Pixel 7'] });
    const p = await ctx.newPage();
    await p.goto(URL + '?cena=desenho');
    await p.waitForSelector('text=Toque para desenhar a área', { timeout: 30000 });
    await p.waitForTimeout(1500);
    const vw = p.viewportSize();
    for (const [x, y] of [[120, 300], [280, 300], [280, 480]]) { await p.touchscreen.tap(x, y); await p.waitForTimeout(250); }
    res.mobile_area = await p.textContent('[data-testid=medidas-area]').catch(() => null);
    await p.screenshot({ path: OUT + '/editor-mobile.png' });
    res.mobile_botoes_44 = await p.$$eval('[role=toolbar] button', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    res.mobile_overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    res.mobile_viewport = vw;
    await ctx.close();
  }
  // ── Editar área existente
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(URL + '?cena=editar');
    await p.waitForSelector('[data-testid=medidas-area]', { timeout: 30000 });
    await p.waitForTimeout(1500);
    res.D10_area_existente = await p.textContent('[data-testid=medidas-area]');
    res.D10_modo = await p.getAttribute('[aria-label="Editar pontos"]', 'aria-pressed');
    await p.screenshot({ path: OUT + '/editor-editar-existente.png' });
    await p.click('[aria-label="Fechar editor"]');
    res.D10_sair_sem_alteracao = await p.evaluate(() => window.__E2E__.cancelados);
    await p.close();
  }
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})().catch((e) => { console.error('FALHA', e); process.exit(1); });
