import { useQuery } from "@tanstack/react-query";
import { listarBebedouros } from "@/services/bebedouroDataService";

export function useBebedouros(empresaId) {
  return useQuery({
    queryKey: ["bebedouros", empresaId],
    queryFn: () => listarBebedouros(empresaId),
    enabled: !!empresaId,
    initialData: [],
    staleTime: 60 * 1000
  });
}