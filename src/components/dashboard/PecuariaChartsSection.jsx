import React from "react";
import { BarChart3 } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, PieChart, Pie, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const COLORS = ["#059669", "#2563eb", "#f59e0b", "#7c3aed", "#ef4444", "#0f766e"];

function EmptyState({ title }) {
  return (
    <div className="flex h-[240px] flex-col items-center justify-center text-center text-slate-400">
      <BarChart3 className="mb-2 h-10 w-10 opacity-50" />
      <p className="text-sm">Sem dados para {title.toLowerCase()}</p>
    </div>
  );
}

export default function PecuariaChartsSection({ charts }) {
  const chartCards = [
    {
      key: "pesoLotes",
      title: "Peso médio por lote",
      data: charts.pesoPorLote,
      content: (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={charts.pesoPorLote}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11 }} formatter={(value) => [`${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`, "Peso médio"]} />
            <Bar dataKey="peso" fill="#059669" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ),
    },
    {
      key: "movimentosMes",
      title: "Movimentação pecuária por mês",
      data: charts.movimentacaoMensal,
      content: (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={charts.movimentacaoMensal}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="entradas" fill="#059669" name="Entradas" radius={[4, 4, 0, 0]} />
            <Bar dataKey="saidas" fill="#ef4444" name="Saídas" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ),
    },
    {
      key: "ocupacaoAreas",
      title: "Ocupação das áreas",
      data: charts.ocupacaoAreas,
      content: (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={charts.ocupacaoAreas}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="ocupacao" fill="#2563eb" name="Animais" radius={[4, 4, 0, 0]} />
            <Bar dataKey="capacidade" fill="#f59e0b" name="Capacidade" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ),
    },
    {
      key: "categoriaLotes",
      title: "Composição do rebanho",
      data: charts.categoriaLotes,
      content: (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={charts.categoriaLotes} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} labelLine={false} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
              {charts.categoriaLotes.map((entry, index) => (
                <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 11 }} formatter={(value) => Number(value).toLocaleString("pt-BR")} />
          </PieChart>
        </ResponsiveContainer>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      {chartCards.map((chart) => (
        <Card key={chart.key} className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-900">{chart.title}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {chart.data.length > 0 ? chart.content : <EmptyState title={chart.title} />}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}