import React from "react";
import { Ban, HandCoins, Undo2 } from "lucide-react";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { AvisoGestao, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { formatarMoeda, formatarNumero, percentualDe } from "@/lib/dinheiroDecimal";
import { formatarDia, formatarInstante } from "@/lib/diaCivil";
import {
  ROTULO_CONDICAO,
  ROTULO_CONTEUDO,
  ROTULO_DIRECAO,
  ROTULO_METODO,
  ROTULO_STATUS,
  ROTULO_STATUS_TITULO,
} from "@/services/operacaoFinanceiraService";

const ACOES_HISTORICO = /** @type {Record<string, string>} */ ({
  "operacao_financeira.criar": "Rascunho criado",
  "operacao_financeira.editar": "Rascunho alterado",
  "operacao_financeira.substituir": "Rascunho alterado",
  "operacao_financeira.confirmar": "Lançamento confirmado",
  "operacao_financeira.cancelar": "Lançamento cancelado",
  "operacao_financeira.descartar": "Rascunho descartado",
  "titulo_financeiro.liquidar": "Baixa registrada",
  "liquidacao_financeira.registrar": "Baixa registrada",
  "liquidacao_financeira.estornar": "Baixa estornada",
});

const COR_STATUS = /** @type {Record<string, string>} */ ({
  RASCUNHO: "bg-slate-100 text-slate-700 border-slate-300",
  CONFIRMADO: "bg-emerald-50 text-emerald-800 border-emerald-300",
  CANCELADO: "bg-red-50 text-red-800 border-red-300",
  PREVISTO: "bg-slate-100 text-slate-700 border-slate-300",
  ABERTO: "bg-amber-50 text-amber-900 border-amber-300",
  PARCIAL: "bg-sky-50 text-sky-900 border-sky-300",
  QUITADO: "bg-emerald-50 text-emerald-800 border-emerald-300",
});

/** @param {{ status: string, rotulo: string, testId?: string }} props */
export function Selo({ status, rotulo, testId = undefined }) {
  return (
    <span data-testid={testId} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${COR_STATUS[status] ?? "bg-slate-50 border-slate-200"}`}>
      {rotulo}
    </span>
  );
}

/** @param {{ rotulo: string, children: React.ReactNode, span?: string }} props */
/** Linha de estorno que o servidor devolve junto das baixas (só exibição). @param {any} l */
const ehLinhaDeEstorno = (l) => l?.tipo === "ESTORNO";

function Dado({ rotulo, children, span = "col-span-6 md:col-span-3" }) {
  return (
    <div className={`${span} min-w-0`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--mg-text-3,#64748b)]">{rotulo}</p>
      <div className="break-words text-[13px] font-medium text-[var(--mg-text-1,#0f172a)]">{children}</div>
    </div>
  );
}

const BOTAO = "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium disabled:opacity-60";

/** @param {unknown} u @returns {string} */
const quem = (u) => {
  const x = /** @type {any} */ (u);
  if (!x) return "—";
  if (typeof x === "string") return x;
  return x.login || x.nome || x.id || "—";
};

/**
 * Consulta do lançamento confirmado ou cancelado (D-PROD-154): cabeçalho,
 * itens com os efeitos de estoque (lote/movimento), rateio, títulos com saldo e
 * liquidações (estornadas marcadas) e histórico (quem/quando/ação).
 *
 * @param {{
 *   detalhe: any,
 *   perfil: { locale: string, moeda: string, moeda_casas: number },
 *   fuso: string|null,
 *   acoes: { liquidar?: boolean, estornar?: boolean, cancelar?: boolean },
 *   onLiquidar: (titulo: any) => void,
 *   onEstornar: (liquidacao: any, titulo: any) => void,
 *   onCancelar: () => void,
 *   ocupado?: boolean,
 * }} props
 */
export default function ConsultaLancamento({ detalhe: d, perfil, fuso, acoes, onLiquidar, onEstornar, onCancelar, ocupado = false }) {
  const locale = perfil.locale;
  // O documento guarda a SUA moeda e escala (copiadas do perfil na criação).
  const c = { locale, moeda: d.moeda || perfil.moeda, casas: Number.isInteger(d.moeda_casas) ? d.moeda_casas : perfil.moeda_casas };
  const dinheiro = (/** @type {unknown} */ v) => formatarMoeda(v, c);
  const confirmado = d.status === "CONFIRMADO";
  const pagar = d.direcao === "PAGAR";
  const titulos = Array.isArray(d.titulos) ? [...d.titulos].sort((a, b) => (a.numero_parcela ?? 0) - (b.numero_parcela ?? 0)) : [];
  const itens = Array.isArray(d.itens) ? d.itens : [];
  const rateios = Array.isArray(d.rateios) ? d.rateios : [];
  const historico = Array.isArray(d.historico) ? d.historico : [];
  // O detalhe real traz o estorno como linha própria (`tipo: 'ESTORNO'`, só exibição):
  // ela não é baixa, não se estorna e não conta como baixa ativa.
  const algumaBaixaAtiva = titulos.some((t) => (t.liquidacoes ?? []).some((/** @type {any} */ l) => !ehLinhaDeEstorno(l) && !l.estornada));

  return (
    <CadastroFormShell embedded title="Consulta do lançamento">
      <div className="mg-b1-record-form" data-testid="consulta-lancamento">
        <div className="b1 mg-b1-form-grid w-full min-h-0">
          <div className="col-span-12 flex flex-wrap items-center gap-2">
            <Selo status={d.status} rotulo={ROTULO_STATUS[/** @type {keyof typeof ROTULO_STATUS} */ (d.status)] ?? d.status} testId="status-lancamento" />
            <span className="text-[12px] font-medium uppercase text-[var(--mg-text-2,#475569)]">
              {ROTULO_DIRECAO[/** @type {keyof typeof ROTULO_DIRECAO} */ (d.direcao)] ?? d.direcao} · {ROTULO_CONTEUDO[/** @type {keyof typeof ROTULO_CONTEUDO} */ (d.conteudo)] ?? d.conteudo} ·{" "}
              {ROTULO_CONDICAO[/** @type {keyof typeof ROTULO_CONDICAO} */ (d.condicao)] ?? d.condicao}
            </span>
            {confirmado && acoes.cancelar ? (
              <button
                type="button"
                className={`${BOTAO} ml-auto border-red-300 bg-white text-red-700 hover:bg-red-50`}
                onClick={onCancelar}
                disabled={ocupado}
                data-testid="botao-cancelar-lancamento"
                title={algumaBaixaAtiva ? "Há baixas registradas: estorne-as antes de cancelar" : undefined}
              >
                <Ban size={16} aria-hidden /> Cancelar lançamento
              </button>
            ) : null}
          </div>
          {d.status === "CANCELADO" ? (
            <div className="col-span-12">
              <AvisoGestao testId="aviso-cancelado">
                Cancelado em {formatarInstante(d.cancelado_em, locale, fuso)} por {quem(d.cancelado_por)}. Motivo: {d.motivo_cancelamento || "—"}. Os títulos foram
                cancelados e os efeitos de estoque, estornados.
              </AvisoGestao>
            </div>
          ) : null}

          <SecaoForm titulo="Dados gerais" />
          <div className="col-span-12 grid grid-cols-12 gap-3">
            <Dado rotulo="Parceiro" span="col-span-12 md:col-span-6">
              <span className="uppercase">{d.parceiro_nome || "—"}</span>
            </Dado>
            <Dado rotulo="Emissão">{formatarDia(d.data_emissao, locale)}</Dado>
            <Dado rotulo={pagar ? "Recebimento físico" : "Entrega física"}>{d.data_operacional ? formatarDia(d.data_operacional, locale) : "—"}</Dado>
            <Dado rotulo="Nº do documento">{d.documento_referencia || "—"}</Dado>
            <Dado rotulo="Forma preferida">{d.metodo_preferido ? ROTULO_METODO[/** @type {keyof typeof ROTULO_METODO} */ (d.metodo_preferido)] ?? d.metodo_preferido : "—"}</Dado>
            <Dado rotulo="Confirmado">{d.confirmado_em ? `${formatarInstante(d.confirmado_em, locale, fuso)} · ${quem(d.confirmado_por)}` : "—"}</Dado>
            <Dado rotulo="Moeda">{c.moeda}</Dado>
            <Dado rotulo="Histórico (descrição)" span="col-span-12">
              {d.descricao || "—"}
            </Dado>
            <Dado rotulo="Valor bruto">{dinheiro(d.valor_bruto)}</Dado>
            <Dado rotulo="Desconto">{dinheiro(d.valor_desconto)}</Dado>
            <Dado rotulo="Acréscimo">{dinheiro(d.valor_acrescimo)}</Dado>
            <Dado rotulo="Total">
              <span data-testid="consulta-total" className="font-semibold">
                {dinheiro(d.valor_total)}
              </span>
            </Dado>
          </div>

          {itens.length ? (
            <>
              <SecaoForm titulo="Itens e efeitos no estoque" />
              {itens.map((/** @type {any} */ i) => (
                <div key={i.id ?? i.ordem} className="col-span-12 min-w-0 rounded-lg border border-[var(--mg-divider,#cbd5e1)] bg-white p-3" data-testid={`consulta-item-${i.ordem}`}>
                  <div className="grid grid-cols-12 gap-3">
                    <Dado rotulo={`Item ${i.ordem}`} span="col-span-12 md:col-span-4">
                      <span className="uppercase">{i.tipo_item === "SERVICO" ? i.descricao || "Serviço" : i.produto_nome || "—"}</span>
                    </Dado>
                    <Dado rotulo="Local">{i.local_estoque_nome || "—"}</Dado>
                    <Dado rotulo="Quantidade">
                      {formatarNumero(i.quantidade, { locale, casasMax: 4 })} {i.unidade}
                      {i.quantidade_estoque && i.unidade !== "KG" ? ` (${formatarNumero(i.quantidade_estoque, { locale, casasMax: 4 })} kg)` : ""}
                    </Dado>
                    <Dado rotulo="Valor unitário">{formatarNumero(i.valor_unitario, { locale, casasMin: c.casas, casasMax: 6 })}</Dado>
                    <Dado rotulo="Subtotal">{dinheiro(i.valor_total)}</Dado>
                    {i.tipo_item === "MERCADORIA" ? (
                      <Dado rotulo="Efeito no estoque" span="col-span-12">
                        <span className="text-[12px] font-normal">
                          {i.movimentacao_estoque_id ? `${pagar ? "Entrada" : "Saída"} registrada (movimento ${i.movimentacao_estoque_id})` : "Sem movimento"}
                          {i.estoque_lote_nota_id ? ` · lote ${i.estoque_lote_nota_id}` : ""}
                          {i.movimentacao_estorno_id ? ` · estornado (movimento ${i.movimentacao_estorno_id})` : ""}
                          {Array.isArray(i.consumos) && i.consumos.length
                            ? ` · FIFO: ${i.consumos
                                .map((/** @type {any} */ k) => `lote ${k.estoque_lote_nota_id} ${formatarNumero(k.quantidade, { locale, casasMax: 4 })} kg a ${formatarNumero(k.custo_unitario, { locale, casasMin: 2, casasMax: 4 })}/kg`)
                                .join("; ")}`
                            : ""}
                        </span>
                      </Dado>
                    ) : null}
                  </div>
                </div>
              ))}
            </>
          ) : null}

          <SecaoForm titulo="Rateio" />
          {rateios.map((/** @type {any} */ r) => (
            <div key={r.ordem} className="col-span-12 min-w-0 rounded-lg border border-[var(--mg-divider,#cbd5e1)] bg-white p-3" data-testid={`consulta-rateio-${r.ordem}`}>
              <div className="grid grid-cols-12 gap-3">
                <Dado rotulo={`Natureza ${r.ordem}`} span="col-span-12 md:col-span-4">
                  <span className="uppercase">{r.natureza_nome || "—"}</span>
                </Dado>
                <Dado rotulo="Centro de custo">{r.centro_custo_nome || "—"}</Dado>
                <Dado rotulo="Centro de resultado">{r.centro_resultado_nome || "—"}</Dado>
                <Dado rotulo="Valor" span="col-span-6 md:col-span-1">
                  {dinheiro(r.valor)}
                </Dado>
                <Dado rotulo="%" span="col-span-6 md:col-span-1">
                  {r.percentual
                    ? `${formatarNumero(r.percentual, { locale, casasMin: 2, casasMax: 6 })}%`
                    : d.valor_total && r.valor
                      ? `${formatarNumero(percentualDe(r.valor, d.valor_total, c.casas, 2) ?? "0", { locale, casasMin: 2, casasMax: 2 })}%`
                      : "—"}
                </Dado>
              </div>
            </div>
          ))}

          <SecaoForm titulo={pagar ? "Títulos a pagar" : "Títulos a receber"} />
          {confirmado ? (
            <div className="col-span-12">
              <AvisoGestao tone="blue" testId="aviso-sem-conciliacao">
                Baixa = registro gerencial manual do pagamento/recebimento. Não há conciliação bancária: “quitado” não significa confirmado pelo banco.
              </AvisoGestao>
            </div>
          ) : null}
          {titulos.map((/** @type {any} */ t) => {
            const liquidavel = confirmado && (t.status === "ABERTO" || t.status === "PARCIAL");
            return (
              <div key={t.id} className="col-span-12 min-w-0 rounded-lg border border-[var(--mg-divider,#cbd5e1)] bg-white p-3" data-testid={`titulo-${t.numero_parcela}`}>
                <div className="grid grid-cols-12 items-start gap-3">
                  <Dado rotulo="Parcela" span="col-span-6 md:col-span-2">
                    {t.numero_parcela}/{t.total_parcelas}
                  </Dado>
                  <Dado rotulo="Vencimento" span="col-span-6 md:col-span-2">
                    {formatarDia(t.vencimento, locale)}
                  </Dado>
                  <Dado rotulo="Valor" span="col-span-6 md:col-span-2">
                    {dinheiro(t.valor)}
                  </Dado>
                  <Dado rotulo={pagar ? "Pago" : "Recebido"} span="col-span-6 md:col-span-2">
                    {dinheiro(t.valor_liquidado)}
                  </Dado>
                  <Dado rotulo="Saldo" span="col-span-6 md:col-span-2">
                    <span data-testid={`titulo-${t.numero_parcela}-saldo`}>{dinheiro(t.saldo)}</span>
                  </Dado>
                  <Dado rotulo="Situação" span="col-span-6 md:col-span-2">
                    <Selo status={t.status} rotulo={ROTULO_STATUS_TITULO[/** @type {keyof typeof ROTULO_STATUS_TITULO} */ (t.status)] ?? t.status} testId={`titulo-${t.numero_parcela}-status`} />
                  </Dado>
                  {liquidavel && acoes.liquidar ? (
                    <div className="col-span-12">
                      <button
                        type="button"
                        className={`${BOTAO} border-emerald-600 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}
                        onClick={() => onLiquidar(t)}
                        disabled={ocupado}
                        data-testid={`botao-liquidar-${t.numero_parcela}`}
                      >
                        <HandCoins size={16} aria-hidden /> {pagar ? "Registrar pagamento" : "Registrar recebimento"}
                      </button>
                    </div>
                  ) : null}
                  {(t.liquidacoes ?? []).length ? (
                    <ul className="col-span-12 space-y-1.5" aria-label={`Baixas da parcela ${t.numero_parcela}`}>
                      {(t.liquidacoes ?? []).map((/** @type {any} */ l) =>
                        ehLinhaDeEstorno(l) ? (
                          <li
                            key={l.id}
                            data-testid={`liquidacao-${l.id}`}
                            className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-2 py-1.5 text-[12px] text-amber-900"
                          >
                            <Undo2 size={14} aria-hidden />
                            <span className="font-medium">Estorno de {dinheiro(l.valor)}</span>
                            <span>em {formatarDia(l.data, locale)}</span>
                            {l.motivo ? <span className="break-words">· motivo: {l.motivo}</span> : null}
                            <span>· {quem(l.registrado_por)}</span>
                          </li>
                        ) : (
                          <li
                            key={l.id}
                            data-testid={`liquidacao-${l.id}`}
                            className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-[12px] ${l.estornada ? "border-slate-200 bg-slate-50 text-slate-500" : "border-emerald-200 bg-emerald-50/40"}`}
                          >
                            <span className={l.estornada ? "line-through" : "font-medium"}>{dinheiro(l.valor)}</span>
                            <span>em {formatarDia(l.data, locale)}</span>
                            <span>· {ROTULO_METODO[/** @type {keyof typeof ROTULO_METODO} */ (l.metodo)] ?? l.metodo ?? "—"}</span>
                            {l.referencia ? <span>· ref. {l.referencia}</span> : null}
                            {l.observacao ? <span className="break-words">· {l.observacao}</span> : null}
                            <span>· {quem(l.registrado_por)}</span>
                            {l.estornada ? <Selo status="CANCELADO" rotulo="Estornada" testId={`liquidacao-${l.id}-estornada`} /> : null}
                            {!l.estornada && confirmado && acoes.estornar ? (
                              <button
                                type="button"
                                className={`${BOTAO} ml-auto border-amber-300 bg-white text-amber-900 hover:bg-amber-50`}
                                onClick={() => onEstornar(l, t)}
                                disabled={ocupado}
                                data-testid={`botao-estornar-${l.id}`}
                              >
                                <Undo2 size={14} aria-hidden /> Estornar baixa
                              </button>
                            ) : null}
                          </li>
                        ),
                      )}
                    </ul>
                  ) : null}
                </div>
              </div>
            );
          })}

          <SecaoForm titulo="Histórico de alterações" />
          <ul className="col-span-12 space-y-1 text-[12px]" data-testid="historico-lancamento">
            {historico.length ? (
              historico.map((/** @type {any} */ h, /** @type {number} */ k) => (
                <li key={`${h.acao}-${h.em}-${k}`} className="flex flex-wrap gap-2">
                  <span className="font-medium">{ACOES_HISTORICO[h.acao] ?? h.acao}</span>
                  <span>{formatarInstante(h.em, locale, fuso)}</span>
                  <span className="text-[var(--mg-text-2,#475569)]">{h.usuario_login || "sistema"}</span>
                </li>
              ))
            ) : (
              <li className="text-[var(--mg-text-2,#475569)]">Sem registros.</li>
            )}
          </ul>
        </div>
      </div>
    </CadastroFormShell>
  );
}
