import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Package, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format, subMonths } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PecuariaResumoCards from "@/components/dashboard/PecuariaResumoCards";
import PecuariaChartsSection from "@/components/dashboard/PecuariaChartsSection";
import PecuariaRecentes from "@/components/dashboard/PecuariaRecentes";
import PecuariaInsightsPanel from "@/components/dashboard/PecuariaInsightsPanel";

const CORES = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

export default function Home() {
  const [showConfigGraficos, setShowConfigGraficos] = useState(false);

  const [graficosVisiveis, setGraficosVisiveis] = useState(() => {
    const saved = localStorage.getItem("graficos_dashboard");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const validGraphIds = ["movimentacoes_mes", "estoque_categoria"];
        const filtered = parsed.filter((id) => validGraphIds.includes(id));
        if (filtered.length !== parsed.length) {
          localStorage.setItem("graficos_dashboard", JSON.stringify(filtered));
        }
        return filtered.length > 0 ? filtered : ["movimentacoes_mes", "estoque_categoria"];
      } catch {
        localStorage.removeItem("graficos_dashboard");
        return ["movimentacoes_mes", "estoque_categoria"];
      }
    }
    return ["movimentacoes_mes", "estoque_categoria"];
  });

  const [secoesVisiveis, setSecoesVisiveis] = useState(() => {
    const saved = localStorage.getItem("secoes_dashboard_pecuaria");
    const defaults = ["resumo_pecuaria", "graficos_pecuaria", "insights_mapa", "recentes_pecuaria", "suplementacao", "movimentacoes_mes", "estoque_categoria", "pesoLotes", "movimentosMes", "ocupacaoAreas", "categoriaLotes", "marcaAnimais"];
    if (!saved) return defaults;
    try {
      const parsed = JSON.parse(saved);
      return parsed.length ? parsed : defaults;
    } catch {
      return defaults;
    }
  });

  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos_dashboard", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((p) => p && p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ["movimentacoes_dashboard", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list("-data_movimentacao");
      return all.filter((m) => m && m.empresa_id === empresaSelecionadaId && m.status === "Ativa");
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: pontosSuplementacao = [] } = useQuery({
    queryKey: ["pontos-supl-dash", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: eventosSuplementacao = [] } = useQuery({
    queryKey: ["eventos-supl-dash", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter((e) => e.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ["lotes_dashboard_pecuaria", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((item) => item?.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: pesagensIndividuais = [] } = useQuery({
    queryKey: ["pesagens_individuais_dashboard", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PesagemIndividual.list("-data_pesagem");
      return all.filter((item) => item?.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: movimentacoesPecuaria = [] } = useQuery({
    queryKey: ["movimentacoes_pecuaria_dashboard", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoPecuaria.list("-data_movimentacao");
      return all.filter((item) => item?.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: areasPastagem = [] } = useQuery({
    queryKey: ["areas_pastagem_dashboard", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((item) => item?.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const dadosSuplementacao = useMemo(() => {
    const pontosAtivos = pontosSuplementacao.filter((p) => p.status === "Ativo").length;
    const eventosUltimos30 = eventosSuplementacao.filter((e) => {
      const diasAtras = Math.floor((new Date() - new Date(e.data_lancamento)) / (1000 * 60 * 60 * 24));
      return diasAtras <= 30;
    });
    const totalFornecido = eventosUltimos30.reduce((sum, e) => sum + (e.quantidade_total_kg || 0), 0);

    const pontosComAlerta = pontosSuplementacao.filter((p) => {
      if (p.status !== "Ativo") return false;
      const eventosP = eventosSuplementacao.filter((e) => e.ponto_suplementacao_id === p.id);
      if (eventosP.length === 0) return true;

      const ultimoEvento = [...eventosP].sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0];
      const diasSemLancamento = Math.floor((new Date() - new Date(ultimoEvento.data_lancamento)) / (1000 * 60 * 60 * 24));
      return diasSemLancamento > (p.alerta_sem_lancamento_dias || 10);
    });

    return { pontosAtivos, totalFornecido, alertas: pontosComAlerta.length, eventosCount: eventosUltimos30.length };
  }, [pontosSuplementacao, eventosSuplementacao]);

  const dadosGraficos = useMemo(() => {
    const movimentacoesMes = [];
    for (let i = 5; i >= 0; i--) {
      const mes = subMonths(new Date(), i);
      const inicioMes = new Date(mes.getFullYear(), mes.getMonth(), 1);
      const fimMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);

      const entradas = movimentacoes.filter((m) => m.tipo_movimentacao === "Entrada" && new Date(m.data_movimentacao) >= inicioMes && new Date(m.data_movimentacao) <= fimMes).length;
      const saidas = movimentacoes.filter((m) => m.tipo_movimentacao === "Saída" && new Date(m.data_movimentacao) >= inicioMes && new Date(m.data_movimentacao) <= fimMes).length;

      movimentacoesMes.push({ mes: format(mes, "MMM/yy"), entradas, saidas });
    }

    const categorias = {};
    produtos.forEach((p) => {
      const cat = p.categoria || "Sem categoria";
      if (!categorias[cat]) categorias[cat] = 0;
      categorias[cat] += p.estoque_atual || 0;
    });
    const estoquePorCategoria = Object.entries(categorias).map(([name, value]) => ({ name, value }));

    return { movimentacoesMes, estoquePorCategoria };
  }, [movimentacoes, produtos]);

  const dadosPecuaria = useMemo(() => {
    const hoje = new Date();
    const data30Dias = new Date();
    data30Dias.setDate(hoje.getDate() - 30);

    const lotesAtivos = lotes.filter((item) => (item.status || "Ativo") === "Ativo");
    const areasAtivas = areasPastagem.filter((item) => item.ativo !== false);
    const pesagens30Dias = pesagensIndividuais.filter((item) => item.data_pesagem && new Date(item.data_pesagem) >= data30Dias);
    const movimentacoes30Dias = movimentacoesPecuaria.filter((item) => item.data_movimentacao && new Date(item.data_movimentacao) >= data30Dias);

    const totalCabecasAtivas = lotesAtivos.reduce((sum, item) => sum + Number(item.quantidade_cabecas || 0), 0);
    const somaPesoPonderado = lotesAtivos.reduce((sum, item) => sum + (Number(item.quantidade_cabecas || 0) * Number(item.peso_medio_kg || 0)), 0);
    const pesoMedioRebanho = totalCabecasAtivas > 0 ? somaPesoPonderado / totalCabecasAtivas : 0;
    const mediaGmd30Dias = pesagens30Dias.filter((item) => item.gmd !== undefined && item.gmd !== null).reduce((sum, item, _, arr) => sum + Number(item.gmd || 0) / (arr.length || 1), 0);
    const animaisMovimentados30Dias = movimentacoes30Dias.reduce((sum, item) => sum + Number(item.quantidade_animais || 0), 0);
    const entradas30Dias = movimentacoes30Dias.filter((item) => item.tipo === "Entrada").reduce((sum, item) => sum + Number(item.quantidade_animais || 0), 0);
    const saidas30Dias = movimentacoes30Dias.filter((item) => item.tipo === "Saída").reduce((sum, item) => sum + Number(item.quantidade_animais || 0), 0);
    const hectaresPastagem = areasAtivas.reduce((sum, item) => sum + Number(item.area_pastejada || item.tamanho_hectares || 0), 0);
    const alertasMapa = areasAtivas.filter((item) => ["Alto", "Sobrepastoreado"].includes(item.status_ocupacao)).length;

    const movimentacaoMensal = [];
    for (let i = 5; i >= 0; i--) {
      const mes = subMonths(new Date(), i);
      const inicioMes = new Date(mes.getFullYear(), mes.getMonth(), 1);
      const fimMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
      const entradas = movimentacoesPecuaria
        .filter((item) => item.tipo === "Entrada" && new Date(item.data_movimentacao) >= inicioMes && new Date(item.data_movimentacao) <= fimMes)
        .reduce((sum, item) => sum + Number(item.quantidade_animais || 0), 0);
      const saidas = movimentacoesPecuaria
        .filter((item) => item.tipo === "Saída" && new Date(item.data_movimentacao) >= inicioMes && new Date(item.data_movimentacao) <= fimMes)
        .reduce((sum, item) => sum + Number(item.quantidade_animais || 0), 0);
      movimentacaoMensal.push({ mes: format(mes, "MMM/yy"), entradas, saidas });
    }

    const pesoPorLote = lotesAtivos
      .filter((item) => Number(item.peso_medio_kg || 0) > 0)
      .sort((a, b) => Number(b.quantidade_cabecas || 0) - Number(a.quantidade_cabecas || 0))
      .slice(0, 8)
      .map((item) => ({ name: item.nome, peso: Number(item.peso_medio_kg || 0) }));

    const ocupacaoAreas = areasAtivas
      .sort((a, b) => Number(b.quantidade_atual || 0) - Number(a.quantidade_atual || 0))
      .slice(0, 8)
      .map((item) => ({
        name: item.sigla || item.nome,
        ocupacao: Number(item.quantidade_atual || 0),
        capacidade: Number(item.capacidade_maxima || 0),
      }));

    const categorias = {};
    lotesAtivos.forEach((item) => {
      const nome = item.categoria_manejo_nome || item.categoria || item.sistema_produtivo || "Sem categoria";
      if (!categorias[nome]) categorias[nome] = 0;
      categorias[nome] += Number(item.quantidade_cabecas || 0);
    });
    const categoriaLotes = Object.entries(categorias)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const ultimasPesagensPorAnimal = Object.values(
      pesagensIndividuais.reduce((acc, item) => {
        const chave = item.numero_animal || item.id;
        if (!acc[chave] || new Date(item.data_pesagem || 0) > new Date(acc[chave].data_pesagem || 0)) {
          acc[chave] = item;
        }
        return acc;
      }, {})
    ).filter((item) => item.status_animal !== "Inativo");

    const marcasMap = {};
    ultimasPesagensPorAnimal.forEach((item) => {
      const marca = item.marca || "Sem marca";
      marcasMap[marca] = (marcasMap[marca] || 0) + 1;
    });

    const marcaAnimais = Object.entries(marcasMap)
      .map(([name, quantidade]) => ({ name, quantidade }))
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 8);

    const areasCriticas = areasAtivas
      .map((item) => {
        const ua = lotesAtivos
          .filter((lote) => lote.area_atual_id === item.id)
          .reduce((sum, lote) => sum + ((Number(lote.peso_medio_kg || 0) * Number(lote.quantidade_cabecas || 0)) / 450), 0);
        const capacidade = Number(item.capacidade_maxima || 0);
        const percentual = capacidade > 0 ? (ua / capacidade) * 100 : 0;
        return { nome: item.nome, ua, percentual, capacidade };
      })
      .filter((item) => item.percentual > 110)
      .sort((a, b) => b.percentual - a.percentual);

    const areasBaixaLotacao = areasAtivas
      .map((item) => {
        const ua = lotesAtivos
          .filter((lote) => lote.area_atual_id === item.id)
          .reduce((sum, lote) => sum + ((Number(lote.peso_medio_kg || 0) * Number(lote.quantidade_cabecas || 0)) / 450), 0);
        const capacidade = Number(item.capacidade_maxima || 0);
        const percentual = capacidade > 0 ? (ua / capacidade) * 100 : 0;
        return { nome: item.nome, percentual, capacidade, ua };
      })
      .filter((item) => item.capacidade > 0 && item.percentual > 0 && item.percentual < 70)
      .sort((a, b) => a.percentual - b.percentual);

    const areasVaziasList = areasAtivas
      .filter((item) => !lotesAtivos.some((lote) => lote.area_atual_id === item.id))
      .map((item) => ({ nome: item.nome, value: `${Number(item.area_pastejada || item.tamanho_hectares || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha livres` }));

    const oportunidades = [
      ...areasBaixaLotacao.map((item) => ({ nome: item.nome, value: `${Number(item.percentual).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% da capacidade utilizada` })),
      ...areasVaziasList,
    ];

    const uaTotal = lotesAtivos.reduce((sum, item) => sum + ((Number(item.peso_medio_kg || 0) * Number(item.quantidade_cabecas || 0)) / 450), 0);
    const uaHaMedia = hectaresPastagem > 0 ? uaTotal / hectaresPastagem : 0;

    return {
      summary: {
        totalCabecasAtivas,
        totalLotesAtivos: lotesAtivos.length,
        pesoMedioRebanho,
        pesagens30Dias: pesagens30Dias.length,
        mediaGmd30Dias,
        animaisMovimentados30Dias,
        entradas30Dias,
        saidas30Dias,
        areasAtivas: areasAtivas.length,
        hectaresPastagem,
        alertasMapa,
      },
      charts: {
        pesoPorLote,
        movimentacaoMensal,
        ocupacaoAreas,
        categoriaLotes,
        marcaAnimais,
      },
      recentes: {
        pesagens: [...pesagensIndividuais].slice(0, 6),
        movimentacoes: [...movimentacoesPecuaria].slice(0, 6),
      },
      insights: {
        uaTotal,
        uaHaMedia,
        areasVazias: areasVaziasList.length,
        areasCriticas,
        oportunidades,
        marcas: marcaAnimais.map((item) => ({ nome: item.name, quantidade: item.quantidade })),
        categorias: categoriaLotes.map((item) => ({ nome: item.name, quantidade: item.value })),
      },
    };
  }, [areasPastagem, lotes, movimentacoesPecuaria, pesagensIndividuais]);

  const toggleGrafico = (graficoId) => {
    setGraficosVisiveis((prev) => {
      const novos = prev.includes(graficoId) ? prev.filter((id) => id !== graficoId) : [...prev, graficoId];
      localStorage.setItem("graficos_dashboard", JSON.stringify(novos));
      return novos;
    });
  };

  const toggleSecao = (secaoId) => {
    setSecoesVisiveis((prev) => {
      const novos = prev.includes(secaoId) ? prev.filter((id) => id !== secaoId) : [...prev, secaoId];
      localStorage.setItem("secoes_dashboard_pecuaria", JSON.stringify(novos));
      return novos;
    });
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-xs text-slate-600">Painel executivo com visão integrada da pecuária, mapa e estoque</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowConfigGraficos(true)} className="h-8 text-xs">
            Configurar Gráficos
          </Button>
        </div>
      </div>

      {secoesVisiveis.includes("resumo_pecuaria") && <PecuariaResumoCards summary={dadosPecuaria.summary} />}
      {secoesVisiveis.includes("graficos_pecuaria") && (
        <PecuariaChartsSection
          charts={dadosPecuaria.charts}
          visibleCharts={secoesVisiveis.filter((item) => ["pesoLotes", "movimentosMes", "ocupacaoAreas", "categoriaLotes", "marcaAnimais"].includes(item))}
        />
      )}
      {secoesVisiveis.includes("insights_mapa") && <PecuariaInsightsPanel insights={dadosPecuaria.insights} />}
      {secoesVisiveis.includes("recentes_pecuaria") && <PecuariaRecentes pesagens={dadosPecuaria.recentes.pesagens} movimentacoes={dadosPecuaria.recentes.movimentacoes} />}

      {secoesVisiveis.includes("suplementacao") && dadosSuplementacao.pontosAtivos > 0 && (
        <Card className="shadow-sm border-l-4 border-l-emerald-500">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-900">Suplementação (30 dias)</CardTitle>
              <Link to={createPageUrl("DashboardSuplementacao")}>
                <Button variant="ghost" size="sm" className="h-7 text-xs">Ver detalhes</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="text-center">
                <div className="flex items-center justify-center mb-1">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-lg font-bold text-slate-900">{dadosSuplementacao.pontosAtivos}</div>
                <div className="text-xs text-slate-600">Pontos</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center mb-1">
                  <Package className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-lg font-bold text-slate-900">{dadosSuplementacao.totalFornecido.toFixed(0)} kg</div>
                <div className="text-xs text-slate-600">Fornecido</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center mb-1">
                  <Package className="w-4 h-4 text-purple-600" />
                </div>
                <div className="text-lg font-bold text-slate-900">{dadosSuplementacao.eventosCount}</div>
                <div className="text-xs text-slate-600">Lançamentos</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center mb-1">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                </div>
                <div className="text-lg font-bold text-amber-600">{dadosSuplementacao.alertas}</div>
                <div className="text-xs text-slate-600">Alertas</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {graficosVisiveis.includes("movimentacoes_mes") && (
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-900">Movimentações de estoque (6 meses)</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-2">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dadosGraficos.movimentacoesMes}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="entradas" fill="#10b981" name="Entradas" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="saidas" fill="#ef4444" name="Saídas" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {graficosVisiveis.includes("estoque_categoria") && (
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-900">Estoque por categoria</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-2">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={dadosGraficos.estoquePorCategoria}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    outerRadius={70}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {dadosGraficos.estoquePorCategoria.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CORES[index % CORES.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showConfigGraficos} onOpenChange={setShowConfigGraficos}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Painel</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">Seções do painel</div>
              <div className="space-y-1.5">
                {[
                  ["resumo_pecuaria", "Resumo executivo da pecuária"],
                  ["graficos_pecuaria", "Gráficos da pecuária"],
                  ["insights_mapa", "Insights do mapa e manejo"],
                  ["recentes_pecuaria", "Tabelas recentes"],
                  ["suplementacao", "Card de suplementação"],
                ].map(([id, label]) => (
                  <div key={id} className="flex items-center space-x-2 p-1.5 hover:bg-slate-50 rounded">
                    <Checkbox checked={secoesVisiveis.includes(id)} onCheckedChange={() => toggleSecao(id)} />
                    <label className="cursor-pointer flex-1 text-xs" onClick={() => toggleSecao(id)}>{label}</label>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">Gráficos de estoque</div>
              <div className="space-y-1.5">
                <div className="flex items-center space-x-2 p-1.5 hover:bg-slate-50 rounded">
                  <Checkbox checked={graficosVisiveis.includes("movimentacoes_mes")} onCheckedChange={() => toggleGrafico("movimentacoes_mes")} />
                  <label className="cursor-pointer flex-1 text-xs" onClick={() => toggleGrafico("movimentacoes_mes")}>
                    Movimentações de Estoque
                  </label>
                </div>
                <div className="flex items-center space-x-2 p-1.5 hover:bg-slate-50 rounded">
                  <Checkbox checked={graficosVisiveis.includes("estoque_categoria")} onCheckedChange={() => toggleGrafico("estoque_categoria")} />
                  <label className="cursor-pointer flex-1 text-xs" onClick={() => toggleGrafico("estoque_categoria")}>
                    Estoque por Categoria
                  </label>
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">Gráficos da pecuária</div>
              <div className="space-y-1.5">
                {[
                  ["pesoLotes", "Peso médio por lote"],
                  ["movimentosMes", "Movimentação pecuária por mês"],
                  ["ocupacaoAreas", "Ocupação das áreas"],
                  ["categoriaLotes", "Composição do rebanho"],
                  ["marcaAnimais", "Estoque por marca"],
                ].map(([id, label]) => (
                  <div key={id} className="flex items-center space-x-2 p-1.5 hover:bg-slate-50 rounded">
                    <Checkbox checked={secoesVisiveis.includes(id)} onCheckedChange={() => toggleSecao(id)} />
                    <label className="cursor-pointer flex-1 text-xs" onClick={() => toggleSecao(id)}>{label}</label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}