import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, CircleCheck, X } from "lucide-react";
import { NavegacaoDoRegistro, useNavegacaoDoRegistro } from "@/components/cadastro/base1/registroNavBase1";
import { useCelular } from "@/components/common/MobileSheet";
import { Selo } from "@/components/financeiroGestao/ConsultaLancamento";
import ListaApontamentos from "@/components/lancamento-atividades/ListaApontamentos";
import TotalizadorAtividade from "@/components/lancamento-atividades/TotalizadorAtividade";
import FluxoPorArea from "@/components/lancamento-atividades/FluxoPorArea";
import ResumoDasAreas from "@/components/lancamento-atividades/ResumoDasAreas";
import { useAuth } from "@/lib/AuthContext";
import { temAreas } from "@/lib/atividadeAreasRegras";
import { chaveApontamentos, itensDaLista, RAIZ_CONSULTAS_ATIVIDADES } from "@/lib/atividadeApontamentoRegras";
import { chaveTotais, flagsDoTipoDaAtividade } from "@/lib/atividadeLinhasRegras";
import { CHAVE_DO_SELO_ATIVIDADE, STATUS_ABERTA, formatarAreaExecutadaPlanejada } from "@/lib/lancamentoAtividadesRegras";
import { situacaoDaAtividade } from "@/lib/atividadeFluxoCampo";
import { listarApontamentos, listarTiposAtividade, obterTotaisAtividade } from "@/services/lancamentoAtividadesService";

/** Texto auxiliar (o tom das notas dos formulários do motor). */
const NOTA = "min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";

/** As abas da atividade aberta: os lançamentos (a tabela de áreas e a de cada área), o Resumo das áreas (D-PROD-252) e o Resumo da atividade. */
const ABAS = Object.freeze([
  { id: "lancamentos", rotulo: "Lançamentos" },
  { id: "areas", rotulo: "Resumo das áreas" },
  { id: "resumo", rotulo: "Resumo da atividade" },
]);

/**
 * A atividade ABERTA, reorganizada na D-PROD-252 (sobre o desenho do protótipo, D-PROD-234), no modelo visual do sistema
 * (`b1-aba-cartao`, abas `b1-panel-tab`, a tabela `b1-tipo-tabela` e o ⚡):
 *
 *  - abas **Lançamentos**, **Resumo das áreas** e **Resumo da atividade**, com a navegação ‹‹ ‹ n/N › ›› do registro na mesma
 *    linha (a do motor, `NavegacaoDoRegistro`, na ordem da lista); no celular a navegação fica no rodapé, como sempre;
 *  - **Lançamentos** (`FluxoPorArea`): uma linha de resumo no alto e UMA tabela de áreas; o nome da área abre a área, com os
 *    botões "+" e UMA tabela de lançamentos (`LancamentosDaArea`). Saíram os cartões de custo, a tabela por tipo, os
 *    "Dias lançados" e o "Ajustar um dia": o Editar e o Cancelar são do ⚡ de cada linha da área;
 *  - **Resumo das áreas** (`ResumoDasAreas`): o custo por tipo de cada área, do `por_area` dos totais;
 *  - **Resumo da atividade**: os totais com o detalhe por item (`TotalizadorAtividade`) e os dados da atividade, só leitura.
 *
 * As abas ficam montadas (a escondida com `hidden`): trocar de aba não perde a tela em que a pessoa está. No celular: a
 * cabeça com ✕, o nome, o status, "Nº · área" e o Concluir.
 *
 * @param {{
 *   atividade: any,
 *   empresaId: string|null,
 *   acoes: Record<string, any>,
 *   habilitado: boolean,
 *   cabecalho: React.ReactNode,
 *   avisos?: React.ReactNode,
 *   onAtividadeAtualizada: (atividade: any) => void,
 *   onLancar: (tipo: string, aba: 'lista'|'dados', atividadeAreaId?: string|null) => void,
 *   onGravouAbastecimento?: (recado: { texto: string, areaId: string|null, nomeArea: string, nomeAtividade: string }) => void,
 *   onFechar: () => void,
 *   onConcluir?: (() => void) | null,
 *   recado?: { texto: string, areaId: string|null, nomeArea: string, nomeAtividade: string } | null,
 *   onLimparRecado?: () => void,
 * }} props `acoes`: as dos lançamentos (já com o status, a permissão e o fuso); `onLancar`: abre a janela do lançamento
 *   sobre esta atividade, presa na área. `onConcluir`: o Concluir da cabeça do celular (null = sem o botão).
 */
