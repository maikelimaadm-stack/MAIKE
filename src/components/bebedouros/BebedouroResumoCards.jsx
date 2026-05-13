import React from "react";
import { Droplets, AlertTriangle, Wrench, DollarSign } from "lucide-react";

function CardMini({ label, value, IconComponent, color = "text-slate-700" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      <div className="flex items-center gap-2">
        <IconComponent className={`h-4 w-4 ${color}`} />
        <div>
          <div className="text-[10px] text-slate-500">{label}</div>
          <div className="text-sm font-bold text-slate-900">{value}</div>
        </div>
      </div>
    </div>
  );
}

export default function BebedouroResumoCards({ bebedouros = [], historico = [], alertas = [] }) {
  const ativos = bebedouros.filter((item) => item.status === "Ativo").length;
  const manutencao = bebedouros.filter((item) => item.status === "Em manutenção").length;
  const custo = historico.reduce((sum, item) => sum + Number(item.custo || 0), 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <CardMini label="Total" value={bebedouros.length} IconComponent={Droplets} color="text-blue-600" />
      <CardMini label="Ativos" value={ativos} IconComponent={Droplets} color="text-emerald-600" />
      <CardMini label="Manutenção" value={manutencao} IconComponent={Wrench} color="text-amber-600" />
      <CardMini label="Alertas" value={alertas.length} IconComponent={AlertTriangle} color="text-red-600" />
      <CardMini label="Custos acumulados" value={`R$ ${custo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} IconComponent={DollarSign} color="text-slate-700" />
    </div>
  );
}