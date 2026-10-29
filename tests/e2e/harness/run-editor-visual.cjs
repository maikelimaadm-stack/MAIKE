/**
 * MAPLIBRE-EDITOR-PARIDADE-VISUAL-01 — prova visual do editor de polígonos com
 * WebGL real (Chromium + SwiftShader) contra a referência CONTROLE-DE-ESTOQUE
 * (`camada-desenho.tsx` @6aef845e).
 *
 * Mede no PNG (não no helper): solidez da linha elástica, raios visíveis de
 * vértice/meio, presença do anel/cruz do ímã, guia Shift; registra paint/layout
 * das camadas e estado de overlay. Dados sintéticos do harness — NÃO é o app
 * autenticado.
 *
 * Uso: npx vite --config tests/e2e/harness/vite.e2e.config.mjs
 *      E2E_FASE=antes|depois node tests/e2e/harness/run-editor-visual.cjs
 */
const { chromium } = require('playwright');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const FASE = process.env.E2E_FASE || 'depois';
const OUT = path.resolve(process.env.E2E_OUT || path.resolve(__dirname, '../../../docs/engineering/evidencias/maplibre-editor-visual'), FASE);
const URL = process.env.E2E_URL || 'http://localhost:5199/';
const DPR = 2;
const CAMADAS = ['m1-desenho-fill', 'm1-desenho-line', 'm1-ima-aresta-halo', 'm1-ima-aresta', 'm1-guia', 'm1-guia-shift', 'm1-midpoints', 'm1-vertices-selecao', 'm1-vertices'];

/** Decodificador PNG mínimo (RGB/RGBA 8 bits) — sem dependência nova. */
function decodePng(buf) {
  let p = 8;
  let w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y += 1) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, at: (x, y) => { const i = Math.round(y) * stride + Math.round(x) * bpp; return [px[i], px[i + 1], px[i + 2]]; } };
}

/** Laranja do desenho (#f5a01b) — tolerante a antialias. */
const laranja = ([r, g, b]) => r > 200 && g > 110 && g < 200 && b < 110;
const branco = ([r, g, b]) => r > 225 && g > 225 && b > 225;

/** Fração de pixels laranja ao longo do segmento (em CSS px), ignorando as pontas. */
function solidez(png, a, b, margem = 12) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < margem * 2 + 4) return null;
  let tot = 0, ok = 0;
  for (let d = margem; d <= len - margem; d += 1) {
    const t = d / len;
    const x = (a.x + (b.x - a.x) * t) * DPR, y = (a.y + (b.y - a.y) * t) * DPR;
    tot += 1;
    // linha 2.2px → olha a vizinhança perpendicular de ±1 px do dispositivo
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    if ([-1, 0, 1].some((k) => laranja(png.at(x + nx * k, y + ny * k)))) ok += 1;
  }
  return Number((ok / tot).toFixed(3));
}

/** Raio visível (CSS px): extensão de pixels do círculo a partir do centro, média de 4 direções. */
function raio(png, c, aceita) {
  // 8 direções; mediana — linhas que saem do ponto ocupam no máximo 2–3 direções.
  const s2 = Math.SQRT1_2;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [s2, s2], [-s2, s2], [s2, -s2], [-s2, -s2]];
  const r = dirs.map(([dx, dy]) => {
    let k = 0;
    while (k <= 14 * DPR && aceita(png.at(c.x * DPR + dx * k, c.y * DPR + dy * k))) k += 1;
    return k / DPR;
  }).sort((a, b) => a - b);
  return Number(((r[3] + r[4]) / 2).toFixed(2));
}

/** Vértice: raio do miolo branco e raio externo do anel laranja. */
function medirVertice(png, c) {
  const branco0 = raio(png, c, (p) => branco(p));
  const externo = raio(png, c, (p) => laranja(p) || branco(p));
  return { miolo_branco: branco0, externo };
}

async function idle(p) {
  await p.evaluate(() => new Promise((res) => {
    const m = window.__E2E_MAPS__.at(-1);
    if (m.loaded() && !m.isMoving()) return setTimeout(res, 120);
    m.once('idle', () => setTimeout(res, 120));
  }));
}

