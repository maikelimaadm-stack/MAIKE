#!/usr/bin/env node
/**
 * D-PROD-159 / D-PROD-162 / D-PROD-163 — semente dos ensaios ponta a ponta
 * REAIS de Patrimônio e Frota (tela real + backend Fastify real + PostgreSQL
 * LOCAL). Molde: `e2e-lancamentos-seed.mjs` (Central Única de Lançamentos).
 *
 * D-PROD-162 (MAIKE-PATRIMONIO-SIMPLIFICA-01): não há mais tipo de
 * combustível, vínculo combustível × produto nem fator kg/L. O tanque do bem
 * aceita PRODUTOS do estoque e o abastecimento baixa exatamente a quantidade
 * digitada, na unidade de estoque do Produto. O estoque em litros entra pela
 * compra da Gestão P3 em `L` (a API real), nunca por "saldo inicial" fingido.
 *
 * D-PROD-163 (MAIKE-PATRIMONIO-SIMPLIFICA-02): o tanque aceita Produto em
 * QUALQUER unidade (L, KG ou SACO; o SACO guarda estoque em kg e abastece em
 * kg). O bem vai com "Tipo de bem" (`natureza`) + `tipo_id`, SEM `familia_id`
 * (o servidor deriva a família do tipo); o catálogo padrão (uma família por
 * natureza e os tipos padrão) é GARANTIDO pelo servidor na primeira leitura
 * de tipos — a semente não chama mais `POST /patrimonio-catalogo-padrao`.
 *
 * Cria UM tenant novo por chamada (código e logins com sufixo aleatório: nada
 * é apagado, nada colide com execuções anteriores):
 *   - pelo BANCO (o que nenhuma tela desta missão cria): administrador real da
 *     fazenda (`papel_tenant = 'administrador'`, sem linha de Permissão: o
 *     caminho do dono) com senha conhecida; empresa SEDE com fuso
 *     `America/Sao_Paulo` e uma segunda empresa RETIRO; unidades de medida
 *     (L, KG, SC), categoria de produto, locais de estoque, fornecedor e natureza
 *     de despesa (para a compra P3); usuário comum só com `visualizar` em
 *     Abastecimentos e em Bens Patrimoniais;
 *   - pela API REAL: o perfil financeiro da SEDE e, em `semearAbastecimentoE2E`
 *     (o ensaio da tela de Abastecimentos), os Produtos em L e em KG
 *     (`POST /produtos`), as compras P3 em L e em KG (`POST
 *     /operacoes-financeiras` + confirmar: lotes e movimentos rotulados `L`/`KG`),
 *     os tipos do catálogo padrão (`GET /patrimonio-tipos?natureza=…`, que o
 *     garante) e os bens com `natureza` + `tipo_id` e os Produtos aceitos dos
 *     tanques (`POST /bens-patrimoniais`, `produto_ids`).
 *
 * Decimais só como texto (nunca `Number`/float). SÓ roda contra PostgreSQL local.
 *
 * Uso: DATABASE_URL=postgresql://postgres@localhost:5433/maike_e2e?host=/tmp \
 *        node scripts/dev/e2e-abastecimentos-seed.mjs [rotulo]
 * Sem backend no ar, a parte "pela API" usa o app Fastify em processo
 * (`app.inject`). Imprime o JSON da semente (ids e credenciais de TESTE).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { exigirBancoLocal } from './e2e-lancamentos-seed.mjs';

export { exigirBancoLocal };

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const SENHA_E2E_ABASTECIMENTO = 'senha-e2e-abastecimentos-1';
export const TELA_ABASTECIMENTOS = 'pat-abastecimentos';
export const TELA_BENS = 'pat-bens-patrimoniais';
export const FUSO_E2E = 'America/Sao_Paulo';

/** Vetor `fifo` compartilhado com o backend e o smoke (`abastecimentoVetores.json`). */
export const VETOR_FIFO = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tests/smoke/fixtures/abastecimentoVetores.json'), 'utf8')).fifo;

