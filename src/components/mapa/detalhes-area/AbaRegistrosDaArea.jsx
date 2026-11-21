import React from "react";
import { useInfiniteQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { Nota, Vazio } from "@/components/mapa/detalhes-lote/blocos";
import FiltroHistorico from "@/components/mapa/detalhes-lote/FiltroHistorico";
import LinhaDoTempo from "@/components/mapa/detalhes-lote/LinhaDoTempo";
import {
  BotaoCancelarRegistro,
  DialogoCancelarRegistro,
  TEXTO_FALHA_NA_EXCLUSAO,
  TEXTO_JA_EXCLUIDO,
  TEXTO_SEM_CONEXAO,
  descreverRegistro,
  ehRegistroJaExcluido,
  estadoDoCancelamento,
  estaOnline,
  mensagemDeErroDaExclusao,
  textoSemCancelamento,
  useEstaOnline,
} from "@/components/mapa/detalhes-area/CancelarRegistroDaArea";
import { useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { QUERY_RAIZ_ABASTECIMENTOS } from "@/hooks/useFluxoAbastecimento";
import { diasDosRegistros } from "@/domain/mapa/registrosDaArea";
import { RAIZ_CONSULTAS_ATIVIDADES, pedeReleitura } from "@/lib/atividadeApontamentoRegras";
import { STATUS_CANCELADO, STATUS_CONFIRMADO, codigoDoErroAtividade } from "@/lib/lancamentoAtividadesRegras";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { QUERY_ATIVIDADES_DA_AREA } from "@/lib/registroDeCampoRegras";
import { cancelarApontamento, definirFazendaDaTela, listarRegistrosDaArea, obterApontamento, obterAtividade } from "@/services/lancamentoAtividadesService";
import { ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

import "@/styles/mk-dp-historico.css";

/*
 * Aba Histórico da área (D-PROD-254): os REGISTROS de campo da área (Gradeação, Aplicação, Abastecimento…) na linha do
 * tempo do Detalhes do Lote (`LinhaDoTempo`, o filtro "Todos"). Não substitui o histórico de movimentação de animais, que
 * continua no "Histórico completo" do rodapé. "Carregar mais" pede a página seguinte ao servidor.
 *
 * D-PROD-266 (etapa 1): no pé do cartão (`acoes` da LinhaDoTempo), o "Excluir registro" — por baixo, o MESMO
 * cancelamento do apontamento do Lançamento de Atividades, com as mesmas condições (`podeCancelar` = ação extra
 * `cancelar_apontamento` de `op-atividades`; fuso da fazenda; atividade ABERTA; apontamento CONFIRMADO relido com a
 * `versao`). Só online. No mapa a pessoa só vê EXCLUSÃO (pedido do proprietário): o registro excluído SOME do histórico
 * na hora (sem chip "Cancelado"), e a releitura do servidor (que só lista CONFIRMADO) confirma.
 */

const TODOS = "todos";

/** @param {string|null|undefined} empresaId @param {string} id Mesma chave do detalhe da atividade na tela de atividades. */
const chaveDetalheAtividade = (empresaId, id) => [RAIZ_CONSULTAS_ATIVIDADES, "detalhe", empresaId ?? null, id];

/** @param {{ area: any, tipos: any[], podeCancelar?: boolean }} props */
export default function AbaRegistrosDaArea({ area, tipos, podeCancelar = false }) {
  const empresaId = useEmpresaRealSelecionadaId();
  definirFazendaDaTela(empresaId);
  const queryClient = useQueryClient();
  const { fusoOk, semFuso } = useFusoDaFazenda(podeCancelar ? empresaId : null);
  const online = useEstaOnline();
  const [filtro, setFiltro] = React.useState(TODOS);
  // Registros excluídos nesta tela: saem do histórico na hora, antes da releitura do servidor.
  const [excluidos, setExcluidos] = React.useState(() => /** @type {Set<string>} */ (new Set()));
  const [conferindo, setConferindo] = React.useState(/** @type {string|null} */ (null));
  const [cancelando, setCancelando] = React.useState(/** @type {{ registro: any, apontamento: any } | null} */ (null));

  const consulta = useInfiniteQuery({
    queryKey: [QUERY_ATIVIDADES_DA_AREA, "registros", empresaId, area.id, filtro],
    queryFn: ({ pageParam }) => listarRegistrosDaArea(String(area.id), { cursor: pageParam || null, limit: 20, tipo_atividade_id: filtro === TODOS ? null : filtro }),
    initialPageParam: /** @type {string|null} */ (null),
    getNextPageParam: (ultima) => ultima.next_cursor || undefined,
    enabled: Boolean(empresaId && area?.id),
    staleTime: 15 * 1000,
  });
  // O excluído (aqui ou já CANCELADO no servidor) não aparece: no mapa não há cartão de registro excluído.
  const itens = React.useMemo(
    () => (consulta.data?.pages ?? []).flatMap((p) => p.items).filter((r) => r && !excluidos.has(String(r.id)) && r.status !== STATUS_CANCELADO),
    [consulta.data, excluidos],
  );
  const dias = React.useMemo(() => diasDosRegistros(itens), [itens]);
  const opcoes = React.useMemo(
    () => [{ valor: TODOS, rotulo: "Todos" }, ...tipos.map((t) => ({ valor: String(t.id), rotulo: String(t.nome_tipo) }))],
    [tipos],
  );

  // O status de cada atividade da página (uma leitura por atividade, não por cartão): só a ABERTA aceita cancelar.
  const atividadeIds = React.useMemo(
    () => [...new Set(itens.map((r) => (r?.atividade_id == null ? "" : String(r.atividade_id))).filter(Boolean))],
    [itens],
  );
  const lerStatus = podeCancelar && fusoOk && Boolean(empresaId);
  const atividadesLidas = useQueries({
    queries: atividadeIds.map((id) => ({
      queryKey: chaveDetalheAtividade(empresaId, id),
      queryFn: () => obterAtividade(id),
      enabled: lerStatus,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const statusDaAtividade = React.useMemo(() => {
    /** @type {Map<string, string>} */
    const m = new Map();
    atividadeIds.forEach((id, i) => {
      const a = /** @type {any} */ (atividadesLidas[i]?.data);
      if (a && String(a.id) === id && typeof a.status === "string") m.set(id, a.status);
    });
    return m;
  }, [atividadeIds, atividadesLidas]);

  /** Releitura depois de uma exclusão (ou de uma recusa que pede reler): histórico, resumo, atividades e o mapa. */
  const relerTudo = () => {
    queryClient.invalidateQueries({ queryKey: [QUERY_ATIVIDADES_DA_AREA] });
    queryClient.invalidateQueries({ queryKey: [RAIZ_CONSULTAS_ATIVIDADES] });
    // A exclusão do registro leva junto os abastecimentos ligados a ele (D-PROD-211).
    queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ_ABASTECIMENTOS] });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  };

  /** @param {string} id */
  const marcarExcluido = (id) => setExcluidos((s) => (s.has(id) ? s : new Set([...s, id])));

  /** Relê o apontamento (status e `versao` do CAS) antes de abrir o diálogo. @param {any} r */
  const pedirCancelamento = async (r) => {
    if (conferindo || !online) return;
    const id = String(r.id);
    setConferindo(id);
    try {
      const ap = /** @type {any} */ (await obterApontamento(String(r.atividade_id), id));
      if (ap?.status === STATUS_CANCELADO) {
        marcarExcluido(id);
        notifyInfo("Já excluído", TEXTO_JA_EXCLUIDO);
        relerTudo();
      } else if (ap?.status !== STATUS_CONFIRMADO || ap?.versao == null) {
        notifyWarning("Atenção", "Não foi possível conferir este registro agora. Nada foi alterado.");
      } else {
        setCancelando({ registro: r, apontamento: ap });
      }
    } catch (erro) {
      notifyWarning("Atenção", mensagemDeErroDaExclusao(erro, "Não foi possível conferir o registro agora. Tente de novo."));
    } finally {
      setConferindo(null);
    }
  };

  /** O serviço confere o motivo (3 a 500 caracteres) ANTES da rede. @param {string} motivo */
  const enviarCancelamento = async (motivo) => {
    const alvo = cancelando;
    if (!alvo) return;
    // Ação definitiva: só online, nunca para a fila offline.
    if (!estaOnline()) {
      notifyWarning("Sem conexão", TEXTO_SEM_CONEXAO);
      throw Object.assign(new Error(TEXTO_SEM_CONEXAO), { code: "SEM_CONEXAO" });
    }
    const { registro, apontamento } = alvo;
    try {
      await cancelarApontamento(String(registro.atividade_id), String(registro.id), { versao: apontamento.versao, motivo });
      setCancelando(null);
      marcarExcluido(String(registro.id));
      notifySuccess("Registro excluído", `${descreverRegistro(registro)} excluído deste histórico.`);
      relerTudo();
    } catch (erro) {
      // Sem resposta: o diálogo mostra "resultado incerto" (consultar ou repetir); as listas se relêem.
      if (ehResultadoIncerto(erro)) {
        relerTudo();
        throw erro;
      }
      // O registro ou a atividade mudou no servidor (versao, status): a `versao` guardada neste diálogo ficou velha e
      // repetir daria a mesma recusa. Fecha o diálogo e pede para abrir de novo (o pedido relê o apontamento).
      if (pedeReleitura(erro)) {
        setCancelando(null);
        if (ehRegistroJaExcluido(erro)) {
          // Já excluído (por outra pessoa ou por um envio anterior): sai do histórico na hora, sem pedir nova exclusão.
          marcarExcluido(String(registro.id));
          notifyInfo("Já excluído", TEXTO_JA_EXCLUIDO);
        } else if (codigoDoErroAtividade(erro) === "ATIVIDADE_STATUS_INVALIDO") {
          // Atividade (ou área) fora do status que aceita exclusão: abrir de novo daria a mesma recusa.
          notifyWarning("Não foi possível excluir", mensagemDeErroDaExclusao(erro, TEXTO_FALHA_NA_EXCLUSAO));
        } else {
          notifyWarning(
            "O registro mudou",
            `${mensagemDeErroDaExclusao(erro, "O registro mudou no servidor.")} Nada foi excluído. Abra a exclusão de novo para conferir.`,
          );
        }
        relerTudo();
        return;
      }
      notifyWarning("Atenção", mensagemDeErroDaExclusao(erro, TEXTO_FALHA_NA_EXCLUSAO));
      throw erro;
    }
  };

  /** "Consultar" depois de uma exclusão sem resposta: relê o apontamento no servidor. */
  const consultarCancelamento = async () => {
    const alvo = cancelando;
    if (!alvo) return;
    try {
      const ap = /** @type {any} */ (await obterApontamento(String(alvo.registro.atividade_id), String(alvo.registro.id)));
      if (ap?.status === STATUS_CANCELADO) {
        setCancelando(null);
        marcarExcluido(String(alvo.registro.id));
        notifySuccess("Registro excluído", "O registro aparece excluído: o envio anterior foi gravado.");
        relerTudo();
      } else {
        notifyInfo("Ainda não excluído", "A exclusão não aparece gravada. Pode repetir o envio: se ela já tiver sido gravada, o servidor recusa sem mudar nada.");
      }
    } catch (erro) {
      notifyWarning("Atenção", mensagemDeErroDaExclusao(erro, "Não foi possível consultar agora. Tente de novo."));
    }
  };

  const porId = React.useMemo(() => new Map(itens.map((r) => [String(r.id), r])), [itens]);
  // O pé de ações de cada cartão (sem `acoes`, o cartão fica como antes). O excluído já saiu de `itens`.
  const diasComAcoes = dias.map((dia) => ({
    ...dia,
    cartoes: dia.cartoes.map((c) => {
      const r = porId.get(c.chave);
      if (!r || r.atividade_id == null) return c;
      const estado = estadoDoCancelamento({ permitido: podeCancelar, semFuso, fusoOk, online, statusAtividade: statusDaAtividade.get(String(r.atividade_id)) });
      if (!estado) return c;
      return {
        ...c,
        acoes: <BotaoCancelarRegistro registroId={c.chave} descricao={descreverRegistro(r)} estado={estado} conferindo={conferindo === c.chave} onClick={() => pedirCancelamento(r)} />,
      };
    }),
  }));

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
        <p className="mk-dp-hist__detalhe">{textoSemCancelamento(getApiErrorMessage(consulta.error, "Tente novamente em instantes."), "Tente novamente em instantes.")}</p>
        <button type="button" className="mk-dp-hist__botao" onClick={() => consulta.refetch()}>
          Tentar novamente
        </button>
      </div>
    );
  } else if (dias.length) {
    conteudo = <LinhaDoTempo textoAutomatico dias={diasComAcoes} rotulo="Registros de campo da área" />;
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
      {cancelando ? (
        <DialogoCancelarRegistro
          key={`cancelar-${cancelando.registro.id}-${cancelando.apontamento.versao}`}
          registro={cancelando.registro}
          online={online}
          onFechar={() => setCancelando(null)}
          onEnviar={enviarCancelamento}
          onConsultar={consultarCancelamento}
        />
      ) : null}
    </div>
  );
}
