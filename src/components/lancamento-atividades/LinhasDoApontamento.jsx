import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Pencil, Plus } from "lucide-react";
import { tanqueEJatoDoDia, textoDosJatosSalvos } from "@/lib/jatosRegras";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { MobileSheetPortalCtx } from "@/components/common/MobileSheet";
import { SeloAbastecimento } from "@/components/patrimonio/TabelaAbastecimentos";
import FormularioAbastecimento from "@/components/patrimonio/FormularioAbastecimento";
import { BOTAO_PERIGO, BOTAO_SECUNDARIO, DialogoCancelarAbastecimento, DialogoPreviaAbastecimento } from "@/components/patrimonio/DialogosAbastecimento";
import { useAcoesTelaAbastecimento } from "@/hooks/usePatrimonioSessao";
import { useVerCusto } from "@/components/lancamento-atividades/VerCusto";
import { useEmpresaRealSelecionadaId } from "@/hooks/useLancamentoAtividadesSessao";
import { chaveAbastecimentosDoApontamento, useFluxoAbastecimento } from "@/hooks/useFluxoAbastecimento";
import { useAuth } from "@/lib/AuthContext";
import { formatarQuantidadeCurta, formularioDoApontamento, rotuloDaOrigem, rotuloDoBem } from "@/lib/abastecimentoRegras";
import { hojeNoFuso } from "@/lib/diaCivil";
import { mensagemErroAbastecimento } from "@/lib/patrimonioErros";
import { detalharAbastecimento, listarAbastecimentosPagina } from "@/services/abastecimentoService";
import { DialogoCancelarLinha, JanelaLinhaMaoObra, JanelaLinhaMaquina, JanelaLinhaProduto, JanelaLinhaServico } from "@/components/lancamento-atividades/JanelasDaLinha";
import { formatarInstante } from "@/lib/diaCivil";
import { notifyWarning } from "@/lib/maikeNotify";
import { LOCALE_ATIVIDADE, STATUS_CANCELADO, STATUS_CONFIRMADO, rotuloDoUsuario } from "@/lib/lancamentoAtividadesRegras";
import { chaveApontamentos, itensDaLista } from "@/lib/atividadeApontamentoRegras";
import {
  LINHA_MAO_OBRA,
  LINHA_MAQUINA,
  LINHA_PRODUTO,
  LINHA_SERVICO,
  ROTULO_MEDIDA,
  doseHa,
  formatarCustoLinha,
  formatarDecimalLinha,
  formatarDose,
  formatarQuantidadeLinha,
  formatarQuantidadeMaoObra,
  formatarQuantidadeServico,
  formatarUso,
  linhasDoApontamento,
  rotuloDaMaquinaDaLinha,
  rotuloDaUnidadeDoMedidor,
  comMarcaDeTerceiro,
  rotuloDaMaoObraDaLinha,
  rotuloDoImplementoDaLinha,
  rotuloDoLocalDaLinha,
  rotuloDoParceiroDaLinha,
  rotuloDoProdutoDaLinha,
  rotuloDoServicoDaLinha,
  rotuloDaAtividadeDoAbastecimento,
  rotuloDoLancamentoDoAbastecimento,
  statusDaLinha,
  chaveTotais,
} from "@/lib/atividadeLinhasRegras";

/** Linha de produto/máquina/mão de obra/serviço: o desenho das linhas de lançamento (`ListaApontamentos`). */
const LINHA = "flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-[12px]";
const LINHA_CONFIRMADA = `${LINHA} border-emerald-200 bg-white`;
const LINHA_CANCELADA = `${LINHA} border-slate-200 bg-slate-50 text-slate-500`;
const TITULO_BLOCO = "mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]";

/**
 * "Cancelado em 13/11/2026 14:05 por Fulano · motivo: …" (edição: "substituído pela edição").
 * @param {any} l @param {string|null} fuso
 */
