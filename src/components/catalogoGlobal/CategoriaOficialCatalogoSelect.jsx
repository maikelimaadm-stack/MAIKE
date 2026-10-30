/**
 * Escolha da categoria oficial do catálogo MAIKE (tipo `lote`) para uma
 * Categoria de Manejo (D-PROD-69). Só lista categorias publicadas; não há
 * upload, cor nem edição de ícone — o ícone é global do produto.
 *
 * Um vínculo já gravado que não está mais entre as publicadas (categoria
 * desativada) continua visível e selecionado, para não ser apagado em silêncio.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { carregarCategoriasOficiaisLote } from "@/services/catalogoGlobalService";

export const CHAVE_CATEGORIAS_OFICIAIS_LOTE = ["catalogo-global", "lote", "categorias-publicadas"];
const NENHUMA = "__SEM_VINCULO__";

/**
 * @param {{ value?: string|null, onChange: (id: string) => void, className?: string, readOnly?: boolean }} props
 */
export default function CategoriaOficialCatalogoSelect({ value = "", onChange, className = "", readOnly = false }) {
  const { data, isError, isLoading } = useQuery({
    queryKey: CHAVE_CATEGORIAS_OFICIAIS_LOTE,
    queryFn: carregarCategoriasOficiaisLote,
    staleTime: 60 * 1000,
    retry: false,
  });
  const categorias = data?.categorias ?? [];
  const atual = categorias.find((c) => c.id === value);

  if (readOnly) {
    const rotulo = !value ? "SEM VÍNCULO" : atual ? atual.nome : "CATEGORIA OFICIAL INDISPONÍVEL";
    return <input type="text" readOnly value={rotulo} className={className} />;
  }

  return (
    <select
      aria-label="Ícone oficial (catálogo MAIKE)"
      data-testid="categoria-oficial-catalogo"
      data-status={isError ? "erro" : isLoading ? "carregando" : "ok"}
      value={value || NENHUMA}
      disabled={isLoading}
      onChange={(e) => onChange(e.target.value === NENHUMA ? "" : e.target.value)}
      className={className}
    >
      <option value={NENHUMA}>{isError ? "CATÁLOGO INDISPONÍVEL — SEM VÍNCULO" : "SEM VÍNCULO"}</option>
      {categorias.map((c) => (
        <option key={c.id} value={c.id}>
          {c.nome}
        </option>
      ))}
      {value && !atual && !isLoading ? <option value={value}>CATEGORIA OFICIAL INDISPONÍVEL</option> : null}
    </select>
  );
}
