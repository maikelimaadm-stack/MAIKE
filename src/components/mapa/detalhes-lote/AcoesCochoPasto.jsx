import React from "react";
import { ClipboardCheck, History } from "lucide-react";
import IconeLancarSuplementacao from "../IconeLancarSuplementacao";
import { useQueryClient } from "@tanstack/react-query";
import { hojeNoFuso } from "@/lib/diaCivil";
import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import FormularioLancamentoSuplementacao from "@/components/suplementacao/FormularioLancamentoSuplementacao";
import FormularioLeituraCocho from "@/components/suplementacao/FormularioLeituraCocho";
import HistoricoSuplementacaoPonto from "@/components/suplementacao/HistoricoSuplementacaoPonto";
import { getMapaCachedData } from "@/services/mapaCacheService";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { RodapePilulas } from "./blocos";

/*
 * Rodapé da aba Suplementação quando o pasto tem cocho (Detalhes do Lote v12,
 * D-PROD-218): Lançar · Leitura · Histórico do cocho
 * dos números da aba (o primeiro por nome).
 *
 * Abre os MESMOS formulários e o MESMO histórico do detalhe do cocho
 * (`src/components/mapa/DetalhesPontoSuplementacao.jsx`), com a mesma fiação e
 * o mesmo refresh depois de salvar:
 *  - Lançar: `FormularioLancamentoSuplementacao` no mesmo `LancLoteDialogo`
 *    "Lançar Suplementação" (subtítulo = o cocho, largo), como o lançamento de
 *    manejo (D-PROD-222); ao sair, invalida as consultas do cocho e dispara
 *    `atualizar-mapa`;
 *  - Leitura: `FormularioLeituraCocho` em `LancLoteDialogo` "Leitura de Cocho";
 *    depois de salvar relê o cache `leiturasCocho` (D-PROD-205);
 *  - Histórico: `HistoricoSuplementacaoPonto` em `LancLoteDialogo` "Histórico de
 *    Suplementação" (largo, só leitura), com o nível do SSOT.
 * Permissões (as mesmas chaves do detalhe): Lançar e Leitura com
 * `lancar_suplementacao`; Histórico com `visualizar_historico_cocho`.
 */

/**
 * @param {{
 *   ponto: any,
 *   nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelCocho | null,
 *   hoje?: string | null,
 *   podeLancar: boolean,
 *   podeHistorico: boolean,
 * }} props
 *   `hoje`: dia civil da fazenda (AAAA-MM-DD), o mesmo do mapa; sem ele, o
 *   relógio do navegador (como `useDiaCivil(null)`).
 */
export default function AcoesCochoPasto({ ponto, nivel, hoje = null, podeLancar, podeHistorico }) {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const queryClient = useQueryClient();
  const [showLancamento, setShowLancamento] = React.useState(false);
  const [showLeitura, setShowLeitura] = React.useState(false);
  const [showHistorico, setShowHistorico] = React.useState(false);
  const nome = String(ponto?.nome_ponto ?? "").trim();

  // Mesmo refresh do detalhe do cocho depois do lançamento.
  const handleSaved = () => {
    queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["eventos-ponto", "mapa-eventos-supl", "mapa-pontos-supl", "pontos", "pontos-suplementacao"].includes(query.queryKey[0]) });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  };

  /** D-PROD-205: depois de registrar a leitura, a aba e o marcador releem o cache. @param {any} lista */
  const leiturasAtualizadas = (lista) => {
    if (Array.isArray(lista)) queryClient.setQueryData(["mapa-cache", "leiturasCocho", empresaSelecionadaId, "default"], lista);
    queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "mapa-cache" && query.queryKey[1] === "leiturasCocho" });
    window.dispatchEvent(new CustomEvent("atualizar-mapa", { detail: { cacheKeys: ["leiturasCocho"] } }));
  };

  /** @type {Array<{ chave: string, rotulo: string, icone: import("lucide-react").LucideIcon, onClick: () => void, title: string }>} */
  const itens = [];
  if (podeLancar) {
    itens.push({ chave: "lancar", rotulo: "Lançar", icone: IconeLancarSuplementacao, onClick: () => setShowLancamento(true), title: nome ? `Lançar suplementação: ${nome}` : "Lançar suplementação" });
    itens.push({ chave: "leitura", rotulo: "Leitura", icone: ClipboardCheck, onClick: () => setShowLeitura(true), title: nome ? `Leitura de cocho: ${nome}` : "Leitura de cocho" });
  }
  if (podeHistorico) {
    itens.push({ chave: "historico", rotulo: "Histórico", icone: History, onClick: () => setShowHistorico(true), title: nome ? `Histórico de Suplementação: ${nome}` : "Histórico de Suplementação" });
  }
  if (!ponto || !itens.length) return null;

  return (
    <>
      <RodapePilulas itens={itens} rotulo="Ações do cocho" />

      {podeLancar ? (
        <LancLoteDialogo open={showLancamento} onOpenChange={setShowLancamento} titulo="Lançar Suplementação" lotes={[{ nome: ponto.nome_ponto }]} largo>
          {showLancamento ? (
            <FormularioLancamentoSuplementacao
              ponto={ponto}
              cicloCompartilhado={nivel?.confiabilidade === "compartilhada"}
              onCancel={() => {
                setShowLancamento(false);
                handleSaved();
              }}
            />
          ) : null}
        </LancLoteDialogo>
      ) : null}

      {podeLancar ? (
        <LancLoteDialogo open={showLeitura} onOpenChange={setShowLeitura} titulo="Leitura de Cocho" lotes={[{ nome: ponto.nome_ponto }]}>
          {showLeitura ? (
            <FormularioLeituraCocho
              ponto={ponto}
              hoje={hoje || nivel?.hoje || hojeNoFuso(null)}
              onCancel={() => setShowLeitura(false)}
              onSaved={async () => {
                setShowLeitura(false);
                leiturasAtualizadas(await getMapaCachedData("leiturasCocho", empresaSelecionadaId));
              }}
            />
          ) : null}
        </LancLoteDialogo>
      ) : null}

      {podeHistorico ? (
        <LancLoteDialogo open={showHistorico} onOpenChange={setShowHistorico} titulo="Histórico de Suplementação" lotes={nome ? [{ nome }] : undefined} largo somenteLeitura>
          <HistoricoSuplementacaoPonto pontoId={ponto.id} pontoNome={ponto.nome_ponto} ponto={ponto} nivel={nivel} />
        </LancLoteDialogo>
      ) : null}
    </>
  );
}
