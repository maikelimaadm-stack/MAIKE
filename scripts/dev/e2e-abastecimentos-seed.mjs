#!/usr/bin/env node
/**
 * D-PROD-159 — semente do ensaio ponta a ponta REAL da tela Abastecimentos
 * (Patrimônio e Frota P1-02): tela real + backend Fastify real + PostgreSQL
 * LOCAL. Molde: `e2e-lancamentos-seed.mjs` (Central Única de Lançamentos).
 *
 * Cria UM tenant novo por chamada (código e logins com sufixo aleatório: nada
 * é apagado, nada colide com execuções anteriores):
 *   - pelo BANCO (o que nenhuma tela desta missão cria):
 *     - administrador real da fazenda (`papel_tenant = 'administrador'`, sem
 *       linha de Permissão: o caminho do dono) com senha conhecida;
 *     - empresa COM fuso `America/Sao_Paulo`;
 *     - produto "DIESEL S10 GRANEL" com estoque em KG e o local "TANQUE
 *       DIESEL SEDE" com estoque inicial coerente em DOIS lotes de custo
 *       distinto (50 kg a 5,2000/kg e 100 kg a 5,5000/kg — o vetor `fifo` de
 *       `tests/smoke/fixtures/abastecimentoVetores.json`), cada um com a sua
 *       Entrada, e `estoque_atual = 150`;
 *     - usuário comum (`papel_tenant = 'usuario'`) só com `visualizar` na tela
 *       `pat-abastecimentos` (as demais ações explícitas e falsas);
 *   - pela API REAL (os mesmos endpoints das telas do Patrimônio):
 *     - catálogo padrão do Patrimônio (`POST /patrimonio-catalogo-padrao`);
 *     - vínculo combustível × produto Diesel S10 → DIESEL S10 GRANEL (R2);
 *     - trator TP-02 com horímetro (1.520,5 h há 10 dias) e um tanque de
 *       180 L de diesel S10.
 *   O fator kg/L NÃO é semeado: o roteiro o configura PELA TELA.
 *
 * Decimais só como texto/`Prisma.Decimal` (nunca `Number`/float).
 * SÓ roda contra PostgreSQL local (mesma guarda do molde).
 *
 * Uso: DATABASE_URL=postgresql://postgres@localhost:5433/maike_e2e?host=/tmp \
 *        node scripts/dev/e2e-abastecimentos-seed.mjs [rotulo]
 * Sem backend no ar, a parte "pela API" usa o app Fastify em processo
 * (`app.inject`). Imprime o JSON da semente (ids e credenciais de TESTE).
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { exigirBancoLocal } from './e2e-lancamentos-seed.mjs';

export { exigirBancoLocal };

export const SENHA_E2E_ABASTECIMENTO = 'senha-e2e-abastecimentos-1';
export const TELA_ABASTECIMENTOS = 'pat-abastecimentos';
export const FUSO_E2E = 'America/Sao_Paulo';

/** Lotes iniciais do diesel (vetor `fifo`): kg e custo/kg em texto canônico. */
export const LOTES_DIESEL = Object.freeze([
  Object.freeze({ chave: 'A', kg: '50.0000', custo: '5.2000', diasAtras: 40, doc: 'NF-DIESEL-1' }),
  Object.freeze({ chave: 'B', kg: '100.0000', custo: '5.5000', diasAtras: 25, doc: 'NF-DIESEL-2' }),
]);

