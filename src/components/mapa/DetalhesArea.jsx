import React from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import HistoricoAbateCurral from "./HistoricoAbateCurral";
import HistoricoMovimentacoes from "../lotes/HistoricoMovimentacoes";
import { LancLoteDialogo } from "../lotes/LancamentoLoteUi";
import { ehCurral, podeMedirForragemNaArea, podeVerHistoricoDaArea } from "@/domain/mapa/cliqueArea";
import CascaDetalhe from "./detalhes-lote/CascaDetalhe";
import AbaDetalhesDaArea from "./detalhes-area/AbaDetalhesDaArea";
import PainelForragemArea from "@/components/pastagem/PainelForragemArea";
import { Abas, RodapePilulas, idsDaAba } from "./detalhes-lote/blocos";

/**
 * Detalhes da área no Mapa Geral (D-PROD-94a, D-PROD-220, D-PROD-254), no desenho do Detalhes do Lote: cabeçalho com o
 * nome da área e o setor, abas, corpo que rola e rodapé de pílulas; no celular, a folha de tela cheia do diálogo.
 *
 * - Detalhes: o cartão da área e, com a chave `medir_forragem` (D-PROD-219, fora da infraestrutura), a aba Forragem.
 * - Curral: a aba Abate de antes (`HistoricoAbateCurral`), à parte: são fatos de natureza diferente.
 * - Rodapé: "Histórico completo" (com a permissão de histórico de movimentação) é o Histórico de Movimentação, com o
 *   "Excluir movimentação" do administrador (D-PROD-110), num diálogo por cima.
 * - D-PROD-383: as atividades saíram (para recomeçar do zero) e, com elas, as abas Manejos e Custos, os registros de campo
 *   ("Já feito") e a pílula "Manejos" que abria o Diário das atividades.
 *
 * @param {{ area: any, permissions?: Record<string, any>, setorNome?: string, eventosSuplementacao?: any[] | null, areas?: Array<{ id?: string, nome?: string }>, ocupada?: boolean | null }} props
 *   `eventosSuplementacao` e `areas` seguem na assinatura por compatibilidade (o histórico completo lê o servidor).
 */
export default function DetalhesArea({ area, permissions, setorNome = "", ocupada = null }) {
  const curral = ehCurral(area);
  const historicoDaArea = podeVerHistoricoDaArea(permissions);
  const forragem = podeMedirForragemNaArea(permissions, area);
  const [aba, setAba] = React.useState("detalhes");
  const [anim, setAnim] = React.useState(/** @type {"aba-dir" | "aba-esq" | "empurrar" | "voltar" | null} */ (null));
  const [completoAberto, setCompletoAberto] = React.useState(false);

  if (!area?.id) return null;

  const abas = [
    { id: "detalhes", rotulo: "Detalhes" },
    ...(forragem ? [{ id: "forragem", rotulo: "Forragem" }] : []),
    ...(curral ? [{ id: "abate", rotulo: "Abate" }] : []),
  ];
  const abaAtual = abas.some((a) => a.id === aba) ? aba : "detalhes";
  const ordem = abas.map((a) => a.id);
  /** @param {string} nova */
  const irAba = (nova) => {
    if (nova === abaAtual) return;
    setAnim(ordem.indexOf(nova) > ordem.indexOf(abaAtual) ? "aba-dir" : "aba-esq");
    setAba(nova);
  };

  /** @type {import("./detalhes-lote/blocos").Pilula[]} */
  const pilulas = [];
  if (historicoDaArea) {
    pilulas.push({
      chave: "completo",
      rotulo: "Histórico completo",
      icone: History,
      onClick: () => setCompletoAberto(true),
      title: area.nome ? `Histórico completo da área: ${area.nome}` : "Histórico completo da área",
    });
  }
  const rodape = pilulas.length ? <RodapePilulas itens={pilulas} rotulo="Ações da área" /> : null;

  // Histórico completo da área (movimentação de animais, com o "Excluir movimentação" do administrador), por cima.
  const completo = historicoDaArea ? (
    <LancLoteDialogo open={completoAberto} onOpenChange={setCompletoAberto} titulo="Histórico da Área" largo somenteLeitura>
      {/* Sem condição: fechado, o Radix não monta o conteúdo (nem consulta). */}
      <HistoricoMovimentacoes lotes={[]} areaId={area.id} />
    </LancLoteDialogo>
  ) : null;

  const idBase = `area-${area.id}`;
  const ids = idsDaAba(idBase, abaAtual);
  let corpo;
  if (abaAtual === "forragem") corpo = <PainelForragemArea area={area} />;
  else if (abaAtual === "abate") corpo = <HistoricoAbateCurral areaId={area.id} />;
  else corpo = <AbaDetalhesDaArea area={area} ocupada={ocupada} />;

  return (
    <>
      <CascaDetalhe
        titulo={area.nome || "Detalhes da Área"}
        sub={setorNome}
        chaveTela={`aba:${abaAtual}`}
        anim={anim}
        rodape={rodape}
        cabecalhoDoCorpo={abas.length > 1 ? <Abas abas={abas} ativa={abaAtual} onMudar={irAba} idBase={idBase} rotulo="Seções da área" /> : null}
        propsDoCorpo={abas.length > 1 ? { role: "tabpanel", id: ids.painel, "aria-labelledby": ids.aba } : undefined}
      >
        {corpo}
      </CascaDetalhe>
      {completo}
    </>
  );
}
