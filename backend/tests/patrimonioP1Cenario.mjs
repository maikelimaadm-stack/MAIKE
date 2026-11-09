/**
 * D-PROD-157 — cenário compartilhado dos testes da Patrimônio P1-01
 * (cadastros de Patrimônio e Frota). Não é arquivo de teste (sem `.test.`):
 * só monta tenants, contas por permissão, corpos de bens e fotografias.
 *
 * Tudo contra PostgreSQL real e HTTP autenticado (`app.inject`). O "hoje" da
 * fazenda é o do relógio de teste: o runner define `MAIKE_TESTE_AGORA` com este
 * mesmo instante; fixá-lo aqui deixa o arquivo determinístico também quando
 * rodado sozinho (só vale com NODE_ENV=test).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { autenticarNoApp, criarTenant } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

const AGORA = '2027-06-15T15:00:00.000Z';
/** Dia de AGORA em America/Sao_Paulo (12:00 local). */
export const HOJE = '2027-06-15';
process.env.MAIKE_TESTE_AGORA = AGORA;

export const FUSO = 'America/Sao_Paulo';
const MODULO = 'patrimonio';
export const TELAS = Object.freeze({
  bens: 'pat-bens-patrimoniais',
  familias: 'pat-familias-patrimoniais',
  tipos: 'pat-tipos-patrimoniais',
  perfis: 'pat-perfis-medicao',
  combustiveis: 'pat-combustiveis',
});
/** As 9 tabelas novas da migration `20261110100000_patrimonio_p1_01_cadastros`. */
export const TABELAS_PATRIMONIO = Object.freeze([
  'BemPatrimonial', 'FamiliaPatrimonial', 'MedicaoBem', 'PerfilMedicao', 'TanqueBem', 'TanqueBemCombustivel',
  'TipoCombustivel', 'TipoPatrimonial', 'TipoPatrimonialPerfil',
]);
export const MIGRATION_PATRIMONIO = '20261110100000_patrimonio_p1_01_cadastros';

export const prisma = () => getPrismaClient();

/** Cliente HTTP sobre `app.inject`. */
export const http = (app) => {
  const req = (metodo, url, token, payload) =>
    app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
  const ok = async (r, status = 200) => {
    const x = await r;
    assert.equal(x.statusCode, status, x.body);
    return x.json();
  };
  return { req, ok };
};

/** `[status, code, field, reason]` de uma resposta de erro. */
export const erro = (r) => {
  const c = r.json();
  return [r.statusCode, c.code, c.field ?? null, c.reason ?? null];
};
/** Corpo de erro sem o id de rastreio (o resto tem de ser idêntico entre casos). */
export const corpoErro = (r) => {
  const resto = { ...r.json() };
  delete resto.request_id;
  return resto;
};

/** Ações padrão de uma linha de permissão (mais a extra `inativar` do Patrimônio). */
const ACOES = Object.freeze(['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar', 'inativar']);
/** Linha de permissão da tela do Patrimônio com só as ações dadas ligadas. */
export const linha = (tela, acoes = {}) => ({ modulo_id: MODULO, tela_id: tela, ...Object.fromEntries(ACOES.map((a) => [a, false])), ...acoes });
export const tudo = (tela) => linha(tela, Object.fromEntries(ACOES.map((a) => [a, true])));

/** Tabelas do tenant (todo model com cliente_id): prova de "nada gravado". */
const MODELOS_DO_TENANT = Prisma.dmmf.datamodel.models
  .filter((m) => m.fields.some((f) => f.name === 'cliente_id'))
  .map((m) => m.name[0].toLowerCase() + m.name.slice(1));
const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);

/** Contagem de TODAS as tabelas do tenant. */
export const contagens = async (clienteId) => {
  const p = /** @type {any} */ (prisma());
  const out = [];
  for (const m of MODELOS_DO_TENANT) out.push(`${m}:${await p[m].count({ where: { cliente_id: clienteId } })}`);
  return out.join(',');
};

/** Linhas COMPLETAS das tabelas do Patrimônio e da auditoria do tenant. */
export const fotoPatrimonio = async (clienteIds) => {
  const p = /** @type {any} */ (prisma());
  const ids = Array.isArray(clienteIds) ? clienteIds : [clienteIds];
  const out = {};
  for (const t of [...TABELAS_PATRIMONIO, 'AuditLog']) {
    const m = t[0].toLowerCase() + t.slice(1);
    out[t] = await p[m].findMany({ where: { cliente_id: { in: ids } }, orderBy: { id: 'asc' } });
  }
  return JSON.stringify(out, replacer);
};

/**
 * Tudo FORA do Patrimônio: toda tabela do tenant (todo model com `cliente_id`,
 * o que cobre estoque e financeiro inteiros — Produto, LocalEstoque, Lote,
 * NaturezaFinanceira, PerfilFinanceiroEmpresa, CentroResultado, títulos...)
 * menos as 9 do Patrimônio, a auditoria e a sequência de números. Compare
 * antes/depois: uma tabela nova de estoque/financeiro entra sozinha.
 */
