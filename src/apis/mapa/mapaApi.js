/**
 * API do módulo Mapa (P1.2, D-PROD-18).
 *
 * Implementação interna: quem está fora do módulo importa `@/apis/mapa`.
 *
 * Esta camada é adaptador de dados, e só isso:
 *  - não importa React, React Query, toast, componente ou hook;
 *  - não conhece cache nem `localStorage`;
 *  - não aceita `entityName`;
 *  - devolve dados, nunca objeto do provider.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { mapaProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Mapa';

const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
/**
 * O provider devolve `undefined` quando não há registro; a fronteira nunca.
 *
 * O tipo é `any[]` porque o documento da Base44 é, de fato, não tipado — dizer
 * `object[]` seria uma afirmação falsa que quebraria todo acesso a campo nos
 * consumidores. Quando o provider nativo chegar em P7, cada módulo ganha o tipo
 * real do seu agregado.
 *
 * @param {unknown} registros
 * @returns {any[]}
 */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);

const ctx = (operation) => ({ operation, resource: RESOURCE });

// ── Áreas de pastagem ─────────────────────────────────────────────────────

/**
 * Nativas desde a P4.2, e com dono em `@/apis/areas` (D-PROD-31).
 *
 * Mesma mudança de dono que `listSetores` teve na P4.1, pelo mesmo motivo:
 * antes havia duas leituras do mesmo agregado — `mapaProvider.listAreas` e
 * `suplementacaoProvider.listAreas` —, aceitáveis enquanto as duas batiam na
 * mesma entidade da Base44. Com a persistência nativa elas deixariam de ser
 * equivalentes: duas portas, dois caches offline com a mesma chave.
 *
 * A superfície pública do mapa não muda: quem importa `@/apis/mapa` continua
 * chamando `listAreas`, `filterAreas`, `createArea` e `updateArea` sem saber de
 * onde o dado vem. O que mudou é que ele não vem mais da Base44 — e não volta a
 * vir quando o backend próprio falha. Não existe fallback.
 */
export { listAreas, filterAreas, createArea, updateArea } from '@/apis/areas';

/**
 * Geografia nativa desde a P4.3 (D-PROD-32): pontos, linhas e ícones saíram da
 * Base44. Dono único em `@/apis/mapaGeografia`.
 */
export {
  listPontos,
  createPonto,
  updatePonto,
  deletePonto,
  listLinhas,
  createLinha,
  updateLinha,
  listIcones,
  createIcone,
  updateIcone,
} from '@/apis/mapaGeografia';

// ── Pontos de suplementação ───────────────────────────────────────────────

export {
  listPontosSuplementacao,
  createPontoSuplementacao,
  updatePontoSuplementacao,
  deletePontoSuplementacao,
} from '@/apis/pontos-suplementacao';

// ── Apoio: setores, bebedouros ──────────────────────────────────────────────

/**
 * Setores, para desenhar e agrupar a geografia.
 *
 * Reexportado do módulo Setores desde a P4.1 (D-PROD-25). Antes existiam duas
 * leituras do mesmo agregado — `mapaProvider.listSetores` e
 * `setoresProvider.list` —, aceitáveis enquanto as duas batiam na mesma entidade
 * da Base44. Com a persistência nativa elas deixariam de ser equivalentes: duas
 * portas, dois caches offline com a mesma chave, e nenhuma garantia de que o
 * mapa e o cadastro enxergassem a mesma lista.
 *
 * A superfície pública do mapa não muda: quem importa `@/apis/mapa` continua
 * chamando `listSetores()` sem saber de onde ele vem.
 */
export { listSetores } from '@/apis/setores';

export { listBebedouros } from '@/apis/bebedouros';
