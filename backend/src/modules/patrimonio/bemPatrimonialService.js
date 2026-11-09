/**
 * D-PROD-156 — Bens patrimoniais (da EMPRESA): lista, detalhe, criação,
 * edição do agregado (medições, medidor e tanques) e prévia de depreciação.
 *
 * Regras:
 *  - `cliente_id` só da sessão; `empresa_id` (query ou corpo) é ESCOPO,
 *    validado no banco e imutável: bem de outra empresa, de outro tenant ou
 *    inexistente → o mesmo 404 `BEM_PATRIMONIAL_NAO_ENCONTRADO`;
 *  - `numero` pela sequência do tenant (`reservarNumero`, ESCOPO_TENANT) e
 *    `natureza` copiada da família: ambos IMUTÁVEIS;
 *  - `codigo_frota` (opcional) único por empresa: pré-checagem sob
 *    `travarEscopo('patrimonio:frota:<cli>:<emp>:<codigo>')` e o unique do
 *    banco como última barreira → 409 `BEM_CODIGO_FROTA_DUPLICADO`;
 *  - escrita numa transação, na ordem do A5: trava a linha do bem (PATCH) e
 *    confere a `versao` → lê família/tipo/perfis/combustíveis com FOR SHARE →
 *    mescla banco + corpo e valida TUDO sobre o estado final → medições →
 *    tanques → UPDATE com CAS da versão (uma vez por PATCH efetivo) →
 *    auditoria (allowlist, sem texto livre) na mesma transação;
 *  - PATCH sem mudança efetiva devolve o atual sem gravar, auditar nem
 *    incrementar a versão;
 *  - nada aqui toca estoque, financeiro, consumo ou contabilidade: a
 *    depreciação são PARÂMETROS e a prévia é simulação (§6).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento, registrarEventosEmLote } from '../auditoria/auditService.js';
import { texto } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, iso, travarEscopo } from '../gestao/gestaoComum.js';
import { hojeDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ESCOPO_TENANT, reservarNumero } from '../sequencias/entidadeCodigoService.js';
import {
  ESTADO_NOVO, REFERENCIAS_DO_TOPO, aquisicaoDoCorpo, decidirMedidor, depreciacaoDoCorpo, diferencas, escalaresDoCorpo, estadoDoRegistro,
  exigirCamposAplicaveis, exigirProprietarioCoerente, medidorDoEstado, paraGravacao, previaDoEstado, referenciaInvalida,
  validarAquisicaoEDepreciacao,
} from './bemPatrimonialRegras.js';
import { sincronizarMedicoes, sincronizarTanques, validarMedicoes, validarTanques } from './bemPatrimonialFilhos.js';
import { simularDepreciacaoLinear } from './depreciacaoLinear.js';
import { atualizarComVersao, comUnicosEstaveis, exigirVersao, lerAtivo, listarKeyset, termoDeBusca } from './patrimonioComum.js';
import { CAPACIDADES_POR_NATUREZA } from './patrimonioDominio.js';

export const ENTIDADE = 'BemPatrimonial';
/** Ação de auditoria da correção do cadastro do medidor (A2). */
export const ACAO_CORRIGIR_MEDIDOR = 'bem_patrimonial.corrigir_medidor';

const CASAS_MEDIDA = 4;
const CASAS_DINHEIRO = 2;
const CASAS_PERCENTUAL = 4;

export const naoEncontrado = () => new AppError('BEM_PATRIMONIAL_NAO_ENCONTRADO', 'bem patrimonial não encontrado nesta fazenda');
const frotaDuplicado = () =>
  new AppError('BEM_CODIGO_FROTA_DUPLICADO', 'já existe um bem com este código de frota nesta fazenda; nada foi gravado', {
    details: { field: 'codigo_frota', reason: 'codigo_frota_repetido' },
  });

