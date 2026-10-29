-- PR145-R2 (D-PROD-69) — vínculo explícito CategoriaManejo -> CatalogoCategoriaVisual.
--
-- Coluna opcional: categorias de manejo existentes ficam sem vínculo (NULL) e
-- continuam válidas; o FormularioLote mostra fallback para elas.
-- A FK aponta para o id GLOBAL da categoria visual (catálogo sem cliente_id,
-- D-PROD-60) — não é FK entre tenants. ON DELETE RESTRICT: categorias visuais
-- nunca são apagadas, só desativadas.
--
-- Aditiva e reversível:
--   ALTER TABLE "CategoriaManejo" DROP CONSTRAINT "CategoriaManejo_catalogo_categoria_visual_id_fkey";
--   DROP INDEX "CategoriaManejo_cliente_id_catalogo_categoria_visual_id_idx";
--   ALTER TABLE "CategoriaManejo" DROP COLUMN "catalogo_categoria_visual_id";

-- AlterTable
ALTER TABLE "CategoriaManejo" ADD COLUMN     "catalogo_categoria_visual_id" VARCHAR(64);

-- CreateIndex
CREATE INDEX "CategoriaManejo_cliente_id_catalogo_categoria_visual_id_idx" ON "CategoriaManejo"("cliente_id", "catalogo_categoria_visual_id");

-- AddForeignKey
ALTER TABLE "CategoriaManejo" ADD CONSTRAINT "CategoriaManejo_catalogo_categoria_visual_id_fkey" FOREIGN KEY ("catalogo_categoria_visual_id") REFERENCES "CatalogoCategoriaVisual"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