const textoDoCancelamento = (l, fuso) => {
  if (l?.cancelamento_origem === "EDICAO") return "Substituída pela edição";
  const quando = typeof l?.cancelado_em === "string" && l.cancelado_em ? ` em ${formatarInstante(l.cancelado_em, LOCALE_ATIVIDADE, fuso)}` : "";
  const quem = rotuloDoUsuario(l?.cancelado_por);
  const motivo = typeof l?.motivo_cancelamento === "string" && l.motivo_cancelamento.trim() ? ` · motivo: ${l.motivo_cancelamento.trim()}` : "";
  const origem = l?.cancelamento_origem === "APONTAMENTO" ? " (com o lançamento)" : l?.cancelamento_origem === "ATIVIDADE" ? " (com a atividade)" : "";
  return `Cancelada${origem}${quando}${quem ? ` por ${quem}` : ""}${motivo}`;
};

/**
 * @typedef {'produtos'|'maquinas'|'mao-obra'|'servicos'} TipoDeLinha
 * @typedef {{ tipo: TipoDeLinha, linha: any | null, chave: number }} JanelaDaLinha
 * @typedef {{ tipo: TipoDeLinha, linha: any, apontamento: any }} CancelamentoDaLinha
 */

/** Os abastecimentos de um lançamento (uma página basta: são os do dia de uma máquina ou poucas). */
const LIMITE_ABASTECIMENTOS_DO_LANCAMENTO = 100;

/**
 * Bloco "Abastecimentos" de UM lançamento (D-PROD-211): a lista dos abastecimentos ligados a ele (filtro
 * `apontamento_id` da lista de abastecimentos) e o botão "Novo abastecimento", que abre o MESMO formulário da tela
 * Abastecimentos (`FormularioAbastecimento`, prévia e confirmação idempotente do `useFluxoAbastecimento`) já ligado
 * ao lançamento: a atividade e o lançamento aparecem só para leitura e a data padrão é a do lançamento. O cancelamento
 * usa o diálogo de sempre (`DialogoCancelarAbastecimento`). Só aparece com a tela Abastecimentos liberada (`ver`);
 * "Novo" pede `criar` e "Cancelar" pede `cancelar` — e os dois, a atividade ABERTA, o fuso da fazenda e o lançamento
 * CONFIRMADO (`gravavel`). Depois de gravar: as listas de abastecimento, os lançamentos e os totais da atividade se
 * relêem. Nem o tipo de medidor (vem do bem) nem o centro de custo (snapshot do servidor) são perguntados.
 * @param {{ atividade: any, apontamento: any, gravavel: boolean, fuso: string|null }} props
 */