/** Leitura completa do agregado (detalhe, auditoria e base do PATCH). */
const INCLUIR = Object.freeze({
  familia: { select: { id: true, codigo: true, nome: true, natureza: true, ativo: true } },
  tipo: { select: { id: true, codigo: true, nome: true, ativo: true } },
  proprietario: { select: { id: true, nome: true } },
  fornecedor: { select: { id: true, nome: true } },
  responsavel: { select: { id: true, nome: true } },
  centroCusto: { select: { id: true, numero: true, nome: true } },
  area: { select: { id: true, nome: true } },
  medicoes: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, perfil_id: true, rotulo: true, valor_informado: true, unidade_informada: true, valor_normalizado: true, unidade_canonica: true, principal: true,
      perfil: { select: { id: true, codigo: true, nome: true, dimensao: true, ativo: true } },
    },
  },
  tanques: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, identificador: true, capacidade_litros: true, observacao: true, ativo: true,
      combustiveis: { select: { combustivel_id: true, combustivel: { select: { id: true, codigo: true, nome: true, unidade: true, ativo: true } } } },
    },
  },
});

const buscar = (db, clienteId, empresaId, id) => db.bemPatrimonial.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, include: INCLUIR });

const ref = (r) => (r ? { id: r.id, nome: r.nome } : null);

/**
 * Detalhe (A13, forma FIXA): referências como objetos, medidor/aquisição/
 * depreciação em blocos (sem repetir as colunas planas), decimais em string
 * (medidas, leituras, capacidade e potência com 4 casas; dinheiro 2;
 * percentual 4), `consumo` sempre null neste slice.
 * @param {any} r  bem lido com `INCLUIR`
 */
export const comoBemPublico = (r) => {
  const e = estadoDoRegistro(r);
  const medicoes = [...r.medicoes].sort((a, b) => Number(b.principal === true) - Number(a.principal === true));
  return {
    id: r.id,
    empresa_id: r.empresa_id,
    numero: r.numero,
    codigo_frota: r.codigo_frota ?? null,
    nome: r.nome,
    natureza: r.natureza,
    ativo: r.ativo,
    versao: r.versao,
    created_date: iso(r.createdAt),
    updated_date: iso(r.updatedAt),
    familia: { id: r.familia.id, codigo: r.familia.codigo, nome: r.familia.nome, natureza: r.familia.natureza, ativo: r.familia.ativo },
    tipo: { id: r.tipo.id, codigo: r.tipo.codigo, nome: r.tipo.nome, ativo: r.tipo.ativo },
    propriedade: r.propriedade,
    proprietario: ref(r.proprietario),
    responsavel: ref(r.responsavel),
    centro_custo: r.centroCusto ? { id: r.centroCusto.id, numero: r.centroCusto.numero, nome: r.centroCusto.nome } : null,
    area: ref(r.area),
    localizacao_descricao: e.localizacao_descricao,
    marca: e.marca,
    modelo: e.modelo,
    ano_fabricacao: e.ano_fabricacao,
    ano_modelo: e.ano_modelo,
    numero_serie: e.numero_serie,
    chassi: e.chassi,
    placa: e.placa,
    placa_uf: e.placa_uf,
    renavam: e.renavam,
    potencia_cv: texto(r.potencia_cv, CASAS_MEDIDA),
    material: e.material,
    ano_conclusao: e.ano_conclusao,
    compatibilidade: e.compatibilidade,
    especificacoes: e.especificacoes,
    observacoes: e.observacoes,
    medidor: medidorDoEstado(e),
    medicoes: medicoes.map((m) => ({
      id: m.id,
      perfil: { id: m.perfil.id, codigo: m.perfil.codigo, nome: m.perfil.nome, dimensao: m.perfil.dimensao, ativo: m.perfil.ativo },
      rotulo: m.rotulo ?? null,
      valor_informado: texto(m.valor_informado, CASAS_MEDIDA),
      unidade_informada: m.unidade_informada,
      valor_normalizado: texto(m.valor_normalizado, CASAS_MEDIDA),
      unidade_canonica: m.unidade_canonica,
      principal: m.principal === true,
    })),
    tanques: r.tanques.map((t) => ({
      id: t.id,
      identificador: t.identificador,
      capacidade_litros: texto(t.capacidade_litros, CASAS_MEDIDA),
      observacao: t.observacao ?? null,
      ativo: t.ativo,
      combustiveis: t.combustiveis
        .map((v) => v.combustivel)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.id.localeCompare(b.id))
        .map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome, unidade: c.unidade, ativo: c.ativo })),
    })),
    aquisicao: {
      data_aquisicao: e.data_aquisicao,
      data_disponibilidade: e.data_disponibilidade,
      valor_aquisicao: texto(r.valor_aquisicao, CASAS_DINHEIRO),
      custo_incorporacao: texto(r.custo_incorporacao, CASAS_DINHEIRO),
      fornecedor: ref(r.fornecedor),
      documento_referencia: e.documento_referencia,
      garantia_ate: e.garantia_ate,
    },
    depreciacao: {
      depreciavel: r.depreciavel,
      metodo: e.depreciacao_metodo,
      vida_util_meses: e.vida_util_meses,
      residual_modo: e.residual_modo,
      valor_residual: texto(r.valor_residual, CASAS_DINHEIRO),
      residual_percentual: texto(r.residual_percentual, CASAS_PERCENTUAL),
      data_inicio_depreciacao: e.data_inicio_depreciacao,
      previa: previaDoEstado(e),
    },
    consumo: null,
  };
};

