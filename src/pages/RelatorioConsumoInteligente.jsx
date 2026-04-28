import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import RelatorioBase from "@/components/relatorios/RelatorioBase";
import { FiltroData, FiltroMultiplo, FiltroSelect, BotaoLimparFiltros } from "@/components/relatorios/FiltrosRelatorio";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const formatarNumero = (num, casas = 2) => Number(num || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

function calcularConsumoEsperadoKg(lote, produto) {
  const cabecas = Number(lote?.quantidade_cabecas || 0);
  const pesoMedio = Number(lote?.peso_medio_kg || 0);
  const percentualPv = Number(produto?.percentual_consumo_pv || 0);
  if (cabecas <= 0) return 0;
  if (percentualPv > 0 && pesoMedio > 0) return cabecas * pesoMedio * (percentualPv / 100);
  if (produto?.tipo_consumo === 'CONSUMO_DIARIO' && produto?.consumo_minimo_pv && pesoMedio > 0) return cabecas * pesoMedio * (Number(produto.consumo_minimo_pv) / 100);
  return 0;
}

function classificarStatus({ eficiencia, saldo, estoqueMinimo, diasRestantes }) {
  if (estoqueMinimo > 0 && saldo <= estoqueMinimo) return { status: 'critico', alerta: 'ESTOQUE ABAIXO DO MÍNIMO' };
  if (eficiencia > 120 || (eficiencia > 0 && eficiencia < 80)) return { status: 'atencao', alerta: 'CONSUMO FORA DO PADRÃO' };
  if (diasRestantes > 0 && diasRestantes <= 3) return { status: 'atencao', alerta: 'BAIXA COBERTURA DE ESTOQUE' };
  return { status: 'normal', alerta: 'OPERAÇÃO DENTRO DO PADRÃO' };
}

const statusBadgeClass = {
  critico: "bg-red-100 text-red-700 border-red-200",
  atencao: "bg-amber-100 text-amber-700 border-amber-200",
  normal: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export default function RelatorioConsumoInteligente() {
  const empresaId = localStorage.getItem('empresa_selecionada_id');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [lotesSelecionados, setLotesSelecionados] = useState([]);
  const [statusSelecionados, setStatusSelecionados] = useState([]);
  const [ordenacao, setOrdenacao] = useState('data_desc');

  const { data: empresaAtual } = useQuery({
    queryKey: ['empresa-relatorio-consumo-inteligente', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Empresa.list();
      return all.find((item) => item.id === empresaId) || null;
    },
    enabled: !!empresaId,
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes-relatorio-consumo-inteligente', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((item) => item.empresa_id === empresaId && item.status === 'Ativo');
    },
    enabled: !!empresaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-relatorio-consumo-inteligente', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((item) => item.empresa_id === empresaId && item.ativo !== false);
    },
    enabled: !!empresaId,
  });

  const { data: pontos = [] } = useQuery({
    queryKey: ['pontos-relatorio-consumo-inteligente', empresaId],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter((item) => item.empresa_id === empresaId && item.status === 'Ativo');
    },
    enabled: !!empresaId,
  });

  const { data: eventos = [] } = useQuery({
    queryKey: ['eventos-relatorio-consumo-inteligente', empresaId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list('-data_lancamento', 1000);
      return all.filter((item) => item.empresa_id === empresaId);
    },
    enabled: !!empresaId,
  });

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['movimentacoes-relatorio-consumo-inteligente', empresaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list('-data_movimentacao', 1000);
      return all.filter((item) => item.empresa_id === empresaId && item.status === 'Ativa');
    },
    enabled: !!empresaId,
  });

  const produtosMap = useMemo(() => new Map(produtos.map((item) => [item.id, item])), [produtos]);
  const pontosMap = useMemo(() => new Map(pontos.map((item) => [item.id, item])), [pontos]);
  const depositos = useMemo(() => pontos.filter((item) => item.categoria_ponto === 'DEPOSITO'), [pontos]);
  const cochos = useMemo(() => pontos.filter((item) => item.categoria_ponto !== 'DEPOSITO'), [pontos]);

  const linhas = useMemo(() => {
    const eventosFiltrados = eventos.filter((evento) => {
      const dataBase = evento.data_lancamento || evento.created_date;
      if (dataInicio && new Date(dataBase) < new Date(dataInicio)) return false;
      if (dataFim) {
        const limite = new Date(dataFim);
        limite.setHours(23, 59, 59, 999);
        if (new Date(dataBase) > limite) return false;
      }
      return true;
    });

    return eventosFiltrados.map((evento) => {
      const produto = produtosMap.get(evento.produto_id) || produtos.find((item) => item.nome_produto === evento.produto);
      const ponto = pontosMap.get(evento.ponto_suplementacao_id);
      const lote = lotes.find((item) => evento.lote_id && item.id === evento.lote_id);
      const consumoRealizado = Number(evento.quantidade_total_kg || 0);
      const consumoEsperado = calcularConsumoEsperadoKg(lote, produto);
      const eficiencia = consumoEsperado > 0 ? (consumoRealizado / consumoEsperado) * 100 : 0;
      const saldoPonto = movimentacoes
        .filter((mov) => mov.ponto_suplementacao_id === evento.ponto_suplementacao_id || mov.local_destino === ponto?.nome_ponto || mov.local_origem === ponto?.nome_ponto)
        .reduce((acc, mov) => {
          if (mov.tipo_movimentacao === 'Entrada') return acc + Number(mov.quantidade || 0);
          if (mov.tipo_movimentacao === 'Saída') return acc - Number(mov.quantidade || 0);
          return acc;
        }, 0);
      const diasRestantes = consumoRealizado > 0 ? saldoPonto / consumoRealizado : 0;
      const estoqueMinimo = Number(ponto?.estoque_minimo_kg || 0);
      const classificacao = classificarStatus({ eficiencia, saldo: saldoPonto, estoqueMinimo, diasRestantes });

      return {
        id: evento.id,
        lote_nome: lote?.nome || lote?.identificador_nome || 'GERAL',
        cabecas: Number(lote?.quantidade_cabecas || evento.total_cabecas_afetadas || 0),
        peso_medio: Number(lote?.peso_medio_kg || 0),
        produto_nome: produto?.nome_produto || evento.produto || '-',
        cocho_nome: ponto?.nome_ponto || evento.ponto_nome || '-',
        deposito_nome: ponto?.deposito_origem_nome || '-',
        esperado: consumoEsperado,
        realizado: consumoRealizado,
        eficiencia,
        saldo: saldoPonto,
        dias_restantes: diasRestantes,
        estoque_minimo: estoqueMinimo,
        status: classificacao.status,
        alerta: classificacao.alerta,
      };
    }).filter((linha) => {
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(linha.produto_nome)) return false;
      if (lotesSelecionados.length > 0 && !lotesSelecionados.includes(linha.lote_nome)) return false;
      if (statusSelecionados.length > 0 && !statusSelecionados.includes(linha.status)) return false;
      return true;
    }).sort((a, b) => {
      switch (ordenacao) {
        case 'eficiencia_desc': return b.eficiencia - a.eficiencia;
        case 'eficiencia_asc': return a.eficiencia - b.eficiencia;
        case 'realizado_desc': return b.realizado - a.realizado;
        default: return b.realizado - a.realizado;
      }
    });
  }, [eventos, dataInicio, dataFim, produtosMap, produtos, pontosMap, lotes, movimentacoes, produtosSelecionados, lotesSelecionados, statusSelecionados, ordenacao]);

  const produtosOpcoes = useMemo(() => [...new Set(linhas.map((item) => item.produto_nome))].filter(Boolean).sort(), [linhas]);
  const lotesOpcoes = useMemo(() => [...new Set(linhas.map((item) => item.lote_nome))].filter(Boolean).sort(), [linhas]);
  const statusOpcoes = ['normal', 'atencao', 'critico'];

  const totais = useMemo(() => ({
    registros: linhas.length,
    esperado: linhas.reduce((acc, item) => acc + item.esperado, 0),
    realizado: linhas.reduce((acc, item) => acc + item.realizado, 0),
    criticos: linhas.filter((item) => item.status === 'critico').length,
  }), [linhas]);

  const analiseLotes = useMemo(() => {
    const mapa = new Map();
    linhas.forEach((linha) => {
      if (!mapa.has(linha.lote_nome)) {
        mapa.set(linha.lote_nome, { lote_nome: linha.lote_nome, cabecas: linha.cabecas, peso_medio: linha.peso_medio, esperado: 0, realizado: 0, alertas: [] });
      }
      const item = mapa.get(linha.lote_nome);
      item.esperado += linha.esperado;
      item.realizado += linha.realizado;
      if (linha.status !== 'normal') item.alertas.push(linha.alerta);
    });
    return Array.from(mapa.values()).map((item) => ({
      ...item,
      eficiencia: item.esperado > 0 ? (item.realizado / item.esperado) * 100 : 0,
      observacao: item.alertas[0] || 'Sem ocorrências relevantes no período'
    }));
  }, [linhas]);

  const consumoProdutos = useMemo(() => {
    const mapa = new Map();
    linhas.forEach((linha) => {
      if (!mapa.has(linha.produto_nome)) mapa.set(linha.produto_nome, { produto_nome: linha.produto_nome, esperado: 0, realizado: 0 });
      const item = mapa.get(linha.produto_nome);
      item.esperado += linha.esperado;
      item.realizado += linha.realizado;
    });
    return Array.from(mapa.values()).map((item) => {
      const eficiencia = item.esperado > 0 ? (item.realizado / item.esperado) * 100 : 0;
      return {
        ...item,
        eficiencia,
        situacao: eficiencia > 120 ? 'Acima do ideal' : eficiencia > 0 && eficiencia < 80 ? 'Abaixo do ideal' : 'Dentro do ideal'
      };
    });
  }, [linhas]);

  const situacaoCochos = useMemo(() => {
    return cochos.map((cocho) => {
      const linhasCocho = linhas.filter((linha) => linha.cocho_nome === cocho.nome_ponto);
      const consumoMedio = linhasCocho.reduce((acc, item) => acc + item.realizado, 0) / (linhasCocho.length || 1);
      const saldo = linhasCocho.length ? linhasCocho[0].saldo : 0;
      const diasRestantes = consumoMedio > 0 ? saldo / consumoMedio : 0;
      const classificacao = classificarStatus({ eficiencia: 100, saldo, estoqueMinimo: Number(cocho.estoque_minimo_kg || 0), diasRestantes });
      return { nome: cocho.nome_ponto, saldo, consumoMedio, diasRestantes, alerta: classificacao.alerta, status: classificacao.status };
    });
  }, [cochos, linhas]);

  const situacaoDepositos = useMemo(() => {
    return depositos.map((deposito) => {
      const saldo = movimentacoes
        .filter((mov) => mov.deposito_id === deposito.id || mov.local_destino === deposito.nome_ponto || mov.local_origem === deposito.nome_ponto)
        .reduce((acc, mov) => {
          if (mov.tipo_movimentacao === 'Entrada') return acc + Number(mov.quantidade || 0);
          if (mov.tipo_movimentacao === 'Saída') return acc - Number(mov.quantidade || 0);
          return acc;
        }, 0);
      const estoqueMinimo = Number(deposito.estoque_minimo_kg || 0);
      return {
        nome: deposito.nome_ponto,
        saldo,
        estoqueMinimo,
        necessidadeReposicao: saldo < estoqueMinimo ? estoqueMinimo - saldo : 0,
        risco: saldo <= estoqueMinimo ? 'Risco de ruptura' : 'Normal'
      };
    });
  }, [depositos, movimentacoes]);

  const fluxoEstoque = useMemo(() => {
    const entradas = movimentacoes.filter((mov) => mov.tipo_movimentacao === 'Entrada').reduce((acc, mov) => acc + Number(mov.quantidade || 0), 0);
    const transferencias = movimentacoes.filter((mov) => mov.tipo_movimentacao === 'Transferência').reduce((acc, mov) => acc + Number(mov.quantidade || 0), 0);
    const consumo = linhas.reduce((acc, item) => acc + item.realizado, 0);
    const inconsistencias = [];
    if (consumo > entradas + transferencias) inconsistencias.push('Consumo maior que entradas e transferências do período.');
    if (situacaoDepositos.some((item) => item.risco === 'Risco de ruptura')) inconsistencias.push('Há depósitos operando em risco de ruptura.');
    return { entradas, transferencias, consumo, inconsistencias };
  }, [movimentacoes, linhas, situacaoDepositos]);

  const alertasInteligentes = useMemo(() => {
    const lista = [];
    situacaoDepositos.filter((item) => item.saldo <= item.estoqueMinimo).forEach((item) => {
      lista.push(`Depósito ${item.nome} abaixo do mínimo, com necessidade de reposição de ${formatarNumero(item.necessidadeReposicao)} kg.`);
    });
    situacaoCochos.filter((item) => item.status !== 'normal').forEach((item) => {
      lista.push(`Cocho ${item.nome} com alerta de ${item.alerta.toLowerCase()}.`);
    });
    analiseLotes.filter((item) => item.eficiencia > 120 || (item.eficiencia > 0 && item.eficiencia < 80)).forEach((item) => {
      lista.push(`Lote ${item.lote_nome} com consumo fora do esperado, operando em ${formatarNumero(item.eficiencia)}% da meta.`);
    });
    return lista;
  }, [situacaoDepositos, situacaoCochos, analiseLotes]);

  const recomendacoes = useMemo(() => {
    const lista = [];
    if (situacaoDepositos.some((item) => item.saldo <= item.estoqueMinimo)) lista.push('Priorizar a reposição imediata dos depósitos abaixo do estoque mínimo.');
    if (situacaoCochos.some((item) => item.status !== 'normal')) lista.push('Revisar a frequência de abastecimento dos cochos com baixa cobertura.');
    if (analiseLotes.some((item) => item.eficiencia > 120 || (item.eficiencia > 0 && item.eficiencia < 80))) lista.push('Reavaliar o ajuste de fornecimento e os parâmetros nutricionais dos lotes com desvio de consumo.');
    if (!lista.length) lista.push('A operação está estável no período avaliado, manter o monitoramento atual.');
    return lista;
  }, [situacaoDepositos, situacaoCochos, analiseLotes]);

  const toggleFiltro = (lista, setLista, valor) => {
    setLista((prev) => prev.includes(valor) ? prev.filter((item) => item !== valor) : [...prev, valor]);
  };

  const limparFiltros = () => {
    setDataInicio('');
    setDataFim('');
    setProdutosSelecionados([]);
    setLotesSelecionados([]);
    setStatusSelecionados([]);
    setOrdenacao('data_desc');
  };

  return (
    <RelatorioBase
      titulo="Relatório Inteligente de Consumo"
      subtitulo="Análise gerencial completa de consumo, cochos e depósitos"
      empresaAtual={empresaAtual}
      resumoTotais={`${totais.registros} registros | Esperado: ${formatarNumero(totais.esperado)} kg | Realizado: ${formatarNumero(totais.realizado)} kg | Críticos: ${totais.criticos}`}
      filtros={
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <FiltroData label="Data Início" value={dataInicio} onChange={setDataInicio} />
            <FiltroData label="Data Fim" value={dataFim} onChange={setDataFim} />
            <FiltroSelect
              label="Ordenar Por"
              value={ordenacao}
              onChange={setOrdenacao}
              opcoes={[
                { value: 'data_desc', label: 'Maior consumo' },
                { value: 'eficiencia_desc', label: 'Eficiência maior' },
                { value: 'eficiencia_asc', label: 'Eficiência menor' },
                { value: 'realizado_desc', label: 'Consumo realizado' },
              ]}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <FiltroMultiplo label="Produtos" selecionados={produtosSelecionados} opcoes={produtosOpcoes} onToggle={(v) => toggleFiltro(produtosSelecionados, setProdutosSelecionados, v)} />
            <FiltroMultiplo label="Lotes" selecionados={lotesSelecionados} opcoes={lotesOpcoes} onToggle={(v) => toggleFiltro(lotesSelecionados, setLotesSelecionados, v)} />
            <FiltroMultiplo label="Status" selecionados={statusSelecionados} opcoes={statusOpcoes} onToggle={(v) => toggleFiltro(statusSelecionados, setStatusSelecionados, v)} renderLabel={(v) => v.toUpperCase()} />
            <BotaoLimparFiltros onClick={limparFiltros} />
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <Card>
          <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">1. RESUMO EXECUTIVO</CardTitle></CardHeader>
          <CardContent className="p-4 text-xs text-slate-700 space-y-2">
            <p>A operação analisada registrou {totais.registros} eventos de consumo, com expectativa de {formatarNumero(totais.esperado)} kg e consumo realizado de {formatarNumero(totais.realizado)} kg no período.</p>
            <p>Os principais pontos críticos estão ligados a estoques abaixo do mínimo em depósitos, cobertura curta em cochos e desvios de consumo em alguns lotes.</p>
            <div className="space-y-1">
              {alertasInteligentes.slice(0, 5).map((alerta, index) => <p key={index}>• {alerta}</p>)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">2. ANÁLISE DOS LOTES</CardTitle></CardHeader>
          <CardContent className="p-4 space-y-2 text-xs">
            {analiseLotes.map((item) => (
              <div key={item.lote_nome} className="border rounded-lg p-3 space-y-1">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div className="font-semibold text-slate-900">{item.lote_nome}</div>
                  <Badge className={item.eficiencia > 120 || (item.eficiencia > 0 && item.eficiencia < 80) ? statusBadgeClass.atencao : statusBadgeClass.normal}>{formatarNumero(item.eficiencia)}%</Badge>
                </div>
                <p>Quantidade de cabeças: {formatarNumero(item.cabecas, 0)} | Peso médio: {formatarNumero(item.peso_medio)} kg</p>
                <p>Consumo estimado: {formatarNumero(item.esperado)} kg | Consumo realizado: {formatarNumero(item.realizado)} kg</p>
                <p>Observação relevante: {item.observacao}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">3. CONSUMO DE PRODUTOS</CardTitle></CardHeader>
          <CardContent className="p-4 space-y-2 text-xs">
            {consumoProdutos.map((item) => (
              <div key={item.produto_nome} className="border rounded-lg p-3 space-y-1">
                <div className="font-semibold text-slate-900">{item.produto_nome}</div>
                <p>Consumo total no período: {formatarNumero(item.realizado)} kg</p>
                <p>Parâmetro esperado: {formatarNumero(item.esperado)} kg | Eficiência: {formatarNumero(item.eficiencia)}%</p>
                <p>Situação do produto: {item.situacao}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">4. SITUAÇÃO DOS COCHOS</CardTitle></CardHeader>
          <CardContent className="p-4 space-y-2 text-xs">
            {situacaoCochos.map((item) => (
              <div key={item.nome} className="border rounded-lg p-3 space-y-1">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold text-slate-900">{item.nome}</span><Badge className={statusBadgeClass[item.status]}>{item.status.toUpperCase()}</Badge></div>
                <p>Nível atual de estoque: {formatarNumero(item.saldo)} kg</p>
                <p>Consumo médio: {formatarNumero(item.consumoMedio)} kg | Dias restantes estimados: {formatarNumero(item.diasRestantes)}</p>
                <p>Alerta operacional: {item.alerta}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">5. SITUAÇÃO DOS DEPÓSITOS</CardTitle></CardHeader>
          <CardContent className="p-4 space-y-2 text-xs">
            {situacaoDepositos.map((item) => (
              <div key={item.nome} className="border rounded-lg p-3 space-y-1">
                <div className="font-semibold text-slate-900">{item.nome}</div>
                <p>Saldo atual: {formatarNumero(item.saldo)} kg | Estoque mínimo: {formatarNumero(item.estoqueMinimo)} kg</p>
                <p>Necessidade de reposição: {formatarNumero(item.necessidadeReposicao)} kg | Risco: {item.risco}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">6. FLUXO DE ESTOQUE</CardTitle></CardHeader>
          <CardContent className="p-4 text-xs space-y-2">
            <p>Entradas (compras): {formatarNumero(fluxoEstoque.entradas)} kg</p>
            <p>Transferências (depósito → cocho): {formatarNumero(fluxoEstoque.transferencias)} kg</p>
            <p>Consumo total apurado: {formatarNumero(fluxoEstoque.consumo)} kg</p>
            <div className="space-y-1">
              {fluxoEstoque.inconsistencias.length ? fluxoEstoque.inconsistencias.map((item, index) => <p key={index}>• {item}</p>) : <p>• Não foram identificadas inconsistências relevantes no período.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">7. ALERTAS INTELIGENTES</CardTitle></CardHeader>
          <CardContent className="p-4 text-xs space-y-1">
            {alertasInteligentes.length ? alertasInteligentes.map((item, index) => <p key={index}>• {item}</p>) : <p>• Não há alertas críticos no período selecionado.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">8. RECOMENDAÇÕES</CardTitle></CardHeader>
          <CardContent className="p-4 text-xs space-y-1">
            {recomendacoes.map((item, index) => <p key={index}>• {item}</p>)}
          </CardContent>
        </Card>
      </div>
    </RelatorioBase>
  );
}