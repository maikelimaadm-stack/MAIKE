import React from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { Nota, Vazio } from "@/components/mapa/detalhes-lote/blocos";
import FiltroHistorico from "@/components/mapa/detalhes-lote/FiltroHistorico";
import LinhaDoTempo from "@/components/mapa/detalhes-lote/LinhaDoTempo";
import { useEmpresaRealSelecionadaId } from "@/hooks/useLancamentoAtividadesSessao";
import { diasDosRegistros } from "@/domain/mapa/registrosDaArea";
import { QUERY_ATIVIDADES_DA_AREA } from "@/lib/registroDeCampoRegras";
import { definirFazendaDaTela, listarRegistrosDaArea } from "@/services/lancamentoAtividadesService";

import "@/styles/mk-dp-historico.css";

/*
 * Aba Histórico da área (D-PROD-254): os REGISTROS de campo da área (Gradeação, Aplicação, Abastecimento…) na linha do
 * tempo do Detalhes do Lote (`LinhaDoTempo`, o filtro "Todos"). Não substitui o histórico de movimentação de animais, que
 * continua no "Histórico completo" do rodapé. Só leitura; "Carregar mais" pede a página seguinte ao servidor.
 */

const TODOS = "todos";

/** @param {{ area: any, tipos: any[] }} props */
export default function AbaRegistrosDaArea({ area, tipos }) {
  const empresaId = useEmpresaRealSelecionadaId();
  definirFazendaDaTela(empresaId);
  const [filtro, setFiltro] = React.useState(TODOS);
  const consulta = useInfiniteQuery({
    queryKey: [QUERY_ATIVIDADES_DA_AREA, "registros", empresaId, area.id, filtro],
    queryFn: ({ pageParam }) => listarRegistrosDaArea(String(area.id), { cursor: pageParam || null, limit: 20, tipo_atividade_id: filtro === TODOS ? null : filtro }),
    initialPageParam: /** @type {string|null} */ (null),
    getNextPageParam: (ultima) => ultima.next_cursor || undefined,
    enabled: Boolean(empresaId && area?.id),
    staleTime: 15 * 1000,
  });
  const itens = React.useMemo(() => (consulta.data?.pages ?? []).flatMap((p) => p.items), [consulta.data]);
  const dias = React.useMemo(() => diasDosRegistros(itens), [itens]);
  const opcoes = React.useMemo(
    () => [{ valor: TODOS, rotulo: "Todos" }, ...tipos.map((t) => ({ valor: String(t.id), rotulo: String(t.nome_tipo) }))],
    [tipos],
  );

  let conteudo;
  if (consulta.isLoading) {
    conteudo = (
      <div role="status" className="mk-dp-hist__estado">
        Carregando histórico...
      </div>
    );
  } else if (consulta.isError) {
    conteudo = (
      <div role="alert" className="mk-dp-hist__estado">
        <p>Não foi possível carregar o histórico.</p>
        <p className="mk-dp-hist__detalhe">{getApiErrorMessage(consulta.error, "Tente novamente em instantes.")}</p>
        <button type="button" className="mk-dp-hist__botao" onClick={() => consulta.refetch()}>
          Tentar novamente
        </button>
      </div>
    );
  } else if (dias.length) {
    conteudo = <LinhaDoTempo textoAutomatico dias={dias} rotulo="Registros de campo da área" />;
  } else {
    conteudo = <Vazio icone={History}>Nenhum registro de campo {filtro === TODOS ? "nesta área" : "deste tipo nesta área"}.</Vazio>;
  }

  return (
    <div className="mk-dp-hist" data-testid="area-registros">
      <FiltroHistorico opcoes={opcoes} valor={filtro} onMudar={setFiltro} rotulo="Mostrar" />
      {conteudo}
      {consulta.hasNextPage ? (
        <div className="mk-dp-hist__mais">
          <button type="button" className="mk-dp-hist__botao" disabled={consulta.isFetchingNextPage} onClick={() => consulta.fetchNextPage()}>
            {consulta.isFetchingNextPage ? "Carregando..." : "Carregar mais"}
          </button>
        </div>
      ) : null}
      <Nota>Registros de todos os manejos de campo feitos nesta área.</Nota>
    </div>
  );
}
