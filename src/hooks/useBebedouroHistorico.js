import { useQuery } from "@tanstack/react-query";
import bebedouroRepository from "@/repositories/bebedouroRepository";

export function useBebedouroHistorico(empresaId, bebedouroId) {
  return useQuery({
    queryKey: ["bebedouro-historico", empresaId, bebedouroId],
    queryFn: () => bebedouroRepository.listHistorico(empresaId, bebedouroId),
    enabled: !!empresaId && !!bebedouroId,
    initialData: [],
    staleTime: 60 * 1000
  });
}