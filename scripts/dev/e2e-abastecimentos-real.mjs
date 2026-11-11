#!/usr/bin/env node
/**
 * D-PROD-159 / D-PROD-162 — PROVA DE USO REAL ponta a ponta da tela
 * Abastecimentos (Patrimônio e Frota). Tela real + backend Fastify REAL +
 * Vite + PostgreSQL LOCAL, conduzidos pelo Playwright (Chromium já instalado;
 * nada é instalado); depois de cada passo confere o BANCO (Prisma).
 *
 * D-PROD-162 (MAIKE-PATRIMONIO-SIMPLIFICA-01): sem tipo de combustível, sem
 * vínculo combustível × produto e sem fator kg/L. O tanque aceita Produtos
 * do estoque; o abastecimento baixa EXATAMENTE a quantidade digitada, na
 * unidade do Produto (L ou KG). O aceite humano do fluxo de cadastro (Produto
 * e Bem pela tela) está em `e2e-patrimonio-simplifica-real.mjs`; este roteiro
 * cobre a tela de Abastecimentos com a semente pela API real
 * (`e2e-abastecimentos-seed.mjs#semearAbastecimentoE2E`: Produtos em L e KG,
 * compras P3 em L e KG, bens com os Produtos aceitos).
 *
 * Roteiro (em 1280, 820 e 390 px; cada largura num tenant próprio; "hoje" =
 * dia real no fuso da fazenda):
 *   1. tela vazia, sem "Fatores kg/L" nem nada de combustível;
 *   2. bem cujo tanque não aceita Produto (UT-04) → "Os tanques deste bem não
 *      têm Produto aceito…" + "Abrir Bens Patrimoniais"; nada a escolher;
 *   3. Novo abastecimento: TP-02 → DIESEL S10 GRANEL já marcado → "Sai do
 *      estoque: TANQUE DIESEL SEDE" → "Quantidade abastecida (L)" 80 →
 *      horímetro 1.550,5 → tanque cheio → "Revisar abastecimento": baixa de
 *      80,0000 L, custo estimado R$ 425,00 em 2 lotes FIFO (vetor `fifo`);
 *      a revisão NÃO grava nada;
 *   4. confirmar → banco: 1 abastecimento CONFIRMADO (80 L, unidade L, custo
 *      FIFO 425,0000 / 5,3125), Saída `abastecimento_patrimonio` rotulada `L`,
 *      2 fatias, lotes 0 / 70 L, `estoque_atual` 70; o bem não muda; nenhum
 *      lançamento financeiro novo;
 *   5. histórico: lista (Data | Máquina/Veículo | Produto | Quantidade |
 *      Medidor | Situação; cards no celular) e consulta (quantidade, custo por
 *      L, fatias, movimento);
 *   6. cancelar (motivo + ciência; aviso da leitura operacional) → banco:
 *      CANCELADO versão 2, Entrada `estorno_abastecimento` de 80 L, lotes de
 *      volta a 50 / 100, `estoque_atual` 150;
 *   7. resposta PERDIDA (o pedido chega ao servidor e a resposta some) →
 *      "Resultado incerto" → "Repetir o mesmo envio" = a MESMA `operation_id`,
 *      replay ("nada foi duplicado") e UMA baixa só (30 L);
 *  7b. envio que NÃO chega → "Consultar" diz "não foi gravado" → "Repetir"
 *      com a resposta perdida → "Consultar" acha pela `operation_id`; UMA
 *      baixa só (10 L);
 *   8. troca do Produto aceito PELA TELA de Bens (A → B): no TP-02 tira o
 *      DIESEL S10 GRANEL e aceita o DIESEL S10 ESTOQUE NOVO → banco: o aceite
 *      antigo, que tem histórico, fica inativo (a linha é mantida); o novo
 *      ativo. Novo abastecimento oferece só o Produto novo (20 L, baixa só nos
 *      lotes dele); a consulta do abastecimento antigo ainda mostra o Produto
 *      antigo e o cancelamento dele devolve exatamente aos lotes antigos;
 *   9. usuário só com `visualizar`: vê lista e consulta, nenhum botão de
 *      ação; a API real recusa 403 os comandos e nada muda no banco; as rotas
 *      de fator e de combustível removidas respondem 404 e o corpo antigo
 *      (`quantidade_litros`/`tipo_combustivel_id`) é recusado com 400.
 *  Toda resposta ≥ 400 da API real observada pelas telas é divergência. Em
 *  TODA captura a página não rola na horizontal. Na tabela, nenhum rótulo de
 *  cabeçalho cortado (exceção: "Máquina/Veículo" em < 1024 px) nem célula de
 *  Data/Quantidade/Medidor/Situação cortada, coluna Produto com >= 128 px e a
 *  grade sem rolagem horizontal.
 *
 * Uso:
 *   DATABASE_URL=postgresql://postgres@localhost:5433/maike_simp_e2e2?host=/tmp \
 *     node scripts/dev/e2e-abastecimentos-real.mjs [pasta-das-capturas]
 * Variáveis opcionais: E2E_API_PORT (3952), E2E_WEB_PORT (5252),
 * E2E_LARGURAS ("1280,820,390"). O banco precisa estar migrado
 * (`npm run deploy:migrate` com a mesma URL). Recusa banco que não seja local.
 * Encerra backend e Vite ao sair. Sai com código ≠ 0 em QUALQUER divergência.
 */
import os from 'node:os';
import path from 'node:path';

import { VETOR_FIFO, semearAbastecimentoE2E } from './e2e-abastecimentos-seed.mjs';
import { Divergencia, carregarChromium, criarEnsaio, dec } from './e2e-patrimonio-comum.mjs';

const chromium = await carregarChromium();
if (!chromium) {
  console.error('playwright não encontrado: o ensaio usa o Playwright já instalado no ambiente (nada é instalado).');
  process.exit(2);
}
const LARGURAS = String(process.env.E2E_LARGURAS || '1280,820,390')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 320);
const E = criarEnsaio({
  nome: 'abastecimentos',
  out: path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maike-e2e-abastecimentos')),
  apiPort: Number(process.env.E2E_API_PORT || 3952),
  webPort: Number(process.env.E2E_WEB_PORT || 5252),
});
const { WEB, conferir, exigir, igual, esperarBanco } = E;
const FIFO = VETOR_FIFO;
const COLUNAS_PADRAO = 'Data | Máquina/Veículo | Produto | Quantidade | Medidor | Situação';
const TEXTO_TANQUE_SEM_PRODUTO = 'Os tanques deste bem não têm Produto aceito. Marque os Produtos aceitos em Bens Patrimoniais › Operação › Tanques.';
/** Texto da tela normalizado (o Intl põe espaço não separável em "R$ 425,00"). @param {string} t */
const texto = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

