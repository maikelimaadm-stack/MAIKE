#!/usr/bin/env node
/**
 * D-PROD-155 — evidência visual reproduzível da Central Única de Lançamentos.
 *
 * Usa os COMPONENTES REAIS (Vite dev) com o BACKEND FALSO do contrato
 * (`tests/smoke/fixtures/lancamentosFakeCore.js`, via `page.route` em
 * /api/native/**): nenhuma chamada sai para banco ou API real. Toda captura
 * leva a faixa "BACKEND FALSO — evidência visual" no rodapé.
 *
 * Uso (dois terminais):
 *   npx vite --port 5199 --strictPort --host 127.0.0.1
 *   node scripts/dev/visual-lancamentos-financeiros.mjs [pasta-de-saida]
 *
 * Variáveis: VISUAL_BASE (padrão http://127.0.0.1:5199).
 * Requer o pacote `playwright` com Chromium disponível no ambiente (não é
 * dependência do projeto). Sai com código 1 se houver rolagem horizontal,
 * diálogo mais largo que a tela, erro de página ou etapa não encontrada.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { criarEstadoLancamentos, rotearLancamentos, semearDocumento } from '../../tests/smoke/fixtures/lancamentosFakeCore.js';

const BASE = process.env.VISUAL_BASE || 'http://127.0.0.1:5199';
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maike-visual-lancamentos'));
fs.mkdirSync(OUT, { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = createRequire(import.meta.url)('playwright'));
  } catch {
    chromium = null;
  }
}
if (!chromium) {
  console.error('playwright não encontrado: instale-o no ambiente para gerar as capturas.');
  process.exit(2);
}

const corpo = (extra = {}) => ({
  empresa_id: 'emp-1', direcao: 'PAGAR', conteudo: 'SEM_PRODUTOS', condicao: 'AVISTA', parceiro_id: 'pa1', data_emissao: '2026-11-08',
  valor_bruto: '1250.00', rateio_modo: 'VALOR', rateios: [{ natureza_id: 'nd1', valor: '1250.00' }], parcelas: [{ vencimento: '2026-11-08', valor: '1250.00' }], ...extra,
});

/** Estado inicial de cada largura: sem perfil (onboarding) e alguns documentos. */
const novoEstado = () => {
  const estado = criarEstadoLancamentos({ perfil: null });
  semearDocumento(estado, corpo({ descricao: 'ENERGIA DO RETIRO', rateios: [{ natureza_id: 'nd3', valor: '1250.00' }] }), { confirmar: true });
  semearDocumento(
    estado,
    corpo({
      direcao: 'RECEBER', parceiro_id: 'pa2', condicao: 'PARCELADO', valor_bruto: '30000.00', rateios: [{ natureza_id: 'nr2', valor: '30000.00' }],
      parcelas: [{ vencimento: '2026-12-08', valor: '15000.00' }, { vencimento: '2027-01-07', valor: '15000.00' }],
    }),
    { confirmar: true },
  );
  semearDocumento(estado, corpo({ parceiro_id: 'pa3', valor_bruto: '480.00', rateios: [{ natureza_id: 'nd2', valor: '480.00' }], parcelas: [{ vencimento: '2026-11-08', valor: '480.00' }], documento_referencia: 'RECIBO 77' }));
  return estado;
};

const responderSessao = (rota) => {
  if (rota === '/auth/contexto') return { cliente_id: 'cli-1', usuario_id: 'u1', login: 'dono', nome: 'DONO', administrador_fazenda: true, papel_tenant: 'admin' };
  if (rota === '/empresas') return [{ id: 'emp-1', nome: 'FAZENDA DEMONSTRAÇÃO', apelido: 'DEMONSTRAÇÃO', ativo: true, fuso_horario: 'America/Sao_Paulo' }];
  return [];
};

const FAIXA = `(() => { if (document.getElementById('faixa-backend-falso')) return; const f = document.createElement('div'); f.id = 'faixa-backend-falso';
  f.textContent = 'BACKEND FALSO — evidência visual (D-PROD-155)';
  f.setAttribute('style','position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#7c2d12;color:#fff;font:600 11px system-ui;text-align:center;padding:2px;pointer-events:none');
  document.body.appendChild(f); })()`;

const tamanhos = [[1440, 900, '1440'], [1280, 800, '1280'], [768, 1024, '768'], [390, 844, '390'], [320, 640, '320']];
const falhas = [];
const resumo = [];

