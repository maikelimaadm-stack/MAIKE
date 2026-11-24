import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { listarLotesDisponiveis } from "@/services/estoqueConsultaService";
import { avisoDoLote, diaMes, erroDosLotes, quantidadeDeEstoque, sugestaoFefo, usaLoteVencido } from "@/lib/estoqueLotesRegras";

const fmt = (/** @type {unknown} */ v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) : "";
};

/**
 * D-PROD-281 — campo "Lote" de uma linha de SAÍDA ou TRANSFERÊNCIA de produto que controla lote. Mostra a sugestão
 * FEFO (o lote que vence primeiro; o servidor aplica a mesma sem a lista), deixa trocar e dividir entre lotes
 * ("Escolher lotes") e avisa "Lote vencido em dd/mm", pedindo a confirmação. Produto sem lote: não aparece.
 * O estado vive na linha: `lotes` (null = FEFO; [{ id, quantidade }] = escolha manual) e `confirmaVencido`.
 * Cabe em 390 px: lista empilhada, sem tabela.
 * @param {{ empresaId: string, linha: any, onMudar: (patch: Record<string, unknown>) => void, testId: string }} props
 */
export default function CampoLotesSaida({ empresaId, linha, onMudar, testId }) {
  const produtoId = linha?.produto?.id;
  const localId = linha?.deposito?.id;
  const ativo = Boolean(linha?.produto?.controla_lote && produtoId && localId);
  const { data, isLoading } = useQuery({
    queryKey: ["estoque", "lotes-disponiveis", empresaId, produtoId, localId],
    queryFn: () => listarLotesDisponiveis(empresaId, produtoId, localId),
    enabled: ativo,
    staleTime: 15_000,
  });
  const lotesLidos = data?.lotes ?? [];
  const vencidoAgora = ativo && usaLoteVencido(linha, lotesLidos);
  const erroAgora = ativo && !isLoading ? erroDosLotes(linha, lotesLidos) : "";
  // A validação do formulário é pura: o campo devolve à linha o que só ele sabe (vencido, erro dos lotes).
  useEffect(() => {
    if (Boolean(linha?.loteVencido) !== Boolean(vencidoAgora) || (linha?.erroLote ?? "") !== (erroAgora || "")) {
      onMudar({ loteVencido: Boolean(vencidoAgora), erroLote: erroAgora || "" });
    }
  }, [vencidoAgora, erroAgora]);
  if (!linha?.produto?.controla_lote) return null;
  if (!localId) {
    return <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid={`${testId}-sem-deposito`}>Escolha o depósito para ver os lotes.</p>;
  }
  const lotes = data?.lotes ?? [];
  const unidade = data?.unidade === "L" ? "L" : "kg";
  const total = quantidadeDeEstoque(linha);
  const manual = Array.isArray(linha.lotes);
  const sugestao = sugestaoFefo(lotes, total);
  const erro = erroDosLotes(linha, lotes);
  const vencido = usaLoteVencido(linha, lotes);
  const rotulo = (/** @type {any} */ l) => `${l.lote_fabricante ?? "Sem lote"}${l.data_validade ? ` · vence ${diaMes(l.data_validade)}` : ""}`;
  const qtdManual = (/** @type {string} */ id) => linha.lotes?.find((/** @type {any} */ f) => f.id === id)?.quantidade ?? "";
  const mudarQtd = (/** @type {string} */ id, /** @type {string} */ valor) => {
    const outros = (linha.lotes ?? []).filter((/** @type {any} */ f) => f.id !== id);
    onMudar({ lotes: valor ? [...outros, { id, quantidade: valor }] : outros, confirmaVencido: false });
  };
  return (
    <div className="col-span-12 rounded border border-dashed border-[var(--mg-border,#e2e8f0)] p-2 text-[13px]" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">Lote</span>
        <button
          type="button"
          className="tb-btn"
          onClick={() => onMudar({ lotes: manual ? null : sugestao.fatias.map((f) => ({ id: f.id, quantidade: String(f.quantidade).replace(".", ",") })), confirmaVencido: false })}
          data-testid={`${testId}-alternar`}
        >
          {manual ? "Usar a sugestão (vence primeiro)" : "Escolher lotes"}
        </button>
      </div>
      {isLoading ? <p className="mt-1 text-[12px]">Carregando lotes…</p> : null}
      {!isLoading && !lotes.length ? <p className="mt-1 text-[12px]" data-testid={`${testId}-vazio`}>Nenhum lote com saldo neste depósito.</p> : null}
      {!manual && lotes.length ? (
        <ul className="mt-1 space-y-1" data-testid={`${testId}-sugestao`}>
          {sugestao.fatias.length ? sugestao.fatias.map((f) => {
            const l = lotes.find((x) => x.id === f.id);
            return (
              <li key={f.id} className="flex flex-wrap justify-between gap-x-2">
                <span>{rotulo(l)}</span>
                <span className="tabular-nums">{fmt(f.quantidade)} {unidade}</span>
              </li>
            );
          }) : <li className="text-[12px] text-[var(--mg-text-2,#475569)]">Informe a quantidade para ver a sugestão.</li>}
        </ul>
      ) : null}
      {manual ? (
        <ul className="mt-1 space-y-2" data-testid={`${testId}-manual`}>
          {lotes.map((l) => (
            <li key={l.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {rotulo(l)} <span className="text-[12px] text-[var(--mg-text-2,#475569)]">(saldo {fmt(l.quantidade_disponivel)} {unidade})</span>
                {avisoDoLote(l) ? <span className="ml-1 text-[12px] font-semibold text-amber-700">{avisoDoLote(l)}</span> : null}
              </span>
              <input
                type="text"
                inputMode="decimal"
                className="w-full rounded border border-[var(--mg-border,#e2e8f0)] px-2 py-1 text-right tabular-nums sm:w-28"
                value={qtdManual(l.id)}
                onChange={(e) => mudarQtd(l.id, e.target.value.replace(/[^0-9,]/g, ""))}
                placeholder="0"
                aria-label={`Quantidade do lote ${l.lote_fabricante ?? ""}`}
                data-testid={`${testId}-qtd-${l.id}`}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {erro ? <p className="mt-1 text-[12px] text-red-700" role="alert" data-testid={`${testId}-erro`}>{erro}</p> : null}
      {vencido ? (
        <label className="mt-2 flex items-start gap-2 rounded bg-amber-50 p-2 text-[12px] text-amber-900" data-testid={`${testId}-vencido`}>
          <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span className="flex-1">
            {lotesVencidosTexto(linha, lotes)}. Confirme para usar mesmo assim.
          </span>
          <input type="checkbox" checked={linha.confirmaVencido === true} onChange={(e) => onMudar({ confirmaVencido: e.target.checked })} aria-label="Confirmo usar o lote vencido" data-testid={`${testId}-confirma-vencido`} />
        </label>
      ) : null}
    </div>
  );
}

/** "Lote vencido em dd/mm" (o primeiro vencido usado). @param {any} linha @param {any[]} lotes */
const lotesVencidosTexto = (linha, lotes) => {
  const usados = Array.isArray(linha.lotes) ? linha.lotes.map((/** @type {any} */ f) => lotes.find((l) => l.id === f.id)) : sugestaoFefo(lotes, quantidadeDeEstoque(linha)).fatias.map((f) => lotes.find((l) => l.id === f.id));
  const v = usados.find((l) => l?.vencido);
  return v ? `Lote vencido em ${diaMes(v.data_validade)}` : "Lote vencido";
};