const SELECAO_RESUMO = Object.freeze({
  id: true, numero: true, codigo_frota: true, nome: true, natureza: true, propriedade: true, medidor_tipo: true, ativo: true, versao: true,
  createdAt: true, updatedAt: true, familia: { select: { id: true, nome: true } }, tipo: { select: { id: true, nome: true } },
});

/** Item da lista (resumo do §5). */
const comoResumo = (r) => ({
  id: r.id,
  numero: r.numero,
  codigo_frota: r.codigo_frota ?? null,
  nome: r.nome,
  natureza: r.natureza,
  familia: { id: r.familia.id, nome: r.familia.nome },
  tipo: { id: r.tipo.id, nome: r.tipo.nome },
  propriedade: r.propriedade,
  medidor_tipo: r.medidor_tipo ?? null,
  ativo: r.ativo,
  versao: r.versao,
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

/**
 * Auditoria por allowlist: ids, número, código de frota, classificação,
 * situação, medidor, sinal de depreciação e a forma das medições/tanques
 * (perfil, valor normalizado, combustíveis). Sem nome, descrições,
 * observações, rótulos, identificadores, documentos nem placa/chassi/renavam.
 * @param {any} r  bem lido com `INCLUIR`
 */
const paraAuditoria = (r) => {
  const e = estadoDoRegistro(r);
  return {
    id: r.id,
    empresa_id: r.empresa_id,
    numero: r.numero,
    codigo_frota: r.codigo_frota ?? null,
    natureza: r.natureza,
    familia_id: r.familia_id,
    tipo_id: r.tipo_id,
    propriedade: r.propriedade,
    proprietario_parceiro_id: e.proprietario_parceiro_id,
    fornecedor_parceiro_id: e.fornecedor_parceiro_id,
    responsavel_usuario_id: e.responsavel_usuario_id,
    centro_custo_id: e.centro_custo_id,
    area_id: e.area_id,
    ativo: r.ativo,
    versao: r.versao,
    medidor: medidorDoEstado(e),
    depreciavel: r.depreciavel,
    vida_util_meses: e.vida_util_meses,
    residual_modo: e.residual_modo,
    medicoes: r.medicoes.map((m) => ({
      id: m.id,
      perfil_id: m.perfil_id,
      valor_normalizado: texto(m.valor_normalizado, CASAS_MEDIDA),
      unidade_canonica: m.unidade_canonica,
      principal: m.principal === true,
    })),
    tanques: r.tanques.map((t) => ({
      id: t.id,
      ativo: t.ativo,
      capacidade_litros: texto(t.capacidade_litros, CASAS_MEDIDA),
      combustivel_ids: t.combustiveis.map((c) => c.combustivel_id).sort(),
    })),
  };
};

/** NOMES dos campos alterados (as colunas do medidor viram `medidor`). */
const nomesAlterados = (dados, mudouMedicoes, mudouTanques) => {
  const nomes = new Set(Object.keys(dados).map((c) => (c.startsWith('medidor_') ? 'medidor' : c)));
  if (mudouMedicoes) nomes.add('medicoes');
  if (mudouTanques) nomes.add('tanques');
  return [...nomes];
};

const transacao = (fn) => comUnicosEstaveis(() => emTransacao(TRANSACAO_CURTA, fn, {}, MENSAGEM_CONFLITO_SEM_CHAVE), { codigo_frota: frotaDuplicado });

/** "Hoje" da fazenda, lido uma vez por transação e só quando uma data do medidor precisa dele. */
const hojeDe = (tx, clienteId, empresaId) => {
  /** @type {string|null} */
  let dia = null;
  return async () => {
    dia ??= (await hojeDaEmpresa(tx, clienteId, empresaId)).hoje;
    return dia;
  };
};

// ─── referências ────────────────────────────────────────────────────────────

/**
 * Família e tipo lidos com FOR SHARE: a inativação concorrente espera esta
 * escrita (e esta escrita vê a inativação já confirmada).
 * @param {any} tx @param {string} clienteId @param {string} familiaId @param {string} tipoId
 */
const carregarClassificacao = async (tx, clienteId, familiaId, tipoId) => {
  await tx.$queryRaw`SELECT id FROM "FamiliaPatrimonial" WHERE cliente_id = ${clienteId} AND id = ${familiaId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "TipoPatrimonial" WHERE cliente_id = ${clienteId} AND id = ${tipoId} FOR SHARE`;
  const familia = await tx.familiaPatrimonial.findFirst({ where: { cliente_id: clienteId, id: familiaId }, select: { id: true, natureza: true, ativo: true } });
  const tipo = await tx.tipoPatrimonial.findFirst({ where: { cliente_id: clienteId, id: tipoId }, select: { id: true, familia_id: true, ativo: true } });
  return { familia, tipo };
};

/**
 * Classificação escolhida (criação) ou alterada (PATCH): família e tipo
 * existentes no tenant e ATIVOS quando novos, tipo da família; no PATCH a
 * natureza do bem nunca muda (família de outra natureza → 409, nada apagado).
 * @param {{ familia: any, tipo: any }} c
 * @param {{ naturezaDoBem?: string|null, familiaNova?: boolean, tipoNovo?: boolean }} [opcoes]
 */
const exigirClassificacao = ({ familia, tipo }, { naturezaDoBem = null, familiaNova = true, tipoNovo = true } = {}) => {
  if (!familia) throw referenciaInvalida('familia_id', 'inexistente', 'família patrimonial não encontrada');
  if (naturezaDoBem && familia.natureza !== naturezaDoBem) {
    throw new AppError('BEM_NATUREZA_IMUTAVEL', 'a natureza do bem não muda: escolha uma família da mesma natureza; nada foi gravado', {
      details: { field: 'familia_id', reason: 'natureza_diferente', natureza: naturezaDoBem, natureza_familia: familia.natureza },
    });
  }
  if (familiaNova && !familia.ativo) throw referenciaInvalida('familia_id', 'inativo', 'a família escolhida está inativa');
  if (!tipo) throw referenciaInvalida('tipo_id', 'inexistente', 'tipo patrimonial não encontrado');
  if (tipoNovo && !tipo.ativo) throw referenciaInvalida('tipo_id', 'inativo', 'o tipo escolhido está inativo');
  if (tipo.familia_id !== familia.id) {
    throw new AppError('BEM_TIPO_FAMILIA_INCOMPATIVEL', 'o tipo escolhido não pertence a esta família; nada foi gravado', {
      details: { field: 'tipo_id', reason: 'tipo_de_outra_familia' },
    });
  }
};

/** Mensagens das referências escalares (inexistente/inativo). */
const REFERENCIAS = Object.freeze({
  proprietario_parceiro_id: { field: 'proprietario_parceiro_id', inexistente: 'o parceiro proprietário não foi encontrado nesta fazenda', inativo: 'o parceiro proprietário está inativo' },
  responsavel_usuario_id: { field: 'responsavel_usuario_id', inexistente: 'o responsável não foi encontrado', inativo: 'o responsável está inativo' },
  centro_custo_id: { field: 'centro_custo_id', inexistente: 'o centro de custo não foi encontrado nesta fazenda', inativo: 'o centro de custo está inativo' },
  area_id: { field: 'area_id', inexistente: 'a área não foi encontrada nesta fazenda', inativo: 'a área está inativa' },
  fornecedor_parceiro_id: { field: 'aquisicao.fornecedor_parceiro_id', inexistente: 'o parceiro fornecedor não foi encontrado nesta fazenda', inativo: 'o parceiro fornecedor está inativo' },
});

/**
 * O parceiro (proprietário ou fornecedor) é lido FOR KEY SHARE — a mesma trava
 * que a FK pega no INSERT, só que antes: uma exclusão do parceiro em voo
 * termina primeiro e aqui ele já não existe (422 "inexistente", nunca o 403 da
 * FK); se este bem chega antes, a exclusão espera o commit e vê o vínculo.
 * @param {any} tx @param {string} clienteId @param {string} coluna @param {string} id @returns {Promise<{ empresa_id?: string, ativo: boolean }|null>}
 */
const lerReferencia = async (tx, clienteId, coluna, id) => {
  const where = { cliente_id: clienteId, id };
  if (coluna === 'responsavel_usuario_id') return tx.usuario.findFirst({ where, select: { ativo: true } });
  if (coluna === 'centro_custo_id') return tx.centroCusto.findFirst({ where, select: { empresa_id: true, ativo: true } });
  if (coluna === 'area_id') return tx.areaPastagem.findFirst({ where, select: { empresa_id: true, ativo: true } });
  const [parceiro] = /** @type {Array<{ empresa_id: string, ativo: boolean }>} */ (
    await tx.$queryRaw`SELECT empresa_id, ativo FROM "Fornecedor" WHERE cliente_id = ${clienteId} AND id = ${id} FOR KEY SHARE`
  );
  return parceiro ?? null;
};

/**
 * Parceiros, responsável, centro de custo e área INFORMADOS (criação) ou
 * ALTERADOS (PATCH): do tenant, da MESMA empresa do bem (o usuário é do
 * tenant) e ativos. Manter uma referência que depois foi inativada é permitido.
 * @param {any} tx @param {string} clienteId @param {string} empresaId
 * @param {Record<string, any>} estado  estado final
 * @param {Record<string, any>|null} anterior  estado gravado (PATCH) ou null
 */
const exigirReferencias = async (tx, clienteId, empresaId, estado, anterior) => {
  for (const coluna of [...REFERENCIAS_DO_TOPO, 'fornecedor_parceiro_id']) {
    const id = estado[coluna];
    if (!id || id === (anterior?.[coluna] ?? null)) continue;
    const { field, inexistente, inativo } = REFERENCIAS[coluna];
    const r = await lerReferencia(tx, clienteId, coluna, id);
    if (!r || (r.empresa_id !== undefined && r.empresa_id !== empresaId)) throw referenciaInvalida(field, 'inexistente', inexistente);
    if (!r.ativo) throw referenciaInvalida(field, 'inativo', inativo);
  }
};

/**
 * Código de frota livre na empresa, sob a trava do código (a corrida de dois
 * POST com o mesmo código termina em 201 + 409).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string|null} codigo @param {string|null} ignorarId
 */
const exigirCodigoFrotaLivre = async (tx, clienteId, empresaId, codigo, ignorarId) => {
  if (!codigo) return;
  await travarEscopo(tx, `patrimonio:frota:${clienteId}:${empresaId}:${codigo}`);
  const outro = await tx.bemPatrimonial.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, codigo_frota: codigo, ...(ignorarId ? { NOT: { id: ignorarId } } : {}) },
    select: { id: true },
  });
  if (outro) throw frotaDuplicado();
};