process.env.DATABASE_URL = E.DATABASE_URL;
const { getPrismaClient, closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
const prisma = getPrismaClient();

/** Foto das linhas que o abastecimento pode tocar (prova de "nada gravado" e de "bem intocado"). */
const fotoBanco = async (s) => {
  const w = { where: { cliente_id: s.cliente_id }, orderBy: { id: 'asc' } };
  const out = {
    abastecimentos: await prisma.abastecimentoBem.findMany(w),
    fatias: await prisma.abastecimentoBemConsumoLote.findMany(w),
    aceites: await prisma.tanqueBemProduto.findMany(w),
    movimentos: await prisma.movimentacaoEstoque.findMany({ ...w, select: { id: true, status: true, quantidade: true, unidade_medida: true } }),
    lotes: await prisma.estoqueLoteNota.findMany({ ...w, select: { id: true, quantidade_disponivel: true, status: true } }),
    produtos: await prisma.produto.findMany({ ...w, select: { id: true, estoque_atual: true } }),
    bens: await prisma.bemPatrimonial.findMany(w),
    financeiro: await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } }),
  };
  return JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
};
const lotesDe = async (s, produtoId) =>
  (await prisma.estoqueLoteNota.findMany({ where: { cliente_id: s.cliente_id, produto_id: produtoId }, orderBy: [{ data_documento: 'asc' }, { createdAt: 'asc' }] }))
    .map((l) => `${dec(l.quantidade_disponivel)}:${l.status}`)
    .join('|');
const estoqueDe = async (s, produtoId) => dec((await prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, id: produtoId } })).estoque_atual);
/** Colunas do medidor do bem (o abastecimento NUNCA grava coluna do bem; o PATCH do passo 8 só mexe no tanque). */
const medidorCru = async (s, bemId) => {
  const b = await prisma.bemPatrimonial.findFirst({ where: { cliente_id: s.cliente_id, id: bemId } });
  return `${b.medidor_tipo}:${dec(b.medidor_leitura_atual)}:${b.medidor_origem}:${String(b.medidor_data_leitura?.toISOString?.() ?? b.medidor_data_leitura)}`;
};
const bemCru = async (s, bemId) => {
  const b = await prisma.bemPatrimonial.findFirst({ where: { cliente_id: s.cliente_id, id: bemId } });
  return `${b.versao}:${await medidorCru(s, bemId)}:${b.updatedAt?.toISOString?.() ?? ''}`;
};
const aceitesDe = async (s, tanqueId) =>
  (await prisma.tanqueBemProduto.findMany({ where: { cliente_id: s.cliente_id, tanque_id: tanqueId }, orderBy: { createdAt: 'asc' } })).map((a) => ({ produto_id: a.produto_id, ativo: a.ativo }));

