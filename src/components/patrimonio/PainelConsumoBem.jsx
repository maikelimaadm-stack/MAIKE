import React from "react";
import { useQuery } from "@tanstack/react-query";
import * as UiDialog from "@/components/ui/dialog";
import { consumoDoBem } from "@/services/abastecimentoService";
import { mensagemErroAbastecimento } from "@/lib/patrimonioErros";
import { formatarDiaAbastecimento, formatarLeitura, formatarLitros, rotuloDoBem } from "@/lib/abastecimentoRegras";
import { MOTIVO_CONSUMO } from "@/components/patrimonio/ConsultaAbastecimento";
import { BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";

const Dialog = /** @type {any} */ (UiDialog.Dialog);
const DialogContent = /** @type {any} */ (UiDialog.DialogContent);
const DialogDescription = /** @type {any} */ (UiDialog.DialogDescription);
const DialogFooter = /** @type {any} */ (UiDialog.DialogFooter);
const DialogHeader = /** @type {any} */ (UiDialog.DialogHeader);
const DialogTitle = /** @type {any} */ (UiDialog.DialogTitle);

/** Chave do consumo do bem (prefixo da tela: confirmar/cancelar invalida). @param {string|null} empresaId @param {string|null} bemId */
export const chaveConsumoBem = (empresaId, bemId) => ["patrimonio-abastecimentos", "consumo", empresaId, bemId];

/**
 * Consumo do bem pelo método do tanque cheio (km/L no odômetro, L/h no
 * horímetro). Sem dois tanques cheios consecutivos com leitura: "dados
 * insuficientes". Sem medidor ou de ciclos: não se aplica.
 * @param {{ aberto: boolean, empresaId: string|null, bem: any, onFechar: () => void }} props
 */
export default function PainelConsumoBem({ aberto, empresaId, bem, onFechar }) {
  const bemId = bem?.id ? String(bem.id) : null;
  const consulta = useQuery({
    queryKey: chaveConsumoBem(empresaId, bemId),
    queryFn: () => consumoDoBem(empresaId, /** @type {string} */ (bemId)),
    enabled: aberto && Boolean(empresaId && bemId),
    staleTime: 15 * 1000,
  });
  const dados = /** @type {any} */ (consulta.data ?? null);
  const intervalos = Array.isArray(dados?.intervalos) ? dados.intervalos : [];
  const naoAplica = dados?.situacao_geral === "NAO_APLICAVEL";
  const unidadeIntervalo = dados?.metrica === "KM_POR_LITRO" ? "km" : "h";

  let corpo;
  if (consulta.isLoading) corpo = <p role="status">Carregando consumo…</p>;
  else if (consulta.isError) {
    corpo = (
      <div role="alert" className="text-red-800">
        <p>{mensagemErroAbastecimento(consulta.error, "Não foi possível ler o consumo do bem.")}</p>
        <button type="button" className={`${BOTAO_SECUNDARIO} mt-2`} onClick={() => consulta.refetch()}>
          Tentar novamente
        </button>
      </div>
    );
  } else if (naoAplica) corpo = <p data-testid="consumo-nao-aplica">Consumo não se aplica a este medidor.</p>;
  else if (!intervalos.length) corpo = <p data-testid="consumo-vazio">Dados insuficientes: ainda não há abastecimentos com tanque cheio neste bem.</p>;
  else {
    corpo = (
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full text-[12px]" data-testid="consumo-intervalos">
          <thead>
            <tr className="text-left text-[var(--mg-text-2,#475569)]">
              <th className="py-1 pr-2">Tanque</th>
              <th className="py-1 pr-2">De → até</th>
              <th className="py-1 pr-2 text-right">Intervalo</th>
              <th className="py-1 pr-2 text-right">Litros</th>
              <th className="py-1 text-right">Consumo</th>
            </tr>
          </thead>
          <tbody>
            {intervalos.map((/** @type {any} */ it) => (
              <tr key={it.abastecimento_id} className="border-t border-slate-100" data-testid={`consumo-intervalo-${it.abastecimento_id}`}>
                <td className="py-1 pr-2">{it.tanque?.identificador ?? "—"}</td>
                <td className="py-1 pr-2">
                  {it.data_inicial ? formatarDiaAbastecimento(it.data_inicial) : "—"} → {formatarDiaAbastecimento(it.data_final)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{it.intervalo ? `${formatarLeitura(it.intervalo)} ${unidadeIntervalo}` : "—"}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{it.litros ? `${formatarLitros(it.litros)} L` : "—"}</td>
                <td className="py-1 text-right">
                  {it.situacao === "CALCULADO" ? (
                    <span className="font-semibold tabular-nums">
                      {formatarLeitura(it.valor)} {dados.unidade_metrica}
                    </span>
                  ) : (
                    <span className="text-[var(--mg-text-2,#475569)]" title={MOTIVO_CONSUMO[String(it.motivo ?? "")] ?? undefined}>
                      dados insuficientes
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Dialog open={aberto} onOpenChange={(/** @type {boolean} */ o) => (!o ? onFechar() : undefined)}>
      <DialogContent data-permissao-explicita="" data-testid="painel-consumo-bem" className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Consumo de {rotuloDoBem(dados?.bem ?? bem) || "bem"}</DialogTitle>
          <DialogDescription>Entre dois abastecimentos confirmados com tanque cheio no mesmo tanque.</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 text-[13px]">{corpo}</div>
        {dados?.metodologia ? (
          <p className="text-[11px] text-[var(--mg-text-2,#475569)]" data-testid="consumo-metodologia">
            {dados.metodologia}
          </p>
        ) : null}
        <DialogFooter>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>
            Fechar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
