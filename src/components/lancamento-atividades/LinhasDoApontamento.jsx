import React, { useState } from "react";
import { Ban, Pencil, Plus } from "lucide-react";
import { DialogoAcao } from "@/components/financeiroGestao/DialogosLancamento";
import { SeloAbastecimento } from "@/components/patrimonio/TabelaAbastecimentos";
import { BOTAO_PERIGO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { JanelaLinhaMaoObra, JanelaLinhaMaquina, JanelaLinhaProduto, JanelaLinhaServico } from "@/components/lancamento-atividades/JanelasDaLinha";
import { formatarInstante } from "@/lib/diaCivil";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { LOCALE_ATIVIDADE, MOTIVO_MINIMO, STATUS_CANCELADO, STATUS_CONFIRMADO, formatarDiaAtividade, rotuloDoUsuario } from "@/lib/lancamentoAtividadesRegras";
import { normalizarRespostaDeEscrita, pedeReleitura } from "@/lib/atividadeApontamentoRegras";
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
  linhasDoTipo,
  mensagemDeErroLinha,
  rotuloDaMaquinaDaLinha,
  rotuloDaUnidadeDoMedidor,
  comMarcaDeTerceiro,
  rotuloDaMaoObraDaLinha,
  rotuloDoImplementoDaLinha,
  rotuloDoLocalDaLinha,
  rotuloDoParceiroDaLinha,
  rotuloDoProdutoDaLinha,
  rotuloDoServicoDaLinha,
  statusDaLinha,
} from "@/lib/atividadeLinhasRegras";
import { ACAO_CANCELAR_LINHA, alvoDaLinha, cancelarLinha, limparPendenciaDaLinha, obterApontamento } from "@/services/lancamentoAtividadesService";
import { ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

/** Formatação das mensagens do diálogo de ação (o custo aparece em reais). */
const CONTEXTO_MENSAGENS = Object.freeze({ locale: LOCALE_ATIVIDADE, moeda: "BRL", casas: 2 });

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

/** O nome da linha no diálogo de cancelamento e nas mensagens. @param {TipoDeLinha} tipo @param {any} l */
const nomeDaLinhaDoTipo = (tipo, l) => {
  if (tipo === LINHA_PRODUTO) return `o produto ${rotuloDoProdutoDaLinha(l) || ""}`.trim();
  if (tipo === LINHA_MAQUINA) return `a máquina ${rotuloDaMaquinaDaLinha(l) || ""}`.trim();
  if (tipo === LINHA_MAO_OBRA) return `a mão de obra ${rotuloDaMaoObraDaLinha(l) ? `de ${rotuloDaMaoObraDaLinha(l)}` : ""}`.trim();
  return `o serviço ${rotuloDoServicoDaLinha(l) || ""}`.trim();
};

/** O que acontece ao cancelar cada tipo de linha (a descrição do diálogo). */
const EFEITO_DO_CANCELAMENTO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    [LINHA_PRODUTO]: "A quantidade volta exatamente aos lotes de onde saiu (estorno exato).",
    [LINHA_MAQUINA]: "A leitura desta linha deixa de contar como leitura atual do bem.",
    [LINHA_MAO_OBRA]: "O custo desta mão de obra deixa de contar na atividade.",
    [LINHA_SERVICO]: "O valor deste serviço deixa de contar na atividade.",
  }),
);

