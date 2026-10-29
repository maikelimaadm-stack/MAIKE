/**
 * R1 POLÍGONOS — prova VISUAL com WebGL real (Chromium + SwiftShader).
 * Dados sintéticos do harness (não é app autenticado).
 *
 * Para cada cena: queryRenderedFeatures nas camadas de preenchimento/contorno
 * + amostragem de pixels do screenshot dentro da área versus o mapa-base.
 *
 * Uso: npx vite --config tests/e2e/harness/vite.e2e.config.mjs
 *      node tests/e2e/harness/run-geo.cjs
 */
const { chromium, devices } = require('playwright');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const OUT = process.env.E2E_OUT || path.resolve(__dirname, '../../../docs/engineering/evidencias/maplibre-areas');
const URL = process.env.E2E_URL || 'http://localhost:5199/';
const L = { FILL: 'm1-desenho-fill', LINE: 'm1-desenho-line', VERT: 'm1-vertices', AREAS: 'm1-areas-fill', MG: 'mg-areas-fill' };

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

/** Pixel "laranja do desenho" (COR_DESENHO #f5a01b translúcido) vs base clara. */

async function estadoGeo(p, camadas) {
  return p.evaluate((camadas) => {
    const m = window.__E2E_MAPS__.at(-1);
    const out = {};
    for (const id of camadas) out[id] = m.getLayer(id) ? m.queryRenderedFeatures({ layers: [id] }).length : -1;
    const src = m.getSource('m1-desenho');
    const fc = src && src.serialize ? src.serialize().data : null;
    out.desenhoGeom = fc && fc.features && fc.features[0] ? fc.features[0].geometry.type : null;
    out.desenhoVertices = fc && fc.features && fc.features[0] && fc.features[0].geometry.type === 'Polygon' ? fc.features[0].geometry.coordinates[0].length - 1 : null;
    out.zoom = Math.round(m.getZoom() * 100) / 100;
    return out;
  }, camadas);
}

/** Ponto interno (60% do centróide até um vértice) projetado em pixels CSS. */
async function pontoInterno(p) {
  return p.evaluate(() => {
    const m = window.__E2E_MAPS__.at(-1);
    // Vértices (fonte independente) definem o anel — funciona mesmo se o
    // desenho sumiu (é exatamente o defeito que se quer flagrar).
    const ring = m.getSource('m1-vertices').serialize().data.features.map((f) => f.geometry.coordinates);
    const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    const v = ring[0];
    const pt = m.project([cx + (v[0] - cx) * 0.6, cy + (v[1] - cy) * 0.6]);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + pt.x, y: r.top + pt.y };
  });
}

/**
 * Prova A/B: screenshot com as camadas do desenho e outra com elas ocultas
 * (só no harness). Se o pixel interno muda, o preenchimento ESTÁ pintado ali —
 * independe da cor do mapa-base ou de áreas vizinhas por baixo.
 */
async function amostrar(p, nome, pt, camadas = ['m1-desenho-fill', 'm1-desenho-line']) {
  const file = path.join(OUT, nome);
  const com = decodePng(await p.screenshot({ path: file }));
  await p.evaluate((ids) => { const m = window.__E2E_MAPS__.at(-1); ids.forEach((id) => m.setLayoutProperty(id, 'visibility', 'none')); }, camadas);
  await idle(p);
  const sem = decodePng(await p.screenshot());
  await p.evaluate((ids) => { const m = window.__E2E_MAPS__.at(-1); ids.forEach((id) => m.setLayoutProperty(id, 'visibility', 'visible')); }, camadas);
  await idle(p);
  const dpr = com.w / p.viewportSize().width;
  const c1 = com.at(pt.x * dpr, pt.y * dpr);
  const c0 = sem.at(pt.x * dpr, pt.y * dpr);
  const delta = Math.abs(c1[0] - c0[0]) + Math.abs(c1[1] - c0[1]) + Math.abs(c1[2] - c0[2]);
  return { arquivo: nome, comCamada: c1, semCamada: c0, delta, pintado: delta >= 30 };
}

