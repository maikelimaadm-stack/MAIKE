import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Pencil, Plus, Repeat } from "lucide-react";
import { AvisoGestao, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { DialogoAcao } from "@/components/financeiroGestao/DialogosLancamento";
import { SeloAbastecimento } from "@/components/patrimonio/TabelaAbastecimentos";
import { BOTAO_PERIGO, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import FormularioApontamento from "@/components/lancamento-atividades/FormularioApontamento";
import LinhasDoApontamento from "@/components/lancamento-atividades/LinhasDoApontamento";
import { useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { QUERY_RAIZ_ABASTECIMENTOS } from "@/hooks/useFluxoAbastecimento";
import { useAuth } from "@/lib/AuthContext";
import { formatarInstante } from "@/lib/diaCivil";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import {
  LOCALE_ATIVIDADE,
  MOTIVO_MINIMO,
  STATUS_ABERTA,
  STATUS_CANCELADA,
  STATUS_CANCELADO,
  STATUS_CONCLUIDA,
  STATUS_CONFIRMADO,
  formatarDiaAtividade,
  mensagemDeErroAtividade,
  mensagemDoAlertaAtividade,
  rotuloDoTurno,
  rotuloDoUsuario,
} from "@/lib/lancamentoAtividadesRegras";
import {
  apontamentosPorDia,
  chaveApontamentos,
  formatarComUnidade,
  itensDaLista,
  maisRecenteConfirmado,
  normalizarRespostaDeEscrita,
  pedeReleitura,
  RAIZ_CONSULTAS_ATIVIDADES,
  rotuloDaPassada,
  siglaDaProducao,
} from "@/lib/atividadeApontamentoRegras";
import { chaveTotais, flagsDoTipoDaAtividade } from "@/lib/atividadeLinhasRegras";
import { cancelarApontamento, listarApontamentos, listarTiposAtividade, obterAtividade } from "@/services/lancamentoAtividadesService";
import { ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

/** Formatação das mensagens do diálogo de ação (não há dinheiro neste diálogo). */
const CONTEXTO_MENSAGENS = Object.freeze({ locale: LOCALE_ATIVIDADE, moeda: "BRL", casas: 2 });

/** Linha de um lançamento (o desenho das linhas de baixa da Consulta de Lançamento). */
const LINHA = "flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-[12px]";
const LINHA_CONFIRMADA = `${LINHA} border-emerald-200 bg-emerald-50/40`;
const LINHA_CANCELADA = `${LINHA} border-slate-200 bg-slate-50 text-slate-500`;
/** Subtítulo do dia (o "Lotes consumidos" das janelas de estoque). */
const TITULO_DIA = "mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]";

/**
 * @typedef {{ ver?: boolean, lancarApontamento?: boolean, editarApontamento?: boolean, cancelarApontamento?: boolean, login?: string|null }} AcoesDosLancamentos
 * @typedef {{ modo: 'novo'|'editar'|'repetir', apontamento: any, chave: number }} JanelaAberta
 */

/**
 * "Cancelado em 13/11/2026 14:05 por Fulano · motivo: …" (o que o servidor devolveu).
 * @param {any} ap @param {string|null} fuso
 */
const textoDoCancelamento = (ap, fuso) => {
  const quando = typeof ap?.cancelado_em === "string" && ap.cancelado_em ? ` em ${formatarInstante(ap.cancelado_em, LOCALE_ATIVIDADE, fuso)}` : "";
  const quem = rotuloDoUsuario(ap?.cancelado_por);
  const motivo = typeof ap?.motivo_cancelamento === "string" && ap.motivo_cancelamento.trim() ? ` · motivo: ${ap.motivo_cancelamento.trim()}` : "";
  return `Cancelado${quando}${quem ? ` por ${quem}` : ""}${motivo}`;
};

/**
 * Lançamentos do dia a dia de UMA atividade (D-PROD-200, Fatia 2): a lista por
 * dia (o mais recente primeiro; no dia, turno e passada), com data, turno,
 * passada ("1ª/2ª passada"), operador, área do dia, produção, situação e
 * observação. Os CANCELADOS continuam na lista, riscados e com o motivo.
 *
 * Botões só com a atividade ABERTA, a fazenda com fuso configurado (o servidor
 * recusa sem ele) e a ação liberada na tela (`acoes`):
 *  - "Novo lançamento" e "Repetir" (o último lançado, ou o da linha) com
 *    `lancarApontamento` — o "Repetir" abre o formulário já preenchido com os
 *    dados da base para o operador só ajustar (ver `FormularioApontamento`);
 *  - "Editar" com `editarApontamento` e "Cancelar" (motivo obrigatório, no
 *    `DialogoAcao`) com `cancelarApontamento`, só no lançamento CONFIRMADO.
 *
 * Fatia 3 (D-PROD-202): dentro de cada lançamento, os blocos "Produtos" e
 * "Máquinas" (`LinhasDoApontamento`), com as linhas e as janelas de adicionar,
 * editar e cancelar; o bloco Produtos só aparece com `permite_produto` no tipo.
 * D-PROD-211: o bloco "Abastecimentos" de cada lançamento (só com a tela Abastecimentos liberada).
 * Fatia 4: os blocos "Mão de obra" e "Serviços", só com `permite_mao_obra` e
 * `permite_servico` no tipo.
 * "Repetir último lançamento" traz também as linhas do lançamento base.
 *
 * Depois de cada escrita a lista é relida, `onAtividadeAtualizada` recebe o
 * cabeçalho com os totais recalculados (área executada e produção) e os
 * alertas da resposta (FORA_DO_INTERVALO) ficam num aviso: alerta não bloqueia,
 * o lançamento já foi gravado. Recusa que diz "mudou" (versão, status, não
 * encontrado) e resultado incerto relêem a lista e o cabeçalho.
 *
 * @param {{
 *   atividade: any,
 *   acoes: AcoesDosLancamentos & Record<string, any>,
 *   onAtividadeAtualizada: (atividade: any) => void,
 *   titulo?: string,
 * }} props `titulo`: o da seção (D-PROD-234: "Lançamentos por dia", dentro de "Dias lançados" da atividade aberta).
 */
export default function ListaApontamentos({ atividade, acoes, onAtividadeAtualizada, titulo = "Lançamentos" }) {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const { fuso, semFuso } = useFusoDaFazenda(empresaId);
  const atividadeId = atividade?.id ? String(atividade.id) : null;
  const podeVer = acoes?.ver === true;
  const chave = chaveApontamentos(empresaId, atividadeId);
  const sigla = siglaDaProducao(atividade);

  const consulta = useQuery({
    queryKey: chave,
    queryFn: () => listarApontamentos(/** @type {string} */ (atividadeId)),
    enabled: Boolean(empresaId && atividadeId && podeVer),
    staleTime: 15 * 1000,
  });
  // O que o tipo permite nas linhas (produto, implemento, mão de obra, serviço): a mesma leitura de tipos da página (mesma chave).
  const { data: tipos = [] } = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "tipos"],
    queryFn: () => listarTiposAtividade(),
    enabled: podeVer,
    staleTime: 30 * 1000,
  });
  const { permiteProduto, permiteImplemento, permiteMaoObra, permiteServico } = flagsDoTipoDaAtividade(atividade, /** @type {any[]} */ (tipos));
  // Escopo da pendência de `operation_id` (cliente e login): o mesmo par do abastecimento.
  const { clienteId } = useAuth();
  const escopo = `${clienteId || "sem-tenant"}:${acoes?.login || "sem-login"}`;
  const itens = useMemo(() => itensDaLista(consulta.data), [consulta.data]);
  const dias = useMemo(() => apontamentosPorDia(itens), [itens]);
  const ultimo = useMemo(() => maisRecenteConfirmado(itens), [itens]);

  const aberta = atividade?.status === STATUS_ABERTA;
  // Lançar, editar e cancelar pedem a atividade ABERTA e o "hoje" da fazenda (o servidor recusa sem fuso).
  const gravavel = Boolean(empresaId) && Boolean(fuso) && aberta;
  const podeLancar = gravavel && acoes?.lancarApontamento === true;
  const podeEditar = gravavel && acoes?.editarApontamento === true;
  const podeCancelar = gravavel && acoes?.cancelarApontamento === true;
  const algumaEscrita = acoes?.lancarApontamento === true || acoes?.editarApontamento === true || acoes?.cancelarApontamento === true;

  const [janela, setJanela] = useState(/** @type {JanelaAberta | null} */ (null));
  const [cancelando, setCancelando] = useState(/** @type {any} */ (null));
  const [alertas, setAlertas] = useState(/** @type {string[]} */ ([]));
  const proximaChave = useRef(0);

  // A resposta que chega depois de trocar de atividade não mexe no cabeçalho da atividade nova.
  const atividadeAtual = useRef(atividadeId);
  atividadeAtual.current = atividadeId;

  // Outra atividade (ou outra fazenda): nada da anterior fica aberto na tela.
  const contexto = `${empresaId ?? ""}:${atividadeId ?? ""}`;
  const contextoAnterior = useRef(contexto);
  useEffect(() => {
    if (contextoAnterior.current === contexto) return;
    contextoAnterior.current = contexto;
    setJanela(null);
    setCancelando(null);
    setAlertas([]);
  }, [contexto]);

  // O cabeçalho mudou por fora (concluir, reabrir, cancelar a atividade, que cancela os lançamentos): relê a lista.
  const situacao = `${atividade?.versao ?? ""}:${atividade?.status ?? ""}`;
  const situacaoAnterior = useRef({ id: atividadeId, situacao });
  useEffect(() => {
    const anterior = situacaoAnterior.current;
    situacaoAnterior.current = { id: atividadeId, situacao };
    if (atividadeId && anterior.id === atividadeId && anterior.situacao !== situacao) {
      queryClient.invalidateQueries({ queryKey: chaveApontamentos(empresaId, atividadeId) });
      // Cancelar a atividade cancela os abastecimentos ligados (D-PROD-211): os blocos de abastecimento se relêem.
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ_ABASTECIMENTOS] });
    }
  }, [atividadeId, situacao, empresaId, queryClient]);

  /** Relê a lista e o cabeçalho (algo mudou no servidor ou o envio ficou sem resposta). */
  const relerTudo = () => {
    queryClient.invalidateQueries({ queryKey: chave });
    queryClient.invalidateQueries({ queryKey: chaveTotais(empresaId, atividadeId) });
    queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ_ABASTECIMENTOS] });
    const id = atividadeId;
    if (!id) return;
    obterAtividade(id)
      .then((/** @type {any} */ a) => {
        if (a && typeof a === "object" && String(a.id) === id && atividadeAtual.current === id) onAtividadeAtualizada(a);
      })
      .catch(() => {
        /* a tela da atividade mostra o erro dela; a lista já foi relida */
      });
  };

  /** O lançamento devolvido pelo servidor entra na lista já (a releitura confirma a ordem). @param {any} ap */
  const mesclarNaLista = (ap) => {
    if (!ap || typeof ap !== "object" || ap.id == null) return;
    queryClient.setQueryData(chave, (/** @type {unknown} */ antigo) => {
      if (antigo === undefined) return antigo;
      const lista = itensDaLista(antigo);
      const existe = lista.some((x) => String(x?.id) === String(ap.id));
      const nova = existe ? lista.map((x) => (String(x?.id) === String(ap.id) ? ap : x)) : [...lista, ap];
      return Array.isArray(antigo) ? nova : { .../** @type {Record<string, any>} */ (antigo && typeof antigo === "object" ? antigo : {}), items: nova };
    });
  };

  /**
   * Escrita concluída: lista, cabeçalho (totais) e alertas.
   * @param {{ apontamento: any, atividade: any, alertas: any[] }} r @param {string} texto
   */
  const aplicarEscrita = (r, texto) => {
    mesclarNaLista(r.apontamento);
    queryClient.invalidateQueries({ queryKey: chave });
    // O totalizador (produtos, máquinas, custo) se relê depois de TODA escrita.
    queryClient.invalidateQueries({ queryKey: chaveTotais(empresaId, atividadeId) });
    if (r.atividade && String(r.atividade.id) === atividadeAtual.current) onAtividadeAtualizada(r.atividade);
    const dia = formatarDiaAtividade(r.apontamento?.data_operacional);
    const textos = r.alertas.map((a) => `${dia ? `${dia}: ` : ""}${mensagemDoAlertaAtividade(a)}`);
    setAlertas(textos);
    notifySuccess("Sucesso", texto);
    if (textos.length) notifyWarning("Atenção", textos[0]);
  };

  /** @param {'novo'|'editar'|'repetir'} modo @param {any} [apontamento] */
  const abrir = (modo, apontamento = null) => {
    proximaChave.current += 1;
    setAlertas([]);
    setJanela({ modo, apontamento, chave: proximaChave.current });
  };

  /** @param {'novo'|'editar'|'repetir'} modo @param {{ apontamento: any }} r */
  const textoDoSucesso = (modo, r) => {
    const dia = formatarDiaAtividade(r.apontamento?.data_operacional);
    const passada = rotuloDaPassada(r.apontamento?.sequencia);
    const daPassada = passada ? ` (${passada})` : "";
    if (modo === "editar") return `Lançamento${dia ? ` de ${dia}` : ""} atualizado.`;
    if (modo === "repetir") return `Lançamento repetido${dia ? ` em ${dia}` : ""}${daPassada}.`;
    return `Lançamento${dia ? ` de ${dia}` : ""} gravado${daPassada}.`;
  };

  // ─── Cancelamento ───────────────────────────────────────────────────
  /** O serviço confere o motivo (3 a 500 caracteres) ANTES da rede. @param {string} motivo */
  const enviarCancelamento = async (motivo) => {
    const alvo = cancelando;
    if (!alvo || !atividadeId) return;
    try {
      const r = normalizarRespostaDeEscrita(await cancelarApontamento(atividadeId, String(alvo.id), { versao: alvo.versao, motivo }));
      setCancelando(null);
      // O cancelamento do lançamento cancela os abastecimentos ligados a ele (D-PROD-211).
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ_ABASTECIMENTOS] });
      aplicarEscrita(r, `Lançamento de ${formatarDiaAtividade(alvo.data_operacional)} cancelado. Ele continua no histórico; nada foi apagado.`);
    } catch (erro) {
      // Sem resposta: o diálogo mostra "resultado incerto" (consultar ou repetir); a lista é relida.
      if (!ehResultadoIncerto(erro)) notifyWarning("Atenção", mensagemDeErroAtividade(erro, "Não foi possível cancelar o lançamento. Nada foi alterado."));
      if (ehResultadoIncerto(erro) || pedeReleitura(erro)) relerTudo();
      throw erro;
    }
  };

  /** "Consultar" depois de um cancelamento sem resposta: relê a lista e confere o lançamento. */
  const consultarCancelamento = async () => {
    const alvo = cancelando;
    if (!alvo || !atividadeId) return;
    try {
      const r = await listarApontamentos(atividadeId);
      queryClient.setQueryData(chave, r);
      const atual = itensDaLista(r).find((x) => String(x?.id) === String(alvo.id));
      if (atual?.status === STATUS_CANCELADO) {
        setCancelando(null);
        notifySuccess("Lançamento cancelado", `O lançamento de ${formatarDiaAtividade(alvo.data_operacional)} aparece cancelado: o envio anterior foi gravado.`);
        relerTudo();
      } else {
        notifyInfo("Ainda confirmado", "O cancelamento não aparece gravado. Pode repetir o envio: se ele já tiver sido gravado, o servidor recusa sem mudar nada.");
      }
    } catch (erro) {
      notifyWarning("Atenção", mensagemDeErroAtividade(erro, "Não foi possível consultar agora. Tente de novo."));
    }
  };

  // ─── Tela ───────────────────────────────────────────────────────────
  if (!podeVer) {
    return (
      <section className="cadastro-b1 min-w-0" data-testid="lista-apontamentos">
        <AvisoGestao testId="apontamentos-sem-permissao">Você não tem permissão para ver os lançamentos desta atividade.</AvisoGestao>
      </section>
    );
  }

  let aviso = null;
  if (!empresaId) aviso = "Selecione uma fazenda para ver os lançamentos.";
  else if (atividade?.status === STATUS_CONCLUIDA) aviso = "Atividade concluída: os lançamentos ficam só para consulta. Para lançar ou corrigir, reabra a atividade.";
  else if (atividade?.status === STATUS_CANCELADA) aviso = "Atividade cancelada: os lançamentos foram cancelados junto e ficam no histórico.";
  else if (aberta && algumaEscrita && semFuso) {
    aviso = "Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de lançar, editar ou cancelar lançamentos: o servidor recusa sem ele.";
  }

  /** @param {any} ap */
  const linha = (ap) => {
    const id = String(ap.id);
    const cancelado = ap.status === STATUS_CANCELADO;
    const confirmado = ap.status === STATUS_CONFIRMADO;
    const turnoEPassada = [rotuloDoTurno(ap.turno), rotuloDaPassada(ap.sequencia)].filter(Boolean).join(" · ");
    const operador = rotuloDoUsuario(ap.operador);
    const area = formatarComUnidade(ap.area_executada_dia, "ha");
    const producao = formatarComUnidade(ap.quantidade_produzida_dia, sigla);
    const observacao = typeof ap.observacao === "string" ? ap.observacao.trim() : "";
    const comAcoes = confirmado && (podeLancar || podeEditar || podeCancelar);
    return (
      <li key={id} className={cancelado ? LINHA_CANCELADA : LINHA_CONFIRMADA} data-testid={`apontamento-${id}`} data-status={String(ap.status ?? "")}>
        <span className={cancelado ? "line-through" : "font-medium"} data-testid={`apontamento-${id}-passada`}>
          {turnoEPassada}
        </span>
        {operador ? <span data-testid={`apontamento-${id}-operador`}>· {operador}</span> : null}
        {area ? <span data-testid={`apontamento-${id}-area`}>· área {area}</span> : null}
        {producao ? <span data-testid={`apontamento-${id}-producao`}>· produção {producao}</span> : null}
        {observacao ? <span className="break-words">· {observacao}</span> : null}
        <SeloAbastecimento status={String(ap.status ?? "")} testId={`apontamento-${id}-status`} />
        {cancelado ? (
          <span className="break-words" data-testid={`apontamento-${id}-cancelamento`}>
            {textoDoCancelamento(ap, fuso)}
          </span>
        ) : null}
        {comAcoes ? (
          <span className="ml-auto flex flex-wrap gap-2">
            {podeLancar ? (
              <button type="button" className={`${BOTAO_SECUNDARIO} tb-btn-sm`} onClick={() => abrir("repetir", ap)} data-testid={`apontamento-${id}-repetir`}>
                <Repeat size={14} aria-hidden /> Repetir
              </button>
            ) : null}
            {podeEditar ? (
              <button type="button" className={`${BOTAO_SECUNDARIO} tb-btn-sm`} onClick={() => abrir("editar", ap)} data-testid={`apontamento-${id}-editar`}>
                <Pencil size={14} aria-hidden /> Editar
              </button>
            ) : null}
            {podeCancelar ? (
              <button
                type="button"
                className={`${BOTAO_PERIGO} tb-btn-sm`}
                onClick={() => {
                  setAlertas([]);
                  setCancelando(ap);
                }}
                data-testid={`apontamento-${id}-cancelar`}
              >
                <Ban size={14} aria-hidden /> Cancelar
              </button>
            ) : null}
          </span>
        ) : null}
        <LinhasDoApontamento
          atividade={atividade}
          apontamento={ap}
          permiteProduto={permiteProduto}
          permiteImplemento={permiteImplemento}
          permiteMaoObra={permiteMaoObra}
          permiteServico={permiteServico}
          podeLancar={podeLancar}
          podeEditar={podeEditar}
          podeCancelar={podeCancelar}
          gravavel={gravavel}
          escopo={escopo}
          fuso={fuso}
          onEscrita={aplicarEscrita}
          onMudou={relerTudo}
        />
      </li>
    );
  };

  const listaVazia = consulta.isSuccess && itens.length === 0;
  const passadaCancelando = cancelando ? rotuloDaPassada(cancelando.sequencia) : "";

  return (
    // Os botões seguem as ações da tela (lançar, editar e cancelar apontamento): a heurística de texto do Layout não vale.
    <section className="cadastro-b1 min-w-0" data-permissao-explicita="" data-testid="lista-apontamentos">
      <div className="b1 mg-b1-form-grid w-full min-h-0">
        <SecaoForm titulo={titulo} />
        {aviso ? (
          <div className="col-span-12">
            <AvisoGestao testId="apontamentos-aviso">{aviso}</AvisoGestao>
          </div>
        ) : null}
        {podeLancar ? (
          <div className="col-span-12 flex flex-wrap gap-2" data-testid="apontamentos-acoes">
            <button type="button" className={BOTAO_PRIMARIO} onClick={() => abrir("novo")} data-testid="apontamento-novo">
              <Plus className="h-4 w-4" aria-hidden /> Novo lançamento
            </button>
            {ultimo ? (
              <button type="button" className={BOTAO_SECUNDARIO} onClick={() => abrir("repetir", ultimo)} data-testid="apontamento-repetir-ultimo">
                <Repeat className="h-4 w-4" aria-hidden /> Repetir último lançamento
              </button>
            ) : null}
          </div>
        ) : null}
        {alertas.length ? (
          <div className="col-span-12" data-testid="apontamentos-alertas">
            <AvisoGestao testId="apontamento-alerta">
              {alertas.map((t, k) => (
                <p key={k} className="break-words">
                  {t}
                </p>
              ))}
            </AvisoGestao>
          </div>
        ) : null}
        {consulta.isLoading && empresaId ? (
          <p role="status" className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="apontamentos-carregando">
            Carregando os lançamentos…
          </p>
        ) : null}
        {consulta.isError ? (
          <div className="col-span-12">
            <AvisoGestao testId="apontamentos-erro">
              {mensagemDeErroAtividade(consulta.error, "Não foi possível carregar os lançamentos. Verifique a conexão e tente de novo.")}{" "}
              <button type="button" className="underline" onClick={() => consulta.refetch()}>
                Tentar novamente
              </button>
            </AvisoGestao>
          </div>
        ) : null}
        {listaVazia ? (
          <div className="col-span-12">
            <AvisoGestao tone="blue" testId="apontamentos-vazio">
              Nenhum lançamento nesta atividade ainda.
            </AvisoGestao>
          </div>
        ) : null}
        {dias.map(({ dia, itens: doDia }) => (
          <div key={dia || "sem-dia"} className="col-span-12 min-w-0" data-testid={`apontamentos-dia-${dia}`}>
            <p className={TITULO_DIA}>
              {formatarDiaAtividade(dia) || "Sem data"} · {doDia.length} {doDia.length === 1 ? "lançamento" : "lançamentos"}
            </p>
            <ul className="space-y-1.5" aria-label={`Lançamentos de ${formatarDiaAtividade(dia) || "dia sem data"}`}>
              {doDia.map(linha)}
            </ul>
          </div>
        ))}
      </div>

      {janela ? (
        <FormularioApontamento
          key={janela.chave}
          atividade={atividade}
          apontamento={janela.modo === "editar" ? janela.apontamento : null}
          base={janela.modo === "repetir" ? janela.apontamento : null}
          permiteProduto={permiteProduto}
          permiteImplemento={permiteImplemento}
          permiteMaoObra={permiteMaoObra}
          permiteServico={permiteServico}
          escopo={escopo}
          onSalvo={(r) => {
            const modo = janela.modo;
            setJanela(null);
            aplicarEscrita(r, textoDoSucesso(modo, r));
          }}
          onCancelar={() => setJanela(null)}
          onMudou={relerTudo}
        />
      ) : null}

      {cancelando ? (
        <DialogoAcao
          key={`cancelar-${cancelando.id}-${cancelando.versao}`}
          aberto
          titulo={`Cancelar lançamento de ${formatarDiaAtividade(cancelando.data_operacional)}${passadaCancelando ? ` (${passadaCancelando})` : ""}`}
          descricao={`O lançamento continua no histórico como cancelado; nada é apagado. Ele deixa de contar na área executada e na produção da atividade e não aceita mais edição. Informe o motivo (pelo menos ${MOTIVO_MINIMO} caracteres).`}
          rotuloBotao="Cancelar lançamento"
          testId="dialogo-cancelar-apontamento"
          contexto={CONTEXTO_MENSAGENS}
          onFechar={() => setCancelando(null)}
          onEnviar={enviarCancelamento}
          onConsultar={consultarCancelamento}
        />
      ) : null}
    </section>
  );
}
