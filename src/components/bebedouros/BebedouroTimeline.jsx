import React from "react";
import { Badge } from "@/components/ui/badge";
import { Droplet, Wrench, AlertTriangle, CheckCircle2 } from "lucide-react";

const getIcon = (tipo) => {
  if (["Limpeza", "Tratamento da água", "Aplicação de produto", "Análise da água", "Abastecimento"].includes(tipo)) return Droplet;
  if (["Manutenção", "Troca de boia", "Troca de encanamento"].includes(tipo)) return Wrench;
  if (["Vazamento", "Contaminação"].includes(tipo)) return AlertTriangle;
  return CheckCircle2;
};

const statusClass = {
  Pendente: "bg-amber-50 text-amber-700 border-amber-200",
  Concluído: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Emergencial: "bg-red-50 text-red-700 border-red-200"
};

export default function BebedouroTimeline({ historico = [] }) {
  if (!historico.length) return <div className="text-xs text-slate-500 p-3">Nenhum lançamento registrado.</div>;

  return (
    <div className="space-y-2">
      {historico.map((item) => {
        const Icon = getIcon(item.tipo_lancamento);
        return (
          <div key={item.id} className="relative pl-8 pb-3 border-l border-slate-200 ml-3 last:pb-0">
            <div className="absolute -left-3 top-0 h-6 w-6 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm">
              <Icon className="h-3.5 w-3.5 text-slate-700" />
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs font-semibold text-slate-900">{item.tipo_lancamento}</div>
                <Badge variant="outline" className={`text-[10px] ${statusClass[item.status] || statusClass.Concluído}`}>{item.status}</Badge>
              </div>
              <div className="text-[10px] text-slate-500">{item.data_lancamento ? new Date(`${item.data_lancamento}T00:00:00`).toLocaleDateString("pt-BR") : "-"} {item.hora_lancamento || ""} · {item.responsavel || "Sem responsável"}</div>
              {item.descricao && <div className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{item.descricao}</div>}
              {(item.produto_utilizado || item.quantidade_utilizada || item.custo) && <div className="grid grid-cols-3 gap-1 mt-2 text-[10px]">
                <div className="rounded bg-slate-50 p-1"><span className="text-slate-500">Produto</span><div className="font-semibold">{item.produto_utilizado || "-"}</div></div>
                <div className="rounded bg-slate-50 p-1"><span className="text-slate-500">Qtd.</span><div className="font-semibold">{item.quantidade_utilizada || "-"}</div></div>
                <div className="rounded bg-slate-50 p-1"><span className="text-slate-500">Custo</span><div className="font-semibold">{item.custo ? `R$ ${Number(item.custo).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "-"}</div></div>
              </div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}