// ─── leitura ────────────────────────────────────────────────────────────────

/**
 * Lista keyset (createdAt desc, id desc) dos bens da empresa; `q` busca em
 * nome, número, código de frota, placa (com ou sem hífen) e número de série.
 */
export const listar = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  /** @type {Record<string, any>} */
  const where = { cliente_id: auth.clienteId, empresa_id: empresaId };
  const ativo = lerAtivo(query.ativo);
  if (ativo !== null) where.ativo = ativo;
  if (typeof query.familia_id === 'string' && query.familia_id) where.familia_id = query.familia_id;
  if (typeof query.tipo_id === 'string' && query.tipo_id) where.tipo_id = query.tipo_id;
  if (typeof query.natureza === 'string' && query.natureza) where.natureza = query.natureza;
  const q = termoDeBusca(query.q);
  const qPlaca = q.replace(/[\s-]/g, '');
  const busca = q
    ? [
        { nome: { contains: q, mode: 'insensitive' } },
        { numero: { contains: q } },
        { codigo_frota: { contains: q, mode: 'insensitive' } },
        ...(qPlaca ? [{ placa: { contains: qPlaca, mode: 'insensitive' } }] : []),
        { numero_serie: { contains: q, mode: 'insensitive' } },
      ]
    : [];
  return listarKeyset(prisma.bemPatrimonial, { where, busca, query, select: SELECAO_RESUMO, mapItem: comoResumo });
};