const browser = await chromium.launch();
for (const [w, h, rotulo] of tamanhos) {
  const movel = w < 640;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: movel, hasTouch: movel, timezoneId: 'America/Sao_Paulo' });
  await ctx.addInitScript(() => {
    window.sessionStorage.setItem('maike_native_access_token', 'jwt.falso.screenshot');
    window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
    window.localStorage.setItem('empresa_selecionada_cliente_id', 'cli-1');
  });
  const estado = novoEstado();
  await ctx.route('**/api/native/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const rota = u.pathname.replace(/^\/api\/native/, '');
    let body = null;
    try {
      body = req.postData() ? JSON.parse(req.postData()) : null;
    } catch {
      body = null;
    }
    const r = await rotearLancamentos(estado, { method: req.method(), path: rota, query: u.searchParams, body });
    if (r && r.rede) return route.abort('failed');
    if (r) return route.fulfill({ status: r.status, contentType: 'application/json', body: r.body === undefined ? '' : JSON.stringify(r.body) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responderSessao(rota)) });
  });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));

  const shot = async (etapa, alvo = null) => {
    await page.waitForTimeout(350);
    if (alvo) await alvo.scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(FAIXA);
    const medidas = await page.evaluate(() => {
      const dialogos = [...document.querySelectorAll('[role="dialog"]')].map((d) => Math.ceil(d.getBoundingClientRect().right));
      const escopo = '[data-testid="b1-form"] button, [data-testid="b1-form"] input, [data-testid="consulta-lancamento"] button, [role="dialog"] button';
      const alturas = [...document.querySelectorAll(escopo)]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
        })
        .map((b) => Math.round(b.getBoundingClientRect().height));
      return { scrollWidth: document.documentElement.scrollWidth, dialogoDireita: dialogos.length ? Math.max(...dialogos) : 0, menorAlvo: alturas.length ? Math.min(...alturas) : '-' };
    });
    const arquivo = `lancamentos-${rotulo}-${etapa}.png`;
    await page.screenshot({ path: path.join(OUT, arquivo) });
    const overflow = medidas.scrollWidth > w;
    const dialogoLargo = medidas.dialogoDireita > w;
    if (overflow) falhas.push(`${arquivo}: rolagem horizontal (${medidas.scrollWidth} > ${w})`);
    if (dialogoLargo) falhas.push(`${arquivo}: diálogo passa da tela (${medidas.dialogoDireita} > ${w})`);
    resumo.push(`${arquivo}  scrollWidth=${medidas.scrollWidth}/${w}  menor_alvo=${medidas.menorAlvo}px${overflow || dialogoLargo ? '  OVERFLOW' : ''}`);
  };
  const exigir = async (loc, etapa) => {
    if (!(await loc.count())) {
      falhas.push(`${rotulo}: etapa "${etapa}" não encontrada`);
      return null;
    }
    return loc.first();
  };
  const clicar = async (loc, etapa) => {
    const el = await exigir(loc, etapa);
    if (el) {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click();
      await page.waitForTimeout(300);
    }
    return el;
  };
  const visivel = (loc) => loc.filter({ visible: true });
  const escolher = async (testId, nome) => {
    if (!(await clicar(page.getByTestId(testId), `seletor ${testId}`))) return;
    await page.waitForTimeout(500);
    await clicar(page.getByTestId(`${testId}-painel`).getByRole('option', { name: nome }), `opção ${nome}`);
  };
  const preencher = async (testId, valor) => {
    const el = await exigir(page.getByTestId(testId), `campo ${testId}`);
    if (el) await el.fill(valor);
  };
  const voltarLista = async () => {
    await page.goto(`${BASE}/lancamentosfinanceiros`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
  };
  const novo = async () => {
    await voltarLista();
    await clicar(visivel(page.getByRole('button', { name: 'Novo' })), 'botão Novo');
    await page.waitForTimeout(500);
  };
  const abrirDocumento = async (texto) => {
    await voltarLista();
    const alvo = await exigir(page.getByText(texto, { exact: true }), `documento ${texto}`);
    if (!alvo) return false;
    await alvo.scrollIntoViewIfNeeded();
    await alvo.dblclick();
    await page.waitForTimeout(900);
    return true;
  };

  // 1. Onboarding do perfil financeiro (padrões explicados)
  await voltarLista();
  await shot('01-onboarding-perfil');
  await clicar(page.getByTestId('botao-confirmar-perfil'), 'Confirmar perfil');
  await page.waitForTimeout(700);

  // 2. Lista (tabela no desktop, cards no celular)
  await voltarLista();
  await shot('02-lista');

  // 3. Novo a pagar sem produtos
  await novo();
  await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
  await preencher('valor-bruto', '1.000,00');
  await escolher('seletor-natureza-0', /NUTRIÇÃO/);
  await shot('03-novo-pagar-sem-produtos');

  // 4. Rateio com diferença ao centavo
  await clicar(page.getByRole('button', { name: /Linha de rateio/ }), 'adicionar linha de rateio');
  await escolher('seletor-natureza-1', /SANIDADE/);
  await preencher('rateio-0-valor', '600,00');
  await preencher('rateio-1-valor', '399,99');
  await shot('04-rateio-diferenca', page.getByTestId('rateio-diferenca'));

  // 5. Parcelado com gerador (resto na última)
  await preencher('rateio-1-valor', '400,00');
  await clicar(page.getByRole('radio', { name: 'Parcelado' }), 'condição Parcelado');
  const gerador = page.getByTestId('gerador-parcelas');
  const nParcelas = await exigir(gerador.getByLabel(/Nº de parcelas/), 'nº de parcelas');
  if (nParcelas) await nParcelas.fill('3');
  await clicar(gerador.getByRole('button', { name: 'Gerar parcelas' }), 'Gerar parcelas');
  await shot('05-parcelado-gerado', page.getByTestId('parcelas-diferenca'));

  // 6. Com produtos — compra (SACO convertido em kg, declaração física)
  await novo();
  await escolher('seletor-parceiro', /AGROPECUÁRIA BOA VISTA/);
  await clicar(page.getByRole('radio', { name: 'Com produtos' }), 'Com produtos');
  await escolher('seletor-produto-0', /SAL MINERAL 80/);
  await escolher('seletor-local-0', /DEPÓSITO SEDE/);
  const unidade = await exigir(page.getByRole('combobox', { name: 'Unidade do item 1' }), 'unidade do item');
  if (unidade) {
    await unidade.click();
    await page.waitForTimeout(300);
    await clicar(page.getByRole('option', { name: 'SACO', exact: true }), 'unidade SACO');
  }
  await preencher('item-0-quantidade', '4');
  await preencher('item-0-valor-unitario', '250');
  await preencher('data-operacional', '2026-11-07');
  await clicar(page.getByTestId('declaracao-efeito-fisico'), 'declaração física');
  await shot('06-compra-com-produtos', page.getByTestId('item-0'));

  // 7. Venda com saldo da empresa por local
  await novo();
  await clicar(page.getByRole('radio', { name: 'A receber' }), 'A receber');
  await escolher('seletor-parceiro', /FRIGORÍFICO CENTRAL/);
  await clicar(page.getByRole('radio', { name: 'Com produtos' }), 'Com produtos (venda)');
  await escolher('seletor-produto-0', /MILHO MOÍDO/);
  await page.waitForTimeout(600);
  await clicar(page.getByTestId('saldos-item-0').getByRole('button', { name: /GALPÃO RETIRO/ }), 'saldo do local');
  await preencher('item-0-quantidade', '1.300');
  await preencher('item-0-valor-unitario', '1,5');
  await shot('07-venda-com-saldo', page.getByTestId('item-0'));

  // 8. Prévia do rascunho salvo
  if (await abrirDocumento('VETERINÁRIA SÃO JOSÉ')) {
    await clicar(page.getByTestId('botao-confirmar-lancamento'), 'Confirmar lançamento');
    await page.waitForTimeout(700);
    await shot('08-previa-confirmacao');
    // 9. Consulta com títulos (depois de confirmar)
    await clicar(page.getByTestId('botao-confirmar-definitivo'), 'confirmar definitivo');
    await page.waitForTimeout(900);
    await shot('09-consulta-titulos');
    // 10. Liquidação parcial
    await clicar(page.getByTestId('botao-liquidar-1'), 'Registrar pagamento');
    const valor = await exigir(page.getByTestId('liquidacao-valor'), 'valor da baixa');
    if (valor) await valor.fill('200,00');
    // Forma da baixa: botões dentro do próprio diálogo (toque real no celular).
    try {
      await page.getByRole('dialog').getByRole('radio', { name: 'Pix', exact: true }).click({ timeout: 5000 });
      await page.waitForTimeout(300);
    } catch (e) {
      falhas.push(`${rotulo}: forma da baixa não escolhida dentro do diálogo (${String(e).slice(0, 120)})`);
    }
    await shot('10-liquidacao-dialogo');
    await clicar(page.getByTestId('botao-registrar-liquidacao'), 'registrar baixa');
    await page.waitForTimeout(900);
    await shot('11-consulta-parcial', page.getByTestId('titulo-1'));
    // 11. Cancelamento recusado (há baixa ativa)
    await clicar(page.getByTestId('botao-cancelar-lancamento'), 'Cancelar lançamento');
    const motivo = await exigir(page.getByTestId('dialogo-cancelamento-motivo'), 'motivo do cancelamento');
    if (motivo) await motivo.fill('Lançado em duplicidade');
    await clicar(page.getByTestId('dialogo-cancelamento-enviar'), 'enviar cancelamento');
    await page.waitForTimeout(700);
    await shot('12-cancelamento-recusado');
  }
  if (erros.length) falhas.push(`${rotulo}: erros de página: ${erros.slice(0, 3).join(' | ')}`);
  await ctx.close();
}
await browser.close();

console.log(resumo.join('\n'));
console.log(`\n${resumo.length} capturas em ${OUT}`);
if (falhas.length) {
  console.error(`\nFALHAS (${falhas.length}):\n${falhas.join('\n')}`);
  process.exit(1);
}
