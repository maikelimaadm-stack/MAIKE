import React from "react";
import HistoricoAbateCurral from "./HistoricoAbateCurral";
import { ehCurral, podeVerHistoricoDaArea } from "@/domain/mapa/cliqueArea";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import CascaDetalhe from "./detalhes-lote/CascaDetalhe";
import AbaHistorico from "./detalhes-lote/AbaHistorico";
import { Abas, idsDaAba } from "./detalhes-lote/blocos";
import { PastoCtx, useModoPasto } from "./detalhes-lote/pastoContexto";

/**
 * Detalhes da área no Mapa Geral (D-PROD-94a), no desenho do Detalhes do Lote
 * v12 (D-PROD-220): o clique no contorno continua abrindo o "Histórico da
 * Área" — a MESMA linha do tempo da aba Histórico do pasto (`AbaHistorico`:
 * filtro "Mostrar", "Carregar mais", aviso offline), só leitura, consultando o
 * servidor pela área (origem, destino ou local), sem depender de lote presente.
 * Área vazia não perde histórico.
 *
 * Curral: abas Abate · Histórico da Área (v12). O abate continua o histórico de
 * abate de hoje (`HistoricoAbateCurral`); são fatos de naturezas diferentes e
 * nenhum é copiado para o outro.
 *
 * Cabeçalho: área comum = "Histórico da Área" com "Pasto 07 · Retiro" (área ·
 * setor), como as telas de histórico do v12; curral = nome da área e setor
 * (as abas dizem o que é cada parte).
 *
 * @param {{ area: any, permissions?: Record<string, any>, setorNome?: string, eventosSuplementacao?: any[] | null }} props
 */
export default function DetalhesArea({ area, permissions, setorNome = "", eventosSuplementacao = null }) {
  const curral = ehCurral(area);
  const historicoDaArea = podeVerHistoricoDaArea(permissions);
  const [aba, setAba] = React.useState(curral ? "abate" : "historico");
  const [anim, setAnim] = React.useState(/** @type {"aba-dir" | "aba-esq" | null} */ (null));

  if (!area?.id || (!curral && !historicoDaArea)) return null;

  const titulo = area.nome || "Histórico da Área";
  const historico = <HistoricoDaArea area={area} setorNome={setorNome} eventos={eventosSuplementacao} />;

  if (!curral) {
    return (
      <CascaDetalhe titulo="Histórico da Área" sub={[area.nome, setorNome].filter(Boolean).join(" · ")}>
        {historico}
      </CascaDetalhe>
    );
  }

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
    <CascaDetalhe
      titulo={titulo}
      sub={setorNome}
      chaveTela={`aba:${aba}`}
      anim={anim}
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
  );
}

/**
 * A aba Histórico do pasto lê tudo da casca (`usePasto().dados`): aqui ela
 * recebe só a área (sem lotes, sem permissões de manejo — é só leitura).
 * @param {{ area: any, setorNome: string, eventos: any[] | null }} props
 */
function HistoricoDaArea({ area, setorNome, eventos }) {
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
  }, [modo, area.id, area.nome, setorNome, empresaId, eventos]);
  return (
    <PastoCtx.Provider value={valor}>
      <AbaHistorico />
    </PastoCtx.Provider>
  );
}
