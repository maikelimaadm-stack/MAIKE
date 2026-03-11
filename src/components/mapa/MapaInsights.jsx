import React, { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingUp, Beef, MapPin, Droplets, BarChart3 } from "lucide-react";

export default function MapaInsights({ lotes, areas, eventosSupl, pontosSuplementacao, pontosReferencia = [] }) {
  const insights = useMemo(() => {
    const result = [];

    // Total geral
    const totalCabecas = lotes.reduce((sum, l) => sum + (l.quantidade_cabecas || 0), 0);
    const totalAreas = areas.length;
    const areasComLotes = new Set(lotes.map(l => l.area_atual_id).filter(Boolean)).size;
    const areasVazias = totalAreas - areasComLotes;

    result.push({
      tipo: 'resumo',
      icone: BarChart3,
      cor: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      titulo: 'Resumo Geral',
      valores: [
        { label: 'Total Cabeças', valor: totalCabecas },
        { label: 'Áreas', valor: totalAreas },
        { label: 'Áreas Ocupadas', valor: areasComLotes },
        { label: 'Áreas Vazias', valor: areasVazias },
      ]
    });

    // Lotação por área (UA/ha)
    const lotacoes = [];
    const lotesPorArea = {};
    lotes.forEach(l => {
      if (!l.area_atual_id) return;
      if (!lotesPorArea[l.area_atual_id]) lotesPorArea[l.area_atual_id] = [];
      lotesPorArea[l.area_atual_id].push(l);
    });

    Object.entries(lotesPorArea).forEach(([areaId, lotesArea]) => {
      const area = areas.find(a => a.id === areaId);
      if (!area) return;
      const ha = area.tamanho_hectares || 0;
      const cabecas = lotesArea.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
      if (ha > 0) {
        lotacoes.push({ nome: area.nome, cabecas, ha, lotacao: (cabecas / ha).toFixed(2) });
      }
    });

    if (lotacoes.length > 0) {
      const lotacaoMedia = lotacoes.reduce((s, l) => s + parseFloat(l.lotacao), 0) / lotacoes.length;
      const areasMaisLotadas = lotacoes.sort((a, b) => parseFloat(b.lotacao) - parseFloat(a.lotacao)).slice(0, 3);

      result.push({
        tipo: 'lotacao',
        icone: Beef,
        cor: 'text-orange-700 bg-orange-50 border-orange-200',
        titulo: 'Lotação (cab/ha)',
        texto: `Média: ${lotacaoMedia.toFixed(2)} cab/ha`,
        lista: areasMaisLotadas.map(a => `${a.nome}: ${a.lotacao} cab/ha (${a.cabecas} cab)`)
      });
    }

    // Alertas de suplementação
    const pontosAtivos = pontosSuplementacao.filter(p => p.status === 'Ativo');
    const pontosComAlerta = [];

    pontosAtivos.forEach(ponto => {
      const eventosPonto = eventosSupl.filter(e => e.ponto_suplementacao_id === ponto.id);
      if (eventosPonto.length === 0) {
        pontosComAlerta.push({ nome: ponto.nome_ponto, dias: 'Nunca lançado', tipo: 'critico' });
        return;
      }
      const ultimo = eventosPonto.sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0];
      const dias = Math.floor((new Date() - new Date(ultimo.data_lancamento)) / (1000 * 60 * 60 * 24));
      const limite = ponto.alerta_sem_lancamento_dias || 10;
      if (dias > limite) {
        pontosComAlerta.push({ nome: ponto.nome_ponto, dias: `${dias} dias sem lançamento`, tipo: dias > limite * 2 ? 'critico' : 'alerta' });
      }
    });

    if (pontosComAlerta.length > 0) {
      result.push({
        tipo: 'alerta_supl',
        icone: Droplets,
        cor: 'text-amber-700 bg-amber-50 border-amber-200',
        titulo: `Alertas Suplementação (${pontosComAlerta.length})`,
        lista: pontosComAlerta.map(p => `${p.nome}: ${p.dias}`)
      });
    }

    // Áreas vazias
    if (areasVazias > 0) {
      const areasVaziasList = areas.filter(a => !lotesPorArea[a.id]);
      result.push({
        tipo: 'areas_vazias',
        icone: MapPin,
        cor: 'text-slate-600 bg-slate-50 border-slate-200',
        titulo: `Áreas Vazias (${areasVazias})`,
        lista: areasVaziasList.slice(0, 5).map(a => a.nome)
      });
    }

    // Pontos de referência
    if (pontosReferencia.length > 0) {
      const tiposPontos = {};
      pontosReferencia.forEach(p => {
        const tipo = p.tipo || 'Sem tipo';
        tiposPontos[tipo] = (tiposPontos[tipo] || 0) + 1;
      });
      result.push({
        tipo: 'pontos_ref',
        icone: MapPin,
        cor: 'text-indigo-700 bg-indigo-50 border-indigo-200',
        titulo: `Pontos de Referência (${pontosReferencia.length})`,
        lista: Object.entries(tiposPontos).sort((a, b) => b[1] - a[1]).map(([t, q]) => `${t}: ${q}`)
      });
    }

    // Cochos / Pontos de suplementação - resumo
    if (pontosAtivos.length > 0) {
      const cochosPorArea = {};
      pontosAtivos.forEach(p => {
        const nome = p.area_nome || 'Sem área';
        cochosPorArea[nome] = (cochosPorArea[nome] || 0) + 1;
      });
      result.push({
        tipo: 'cochos',
        icone: Droplets,
        cor: 'text-teal-700 bg-teal-50 border-teal-200',
        titulo: `Cochos Ativos (${pontosAtivos.length})`,
        texto: `${pontosComAlerta.length} com alertas`,
        lista: Object.entries(cochosPorArea).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, q]) => `${a}: ${q} cochos`)
      });
    }

    // Peso médio por categoria
    const pesosPorCategoria = {};
    lotes.forEach(l => {
      if (!l.peso_medio_kg) return;
      const cat = l.categoria || 'Sem categoria';
      if (!pesosPorCategoria[cat]) pesosPorCategoria[cat] = { total: 0, count: 0, cabecas: 0 };
      pesosPorCategoria[cat].total += l.peso_medio_kg * (l.quantidade_cabecas || 1);
      pesosPorCategoria[cat].cabecas += (l.quantidade_cabecas || 1);
      pesosPorCategoria[cat].count++;
    });
    const pesosOrdenados = Object.entries(pesosPorCategoria).map(([cat, d]) => ({
      cat, pesoMedio: (d.total / d.cabecas).toFixed(1), cabecas: d.cabecas
    })).sort((a, b) => parseFloat(b.pesoMedio) - parseFloat(a.pesoMedio));
    if (pesosOrdenados.length > 0) {
      result.push({
        tipo: 'pesos',
        icone: TrendingUp,
        cor: 'text-purple-700 bg-purple-50 border-purple-200',
        titulo: 'Peso Médio por Categoria',
        lista: pesosOrdenados.map(p => `${p.cat}: ${p.pesoMedio} kg (${p.cabecas} cab)`)
      });
    }

    // Categorias em campo
    const categoriasCounts = {};
    lotes.forEach(l => {
      const cat = l.categoria || 'Sem categoria';
      categoriasCounts[cat] = (categoriasCounts[cat] || 0) + (l.quantidade_cabecas || 0);
    });

    const categoriasOrdenadas = Object.entries(categoriasCounts).sort((a, b) => b[1] - a[1]);
    if (categoriasOrdenadas.length > 0) {
      result.push({
        tipo: 'categorias',
        icone: TrendingUp,
        cor: 'text-blue-700 bg-blue-50 border-blue-200',
        titulo: 'Categorias em Campo',
        lista: categoriasOrdenadas.map(([cat, qtd]) => `${cat}: ${qtd} cab`)
      });
    }

    return result;
  }, [lotes, areas, eventosSupl, pontosSuplementacao]);

  return (
    <div className="space-y-2 max-h-[70vh] overflow-y-auto">
      {insights.map((insight, idx) => {
        const Icon = insight.icone;
        return (
          <Card key={idx} className={`border ${insight.cor.split(' ').slice(1).join(' ')} shadow-sm`}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${insight.cor.split(' ')[0]}`} />
                <span className="text-xs font-bold text-slate-900">{insight.titulo}</span>
              </div>

              {insight.valores && (
                <div className="grid grid-cols-2 gap-2">
                  {insight.valores.map((v, i) => (
                    <div key={i} className="text-center p-1.5 bg-white/70 rounded">
                      <div className="text-lg font-bold text-slate-900">{v.valor}</div>
                      <div className="text-[10px] text-slate-600">{v.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {insight.texto && (
                <div className="text-xs font-semibold text-slate-700 mb-1">{insight.texto}</div>
              )}

              {insight.lista && (
                <div className="space-y-1">
                  {insight.lista.map((item, i) => (
                    <div key={i} className="text-[11px] text-slate-700 flex items-start gap-1.5">
                      <span className="text-slate-400 mt-0.5">•</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}