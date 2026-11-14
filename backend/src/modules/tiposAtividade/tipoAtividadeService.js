/**
 * Serviço de TipoAtividade (D-PROD-182).
 *
 * Espelho do serviço de TipoTarefa (D-PROD-45), sem o que é específico de
 * LancamentoTarefa: não há propagação de nome (a atividade guarda o nome do
 * tipo como snapshot, D-PROD-190/198). O nome do grupo fica em cache em
 * `grupo_atividade_nome` e é renovado quando o grupo do tipo muda.
 *
 * D-PROD-190 / D-PROD-199 — o tipo usado numa atividade não é excluído: quem
 * barra é a FK RESTRICT da tabela `Atividade` (este módulo NUNCA consulta
 * `Atividade`, lição do hotfix #259), reconhecida pelo nome da FK
 * (`shared/errors/vinculoAtividade.js`) e traduzida aqui em 409
 * `TIPO_ATIVIDADE_DELETE_BLOCKED`.
 *
 * D-PROD-197 — PADRÕES e FLAGS do tipo (contrato
 * `docs/engineering/MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md` §3):
 *  - categoria (lista fechada), centro de custo e centro de resultado padrão,
 *    unidade de produção (`UnidadeMedida`) e coeficiente padrão (Decimal(14,4):
 *    texto na entrada, 4 casas na resposta), e as 8 flags de como a atividade
 *    funciona (ausente no POST = false; padrão ausente = null);
 *  - regras conferidas SÓ quando o padrão MUDA (valor diferente do gravado; no
 *    POST, quando vem não nulo), dentro da transação da escrita: centro e
 *    unidade existem NO tenant (id de outro tenant é `nao_encontrado`, como o
 *    inexistente: sem oráculo) e estão ativos; os dois centros, quando ambos
 *    ficam preenchidos, são da mesma fazenda (conferido sempre que um dos dois
 *    muda); coeficiente > 0. Recusa: 422 `TIPO_ATIVIDADE_PADRAO_INVALIDO`
 *    (`field`/`reason`). Padrão que fica inativo DEPOIS de gravado continua no
 *    tipo: não é apagado nem revalidado num PATCH que não o muda;
 *  - a FK composta é a rede do banco: um cadastro que sumiu entre a conferência
 *    e a escrita (P2003 da FK nova) vira o mesmo 422 `nao_encontrado` do campo,
 *    nunca o 403 genérico do P2003;
 *  - opções de centro para o formulário (`opcoesCentrosPadrao`): só os ATIVOS
 *    da fazenda informada (conferida no tenant da sessão), por número, até o
 *    teto de ativos por empresa da gestão.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { dec } from '../financeiro/decimalFinanceiro.js';
import { MAX_ATIVOS_POR_EMPRESA } from '../gestao/centroService.js';
import { exigirEmpresaDoTenant, invalido } from '../gestao/gestaoComum.js';
import { buscarGrupo } from '../gruposAtividade/grupoAtividadeRepository.js';
import {
  tipoAtividadeNotFound,
  tipoAtividadeNomeConflito,
  tipoAtividadeDeleteBlocked,
  tipoAtividadePadraoInvalido,
  grupoAtividadeNotFound,
} from '../../shared/errors/AppError.js';
import { vinculoComAtividade } from '../../shared/errors/vinculoAtividade.js';
import { fkDoPadraoNaEscrita } from '../../shared/errors/vinculoTipoAtividadePadrao.js';
import {
  listarTipos,
  buscarTipo,
  existeTipoComNomeNoGrupo,
  inserirTipo,
  atualizarTipoPorId,
  excluirTipoPorId,
  lerCentroPadrao,
  lerUnidadePadrao,
  listarCentrosAtivosDaEmpresa,
} from './tipoAtividadeRepository.js';
import {
  CASAS_COEFICIENTE,
  CATEGORIAS_TIPO_ATIVIDADE,
  FLAGS_TIPO_ATIVIDADE,
  PADRAO_COEFICIENTE,
} from './tipoAtividadePadroes.js';

const tem = (obj, chave) => Object.prototype.hasOwnProperty.call(obj, chave);

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

/** Mesmo normalizador do Tipo de Tarefa: o nome é gravado em MAIÚSCULAS. */
const normalizarNomeTipo = (valor) => {
  const limpo = textoOuNulo(valor);
  if (limpo === undefined || limpo === null) return limpo;
  return limpo.toUpperCase();
};