function AbastecimentosDoApontamento({ atividade, apontamento, gravavel, fuso }) {
  const verCusto = useVerCusto();
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaAbastecimento();
  const { clienteId } = useAuth();
  // O MESMO escopo da pendência da tela Abastecimentos (cliente e login).
  const escopo = `${clienteId || "sem-tenant"}:${acoes.login || "sem-login"}`;
  const apId = apontamento?.id ? String(apontamento.id) : null;
  const atividadeId = atividade?.id ? String(atividade.id) : null;
  const confirmado = apontamento?.status === STATUS_CONFIRMADO;
  const podeNovo = gravavel && confirmado && acoes.criar === true;
  const podeCancelar = gravavel && confirmado && acoes.cancelar === true;
  const hoje = hojeNoFuso(fuso);
  const [janela, setJanela] = useState(/** @type {number|null} */ (null));
  const [alvoFolha, setAlvoFolha] = useState(/** @type {HTMLElement | null} */ (null));
  const [abrindo, setAbrindo] = useState(/** @type {string|null} */ (null));

  /** Os lançamentos e os totais da atividade (o servidor já somou o combustível). */
  const relerAtividade = () => {
    queryClient.invalidateQueries({ queryKey: chaveTotais(empresaId, atividadeId) });
    queryClient.invalidateQueries({ queryKey: chaveApontamentos(empresaId, atividadeId) });
  };
  const fluxo = useFluxoAbastecimento({
    empresaId,
    hoje,
    podeCriar: podeNovo,
    escopo,
    onConcluido: (_registro, _emp, tipo) => {
      relerAtividade();
      if (tipo === "confirmar") setJanela(null);
    },
  });

  const consulta = useQuery({
    queryKey: chaveAbastecimentosDoApontamento(empresaId, apId),
    queryFn: () => listarAbastecimentosPagina(empresaId, { apontamentoId: apId, limit: LIMITE_ABASTECIMENTOS_DO_LANCAMENTO }),
    enabled: Boolean(empresaId && apId && acoes.ver),
    staleTime: 15 * 1000,
  });
  if (!acoes.ver || !apId) return null;
  const itens = itensDaLista(consulta.data);

  const abrirNovo = () => {
    fluxo.iniciar(formularioDoApontamento(hoje, apontamento));
    setJanela(Date.now());
  };

  /** O cancelamento precisa do DETALHE (versão e o efeito no medidor). @param {any} a */
  const abrirCancelamento = async (a) => {
    if (!empresaId || abrindo) return;
    setAbrindo(String(a.id));
    try {
      fluxo.setCancelando(await detalharAbastecimento(empresaId, String(a.id)));
    } catch (erro) {
      notifyWarning("Atenção", mensagemErroAbastecimento(erro, "Não foi possível abrir o abastecimento."));
    } finally {
      setAbrindo(null);
    }
  };

  /** @param {any} a */
  const linha = (a) => {
    const id = String(a.id);
    const cancelado = a.status === STATUS_CANCELADO;
    const custo = formatarCustoLinha(a.custo_total);
    return (
      <li key={id} className={cancelado ? LINHA_CANCELADA : LINHA_CONFIRMADA} data-testid={`linha-abastecimento-${id}`} data-status={String(a.status ?? "")}>
        <span className={cancelado ? "line-through" : "font-medium"} data-testid={`linha-abastecimento-${id}-nome`}>
          Nº {a.numero ?? "—"} · {rotuloDoBem(a.bem) || "Máquina"}
        </span>
        <span>· {a.produto?.nome ?? "Produto"}</span>
        <span data-testid={`linha-abastecimento-${id}-quantidade`}>· {formatarQuantidadeCurta(a.quantidade, a.unidade) || "—"}</span>
        <span data-testid={`linha-abastecimento-${id}-origem`}>· {rotuloDaOrigem(a)}</span>
        {verCusto && custo ? <span data-testid={`linha-abastecimento-${id}-custo`}>· custo {custo}</span> : null}
        <SeloAbastecimento status={String(a.status ?? "")} testId={`linha-abastecimento-${id}-status`} />
        {!cancelado && podeCancelar ? (
          <span className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              className={`${BOTAO_PERIGO} tb-btn-sm`}
              onClick={() => abrirCancelamento(a)}
              disabled={abrindo !== null}
              data-testid={`linha-abastecimento-${id}-cancelar`}
            >
              <Ban size={14} aria-hidden /> Cancelar
            </button>
          </span>
        ) : null}
      </li>
    );
  };

  return (
    <div className="min-w-0" data-testid={`apontamento-${apId}-abastecimentos`}>
      <p className={TITULO_BLOCO}>Abastecimentos</p>
      {consulta.isError ? (
        <p className="text-[12px] text-red-700" role="alert" data-testid={`apontamento-${apId}-abastecimentos-erro`}>
          {mensagemErroAbastecimento(consulta.error, "Não foi possível ler os abastecimentos deste lançamento.")}{" "}
          <button type="button" className="underline" onClick={() => consulta.refetch()}>
            Tentar novamente
          </button>
        </p>
      ) : itens.length ? (
        <ul className="space-y-1" aria-label="Abastecimentos do lançamento">
          {itens.map(linha)}
        </ul>
      ) : consulta.isSuccess ? (
        <p className="text-[12px] text-[var(--mg-text-2,#475569)]">Nenhum abastecimento neste lançamento.</p>
      ) : null}
      {podeNovo ? (
        <button type="button" className={`${BOTAO_SECUNDARIO} tb-btn-sm mt-1`} onClick={abrirNovo} data-testid={`apontamento-${apId}-novo-abastecimento`}>
          <Plus size={14} aria-hidden /> Novo abastecimento
        </button>
      ) : null}

      {janela !== null ? (
        <B1Janela
          key={janela}
          aberto
          onFechar={() => setJanela(null)}
          podeFechar={!fluxo.previando}
          aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
          titulo="Novo abastecimento"
          descricao={[rotuloDoLancamentoDoAbastecimento(apontamento), rotuloDaAtividadeDoAbastecimento(atividade)].join(" — ")}
          testId="janela-abastecimento-lancamento"
          // Os botões daqui seguem as ações da tela Abastecimentos: a heurística de texto do Layout não vale.
          contentProps={{ "data-permissao-explicita": "" }}
          fora={<div ref={setAlvoFolha} className="contents" />}
        >
          <MobileSheetPortalCtx.Provider value={alvoFolha}>
            <FormularioAbastecimento
              empresaId={/** @type {string} */ (empresaId)}
              form={fluxo.form}
              setForm={fluxo.setForm}
              hoje={hoje}
              erros={fluxo.erros}
              limparErro={fluxo.limparErro}
              previando={fluxo.previando}
              situacaoPrevia={fluxo.situacaoPrevia}
              onPrevia={fluxo.pedirPrevia}
              onReabrirPrevia={() => fluxo.setPreviaAberta(true)}
              vinculo={{ atividade, apontamento }}
            />
          </MobileSheetPortalCtx.Provider>
        </B1Janela>
      ) : null}

      {fluxo.previa ? (
        <DialogoPreviaAbastecimento
          key={`previa-${fluxo.previa.seq}`}
          aberto={fluxo.previaAberta && fluxo.situacaoPrevia === "valida"}
          previa={fluxo.previa.resposta}
          origem={fluxo.origemDaPrevia}
          custoExterno={fluxo.custoExternoDaPrevia}
          podeConfirmar={podeNovo}
          onFechar={() => fluxo.setPreviaAberta(false)}
          onConfirmar={fluxo.confirmarDaPrevia}
          onConsultar={fluxo.consultarConfirmacao}
        />
      ) : null}

      {fluxo.cancelando ? (
        <DialogoCancelarAbastecimento
          key={`cancelar-abastecimento-${fluxo.cancelando.id}-${fluxo.cancelando.versao}`}
          aberto
          registro={fluxo.cancelando}
          onFechar={() => fluxo.setCancelando(null)}
          onEnviar={fluxo.enviarCancelamento}
          onConsultar={fluxo.consultarCancelamento}
        />
      ) : null}
    </div>
  );
}

