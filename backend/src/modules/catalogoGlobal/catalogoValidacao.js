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