// ─── D-PROD-197: normalização dos padrões e das flags ───────────────────────

/** Categoria da lista fechada ou null (o schema da rota já recusou o resto). @param {unknown} v */
const categoriaDoCorpo = (v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string' || !CATEGORIAS_TIPO_ATIVIDADE.includes(v)) {
    throw invalido(`categoria deve ser uma de ${CATEGORIAS_TIPO_ATIVIDADE.join(', ')} (ou null)`, { field: 'categoria', reason: 'categoria_invalida' });
  }
  return v;
};

/** Id de cadastro apontado ou null (null limpa o padrão). @param {unknown} v @param {string} campo */
const idDoPadrao = (v, campo) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string' || !v.trim()) throw invalido(`${campo} inválido`, { field: campo, reason: 'formato' });
  return v.trim();
};

/** Coeficiente como TEXTO decimal (nunca número), gravado com 4 casas; zero é regra do serviço (422). @param {unknown} v */
const coeficienteDoCorpo = (v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string' || !PADRAO_COEFICIENTE.test(v)) {
    throw invalido('coeficiente_padrao deve ser texto decimal com até 10 dígitos inteiros e 4 casas (ex.: "1.5"), nunca número', {
      field: 'coeficiente_padrao',
      reason: 'formato',
    });
  }
  return dec(v).toFixed(CASAS_COEFICIENTE);
};

/** Flag: só booleano de verdade (a rota recusa o resto ANTES da coerção do AJV). @param {unknown} v @param {string} flag */
const flagDoCorpo = (v, flag) => {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw invalido(`${flag} deve ser true ou false`, { field: flag, reason: 'valor_deve_ser_booleano' });
  return v;
};

/** Coeficiente gravado (Decimal do Prisma) → texto com 4 casas, ou null. @param {unknown} v */
const coeficienteComQuatroCasas = (v) => (v === null || v === undefined ? null : dec(v).toFixed(CASAS_COEFICIENTE));

/** @param {any} c */
const centroPadraoPublico = (c) =>
  c ? { id: c.id, numero: c.numero, nome: c.nome, empresa_id: c.empresa_id, ativo: c.ativo } : null;

/** @param {any} u */
const unidadeProducaoPublica = (u) => (u ? { id: u.id, sigla: u.sigla, descricao: u.descricao, ativo: u.ativo } : null);

/**
 * Forma pública (lista, detalhe, escrita e auditoria). D-PROD-197: ao lado de
 * cada id de padrão, o resumo do cadastro (do `select` do repository; `null`
 * sem padrão); coeficiente com 4 casas; as 8 flags booleanas.
 * @param {Record<string, any>} registro
 */