/**
 * Linhas que geram custo de UM apontamento (D-PROD-202, Fatia 3): os blocos "Produtos" e "Máquinas", cada um com as
 * linhas (as canceladas continuam visíveis, marcadas) e o botão de adicionar. Adicionar, editar e cancelar seguem as
 * ações da tela (`podeLancar`, `podeEditar`, `podeCancelar` — já com a atividade ABERTA e o fuso) e só valem no
 * apontamento CONFIRMADO e na linha CONFIRMADA. Sem `permite_produto` no tipo, o bloco Produtos some (o servidor também
 * recusa); a linha de produto antiga, se houver, continua listada. Fatia 4: os blocos "Mão de obra" e "Serviços", no
 * mesmo molde, cada um só com a flag do tipo (`permite_mao_obra`, `permite_servico`). D-PROD-211: o bloco
 * "Abastecimentos" (`AbastecimentosDoApontamento`), só com a tela Abastecimentos liberada; `gravavel` = atividade
 * ABERTA, fazenda com fuso e a empresa real.
 *
 * @param {{
 *   atividade: any,
 *   apontamento: any,
 *   permiteProduto: boolean,
 *   permiteImplemento: boolean,
 *   permiteMaoObra?: boolean,
 *   permiteServico?: boolean,
 *   podeLancar: boolean,
 *   podeEditar: boolean,
 *   podeCancelar: boolean,
 *   gravavel?: boolean,
 *   escopo: string,
 *   fuso: string|null,
 *   onEscrita: (resultado: { apontamento: any, atividade: any, alertas: any[] }, texto: string) => void,
 *   onMudou: () => void,
 * }} props O cancelamento da linha é o `DialogoCancelarLinha` (o mesmo da janela por tipo, D-PROD-233).
 */
