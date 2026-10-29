/**
 * Catálogo global de ícones do produto MAIKE (D-PROD-57/60/62).
 *
 * Duas faces, ambas autorizadas no backend:
 *  - leitura publicada (qualquer sessão autenticada): ícones oficiais para
 *    exibição em cadastros como Lotes;
 *  - painel interno (`/admin/*`): só OperadorProdutoMaike. `Permissao.is_admin`
 *    do tenant não basta — o servidor responde 403 e a UI só reflete isso.
 *
 * Não confundir com `ConfiguracaoIcone` (legado por tenant, em
 * `configuracaoIconeService.js`), que continua servindo o mapa.
 */

import {
  getManifestoCatalogo,
  getVisaoAdminCatalogo,
  listCategoriasCatalogoPublicadas,
  listIconesCatalogoPublicados,
  createTipoCatalogo,
  createCategoriaCatalogo,
  uploadAssetCatalogo,
  createIconeCatalogo,
  updateIconeCatalogo,
  publishIconeCatalogo,
  deactivateIconeCatalogo,
} from '@/apis/catalogoGlobal';

export const carregarVisaoAdminCatalogo = () => getVisaoAdminCatalogo();

/** Revisão atual (manifest). Usada entre passos de um fluxo com várias escritas. */
export const obterRevisaoCatalogo = async () => {
  const m = /** @type {{ revisao?: number }} */ (await getManifestoCatalogo());
  return Number(m?.revisao ?? 0);
};
export const listarIconesOficiaisPublicados = () => listIconesCatalogoPublicados();
export const listarCategoriasOficiaisPublicadas = () => listCategoriasCatalogoPublicadas();

/** Todas as escritas mandam `revisao_esperada` (CAS): conflito volta 409. */
export const criarTipoCatalogo = (dados, revisao) => createTipoCatalogo({ ...dados, revisao_esperada: revisao });
export const criarCategoriaCatalogo = (dados, revisao) =>
  createCategoriaCatalogo({ ...dados, revisao_esperada: revisao });
export const criarIconeCatalogo = (dados, revisao) => createIconeCatalogo({ ...dados, revisao_esperada: revisao });
export const atualizarIconeCatalogo = (id, dados, revisao) =>
  updateIconeCatalogo(id, { ...dados, revisao_esperada: revisao });
export const publicarIconeCatalogo = (id, revisao) => publishIconeCatalogo(id, { revisao_esperada: revisao });
export const desativarIconeCatalogo = (id, revisao) => deactivateIconeCatalogo(id, { revisao_esperada: revisao });

/**
 * Lê o arquivo escolhido pelo operador e o envia SEM transformar os bytes —
 * as imagens oficiais são as do proprietário. Tipo e tamanho são validados de
 * verdade no backend (MIME real, whitelist, limite); aqui só se antecipa a
 * mensagem com os mesmos limites que o backend informou em `/admin/visao`.
 *
 * @param {File} arquivo
 * @param {number} revisao
 * @param {{ mimes: string[], max_bytes: number }} [limites]
 */
export const enviarImagemCatalogo = async (arquivo, revisao, limites) => {
  if (limites) {
    if (!limites.mimes.includes(arquivo.type)) {
      throw new Error(`Formato não aceito (${arquivo.type || 'desconhecido'}). Aceitos: ${limites.mimes.join(', ')}.`);
    }
    if (arquivo.size > limites.max_bytes) {
      throw new Error(`Arquivo acima do limite de ${Math.round(limites.max_bytes / 1024)} KB.`);
    }
  }
  const conteudo_base64 = await lerComoBase64(arquivo);
  return uploadAssetCatalogo({ conteudo_base64, mime_type: arquivo.type, revisao_esperada: revisao });
};

/** @param {Blob} arquivo */
const lerComoBase64 = (arquivo) =>
  new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    leitor.onload = () => {
      const url = String(leitor.result || '');
      const virgula = url.indexOf(',');
      resolve(virgula >= 0 ? url.slice(virgula + 1) : '');
    };
    leitor.readAsDataURL(arquivo);
  });

/**
 * Código do backend por trás de um erro de API. Códigos que o catálogo de
 * erros do frontend não cataloga (ex.: PRODUCT_OPERATOR_REQUIRED) chegam como
 * OPERATION_FAILED, mas o corpo original fica em `cause`.
 *
 * @param {unknown} erro
 * @returns {string|null}
 */
export const codigoErroCatalogo = (erro) => {
  const e = /** @type {any} */ (erro);
  return e?.cause?.code ?? e?.code ?? null;
};

export const ehSemPermissaoCatalogo = (erro) => codigoErroCatalogo(erro) === 'PRODUCT_OPERATOR_REQUIRED';
export const ehConflitoRevisaoCatalogo = (erro) => codigoErroCatalogo(erro) === 'CONCURRENCY_CONFLICT';

/**
 * Ícone oficial do lote — só por vínculo EXPLÍCITO e estável.
 *
 * Hoje não existe vínculo entre `CategoriaManejo` (tenant) e
 * `CatalogoCategoriaVisual` (global): `categoria_oficial` é texto livre, e
 * casar por nome/sexo exibiria ícone errado (e confundiria a regra visual
 * MISTO com `sexo = Misto`). Por isso o chamador passa `categoriaVisualId`
 * apenas quando houver um vínculo explícito; sem ele, o resultado é
 * `mapeamento_pendente` — fallback honesto, nunca palpite.
 *
 * @param {{
 *   categoriaVisualId?: string|null,
 *   icones: Array<{ id: string, categoria_id: string, asset_principal_url?: string|null, asset_subicone_url?: string|null, cor_fallback?: string|null }>,
 * }} args
 * @returns {{ status: 'mapeamento_pendente' } | { status: 'sem_icone_publicado', categoriaVisualId: string } | { status: 'ok', icone: object }}
 */
export const resolverIconeOficialDoLote = ({ categoriaVisualId, icones }) => {
  if (!categoriaVisualId) return { status: 'mapeamento_pendente' };
  const icone = (Array.isArray(icones) ? icones : []).find((i) => i.categoria_id === categoriaVisualId);
  if (!icone) return { status: 'sem_icone_publicado', categoriaVisualId };
  return { status: 'ok', icone };
};