export const detalhar = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const r = await buscar(prisma, auth.clienteId, empresaId, id);
  if (!r) throw naoEncontrado();
  return comoBemPublico(r);
};

// ─── escrita ────────────────────────────────────────────────────────────────

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const corpo = escalaresDoCorpo(entrada);
  const aquisicao = aquisicaoDoCorpo(entrada.aquisicao);
  const depreciacao = depreciacaoDoCorpo(entrada.depreciacao);
  return transacao(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, entrada.empresa_id);
    // FOR KEY SHARE da fazenda (a trava que a FK do INSERT pegaria, só que
    // antes): uma exclusão da fazenda em voo termina primeiro → 404; se este
    // bem chega antes, a exclusão espera o commit e devolve 409 com o vínculo.
    const [empresaTravada] = /** @type {Array<{ id: string }>} */ (
      await tx.$queryRaw`SELECT id FROM "Empresa" WHERE cliente_id = ${cli} AND id = ${empresaId} FOR KEY SHARE`
    );
    if (!empresaTravada) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada neste tenant', { details: { field: 'empresa_id' } });
    const classificacao = await carregarClassificacao(tx, cli, entrada.familia_id, entrada.tipo_id);
    exigirClassificacao(classificacao);
    const natureza = classificacao.familia.natureza;
    exigirCamposAplicaveis(natureza, entrada);
    /** @type {Record<string, any>} */
    const estado = { ...ESTADO_NOVO, ...corpo, ...(aquisicao ?? {}), ...(depreciacao ?? {}), familia_id: classificacao.familia.id, tipo_id: classificacao.tipo.id };
    exigirProprietarioCoerente(estado);
    await exigirReferencias(tx, cli, empresaId, estado, null);
    const medidor = await decidirMedidor({ natureza, estado: ESTADO_NOVO, pedido: entrada.medidor, criacao: true, hoje: hojeDe(tx, cli, empresaId) });
    if (medidor.colunas) Object.assign(estado, medidor.colunas);
    const capacidades = CAPACIDADES_POR_NATUREZA[natureza];
    const medicoes = capacidades.medicoes ? await validarMedicoes(tx, cli, entrada.medicoes ?? [], []) : null;
    const tanques = capacidades.tanques ? await validarTanques(tx, cli, entrada.tanques ?? [], []) : null;
    validarAquisicaoEDepreciacao(estado);
    await exigirCodigoFrotaLivre(tx, cli, empresaId, estado.codigo_frota, null);
    const numero = String(await reservarNumero(tx, { clienteId: cli, entidade: ENTIDADE, escopoTipo: ESCOPO_TENANT }));
    const { id } = await tx.bemPatrimonial.create({
      data: { cliente_id: cli, empresa_id: empresaId, numero, natureza, ...paraGravacao(estado) },
      select: { id: true },
    });
    if (medicoes?.desejadas.length) await sincronizarMedicoes(tx, cli, id, medicoes.desejadas, []);
    if (tanques?.desejados.length) await sincronizarTanques(tx, cli, id, tanques.desejados, []);
    const r = await buscar(tx, cli, empresaId, id);
    await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: id, dadosNovos: paraAuditoria(r) }, tx);
    return comoBemPublico(r);
  });
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const corpo = escalaresDoCorpo(entrada);
  const aquisicao = aquisicaoDoCorpo(entrada.aquisicao);
  const depreciacao = depreciacaoDoCorpo(entrada.depreciacao);
  return transacao(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, entrada.empresa_id);
    const travado = /** @type {Array<{ id: string }>} */ (
      await tx.$queryRaw`SELECT id FROM "BemPatrimonial" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`
    );
    if (!travado.length) throw naoEncontrado();
    const atual = await buscar(tx, cli, empresaId, id);
    exigirVersao(atual, entrada.versao);
    const natureza = atual.natureza;
    const antes = estadoDoRegistro(atual);

    const familiaId = entrada.familia_id ?? atual.familia_id;
    const tipoId = entrada.tipo_id ?? atual.tipo_id;
    const familiaNova = familiaId !== atual.familia_id;
    const tipoNovo = tipoId !== atual.tipo_id;
    const classificacao = familiaNova || tipoNovo ? await carregarClassificacao(tx, cli, familiaId, tipoId) : { familia: atual.familia, tipo: atual.tipo };
    if (familiaNova || tipoNovo) exigirClassificacao(classificacao, { naturezaDoBem: natureza, familiaNova, tipoNovo });
    exigirCamposAplicaveis(natureza, entrada);

    /** @type {Record<string, any>} */
    const estado = { ...antes, ...corpo, ...(aquisicao ?? {}), ...(depreciacao ?? {}), familia_id: familiaId, tipo_id: tipoId };
    if (typeof entrada.ativo === 'boolean') estado.ativo = entrada.ativo;
    if (estado.ativo && !antes.ativo && (!classificacao.familia.ativo || !classificacao.tipo.ativo)) {
      throw new AppError('BEM_CLASSIFICACAO_INATIVA', 'o bem não é reativado com família ou tipo inativo: reative a classificação antes; nada foi gravado', {
        details: { field: !classificacao.familia.ativo ? 'familia_id' : 'tipo_id', reason: 'classificacao_inativa' },
      });
    }
    exigirProprietarioCoerente(estado);
    await exigirReferencias(tx, cli, empresaId, estado, antes);
    const medidor = await decidirMedidor({ natureza, estado: antes, pedido: entrada.medidor, criacao: false, hoje: hojeDe(tx, cli, empresaId) });
    if (medidor.colunas) Object.assign(estado, medidor.colunas);
    const capacidades = CAPACIDADES_POR_NATUREZA[natureza];
    const medicoes = capacidades.medicoes && entrada.medicoes !== undefined ? await validarMedicoes(tx, cli, entrada.medicoes, atual.medicoes) : null;
    const tanques = capacidades.tanques && entrada.tanques !== undefined ? await validarTanques(tx, cli, entrada.tanques, atual.tanques) : null;
    validarAquisicaoEDepreciacao(estado);

    const dados = diferencas(antes, estado);
    const mudouMedicoes = medicoes?.mudou === true;
    const mudouTanques = tanques?.mudou === true;
    if (!Object.keys(dados).length && !mudouMedicoes && !mudouTanques) return comoBemPublico(atual);
    if ('codigo_frota' in dados) await exigirCodigoFrotaLivre(tx, cli, empresaId, dados.codigo_frota, id);
    if (mudouMedicoes) await sincronizarMedicoes(tx, cli, id, medicoes.desejadas, atual.medicoes);
    if (mudouTanques) await sincronizarTanques(tx, cli, id, tanques.desejados, atual.tanques);
    await atualizarComVersao(tx.bemPatrimonial, { clienteId: cli, id, versao: entrada.versao, data: paraGravacao(dados) });
    const depois = await buscar(tx, cli, empresaId, id);
    /** @type {Array<{ acao: string, entidade: string, entidadeId: string, dadosAnteriores: unknown, dadosNovos: unknown }>} */
    const eventos = [
      {
        acao: 'update',
        entidade: ENTIDADE,
        entidadeId: id,
        dadosAnteriores: paraAuditoria(atual),
        dadosNovos: { ...paraAuditoria(depois), campos_alterados: nomesAlterados(dados, mudouMedicoes, mudouTanques) },
      },
    ];
    if (medidor.correcao) {
      eventos.push({
        acao: ACAO_CORRIGIR_MEDIDOR,
        entidade: ENTIDADE,
        entidadeId: id,
        dadosAnteriores: { medidor: medidorDoEstado(antes) },
        dadosNovos: { medidor: medidorDoEstado(estadoDoRegistro(depois)) },
      });
    }
    await registrarEventosEmLote(contexto, eventos, tx);
    return comoBemPublico(depois);
  });
};

/**
 * Prévia gerencial de depreciação linear (§6): SÓ cálculo — confere a
 * empresa do tenant e não grava nada (nenhuma tabela muda).
 */
export const previaDepreciacao = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  await exigirEmpresaDoTenant(getPrismaClient(), auth.clienteId, entrada.empresa_id);
  return simularDepreciacaoLinear({
    valor_aquisicao: entrada.valor_aquisicao,
    custo_incorporacao: entrada.custo_incorporacao ?? null,
    residual_modo: entrada.residual_modo,
    valor_residual: entrada.valor_residual ?? null,
    residual_percentual: entrada.residual_percentual ?? null,
    vida_util_meses: entrada.vida_util_meses,
    data_inicio_depreciacao: entrada.data_inicio_depreciacao,
  });
};
