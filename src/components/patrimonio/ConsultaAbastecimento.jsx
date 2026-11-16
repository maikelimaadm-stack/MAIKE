import React from "react";
import { Ban, Gauge } from "lucide-react";
import { formatarInstante } from "@/lib/diaCivil";
import {
  UNIDADE_MEDIDOR,
  formatarCusto,
  formatarDiaAbastecimento,
  formatarLeitura,
  formatarLitros,
  formatarQuantidade,
  ehExterno,
  rotuloDaOrigem,
  rotuloDaUnidade,
  rotuloDoBem,
  rotuloDoCentroDeCusto,
  snapshotDoMedidor,
  textoDoIntervaloConfiavel,
} from "@/lib/abastecimentoRegras";
import { rotuloDaAtividadeDoAbastecimento, rotuloDoLancamentoDoAbastecimento } from "@/lib/atividadeLinhasRegras";
import { SeloAbastecimento } from "@/components/patrimonio/TabelaAbastecimentos";
import { BOTAO_PERIGO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";

/** Motivo legível de "dados insuficientes" / "não se aplica" no consumo. */
export const MOTIVO_CONSUMO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    sem_tanque_cheio_anterior: "não há abastecimento anterior com tanque cheio neste tanque",
    nao_e_tanque_cheio: "este abastecimento não completou o tanque",
    medidor_trocado: "o medidor mudou entre os dois tanques cheios",
    intervalo_nao_positivo: "a leitura não avançou entre os dois tanques cheios",
    quantidade_nao_positiva: "a quantidade abastecida entre os dois tanques cheios não é positiva",
    // D-PROD-162 (P-03): litros e quilos nunca se somam.
    unidades_misturadas: "o intervalo tem abastecimentos em litros e em quilos, que não se somam",
    sem_medidor: "o bem não tem medidor",
    medidor_ciclos: "o medidor é de ciclos (sem métrica de consumo)",
    cancelado: "o abastecimento foi cancelado",
  }),
);