async function idle(p) {
  await p.evaluate(() => new Promise((res) => {
    const m = window.__E2E_MAPS__.at(-1);
    if (m.loaded() && !m.isMoving()) return setTimeout(res, 150);
    m.once('idle', () => setTimeout(res, 150));
  }));
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const R = {};
  const camadas = [L.FILL, L.LINE, L.VERT];

  // ── GEO-01 / GEO-02 / GEO-04 / GEO-05 / GEO-06 (desktop, desenho novo)
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const erros = [];
    p.on('pageerror', (e) => erros.push(String(e)));
    await p.goto(URL + '?cena=desenho');
    await p.waitForSelector('text=Toque para desenhar a área', { timeout: 30000 });
    await idle(p);
    const box = await (await p.$('.maplibregl-canvas')).boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const clique = async (x, y) => { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(200); };
    const arrastar = async (x, y, dx, dy) => { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx, y + dy, { steps: 10 }); await p.mouse.up(); await p.waitForTimeout(300); };

    // GEO-05: pan na área vazia não cria ponto
    await arrastar(cx, cy, 90, 40);
    R.GEO05_pan_vazio_sem_ponto = await p.isVisible('text=Toque para desenhar a área');

    const pts = [[cx - 120, cy - 80], [cx + 120, cy - 80], [cx + 120, cy + 80], [cx - 120, cy + 80]];
    await clique(...pts[0]); await clique(...pts[1]);
    await idle(p);
    R.GEO01_preview_2pts = await estadoGeo(p, camadas);
    await clique(...pts[2]); await clique(...pts[3]);
    await idle(p);
    R.GEO01_aberto_4pts = await estadoGeo(p, camadas);
    await clique(pts[0][0] + 2, pts[0][1] + 2);
    await idle(p);
    R.GEO01_fechado = await estadoGeo(p, camadas);
    R.GEO01_fechado_px = await amostrar(p, 'r1-geo01-fechado.png', await pontoInterno(p));

    // GEO-02: Navegar + pan + zoom — continua visível
    await p.click('[aria-label="Navegar no mapa"]');
    await arrastar(cx + 250, cy + 220, 70, 30);
    await p.mouse.move(cx, cy);
    await p.mouse.wheel(0, -300);
    await p.waitForTimeout(600);
    await idle(p);
    R.GEO02_navegar = await estadoGeo(p, camadas);
    R.GEO02_medidas = await p.textContent('[data-testid=medidas-area]');
    R.GEO02_navegar_px = await amostrar(p, 'r1-geo02-navegar-pan-zoom.png', await pontoInterno(p));

    // GEO-04: editar → arrastar vértice; inserir ponto médio; remover; mover; undo/redo
    await p.click('[aria-label="Editar pontos"]');
    const vpx = async (i) => p.evaluate((i) => {
      const m = window.__E2E_MAPS__.at(-1);
      const ring = m.getSource('m1-vertices').serialize().data.features.map((f) => f.geometry.coordinates);
      const pt = m.project(ring[i]); const r = m.getCanvas().getBoundingClientRect();
      return [r.left + pt.x, r.top + pt.y];
    }, i);
    const mid = async (i) => p.evaluate((i) => {
      const m = window.__E2E_MAPS__.at(-1);
      const ring = m.getSource('m1-vertices').serialize().data.features.map((f) => f.geometry.coordinates);
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const pt = m.project([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]); const r = m.getCanvas().getBoundingClientRect();
      return [r.left + pt.x, r.top + pt.y];
    }, i);
    const medidas = () => p.textContent('[data-testid=medidas-area]');
    const [v1x, v1y] = await vpx(1);
    await arrastar(v1x, v1y, 50, -40);
    await idle(p);
    R.GEO04_apos_arrastar = { ...(await estadoGeo(p, camadas)), medidas: await medidas() };
    const [mx, my] = await mid(2);
    await clique(mx, my);
    await idle(p);
    R.GEO04_apos_inserir_medio = { ...(await estadoGeo(p, camadas)), medidas: await medidas() };
    const [v0x, v0y] = await vpx(0);
    await clique(v0x, v0y);
    R.GEO04_selecionou = await p.isVisible('button:has-text("Remover ponto")');
    if (R.GEO04_selecionou) await p.click('button:has-text("Remover ponto")');
    await idle(p);
    R.GEO04_apos_remover = { ...(await estadoGeo(p, camadas)), medidas: await medidas() };
    R.GEO04_apos_remover_px = await amostrar(p, 'r1-geo04-editar-remover.png', await pontoInterno(p));
    // GEO-05: MOVER arrasta polígono e NÃO a câmera
    await p.click('[aria-label="Mover área inteira"]');
    const centroAntes = await p.evaluate(() => window.__E2E_MAPS__.at(-1).getCenter().toArray());
    const ip = await pontoInterno(p);
    await arrastar(ip.x, ip.y, -80, 60);
    await idle(p);
    const centroDepois = await p.evaluate(() => window.__E2E_MAPS__.at(-1).getCenter().toArray());
    R.GEO05_mover_camera_parada = JSON.stringify(centroAntes) === JSON.stringify(centroDepois);
    R.GEO04_apos_mover = { ...(await estadoGeo(p, camadas)), medidas: await medidas() };
    R.GEO04_apos_mover_px = await amostrar(p, 'r1-geo04-mover.png', await pontoInterno(p));
    const antesUndo = await medidas();
    await p.click('button:has-text("Desfazer")'); await idle(p);
    R.GEO04_undo = { ...(await estadoGeo(p, camadas)), medidas: await medidas() };
    await p.click('button:has-text("Refazer")'); await idle(p);
    R.GEO04_redo_igual = (await medidas()) === antesUndo;
    R.GEO04_redo_geo = await estadoGeo(p, camadas);
    // GEO-06: troca de base (sem chave → fallback honesto) várias vezes, nada some
    for (let i = 0; i < 3; i += 1) {
      await p.click('button:has-text("Satélite")'); await p.waitForTimeout(300);
      await p.click('button:has-text("Mapa")'); await p.waitForTimeout(300);
    }
    await idle(p);
    R.GEO06_apos_trocas = { ...(await estadoGeo(p, camadas)), medidas: await medidas() };
    R.GEO06_px = await amostrar(p, 'r1-geo06-apos-trocas-base.png', await pontoInterno(p));
    // D06 teclado real: Shift trava 45°; Alt suspende ímã (desenho novo)
    await p.click('button:has-text("Reiniciar")'); await idle(p);
    await clique(cx - 100, cy);
    await p.keyboard.down('Shift');
    await clique(cx + 100, cy + 37);
    await p.keyboard.up('Shift');
    await idle(p);
    R.D06_shift_45 = await p.evaluate(() => {
      const m = window.__E2E_MAPS__.at(-1);
      const c = m.getSource('m1-vertices').serialize().data.features.map((f) => f.geometry.coordinates);
      const a = m.project(c[0]), z = m.project(c[1]);
      const ang = Math.atan2(z.y - a.y, z.x - a.x) * 180 / Math.PI;
      return Math.round(ang * 10) / 10;
    });
    R.erros = erros.slice(0, 5);
    await p.close();
  }

  // ── GEO-03 editar existente (área legada a2, cor #92ca25)
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(URL + '?cena=editar');
    await p.waitForSelector('[data-testid=medidas-area]', { timeout: 30000 });
    await p.waitForTimeout(800);
    await idle(p);
    R.GEO03_abertura = await estadoGeo(p, [...camadas, L.AREAS]);
    R.GEO03_abertura_px = await amostrar(p, 'r1-geo03-editar-existente.png', await pontoInterno(p));
    R.GEO03_medidas = await p.textContent('[data-testid=medidas-area]');
    await p.click('[aria-label="Navegar no mapa"]');
    const box = await (await p.$('.maplibregl-canvas')).boundingBox();
    await p.mouse.move(box.x + 100, box.y + 600); await p.mouse.down(); await p.mouse.move(box.x + 160, box.y + 640, { steps: 8 }); await p.mouse.up();
    await idle(p);
    R.GEO03_apos_pan = await estadoGeo(p, camadas);
    R.GEO03_apos_pan_px = await amostrar(p, 'r1-geo03-editar-existente-pan.png', await pontoInterno(p));
    await p.close();
  }

  // ── GEO-07 Mapa Geral — polígonos coloridos, ids e clique
  {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(URL + '?cena=geral');
    await p.waitForFunction(() => document.querySelectorAll('.mg-area-label').length >= 3, null, { timeout: 30000 });
    await idle(p);
    const info = await p.evaluate(() => {
      const m = window.__E2E_MAPS__.at(-1);
      const fs = m.queryRenderedFeatures({ layers: ['mg-areas-fill'] });
      const r = m.getCanvas().getBoundingClientRect();
      const ids = [...new Set(fs.map((f) => f.properties.id))].sort();
      const pontos = {};
      for (const id of ids) {
        const f = m.getSource('mg-areas').serialize().data.features.find((x) => x.properties.id === id);
        const ring = f.geometry.coordinates[0];
        const pt = m.project([ring[0][0] + (ring[2][0] - ring[0][0]) * 0.2, ring[0][1] + (ring[2][1] - ring[0][1]) * 0.2]);
        pontos[id] = { x: r.left + pt.x, y: r.top + pt.y, fill: f.properties.fill };
      }
      return { ids, pontos, linha: m.queryRenderedFeatures({ layers: ['mg-areas-line'] }).length };
    });
    R.GEO07_ids = info.ids;
    R.GEO07_divisas = info.linha;
    R.GEO07_pixels = {};
    for (const [id, pt] of Object.entries(info.pontos)) {
      const r = await amostrar(p, 'r1-geo07-mapa-geral.png', pt, ['mg-areas-fill']);
      R.GEO07_pixels[id] = { fill: pt.fill, comCamada: r.comCamada, semCamada: r.semCamada, pintado: r.pintado };
    }
    // clique no interior de a1 → hitArea/handler aponta o ID correto (sem painel: só curral abre)
    const pt3 = info.pontos.a3;
    await p.mouse.click(pt3.x, pt3.y);
    await p.waitForTimeout(800);
    R.GEO07_clique_curral_abre_detalhe = await p.isVisible('[role=dialog]');
    await p.close();
  }

  // ── GEO-10 mobile: Desenhar / Navegar / Editar / Mover com polígono visível
  {
    const ctx = await b.newContext({ ...devices['Pixel 7'] });
    const p = await ctx.newPage();
    await p.goto(URL + '?cena=desenho');
    await p.waitForSelector('text=Toque para desenhar a área', { timeout: 30000 });
    await idle(p);
    for (const [x, y] of [[110, 300], [300, 300], [300, 500], [110, 500]]) { await p.touchscreen.tap(x, y); await p.waitForTimeout(200); }
    await p.touchscreen.tap(111, 301);
    await idle(p);
    R.GEO10_desenhar = await estadoGeo(p, camadas);
    R.GEO10_editar_px = await amostrar(p, 'r1-geo10-mobile-editar.png', await pontoInterno(p));
    await p.tap('[aria-label="Navegar no mapa"]');
    await idle(p);
    R.GEO10_navegar_px = await amostrar(p, 'r1-geo10-mobile-navegar.png', await pontoInterno(p));
    await p.tap('[aria-label="Mover área inteira"]');
    await idle(p);
    R.GEO10_mover = await estadoGeo(p, camadas);
    R.GEO10_overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await ctx.close();
  }

  fs.writeFileSync(path.join(OUT, 'r1-geo-resultado.json'), JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error('FALHA', e); process.exit(1); });
