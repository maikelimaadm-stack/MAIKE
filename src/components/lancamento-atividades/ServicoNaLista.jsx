import React from "react";
import { Plus } from "lucide-react";
import { formatarMoedaAtividade } from "@/lib/atividadeLinhasRegras";
import {
  barraDoAndamento,
  capimDoServico,
  faltaConcluir,
  hectaresDaConcluida,
  rotuloDaSituacaoDoServico,
  rotuloDoTipoDoServico,
  situacaoDoServico,
  textoDaAreaDoServico,
  textoDaDataDoServico,
  textoDoAndamento,
  textoDoCapim,
  textoDosHectares,
} from "@/lib/servicoVariosDias";

/**
 * D-PROD-267 — as peças da linha do serviço na lista "uma linha por serviço" (Lançamento de Atividades).
 *
 * `SituacaoDoServico`: a célula "Situação" (computador) — a situação ("Em andamento", "Concluída"…) e, em andamento com
 * dia lançado, "12 de 40 ha (30%) · último dia 02/12", a barra fina e os botões "+ Lançar dia" e "Concluir"; aos 100% sem
 * ninguém concluir, "100%, falta concluir" em negrito e só "Concluir". `BlocoDoServico`: o mesmo serviço no celular, em
 * bloco compacto (Nº à esquerda; tipo e custo; operação · área; data · situação; o andamento, a barra e os botões).
 * Os botões não selecionam nem abrem a linha (o clique para ali).
 * D-PROD-271 (ajustes do teste de ponta a ponta): o Plantio de pastagem mostra o capim ("operação · área · capim …") e o
 * serviço sem área mostra o local e a quantidade feita, nunca "0 ha". `OperacaoDoServico`: a célula "Operação" do
 * computador, com o capim embaixo.
 */

/**
 * A célula "Operação" (computador): a operação e, no Plantio de pastagem, "capim <nome>" embaixo.
 * @param {{ item: any }} p
 */
export function OperacaoDoServico({ item }) {
  const operacao = String(item?.tipo_atividade_nome ?? "");
  const capim = textoDoCapim(capimDoServico(item));
  if (!capim) return <>{operacao || "–"}</>;
  return (
    <span className="b1-servico-operacao">
      <span>{operacao || "–"}</span>
      <span className="b1-servico-operacao__capim" data-testid={`servico-capim-${item?.id}`}>
        {capim}
      </span>
    </span>
  );
}

/** O clique nos botões da linha não chega à linha (nem seleciona, nem abre). @param {React.SyntheticEvent} e */
const parar = (e) => e.stopPropagation();

/**
 * @param {{ item: any, podeLancar: boolean, podeConcluir: boolean, onLancarDia: (item: any) => void, onConcluir: (item: any) => void, grande?: boolean }} p
 */
function AndamentoDoServico({ item, podeLancar, podeConcluir, onLancarDia, onConcluir, grande = false }) {
  if (situacaoDoServico(item) !== "EM_ANDAMENTO") return null;
  const falta = faltaConcluir(item);
  const barra = barraDoAndamento(item);
  const a = item?.andamento ?? {};
  const texto = textoDoAndamento(item);
  const id = String(item?.id ?? "");
  return (
    <>
      {falta ? (
        <span className="b1-servico-andamento b1-servico-andamento--falta" data-testid={`servico-falta-concluir-${id}`}>
          <strong>100%, falta concluir</strong>
          {textoDosHectares(a.hectares_feitos, a.hectares_area, null) ? (
            <span className="text-[#73726c]"> ({textoDosHectares(a.hectares_feitos, a.hectares_area, null)})</span>
          ) : null}
        </span>
      ) : texto ? (
        <span className="b1-servico-andamento" data-testid={`servico-andamento-${id}`}>
          {texto}
        </span>
      ) : null}
      {barra !== null ? (
        <span className="b1-servico-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={barra} aria-label="Andamento do serviço">
          <span className="b1-servico-barra__feito" style={{ width: `${barra}%` }} />
        </span>
      ) : null}
      {(podeLancar && !falta) || podeConcluir ? (
        <span className={`b1-servico-botoes${grande ? " b1-servico-bloco__botoes" : ""}`} onClick={parar} onDoubleClick={parar} onKeyDown={parar}>
          {podeLancar && !falta ? (
            <button type="button" className="b1-servico-botao" onClick={() => onLancarDia(item)} data-testid={`servico-lancar-dia-${id}`}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Lançar dia
            </button>
          ) : null}
          {podeConcluir ? (
            <button type="button" className="b1-servico-botao" onClick={() => onConcluir(item)} data-testid={`servico-concluir-${id}`}>
              Concluir
            </button>
          ) : null}
        </span>
      ) : null}
    </>
  );
}

