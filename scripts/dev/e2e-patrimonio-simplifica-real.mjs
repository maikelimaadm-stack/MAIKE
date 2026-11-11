#!/usr/bin/env node
/**
 * D-PROD-161 (MAIKE-PATRIMONIO-SIMPLIFICA-01) — ACEITE HUMANO da missão em
 * navegador real: tela real + backend Fastify REAL + Vite + PostgreSQL LOCAL;
 * conduz as telas pelo Playwright (Chromium já instalado; nada é instalado) e
 * confere o BANCO (Prisma) depois de cada passo. Substitui o E2E-2 da UX-02
 * (`e2e-abastecimentos-ux02-real.mjs`, cujos passos de Combustíveis e de fator
 * kg/L perderam o objeto).
 *
 * "No cadastro de Produto crio o Diesel S10 em Litros; no cadastro do Bem crio
 *  a família e o tipo pelo '+ Novo', cadastro o Trator com o tanque e marco o
 *  Produto aceito; abasteço 80 L e o estoque baixa exatamente 80 L, FIFO. Um
 *  Produto em quilos também pode ser aceito num tanque, e então digito kg.
 *  O menu de Patrimônio e Frota só tem Bens Patrimoniais e Abastecimentos."
 *
 * Roteiro (em 1280, 820 e 390 px; cada largura num tenant próprio semeado
 * pelo BANCO por `e2e-abastecimentos-seed.mjs#semearBancoBase` — SEM Produto,
 * SEM família/tipo e SEM bem; "hoje" = dia real no fuso da fazenda):
 *   1. menu "Patrimônio e Frota" com exatamente Bens Patrimoniais e
 *      Abastecimentos (topo no desktop; "Módulos" no tablet/celular); nenhum
 *      link para Famílias, Tipos, Perfis de medição ou Combustíveis; as rotas
 *      removidas (minúsculas e PascalCase) caem em "Página não encontrada";
 *   2. Produtos PELA TELA: "Diesel S10" com estoque em LITROS (L) e unidade de
 *      medida L (sem o aviso de unidade); "Diesel S500 granel" em QUILOS (KG)
 *      — escolher LITROS com unidade de medida KG mostra o aviso (achado D5) e
 *      voltar a KG o tira. Banco: `unidade_principal_estoque` L e KG;
 *   3. compras P3 pela API real (o estoque em litros só entra assim): 50 L a
 *      5,2000/L e 100 L a 5,5000/L (vetor `fifo`); 200 kg a 4,1000/kg. Banco:
 *      lotes, movimentos rotulados `L`/`KG` e `estoque_atual` 150 / 200;
 *   4. Bens PELA TELA: novo bem → "+ Nova família" (Nome da busca + Natureza
 *      Máquina; sem código) → "+ Novo tipo" (família travada) → Trator TP-02
 *      com horímetro e um tanque de 180 L → "Aceitar Produto" → Diesel S10
 *      (selo L). Banco: família MAQUINA com código gerado, tipo, bem, tanque e
 *      UM `TanqueBemProduto` ativo com o Diesel S10;
 *   5. segundo bem PELA TELA (Trator TP-03, a família e o tipo já existentes)
 *      com tanque de 120 L aceitando o Produto em KG (filtro "Quilos") → aviso
 *      "no abastecimento digita-se kg". Banco: aceite do Produto KG;
 *   6. Abastecimentos: lista vazia, sem "Fatores kg/L" nem nada de combustível;
 *   7. novo abastecimento TP-02 → Diesel S10 já marcado → local automático →
 *      "Quantidade abastecida (L)" 80 → horímetro 1.550,5 → tanque cheio →
 *      "Revisar abastecimento": baixa de 80,0000 L, capacidade conferida,
 *      custo estimado R$ 425,00 (R$ 5,3125/L) em 2 lotes FIFO; nada gravado;
 *   8. confirmar → banco: quantidade 80, unidade L, custo FIFO 425,0000 e
 *      5,3125/L, Saída rotulada `L` de 80, 2 fatias (50 + 30), lotes 0 / 70,
 *      `estoque_atual` 70; o bem não muda; nenhum lançamento financeiro novo;
 *   9. lista (colunas Data | Máquina/Veículo | Produto | Quantidade | Medidor
 *      | Situação; cards no celular) e consulta (80,0000 L; R$ 425,00 por L) →
 *      cancelar (motivo + ciência) → banco: CANCELADO versão 2, Entrada de
 *      estorno de 80 L e 425,0000, lotes 50 / 100, `estoque_atual` 150;
 *  10. abastecimento do TP-03 em KG: "Quantidade abastecida (kg)" com a dica
 *      fixa (formulário e revisão), capacidade NÃO conferida, 35 kg → banco:
 *      unidade KG, Saída rotulada `KG` de 35, lote 165, `estoque_atual` 165;
 *  11. lista final: o 80,0000 L Cancelado e o 35,0000 kg Confirmado.
 *  Em TODA captura: sem rolagem horizontal da página. Toda resposta ≥ 400 da
 *  API real observada pelas telas é divergência.
 *
 * Uso:
 *   DATABASE_URL=postgresql://postgres@localhost:5433/maike_simp_e2e1?host=/tmp \
 *     node scripts/dev/e2e-patrimonio-simplifica-real.mjs [pasta-das-capturas]
 * Variáveis opcionais: E2E_API_PORT (3951), E2E_WEB_PORT (5251),
 * E2E_LARGURAS ("1280,820,390"). O banco precisa estar migrado
 * (`npm run deploy:migrate` com a mesma URL). Recusa banco que não seja local.
 * Encerra backend e Vite ao sair. Sai com código ≠ 0 em QUALQUER divergência.
 */
import os from 'node:os';
import path from 'node:path';

import { COMPRA_KG, VETOR_FIFO, comprarDieselEmLitros, comprarPelaP3, definirPerfilFinanceiro, semearBancoBase, somarDias } from './e2e-abastecimentos-seed.mjs';
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
  nome: 'patrimonio-simplifica',
  out: path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maike-e2e-patrimonio-simplifica')),
  apiPort: Number(process.env.E2E_API_PORT || 3951),
  webPort: Number(process.env.E2E_WEB_PORT || 5251),
});
const { WEB, conferir, exigir, igual, esperarBanco } = E;
const FIFO = VETOR_FIFO;

