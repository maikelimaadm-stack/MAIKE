import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

export const sortByNomeNumerico = (a, b, field = "nome") => {
  return collator.compare(String(a?.[field] || ""), String(b?.[field] || ""));
};

export const ordenarPorNomeNumerico = (items = [], field = "nome") => {
  return [...items].sort((a, b) => sortByNomeNumerico(a, b, field));
};

export default function useSetorAreas(empresaSelecionadaId) {
  const { data: setores = [], ...setoresQuery } = useQuery({
    queryKey: ["setores-por-area", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Setor.list();
      return all
        .map((item) => ({ ...(item.data || item), id: item.id }))
        .filter((item) => item.empresa_id === empresaSelecionadaId && item.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const { data: areas = [], ...areasQuery } = useQuery({
    queryKey: ["areas-por-setor", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all
        .map((item) => ({ ...(item.data || item), id: item.id }))
        .filter((item) => item.empresa_id === empresaSelecionadaId && item.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const setoresOrdenados = useMemo(() => ordenarPorNomeNumerico(setores), [setores]);
  const areasOrdenadas = useMemo(() => ordenarPorNomeNumerico(areas), [areas]);

  const getAreasBySetor = (setorId) => {
    if (!setorId) return [];
    return areasOrdenadas.filter((area) => area.setor_id === setorId);
  };

  const getSetorById = (setorId) => setoresOrdenados.find((setor) => setor.id === setorId) || null;
  const getAreaById = (areaId) => areasOrdenadas.find((area) => area.id === areaId) || null;

  return {
    setores: setoresOrdenados,
    areas: areasOrdenadas,
    getAreasBySetor,
    getSetorById,
    getAreaById,
    ...setoresQuery,
    ...areasQuery,
  };
}