export default function AtividadeAberta({ atividade, empresaId, acoes, habilitado, cabecalho, avisos = null, onAtividadeAtualizada, onLancar, onFechar, onConcluir = null, recado = null, onLimparRecado = () => {}, onGravouAbastecimento = () => {} }) {
  const celular = useCelular();
  const { clienteId } = useAuth();
  const id = atividade?.id ? String(atividade.id) : null;
  const [aba, setAba] = useState(/** @type {'lancamentos'|'areas'|'resumo'} */ ("lancamentos"));
  // O ajuste de um dia (o lançamento do dia: área do dia, operador, observação; repetir e cancelar o dia) não é um caminho
  // do dia a dia: fica recolhido no "Resumo da atividade" (D-PROD-252).
  const [diasAbertos, setDiasAbertos] = useState(false);
  const comAreas = temAreas(atividade);
  // Escopo da pendência de `operation_id` (cliente e login): o mesmo da lista de lançamentos.
  const escopo = `${clienteId || "sem-tenant"}:${acoes?.login || "sem-login"}`;
  // ‹ › do registro na linha das abas (computador e tablet); no celular, no rodapé da casca.
  const navInfo = useNavegacaoDoRegistro(!celular);
  // O contêiner do registro no modo do design com abas (como `Base1PanelTabs`): abas fora, cartões sobre o fundo.
  const raizRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  useLayoutEffect(() => {
    const scroll = raizRef.current?.closest(".mg-form-scroll");
    if (!scroll) return undefined;
    scroll.classList.add("b1-form--abas-fora");
    return () => scroll.classList.remove("b1-form--abas-fora");
  }, []);

  const podeVer = acoes?.ver === true;
  const totaisQuery = useQuery({
    queryKey: chaveTotais(empresaId, id),
    queryFn: () => obterTotaisAtividade(/** @type {string} */ (id)),
    enabled: Boolean(habilitado && empresaId && id),
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  });
  const apontamentosQuery = useQuery({
    queryKey: chaveApontamentos(empresaId, id),
    queryFn: () => listarApontamentos(/** @type {string} */ (id)),
    enabled: Boolean(habilitado && empresaId && id && podeVer),
    staleTime: 15 * 1000,
  });
  const { data: tipos = [] } = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "tipos"],
    queryFn: () => listarTiposAtividade(),
    enabled: podeVer,
    staleTime: 30 * 1000,
  });
  const totais = /** @type {Record<string, any> | null} */ (totaisQuery.data ?? null);
  const itens = useMemo(() => itensDaLista(apontamentosQuery.data), [apontamentosQuery.data]);
  const flags = flagsDoTipoDaAtividade(atividade, /** @type {any[]} */ (tipos));
  const lendoTotais = totaisQuery.isPending && totaisQuery.fetchStatus !== "idle";
  const lendoLinhas = apontamentosQuery.isPending && apontamentosQuery.fetchStatus !== "idle";

  const aberta = atividade?.status === STATUS_ABERTA;
  const podeLancar = aberta && acoes?.lancarApontamento === true;
  const podeGerirAreas = aberta && acoes?.editar === true && habilitado;

  // ─── Cabeça do celular (protótipo: ✕, nome, status, "Nº · área" e o Concluir) ───────────────
  const cabecaCelular = celular ? (
    <div className="b1-aberta-cab" data-testid="atividade-cabeca-celular">
      <button type="button" className="tb-btn tb-btn-icon b1-aberta-cab__fechar" aria-label="Voltar para a lista" title="Voltar para a lista" onClick={onFechar} data-testid="atividade-fechar-celular">
        <X className="h-4 w-4" aria-hidden />
      </button>
      <div className="b1-aberta-cab__texto">
        <p className="b1-aberta-cab__nome">{String(atividade?.nome ?? "")}</p>
        <p className="b1-aberta-cab__linha">
          <Selo status={CHAVE_DO_SELO_ATIVIDADE[String(atividade?.status ?? "")] ?? String(atividade?.status ?? "")} rotulo={situacaoDaAtividade(atividade)} testId="atividade-cabeca-status" />
          <span>
            {[atividade?.numero != null ? `Nº ${atividade.numero}` : "", formatarAreaExecutadaPlanejada(atividade) ? `${formatarAreaExecutadaPlanejada(atividade)} ha` : ""]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>
      </div>
      {onConcluir ? (
        <button type="button" className="b1-aberta-cab__concluir" onClick={onConcluir} data-testid="atividade-concluir-celular">
          <CircleCheck className="h-4 w-4" aria-hidden />
          Concluir
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div ref={raizRef} className="cadastro-b1 b1-aberta min-w-0" data-testid="atividade-aberta" data-celular={celular ? "" : undefined}>
      {cabecaCelular}
      {avisos}
      <div className="b1-panel-tabs-rail b1-aberta-abas">
        <div role="tablist" aria-label="Atividade aberta" className="b1-panel-tabs-strip b1-aberta-abas__lista">
          {ABAS.map((a, i) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              id={`atividade-aba-${a.id}`}
              aria-selected={aba === a.id}
              aria-controls={`atividade-painel-${a.id}`}
              tabIndex={aba === a.id ? 0 : -1}
              className={`b1-panel-tab${aba === a.id ? " is-active" : ""}`}
              onClick={() => setAba(/** @type {'lancamentos'|'areas'|'resumo'} */ (a.id))}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const outra = ABAS[(i + (e.key === "ArrowRight" ? 1 : ABAS.length - 1)) % ABAS.length].id;
                setAba(/** @type {'lancamentos'|'areas'|'resumo'} */ (outra));
                document.getElementById(`atividade-aba-${outra}`)?.focus();
              }}
              data-testid={`atividade-aba-${a.id}`}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
        <NavegacaoDoRegistro info={navInfo} />
      </div>
      <div role="tabpanel" id="atividade-painel-lancamentos" aria-labelledby="atividade-aba-lancamentos" hidden={aba !== "lancamentos"} className="b1-aberta-painel" data-testid="atividade-painel-lancamentos">
        <FluxoPorArea
          atividade={atividade}
          totais={totais}
          lendoTotais={lendoTotais}
          lendoLinhas={lendoLinhas}
          apontamentos={itens}
          acoes={acoes}
          escopo={escopo}
          podeLancar={podeLancar}
          podeGerir={podeGerirAreas}
          flags={flags}
          onLancar={onLancar}
          onGravouAbastecimento={onGravouAbastecimento}
          onAtividadeAtualizada={onAtividadeAtualizada}
          recado={recado}
          onLimparRecado={onLimparRecado}
        />
      </div>
      <div role="tabpanel" id="atividade-painel-areas" aria-labelledby="atividade-aba-areas" hidden={aba !== "areas"} className="b1-aberta-painel" data-testid="atividade-painel-areas">
        <ResumoDasAreas atividade={atividade} totais={totais} lendoTotais={lendoTotais} empresaId={empresaId} habilitado={habilitado} />
      </div>
      <div role="tabpanel" id="atividade-painel-resumo" aria-labelledby="atividade-aba-resumo" hidden={aba !== "resumo"} className="b1-aberta-painel" data-testid="atividade-painel-resumo">
        <section className="b1-aba-cartao b1-aberta-cartao">
          <TotalizadorAtividade atividade={atividade} empresaId={empresaId} habilitado={habilitado} fixo={false} />
        </section>
        <section className="b1-aba-cartao b1-aberta-cartao">{cabecalho}</section>
        <section className="b1-aba-cartao b1-aberta-cartao" data-testid="atividade-dias">
          <button
            type="button"
            className="b1-aberta-dias__toggle"
            aria-expanded={diasAbertos}
            aria-controls="atividade-dias-corpo"
            onClick={() => setDiasAbertos((v) => !v)}
            data-testid="atividade-dias-toggle"
          >
            {diasAbertos ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
            <span className="b1-aba-cartao__titulo">Dias lançados</span>
            <span className={NOTA}>
              {lendoLinhas ? "" : `${itens.length} ${itens.length === 1 ? "lançamento" : "lançamentos"} · ajuste avançado: a área do dia, o operador, repetir e cancelar o dia`}
            </span>
          </button>
          <div id="atividade-dias-corpo" hidden={!diasAbertos} className="mt-2 min-w-0">
            <ListaApontamentos
              key={String(atividade?.id ?? "")}
              atividade={atividade}
              acoes={acoes}
              onAtividadeAtualizada={onAtividadeAtualizada}
              titulo={comAreas ? "Lançamentos por dia (todas as áreas)" : "Lançamentos por dia"}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
