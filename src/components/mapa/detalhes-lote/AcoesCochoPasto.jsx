import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ClipboardCheck, History, Package } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
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
 * D-PROD-V12 — número definitivo no PR): Lançar · Leitura · Histórico do cocho
 * dos números da aba (o primeiro por nome).
 *
 * Abre os MESMOS formulários e o MESMO histórico do detalhe do cocho
 * (`src/components/mapa/DetalhesPontoSuplementacao.jsx`), com a mesma fiação e
 * o mesmo refresh depois de salvar:
 *  - Lançar: `FormularioLancamentoSuplementacao` no mesmo diálogo (classes do
 *    `DialogContent` do detalhe, montado com os primitivos do Radix); ao sair,
 *    invalida as consultas do cocho e dispara `atualizar-mapa`;
 *  - Leitura: `FormularioLeituraCocho` em `LancLoteDialogo` "Leitura de Cocho";
 *    depois de salvar relê o cache `leiturasCocho` (D-PROD-205);
 *  - Histórico: `HistoricoSuplementacaoPonto` em `LancLoteDialogo` "Histórico de
 *    Suplementação" (largo, só leitura), com o nível do SSOT.
 * Permissões (as mesmas chaves do detalhe): Lançar e Leitura com
 * `lancar_suplementacao`; Histórico com `visualizar_historico_cocho`.
 */

/** Classes do `DialogContent` (`ui/dialog`) com as do detalhe do cocho. */
const CLASSES_DIALOGO_LANCAMENTO = cn(
  "fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-1rem)] max-h-[90vh] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-x-hidden overflow-y-auto border bg-background p-3 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:w-full sm:rounded-lg sm:p-6",
  "mk-map-dialog max-w-[880px] max-h-[90vh] overflow-y-auto overflow-x-hidden",
);
const CLASSES_VEU_LANCAMENTO =
  "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";
const CLASSES_FECHAR_LANCAMENTO =
  "absolute right-3 top-3 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground sm:right-4 sm:top-4";

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
    itens.push({ chave: "lancar", rotulo: "Lançar", icone: Package, onClick: () => setShowLancamento(true), title: nome ? `Lançar suplementação: ${nome}` : "Lançar suplementação" });
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
        <DialogPrimitive.Root open={showLancamento} onOpenChange={setShowLancamento}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className={CLASSES_VEU_LANCAMENTO} />
            <DialogPrimitive.Content className={CLASSES_DIALOGO_LANCAMENTO} aria-describedby={undefined}>
              <DialogPrimitive.Title className="sr-only">{nome ? `Lançar Suplementação - ${nome}` : "Lançar Suplementação"}</DialogPrimitive.Title>
              <FormularioLancamentoSuplementacao
                ponto={ponto}
                cicloCompartilhado={nivel?.confiabilidade === "compartilhada"}
                onCancel={() => {
                  setShowLancamento(false);
                  handleSaved();
                }}
              />
              <DialogPrimitive.Close className={CLASSES_FECHAR_LANCAMENTO}>
                <span className="sr-only">Fechar</span>
              </DialogPrimitive.Close>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      ) : null}

      {podeLancar ? (
        <LancLoteDialogo open={showLeitura} onOpenChange={setShowLeitura} titulo="Leitura de Cocho">
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
        <LancLoteDialogo open={showHistorico} onOpenChange={setShowHistorico} titulo="Histórico de Suplementação" largo somenteLeitura>
          <HistoricoSuplementacaoPonto pontoId={ponto.id} pontoNome={ponto.nome_ponto} ponto={ponto} nivel={nivel} />
        </LancLoteDialogo>
      ) : null}
    </>
  );
}
