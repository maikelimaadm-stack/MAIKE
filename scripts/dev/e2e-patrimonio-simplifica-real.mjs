#!/usr/bin/env node
/**
 * D-PROD-162 (MAIKE-PATRIMONIO-SIMPLIFICA-01) e D-PROD-163
 * (MAIKE-PATRIMONIO-SIMPLIFICA-02) — ACEITE HUMANO em navegador real: tela
 * real + backend Fastify REAL + Vite + PostgreSQL LOCAL; conduz as telas pelo
 * Playwright (Chromium já instalado; nada é instalado) e confere o BANCO
 * (Prisma) depois de cada passo.
 *
 * "No cadastro de Produto crio o Diesel S10 em Litros, o Diesel S500 em quilos
 *  e a Ureia em SACOS; no cadastro do Bem escolho o Tipo de bem (Máquina) e o
 *  Tipo — ou crio um tipo novo pelo '+ Novo tipo' —, sem família, área nem
 *  localização; o tanque aceita Produto em qualquer unidade. Em '⋯ › Gerenciar
 *  tipos' vejo a lista, renomeio, excluo um tipo que ninguém usa e não consigo
 *  excluir um tipo em uso. Abasteço 80 L (capacidade conferida) e 150 kg de
 *  Ureia (Produto em sacos: digito kg; a capacidade em litros não é conferida)
 *  e o estoque baixa exatamente o que digitei; o cancelamento devolve
 *  exatamente o mesmo."
 *
 * Roteiro (em 1280, 820 e 390 px; cada largura num tenant próprio semeado
 * pelo BANCO por `e2e-abastecimentos-seed.mjs#semearBancoBase` — SEM Produto,
 * SEM família/tipo e SEM bem; "hoje" = dia real no fuso da fazenda):
 *   1. menu "Patrimônio e Frota" com exatamente Bens Patrimoniais e
 *      Abastecimentos; nenhum link para Famílias, Tipos, Perfis de medição ou
 *      Combustíveis; as rotas removidas caem em "Página não encontrada";
 *   2. Produtos PELA TELA: "Diesel S10" em LITROS (L), "Diesel S500 granel" em
 *      QUILOS (KG, com o aviso de litros ao trocar) e "Ureia granulada" em
 *      SACOS (peso por saco 50 kg). Banco: `unidade_principal_estoque` L, KG,
 *      SACO e o peso do saco;
 *   3. compras P3 pela API real: 50 L + 100 L (vetor `fifo`), 200 kg e 5 sacos
 *      (= 250 kg a R$ 4,0000/kg). Banco: lotes e `estoque_atual` 150 / 200 / 250;
 *   4. Bem PELA TELA: sem "Família", "Área" nem "Localização"; o Tipo fica
 *      bloqueado até escolher o "Tipo de bem" (Máquina); os tipos oferecidos são
 *      só os de Máquina (o catálogo padrão garantido pelo servidor, sem botão);
 *      "+ Novo tipo" (Tipo de bem travado) → "Trator cafeeiro" → Trator TP-02
 *      com horímetro e tanque de 180 L aceitando o Diesel S10 (selo L). Banco:
 *      as 6 famílias padrão, o tipo novo na família padrão MAQUINAS, o bem com
 *      natureza MAQUINA, sem área/localização, e o aceite;
 *   5. segundo bem (TP-03, tipo padrão "Trator de pneus") com tanque de 120 L
 *      aceitando o Produto em KG e o Produto em SACO (filtro "Sacos", selo
 *      "kg · saco", aviso de kg, texto novo da regra). Banco: 2 aceites;
 *  5b. lista de Bens com a coluna "Tipo de bem" e sem "Família"; consulta do
 *      bem sem Família/Área/Localização e com o Tipo de bem travado;
 *  5c. "⋯ › Gerenciar tipos" (sem família e sem "Instalar catálogo padrão"):
 *      lista com Tipo de bem e bens em uso, filtro por Tipo de bem, renomear
 *      (PATCH com versão), excluir um tipo livre (DELETE → some do banco) e
 *      tentar excluir um tipo em uso (409 → "Este tipo está em uso por 1
 *      bem(ns). Troque o tipo desses bens antes de excluir.", nada apagado);
 *   6. Abastecimentos: lista vazia, sem "Fatores kg/L" nem combustível;
 *   7. TP-02 em L: 181 L num tanque de 180 L é barrado na tela (capacidade
 *      conferida para Produto em litros); 80 L → revisão: baixa de 80,0000 L,
 *      capacidade conferida, custo FIFO R$ 425,00 em 2 lotes; nada gravado;
 *   8. confirmar → banco: 80 L, unidade L, FIFO exato, `estoque_atual` 70;
 *   9. lista e consulta → cancelar → estorno exato de 80 L (`estoque_atual` 150);
 *  10. TP-03 com Produto em SACO: escolhe a Ureia entre os 2 Produtos aceitos,
 *      "Quantidade abastecida (kg)" com a dica de sacos, 150 kg num tanque de
 *      120 L (capacidade NÃO conferida) → revisão em kg (R$ 600,00, R$ 4,0000/kg)
 *      → confirmar → banco: unidade KG, baixa EXATA de 150 kg (não 150 sacos),
 *      lote 100, `estoque_atual` 100 → cancelar → estorno EXATO de 150 kg
 *      (lote 250, `estoque_atual` 250);
 *  11. TP-03 com Produto em KG: 35 kg → banco: unidade KG, lote 165;
 *  12. lista final: 80,0000 L e 150,0000 kg Cancelados; 35,0000 kg Confirmado.
 *  Em TODA captura: sem rolagem horizontal da página. Toda resposta ≥ 400 da
 *  API real observada pelas telas é divergência, salvo a recusa esperada da
 *  exclusão do tipo em uso (409 `PATRIMONIO_TIPO_EM_USO`).
 *
 * Uso:
 *   DATABASE_URL=postgresql://postgres@localhost:5433/maike_s2_e2e1?host=/tmp \
 *     node scripts/dev/e2e-patrimonio-simplifica-real.mjs [pasta-das-capturas]
 * Variáveis opcionais: E2E_API_PORT (3951), E2E_WEB_PORT (5251),
 * E2E_LARGURAS ("1280,820,390"). O banco precisa estar migrado
 * (`npm run deploy:migrate` com a mesma URL). Recusa banco que não seja local.
 * Encerra backend e Vite ao sair. Sai com código ≠ 0 em QUALQUER divergência.
 */
import os from 'node:os';
import path from 'node:path';

import { COMPRA_KG, COMPRA_SACO, VETOR_FIFO, comprarDieselEmLitros, comprarPelaP3, definirPerfilFinanceiro, semearBancoBase, somarDias } from './e2e-abastecimentos-seed.mjs';
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
const { WEB, conferir, igual, esperarBanco } = E;
const FIFO = VETOR_FIFO;

