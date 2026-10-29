/**
 * MAPLIBRE-PONTOS-MÉDIOS-NO-CADASTRO-03 (D-PROD-68) — pontos médios no cadastro
 * de área ainda ABERTA, com WebGL real (Chromium + SwiftShader).
 * Referência: CONTROLE-DE-ESTOQUE `editor-desenho.ts` (`acertar`: aberto = n−1
 * meios) e `editor-contorno.tsx` (`aoPressionar` no meio cria e arrasta o vértice).
 * Dados sintéticos do harness — NÃO é o app autenticado.
 *
 * Uso: npx vite --config tests/e2e/harness/vite.e2e.config.mjs
 *      E2E_FASE=antes|depois node tests/e2e/harness/run-editor-meios-cadastro.cjs
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const FASE = process.env.E2E_FASE || 'depois';
const OUT = path.resolve(process.env.E2E_OUT || path.resolve(__dirname, '../../../docs/engineering/evidencias/maplibre-meios-cadastro'), FASE);
const URL = process.env.E2E_URL || 'http://localhost:5199/';

const idle = (p) => p.evaluate(() => new Promise((res) => {
  const m = window.__E2E_MAPS__.at(-1);
  if (m.loaded() && !m.isMoving()) return setTimeout(res, 150);
  m.once('idle', () => setTimeout(res, 150));
}));

/** Vértices/meios em lat,lng + px, estado de hover, formulário aberto. */
const estado = (p) => p.evaluate(() => {
  const m = window.__E2E_MAPS__.at(-1);
  const fc = (id) => m.getSource(id).serialize().data.features;
  const comPx = (f) => { const q = m.project(f.geometry.coordinates); return { id: f.properties.id, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], x: q.x, y: q.y }; };
  return {
    vertices: fc('m1-vertices').map(comPx),
    meios: fc('m1-midpoints').map((f) => ({ ...comPx(f), hover: !!m.getFeatureState({ source: 'm1-midpoints', id: f.properties.id }).hover })),
    meios_pintados: m.queryRenderedFeatures({ layers: ['m1-midpoints'] }).length,
    desenho: fc('m1-desenho').map((f) => ({ geom: f.geometry.type, fechado: f.properties.fechado ?? null })),
    dialogo: !!document.querySelector('[role=dialog][data-state=open]'),
    cruz: (() => { const e = document.querySelector('[data-testid=editor-cruzinha]'); return !!e && getComputedStyle(e).display !== 'none'; })(),
    botao: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => ['Terminar', 'Fechar área', 'Salvar'].includes(t)) || null,
  };
});

const meio = (a, b) => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
const igual = (a, b) => Math.abs(a.lat - b.lat) < 1e-12 && Math.abs(a.lng - b.lng) < 1e-12;
/** Meios só nas arestas consecutivas? (nenhum no último→primeiro enquanto aberto) */
function conferirMeios(st, fechado) {
  const v = st.vertices;
  const esperados = [];
  const n = fechado ? v.length : v.length - 1;
  for (let i = 0; i < n; i += 1) esperados.push(meio(v[i], v[(i + 1) % v.length]));
  const fecho = v.length >= 3 ? meio(v[v.length - 1], v[0]) : null;
  return {
    n_meios: st.meios.length,
    n_esperado: esperados.length,
    todos_nas_arestas: st.meios.length === esperados.length && st.meios.every((m, i) => igual(m, esperados[i])),
    meio_de_fecho_presente: !!fecho && st.meios.some((m) => igual(m, fecho)),
  };
}

async function abrir(ctx) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') erros.push(`console.error: ${m.text()}`); });
  await p.goto(`${URL}?cena=desenho`);
  await p.evaluate(() => sessionStorage.clear());
  await p.reload();
  await p.waitForFunction(() => window.__E2E_MAPS__?.length && window.__E2E_MAPS__.at(-1).getLayer('m1-vertices'), null, { timeout: 30000 });
  await p.waitForTimeout(700);
  await idle(p);
  return { p, erros };
}

