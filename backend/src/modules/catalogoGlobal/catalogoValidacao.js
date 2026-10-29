import { catalogoGlobalInvalid, catalogoGlobalNotFound } from '../../shared/errors/AppError.js';

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 * @param {string} tipoId
 */
export const exigirTipoAtivo = async (db, tipoId) => {
  const tipo = await db.catalogoTipoEntidade.findUnique({ where: { id: tipoId } });
  if (!tipo) throw catalogoGlobalNotFound('tipo não encontrado');
  if (!tipo.ativo) throw catalogoGlobalInvalid('tipo inativo');
  return tipo;
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 * @param {string} tipoId
 * @param {string} categoriaId
 */
export const exigirCategoriaDoTipo = async (db, tipoId, categoriaId) => {
  const categoria = await db.catalogoCategoriaVisual.findUnique({ where: { id: categoriaId } });
  if (!categoria) throw catalogoGlobalNotFound('categoria não encontrada');
  if (categoria.tipo_id !== tipoId) {
    throw catalogoGlobalInvalid('categoria incompatível com o tipo informado');
  }
  if (!categoria.ativo) throw catalogoGlobalInvalid('categoria inativa');
  return categoria;
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 * @param {string | null | undefined} assetId
 * @param {string} [rotulo]
 */
export const exigirAssetPublicado = async (db, assetId, rotulo = 'asset') => {
  if (!assetId) return null;
  const asset = await db.catalogoAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw catalogoGlobalNotFound(`${rotulo} não encontrado`);
  if (asset.estado !== 'publicado') {
    throw catalogoGlobalInvalid(`${rotulo} não está publicado`);
  }
  return asset;
};

/** Código do tipo oficial cujas categorias visuais podem ser vinculadas a CategoriaManejo. */
export const CODIGO_TIPO_LOTE = 'lote';

/**
 * Valida o vínculo `CategoriaManejo.catalogo_categoria_visual_id` (D-PROD-69):
 * a categoria visual tem de existir, estar ativa e pertencer ao tipo oficial
 * `lote`, também ativo. Trava as duas linhas (FOR SHARE) até o fim da
 * transação do chamador, para uma desativação concorrente não passar entre a
 * validação e a gravação.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} categoriaId
 */
export const exigirCategoriaVisualLoteVinculavel = async (tx, categoriaId) => {
  /** @type {Array<{ ativo: boolean, tipo_codigo: string, tipo_ativo: boolean }>} */
  const linhas = await tx.$queryRaw`
    SELECT c."ativo", t."codigo" AS tipo_codigo, t."ativo" AS tipo_ativo
      FROM "CatalogoCategoriaVisual" c
      JOIN "CatalogoTipoEntidade" t ON t."id" = c."tipo_id"
     WHERE c."id" = ${categoriaId}
       FOR SHARE OF c, t`;
  const linha = linhas[0];
  const detalhes = { campo: 'catalogo_categoria_visual_id' };
  if (!linha) throw catalogoGlobalInvalid('categoria oficial não encontrada no catálogo', detalhes);
  if (linha.tipo_codigo !== CODIGO_TIPO_LOTE) {
    throw catalogoGlobalInvalid('categoria oficial não pertence ao tipo lote', detalhes);
  }
  if (!linha.ativo || !linha.tipo_ativo) throw catalogoGlobalInvalid('categoria oficial inativa', detalhes);
};