/**
 * Compras do diesel em LITROS (o vetor `fifo`: 50 L a 5,2000/L e 100 L a
 * 5,5000/L), em dias distintos para a ordem FIFO.
 */
export const COMPRAS_DIESEL = Object.freeze(
  VETOR_FIFO.lotes.map((l, i) => Object.freeze({ chave: l.chave, quantidade: l.disponivel, custo: l.custo_unitario, diasAtras: 40 - i * 15 })),
);
/** Compra do Produto em QUILOS (um lote só). */
export const COMPRA_KG = Object.freeze({ quantidade: '200.0000', custo: '4.1000', diasAtras: 20 });
/**
 * D-PROD-163 — compra do Produto em SACOS (um lote só): 5 sacos de 50 kg a
 * R$ 200,00 o saco = 250 kg a R$ 4,0000/kg (o estoque do SACO é em kg).
 */
export const COMPRA_SACO = Object.freeze({ sacos: '5', pesoSacoKg: '50', custoSaco: '200.0000', kg: '250.0000', custoKg: '4.0000', diasAtras: 15 });

/** Dia de hoje no fuso da fazenda (AAAA-MM-DD). */
export const hojeEm = (fuso) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const somarDias = (d, n) => {
  const t = new Date(`${d}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** Ações gravadas numa linha de Permissão (ausente = negado; D-PROD-162: sem `configurar_conversao`). */
const ACOES = Object.freeze(['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar', 'inativar', 'cancelar']);
/** Linha de uma tela do Patrimônio com TODAS as ações explícitas. */
export const linhaTela = (telaId, acoes = {}) => ({
  modulo_id: 'patrimonio',
  tela_id: telaId,
  ...Object.fromEntries(ACOES.map((a) => [a, false])),
  visualizar: true,
  ...acoes,
});
export const linhaAbastecimentos = (acoes = {}) => linhaTela(TELA_ABASTECIMENTOS, acoes);

let sequenciaOp = 0;
/** `operation_id` único (padrão da rota P3). */
export const opId = (prefixo = 'e2e') => `${prefixo}-${Date.now().toString(36)}-${(sequenciaOp += 1)}-${randomUUID().slice(0, 8)}`;

/**
 * Parte do BANCO: tenant, dono, empresas, cadastros de apoio do Produto e da
 * compra P3, e o usuário só-visualizar.
 * @param {{ rotulo?: string }} [opcoes]
 */
export const semearBancoBase = async (opcoes = {}) => {
  exigirBancoLocal();
  const { getPrismaClient } = await import('../../backend/src/database/prismaClient.js');
  const { gerarSenhaHash } = await import('../../backend/src/modules/auth/authService.js');
  const prisma = getPrismaClient();

  const sufixo = randomUUID().slice(0, 8);
  const rotulo = String(opcoes.rotulo || 'e2e').replace(/[^a-z0-9-]/gi, '').slice(0, 16) || 'e2e';
  const login = `dono-ab-${rotulo}-${sufixo}`;
  const senhaHash = await gerarSenhaHash(SENHA_E2E_ABASTECIMENTO);
  const hoje = hojeEm(FUSO_E2E);

  return prisma.$transaction(async (tx) => {
    const cliente = await tx.cliente.create({ data: { codigo: `e2e-abast-${rotulo}-${sufixo}`, nome: `FAZENDA ABASTECIMENTO ${rotulo.toUpperCase()}` } });
    const c = cliente.id;
    const dono = await tx.usuario.create({ data: { cliente_id: c, nome: 'DONO DA FAZENDA', login, senha_hash: senhaHash, papel_tenant: 'administrador' } });
    const empresa = await tx.empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'SEDE', nome: 'FAZENDA SANTA LUZIA', fuso_horario: FUSO_E2E } });
    const retiro = await tx.empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'RETIRO', nome: 'RETIRO SÃO JOSÉ', fuso_horario: FUSO_E2E } });
    const base = { cliente_id: c, empresa_id: empresa.id };
    const local = await tx.localEstoque.create({ data: { cliente_id: c, numero_local: '1', nome: 'TANQUE DIESEL SEDE' } });
    const localKg = await tx.localEstoque.create({ data: { cliente_id: c, numero_local: '2', nome: 'DEPÓSITO DE GRANEL' } });
    const unidadeL = await tx.unidadeMedida.create({ data: { cliente_id: c, numero_unidade: '1', sigla: 'L', descricao: 'LITRO' } });
    const unidadeKg = await tx.unidadeMedida.create({ data: { cliente_id: c, numero_unidade: '2', sigla: 'KG', descricao: 'QUILOGRAMA' } });
    const unidadeSc = await tx.unidadeMedida.create({ data: { cliente_id: c, numero_unidade: '3', sigla: 'SC', descricao: 'SACO' } });
    const categoria = await tx.categoria.create({ data: { cliente_id: c, numero_categoria: '1', nome: 'COMBUSTÍVEIS E LUBRIFICANTES' } });
    const fornecedor = await tx.fornecedor.create({
      data: { ...base, numero_cadastro: '101', tipo_pessoa: 'Jurídica', nome: 'POSTO BOA VIAGEM', tipos: ['fornecedor'] },
    });
    const natureza = await tx.naturezaFinanceira.create({ data: { ...base, numero: '11', tipo: 'DESPESA', nome: 'COMBUSTÍVEIS' } });

    const loginVis = `vis-ab-${rotulo}-${sufixo}`;
    const vis = await tx.usuario.create({ data: { cliente_id: c, nome: 'VAQUEIRO SÓ CONSULTA', login: loginVis, senha_hash: senhaHash, papel_tenant: 'usuario' } });
    await tx.permissao.create({
      data: {
        cliente_id: c,
        user_email: loginVis,
        user_nome: vis.nome,
        is_admin: false,
        modulos_permitidos: ['patrimonio'],
        mobile_menu_ids: [],
        permissoes_telas: [linhaAbastecimentos({}), linhaTela(TELA_BENS, {})],
      },
    });

    return {
      cliente_id: c,
      hoje,
      usuario_id: dono.id,
      credenciais: { login, senha: SENHA_E2E_ABASTECIMENTO },
      usuarios: { vis: { id: vis.id, nome: vis.nome, credenciais: { login: loginVis, senha: SENHA_E2E_ABASTECIMENTO } } },
      empresa: { id: empresa.id, nome: empresa.nome, apelido: empresa.apelido, fuso: empresa.fuso_horario },
      retiro: { id: retiro.id, nome: retiro.nome, apelido: retiro.apelido },
      local: { id: local.id, nome: local.nome },
      localKg: { id: localKg.id, nome: localKg.nome },
      unidades: { L: { id: unidadeL.id, sigla: unidadeL.sigla }, KG: { id: unidadeKg.id, sigla: unidadeKg.sigla }, SC: { id: unidadeSc.id, sigla: unidadeSc.sigla } },
      categoria: { id: categoria.id, nome: categoria.nome },
      fornecedor: { id: fornecedor.id, nome: fornecedor.nome },
      natureza: { id: natureza.id, nome: natureza.nome },
    };
  });
};

/** `api(metodo, caminho, corpo)` → `{ status, corpo }` já autenticada. @typedef {(metodo: string, caminho: string, corpo?: unknown) => Promise<{ status: number, corpo: any }>} ApiDono */

const exigirStatus = (r, status, oque) => {
  if (r.status !== status) throw new Error(`${oque}: HTTP ${r.status} ${JSON.stringify(r.corpo).slice(0, 400)}`);
  return r.corpo;
};

/** Perfil financeiro da SEDE (a compra P3 exige país/moeda). @param {any} s @param {ApiDono} api */
export const definirPerfilFinanceiro = async (s, api) =>
  exigirStatus(await api('PUT', '/perfis-financeiros-empresa', { empresa_id: s.empresa.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }), 200, 'perfil financeiro da SEDE');

/**
 * Compra P3 confirmada de UM item de mercadoria (`unidade` = `L` ou `KG`, a do
 * Produto; `SACO` para Produto em sacos com peso por saco — o lote entra em
 * kg): lote + Entrada rotulada pela unidade de estoque + título a pagar.
 * @param {any} s @param {ApiDono} api
 * @param {{ produto_id: string, local_id: string, unidade: 'L'|'KG'|'SACO', quantidade: string, custo: string, dia: string, documento: string }} c
 */
export const comprarPelaP3 = async (s, api, c) => {
  const { Prisma } = await import('@prisma/client');
  const total = new Prisma.Decimal(c.quantidade).times(new Prisma.Decimal(c.custo)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
  const doc = {
    empresa_id: s.empresa.id,
    direcao: 'PAGAR',
    conteudo: 'COM_PRODUTOS',
    condicao: 'PRAZO',
    parceiro_id: s.fornecedor.id,
    documento_referencia: c.documento,
    data_emissao: c.dia,
    data_operacional: c.dia,
    efeito_fisico_confirmado: true,
    itens: [{ tipo_item: 'MERCADORIA', produto_id: c.produto_id, local_estoque_id: c.local_id, unidade: c.unidade, quantidade: c.quantidade, valor_unitario: c.custo }],
    rateio_modo: 'PERCENTUAL',
    rateios: [{ natureza_id: s.natureza.id, percentual: '100' }],
    parcelas: [{ vencimento: somarDias(s.hoje, 30), valor: total }],
    operation_id: opId('compra'),
  };
  const criada = exigirStatus(await api('POST', '/operacoes-financeiras', doc), 201, `compra P3 ${c.documento} (criar)`);
  return exigirStatus(
    await api('POST', `/operacoes-financeiras/${criada.id}/confirmar`, { empresa_id: s.empresa.id, operation_id: opId('confirma'), versao: criada.versao }),
    200,
    `compra P3 ${c.documento} (confirmar)`,
  );
};

/** As duas compras do diesel em L (vetor `fifo`). @param {any} s @param {ApiDono} api @param {string} produtoId */
export const comprarDieselEmLitros = async (s, api, produtoId) => {
  for (const l of COMPRAS_DIESEL) {
    await comprarPelaP3(s, api, { produto_id: produtoId, local_id: s.local.id, unidade: 'L', quantidade: l.quantidade, custo: l.custo, dia: somarDias(s.hoje, -l.diasAtras), documento: `NF-DIESEL-${l.chave}` });
  }
};

/**
 * Produto pela API (o mesmo corpo da tela de Produtos). SACO leva o peso por
 * saco (kg) e a unidade de medida SC.
 * @param {any} s @param {ApiDono} api @param {{ nome: string, codigo: string, unidade: 'L'|'KG'|'SACO', local: { nome: string }, pesoSacoKg?: string }} p
 */
export const criarProdutoPelaApi = async (s, api, p) =>
  exigirStatus(
    await api('POST', '/produtos', {
      empresa_id: s.empresa.id,
      nome_produto: p.nome,
      codigo_interno: p.codigo,
      categoria: s.categoria.nome,
      unidade_medida: p.unidade === 'L' ? 'L' : p.unidade === 'SACO' ? 'SC' : 'KG',
      local_estoque: p.local.nome,
      unidade_principal_estoque: p.unidade,
      ...(p.unidade === 'SACO' ? { peso_por_saco_kg: Number(p.pesoSacoKg ?? COMPRA_SACO.pesoSacoKg) } : {}),
      ativo: true,
    }),
    201,
    `produto ${p.nome}`,
  );

/**
 * Ids dos tipos do catálogo do tenant por código (D-PROD-163). A leitura de
 * `GET /patrimonio-tipos` GARANTE o catálogo padrão (uma família padrão por
 * natureza + os tipos padrão) antes de responder: a semente não instala nada.
 * @param {ApiDono} api @returns {Promise<Record<string, { id: string, natureza: string }>>}
 */
export const tiposPorCodigo = async (api) => {
  const pagina = exigirStatus(await api('GET', '/patrimonio-tipos?limit=100&ativo=true'), 200, 'tipos do catálogo (garantia do catálogo padrão)');
  return Object.fromEntries((pagina.items ?? []).map((t) => [t.codigo, { id: t.id, natureza: t.natureza }]));
};

/**
 * Semente do ensaio da tela de Abastecimentos (`e2e-abastecimentos-real.mjs`):
 * base + perfil + Produtos L ("DIESEL S10 GRANEL" e "DIESEL S10 ESTOQUE NOVO",
 * este para a troca de aceite A → B), KG ("DIESEL S500 GRANEL") e SACO
 * ("UREIA GRANULADA", 50 kg o saco) pela API, compras P3 (vetor `fifo` em L;
 * 200 kg; 60 L do Produto novo; 5 sacos = 250 kg), tipos do catálogo padrão
 * (garantido pela leitura) e, pela API de Bens (`natureza` + `tipo_id`, sem
 * `familia_id`): trator TP-02 (horímetro 1.520,5 h há 10 dias; tanque de 180 L
 * que aceita só o diesel S10 granel), trator TP-03 (tanque de 120 L que aceita
 * o Produto em KG e o Produto em SACO) e caminhonete UT-04 (tanque SEM Produto
 * aceito).
 * @param {any} s @param {ApiDono} api
 */
const semearPelaApi = async (s, api) => {
  await definirPerfilFinanceiro(s, api);
  const diesel = await criarProdutoPelaApi(s, api, { nome: 'DIESEL S10 GRANEL', codigo: 'DS10G', unidade: 'L', local: s.local });
  const dieselNovo = await criarProdutoPelaApi(s, api, { nome: 'DIESEL S10 ESTOQUE NOVO', codigo: 'DS10N', unidade: 'L', local: s.local });
  const granel = await criarProdutoPelaApi(s, api, { nome: 'DIESEL S500 GRANEL', codigo: 'DS500K', unidade: 'KG', local: s.localKg });
  const ureia = await criarProdutoPelaApi(s, api, { nome: 'UREIA GRANULADA', codigo: 'UREIA', unidade: 'SACO', local: s.localKg, pesoSacoKg: COMPRA_SACO.pesoSacoKg });
  await comprarDieselEmLitros(s, api, diesel.id);
  await comprarPelaP3(s, api, { produto_id: granel.id, local_id: s.localKg.id, unidade: 'KG', quantidade: COMPRA_KG.quantidade, custo: COMPRA_KG.custo, dia: somarDias(s.hoje, -COMPRA_KG.diasAtras), documento: 'NF-GRANEL-1' });
  await comprarPelaP3(s, api, { produto_id: dieselNovo.id, local_id: s.local.id, unidade: 'L', quantidade: '60.0000', custo: '6.0000', dia: somarDias(s.hoje, -5), documento: 'NF-DIESEL-NOVO' });
  await comprarPelaP3(s, api, { produto_id: ureia.id, local_id: s.localKg.id, unidade: 'SACO', quantidade: COMPRA_SACO.sacos, custo: COMPRA_SACO.custoSaco, dia: somarDias(s.hoje, -COMPRA_SACO.diasAtras), documento: 'NF-UREIA-1' });

  const tip = await tiposPorCodigo(api);
  for (const codigo of ['TRATOR_PNEUS', 'CAMINHONETE']) {
    if (!tip[codigo]) throw new Error(`tipo padrão ${codigo} ausente depois da garantia do catálogo`);
  }
  const bem = async (corpo, oque) => exigirStatus(await api('POST', '/bens-patrimoniais', { empresa_id: s.empresa.id, ...corpo }), 201, oque);
  const medidorHoras = (leitura) => ({ tipo: 'HORIMETRO', leitura_inicial: leitura, data_leitura: somarDias(s.hoje, -10) });
  const trator = await bem(
    {
      nome: 'Trator TP-02', natureza: 'MAQUINA', tipo_id: tip.TRATOR_PNEUS.id, codigo_frota: 'TP-02', marca: 'Valtra', modelo: 'A950', medidor: medidorHoras('1520.5'),
      tanques: [{ identificador: 'Tanque principal', capacidade_litros: '180', produto_ids: [diesel.id] }],
    },
    'trator TP-02',
  );
  const tratorKg = await bem(
    {
      nome: 'Trator TP-03', natureza: 'MAQUINA', tipo_id: tip.TRATOR_PNEUS.id, codigo_frota: 'TP-03', medidor: medidorHoras('800'),
      tanques: [{ identificador: 'Tanque único', capacidade_litros: '120', produto_ids: [granel.id, ureia.id] }],
    },
    'trator TP-03',
  );
  const caminhonete = await bem(
    {
      nome: 'Caminhonete UT-04', natureza: 'VEICULO', tipo_id: tip.CAMINHONETE.id, codigo_frota: 'UT-04',
      medidor: { tipo: 'ODOMETRO', leitura_inicial: '45300', data_leitura: somarDias(s.hoje, -10) },
      tanques: [{ identificador: 'Tanque único', capacidade_litros: '80', produto_ids: [] }],
    },
    'caminhonete UT-04',
  );
  const resumoBem = (b) => ({ id: b.id, numero: b.numero, codigo_frota: b.codigo_frota, nome: b.nome, tanque_id: b.tanques[0].id, versao: b.versao });
  return {
    ...s,
    produto: { id: diesel.id, nome: diesel.nome_produto },
    produtoNovo: { id: dieselNovo.id, nome: dieselNovo.nome_produto },
    produtoKg: { id: granel.id, nome: granel.nome_produto },
    produtoSaco: { id: ureia.id, nome: ureia.nome_produto },
    tipos: { TRATOR_PNEUS: tip.TRATOR_PNEUS.id, CAMINHONETE: tip.CAMINHONETE.id },
    trator: resumoBem(trator),
    tratorKg: resumoBem(tratorKg),
    caminhonete: resumoBem(caminhonete),
  };
};

/**
 * Semente completa do ensaio da tela de Abastecimentos. `api` (opcional) =
 * chamada autenticada à API REAL já no ar; sem ela, o app Fastify é montado em
 * processo (`app.inject`).
 * @param {{ rotulo?: string, api?: (token: string, metodo: string, caminho: string, corpo?: unknown) => Promise<{ status: number, corpo: any }>, login?: (cred: any) => Promise<string> }} [opcoes]
 */
export const semearAbastecimentoE2E = async (opcoes = {}) => {
  if (opcoes.api && opcoes.login) {
    const s = await semearBancoBase(opcoes);
    const token = await opcoes.login(s.credenciais);
    return semearPelaApi(s, (m, c, b) => /** @type {any} */ (opcoes.api)(token, m, `/api/native${c}`, b));
  }
  const s = await semearBancoBase(opcoes);
  const { construirApp } = await import('../../backend/src/app.js');
  const app = await construirApp({ logger: false });
  await app.ready();
  try {
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: s.credenciais });
    const token = r.json().token;
    if (r.statusCode !== 200 || !token) throw new Error(`login do dono falhou (${r.statusCode})`);
    return await semearPelaApi(s, async (metodo, caminho, corpo) => {
      const x = await app.inject({ method: metodo, url: caminho, headers: { authorization: `Bearer ${token}` }, ...(corpo !== undefined ? { payload: corpo } : {}) });
      return { status: x.statusCode, corpo: x.json() };
    });
  } finally {
    await app.close();
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // App em processo: a configuração do backend é lida no 1º import de um módulo dele.
  process.env.AUTH_SECRET ||= 'ci-only-ephemeral-signing-key';
  process.env.FRONTEND_ORIGINS ||= 'http://localhost:5173';
  const { closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
  try {
    const s = await semearAbastecimentoE2E({ rotulo: process.argv[2] });
    console.log(JSON.stringify(s, null, 2));
  } catch (erro) {
    console.error(`[e2e-abastecimentos-seed] ${erro.message}`);
    process.exitCode = 1;
  } finally {
    await closePrismaClient();
  }
}