/** Arrasto por toque real (CDP), com movimento acima do limiar. */
async function arrastarToque(p, de, para) {
  const c = await p.context().newCDPSession(p);
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: de.x, y: de.y }] });
  for (let k = 1; k <= 8; k += 1) {
    await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: de.x + ((para.x - de.x) * k) / 8, y: de.y + ((para.y - de.y) * k) / 8 }] });
    await p.waitForTimeout(16);
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const R = { fase: FASE, gerado_em: new Date().toISOString(), cenas: {} };

  for (const [w, h, toque] of [[1440, 900, false], [390, 844, true], [412, 915, true]]) {
    const tag = String(w);
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: toque, hasTouch: toque });
    const { p, erros } = await abrir(ctx);
    const tocar = (x, y) => (toque ? p.touchscreen.tap(x, y) : p.mouse.click(x, y));
    const shot = (n) => p.screenshot({ path: path.join(OUT, `${tag}-${n}.png`) });
    const cx = w / 2, cy = h * 0.45, dx = Math.min(150, w * 0.3), dy = Math.min(110, h * 0.13);
    const P = [[cx - dx, cy - dy], [cx + dx, cy - dy * 0.9], [cx + dx * 0.9, cy + dy], [cx - dx * 0.9, cy + dy * 1.05]];
    const C = {};
    R.cenas[tag] = C;

    // 2 pontos → 1 meio
    for (const [x, y] of P.slice(0, 2)) { await tocar(x, y); await p.waitForTimeout(250); }
    if (!toque) await p.mouse.move(cx, cy + dy * 2.2);
    await idle(p);
    let st = await estado(p);
    C.a_2_pontos = { n_vertices: st.vertices.length, ...conferirMeios(st, false), meios_pintados: st.meios_pintados };
    await shot('01-aberto-2-pontos');

    // 4 pontos → 3 meios, sem o de fecho
    for (const [x, y] of P.slice(2)) { await tocar(x, y); await p.waitForTimeout(250); }
    if (!toque) await p.mouse.move(cx, cy + dy * 2.2);
    await idle(p);
    st = await estado(p);
    C.b_4_pontos = { n_vertices: st.vertices.length, ...conferirMeios(st, false), meios_pintados: st.meios_pintados };
    await shot('02-aberto-4-pontos');
    const antes4 = st.vertices;

    // hover do meio 0 (desktop)
    if (!toque && st.meios[0]) {
      await p.mouse.move(st.meios[0].x + 6, st.meios[0].y, { steps: 3 });
      await idle(p);
      const sh = await estado(p);
      C.c_hover_meio = { hover: sh.meios[0]?.hover ?? null, cruz_visivel: sh.cruz };
      await shot('03-hover-meio');
    }

    // clique/toque no meio 0 (P0–P1), fora do centro (5–10 px)
    if (st.meios[0]) {
      const alvo = { x: st.meios[0].x + (toque ? 10 : 5), y: st.meios[0].y };
      const esperado = meio(antes4[0], antes4[1]);
      await tocar(alvo.x, alvo.y);
      await p.waitForTimeout(450); await idle(p);
      const si = await estado(p);
      C.d_inserir_no_meio = {
        n_vertices: si.vertices.length,
        novo_no_indice_1_exato: !!si.vertices[1] && igual(si.vertices[1], esperado),
        ultimo_continua_P3: !!si.vertices.at(-1) && igual(si.vertices.at(-1), antes4[3]),
        sem_ponto_final_extra: si.vertices.length === 5,
        ...conferirMeios(si, false),
      };
      await shot('04-inserido-no-meio');
    }

    // clique em área vazia continua adicionando ao fim
    const vazio = [cx - dx * 0.2, cy + dy * 1.9];
    const antesVazio = (await estado(p)).vertices;
    await tocar(vazio[0], vazio[1]); await p.waitForTimeout(350); await idle(p);
    let sv = await estado(p);
    C.e_clique_vazio = { n_antes: antesVazio.length, n_depois: sv.vertices.length, primeiros_iguais: antesVazio.every((v, i) => igual(v, sv.vertices[i])), ...conferirMeios(sv, false) };

    // desfazer 2x volta aos 4 pontos originais
    if (!toque) {
      await p.click('button:has-text("Desfazer")'); await p.waitForTimeout(250);
      await p.click('button:has-text("Desfazer")'); await p.waitForTimeout(250); await idle(p);
      const su = await estado(p);
      C.f_desfazer_2x = { n_vertices: su.vertices.length, iguais_aos_4_originais: su.vertices.length === 4 && su.vertices.every((v, i) => igual(v, antes4[i])) };
      await p.click('button:has-text("Refazer")'); await p.waitForTimeout(250); await idle(p);
      C.f_refazer = { n_vertices: (await estado(p)).vertices.length };
    }

    // arrastar um meio: cria o vértice e o move (sem duplicar)
    sv = await estado(p);
    const mArr = sv.meios.at(-1);
    if (mArr) {
      const nAntes = sv.vertices.length;
      const destino = { x: mArr.x + 30, y: mArr.y + 40 };
      if (toque) {
        await arrastarToque(p, { x: mArr.x, y: mArr.y }, destino);
      } else {
        // Alt suspende o ímã: mede a posição crua do arrasto (com ímã, gruda em área vizinha)
        await p.keyboard.down('Alt');
        await p.mouse.move(mArr.x, mArr.y); await p.mouse.down();
        await p.mouse.move(destino.x, destino.y, { steps: 8 });
        await idle(p);
        const durante = await estado(p);
        C.g_durante_arrasto = { n_vertices: durante.vertices.length, n_meios: durante.meios.length };
        await shot('05-arrastando-meio');
        await p.mouse.up();
        await p.keyboard.up('Alt');
      }
      await p.waitForTimeout(450); await idle(p);
      const sa = await estado(p);
      const novo = sa.vertices.find((v) => Math.hypot(v.x - destino.x, v.y - destino.y) < 3);
      C.g_arrastar_meio = { n_antes: nAntes, n_depois: sa.vertices.length, um_so_novo: sa.vertices.length === nAntes + 1, novo_no_destino: !!novo, ...conferirMeios(sa, false) };
      await shot('06-meio-arrastado');
    }

    // Fechar área → meio de fecho aparece
    const rot = (await estado(p)).botao;
    if (rot === 'Fechar área' || rot === 'Terminar') {
      await p.locator('button').filter({ hasText: /^(Fechar área|Terminar)$/ }).first().click();
      await p.waitForTimeout(600);
      if (await p.locator('[role=dialog][data-state=open]').count()) { C.h_fechar_abriu_formulario = true; await p.keyboard.press('Escape'); await p.waitForTimeout(500); }
      await idle(p);
      const sf = await estado(p);
      C.h_fechado = { rotulo: rot, ...conferirMeios(sf, true), desenho: sf.desenho };
      await shot('07-fechado');

      // formulário (prévia) sem manipuladores; cancelar restaura
      await p.locator('button').filter({ hasText: /^Salvar$/ }).first().click();
      await p.waitForSelector('[role=dialog] form', { timeout: 10000 });
      await p.waitForTimeout(600); await idle(p);
      const sp = await estado(p);
      C.i_previa = { n_vertices: sp.vertices.length, n_meios: sp.meios.length, dialogo: sp.dialogo };
      await shot('08-previa-formulario');
      await p.locator('[role=dialog] button:has-text("Cancelar")').click();
      await p.waitForTimeout(600); await idle(p);
      const sc = await estado(p);
      C.j_cancelado = { n_vertices: sc.vertices.length, iguais: sc.vertices.length === sf.vertices.length && sc.vertices.every((v, i) => igual(v, sf.vertices[i])), ...conferirMeios(sc, true) };
    }
    C.erros = erros.slice(0, 6);
    await ctx.close();
  }

  // área existente (regressão): meios incluem o de fecho, como antes
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const erros = [];
    p.on('pageerror', (e) => erros.push(String(e)));
    await p.goto(`${URL}?cena=editar`);
    await p.waitForSelector('[data-testid=medidas-area]', { timeout: 30000 });
    await p.waitForTimeout(1300); await idle(p);
    const st = await estado(p);
    R.cenas.existente = { n_vertices: st.vertices.length, ...conferirMeios(st, true), erros };
    await p.screenshot({ path: path.join(OUT, 'existente-edicao.png') });
    await ctx.close();
  }

  fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error('FALHA', e); process.exit(1); });
