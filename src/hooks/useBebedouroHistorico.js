import { useQuery } from "@tanstack/react-query";
import { listarHistorico } from "@/services/bebedouroDataService";

export function useBebedouroHistorico(empresaId, bebedouroId) {
  return useQuery({
    queryKey: ["bebedouro-historico", empresaId, bebedouroId],
    queryFn: () => listarHistorico(empresaId, bebedouroId),
    enabled: !!empresaId && !!bebedouroId,
    // D-PROD-137: `initialData: []` + `staleTime` contava a lista vazia como
    // dado FRESCO — a 1ª abertura do bebedouro não buscava nada por 60 s
    // ("Nenhum lançamento", sem o "Excluir" do mais recente). O placeholder só
    // preenche enquanto a busca roda.
    placeholderData: [],
    staleTime: 60 * 1000
  });
}
