/**
 * Prévia do ícone oficial (catálogo global) de um lote — somente leitura.
 *
 * O id vem do vínculo `CategoriaManejo.catalogo_categoria_visual_id` da
 * categoria de manejo escolhida no lote (D-PROD-69). Nunca bloqueia o
 * cadastro e nunca adivinha: sem vínculo mostra fallback discreto e nem
 * consulta o catálogo. Falha de rede vira aviso, não "sucesso".
 *
 * Cache: os ícones publicados ficam 60 s em cache (CHAVE_ICONES_LOTE); a troca
 * de imagem no catálogo gera asset/URL versionados, então aparece no máximo
 * após esse intervalo, sem deploy.
 */

import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { carregarIconesOficiaisLote, resolverIconeOficialDoLote } from "@/services/catalogoGlobalService";

export const CHAVE_ICONES_LOTE = ["catalogo-global", "lote", "icones-publicados"];

/**
 * @param {{ categoriaVisualId?: string|null, categoriaManejoSelecionada?: boolean }} props
 */
export default function IconeOficialLotePreview({ categoriaVisualId = null, categoriaManejoSelecionada = false }) {
  const { data, isError, isLoading } = useQuery({
    queryKey: CHAVE_ICONES_LOTE,
    queryFn: carregarIconesOficiaisLote,
    staleTime: 60 * 1000,
    retry: false,
    enabled: Boolean(categoriaVisualId),
  });
  const r = resolverIconeOficialDoLote({
    categoriaVisualId,
    tipoLoteId: data?.tipoLoteId ?? null,
    icones: data?.icones ?? [],
  });
  const url = r.status === "ok" ? r.icone.asset_principal_url || null : null;
  const [imagemFalhou, setImagemFalhou] = useState(false);
  useEffect(() => setImagemFalhou(false), [url]);

  /** @type {string} */
  let status = r.status;
  let conteudo;
  if (!categoriaVisualId) {
    status = categoriaManejoSelecionada ? "mapeamento_pendente" : "sem_categoria";
    conteudo = categoriaManejoSelecionada
      ? "Ícone oficial: esta categoria de manejo ainda não tem categoria oficial do catálogo MAIKE."
      : "Ícone oficial: selecione a categoria de manejo.";
  } else if (isError) {
    status = "erro";
    conteudo = "Catálogo de ícones indisponível no momento (o cadastro não é afetado).";
  } else if (isLoading) {
    status = "carregando";
    conteudo = "Carregando ícone oficial…";
  } else if (r.status === "ok") {
    const mostrarImagem = url && !imagemFalhou;
    conteudo = (
      <span className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center overflow-hidden rounded border bg-white"
          style={!mostrarImagem && r.icone.cor_fallback ? { backgroundColor: r.icone.cor_fallback } : undefined}
          data-testid="icone-oficial-lote-moldura"
        >
          {mostrarImagem ? (
            <img
              src={url}
              alt="Ícone oficial do lote"
              className="h-full w-full object-contain"
              onError={() => setImagemFalhou(true)}
            />
          ) : null}
        </span>
        Ícone oficial MAIKE
      </span>
    );
  } else {
    conteudo = "Categoria oficial sem ícone publicado ainda.";
  }

  return (
    <p
      className="px-1 py-1 text-[11px] text-slate-500"
      data-testid="icone-oficial-lote"
      data-status={status}
      data-icone-id={r.status === "ok" ? r.icone.id : undefined}
    >
      {conteudo}
    </p>
  );
}