/** Dia de hoje no fuso da fazenda (AAAA-MM-DD). */
export const hojeEm = (fuso) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const somarDias = (d, n) => {
  const t = new Date(`${d}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

const ACOES = Object.freeze(['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar', 'cancelar', 'configurar_conversao']);
/** Linha da tela Abastecimentos com TODAS as ações explícitas (ausente = negado). */
export const linhaAbastecimentos = (acoes = {}) => ({
  modulo_id: 'patrimonio',
  tela_id: TELA_ABASTECIMENTOS,
  ...Object.fromEntries(ACOES.map((a) => [a, false])),
  visualizar: true,
  ...acoes,
});

/**
 * Parte do BANCO: tenant, dono, empresa, produto, local, lotes coerentes e o
 * usuário só-visualizar.
 * @param {{ rotulo?: string }} [opcoes]
 */
const semearBanco = async (opcoes = {}) => {
  exigirBancoLocal();
  const { Prisma } = await import('@prisma/client');
  const { getPrismaClient } = await import('../../backend/src/database/prismaClient.js');
  const { gerarSenhaHash } = await import('../../backend/src/modules/auth/authService.js');
  const { reservarNumero, ESCOPO_TENANT } = await import('../../backend/src/modules/sequencias/entidadeCodigoService.js');
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
    const base = { cliente_id: c, empresa_id: empresa.id };
    const local = await tx.localEstoque.create({ data: { cliente_id: c, numero_local: '1', nome: 'TANQUE DIESEL SEDE' } });
    const diesel = await tx.produto.create({
      data: { ...base, numero_produto: '1', nome_produto: 'DIESEL S10 GRANEL', unidade_principal_estoque: 'KG', unidade_medida: 'KG' },
    });

    const lotes = [];
    let saldo = new Prisma.Decimal(0);
    for (const l of LOTES_DIESEL) {
      const data = somarDias(hoje, -l.diasAtras);
      const kg = new Prisma.Decimal(l.kg);
      const numero = String(await reservarNumero(tx, { clienteId: c, entidade: 'MovimentacaoEstoque', escopoTipo: ESCOPO_TENANT }));
      const movimento = await tx.movimentacaoEstoque.create({
        data: {
          ...base,
          numero_movimentacao: numero,
          tipo_movimentacao: 'Entrada',
          tipo_detalhado: 'saldo_inicial',
          data_movimentacao: new Date(`${data}T12:00:00.000Z`),
          produto_id: diesel.id,
          produto_nome: diesel.nome_produto,
          quantidade: kg.toFixed(4),
          unidade_medida: 'KG',
          valor_unitario: l.custo,
          valor_total: kg.times(new Prisma.Decimal(l.custo)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4),
          local_estoque_destino: local.id,
          local_destino: local.nome,
          numero_documento: l.doc,
          data_documento: new Date(`${data}T00:00:00.000Z`),
          motivo_movimentacao: 'Saldo inicial do ensaio E2E de abastecimentos',
          saldo_antes: saldo.toFixed(4),
          saldo_depois: saldo.plus(kg).toFixed(4),
          usuario_responsavel: login,
          status: 'Ativa',
        },
      });
      saldo = saldo.plus(kg);
      const lote = await tx.estoqueLoteNota.create({
        data: {
          ...base,
          produto_id: diesel.id,
          produto_nome: diesel.nome_produto,
          local_estoque_id: local.id,
          local_estoque_nome: local.nome,
          numero_documento: l.doc,
          data_documento: new Date(`${data}T00:00:00.000Z`),
          custo_unitario: l.custo,
          quantidade_entrada: kg.toFixed(4),
          quantidade_disponivel: kg.toFixed(4),
          movimentacao_entrada_id: movimento.id,
          status: 'Disponivel',
        },
      });
      lotes.push({ chave: l.chave, id: lote.id, kg: l.kg, custo: l.custo, data, movimento_id: movimento.id });
    }
    await tx.produto.update({ where: { id: diesel.id }, data: { estoque_atual: saldo.toFixed(4) } });

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
        permissoes_telas: [linhaAbastecimentos({})],
      },
    });

    return {
      cliente_id: c,
      hoje,
      usuario_id: dono.id,
      credenciais: { login, senha: SENHA_E2E_ABASTECIMENTO },
      usuarios: { vis: { id: vis.id, nome: vis.nome, credenciais: { login: loginVis, senha: SENHA_E2E_ABASTECIMENTO } } },
      empresa: { id: empresa.id, nome: empresa.nome, apelido: empresa.apelido, fuso: empresa.fuso_horario },
      local: { id: local.id, nome: local.nome },
      produto: { id: diesel.id, nome: diesel.nome_produto },
      lotes,
    };
  });
};

/**
 * Parte da API REAL: catálogo, vínculo R2 e o trator TP-02.
 * `api(metodo, caminho, corpo)` → `{ status, corpo }` já autenticada como o dono.
 * @param {any} s @param {(metodo: string, caminho: string, corpo?: unknown) => Promise<{ status: number, corpo: any }>} api
 */
const semearPelaApi = async (s, api) => {
  const { getPrismaClient } = await import('../../backend/src/database/prismaClient.js');
  const prisma = getPrismaClient();
  const exigir = (r, status, oque) => {
    if (r.status !== status) throw new Error(`${oque}: HTTP ${r.status} ${JSON.stringify(r.corpo).slice(0, 300)}`);
    return r.corpo;
  };
  exigir(await api('POST', '/patrimonio-catalogo-padrao', {}), 200, 'catálogo padrão do Patrimônio');
  const porCodigo = async (delegado) =>
    Object.fromEntries((await delegado.findMany({ where: { cliente_id: s.cliente_id }, select: { id: true, codigo: true } })).map((r) => [r.codigo, r.id]));
  const fam = await porCodigo(prisma.familiaPatrimonial);
  const tip = await porCodigo(prisma.tipoPatrimonial);
  const comb = await porCodigo(prisma.tipoCombustivel);
  exigir(await api('POST', `/patrimonio-combustiveis/${comb.DIESEL_S10}/produtos`, { empresa_id: s.empresa.id, produto_id: s.produto.id }), 201, 'vínculo Diesel S10 × produto');
  const trator = exigir(
    await api('POST', '/bens-patrimoniais', {
      empresa_id: s.empresa.id,
      nome: 'Trator TP-02',
      familia_id: fam.MAQUINAS,
      tipo_id: tip.TRATOR_PNEUS,
      codigo_frota: 'TP-02',
      marca: 'Valtra',
      modelo: 'A950',
      medidor: { tipo: 'HORIMETRO', leitura_inicial: '1520.5', data_leitura: somarDias(s.hoje, -10) },
      tanques: [{ identificador: 'Tanque principal', capacidade_litros: '180', combustivel_ids: [comb.DIESEL_S10] }],
    }),
    201,
    'trator TP-02',
  );
  return {
    ...s,
    combustivel: { id: comb.DIESEL_S10, nome: 'Diesel S10' },
    trator: { id: trator.id, numero: trator.numero, codigo_frota: trator.codigo_frota, nome: trator.nome, tanque_id: trator.tanques[0].id, versao: trator.versao },
  };
};

/**
 * Semente completa. `api` (opcional) = chamada autenticada à API REAL já no ar;
 * sem ela, o app Fastify é montado em processo (`app.inject`).
 * @param {{ rotulo?: string, api?: (token: string, metodo: string, caminho: string, corpo?: unknown) => Promise<{ status: number, corpo: any }>, login?: (cred: any) => Promise<string> }} [opcoes]
 */
export const semearAbastecimentoE2E = async (opcoes = {}) => {
  if (opcoes.api && opcoes.login) {
    const s = await semearBanco(opcoes);
    const token = await opcoes.login(s.credenciais);
    return semearPelaApi(s, (m, c, b) => /** @type {any} */ (opcoes.api)(token, m, `/api/native${c}`, b));
  }
  const s = await semearBanco(opcoes);
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