export default function LinhasDoApontamento({
  atividade,
  apontamento,
  permiteProduto,
  permiteImplemento,
  permiteMaoObra = false,
  permiteServico = false,
  podeLancar,
  podeEditar,
  podeCancelar,
  gravavel = false,
  escopo,
  fuso,
  onEscrita,
  onMudou,
}) {
  const verCusto = useVerCusto();
  const [janela, setJanela] = useState(/** @type {JanelaDaLinha | null} */ (null));
  const [cancelando, setCancelando] = useState(/** @type {CancelamentoDaLinha | null} */ (null));
  const apId = String(apontamento?.id ?? "");
  const { produtos, maquinas, mao_obra: maoObra, servicos } = linhasDoApontamento(apontamento);
  const confirmado = apontamento?.status === STATUS_CONFIRMADO;
  const adicionar = confirmado && podeLancar;
  const editar = confirmado && podeEditar;
  const cancelar = confirmado && podeCancelar;
  const mostrarProdutos = permiteProduto || produtos.length > 0;
  const mostrarMaoObra = permiteMaoObra || maoObra.length > 0;
  const mostrarServicos = permiteServico || servicos.length > 0;
  if (!mostrarProdutos && !maquinas.length && !mostrarMaoObra && !mostrarServicos && !adicionar) return null;

  /** @param {TipoDeLinha} tipo @param {any} [linha] */
  const abrir = (tipo, linha = null) => setJanela({ tipo, linha, chave: Date.now() });

  /** @param {any} l */
  const linhaProduto = (l) => {
    const id = String(l.id);
    const cancelada = statusDaLinha(l) === STATUS_CANCELADO;
    const dose = l.dose_ha ?? doseHa(l.quantidade, apontamento?.area_executada_dia);
    const local = rotuloDoLocalDaLinha(l);
    const custo = formatarCustoLinha(l.custo_total);
    const comAcoes = !cancelada && (editar || cancelar);
    return (
      <li key={id} className={cancelada ? LINHA_CANCELADA : LINHA_CONFIRMADA} data-testid={`linha-produto-${id}`} data-status={statusDaLinha(l)}>
        {Number.isInteger(l.jato) && l.jato > 0 ? <span data-testid={`linha-produto-${id}-jato`}>Implemento {l.jato} ·</span> : null}
        <span className={cancelada ? "line-through" : "font-medium"} data-testid={`linha-produto-${id}-nome`}>
          {rotuloDoProdutoDaLinha(l) || "Produto"}
        </span>
        <span data-testid={`linha-produto-${id}-quantidade`}>· {formatarQuantidadeLinha(l.quantidade, l.unidade) || "—"}</span>
        {local ? <span>· de {local}</span> : null}
        {dose ? <span data-testid={`linha-produto-${id}-dose`}>· dose {formatarDose(dose, l.unidade)}</span> : null}
        {verCusto && custo ? <span data-testid={`linha-produto-${id}-custo`}>· custo {custo}</span> : null}
        <SeloAbastecimento status={statusDaLinha(l)} testId={`linha-produto-${id}-status`} />
        {cancelada ? (
          <span className="break-words" data-testid={`linha-produto-${id}-cancelamento`}>
            {textoDoCancelamento(l, fuso)}
          </span>
        ) : null}
        {comAcoes ? (
          <span className="ml-auto flex flex-wrap gap-2">
            {editar ? (
              <button type="button" className={`${BOTAO_SECUNDARIO} tb-btn-sm`} onClick={() => abrir(LINHA_PRODUTO, l)} data-testid={`linha-produto-${id}-editar`}>
                <Pencil size={14} aria-hidden /> Editar
              </button>
            ) : null}
            {cancelar ? (
              <button type="button" className={`${BOTAO_PERIGO} tb-btn-sm`} onClick={() => setCancelando({ tipo: LINHA_PRODUTO, linha: l, apontamento })} data-testid={`linha-produto-${id}-cancelar`}>
                <Ban size={14} aria-hidden /> Cancelar
              </button>
            ) : null}
          </span>
        ) : null}
      </li>
    );
  };

  /** @param {any} l */
  const linhaMaquina = (l) => {
    const id = String(l.id);
    const cancelada = statusDaLinha(l) === STATUS_CANCELADO;
    const implemento = rotuloDoImplementoDaLinha(l);
    const unidade = rotuloDaUnidadeDoMedidor(l.medidor_tipo, l.medidor_unidade);
    const leituras =
      l.sem_medidor === true
        ? "sem medidor"
        : l.leitura_inicial != null || l.leitura_final != null
          ? `leitura ${formatarDecimalLinha(l.leitura_inicial) || "—"} → ${formatarDecimalLinha(l.leitura_final) || "—"}${unidade ? ` ${unidade}` : ""}`
          : "";
    const custo = formatarCustoLinha(l.custo_total);
    const comAcoes = !cancelada && (editar || cancelar);
    return (
      <li key={id} className={cancelada ? LINHA_CANCELADA : LINHA_CONFIRMADA} data-testid={`linha-maquina-${id}`} data-status={statusDaLinha(l)}>
        <span className={cancelada ? "line-through" : "font-medium"} data-testid={`linha-maquina-${id}-nome`}>
          {rotuloDaMaquinaDaLinha(l) || "Máquina"}
          {implemento ? ` + ${implemento}` : ""}
        </span>
        {leituras ? <span data-testid={`linha-maquina-${id}-leituras`}>· {leituras}</span> : null}
        <span data-testid={`linha-maquina-${id}-uso`}>· uso {formatarUso(l.quantidade_uso, l.medidor_tipo, l.medidor_unidade) || "—"}</span>
        {verCusto && custo ? <span data-testid={`linha-maquina-${id}-custo`}>· custo {custo}</span> : null}
        {typeof l.justificativa_salto === "string" && l.justificativa_salto.trim() ? <span className="break-words">· salto: {l.justificativa_salto.trim()}</span> : null}
        <SeloAbastecimento status={statusDaLinha(l)} testId={`linha-maquina-${id}-status`} />
        {cancelada ? (
          <span className="break-words" data-testid={`linha-maquina-${id}-cancelamento`}>
            {textoDoCancelamento(l, fuso)}
          </span>
        ) : null}
        {comAcoes ? (
          <span className="ml-auto flex flex-wrap gap-2">
            {editar ? (
              <button type="button" className={`${BOTAO_SECUNDARIO} tb-btn-sm`} onClick={() => abrir(LINHA_MAQUINA, l)} data-testid={`linha-maquina-${id}-editar`}>
                <Pencil size={14} aria-hidden /> Editar
              </button>
            ) : null}
            {cancelar ? (
              <button type="button" className={`${BOTAO_PERIGO} tb-btn-sm`} onClick={() => setCancelando({ tipo: LINHA_MAQUINA, linha: l, apontamento })} data-testid={`linha-maquina-${id}-cancelar`}>
                <Ban size={14} aria-hidden /> Cancelar
              </button>
            ) : null}
          </span>
        ) : null}
      </li>
    );
  };

  /**
   * Ações da linha confirmada (o mesmo par editar/cancelar das outras).
   * @param {TipoDeLinha} tipo @param {string} prefixo @param {any} l
   */
  const acoesDaLinha = (tipo, prefixo, l) => (
    <span className="ml-auto flex flex-wrap gap-2">
      {editar ? (
        <button type="button" className={`${BOTAO_SECUNDARIO} tb-btn-sm`} onClick={() => abrir(tipo, l)} data-testid={`${prefixo}-editar`}>
          <Pencil size={14} aria-hidden /> Editar
        </button>
      ) : null}
      {cancelar ? (
        <button type="button" className={`${BOTAO_PERIGO} tb-btn-sm`} onClick={() => setCancelando({ tipo, linha: l, apontamento })} data-testid={`${prefixo}-cancelar`}>
          <Ban size={14} aria-hidden /> Cancelar
        </button>
      ) : null}
    </span>
  );

  /** @param {any} l */
  const linhaMaoObra = (l) => {
    const id = String(l.id);
    const prefixo = `linha-mao-obra-${id}`;
    const cancelada = statusDaLinha(l) === STATUS_CANCELADO;
    const unitario = formatarCustoLinha(l.custo_unitario);
    const custo = formatarCustoLinha(l.custo_total);
    return (
      <li key={id} className={cancelada ? LINHA_CANCELADA : LINHA_CONFIRMADA} data-testid={prefixo} data-status={statusDaLinha(l)}>
        <span className={cancelada ? "line-through" : "font-medium"} data-testid={`${prefixo}-nome`}>
          {comMarcaDeTerceiro(rotuloDaMaoObraDaLinha(l) || "Funcionário ou terceiro", l)}
        </span>
        <span data-testid={`${prefixo}-quantidade`}>
          · {ROTULO_MEDIDA[String(l.tipo_medida ?? "")] ?? "—"} · {formatarQuantidadeMaoObra(l.quantidade, l.tipo_medida) || "—"}
        </span>
        {verCusto && unitario ? <span data-testid={`${prefixo}-unitario`}>· {unitario} cada</span> : null}
        {verCusto ? <span data-testid={`${prefixo}-custo`}>· custo {custo || "sem custo no cadastro"}</span> : null}
        <SeloAbastecimento status={statusDaLinha(l)} testId={`${prefixo}-status`} />
        {cancelada ? (
          <span className="break-words" data-testid={`${prefixo}-cancelamento`}>
            {textoDoCancelamento(l, fuso)}
          </span>
        ) : null}
        {!cancelada && (editar || cancelar) ? acoesDaLinha(LINHA_MAO_OBRA, prefixo, l) : null}
      </li>
    );
  };

  /** @param {any} l */
  const linhaServico = (l) => {
    const id = String(l.id);
    const prefixo = `linha-servico-${id}`;
    const cancelada = statusDaLinha(l) === STATUS_CANCELADO;
    const parceiro = rotuloDoParceiroDaLinha(l);
    const valor = formatarCustoLinha(l.valor_total);
    const documento = typeof l.documento_referencia === "string" ? l.documento_referencia.trim() : "";
    return (
      <li key={id} className={cancelada ? LINHA_CANCELADA : LINHA_CONFIRMADA} data-testid={prefixo} data-status={statusDaLinha(l)}>
        <span className={cancelada ? "line-through" : "font-medium"} data-testid={`${prefixo}-nome`}>
          {rotuloDoServicoDaLinha(l) || "Serviço"}
        </span>
        <span data-testid={`${prefixo}-quantidade`}>· {formatarQuantidadeServico(l.quantidade, l.unidade) || "—"}</span>
        {parceiro ? <span data-testid={`${prefixo}-parceiro`}>· por {parceiro}</span> : null}
        {documento ? <span className="break-words">· doc. {documento}</span> : null}
        {valor ? <span data-testid={`${prefixo}-valor`}>· valor {valor}</span> : null}
        <SeloAbastecimento status={statusDaLinha(l)} testId={`${prefixo}-status`} />
        {cancelada ? (
          <span className="break-words" data-testid={`${prefixo}-cancelamento`}>
            {textoDoCancelamento(l, fuso)}
          </span>
        ) : null}
        {!cancelada && (editar || cancelar) ? acoesDaLinha(LINHA_SERVICO, prefixo, l) : null}
      </li>
    );
  };

  return (
    <div className="min-w-0 basis-full space-y-1.5 pl-2" data-testid={`apontamento-${apId}-linhas`}>
      {mostrarProdutos ? (
        <div className="min-w-0" data-testid={`apontamento-${apId}-produtos`}>
          <p className={TITULO_BLOCO}>Produtos</p>
          {/* D-PROD-292: o dia com jatos mostra o resumo dos jatos antes das linhas (cada linha diz o jato dela). */}
          {textoDosJatosSalvos(produtos, maquinas) ? (
            <p className="mb-1 text-[13px] font-semibold text-[#141413]" data-testid={`apontamento-${apId}-jatos`}>
              {textoDosJatosSalvos(produtos, maquinas)}
            </p>
          ) : null}
          {produtos.length ? (
            <ul className="space-y-1" aria-label="Produtos do lançamento">
              {produtos.map(linhaProduto)}
            </ul>
          ) : (
            <p className="text-[12px] text-[var(--mg-text-2,#475569)]">Nenhum produto neste lançamento.</p>
          )}
          {adicionar && permiteProduto ? (
            <button type="button" className={`${BOTAO_SECUNDARIO} tb-btn-sm mt-1`} onClick={() => abrir(LINHA_PRODUTO)} data-testid={`apontamento-${apId}-adicionar-produto`}>
              <Plus size={14} aria-hidden /> Adicionar produto
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="min-w-0" data-testid={`apontamento-${apId}-maquinas`}>
        <p className={TITULO_BLOCO}>Máquinas</p>
        {maquinas.length ? (
          <ul className="space-y-1" aria-label="Máquinas do lançamento">
            {maquinas.map(linhaMaquina)}
          </ul>
        ) : (
          <p className="text-[12px] text-[var(--mg-text-2,#475569)]">Nenhuma máquina neste lançamento.</p>
        )}
        {adicionar ? (
          <button type="button" className={`${BOTAO_SECUNDARIO} tb-btn-sm mt-1`} onClick={() => abrir(LINHA_MAQUINA)} data-testid={`apontamento-${apId}-adicionar-maquina`}>
            <Plus size={14} aria-hidden /> Adicionar máquina
          </button>
        ) : null}
      </div>
      <AbastecimentosDoApontamento atividade={atividade} apontamento={apontamento} gravavel={gravavel} fuso={fuso} />
      {mostrarMaoObra ? (
        <div className="min-w-0" data-testid={`apontamento-${apId}-mao-obra`}>
          <p className={TITULO_BLOCO}>Mão de obra</p>
          {maoObra.length ? (
            <ul className="space-y-1" aria-label="Mão de obra do lançamento">
              {maoObra.map(linhaMaoObra)}
            </ul>
          ) : (
            <p className="text-[12px] text-[var(--mg-text-2,#475569)]">Nenhuma mão de obra neste lançamento.</p>
          )}
          {adicionar && permiteMaoObra ? (
            <button type="button" className={`${BOTAO_SECUNDARIO} tb-btn-sm mt-1`} onClick={() => abrir(LINHA_MAO_OBRA)} data-testid={`apontamento-${apId}-adicionar-mao-obra`}>
              <Plus size={14} aria-hidden /> Adicionar mão de obra
            </button>
          ) : null}
        </div>
      ) : null}
      {mostrarServicos ? (
        <div className="min-w-0" data-testid={`apontamento-${apId}-servicos`}>
          <p className={TITULO_BLOCO}>Serviços</p>
          {servicos.length ? (
            <ul className="space-y-1" aria-label="Serviços do lançamento">
              {servicos.map(linhaServico)}
            </ul>
          ) : (
            <p className="text-[12px] text-[var(--mg-text-2,#475569)]">Nenhum serviço neste lançamento.</p>
          )}
          {adicionar && permiteServico ? (
            <button type="button" className={`${BOTAO_SECUNDARIO} tb-btn-sm mt-1`} onClick={() => abrir(LINHA_SERVICO)} data-testid={`apontamento-${apId}-adicionar-servico`}>
              <Plus size={14} aria-hidden /> Adicionar serviço
            </button>
          ) : null}
        </div>
      ) : null}

      {janela?.tipo === LINHA_PRODUTO ? (
        <JanelaLinhaProduto
          key={janela.chave}
          atividade={atividade}
          apontamento={apontamento}
          linha={janela.linha}
          escopo={escopo}
          onSalvo={(r, texto) => {
            setJanela(null);
            onEscrita(r, texto);
          }}
          onCancelar={() => setJanela(null)}
          onMudou={onMudou}
          {...tanqueEJatoDoDia(apontamento)}
        />
      ) : null}
      {janela?.tipo === LINHA_MAQUINA ? (
        <JanelaLinhaMaquina
          key={janela.chave}
          atividade={atividade}
          apontamento={apontamento}
          linha={janela.linha}
          permiteImplemento={permiteImplemento}
          escopo={escopo}
          onSalvo={(r, texto) => {
            setJanela(null);
            onEscrita(r, texto);
          }}
          onCancelar={() => setJanela(null)}
          onMudou={onMudou}
        />
      ) : null}

      {janela?.tipo === LINHA_MAO_OBRA || janela?.tipo === LINHA_SERVICO ? (
        (() => {
          const Janela = janela.tipo === LINHA_MAO_OBRA ? JanelaLinhaMaoObra : JanelaLinhaServico;
          return (
            <Janela
              key={janela.chave}
              atividade={atividade}
              apontamento={apontamento}
              linha={janela.linha}
              escopo={escopo}
              onSalvo={(r, texto) => {
                setJanela(null);
                onEscrita(r, texto);
              }}
              onCancelar={() => setJanela(null)}
              onMudou={onMudou}
            />
          );
        })()
      ) : null}

      {cancelando ? (
        <DialogoCancelarLinha
          key={`cancelar-linha-${cancelando.linha.id}`}
          atividade={atividade}
          cancelando={cancelando}
          escopo={escopo}
          onCancelada={(r, texto) => {
            setCancelando(null);
            onEscrita(r, texto);
          }}
          onFechar={() => setCancelando(null)}
          onMudou={onMudou}
        />
      ) : null}
    </div>
  );
}