/** @param {{ rotulo: string, children: React.ReactNode, testId?: string, span?: string }} props */
function Campo({ rotulo, children, testId = undefined, span = "sm:col-span-1" }) {
  return (
    <div className={`min-w-0 ${span}`}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">{rotulo}</dt>
      <dd className="min-w-0 break-words text-[13px]" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

/** Unidade do intervalo do medidor (km no odômetro; h no horímetro), pela métrica. @param {unknown} metrica */
export const unidadeDoIntervalo = (metrica) => (typeof metrica === "string" && metrica.startsWith("KM_") ? "km" : "h");

/** @param {{ titulo: string, mov: any, testId: string, unidade: string|null }} props */
function Movimento({ titulo, mov, testId, unidade }) {
  if (!mov) return null;
  // O movimento rotula a sua unidade (`unidade_medida`); sem ela, a do abastecimento.
  const u = mov.unidade ?? unidade;
  const por = rotuloDaUnidade(u);
  return (
    <div className="min-w-0 rounded-md border border-slate-200 p-2 text-[12px]" data-testid={testId}>
      <p className="font-semibold">
        {titulo} nº {mov.numero ?? "—"} · {mov.tipo_movimentacao ?? ""} · {mov.status ?? ""}
      </p>
      <p className="text-[var(--mg-text-2,#475569)]">
        {formatarQuantidade(mov.quantidade, u)} × {formatarCusto(mov.valor_unitario)}
        {por ? `/${por}` : ""} = {formatarCusto(mov.valor_total)}
      </p>
    </div>
  );
}

/**
 * Bloco de consumo do abastecimento: valor e metodologia, ou "Dados insuficientes" + motivo.
 * @param {{ consumo: any }} props
 */
export function ConsumoDoAbastecimento({ consumo }) {
  if (!consumo || consumo.situacao !== "CALCULADO") {
    const naoAplica = consumo?.situacao === "NAO_APLICAVEL";
    return (
      <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 p-2 text-[12px]" data-testid="abastecimento-consumo">
        <p className="font-semibold">{naoAplica ? "Consumo não se aplica" : "Dados insuficientes"}</p>
        <p className="text-[var(--mg-text-2,#475569)]">
          {MOTIVO_CONSUMO[String(consumo?.motivo ?? "")] ?? "não há dois tanques cheios consecutivos com leitura neste tanque"}.
        </p>
        {consumo?.metodologia ? <p className="mt-1 text-[11px] text-[var(--mg-text-2,#475569)]">{consumo.metodologia}</p> : null}
      </div>
    );
  }
  return (
    <div className="min-w-0 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[12px]" data-testid="abastecimento-consumo">
      <p className="font-semibold">
        Consumo: {formatarLeitura(consumo.valor)} {consumo.unidade_metrica}
      </p>
      <p className="text-[var(--mg-text-2,#475569)]">
        {formatarQuantidade(consumo.quantidade, consumo.unidade)} em {formatarLeitura(consumo.intervalo)} {unidadeDoIntervalo(consumo.metrica)} desde o tanque cheio anterior.
      </p>
      {consumo.metodologia ? <p className="mt-1 text-[11px] text-[var(--mg-text-2,#475569)]">{consumo.metodologia}</p> : null}
    </div>
  );
}

/**
 * Consulta de um abastecimento (fato confirmado ou cancelado; nada se edita):
 * máquina, PRODUTO (o da época: trocar os Produtos aceitos do tanque no
 * cadastro de Bens não reescreve o histórico), quantidade baixada na unidade
 * gravada no abastecimento (L ou kg), leitura do medidor, tanque, custo FIFO
 * FINAL (por L ou por kg), lotes, movimento e estorno; situação, cancelamento e
 * consumo. D-PROD-162: sem tipo de combustível e sem fator. D-PROD-210: origem
 * (estoque da fazenda ou posto externo, que não tem local nem movimento), a
 * atividade e o lançamento a que pertence, o centro de custo (snapshot) e, com
 * contador, a leitura anterior, o avanço do medidor e o intervalo confiável.
 * @param {{ detalhe: any, podeCancelar: boolean, onCancelar: () => void, onVerConsumo: () => void, fuso?: string|null }} props
 */
export default function ConsultaAbastecimento({ detalhe: d, podeCancelar, onCancelar, onVerConsumo, fuso = null }) {
  const unidade = UNIDADE_MEDIDOR[String(d?.medidor?.tipo ?? "")] ?? "";
  const fatias = Array.isArray(d?.fatias) ? d.fatias : [];
  // A unidade GRAVADA no abastecimento (snapshot): a do Produto pode ter mudado depois.
  const porUnidade = rotuloDaUnidade(d?.unidade);
  const externo = ehExterno(d);
  const snapshot = d?.medidor?.leitura ? snapshotDoMedidor(d) : null;
  return (
    <div className="cadastro-b1 min-w-0 p-3" data-testid="abastecimento-consulta">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SeloAbastecimento status={d.status} testId="abastecimento-consulta-situacao" />
        <span className="text-[13px] font-semibold">Abastecimento nº {d.numero}</span>
        <span className="text-[12px] text-[var(--mg-text-2,#475569)]">{formatarDiaAbastecimento(d.data_operacional)}</span>
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Campo rotulo="Máquina/Veículo" testId="consulta-bem">
          {rotuloDoBem(d.bem)}
        </Campo>
        <Campo rotulo="Produto" testId="consulta-produto">
          {d.produto?.nome ?? "—"}
        </Campo>
        <Campo rotulo="Origem" testId="consulta-origem">
          {rotuloDaOrigem(d)}
        </Campo>
        <Campo rotulo="Local de estoque">{externo ? "— (posto externo)" : (d.local_estoque?.nome ?? "—")}</Campo>
        <Campo rotulo={externo ? "Quantidade abastecida" : "Quantidade baixada"} testId="consulta-quantidade">
          {formatarQuantidade(d.quantidade, d.unidade)}
        </Campo>
        <Campo rotulo="Leitura do medidor" testId="consulta-leitura">
          {d.medidor?.leitura ? `${formatarLeitura(d.medidor.leitura)} ${unidade}` : d.medidor?.tipo === "SEM_MEDIDOR" ? "Sem medidor" : "—"}
        </Campo>
        {snapshot ? (
          <>
            <Campo rotulo="Leitura anterior" testId="consulta-leitura-anterior">
              {snapshot.anterior ? `${formatarLeitura(snapshot.anterior)} ${unidade}` : "—"}
            </Campo>
            <Campo rotulo="Avanço do medidor" testId="consulta-medidor-delta">
              {snapshot.delta ? `${formatarLeitura(snapshot.delta)} ${unidade}` : "—"}
            </Campo>
            <Campo rotulo="Intervalo confiável" testId="consulta-intervalo-confiavel">
              {textoDoIntervaloConfiavel(snapshot)}
            </Campo>
          </>
        ) : null}
        <Campo rotulo="Tanque cheio">{d.tanque_cheio ? "Sim" : "Não"}</Campo>
        <Campo rotulo="Tanque">
          {d.tanque?.identificador ?? "—"}
          {d.tanque?.capacidade_litros ? ` (${formatarLitros(d.tanque.capacidade_litros)} L)` : ""}
        </Campo>
        <Campo rotulo={externo ? "Valor da nota" : "Custo FIFO"} testId="consulta-custo">
          {formatarCusto(d.custo_total)}
          {d.custo_unitario ? ` (${formatarCusto(d.custo_unitario)}${porUnidade ? `/${porUnidade}` : ""})` : ""}
        </Campo>
        <Campo rotulo={externo ? "Número da nota ou cupom" : "Referência externa"}>{d.referencia_externa || "—"}</Campo>
        <Campo rotulo="Atividade" testId="consulta-atividade">
          {rotuloDaAtividadeDoAbastecimento(d.atividade)}
        </Campo>
        <Campo rotulo="Lançamento" testId="consulta-lancamento">
          {rotuloDoLancamentoDoAbastecimento(d.apontamento)}
        </Campo>
        <Campo rotulo="Centro de custo" testId="consulta-centro-custo">
          {rotuloDoCentroDeCusto(d)}
        </Campo>
        {d.observacao ? (
          <Campo rotulo="Observação" span="sm:col-span-3">
            {d.observacao}
          </Campo>
        ) : null}
        <Campo rotulo="Registrado por">
          {d.criado_por?.login ?? "—"} {d.created_date ? `em ${formatarInstante(d.created_date, "pt-BR", fuso)}` : ""}
        </Campo>
      </dl>

      {fatias.length ? (
        <div className="mt-3 min-w-0 overflow-x-auto">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">Lotes consumidos (FIFO)</p>
          <table className="w-full text-[12px]" data-testid="consulta-fatias">
            <thead>
              <tr className="text-left text-[var(--mg-text-2,#475569)]">
                <th className="py-1 pr-2">Ordem</th>
                <th className="py-1 pr-2">Lote de</th>
                <th className="py-1 pr-2 text-right">{porUnidade ? `Quantidade (${porUnidade})` : "Quantidade"}</th>
                <th className="py-1 pr-2 text-right">{porUnidade ? `Custo/${porUnidade}` : "Custo"}</th>
                <th className="py-1 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {fatias.map((/** @type {any} */ f) => (
                <tr key={`${f.ordem}-${f.lote_id}`} className="border-t border-slate-100">
                  <td className="py-1 pr-2">{f.ordem}</td>
                  <td className="py-1 pr-2">{formatarDiaAbastecimento(f.data_lote)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatarQuantidade(f.quantidade, null)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatarCusto(f.custo_unitario)}</td>
                  <td className="py-1 text-right tabular-nums">{formatarCusto(f.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <Movimento titulo="Saída de estoque" mov={d.movimentacao} testId="consulta-movimento" unidade={d.unidade ?? null} />
        <Movimento titulo="Estorno" mov={d.estorno} testId="consulta-estorno" unidade={d.unidade ?? null} />
      </div>

      {d.cancelamento ? (
        <div className="mt-3 min-w-0 rounded-md border border-slate-300 bg-slate-50 p-2 text-[12px]" data-testid="consulta-cancelamento">
          <p className="font-semibold">
            Cancelado {d.cancelamento.cancelado_em ? `em ${formatarInstante(d.cancelamento.cancelado_em, "pt-BR", fuso)}` : ""}
            {d.cancelamento.cancelado_por?.login ? ` por ${d.cancelamento.cancelado_por.login}` : ""}
          </p>
          <p className="break-words">Motivo: {d.cancelamento.motivo}</p>
        </div>
      ) : null}

      <div className="mt-3 min-w-0">
        <ConsumoDoAbastecimento consumo={d.consumo} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={BOTAO_SECUNDARIO} onClick={onVerConsumo} data-testid="abastecimento-ver-consumo-bem">
          <Gauge size={16} className="mr-1" aria-hidden /> Consumo do bem
        </button>
        {podeCancelar && d.status === "CONFIRMADO" ? (
          <button type="button" className={BOTAO_PERIGO} onClick={onCancelar} data-testid="abastecimento-cancelar">
            <Ban size={16} aria-hidden /> Cancelar abastecimento
          </button>
        ) : null}
      </div>
    </div>
  );
}
