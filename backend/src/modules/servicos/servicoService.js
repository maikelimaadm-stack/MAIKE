/**
 * Serviço (camada de negócio) do cadastro de SERVIÇOS da fazenda (D-PROD-204,
 * Fatia 4 do Lançamento de Atividades). Contrato:
 * `docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md` §2.
 *
 * Um serviço é o que um terceiro executa na atividade (ex.: "APLICAÇÃO AÉREA",
 * "FRETE"), medido na unidade do cadastro de Unidades de Medida existente, com
 * um centro de custo padrão opcional e um valor de referência que a tela usa
 * para preencher a linha de serviço. Não é contrato de serviço nem título.
 *
 * Regras:
 *  - tenant só de `auth_context` (R11); a fazenda vem do corpo/query e precisa
 *    ser DESTE tenant (`exigirEmpresaDoTenant`: outra ou inexistente → 404);
 *    a fazenda do registro é imutável;
 *  - nome em MAIÚSCULAS; `valor_referencia` opcional, texto decimal ≥ 0;
 *  - `unidade_medida_id` obrigatória: unidade ATIVA do cliente; outro tenant
 *    ou inexistente → 422 `SERVICO_REFERENCIA_INVALIDA` `nao_encontrado` (sem
 *    oráculo); inativa → `inativo`;
 *  - `centro_custo_padrao_id` opcional: centro ATIVO da MESMA fazenda; outra
 *    fazenda, outro tenant ou inexistente → `nao_encontrado`; inativo → `inativo`;
 *  - as referências só são conferidas quando MUDAM (manter a gravada não relê
 *    nada, mesmo que ela tenha ficado inativa depois);
 *  - número pela sequência atômica do tenant; SEM exclusão física (inativar e
 *    reativar); toda escrita audita na mesma transação.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { servicoNotFound, servicoReferenciaInvalida } from '../../shared/errors/AppError.js';
import { fkDoServicoNaEscrita } from '../../shared/errors/vinculoServico.js';
import { decodificarCursor, montarEnvelopeKeyset, normalizarLimite } from '../../shared/pagination/keysetCursor.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { CASAS_CUSTO, dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido, iso, textoDoCorpo } from '../gestao/gestaoComum.js';
import { termoDeBusca } from '../patrimonio/patrimonioComum.js';
import { ESCOPO_TENANT, reservarNumero } from '../sequencias/entidadeCodigoService.js';
import {
  atualizarServicoPorId,
  buscarServico,
  inserirServico,
  lerCentroCustoDaFazenda,
  lerUnidadeMedida,
  listarServicosPagina,
  travarServico,
} from './servicoRepository.js';

/** Decimais do corpo (texto; o `preValidation` da rota recusa número JSON). */
export const DECIMAIS_SERVICO = Object.freeze(['valor_referencia']);

const ENTIDADE = 'Servico';
const LARGURA_NOME = 255;

/** @param {unknown} v @returns {string|null} */
const t4 = (v) => (v === null || v === undefined ? null : dec(/** @type {any} */ (v)).toFixed(CASAS_CUSTO));

/** @param {any} u */
const unidadePublica = (u) => (u ? { id: u.id, sigla: u.sigla, descricao: u.descricao, ativo: u.ativo } : null);
/** @param {any} c */
const centroPublico = (c) => (c ? { id: c.id, numero: c.numero, nome: c.nome, ativo: c.ativo } : null);

/**
 * Forma pública (lista, detalhe, escrita). Ao lado de cada id de referência, o
 * resumo do cadastro apontado; na auditoria, `semResumo` tira os resumos.
 * @param {Record<string, any>} r
 */
export const comoServicoPublico = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  numero: r.numero,
  nome: r.nome,
  unidade_medida_id: r.unidade_medida_id,
  unidade_medida: unidadePublica(r.unidadeMedida),
  centro_custo_padrao_id: r.centro_custo_padrao_id ?? null,
  centro_custo_padrao: centroPublico(r.centroCustoPadrao),
  valor_referencia: t4(r.valor_referencia),
  ativo: r.ativo,
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

/** @param {ReturnType<typeof comoServicoPublico>} p */
const paraAuditoria = (p) => {
  const resto = { ...p };
  delete resto.unidade_medida;
  delete resto.centro_custo_padrao;
  return resto;
};

