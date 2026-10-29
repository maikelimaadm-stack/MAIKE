/**
 * MAPLIBRE-EDITOR-PONTOS-FINALIZACAO-02 (D-PROD-67) — ciclo de fechar/finalizar
 * polígono com WebGL real (Chromium + SwiftShader), estados A–E:
 *  A aberto · B fechar pelo comando de finalização · C edição de existente ·
 *  D formulário aberto (prévia sem manipuladores, cor do formulário, cancelar) ·
 *  E salvar (editor encerra) → área no estado normal → reabrir.
 * Referência de comportamento: CONTROLE-DE-ESTOQUE `editor-contorno.tsx` (confirmar/sairDoDesenho).
 * Dados sintéticos do harness — NÃO é o app autenticado.
 *
 * Uso: npx vite --config tests/e2e/harness/vite.e2e.config.mjs
 *      E2E_FASE=antes|depois node tests/e2e/harness/run-editor-finalizacao.cjs
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const FASE = process.env.E2E_FASE || 'depois';
const OUT = path.resolve(process.env.E2E_OUT || path.resolve(__dirname, '../../../docs/engineering/evidencias/maplibre-editor-finalizacao'), FASE);
const URL = process.env.E2E_URL || 'http://localhost:5199/';

const idle = (p) => p.evaluate(() => new Promise((res) => {
  const m = window.__E2E_MAPS__.at(-1);
  if (!m) return res();
  if (m.loaded() && !m.isMoving()) return setTimeout(res, 150);
  m.once('idle', () => setTimeout(res, 150));
}));

/** Estado observável do editor: fontes, feições pintadas, overlay, formulário. */
const estado = (p) => p.evaluate(() => {
  const m = window.__E2E_MAPS__.at(-1);
  const editor = !!document.querySelector('[data-testid=mapa-desenho-maplibre]');
  const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; };
  if (!m || !editor || !m.getSource('m1-desenho')) return { editor, dialogo: !!document.querySelector('[role=dialog][data-state=open]') };
  const feats = (id) => m.getSource(id).serialize().data.features;
  const poly = feats('m1-desenho').find((f) => f.geometry.type === 'Polygon');
  const pintadas = (l) => (m.getLayer(l) ? m.queryRenderedFeatures({ layers: [l] }).length : null);
  return {
    editor,
    dialogo: !!document.querySelector('[role=dialog][data-state=open]'),
    desenho: feats('m1-desenho').map((f) => ({ geom: f.geometry.type, fechado: f.properties.fechado ?? null, contorno: f.properties.contorno ?? null, fill: f.properties.fill ?? null })),
    anel_n: poly ? poly.geometry.coordinates[0].length : 0,
    vertices: feats('m1-vertices').length,
    selecionados: feats('m1-vertices').filter((f) => f.properties.selecionado).length,
    meios: feats('m1-midpoints').length,
    guia: feats('m1-guia').length,
    pintado: { fill: pintadas('m1-desenho-fill'), linha: pintadas('m1-desenho-line'), vertices: pintadas('m1-vertices'), meios: pintadas('m1-midpoints'), selecao: pintadas('m1-vertices-selecao') },
    overlay: { cruz: vis('[data-testid=editor-cruzinha]'), ima: vis('[data-testid=editor-ima]') },
    botao_finalizar: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => ['Terminar', 'Fechar área', 'Salvar'].includes(t)) || null,
    modo_editar: document.querySelector('[aria-label="Editar pontos"]')?.getAttribute('aria-pressed') ?? null,
    areas_cadastradas: feats('m1-areas').map((f) => ({ id: f.properties.id, fill: f.properties.fill })),
  };
});

const verticesLatLng = (p) => p.evaluate(() => window.__E2E_MAPS__.at(-1).getSource('m1-vertices').serialize().data.features.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]]));
const mesmo = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v[0] - b[i][0]) < 1e-12 && Math.abs(v[1] - b[i][1]) < 1e-12);
const botaoFinal = (p) => p.locator('button').filter({ hasText: /^(Terminar|Fechar área|Salvar)$/ }).first();