export const comoTipoPublico = (registro) => ({
  id: registro.id,
  nome_tipo: registro.nome_tipo,
  grupo_atividade_id: registro.grupo_atividade_id,
  grupo_atividade_nome: registro.grupo_atividade_nome,
  ativo: registro.ativo,
  descricao: registro.descricao ?? null,
  categoria: registro.categoria ?? null,
  centro_custo_padrao_id: registro.centro_custo_padrao_id ?? null,
  centro_custo_padrao: centroPadraoPublico(registro.centroCustoPadrao),
  centro_resultado_padrao_id: registro.centro_resultado_padrao_id ?? null,
  centro_resultado_padrao: centroPadraoPublico(registro.centroResultadoPadrao),
  unidade_producao_id: registro.unidade_producao_id ?? null,
  unidade_producao: unidadeProducaoPublica(registro.unidadeProducao),
  coeficiente_padrao: coeficienteComQuatroCasas(registro.coeficiente_padrao),
  ...Object.fromEntries(FLAGS_TIPO_ATIVIDADE.map((flag) => [flag, registro[flag] === true])),
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

/** @type {Readonly<Record<string, (v: unknown) => unknown>>} */
const CAMPOS_EDITAVEIS = Object.freeze({
  nome_tipo: (v) => normalizarNomeTipo(v),
  grupo_atividade_id: (v) => textoOuNulo(v),
  ativo: (v) => (v === undefined ? undefined : Boolean(v)),
  descricao: (v) => textoOuNulo(v),
  // D-PROD-197 — padrões e flags.
  categoria: (v) => categoriaDoCorpo(v),
  centro_custo_padrao_id: (v) => idDoPadrao(v, 'centro_custo_padrao_id'),
  centro_resultado_padrao_id: (v) => idDoPadrao(v, 'centro_resultado_padrao_id'),
  unidade_producao_id: (v) => idDoPadrao(v, 'unidade_producao_id'),
  coeficiente_padrao: (v) => coeficienteDoCorpo(v),
  ...Object.fromEntries(FLAGS_TIPO_ATIVIDADE.map((flag) => [flag, (v) => flagDoCorpo(v, flag)])),
});

/** @param {Record<string, unknown>} entrada */
const camposDe = (entrada) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const [campo, tratar] of Object.entries(CAMPOS_EDITAVEIS)) {
    if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
    const valor = tratar(entrada[campo]);
    if (valor !== undefined) saida[campo] = valor;
  }
  return saida;
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} grupoId
 */
const resolverGrupo = async (tx, clienteId, grupoId) => {
  const grupo = await buscarGrupo(clienteId, grupoId, tx);
  if (!grupo) throw grupoAtividadeNotFound();
  return grupo;
};

// ─── D-PROD-197: regras dos padrões (§3.3) ──────────────────────────────────

/** Os dois centros padrão: coluna do tipo, lado do cadastro e relação incluída pelo repository. */
const CENTROS_PADRAO = Object.freeze([
  Object.freeze({ campo: 'centro_custo_padrao_id', lado: /** @type {'custo'} */ ('custo'), relacao: 'centroCustoPadrao' }),
  Object.freeze({ campo: 'centro_resultado_padrao_id', lado: /** @type {'resultado'} */ ('resultado'), relacao: 'centroResultadoPadrao' }),
]);

/**
 * Valor GRAVADO de um padrão, na forma do corpo normalizado (null = sem padrão).
 * @param {Record<string, any>|null} anterior @param {string} campo
 */
const padraoGravado = (anterior, campo) => {
  if (!anterior) return null;
  if (campo === 'coeficiente_padrao') return coeficienteComQuatroCasas(anterior.coeficiente_padrao);
  return anterior[campo] ?? null;
};

/**
 * §3.3 — confere os padrões que MUDAM (no POST, `anterior` = null: os que vêm
 * não nulos), na transação da escrita. Limpar (null) não confere nada; manter
 * o gravado não relê nada (mesmo que ele tenha ficado inativo depois).
 * @param {any} tx @param {string} clienteId
 * @param {Record<string, unknown>} campos  corpo normalizado (só os presentes)
 * @param {Record<string, any>|null} anterior  registro gravado (edição) ou null
 */