// ─── Roteiro por largura ────────────────────────────────────────────────────
const executarLargura = async (browser, largura) => {
  const rotulo = String(largura);
  const movel = largura < 640;
  const s = await semearAbastecimentoE2E({ rotulo: `w${rotulo}`, api: E.api, login: E.login });
  const token = await E.login(s.credenciais);
  const tokenVis = await E.login(s.usuarios.vis.credenciais);
  const registro = { errosPagina: [], respostasApi: [], contador: { n: 0 } };
  const atores = [];
  const passo = (nome, fn) => E.passo(rotulo, nome, fn, atores);
  const [ano, mes, dia] = String(s.hoje).split('-');
  const dataBr = `${dia}/${mes}/${ano}`;
  const reg = {};

  const abrirAtor = async (ator, tokenAtor) => {
    const a = await E.abrirAtor(browser, { largura, rotulo, ator, token: tokenAtor, empresaId: s.empresa.id, clienteId: s.cliente_id, prefixo: 'abast' }, registro);
    atores.push(a);
    const { page, visivel, shot } = a;
    const irParaLista = async () => {
      await page.goto(`${WEB}/abastecimentos`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
    };
    const esperarNaLista = (r) =>
      page.waitForFunction(
        ({ id, q }) =>
          [...document.querySelectorAll(`[data-testid="abastecimento-bem-${id}"]`)].some((e) => e.getClientRects().length > 0) ||
          [...document.querySelectorAll('[data-testid="b1-card"]')].some((e) => e.textContent?.includes(q) && e.getClientRects().length > 0),
        { id: r.id, q: r.quantidade },
      );
    /**
     * Lista padrão com os registros (e captura). Tabela (≥ 640 px; obrigatória
     * em ≥ 1024): colunas exatas, sem combustível; linha com máquina, Produto,
     * quantidade + unidade, data e situação. Celular: cards.
     */
    const conferirLista = async (registros, etapa) => {
      await irParaLista();
      for (const r of registros) await esperarNaLista(r);
      const cabecalhos = (await page.getByRole('columnheader').filter({ visible: true }).allTextContents()).map((t) => t.trim()).filter(Boolean);
      if (largura >= 1024) conferir(cabecalhos.length > 0, `[${rotulo}] ${ator}: lista sem tabela em ${largura} px`);
      if (movel) conferir(cabecalhos.length === 0, `[${rotulo}] ${ator}: lista em tabela no celular (${cabecalhos.join(' | ')})`);
      if (cabecalhos.length) {
        igual(cabecalhos.join(' | '), COLUNAS_PADRAO, `[${rotulo}] ${ator}: colunas padrão da lista`);
        conferir(!cabecalhos.some((c) => /combust|litros|^kg$/i.test(c)), `[${rotulo}] ${ator}: coluna de combustível/litros/kg na lista (${cabecalhos.join(' | ')})`);
        const encaixe = await page.getByRole('columnheader', { name: 'Situação' }).first().evaluate((th) => {
          let el = th.parentElement;
          while (el && el !== document.body) {
            const ox = getComputedStyle(el).overflowX;
            if (ox === 'auto' || ox === 'scroll') break;
            el = el.parentElement;
          }
          const caixa = (el && el !== document.body ? el : document.documentElement).getBoundingClientRect();
          return { direita: Math.round(th.getBoundingClientRect().right), limite: Math.round(caixa.right), sw: el?.scrollWidth ?? 0, cw: el?.clientWidth ?? 0 };
        });
        conferir(encaixe.direita <= encaixe.limite + 1, `[${rotulo}] ${ator}: coluna Situação fora da área visível da grade em ${largura} px (${encaixe.direita} > ${encaixe.limite})`);
        conferir(encaixe.sw <= encaixe.cw + 1, `[${rotulo}] ${ator}: a grade rola na horizontal em ${largura} px (${encaixe.sw} > ${encaixe.cw} + 1)`);
        const cortes = await visivel(page.locator('table.mg-grid')).evaluate((tabela) => {
          const ths = [...tabela.querySelectorAll('thead th')];
          const rotuloDe = (th) => th.querySelector('button span') || th.querySelector('button');
          const out = [];
          const cabecalhosCortados = [];
          const indice = {};
          ths.forEach((th, i) => {
            const el = rotuloDe(th);
            const t = el?.textContent.trim();
            if (!t) return;
            indice[t] = i;
            if (el.scrollWidth > el.clientWidth + 1) cabecalhosCortados.push({ t, sw: el.scrollWidth, cw: el.clientWidth });
          });
          for (const tr of tabela.querySelectorAll('tbody tr')) {
            for (const nome of ['Data', 'Quantidade', 'Medidor', 'Situação']) {
              const td = indice[nome] === undefined ? null : tr.children[indice[nome]];
              if (td && td.scrollWidth > td.clientWidth + 1) out.push(`${nome} "${td.textContent.trim()}" (${td.scrollWidth} > ${td.clientWidth})`);
            }
          }
          const thProduto = indice.Produto === undefined ? null : ths[indice.Produto];
          return { out, cabecalhosCortados, rotulos: Object.keys(indice), larguraProduto: thProduto ? Math.round(thProduto.getBoundingClientRect().width * 10) / 10 : 0 };
        });
        igual(cortes.rotulos.join(' | '), COLUNAS_PADRAO, `[${rotulo}] ${ator}: rótulos medidos na grade`);
        // Só o rótulo "Máquina/Veículo" pode sair com reticências, e só em < 1024 px (exceção aceita na UX-02).
        const podeCortar = (t) => largura < 1024 && t === 'Máquina/Veículo';
        const ruins = cortes.cabecalhosCortados.filter((c) => !podeCortar(c.t)).map((c) => `cabeçalho "${c.t}" (${c.sw} > ${c.cw})`);
        conferir(ruins.length === 0 && cortes.out.length === 0, `[${rotulo}] ${ator}: texto cortado na lista em ${largura} px: ${[...ruins, ...cortes.out].join('; ')}`);
        conferir(cortes.larguraProduto >= 128, `[${rotulo}] ${ator}: coluna Produto com ${cortes.larguraProduto} px (< 128) em ${largura} px`);
        for (const r of registros) {
          const linha = visivel(page.locator('tr').filter({ has: page.getByTestId(`abastecimento-bem-${r.id}`) }));
          const txt = texto(await linha.innerText());
          conferir(txt.includes(r.frota) && txt.includes(r.produto) && txt.includes(r.quantidade) && txt.includes(dataBr), `[${rotulo}] ${ator}: linha da lista sem máquina/Produto/quantidade/data (${txt})`);
          igual(texto(await visivel(page.getByTestId(`abastecimento-situacao-${r.id}`)).innerText()), r.situacao, `[${rotulo}] ${ator}: linha ${r.quantidade} — Situação`);
        }
      }
      if (movel) {
        for (const r of registros) {
          const card = visivel(page.getByTestId('b1-card').filter({ hasText: r.quantidade }));
          const titulo = texto(await card.locator('.mg-b1-card__title').innerText().catch(() => ''));
          conferir(titulo.includes(r.frota), `[${rotulo}] ${ator}: título do card sem a máquina/veículo (${titulo})`);
          const rotulos = (await card.locator('.mg-b1-card__label').allInnerTexts()).map((t) => t.trim().replace(/:$/, ''));
          const valores = (await card.locator('.mg-b1-card__value').allInnerTexts()).map((t) => texto(t));
          const campos = Object.fromEntries(rotulos.map((rr, i) => [rr, valores[i]]));
          igual(campos.Produto, r.produto, `[${rotulo}] ${ator}: card ${r.quantidade} — Produto`);
          igual(campos.Quantidade, r.quantidade, `[${rotulo}] ${ator}: card ${r.quantidade} — Quantidade`);
          igual(campos.Data, dataBr, `[${rotulo}] ${ator}: card ${r.quantidade} — Data`);
          conferir(!rotulos.some((rr) => /combust/i.test(rr)), `[${rotulo}] ${ator}: card com combustível (${rotulos.join(', ')})`);
          const sub = texto(await card.locator('.mg-b1-card__sub').innerText().catch(() => ''));
          conferir(sub === r.situacao || campos['Situação'] === r.situacao, `[${rotulo}] ${ator}: card ${r.quantidade} sem a Situação "${r.situacao}" (subtítulo "${sub}")`);
        }
      }
      await shot(etapa);
    };
    /** Abre o abastecimento pela lista (tabela: célula da máquina; celular: card com a quantidade). */
    const abrirNaLista = async (r) => {
      await irParaLista();
      await esperarNaLista(r);
      let alvo = page.getByTestId(`abastecimento-bem-${r.id}`);
      if (!(await visivel(alvo).isVisible().catch(() => false))) alvo = page.getByTestId('b1-card').filter({ hasText: r.quantidade });
      const el = visivel(alvo);
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.dblclick();
      await visivel(page.getByTestId('abastecimento-consulta')).waitFor();
    };
    return { ...a, irParaLista, conferirLista, abrirNaLista };
  };

  const dono = await abrirAtor('dono', token);
  const { page, shot, visivel, clicar, preencher, escolher } = dono;
  const bemAntes = await bemCru(s, s.trator.id);
  const esperarAviso = (re, ms = 8000) =>
    visivel(page.getByText(re))
      .waitFor({ timeout: ms })
      .then(
        () => true,
        () => false,
      );

  /**
   * Formulário do TP-02 como o usuário: máquina → o único Produto aceito já
   * vem marcado → local automático → quantidade/leitura em pt-BR → tanque cheio.
   */
  const preencherTrator = async (produto, quantidade, leitura) => {
    await clicar(page.getByRole('button', { name: 'Novo abastecimento' }));
    const form = visivel(page.getByTestId('abastecimento-form'));
    await form.waitFor();
    await escolher(form, 'abastecimento-bem', /TP-02/);
    await page.waitForFunction(
      (nome) =>
        [...document.querySelectorAll('[data-testid="abastecimento-produto"] [role="radio"][aria-checked="true"]')].some((r) => r.textContent?.trim() === nome && r.getClientRects().length > 0),
      produto,
    );
    igual(await page.getByTestId('abastecimento-produto').getByRole('radio').filter({ visible: true }).count(), 1, `[${rotulo}] Produtos oferecidos para o TP-02`);
    await visivel(page.getByTestId('abastecimento-local-auto').filter({ hasText: 'Sai do estoque: TANQUE DIESEL SEDE' })).waitFor();
    igual(await form.getByText(/combust[íi]vel|fator|kg\/L/i).filter({ visible: true }).count(), 0, `[${rotulo}] o formulário fala de combustível/fator`);
    conferir(await visivel(form.getByText('Quantidade abastecida (L)')).isVisible().catch(() => false), `[${rotulo}] campo "Quantidade abastecida (L)" ausente`);
    igual(await page.getByTestId('abastecimento-dica-kg').filter({ visible: true }).count(), 0, `[${rotulo}] dica de KG para Produto em L`);
    igual(await visivel(page.getByTestId('abastecimento-data')).inputValue(), s.hoje, `[${rotulo}] data padrão do formulário (hoje no fuso da fazenda)`);
    await preencher('abastecimento-quantidade', quantidade);
    await preencher('abastecimento-leitura', leitura);
    const sim = visivel(page.getByTestId('abastecimento-tanque-cheio').getByRole('radio', { name: 'Sim' }));
    if ((await sim.getAttribute('aria-checked')) !== 'true') await sim.click();
    return form;
  };
  const pedirPrevia = async () => {
    await clicar(page.getByTestId('abastecimento-previa'));
    const dlg = visivel(page.getByTestId('dialogo-previa-abastecimento'));
    await dlg.waitFor();
    await visivel(page.getByTestId('previa-baixa')).waitFor();
    return dlg;
  };
  const abrirDetalhesDoEstoque = async () => {
    const b = visivel(page.getByTestId('previa-detalhes-estoque'));
    igual(await b.getAttribute('aria-expanded'), 'false', `[${rotulo}] "Detalhes do estoque" não começa recolhido`);
    await b.click();
    await visivel(page.getByTestId('previa-detalhes-conteudo')).waitFor();
  };
  const saidasAtivas = () => prisma.movimentacaoEstoque.count({ where: { cliente_id: s.cliente_id, origem_sistema: 'abastecimento_patrimonio', tipo_movimentacao: 'Saída', status: 'Ativa' } });
  const financeiroInicial = await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } });

  try {
    await passo('1 tela vazia, sem fator kg/L nem combustível', async () => {
      await dono.irParaLista();
      await visivel(page.getByTestId('abastecimento-lista-vazia')).waitFor();
      exigir(await visivel(page.getByRole('button', { name: 'Novo abastecimento' })).isVisible(), `[${rotulo}] dono sem o botão "Novo abastecimento"`);
      igual(await page.getByTestId('abastecimento-fatores').count(), 0, `[${rotulo}] botão "Fatores kg/L" na tela`);
      igual(await page.getByRole('button', { name: /fator|kg\/L|combust/i }).filter({ visible: true }).count(), 0, `[${rotulo}] botão de fator/combustível na tela`);
      await shot('lista-vazia');
    });

    await passo('2 bem com tanque sem Produto aceito: aviso e nada a escolher', async () => {
      await clicar(page.getByRole('button', { name: 'Novo abastecimento' }));
      const form = visivel(page.getByTestId('abastecimento-form'));
      await form.waitFor();
      await escolher(form, 'abastecimento-bem', /UT-04/);
      const aviso = visivel(page.getByTestId('abastecimento-sem-produto'));
      await aviso.waitFor();
      const txt = texto(await aviso.innerText());
      conferir(txt.includes(TEXTO_TANQUE_SEM_PRODUTO), `[${rotulo}] aviso de tanque sem Produto: ${txt}`);
      conferir(await visivel(page.getByTestId('abastecimento-abrir-bens')).isVisible().catch(() => false), `[${rotulo}] sem o link "Abrir Bens Patrimoniais"`);
      igual(await page.getByTestId('abastecimento-produto').count(), 0, `[${rotulo}] Produto a escolher para bem sem Produto aceito`);
      await shot('sem-produto-aceito');
      await dono.irParaLista();
    });

    await passo('3 formulário → revisão em L (sem escrita)', async () => {
      await preencherTrator('DIESEL S10 GRANEL', '80', '1.550,5');
      await shot('formulario');
      const antes = await fotoBanco(s);
      await pedirPrevia();
      const resumo = texto(await visivel(page.getByTestId('previa-resumo')).innerText());
      conferir(resumo.includes('DIESEL S10 GRANEL') && resumo.includes('80 L') && resumo.includes('Baixa de 80,0000 L'), `[${rotulo}] revisão: resumo ${resumo}`);
      igual(texto(await visivel(page.getByTestId('previa-baixa')).innerText()), '80,0000 L', `[${rotulo}] revisão: baixa`);
      igual(await page.getByTestId('previa-custo').filter({ visible: true }).count(), 0, `[${rotulo}] revisão: custo fora de "Detalhes do estoque"`);
      await shot('previa');
      await abrirDetalhesDoEstoque();
      const custo = texto(await visivel(page.getByTestId('previa-custo')).innerText());
      conferir(custo.includes('R$ 425,00') && custo.includes('5,3125/L') && /estimativa/i.test(custo), `[${rotulo}] revisão: custo ${custo}`);
      conferir(texto(await visivel(page.getByTestId('previa-capacidade')).innerText()).includes('conferida (Produto em litros)'), `[${rotulo}] revisão: capacidade não conferida`);
      const linhas = await visivel(page.getByTestId('previa-fatias')).locator('tbody tr').allInnerTexts();
      igual(linhas.length, FIFO.fatias.length, `[${rotulo}] revisão: lotes FIFO`);
      conferir(linhas[0]?.includes('50,0000') && linhas[1]?.includes('30,0000'), `[${rotulo}] revisão: fatias ${linhas.join(' / ')}`);
      igual(await page.getByTestId('previa-bloqueios').count(), 0, `[${rotulo}] revisão com bloqueio`);
      igual(await fotoBanco(s), antes, `[${rotulo}] a revisão gravou algo`);
      await shot('previa-detalhes');
    });

    await passo('4 confirmar → baixa FIFO exata no banco', async () => {
      await clicar(page.getByTestId('abastecimento-confirmar'));
      await visivel(page.getByTestId('abastecimento-consulta')).waitFor({ timeout: 30000 });
      conferir(await esperarAviso(/confirmado: 80,0000 L baixados do estoque\./), `[${rotulo}] aviso de confirmação ausente`);
      const ab = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, status: 'CONFIRMADO' } }), 'abastecimento confirmado');
      igual(
        `${dec(ab.quantidade)}:${ab.unidade}:${dec(ab.custo_total)}:${dec(ab.custo_unitario)}:${dec(ab.medidor_leitura)}:${ab.tanque_cheio}:${ab.produto_id === s.produto.id}`,
        `${FIFO.quantidade}:L:${FIFO.custo_total}:${FIFO.custo_unitario}:1550.5000:true:true`,
        `[${rotulo}] abastecimento no banco`,
      );
      const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: ab.movimentacao_estoque_id } });
      igual(
        `${mov.tipo_movimentacao}:${mov.origem_sistema}:${mov.lancamento_origem_id === ab.id}:${mov.unidade_medida}:${dec(mov.quantidade)}:${dec(mov.valor_total)}:${mov.status}`,
        `Saída:abastecimento_patrimonio:true:L:${FIFO.quantidade}:${FIFO.custo_total}:Ativa`,
        `[${rotulo}] movimento de saída`,
      );
      const lotes = await prisma.estoqueLoteNota.findMany({ where: { cliente_id: s.cliente_id, produto_id: s.produto.id }, orderBy: [{ data_documento: 'asc' }, { createdAt: 'asc' }] });
      const fatias = await prisma.abastecimentoBemConsumoLote.findMany({ where: { cliente_id: s.cliente_id, abastecimento_id: ab.id }, orderBy: { ordem: 'asc' } });
      igual(
        fatias.map((f) => `${f.estoque_lote_nota_id === lotes[f.ordem - 1]?.id}:${dec(f.quantidade)}:${dec(f.custo_unitario)}:${dec(f.quantidade.times(f.custo_unitario).toDecimalPlaces(4))}`).join('|'),
        FIFO.fatias.map((f) => `true:${f.quantidade}:${f.custo_unitario}:${f.valor}`).join('|'),
        `[${rotulo}] fatias FIFO`,
      );
      igual(await lotesDe(s, s.produto.id), '0.0000:Esgotado|70.0000:Disponivel', `[${rotulo}] lotes após a baixa`);
      igual(await estoqueDe(s, s.produto.id), '70.0000', `[${rotulo}] estoque_atual após a baixa`);
      igual(await bemCru(s, s.trator.id), bemAntes, `[${rotulo}] o abastecimento alterou o bem`);
      igual(await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } }), financeiroInicial, `[${rotulo}] lançamento financeiro criado`);
      reg.primeiro = { id: ab.id, frota: 'TP-02', produto: 'DIESEL S10 GRANEL', quantidade: '80,0000 L', situacao: 'Confirmado' };
      await shot('confirmado');
    });

    await passo('5 histórico: lista e consulta', async () => {
      await dono.conferirLista([reg.primeiro], 'lista');
      await dono.abrirNaLista(reg.primeiro);
      igual(texto(await visivel(page.getByTestId('consulta-quantidade')).innerText()), '80,0000 L', `[${rotulo}] consulta: quantidade`);
      const custo = texto(await visivel(page.getByTestId('consulta-custo')).innerText());
      conferir(custo.includes('R$ 425,00') && custo.includes('5,3125/L'), `[${rotulo}] consulta: custo ${custo}`);
      igual(await visivel(page.getByTestId('consulta-fatias')).locator('tbody tr').count(), 2, `[${rotulo}] consulta: fatias`);
      conferir(/Saída|abastecimento/i.test(await visivel(page.getByTestId('consulta-movimento')).innerText()), `[${rotulo}] consulta: movimento ausente`);
      igual(texto(await visivel(page.getByTestId('abastecimento-consulta-situacao')).innerText()), 'Confirmado', `[${rotulo}] consulta: situação`);
      igual(texto(await visivel(page.getByTestId('consulta-produto')).innerText()), 'DIESEL S10 GRANEL', `[${rotulo}] consulta: Produto`);
      igual(await page.getByTestId('consulta-tipo').count(), 0, `[${rotulo}] consulta ainda mostra o tipo de combustível`);
      await shot('consulta');
    });

    await passo('6 cancelar → devolução exata aos lotes', async () => {
      await clicar(page.getByTestId('abastecimento-cancelar'));
      await visivel(page.getByTestId('dialogo-cancelamento-abastecimento')).waitFor();
      const aviso = visivel(page.getByTestId('cancelamento-aviso-medidor'));
      conferir(await aviso.isVisible().catch(() => false), `[${rotulo}] cancelamento sem o aviso da leitura operacional`);
      conferir(/1\.550,5/.test(await aviso.innerText().catch(() => '')), `[${rotulo}] aviso do medidor sem a leitura 1.550,5`);
      const enviar = visivel(page.getByTestId('cancelamento-enviar'));
      conferir(await enviar.isDisabled(), `[${rotulo}] cancelar habilitado sem motivo/ciência`);
      await visivel(page.getByTestId('cancelamento-motivo')).fill('Lançado no bem errado');
      await visivel(page.getByTestId('cancelamento-ciente')).check();
      await shot('cancelamento');
      await enviar.click();
      conferir(await esperarAviso(/cancelado: 80,0000 L devolvidos aos lotes de origem\./, 15000), `[${rotulo}] aviso de cancelamento ausente`);
      const ab = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, id: reg.primeiro.id, status: 'CANCELADO' } }), 'abastecimento cancelado');
      igual(`${ab.versao}:${ab.motivo_cancelamento}`, '2:Lançado no bem errado', `[${rotulo}] cancelamento no banco`);
      const est = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: ab.movimentacao_estorno_id } });
      igual(`${est?.tipo_movimentacao}:${est?.tipo_detalhado}:${est?.unidade_medida}:${dec(est?.quantidade)}:${dec(est?.valor_total)}`, `Entrada:estorno_abastecimento:L:${FIFO.quantidade}:${FIFO.custo_total}`, `[${rotulo}] movimento de estorno`);
      igual(await lotesDe(s, s.produto.id), '50.0000:Disponivel|100.0000:Disponivel', `[${rotulo}] lotes após o cancelamento`);
      igual(await estoqueDe(s, s.produto.id), '150.0000', `[${rotulo}] estoque_atual após o cancelamento`);
      igual(await bemCru(s, s.trator.id), bemAntes, `[${rotulo}] o cancelamento alterou o bem`);
      await visivel(page.getByTestId('consulta-estorno')).waitFor();
      igual(texto(await visivel(page.getByTestId('abastecimento-consulta-situacao')).innerText()), 'Cancelado', `[${rotulo}] consulta: situação após cancelar`);
      igual(await page.getByTestId('abastecimento-cancelar').filter({ visible: true }).count(), 0, `[${rotulo}] botão cancelar num abastecimento cancelado`);
      reg.primeiro.situacao = 'Cancelado';
      await shot('cancelado');
    });

    await passo('7 resposta perdida + "Repetir o mesmo envio" = 1 baixa', async () => {
      await dono.irParaLista();
      await preencherTrator('DIESEL S10 GRANEL', '30', '1.560');
      await pedirPrevia();
      igual(texto(await visivel(page.getByTestId('previa-baixa')).innerText()), '30,0000 L', `[${rotulo}] revisão de 30 L`);
      const enviados = [];
      const rota = (u) => u.pathname === '/api/native/patrimonio-abastecimentos';
      await page.route(rota, async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.continue();
        enviados.push(JSON.parse(req.postData() || '{}').operation_id);
        if (enviados.length === 1) {
          await route.fetch(); // chega ao servidor e é processada…
          return route.abort('failed'); // …mas a resposta se perde no caminho
        }
        return route.continue();
      });
      try {
        await clicar(page.getByTestId('abastecimento-confirmar'));
        await visivel(page.getByTestId('resultado-incerto')).waitFor({ timeout: 30000 });
        await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, operation_id: enviados[0] } }), 'abastecimento gravado pela 1ª tentativa');
        conferir(!(await page.getByTestId('abastecimento-consulta').filter({ visible: true }).count()), `[${rotulo}] resultado incerto tratado como sucesso`);
        await shot('resultado-incerto');
        await clicar(page.getByTestId('botao-repetir-envio'));
        await visivel(page.getByTestId('abastecimento-consulta')).waitFor({ timeout: 30000 });
        conferir(await esperarAviso(/confirmado: 30,0000 L baixados do estoque\. \(envio repetido: nada foi duplicado\)/), `[${rotulo}] replay não foi comunicado ("nada foi duplicado")`);
        await shot('replay');
      } finally {
        await page.unroute(rota).catch(() => {});
      }
      igual(enviados.length, 2, `[${rotulo}] envios da confirmação`);
      conferir(enviados[0] && enviados[0] === enviados[1], `[${rotulo}] a repetição não reusou o operation_id (${enviados.join(' ≠ ')})`);
      igual(await prisma.abastecimentoBem.count({ where: { cliente_id: s.cliente_id, status: 'CONFIRMADO' } }), 1, `[${rotulo}] abastecimentos confirmados após o replay`);
      igual(await saidasAtivas(), 1, `[${rotulo}] saídas ativas de abastecimento após o replay`);
      igual(await lotesDe(s, s.produto.id), '20.0000:Disponivel|100.0000:Disponivel', `[${rotulo}] lotes após a confirmação repetida (UMA baixa)`);
      igual(await estoqueDe(s, s.produto.id), '120.0000', `[${rotulo}] estoque_atual após a confirmação repetida`);
      const ab = await prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, operation_id: enviados[0] } });
      reg.segundo = { id: ab.id, versao: ab.versao, frota: 'TP-02', produto: 'DIESEL S10 GRANEL', quantidade: '30,0000 L', situacao: 'Confirmado' };
    });

    await passo('7b envio que não chegou + "Consultar" → repetir com resposta perdida + "Consultar" (achado pela operation_id)', async () => {
      await dono.irParaLista();
      await preencherTrator('DIESEL S10 GRANEL', '10', '1.570');
      await pedirPrevia();
      const enviados = [];
      const rota = (u) => u.pathname === '/api/native/patrimonio-abastecimentos';
      await page.route(rota, async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.continue();
        enviados.push(JSON.parse(req.postData() || '{}').operation_id);
        if (enviados.length === 1) return route.abort('failed'); // 1º: nem chega ao servidor
        if (enviados.length === 2) {
          await route.fetch(); // 2º: chega e é gravado…
          return route.abort('failed'); // …mas a resposta se perde
        }
        return route.continue();
      });
      try {
        await clicar(page.getByTestId('abastecimento-confirmar'));
        await visivel(page.getByTestId('resultado-incerto')).waitFor({ timeout: 30000 });
        await clicar(page.getByTestId('botao-consultar-resultado'));
        const nao = visivel(page.getByTestId('consulta-resultado'));
        await nao.waitFor();
        igual(texto(await nao.innerText()), 'O envio não foi gravado. Você pode repetir o mesmo envio.', `[${rotulo}] "Consultar" do envio que não chegou`);
        igual(await prisma.abastecimentoBem.count({ where: { cliente_id: s.cliente_id, operation_id: enviados[0] } }), 0, `[${rotulo}] envio que não chegou foi gravado`);
        await shot('consultar-nao-gravado');
        await clicar(page.getByTestId('botao-repetir-envio'));
        await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, operation_id: enviados[0] } }), 'abastecimento gravado pela repetição');
        await page.waitForFunction(() => document.querySelector('[data-testid="resultado-incerto"]') && !document.querySelector('[data-testid="consulta-resultado"]'));
        await clicar(page.getByTestId('botao-consultar-resultado'));
        await visivel(page.getByTestId('abastecimento-consulta')).waitFor({ timeout: 30000 });
        conferir(await esperarAviso(/confirmado: 10,0000 L baixados do estoque\./), `[${rotulo}] "Consultar" achou o gravado mas não avisou`);
        igual(texto(await visivel(page.getByTestId('consulta-quantidade')).innerText()), '10,0000 L', `[${rotulo}] consulta do abastecimento achado pela chave`);
        await shot('consultar-achado');
      } finally {
        await page.unroute(rota).catch(() => {});
      }
      igual(enviados.length, 2, `[${rotulo}] envios (o "Consultar" não reenvia)`);
      conferir(enviados[0] && enviados[0] === enviados[1], `[${rotulo}] a repetição não reusou o operation_id (${enviados.join(' ≠ ')})`);
      igual(await prisma.abastecimentoBem.count({ where: { cliente_id: s.cliente_id, status: 'CONFIRMADO' } }), 2, `[${rotulo}] abastecimentos confirmados após o "Consultar"`);
      igual(await lotesDe(s, s.produto.id), '10.0000:Disponivel|100.0000:Disponivel', `[${rotulo}] lotes após o "Consultar" (UMA baixa de 10 L)`);
      igual(await estoqueDe(s, s.produto.id), '110.0000', `[${rotulo}] estoque_atual após o "Consultar"`);
      igual(await bemCru(s, s.trator.id), bemAntes, `[${rotulo}] os abastecimentos alteraram o bem`);
      const terceiro = await prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, operation_id: enviados[0] } });
      reg.terceiro = { id: terceiro.id, frota: 'TP-02', produto: 'DIESEL S10 GRANEL', quantidade: '10,0000 L', situacao: 'Confirmado' };
    });

    await passo('8 troca do Produto aceito pela tela de Bens (A → B) sem reescrever o histórico', async () => {
      const medidorAntes = await medidorCru(s, s.trator.id);
      const linhaAntiga = JSON.stringify(await prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, id: reg.segundo.id } }), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      await page.goto(`${WEB}/benspatrimoniais`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      let alvo = page.getByTestId(`bem-nome-${s.trator.id}`);
      await page.waitForFunction(
        (id) =>
          [...document.querySelectorAll(`[data-testid="bem-nome-${id}"]`)].some((e) => e.getClientRects().length > 0) ||
          [...document.querySelectorAll('[data-testid="b1-card"]')].some((e) => e.textContent?.includes('TP-02') && e.getClientRects().length > 0),
        s.trator.id,
      );
      if (!(await visivel(alvo).isVisible().catch(() => false))) alvo = page.getByTestId('b1-card').filter({ hasText: 'TP-02' });
      await visivel(alvo).dblclick();
      const form = visivel(page.getByTestId('b1-form'));
      await form.waitFor();
      await clicar(page.getByRole('button', { name: 'Editar', exact: true }));
      await clicar(page.getByRole('tab', { name: 'Operação' }));
      await visivel(page.getByTestId(`bem-tanque-0-produto-${s.produto.id}`)).waitFor();
      await clicar(page.getByRole('button', { name: /^Tirar DIESEL S10 GRANEL dos Produtos aceitos do tanque/ }));
      igual(await page.getByTestId(`bem-tanque-0-produto-${s.produto.id}`).count(), 0, `[${rotulo}] o Produto retirado continua no tanque`);
      await clicar(page.getByTestId('bem-tanque-seletor-produto-0'));
      const painel = visivel(page.getByTestId('bem-tanque-seletor-produto-0-painel'));
      await painel.getByRole('option', { name: /DIESEL S10 ESTOQUE NOVO/ }).first().click();
      await visivel(page.getByTestId(`bem-tanque-0-produto-${s.produtoNovo.id}`)).waitFor();
      await shot('troca-aceite');
      await clicar(page.getByRole('button', { name: 'Salvar', exact: true }));
      conferir(await esperarAviso('Bem patrimonial atualizado', 15000), `[${rotulo}] aviso "Bem patrimonial atualizado" ausente`);
      await esperarBanco(
        async () => (await aceitesDe(s, s.trator.tanque_id)).some((a) => a.produto_id === s.produtoNovo.id && a.ativo),
        'aceite do Produto novo gravado',
      );
      // D11: o aceite retirado TEM histórico (abastecimentos) → a linha fica, só inativa.
      igual(
        (await aceitesDe(s, s.trator.tanque_id)).map((a) => `${a.produto_id === s.produto.id ? 'A' : a.produto_id === s.produtoNovo.id ? 'B' : '?'}:${a.ativo}`).join('|'),
        'A:false|B:true',
        `[${rotulo}] aceites do tanque após a troca`,
      );
      igual(await medidorCru(s, s.trator.id), medidorAntes, `[${rotulo}] a troca de aceite mexeu no medidor do bem`);
      igual(
        JSON.stringify(await prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, id: reg.segundo.id } }), (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
        linhaAntiga,
        `[${rotulo}] a troca de aceite reescreveu um abastecimento antigo`,
      );

      await dono.irParaLista();
      await preencherTrator('DIESEL S10 ESTOQUE NOVO', '20', '1.580');
      await pedirPrevia();
      igual(texto(await visivel(page.getByTestId('previa-produto')).innerText()), 'DIESEL S10 ESTOQUE NOVO', `[${rotulo}] revisão com o Produto novo`);
      await clicar(page.getByTestId('abastecimento-confirmar'));
      await visivel(page.getByTestId('abastecimento-consulta')).waitFor({ timeout: 30000 });
      conferir(await esperarAviso(/confirmado: 20,0000 L baixados do estoque\./), `[${rotulo}] aviso de confirmação do Produto novo ausente`);
      const novo = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, produto_id: s.produtoNovo.id, status: 'CONFIRMADO' } }), 'abastecimento do Produto novo');
      igual(`${dec(novo.quantidade)}:${novo.unidade}:${dec(novo.custo_total)}`, '20.0000:L:120.0000', `[${rotulo}] abastecimento do Produto novo no banco`);
      igual(await lotesDe(s, s.produtoNovo.id), '40.0000:Disponivel', `[${rotulo}] lote do Produto novo após a baixa`);
      igual(await lotesDe(s, s.produto.id), '10.0000:Disponivel|100.0000:Disponivel', `[${rotulo}] o Produto antigo foi tocado pelo abastecimento do novo`);
      await shot('abastecimento-produto-novo');

      // O histórico continua com o Produto da época; o cancelamento devolve aos lotes antigos.
      await dono.abrirNaLista(reg.terceiro);
      igual(texto(await visivel(page.getByTestId('consulta-produto')).innerText()), 'DIESEL S10 GRANEL', `[${rotulo}] consulta antiga com o Produto da época`);
      await clicar(page.getByTestId('abastecimento-cancelar'));
      await visivel(page.getByTestId('dialogo-cancelamento-abastecimento')).waitFor();
      await visivel(page.getByTestId('cancelamento-motivo')).fill('Teste depois da troca de aceite');
      await visivel(page.getByTestId('cancelamento-ciente')).check();
      await visivel(page.getByTestId('cancelamento-enviar')).click();
      conferir(await esperarAviso(/cancelado: 10,0000 L devolvidos aos lotes de origem\./, 15000), `[${rotulo}] aviso do cancelamento antigo ausente`);
      await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, id: reg.terceiro.id, status: 'CANCELADO' } }), 'abastecimento antigo cancelado');
      igual(await lotesDe(s, s.produto.id), '20.0000:Disponivel|100.0000:Disponivel', `[${rotulo}] lotes antigos após cancelar depois da troca (estorno exato)`);
      igual(await estoqueDe(s, s.produto.id), '120.0000', `[${rotulo}] estoque_atual antigo após cancelar depois da troca`);
      igual(await lotesDe(s, s.produtoNovo.id), '40.0000:Disponivel', `[${rotulo}] o cancelamento antigo tocou o Produto novo`);
      reg.terceiro.situacao = 'Cancelado';
      reg.quarto = { id: novo.id, frota: 'TP-02', produto: 'DIESEL S10 ESTOQUE NOVO', quantidade: '20,0000 L', situacao: 'Confirmado', versao: novo.versao };
      await shot('cancelado-depois-da-troca');
    });

    await passo('9 usuário só visualizar: sem botões na tela, 403 na API; rotas removidas 404; corpo antigo 400', async () => {
      const vis = await abrirAtor('vis', tokenVis);
      await vis.conferirLista([reg.quarto, reg.segundo, { ...reg.primeiro }, reg.terceiro], 'lista');
      igual(await vis.page.getByRole('button', { name: 'Novo abastecimento' }).filter({ visible: true }).count(), 0, `[${rotulo}] só-visualizar vê "Novo abastecimento"`);
      igual(await vis.page.getByTestId('abastecimento-fatores').count(), 0, `[${rotulo}] só-visualizar vê "Fatores kg/L"`);
      await vis.abrirNaLista(reg.segundo);
      igual(await vis.page.getByTestId('abastecimento-cancelar').filter({ visible: true }).count(), 0, `[${rotulo}] só-visualizar vê "Cancelar"`);
      await vis.shot('consulta');
      const antes = await fotoBanco(s);
      const corpoBase = {
        empresa_id: s.empresa.id, bem_id: s.trator.id, tanque_id: s.trator.tanque_id, produto_id: s.produtoNovo.id,
        local_estoque_id: s.local.id, data_operacional: s.hoje, quantidade: '5', medidor_leitura: '1590', tanque_cheio: false, observacao: null, referencia_externa: null,
      };
      const recusas = {
        previa: await E.api(tokenVis, 'POST', '/api/native/patrimonio-abastecimentos-previa', corpoBase),
        confirmar: await E.api(tokenVis, 'POST', '/api/native/patrimonio-abastecimentos', { ...corpoBase, operation_id: `e2e-vis-${Date.now()}` }),
        cancelar: await E.api(tokenVis, 'POST', `/api/native/patrimonio-abastecimentos/${reg.segundo.id}/cancelar`, { empresa_id: s.empresa.id, versao: reg.segundo.versao, motivo: 'tentativa sem permissão', operation_id: `e2e-vis-c-${Date.now()}` }),
        locais: await E.api(tokenVis, 'GET', `/api/native/patrimonio-abastecimentos-opcoes/locais?empresa_id=${s.empresa.id}&produto_id=${s.produtoNovo.id}`),
        produtos_do_tanque: await E.api(tokenVis, 'GET', `/api/native/bens-patrimoniais-opcoes/produtos?empresa_id=${s.empresa.id}`),
      };
      for (const [k, r] of Object.entries(recusas)) igual(`${r.status}:${r.corpo?.code}`, '403:ACAO_NAO_PERMITIDA', `[${rotulo}] API só-visualizar: ${k}`);
      const leitura = await E.api(tokenVis, 'GET', `/api/native/patrimonio-abastecimentos/${reg.segundo.id}?empresa_id=${s.empresa.id}`);
      igual(`${leitura.status}:${leitura.corpo?.quantidade}:${leitura.corpo?.unidade}:${leitura.corpo?.produto?.nome}`, '200:30.0000:L:DIESEL S10 GRANEL', `[${rotulo}] API só-visualizar: detalhe`);
      // Rotas de fator e de combustível removidas (D-PROD-162, P-09): 404, nem para o dono.
      for (const caminho of ['/patrimonio-conversoes-combustivel', '/patrimonio-combustiveis', '/patrimonio-perfis-medicao', `/patrimonio-abastecimentos-opcoes/tipos?empresa_id=${s.empresa.id}`]) {
        const r = await E.api(token, 'GET', `/api/native${caminho}`);
        igual(r.status, 404, `[${rotulo}] rota removida GET ${caminho.split('?')[0]}`);
      }
      // Corpo antigo (v1) recusado sem falso sucesso.
      const v1 = await E.api(token, 'POST', '/api/native/patrimonio-abastecimentos-previa', {
        empresa_id: s.empresa.id, bem_id: s.trator.id, tanque_id: s.trator.tanque_id, tipo_combustivel_id: 'x', produto_id: s.produtoNovo.id,
        local_estoque_id: s.local.id, data_operacional: s.hoje, quantidade_litros: '5',
      });
      igual(`${v1.status}:${v1.corpo?.code}`, '400:REQUEST_VALIDATION_FAILED', `[${rotulo}] corpo antigo (quantidade_litros/tipo_combustivel_id)`);
      igual(await fotoBanco(s), antes, `[${rotulo}] as recusas mexeram no banco`);
      await vis.fechar();
    });
  } catch (erro) {
    if (!(erro instanceof Divergencia)) console.error(`  [${rotulo}] interrompido: ${String(erro?.message || erro).split('\n')[0]}`);
  } finally {
    await new Promise((r) => setTimeout(r, 400)); // corpos das últimas respostas ainda em leitura
    E.fecharLargura(rotulo, registro);
    for (const at of atores) await at.fechar();
  }
};

// ─── Principal ──────────────────────────────────────────────────────────────
try {
  await E.subirServicos();
  const browser = await E.abrirNavegador(chromium);
  try {
    for (const largura of LARGURAS) await executarLargura(browser, largura);
  } finally {
    await browser.close();
  }
} catch (erro) {
  E.falhas.push(`ensaio interrompido: ${String(erro?.message || erro).split('\n')[0]}`);
} finally {
  await E.encerrarProcessos();
  await closePrismaClient();
}
process.exit(E.concluir('OK: tela real + backend real + PostgreSQL local sem divergências.'));