/** @param {unknown} v @param {string} campo @returns {string|null|undefined} */
const decimalDoCorpo = (v, campo) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string' || !/^\d{1,10}(\.\d{1,4})?$/.test(v)) {
    throw invalido(`${campo} deve ser texto decimal não negativo, com até 10 dígitos e 4 casas (ex.: "12.5")`, { field: campo, reason: 'formato' });
  }
  return dec(v).toFixed(CASAS_CUSTO);
};

/** @param {unknown} v @param {string} campo @param {boolean} anulavel @returns {string|null|undefined} */
const idDoCorpo = (v, campo, anulavel) => {
  if (v === undefined) return undefined;
  if (v === null) {
    if (anulavel) return null;
    throw invalido(`${campo} é obrigatório`, { field: campo });
  }
  if (typeof v !== 'string' || !v.trim()) throw invalido(`${campo} inválido`, { field: campo, reason: 'formato' });
  return v.trim();
};

/**
 * Campos editáveis do corpo, já normalizados (só os presentes).
 * @param {Record<string, unknown>} entrada
 */
const camposDe = (entrada) => {
  /** @type {Record<string, unknown>} */
  const campos = {};
  const nome = textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true, maiusculas: true });
  if (typeof nome === 'string' && [...nome].length > LARGURA_NOME) {
    throw invalido(`nome passa de ${LARGURA_NOME} caracteres depois de convertido para maiúsculas`, { field: 'nome', reason: 'tamanho_excedido' });
  }
  if (nome !== undefined) campos.nome = nome;
  const unidade = idDoCorpo(entrada.unidade_medida_id, 'unidade_medida_id', false);
  if (unidade !== undefined) campos.unidade_medida_id = unidade;
  const centro = idDoCorpo(entrada.centro_custo_padrao_id, 'centro_custo_padrao_id', true);
  if (centro !== undefined) campos.centro_custo_padrao_id = centro;
  const valor = decimalDoCorpo(entrada.valor_referencia, 'valor_referencia');
  if (valor !== undefined) campos.valor_referencia = valor;
  return campos;
};

/**
 * Confere as referências que MUDAM, na transação da escrita.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId @param {string} empresaId
 * @param {Record<string, unknown>} campos
 * @param {Record<string, any>|null} anterior
 */
const exigirReferencias = async (tx, clienteId, empresaId, campos, anterior) => {
  const unidadeId = campos.unidade_medida_id;
  if (typeof unidadeId === 'string' && unidadeId !== anterior?.unidade_medida_id) {
    const unidade = await lerUnidadeMedida(tx, clienteId, unidadeId);
    if (!unidade) throw servicoReferenciaInvalida('unidade_medida_id', 'nao_encontrado');
    if (!unidade.ativo) throw servicoReferenciaInvalida('unidade_medida_id', 'inativo');
  }
  const centroId = campos.centro_custo_padrao_id;
  if (typeof centroId === 'string' && centroId !== (anterior?.centro_custo_padrao_id ?? null)) {
    const centro = await lerCentroCustoDaFazenda(tx, clienteId, empresaId, centroId);
    if (!centro) throw servicoReferenciaInvalida('centro_custo_padrao_id', 'nao_encontrado');
    if (!centro.ativo) throw servicoReferenciaInvalida('centro_custo_padrao_id', 'inativo');
  }
};

/**
 * A FK composta é a rede do banco: a referência que sumiu entre a conferência e
 * a escrita vira o 422 `nao_encontrado` do campo, nunca o 403 genérico do P2003.
 * @template T @param {() => Promise<T>} fn @returns {Promise<T>}
 */
const comFkTraduzida = async (fn) => {
  try {
    return await fn();
  } catch (erro) {
    const fk = fkDoServicoNaEscrita(erro);
    if (fk) throw servicoReferenciaInvalida(/** @type {any} */ (fk.campo), 'nao_encontrado', { cause: erro });
    throw erro;
  }
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ empresa_id?: unknown, q?: unknown, ativo?: unknown, limit?: unknown, cursor?: unknown }} consulta
 */
