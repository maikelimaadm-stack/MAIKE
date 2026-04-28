import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import RelatorioBase from "@/components/relatorios/RelatorioBase";
import { FiltroData, FiltroMultiplo, FiltroSelect, BotaoLimparFiltros } from "@/components/relatorios/FiltrosRelatorio";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const formatarNumero = (num, casas = 2) => Number(num || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const formatarData = (valor) => {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleDateString('pt-BR');
};

const statusBadgeClass = {
  critico: "bg-red-100 text-red-700 border-red-200",
  atencao: "bg-amber-100 text-amber-700 border-amber-200",
  normal: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

function calcularConsumoEsperadoKg(lote, produto) {
  const cabecas = Number(lote?.quantidade_cabecas || 0);
  const pesoMedio = Number(lote?.peso_medio_kg || 0);
  const percentualPv = Number(produto?.percentual_consumo_pv || 0);
  if (cabecas <= 0) return 0;
  if (percentualPv > 0 && pesoMedio > 0) {
    return cabecas * pesoMedio * (percentualPv / 100);
  }
  if (produto?.tipo_consumo === 'CONSUMO_DIARIO' && produto?.consumo_minimo_pv && pesoMedio > 0) {
    return cabecas * pesoMedio * (Number(produto.consumo_minimo_pv) / 100);
  }
  return 0;
}

export default function RelatorioConsumoInteligente() {
  const empresaId = localStorage.getItem('empresa_selecionada_id');
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
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
      const lote = lotes.find((item) => {
        if (evento.lote_id && item.id === evento.lote_id) return true;
        return false;
      });

      const consumoRealizado = Number(evento.quantidade_total_kg || 0);
      const consumoEsperado = calcularConsumoEsperadoKg(lote, produto);
      const eficiencia = consumoEsperado > 0 ? (consumoRealizado / consumoEsperado) * 100 : 0;
      const desvio = consumoRealizado - consumoEsperado;

      const saldoCocho = movimentacoes
        .filter((mov) => mov.ponto_suplementacao_id === evento.ponto_suplementacao_id || mov.local_destino === ponto?.nome_ponto || mov.local_origem === ponto?.nome_ponto)
        .reduce((acc, mov) => {
          if (mov.tipo_movimentacao === 'Entrada') return acc + Number(mov.quantidade || 0);
          if (mov.tipo_movimentacao === 'Saída') return acc - Number(mov.quantidade || 0);
          return acc;
        }, 0);

      const consumoMedio = consumoRealizado > 0 ? consumoRealizado : 0;
      const diasRestantes = consumoMedio > 0 ? saldoCocho / consumoMedio : 0;
      const estoqueMinimo = Number(ponto?.estoque_minimo_kg || 0);

      let status = 'normal';
      let alerta = 'OPERAÇÃO DENTRO DO PADRÃO';
      if (estoqueMinimo > 0 && saldoCocho <= estoqueMinimo) {
        status = 'critico';
        alerta = 'ESTOQUE ABAIXO DO MÍNIMO';
      } else if (eficiencia > 120 || (eficiencia > 0 && eficiencia < 80)) {
        status = 'atencao';
        alerta = 'CONSUMO FORA DO PADRÃO';
      } else if (diasRestantes > 0 && diasRestantes <= 3) {
        status = 'atencao';
        alerta = 'BAIXA COBERTURA DE ESTOQUE';
      }

      return {
        id: evento.id,
        data: evento.data_lancamento || evento.created_date,
        lote_nome: lote?.nome || lote?.identificador_nome || 'GERAL',
        produto_nome: produto?.nome_produto || evento.produto || '-',
        cocho_nome: ponto?.nome_ponto || evento.ponto_nome || '-',
        deposito_nome: ponto?.deposito_origem_nome || '-',
        cabecas: Number(lote?.quantidade_cabecas || evento.total_cabecas_afetadas || 0),
        peso_medio: Number(lote?.peso_medio_kg || 0),
        esperado: consumoEsperado,
        realizado: consumoRealizado,
        desvio,
        eficiencia,
        saldo: saldoCocho,
        dias_restantes: diasRestantes,
        estoque_minimo: estoqueMinimo,
        status,
        alerta,
      };
    }).filter((linha) => {
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(linha.produto_nome)) return false;
      if (lotesSelecionados.length > 0 && !lotesSelecionados.includes(linha.lote_nome)) return false;
      if (statusSelecionados.length > 0 && !statusSelecionados.includes(linha.status)) return false;
      return true;
    }).sort((a, b) => {
      switch (ordenacao) {
        case 'data_asc': return new Date(a.data) - new Date(b.data);
        case 'eficiencia_desc': return b.eficiencia - a.eficiencia;
        case 'eficiencia_asc': return a.eficiencia - b.eficiencia;
        case 'desvio_desc': return b.desvio - a.desvio;
        default: return new Date(b.data) - new Date(a.data);
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
      subtitulo="Visão unificada de consumo, cochos e depósitos"
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
                { value: 'data_desc', label: 'Data (Mais Recente)' },
                { value: 'data_asc', label: 'Data (Mais Antiga)' },
                { value: 'eficiencia_desc', label: 'Eficiência (Maior)' },
                { value: 'eficiencia_asc', label: 'Eficiência (Menor)' },
                { value: 'desvio_desc', label: 'Desvio (Maior)' },
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs font-bold py-2 px-3 border-b">DATA</TableHead>
            <TableHead className="text-xs font-bold py-2 px-3 border-b">LOTE</TableHead>
            <TableHead className="text-xs font-bold py-2 px-3 border-b">PRODUTO</TableHead>
            <TableHead className="text-xs font-bold py-2 px-3 border-b">COCHO</TableHead>
            <TableHead className="text-xs font-bold py-2 px-3 border-b">DEPÓSITO</TableHead>
            <TableHead className="text-xs font-bold py-2 px-3 border-b text-right">ESP. KG</TableHead>
            <TableHead className="text-xs font-bold py-2 px-3 border-b text-right">REAL. KG</TableHead>
            <TableHead className="text-xs font-bold py-2 px-3 border-b text-right">DESVIO</TableHead>
            <TableHead className="text-xs font-bold py-2 px-3 border-b text-right">EFIC. %</TableHead>
            <TableHead className="text-xs font-bold py-2 px-3 border-b text-right">SALDO</TableHead>
            <TableHead className="text-xs font-bold py-2 px-3 border-b text-right">DIAS</TableHead>
            <TableHead className="text-xs font-bold py-2 px-3 border-b">STATUS</TableHead>
            <TableHead className="text-xs font-bold py-2 px-3 border-b">ALERTA</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((linha) => (
            <TableRow key={linha.id} className="hover:bg-gray-50">
              <TableCell className="text-xs py-2 px-3 border-b">{formatarData(linha.data)}</TableCell>
              <TableCell className="text-xs py-2 px-3 border-b">{linha.lote_nome}</TableCell>
              <TableCell className="text-xs py-2 px-3 border-b">{linha.produto_nome}</TableCell>
              <TableCell className="text-xs py-2 px-3 border-b">{linha.cocho_nome}</TableCell>
              <TableCell className="text-xs py-2 px-3 border-b">{linha.deposito_nome}</TableCell>
              <TableCell className="text-xs py-2 px-3 border-b text-right font-mono">{formatarNumero(linha.esperado)}</TableCell>
              <TableCell className="text-xs py-2 px-3 border-b text-right font-mono">{formatarNumero(linha.realizado)}</TableCell>
              <TableCell className="text-xs py-2 px-3 border-b text-right font-mono">{formatarNumero(linha.desvio)}</TableCell>
              <TableCell className="text-xs py-2 px-3 border-b text-right font-mono">{formatarNumero(linha.eficiencia)}</TableCell>
              <TableCell className="text-xs py-2 px-3 border-b text-right font-mono">{formatarNumero(linha.saldo)}</TableCell>
              <TableCell className="text-xs py-2 px-3 border-b text-right font-mono">{formatarNumero(linha.dias_restantes)}</TableCell>
              <TableCell className="text-xs py-2 px-3 border-b">
                <Badge className={statusBadgeClass[linha.status]}>{linha.status.toUpperCase()}</Badge>
              </TableCell>
              <TableCell className="text-xs py-2 px-3 border-b">{linha.alerta}</TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-gray-100 font-bold">
            <TableCell colSpan={5} className="text-xs py-2 px-3 border-b">TOTAL GERAL</TableCell>
            <TableCell className="text-xs py-2 px-3 border-b text-right">{formatarNumero(totais.esperado)}</TableCell>
            <TableCell className="text-xs py-2 px-3 border-b text-right">{formatarNumero(totais.realizado)}</TableCell>
            <TableCell colSpan={6} className="text-xs py-2 px-3 border-b"></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </RelatorioBase>
  );
}