import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, CircleCheck, List, Plus, X } from "lucide-react";
import { B1MenuAcoesDaLinha } from "@/components/cadastro/base1/B1AcoesDaLinha";
import { NavegacaoDoRegistro, useNavegacaoDoRegistro } from "@/components/cadastro/base1/registroNavBase1";
import { useCelular } from "@/components/common/MobileSheet";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { Selo } from "@/components/financeiroGestao/ConsultaLancamento";
import { LANCAMENTOS_POR_TIPO } from "@/components/lancamento-atividades/JanelaLancamentoPorTipo";
import ListaApontamentos from "@/components/lancamento-atividades/ListaApontamentos";
import TotalizadorAtividade from "@/components/lancamento-atividades/TotalizadorAtividade";
import CardAreasDaAtividade from "@/components/lancamento-atividades/CardAreasDaAtividade";
import FluxoPorArea from "@/components/lancamento-atividades/FluxoPorArea";
import { areaDaAtividadePorId, rotuloDaAreaDaAtividade, temAreas, textoDaColunaArea } from "@/lib/atividadeAreasRegras";
import { chaveApontamentos, itensDaLista, RAIZ_CONSULTAS_ATIVIDADES } from "@/lib/atividadeApontamentoRegras";
import {
  chaveTotais,
  flagsDoTipoDaAtividade,
  formatarDecimalLinha,
  formatarMoedaAtividade,
  linhasConfirmadasDaAtividade,
  resumoDeCustoParaExibir,
  resumoDoTipoNaAtividade,
  valorDoTipoNaAtividade,
} from "@/lib/atividadeLinhasRegras";
import { somar } from "@/lib/dinheiroDecimal";
import {
  CHAVE_DO_SELO_ATIVIDADE,
  STATUS_ABERTA,
  formatarAreaExecutadaPlanejada,
  formatarDiaAtividade,
  rotuloDaArea,
} from "@/lib/lancamentoAtividadesRegras";
import { situacaoDaAtividade } from "@/lib/atividadeFluxoCampo";
import { listarApontamentos, listarTiposAtividade, obterTotaisAtividade } from "@/services/lancamentoAtividadesService";

/** As abas da atividade aberta (protótipo do proprietário). */
const ABAS = Object.freeze([
  { id: "lancamentos", rotulo: "Lançamentos" },
  { id: "resumo", rotulo: "Resumo da atividade" },
]);

/** Texto auxiliar (o tom das notas dos formulários do motor). */
const NOTA = "min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";

/**
 * As células do card "Resumo de custo" (protótipo do proprietário), na ordem do desenho.
 * @type {ReadonlyArray<{ id: string, rotulo: string, campo: keyof ReturnType<typeof resumoDeCustoParaExibir> }>}
 */
const CELULAS_DO_RESUMO = Object.freeze([
  { id: "area", rotulo: "Área (ha) / planejada", campo: "area" },
  { id: "feito", rotulo: "% feito", campo: "feito" },
  { id: "custo", rotulo: "Custo total", campo: "custo" },
  { id: "custo-ha", rotulo: "Custo por hectare", campo: "custoPorHa" },
  { id: "maquinas", rotulo: "Trabalho de máquinas", campo: "maquinas" },
  { id: "produtos", rotulo: "Aplicação de insumos", campo: "produtos" },
  { id: "mao-obra", rotulo: "Mão de obra", campo: "maoObra" },
  { id: "servicos", rotulo: "Custos extras", campo: "servicos" },
  { id: "combustivel", rotulo: "Combustível (L)", campo: "combustivel" },
  { id: "combustivel-ha", rotulo: "Combustível por ha", campo: "combustivelPorHa" },
  { id: "data", rotulo: "Data", campo: "data" },
  { id: "safra", rotulo: "Safra", campo: "safra" },
]);

