/**
 * Prévia do ícone oficial (catálogo global) de um lote — somente leitura.
 *
 * Nunca bloqueia o cadastro e nunca adivinha: o ícone só aparece quando há
 * vínculo explícito `categoriaVisualId`. Hoje nenhuma Categoria de Manejo tem
 * esse vínculo (ver `resolverIconeOficialDoLote`), então o resultado honesto
 * é "mapeamento pendente". Consome apenas a leitura publicada do catálogo.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  listarIconesOficiaisPublicados,
  resolverIconeOficialDoLote,
} from "@/services/catalogoGlobalService";

export const CHAVE_ICONES_PUBLICADOS = ["catalogo-global", "icones", "publicados"];

export default function IconeOficialLotePreview({ categoriaVisualId = null }) {
  const { data: icones = [], isError } = useQuery({
    queryKey: CHAVE_ICONES_PUBLICADOS,
    queryFn: listarIconesOficiaisPublicados,
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled: Boolean(categoriaVisualId),
  });
  const r = resolverIconeOficialDoLote({ categoriaVisualId, icones });

  let conteudo;
  if (r.status === "ok") {
    const url = r.icone.asset_principal_url;
    conteudo = (
      <span className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center overflow-hidden rounded border bg-white"
          style={!url && r.icone.cor_fallback ? { backgroundColor: r.icone.cor_fallback } : undefined}
        >
          {url ? <img src={url} alt="Ícone oficial do lote" className="h-full w-full object-contain" /> : null}
        </span>
        Ícone oficial MAIKE
      </span>
    );
  } else if (isError) {
    conteudo = "Catálogo de ícones indisponível no momento (o cadastro não é afetado).";
  } else if (r.status === "sem_icone_publicado") {
    conteudo = "Categoria oficial sem ícone publicado ainda.";
  } else {
    conteudo = "Ícone oficial: vínculo da categoria com o catálogo MAIKE ainda não configurado.";
  }

  return (
    <p className="px-1 py-1 text-[11px] text-slate-500" data-testid="icone-oficial-lote" data-status={isError ? "erro" : r.status}>
      {conteudo}
    </p>
  );
}