const FORA_DO_PATRIMONIO = Object.freeze(
  MODELOS_DO_TENANT.filter((m) => ![...TABELAS_PATRIMONIO, 'AuditLog', 'EntidadeCodigoSequencia'].some((t) => t[0].toLowerCase() + t.slice(1) === m))
);
/** As tabelas de estoque e financeiro que o cenário NUNCA preenche (contagem 0 antes de qualquer bem). */
export const ESTOQUE_FINANCEIRO_VAZIOS = Object.freeze([
  'produto', 'movimentacaoEstoque', 'estoqueLoteNota', 'operacaoFinanceira', 'operacaoFinanceiraItem', 'tituloFinanceiro', 'liquidacaoFinanceira', 'lote',
  'naturezaFinanceira', 'perfilFinanceiroEmpresa', 'localEstoque', 'centroResultado', 'centroCustoResultado',
]);

/** Contagem, por tabela, de tudo fora do Patrimônio no tenant: o cadastro do bem nunca toca estoque/financeiro. */
export const contagemForaDoPatrimonio = async (clienteId) => {
  const p = /** @type {any} */ (prisma());
  /** @type {Record<string, number>} */
  const out = {};
  for (const m of FORA_DO_PATRIMONIO) out[m] = await p[m].count({ where: { cliente_id: clienteId } });
  return out;
};

/** `{CODIGO: id}` de um catálogo do tenant. */
const porCodigo = async (delegado, clienteId) =>
  Object.fromEntries((await delegado.findMany({ where: { cliente_id: clienteId }, select: { id: true, codigo: true } })).map((r) => [r.codigo, r.id]));

/**
 * Tenant com 2 fazendas (E1, E2, ambas com fuso), o catálogo padrão instalado
 * pelo próprio endpoint, e por fazenda: parceiro ativo, parceiro inativo,
 * centro de custo e área. `conta(permissao)` cria um usuário do tenant e
 * devolve o token.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ fuso?: string|null, catalogo?: boolean }} [opcoes]
 */
