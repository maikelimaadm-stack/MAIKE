import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, X } from "lucide-react";
import { NavegacaoDoRegistro, useNavegacaoDoRegistro } from "@/components/cadastro/base1/registroNavBase1";
import { useCelular } from "@/components/common/MobileSheet";
import { Selo } from "@/components/financeiroGestao/ConsultaLancamento";
import TotalizadorAtividade from "@/components/lancamento-atividades/TotalizadorAtividade";
import FluxoPorArea from "@/components/lancamento-atividades/FluxoPorArea";
import ResumoDasAreas from "@/components/lancamento-atividades/ResumoDasAreas";
import "@/components/lancamento-atividades/legadoDiasDoLancamento";
import { useAuth } from "@/lib/AuthContext";
import { chaveApontamentos, itensDaLista, RAIZ_CONSULTAS_ATIVIDADES } from "@/lib/atividadeApontamentoRegras";
import { chaveTotais, flagsDoTipoDaAtividade } from "@/lib/atividadeLinhasRegras";
import { CHAVE_DO_SELO_ATIVIDADE, STATUS_ABERTA, formatarAreaExecutadaPlanejada } from "@/lib/lancamentoAtividadesRegras";
import { situacaoDaAtividade } from "@/lib/atividadeFluxoCampo";
import { listarApontamentos, listarTiposAtividade, obterTotaisAtividade } from "@/services/lancamentoAtividadesService";

/** As abas da atividade aberta: os lançamentos (a tabela de áreas e a de cada área), o Resumo das áreas (D-PROD-252) e o Resumo da atividade. */
const ABAS = Object.freeze([
  { id: "lancamentos", rotulo: "Lançamentos" },
  { id: "areas", rotulo: "Resumo das áreas" },
  { id: "resumo", rotulo: "Resumo da atividade" },
]);

/**
 * A atividade ABERTA (D-PROD-234, reorganizada na D-PROD-252 e nas emendas 1 e 2), no modelo da lista do sistema: as tabelas
 * são a grade Base1 (`TabelaBase1` → `CadastroBase1Grade`), sem cartão, e o rodapé do Base1 ("N registros", tamanho da
 * página) fica no fim da casca:
 *
 *  - abas **Lançamentos**, **Resumo das áreas** e **Resumo da atividade**, com a navegação ‹‹ ‹ n/N › ›› do registro na mesma
 *    linha (a do motor, `NavegacaoDoRegistro`, na ordem da lista); no celular a navegação fica no rodapé, como sempre;
 *  - **Lançamentos** (`FluxoPorArea`): UMA tabela de áreas, sem linha de resumo; o nome da área abre a área, com os botões
 *    "+" e UMA tabela de lançamentos (`LancamentosDaArea`); com a área aberta, as abas e a navegação do registro saem da
 *    frente (o "‹ Áreas" volta). O Editar e o Cancelar são do ⚡ de cada linha;
 *  - **Resumo das áreas** (`ResumoDasAreas`): o custo por tipo de cada área, do `por_area` dos totais, numa tabela Base1;
 *  - **Resumo da atividade**: UM detalhe (o do registro dos cadastros: seções e campos só leitura) com os totais — os valores
 *    únicos como campos e os itens (insumos, máquinas, mão de obra, serviços) numa tabela Base1 — e os dados da atividade
 *    (`TotalizadorAtividade` e o `cabecalho` da tela). Sem "dias": cada linha lançada tem a data dela.
 *
 * O aviso de uma gravação é o toast do app (`notifySuccess`), nunca um aviso na tela. As abas ficam montadas (a escondida
 * com `hidden`): trocar de aba não perde a tela em que a pessoa está. No celular: a cabeça com ✕, o nome, o status,
 * "Nº · área" e o Concluir.
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
 *   onFechar: () => void,
 *   onConcluir?: (() => void) | null,
 * }} props `acoes`: as dos lançamentos (já com o status, a permissão e o fuso); `onLancar`: abre a janela do lançamento
 *   sobre esta atividade, presa na área. `onConcluir`: o Concluir da cabeça do celular (null = sem o botão).
 */
export default function AtividadeAberta({ atividade, empresaId, acoes, habilitado, cabecalho, avisos = null, onAtividadeAtualizada, onLancar, onFechar, onConcluir = null }) {
  const celular = useCelular();
  const { clienteId } = useAuth();
  const id = atividade?.id ? String(atividade.id) : null;
  const [aba, setAba] = useState(/** @type {'lancamentos'|'areas'|'resumo'} */ ("lancamentos"));
  // Uma área aberta (e não a tabela de áreas): sem as abas nem o "1 registro" por cima, só o "‹ Áreas" volta.
  const [emArea, setEmArea] = useState(false);
  // Escopo da pendência de `operation_id` (cliente e login): o mesmo da lista de lançamentos.
  const escopo = `${clienteId || "sem-tenant"}:${acoes?.login || "sem-login"}`;
  // ‹ › do registro na linha das abas (computador e tablet); no celular, no rodapé da casca.
  const navInfo = useNavegacaoDoRegistro(!celular);
  // O contêiner do registro no modo do design com abas (como `Base1PanelTabs`): abas fora, cartões sobre o fundo.
  const raizRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  useLayoutEffect(() => {
    const scroll = raizRef.current?.closest(".mg-form-scroll");
    if (!scroll) return undefined;
    scroll.classList.add("b1-form--abas-fora", "b1-form--tabela");
    return () => scroll.classList.remove("b1-form--abas-fora", "b1-form--tabela");
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
          Finalizar
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div ref={raizRef} className="cadastro-b1 b1-aberta min-w-0" data-testid="atividade-aberta" data-celular={celular ? "" : undefined}>
      {cabecaCelular}
      {avisos}
      <div className="b1-panel-tabs-rail b1-aberta-abas" style={emArea && aba === "lancamentos" ? { display: "none" } : undefined} data-testid="atividade-abas">
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
          podeInformarFeita={aberta && acoes?.editarApontamento === true && habilitado}
          flags={flags}
          onLancar={onLancar}
          onAtividadeAtualizada={onAtividadeAtualizada}
          onAreaAberta={setEmArea}
        />
      </div>
      <div role="tabpanel" id="atividade-painel-areas" aria-labelledby="atividade-aba-areas" hidden={aba !== "areas"} className="b1-aberta-painel" data-testid="atividade-painel-areas">
        <ResumoDasAreas atividade={atividade} totais={totais} lendoTotais={lendoTotais} />
      </div>
      <div role="tabpanel" id="atividade-painel-resumo" aria-labelledby="atividade-aba-resumo" hidden={aba !== "resumo"} className="b1-aberta-painel b1-aberta-painel--detalhe" data-testid="atividade-painel-resumo">
        <div className="b1-resumo-atividade">
          <TotalizadorAtividade atividade={atividade} empresaId={empresaId} habilitado={habilitado} fixo={false} />
          {cabecalho}
        </div>
      </div>
    </div>
  );
}
