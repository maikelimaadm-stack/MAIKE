import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import RelatorioBase from "@/components/relatorios/RelatorioBase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ConfigAnaliseLotesDialog from "@/components/relatorios/consumoInteligente/ConfigAnaliseLotesDialog";
import TabelaAnaliseLotes from "@/components/relatorios/consumoInteligente/TabelaAnaliseLotes";
import { COLUNAS_ANALISE_LOTES, STORAGE_KEY_COLUNAS_ANALISE_LOTES } from "@/components/relatorios/consumoInteligente/colunasAnaliseLotes";

const formatarNumero = (num, casas = 2) => Number(num || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const formatarData = (valor) => {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleDateString('pt-BR');
};
const somarSaldoProduto = (movimentacoes, nomeLocal, produtoNome) => movimentacoes
  .filter((mov) => (mov.local_destino === nomeLocal || mov.local_origem === nomeLocal) && mov.produto_nome === produtoNome)
  .reduce((acc, mov) => {
    if (mov.tipo_movimentacao === 'Entrada') return acc + Number(mov.quantidade || 0);
    if (mov.tipo_movimentacao === 'Saída') return acc - Number(mov.quantidade || 0);
    return acc;
  }, 0);

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

const tabelaWrapClass = "overflow-x-auto rounded-lg border";
const thClass = "text-xs font-bold py-2 px-3 border-b bg-slate-50";
const tdClass = "text-xs py-2 px-3 border-b";
const tdNumClass = "text-xs py-2 px-3 border-b text-right font-mono";

export default function RelatorioConsumoInteligente() {
  const empresaId = localStorage.getItem('empresa_selecionada_id');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [lotesSelecionados, setLotesSelecionados] = useState([]);
  const [statusSelecionados, setStatusSelecionados] = useState([]);
  const [visaoResumo, setVisaoResumo] = useState('geral');
  const [configOpen, setConfigOpen] = useState(false);
  const [modoVisualizacao, setModoVisualizacao] = useState('ambos');
  const [mostrarDetalhes, setMostrarDetalhes] = useState(true);
  const [ordenacaoAnalise, setOrdenacaoAnalise] = useState('data_asc');
  const [retirosSelecionados, setRetirosSelecionados] = useState([]);
  const [colunasVisiveisAnalise, setColunasVisiveisAnalise] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_COLUNAS_ANALISE_LOTES);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_ANALISE_LOTES.filter((coluna) => coluna.default).map((coluna) => coluna.id);
      }
    }
    return COLUNAS_ANALISE_LOTES.filter((coluna) => coluna.default).map((coluna) => coluna.id);
  });

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
    return eventos.filter((evento) => {
      const dataBase = evento.data_lancamento || evento.created_date;
      if (dataInicio && new Date(dataBase) < new Date(dataInicio)) return false;
      if (dataFim) {
        const limite = new Date(dataFim);
        limite.setHours(23, 59, 59, 999);
        if (new Date(dataBase) > limite) return false;
      }
      return true;
    }).map((evento) => {
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
      const diferenca = consumoRealizado - consumoEsperado;
      const consumoPorCabeca = Number(lote?.quantidade_cabecas || evento.total_cabecas_afetadas || 0) > 0 ? consumoRealizado / Number(lote?.quantidade_cabecas || evento.total_cabecas_afetadas || 0) : 0;
      const dataReposicao = diasRestantes > 0 ? new Date(Date.now() + diasRestantes * 24 * 60 * 60 * 1000).toISOString() : null;
      const metaPercentual = produto?.percentual_consumo_pv ? Number(produto.percentual_consumo_pv) : 0;
      const consumoPercentual = lote?.peso_medio_kg > 0 && consumoPorCabeca > 0 ? (consumoPorCabeca / Number(lote.peso_medio_kg)) * 100 : 0;
      const desvioPercentual = consumoPercentual - metaPercentual;
      const metaCabeca = lote?.peso_medio_kg > 0 && metaPercentual > 0 ? Number(lote.peso_medio_kg) * (metaPercentual / 100) : 0;
      const desvioCabeca = consumoPorCabeca - metaCabeca;
      return {
        id: evento.id,
        data_evento: evento.data_lancamento || evento.created_date,
        lote_nome: lote?.nome || lote?.identificador_nome || 'GERAL',
        categoria_lote: lote?.categoria_nome || lote?.categoria || '-',
        setor_lote: lote?.setor_nome || '-',
        retiro_nome: lote?.retiro_nome || lote?.fazenda_nome || lote?.propriedade_nome || '-',
        modulo_nome: lote?.modulo_nome || lote?.setor_nome || '-',
        area_nome: ponto?.area_vinculada_nome || lote?.area_pasto_nome || '-',
        cabecas: Number(lote?.quantidade_cabecas || evento.total_cabecas_afetadas || 0),
        peso_medio: Number(lote?.peso_medio_kg || 0),
        produto_nome: produto?.nome_produto || evento.produto || '-',
        classificacao_produto: produto?.descricao || produto?.categoria || produto?.tipo_consumo || '-',
        tipo_consumo: produto?.tipo_consumo || '-',
        cocho_nome: ponto?.nome_ponto || evento.ponto_nome || '-',
        deposito_nome: ponto?.deposito_origem_nome || '-',
        esperado: consumoEsperado,
        realizado: consumoRealizado,
        diferenca,
        meta_percentual: metaPercentual,
        consumo_percentual: consumoPercentual,
        desvio_percentual: desvioPercentual,
        meta_cabeca: metaCabeca,
        consumo_por_cabeca: consumoPorCabeca,
        desvio_cabeca: desvioCabeca,
        eficiencia,
        saldo: saldoPonto,
        dias_restantes: diasRestantes,
        data_reposicao: dataReposicao,
        estoque_minimo: estoqueMinimo,
        status: classificacao.status,
        alerta: classificacao.alerta,
        detalhes_texto: `${produto?.nome_produto || evento.produto || '-'} | COCHO ${ponto?.nome_ponto || evento.ponto_nome || '-'} | DEPÓSITO ${ponto?.deposito_origem_nome || '-'} | ALERTA ${classificacao.alerta}`,
      };
    }).filter((linha) => {
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(linha.produto_nome)) return false;
      if (lotesSelecionados.length > 0 && !lotesSelecionados.includes(linha.lote_nome)) return false;
      if (statusSelecionados.length > 0 && !statusSelecionados.includes(linha.status)) return false;
      return true;
    });
  }, [eventos, dataInicio, dataFim, produtosMap, produtos, pontosMap, lotes, movimentacoes, produtosSelecionados, lotesSelecionados, statusSelecionados]);

  const produtosOpcoes = useMemo(() => [...new Set(linhas.map((item) => item.produto_nome))].filter(Boolean).sort(), [linhas]);
  const lotesOpcoes = useMemo(() => [...new Set(linhas.map((item) => item.lote_nome))].filter(Boolean).sort(), [linhas]);
  const retirosOpcoes = useMemo(() => [...new Set(linhas.map((item) => item.retiro_nome))].filter(Boolean).sort(), [linhas]);
  const statusOpcoes = ['normal', 'atencao', 'critico'];

  const totais = useMemo(() => ({
    registros: linhas.length,
    esperado: linhas.reduce((acc, item) => acc + item.esperado, 0),
    realizado: linhas.reduce((acc, item) => acc + item.realizado, 0),
    criticos: linhas.filter((item) => item.status === 'critico').length,
    atencao: linhas.filter((item) => item.status === 'atencao').length,
  }), [linhas]);

  const analiseLotes = useMemo(() => {
    const mapa = new Map();
    linhas.forEach((linha) => {
      if (!mapa.has(linha.lote_nome)) {
        mapa.set(linha.lote_nome, { ...linha, esperado: 0, realizado: 0, alertas: [] });
      }
      const item = mapa.get(linha.lote_nome);
      item.esperado += linha.esperado;
      item.realizado += linha.realizado;
      item.saldo = linha.saldo;
      item.dias_restantes = linha.dias_restantes;
      if (linha.status !== 'normal') item.alertas.push(linha.alerta);
    });
    return Array.from(mapa.values()).map((item) => {
      const eficiencia = item.esperado > 0 ? (item.realizado / item.esperado) * 100 : 0;
      const diferenca = item.realizado - item.esperado;
      const mediaCabeca = item.cabecas > 0 ? item.realizado / item.cabecas : 0;
      return {
        ...item,
        eficiencia,
        diferenca,
        media_cabeca: mediaCabeca,
        observacao: item.alertas[0] || 'SEM OCORRÊNCIAS RELEVANTES'
      };
    }).sort((a, b) => b.realizado - a.realizado);
  }, [linhas]);

  const consumoProdutos = useMemo(() => {
    const mapa = new Map();
    linhas.forEach((linha) => {
      if (!mapa.has(linha.produto_nome)) mapa.set(linha.produto_nome, { produto_nome: linha.produto_nome, tipo_consumo: linha.tipo_consumo, esperado: 0, realizado: 0, lotes: new Set() });
      const item = mapa.get(linha.produto_nome);
      item.esperado += linha.esperado;
      item.realizado += linha.realizado;
      item.lotes.add(linha.lote_nome);
    });
    return Array.from(mapa.values()).map((item) => {
      const eficiencia = item.esperado > 0 ? (item.realizado / item.esperado) * 100 : 0;
      const diferenca = item.realizado - item.esperado;
      return {
        ...item,
        lotes_count: item.lotes.size,
        eficiencia,
        diferenca,
        situacao: eficiencia > 120 ? 'ACIMA DO IDEAL' : eficiencia > 0 && eficiencia < 80 ? 'ABAIXO DO IDEAL' : 'DENTRO DO IDEAL'
      };
    }).sort((a, b) => b.realizado - a.realizado);
  }, [linhas]);

  const situacaoCochos = useMemo(() => {
    return cochos.map((cocho) => {
      const linhasCocho = linhas.filter((linha) => linha.cocho_nome === cocho.nome_ponto);
      const consumoEsperado = linhasCocho.reduce((acc, item) => acc + item.esperado, 0);
      const consumoRealizado = linhasCocho.reduce((acc, item) => acc + item.realizado, 0);
      const consumoMedio = linhasCocho.reduce((acc, item) => acc + item.realizado, 0) / (linhasCocho.length || 1);
      const saldo = somarSaldoProduto(movimentacoes, cocho.nome_ponto, cocho.produto_padrao || '-');
      const diasRestantes = consumoMedio > 0 ? saldo / consumoMedio : 0;
      const dataReposicao = diasRestantes > 0 ? new Date(Date.now() + diasRestantes * 24 * 60 * 60 * 1000).toISOString() : null;
      const classificacao = classificarStatus({ eficiencia: consumoEsperado > 0 ? (consumoRealizado / consumoEsperado) * 100 : 100, saldo, estoqueMinimo: Number(cocho.estoque_minimo_kg || 0), diasRestantes });
      return {
        nome: cocho.nome_ponto,
        deposito_origem: cocho.deposito_origem_nome || '-',
        produto_padrao: cocho.produto_padrao || '-',
        capacidade: Number(cocho.capacidade_cocho_kg || 0),
        saldo,
        consumoEsperado,
        consumoRealizado,
        consumoMedio,
        diasRestantes,
        dataReposicao,
        alerta: classificacao.alerta,
        status: classificacao.status
      };
    }).sort((a, b) => a.saldo - b.saldo);
  }, [cochos, linhas, movimentacoes]);

  const situacaoDepositos = useMemo(() => {
    return depositos.map((deposito) => {
      const produtoBase = deposito.produto_padrao || '-';
      const saldo = somarSaldoProduto(movimentacoes, deposito.nome_ponto, produtoBase);
      const estoqueMinimo = Number(deposito.estoque_minimo_kg || 0);
      return {
        nome: deposito.nome_ponto,
        produto_padrao: produtoBase,
        capacidade: Number(deposito.capacidade_cocho_kg || 0),
        saldo,
        estoqueMinimo,
        necessidadeReposicao: saldo < estoqueMinimo ? estoqueMinimo - saldo : 0,
        risco: saldo <= estoqueMinimo ? 'RISCO DE RUPTURA' : 'NORMAL'
      };
    }).sort((a, b) => a.saldo - b.saldo);
  }, [depositos, movimentacoes]);

  const fluxoEstoque = useMemo(() => {
    const entradas = movimentacoes.filter((mov) => mov.tipo_movimentacao === 'Entrada').reduce((acc, mov) => acc + Number(mov.quantidade || 0), 0);
    const saidas = movimentacoes.filter((mov) => mov.tipo_movimentacao === 'Saída').reduce((acc, mov) => acc + Number(mov.quantidade || 0), 0);
    const transferencias = movimentacoes.filter((mov) => mov.tipo_movimentacao === 'Transferência').reduce((acc, mov) => acc + Number(mov.quantidade || 0), 0);
    const consumo = linhas.reduce((acc, item) => acc + item.realizado, 0);
    const saldoTeorico = entradas - saidas;
    const diferenca = saldoTeorico - consumo;
    return { entradas, saidas, transferencias, consumo, saldoTeorico, diferenca };
  }, [movimentacoes, linhas]);

  const alertasInteligentes = useMemo(() => {
    const lista = [];
    situacaoDepositos.filter((item) => item.saldo <= item.estoqueMinimo).forEach((item) => lista.push({ tipo: 'DEPÓSITO', descricao: `${item.nome} ABAIXO DO MÍNIMO`, impacto: `REPOR ${formatarNumero(item.necessidadeReposicao)} KG` }));
    situacaoCochos.filter((item) => item.status !== 'normal').forEach((item) => lista.push({ tipo: 'COCHO', descricao: `${item.nome} COM ${item.alerta}`, impacto: `SALDO ${formatarNumero(item.saldo)} KG` }));
    analiseLotes.filter((item) => item.eficiencia > 120 || (item.eficiencia > 0 && item.eficiencia < 80)).forEach((item) => lista.push({ tipo: 'LOTE', descricao: `${item.lote_nome} FORA DO ESPERADO`, impacto: `EFICIÊNCIA ${formatarNumero(item.eficiencia)}%` }));
    return lista;
  }, [situacaoDepositos, situacaoCochos, analiseLotes]);

  const limparFiltros = () => {
    setDataInicio('');
    setDataFim('');
    setProdutosSelecionados([]);
    setLotesSelecionados([]);
    setStatusSelecionados([]);
    setRetirosSelecionados([]);
    setVisaoResumo('geral');
    setModoVisualizacao('ambos');
    setMostrarDetalhes(true);
    setOrdenacaoAnalise('data_asc');
  };

  const toggleColunaAnalise = (colunaId) => {
    setColunasVisiveisAnalise((prev) => {
      const next = prev.includes(colunaId) ? prev.filter((id) => id !== colunaId) : [...prev, colunaId];
      localStorage.setItem(STORAGE_KEY_COLUNAS_ANALISE_LOTES, JSON.stringify(next));
      return next;
    });
  };

  const linhasAnalise = useMemo(() => {
    let base = linhas.filter((linha) => {
      if (retirosSelecionados.length > 0 && !retirosSelecionados.includes(linha.retiro_nome)) return false;
      return true;
    });

    base = [...base].sort((a, b) => {
      if (ordenacaoAnalise === 'data_desc') return new Date(b.data_evento || 0) - new Date(a.data_evento || 0);
      if (ordenacaoAnalise === 'lote_asc') return String(a.lote_nome || '').localeCompare(String(b.lote_nome || ''));
      if (ordenacaoAnalise === 'consumo_desc') return Number(b.realizado || 0) - Number(a.realizado || 0);
      return new Date(a.data_evento || 0) - new Date(b.data_evento || 0);
    });

    return base;
  }, [linhas, retirosSelecionados, ordenacaoAnalise]);

  const resumoPorLote = useMemo(() => {
    const mapa = new Map();
    linhasAnalise.forEach((linha) => {
      const chave = linha.lote_nome;
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          ...linha,
          id: `resumo-${chave}`,
          realizado: 0,
          esperado: 0,
          cabecas: linha.cabecas,
          peso_medio: linha.peso_medio,
          consumo_por_cabeca: 0,
          detalhes_texto: '',
        });
      }
      const atual = mapa.get(chave);
      atual.realizado += Number(linha.realizado || 0);
      atual.esperado += Number(linha.esperado || 0);
      atual.consumo_por_cabeca = atual.cabecas > 0 ? atual.realizado / atual.cabecas : 0;
      atual.meta_cabeca = atual.peso_medio > 0 && atual.meta_percentual > 0 ? atual.peso_medio * (atual.meta_percentual / 100) : atual.meta_cabeca;
      atual.desvio_cabeca = atual.consumo_por_cabeca - (atual.meta_cabeca || 0);
      atual.consumo_percentual = atual.peso_medio > 0 ? (atual.consumo_por_cabeca / atual.peso_medio) * 100 : 0;
      atual.desvio_percentual = atual.consumo_percentual - (atual.meta_percentual || 0);
      atual.detalhes_texto = `PERÍODO ${atual.data_evento ? new Date(atual.data_evento).toLocaleDateString('pt-BR') : '-'} ATÉ ${linha.data_evento ? new Date(linha.data_evento).toLocaleDateString('pt-BR') : '-'} | ${atual.alerta}`;
    });
    return Array.from(mapa.values());
  }, [linhasAnalise]);

  const toggleFiltro = (lista, setLista, valor) => {
    setLista((prev) => prev.includes(valor) ? prev.filter((item) => item !== valor) : [...prev, valor]);
  };

  return (
    <RelatorioBase
      titulo="Relatório Inteligente de Consumo"
      subtitulo="Dados completos de lotes, produtos, cochos, depósitos e fluxo de estoque"
      empresaAtual={empresaAtual}
      resumoTotais={`${totais.registros} registros | Esperado: ${formatarNumero(totais.esperado)} kg | Realizado: ${formatarNumero(totais.realizado)} kg | Críticos: ${totais.criticos} | Atenção: ${totais.atencao}`}
      filtros={
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
          <div>
            <p className="text-xs text-slate-600">Análise por lotes com resumo, detalhes, datas, colunas e layout no padrão histórico.</p>
          </div>
          <Button type="button" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => setConfigOpen(true)}>
            <Settings className="w-3.5 h-3.5 mr-1" />
            Configurar Relatório
          </Button>
        </div>
      }
    >
      <ConfigAnaliseLotesDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        dataInicio={dataInicio}
        setDataInicio={setDataInicio}
        dataFim={dataFim}
        setDataFim={setDataFim}
        modoVisualizacao={modoVisualizacao}
        setModoVisualizacao={setModoVisualizacao}
        mostrarDetalhes={mostrarDetalhes}
        setMostrarDetalhes={setMostrarDetalhes}
        ordenacao={ordenacaoAnalise}
        setOrdenacao={setOrdenacaoAnalise}
        retiros={retirosOpcoes}
        retirosSelecionados={retirosSelecionados}
        toggleRetiro={(v) => toggleFiltro(retirosSelecionados, setRetirosSelecionados, v)}
        selecionarTodosRetiros={() => setRetirosSelecionados(retirosOpcoes)}
        limparRetiros={() => setRetirosSelecionados([])}
        produtos={produtosOpcoes}
        produtosSelecionados={produtosSelecionados}
        toggleProduto={(v) => toggleFiltro(produtosSelecionados, setProdutosSelecionados, v)}
        selecionarTodosProdutos={() => setProdutosSelecionados(produtosOpcoes)}
        limparProdutos={() => setProdutosSelecionados([])}
        lotes={lotesOpcoes}
        lotesSelecionados={lotesSelecionados}
        toggleLote={(v) => toggleFiltro(lotesSelecionados, setLotesSelecionados, v)}
        selecionarTodosLotes={() => setLotesSelecionados(lotesOpcoes)}
        limparLotes={() => setLotesSelecionados([])}
        colunasVisiveis={colunasVisiveisAnalise}
        toggleColuna={toggleColunaAnalise}
        limparFiltros={limparFiltros}
      >
      <div className="space-y-3">
        <Card>
          <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">1. RESUMO EXECUTIVO</CardTitle></CardHeader>
          <CardContent className="p-4">
            <div className={tabelaWrapClass}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={thClass}>INDICADOR</TableHead>
                    <TableHead className={`${thClass} text-right`}>VALOR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow><TableCell className={tdClass}>REGISTROS ANALISADOS</TableCell><TableCell className={tdNumClass}>{formatarNumero(totais.registros, 0)}</TableCell></TableRow>
                  <TableRow><TableCell className={tdClass}>CONSUMO ESPERADO (KG)</TableCell><TableCell className={tdNumClass}>{formatarNumero(totais.esperado)}</TableCell></TableRow>
                  <TableRow><TableCell className={tdClass}>CONSUMO REALIZADO (KG)</TableCell><TableCell className={tdNumClass}>{formatarNumero(totais.realizado)}</TableCell></TableRow>
                  <TableRow><TableCell className={tdClass}>PONTOS CRÍTICOS</TableCell><TableCell className={tdNumClass}>{formatarNumero(totais.criticos, 0)}</TableCell></TableRow>
                  <TableRow><TableCell className={tdClass}>PONTOS DE ATENÇÃO</TableCell><TableCell className={tdNumClass}>{formatarNumero(totais.atencao, 0)}</TableCell></TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {(visaoResumo === 'geral' || visaoResumo === 'lotes') && (
          <div className="space-y-3">
            {(modoVisualizacao === 'resumo' || modoVisualizacao === 'ambos') && (
              <TabelaAnaliseLotes
                titulo="2. RESUMO POR LOTE"
                linhas={resumoPorLote}
                colunasVisiveis={colunasVisiveisAnalise}
                mostrarDetalhes={mostrarDetalhes}
              />
            )}
            {(modoVisualizacao === 'detalhado' || modoVisualizacao === 'ambos') && (
              <TabelaAnaliseLotes
                titulo="3. LISTA DETALHADA POR DATA"
                linhas={linhasAnalise}
                colunasVisiveis={colunasVisiveisAnalise}
                mostrarDetalhes={mostrarDetalhes}
              />
            )}
          </div>
        )}

        {(visaoResumo === 'geral' || visaoResumo === 'produtos') && (
          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">3. CONSUMO DE PRODUTOS</CardTitle></CardHeader>
            <CardContent className="p-4">
              <div className={tabelaWrapClass}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={thClass}>PRODUTO</TableHead>
                      <TableHead className={thClass}>TIPO</TableHead>
                      <TableHead className={`${thClass} text-right`}>LOTES</TableHead>
                      <TableHead className={`${thClass} text-right`}>ESPERADO</TableHead>
                      <TableHead className={`${thClass} text-right`}>REALIZADO</TableHead>
                      <TableHead className={`${thClass} text-right`}>DIFERENÇA</TableHead>
                      <TableHead className={`${thClass} text-right`}>EFIC. %</TableHead>
                      <TableHead className={thClass}>SITUAÇÃO</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {consumoProdutos.map((item) => (
                      <TableRow key={item.produto_nome}>
                        <TableCell className={tdClass}>{item.produto_nome}</TableCell>
                        <TableCell className={tdClass}>{item.tipo_consumo}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.lotes_count, 0)}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.esperado)}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.realizado)}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.diferenca)}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.eficiencia)}</TableCell>
                        <TableCell className={tdClass}>{item.situacao}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {(visaoResumo === 'geral' || visaoResumo === 'estoque') && (
          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">4. SITUAÇÃO DOS COCHOS</CardTitle></CardHeader>
            <CardContent className="p-4">
              <div className={tabelaWrapClass}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={thClass}>COCHO</TableHead>
                      <TableHead className={thClass}>DEPÓSITO ORIGEM</TableHead>
                      <TableHead className={thClass}>PRODUTO</TableHead>
                      <TableHead className={`${thClass} text-right`}>CAPACIDADE</TableHead>
                      <TableHead className={`${thClass} text-right`}>SALDO PROD.</TableHead>
                      <TableHead className={`${thClass} text-right`}>ESPERADO</TableHead>
                      <TableHead className={`${thClass} text-right`}>REALIZADO</TableHead>
                      <TableHead className={`${thClass} text-right`}>CONS. MÉDIO</TableHead>
                      <TableHead className={`${thClass} text-right`}>DIAS REST.</TableHead>
                      <TableHead className={thClass}>DATA REPOSIÇÃO</TableHead>
                      <TableHead className={thClass}>ALERTA</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {situacaoCochos.map((item) => (
                      <TableRow key={item.nome}>
                        <TableCell className={tdClass}>{item.nome}</TableCell>
                        <TableCell className={tdClass}>{item.deposito_origem}</TableCell>
                        <TableCell className={tdClass}>{item.produto_padrao}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.capacidade)}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.saldo)}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.consumoEsperado)}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.consumoRealizado)}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.consumoMedio)}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.diasRestantes)}</TableCell>
                        <TableCell className={tdClass}>{formatarData(item.dataReposicao)}</TableCell>
                        <TableCell className={tdClass}><Badge className={statusBadgeClass[item.status]}>{item.alerta}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {(visaoResumo === 'geral' || visaoResumo === 'estoque') && (
          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">5. SITUAÇÃO DOS DEPÓSITOS</CardTitle></CardHeader>
            <CardContent className="p-4">
              <div className={tabelaWrapClass}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={thClass}>DEPÓSITO</TableHead>
                      <TableHead className={thClass}>PRODUTO</TableHead>
                      <TableHead className={`${thClass} text-right`}>CAPACIDADE</TableHead>
                      <TableHead className={`${thClass} text-right`}>SALDO</TableHead>
                      <TableHead className={`${thClass} text-right`}>ESTOQUE MÍNIMO</TableHead>
                      <TableHead className={`${thClass} text-right`}>REPOSIÇÃO</TableHead>
                      <TableHead className={thClass}>RISCO</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {situacaoDepositos.map((item) => (
                      <TableRow key={item.nome}>
                        <TableCell className={tdClass}>{item.nome}</TableCell>
                        <TableCell className={tdClass}>{item.produto_padrao}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.capacidade)}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.saldo)}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.estoqueMinimo)}</TableCell>
                        <TableCell className={tdNumClass}>{formatarNumero(item.necessidadeReposicao)}</TableCell>
                        <TableCell className={tdClass}>{item.risco}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">6. FLUXO DE ESTOQUE</CardTitle></CardHeader>
          <CardContent className="p-4">
            <div className={tabelaWrapClass}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={thClass}>MOVIMENTO</TableHead>
                    <TableHead className={`${thClass} text-right`}>KG</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow><TableCell className={tdClass}>ENTRADAS (COMPRAS)</TableCell><TableCell className={tdNumClass}>{formatarNumero(fluxoEstoque.entradas)}</TableCell></TableRow>
                  <TableRow><TableCell className={tdClass}>SAÍDAS DE ESTOQUE</TableCell><TableCell className={tdNumClass}>{formatarNumero(fluxoEstoque.saidas)}</TableCell></TableRow>
                  <TableRow><TableCell className={tdClass}>TRANSFERÊNCIAS DEPÓSITO → COCHO</TableCell><TableCell className={tdNumClass}>{formatarNumero(fluxoEstoque.transferencias)}</TableCell></TableRow>
                  <TableRow><TableCell className={tdClass}>CONSUMO TOTAL APURADO</TableCell><TableCell className={tdNumClass}>{formatarNumero(fluxoEstoque.consumo)}</TableCell></TableRow>
                  <TableRow><TableCell className={tdClass}>SALDO TEÓRICO</TableCell><TableCell className={tdNumClass}>{formatarNumero(fluxoEstoque.saldoTeorico)}</TableCell></TableRow>
                  <TableRow><TableCell className={tdClass}>DIFERENÇA / POSSÍVEL PERDA</TableCell><TableCell className={tdNumClass}>{formatarNumero(fluxoEstoque.diferenca)}</TableCell></TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">7. ALERTAS INTELIGENTES</CardTitle></CardHeader>
          <CardContent className="p-4">
            <div className={tabelaWrapClass}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={thClass}>TIPO</TableHead>
                    <TableHead className={thClass}>DESCRIÇÃO</TableHead>
                    <TableHead className={thClass}>IMPACTO</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alertasInteligentes.length ? alertasInteligentes.map((item, index) => (
                    <TableRow key={`${item.tipo}-${index}`}>
                      <TableCell className={tdClass}>{item.tipo}</TableCell>
                      <TableCell className={tdClass}>{item.descricao}</TableCell>
                      <TableCell className={tdClass}>{item.impacto}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={3} className="text-center py-8 text-xs text-slate-400">NENHUM ALERTA ENCONTRADO</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 border-b"><CardTitle className="text-sm font-semibold">8. DADOS COMPLETOS DOS EVENTOS</CardTitle></CardHeader>
          <CardContent className="p-4">
            <div className={tabelaWrapClass}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={thClass}>LOTE</TableHead>
                    <TableHead className={thClass}>PRODUTO</TableHead>
                    <TableHead className={thClass}>COCHO</TableHead>
                    <TableHead className={thClass}>DEPÓSITO</TableHead>
                    <TableHead className={`${thClass} text-right`}>CABEÇAS</TableHead>
                    <TableHead className={`${thClass} text-right`}>PESO MÉDIO</TableHead>
                    <TableHead className={thClass}>DATA</TableHead>
                    <TableHead className={`${thClass} text-right`}>ESPERADO</TableHead>
                    <TableHead className={`${thClass} text-right`}>REALIZADO</TableHead>
                    <TableHead className={`${thClass} text-right`}>DIFERENÇA</TableHead>
                    <TableHead className={`${thClass} text-right`}>CONS/CAB</TableHead>
                    <TableHead className={`${thClass} text-right`}>EFIC. %</TableHead>
                    <TableHead className={thClass}>STATUS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className={tdClass}>{item.lote_nome}</TableCell>
                      <TableCell className={tdClass}>{item.produto_nome}</TableCell>
                      <TableCell className={tdClass}>{item.cocho_nome}</TableCell>
                      <TableCell className={tdClass}>{item.deposito_nome}</TableCell>
                      <TableCell className={tdNumClass}>{formatarNumero(item.cabecas, 0)}</TableCell>
                      <TableCell className={tdNumClass}>{formatarNumero(item.peso_medio)}</TableCell>
                      <TableCell className={tdClass}>{formatarData(item.data_evento)}</TableCell>
                      <TableCell className={tdNumClass}>{formatarNumero(item.esperado)}</TableCell>
                      <TableCell className={tdNumClass}>{formatarNumero(item.realizado)}</TableCell>
                      <TableCell className={tdNumClass}>{formatarNumero(item.diferenca)}</TableCell>
                      <TableCell className={tdNumClass}>{formatarNumero(item.consumo_por_cabeca)}</TableCell>
                      <TableCell className={tdNumClass}>{formatarNumero(item.eficiencia)}</TableCell>
                      <TableCell className={tdClass}><Badge className={statusBadgeClass[item.status]}>{item.status.toUpperCase()}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </RelatorioBase>
  );
}