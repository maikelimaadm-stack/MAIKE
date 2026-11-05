/**
 * D-PROD-123 (H2) — histórico por ocorrência no navegador real (Chromium),
 * larguras 390/412/768/1440. Dados sintéticos do harness — NÃO é o app
 * autenticado. Prova: "Ocorrência" e "Registrado em" visíveis em todo card,
 * ausência dita por extenso, ordem do servidor preservada após "Carregar mais",
 * sem rolagem horizontal da página.
 *
 * Uso: npx vite --config tests/e2e/harness/vite.e2e.config.mjs
 *      node tests/e2e/harness/run-historico.cjs
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const OUT = process.env.E2E_OUT || path.resolve(__dirname, '../../../docs/engineering/evidencias/d-prod-123-historico');
const URL = (process.env.E2E_URL || 'http://localhost:5199/') + '?cena=historico';
const LARGURAS = [390, 412, 768, 1440];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const resultado = [];
  let falhou = false;
  for (const largura of LARGURAS) {
    const page = await browser.newPage({ viewport: { width: largura, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(URL);
    await page.getByText('Movimentações: 2 de 3').waitFor();
    await page.getByRole('button', { name: 'Carregar mais' }).click();
    await page.getByText('Movimentações: 3 de 3').waitFor();
    const ocorrencias = await page.getByTestId('ocorrencia').allTextContents();
    const registros = await page.getByTestId('registrado-em').allTextContents();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const ok =
      JSON.stringify(ocorrencias) === JSON.stringify(['Ocorrência: 30/10/2026', 'Ocorrência: 05/01/2026', 'Ocorrência: Data da ocorrência não informada']) &&
      registros.length === 3 && registros.every((t) => /^Registrado em: \d{2}\/\d{2}\/\d{4}/.test(t)) &&
      overflow <= 0;
    if (!ok) falhou = true;
    await page.screenshot({ path: path.join(OUT, `historico-${largura}.png`), fullPage: true });
    resultado.push({ largura, ok, overflow, ocorrencias, registros });
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(resultado, null, 2) + '\n');
  console.log(JSON.stringify(resultado, null, 2));
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
