import React, { useEffect, useState } from "react";
import CardAreasDaAtividade from "@/components/lancamento-atividades/CardAreasDaAtividade";
import LancamentosDaArea from "@/components/lancamento-atividades/LancamentosDaArea";
import { areasDaAtividade, temAreas } from "@/lib/atividadeAreasRegras";

/**
 * A atividade pelo lugar do custo (D-PROD-251, reorganizada nas D-PROD-252 e emendas): duas telas, uma de cada vez, cada uma
 * uma tabela Base1 (`TabelaBase1`) sem cartão e sem linha de resumo.
 *
 *  - **A atividade**: UMA tabela de áreas (`CardAreasDaAtividade`). O nome da área abre a área; o ⚡ inicia, conclui e o resto.
 *  - **A área** (`LancamentosDaArea`): os botões "+" e UMA tabela com tudo o que foi lançado ali. A atividade antiga, sem
 *    áreas, abre direto nessa tela (o lugar é a atividade toda).
 *
 * Gravou o abastecimento ou um lançamento: o aviso é o toast do app, não um aviso na tela (emenda 2).
 *
 * @param {{
 *   atividade: any,
 *   totais: any,
 *   lendoTotais: boolean,
 *   lendoLinhas: boolean,
 *   apontamentos: any[],
 *   acoes: Record<string, any>,
 *   escopo: string,
 *   podeLancar: boolean,
 *   podeGerir: boolean,
 *   podeInformarFeita?: boolean,
 *   flags: { permiteProduto?: boolean, permiteImplemento?: boolean, permiteMaoObra?: boolean, permiteServico?: boolean },
 *   onLancar: (tipo: string, aba: 'lista'|'dados', areaId: string|null) => void,
 *   onAtividadeAtualizada: (atividade: any) => void,
 *   telaInicial?: { nome: 'atividade' } | { nome: 'area', id: string|null } | null,
 *   onAreaAberta?: (aberta: boolean) => void,
 * }} props `onAreaAberta`: avisa quando uma área (com a tabela de áreas por trás) está aberta; a casca esconde as abas.
 */
export default function FluxoPorArea({
  atividade,
  totais,
  lendoTotais,
  lendoLinhas,
  apontamentos,
  acoes,
  escopo,
  podeLancar,
  podeGerir,
  podeInformarFeita = false,
  flags,
  onLancar,
  onAtividadeAtualizada,
  telaInicial = null,
  onAreaAberta = () => {},
}) {
  const comAreas = temAreas(atividade);
  const [tela, setTela] = useState(/** @type {{ nome: 'atividade' } | { nome: 'area', id: string|null }} */ (telaInicial ?? { nome: "atividade" }));
  const areas = areasDaAtividade(atividade);

  const telaAtual = !comAreas ? { nome: "area", id: null } : tela;
  const areaAberta = comAreas && telaAtual.nome === "area";
  useEffect(() => {
    onAreaAberta(areaAberta);
    return () => onAreaAberta(false);
  }, [areaAberta, onAreaAberta]);

  if (telaAtual.nome === "area") {
    const area = telaAtual.id ? areas.find((a) => String(a.id) === String(telaAtual.id)) ?? null : null;
    return (
      <LancamentosDaArea
        atividade={atividade}
        area={area}
        totais={totais}
        lendoTotais={lendoTotais}
        lendoLinhas={lendoLinhas}
        apontamentos={apontamentos}
        acoes={acoes}
        podeLancar={podeLancar}
        flags={flags}
        escopo={escopo}
        onLancar={onLancar}
        onAtividadeAtualizada={onAtividadeAtualizada}
        onVoltar={
          comAreas
            ? () => setTela({ nome: "atividade" })
            : null
        }
      />
    );
  }

  return (
    <section className="b1-tabela-tela" data-testid="fluxo-por-area">
      <CardAreasDaAtividade
        atividade={atividade}
        totais={totais}
        lendoTotais={lendoTotais}
        podeGerir={podeGerir}
        apontamentos={apontamentos}
        podeInformarFeita={podeInformarFeita}
        onAbrirArea={(id) => setTela({ nome: "area", id })}
        onAtividadeAtualizada={onAtividadeAtualizada}
      />
    </section>
  );
}
