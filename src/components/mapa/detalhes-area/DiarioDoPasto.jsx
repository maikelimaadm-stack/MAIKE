import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DiarioDasAtividades from "@/components/lancamento-atividades/DiarioDasAtividades";
import { useEmpresaRealSelecionadaId } from "@/hooks/useLancamentoAtividadesSessao";
import { RAIZ_CONSULTAS_ATIVIDADES } from "@/lib/atividadeApontamentoRegras";
import { STATUS_AREA } from "@/lib/atividadeAreasRegras";
import { QUERY_ATIVIDADES_DA_AREA } from "@/lib/registroDeCampoRegras";
import { definirFazendaDaTela, obterResumoDaArea } from "@/services/lancamentoAtividadesService";
import { lerAtividadeParaAcoes } from "./lerAtividadeParaAcoes";

/**
 * O "Diário das atividades" dos Detalhes da área do Mapa (D-PROD-332, D-PROD-341): é a ÚNICA entrada de diário no mapa —
 * a pílula "Manejos" do rodapé e a ação "+ Lançamento" da linha das atividades em andamento abrem este componente.
 *
 * Fino: lê o resumo da área com a MESMA chave da aba (cache compartilhado) para montar a lista "Em andamento neste pasto"
 * e entrega o resto ao `DiarioDasAtividades`. O passo inicial do diário é decidido na montagem, então, enquanto o resumo
 * carrega pela 1ª vez (e não há `atividade`), não se renderiza nada. Se a consulta falhar, o diário abre com lista vazia
 * (vai ao tipo).
 *
 * @param {{ area: any, tipos?: any[], atividade?: any | null, verAtividades?: boolean, onFechar: () => void, aoGravar?: () => void }} props
 *   `atividade`: a atividade já lida (a ação de linha); sem ela, o diário decide pelas atividades abertas do pasto.
 *   `aoGravar`: além das consultas do mapa (que este componente já relê), para quem mostra a lista de atividades por fora
 *   (a página Lançamento de Atividades) reler a sua.
 */
export default function DiarioDoPasto({ area, tipos = [], atividade = null, verAtividades = true, onFechar, aoGravar = undefined }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const queryClient = useQueryClient();
  definirFazendaDaTela(empresaId);
  const habilitada = Boolean(empresaId && area?.id && verAtividades);
  const resumo = useQuery({
    queryKey: [QUERY_ATIVIDADES_DA_AREA, "resumo", empresaId, area.id],
    queryFn: () => obterResumoDaArea(String(area.id)),
    enabled: habilitada,
    staleTime: 15 * 1000,
  });

  if (!atividade && habilitada && resumo.isPending) return null;

  const atividadesAbertas = (resumo.data?.atividades ?? []).filter((a) => a.area_status !== STATUS_AREA.CONCLUIDA);

  return (
    <DiarioDasAtividades
      area={area}
      tipos={tipos}
      atividade={atividade}
      atividadesAbertas={atividadesAbertas}
      lerAtividade={(atividadeId) => lerAtividadeParaAcoes(atividadeId, String(area.id))}
      onFechar={onFechar}
      onGravou={() => {
        void queryClient.invalidateQueries({ queryKey: [QUERY_ATIVIDADES_DA_AREA] });
        void queryClient.invalidateQueries({ queryKey: [RAIZ_CONSULTAS_ATIVIDADES] });
        aoGravar?.();
      }}
    />
  );
}
