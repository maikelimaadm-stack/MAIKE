import React from "react";
import { History } from "lucide-react";
import HistoricoAbateCurral from "./HistoricoAbateCurral";
import HistoricoMovimentacoes from "../lotes/HistoricoMovimentacoes";
import { LancLoteDialogo } from "../lotes/LancamentoLoteUi";
import { ehCurral, podeMedirForragemNaArea, podeVerHistoricoDaArea } from "@/domain/mapa/cliqueArea";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import PainelForragemArea from "../pastagem/PainelForragemArea";
import CascaDetalhe from "./detalhes-lote/CascaDetalhe";
import AbaHistorico from "./detalhes-lote/AbaHistorico";
import { Abas, RodapePilulas, TituloBloco, idsDaAba } from "./detalhes-lote/blocos";
import { PastoCtx, useModoPasto } from "./detalhes-lote/pastoContexto";

/**
 * Detalhes da área no Mapa Geral (D-PROD-94a), no desenho do Detalhes do Lote
 * v12 (D-PROD-220): o clique no contorno continua abrindo o "Histórico da
 * Área" — a MESMA linha do tempo da aba Histórico do pasto (`AbaHistorico`:
 * filtro "Mostrar", "Carregar mais", aviso offline), só leitura, consultando o
 * servidor pela área (origem, destino ou local), sem depender de lote presente.
 * Área vazia não perde histórico.
 *
 * - Pasto (fora da infraestrutura) com a chave `medir_forragem` (D-PROD-219):
 *   o painel Forragem (botão "Medição de Forragem" e as últimas medições) em
 *   cima e, com a permissão, o histórico embaixo. Cabeçalho = área e setor.
 * - Sem a chave: cabeçalho "Histórico da Área" com "Pasto 07 · Retiro" (área ·
 *   setor), como as telas de histórico do v12.
 * - Curral: abas Abate · Histórico da Área (v12). O abate continua o histórico
 *   de abate de hoje (`HistoricoAbateCurral`); são fatos de naturezas
 *   diferentes e nenhum é copiado para o outro.
 *
 * Com a permissão de histórico, o rodapé tem a pílula "Histórico completo": o
 * Histórico de Movimentação da área de hoje (`HistoricoMovimentacoes`, lotes=[]),
 * num diálogo por cima, como o "Manejos e históricos" do pasto (D-PROD-218). É
 * lá que ficam o "Excluir movimentação" do administrador (D-PROD-110) e os
 * dados de auditoria que a linha do tempo resumida não traz (registrado em,
 * observações, cancelado em … por …, vínculo pelo nome, lote excluído, nutrição).
 *
 * `areas` (as do mapa) dão o nome da outra área quando o registro antigo gravou
 * o nome vazio, como no histórico completo.
 *
 * @param {{ area: any, permissions?: Record<string, any>, setorNome?: string, eventosSuplementacao?: any[] | null, areas?: Array<{ id?: string, nome?: string }> }} props
 */
