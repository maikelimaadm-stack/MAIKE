import { useQuery } from "@tanstack/react-query";
import { listarHistorico } from "@/services/bebedouroDataService";

export function useBebedouroHistorico(empresaId, bebedouroId) {
  return useQuery({
    queryKey: ["bebedouro-historico", empresaId, bebedouroId],
    queryFn: () => listarHistorico(empresaId, bebedouroId),
    enabled: !!empresaId && !!bebedouroId,
    initialData: [],
    staleTime: 60 * 1000
  });
}