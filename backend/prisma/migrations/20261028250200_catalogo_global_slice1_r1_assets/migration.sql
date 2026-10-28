-- Catálogo global slice 1 R1 — dedupe de asset por revisão de catálogo + caminho versionado.

CREATE UNIQUE INDEX "CatalogoAsset_sha256_revisao_key" ON "CatalogoAsset"("sha256", "revisao");