/**
 * A atividade ABERTA no desenho do protótipo do proprietário (D-PROD-234, fatia 3 do redesenho), no modelo visual do
 * sistema (cartões `b1-aba-cartao`, abas `b1-panel-tab`, a tabela `b1-tipo-tabela` e o ⚡ da fatia 1):
 *
 *  - abas **Lançamentos** e **Resumo da atividade**, com a navegação ‹‹ ‹ n/N › ›› do registro na mesma linha
 *    (a do motor, `NavegacaoDoRegistro`, na ordem da lista); no celular a navegação fica no rodapé, como sempre;
 *  - **Lançamentos**: o card "Resumo de custo · ÁREA" (área executada / planejada, % feito, custo total e por hectare,
 *    o valor de cada tipo, combustível em litros e por hectare, data e safra — `resumoDeCustoParaExibir`, só do
 *    servidor); o card "Lançamentos" com UMA linha por tipo que o tipo da atividade permite (as mesmas flags do ⚡
 *    da lista; o tipo que deixou de ser permitido mas tem linha continua, para consulta): Itens (linhas CONFIRMADAS de
 *    todos os dias), Resumo, Valor (a parcela do servidor) e o ⚡ (Inserir / Ver lançamentos: a janela do tipo da
 *    fatia 2); sem linha, "+ Lançar"; a linha de Total. Abaixo, **Dias lançados** (recolhível): a lista de sempre
 *    por dia (`ListaApontamentos`), com Novo, Repetir, Editar, Cancelar, os blocos das linhas e os abastecimentos;
 *  - **Resumo da atividade**: os totais com o detalhe por item (`TotalizadorAtividade`: cada produto, máquina,
 *    pessoa, serviço, o combustível e o consumo) e os dados da atividade, só leitura (`cabecalho`).
 *
 * As duas abas ficam montadas (a escondida com `hidden`): trocar de aba não perde o que está aberto nos dias.
 * No celular: a cabeça com ✕, o nome, o status, "Nº · área" e o Concluir; os tipos viram cartões.
 *
 * @param {{
 *   atividade: any,
 *   empresaId: string|null,
 *   acoes: Record<string, any>,
 *   habilitado: boolean,
 *   cabecalho: React.ReactNode,
 *   avisos?: React.ReactNode,
 *   onAtividadeAtualizada: (atividade: any) => void,
 *   onLancar: (tipo: string, aba: 'lista'|'dados', atividadeAreaId?: string|null, modoCampo?: boolean, tituloCampo?: string) => void,
 *   onGravouAbastecimento?: (recado: { texto: string, areaId: string|null, nomeArea: string, nomeAtividade: string }) => void,
 *   onFechar: () => void,
 *   onConcluir?: (() => void) | null,
 *   recado?: { texto: string, areaId: string|null, nomeArea: string, nomeAtividade: string } | null,
 *   onLimparRecado?: () => void,
 * }} props `acoes`: as dos lançamentos (já com o status, a permissão e o fuso); `onLancar`: abre a janela do tipo
 *   (fatia 2) sobre esta atividade. `modoCampo` true: o registro do dia a dia, com confirmação na área.
 *   `onConcluir`: o Concluir da cabeça do celular (null = sem o botão).
 */