const exigirPadroes = async (tx, clienteId, campos, anterior) => {
  const muda = (campo) => tem(campos, campo) && campos[campo] !== padraoGravado(anterior, campo);
  const novo = (campo) => muda(campo) && campos[campo] !== null;
  const final = (campo) => (tem(campos, campo) ? campos[campo] : padraoGravado(anterior, campo));

  /** @type {Record<string, { empresa_id: string, ativo: boolean }>} */
  const lidos = {};
  for (const { campo, lado } of CENTROS_PADRAO) {
    if (!novo(campo)) continue;
    const centro = await lerCentroPadrao(tx, lado, clienteId, String(campos[campo]));
    if (!centro) throw tipoAtividadePadraoInvalido(/** @type {any} */ (campo), 'nao_encontrado');
    if (!centro.ativo) throw tipoAtividadePadraoInvalido(/** @type {any} */ (campo), 'inativo');
    lidos[campo] = centro;
  }

  // Mesma fazenda: sempre que um dos dois muda e os dois ficam preenchidos.
  if (CENTROS_PADRAO.some(({ campo }) => muda(campo)) && CENTROS_PADRAO.every(({ campo }) => final(campo) !== null)) {
    const empresas = [];
    for (const { campo, lado, relacao } of CENTROS_PADRAO) {
      const centro =
        lidos[campo] ??
        (anterior?.[relacao] && anterior[relacao].id === final(campo) ? anterior[relacao] : null) ??
        (await lerCentroPadrao(tx, lado, clienteId, String(final(campo))));
      empresas.push(centro?.empresa_id ?? null);
    }
    if (empresas[0] !== empresas[1]) throw tipoAtividadePadraoInvalido('centro_resultado_padrao_id', 'empresas_diferentes');
  }

  if (novo('unidade_producao_id')) {
    const unidade = await lerUnidadePadrao(tx, clienteId, String(campos.unidade_producao_id));
    if (!unidade) throw tipoAtividadePadraoInvalido('unidade_producao_id', 'nao_encontrado');
    if (!unidade.ativo) throw tipoAtividadePadraoInvalido('unidade_producao_id', 'inativo');
  }

  if (novo('coeficiente_padrao') && !dec(/** @type {string} */ (campos.coeficiente_padrao)).gt(0)) {
    throw tipoAtividadePadraoInvalido('coeficiente_padrao', 'nao_positivo');
  }
};

/**
 * Escrita no tipo. A FK composta de cada padrão é a rede do banco: o centro ou
 * a unidade que sumiu entre a conferência e o INSERT/UPDATE (corrida) vira o
 * 422 `nao_encontrado` da coluna, nunca o 403 genérico do P2003.
 * @template T @param {() => Promise<T>} fn @returns {Promise<T>}
 */
