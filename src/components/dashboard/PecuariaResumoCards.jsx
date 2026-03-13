import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRightLeft, MapPin, Scale, TrendingUp, Package } from "lucide-react";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const formatNumber = (value) => Number(value || 0).toLocaleString("pt-BR");
const formatKg = (value) => `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;

export default function PecuariaResumoCards({ summary }) {
  const cards = [
    {
      title: "Rebanho ativo",
      value: formatNumber(summary.totalCabecasAtivas),
      subtitle: `${formatNumber(summary.totalLotesAtivos)} lotes ativos`,
      icon: Package,
      color: "text-emerald-600",
      border: "border-emerald-500",
    },
    {
      title: "Peso médio atual",
      value: formatKg(summary.pesoMedioRebanho),
      subtitle: `GMD médio: ${Number(summary.mediaGmd30Dias || 0).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg/dia`,
      icon: TrendingUp,
      color: "text-blue-600",
      border: "border-blue-500",
    },
    {
      title: "Pesagens individuais",
      value: formatNumber(summary.pesagens30Dias),
      subtitle: "Lançamentos nos últimos 30 dias",
      icon: Scale,
      color: "text-violet-600",
      border: "border-violet-500",
    },
    {
      title: "Movimentações pecuárias",
      value: formatNumber(summary.animaisMovimentados30Dias),
      subtitle: `${formatNumber(summary.entradas30Dias)} entradas • ${formatNumber(summary.saidas30Dias)} saídas`,
      icon: ArrowRightLeft,
      color: "text-sky-600",
      border: "border-sky-500",
    },
    {
      title: "Mapa geral",
      value: formatNumber(summary.areasAtivas),
      subtitle: `${Number(summary.hectaresPastagem || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha monitorados`,
      icon: MapPin,
      color: "text-amber-600",
      border: "border-amber-500",
    },
    {
      title: "Alertas do mapa",
      value: formatNumber(summary.alertasMapa),
      subtitle: "Áreas com alta ocupação ou sobrepastoreio",
      icon: AlertTriangle,
      color: "text-red-600",
      border: "border-red-500",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className={`border-l-4 ${card.border} shadow-sm`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-slate-500">{card.title}</div>
                    <div className="mt-1 text-2xl font-bold text-slate-900">{card.value}</div>
                    <div className="mt-1 text-xs text-slate-600">{card.subtitle}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <Icon className={`w-5 h-5 ${card.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Acessos rápidos da pecuária</h2>
              <p className="text-xs text-slate-600">Atalhos para acompanhar manejo, mapa e pesagens no dia a dia.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={createPageUrl("ControlePecuaria")}>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 gap-1.5">
                  <Package className="w-3.5 h-3.5" />
                  Controle Pecuária
                </Button>
              </Link>
              <Link to={createPageUrl("PesagensIndividuais")}>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                  <Scale className="w-3.5 h-3.5" />
                  Pesagens Individuais
                </Button>
              </Link>
              <Link to={createPageUrl("HistoricoMovimentacoesPecuaria")}>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  Histórico Pecuária
                </Button>
              </Link>
              <Link to={createPageUrl("MapaGeral")}>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  Mapa Geral
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}