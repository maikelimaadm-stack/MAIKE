/**
 * Medição de desempenho do Mapa Geral (D-PROD-347, etapa 0 do "mapa leve").
 *
 * Abre o harness com uma fazenda grande (`?grande=N`), num celular emulado (CPU 4× mais lenta), e mede:
 *  - abertura: tempo até o canvas, até os nomes das áreas e até os lotes aparecerem;
 *  - arrastar e zoom: duração de cada quadro (requestAnimationFrame) durante gestos roteirizados,
 *    com mediana, p95, quadros acima de 50 ms e o tempo de script (CDP Performance.getMetrics).
 *
 * Uso: npx vite --config tests/e2e/harness/vite.e2e.config.mjs   (em outro terminal)
 *      node tests/e2e/harness/run-perf.cjs [N=200] [rotulo]
 * Saída: uma linha JSON por cenário (stdout). WebGL é SwiftShader (CPU): os números servem para COMPARAR antes × depois
 * na mesma máquina, não como tempo absoluto de um celular.
 * Variáveis: E2E_URL (padrão http://localhost:5199/), PERF_CPU (padrão 4), PERF_DPR (densidade de tela; padrão a do
 * Pixel 7, 2,625). D-PROD-348: com a densidade do Pixel 7 o SwiftShader gasta quase todo o quadro pintando o mapa
 * na CPU, e o arrastar fica em ≈ 9 quadros/s mesmo sem nenhum marcador HTML; PERF_DPR=1 mostra o custo da página.
 */
const { chromium, devices } = require("playwright");

const URL = process.env.E2E_URL || "http://localhost:5199/";
const N = Number(process.argv[2] || 200);
const ROTULO = process.argv[3] || "atual";
const CPU = Number(process.env.PERF_CPU || 4);
const DPR = process.env.PERF_DPR ? Number(process.env.PERF_DPR) : null;

const resumo = (quadros) => {
  const v = [...quadros].sort((a, b) => a - b);
  if (!v.length) return { quadros: 0 };
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return {
    quadros: v.length,
    mediana_ms: +q(0.5).toFixed(1),
    p95_ms: +q(0.95).toFixed(1),
    acima_50ms: v.filter((x) => x > 50).length,
    fps_medio: +(1000 / (v.reduce((a, b) => a + b, 0) / v.length)).toFixed(1),
  };
};

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ ...devices["Pixel 7"], ...(DPR ? { deviceScaleFactor: DPR } : {}) });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const erros = [];
  p.on("pageerror", (e) => erros.push(String(e)));

  const t0 = Date.now();
  await p.goto(`${URL}?cena=geral&grande=${N}`);
  await p.waitForSelector(".maplibregl-canvas", { timeout: 120000 });
  const tCanvas = Date.now() - t0;
  // Lotes desenhados pelo mapa (D-PROD-348): contados pela fonte `mg-lotes` do mapa do harness (`window.__E2E_MAPS__`,
  // só no harness), não por elemento HTML. Aceita também o marcador HTML antigo (.mg-lote-count), para medir o "antes".
  const lotesNoMapa = () => {
    const m = (window.__E2E_MAPS__ || []).at(-1);
    const fonte = m?.getStyle?.() && m.getSource("mg-lotes");
    const dados = fonte?.serialize?.().data;
    return Array.isArray(dados?.features) ? dados.features.length : 0;
  };
  await p.waitForFunction(() => document.querySelectorAll(".mg-area-label").length > 0, null, { timeout: 120000 });
  const tRotulos = Date.now() - t0;
  await p.waitForFunction(
    `document.querySelectorAll(".mg-lote-count").length > 0 || (${lotesNoMapa})() > 0`,
    null,
    { timeout: 120000 },
  );
  const tLotes = Date.now() - t0;
  await p.waitForTimeout(3000);
  const contagem = await p.evaluate(`({
    marcadores_html: document.querySelectorAll(".maplibregl-marker").length,
    rotulos_html: document.querySelectorAll(".mg-area-label").length,
    lotes_html: document.querySelectorAll(".mg-lote-count").length,
    lotes_no_mapa: (${lotesNoMapa})(),
  })`);
  console.log(JSON.stringify({ rotulo: ROTULO, n: N, cpu: CPU, dpr: DPR || devices["Pixel 7"].deviceScaleFactor, cenario: "abertura", canvas_ms: tCanvas, rotulos_ms: tRotulos, lotes_ms: tLotes, ...contagem }));

  const canvas = await p.$(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  const medir = async (nome, gesto) => {
    await p.evaluate(() => {
      window.__quadros = [];
      let ultimo = performance.now();
      window.__rodando = true;
      const passo = (t) => {
        window.__quadros.push(t - ultimo);
        ultimo = t;
        if (window.__rodando) requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    });
    const camera = () => p.evaluate(() => {
      const m = (window.__E2E_MAPS__ || []).at(-1);
      return m ? { z: +m.getZoom().toFixed(2), c: m.getCenter().toArray().map((v) => +v.toFixed(4)) } : null;
    });
    const antes = await camera();
    const m0 = await cdp.send("Performance.getMetrics");
    await gesto();
    const m1 = await cdp.send("Performance.getMetrics");
    const depois = await camera();
    const quadros = await p.evaluate(() => {
      window.__rodando = false;
      return window.__quadros.slice(1);
    });
    const met = (m, k) => m.metrics.find((x) => x.name === k)?.value || 0;
    console.log(JSON.stringify({
      rotulo: ROTULO,
      n: N,
      cpu: CPU,
      dpr: DPR || devices["Pixel 7"].deviceScaleFactor,
      cenario: nome,
      ...resumo(quadros),
      script_s: +(met(m1, "ScriptDuration") - met(m0, "ScriptDuration")).toFixed(2),
      layout_s: +(met(m1, "LayoutDuration") - met(m0, "LayoutDuration")).toFixed(2),
      estilo_s: +(met(m1, "RecalcStyleDuration") - met(m0, "RecalcStyleDuration")).toFixed(2),
      camera_antes: antes,
      camera_depois: depois,
    }));
  };

  // Arrastar: 3 idas e voltas lentas com o mouse (equivalente a arrastar com o dedo).
  await medir("arrastar", async () => {
    for (let r = 0; r < 3; r++) {
      await p.mouse.move(cx, cy);
      await p.mouse.down();
      await p.mouse.move(cx - 220, cy - 160, { steps: 30 });
      await p.mouse.move(cx, cy, { steps: 30 });
      await p.mouse.up();
    }
    await p.waitForTimeout(600);
  });

  // Zoom: rodinha para afastar e aproximar, passo a passo (aciona o ajuste dos nomes por zoom).
  await medir("zoom", async () => {
    await p.mouse.move(cx, cy);
    // gesto contínuo (como a pinça): sem pausa que dispare moveend no meio
    for (let i = 0; i < 30; i++) {
      await p.mouse.wheel(0, 40);
      await p.waitForTimeout(16);
    }
    await p.waitForTimeout(400);
    console.log(JSON.stringify({ rotulo: ROTULO, zoom_afastado: await p.evaluate(() => (window.__E2E_MAPS__ || []).at(-1)?.getZoom()) }));
    for (let i = 0; i < 30; i++) {
      await p.mouse.wheel(0, -40);
      await p.waitForTimeout(16);
    }
    await p.waitForTimeout(800);
  });

  if (erros.length) console.log(JSON.stringify({ rotulo: ROTULO, erros: erros.slice(0, 5) }));
  await b.close();
})();