process.env.DATABASE_URL = E.DATABASE_URL;
const { getPrismaClient, closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
const prisma = getPrismaClient();

/** Rotas das telas removidas pela D-PROD-162 (minúsculas = `createPageUrl`; PascalCase = links antigos). */
const TELAS_REMOVIDAS = ['FamiliasPatrimoniais', 'TiposPatrimoniais', 'PerfisMedicao', 'Combustiveis'];
/** D-PROD-163: aviso do tanque para Produto em KG ou SACO (estoque em kg). */
const AVISO_KG_TANQUE = 'Produto em quilos ou em sacos tem estoque em quilos: no abastecimento digita-se kg, não sacos nem os litros da bomba.';
/** D-PROD-163: a regra dos Produtos aceitos, na tela do tanque. */
const NOTA_PRODUTOS_ACEITOS =
  'Os Produtos aceitos vêm do estoque desta fazenda, em qualquer unidade (litros, quilos ou sacos). O abastecimento baixa do estoque exatamente a quantidade digitada, na unidade de estoque do Produto (litros para L; quilos para KG e SACO); a capacidade do tanque só é conferida para Produto em litros.';
const DICA_KG = 'Este Produto é controlado em quilos: digite kg, não os litros da bomba.';
const DICA_SACO = 'Este Produto é em sacos, com estoque em quilos: digite kg (não sacos nem os litros da bomba).';
const COLUNAS_PADRAO = 'Data | Máquina/Veículo | Produto | Quantidade | Medidor | Situação';
/** Códigos das 6 famílias padrão (uma por natureza) que o servidor garante sozinho (D-PROD-163). */
const FAMILIAS_PADRAO = 'BENFEITORIAS:BENFEITORIA|EQUIPAMENTOS:EQUIPAMENTO|IMPLEMENTOS:IMPLEMENTO|MAQUINAS:MAQUINA|OUTROS:OUTRO|VEICULOS:VEICULO';
/** Texto da tela normalizado (o Intl põe espaço não separável em "R$ 425,00"). @param {string} t */
const texto = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

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
/** Famílias do tenant (código:natureza), em ordem de código. */
const familiasDe = async (s) =>
  (await prisma.familiaPatrimonial.findMany({ where: { cliente_id: s.cliente_id }, orderBy: { codigo: 'asc' }, select: { codigo: true, natureza: true } }))
    .map((f) => `${f.codigo}:${f.natureza}`)
    .join('|');

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
   * @param {{ nome: string, codigo: string, unidadeMedida: RegExp, local: RegExp, estoque: 'L'|'KG'|'SACO', siglaMedida: string, pesoSaco?: string, conferirAviso?: boolean }} p
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
    if (p.estoque === 'SACO') {
      await escolherNoCombo(combo, 'SACOS');
      // Máscara de centavos do campo: "5000" = 50,00 kg por saco.
      await preencher(form.getByLabel(/^Peso por saco/), String(p.pesoSaco ?? '5000'));
    }
    const rotuloEstoque = { L: 'LITROS (L)', KG: 'QUILOGRAMAS (KG)', SACO: 'SACOS' }[p.estoque];
    igual((await visivel(combo).innerText()).trim(), rotuloEstoque, `[${rotulo}] Produto ${p.nome}: unidade principal de estoque na tela`);
    if (p.estoque === 'L') igual(await page.getByTestId('aviso-unidade-litros').filter({ visible: true }).count(), 0, `[${rotulo}] Produto em L com unidade L: aviso indevido`);
    await shot(`produto-${p.codigo.toLowerCase()}`);
    await clicar(botao('Salvar'));
    conferir(await esperarAviso('Produto cadastrado'), `[${rotulo}] aviso "Produto cadastrado" ausente (${p.nome})`);
    const linha = await esperarBanco(
      () => prisma.produto.findFirst({ where: { cliente_id: s.cliente_id, codigo_interno: { equals: p.codigo, mode: 'insensitive' } } }),
      `Produto ${p.nome} gravado`,
    );
    igual(
      `${linha.nome_produto.toUpperCase()}:${linha.unidade_principal_estoque}:${linha.unidade_medida}:${linha.empresa_id === s.empresa.id}:${linha.ativo}:${dec(linha.estoque_atual)}:${dec(linha.peso_por_saco_kg)}`,
      `${p.nome.toUpperCase()}:${p.estoque}:${p.siglaMedida}:true:true:0.0000:${p.estoque === 'SACO' ? '50.0000' : null}`,
      `[${rotulo}] Produto ${p.nome} no banco`,
    );
    return linha;
  };

  /** Escolhe o "Tipo de bem" (CampoSelect) no formulário do Bem. */
  const escolherTipoDeBem = async (form, nome) => {
    await escolherNoCombo(form.getByRole('combobox', { name: /^Tipo de bem/ }), nome);
    await page.getByTestId('bem-escolha-tipo-de-bem').filter({ visible: true }).waitFor({ state: 'detached' }).catch(() => {});
  };
  /** O formulário do Bem não tem Família, Área nem Localização (D-PROD-163). */
  const conferirSemCamposAntigos = async (form, onde) => {
    for (const re of [/^Fam[íi]lia/, /^[ÁA]rea/, /^Localiza/, /^Natureza/]) {
      igual(await form.getByLabel(re).filter({ visible: true }).count(), 0, `[${rotulo}] ${onde}: campo ${re.source} presente`);
    }
    igual(await form.getByText(/fam[íi]lia/i).filter({ visible: true }).count(), 0, `[${rotulo}] ${onde}: fala de família`);
  };
  /** Medidor horímetro + leitura inicial na aba Operação. */
  const preencherMedidor = async (form, leitura) => {
    await clicar(page.getByRole('tab', { name: 'Operação' }));
    await escolherNoCombo(form.getByRole('combobox', { name: 'Medidor' }), 'Horímetro');
    await preencher('bem-medidor-leitura-inicial', leitura);
    await preencher('bem-medidor-data', somarDias(s.hoje, -10));
  };
  /**
   * Aceita um Produto no tanque 0 pelo seletor (com filtro de unidade opcional).
   * @param {{ produto: RegExp, produtoId: string, selo: string, filtro?: string, seloFiltro?: string }} t
   */
  const aceitarProduto = async (tanque, t) => {
    if (t.filtro) await escolherNoCombo(tanque.getByRole('combobox', { name: 'Unidade' }), t.filtro);
    await clicar(tanque.getByTestId('bem-tanque-seletor-produto-0'));
    const painel = visivel(page.getByTestId('bem-tanque-seletor-produto-0-painel'));
    await painel.waitFor();
    const opcao = painel.getByRole('option', { name: t.produto });
    await opcao.first().waitFor();
    const textoOpcao = texto(await opcao.first().innerText());
    conferir(textoOpcao.includes(t.selo), `[${rotulo}] opção do Produto aceito sem o selo "${t.selo}" (${textoOpcao})`);
    if (t.filtro) {
      const todas = (await painel.getByRole('option').allInnerTexts()).map(texto);
      conferir(todas.length > 0 && todas.every((x) => x.includes(t.seloFiltro ?? t.selo)), `[${rotulo}] filtro "${t.filtro}" deixou passar outra unidade (${todas.join(' / ')})`);
    }
    await opcao.first().click();
    const chip = visivel(page.getByTestId(`bem-tanque-0-produto-${t.produtoId}`));
    await chip.waitFor();
    conferir(texto(await chip.innerText()).includes(t.selo), `[${rotulo}] chip do Produto aceito sem o selo ${t.selo}`);
  };
  /** Tanque novo na aba Operação (índice 0) com os Produtos aceitos. */
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
    // D-PROD-163: a regra nova (qualquer unidade) aparece no tanque.
    igual(texto(await visivel(page.getByTestId('bem-tanques-nota')).innerText()), NOTA_PRODUTOS_ACEITOS, `[${rotulo}] texto da regra dos Produtos aceitos`);
    for (const p of t.produtos) await aceitarProduto(tanque, p);
    igual(await page.getByTestId('bem-tanque-sem-produto-0').filter({ visible: true }).count(), 0, `[${rotulo}] aviso de tanque sem Produto continua com Produto aceito`);
    return tanque;
  };
  const conferirBemGravado = async (codigoFrota, esperado) => {
    const bem = await esperarBanco(
      () =>
        prisma.bemPatrimonial.findFirst({
          where: { cliente_id: s.cliente_id, codigo_frota: codigoFrota },
          include: { tanques: { include: { produtos: { orderBy: { createdAt: 'asc' } } } }, familia: true, tipo: true },
        }),
      `bem ${codigoFrota} gravado`,
    );
    const t = bem.tanques[0];
    igual(
      `${bem.nome}:${bem.natureza}:${bem.familia.codigo}:${bem.familia.natureza}:${bem.tipo.nome}:${bem.tipo.familia_id === bem.familia_id}:${bem.area_id}:${bem.localizacao_descricao}:${bem.medidor_tipo}:${dec(bem.medidor_leitura_atual)}:${bem.tanques.length}:${t?.identificador}:${dec(t?.capacidade_litros)}:${t?.ativo}`,
      esperado.bem,
      `[${rotulo}] bem ${codigoFrota} no banco`,
    );
    igual(
      (t?.produtos ?? []).map((p) => `${esperado.produtoIds.indexOf(p.produto_id)}:${p.ativo}`).join('|'),
      esperado.produtoIds.map((_id, i) => `${i}:true`).join('|'),
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
        const txt = texto(await linha.innerText());
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
        const valores = (await card.locator('.mg-b1-card__value').allInnerTexts()).map((t) => texto(t));
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

  /**
   * Novo abastecimento até a revisão.
   * @param {{ frota: RegExp, produto: string, escolherProduto?: boolean, local: string, unidade: 'L'|'KG', dica: string|null, quantidade: string, leitura: string, cheio: boolean }} a
   */
  const preencherAbastecimento = async (a) => {
    await clicar(page.getByRole('button', { name: 'Novo abastecimento' }));
    const form = visivel(page.getByTestId('abastecimento-form'));
    await form.waitFor();
    await escolher(form, 'abastecimento-bem', a.frota);
    if (a.escolherProduto) {
      // Mais de um Produto aceito: nenhum vem marcado; a pessoa escolhe.
      const radios = page.getByTestId('abastecimento-produto').getByRole('radio').filter({ visible: true });
      await radios.first().waitFor();
      igual(await radios.count(), 2, `[${rotulo}] Produtos oferecidos para ${a.frota.source}`);
      await clicar(page.getByTestId('abastecimento-produto').getByRole('radio', { name: a.produto, exact: true }));
    }
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
    if (a.dica) igual((await visivel(page.getByTestId('abastecimento-dica-kg')).innerText()).trim(), a.dica, `[${rotulo}] dica da unidade do Produto no formulário`);
    else igual(await page.getByTestId('abastecimento-dica-kg').filter({ visible: true }).count(), 0, `[${rotulo}] dica de kg para Produto em L`);
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
  /** Cancela o abastecimento aberto na consulta (motivo + ciência) e espera o aviso. */
  const cancelarAberto = async (motivo, avisoRe) => {
    await clicar(page.getByTestId('abastecimento-cancelar'));
    await visivel(page.getByTestId('dialogo-cancelamento-abastecimento')).waitFor();
    const enviar = visivel(page.getByTestId('cancelamento-enviar'));
    conferir(await enviar.isDisabled(), `[${rotulo}] cancelar habilitado sem motivo/ciência`);
    await visivel(page.getByTestId('cancelamento-motivo')).fill(motivo);
    await visivel(page.getByTestId('cancelamento-ciente')).check();
    await shot('cancelamento');
    await enviar.click();
    conferir(await esperarAviso(avisoRe, 15000), `[${rotulo}] aviso de cancelamento ausente (${avisoRe.source})`);
  };

  /** "⋯ › Gerenciar tipos" da tela de Bens: devolve o diálogo aberto. */
  const abrirGerenciarTipos = async () => {
    await clicar(page.getByRole('button', { name: 'Mais opções' }));
    const item = (nome) => page.getByRole('menuitem', { name: nome }).or(page.getByRole('button', { name: nome, exact: true }));
    await visivel(item('Gerenciar tipos')).waitFor();
    // D-PROD-163: sem família e sem "Instalar catálogo padrão" (o servidor garante o catálogo sozinho).
    igual(await item(/fam[íi]lia/i).filter({ visible: true }).count(), 0, `[${rotulo}] menu "⋯" com item de família`);
    igual(await item('Instalar catálogo padrão').filter({ visible: true }).count(), 0, `[${rotulo}] menu "⋯" com "Instalar catálogo padrão"`);
    await clicar(item('Gerenciar tipos'));
    const dlg = visivel(page.getByTestId('gerenciar-tipos'));
    await dlg.waitFor();
    await visivel(dlg.getByTestId('gerenciar-lista-tipos')).waitFor();
    return dlg;
  };
  /** Linha de um tipo no "Gerenciar tipos" (dados = "Máquina · 1 bem"). */
  const linhaDoTipo = (dlg, id) => visivel(dlg.getByTestId(`gerenciar-tipos-${id}`));
  const dadosDoTipo = async (dlg, id) => texto(await visivel(dlg.getByTestId(`gerenciar-tipos-${id}-dados`)).innerText());
  const tipoPorNome = (nome) => prisma.tipoPatrimonial.findFirst({ where: { cliente_id: s.cliente_id, nome }, include: { familia: true } });

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

    await passo('2 Produtos pela tela: Diesel S10 em LITROS, Diesel S500 granel em KG e Ureia granulada em SACOS', async () => {
      reg.diesel = await cadastrarProduto({ nome: 'Diesel S10', codigo: 'DS10', unidadeMedida: /^L - LITRO/, siglaMedida: 'L', local: /TANQUE DIESEL SEDE/, estoque: 'L' });
      reg.granel = await cadastrarProduto({ nome: 'Diesel S500 granel', codigo: 'DS500', unidadeMedida: /^KG - QUILOGRAMA/, siglaMedida: 'KG', local: /DEPÓSITO DE GRANEL/, estoque: 'KG', conferirAviso: true });
      reg.ureia = await cadastrarProduto({ nome: 'Ureia granulada', codigo: 'UREIA', unidadeMedida: /^SC - SACO/, siglaMedida: 'SC', local: /DEPÓSITO DE GRANEL/, estoque: 'SACO', pesoSaco: '5000' });
    });

    await passo('3 compras P3 (API real) em L, em KG e em SACOS', async () => {
      await definirPerfilFinanceiro(s, apiDono);
      await comprarDieselEmLitros(s, apiDono, reg.diesel.id);
      await comprarPelaP3(s, apiDono, { produto_id: reg.granel.id, local_id: s.localKg.id, unidade: 'KG', quantidade: COMPRA_KG.quantidade, custo: COMPRA_KG.custo, dia: somarDias(s.hoje, -COMPRA_KG.diasAtras), documento: 'NF-GRANEL-1' });
      await comprarPelaP3(s, apiDono, { produto_id: reg.ureia.id, local_id: s.localKg.id, unidade: 'SACO', quantidade: COMPRA_SACO.sacos, custo: COMPRA_SACO.custoSaco, dia: somarDias(s.hoje, -COMPRA_SACO.diasAtras), documento: 'NF-UREIA-1' });
      igual(await lotesDe(s, reg.diesel.id), '50.0000:Disponivel|100.0000:Disponivel', `[${rotulo}] lotes do Diesel S10 após as compras`);
      igual(await estoqueDe(s, reg.diesel.id), '150.0000', `[${rotulo}] estoque_atual do Diesel S10 após as compras`);
      igual(await lotesDe(s, reg.granel.id), '200.0000:Disponivel', `[${rotulo}] lote do Produto em KG`);
      // SACO guarda estoque em kg: 5 sacos de 50 kg = 250 kg (R$ 200,00 o saco = R$ 4,0000/kg).
      igual(await lotesDe(s, reg.ureia.id), `${COMPRA_SACO.kg}:Disponivel`, `[${rotulo}] lote do Produto em SACO (em kg)`);
      igual(await estoqueDe(s, reg.ureia.id), COMPRA_SACO.kg, `[${rotulo}] estoque_atual do Produto em SACO (em kg)`);
      const loteUreia = await prisma.estoqueLoteNota.findFirst({ where: { cliente_id: s.cliente_id, produto_id: reg.ureia.id } });
      igual(dec(loteUreia.custo_unitario), COMPRA_SACO.custoKg, `[${rotulo}] custo por kg do lote do Produto em SACO`);
      const rotulos = await prisma.movimentacaoEstoque.findMany({ where: { cliente_id: s.cliente_id }, orderBy: { createdAt: 'asc' }, select: { produto_id: true, unidade_medida: true } });
      const sigla = (id) => (id === reg.diesel.id ? 'DS10' : id === reg.granel.id ? 'DS500' : 'UREIA');
      igual(rotulos.map((m) => `${sigla(m.produto_id)}:${m.unidade_medida}`).join('|'), 'DS10:L|DS10:L|DS500:KG|UREIA:KG', `[${rotulo}] rótulo dos movimentos das compras`);
      reg.financeiro = await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } });
      igual(reg.financeiro, 4, `[${rotulo}] lançamentos P3 das compras`);
    });

    await passo('4 Bem pela tela: "Tipo de bem" + "+ Novo tipo", sem Família/Área/Localização, tanque com Produto em L', async () => {
      igual(await familiasDe(s), '', `[${rotulo}] famílias antes de abrir o cadastro de Bens`);
      await ir('benspatrimoniais');
      await clicar(botao('Novo'));
      const form = visivel(page.getByTestId('b1-form'));
      await form.waitFor();
      await visivel(page.getByTestId('bem-escolha-tipo-de-bem')).waitFor();
      await conferirSemCamposAntigos(form, 'novo bem');
      // O Tipo fica bloqueado até escolher o Tipo de bem.
      const seletorTipo = visivel(form.getByTestId('bem-seletor-tipo'));
      igual(`${await seletorTipo.isDisabled()}:${texto(await seletorTipo.innerText())}`, 'true:Escolha o tipo de bem primeiro', `[${rotulo}] Tipo bloqueado até escolher o Tipo de bem`);
      await shot('bem-sem-tipo-de-bem');
      // "Tipo de bem" = a lista FIXA de natureza.
      await clicar(form.getByRole('combobox', { name: /^Tipo de bem/ }));
      const opcoes = (await page.getByRole('option').filter({ visible: true }).allInnerTexts()).map(texto).filter((t) => t && !t.startsWith('—'));
      igual(opcoes.join(' | '), 'Benfeitoria | Máquina | Veículo | Implemento | Equipamento | Outro', `[${rotulo}] opções do "Tipo de bem"`);
      await visivel(page.getByRole('option', { name: 'Máquina', exact: true })).click();
      // Os tipos oferecidos são só os de Máquina (o catálogo padrão foi garantido pelo servidor, sem botão).
      await clicar(form.getByTestId('bem-seletor-tipo'));
      const painel = visivel(page.getByTestId('bem-seletor-tipo-painel'));
      await painel.waitFor();
      await painel.getByRole('option', { name: /Trator de pneus/i }).first().waitFor();
      const tiposMaquina = (await painel.getByRole('option').allInnerTexts()).map(texto).filter(Boolean);
      igual(tiposMaquina.map((t) => t.toUpperCase()).sort().join(' | '), 'TRATOR DE ESTEIRAS | TRATOR DE PNEUS', `[${rotulo}] tipos oferecidos para Máquina`);
      igual(await familiasDe(s), FAMILIAS_PADRAO, `[${rotulo}] famílias padrão garantidas pelo servidor (uma por natureza)`);
      await shot('bem-tipos-maquina');
      // "+ Novo tipo" com o Tipo de bem do bem, travado.
      await painel.getByRole('searchbox').fill('Trator cafeeiro');
      await clicar(page.getByTestId('bem-seletor-tipo-criar-novo'));
      const folha = visivel(page.getByRole('dialog', { name: 'Novo tipo' }));
      await folha.waitFor();
      igual(await visivel(folha.getByLabel(/^Nome/)).inputValue(), 'Trator cafeeiro', `[${rotulo}] "+ Novo tipo": nome vindo da busca`);
      const tipoDeBem = visivel(folha.getByLabel(/^Tipo de bem/));
      igual(`${await tipoDeBem.inputValue()}:${(await tipoDeBem.getAttribute('readonly')) !== null}`, 'Máquina:true', `[${rotulo}] "+ Novo tipo": Tipo de bem travado`);
      igual(await folha.getByLabel(/^Código|^Fam[íi]lia/).count(), 0, `[${rotulo}] "+ Novo tipo" pede código ou família`);
      await shot('novo-tipo');
      await clicar(folha.getByRole('button', { name: 'Salvar' }));
      conferir(await esperarAviso('Tipo criado'), `[${rotulo}] aviso "Tipo criado" ausente`);
      await folha.waitFor({ state: 'hidden' });
      await visivel(form.getByTestId('bem-seletor-tipo').filter({ hasText: /Trator cafeeiro/i })).waitFor();
      const novoTipo = await tipoPorNome('Trator cafeeiro');
      igual(
        `${novoTipo?.codigo}:${novoTipo?.familia?.codigo}:${novoTipo?.familia?.natureza}:${novoTipo?.ativo}:${novoTipo?.versao}`,
        'TRATOR_CAFEEIRO:MAQUINAS:MAQUINA:true:1',
        `[${rotulo}] tipo criado pelo "+ Novo tipo" (na família padrão da natureza; código gerado no servidor)`,
      );
      reg.tipoNovo = novoTipo;
      await preencher(form.getByLabel(/^Nome/).first(), 'Trator TP-02');
      await preencher(form.getByLabel(/^Código de frota/), 'TP-02');
      await preencherMedidor(form, '1.520,5');
      await conferirSemCamposAntigos(form, 'aba Operação');
      await preencherTanque(form, { identificador: 'Principal', capacidade: '180', produtos: [{ produto: /Diesel S10/i, produtoId: reg.diesel.id, selo: 'L' }] });
      igual(await page.getByTestId('bem-tanque-aviso-kg-0').filter({ visible: true }).count(), 0, `[${rotulo}] aviso de kg para Produto em L`);
      await shot('bem-tanque-produto-l');
      await clicar(botao('Salvar'));
      conferir(await esperarAviso('Bem patrimonial criado'), `[${rotulo}] aviso "Bem patrimonial criado" ausente`);
      reg.tp02 = await conferirBemGravado('TP-02', {
        bem: 'Trator TP-02:MAQUINA:MAQUINAS:MAQUINA:Trator cafeeiro:true:null:null:HORIMETRO:1520.5000:1:Principal:180.0000:true',
        produtoIds: [reg.diesel.id],
      });
      await shot('bem-tp02-salvo');
    });

    await passo('5 segundo bem: tipo padrão e tanque aceitando Produto em KG e em SACO', async () => {
      await ir('benspatrimoniais');
      await clicar(botao('Novo'));
      const form = visivel(page.getByTestId('b1-form'));
      await form.waitFor();
      await escolherTipoDeBem(form, 'Máquina');
      await escolher(form, 'bem-seletor-tipo', /Trator de pneus/i);
      await preencher(form.getByLabel(/^Nome/).first(), 'Trator TP-03');
      await preencher(form.getByLabel(/^Código de frota/), 'TP-03');
      await preencherMedidor(form, '800');
      const tanque = await preencherTanque(form, {
        identificador: 'Único',
        capacidade: '120',
        produtos: [
          { produto: /Diesel S500 granel/i, produtoId: reg.granel.id, selo: 'kg', filtro: 'Quilos (kg)' },
          { produto: /Ureia granulada/i, produtoId: reg.ureia.id, selo: 'kg · saco', filtro: 'Sacos (estoque em kg)' },
        ],
      });
      igual(texto(await visivel(page.getByTestId('bem-tanque-aviso-kg-0')).innerText()), AVISO_KG_TANQUE, `[${rotulo}] aviso de Produto em KG/SACO no tanque`);
      igual(await tanque.getByTestId(/^bem-tanque-0-produto-/).count(), 2, `[${rotulo}] Produtos aceitos no tanque do TP-03 (tela)`);
      await shot('bem-tanque-produto-kg-saco');
      await clicar(botao('Salvar'));
      conferir(await esperarAviso('Bem patrimonial criado'), `[${rotulo}] aviso "Bem patrimonial criado" ausente (TP-03)`);
      reg.tp03 = await conferirBemGravado('TP-03', {
        bem: 'Trator TP-03:MAQUINA:MAQUINAS:MAQUINA:Trator de pneus:true:null:null:HORIMETRO:800.0000:1:Único:120.0000:true',
        produtoIds: [reg.granel.id, reg.ureia.id],
      });
      igual(await familiasDe(s), FAMILIAS_PADRAO, `[${rotulo}] famílias (nenhuma criada pelo usuário)`);
    });

    await passo('5b lista de Bens com "Tipo de bem" (sem Família) e consulta sem Família/Área/Localização', async () => {
      await ir('benspatrimoniais');
      const alvo = page.getByTestId(`bem-nome-${reg.tp02.id}`).or(page.getByTestId('b1-card').filter({ hasText: 'TP-02' }));
      await visivel(alvo).waitFor();
      const cabecalhos = (await page.getByRole('columnheader').filter({ visible: true }).allTextContents()).map((t) => t.trim()).filter(Boolean);
      if (desktop) conferir(cabecalhos.includes('Tipo de bem') && cabecalhos.includes('Tipo'), `[${rotulo}] lista de Bens sem as colunas "Tipo de bem" e "Tipo" (${cabecalhos.join(' | ')})`);
      conferir(!cabecalhos.some((c) => /fam[íi]lia|natureza|[áa]rea|localiza/i.test(c)), `[${rotulo}] lista de Bens com coluna antiga (${cabecalhos.join(' | ')})`);
      conferir(await visivel(page.getByRole('combobox', { name: 'Filtrar por tipo de bem' })).isVisible().catch(() => false), `[${rotulo}] filtro "Tipo de bem" ausente na lista de Bens`);
      if (cabecalhos.length) {
        const linha = texto(await visivel(page.locator('tr').filter({ has: page.getByTestId(`bem-nome-${reg.tp02.id}`) })).innerText());
        conferir(linha.includes('Máquina') && /Trator cafeeiro/i.test(linha), `[${rotulo}] linha do TP-02 sem Tipo de bem/Tipo (${linha})`);
      }
      await shot('lista-bens');
      await visivel(alvo).dblclick();
      const form = visivel(page.getByTestId('b1-form'));
      await form.waitFor();
      await conferirSemCamposAntigos(form, 'consulta do bem');
      const tipoDeBem = visivel(form.getByRole('combobox', { name: /^Tipo de bem/ }));
      igual(`${texto(await tipoDeBem.innerText()).toUpperCase()}:${await tipoDeBem.isDisabled()}`, 'MÁQUINA:true', `[${rotulo}] consulta: Tipo de bem (travado)`);
      conferir(/Trator cafeeiro/i.test(texto(await visivel(form.getByTestId('bem-seletor-tipo')).innerText())), `[${rotulo}] consulta: Tipo`);
      await shot('consulta-bem');
    });

    await passo('5c "⋯ › Gerenciar tipos": lista, renomear, excluir livre e recusa do tipo em uso', async () => {
      await ir('benspatrimoniais');
      await visivel(page.getByTestId(`bem-nome-${reg.tp03.id}`).or(page.getByTestId('b1-card').filter({ hasText: 'TP-03' }))).waitFor();
      const dlg = await abrirGerenciarTipos();
      const pneus = await tipoPorNome('Trator de pneus');
      const rocadeira = await tipoPorNome('Roçadeira');
      igual(`${pneus?.familia?.codigo}:${rocadeira?.familia?.codigo}`, 'MAQUINAS:IMPLEMENTOS', `[${rotulo}] tipos padrão nas famílias padrão`);
      igual(await dadosDoTipo(dlg, reg.tipoNovo.id), 'Máquina · 1 bem', `[${rotulo}] gerenciar: Trator cafeeiro`);
      igual(await dadosDoTipo(dlg, pneus.id), 'Máquina · 1 bem', `[${rotulo}] gerenciar: Trator de pneus`);
      igual(await dadosDoTipo(dlg, rocadeira.id), 'Implemento · Nenhum bem', `[${rotulo}] gerenciar: Roçadeira`);
      igual(await dlg.getByText(/fam[íi]lia|perfi[ls] de medição|combust[íi]vel/i).count(), 0, `[${rotulo}] gerenciar fala de família/perfis/combustível`);
      await shot('gerenciar-tipos');
      // Filtro pelo Tipo de bem.
      await escolherNoCombo(dlg.getByRole('combobox', { name: 'Filtrar por tipo de bem' }), 'Máquina');
      await page.waitForFunction(
        (id) => !document.querySelector(`[data-testid="gerenciar-tipos-${id}"]`) && document.querySelector('[data-testid="gerenciar-lista-tipos"]'),
        rocadeira.id,
      );
      const maquinas = (await visivel(dlg.getByTestId('gerenciar-lista-tipos')).locator('li p.uppercase').allInnerTexts()).map((t) => texto(t).toUpperCase()).sort();
      igual(maquinas.join(' | '), 'TRATOR CAFEEIRO | TRATOR DE ESTEIRAS | TRATOR DE PNEUS', `[${rotulo}] gerenciar: filtro Máquina`);
      await shot('gerenciar-filtro-maquina');
      // As ações das linhas cabem no diálogo sem arrastar a lista para o lado.
      const caixa = await visivel(dlg.getByTestId('gerenciar-lista-tipos')).evaluate((t) => {
        const el = t.parentElement;
        return { sw: el.scrollWidth, cw: el.clientWidth, dsw: t.closest('[role="dialog"]')?.scrollWidth ?? 0, dcw: t.closest('[role="dialog"]')?.clientWidth ?? 0 };
      });
      conferir(caixa.sw <= caixa.cw + 1 && caixa.dsw <= caixa.dcw + 1, `[${rotulo}] gerenciar: a lista rola na horizontal em ${largura} px (${JSON.stringify(caixa)})`);

      // Renomear (PATCH com a versão lida).
      await clicar(linhaDoTipo(dlg, reg.tipoNovo.id).getByRole('button', { name: /^Renomear/ }));
      await preencher(dlg.getByRole('textbox', { name: /^Novo nome do tipo/ }), 'Trator cafeeiro 4x4');
      await shot('gerenciar-renomear');
      await clicar(linhaDoTipo(dlg, reg.tipoNovo.id).getByRole('button', { name: 'Salvar', exact: true }));
      conferir(await esperarAviso('Tipo renomeado'), `[${rotulo}] aviso "Tipo renomeado" ausente`);
      const renomeado = await esperarBanco(
        () => prisma.tipoPatrimonial.findFirst({ where: { cliente_id: s.cliente_id, id: reg.tipoNovo.id, nome: 'Trator cafeeiro 4x4' } }),
        'tipo renomeado',
      );
      igual(`${renomeado.versao}:${renomeado.codigo}:${renomeado.familia_id === reg.tipoNovo.familia_id}`, '2:TRATOR_CAFEEIRO:true', `[${rotulo}] renomear: versão, código e família`);
      await visivel(linhaDoTipo(dlg, reg.tipoNovo.id).getByText(/Trator cafeeiro 4x4/i)).waitFor();

      // Tentar excluir um tipo EM USO: 409 com a mensagem, nada apagado.
      await clicar(linhaDoTipo(dlg, pneus.id).getByRole('button', { name: /^Excluir/ }));
      const confirma = visivel(page.getByRole('alertdialog'));
      await confirma.waitFor();
      await clicar(confirma.getByRole('button', { name: 'Excluir', exact: true }));
      const emUso = visivel(dlg.getByTestId(`gerenciar-tipo-em-uso-${pneus.id}`));
      await emUso.waitFor();
      igual(texto(await emUso.innerText()), 'Este tipo está em uso por 1 bem(ns). Troque o tipo desses bens antes de excluir.', `[${rotulo}] gerenciar: mensagem do tipo em uso`);
      igual(await prisma.tipoPatrimonial.count({ where: { cliente_id: s.cliente_id, id: pneus.id } }), 1, `[${rotulo}] o tipo em uso foi apagado`);
      await shot('gerenciar-tipo-em-uso');

      // Excluir um tipo LIVRE (Roçadeira, de Implemento): some do banco e da lista.
      await escolherNoCombo(dlg.getByRole('combobox', { name: 'Filtrar por tipo de bem' }), 'Implemento');
      await linhaDoTipo(dlg, rocadeira.id).waitFor();
      await clicar(linhaDoTipo(dlg, rocadeira.id).getByRole('button', { name: /^Excluir/ }));
      const confirma2 = visivel(page.getByRole('alertdialog'));
      await confirma2.waitFor();
      await clicar(confirma2.getByRole('button', { name: 'Excluir', exact: true }));
      conferir(await esperarAviso('Tipo excluído'), `[${rotulo}] aviso "Tipo excluído" ausente`);
      await esperarBanco(async () => (await prisma.tipoPatrimonial.count({ where: { cliente_id: s.cliente_id, id: rocadeira.id } })) === 0, 'tipo livre excluído');
      await page.waitForFunction((id) => !document.querySelector(`[data-testid="gerenciar-tipos-${id}"]`), rocadeira.id);
      igual(
        await prisma.auditLog.count({ where: { cliente_id: s.cliente_id, entidade_id: rocadeira.id, acao: 'delete', usuario_id: s.usuario_id } }),
        1,
        `[${rotulo}] auditoria da exclusão do tipo`,
      );
      await shot('gerenciar-tipo-excluido');
      await page.keyboard.press('Escape');
      await dlg.waitFor({ state: 'hidden' });
      // O tipo excluído não volta (a família padrão já existe) e o renomeado aparece no bem.
      const outra = await apiDono('GET', '/patrimonio-tipos?natureza=IMPLEMENTO&limit=100');
      igual(`${outra.status}:${(outra.corpo?.items ?? []).some((t) => t.id === rocadeira.id || t.codigo === 'ROCADEIRA')}`, '200:false', `[${rotulo}] o tipo padrão excluído voltou`);
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

    await passo('7 Produto em L: capacidade conferida (181 L barrado); 80 L → revisão (nada gravado)', async () => {
      await preencherAbastecimento({ frota: /TP-02/, produto: 'DIESEL S10', local: 'TANQUE DIESEL SEDE', unidade: 'L', dica: null, quantidade: '181', leitura: '1.550,5', cheio: true });
      const antes = await fotoBanco(s);
      await clicar(page.getByTestId('abastecimento-previa'));
      conferir(
        await visivel(page.getByText('Os litros passam da capacidade nominal do tanque.')).waitFor({ timeout: 8000 }).then(() => true, () => false),
        `[${rotulo}] 181 L num tanque de 180 L não foi barrado (capacidade conferida para Produto em L)`,
      );
      igual(await page.getByTestId('dialogo-previa-abastecimento').filter({ visible: true }).count(), 0, `[${rotulo}] revisão aberta acima da capacidade`);
      await shot('formulario-l-acima-da-capacidade');
      await preencher('abastecimento-quantidade', '80');
      await shot('formulario-l');
      await pedirPrevia();
      const resumo = await visivel(page.getByTestId('previa-resumo')).innerText();
      conferir(resumo.includes('DIESEL S10') && resumo.includes('80 L') && resumo.includes('Baixa de 80,0000 L'), `[${rotulo}] revisão: resumo ${resumo}`);
      igual((await visivel(page.getByTestId('previa-baixa')).innerText()).replace(/\s+/g, ' ').trim(), '80,0000 L', `[${rotulo}] revisão: baixa`);
      igual(await page.getByTestId('previa-dica-kg').filter({ visible: true }).count(), 0, `[${rotulo}] revisão: dica de kg para Produto em L`);
      await shot('previa-l');
      await abrirDetalhesDoEstoque();
      const custo = texto(await visivel(page.getByTestId('previa-custo')).innerText());
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
      igual(await lotesDe(s, reg.ureia.id), `${COMPRA_SACO.kg}:Disponivel`, `[${rotulo}] o Produto em SACO foi tocado`);
      igual(await bemCru(s, reg.tp02.id), reg.bemTp02, `[${rotulo}] o abastecimento alterou o bem`);
      igual(await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } }), reg.financeiro, `[${rotulo}] lançamento financeiro criado pelo abastecimento`);
      reg.l80 = { id: ab.id, frota: 'TP-02', produto: 'DIESEL S10', quantidade: '80,0000 L', situacao: 'Confirmado' };
      await shot('confirmado-l');
    });

    await passo('9 lista e consulta → cancelar → estorno exato de 80 L', async () => {
      await conferirLista([reg.l80], 'lista-l');
      await abrirNaLista(reg.l80);
      igual((await visivel(page.getByTestId('consulta-quantidade')).innerText()).replace(/\s+/g, ' ').trim(), '80,0000 L', `[${rotulo}] consulta: quantidade`);
      const custo = texto(await visivel(page.getByTestId('consulta-custo')).innerText());
      conferir(custo.includes('R$ 425,00') && custo.includes('5,3125/L'), `[${rotulo}] consulta: custo ${custo}`);
      igual(await visivel(page.getByTestId('consulta-fatias')).locator('tbody tr').count(), 2, `[${rotulo}] consulta: fatias`);
      igual((await visivel(page.getByTestId('abastecimento-consulta-situacao')).innerText()).trim(), 'Confirmado', `[${rotulo}] consulta: situação`);
      await shot('consulta-l');
      await cancelarAberto('Lançado no bem errado', /cancelado: 80,0000 L devolvidos aos lotes de origem\./);
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

    await passo('10 Produto em SACO (TP-03): kg, capacidade não conferida, baixa exata de 150 kg e estorno exato', async () => {
      await ir('abastecimentos');
      await preencherAbastecimento({ frota: /TP-03/, produto: 'UREIA GRANULADA', escolherProduto: true, local: 'DEPÓSITO DE GRANEL', unidade: 'KG', dica: DICA_SACO, quantidade: '150', leitura: '805', cheio: false });
      await shot('formulario-saco');
      const antes = await fotoBanco(s);
      await pedirPrevia();
      igual(texto(await visivel(page.getByTestId('previa-dica-kg')).innerText()), DICA_SACO, `[${rotulo}] revisão: dica do Produto em sacos`);
      igual(texto(await visivel(page.getByTestId('previa-baixa')).innerText()), '150,0000 kg', `[${rotulo}] revisão: baixa em kg (não em sacos)`);
      await abrirDetalhesDoEstoque();
      // 150 kg num tanque de 120 L: a capacidade (em litros) não é conferida para Produto em kg.
      conferir(texto(await visivel(page.getByTestId('previa-capacidade')).innerText()).includes('não conferida (Produto em quilos'), `[${rotulo}] revisão: capacidade conferida para Produto em SACO`);
      const custo = texto(await visivel(page.getByTestId('previa-custo')).innerText());
      conferir(custo.includes('R$ 600,00') && custo.includes('R$ 4,00/kg'), `[${rotulo}] revisão SACO: custo ${custo}`);
      igual(await page.getByTestId('previa-bloqueios').count(), 0, `[${rotulo}] revisão SACO com bloqueio`);
      igual(await fotoBanco(s), antes, `[${rotulo}] a revisão em SACO gravou algo`);
      await shot('previa-saco');
      await clicar(page.getByTestId('abastecimento-confirmar'));
      await visivel(page.getByTestId('abastecimento-consulta')).waitFor({ timeout: 30000 });
      conferir(await esperarAviso(/confirmado: 150,0000 kg baixados do estoque\./, 8000), `[${rotulo}] aviso de confirmação (150,0000 kg) ausente`);
      const ab = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, status: 'CONFIRMADO', bem_id: reg.tp03.id, produto_id: reg.ureia.id } }), 'abastecimento SACO confirmado');
      igual(`${dec(ab.quantidade)}:${ab.unidade}:${dec(ab.custo_total)}:${dec(ab.custo_unitario)}`, '150.0000:KG:600.0000:4.0000', `[${rotulo}] abastecimento SACO no banco (unidade KG)`);
      const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: ab.movimentacao_estoque_id } });
      igual(`${mov.tipo_movimentacao}:${mov.unidade_medida}:${dec(mov.quantidade)}:${dec(mov.valor_total)}`, 'Saída:KG:150.0000:600.0000', `[${rotulo}] movimento de saída do Produto em SACO`);
      igual(await lotesDe(s, reg.ureia.id), '100.0000:Disponivel', `[${rotulo}] lote do Produto em SACO após a baixa exata de 150 kg`);
      igual(await estoqueDe(s, reg.ureia.id), '100.0000', `[${rotulo}] estoque_atual do Produto em SACO após a baixa`);
      igual(await lotesDe(s, reg.granel.id), '200.0000:Disponivel', `[${rotulo}] o Produto em KG foi tocado pelo abastecimento em SACO`);
      igual(await bemCru(s, reg.tp03.id), reg.bemTp03, `[${rotulo}] o abastecimento alterou o TP-03`);
      igual(texto(await visivel(page.getByTestId('consulta-quantidade')).innerText()), '150,0000 kg', `[${rotulo}] consulta SACO: quantidade`);
      await shot('confirmado-saco');
      await cancelarAberto('Produto errado', /cancelado: 150,0000 kg devolvidos aos lotes de origem\./);
      const cancelado = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, id: ab.id, status: 'CANCELADO' } }), 'abastecimento SACO cancelado');
      const est = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: cancelado.movimentacao_estorno_id } });
      igual(`${est?.tipo_movimentacao}:${est?.tipo_detalhado}:${est?.unidade_medida}:${dec(est?.quantidade)}:${dec(est?.valor_total)}`, 'Entrada:estorno_abastecimento:KG:150.0000:600.0000', `[${rotulo}] estorno do Produto em SACO`);
      igual(await lotesDe(s, reg.ureia.id), `${COMPRA_SACO.kg}:Disponivel`, `[${rotulo}] lote do Produto em SACO após o estorno exato`);
      igual(await estoqueDe(s, reg.ureia.id), COMPRA_SACO.kg, `[${rotulo}] estoque_atual do Produto em SACO após o estorno`);
      await visivel(page.getByTestId('consulta-estorno')).waitFor();
      reg.saco150 = { id: ab.id, frota: 'TP-03', produto: 'UREIA GRANULADA', quantidade: '150,0000 kg', situacao: 'Cancelado' };
      await shot('cancelado-saco');
    });

    await passo('11 Produto em KG (TP-03): 35 kg, dica de kg, baixa exata', async () => {
      await ir('abastecimentos');
      await preencherAbastecimento({ frota: /TP-03/, produto: 'DIESEL S500 GRANEL', escolherProduto: true, local: 'DEPÓSITO DE GRANEL', unidade: 'KG', dica: DICA_KG, quantidade: '35', leitura: '810', cheio: false });
      await shot('formulario-kg');
      const antes = await fotoBanco(s);
      await pedirPrevia();
      igual(texto(await visivel(page.getByTestId('previa-dica-kg')).innerText()), DICA_KG, `[${rotulo}] revisão: dica de Produto em KG`);
      igual(texto(await visivel(page.getByTestId('previa-baixa')).innerText()), '35,0000 kg', `[${rotulo}] revisão: baixa em kg`);
      await abrirDetalhesDoEstoque();
      conferir(texto(await visivel(page.getByTestId('previa-capacidade')).innerText()).includes('não conferida (Produto em quilos'), `[${rotulo}] revisão: capacidade conferida para Produto em KG`);
      const custo = texto(await visivel(page.getByTestId('previa-custo')).innerText());
      conferir(custo.includes('R$ 143,50') && custo.includes('/kg'), `[${rotulo}] revisão KG: custo ${custo}`);
      igual(await fotoBanco(s), antes, `[${rotulo}] a revisão em KG gravou algo`);
      await shot('previa-kg');
      await clicar(page.getByTestId('abastecimento-confirmar'));
      await visivel(page.getByTestId('abastecimento-consulta')).waitFor({ timeout: 30000 });
      conferir(await esperarAviso(/confirmado: 35,0000 kg baixados do estoque\./, 8000), `[${rotulo}] aviso de confirmação (35,0000 kg) ausente`);
      const ab = await esperarBanco(() => prisma.abastecimentoBem.findFirst({ where: { cliente_id: s.cliente_id, status: 'CONFIRMADO', bem_id: reg.tp03.id, produto_id: reg.granel.id } }), 'abastecimento KG confirmado');
      igual(`${dec(ab.quantidade)}:${ab.unidade}:${dec(ab.custo_total)}:${dec(ab.custo_unitario)}`, '35.0000:KG:143.5000:4.1000', `[${rotulo}] abastecimento KG no banco`);
      const mov = await prisma.movimentacaoEstoque.findFirst({ where: { cliente_id: s.cliente_id, id: ab.movimentacao_estoque_id } });
      igual(`${mov.tipo_movimentacao}:${mov.unidade_medida}:${dec(mov.quantidade)}:${dec(mov.valor_total)}`, 'Saída:KG:35.0000:143.5000', `[${rotulo}] movimento de saída KG`);
      igual(await lotesDe(s, reg.granel.id), '165.0000:Disponivel', `[${rotulo}] lote do Produto em KG após a baixa`);
      igual(await estoqueDe(s, reg.granel.id), '165.0000', `[${rotulo}] estoque_atual do Produto em KG`);
      igual(await lotesDe(s, reg.diesel.id), '50.0000:Disponivel|100.0000:Disponivel', `[${rotulo}] o Diesel S10 foi tocado pelo abastecimento em KG`);
      igual(await lotesDe(s, reg.ureia.id), `${COMPRA_SACO.kg}:Disponivel`, `[${rotulo}] o Produto em SACO foi tocado pelo abastecimento em KG`);
      igual(await bemCru(s, reg.tp03.id), reg.bemTp03, `[${rotulo}] o abastecimento alterou o TP-03`);
      reg.kg35 = { id: ab.id, frota: 'TP-03', produto: 'DIESEL S500 GRANEL', quantidade: '35,0000 kg', situacao: 'Confirmado' };
      await shot('confirmado-kg');
    });

    await passo('12 lista final: 80,0000 L e 150,0000 kg cancelados; 35,0000 kg confirmado', async () => {
      await conferirLista([reg.kg35, reg.saco150, reg.l80], 'lista-final');
      igual(await prisma.operacaoFinanceira.count({ where: { cliente_id: s.cliente_id } }), reg.financeiro, `[${rotulo}] lançamentos financeiros ao fim`);
    });
  } catch (erro) {
    if (!(erro instanceof Divergencia)) console.error(`  [${rotulo}] interrompido: ${String(erro?.message || erro).split('\n')[0]}`);
  } finally {
    await new Promise((r) => setTimeout(r, 400)); // corpos das últimas respostas ainda em leitura
    // Única recusa esperada: excluir o tipo em uso (409 PATRIMONIO_TIPO_EM_USO).
    E.fecharLargura(rotulo, registro, [(r) => r.metodo === 'DELETE' && r.status === 409 && /^\/api\/native\/patrimonio-tipos\/[^/?]+\?versao=\d+$/.test(r.caminho) && /PATRIMONIO_TIPO_EM_USO/.test(r.texto)]);
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
process.exit(
  E.concluir(
    'OK: aceite D-PROD-163 — Produtos em L, KG e SACO aceitos no tanque, Bens com "Tipo de bem" + "Tipo" (+ Novo tipo) sem Família/Área/Localização, "Gerenciar tipos" (renomear, excluir, recusa em uso), abastecimento e estorno exatos (L com capacidade; kg sem); tela real + backend real + PostgreSQL local sem divergências.',
  ),
);