export default function DetalhesArea({ area, permissions, setorNome = "", eventosSuplementacao = null, areas = SEM_AREAS }) {
  const curral = ehCurral(area);
  const historicoDaArea = podeVerHistoricoDaArea(permissions);
  const forragem = podeMedirForragemNaArea(permissions, area);
  const [aba, setAba] = React.useState(curral ? "abate" : "historico");
  const [anim, setAnim] = React.useState(/** @type {"aba-dir" | "aba-esq" | null} */ (null));
  const [completoAberto, setCompletoAberto] = React.useState(false);

  if (!area?.id || (!curral && !historicoDaArea && !forragem)) return null;

  const historico = <HistoricoDaArea area={area} setorNome={setorNome} eventos={eventosSuplementacao} areas={areas} />;

  // Histórico completo da área (com o "Excluir movimentação" do administrador), por cima.
  const rodape = historicoDaArea ? (
    <RodapePilulas
      itens={[
        {
          chave: "completo",
          rotulo: "Histórico completo",
          icone: History,
          onClick: () => setCompletoAberto(true),
          title: area.nome ? `Histórico completo da área: ${area.nome}` : "Histórico completo da área",
        },
      ]}
      rotulo="Ações da área"
    />
  ) : null;
  const completo = historicoDaArea ? (
    <LancLoteDialogo open={completoAberto} onOpenChange={setCompletoAberto} titulo="Histórico da Área" largo somenteLeitura>
      {completoAberto ? <HistoricoMovimentacoes lotes={[]} areaId={area.id} /> : null}
    </LancLoteDialogo>
  ) : null;

  if (!curral) {
    if (forragem) {
      return (
        <>
          <CascaDetalhe titulo={area.nome || "Pasto"} sub={setorNome} rodape={rodape}>
            <PainelForragemArea area={area} />
            {historicoDaArea ? (
              <>
                <TituloBloco>Histórico da área</TituloBloco>
                {historico}
              </>
            ) : null}
          </CascaDetalhe>
          {completo}
        </>
      );
    }
    return (
      <>
        <CascaDetalhe titulo="Histórico da Área" sub={[area.nome, setorNome].filter(Boolean).join(" · ")} rodape={rodape}>
          {historico}
        </CascaDetalhe>
        {completo}
      </>
    );
  }

  const titulo = area.nome || "Histórico da Área";
  const abate = <HistoricoAbateCurral areaId={area.id} />;
  if (!historicoDaArea) {
    return (
      <CascaDetalhe titulo={titulo} sub={setorNome}>
        {abate}
      </CascaDetalhe>
    );
  }

  const idBase = `area-${area.id}`;
  const ids = idsDaAba(idBase, aba);
  /** @param {string} nova */
  const irAba = (nova) => {
    if (nova === aba) return;
    setAnim(nova === "historico" ? "aba-dir" : "aba-esq");
    setAba(nova);
  };
  return (
    <>
    <CascaDetalhe
      titulo={titulo}
      sub={setorNome}
      chaveTela={`aba:${aba}`}
      anim={anim}
      rodape={rodape}
      cabecalhoDoCorpo={
        <Abas
          abas={[
            { id: "abate", rotulo: "Abate" },
            { id: "historico", rotulo: "Histórico da Área" },
          ]}
          ativa={aba}
          onMudar={irAba}
          idBase={idBase}
          rotulo="Seções do curral"
        />
      }
      propsDoCorpo={{ role: "tabpanel", id: ids.painel, "aria-labelledby": ids.aba }}
    >
      {aba === "abate" ? abate : historico}
    </CascaDetalhe>
    {completo}
    </>
  );
}

/** @type {Array<{ id?: string, nome?: string }>} */
const SEM_AREAS = [];

/**
 * A aba Histórico do pasto lê tudo da casca (`usePasto().dados`): aqui ela
 * recebe só a área (sem lotes, sem permissões de manejo — é só leitura).
 * @param {{ area: any, setorNome: string, eventos: any[] | null, areas: Array<{ id?: string, nome?: string }> }} props
 */
function HistoricoDaArea({ area, setorNome, eventos, areas }) {
  const empresaId = useEmpresaSelecionadaId();
  const modo = useModoPasto();
  const valor = React.useMemo(() => {
    const nada = () => {};
    return /** @type {import("./detalhes-lote/pastoContexto").Pasto} */ ({
      modo,
      modelo: null,
      dados: {
        areaId: area.id,
        areaNome: area.nome || "",
        setorNome,
        lotesDoPasto: [],
        movimentacoes: [],
        empresaId: empresaId || null,
        suplementacao: Array.isArray(eventos) ? { pontos: [], eventos, hoje: null } : null,
        onAbrirCocho: null,
        tipoLocal: "area",
        areas,
      },
      permissoes: { mover: false, pesar: false, historico: true, supl: false, detalhesCocho: false, lancarSupl: false, historicoCocho: false },
      escopoPreferencias: null,
      empurrar: nada,
      voltar: nada,
      selecao: new Set(),
      alternarSelecao: nada,
      definirSelecao: nada,
      slotRodape: null,
      marcarRodapeProprio: nada,
    });
  }, [modo, area.id, area.nome, setorNome, empresaId, eventos, areas]);
  return (
    <PastoCtx.Provider value={valor}>
      <AbaHistorico />
    </PastoCtx.Provider>
  );
}