const comFkDoPadraoTraduzida = async (fn) => {
  try {
    return await fn();
  } catch (erro) {
    const fk = fkDoPadraoNaEscrita(erro);
    if (fk) throw tipoAtividadePadraoInvalido(/** @type {any} */ (fk.campo), 'nao_encontrado', { cause: erro });
    throw erro;
  }
};

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarTipos(auth.clienteId);
  return registros.map(comoTipoPublico);
};

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id */
export const obter = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registro = await buscarTipo(auth.clienteId, id);
  if (!registro) throw tipoAtividadeNotFound();
  return comoTipoPublico(registro);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);

  const criado = await prisma.$transaction(async (tx) => {
    const grupoId = String(campos.grupo_atividade_id);
    const grupo = await resolverGrupo(tx, auth.clienteId, grupoId);
    const nome = String(campos.nome_tipo);

    if (await existeTipoComNomeNoGrupo(auth.clienteId, grupoId, nome, undefined, tx)) {
      throw tipoAtividadeNomeConflito();
    }

    await exigirPadroes(tx, auth.clienteId, campos, null);

    const registro = await comFkDoPadraoTraduzida(() =>
      inserirTipo(tx, {
        ...campos,
        cliente_id: auth.clienteId,
        grupo_atividade_id: grupoId,
        grupo_atividade_nome: grupo.nome_grupo,
      })
    );

    const publico = comoTipoPublico(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'create',
        entidade: 'TipoAtividade',
        entidadeId: registro.id,
        dadosNovos: publico,
      },
      tx
    );

    return publico;
  });

  return criado;
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id @param {Record<string, unknown>} entrada */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    // D-PROD-197 (revisão A5-1/A6-1): trava a linha ANTES de ler `anterior`. Sem a trava, dois PATCH
    // concorrentes que mudam um centro cada leem o par antigo e burlam a regra "mesma empresa" (§3.3);
    // com ela, o segundo espera, relê o par já gravado (READ COMMITTED) e recebe 422 `empresas_diferentes`.
    // Tipo inexistente (ou de outro cliente) não trava nada e segue para o 404 de sempre.
    await tx.$queryRaw`SELECT id FROM "TipoAtividade" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR UPDATE`;
    const anterior = await buscarTipo(auth.clienteId, id, tx);
    if (!anterior) throw tipoAtividadeNotFound();

    const campos = camposDe(entrada);
    const grupoId = String(campos.grupo_atividade_id ?? anterior.grupo_atividade_id);
    let nomeGrupo = anterior.grupo_atividade_nome;

    if (campos.grupo_atividade_id && campos.grupo_atividade_id !== anterior.grupo_atividade_id) {
      const grupo = await resolverGrupo(tx, auth.clienteId, grupoId);
      nomeGrupo = grupo.nome_grupo;
    }
    if (nomeGrupo !== anterior.grupo_atividade_nome) {
      campos.grupo_atividade_nome = nomeGrupo;
    }

    const nomeTipo = campos.nome_tipo ? String(campos.nome_tipo) : anterior.nome_tipo;
    if (
      (campos.nome_tipo && campos.nome_tipo !== anterior.nome_tipo) ||
      (campos.grupo_atividade_id && campos.grupo_atividade_id !== anterior.grupo_atividade_id)
    ) {
      if (await existeTipoComNomeNoGrupo(auth.clienteId, grupoId, nomeTipo, id, tx)) {
        throw tipoAtividadeNomeConflito();
      }
    }

    await exigirPadroes(tx, auth.clienteId, campos, anterior);

    const registro = Object.keys(campos).length
      ? await comFkDoPadraoTraduzida(() => atualizarTipoPorId(tx, auth.clienteId, id, campos))
      : anterior;

    const publico = comoTipoPublico(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'TipoAtividade',
        entidadeId: id,
        dadosAnteriores: comoTipoPublico(anterior),
        dadosNovos: publico,
      },
      tx
    );

    return publico;
  });
};

/**
 * Exclusão física, mesma política do Tipo de Tarefa. D-PROD-190/198: o tipo
 * usado numa atividade é barrado pela FK RESTRICT (409, inative-o).
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id
 */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    const anterior = await buscarTipo(auth.clienteId, id, tx);
    if (!anterior) throw tipoAtividadeNotFound();

    try {
      await excluirTipoPorId(tx, auth.clienteId, id);
    } catch (erro) {
      if (vinculoComAtividade(erro)) throw tipoAtividadeDeleteBlocked(undefined, { cause: erro });
      throw erro;
    }

    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'TipoAtividade',
        entidadeId: id,
        dadosAnteriores: comoTipoPublico(anterior),
      },
      tx
    );
  });
};

// ─── D-PROD-197: opções de centro padrão para o formulário (§3.4) ──────────

/**
 * Centros ATIVOS da fazenda informada, `{ itens: [{ id, numero, nome }] }`,
 * pelo valor do número ("2" antes de "10"; ver o repository), no máximo o teto
 * de ativos por empresa da gestão (a lista nunca sai cortada). A fazenda é
 * conferida no tenant da SESSÃO: outra fazenda, outro tenant ou inexistente →
 * 404 `EMPRESA_NOT_FOUND` (o mesmo corpo).
 * @param {'custo'|'resultado'} lado
 */
export const opcoesCentrosPadrao = (lado) =>
  /**
   * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
   * @param {Record<string, unknown>} [query]
   */
  async (contexto, query = {}) => {
    const auth = exigirAuthContext(contexto?.auth);
    const empresaId = await exigirEmpresaDoTenant(getPrismaClient(), auth.clienteId, query.empresa_id);
    const linhas = await listarCentrosAtivosDaEmpresa(lado, auth.clienteId, empresaId, MAX_ATIVOS_POR_EMPRESA);
    return { itens: linhas.map((c) => ({ id: c.id, numero: c.numero, nome: c.nome })) };
  };
