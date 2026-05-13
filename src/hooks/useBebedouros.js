import { useQuery } from "@tanstack/react-query";
import bebedouroRepository from "@/repositories/bebedouroRepository";

export function useBebedouros(empresaId) {
  return useQuery({
    queryKey: ["bebedouros", empresaId],
    queryFn: () => bebedouroRepository.listBebedouros(empresaId),
    enabled: !!empresaId,
    initialData: [],
    staleTime: 60 * 1000
  });
}