process.env.DATABASE_URL = E.DATABASE_URL;
const { getPrismaClient, closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
const prisma = getPrismaClient();

/** Rotas das telas removidas pela D-PROD-161 (minúsculas = `createPageUrl`; PascalCase = links antigos). */
const TELAS_REMOVIDAS = ['FamiliasPatrimoniais', 'TiposPatrimoniais', 'PerfisMedicao', 'Combustiveis'];
const AVISO_KG_TANQUE = 'Este Produto é controlado em quilos: no abastecimento digita-se kg, não os litros da bomba.';
const DICA_KG = 'Este Produto é controlado em quilos: digite kg, não os litros da bomba.';
const COLUNAS_PADRAO = 'Data | Máquina/Veículo | Produto | Quantidade | Medidor | Situação';

/** Foto das linhas que o abastecimento pode tocar (prova de "nada gravado"). */
const fotoBanco = async (s) => {
  const w = { where: { cliente_id: s.cliente_id }, orderBy: { id: 'asc' } };
  const out = {
    abastecimentos: await prisma.abastecimentoBem.findMany(w),
    fatias: await prisma.abastecimentoBemConsumoLote.findMany(w),
    aceites: await prisma.tanqueBemProduto.findMany(w),
    movimentos: await prisma.movimentacaoEstoque.findMany({ ...w, select: { id: true, status: true, quantidade: true, unidade_medida: true } }),
    lotes: await prisma.estoqueLoteNota.findMany({ ...w, select: { id: true, quantidade_disponivel: true, status: true } }),
    produtos: await prisma.produto.findMany({ ...w, select: { id: true, estoque_atual: true, unidade_principal_estoque: true } }),
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
/** O bem como o cadastro o deixou (o abastecimento NUNCA grava coluna do bem). */
const bemCru = async (s, bemId) => {
  const b = await prisma.bemPatrimonial.findFirst({ where: { cliente_id: s.cliente_id, id: bemId } });
  return `${b.versao}:${b.medidor_tipo}:${dec(b.medidor_leitura_atual)}:${b.medidor_origem}:${String(b.medidor_data_leitura?.toISOString?.() ?? b.medidor_data_leitura)}:${b.updatedAt?.toISOString?.() ?? ''}`;
};

// ─── Roteiro por largura ────────────────────────────────────────────────────
const executarLargura = async (browser, largura) => {
  const rotulo = String(largura);
  const movel = largura < 640;
  const desktop = largura >= 1024;
  const s = await semearBancoBase({ rotulo: `s${rotulo}` });
  const token = await E.login(s.credenciais);
  const apiDono = E.apiDo(token);
  const registro = { errosPagina: [], respostasApi: [], contador: { n: 0 } };
  const atores = [];
  const dono = await E.abrirAtor(browser, { largura, rotulo, ator: 'dono', token, empresaId: s.empresa.id, clienteId: s.cliente_id, prefixo: 'simp' }, registro);
  atores.push(dono);
  const { page, shot, visivel, clicar, preencher, escolher, escolherNoCombo } = dono;
  const passo = (nome, fn) => E.passo(rotulo, nome, fn, atores);
  const reg = {};
  const [ano, mes, dia] = String(s.hoje).split('-');
  const dataBr = `${dia}/${mes}/${ano}`;

  const ir = async (rota) => {
    await page.goto(`${WEB}/${rota}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
  };
  /** Botão da barra do cadastro (Novo/Salvar…): no celular o "Salvar" fica no cabeçalho do registro. */
  const botao = (nome) => page.getByRole('button', { name: nome, exact: true });
  const esperarAviso = (texto, ms = 10000) =>
    visivel(page.getByText(texto))
      .waitFor({ timeout: ms })
      .then(
        () => true,
        () => false,
      );
  /** AutocompleteGenerico (Categoria, Unidade, Local): abre pelo campo e escolhe a opção. */
  const escolherAutocomplete = async (raiz, placeholder, nome) => {
    await clicar(raiz.getByPlaceholder(placeholder));
    await clicar(page.getByRole('option', { name: nome }));
  };

  /**
   * Cadastro de Produto PELA TELA. Devolve a linha gravada.
   * @param {{ nome: string, codigo: string, unidadeMedida: RegExp, local: RegExp, estoque: 'L'|'KG', conferirAviso?: boolean }} p
   */
  const cadastrarProduto = async (p) => {
    await ir('produtos');
    await clicar(botao('Novo'));
    const form = visivel(page.getByTestId('b1-form-produto'));
    await form.waitFor();
    await preencher(form.getByPlaceholder('NOME DO PRODUTO'), p.nome);
    await preencher(form.getByPlaceholder('CÓDIGO INTERNO'), p.codigo);
    await escolherAutocomplete(form, 'BUSCAR CATEGORIA...', /COMBUST/i);
    await escolherAutocomplete(form, 'BUSCAR UNIDADE...', p.unidadeMedida);
    await escolherAutocomplete(form, 'BUSCAR LOCAL...', p.local);
    const combo = form.getByRole('combobox').filter({ hasText: /QUILOGRAMAS \(KG\)|SACOS|LITROS \(L\)/ });
    if (p.conferirAviso) {
      // Achado D5: estoque em LITROS com unidade de medida que não é de litros → aviso (não bloqueia).
      await escolherNoCombo(combo, 'LITROS (L)');
      const aviso = visivel(page.getByTestId('aviso-unidade-litros'));
      conferir(await aviso.waitFor({ timeout: 5000 }).then(() => true, () => false), `[${rotulo}] Produto: sem o aviso de unidade de medida que não é de litros`);
      igual((await aviso.innerText().catch(() => '')).trim(), 'A unidade de medida do cadastro não é de litros; confira.', `[${rotulo}] Produto: texto do aviso de litros`);
      await shot('produto-aviso-litros');
      await escolherNoCombo(combo, 'QUILOGRAMAS (KG)');
      igual(await page.getByTestId('aviso-unidade-litros').filter({ visible: true }).count(), 0, `[${rotulo}] Produto: aviso de litros continua com KG`);
    }
    if (p.estoque === 'L') await escolherNoCombo(combo, 'LITROS (L)');
    igual((await visivel(combo).innerText()).trim(), p.estoque === 'L' ? 'LITROS (L)' : 'QUILOGRAMAS (KG)', `[${rotulo}] Produto ${p.nome}: unidade principal de estoque na tela`);
    if (p.estoque === 'L') igual(await page.getByTestId('aviso-unidade-litros').filter({ visible: true }).count(), 0, `[${rotulo}] Produto em L com unidade L: aviso indevido`);
    await shot(`produto-${p.codigo.toLowerCase()}`);
    await clicar(botao('Salvar'));
    conferir(await esperarAviso('Produto cadastrado'), `[${rotulo}] aviso "Produto cadastrado" ausente (${p.nome})`);
    const linha = await esperarBanco(
      () => prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, codigo_interno: { equals: p.codigo, mode: 'insensitive' } } }),
      `Produto ${p.nome} gravado`,
    );
    igual(
      `${linha.nome_produto.toUpperCase()}:${linha.unidade_principal_estoque}:${linha.unidade_medida}:${linha.empresa_id === s.empresa.id}:${linha.ativo}:${dec(linha.estoque_atual)}`,
      `${p.nome.toUpperCase()}:${p.estoque}:${p.estoque}:true:true:0.0000`,
      `[${rotulo}] Produto ${p.nome} no banco`,
    );
    return linha;
  };

  /** Painel do seletor de família/tipo do Bem: busca e "+ Nova…". */
  const pedirCadastroRapido = async (form, testId, busca, titulo) => {
    await clicar(form.getByTestId(testId));
    const painel = visivel(page.getByTestId(`${testId}-painel`));
    await painel.waitFor();
    await painel.getByRole('searchbox').fill(busca);
    await clicar(page.getByTestId(`${testId}-criar-novo`));
    const folha = visivel(page.getByRole('dialog', { name: titulo }));
    await folha.waitFor();
    return folha;
  };
  /** Medidor horímetro + leitura inicial na aba Operação. */
  const preencherMedidor = async (form, leitura) => {
    await clicar(page.getByRole('tab', { name: 'Operação' }));
    await escolherNoCombo(form.getByRole('combobox', { name: 'Medidor' }), 'Horímetro');
    await preencher('bem-medidor-leitura-inicial', leitura);
    await preencher('bem-medidor-data', somarDias(s.hoje, -10));
  };
  /** Tanque novo na aba Operação (índice 0) com o Produto aceito. */
  const preencherTanque = async (form, t) => {
    await clicar(form.getByRole('button', { name: 'Adicionar tanque' }));
    const tanque = visivel(page.getByTestId('bem-tanque-0'));
    await tanque.waitFor();
    await preencher(tanque.getByLabel(/^Identificador/), t.identificador);
    await preencher('bem-tanque-capacidade-0', t.capacidade);
    // P-01: tanque sem Produto avisa que não pode ser abastecido.
    igual(
      (await visivel(page.getByTestId('bem-tanque-sem-produto-0')).innerText()).trim(),
      'Este tanque não pode ser abastecido até ter um Produto aceito.',
      `[${rotulo}] tanque sem Produto: aviso`,
    );
    if (t.filtro) await escolherNoCombo(tanque.getByRole('combobox', { name: 'Unidade' }), t.filtro);
    await clicar(tanque.getByTestId('bem-tanque-seletor-produto-0'));
    const painel = visivel(page.getByTestId('bem-tanque-seletor-produto-0-painel'));
    await painel.waitFor();
    const opcao = painel.getByRole('option', { name: t.produto });
    await opcao.first().waitFor();
    const textoOpcao = (await opcao.first().innerText()).replace(/\s+/g, ' ');
    conferir(textoOpcao.includes(t.selo), `[${rotulo}] opção do Produto aceito sem o selo "${t.selo}" (${textoOpcao})`);
    if (t.filtro) {
      const todas = (await painel.getByRole('option').allInnerTexts()).map((x) => x.replace(/\s+/g, ' '));
      conferir(todas.every((x) => x.includes(t.selo)), `[${rotulo}] filtro "${t.filtro}" deixou passar outra unidade (${todas.join(' / ')})`);
    }
    await opcao.first().click();
    const chip = visivel(page.getByTestId(`bem-tanque-0-produto-${t.produtoId}`));
    await chip.waitFor();
    conferir((await chip.innerText()).includes(t.selo), `[${rotulo}] chip do Produto aceito sem o selo ${t.selo}`);
    igual(await page.getByTestId('bem-tanque-sem-produto-0').filter({ visible: true }).count(), 0, `[${rotulo}] aviso de tanque sem Produto continua com Produto aceito`);
    return tanque;
  };
  const conferirBemGravado = async (codigoFrota, esperado) => {
    const bem = await esperarBanco(
      () => prisma.bemPatrimonial.findFirst({ where: { cliente_id: s.cliente_id, codigo_frota: codigoFrota }, include: { tanques: { include: { produtos: true } }, familia: true, tipo: true } }),
      `bem ${codigoFrota} gravado`,
    );
    const t = bem.tanques[0];
    igual(
      `${bem.nome}:${bem.familia.nome}:${bem.familia.natureza}:${bem.tipo.nome}:${bem.medidor_tipo}:${dec(bem.medidor_leitura_atual)}:${bem.tanques.length}:${t?.identificador}:${dec(t?.capacidade_litros)}:${t?.ativo}`,
      esperado.bem,
      `[${rotulo}] bem ${codigoFrota} no banco`,
    );
    igual(
      (t?.produtos ?? []).map((p) => `${p.produto_id === esperado.produtoId}:${p.ativo}`).join('|'),
      'true:true',
      `[${rotulo}] Produtos aceitos do tanque de ${codigoFrota} no banco`,
    );
    return bem;
  };

  /** Lista de abastecimentos: colunas padrão, linhas/cards com a quantidade e a situação. */
  const conferirLista = async (registros, etapa) => {
    await ir('abastecimentos');
    for (const r of registros) {
      await page.waitForFunction(
        ({ id, q }) =>
          [...document.querySelectorAll(`[data-testid="abastecimento-bem-${id}"]`)].some((e) => e.getClientRects().length > 0) ||
          [...document.querySelectorAll('[data-testid="b1-card"]')].some((e) => e.textContent?.includes(q) && e.getClientRects().length > 0),
        { id: r.id, q: r.quantidade },
      );
    }
    const cabecalhos = (await page.getByRole('columnheader').filter({ visible: true }).allTextContents()).map((t) => t.trim()).filter(Boolean);
    if (desktop) conferir(cabecalhos.length > 0, `[${rotulo}] lista sem tabela em ${largura} px`);
    if (movel) conferir(cabecalhos.length === 0, `[${rotulo}] lista em tabela no celular (${cabecalhos.join(' | ')})`);
    if (cabecalhos.length) {
      igual(cabecalhos.join(' | '), COLUNAS_PADRAO, `[${rotulo}] colunas padrão da lista`);
      conferir(!cabecalhos.some((c) => /combust|litros|kg/i.test(c)), `[${rotulo}] coluna de combustível/litros/kg na lista (${cabecalhos.join(' | ')})`);
      const grade = await visivel(page.locator('table.mg-grid')).evaluate((tabela) => {
        let el = tabela.parentElement;
        while (el && el !== document.body) {
          const ox = getComputedStyle(el).overflowX;
          if (ox === 'auto' || ox === 'scroll') break;
          el = el.parentElement;
        }
        const cortados = [...tabela.querySelectorAll('thead th')]
          .map((th) => th.querySelector('button span') || th.querySelector('button'))
          .filter((x) => x && x.textContent.trim() && x.scrollWidth > x.clientWidth + 1)
          .map((x) => x.textContent.trim());
        return { sw: el?.scrollWidth ?? 0, cw: el?.clientWidth ?? 0, cortados };
      });
      conferir(grade.sw <= grade.cw + 1, `[${rotulo}] a grade rola na horizontal em ${largura} px (${grade.sw} > ${grade.cw} + 1)`);
      const ruins = grade.cortados.filter((t) => !(largura < 1024 && t === 'Máquina/Veículo'));
      conferir(ruins.length === 0, `[${rotulo}] rótulo de coluna cortado em ${largura} px: ${ruins.join(', ')}`);
      for (const r of registros) {
        const linha = visivel(page.locator('tr').filter({ has: page.getByTestId(`abastecimento-bem-${r.id}`) }));
        const txt = (await linha.innerText()).replace(/\s+/g, ' ');
        conferir(txt.includes(r.frota) && txt.includes(r.produto) && txt.includes(r.quantidade) && txt.includes(dataBr), `[${rotulo}] linha da lista sem máquina/Produto/quantidade/data (${txt})`);
        igual((await visivel(page.getByTestId(`abastecimento-situacao-${r.id}`)).innerText()).trim(), r.situacao, `[${rotulo}] linha ${r.quantidade} — Situação`);
      }
    }
    if (movel) {
      for (const r of registros) {
        const card = visivel(page.getByTestId('b1-card').filter({ hasText: r.quantidade }));
        const titulo = (await card.locator('.mg-b1-card__title').innerText().catch(() => '')).trim();
        conferir(titulo.includes(r.frota), `[${rotulo}] título do card sem a máquina (${titulo})`);
        const rotulos = (await card.locator('.mg-b1-card__label').allInnerTexts()).map((t) => t.trim().replace(/:$/, ''));
        const valores = (await card.locator('.mg-b1-card__value').allInnerTexts()).map((t) => t.trim());
        const campos = Object.fromEntries(rotulos.map((rr, i) => [rr, valores[i]]));
        igual(campos.Produto, r.produto, `[${rotulo}] card ${r.quantidade} — Produto`);
        igual(campos.Quantidade, r.quantidade, `[${rotulo}] card ${r.quantidade} — Quantidade`);
        igual(campos.Data, dataBr, `[${rotulo}] card ${r.quantidade} — Data`);
        const sub = (await card.locator('.mg-b1-card__sub').innerText().catch(() => '')).trim();
        conferir(sub === r.situacao || campos['Situação'] === r.situacao, `[${rotulo}] card ${r.quantidade} sem a Situação "${r.situacao}" (subtítulo "${sub}")`);
      }
    }
    await shot(etapa);
  };
  const abrirNaLista = async (r) => {
    await ir('abastecimentos');
    let alvo = page.getByTestId(`abastecimento-bem-${r.id}`);
    await page.waitForFunction(
      ({ id, q }) =>
        [...document.querySelectorAll(`[data-testid="abastecimento-bem-${id}"]`)].some((e) => e.getClientRects().length > 0) ||
        [...document.querySelectorAll('[data-testid="b1-card"]')].some((e) => e.textContent?.includes(q) && e.getClientRects().length > 0),
      { id: r.id, q: r.quantidade },
    );
    if (!(await visivel(alvo).isVisible().catch(() => false))) alvo = page.getByTestId('b1-card').filter({ hasText: r.quantidade });
    const el = visivel(alvo);
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.dblclick();
    await visivel(page.getByTestId('abastecimento-consulta')).waitFor();
  };

  /** Novo abastecimento até a revisão. @param {{ frota: RegExp, produto: string, local: string, unidade: 'L'|'KG', quantidade: string, leitura: string, cheio: boolean }} a */
  const preencherAbastecimento = async (a) => {
    await clicar(page.getByRole('button', { name: 'Novo abastecimento' }));
    const form = visivel(page.getByTestId('abastecimento-form'));
    await form.waitFor();
    await escolher(form, 'abastecimento-bem', a.frota);
    // Um só Produto aceito: já vem marcado (sem etapa de combustível nem de fator).
    await page.waitForFunction(
      (nome) =>
        [...document.querySelectorAll('[data-testid="abastecimento-produto"] [role="radio"][aria-checked="true"]')].some((r) => r.textContent?.trim() === nome && r.getClientRects().length > 0),
      a.produto,
    );
    await visivel(page.getByTestId('abastecimento-local-auto').filter({ hasText: `Sai do estoque: ${a.local}` })).waitFor();
    igual(await form.getByText(/combust[íi]vel|fator|kg\/L/i).filter({ visible: true }).count(), 0, `[${rotulo}] formulário fala de combustível/fator`);
    const rotuloQtd = a.unidade === 'L' ? 'Quantidade abastecida (L)' : 'Quantidade abastecida (kg)';
    conferir(await visivel(form.getByText(rotuloQtd, { exact: false })).isVisible().catch(() => false), `[${rotulo}] campo "${rotuloQtd}" ausente`);
    const dica = await page.getByTestId('abastecimento-dica-kg').filter({ visible: true }).count();
    if (a.unidade === 'KG') igual((await visivel(page.getByTestId('abastecimento-dica-kg')).innerText()).trim(), DICA_KG, `[${rotulo}] dica de Produto em KG no formulário`);
    else igual(dica, 0, `[${rotulo}] dica de KG para Produto em L`);
    igual(await visivel(page.getByTestId('abastecimento-data')).inputValue(), s.hoje, `[${rotulo}] data padrão do formulário (hoje no fuso da fazenda)`);
    await preencher('abastecimento-quantidade', a.quantidade);
    await preencher('abastecimento-leitura', a.leitura);
    const resposta = visivel(page.getByTestId('abastecimento-tanque-cheio').getByRole('radio', { name: a.cheio ? 'Sim' : 'Não' }));
    if ((await resposta.getAttribute('aria-checked')) !== 'true') await resposta.click();
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

  try {
    await passo('1 menu só com Bens e Abastecimentos; telas removidas = 404', async () => {
      await ir('benspatrimoniais');
      await visivel(botao('Novo')).waitFor();
      let telas;
      if (desktop) {
        const grupo = page.locator('nav[aria-label="Módulos"] .group').filter({ has: page.getByRole('button', { name: 'Patrimônio e Frota' }) });
        await grupo.getByRole('button', { name: 'Patrimônio e Frota' }).hover();
        await visivel(grupo.getByRole('link', { name: 'Abastecimentos' })).waitFor();
        telas = (await grupo.getByRole('link').allInnerTexts()).map((t) => t.trim());
        await shot('menu-patrimonio');
      } else {
        await clicar(page.getByRole('button', { name: 'Módulos', exact: true }));
        const modulos = visivel(page.getByRole('dialog', { name: 'Módulos' }));
        await modulos.waitFor();
        const tile = modulos.locator('.mk-mods__tile').filter({ hasText: 'Patrimônio e Frota' });
        igual((await tile.locator('.mk-mods__tile-count').innerText()).trim(), '2 telas', `[${rotulo}] módulo Patrimônio e Frota: contagem de telas`);
        await tile.click();
        await visivel(modulos.locator('.mk-mods__head-name').filter({ hasText: 'Patrimônio e Frota' })).waitFor();
        telas = (await modulos.locator('.mk-mods__row-label').allInnerTexts()).map((t) => t.split('\n')[0].trim());
        await shot('menu-patrimonio');
        await page.keyboard.press('Escape').catch(() => {});
      }
      igual(telas.join(' | '), 'Bens Patrimoniais | Abastecimentos', `[${rotulo}] telas do módulo Patrimônio e Frota`);
      const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || ''));
      const antigos = hrefs.filter((h) => /familiaspatrimoniais|tipospatrimoniais|perfismedicao|combustiveis/i.test(h));
      igual(antigos.join(', '), '', `[${rotulo}] links para telas removidas`);
      for (const tela of TELAS_REMOVIDAS) {
        for (const caminho of [tela.toLowerCase(), tela]) {
          await ir(caminho);
          conferir(
            await visivel(page.getByText('Página não encontrada')).waitFor({ timeout: 10000 }).then(() => true, () => false),
            `[${rotulo}] /${caminho} não caiu em "Página não encontrada"`,
          );
        }
      }
      await shot('tela-removida-404');
    });

    await passo('2 Produtos pela tela: Diesel S10 em LITROS e Diesel S500 granel em KG', async () => {
      reg.diesel = await cadastrarProduto({ nome: 'Diesel S10', codigo: 'DS10', unidadeMedida: /^L - LITRO/, local: /TANQUE DIESEL SEDE/, estoque: 'L' });
      reg.granel = await cadastrarProduto({ nome: 'Diesel S500 granel', codigo: 'DS500', unidadeMedida: /^KG - QUILOGRAMA/, local: /DEPÓSITO DE GRANEL/, estoque: 'KG', conferirAviso: true });
    });

    await passo('3 compras P3 (API real) em L e em KG', async () => {
      await definirPerfilFinanceiro(s, apiDono);
      await comprarDieselEmLitros(s, apiDono, reg.diesel.id);
      await comprarPelaP3(s, apiDono, { produto_id: reg.granel.id, local_id: s.localKg.id, unidade: 'KG', quantidade: COMPRA_KG.quantidade, custo: COMPRA_KG.custo, dia: somarDias(s.hoje, -COMPRA_KG.diasAtras), documento: 'NF-GRANEL-1' });
      igual(await lotesDe(s, reg.diesel.id), '50.0000:Disponivel|100.0000:Disponivel', `[${rotulo}] lotes do Diesel S10 após as compras`);
      igual(await estoqueDe(s, reg.diesel.id), '150.0000', `[${rotulo}] estoque_atual do Diesel S10 após as compras`);
      igual(await lotesDe(s, reg.granel.id), '200.0000:Disponivel', `[${rotulo}] lote do Produto em KG`);
      const rotulos = await prisma.movimentacaoEstoque.findMany({ where: { cliente_id: s.cliente_id }, orderBy: { createdAt: 'asc' }, select: { produto_id: true, unidade_medida: true } });
      igual(rotulos.map((m) => `${m.produto_id === reg.diesel.id ? 'DS10' : 'DS500'}:${m.unidade_medida}`).join('|'), 'DS10:L|DS10:L|DS500:KG', `[${rotulo}] rótulo dos movimentos das compras`);
      reg.financeiro = await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } });
      igual(reg.financeiro, 3, `[${rotulo}] lançamentos P3 das compras`);
    });

    await passo('4 Bem pela tela: "+ Nova família", "+ Novo tipo", tanque com o Produto aceito', async () => {
      await ir('benspatrimoniais');
      await clicar(botao('Novo'));
      const form = visivel(page.getByTestId('b1-form'));
      await form.waitFor();
      await visivel(page.getByTestId('bem-escolha-familia')).waitFor();
      const folha = await pedirCadastroRapido(form, 'bem-seletor-familia', 'Tratores', 'Nova família');
      igual(await visivel(folha.getByLabel(/^Nome/)).inputValue(), 'Tratores', `[${rotulo}] "+ Nova família": nome vindo da busca`);
      igual(await folha.getByLabel(/^Código/).count(), 0, `[${rotulo}] "+ Nova família" pede código`);
      await escolherNoCombo(folha.getByRole('combobox', { name: 'Natureza' }), 'Máquina');
      await shot('nova-familia');
      await clicar(folha.getByRole('button', { name: 'Salvar' }));
      conferir(await esperarAviso('Família patrimonial criada'), `[${rotulo}] aviso "Família patrimonial criada" ausente`);
      await folha.waitFor({ state: 'hidden' });
      await visivel(form.getByTestId('bem-seletor-familia').filter({ hasText: /Tratores/i })).waitFor();
      igual(await visivel(form.getByLabel(/^Natureza/)).inputValue(), 'Máquina', `[${rotulo}] natureza do bem após a família nova`);
      const folhaTipo = await pedirCadastroRapido(form, 'bem-seletor-tipo', 'Trator de pneus', 'Novo tipo');
      const familiaNoTipo = visivel(folhaTipo.getByLabel(/^Família/));
      igual(`${await familiaNoTipo.inputValue()}:${await familiaNoTipo.getAttribute('readonly') !== null}`, 'Tratores:true', `[${rotulo}] "+ Novo tipo": família travada`);
      await shot('novo-tipo');
      await clicar(folhaTipo.getByRole('button', { name: 'Salvar' }));
      conferir(await esperarAviso('Tipo patrimonial criado'), `[${rotulo}] aviso "Tipo patrimonial criado" ausente`);
      await folhaTipo.waitFor({ state: 'hidden' });
      await visivel(form.getByTestId('bem-seletor-tipo').filter({ hasText: /Trator de pneus/i })).waitFor();
      const familia = await prisma.familiaPatrimonial.findFirst({ where: { cliente_id: s.cliente_id }, include: { tipos: true } });
      igual(
        `${familia?.nome}:${familia?.natureza}:${familia?.codigo}:${familia?.tipos.map((t) => `${t.nome}/${t.codigo}`).join(',')}`,
        'Tratores:MAQUINA:TRATORES:Trator de pneus/TRATOR_DE_PNEUS',
        `[${rotulo}] família e tipo criados pelo "+ Novo" (código gerado no servidor)`,
      );
      await preencher(form.getByLabel(/^Nome/).first(), 'Trator TP-02');
      await preencher(form.getByLabel(/^Código de frota/), 'TP-02');
      await preencherMedidor(form, '1.520,5');
      await preencherTanque(form, { identificador: 'Principal', capacidade: '180', produto: /Diesel S10/i, produtoId: reg.diesel.id, selo: 'L' });
      igual(await page.getByTestId('bem-tanque-aviso-kg-0').filter({ visible: true }).count(), 0, `[${rotulo}] aviso de KG para Produto em L`);
      await shot('bem-tanque-produto-l');
      await clicar(botao('Salvar'));
      conferir(await esperarAviso('Bem patrimonial criado'), `[${rotulo}] aviso "Bem patrimonial criado" ausente`);
      reg.tp02 = await conferirBemGravado('TP-02', { bem: 'Trator TP-02:Tratores:MAQUINA:Trator de pneus:HORIMETRO:1520.5000:1:Principal:180.0000:true', produtoId: reg.diesel.id });
      await shot('bem-tp02-salvo');
    });

    await passo('5 segundo bem pela tela com Produto em KG aceito (aviso de kg)', async () => {
      await ir('benspatrimoniais');
      await clicar(botao('Novo'));
      const form = visivel(page.getByTestId('b1-form'));
      await form.waitFor();
      await escolher(form, 'bem-seletor-familia', /Tratores/i);
      await escolher(form, 'bem-seletor-tipo', /Trator de pneus/i);
      await preencher(form.getByLabel(/^Nome/).first(), 'Trator TP-03');
      await preencher(form.getByLabel(/^Código de frota/), 'TP-03');
      await preencherMedidor(form, '800');
      await preencherTanque(form, { identificador: 'Único', capacidade: '120', produto: /Diesel S500 granel/i, produtoId: reg.granel.id, selo: 'kg', filtro: 'Quilos (kg)' });
      igual((await visivel(page.getByTestId('bem-tanque-aviso-kg-0')).innerText()).trim(), AVISO_KG_TANQUE, `[${rotulo}] aviso de Produto em KG no tanque`);
      await shot('bem-tanque-produto-kg');
      await clicar(botao('Salvar'));
      conferir(await esperarAviso('Bem patrimonial criado'), `[${rotulo}] aviso "Bem patrimonial criado" ausente (TP-03)`);
      reg.tp03 = await conferirBemGravado('TP-03', { bem: 'Trator TP-03:Tratores:MAQUINA:Trator de pneus:HORIMETRO:800.0000:1:Único:120.0000:true', produtoId: reg.granel.id });
      igual(await prisma.familiaPatrimonial.count({ where: { cliente_id: s.cliente_id } }), 1, `[${rotulo}] famílias (o 2º bem reusou a existente)`);
    });

    await passo('6 Abastecimentos: lista vazia, sem fator kg/L nem combustível', async () => {
      await ir('abastecimentos');
      await visivel(page.getByTestId('abastecimento-lista-vazia')).waitFor();
      igual(await page.getByTestId('abastecimento-fatores').count(), 0, `[${rotulo}] botão "Fatores kg/L" na tela`);
      igual(await page.getByRole('button', { name: /fator|kg\/L|combust/i }).filter({ visible: true }).count(), 0, `[${rotulo}] botão de fator/combustível na tela`);
      reg.bemTp02 = await bemCru(s, reg.tp02.id);
      reg.bemTp03 = await bemCru(s, reg.tp03.id);
      await shot('abastecimentos-vazio');
    });

    await passo('7 abastecer 80 L → revisão (nada gravado)', async () => {
      await preencherAbastecimento({ frota: /TP-02/, produto: 'DIESEL S10', local: 'TANQUE DIESEL SEDE', unidade: 'L', quantidade: '80', leitura: '1.550,5', cheio: true });
      await shot('formulario-l');
      const antes = await fotoBanco(s);
      await pedirPrevia();
      const resumo = await visivel(page.getByTestId('previa-resumo')).innerText();
      conferir(resumo.includes('DIESEL S10') && resumo.includes('80 L') && resumo.includes('Baixa de 80,0000 L'), `[${rotulo}] revisão: resumo ${resumo}`);
      igual((await visivel(page.getByTestId('previa-baixa')).innerText()).replace(/\s+/g, ' ').trim(), 'Baixa do estoque 80,0000 L', `[${rotulo}] revisão: baixa`);
      igual(await page.getByTestId('previa-dica-kg').filter({ visible: true }).count(), 0, `[${rotulo}] revisão: dica de KG para Produto em L`);
      await shot('previa-l');
      await abrirDetalhesDoEstoque();
      const custo = await visivel(page.getByTestId('previa-custo')).innerText();
      conferir(custo.includes('R$ 425,00') && custo.includes('5,3125') && custo.includes('/L') && /estimativa/i.test(custo), `[${rotulo}] revisão: custo ${custo}`);
      conferir((await visivel(page.getByTestId('previa-capacidade')).innerText()).includes('conferida (Produto em litros)'), `[${rotulo}] revisão: capacidade não conferida para Produto em L`);
      const linhas = await visivel(page.getByTestId('previa-fatias')).locator('tbody tr').allInnerTexts();
      igual(linhas.length, FIFO.fatias.length, `[${rotulo}] revisão: lotes FIFO`);
      conferir(linhas[0]?.includes('50,0000') && linhas[1]?.includes('30,0000'), `[${rotulo}] revisão: fatias ${linhas.join(' / ')}`);
      igual(await page.getByTestId('previa-bloqueios').count(), 0, `[${rotulo}] revisão com bloqueio`);
      igual(await fotoBanco(s), antes, `[${rotulo}] a revisão gravou algo`);
      await shot('previa-l-detalhes');
    });

    await passo('8 confirmar → baixa FIFO exata de 80 L no banco', async () => {
      await clicar(page.getByTestId('abastecimento-confirmar'));
      await visivel(page.getByTestId('abastecimento-consulta')).waitFor({ timeout: 30000 });
      conferir(await esperarAviso(/confirmado: 80,0000 L baixados do estoque\./, 8000), `[${rotulo}] aviso de confirmação (80,0000 L) ausente`);
      const ab = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, status: 'CONFIRMADO', bem_id: reg.tp02.id } }), 'abastecimento confirmado');
      igual(
        `${dec(ab.quantidade)}:${ab.unidade}:${dec(ab.custo_total)}:${dec(ab.custo_unitario)}:${dec(ab.medidor_leitura)}:${ab.tanque_cheio}:${ab.produto_id === reg.diesel.id}:${ab.tanque_id === reg.tp02.tanques[0].id}`,
        `${FIFO.quantidade}:L:${FIFO.custo_total}:${FIFO.custo_unitario}:1550.5000:true:true:true`,
        `[${rotulo}] abastecimento no banco`,
      );
      const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: ab.movimentacao_estoque_id } });
      igual(
        `${mov.tipo_movimentacao}:${mov.origem_sistema}:${mov.lancamento_origem_id === ab.id}:${mov.unidade_medida}:${dec(mov.quantidade)}:${dec(mov.valor_total)}:${mov.status}`,
        `Saída:abastecimento_patrimonio:true:L:${FIFO.quantidade}:${FIFO.custo_total}:Ativa`,
        `[${rotulo}] movimento de saída`,
      );
      const lotes = await prisma.estoqueLoteNota.findMany({ where: { cliente_id: s.cliente_id, produto_id: reg.diesel.id }, orderBy: [{ data_documento: 'asc' }, { createdAt: 'asc' }] });
      const fatias = await prisma.abastecimentoBemConsumoLote.findMany({ where: { cliente_id: s.cliente_id, abastecimento_id: ab.id }, orderBy: { ordem: 'asc' } });
      igual(
        fatias.map((f) => `${f.estoque_lote_nota_id === lotes[f.ordem - 1]?.id}:${dec(f.quantidade)}:${dec(f.custo_unitario)}:${dec(f.quantidade.times(f.custo_unitario).toDecimalPlaces(4))}`).join('|'),
        FIFO.fatias.map((f) => `true:${f.quantidade}:${f.custo_unitario}:${f.valor}`).join('|'),
        `[${rotulo}] fatias FIFO`,
      );
      igual(await lotesDe(s, reg.diesel.id), '0.0000:Esgotado|70.0000:Disponivel', `[${rotulo}] lotes após a baixa de 80 L`);
      igual(await estoqueDe(s, reg.diesel.id), '70.0000', `[${rotulo}] estoque_atual após a baixa de 80 L`);
      igual(await lotesDe(s, reg.granel.id), '200.0000:Disponivel', `[${rotulo}] o Produto em KG foi tocado`);
      igual(await bemCru(s, reg.tp02.id), reg.bemTp02, `[${rotulo}] o abastecimento alterou o bem`);
      igual(await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } }), reg.financeiro, `[${rotulo}] lançamento financeiro criado pelo abastecimento`);
      reg.l80 = { id: ab.id, frota: 'TP-02', produto: 'DIESEL S10', quantidade: '80,0000 L', situacao: 'Confirmado' };
      await shot('confirmado-l');
    });

    await passo('9 lista e consulta → cancelar → estorno exato de 80 L', async () => {
      await conferirLista([reg.l80], 'lista-l');
      await abrirNaLista(reg.l80);
      igual((await visivel(page.getByTestId('consulta-quantidade')).innerText()).replace(/\s+/g, ' ').trim(), 'Quantidade baixada 80,0000 L', `[${rotulo}] consulta: quantidade`);
      const custo = await visivel(page.getByTestId('consulta-custo')).innerText();
      conferir(custo.includes('R$ 425,00') && custo.includes('5,3125/L'), `[${rotulo}] consulta: custo ${custo}`);
      igual(await visivel(page.getByTestId('consulta-fatias')).locator('tbody tr').count(), 2, `[${rotulo}] consulta: fatias`);
      igual((await visivel(page.getByTestId('abastecimento-consulta-situacao')).innerText()).trim(), 'Confirmado', `[${rotulo}] consulta: situação`);
      await shot('consulta-l');
      await clicar(page.getByTestId('abastecimento-cancelar'));
      await visivel(page.getByTestId('dialogo-cancelamento-abastecimento')).waitFor();
      const enviar = visivel(page.getByTestId('cancelamento-enviar'));
      conferir(await enviar.isDisabled(), `[${rotulo}] cancelar habilitado sem motivo/ciência`);
      await visivel(page.getByTestId('cancelamento-motivo')).fill('Lançado no bem errado');
      await visivel(page.getByTestId('cancelamento-ciente')).check();
      await shot('cancelamento');
      await enviar.click();
      conferir(await esperarAviso(/cancelado: 80,0000 L devolvidos aos lotes de origem\./, 15000), `[${rotulo}] aviso de cancelamento (80,0000 L) ausente`);
      const ab = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, id: reg.l80.id, status: 'CANCELADO' } }), 'abastecimento cancelado');
      igual(`${ab.versao}:${ab.motivo_cancelamento}`, '2:Lançado no bem errado', `[${rotulo}] cancelamento no banco`);
      const est = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: ab.movimentacao_estorno_id } });
      igual(`${est?.tipo_movimentacao}:${est?.tipo_detalhado}:${est?.unidade_medida}:${dec(est?.quantidade)}:${dec(est?.valor_total)}`, `Entrada:estorno_abastecimento:L:${FIFO.quantidade}:${FIFO.custo_total}`, `[${rotulo}] movimento de estorno`);
      igual(await lotesDe(s, reg.diesel.id), '50.0000:Disponivel|100.0000:Disponivel', `[${rotulo}] lotes após o cancelamento (estorno exato)`);
      igual(await estoqueDe(s, reg.diesel.id), '150.0000', `[${rotulo}] estoque_atual após o cancelamento`);
      igual(await bemCru(s, reg.tp02.id), reg.bemTp02, `[${rotulo}] o cancelamento alterou o bem`);
      await visivel(page.getByTestId('consulta-estorno')).waitFor();
      igual((await visivel(page.getByTestId('abastecimento-consulta-situacao')).innerText()).trim(), 'Cancelado', `[${rotulo}] consulta: situação após cancelar`);
      reg.l80.situacao = 'Cancelado';
      await shot('cancelado-l');
    });

    await passo('10 abastecer o Produto em KG (TP-03): dica de kg, capacidade não conferida', async () => {
      await ir('abastecimentos');
      await preencherAbastecimento({ frota: /TP-03/, produto: 'DIESEL S500 GRANEL', local: 'DEPÓSITO DE GRANEL', unidade: 'KG', quantidade: '35', leitura: '810', cheio: false });
      await shot('formulario-kg');
      const antes = await fotoBanco(s);
      await pedirPrevia();
      igual((await visivel(page.getByTestId('previa-dica-kg')).innerText()).trim(), DICA_KG, `[${rotulo}] revisão: dica de Produto em KG`);
      igual((await visivel(page.getByTestId('previa-baixa')).innerText()).replace(/\s+/g, ' ').trim(), 'Baixa do estoque 35,0000 kg', `[${rotulo}] revisão: baixa em kg`);
      await abrirDetalhesDoEstoque();
      conferir((await visivel(page.getByTestId('previa-capacidade')).innerText()).includes('não conferida (Produto em quilos'), `[${rotulo}] revisão: capacidade conferida para Produto em KG`);
      const custo = await visivel(page.getByTestId('previa-custo')).innerText();
      conferir(custo.includes('R$ 143,50') && custo.includes('/kg'), `[${rotulo}] revisão KG: custo ${custo}`);
      igual(await fotoBanco(s), antes, `[${rotulo}] a revisão em KG gravou algo`);
      await shot('previa-kg');
      await clicar(page.getByTestId('abastecimento-confirmar'));
      await visivel(page.getByTestId('abastecimento-consulta')).waitFor({ timeout: 30000 });
      conferir(await esperarAviso(/confirmado: 35,0000 kg baixados do estoque\./, 8000), `[${rotulo}] aviso de confirmação (35,0000 kg) ausente`);
      const ab = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, status: 'CONFIRMADO', bem_id: reg.tp03.id } }), 'abastecimento KG confirmado');
      igual(`${dec(ab.quantidade)}:${ab.unidade}:${dec(ab.custo_total)}:${dec(ab.custo_unitario)}:${ab.produto_id === reg.granel.id}`, '35.0000:KG:143.5000:4.1000:true', `[${rotulo}] abastecimento KG no banco`);
      const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: ab.movimentacao_estoque_id } });
      igual(`${mov.tipo_movimentacao}:${mov.unidade_medida}:${dec(mov.quantidade)}:${dec(mov.valor_total)}`, 'Saída:KG:35.0000:143.5000', `[${rotulo}] movimento de saída KG`);
      igual(await lotesDe(s, reg.granel.id), '165.0000:Disponivel', `[${rotulo}] lote do Produto em KG após a baixa`);
      igual(await estoqueDe(s, reg.granel.id), '165.0000', `[${rotulo}] estoque_atual do Produto em KG`);
      igual(await lotesDe(s, reg.diesel.id), '50.0000:Disponivel|100.0000:Disponivel', `[${rotulo}] o Diesel S10 foi tocado pelo abastecimento em KG`);
      igual(await bemCru(s, reg.tp03.id), reg.bemTp03, `[${rotulo}] o abastecimento alterou o TP-03`);
      reg.kg35 = { id: ab.id, frota: 'TP-03', produto: 'DIESEL S500 GRANEL', quantidade: '35,0000 kg', situacao: 'Confirmado' };
      await shot('confirmado-kg');
    });

    await passo('11 lista final: 80,0000 L cancelado e 35,0000 kg confirmado', async () => {
      await conferirLista([reg.kg35, reg.l80], 'lista-final');
      igual(await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } }), reg.financeiro, `[${rotulo}] lançamentos financeiros ao fim`);
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
process.exit(E.concluir('OK: aceite D-PROD-161 — Produto em L e em KG, Bens com "+ Nova família/tipo" e Produtos aceitos, abastecimento e estorno exatos; tela real + backend real + PostgreSQL local sem divergências.'));
