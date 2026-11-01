import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listarIconesDeLoteDaEmpresa } from "@/services/categoriaManejoService";

const SEM_ICONES = [];

const CATEGORIAS_PADRAO = [
  "Bezerro 0 a 12 meses",
  "Bezerra 0 a 12 meses",
  "Garrote 13 a 24 meses",
  "Novilha 13 a 24 meses",
  "Boi 25 a 36 meses",
  "Vaca 25 a 36 meses",
  "Touro + 36 meses",
  "Vaca + 36 meses",
];

/**
 * Categorias oficiais que uma categoria de manejo pode usar: as padrão mais as
 * dos ícones de Lote da empresa (sem "MISTO"). Usado pela tela de Categorias de
 * Manejo e pelo cadastro rápido aberto do formulário do Lote.
 *
 * @param {string | null | undefined} empresaId
 * @returns {string[]}
 */
export function useCategoriasOficiaisDisponiveis(empresaId) {
  const { data } = useQuery({
    queryKey: ["configuracao-icones", empresaId],
    queryFn: async () => listarIconesDeLoteDaEmpresa(empresaId),
    enabled: !!empresaId,
  });
  const icones = data ?? SEM_ICONES;
  return useMemo(() => {
    const dosIcones = icones
      .filter((ic) => ic.tipo_entidade === "Lote")
      .map((ic) => ic.categoria)
      .filter((cat) => cat && cat.toUpperCase() !== "MISTO");
    return [...new Set([...CATEGORIAS_PADRAO, ...dosIcones])].sort();
  }, [icones]);
}
