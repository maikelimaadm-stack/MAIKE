import React, { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingUp, Beef, MapPin, Droplets, BarChart3, Scale, Target, ArrowDown, ArrowUp, Leaf, Clock, Sprout, Flame } from "lucide-react";
import { fmtNum, fmtHa, fmtKg } from "../common/formatNumber";

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
      // Usa área efetiva (pastejada) se disponível, senão área total
      const ha = (area.area_pastejada && area.area_pastejada > 0) ? area.area_pastejada : (area.tamanho_hectares || 0);
      const cabecas = lotesArea.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
      if (ha > 0) {
        lotacoes.push({ nome: area.nome, cabecas, ha, lotacao: fmtNum(cabecas / ha, 2) });
      }
    });

    if (lotacoes.length > 0) {
      const lotacaoMediaRaw = lotacoes.reduce((s, l) => s + (l.cabecas / l.ha), 0) / lotacoes.length;
      const areasMaisLotadas = [...lotacoes].sort((a, b) => (b.cabecas / b.ha) - (a.cabecas / a.ha)).slice(0, 3);

      result.push({
        tipo: 'lotacao',
        icone: Beef,
        cor: 'text-orange-700 bg-orange-50 border-orange-200',
        titulo: 'Lotação (cab/ha)',
        texto: `Média: ${fmtNum(lotacaoMediaRaw, 2)} cab/ha`,
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
      cat, pesoMedio: d.total / d.cabecas, cabecas: d.cabecas
    })).sort((a, b) => b.pesoMedio - a.pesoMedio);
    if (pesosOrdenados.length > 0) {
      result.push({
        tipo: 'pesos',
        icone: TrendingUp,
        cor: 'text-purple-700 bg-purple-50 border-purple-200',
        titulo: 'Peso Médio por Categoria',
        lista: pesosOrdenados.map(p => `${p.cat}: ${fmtNum(p.pesoMedio, 1)} kg (${fmtNum(p.cabecas)} cab)`)
      });
    }

    // ─── Análise de Lotação e Manejo da Pastagem ───
    // 1 UA = 450 kg PV (padrão Embrapa)
    // UA do animal = peso médio / 450
    // UA total do lote = UA individual × quantidade de animais
    // UA total do pasto = soma de todas as UA dos lotes no pasto
    // Taxa de lotação = UA total do pasto / área efetiva (ha)
    // Capacidade do pasto = área (ha) × capacidade de suporte (UA/ha) → campo capacidade_maxima
    // Percentual de utilização = (UA atual / capacidade máxima) × 100

    const analiseAreas = [];
    let totalUA = 0;
    let totalCapacidade = 0;
    let areasSuperlotadas = 0;
    let areasBaixaLotacao = 0;
    let areasIdeais = 0;

    // Incluir TODAS as áreas (com e sem lotes) para análise completa
    areas.forEach(area => {
      const haEfetiva = (area.area_pastejada && area.area_pastejada > 0) ? area.area_pastejada : (area.tamanho_hectares || 0);
      const lotesArea = lotesPorArea[area.id] || [];
      
      // Calcular UA total do pasto
      let uaArea = 0;
      lotesArea.forEach(l => {
        const pesoMedio = l.peso_medio_kg || 0;
        const qtd = l.quantidade_cabecas || 0;
        const uaIndividual = pesoMedio / 450;
        uaArea += uaIndividual * qtd;
      });
      totalUA += uaArea;

      const cabTotal = lotesArea.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
      const taxaLotacao = haEfetiva > 0 ? uaArea / haEfetiva : 0;
      
      // Capacidade de suporte: campo capacidade_maxima (em UA)
      const capacidadeMaxUA = area.capacidade_maxima || 0;
      totalCapacidade += capacidadeMaxUA;

      // Percentual de utilização
      const percentUtil = capacidadeMaxUA > 0 ? (uaArea / capacidadeMaxUA) * 100 : null;
      const uaDisponivel = capacidadeMaxUA > 0 ? capacidadeMaxUA - uaArea : null;

      // Classificação de manejo
      let classificacao = 'sem_dados';
      if (capacidadeMaxUA > 0) {
        if (percentUtil <= 70) { classificacao = 'baixa'; areasBaixaLotacao++; }
        else if (percentUtil <= 110) { classificacao = 'ideal'; areasIdeais++; }
        else { classificacao = 'superlotacao'; areasSuperlotadas++; }
      } else if (lotesArea.length > 0) {
        classificacao = 'sem_capacidade';
      }

      analiseAreas.push({
        nome: area.nome,
        ua: uaArea,
        ha: haEfetiva,
        taxaLotacao,
        cabecas: cabTotal,
        capacidadeMaxUA,
        percentUtil,
        uaDisponivel,
        classificacao,
      });
    });

    if (analiseAreas.some(a => a.ua > 0 || a.capacidadeMaxUA > 0)) {
      const comGado = analiseAreas.filter(a => a.ua > 0);
      const comHa = comGado.filter(a => a.ha > 0);
      const uaHaMedia = comHa.length > 0 ? comHa.reduce((s, a) => s + a.taxaLotacao, 0) / comHa.length : 0;
      const percentGeral = totalCapacidade > 0 ? (totalUA / totalCapacidade) * 100 : null;

      result.push({
        tipo: 'ua_total',
        icone: Scale,
        cor: 'text-violet-700 bg-violet-50 border-violet-200',
        titulo: `Unidade Animal (1 UA = 450 kg PV)`,
        texto: `Taxa média: ${fmtNum(uaHaMedia, 2)} UA/ha${percentGeral !== null ? `  •  Utilização geral: ${fmtNum(percentGeral, 0)}%` : ''}`,
        valores: [
          { label: 'UA Total', valor: fmtNum(totalUA, 1) },
          { label: 'Taxa Média UA/ha', valor: fmtNum(uaHaMedia, 2) },
          { label: 'Capacidade Total', valor: totalCapacidade > 0 ? fmtNum(totalCapacidade, 1) + ' UA' : 'N/I' },
          { label: 'Ha Efetivos', valor: fmtNum(comHa.reduce((s, a) => s + a.ha, 0), 0) },
        ]
      });

      // Card de análise de manejo
      const comCapacidade = analiseAreas.filter(a => a.capacidadeMaxUA > 0);
      if (comCapacidade.length > 0) {
        result.push({
          tipo: 'analise_manejo',
          icone: Target,
          cor: 'text-blue-700 bg-blue-50 border-blue-200',
          titulo: `Análise de Manejo (${comCapacidade.length} áreas)`,
          valores: [
            { label: '🟢 Lotação Ideal', valor: areasIdeais },
            { label: '🔵 Baixa Lotação', valor: areasBaixaLotacao },
            { label: '🔴 Superlotação', valor: areasSuperlotadas },
            { label: 'Utiliz. Geral', valor: percentGeral !== null ? fmtNum(percentGeral, 0) + '%' : '-' },
          ]
        });
      }

      // Áreas superlotadas (prioridade)
      const superlotadas = analiseAreas.filter(a => a.classificacao === 'superlotacao').sort((a, b) => b.percentUtil - a.percentUtil);
      if (superlotadas.length > 0) {
        result.push({
          tipo: 'superlotacao',
          icone: ArrowUp,
          cor: 'text-red-700 bg-red-50 border-red-200',
          titulo: `⚠ Superlotação (${superlotadas.length} áreas)`,
          texto: 'Risco de degradação! Reduzir animais ou aumentar área.',
          lista: superlotadas.map(a => 
            `${a.nome}: ${fmtNum(a.ua, 1)} / ${fmtNum(a.capacidadeMaxUA, 1)} UA (${fmtNum(a.percentUtil, 0)}%) — Excede ${fmtNum(Math.abs(a.uaDisponivel), 1)} UA`
          )
        });
      }

      // Áreas com baixa lotação
      const baixaLot = analiseAreas.filter(a => a.classificacao === 'baixa').sort((a, b) => a.percentUtil - b.percentUtil);
      if (baixaLot.length > 0) {
        result.push({
          tipo: 'baixa_lotacao',
          icone: ArrowDown,
          cor: 'text-sky-700 bg-sky-50 border-sky-200',
          titulo: `Baixa Lotação (${baixaLot.length} áreas)`,
          texto: 'Pastagem subutilizada. Pode receber mais animais.',
          lista: baixaLot.map(a => 
            `${a.nome}: ${fmtNum(a.ua, 1)} / ${fmtNum(a.capacidadeMaxUA, 1)} UA (${fmtNum(a.percentUtil, 0)}%) — Cabe mais ${fmtNum(a.uaDisponivel, 1)} UA`
          )
        });
      }

      // Áreas com lotação ideal
      const ideais = analiseAreas.filter(a => a.classificacao === 'ideal').sort((a, b) => b.percentUtil - a.percentUtil);
      if (ideais.length > 0) {
        result.push({
          tipo: 'lotacao_ideal',
          icone: Target,
          cor: 'text-green-700 bg-green-50 border-green-200',
          titulo: `✓ Lotação Ideal (${ideais.length} áreas)`,
          texto: 'Manejo equilibrado, pastagem bem aproveitada.',
          lista: ideais.map(a => 
            `${a.nome}: ${fmtNum(a.ua, 1)} / ${fmtNum(a.capacidadeMaxUA, 1)} UA (${fmtNum(a.percentUtil, 0)}%) — ${fmtNum(a.taxaLotacao, 2)} UA/ha`
          )
        });
      }

      // Lista completa de UA por pasto (todas com gado)
      const todosOrdenados = [...comGado].sort((a, b) => b.ua - a.ua);
      result.push({
        tipo: 'ua_por_pasto',
        icone: Scale,
        cor: 'text-violet-700 bg-violet-50 border-violet-200',
        titulo: `UA por Pasto (${todosOrdenados.length} áreas)`,
        lista: todosOrdenados.map(a => {
          const capStr = a.capacidadeMaxUA > 0 ? ` cap. ${fmtNum(a.capacidadeMaxUA, 0)} UA` : '';
          const percStr = a.percentUtil !== null ? ` ${fmtNum(a.percentUtil, 0)}%` : '';
          return `${a.nome}: ${fmtNum(a.ua, 1)} UA (${fmtNum(a.taxaLotacao, 2)} UA/ha)${capStr}${percStr} — ${fmtNum(a.cabecas)} cab`;
        })
      });

      // Áreas sem capacidade de suporte definida (aviso)
      const semCapacidade = analiseAreas.filter(a => a.ua > 0 && a.capacidadeMaxUA === 0);
      if (semCapacidade.length > 0) {
        result.push({
          tipo: 'sem_capacidade',
          icone: AlertTriangle,
          cor: 'text-amber-700 bg-amber-50 border-amber-200',
          titulo: `Sem Capacidade Definida (${semCapacidade.length})`,
          texto: 'Defina a capacidade máxima (UA) no cadastro da área para análise de manejo.',
          lista: semCapacidade.slice(0, 8).map(a => `${a.nome}: ${fmtNum(a.ua, 1)} UA, ${fmtNum(a.taxaLotacao, 2)} UA/ha`)
        });
      }
    }

    // ─── Análise de Forragem e Dias de Pastejo ───
    // Consumo diário por UA = 2,5% de 450 kg = 11,25 kg MS/dia
    const CONSUMO_DIARIO_UA = 11.25; // kg MS/dia

    // Estimativas padrão de forragem por classificação de aproveitamento
    const FORRAGEM_ESTIMADA = { 'Baixa': 1500, 'Média': 2500, 'Alta': 3500 };
    // Taxa de crescimento por período (kg MS/ha/dia)
    const CRESC_ESTIMADO = { 'Seco': 12, 'Intermediário': 30, 'Chuvoso': 55 };

    const analiseForragem = [];
    let totalConsumo = 0;
    let totalProducao = 0;

    areas.forEach(area => {
      if (area.tipo_cultura !== 'Pastagem') return;
      const lotesArea = lotesPorArea[area.id] || [];
      const haEfetiva = (area.area_pastejada > 0 ? area.area_pastejada : area.tamanho_hectares) || 0;
      if (haEfetiva <= 0) return;

      // UA do pasto
      let uaArea = 0;
      lotesArea.forEach(l => {
        uaArea += ((l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0)) / 450;
      });
      if (uaArea === 0) return; // Sem gado, não calcula

      // Consumo diário do rebanho
      const consumoDiario = uaArea * CONSUMO_DIARIO_UA;
      totalConsumo += consumoDiario;

      // Forragem disponível (kg MS/ha) — campo do usuário ou estimativa
      const forragemKgHa = area.forragem_kg_ha || FORRAGEM_ESTIMADA[area.aproveitamento_classificacao] || 2500;
      const forragemTotal = haEfetiva * forragemKgHa;

      // Taxa de aproveitamento (padrão 50%)
      const taxaAprov = (area.taxa_aproveitamento > 0 ? area.taxa_aproveitamento : 50) / 100;
      const forragemUtil = forragemTotal * taxaAprov;

      // Dias de pastejo = forragem utilizável / consumo diário
      const diasPastejo = consumoDiario > 0 ? forragemUtil / consumoDiario : 0;

      // Taxa de crescimento (kg MS/ha/dia)
      const crescKgHaDia = area.taxa_crescimento_kg_ha_dia || CRESC_ESTIMADO[area.periodo_estacao] || CRESC_ESTIMADO['Intermediário'];
      const producaoDiaria = haEfetiva * crescKgHaDia;
      totalProducao += producaoDiaria;

      // Balanço de forragem = produção - consumo
      const balanco = producaoDiaria - consumoDiario;
      const balancoPercent = consumoDiario > 0 ? (producaoDiaria / consumoDiario) * 100 : 0;

      // Classificação
      let situacao = 'equilibrado';
      if (balancoPercent >= 130) situacao = 'abundante';
      else if (balancoPercent >= 90) situacao = 'equilibrado';
      else if (balancoPercent >= 60) situacao = 'risco';
      else situacao = 'degradacao';

      // Data estimada de esgotamento (quando balanço negativo)
      let dataEsgotamento = null;
      if (balanco < 0 && forragemUtil > 0) {
        const diasRestantes = forragemUtil / Math.abs(balanco);
        const dt = new Date();
        dt.setDate(dt.getDate() + Math.floor(diasRestantes));
        dataEsgotamento = dt.toLocaleDateString('pt-BR');
      }

      const usaEstimativa = !area.forragem_kg_ha;

      analiseForragem.push({
        nome: area.nome,
        uaArea,
        ha: haEfetiva,
        consumoDiario,
        forragemKgHa,
        forragemTotal,
        forragemUtil,
        diasPastejo,
        producaoDiaria,
        crescKgHaDia,
        balanco,
        balancoPercent,
        situacao,
        dataEsgotamento,
        usaEstimativa,
        taxaAprov: taxaAprov * 100,
      });
    });

    if (analiseForragem.length > 0) {
      const balancoGeral = totalProducao - totalConsumo;

      // Card resumo geral de forragem
      result.push({
        tipo: 'forragem_resumo',
        icone: Leaf,
        cor: 'text-lime-700 bg-lime-50 border-lime-200',
        titulo: 'Forragem — Resumo Geral',
        texto: `Consumo: ${fmtNum(totalConsumo, 0)} kg MS/dia  •  Produção: ${fmtNum(totalProducao, 0)} kg MS/dia`,
        valores: [
          { label: 'Consumo/dia', valor: fmtNum(totalConsumo, 0) + ' kg' },
          { label: 'Produção/dia', valor: fmtNum(totalProducao, 0) + ' kg' },
          { label: 'Balanço/dia', valor: (balancoGeral >= 0 ? '+' : '') + fmtNum(balancoGeral, 0) + ' kg' },
          { label: 'Pastos Analisados', valor: analiseForragem.length },
        ]
      });

      // Dias de pastejo por pasto
      const ordenadosDias = [...analiseForragem].sort((a, b) => a.diasPastejo - b.diasPastejo);
      result.push({
        tipo: 'dias_pastejo',
        icone: Clock,
        cor: 'text-cyan-700 bg-cyan-50 border-cyan-200',
        titulo: `Dias de Pastejo Estimados`,
        texto: 'Quantos dias o pasto sustenta o rebanho atual (forragem utilizável ÷ consumo diário).',
        lista: ordenadosDias.map(a => {
          const badge = a.diasPastejo < 20 ? '🔴' : a.diasPastejo < 45 ? '🟡' : '🟢';
          const est = a.usaEstimativa ? ' *' : '';
          return `${badge} ${a.nome}: ${fmtNum(a.diasPastejo, 0)} dias (${fmtNum(a.consumoDiario, 0)} kg/dia, ${fmtNum(a.forragemKgHa, 0)} kg/ha${est})`;
        })
      });

      // Balanço de forragem por pasto (produção vs consumo)
      const abundantes = analiseForragem.filter(a => a.situacao === 'abundante');
      const equilibrados = analiseForragem.filter(a => a.situacao === 'equilibrado');
      const emRisco = analiseForragem.filter(a => a.situacao === 'risco');
      const emDegradacao = analiseForragem.filter(a => a.situacao === 'degradacao');

      result.push({
        tipo: 'balanco_forragem',
        icone: Sprout,
        cor: 'text-emerald-700 bg-emerald-50 border-emerald-200',
        titulo: `Balanço Forragem (${analiseForragem.length} pastos)`,
        valores: [
          { label: '🟢 Abundante', valor: abundantes.length },
          { label: '🟡 Equilibrado', valor: equilibrados.length },
          { label: '🟠 Risco', valor: emRisco.length },
          { label: '🔴 Degradação', valor: emDegradacao.length },
        ]
      });

      // Alertas: pastos em risco ou degradação
      const pastosAlerta = [...emDegradacao, ...emRisco].sort((a, b) => a.balancoPercent - b.balancoPercent);
      if (pastosAlerta.length > 0) {
        result.push({
          tipo: 'alerta_forragem',
          icone: Flame,
          cor: 'text-red-700 bg-red-50 border-red-200',
          titulo: `⚠ Atenção — Forragem Insuficiente (${pastosAlerta.length})`,
          texto: 'Consumo acima da produção de capim. Considerar rotação ou redução de lotação.',
          lista: pastosAlerta.map(a => {
            const defStr = fmtNum(Math.abs(a.balanco), 0);
            const dtStr = a.dataEsgotamento ? ` — Esgota em ${a.dataEsgotamento}` : '';
            return `${a.situacao === 'degradacao' ? '🔴' : '🟠'} ${a.nome}: déficit ${defStr} kg/dia (${fmtNum(a.balancoPercent, 0)}% da necessidade)${dtStr}`;
          })
        });
      }

      // Pastos com abundância (podem receber mais animais)
      if (abundantes.length > 0) {
        result.push({
          tipo: 'forragem_abundante',
          icone: Sprout,
          cor: 'text-green-700 bg-green-50 border-green-200',
          titulo: `✓ Forragem Abundante (${abundantes.length} pastos)`,
          texto: 'Produção de capim acima do consumo. Podem receber mais animais.',
          lista: abundantes.sort((a, b) => b.balancoPercent - a.balancoPercent).map(a =>
            `${a.nome}: +${fmtNum(a.balanco, 0)} kg/dia (produção ${fmtNum(a.balancoPercent, 0)}% do consumo)`
          )
        });
      }

      // Nota sobre estimativas
      const comEstimativa = analiseForragem.filter(a => a.usaEstimativa);
      if (comEstimativa.length > 0) {
        result.push({
          tipo: 'nota_forragem',
          icone: AlertTriangle,
          cor: 'text-slate-600 bg-slate-50 border-slate-200',
          titulo: `ℹ Estimativas de Forragem`,
          texto: `${comEstimativa.length} pasto(s) usam estimativas padrão. Para maior precisão, informe forragem (kg MS/ha), taxa de crescimento e período no cadastro da área.`,
        });
      }
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
        titulo: 'Categorias de Manejo em Campo',
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