async function estado(p) {
  return p.evaluate((camadas) => {
    const m = window.__E2E_MAPS__.at(-1);
    const layers = {};
    for (const id of camadas) {
      const l = m.getLayer(id);
      if (!l) { layers[id] = null; continue; }
      const paint = {}; const layout = {};
      const tipo = l.type;
      const chaves = {
        line: { paint: ['line-color', 'line-width', 'line-opacity', 'line-dasharray'], layout: ['line-cap', 'line-join'] },
        circle: { paint: ['circle-radius', 'circle-color', 'circle-opacity', 'circle-stroke-color', 'circle-stroke-width', 'circle-stroke-opacity'], layout: [] },
        fill: { paint: ['fill-color', 'fill-opacity'], layout: [] },
      }[tipo] || { paint: [], layout: [] };
      chaves.paint.forEach((k) => { const v = m.getPaintProperty(id, k); if (v !== undefined) paint[k] = v; });
      chaves.layout.forEach((k) => { const v = m.getLayoutProperty(id, k); if (v !== undefined) layout[k] = v; });
      layers[id] = { tipo, filter: m.getFilter(id) ?? null, paint, layout, renderizadas: m.queryRenderedFeatures({ layers: [id] }).length };
    }
    const ordem = m.getStyle().layers.map((l) => l.id).filter((id) => id.startsWith('m1-'));
    const fonte = (id) => (m.getSource(id) ? m.getSource(id).serialize().data.features : []);
    const desenho = fonte('m1-desenho').map((f) => ({ geom: f.geometry.type, props: f.properties }));
    const guia = fonte('m1-guia').map((f) => ({ geom: f.geometry.type, props: f.properties }));
    const verticesState = fonte('m1-vertices').map((f) => ({ id: f.properties.id, props: f.properties, state: m.getFeatureState({ source: 'm1-vertices', id: f.properties.id }) }));
    const meiosState = fonte('m1-midpoints').map((f) => ({ id: f.properties.id, state: m.getFeatureState({ source: 'm1-midpoints', id: f.properties.id }) }));
    const q = (s) => document.querySelector(s);
    const vis = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getAttribute('visibility') !== 'hidden';
    const overlay = {
      existe: !!q('[data-testid=editor-overlay]'),
      pointerEvents: q('[data-testid=editor-overlay]') ? getComputedStyle(q('[data-testid=editor-overlay]')).pointerEvents : null,
      cruzinha: vis(q('[data-testid=editor-cruzinha]')),
      ima: vis(q('[data-testid=editor-ima]')) ? q('[data-testid=editor-ima]').getAttribute('data-tipo') : null,
      rumo: vis(q('[data-testid=editor-rumo]')) ? q('[data-testid=editor-rumo]').textContent : null,
    };
    return { layers, ordem, desenho, guia, vertices: verticesState, meios: meiosState, overlay, cursorCanvas: getComputedStyle(m.getCanvasContainer()).cursor };
  }, CAMADAS);
}

const px = (p, ll) => p.evaluate(([lng, lat]) => { const q = window.__E2E_MAPS__.at(-1).project([lng, lat]); return { x: q.x, y: q.y }; }, [ll.lng, ll.lat]);
const verticesPx = (p) => p.evaluate(() => { const m = window.__E2E_MAPS__.at(-1); return m.getSource('m1-vertices').serialize().data.features.map((f) => { const q = m.project(f.geometry.coordinates); return { x: q.x, y: q.y }; }); });
const meiosPx = (p) => p.evaluate(() => { const m = window.__E2E_MAPS__.at(-1); return m.getSource('m1-midpoints').serialize().data.features.map((f) => { const q = m.project(f.geometry.coordinates); return { x: q.x, y: q.y }; }); });
const areaPx = (p, id) => p.evaluate((id) => { const m = window.__E2E_MAPS__.at(-1); const f = m.getSource('m1-areas').serialize().data.features.find((x) => x.properties.id === id); return f ? f.geometry.coordinates[0].slice(0, 4).map((c) => { const q = m.project(c); return { x: q.x, y: q.y }; }) : null; }, id);

async function shot(p, nome, foco, raioCrop = 120) {
  const full = await p.screenshot();
  const arq = path.join(OUT, `${nome}.png`);
  if (foco) {
    const vp = p.viewportSize();
    const x = Math.max(0, Math.min(vp.width - raioCrop * 2, foco.x - raioCrop));
    const y = Math.max(0, Math.min(vp.height - raioCrop * 2, foco.y - raioCrop));
    await p.screenshot({ path: arq, clip: { x, y, width: raioCrop * 2, height: raioCrop * 2 } });
    fs.writeFileSync(path.join(OUT, `${nome}-tela.png`), full);
  } else {
    fs.writeFileSync(arq, full);
  }
  return decodePng(full);
}

