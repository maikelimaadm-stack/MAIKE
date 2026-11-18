import React from "react";
import { LancLoteAviso, LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import { formatKg } from "./formatters";

/**
 * "2026-10-20" ou ISO → "20/10/2026", pelo dia gravado: sem passar por fuso ("2026-10-20" não vira 19/10
 * no Brasil, e "2026-10-20T23:30:00-03:00" não vira 21/10 em UTC).
 * @param {any} valor
 */
export const diaDoFechamento = (valor) => {
  const [ano, mes, dia] = String(valor ?? "").slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : null;
};

/**
 * Sobra do ciclo anterior: aparece no "Lançar" do cocho quando o último fechamento deixou sobra, para
 * decidir se ela entra como saldo inicial do novo lançamento (D-PROD-137, SUP-02: escolher só preenche o
 * formulário; o registro nasce ao salvar).
 *
 * D-PROD-222: no desenho dos lançamentos de manejo — `LancLoteDialogo` (o título, o cocho no subtítulo e o
 * ✕ no cabeçalho), os avisos em `LancLoteAviso` e as duas escolhas como as opções do manejo
 * (`mk-ll__opcao`, como o "Editar Informação" quando há mais de um lote). Antes, o diálogo antigo cortava o
 * texto à direita (as escolhas não quebravam linha). O ✕ faz o que o "Cancelar" fazia: sai do lançamento.
 *
 * @param {{ open: boolean, sobraKg: number, pontoNome?: string, ultimoLancamentoData?: string | null, onAproveitar: () => void, onDescartar: () => void, onCancel?: () => void }} props
 */
export default function SobraHerdadaDialog({ open, sobraKg, pontoNome, ultimoLancamentoData, onAproveitar, onDescartar, onCancel }) {
  const dia = diaDoFechamento(ultimoLancamentoData);
  return (
    <LancLoteDialogo
      open={open}
      onOpenChange={(aberto) => {
        if (!aberto) onCancel?.();
      }}
      titulo="Sobra do ciclo anterior"
      lotes={pontoNome ? [{ nome: pontoNome }] : undefined}
      somenteLeitura
      // É uma escolha: o foco vai para a primeira opção, como no diálogo antigo (não fica no ✕ do lançamento,
      // escondido por baixo — um Enter ali cancelava o lançamento).
      focoInicial="corpo"
    >
      <p className="mk-ll__texto">
        O cocho <strong className="font-semibold text-slate-900">{pontoNome}</strong> ficou sem lote no pasto e tinha sobra registrada no fechamento.
      </p>
      <LancLoteAviso tom="ambar" data-testid="sobra-herdada-registrada">
        Sobra registrada: <strong>{formatKg(sobraKg)}</strong>
        {dia ? ` · Fechamento em ${dia}` : null}
      </LancLoteAviso>
      <LancLoteAviso tom="neutro">Essa ação não altera o último fechamento. Ela apenas decide se a sobra entra como saldo inicial do novo lançamento.</LancLoteAviso>
      <p className="mk-ll__texto">Como deseja iniciar o novo lançamento?</p>
      {/* D-PROD-137 (SUP-02): a escolha só preenche o formulário; o registro nasce ao salvar. */}
      <button type="button" className="mk-ll__opcao mk-ll__opcao--coluna" onClick={onAproveitar}>
        <span>Usar essa sobra no novo ciclo</span>
        <span>Preenche {formatKg(sobraKg)} como saldo inicial do novo lançamento — o registro só é criado ao salvar; o fechamento anterior não é reaberto</span>
      </button>
      <button type="button" className="mk-ll__opcao mk-ll__opcao--coluna" onClick={onDescartar}>
        <span>Sobra já foi descartada/baixada</span>
        <span>Faz um lançamento novo do zero</span>
      </button>
    </LancLoteDialogo>
  );
}
