import { useQuery } from "@tanstack/react-query";
import { listarBebedouros } from "@/services/bebedouroDataService";

export function useBebedouros(empresaId) {
  return useQuery({
    queryKey: ["bebedouros", empresaId],
    queryFn: () => listarBebedouros(empresaId),
    enabled: !!empresaId,
    // D-PROD-136: `initialData: []` + `staleTime` = lista vazia tida como
    // fresca: a tela Bebedouros abria "Nenhum bebedouro encontrado" e só
    // buscava depois de 60 s. O placeholder só preenche enquanto a busca roda.
    placeholderData: [],
    staleTime: 60 * 1000
  });
}