/**
 * A célula "Situação" da grade (computador).
 * @param {{ item: any, podeLancar: boolean, podeConcluir: boolean, onLancarDia: (item: any) => void, onConcluir: (item: any) => void }} p
 */
export function SituacaoDoServico({ item, podeLancar, podeConcluir, onLancarDia, onConcluir }) {
  return (
    <span className="b1-servico-situacao" data-testid={`atividade-status-${item?.id}`} data-situacao={situacaoDoServico(item)}>
      <span>{rotuloDaSituacaoDoServico(item)}</span>
      <AndamentoDoServico item={item} podeLancar={podeLancar} podeConcluir={podeConcluir} onLancarDia={onLancarDia} onConcluir={onConcluir} />
    </span>
  );
}

/**
 * O bloco do serviço no celular (o corpo do card da lista).
 * @param {{ item: any, tipos: any[], podeLancar: boolean, podeConcluir: boolean, comAcoes: boolean,
 *   onLancarDia: (item: any) => void, onConcluir: (item: any) => void }} p
 */
export function BlocoDoServico({ item, tipos, podeLancar, podeConcluir, comAcoes, onLancarDia, onConcluir }) {
  const situacao = situacaoDoServico(item);
  const custo = formatarMoedaAtividade(item?.custo_total);
  // D-PROD-271: o capim do plantio fecha a linha ("SEMEADURA DE CAPIM · PASTO DA AROEIRA · capim PANICUM CV. MOMBAÇA").
  const operacaoArea = [String(item?.tipo_atividade_nome ?? ""), textoDaAreaDoServico(item), textoDoCapim(capimDoServico(item))].filter(Boolean).join(" · ");
  const concluidaHa = situacao === "CONCLUIDA" ? hectaresDaConcluida(item) : "";
  const dataSituacao = [textoDaDataDoServico(item), rotuloDaSituacaoDoServico(item), concluidaHa].filter(Boolean).join(" · ");
  return (
    <div className="b1-servico-bloco" data-testid={`servico-bloco-${item?.id}`} data-situacao={situacao}>
      <span className="b1-servico-bloco__num">{item?.numero ?? "–"}</span>
      <div className="b1-servico-bloco__conteudo">
        <span className={`b1-servico-bloco__topo${comAcoes ? " b1-servico-bloco__topo--com-acoes" : ""}`}>
          <span className="b1-servico-bloco__tipo">{rotuloDoTipoDoServico(item, tipos) || String(item?.tipo_atividade_nome ?? "")}</span>
          {custo ? <span className="b1-servico-bloco__custo">{custo}</span> : null}
        </span>
        {operacaoArea ? <span className="b1-servico-bloco__linha">{operacaoArea}</span> : null}
        <span className="b1-servico-bloco__linha" data-testid={`atividade-status-${item?.id}`}>
          {dataSituacao}
        </span>
        <AndamentoDoServico item={item} podeLancar={podeLancar} podeConcluir={podeConcluir} onLancarDia={onLancarDia} onConcluir={onConcluir} grande />
      </div>
    </div>
  );
}
