/**
 * R1 POLÍGONOS — GEO-08 (gravar → recarregar → editar → gravar → recarregar) e
 * GEO-09 (troca de empresa A→B→A) com WebGL real.
 *
 * GEO-08 usa o FormularioArea REAL; só o serviço de dados é um store local
 * (sessionStorage) que sobrevive ao reload. NÃO é backend nem app autenticado.
 *
 * Uso: npx vite --config tests/e2e/harness/vite.e2e.config.mjs ; node tests/e2e/harness/run-geo2.cjs
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const OUT = process.env.E2E_OUT || path.resolve(__dirname, '../../../docs/engineering/evidencias/maplibre-areas');
const URL = process.env.E2E_URL || 'http://localhost:5199/';

const idle = (p) => p.evaluate(() => new Promise((res) => {
  const m = window.__E2E_MAPS__.at(-1);
  if (m.loaded() && !m.isMoving()) return setTimeout(res, 150);
  m.once('idle', () => setTimeout(res, 150));
}));
const verticesLatLng = (p) => p.evaluate(() => window.__E2E_MAPS__.at(-1).getSource('m1-vertices').serialize().data.features.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]]));
const desenhoInfo = (p) => p.evaluate(() => {
  const m = window.__E2E_MAPS__.at(-1);
  const f = m.getSource('m1-desenho').serialize().data.features[0];
  return { geom: f?.geometry?.type || null, fill: f?.properties?.fill || null, pintado: m.queryRenderedFeatures({ layers: ['m1-desenho-fill'] }).length };
});
const mesmo = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v[0] - b[i][0]) < 1e-12 && Math.abs(v[1] - b[i][1]) < 1e-12);

async function preencherESalvar(p, { novo }) {
  await p.waitForSelector('[role=dialog] form', { timeout: 10000 });
  const inputs = p.locator('[role=dialog] input');
  const combos = p.locator('[role=dialog] button[role=combobox]');
  if (novo) {
    await inputs.nth(1).fill('1');
    await inputs.nth(2).fill('piquete r1');
    await combos.nth(0).click(); await p.click('[role=option]:has-text("Setor E2E")');
    await combos.nth(2).click(); await p.click('[role=option]:has-text("Brachiaria")');
    await combos.nth(4).click(); await p.click('[role=option]:has-text("Laranja")');
  }
  await p.click('[role=dialog] button[type=submit]');
  await p.waitForTimeout(800);
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const R = {};

  // ───────────── GEO-08
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    const erros = [];
    p.on('pageerror', (e) => erros.push(String(e)));
    await p.goto(URL + '?cena=desenho');
    await p.evaluate(() => sessionStorage.clear());
    await p.reload();
    await p.waitForSelector('text=Toque para desenhar a área', { timeout: 30000 });
    await idle(p);
    const cx = 640, cy = 400;
    for (const [x, y] of [[cx - 110, cy - 70], [cx + 90, cy - 80], [cx + 120, cy + 60], [cx - 100, cy + 75]]) { await p.mouse.click(x, y); await p.waitForTimeout(200); }
    await p.mouse.click(cx - 109, cy - 69);
    await idle(p);
    const desenhados = await verticesLatLng(p);
    R.GEO08_medidas_desenho = await p.textContent('[data-testid=medidas-area]');
    await p.click('button:has-text("Salvar")');
    await preencherESalvar(p, { novo: true });
    await p.screenshot({ path: '/tmp/claude-0/pos-salvar.png' });
    R.GEO08_salvos = await p.evaluate(() => window.__E2E__.salvos);
    console.log('TOASTS', await p.$$eval('[data-sonner-toast]', (e) => e.map((x) => x.textContent)));
    const gravada = await p.evaluate(() => JSON.parse(sessionStorage.getItem('e2e-areas-salvas'))[0]);
    R.GEO08_formato_persistido = { coordsIsArrayLatLng: Array.isArray(gravada.coordenadas.coords[0]), n: gravada.coordenadas.coords.length, cor: gravada.coordenadas.cor, tamanho_hectares: gravada.tamanho_hectares, nome: gravada.nome };
    R.GEO08_coords_iguais_ao_desenho = mesmo(gravada.coordenadas.coords, desenhados);

    // reabrir (novo carregamento da página) → editar
    await p.goto(URL + '?cena=editar-salva');
    await p.waitForSelector('[data-testid=medidas-area]', { timeout: 30000 });
    await p.waitForTimeout(600);
    await idle(p);
    const reabertos = await verticesLatLng(p);
    R.GEO08_reaberto_coords_iguais = mesmo(reabertos, gravada.coordenadas.coords);
    R.GEO08_reaberto_desenho = await desenhoInfo(p);
    R.GEO08_reaberto_medidas = await p.textContent('[data-testid=medidas-area]');
    await p.screenshot({ path: path.join(OUT, 'r1-geo08-reaberto.png') });
    // arrastar vértice 2 e salvar
    const v2 = await p.evaluate(() => { const m = window.__E2E_MAPS__.at(-1); const c = m.getSource('m1-vertices').serialize().data.features[2].geometry.coordinates; const q = m.project(c); const r = m.getCanvas().getBoundingClientRect(); return [r.left + q.x, r.top + q.y]; });
    await p.mouse.move(v2[0], v2[1]); await p.mouse.down(); await p.mouse.move(v2[0] + 70, v2[1] + 40, { steps: 10 }); await p.mouse.up();
    await idle(p);
    const editados = await verticesLatLng(p);
    R.GEO08_editado_medidas = await p.textContent('[data-testid=medidas-area]');
    await p.click('button:has-text("Salvar")');
    await preencherESalvar(p, { novo: false });
    const regravada = await p.evaluate(() => JSON.parse(sessionStorage.getItem('e2e-areas-salvas'))[0]);
    R.GEO08_regravada_coords_iguais_editado = mesmo(regravada.coordenadas.coords, editados);
    R.GEO08_regravada_mesmo_id = regravada.id === gravada.id;
    R.GEO08_regravada_cor_preservada = regravada.coordenadas.cor === gravada.coordenadas.cor;
    await p.goto(URL + '?cena=editar-salva');
    await p.waitForSelector('[data-testid=medidas-area]', { timeout: 30000 });
    await p.waitForTimeout(600);
    await idle(p);
    R.GEO08_reaberto2_coords_iguais = mesmo(await verticesLatLng(p), regravada.coordenadas.coords);
    R.GEO08_reaberto2_medidas = await p.textContent('[data-testid=medidas-area]');
    R.GEO08_reaberto2_desenho = await desenhoInfo(p);
    await p.screenshot({ path: path.join(OUT, 'r1-geo08-reaberto-apos-edicao.png') });
    R.GEO08_erros = erros.slice(0, 5);
    await ctx.close();
  }

  // ───────────── GEO-09
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(URL + '?cena=geral');
    await p.waitForFunction(() => document.querySelectorAll('.mg-area-label').length >= 3, null, { timeout: 30000 });
    await idle(p);
    const snap = () => p.evaluate(() => {
      const m = window.__E2E_MAPS__.at(-1);
      return {
        labels: [...document.querySelectorAll('.mg-area-label')].map((e) => e.firstChild.textContent),
        lotes: [...document.querySelectorAll('.mg-lote-count')].map((e) => e.textContent),
        fonteAreas: m.getSource('mg-areas').serialize().data.features.map((f) => f.properties.id),
        pintadas: [...new Set(m.queryRenderedFeatures({ layers: ['mg-areas-fill'] }).map((f) => f.properties.id))].sort(),
      };
    });
    R.GEO09_A = await snap();
    await p.evaluate(() => { window.__E2E_ATRASO__ = 1500; window.__E2E_EMPRESA__ = 'emp-b'; window.dispatchEvent(new Event('e2e-empresa')); });
    await p.waitForTimeout(400);
    R.GEO09_B_pendente = await snap();
    await p.waitForFunction(() => [...document.querySelectorAll('.mg-area-label')].some((e) => e.textContent.includes('RETIRO B1')), null, { timeout: 15000 });
    await p.waitForTimeout(1500);
    await idle(p);
    R.GEO09_B = await snap();
    await p.screenshot({ path: path.join(OUT, 'r1-geo09-empresa-b.png') });
    await p.evaluate(() => { window.__E2E_EMPRESA__ = 'emp-e2e'; window.dispatchEvent(new Event('e2e-empresa')); });
    await p.waitForTimeout(400);
    R.GEO09_A2_pendente = await snap();
    await p.waitForFunction(() => document.querySelectorAll('.mg-area-label').length >= 3, null, { timeout: 15000 });
    await p.waitForTimeout(1200);
    await idle(p);
    R.GEO09_A2 = await snap();
    R.GEO09_visao_por_empresa = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mapa_geral_view_')).sort());
    await p.close();
  }

  fs.writeFileSync(path.join(OUT, 'r1-geo2-resultado.json'), JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error('FALHA', e); process.exit(1); });