export default function AtividadeAberta({ atividade, empresaId, acoes, habilitado, cabecalho, avisos = null, onAtividadeAtualizada, onLancar, onFechar, onConcluir = null, recado = null, onLimparRecado = () => {}, onGravouAbastecimento = () => {} }) {
  const celular = useCelular();
  const id = atividade?.id ? String(atividade.id) : null;
  const [aba, setAba] = useState(/** @type {'lancamentos'|'resumo'} */ ("lancamentos"));
  const [diasAbertos, setDiasAbertos] = useState(false);
  const [maisDetalhes, setMaisDetalhes] = useState(false);
  // D-PROD-249: "Ver lançamentos da área" abre os dias lançados só daquela área.
  const [areaDosDias, setAreaDosDias] = useState(/** @type {string|null} */ (null));
  const diasRef = useRef(/** @type {HTMLElement | null} */ (null));
  const comAreas = temAreas(atividade);
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
  const resumo = resumoDeCustoParaExibir({ totais, atividade });
  const lendoTotais = totaisQuery.isPending && totaisQuery.fetchStatus !== "idle";
  const lendoLinhas = apontamentosQuery.isPending && apontamentosQuery.fetchStatus !== "idle";

  const aberta = atividade?.status === STATUS_ABERTA;
  const podeLancar = aberta && acoes?.lancarApontamento === true;

  // Uma linha por tipo: o que o tipo permite (máquina sempre) e o que já tem linha (o tipo pode ter mudado depois).
  const linhasDosTipos = LANCAMENTOS_POR_TIPO.map((l) => {
    const linhas = linhasConfirmadasDaAtividade(itens, l.tipo);
    const permitido = !l.flag || flags[l.flag] === true;
    const valor = valorDoTipoNaAtividade(l.tipo, totais);
    return { ...l, linhas, permitido, valor, resumo: resumoDoTipoNaAtividade(l.tipo, linhas, totais), lancar: podeLancar && permitido };
  }).filter((l) => l.permitido || l.linhas.length > 0);
  const totalItens = linhasDosTipos.reduce((t, l) => t + l.linhas.length, 0);
  const valoresDosTipos = /** @type {string[]} */ (linhasDosTipos.map((l) => l.valor).filter((v) => v !== null));
  // O total da tabela é o custo total do servidor (a soma das parcelas); sem ele, a soma das parcelas mostradas.
  const totalValor = typeof totais?.custo_total === "string" ? totais.custo_total : valoresDosTipos.length ? somar(valoresDosTipos, 4) : null;

  // D-PROD-249: com várias áreas, o nome do card é "N áreas" (cada área tem a linha dela no card das áreas).
  const nomeArea = comAreas ? textoDaColunaArea(atividade) : rotuloDaArea(atividade?.area);
  const executada = formatarDecimalLinha(totais?.area_executada ?? atividade?.area_executada);
  const subtituloDosLancamentos = [
    nomeArea,
    executada ? `${executada} ha` : "",
    formatarDiaAtividade(atividade?.data_inicio),
    formatarMoedaAtividade(totais?.custo_total),
  ]
    .filter(Boolean)
    .join(" · ");

  /** @param {string} v */
  const valorOuLendo = (v) => (v === "—" && lendoTotais ? "…" : v);

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

  // ─── Card "Resumo de custo · ÁREA" ───────────────────────────────────
  const cardResumo = (
    <section className="b1-aba-cartao b1-aberta-cartao" aria-labelledby="atividade-resumo-custo-t" data-testid="atividade-resumo-custo">
      <div className="b1-aba-cartao__cab">
        <h3 className="b1-aba-cartao__titulo" id="atividade-resumo-custo-t">
          Resumo de custo{nomeArea ? ` · ${nomeArea}` : ""}
        </h3>
      </div>
      <dl className="b1-resumo-custo">
        {CELULAS_DO_RESUMO.map((c) => (
          <div key={c.id} className="b1-resumo-custo__celula">
            <dt>{c.rotulo}</dt>
            <dd data-testid={`resumo-custo-${c.id}`}>{valorOuLendo(String(resumo[c.campo]))}</dd>
          </div>
        ))}
      </dl>
      {totaisQuery.isError ? (
        <p className={`${NOTA} mt-2`} data-testid="resumo-custo-erro">
          Não foi possível ler os custos agora.{" "}
          <button type="button" className="underline" onClick={() => totaisQuery.refetch()}>
            Tentar novamente
          </button>
        </p>
      ) : null}
    </section>
  );

  // ─── Card "Lançamentos": uma linha por tipo ──────────────────────────
  /** O ⚡ de um tipo: Inserir (abre a janela do tipo já nos Dados) e Ver lançamentos (a lista do dia). @param {typeof linhasDosTipos[number]} l */
  const menuDoTipo = (l) => (
    <B1MenuAcoesDaLinha
      rotulo={`Ações de ${l.rotulo}`}
      titulo={l.rotulo}
      subtitulo={[`${l.linhas.length} ${l.linhas.length === 1 ? "item" : "itens"}`, formatarMoedaAtividade(l.valor)].filter(Boolean).join(" · ")}
      grupos={[
        l.lancar ? [{ key: "inserir", label: "Inserir", icon: <Plus size={16} strokeWidth={1.75} />, onSelect: () => onLancar(l.tipo, "dados") }] : [],
        [{ key: "ver", label: "Ver lançamentos", icon: <List size={16} strokeWidth={1.75} />, onSelect: () => onLancar(l.tipo, "lista") }],
      ]}
      testId={`tipo-${l.tipo}-acoes`}
    />
  );

  /** Resumo, ou "+ Lançar" no tipo sem linha (quem pode lançar), ou "—". @param {typeof linhasDosTipos[number]} l */
  const resumoOuLancar = (l) => {
    if (l.resumo) return l.resumo;
    if (lendoLinhas) return "…";
    if (l.lancar) {
      return (
        <button type="button" className="b1-tipo-lancar" onClick={() => onLancar(l.tipo, "dados")} data-testid={`tipo-${l.tipo}-lancar`}>
          <Plus size={13} strokeWidth={2} aria-hidden /> Lançar
        </button>
      );
    }
    return "—";
  };

  /** @param {string|null} v */
  const valorDaLinha = (v) => formatarMoedaAtividade(v) || (lendoTotais ? "…" : "—");

  const tabelaDosTipos = celular ? (
    <ul className="b1-tipo-cards" data-testid="atividade-tipos">
      {linhasDosTipos.map((l) => (
        <li key={l.tipo} className="b1-tipo-card" data-testid={`tipo-${l.tipo}`}>
          <div className="b1-tipo-card__topo">
            <span className={`b1-tipo-card__qtd${l.linhas.length ? " is-cheio" : ""}`} data-testid={`tipo-${l.tipo}-itens`}>
              {lendoLinhas ? "…" : l.linhas.length}
            </span>
            <button type="button" className="b1-tipo-card__nome" onClick={() => onLancar(l.tipo, "lista")} data-testid={`tipo-${l.tipo}-abrir`}>
              <span className="b1-tipo-card__titulo">{l.rotulo}</span>
              <span className="b1-tipo-card__valor" data-testid={`tipo-${l.tipo}-valor`}>
                {valorDaLinha(l.valor)}
              </span>
            </button>
            {menuDoTipo(l)}
          </div>
          <div className="b1-tipo-card__resumo">
            <span className="b1-tipo-card__rotulo">Resumo</span>
            <span data-testid={`tipo-${l.tipo}-resumo`}>{resumoOuLancar(l)}</span>
          </div>
        </li>
      ))}
      <li className="b1-tipo-card b1-tipo-card--total" data-testid="tipos-total">
        <span>
          Total · <span data-testid="tipos-total-itens">{lendoLinhas ? "…" : totalItens}</span> {totalItens === 1 ? "item" : "itens"}
        </span>
        <strong data-testid="tipos-total-valor">{valorDaLinha(totalValor)}</strong>
      </li>
    </ul>
  ) : (
    <div className="b1-tipo-tabela__rolagem">
      <table className="b1-tipo-tabela b1-tipo-tabela--tipos" data-testid="atividade-tipos">
        <thead>
          <tr>
            <th scope="col" className="b1-tipo-tabela__acoes">
              Ações
            </th>
            <th scope="col">Lançamento</th>
            <th scope="col" className="is-numero">
              Itens
            </th>
            <th scope="col">Resumo</th>
            <th scope="col" className="is-numero">
              Valor
            </th>
          </tr>
        </thead>
        <tbody>
          {linhasDosTipos.map((l) => (
            <tr key={l.tipo} data-testid={`tipo-${l.tipo}`}>
              <td className="b1-tipo-tabela__acoes">{menuDoTipo(l)}</td>
              <td className="b1-tipo-tabela__tipo">
                <button type="button" className="b1-tipo-tabela__abrir" onClick={() => onLancar(l.tipo, "lista")} data-testid={`tipo-${l.tipo}-abrir`}>
                  {l.rotulo}
                </button>
              </td>
              <td className="is-numero" data-testid={`tipo-${l.tipo}-itens`}>
                {lendoLinhas ? "…" : l.linhas.length}
              </td>
              <td className="b1-tipo-tabela__resumo" data-testid={`tipo-${l.tipo}-resumo`}>
                {resumoOuLancar(l)}
              </td>
              <td className="is-numero" data-testid={`tipo-${l.tipo}-valor`}>
                {valorDaLinha(l.valor)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-testid="tipos-total">
            <td />
            <td>Total</td>
            <td className="is-numero" data-testid="tipos-total-itens">
              {lendoLinhas ? "…" : totalItens}
            </td>
            <td />
            <td className="is-numero" data-testid="tipos-total-valor">
              {valorDaLinha(totalValor)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  const cardLancamentos = (
    <section className="b1-aba-cartao b1-aberta-cartao" aria-labelledby="atividade-lancamentos-t" data-testid="atividade-lancamentos-tipos">
      <div className="b1-aba-cartao__cab b1-aberta-cartao__cab">
        <h3 className="b1-aba-cartao__titulo" id="atividade-lancamentos-t">
          Lançamentos
        </h3>
        {subtituloDosLancamentos ? (
          <span className="b1-aberta-cartao__sub" data-testid="atividade-lancamentos-subtitulo">
            {subtituloDosLancamentos}
          </span>
        ) : null}
      </div>
      <p className={`${NOTA} mb-2`}>
        {podeLancar ? (
          <>Ajuste por tipo fica aqui, fora do caminho do campo. No dia a dia, registre pela área. Itens e valores somam todos os dias.</>
        ) : (
          "Itens e valores somam todos os dias. Clique no tipo para ver os itens."
        )}
      </p>
      {apontamentosQuery.isError ? (
        <AvisoGestao testId="atividade-tipos-erro">
          Não foi possível ler os lançamentos agora.{" "}
          <button type="button" className="underline" onClick={() => apontamentosQuery.refetch()}>
            Tentar novamente
          </button>
        </AvisoGestao>
      ) : null}
      {tabelaDosTipos}
    </section>
  );

  // ─── D-PROD-249: o card "Áreas da atividade" (o principal, com várias áreas) ───
  const podeGerirAreas = aberta && acoes?.editar === true && habilitado;
  const cardAreas = comAreas ? (
    <CardAreasDaAtividade
      atividade={atividade}
      totais={totais}
      lendoTotais={lendoTotais}
      podeGerir={podeGerirAreas}
      lancamentos={linhasDosTipos.map((l) => ({ tipo: l.tipo, rotulo: l.rotulo, Icone: l.Icone, lancar: l.lancar }))}
      onLancarNaArea={(tipo, abaDaJanela, atividadeAreaId) => onLancar(tipo, abaDaJanela, atividadeAreaId)}
      onVerLancamentosDaArea={(atividadeAreaId) => {
        setAreaDosDias(atividadeAreaId);
        setDiasAbertos(true);
        requestAnimationFrame(() => diasRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
      }}
      onAtividadeAtualizada={onAtividadeAtualizada}
    />
  ) : null;
  const areaDosDiasObj = areaDosDias ? areaDaAtividadePorId(atividade, areaDosDias) : null;

  // ─── Dias lançados (a lista de sempre, recolhível) ───────────────────
  const dias = areaDosDias ? itens.filter((a) => String(a?.atividade_area_id ?? "") === areaDosDias).length : itens.length;
  const cardDias = (
    <section ref={diasRef} className="b1-aba-cartao b1-aberta-cartao" data-testid="atividade-dias">
      <button
        type="button"
        className="b1-aberta-dias__toggle"
        aria-expanded={diasAbertos}
        aria-controls="atividade-dias-corpo"
        onClick={() => setDiasAbertos((v) => !v)}
        data-testid="atividade-dias-toggle"
      >
        {diasAbertos ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        <span className="b1-aba-cartao__titulo">{areaDosDiasObj ? `Lançamentos · ${rotuloDaAreaDaAtividade(areaDosDiasObj)}` : "Dias lançados"}</span>
        <span className={NOTA}>
          {lendoLinhas ? "" : `${dias} ${dias === 1 ? "lançamento" : "lançamentos"} · novo, repetir, editar e cancelar o dia, linhas e abastecimentos`}
        </span>
      </button>
      <div id="atividade-dias-corpo" hidden={!diasAbertos} className="mt-2 min-w-0">
        {areaDosDiasObj ? (
          <p className={`${NOTA} mb-2`} data-testid="atividade-dias-filtro-area">
            Só os lançamentos de {rotuloDaAreaDaAtividade(areaDosDiasObj)}.{" "}
            <button type="button" className="underline" onClick={() => setAreaDosDias(null)} data-testid="atividade-dias-todas-areas">
              Ver todas as áreas
            </button>
          </p>
        ) : null}
        <ListaApontamentos
          key={String(atividade?.id ?? "")}
          atividade={atividade}
          acoes={acoes}
          onAtividadeAtualizada={onAtividadeAtualizada}
          titulo={comAreas && !areaDosDias ? "Lançamentos por dia (todas as áreas)" : "Lançamentos por dia"}
          areaFiltro={areaDosDias}
        />
      </div>
    </section>
  );

  return (
    <div ref={raizRef} className="cadastro-b1 b1-aberta min-w-0" data-testid="atividade-aberta" data-celular={celular ? "" : undefined}>
      {cabecaCelular}
      {avisos}
      <FluxoPorArea
        atividade={atividade}
        totais={totais}
        lendoTotais={lendoTotais}
        apontamentos={itens}
        podeLancar={podeLancar}
        podeGerir={podeGerirAreas}
        flags={flags}
        onLancar={onLancar}
        onGravouAbastecimento={onGravouAbastecimento}
        onAtividadeAtualizada={onAtividadeAtualizada}
        onAbrirAjustes={(areaId) => {
          setAreaDosDias(areaId);
          setDiasAbertos(true);
          setMaisDetalhes(true);
          setAba("lancamentos");
        }}
        recado={recado}
        onLimparRecado={onLimparRecado}
      />
      <div className="mt-4">
        <button
          type="button"
          className="b1-aberta-dias__toggle min-h-11"
          aria-expanded={maisDetalhes}
          aria-controls="atividade-mais-detalhes-corpo"
          onClick={() => setMaisDetalhes((v) => !v)}
          data-testid="atividade-mais-detalhes-toggle"
        >
          {maisDetalhes ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          <span className="text-[13px] font-semibold">Mais detalhes</span>
        </button>
        <div id="atividade-mais-detalhes-corpo" hidden={!maisDetalhes}>
      <div className="b1-panel-tabs-rail b1-aberta-abas">
        <div role="tablist" aria-label="Atividade aberta" className="b1-panel-tabs-strip b1-aberta-abas__lista">
          {ABAS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              id={`atividade-aba-${a.id}`}
              aria-selected={aba === a.id}
              aria-controls={`atividade-painel-${a.id}`}
              tabIndex={aba === a.id ? 0 : -1}
              className={`b1-panel-tab${aba === a.id ? " is-active" : ""}`}
              onClick={() => setAba(/** @type {'lancamentos'|'resumo'} */ (a.id))}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const outra = a.id === "lancamentos" ? "resumo" : "lancamentos";
                setAba(outra);
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
        {cardAreas}
        {cardResumo}
        {cardLancamentos}
        {cardDias}
      </div>
      <div role="tabpanel" id="atividade-painel-resumo" aria-labelledby="atividade-aba-resumo" hidden={aba !== "resumo"} className="b1-aberta-painel" data-testid="atividade-painel-resumo">
        <section className="b1-aba-cartao b1-aberta-cartao">
          <TotalizadorAtividade atividade={atividade} empresaId={empresaId} habilitado={habilitado} fixo={false} />
        </section>
        <section className="b1-aba-cartao b1-aberta-cartao">{cabecalho}</section>
      </div>
        </div>
      </div>
    </div>
  );
}
