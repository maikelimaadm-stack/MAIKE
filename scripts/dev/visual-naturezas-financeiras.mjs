#!/usr/bin/env node
/**
 * D-PROD-152 (R1) — evidência visual reproduzível da tela Naturezas Financeiras.
 *
 * Usa os COMPONENTES REAIS (Vite dev) com o BACKEND FALSO deste arquivo
 * (`page.route` em /api/native/**): nenhuma chamada sai para banco ou API real.
 * Toda captura leva a faixa "BACKEND FALSO — evidência visual" no topo.
 *
 * Uso (dois terminais):
 *   npx vite --port 5199 --strictPort --host 127.0.0.1
 *   node scripts/dev/visual-naturezas-financeiras.mjs [pasta-de-saida]
 *
 * Variáveis: VISUAL_BASE (padrão http://127.0.0.1:5199).
 * Requer o pacote `playwright` com Chromium disponível no ambiente
 * (não é dependência do projeto). Sai com código 1 se houver rolagem
 * horizontal, erro de página ou etapa não encontrada.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const BASE = process.env.VISUAL_BASE || 'http://127.0.0.1:5199';
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maike-visual-naturezas'));
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

const ts = '2026-11-01T10:00:00.000Z';
const env = (items) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100 });
const n = (id, numero, tipo, nome, pai = null, extra = {}) => ({
  id, empresa_id: 'emp-1', numero: String(numero), tipo, nome, descricao: null,
  pai_id: pai?.id ?? null, pai_nome: pai?.nome ?? null,
  caminho: pai ? `${pai.caminho} / ${nome}` : nome, nivel: pai ? pai.nivel + 1 : 1,
  ativo: true, created_date: ts, updated_date: ts, ...extra,
});
const INS = n('n1', 1, 'DESPESA', 'INSUMOS', null, { descricao: 'COMPRAS DE INSUMOS PARA O REBANHO' });
const NUT = n('n2', 2, 'DESPESA', 'NUTRIÇÃO ANIMAL', INS);
const SAL = n('n3', 3, 'DESPESA', 'SAL MINERAL', NUT);
const RAC = n('n4', 4, 'DESPESA', 'RAÇÃO', NUT);
const SAN = n('n5', 5, 'DESPESA', 'SANIDADE', INS);
const ENE = n('n6', 6, 'DESPESA', 'ENERGIA ELÉTRICA');
const VEN = n('r1', 8, 'RECEITA', 'VENDA DE GADO');
const ARR = n('r2', 9, 'RECEITA', 'ARRENDAMENTO DE PASTO');
const EXTRAS = Array.from({ length: 70 }, (_, i) => n(`g${i + 1}`, 100 + i, 'DESPESA', `NATUREZA ${String(i + 1).padStart(3, '0')}`));
const LISTA = [INS, NUT, SAL, RAC, SAN, ENE, VEN, ARR];

/** Backend falso: listagem filtrada + opções de pai paginadas por (nome, id). */
const responder = (rota, q, estado) => {
  if (rota === '/auth/contexto') return { cliente_id: 'cli-1', usuario_id: 'u1', login: 'dono', nome: 'DONO', administrador_fazenda: true, papel_tenant: 'admin' };
  if (rota === '/empresas') return [{ id: 'emp-1', nome: 'FAZENDA DEMONSTRAÇÃO', apelido: 'DEMONSTRAÇÃO', ativo: true }];
  if (rota === '/naturezas-financeiras') {
    const tipo = q.get('tipo');
    const ativo = q.get('ativo');
    return env(LISTA.filter((x) => (!tipo || x.tipo === tipo) && (ativo == null || String(x.ativo) === ativo)));
  }
  if (rota === '/naturezas-financeiras-opcoes/pais') {
    if (estado.falharCursor && q.get('cursor')) return { __status: 503, code: 'SERVICE_UNAVAILABLE', message: 'indisponível' };
    const busca = (q.get('q') || '').toLowerCase();
    const todas = [...LISTA, ...EXTRAS]
      .filter((x) => x.ativo && x.tipo === q.get('tipo') && x.id !== q.get('excluir_id'))
      .filter((x) => !busca || x.nome.toLowerCase().includes(busca))
      .sort((a, b) => a.nome.localeCompare(b.nome) || a.id.localeCompare(b.id));
    const inicio = Number(q.get('cursor') || 0);
    const limit = Number(q.get('limit') || 50);
    const pagina = todas.slice(inicio, inicio + limit);
    const mais = inicio + limit < todas.length;
    return { itens: pagina.map(({ id, numero, nome, pai_id, caminho, nivel }) => ({ id, numero, nome, pai_id, caminho, nivel })), has_more: mais, next_cursor: mais ? String(inicio + limit) : null };
  }
  return [];
};

