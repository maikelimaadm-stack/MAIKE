import React from "react";
import { Tabs as TabsUi, TabsContent as TabsContentUi, TabsList as TabsListUi, TabsTrigger as TabsTriggerUi } from "@/components/ui/tabs";
import HistoricoAbateCurral from "./HistoricoAbateCurral";
import HistoricoMovimentacoes from "../lotes/HistoricoMovimentacoes";
import { ehCurral, podeMedirForragemNaArea, podeVerHistoricoDaArea } from "@/domain/mapa/cliqueArea";
import PainelForragemArea from "../pastagem/PainelForragemArea";

// `ui/tabs` é forwardRef sem tipos de props: o checkJs não enxerga `children`.
/** @type {React.ComponentType<any>} */ const Tabs = TabsUi;
/** @type {React.ComponentType<any>} */ const TabsContent = TabsContentUi;
/** @type {React.ComponentType<any>} */ const TabsList = TabsListUi;
/** @type {React.ComponentType<any>} */ const TabsTrigger = TabsTriggerUi;

/**
 * Detalhes da área no Mapa Geral (D-PROD-94a).
 *
 * - Toda área com permissão de histórico: "Histórico da Área" — consulta o
 *   servidor pela área (origem, destino ou local), sem depender de lote
 *   presente (`lotes=[]`). Área vazia não perde histórico.
 * - Curral: mantém o histórico de abate, numa aba própria. São fatos de
 *   naturezas diferentes; nenhum é copiado para o outro.
 * - D-PROD-219: pasto (fora da infraestrutura) com a chave `medir_forragem`:
 *   o painel Forragem (botão "Medição de Forragem" e as últimas medições) em cima.
 */
export default function DetalhesArea({ area, permissions }) {
  const curral = ehCurral(area);
  const historicoDaArea = podeVerHistoricoDaArea(permissions);
  const forragem = podeMedirForragemNaArea(permissions, area);

  if (!area?.id || (!curral && !historicoDaArea && !forragem)) return null;

  const abaArea = <HistoricoMovimentacoes lotes={[]} areaId={area.id} />;

  if (!curral) {
    return (
      <div className="mk-map-details space-y-1" translate="no">
        {forragem ? <PainelForragemArea area={area} /> : null}
        {historicoDaArea ? abaArea : null}
      </div>
    );
  }

  if (!historicoDaArea) {
    return (
      <div className="mk-map-details space-y-1" translate="no">
        <HistoricoAbateCurral areaId={area.id} />
      </div>
    );
  }

  return (
    <div className="mk-map-details space-y-1" translate="no">
      <Tabs defaultValue="abate" className="w-full">
        <TabsList className="mb-1">
          <TabsTrigger value="abate" className="text-xs">Abate</TabsTrigger>
          <TabsTrigger value="area" className="text-xs">Histórico da Área</TabsTrigger>
        </TabsList>
        <TabsContent value="abate" className="mt-0">
          <HistoricoAbateCurral areaId={area.id} />
        </TabsContent>
        <TabsContent value="area" className="mt-0">
          {abaArea}
        </TabsContent>
      </Tabs>
    </div>
  );
}