export const listar = async (contexto, consulta = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, consulta.empresa_id);
  const limit = normalizarLimite(consulta.limit);
  const cursorBruto = typeof consulta.cursor === 'string' ? consulta.cursor : null;
  const cursor = cursorBruto ? decodificarCursor(cursorBruto) : null;
  if (cursorBruto && !cursor) throw invalido('cursor inválido', { field: 'cursor', reason: 'cursor_invalido' });
  let ativo = null;
  if (consulta.ativo === true || consulta.ativo === 'true') ativo = true;
  if (consulta.ativo === false || consulta.ativo === 'false') ativo = false;
  // Busca literal: `%` e `_` escapados (o `contains` do Prisma não os escapa).
  const q = termoDeBusca(consulta.q);
  const { registros, total } = await listarServicosPagina(auth.clienteId, empresaId, { q, ativo, limit, cursor });
  return montarEnvelopeKeyset({ registros, limit, total, mapItem: comoServicoPublico });
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {{ empresa_id?: unknown }} consulta
 */
export const obter = async (contexto, id, consulta = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, consulta.empresa_id);
  const registro = await buscarServico(auth.clienteId, empresaId, id);
  if (!registro) throw servicoNotFound();
  return comoServicoPublico(registro);
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const campos = camposDe(entrada);
  if (!campos.unidade_medida_id) throw invalido('unidade_medida_id é obrigatório', { field: 'unidade_medida_id' });

  return comFkTraduzida(() =>
    getPrismaClient().$transaction(async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
      await exigirReferencias(tx, auth.clienteId, empresaId, campos, null);
      const numero = await reservarNumero(tx, { clienteId: auth.clienteId, entidade: ENTIDADE, escopoTipo: ESCOPO_TENANT });
      const registro = await inserirServico(tx, {
        ...campos,
        cliente_id: auth.clienteId,
        empresa_id: empresaId,
        numero: String(numero),
        ativo: true,
      });
      const publico = comoServicoPublico(registro);
      await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: paraAuditoria(publico) }, tx);
      return publico;
    })
  );
};

/**
 * PATCH dos campos (sem `ativo`: inativar e reativar têm rota própria).
 * `centro_custo_padrao_id: null` tira o padrão.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {Record<string, unknown>} entrada
 */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const campos = camposDe(entrada);

  return comFkTraduzida(() =>
    getPrismaClient().$transaction(async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
      await travarServico(tx, auth.clienteId, id);
      const anterior = await buscarServico(auth.clienteId, empresaId, id, tx);
      if (!anterior) throw servicoNotFound();
      const antes = comoServicoPublico(anterior);
      const mudou = Object.keys(campos).filter((k) => campos[k] !== /** @type {any} */ (antes)[k]);
      if (!mudou.length) return antes;
      await exigirReferencias(tx, auth.clienteId, empresaId, campos, anterior);
      const dados = Object.fromEntries(mudou.map((k) => [k, campos[k]]));
      const registro = await atualizarServicoPorId(tx, auth.clienteId, id, dados);
      const publico = comoServicoPublico(registro);
      await registrarEvento(
        contexto,
        {
          acao: 'update',
          entidade: ENTIDADE,
          entidadeId: id,
          dadosAnteriores: paraAuditoria(antes),
          dadosNovos: { ...paraAuditoria(publico), campos_alterados: mudou },
        },
        tx
      );
      return publico;
    })
  );
};

/**
 * Inativar (`ativo = false`) ou reativar (`true`). Idempotente. Nada é apagado;
 * as linhas de serviço já lançadas ficam (o serviço inativo só não é oferecido
 * para linhas novas). Reativar não exige a unidade ativa: a referência gravada
 * fica como está.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {{ empresa_id?: unknown }} entrada
 * @param {boolean} ativo
 */
export const alterarSituacao = async (contexto, id, entrada, ativo) => {
  const auth = exigirAuthContext(contexto?.auth);
  return getPrismaClient().$transaction(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada?.empresa_id);
    await travarServico(tx, auth.clienteId, id);
    const anterior = await buscarServico(auth.clienteId, empresaId, id, tx);
    if (!anterior) throw servicoNotFound();
    if (anterior.ativo === ativo) return comoServicoPublico(anterior);
    const registro = await atualizarServicoPorId(tx, auth.clienteId, id, { ativo });
    const publico = comoServicoPublico(registro);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: ENTIDADE,
        entidadeId: id,
        dadosAnteriores: paraAuditoria(comoServicoPublico(anterior)),
        dadosNovos: { ...paraAuditoria(publico), comando: ativo ? 'reativar' : 'inativar' },
      },
      tx
    );
    return publico;
  });
};
