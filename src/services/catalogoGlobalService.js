/**
 * Catálogo global de ícones do produto MAIKE (D-PROD-57/60/62/69) — leitura.
 *
 * Os ícones oficiais são dados globais do produto, mantidos pelo proprietário
 * direto no Supabase (runbook `MAIKE-CATALOGO-OPERACAO-SUPABASE.md`). Aqui só
 * se consome o que está publicado. Nenhum tenant — nem admin — edita ícone.
 *
 * Vínculo com o lote: `CategoriaManejo.catalogo_categoria_visual_id` aponta
 * para uma `CatalogoCategoriaVisual` do tipo `lote` (validado no backend). O
 * lote não guarda ícone: deriva da categoria de manejo escolhida.
 *
 * Não confundir com `ConfiguracaoIcone` (legado por tenant, em
 * `configuracaoIconeService.js`), que continua servindo o mapa.
 */

import {
  listTiposCatalogoPublicados,
  listCategoriasCatalogoPublicadas,
  listIconesCatalogoPublicados,
} from '@/apis/catalogoGlobal';

/** Código do tipo oficial do catálogo usado para lotes (espelha o backend). */
export const CODIGO_TIPO_LOTE = 'lote';

/** @returns {Promise<string|null>} id do tipo `lote` publicado, ou null se não houver */
const idTipoLote = async () => {
  const tipos = /** @type {Array<{ id: string, codigo: string }>} */ (await listTiposCatalogoPublicados());
  return tipos.find((t) => t.codigo === CODIGO_TIPO_LOTE)?.id ?? null;
};

/**
 * Categorias oficiais (ativas) do tipo `lote` — as únicas que uma Categoria
 * de Manejo pode vincular.
 *
 * @returns {Promise<{ tipoLoteId: string|null, categorias: Array<{ id: string, codigo: string, nome: string }> }>}
 */
export const carregarCategoriasOficiaisLote = async () => {
  const [tipoLoteId, categorias] = await Promise.all([idTipoLote(), listCategoriasCatalogoPublicadas()]);
  if (!tipoLoteId) return { tipoLoteId: null, categorias: [] };
  return {
    tipoLoteId,
    categorias: /** @type {any[]} */ (categorias).filter((c) => c.tipo_id === tipoLoteId),
  };
};

/**
 * Ícones publicados do tipo `lote`.
 *
 * @returns {Promise<{ tipoLoteId: string|null, icones: any[] }>}
 */
export const carregarIconesOficiaisLote = async () => {
  const [tipoLoteId, icones] = await Promise.all([idTipoLote(), listIconesCatalogoPublicados()]);
  if (!tipoLoteId) return { tipoLoteId: null, icones: [] };
  return { tipoLoteId, icones: /** @type {any[]} */ (icones).filter((i) => i.tipo_id === tipoLoteId) };
};

/**
 * Ícone oficial do lote — só por vínculo EXPLÍCITO e estável.
 *
 * Nunca casa por nome, sexo, raça, idade ou texto de `categoria_oficial`.
 * Candidatos: ícones publicados (o backend já filtra `publicado` + ativo) do
 * tipo `lote` com `categoria_id === categoriaVisualId`.
 *
 * Precedência explícita quando houver mais de um publicado para a mesma
 * categoria (o catálogo não impõe unicidade): maior `revisao` vence; empate →
 * menor `id` em ordem lexicográfica. Determinística e independente da ordem
 * em que a API devolveu a lista.
 *
 * @param {{
 *   categoriaVisualId?: string|null,
 *   tipoLoteId?: string|null,
 *   icones: Array<{ id: string, tipo_id: string, categoria_id: string, revisao?: number, asset_principal_url?: string|null, cor_fallback?: string|null }>,
 * }} args
 * @returns {{ status: 'mapeamento_pendente' } | { status: 'sem_icone_publicado', categoriaVisualId: string } | { status: 'ok', icone: any, candidatos: number }}
 */
export const resolverIconeOficialDoLote = ({ categoriaVisualId, tipoLoteId, icones }) => {
  if (!categoriaVisualId) return { status: 'mapeamento_pendente' };
  const candidatos = (Array.isArray(icones) ? icones : []).filter(
    (i) => Boolean(tipoLoteId) && i.tipo_id === tipoLoteId && i.categoria_id === categoriaVisualId,
  );
  if (candidatos.length === 0) return { status: 'sem_icone_publicado', categoriaVisualId };
  const [icone] = [...candidatos].sort(
    (a, b) => Number(b.revisao ?? 0) - Number(a.revisao ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return { status: 'ok', icone, candidatos: candidatos.length };
};