async function abrir(ctx, cena, limpar) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') erros.push(`console.error: ${m.text()}`); });
  await p.goto(`${URL}?cena=${cena}`);
  if (limpar) { await p.evaluate(() => sessionStorage.clear()); await p.reload(); }
  await p.waitForFunction(() => window.__E2E_MAPS__?.length && window.__E2E_MAPS__.at(-1).getLayer('m1-vertices'), null, { timeout: 30000 });
  await p.waitForTimeout(cena.startsWith('editar') ? 1300 : 700);
  await idle(p);
  return { p, erros };
}

async function preencherFormularioNovo(p, cor) {
  const inputs = p.locator('[role=dialog] input');
  const combos = p.locator('[role=dialog] button[role=combobox]');
  await inputs.nth(1).fill('1');
  await inputs.nth(2).fill('piquete d67');
  await combos.nth(0).click(); await p.click('[role=option]:has-text("Setor E2E")');
  await combos.nth(2).click(); await p.click('[role=option]:has-text("Brachiaria")');
  if (cor) { await combos.nth(4).click(); await p.click(`[role=option]:has-text("${cor}")`); }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const R = { fase: FASE, gerado_em: new Date().toISOString(), cenas: {} };
  const shot = (p, nome) => p.screenshot({ path: path.join(OUT, `${nome}.png`) });

  // ───────── Desktop 1440: A → B → D → cancelar → D → salvar → E
  for (const [w, h, toque] of [[1440, 900, false], [390, 844, true], [412, 915, true]]) {
    const tag = `${w}`;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: toque, hasTouch: toque });
    const { p, erros } = await abrir(ctx, 'desenho', true);
    const tocar = (x, y) => (toque ? p.touchscreen.tap(x, y) : p.mouse.click(x, y));
    const cx = w / 2, cy = h * 0.45, dx = Math.min(140, w * 0.28), dy = Math.min(100, h * 0.12);
    const P = [[cx - dx, cy - dy], [cx + dx, cy - dy * 0.9], [cx + dx * 0.9, cy + dy], [cx - dx * 0.9, cy + dy * 1.05]];
    for (const [x, y] of P) { await tocar(x, y); await p.waitForTimeout(250); }
    if (!toque) await p.mouse.move(cx + dx * 1.6, cy + dy * 1.5, { steps: 3 });
    await idle(p);
    R.cenas[`${tag}_A_aberto`] = await estado(p);
    await shot(p, `${tag}-A-aberto-4-pontos`);
    const desenhados = await verticesLatLng(p);

    // B: comando de finalização com o polígono aberto
    const rotuloB = await botaoFinal(p).textContent();
    await botaoFinal(p).click();
    await p.waitForTimeout(600); await idle(p);
    R.cenas[`${tag}_B_apos_1o_comando`] = { rotulo_clicado: rotuloB.trim(), ...(await estado(p)) };
    await shot(p, `${tag}-B-apos-1o-comando`);
    // fecha o formulário se a versão antiga o abriu, para seguir o mesmo roteiro
    if (await p.locator('[role=dialog]').count()) {
      R.cenas[`${tag}_B_apos_1o_comando`].formulario_abriu_com_poligono_aberto = true;
      await p.keyboard.press('Escape'); await p.waitForTimeout(500); await idle(p);
    }

    // D: comando seguinte → formulário com prévia
    await botaoFinal(p).click();
    await p.waitForSelector('[role=dialog] form', { timeout: 10000 });
    await p.waitForTimeout(700); await idle(p);
    R.cenas[`${tag}_D_formulario`] = await estado(p);
    await shot(p, `${tag}-D-formulario-previa`);
    if (!toque) {
      await preencherFormularioNovo(p, 'Laranja');
      await p.waitForTimeout(400); await idle(p);
      R.cenas[`${tag}_D_formulario_cor_laranja`] = await estado(p);
      await shot(p, `${tag}-D-formulario-cor-escolhida`);
    }
    // cancelar (botão Cancelar do formulário)
    await p.locator('[role=dialog] button:has-text("Cancelar")').click();
    await p.waitForTimeout(600); await idle(p);
    const aposCancelar = await verticesLatLng(p);
    R.cenas[`${tag}_D_cancelado`] = { ...(await estado(p)), geometria_intacta: mesmo(aposCancelar, desenhados) };
    await shot(p, `${tag}-D-cancelado-edicao-restaurada`);

    if (!toque) {
      // tentativa de mexer no desenho "por trás" do formulário: abre e clica no mapa fora do Sheet
      await botaoFinal(p).click();
      await p.waitForSelector('[role=dialog] form', { timeout: 10000 });
      await p.waitForTimeout(500);
      await p.mouse.click(P[0][0] + 5, P[0][1] + 5); // perto do 1º vértice
      await p.waitForTimeout(600); await idle(p);
      R.cenas[`${tag}_D_clique_fora`] = { ...(await estado(p)), geometria_intacta: mesmo(await verticesLatLng(p), desenhados) };

      // salvar de verdade
      await botaoFinal(p).click();
      await p.waitForSelector('[role=dialog] form', { timeout: 10000 });
      await preencherFormularioNovo(p, 'Laranja');
      await p.click('[role=dialog] button[type=submit]');
      await p.waitForTimeout(1200);
      const salva = await p.evaluate(() => JSON.parse(sessionStorage.getItem('e2e-areas-salvas') || '[]').at(-1) || null);
      R.cenas[`${tag}_E_salvo`] = {
        ...(await estado(p)),
        listagem: await p.locator('[data-testid=harness-listagem]').count(),
        overlay_no_dom: await p.locator('[data-testid=editor-overlay]').count(),
        salva: salva ? { cor: salva.coordenadas.cor, n: salva.coordenadas.coords.length, coords_iguais_ao_desenho: mesmo(salva.coordenadas.coords, desenhados) } : null,
      };
      await shot(p, `${tag}-E-salvo-editor-encerrado`);

      // área persistida em estado normal (nova sessão de desenho mostra as cadastradas)
      await p.goto(`${URL}?cena=desenho`);
      await p.waitForFunction(() => window.__E2E_MAPS__?.at(-1)?.getLayer('m1-vertices'), null, { timeout: 30000 });
      await p.waitForTimeout(900); await idle(p);
      const st = await estado(p);
      R.cenas[`${tag}_E_area_normal`] = { ...st, salva_no_mapa: st.areas_cadastradas.find((a) => a.id === salva?.id) || null };
      await p.click('button[aria-label="Navegar no mapa"]'); await p.waitForTimeout(400); await idle(p);
      await shot(p, `${tag}-E-area-salva-estado-normal`);

      // reabrir edição
      await p.goto(`${URL}?cena=editar-salva`);
      await p.waitForSelector('[data-testid=medidas-area]', { timeout: 30000 });
      await p.waitForTimeout(1300); await idle(p);
      R.cenas[`${tag}_E_reaberto`] = { ...(await estado(p)), coords_iguais: mesmo(await verticesLatLng(p), salva.coordenadas.coords) };
      await shot(p, `${tag}-E-reaberto-manipuladores`);
    }
    R.cenas[`${tag}_erros`] = erros.slice(0, 6);
    await ctx.close();
  }

  // ───────── C: área existente (cor salva) → Salvar → prévia → cancelar
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const { p, erros } = await abrir(ctx, 'editar', true);
    const antes = await verticesLatLng(p);
    R.cenas.C_existente_edicao = await estado(p);
    await shot(p, 'C-existente-edicao-manipuladores');
    await botaoFinal(p).click();
    await p.waitForSelector('[role=dialog] form', { timeout: 10000 });
    await p.waitForTimeout(700); await idle(p);
    R.cenas.C_existente_formulario = await estado(p);
    await shot(p, 'C-existente-formulario-previa');
    await p.locator('[role=dialog] button:has-text("Cancelar")').click();
    await p.waitForTimeout(600); await idle(p);
    R.cenas.C_existente_cancelado = { ...(await estado(p)), geometria_intacta: mesmo(await verticesLatLng(p), antes) };
    R.cenas.C_erros = erros.slice(0, 6);
    await ctx.close();
  }

  fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, (k, v) => (k === 'areas_cadastradas' ? undefined : v), 1));
  await b.close();
})().catch((e) => { console.error('FALHA', e); process.exit(1); });
