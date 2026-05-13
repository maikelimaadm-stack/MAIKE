import { useQuery } from "@tanstack/react-query";
import bebedouroRepository from "@/repositories/bebedouroRepository";

export function useBebedouroSanidade(empresaId, bebedouroId) {
  return useQuery({
    queryKey: ["bebedouro-sanidade", empresaId, bebedouroId],
    queryFn: () => bebedouroRepository.listSanidade(empresaId, bebedouroId),
    enabled: !!empresaId && !!bebedouroId,
    initialData: [],
    staleTime: 60 * 1000
  });
}