async function abrir(ctx, cena, viewport) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' || /WebGL|GL_/i.test(m.text())) erros.push(`console.${m.type()}: ${m.text()}`); });
  await p.goto(`${URL}?cena=${cena}`);
  await p.waitForFunction(() => window.__E2E_MAPS__?.length && window.__E2E_MAPS__.at(-1).getLayer('m1-vertices'), null, { timeout: 30000 });
  await p.waitForTimeout(cena === 'editar' ? 1200 : 600);
  await idle(p);
  return { p, erros, viewport };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const R = { fase: FASE, gerado_em: new Date().toISOString(), cenas: {} };

  // ───────── Desktop 1440: desenho novo, fechamento, hover, meio, arrasto, navegar
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
    const { p, erros } = await abrir(ctx, 'desenho');
    const a1 = await areaPx(p, 'a1');
    const xs = a1.map((c) => c.x), ys = a1.map((c) => c.y);
    const bx = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const f = (fx, fy) => ({ x: Math.round(bx.x0 + (bx.x1 - bx.x0) * fx), y: Math.round(bx.y0 + (bx.y1 - bx.y0) * fy) });
    const P = [f(0.3, 0.3), f(0.7, 0.32), f(0.74, 0.72), f(0.32, 0.74)];

    await p.mouse.click(P[0].x, P[0].y); await p.waitForTimeout(150);
    await p.mouse.click(P[1].x, P[1].y); await p.waitForTimeout(150);
    const cursor = f(0.62, 0.62);
    await p.mouse.move(cursor.x - 20, cursor.y - 20); await p.mouse.move(cursor.x, cursor.y, { steps: 4 });
    await idle(p);
    let png = await shot(p, '01-aberto-2-pontos-elastico', { x: (P[1].x + cursor.x) / 2, y: (P[1].y + cursor.y) / 2 }, 160);
    const v01 = await verticesPx(p);
    R.cenas['01_aberto_2pts'] = {
      estado: await estado(p),
      elastico_solidez: solidez(png, v01[1], cursor),
      linha_P0_P1_solidez: solidez(png, v01[0], v01[1]),
      vertice: medirVertice(png, v01[0]),
      cruz_no_cursor: raio(png, cursor, laranja),
    };

    await p.mouse.click(P[2].x, P[2].y); await p.waitForTimeout(150);
    // 3 pontos abertos, cursor longe: o lado de fecho (P2→P0) NÃO deve ser contorno
    await p.mouse.move(P[2].x + 60, P[2].y + 40, { steps: 3 });
    await idle(p);
    png = await shot(p, '01b-aberto-3-pontos-sem-fecho', { x: (P[0].x + P[2].x) / 2, y: (P[0].y + P[2].y) / 2 }, 220);
    const v3 = await verticesPx(p);
    R.cenas['01b_aberto_3pts'] = { estado: await estado(p), lado_de_fecho_P2_P0_solidez: solidez(png, v3[2], v3[0]), pixel_interior: png.at(((v3[0].x + v3[1].x + v3[2].x) / 3) * DPR, ((v3[0].y + v3[1].y + v3[2].y) / 3) * DPR) };
    await p.mouse.click(P[3].x, P[3].y); await p.waitForTimeout(150);
    // aproxima do 1º ponto (ímã de fechamento)
    await p.mouse.move(P[0].x + 9, P[0].y + 7, { steps: 5 });
    await idle(p);
    png = await shot(p, '05b-ima-fechar-primeiro-ponto', P[0], 90);
    const v4 = await verticesPx(p);
    R.cenas['05b_ima_fechar'] = { estado: await estado(p), anel_no_primeiro: raio(png, v4[0], (q) => laranja(q) || branco(q)) };

    await p.mouse.click(P[0].x + 9, P[0].y + 7); await p.waitForTimeout(400);
    await p.mouse.move(10, 450); // tira o mouse do desenho
    await idle(p);
    png = await shot(p, '02-fechado', { x: (P[0].x + P[2].x) / 2, y: (P[0].y + P[2].y) / 2 }, 260);
    const vF = await verticesPx(p);
    const mF = await meiosPx(p);
    R.cenas['02_fechado'] = {
      estado: await estado(p),
      contorno_P3_P0_solidez: solidez(png, vF[3], vF[0]),
      vertice: medirVertice(png, vF[0]),
      meio: mF[0] ? raio(png, mF[0], laranja) : null,
    };

    // hover de vértice (EDITAR)
    await p.mouse.move(vF[1].x + 3, vF[1].y + 2, { steps: 3 });
    await idle(p);
    png = await shot(p, '03-hover-vertice', vF[1], 60);
    R.cenas['03_hover_vertice'] = { estado: await estado(p), vertice_hover: medirVertice(png, vF[1]), vertice_normal: medirVertice(png, vF[2]) };

    // hover do meio (6 px de distância — exige área de acerto ≥ 8 px)
    await p.mouse.move(mF[1].x + 6, mF[1].y, { steps: 3 });
    await idle(p);
    png = await shot(p, '04-meio-hover', mF[1], 60);
    R.cenas['04_meio_hover'] = { estado: await estado(p), meio_hover: raio(png, mF[1], laranja), meio_normal: raio(png, mF[2], laranja) };

    // inserir no meio com clique a 6 px (sem arrasto) → vértice exatamente no meio
    const nAntes = vF.length;
    await p.mouse.click(mF[1].x + 6, mF[1].y);
    await p.waitForTimeout(300); await idle(p);
    const vIns = await verticesPx(p);
    R.cenas['04b_inserir_no_meio'] = { vertices_antes: nAntes, vertices_depois: vIns.length, novo_vertice_px: vIns[2] || null, meio_px: mF[1], erro_px: vIns[2] ? Number(Math.hypot(vIns[2].x - mF[1].x, vIns[2].y - mF[1].y).toFixed(2)) : null };
    if (vIns.length > nAntes) { await p.click('button:has-text("Desfazer")'); await p.waitForTimeout(300); await idle(p); }

    // arrasto de vértice — captura com o botão pressionado
    const vD = await verticesPx(p);
    await p.mouse.move(vD[2].x, vD[2].y);
    await p.mouse.down();
    await p.mouse.move(vD[2].x + 40, vD[2].y + 25, { steps: 8 });
    await idle(p);
    png = await shot(p, '07-arrasto-vertice', { x: vD[2].x + 40, y: vD[2].y + 25 }, 90);
    R.cenas['07_arrasto'] = { estado: await estado(p), vertice_arrastado: medirVertice(png, { x: vD[2].x + 40, y: vD[2].y + 25 }) };
    await p.mouse.up(); await p.waitForTimeout(300); await idle(p);
    R.cenas['07_arrasto'].vertices_apos = (await verticesPx(p)).length;

    // NAVEGAR: pan não cria/move pontos; volta
    const antesPan = await verticesPx(p);
    await p.click('button[aria-label="Navegar no mapa"]');
    await p.mouse.move(700, 120); await p.mouse.down(); await p.mouse.move(560, 220, { steps: 10 }); await p.waitForTimeout(400); await p.mouse.up();
    await idle(p);
    const depoisPan = await verticesPx(p);
    png = await shot(p, '08-navegar-pan', null);
    R.cenas['08_navegar_pan'] = { estado: await estado(p), n_antes: antesPan.length, n_depois: depoisPan.length, deslocamento_px: { dx: Math.round(depoisPan[0].x - antesPan[0].x), dy: Math.round(depoisPan[0].y - antesPan[0].y) } };
    await p.mouse.move(560, 220); await p.mouse.down(); await p.mouse.move(700, 120, { steps: 10 }); await p.waitForTimeout(400); await p.mouse.up();
    await idle(p);
    const volta = await verticesPx(p);
    R.cenas['08_navegar_pan'].retorno_px = { dx: Math.round(volta[0].x - antesPan[0].x), dy: Math.round(volta[0].y - antesPan[0].y) };
    R.cenas['08_navegar_pan'].pintado_apos_retorno = (await estado(p)).layers['m1-desenho-fill']?.renderizadas;

    // MOVER: sem hover/cruz/ímã
    await p.click('button[aria-label="Mover área inteira"]');
    await p.mouse.move((volta[0].x + volta[2].x) / 2, (volta[0].y + volta[2].y) / 2, { steps: 3 });
    await idle(p);
    R.cenas['08b_mover_sem_efeitos'] = { estado: await estado(p) };
    R.cenas.desktop_erros = erros;
    await ctx.close();
  }

  // ───────── Ímã (vértice e aresta) e Shift 45° — desenho novo
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
    const { p, erros } = await abrir(ctx, 'desenho');
    const a1 = await areaPx(p, 'a1');
    const xs = a1.map((c) => c.x), ys = a1.map((c) => c.y);
    const P0 = { x: Math.round(Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * 0.5), y: Math.round(Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * 0.5) };
    await p.mouse.click(P0.x, P0.y); await p.waitForTimeout(200);

    const a3 = await areaPx(p, 'a3');
    // vértice: canto superior-esquerdo do CURRAL (a3[0]), aproximando por fora na diagonal
    const alvoV = a3[0];
    await p.mouse.move(alvoV.x - 30, alvoV.y - 30); await p.mouse.move(alvoV.x - 5, alvoV.y - 5, { steps: 5 });
    await idle(p);
    let png = await shot(p, '05-ima-vertice', alvoV, 80);
    R.cenas['05_ima_vertice'] = { alvo_px: alvoV, estado: await estado(p), anel_ou_cruz_no_alvo: raio(png, alvoV, laranja) };

    // aresta: meio do lado superior do CURRAL (a3[0]→a3[1])
    const alvoA = { x: (a3[0].x + a3[1].x) / 2, y: (a3[0].y + a3[1].y) / 2 };
    await p.mouse.move(alvoA.x, alvoA.y - 30); await p.mouse.move(alvoA.x + 3, alvoA.y - 7, { steps: 5 });
    await idle(p);
    png = await shot(p, '05-ima-aresta', alvoA, 100);
    R.cenas['05_ima_aresta'] = { alvo_px: alvoA, estado: await estado(p), aresta_destacada_solidez: solidez(png, { x: a3[0].x + 14, y: a3[0].y }, { x: alvoA.x - 20, y: alvoA.y }) };

    // Alt suspende o ímã
    await p.keyboard.down('Alt');
    await p.mouse.move(alvoA.x + 4, alvoA.y - 7, { steps: 2 });
    await idle(p);
    R.cenas['05c_alt_suspende'] = { estado: await estado(p) };
    await p.keyboard.up('Alt');

    // Shift 45°: cursor a ~30° do último ponto
    const alvoS = { x: P0.x + 160, y: P0.y - 92 };
    await p.keyboard.down('Shift');
    await p.mouse.move(alvoS.x - 10, alvoS.y + 5); await p.mouse.move(alvoS.x, alvoS.y, { steps: 4 });
    await idle(p);
    png = await shot(p, '06-shift-45-guia', { x: (P0.x + alvoS.x) / 2, y: (P0.y + alvoS.y) / 2 }, 150);
    const st = await estado(p);
    const elastico = st.guia.find((g) => g.props?.tipo === 'elastico' || !g.props?.tipo);
    R.cenas['06_shift'] = { estado: st };
    if (elastico) {
      const fimElastico = await p.evaluate(() => { const m = window.__E2E_MAPS__.at(-1); const f = m.getSource('m1-guia').serialize().data.features.find((g) => !g.properties.tipo || g.properties.tipo === 'elastico'); const q = m.project(f.geometry.coordinates[1]); return { x: q.x, y: q.y }; });
      R.cenas['06_shift'].elastico_solidez = solidez(png, P0, fimElastico);
      R.cenas['06_shift'].angulo_elastico_graus = Number((Math.atan2(-(fimElastico.y - P0.y), fimElastico.x - P0.x) * 180 / Math.PI).toFixed(2));
    }
    await p.keyboard.up('Shift');

    // sair do canvas limpa
    await p.mouse.move(alvoS.x, alvoS.y);
    await p.dispatchEvent('[data-testid=mapa-desenho-maplibre] canvas', 'mouseleave');
    await p.mouse.move(-5, -5);
    await p.waitForTimeout(150);
    R.cenas['06b_fora_do_canvas'] = { estado: await estado(p) };

    // pan durante desenho limpa elástico/cruz
    await p.mouse.move(900, 600); await p.waitForTimeout(80);
    await p.mouse.down(); await p.mouse.move(820, 560, { steps: 6 });
    R.cenas['06c_durante_pan'] = { estado: await estado(p) };
    await p.mouse.up(); await idle(p);
    R.cenas.ima_erros = erros;
    await ctx.close();
  }

  // ───────── Área existente aberta para edição (cor salva)
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
    const { p, erros } = await abrir(ctx, 'editar');
    await p.mouse.move(5, 450);
    await idle(p);
    const v = await verticesPx(p);
    const png = await shot(p, '09-area-existente-cor-salva', { x: (v[0].x + v[2].x) / 2, y: (v[0].y + v[2].y) / 2 }, 300);
    const cx = (v[0].x + v[2].x) / 2, cy = (v[0].y + v[2].y) / 2 + 40;
    const linhaMeio = { x: (v[0].x + v[1].x) / 2 + 30, y: (v[0].y + v[1].y) / 2 };
    R.cenas['09_existente'] = { estado: await estado(p), pixel_interior: png.at(cx * DPR, cy * DPR), pixel_contorno: png.at(linhaMeio.x * DPR, linhaMeio.y * DPR), vertice: medirVertice(png, v[0]) };
    R.cenas.existente_erros = erros;
    await ctx.close();
  }

  // ───────── Celular/toque (390 e 412)
  for (const [w, h] of [[390, 844], [412, 915]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
    const { p, erros } = await abrir(ctx, 'desenho');
    const P = [{ x: w * 0.3, y: h * 0.35 }, { x: w * 0.72, y: h * 0.33 }, { x: w * 0.7, y: h * 0.58 }, { x: w * 0.32, y: h * 0.6 }];
    for (const q of P) { await p.touchscreen.tap(q.x, q.y); await p.waitForTimeout(250); }
    await idle(p);
    let png = await shot(p, `10-mobile-${w}-aberto`, null);
    const vA = await verticesPx(p);
    R.cenas[`10_mobile_${w}_aberto`] = { estado: await estado(p), n: vA.length, vertice: vA[0] ? medirVertice(png, vA[0]) : null };
    await p.touchscreen.tap(P[0].x + 4, P[0].y + 3); await p.waitForTimeout(500); await idle(p);
    png = await shot(p, `10-mobile-${w}-fechado`, null);
    const vF = await verticesPx(p);
    const mF = await meiosPx(p);
    R.cenas[`10_mobile_${w}_fechado`] = { estado: await estado(p), n: vF.length, vertice: vF[0] ? medirVertice(png, vF[0]) : null, meio: mF[0] ? raio(png, mF[0], laranja) : null, sem_scroll_horizontal: await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth) };
    // toque a 12 px do meio insere (alvo de toque ≥ 14 px)
    if (mF[0]) {
      await p.touchscreen.tap(mF[0].x + 12, mF[0].y); await p.waitForTimeout(400); await idle(p);
      R.cenas[`10_mobile_${w}_fechado`].toque_meio_12px_vertices = (await verticesPx(p)).length;
    }
    R.cenas[`mobile_${w}_erros`] = erros;
    await ctx.close();
  }

  // ───────── VIS-09: Mapa ↔ Satélite no editor (Map Tiles interceptada; exige servidor com chave fictícia)
  if (process.env.E2E_SATELITE === '1') {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
    const tile = fs.readFileSync(path.join(__dirname, 'tile-sintetico.png'));
    await ctx.route('https://tile.googleapis.com/**', (route) => {
      const u = route.request().url();
      if (u.includes('/v1/createSession')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: 'S1', expiry: '9999999999', tileWidth: 256, imageFormat: 'png' }) });
      if (u.includes('/v1/2dtiles/')) return route.fulfill({ status: 200, contentType: 'image/png', body: tile, headers: { 'access-control-allow-origin': '*' } });
      if (u.includes('/tile/v1/viewport')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ copyright: 'Fixture sintética', maxZoomRects: [] }) });
      return route.fulfill({ status: 404, body: '' });
    });
    const { p, erros } = await abrir(ctx, 'editar');
    const resumo = async () => { const e = await estado(p); return { ordem: e.ordem, fill: e.layers['m1-desenho-fill']?.renderizadas, linha: e.layers['m1-desenho-line']?.renderizadas, vertices: e.layers['m1-vertices']?.renderizadas, meios: e.layers['m1-midpoints']?.renderizadas, paintVertice: e.layers['m1-vertices']?.paint['circle-radius'] }; };
    const r = { antes: await resumo() };
    await p.click('button:has-text("Satélite")');
    await p.waitForSelector('[data-testid=basemap-atribuicao-texto]', { timeout: 30000 });
    await p.waitForTimeout(800); await idle(p);
    r.satelite = await resumo();
    await shot(p, '11-editor-satelite-sintetico', null);
    await p.click('button:has-text("Mapa")');
    await p.waitForTimeout(800); await idle(p);
    r.volta_mapa = await resumo();
    r.erros = erros;
    R.cenas['11_mapa_satelite_mapa'] = r;
    await ctx.close();
  }

  fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, (k, v) => (k === 'layers' || k === 'vertices' || k === 'meios' || k === 'ordem' ? undefined : v), 1));
  await b.close();
})().catch((e) => { console.error('FALHA', e); process.exit(1); });
