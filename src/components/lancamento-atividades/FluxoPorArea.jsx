import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import CardAreasDaAtividade from "@/components/lancamento-atividades/CardAreasDaAtividade";
import LancamentosDaArea from "@/components/lancamento-atividades/LancamentosDaArea";
import { BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { areasDaAtividade, linhaDaAreaParaExibir, temAreas } from "@/lib/atividadeAreasRegras";
import { formatarDiaAtividade, rotuloDoStatusAtividade } from "@/lib/lancamentoAtividadesRegras";
import { fraseDoRegistro } from "@/lib/atividadeFluxoCampo";
import { linhaResumoDaAtividade } from "@/lib/lancamentosDaAreaRegras";

/**
 * A atividade pelo lugar do custo (D-PROD-251, reorganizada na D-PROD-252): duas telas, uma de cada vez.
 *
 *  - **A atividade**: uma linha de resumo no alto ("Aberta · desde 03/11/2026 · 28 de 70 ha · custo total R$ 4.710,00 (R$ 168,21
 *    por ha)") e UMA tabela de áreas (`CardAreasDaAtividade`). O nome da área abre a área; o ⚡ inicia, conclui e o resto.
 *  - **A área** (`LancamentosDaArea`): os botões "+" e UMA tabela com tudo o que foi lançado ali. A atividade antiga, sem
 *    áreas, abre direto nessa tela (o lugar é a atividade toda).
 *
 * A confirmação do abastecimento é um aviso no alto da área ("Foi anotado em …").
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
 *   onGravouAbastecimento?: (recado: { texto: string, areaId: string|null, nomeArea: string, nomeAtividade: string }) => void,
 *   onAtividadeAtualizada: (atividade: any) => void,
 *   recado: { texto: string, areaId: string|null, nomeArea: string, nomeAtividade: string } | null,
 *   onLimparRecado: () => void,
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
  onGravouAbastecimento = () => {},
  onAtividadeAtualizada,
  recado,
  onLimparRecado,
  telaInicial = null,
  onAreaAberta = () => {},
}) {
  const comAreas = temAreas(atividade);
  const [tela, setTela] = useState(/** @type {{ nome: 'atividade' } | { nome: 'area', id: string|null }} */ (telaInicial ?? { nome: "atividade" }));
  const areas = areasDaAtividade(atividade);

  // A confirmação do abastecimento leva para a área onde ele entrou (como no D-PROD-251).
  const telaAtual = !comAreas ? { nome: "area", id: null } : recado && tela.nome === "atividade" && recado.areaId ? { nome: "area", id: recado.areaId } : tela;
  const areaAberta = comAreas && telaAtual.nome === "area";
  useEffect(() => {
    onAreaAberta(areaAberta);
    return () => onAreaAberta(false);
  }, [areaAberta, onAreaAberta]);
  const fecharRecado = () => {
    if (recado && tela.nome === "atividade" && recado.areaId) setTela({ nome: "area", id: recado.areaId });
    onLimparRecado();
  };
  const avisoRecado = recado ? (
    <AvisoGestao tone="blue" testId="registro-confirmado">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[13px]" data-testid="registro-confirmado-frase">
          {fraseDoRegistro({ texto: recado.texto, area: recado.nomeArea, atividade: recado.nomeAtividade })}
        </p>
        <button type="button" className={BOTAO_SECUNDARIO} onClick={fecharRecado} aria-label="Fechar o aviso" data-testid="registro-voltar-area">
          <X className="h-4 w-4" aria-hidden /> Fechar
        </button>
      </div>
    </AvisoGestao>
  ) : null;

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
        avisoRecado={avisoRecado}
        onLancar={onLancar}
        onGravouAbastecimento={onGravouAbastecimento}
        onAtividadeAtualizada={onAtividadeAtualizada}
        onVoltar={
          comAreas
            ? () => {
                setTela({ nome: "atividade" });
                if (recado) onLimparRecado();
              }
            : null
        }
      />
    );
  }

  const feita = linhaDaAreaParaExibir({ area_planejada: totais?.area_planejada ?? atividade?.area_planejada }, { area_executada: totais?.area_executada ?? atividade?.area_executada });
  const resumo = linhaResumoDaAtividade({
    situacao: rotuloDoStatusAtividade(atividade?.status),
    desde: formatarDiaAtividade(atividade?.data_inicio) || "",
    feitaDePlanejada: feita.planejada !== "—" ? `${feita.feita === "—" ? "0" : feita.feita.replace(/\s*ha$/i, "")} de ${feita.planejada}` : "",
    custoTotal: totais?.custo_total,
    custoPorHa: totais?.custo_por_ha,
  });
  return (
    <section className="min-w-0" data-testid="fluxo-por-area">
      {avisoRecado}
      <p className="mb-3 text-[13px] font-medium" data-testid="fluxo-resumo">
        {resumo}
        {lendoTotais && !totais ? " · …" : ""}
      </p>
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
