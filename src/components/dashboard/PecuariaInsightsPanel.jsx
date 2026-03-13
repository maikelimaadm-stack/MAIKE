import React from "react";
import { AlertTriangle, MapPin, Package, Scale, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const formatNumber = (value, digits = 0) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits });

function InsightListCard({ title, icon: Icon, colorClass, items, emptyText }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Icon className={`w-4 h-4 ${colorClass}`} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-1.5">
        {items.length > 0 ? items.map((item) => (
          <div key={item.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs font-medium text-slate-900">{item.label}</div>
            <div className="text-[11px] text-slate-600">{item.value}</div>
          </div>
        )) : (
          <div className="py-6 text-center text-xs text-slate-500">{emptyText}</div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PecuariaInsightsPanel({ insights }) {
  const summaryCards = [
    { label: "UA total", value: `${formatNumber(insights.uaTotal, 1)} UA` },
    { label: "Taxa média", value: `${formatNumber(insights.uaHaMedia, 2)} UA/ha` },
    { label: "Áreas vazias", value: formatNumber(insights.areasVazias) },
    { label: "Pastos críticos", value: formatNumber(insights.areasCriticas.length) },
  ];

  return (
    <div className="space-y-3">
      <Card className="shadow-sm border-l-4 border-l-emerald-500">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-600" />
            Insights de manejo e mapa geral
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {summaryCards.map((item) => (
              <div key={item.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-center">
                <div className="text-lg font-bold text-slate-900">{item.value}</div>
                <div className="text-[10px] text-slate-600">{item.label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <InsightListCard
          title="Áreas em atenção"
          icon={AlertTriangle}
          colorClass="text-red-600"
          emptyText="Nenhuma área crítica no momento."
          items={insights.areasCriticas.slice(0, 6).map((item) => ({
            label: item.nome,
            value: `${formatNumber(item.percentual, 0)}% da capacidade • ${formatNumber(item.ua, 1)} UA`,
          }))}
        />

        <InsightListCard
          title="Oportunidades de manejo"
          icon={MapPin}
          colorClass="text-blue-600"
          emptyText="Sem áreas livres ou subutilizadas."
          items={insights.oportunidades.slice(0, 6).map((item) => ({
            label: item.nome,
            value: item.value,
          }))}
        />

        <InsightListCard
          title="Estoque por marca"
          icon={Package}
          colorClass="text-violet-600"
          emptyText="Sem marcas cadastradas nas pesagens individuais."
          items={insights.marcas.slice(0, 6).map((item) => ({
            label: item.nome,
            value: `${formatNumber(item.quantidade)} animal(is)`,
          }))}
        />
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Scale className="w-4 h-4 text-amber-600" />
            Categorias e composição do rebanho
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
            {insights.categorias.length > 0 ? insights.categorias.slice(0, 8).map((item) => (
              <div key={item.nome} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-sm font-semibold text-slate-900">{formatNumber(item.quantidade)}</div>
                <div className="text-xs text-slate-600">{item.nome}</div>
              </div>
            )) : (
              <div className="col-span-full py-6 text-center text-xs text-slate-500">Sem categorias disponíveis.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}