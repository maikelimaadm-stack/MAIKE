import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, ChevronDown, ChevronRight } from "lucide-react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import { AvisoEnvioAbastecimento, BOTAO_PERIGO, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { notifyWarning } from "@/lib/maikeNotify";
import { formatarInstante } from "@/lib/diaCivil";
import { ROTULO_NATUREZA } from "@/lib/patrimonioDominio";
import { rotuloDaUnidade } from "@/lib/abastecimentoRegras";
import {
  ITEM_PRODUTO,
  LIMITES_PRODUCAO,
  LIMITES_QUANTIDADE_ITEM,
  LIMITES_VALOR_UNITARIO_ITEM,
  LOCALE_APONTAMENTO,
  MAX_DESCRICAO_ITEM,
  MAX_ITENS_APONTAMENTO,
  MAX_OBSERVACAO,
  NATUREZAS_IMPLEMENTO,
  NATUREZAS_MAQUINA,
  NOME_UNIDADE_PRODUCAO,
  ROTULO_TIPO_ITEM,
  STATUS_CANCELADO,
  STATUS_CONFIRMADO,
  UNIDADES_PRODUCAO,
  corpoDoFormulario,
  corpoDoItem,
  custoDosItens,
  decimaisDoItem,
  dicaDaUnidadeDoItem,
  formatarQuantidadeItem,
  formatarValorItem,
  formularioDoRegistro,
  formularioVazio,
  itemVazio,
  itensDoRegistro,
  mensagemErroApontamento,
  mudancaAoEscolherBem,
  mudancaAoEscolherCentroCusto,
  produtoDoItem,
  rotuloDaArea,
  rotuloDoBem,
  rotuloDoCentro,
  rotuloDoOperador,
  temItemDeProdutoConfirmado,
  totalDoItem,
  unidadeDoItem,
  validarFormulario,
  validarItem,
} from "@/lib/apontamentoAtividadeRegras";
import { listarLocaisDoProduto, listarOpcoesApontamento } from "@/services/apontamentoAtividadeService";
import { CODIGO_ENVIO_PENDENTE, codigoDoServidor, ehRecusaDefinitiva, ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

export const FORMULARIO_APONTAMENTO_ATIVIDADE_ID = "formulario-apontamento-atividade-base1";

const SELECT_EMPTY = "__VAZIO__";

/** @param {{ texto: string|undefined, testId?: string }} props */
function ErroDoCampo({ texto, testId = undefined }) {
  return texto ? (
    <p className="col-span-12 -mt-1 text-[12px] text-red-700" data-testid={testId}>
      {texto}
    </p>
  ) : null;
}

/** @param {any} o */
const detalheDoBem = (o) => /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[String(o?.natureza ?? "")] ?? null;
/** @param {any} o */
const detalheDoCentro = (o) => (o?.numero != null ? `nº ${o.numero}` : null);

// ─── Itens do apontamento (D-PROD-191) ───────────────────────────────────

/** Chave da leitura dos locais com saldo de um Produto (a tela relê depois de baixa, estorno ou recusa de saldo). */
export const chaveLocaisDoItem = (/** @type {string|null} */ empresaId, /** @type {string|null} */ produtoId) => [
  "apontamentos-atividade",
  "locais",
  empresaId,
  produtoId,
];

/** Texto auxiliar da seção (o mesmo tom das notas do formulário). */
const NOTA = "col-span-12 min-w-0 break-words text-[11px] text-[var(--mg-text-2,#475569)]";
/** Aviso âmbar fixo (a dica kg do abastecimento). */
const NOTA_AMBAR = "col-span-12 -mt-1 min-w-0 break-words rounded-md border border-amber-300 bg-amber-50 p-2 text-[12px] text-amber-900";
/** Card de item: o molde visual da linha de item da Central (`LinhaItem`). */
const CARD_ITEM = "col-span-12 min-w-0 rounded-lg border border-[var(--mg-divider,#cbd5e1)] bg-white p-3";
const TITULO_CARD = "text-[12px] font-semibold uppercase text-[var(--mg-text-2,#475569)]";
/** Texto inteiro do card gravado (descrição, Produto, local), quebrando linha: nada é cortado. O tom do "Sai do estoque" do rascunho. */
const TEXTO_CARD = "col-span-12 min-w-0 break-words text-[13px]";
const TEXTO_CARD_METADE = `${TEXTO_CARD} md:col-span-6`;

/**
 * @typedef {{ fase: 'pronto'|'enviando'|'incerto'|'erro', mensagem?: string, consulta?: string|null }} EstadoEnvioItem
 * @typedef {(corpo: Record<string, string>, opcoes: { retentativa: boolean }) => Promise<unknown>} EnviarItem
 * @typedef {(versaoEnviada: number) => Promise<string|null>} ConsultarItem
 */

/**
 * Estado do envio do item — o do abastecimento (`useEnvioAbastecimento`), com
 * as mensagens do apontamento (saldo na unidade do ITEM). "incerto" = sem
 * resposta definitiva: NUNCA vira sucesso; o próximo clique é a retentativa e
 * reaproveita a chave pendente. Um envio por vez (duplo clique = 1 envio).
 * @param {EnviarItem} enviar
 * @param {(erro: unknown) => string} mensagemDe
 */
function useEnvioDoItem(enviar, mensagemDe) {
  const [estado, setEstado] = useState(/** @type {EstadoEnvioItem} */ ({ fase: "pronto" }));
  const emCurso = useRef(false);
  const repetir = useRef(false);
  /** @param {Record<string, string>} corpo */
  const disparar = async (corpo) => {
    if (emCurso.current) return;
    emCurso.current = true;
    setEstado({ fase: "enviando" });
    try {
      await enviar(corpo, { retentativa: repetir.current });
      repetir.current = false;
      setEstado({ fase: "pronto" });
    } catch (erro) {
      // "Manter" o envio anterior sem resposta: nada saiu agora; aquele envio continua incerto.
      const manteve = /** @type {any} */ (erro)?.code === CODIGO_ENVIO_PENDENTE;
      // O MESMO envio ainda em processamento no servidor: pode virar gravado a qualquer momento — segue incerto.
      const processando = codigoDoServidor(erro) === "IDEMPOTENCY_IN_PROGRESS";
      repetir.current = manteve || !ehRecusaDefinitiva(erro);
      if (processando) setEstado({ fase: "incerto", consulta: mensagemDe(erro) });
      else if (manteve || ehResultadoIncerto(erro)) setEstado({ fase: "incerto", consulta: null });
      else setEstado({ fase: "erro", mensagem: mensagemDe(erro) });
    } finally {
      emCurso.current = false;
    }
  };
  return { estado, disparar, setEstado };
}

/** @param {any} o */
const rotuloDoProdutoOpcao = (o) => String(o?.nome ?? "");
/** Unidade de estoque na lista de Produtos ("L" / "kg"; sem L, KG ou SACO, nada). @param {any} o */
const detalheDoProdutoOpcao = (o) => rotuloDaUnidade(o?.unidade_principal_estoque) || null;

/**
 * Card do NOVO item (um por vez). PRODUTO: Produto (opção da tela) → local com
 * saldo (automático com um só) → quantidade na unidade de estoque do Produto (L;
 * kg para KG e SACO), sem conversão; o custo é o FIFO dos lotes, que só o
 * servidor calcula (sem prévia, D-5). SERVIÇO/OUTRO: descrição, quantidade e
 * valor unitário; o total mostrado é só exibição (o servidor refaz e manda).
 * Nada é gravado aqui até "Lançar item".
 * @param {{ tipo: string, empresaId: string|null, versao: number, onEnviar: EnviarItem,
 *   onConsultar?: ConsultarItem | null, onDescartar: () => void }} props
 */
function RascunhoDoItem({ tipo, empresaId, versao, onEnviar, onConsultar = null, onDescartar }) {
  const [item, setItem] = useState(() => itemVazio(tipo));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const produto = item.tipo === ITEM_PRODUTO;
  const produtoId = item.produto?.id ?? null;
  const unidadeProduto = item.produto?.unidade_principal_estoque ?? null;
  const unidade = unidadeDoItem(unidadeProduto);

  const locaisQuery = useQuery({
    queryKey: chaveLocaisDoItem(empresaId, produtoId),
    queryFn: () => listarLocaisDoProduto(empresaId, produtoId),
    enabled: Boolean(empresaId && produtoId && unidade),
    staleTime: 15 * 1000,
  });
  const locais = /** @type {any[]} */ (Array.isArray(locaisQuery.data?.itens) ? locaisQuery.data.itens : []);
  const localEscolhido = locais.find((l) => String(l.local_estoque_id) === String(item.local_estoque_id ?? "")) ?? null;

  // Local: o único com saldo já vem escolhido; um local que sumiu da lista sai do rascunho.
  useEffect(() => {
    if (!produtoId || !locaisQuery.isSuccess) return;
    const atual = item.local_estoque_id ? String(item.local_estoque_id) : null;
    if (atual && !locais.some((l) => String(l.local_estoque_id) === atual)) {
      setItem((i) => (i.produto?.id === produtoId && i.local_estoque_id === atual ? { ...i, local_estoque_id: null } : i));
      return;
    }
    if (!atual && locais.length === 1) {
      const local = String(locais[0].local_estoque_id);
      setItem((i) => (i.produto?.id === produtoId && !i.local_estoque_id ? { ...i, local_estoque_id: local } : i));
    }
  }, [produtoId, item.local_estoque_id, locais, locaisQuery.isSuccess]);

  /** @type {EnviarItem} */
  const enviar = async (corpo, opcoes) => {
    try {
      return await onEnviar(corpo, opcoes);
    } catch (erro) {
      // Saldo mudou desde a leitura: relê os locais (o servidor recusou e nada foi gravado).
      if (codigoDoServidor(erro) === "ESTOQUE_SALDO_INSUFICIENTE" && produtoId) locaisQuery.refetch();
      throw erro;
    }
  };
  const { estado, disparar, setEstado } = useEnvioDoItem(enviar, (erro) =>
    mensagemErroApontamento(erro, "Não foi possível lançar o item. Nada foi gravado.", { unidade, comandoIdempotente: true }),
  );
  const enviando = estado.fase === "enviando";

  /** @param {Partial<import("@/lib/apontamentoAtividadeRegras").RascunhoItem>} mudanca @param {string[]} campos */
  const mudar = (mudanca, campos) => {
    setItem((i) => ({ ...i, ...mudanca }));
    setErros((e) => (campos.some((c) => e[c]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !campos.includes(k))) : e));
    setEstado((e) => (e.fase === "erro" ? { fase: "pronto" } : e));
  };

  const { aviso } = validarItem(item, { unidade: unidadeProduto, disponivel: localEscolhido?.disponivel ?? null });
  const { quantidade: quantidadeLida, valor_unitario: valorLido } = decimaisDoItem(item);
  const total = produto ? null : totalDoItem(quantidadeLida, valorLido);
  const dica = produto ? dicaDaUnidadeDoItem(unidadeProduto) : null;

  const lancar = () => {
    if (enviando) return;
    const v = validarItem(item, { unidade: unidadeProduto, disponivel: localEscolhido?.disponivel ?? null });
    setErros(v.erros);
    if (Object.keys(v.erros).length) return;
    disparar(corpoDoItem(item));
  };
  const consultar = async () => {
    if (!onConsultar) return;
    const texto = await onConsultar(versao);
    if (texto) setEstado((e) => ({ ...e, consulta: texto }));
  };

  let blocoLocal = null;
  if (produto && produtoId && unidade) {
    if (locaisQuery.isError) {
      blocoLocal = (
        <div className="col-span-12">
          <AvisoGestao testId="apontamento-item-locais-erro">
            {mensagemErroApontamento(locaisQuery.error, "Não foi possível ler o saldo. O lançamento confere de novo.")}{" "}
            <button type="button" className="underline" onClick={() => locaisQuery.refetch()}>
              Tentar novamente
            </button>
          </AvisoGestao>
        </div>
      );
    } else if (locaisQuery.isLoading) {
      blocoLocal = (
        <p role="status" className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]">
          Conferindo o saldo deste Produto…
        </p>
      );
    } else if (!locais.length) {
      blocoLocal = (
        <div className="col-span-12">
          <AvisoGestao testId="apontamento-item-sem-saldo">Sem saldo deste Produto nesta fazenda.</AvisoGestao>
        </div>
      );
    } else if (locais.length === 1) {
      blocoLocal = (
        <>
          <p className="col-span-12 min-w-0 break-words text-[13px]" data-testid="apontamento-item-local-auto">
            Sai do estoque: <span className="font-semibold">{String(localEscolhido?.local_nome ?? locais[0].local_nome ?? "")}</span> (disponível{" "}
            {formatarQuantidadeItem(locais[0].disponivel, unidade)})
          </p>
          <ErroDoCampo texto={erros.local_estoque_id} />
        </>
      );
    } else {
      blocoLocal = (
        <>
          <CampoSelect
            label="De qual local do estoque?"
            value={item.local_estoque_id ?? ""}
            onChange={(v) => mudar({ local_estoque_id: v || null }, ["local_estoque_id"])}
            options={locais.map((l) => ({ value: String(l.local_estoque_id), label: String(l.local_nome ?? "") }))}
            placeholder="— Escolha o local —"
            readOnly={enviando}
            required
            span={12}
            error={erros.local_estoque_id}
          />
          {localEscolhido ? (
            <p className={NOTA} data-testid="apontamento-item-disponivel">
              Disponível neste local: {formatarQuantidadeItem(localEscolhido.disponivel, unidade)}
            </p>
          ) : null}
        </>
      );
    }
  }

  return (
    <div className={CARD_ITEM} data-testid="apontamento-item-rascunho" data-tipo={item.tipo}>
      <p className={`mb-2 ${TITULO_CARD}`}>Novo item — {ROTULO_TIPO_ITEM[item.tipo] ?? item.tipo}</p>
      <div className="grid grid-cols-12 gap-3">
        {produto ? (
          <>
            <SeletorPaginadoGestao
              rotulo="Produto"
              testId="apontamento-item-produto"
              chave={["apontamentos-atividade", "produtos", empresaId]}
              buscar={({ q, cursor, limit }) => listarOpcoesApontamento("produtos", empresaId, { q, cursor, limit })}
              value={item.produto ? { id: item.produto.id, rotulo: item.produto.rotulo } : null}
              onChange={(o) => mudar({ produto: produtoDoItem(o), local_estoque_id: null }, ["produto", "local_estoque_id", "quantidade"])}
              rotuloDaOpcao={rotuloDoProdutoOpcao}
              detalheDaOpcao={detalheDoProdutoOpcao}
              readOnly={enviando}
              obrigatorio
              erro={erros.produto}
              span={12}
              maiusculas={false}
            />
            {blocoLocal}
            <CampoNumero
              label={unidade ? `Quantidade (${rotuloDaUnidade(unidade)})` : "Quantidade"}
              value={item.quantidade}
              onChange={(v) => mudar({ quantidade: v }, ["quantidade"])}
              locale={LOCALE_APONTAMENTO}
              limites={LIMITES_QUANTIDADE_ITEM}
              readOnly={enviando}
              required
              span={6}
              error={erros.quantidade}
              testId="apontamento-item-quantidade"
            />
            {dica ? (
              <p role="note" className={NOTA_AMBAR} data-testid="apontamento-item-dica-kg">
                {dica}
              </p>
            ) : null}
            {aviso ? (
              <p role="status" className={NOTA_AMBAR} data-testid="apontamento-item-aviso-saldo">
                {aviso}
              </p>
            ) : null}
            <p className={NOTA}>Sai do estoque exatamente a quantidade digitada. O custo vem dos lotes (FIFO) e aparece depois de lançar.</p>
          </>
        ) : (
          <>
            <CampoTexto
              label="Descrição"
              value={item.descricao}
              onChange={(v) => mudar({ descricao: v }, ["descricao"])}
              readOnly={enviando}
              required
              span={12}
              maxLength={MAX_DESCRICAO_ITEM}
              keepCase
              error={erros.descricao}
            />
            <CampoNumero
              label="Quantidade"
              value={item.quantidade}
              onChange={(v) => mudar({ quantidade: v }, ["quantidade", "valor_unitario"])}
              locale={LOCALE_APONTAMENTO}
              limites={LIMITES_QUANTIDADE_ITEM}
              readOnly={enviando}
              required
              span={4}
              error={erros.quantidade}
              testId="apontamento-item-quantidade"
            />
            <CampoNumero
              label="Valor unitário (R$)"
              value={item.valor_unitario}
              onChange={(v) => mudar({ valor_unitario: v }, ["valor_unitario"])}
              locale={LOCALE_APONTAMENTO}
              limites={LIMITES_VALOR_UNITARIO_ITEM}
              readOnly={enviando}
              required
              span={4}
              error={erros.valor_unitario}
              testId="apontamento-item-valor-unitario"
            />
            <ValorCalculado label="Total" valor={total ? formatarValorItem(total) : "—"} span={4} testId="apontamento-item-total" destaque />
            <p className={NOTA}>O total é quantidade × valor unitário, em 4 casas; o servidor confere e grava.</p>
          </>
        )}
        <div className="col-span-12 min-w-0">
          {!produto && estado.fase === "incerto" ? (
            // Serviço e Outro custo não mexem no estoque: o mesmo bloco "incerto" (mesmas classes), com o texto sem estoque.
            <div role="alert" data-testid="resultado-incerto" className="min-w-0 rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={16} aria-hidden /> Resultado incerto — consulte antes de repetir
              </p>
              <p className="mt-1 break-words">
                Não recebemos a resposta do servidor: o item PODE ter sido gravado. Consulte antes. Se repetir, o MESMO envio é reaproveitado e o item não é
                lançado duas vezes.
              </p>
              {estado.consulta ? (
                <p className="mt-1 break-words font-medium" data-testid="consulta-resultado">
                  {estado.consulta}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {onConsultar ? (
                  <button type="button" className={BOTAO_SECUNDARIO} onClick={consultar} data-testid="botao-consultar-resultado">
                    Consultar
                  </button>
                ) : null}
                <button type="button" className={BOTAO_SECUNDARIO} onClick={lancar} data-testid="botao-repetir-envio">
                  Repetir o mesmo envio
                </button>
              </div>
            </div>
          ) : (
            <AvisoEnvioAbastecimento estado={estado} objeto="o item" onRepetir={lancar} onConsultar={onConsultar ? consultar : null} />
          )}
        </div>
        <div className="col-span-12 flex flex-wrap gap-2 pt-1">
          <button type="button" className={BOTAO_PRIMARIO} disabled={enviando} onClick={lancar} data-testid="apontamento-item-lancar">
            {enviando ? "Lançando…" : estado.fase === "incerto" ? "Repetir o mesmo envio" : "Lançar item"}
          </button>
          <button type="button" className={BOTAO_SECUNDARIO} disabled={enviando} onClick={onDescartar} data-testid="apontamento-item-descartar">
            Descartar
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Card de um item GRAVADO (só leitura; corrigir = cancelar e lançar de novo).
 * Produto mostra o custo FIFO final; os lotes consumidos ficam em "Detalhes do
 * estoque", recolhido.
 * @param {{ item: any, fuso: string|null, podeCancelar: boolean, onCancelar: () => void }} props
 */
function CardItem({ item, fuso, podeCancelar, onCancelar }) {
  const [detalhes, setDetalhes] = useState(false);
  const produto = item?.tipo === ITEM_PRODUTO;
  const cancelado = item?.status === STATUS_CANCELADO;
  const unidade = typeof item?.unidade === "string" ? item.unidade : null;
  const porUnidade = rotuloDaUnidade(unidade);
  const consumos = /** @type {any[]} */ (Array.isArray(item?.consumos) ? item.consumos : []);
  const cancelamento = item?.cancelamento ?? null;
  const ordem = String(item?.ordem ?? "");
  let textoCancelamento = "";
  if (cancelado) {
    textoCancelamento =
      cancelamento?.origem === "APONTAMENTO"
        ? "Cancelado junto com o apontamento."
        : `Item cancelado${cancelamento?.cancelado_em ? ` em ${formatarInstante(cancelamento.cancelado_em, LOCALE_APONTAMENTO, fuso)}` : ""}${
            cancelamento?.cancelado_por?.nome ? ` por ${cancelamento.cancelado_por.nome}` : ""
          }.${cancelamento?.motivo ? ` Motivo: ${cancelamento.motivo}` : ""}`;
    if (produto) textoCancelamento += " A quantidade voltou aos lotes de origem.";
  }
  return (
    <div className={CARD_ITEM} data-testid={`apontamento-item-${ordem}`} data-status={String(item?.status ?? "")}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className={TITULO_CARD}>
          Item {ordem} — {ROTULO_TIPO_ITEM[String(item?.tipo ?? "")] ?? String(item?.tipo ?? "")}
          {cancelado ? " · Cancelado" : ""}
        </p>
        {podeCancelar && !cancelado ? (
          <button type="button" className={BOTAO_PERIGO} onClick={onCancelar} data-testid={`apontamento-item-cancelar-${ordem}`}>
            <Ban size={16} aria-hidden /> Cancelar item
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-12 gap-3">
        {/* Nomes e descrição em <p> que quebra linha: o ValorCalculado corta (truncate) o texto longo. */}
        {produto ? (
          <>
            <p className={TEXTO_CARD_METADE} data-testid={`apontamento-item-produto-${ordem}`}>
              Produto: <span className="font-semibold">{String(item?.produto?.nome ?? "—")}</span>
            </p>
            <p className={TEXTO_CARD_METADE} data-testid={`apontamento-item-local-${ordem}`}>
              Local do estoque: <span className="font-semibold">{String(item?.local_estoque?.nome ?? "—")}</span>
            </p>
            <ValorCalculado label="Quantidade" valor={formatarQuantidadeItem(item?.quantidade, unidade)} span={4} testId={`apontamento-item-quantidade-${ordem}`} />
            <ValorCalculado label={porUnidade ? `Custo FIFO por ${porUnidade}` : "Custo FIFO unitário"} valor={formatarValorItem(item?.valor_unitario, 4)} span={4} />
            <ValorCalculado label="Total" valor={formatarValorItem(item?.valor_total)} span={4} testId={`apontamento-item-total-${ordem}`} destaque />
          </>
        ) : (
          <>
            <p className={TEXTO_CARD} data-testid={`apontamento-item-descricao-${ordem}`}>
              Descrição: <span className="font-semibold">{String(item?.descricao ?? "")}</span>
            </p>
            <ValorCalculado label="Quantidade" valor={formatarQuantidadeItem(item?.quantidade, null)} span={4} testId={`apontamento-item-quantidade-${ordem}`} />
            <ValorCalculado label="Valor unitário" valor={formatarValorItem(item?.valor_unitario, 6)} span={4} />
            <ValorCalculado label="Total" valor={formatarValorItem(item?.valor_total)} span={4} testId={`apontamento-item-total-${ordem}`} destaque />
          </>
        )}
      </div>
      {cancelado ? (
        <p className="mt-2 min-w-0 break-words rounded-md border border-slate-300 bg-slate-50 p-2 text-[12px]" data-testid={`apontamento-item-cancelamento-${ordem}`}>
          {textoCancelamento}
        </p>
      ) : null}
      {produto ? (
        <div className="mt-2 min-w-0">
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-1 rounded-md px-1 text-[13px] font-medium text-[var(--mg-text-1,#0f172a)] hover:bg-slate-50"
            aria-expanded={detalhes}
            onClick={() => setDetalhes((v) => !v)}
            data-testid={`apontamento-item-detalhes-${ordem}`}
          >
            {detalhes ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />} Detalhes do estoque
          </button>
          {detalhes ? (
            <div className="mt-1 min-w-0 overflow-x-auto">
              <p className="text-[12px]">
                Saída de estoque nº {String(item?.movimento?.numero ?? "—")}
                {item?.movimento_estorno ? ` · estorno nº ${String(item.movimento_estorno.numero ?? "—")}` : ""}
              </p>
              {consumos.length ? (
                <>
                  <p className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">Lotes consumidos (FIFO)</p>
                  <table className="w-full text-[12px]" data-testid={`apontamento-item-fatias-${ordem}`}>
                    <thead>
                      <tr className="text-left text-[var(--mg-text-2,#475569)]">
                        <th className="py-1 pr-2">Ordem</th>
                        <th className="py-1 pr-2 text-right">{porUnidade ? `Quantidade (${porUnidade})` : "Quantidade"}</th>
                        <th className="py-1 text-right">{porUnidade ? `Custo/${porUnidade}` : "Custo"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consumos.map((/** @type {any} */ f) => (
                        <tr key={`${f.ordem}-${f.lote_id}`} className="border-t border-slate-100">
                          <td className="py-1 pr-2">{f.ordem}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{formatarQuantidadeItem(f.quantidade, null)}</td>
                          <td className="py-1 text-right tabular-nums">{formatarValorItem(f.custo_unitario, 4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Seção "Itens" (D-PROD-191). Novo: só o aviso (os itens entram depois de
 * salvar). Editando o cabeçalho: itens só leitura (não mistura PATCH com
 * comando de estoque). Consulta do CONFIRMADO: itens gravados, "+ Produto",
 * "+ Serviço" e "+ Outro custo" (com a ação editar), um card de rascunho por
 * vez e "Cancelar item" (com a ação cancelar). CANCELADO: tudo só leitura. O
 * custo dos itens é do centro de custo do cabeçalho (D-4): o item não tem centro.
 * @param {{
 *   registro: any,
 *   modo: 'novo'|'edicao'|'consulta'|'cancelado',
 *   empresaId: string|null,
 *   fuso: string|null,
 *   podeLancar: boolean,
 *   podeCancelar: boolean,
 *   carregando: boolean,
 *   erro: string|null,
 *   onRecarregar?: (() => void) | null,
 *   onAdicionar?: EnviarItem | null,
 *   onConsultar?: ConsultarItem | null,
 *   onCancelarItem?: ((item: any) => void) | null,
 * }} props
 */
function SecaoItens({ registro, modo, empresaId, fuso, podeLancar, podeCancelar, carregando, erro, onRecarregar = null, onAdicionar = null, onConsultar = null, onCancelarItem = null }) {
  const [rascunho, setRascunho] = useState(/** @type {{ tipo: string, chave: number } | null} */ (null));
  const proximaChave = useRef(0);

  if (modo === "novo") {
    return (
      <div className="col-span-12">
        <AvisoGestao tone="blue" testId="apontamento-itens-novo">
          Os itens entram depois de salvar o apontamento.
        </AvisoGestao>
      </div>
    );
  }
  if (!Array.isArray(registro?.itens)) {
    return erro ? (
      <div className="col-span-12">
        <AvisoGestao testId="apontamento-itens-erro">
          {erro}{" "}
          {onRecarregar ? (
            <button type="button" className="underline" onClick={onRecarregar}>
              Tentar novamente
            </button>
          ) : null}
        </AvisoGestao>
      </div>
    ) : (
      <p role="status" className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="apontamento-itens-carregando">
        {carregando ? "Carregando os itens…" : "Os itens aparecem quando o apontamento é lido do servidor."}
      </p>
    );
  }

  const itens = itensDoRegistro(registro);
  const custo = registro?.custo_itens && typeof registro.custo_itens.total === "string" ? registro.custo_itens : custoDosItens(itens);
  const consulta = modo === "consulta";
  const lancaveis = consulta && podeLancar && Boolean(onAdicionar);
  const noLimite = itens.length >= MAX_ITENS_APONTAMENTO;
  const cancelaveis = consulta && podeCancelar && Boolean(onCancelarItem);
  /** @param {string} tipo */
  const abrir = (tipo) => {
    proximaChave.current += 1;
    setRascunho({ tipo, chave: proximaChave.current });
  };

  return (
    <>
      {itens.length ? (
        itens.map((item) => (
          <CardItem
            key={String(item?.id ?? item?.ordem)}
            item={item}
            fuso={fuso}
            podeCancelar={cancelaveis && item?.status === STATUS_CONFIRMADO}
            onCancelar={() => onCancelarItem?.(item)}
          />
        ))
      ) : (
        <p className={NOTA} data-testid="apontamento-itens-vazio">
          Nenhum item lançado.
        </p>
      )}
      <p className="col-span-12 min-w-0 break-words text-[13px]" data-testid="apontamento-itens-custo">
        Custo dos itens confirmados: <span className="font-semibold">{formatarValorItem(custo.total)}</span>
        {itens.length ? " — vai para o centro de custo do apontamento." : ""}
      </p>
      {modo === "edicao" && itens.length ? (
        <p className={NOTA} data-testid="apontamento-itens-edicao">
          Os itens não mudam na edição do cabeçalho: salve ou feche a edição para lançar ou cancelar itens.
        </p>
      ) : null}
      {lancaveis && noLimite ? (
        <div className="col-span-12">
          <AvisoGestao testId="apontamento-itens-limite">
            Este apontamento já tem {MAX_ITENS_APONTAMENTO} itens, o máximo (contando os cancelados).
          </AvisoGestao>
        </div>
      ) : null}
      {lancaveis && !noLimite ? (
        <>
          <div className="col-span-12 flex flex-wrap gap-2" data-testid="apontamento-itens-acoes">
            <button type="button" className={BOTAO_SECUNDARIO} disabled={Boolean(rascunho)} onClick={() => abrir(ITEM_PRODUTO)} data-testid="apontamento-item-novo-produto">
              + Produto
            </button>
            <button type="button" className={BOTAO_SECUNDARIO} disabled={Boolean(rascunho)} onClick={() => abrir("SERVICO")} data-testid="apontamento-item-novo-servico">
              + Serviço
            </button>
            <button type="button" className={BOTAO_SECUNDARIO} disabled={Boolean(rascunho)} onClick={() => abrir("OUTRO")} data-testid="apontamento-item-novo-outro">
              + Outro custo
            </button>
          </div>
          {rascunho && onAdicionar ? (
            <RascunhoDoItem
              key={rascunho.chave}
              tipo={rascunho.tipo}
              empresaId={empresaId}
              versao={Number(registro?.versao ?? 0)}
              onEnviar={onAdicionar}
              onConsultar={onConsultar}
              onDescartar={() => setRascunho(null)}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

/**
 * @typedef {{ id: string, nome_tipo?: string, grupo_atividade_id?: string, grupo_atividade_nome?: string, ativo?: boolean }} TipoOpcao
 * @typedef {{ id: string, nome?: string, numero_area?: string|number|null, ativo?: boolean }} AreaOpcao
 */

/**
 * Formulário do apontamento de atividade (D-PROD-190) — a EXECUÇÃO de um tipo.
 *
 * Campos, nesta ordem EXATA: 1) Tipo de atividade (só ativos; ao editar, o
 * tipo atual inativo aparece marcado "(INATIVO)"; o grupo vem junto, só
 * leitura); 2) Data; 3) Máquina/veículo → libera o Implemento (trocar ou limpar
 * a máquina limpa o implemento; implemento ≠ máquina); 4) Operador; 5) Área;
 * 6) Hora início / Hora fim; 7) Produção: quantidade + unidade (juntas);
 * 8) Observação. Depois, os centros de custo e de resultado: campos de escolha
 * NORMAIS e opcionais. No apontamento NOVO o centro de custo vem preenchido com
 * o centro (ativo) do bem escolhido e o usuário pode trocar antes de salvar; a
 * escolha manual dele não é sobrescrita por uma troca de máquina. Na edição o
 * centro de custo é snapshot: nunca é relido do bem. O centro de resultado é
 * sempre escolha do usuário, nunca vem do bem. Apontamento CANCELADO abre só
 * leitura, com o motivo; o confirmado oferece "Cancelar apontamento".
 *
 * D-PROD-191 (Fatia D): depois dos centros, a seção "Itens" (produto, serviço,
 * outro custo) — ver `SecaoItens`. Os itens vêm do DETALHE do apontamento; só a
 * CONSULTA do confirmado lança e cancela item (cada comando com `operation_id`
 * e a `versao` do apontamento). Com item de Produto confirmado, a data não muda
 * na edição (D-1: a saída do estoque está nela); antes de o detalhe chegar (itens
 * desconhecidos), ela fica travada na data gravada.
 *
 * @param {{
 *   initialData?: any,
 *   empresaId: string|null,
 *   tipos?: TipoOpcao[],
 *   areas?: AreaOpcao[],
 *   hoje: string,
 *   fuso: string|null,
 *   readOnly?: boolean,
 *   isSubmitting?: boolean,
 *   onSubmit: (corpo: Record<string, any>) => void,
 *   podeCancelar?: boolean,
 *   onCancelar?: () => void,
 *   erroDoServidor?: { campo: string, mensagem: string } | null,
 *   podeLancarItens?: boolean,
 *   podeCancelarItens?: boolean,
 *   itensCarregando?: boolean,
 *   erroDosItens?: string | null,
 *   onRecarregarItens?: (() => void) | null,
 *   onAdicionarItem?: EnviarItem | null,
 *   onConsultarItem?: ConsultarItem | null,
 *   onCancelarItem?: ((item: any) => void) | null,
 * }} props
 */
export default function FormularioApontamentoAtividade({
  initialData = null,
  empresaId,
  tipos = [],
  areas = [],
  hoje,
  fuso,
  readOnly = false,
  isSubmitting = false,
  onSubmit,
  podeCancelar = false,
  onCancelar = undefined,
  erroDoServidor = null,
  podeLancarItens = false,
  podeCancelarItens = false,
  itensCarregando = false,
  erroDosItens = null,
  onRecarregarItens = null,
  onAdicionarItem = null,
  onConsultarItem = null,
  onCancelarItem = null,
}) {
  const existente = Boolean(initialData?.id);
  const cancelado = initialData?.status === STATUS_CANCELADO;
  // Cancelado não aceita edição de nenhum campo, venha o pedido de onde vier.
  const somenteLeitura = readOnly || cancelado;
  const bloqueado = somenteLeitura || isSubmitting;
  // D-1: com item de Produto confirmado a data não muda (o servidor recusaria com DATA_COM_ITENS). Antes de o
  // DETALHE chegar os itens não são conhecidos: a data fica travada (na gravada) até eles chegarem.
  const itensConhecidos = Array.isArray(initialData?.itens);
  const dataTravada = existente && (!itensConhecidos || temItemDeProdutoConfirmado(initialData));
  const modoItens = !existente ? "novo" : cancelado ? "cancelado" : readOnly ? "consulta" : "edicao";
  const [form, setForm] = useState(() => (existente ? formularioDoRegistro(initialData, fuso) : formularioVazio(hoje)));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));

  useEffect(() => {
    if (erroDoServidor?.campo) setErros((e) => ({ ...e, [erroDoServidor.campo]: erroDoServidor.mensagem }));
  }, [erroDoServidor]);

  /** @param {Partial<import("@/lib/apontamentoAtividadeRegras").FormularioApontamento>} mudanca @param {string[]} campos */
  const mudar = (mudanca, campos) => {
    setForm((f) => ({ ...f, ...mudanca }));
    setErros((e) => (campos.some((c) => e[c]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !campos.includes(k))) : e));
  };

  // Só tipos ATIVOS. Exceção: o tipo GRAVADO no apontamento continua na lista
  // (marcado INATIVO) — senão o seletor mostraria vazio com o registro gravado
  // nele. Se a lista ainda não chegou, o snapshot do registro o representa.
  const tipoGravadoId = existente ? String(initialData.tipo_atividade_id ?? "") : "";
  const opcoesTipo = useMemo(() => {
    const lista = tipos.filter((t) => t.ativo !== false || (tipoGravadoId && t.id === tipoGravadoId));
    if (tipoGravadoId && !lista.some((t) => t.id === tipoGravadoId)) {
      lista.unshift({
        id: tipoGravadoId,
        nome_tipo: initialData?.tipo_atividade_nome ?? "",
        grupo_atividade_id: initialData?.grupo_atividade_id ?? "",
        grupo_atividade_nome: initialData?.grupo_atividade_nome ?? "",
      });
    }
    return lista;
  }, [tipos, tipoGravadoId, initialData]);

  // O tipo GRAVADO mostra os snapshots do apontamento (renomear depois não reescreve o histórico);
  // um tipo trocado mostra o nome e o grupo atuais dele.
  const mesmoTipo = Boolean(tipoGravadoId) && form.tipo_atividade_id === tipoGravadoId;
  const tipoEscolhido = opcoesTipo.find((t) => t.id === form.tipo_atividade_id) ?? null;
  const nomeDoTipo = mesmoTipo ? String(initialData?.tipo_atividade_nome ?? "") : String(tipoEscolhido?.nome_tipo ?? "");
  const nomeDoGrupo = mesmoTipo ? String(initialData?.grupo_atividade_nome ?? "") : String(tipoEscolhido?.grupo_atividade_nome ?? "");

  // Só áreas ATIVAS da empresa; a área gravada que ficou inativa continua visível (marcada).
  const areaGravadaId = existente ? String(initialData.area_id ?? "") : "";
  const opcoesArea = useMemo(() => {
    const lista = areas.filter((a) => a.ativo !== false).map((a) => ({ value: String(a.id), label: rotuloDaArea(a) || String(a.id) }));
    if (areaGravadaId && !lista.some((a) => a.value === areaGravadaId)) {
      // Fora da lista JÁ carregada = inativa; antes de a lista chegar, só o resumo gravado.
      const rotulo = rotuloDaArea(initialData?.area) || "Área";
      lista.unshift({ value: areaGravadaId, label: areas.length ? `${rotulo} (INATIVA)` : rotulo });
    }
    return lista;
  }, [areas, areaGravadaId, initialData]);

  const bemId = form.bem?.id ?? null;

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (somenteLeitura) return;
    const v = validarFormulario(form, { hoje, fuso });
    setErros(v);
    if (Object.keys(v).length) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    onSubmit(corpoDoFormulario(form, fuso));
  };

  const cancelamento = cancelado ? initialData?.cancelamento ?? null : null;

  const formBody = (
    <form
      id={FORMULARIO_APONTAMENTO_ATIVIDADE_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-apontamento-atividade"
      data-densidade={DENSIDADE_BASE1}
      data-somente-leitura={somenteLeitura ? "" : undefined}
    >
      {cancelado ? (
        <div className="col-span-12">
          <AvisoGestao testId="apontamento-cancelado">
            Apontamento cancelado
            {cancelamento?.cancelado_em ? ` em ${formatarInstante(cancelamento.cancelado_em, LOCALE_APONTAMENTO, fuso)}` : ""}
            {cancelamento?.cancelado_por?.nome ? ` por ${cancelamento.cancelado_por.nome}` : ""}.
            {cancelamento?.motivo ? ` Motivo: ${cancelamento.motivo}` : ""} Ele continua no histórico; nada é apagado e nenhum campo pode ser alterado.
          </AvisoGestao>
        </div>
      ) : null}

      <SecaoForm titulo="Atividade" />
      <B1Field
        label="Tipo de atividade"
        required
        span={6}
        hasValue={Boolean(form.tipo_atividade_id)}
        locked={somenteLeitura}
        disabled={bloqueado}
        error={erros.tipo_atividade_id}
      >
        {somenteLeitura ? (
          <input type="text" readOnly value={nomeDoTipo.toUpperCase()} className={B1_FIELD_CTL_CLS} data-testid="apontamento-tipo-leitura" />
        ) : (
          <B1Select
            value={form.tipo_atividade_id || SELECT_EMPTY}
            onChange={(/** @type {React.ChangeEvent<HTMLSelectElement>} */ e) =>
              mudar({ tipo_atividade_id: e.target.value === SELECT_EMPTY ? "" : e.target.value }, ["tipo_atividade_id"])
            }
            className={B1_FIELD_CTL_CLS}
          >
            <option value={SELECT_EMPTY}>SELECIONE</option>
            {opcoesTipo.map((tipo) => (
              <option key={tipo.id} value={tipo.id}>
                {String((tipo.id === tipoGravadoId ? initialData?.tipo_atividade_nome : null) || tipo.nome_tipo || "").toUpperCase()}
                {tipo.ativo === false ? " (INATIVO)" : ""}
              </option>
            ))}
          </B1Select>
        )}
      </B1Field>
      <B1Field label="Grupo de atividade" span={3} hasValue={Boolean(nomeDoGrupo)} locked disabled>
        <input type="text" readOnly value={nomeDoGrupo.toUpperCase()} className={B1_FIELD_CTL_CLS} data-testid="apontamento-grupo" tabIndex={-1} />
      </B1Field>
      <CampoDia
        label="Data"
        value={form.data_operacional}
        // Travada, nenhuma mudança entra, venha de onde vier (a data fica a gravada).
        onChange={(v) => (dataTravada ? undefined : mudar({ data_operacional: v }, ["data_operacional"]))}
        max={hoje || undefined}
        readOnly={bloqueado || dataTravada}
        required
        span={3}
        error={erros.data_operacional}
        testId="apontamento-data"
      />
      {!somenteLeitura && dataTravada ? (
        <p className="col-span-12 -mt-1 min-w-0 break-words text-[11px] text-[var(--mg-text-2,#475569)]" data-testid="apontamento-data-travada">
          {itensConhecidos
            ? "A data não muda enquanto houver item de Produto lançado: a saída do estoque está nesta data."
            : "A data fica travada até os itens do apontamento serem lidos: com item de Produto lançado, ela não muda."}
        </p>
      ) : null}

      <SecaoForm titulo="Execução" />
      <SeletorPaginadoGestao
        rotulo="Máquina/veículo"
        testId="apontamento-bem"
        chave={["apontamentos-atividade", "bens", empresaId, "maquina"]}
        buscar={({ q, cursor, limit }) => listarOpcoesApontamento("bens", empresaId, { q, cursor, limit, natureza: NATUREZAS_MAQUINA })}
        value={form.bem}
        onChange={(opcao) => {
          // A MESMA máquina de novo não muda nada; trocar ou limpar a máquina limpa o implemento e,
          // só no apontamento NOVO e sem escolha manual do usuário, leva junto o centro de custo do bem.
          if (opcao?.id != null && bemId && String(opcao.id) === bemId) return;
          const mudanca = mudancaAoEscolherBem(form, opcao, { novo: !existente });
          mudar(mudanca, "centro_custo" in mudanca ? ["bem", "implemento", "centro_custo"] : ["bem", "implemento"]);
        }}
        rotuloDaOpcao={rotuloDoBem}
        detalheDaOpcao={detalheDoBem}
        readOnly={bloqueado}
        permitirLimpar
        erro={erros.bem}
        span={6}
        maiusculas={false}
      />
      <SeletorPaginadoGestao
        rotulo="Implemento"
        testId="apontamento-implemento"
        chave={["apontamentos-atividade", "bens", empresaId, "implemento", bemId]}
        buscar={async ({ q, cursor, limit }) => {
          const pagina = await listarOpcoesApontamento("bens", empresaId, { q, cursor, limit, natureza: NATUREZAS_IMPLEMENTO });
          // Implemento ≠ máquina: o bem escolhido como máquina não é oferecido.
          return { ...pagina, itens: pagina.itens.filter((o) => String(o?.id) !== bemId) };
        }}
        value={form.implemento}
        onChange={(opcao) => mudar({ implemento: opcao ? { id: String(opcao.id), rotulo: rotuloDoBem(opcao) } : null }, ["implemento"])}
        rotuloDaOpcao={rotuloDoBem}
        detalheDaOpcao={detalheDoBem}
        readOnly={somenteLeitura || isSubmitting}
        bloqueadoMotivo={!somenteLeitura && !bemId ? "Escolha a máquina ou o veículo antes do implemento." : null}
        permitirLimpar
        erro={erros.implemento}
        span={6}
        maiusculas={false}
      />
      <SeletorPaginadoGestao
        rotulo="Operador"
        testId="apontamento-operador"
        chave={["apontamentos-atividade", "operadores", empresaId]}
        buscar={({ q, cursor, limit }) => listarOpcoesApontamento("operadores", empresaId, { q, cursor, limit })}
        value={form.operador}
        onChange={(opcao) => mudar({ operador: opcao ? { id: String(opcao.id), rotulo: rotuloDoOperador(opcao) } : null }, ["operador"])}
        rotuloDaOpcao={rotuloDoOperador}
        readOnly={bloqueado}
        permitirLimpar
        erro={erros.operador}
        span={6}
        maiusculas={false}
      />
      <CampoSelect
        label="Área"
        value={form.area_id}
        onChange={(v) => mudar({ area_id: v }, ["area_id"])}
        options={opcoesArea}
        placeholder="Sem área"
        readOnly={bloqueado}
        span={6}
        error={erros.area_id}
      />
      <CampoTexto
        label="Hora início"
        type="time"
        value={form.hora_inicio}
        onChange={(v) => mudar({ hora_inicio: v }, ["hora_inicio", "hora_fim"])}
        readOnly={bloqueado}
        span={3}
        keepCase
        error={erros.hora_inicio}
      />
      <CampoTexto
        label="Hora fim"
        type="time"
        value={form.hora_fim}
        onChange={(v) => mudar({ hora_fim: v }, ["hora_fim"])}
        readOnly={bloqueado}
        span={3}
        keepCase
        error={erros.hora_fim}
      />

      <SecaoForm titulo="Produção" />
      <CampoNumero
        label="Quantidade produzida"
        value={form.quantidade_produzida}
        onChange={(v) => mudar({ quantidade_produzida: v }, ["quantidade_produzida", "unidade_producao"])}
        locale={LOCALE_APONTAMENTO}
        limites={LIMITES_PRODUCAO}
        readOnly={bloqueado}
        span={3}
        error={erros.quantidade_produzida}
        testId="apontamento-quantidade"
      />
      <CampoSelect
        label="Unidade"
        value={form.unidade_producao}
        onChange={(v) => mudar({ unidade_producao: v }, ["unidade_producao", "quantidade_produzida"])}
        options={UNIDADES_PRODUCAO.map((u) => ({ value: u, label: NOME_UNIDADE_PRODUCAO[u] ?? u }))}
        placeholder="Sem produção"
        readOnly={bloqueado}
        span={3}
        error={erros.unidade_producao}
      />
      <p className="col-span-12 -mt-1 min-w-0 break-words text-[11px] text-[var(--mg-text-2,#475569)] md:col-span-6 md:self-center">
        Quantidade e unidade andam juntas (hectare, cabeça, tonelada ou quilômetro).
      </p>
      <CampoTextoLongo
        label="Observação"
        value={form.observacao}
        onChange={(v) => mudar({ observacao: v }, ["observacao"])}
        readOnly={bloqueado}
        maxLength={MAX_OBSERVACAO}
      />
      <ErroDoCampo texto={erros.observacao} />

      <SecaoForm titulo="Centros" />
      <SeletorPaginadoGestao
        rotulo="Centro de custo"
        testId="apontamento-centro-custo"
        chave={["apontamentos-atividade", "centros-custo", empresaId]}
        buscar={({ q, cursor, limit }) => listarOpcoesApontamento("centros-custo", empresaId, { q, cursor, limit })}
        value={form.centro_custo}
        onChange={(opcao) => mudar(mudancaAoEscolherCentroCusto(opcao, form, { novo: !existente }), ["centro_custo"])}
        rotuloDaOpcao={rotuloDoCentro}
        detalheDaOpcao={detalheDoCentro}
        readOnly={bloqueado}
        permitirLimpar
        erro={erros.centro_custo}
        span={6}
        maiusculas={false}
      />
      <SeletorPaginadoGestao
        rotulo="Centro de resultado"
        testId="apontamento-centro-resultado"
        chave={["apontamentos-atividade", "centros-resultado", empresaId]}
        buscar={({ q, cursor, limit }) => listarOpcoesApontamento("centros-resultado", empresaId, { q, cursor, limit })}
        value={form.centro_resultado}
        onChange={(opcao) => mudar({ centro_resultado: opcao ? { id: String(opcao.id), rotulo: rotuloDoCentro(opcao) } : null }, ["centro_resultado"])}
        rotuloDaOpcao={rotuloDoCentro}
        detalheDaOpcao={detalheDoCentro}
        readOnly={bloqueado}
        permitirLimpar
        erro={erros.centro_resultado}
        span={6}
        maiusculas={false}
      />

      <SecaoForm titulo="Itens" />
      <SecaoItens
        registro={initialData}
        modo={modoItens}
        empresaId={empresaId}
        fuso={fuso}
        podeLancar={podeLancarItens}
        podeCancelar={podeCancelarItens}
        carregando={itensCarregando}
        erro={erroDosItens}
        onRecarregar={onRecarregarItens}
        onAdicionar={onAdicionarItem}
        onConsultar={onConsultarItem}
        onCancelarItem={onCancelarItem}
      />

      {existente && !cancelado && readOnly && podeCancelar && onCancelar ? (
        <div className="col-span-12 flex flex-wrap gap-2 pt-1">
          <button type="button" className={BOTAO_PERIGO} onClick={onCancelar} data-testid="apontamento-cancelar">
            <Ban size={16} aria-hidden /> Cancelar apontamento
          </button>
        </div>
      ) : null}
    </form>
  );

  return (
    <CadastroFormShell embedded title={existente ? "Apontamento de atividade" : "Novo apontamento de atividade"}>
      {formBody}
    </CadastroFormShell>
  );
}