export const montarPatrimonio = async (app, { fuso = FUSO, catalogo = true } = {}) => {
  const p = prisma();
  const { req } = http(app);
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const token = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const sufixo = randomUUID().slice(0, 6);
  const e1 = await p.empresa.create({ data: { cliente_id: c, numero_empresa: 1, fuso_horario: fuso, apelido: 'F1', nome: `Fazenda 1 ${sufixo}` } });
  const e2 = await p.empresa.create({ data: { cliente_id: c, numero_empresa: 2, fuso_horario: fuso, apelido: 'F2', nome: `Fazenda 2 ${sufixo}` } });
  if (catalogo) {
    const r = await req('POST', '/patrimonio-catalogo-padrao', token, {});
    assert.equal(r.statusCode, 200, r.body);
  }
  const fam = await porCodigo(p.familiaPatrimonial, c);
  const tip = await porCodigo(p.tipoPatrimonial, c);
  const per = await porCodigo(p.perfilMedicao, c);
  const comb = await porCodigo(p.tipoCombustivel, c);
  let n = 0;
  const parceiro = (empresa, nome, ativo = true) =>
    p.fornecedor.create({ data: { cliente_id: c, empresa_id: empresa.id, numero_cadastro: `P${(n += 1)}-${sufixo}`, tipo_pessoa: 'Jurídica', nome, ativo } });
  const centro = (empresa, nome, ativo = true) => p.centroCusto.create({ data: { cliente_id: c, empresa_id: empresa.id, numero: `CC${(n += 1)}-${sufixo}`, nome, ativo } });
  const area = async (empresa, nome, ativo = true) => {
    const setor = await p.setor.create({ data: { cliente_id: c, empresa_id: empresa.id, numero_setor: `S${(n += 1)}`, nome: `Setor ${nome}` } });
    return p.areaPastagem.create({
      data: { cliente_id: c, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: `A${(n += 1)}`, nome, tamanho_hectares: 10, ativo },
    });
  };
  const senhaHash = (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash;
  /**
   * Usuário do tenant com a permissão dada (`null` = sem linha de Permissão).
   * @param {Record<string, unknown>|null} permissao
   * @param {Record<string, unknown>} [extra]  campos do Usuario
   */
  const conta = async (permissao, extra = {}) => {
    const login = `pat-${randomUUID().slice(0, 8)}`;
    // O nome não contém o login: as provas de "login nunca sai" procuram o login na resposta.
    const nome = `Responsável ${randomUUID().slice(0, 6)}`;
    const u = await p.usuario.create({ data: { cliente_id: c, nome, login, senha_hash: senhaHash, papel_tenant: 'usuario', ...extra } });
    if (permissao) await p.permissao.create({ data: { cliente_id: c, user_email: login, user_nome: 'Op', ...permissao } });
    const auth = await autenticarNoApp(app, { login, senha: adm.credenciais.senha });
    return { id: u.id, login, nome, token: auth.corpo.token };
  };
  /** Conta com as linhas dadas no módulo do Patrimônio. */
  const contaCom = (...linhas) => conta({ modulos_permitidos: [MODULO], permissoes_telas: linhas });
  return {
    c,
    adm,
    token,
    e1,
    e2,
    fam,
    tip,
    per,
    comb,
    conta,
    contaCom,
    parceiro1: await parceiro(e1, 'Agropecuária Parceira'),
    parceiro1Inativo: await parceiro(e1, 'Parceiro Antigo', false),
    parceiro2: await parceiro(e2, 'Parceiro da Fazenda 2'),
    centro1: await centro(e1, 'Máquinas e frota'),
    centro2: await centro(e2, 'Frota da Fazenda 2'),
    area1: await area(e1, 'Retiro'),
    area2: await area(e2, 'Sede 2'),
  };
};

// ─── corpos dos bens do aceite do proprietário ──────────────────────────────

/** Cerca de arame de 1,25 km (= 1.250 m). */
export const corpoCerca = (s, extra = {}) => ({
  empresa_id: s.e1.id,
  nome: 'Cerca do retiro',
  familia_id: s.fam.BENFEITORIAS,
  tipo_id: s.tip.CERCA_ARAME,
  medicoes: [{ perfil_id: s.per.EXTENSAO, valor: '1.25', unidade: 'km' }],
  ...extra,
});

/** Curral de 0,5 ha (= 5.000 m², principal) para 200 cabeças. */
export const corpoCurral = (s, extra = {}) => ({
  empresa_id: s.e1.id,
  nome: 'Curral de manejo',
  familia_id: s.fam.BENFEITORIAS,
  tipo_id: s.tip.CURRAL,
  material: 'Madeira de lei',
  ano_conclusao: 2019,
  medicoes: [
    { perfil_id: s.per.AREA, valor: '0.5', unidade: 'ha', principal: true, rotulo: 'Área coberta' },
    { perfil_id: s.per.CAPACIDADE_ANIMAL, valor: '200', unidade: 'cab' },
  ],
  ...extra,
});

/** Reservatório de 20 m³ (= 20.000 L). */
export const corpoReservatorio = (s, extra = {}) => ({
  empresa_id: s.e1.id,
  nome: 'Reservatório da sede',
  familia_id: s.fam.BENFEITORIAS,
  tipo_id: s.tip.RESERVATORIO,
  medicoes: [{ perfil_id: s.per.VOLUME, valor: '20', unidade: 'm3' }],
  ...extra,
});

/** Trator TP-02: horímetro 1.520,5 h e tanque de 180 L de diesel S10. */
export const corpoTrator = (s, extra = {}) => ({
  empresa_id: s.e1.id,
  nome: 'Trator TP-02',
  familia_id: s.fam.MAQUINAS,
  tipo_id: s.tip.TRATOR_PNEUS,
  codigo_frota: ' tp-02 ',
  marca: 'Valtra',
  modelo: 'A950',
  ano_fabricacao: 2018,
  potencia_cv: '95',
  medidor: { tipo: 'HORIMETRO', leitura_inicial: '1520.5', data_leitura: '2027-06-01' },
  tanques: [{ identificador: 'Tanque principal', capacidade_litros: '180', combustivel_ids: [s.comb.DIESEL_S10] }],
  ...extra,
});

/** Caminhonete flex UT-04: odômetro e tanque único de 80 L (gasolina + etanol). */
export const corpoCaminhonete = (s, extra = {}) => ({
  empresa_id: s.e1.id,
  nome: 'Caminhonete UT-04',
  familia_id: s.fam.VEICULOS,
  tipo_id: s.tip.CAMINHONETE,
  codigo_frota: 'UT-04',
  placa: 'abc-1d23',
  placa_uf: 'sp',
  renavam: '12345678901',
  chassi: '9bwzzz377vt004251',
  medidor: { tipo: 'ODOMETRO', leitura_inicial: '35210', data_leitura: '2027-05-30' },
  tanques: [{ identificador: 'Tanque', capacidade_litros: '80', combustivel_ids: [s.comb.GASOLINA, s.comb.ETANOL] }],
  ...extra,
});

/** Roçadeira (implemento): sem motor, sem tanque, sem medidor. */
export const corpoImplemento = (s, extra = {}) => ({
  empresa_id: s.e1.id,
  nome: 'Roçadeira hidráulica',
  familia_id: s.fam.IMPLEMENTOS,
  tipo_id: s.tip.ROCADEIRA,
  numero_serie: 'RC-2020-778',
  compatibilidade: 'Tratores acima de 75 cv',
  ...extra,
});

/** Gerador (equipamento) sem medidor de uso. */
export const corpoGerador = (s, extra = {}) => ({
  empresa_id: s.e1.id,
  nome: 'Gerador da sede',
  familia_id: s.fam.EQUIPAMENTOS,
  tipo_id: s.tip.GERADOR,
  medidor: { tipo: 'SEM_MEDIDOR' },
  ...extra,
});