/**
 * Linhas que geram custo de UM apontamento (D-PROD-202, Fatia 3): os blocos "Produtos" e "Máquinas", cada um com as
 * linhas (as canceladas continuam visíveis, marcadas) e o botão de adicionar. Adicionar, editar e cancelar seguem as
 * ações da tela (`podeLancar`, `podeEditar`, `podeCancelar` — já com a atividade ABERTA e o fuso) e só valem no
 * apontamento CONFIRMADO e na linha CONFIRMADA. Sem `permite_produto` no tipo, o bloco Produtos some (o servidor também
 * recusa); a linha de produto antiga, se houver, continua listada. Fatia 4: os blocos "Mão de obra" e "Serviços", no
 * mesmo molde, cada um só com a flag do tipo (`permite_mao_obra`, `permite_servico`).
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
 *   escopo: string,
 *   fuso: string|null,
 *   onEscrita: (resultado: { apontamento: any, atividade: any, alertas: any[] }, texto: string) => void,
 *   onMudou: () => void,
 * }} props
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
  escopo,
  fuso,
  onEscrita,
  onMudou,
}) {
  const [janela, setJanela] = useState(/** @type {JanelaDaLinha | null} */ (null));
  const [cancelando, setCancelando] = useState(/** @type {CancelamentoDaLinha | null} */ (null));
  const apId = String(apontamento?.id ?? "");
  const atividadeId = String(atividade?.id ?? "");
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
        <span className={cancelada ? "line-through" : "font-medium"} data-testid={`linha-produto-${id}-nome`}>
          {rotuloDoProdutoDaLinha(l) || "Produto"}
        </span>
        <span data-testid={`linha-produto-${id}-quantidade`}>· {formatarQuantidadeLinha(l.quantidade, l.unidade) || "—"}</span>
        {local ? <span>· de {local}</span> : null}
        {dose ? <span data-testid={`linha-produto-${id}-dose`}>· dose {formatarDose(dose, l.unidade)}</span> : null}
        {custo ? <span data-testid={`linha-produto-${id}-custo`}>· custo {custo}</span> : null}
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
        {custo ? <span data-testid={`linha-maquina-${id}-custo`}>· custo {custo}</span> : null}
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
        {unitario ? <span data-testid={`${prefixo}-unitario`}>· {unitario} cada</span> : null}
        <span data-testid={`${prefixo}-custo`}>· custo {custo || "sem custo no cadastro"}</span>
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

  // ─── Cancelamento da linha (motivo; o produto volta exatamente aos lotes de origem) ─
  const nomeDaLinha = (/** @type {CancelamentoDaLinha} */ c) => nomeDaLinhaDoTipo(c.tipo, c.linha);

  /** A frase do sucesso do cancelamento. @param {CancelamentoDaLinha} c */
  const textoDoCancelado = (c) => {
    if (c.tipo === LINHA_PRODUTO) return `Produto ${rotuloDoProdutoDaLinha(c.linha)} cancelado: a quantidade voltou ao estoque, aos lotes de origem.`;
    if (c.tipo === LINHA_MAQUINA) return `Máquina ${rotuloDaMaquinaDaLinha(c.linha)} cancelada: a leitura dela deixa de contar.`;
    if (c.tipo === LINHA_MAO_OBRA) return `Mão de obra de ${rotuloDaMaoObraDaLinha(c.linha)} cancelada: o custo dela deixa de contar.`;
    return `Serviço ${rotuloDoServicoDaLinha(c.linha)} cancelado: o valor dele deixa de contar.`;
  };

  /** O serviço confere o motivo (3 a 500 caracteres) ANTES da rede; a `versao` é a do apontamento lida ao abrir. @param {string} motivo @param {{ retentativa: boolean }} o */
  const enviarCancelamento = async (motivo, o) => {
    const alvo = cancelando;
    if (!alvo) return;
    try {
      const r = normalizarRespostaDeEscrita(await cancelarLinha(alvo.tipo, atividadeId, alvo.apontamento, alvo.linha, motivo, { escopo, retentativa: o?.retentativa === true }));
      setCancelando(null);
      onEscrita(r, textoDoCancelado(alvo));
    } catch (erro) {
      if (!ehResultadoIncerto(erro)) notifyWarning("Atenção", mensagemDeErroLinha(erro, "Não foi possível cancelar a linha. Nada foi alterado."));
      if (ehResultadoIncerto(erro) || pedeReleitura(erro)) onMudou();
      throw erro;
    }
  };

  /** "Consultar" depois de um cancelamento sem resposta: o apontamento relido mostra a linha cancelada? */
  const consultarCancelamento = async () => {
    const alvo = cancelando;
    if (!alvo) return;
    try {
      const lido = /** @type {any} */ (await obterApontamento(atividadeId, apId));
      const atual = linhasDoTipo(lido, alvo.tipo).find((l) => String(l.id) === String(alvo.linha.id));
      if (atual?.status === STATUS_CANCELADO) {
        limparPendenciaDaLinha(escopo, ACAO_CANCELAR_LINHA, alvoDaLinha(alvo.tipo, String(alvo.linha.id)));
        setCancelando(null);
        notifySuccess("Linha cancelada", `O cancelamento de ${nomeDaLinha(alvo)} foi gravado.`);
        onMudou();
      } else {
        notifyInfo("Ainda confirmada", "O cancelamento não aparece gravado. Repita o envio: com a mesma chave, ele não é gravado duas vezes.");
      }
    } catch (erro) {
      notifyWarning("Atenção", mensagemDeErroLinha(erro, "Não foi possível consultar agora. Tente de novo."));
    }
  };

  return (
    <div className="min-w-0 basis-full space-y-1.5 pl-2" data-testid={`apontamento-${apId}-linhas`}>
      {mostrarProdutos ? (
        <div className="min-w-0" data-testid={`apontamento-${apId}-produtos`}>
          <p className={TITULO_BLOCO}>Produtos</p>
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
        <DialogoAcao
          key={`cancelar-linha-${cancelando.linha.id}`}
          aberto
          titulo={`Cancelar ${nomeDaLinha(cancelando)} do lançamento de ${formatarDiaAtividade(apontamento?.data_operacional)}`}
          descricao={`${EFEITO_DO_CANCELAMENTO[cancelando.tipo] ?? ""} A linha continua no histórico como cancelada e deixa de contar nos totais da atividade. Informe o motivo (pelo menos ${MOTIVO_MINIMO} caracteres).`}
          rotuloBotao="Cancelar linha"
          testId="dialogo-cancelar-linha"
          contexto={CONTEXTO_MENSAGENS}
          onFechar={() => setCancelando(null)}
          onEnviar={enviarCancelamento}
          onConsultar={consultarCancelamento}
        />
      ) : null}
    </div>
  );
}
