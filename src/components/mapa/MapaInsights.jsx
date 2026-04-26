import React, { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingUp, Beef, MapPin, Droplets, BarChart3, Scale, Target } from "lucide-react";
import { fmtNum, fmtHa, fmtKg } from "../common/formatNumber";

export default function MapaInsights({ lotes, areas, eventosSupl, pontosSuplementacao, pontosReferencia = [] }) {
  const insights = useMemo(() => {
    const result = [];

    const totalCabecas = lotes.reduce((sum, l) => sum + (l.quantidade_cabecas || 0), 0);
    const totalAreas = areas.length;
    const areasComLotes = new Set(lotes.map((l) => l.area_atual_id).filter(Boolean)).size;
    const areasVazias = totalAreas - areasComLotes;

    const porIdentificador = {};
    const porSexo = {};
    const porSetor = {};

    lotes.forEach((lote) => {
      const qtd = lote.quantidade_cabecas || 0;
      const identificador = lote.identificador_nome || lote.identificador_sigla || 'Sem identificador';
      const sexo = lote.sexo || 'Sem sexo';
      const setor = lote.setor_nome || 'Sem setor';

      porIdentificador[identificador] = (porIdentificador[identificador] || 0) + qtd;
      porSexo[sexo] = (porSexo[sexo] || 0) + qtd;
      porSetor[setor] = (porSetor[setor] || 0) + qtd;
    });

    result.push({
      tipo: 'resumo',
      icone: BarChart3,
      cor: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      titulo: 'Resumo Geral',
      valores: [
        { label: 'Qtd. Animais', valor: totalCabecas },
        { label: 'Áreas', valor: totalAreas },
        { label: 'Áreas Ocupadas', valor: areasComLotes },
        { label: 'Áreas Vazias', valor: areasVazias },
      ]
    });

    result.push({
      tipo: 'identificador',
      icone: TrendingUp,
      cor: 'text-indigo-700 bg-indigo-50 border-indigo-200',
      titulo: 'Resumo por Identificador',
      lista: Object.entries(porIdentificador).sort((a, b) => b[1] - a[1]).map(([nome, qtd]) => `${nome}: ${qtd} cab`)
    });

    result.push({
      tipo: 'sexo',
      icone: Beef,
      cor: 'text-sky-700 bg-sky-50 border-sky-200',
      titulo: 'Resumo por Sexo',
      lista: Object.entries(porSexo).sort((a, b) => b[1] - a[1]).map(([nome, qtd]) => `${nome}: ${qtd} cab`)
    });

    result.push({
      tipo: 'setor',
      icone: MapPin,
      cor: 'text-violet-700 bg-violet-50 border-violet-200',
      titulo: 'Resumo por Setor',
      lista: Object.entries(porSetor).sort((a, b) => a[0].localeCompare(b[0])).map(([nome, qtd]) => `${nome}: ${qtd} cab`)
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

    // Alertas inteligentes de suplementação
    const pontosAtivos = pontosSuplementacao.filter(p => p.status === 'Ativo');
    const pontosComAlerta = [];
    const lotesComAlertaSuplementacao = [];

    lotes.forEach((lote) => {
      const alertaSuplementacao = (lote.alertas || []).find((alerta) => alerta.tipo === 'suplementacao_pendente');
      if (alertaSuplementacao) {
        lotesComAlertaSuplementacao.push(`${lote.nome}: ${alertaSuplementacao.titulo}`);
      }
    });

    pontosAtivos.forEach((ponto) => {
      const alertas = ponto.alertas_inteligentes || [];
      alertas.forEach((alerta) => {
        pontosComAlerta.push({ nome: ponto.nome_ponto || ponto.nome, descricao: alerta.descricao || alerta.titulo, tipo: alerta.tipo });
      });
    });

    if (lotesComAlertaSuplementacao.length > 0) {
      result.push({
        tipo: 'alerta_lote_supl',
        icone: AlertTriangle,
        cor: 'text-red-700 bg-red-50 border-red-200',
        titulo: `Lotes Precisando de Suplementação (${lotesComAlertaSuplementacao.length})`,
        lista: lotesComAlertaSuplementacao.slice(0, 12)
      });
    }

    if (pontosComAlerta.length > 0) {
      result.push({
        tipo: 'alerta_supl',
        icone: Droplets,
        cor: 'text-amber-700 bg-amber-50 border-amber-200',
        titulo: `Alertas de Cochos e Depósitos (${pontosComAlerta.length})`,
        lista: pontosComAlerta.slice(0, 12).map(p => `${p.nome}: ${p.descricao}`)
      });
    }

    const pontosSemSuplementacao = areas.filter((area) => {
      const possuiPonto = pontosAtivos.some((ponto) => {
        const ids = [
          ponto.area_vinculada_id,
          ...(ponto.area_vinculada_ids || []),
          ponto.area_id
        ].filter(Boolean);
        return ids.includes(area.id);
      });
      return !possuiPonto;
    });

    result.push({
      tipo: 'pontos_sem_suplementacao',
      icone: MapPin,
      cor: 'text-slate-600 bg-slate-50 border-slate-200',
      titulo: `Pontos sem Suplementação (${pontosSemSuplementacao.length})`,
      lista: pontosSemSuplementacao.map((area) => area.nome)
    });

    if (pontosComAlerta.length > 0) {
      result.push({
        tipo: 'pontos_alerta',
        icone: AlertTriangle,
        cor: 'text-red-700 bg-red-50 border-red-200',
        titulo: `Pontos de Alerta (${pontosComAlerta.length})`,
        lista: pontosComAlerta.map((p) => `${p.nome}: ${p.descricao}`)
      });
    }

    const depositosSaldo = pontosAtivos
      .filter((ponto) => ponto.categoria_ponto === 'DEPOSITO')
      .filter((ponto) => Array.isArray(ponto.alertas_inteligentes) && ponto.alertas_inteligentes.some((alerta) => ['deposito_sem_saldo', 'deposito_baixo', 'reposicao_deposito'].includes(alerta.tipo)));

    if (depositosSaldo.length > 0) {
      result.push({
        tipo: 'depositos_saldo',
        icone: Droplets,
        cor: 'text-amber-700 bg-amber-50 border-amber-200',
        titulo: `Atualização Saldo Depósitos (${depositosSaldo.length})`,
        lista: depositosSaldo.map((deposito) => deposito.nome_ponto || deposito.nome)
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

      const comCapacidade = analiseAreas.filter((a) => a.capacidadeMaxUA > 0);
      if (comCapacidade.length > 0) {
        result.push({
          tipo: 'lotacao',
          icone: Target,
          cor: 'text-blue-700 bg-blue-50 border-blue-200',
          titulo: 'Lotação',
          valores: [
            { label: 'Lotação Ideal', valor: areasIdeais },
            { label: 'Baixa Lotação', valor: areasBaixaLotacao },
            { label: 'Superlotação', valor: areasSuperlotadas },
            { label: 'Utilização', valor: percentGeral !== null ? fmtNum(percentGeral, 0) + '%' : '-' }
          ]
        });
      }

      const uaPorPastoSetor = [...comGado]
        .sort((a, b) => {
          const setorA = areas.find((area) => area.nome === a.nome)?.setor_nome || '';
          const setorB = areas.find((area) => area.nome === b.nome)?.setor_nome || '';
          if (setorA !== setorB) return setorA.localeCompare(setorB);
          return a.nome.localeCompare(b.nome);
        })
        .map((a) => {
          const areaRef = areas.find((area) => area.nome === a.nome);
          const setorNome = areaRef?.setor_nome || 'Sem setor';
          return `${setorNome} • ${a.nome}: ${fmtNum(a.ua, 1)} UA`;
        });

      result.push({
        tipo: 'ua_por_pasto',
        icone: Scale,
        cor: 'text-violet-700 bg-violet-50 border-violet-200',
        titulo: 'UA por Pasto',
        lista: uaPorPastoSetor
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
          <Card key={idx} className={`border ${insight.cor.split(' ').slice(1).join(' ')} shadow-sm block`}>
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