const FAIXA = `(() => { const f = document.createElement('div'); f.textContent = 'BACKEND FALSO — evidência visual (D-PROD-152)';
  f.setAttribute('style','position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#7c2d12;color:#fff;font:600 11px system-ui;text-align:center;padding:2px;pointer-events:none');
  document.body.appendChild(f); })()`;

const tamanhos = [[1440, 900, '1440'], [1280, 800, '1280'], [768, 1024, '768'], [390, 844, '390'], [320, 640, '320']];
const falhas = [];
const resumo = [];

const browser = await chromium.launch();
for (const [w, h, rotulo] of tamanhos) {
  const movel = w < 640;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: movel, hasTouch: movel });
  await ctx.addInitScript(() => {
    window.sessionStorage.setItem('maike_native_access_token', 'jwt.falso.screenshot');
    window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
    window.localStorage.setItem('empresa_selecionada_cliente_id', 'cli-1');
  });
  const estado = { falharCursor: false };
  await ctx.route('**/api/native/**', (route) => {
    const u = new URL(route.request().url());
    const corpo = responder(u.pathname.replace(/^\/api\/native/, ''), u.searchParams, estado);
    const status = corpo && corpo.__status ? corpo.__status : 200;
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));

  const shot = async (etapa) => {
    await page.waitForTimeout(350);
    const medidas = await page.evaluate(() => {
      // Alvos de toque do FORMULÁRIO e do seletor de pai (o que esta tela acrescenta).
      const escopo = '[data-testid="b1-form"] button, [data-testid="b1-form"] input, [data-testid="b1-form"] [role="combobox"], [data-testid="seletor-pai-natureza-painel"] button';
      const visiveis = [...document.querySelectorAll(escopo)].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
      });
      const alturas = visiveis.map((b) => Math.round(b.getBoundingClientRect().height));
      return { scrollWidth: document.documentElement.scrollWidth, menorBotao: alturas.length ? Math.min(...alturas) : '-' };
    });
    const arquivo = `naturezas-${rotulo}-${etapa}.png`;
    await page.screenshot({ path: path.join(OUT, arquivo) });
    const overflow = medidas.scrollWidth > w;
    if (overflow) falhas.push(`${arquivo}: rolagem horizontal (${medidas.scrollWidth} > ${w})`);
    resumo.push(`${arquivo}  scrollWidth=${medidas.scrollWidth}/${w}  menor_alvo_form=${medidas.menorBotao}px${overflow ? '  OVERFLOW' : ''}`);
  };
  const exigir = async (loc, etapa) => {
    if (!(await loc.count())) {
      falhas.push(`${rotulo}: etapa "${etapa}" não encontrada`);
      return null;
    }
    return loc.first();
  };
  const escolherTipo = async (rotuloOpcao) => {
    const combo = await exigir(page.getByRole('combobox', { name: 'Tipo' }), 'combobox Tipo');
    if (!combo) return;
    await combo.click();
    await page.waitForTimeout(250);
    const opcao = await exigir(page.getByRole('option', { name: rotuloOpcao, exact: true }), `opção ${rotuloOpcao}`);
    if (opcao) await opcao.click();
    await page.waitForTimeout(250);
  };
  const voltarLista = async () => {
    await page.goto(`${BASE}/naturezasfinanceiras`, { waitUntil: 'networkidle' });
    await page.evaluate(FAIXA);
    await page.waitForTimeout(800);
  };

  // 1. Lista padrão: Despesa / Ativos
  await voltarLista();
  await shot('01-lista-despesa-ativos');

  // 2. Filtro Receita
  const filtro = await exigir(page.getByRole('combobox', { name: 'Filtrar por tipo' }), 'filtro tipo');
  if (filtro) {
    await filtro.click();
    await page.waitForTimeout(250);
    const rec = await exigir(page.getByRole('option', { name: 'Receita', exact: true }), 'opção Receita');
    if (rec) await rec.click();
    await page.waitForTimeout(600);
    await shot('02-lista-filtro-receita');
  }

  // 3. Novo: tipo obrigatório (Salvar sem tipo)
  await voltarLista();
  const novo = await exigir(page.getByRole('button', { name: 'Novo' }), 'botão Novo');
  if (novo) {
    await novo.click();
    await page.waitForTimeout(600);
    await shot('03-novo-vazio');
    await page.getByLabel(/^Nome/).first().fill('FRETE DE GADO');
    const salvar = await exigir(page.getByRole('button', { name: 'Salvar' }), 'botão Salvar');
    if (salvar) await salvar.click();
    await page.waitForTimeout(500);
    await shot('04-novo-tipo-obrigatorio');

    // 4. Novo com tipo Despesa, sem pai e depois com pai escolhido
    await escolherTipo('Despesa');
    await shot('05-novo-despesa-sem-pai');
    await page.getByTestId('seletor-pai-natureza').click();
    await page.waitForTimeout(700);
    await shot('06-novo-seletor-pai-aberto');
    const opcao = await exigir(page.getByRole('option', { name: /^1\s*INSUMOS$/ }), 'opção pai');
    if (opcao) await opcao.click();
    await shot('07-novo-com-pai');
  }

  // 5. Registro somente leitura
  await voltarLista();
  // Tabela (desktop/tablet): duplo clique na linha; cards (celular): toque no card.
  const naTabela = page.getByTestId('natureza-caminho-n3');
  const linha = (await naTabela.count())
    ? naTabela.first()
    : await exigir(page.getByText('INSUMOS / NUTRIÇÃO ANIMAL / SAL MINERAL', { exact: true }), 'card SAL MINERAL');
  if (linha) {
    if (await naTabela.count()) await linha.dblclick();
    else {
      // Card: 1º toque seleciona, 2º toque (duplo) abre o registro em leitura.
      await linha.scrollIntoViewIfNeeded();
      await linha.dblclick();
    }
    await page.waitForTimeout(800);
    await shot('08-registro-somente-leitura');

    // 6. Edição: tipo só leitura, seletor com busca, carregar mais, falha + retry
    const editar = await exigir(page.getByRole('button', { name: 'Editar' }), 'botão Editar');
    if (editar) {
      await editar.click();
      await page.waitForTimeout(400);
      await shot('09-edicao');
      await page.getByTestId('seletor-pai-natureza').click();
      await page.waitForTimeout(700);
      await page.getByRole('searchbox', { name: 'Buscar natureza pai' }).fill('natureza 0');
      await page.waitForTimeout(900);
      await shot('10-edicao-pai-busca');
      await page.getByRole('searchbox', { name: 'Buscar natureza pai' }).fill('');
      await page.waitForTimeout(900);
      estado.falharCursor = true;
      const mais = await exigir(page.getByRole('button', { name: 'Carregar mais' }), 'Carregar mais');
      if (mais) {
        await mais.click();
        await page.waitForTimeout(900);
        await page.getByRole('alert').first().scrollIntoViewIfNeeded().catch(() => {});
        await shot('11-pai-falha-lista-incompleta');
        estado.falharCursor = false;
        const retry = await exigir(page.getByRole('button', { name: 'Tentar novamente' }), 'Tentar novamente');
        if (retry) {
          await retry.click();
          await page.waitForTimeout(900);
          await shot('12-pai-retry-ok');
        }
      }
      // 7. Inativação pelo switch: confirmação
      await page.getByRole('button', { name: 'Fechar seleção de pai' }).click().catch(() => {});
      const chave = await exigir(page.getByRole('switch', { name: 'Natureza financeira ativa' }), 'switch Ativo');
      if (chave) {
        await chave.click();
        const salvar = await exigir(page.getByRole('button', { name: 'Salvar' }), 'Salvar edição');
        if (salvar) await salvar.click();
        await page.waitForTimeout(600);
        await shot('13-inativar-confirmacao');
      }
    }
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
