import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const statusClass = {
  Pendente: "text-amber-700 border-amber-200 bg-amber-50",
  Concluído: "text-emerald-700 border-emerald-200 bg-emerald-50",
  Emergencial: "text-red-700 border-red-200 bg-red-50"
};

const formatDateBR = (value) => value ? new Date(`${String(value).split("T")[0]}T00:00:00`).toLocaleDateString("pt-BR") : "-";
const formatMoney = (value) => value ? `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-";

export default function BebedouroTimeline({ historico = [] }) {
  if (!historico.length) return <div className="text-center py-8 text-xs text-slate-500">Nenhum lançamento encontrado.</div>;

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="bg-slate-50 border-b py-3 px-3">
        <CardTitle className="text-sm font-semibold">Histórico do Bebedouro ({historico.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        <div className="max-h-[60vh] overflow-y-auto space-y-1">
          {historico.map((item) => (
            <div key={item.id} className="border border-slate-200 rounded-lg p-2.5 hover:bg-gray-50 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="inline-flex items-center rounded-md border px-2.5 py-0.5 font-semibold text-[10px] text-slate-700 border-slate-300 bg-white">{formatDateBR(item.data_lancamento)}</span>
                  <Badge variant="outline" className={`text-[10px] ${statusClass[item.status] || statusClass.Concluído}`}>{item.status || "Concluído"}</Badge>
                </div>
              </div>

              <div className="text-xs font-semibold text-slate-900">{item.tipo_lancamento || "Lançamento"}</div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                <InfoBox label="Responsável" value={item.responsavel || "-"} />
                <InfoBox label="Hora" value={item.hora_lancamento || "-"} />
                <InfoBox label="Custo" value={formatMoney(item.custo)} />
                <InfoBox label="Status" value={item.status || "-"} />
              </div>

              {(item.produto_utilizado || item.quantidade_utilizada) && (
                <div>
                  <SectionLabel>PRODUTO</SectionLabel>
                  <div className="grid grid-cols-2 gap-1 text-[10px]">
                    <InfoBox label="Produto" value={item.produto_utilizado || "-"} />
                    <InfoBox label="Quantidade" value={item.quantidade_utilizada || "-"} />
                  </div>
                </div>
              )}

              {(item.nivel_risco || item.cor_agua || item.turbidez || item.odor) && (
                <div>
                  <SectionLabel>SANIDADE DA ÁGUA</SectionLabel>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                    <InfoBox label="Risco" value={item.nivel_risco || "-"} />
                    <InfoBox label="Cor" value={item.cor_agua || "-"} />
                    <InfoBox label="Turbidez" value={item.turbidez || "-"} />
                    <InfoBox label="Odor" value={item.odor || "-"} />
                  </div>
                </div>
              )}

              {item.descricao && <div className="text-[10px] text-slate-500 break-words">Obs: {item.descricao}</div>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SectionLabel({ children }) {
  return <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mt-1 mb-0.5">{children}</div>;
}

function InfoBox({ label, value }) {
  return <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">{label}</div><div className="font-semibold text-slate-900 break-words">{value}</div></div>;
}