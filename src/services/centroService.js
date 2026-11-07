/**
 * Service de Centros de Custo e Centros de Resultado (D-PROD-145).
 *
 * Os dois cadastros têm a mesma forma (árvore opcional por empresa); o vínculo
 * N:N é gravado só pelo Centro de Custo e lido dos dois lados. Nada aqui gera
 * lançamento ou valor. O servidor valida hierarquia, nome e permissão.
 */

import {
  listCentrosCustoPage,
  createCentroCusto,
  updateCentroCusto,
  listOpcoesPaiCentroCusto,
  listOpcoesCentrosResultadoParaVinculo,
  listCentrosResultadoDoCentroCusto,
  definirCentrosResultadoDoCentroCusto,
} from '@/apis/centros-custo';
import {
  listCentrosResultadoPage,
  createCentroResultado,
  updateCentroResultado,
  listOpcoesPaiCentroResultado,
  listCentrosCustoDoCentroResultado,
} from '@/apis/centros-resultado';
import { camposAlterados, exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';

/** @typedef {'custo'|'resultado'} TipoCentro */

const API = Object.freeze({
  custo: { listPage: listCentrosCustoPage, create: createCentroCusto, update: updateCentroCusto, opcoesPai: listOpcoesPaiCentroCusto, resource: 'CentroCusto' },
  resultado: { listPage: listCentrosResultadoPage, create: createCentroResultado, update: updateCentroResultado, opcoesPai: listOpcoesPaiCentroResultado, resource: 'CentroResultado' },
});

const CAMPOS = Object.freeze(['nome', 'descricao', 'pai_id', 'ativo']);

/** @param {TipoCentro} tipo */
const apiDe = (tipo) => {
  const api = API[tipo];
  if (!api) throw new TypeError(`tipo de centro desconhecido: ${String(tipo)}`);
  return api;
};

/**
 * @param {TipoCentro} tipo
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, ativo?: boolean }} [opts]
 */
export const listarCentrosPagina = async (tipo, empresaId, opts = {}) => {
  if (!empresaId) return paginaVazia(opts.limit);
  return apiDe(tipo).listPage({ empresa_id: empresaId, limit: opts.limit, cursor: opts.cursor ?? undefined, q: opts.q, ativo: opts.ativo });
};

/** @param {TipoCentro} tipo @param {string|null} empresaId @param {Record<string, any>} dados */
export const criarCentro = async (tipo, empresaId, dados) => {
  const api = apiDe(tipo);
  const empresa = exigirEmpresa(empresaId, 'criarCentro', api.resource);
  const corpo = camposAlterados({}, dados, ['nome', 'descricao', 'pai_id']);
  return api.create({ ...corpo, empresa_id: empresa });
};

/**
 * PATCH só com o que mudou. `pai_id: null` = virar raiz.
 * @param {TipoCentro} tipo @param {string|null} empresaId @param {Record<string, any>} original @param {Record<string, any>} dados
 * @returns {Promise<{ alterado: boolean, registro: object }>}
 */
export const atualizarCentro = async (tipo, empresaId, original, dados) => {
  const api = apiDe(tipo);
  const empresa = exigirEmpresa(empresaId, 'atualizarCentro', api.resource);
  const corpo = camposAlterados(original, dados, CAMPOS);
  if (!Object.keys(corpo).length) return { alterado: false, registro: original };
  const registro = await api.update(original.id, { empresa_id: empresa, ...corpo });
  return { alterado: true, registro };
};

/** @param {TipoCentro} tipo @param {string|null} empresaId @param {string} id @param {boolean} ativo */
export const alterarSituacaoCentro = async (tipo, empresaId, id, ativo) => {
  const api = apiDe(tipo);
  const empresa = exigirEmpresa(empresaId, 'alterarSituacaoCentro', api.resource);
  return api.update(id, { empresa_id: empresa, ativo: ativo === true });
};

/**
 * Inativação em lote (best-effort, na ordem pedida).
 * @param {TipoCentro} tipo @param {string|null} empresaId @param {string[]} ids
 */
export const inativarCentros = async (tipo, empresaId, ids) => {
  const ok = [];
  const falhas = [];
  for (const id of ids) {
    try {
      await alterarSituacaoCentro(tipo, empresaId, id, false);
      ok.push(id);
    } catch (erro) {
      falhas.push({ id, erro });
    }
  }
  return { ok, falhas };
};

/**
 * Ids do nó e de todos os descendentes, pela relação `pai_id` das opções.
 * @param {Array<{ id: string, pai_id?: string|null }>} itens
 * @param {string|null|undefined} raizId
 */
export const idsDaSubarvore = (itens, raizId) => {
  const fora = new Set();
  if (!raizId) return fora;
  fora.add(raizId);
  let cresceu = true;
  while (cresceu) {
    cresceu = false;
    for (const item of itens) {
      if (item.pai_id && fora.has(item.pai_id) && !fora.has(item.id)) {
        fora.add(item.id);
        cresceu = true;
      }
    }
  }
  return fora;
};

/**
 * Opções de pai (ativos do mesmo tipo), sem o próprio nó nem os descendentes
 * (o servidor também barra ciclo). Cada opção leva o caminho para exibição.
 * @param {TipoCentro} tipo @param {string|null} empresaId @param {string|null} [proprioId]
 */
export const listarOpcoesPai = async (tipo, empresaId, proprioId = null) => {
  if (!empresaId) return [];
  const itens = /** @type {Array<{ id: string, numero?: string|number, nome: string, pai_id?: string|null }>} */ (await apiDe(tipo).opcoesPai(empresaId));
  const fora = idsDaSubarvore(itens, proprioId);
  const porId = new Map(itens.map((i) => [i.id, i]));
  return itens
    .filter((i) => !fora.has(i.id))
    .map((i) => ({ ...i, caminho: caminhoDe(i, porId) }))
    .sort((a, b) => a.caminho.localeCompare(b.caminho, 'pt-BR'));
};

/**
 * "AVÔ / PAI / NÓ" subindo pelos pais conhecidos (para em ciclo ou pai fora da lista).
 * @param {{ id: string, nome?: string, pai_id?: string|null, pai_nome?: string|null }} item
 * @param {Map<string, any>} porId
 */
export const caminhoDe = (item, porId) => {
  const partes = [item.nome ?? ''];
  const vistos = new Set([item.id]);
  let paiId = item.pai_id ?? null;
  let paiNome = item.pai_nome ?? null;
  while (paiId && !vistos.has(paiId)) {
    vistos.add(paiId);
    const pai = porId.get(paiId);
    if (!pai) {
      if (paiNome) partes.unshift(paiNome);
      break;
    }
    partes.unshift(pai.nome ?? '');
    paiId = pai.pai_id ?? null;
    paiNome = pai.pai_nome ?? null;
  }
  return partes.join(' / ');
};

// ── Vínculo N:N (sem lançamento; só relação entre cadastros) ─────────────────

/** @param {string|null} empresaId @param {string} centroCustoId */
export const listarCentrosResultadoVinculados = async (empresaId, centroCustoId) => {
  if (!empresaId || !centroCustoId) return [];
  return listCentrosResultadoDoCentroCusto(centroCustoId, empresaId);
};

/** @param {string|null} empresaId */
export const listarOpcoesVinculoCentrosResultado = async (empresaId) => {
  if (!empresaId) return [];
  return listOpcoesCentrosResultadoParaVinculo(empresaId);
};

/**
 * Substitui o conjunto (idempotente no servidor).
 * @param {string|null} empresaId @param {string} centroCustoId @param {string[]} ids
 */
export const salvarCentrosResultadoVinculados = async (empresaId, centroCustoId, ids) => {
  const empresa = exigirEmpresa(empresaId, 'salvarVinculosCentroCusto', 'CentroCusto');
  return definirCentrosResultadoDoCentroCusto(centroCustoId, empresa, ids);
};

/** Leitura (somente) dos centros de custo que apontam para um centro de resultado. */
export const listarCentrosCustoVinculados = async (empresaId, centroResultadoId) => {
  if (!empresaId || !centroResultadoId) return [];
  return listCentrosCustoDoCentroResultado(centroResultadoId, empresaId);
};
