import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import RelatorioBase from "../components/relatorios/RelatorioBase";
import { FiltroData, FiltroMultiplo, BotaoLimparFiltros } from "../components/relatorios/FiltrosRelatorio";
import { getLabelOperacao } from "../components/movimentacoes/utils/movimentacaoUtils";

const formatarNumero = (num) => {
  if (!num && num !== 0) return "0,00";
  return Number(num).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function RelatorioConsumoPeriodo() {
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [locaisSelecionados, setLocaisSelecionados] = useState([]);
  const [operacoesSelecionadas, setOperacoesSelecionadas] = useState([]);

  const empresaId = localStorage.getItem('empresa_selecionada_id');

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['movimentacoes-consumo', empresaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list();
      return all.filter(m => 
        m.empresa_id === empresaId && 
        m.status === 'Ativa' && 
        m.tipo_movimentacao === 'Saída'
      );
    },
    enabled: !!empresaId,
  });

  const { data: locais = [] } = useQuery({
    queryKey: ['locais-consumo'],
    queryFn: () => base44.entities.LocalEstoque.list(),
  });

  const { data: empresaAtual } = useQuery({
    queryKey: ['empresa-atual', empresaId],
    queryFn: async () => {
      const empresas = await base44.entities.Empresa.list();
      return empresas.find(e => e.id === empresaId) || null;
    },
    enabled: !!empresaId,
  });

  const operacoesUnicas = [...new Set(movimentacoes.map(m => m.tipo_detalhado))].filter(Boolean).sort();
  const locaisOpcoes = locais.map(l => l.id);
  const nomeLocal = (id) => locais.find(l => l.id === id)?.nome || id;

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev => prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]);
  };

  const movimentacoesFiltradas = useMemo(() => {
    return movimentacoes.filter(m => {
      if (dataInicio) {
        const mDate = new Date(m.data_movimentacao);
        const iDate = new Date(dataInicio);
        iDate.setHours(0, 0, 0, 0);
        if (mDate < iDate) return false;
      }
      if (dataFim) {
        const mDate = new Date(m.data_movimentacao);
        const fDate = new Date(dataFim);
        fDate.setHours(23, 59, 59, 999);
        if (mDate > fDate) return false;
      }
      if (locaisSelecionados.length > 0 && !locaisSelecionados.includes(m.local_estoque_origem)) return false;
      if (operacoesSelecionadas.length > 0 && !operacoesSelecionadas.includes(m.tipo_detalhado)) return false;
      return true;
    });
  }, [movimentacoes, dataInicio, dataFim, locaisSelecionados, operacoesSelecionadas]);

  const consumoPorProduto = useMemo(() => {
    const grupos = {};
    movimentacoesFiltradas.forEach(m => {
      const key = m.produto_id;
      if (!grupos[key]) {
        grupos[key] = {
          produto_nome: m.produto_nome,
          codigo: m.produto_codigo,
          unidade: m.unidade_medida,
          quantidade_total: 0,
          valor_total: 0
        };
      }
      grupos[key].quantidade_total += m.quantidade || 0;
      grupos[key].valor_total += m.valor_total || 0;
    });
    return Object.values(grupos).sort((a, b) => b.valor_total - a.valor_total);
  }, [movimentacoesFiltradas]);

  const totalGeral = consumoPorProduto.reduce((acc, p) => ({
    quantidade: acc.quantidade + p.quantidade_total,
    valor: acc.valor + p.valor_total
  }), { quantidade: 0, valor: 0 });

  const limparFiltros = () => {
    setDataInicio("");
    setDataFim("");
    setLocaisSelecionados([]);
    setOperacoesSelecionadas([]);
  };

  return (
    <RelatorioBase
      titulo="Consumo por Período"
      subtitulo="Total consumido por produto"
      empresaAtual={empresaAtual}
      resumoTotais={`${consumoPorProduto.length} produto(s) | Quantidade: ${formatarNumero(totalGeral.quantidade)} | Valor: ${formatarMoeda(totalGeral.valor)}`}
      filtros={
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <FiltroData label="Data Início" value={dataInicio} onChange={setDataInicio} />
            <FiltroData label="Data Fim" value={dataFim} onChange={setDataFim} />
          </div>

          <div className="flex gap-2 flex-wrap">
            <FiltroMultiplo
              label="Locais"
              selecionados={locaisSelecionados}
              opcoes={locaisOpcoes}
              renderLabel={nomeLocal}
              onToggle={(v) => toggleFiltro(locaisSelecionados, setLocaisSelecionados, v)}
            />
            <FiltroMultiplo
              label="Operações"
              selecionados={operacoesSelecionadas}
              opcoes={operacoesUnicas}
              renderLabel={getLabelOperacao}
              onToggle={(v) => toggleFiltro(operacoesSelecionadas, setOperacoesSelecionadas, v)}
            />
            <BotaoLimparFiltros onClick={limparFiltros} />
          </div>
        </div>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Código</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">UN</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd Consumida</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Valor Total</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo Médio</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {consumoPorProduto.map((p, idx) => {
            const custoMedio = p.quantidade_total > 0 ? p.valor_total / p.quantidade_total : 0;
            return (
              <TableRow key={idx} className="hover:bg-gray-50">
                <TableCell className="text-xs py-1 border border-gray-300">{p.produto_nome}</TableCell>
                <TableCell className="text-xs py-1 border border-gray-300">{p.codigo || '-'}</TableCell>
                <TableCell className="text-xs py-1 border border-gray-300">{p.unidade || 'UN'}</TableCell>
                <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(p.quantidade_total)}</TableCell>
                <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold">{formatarMoeda(p.valor_total)}</TableCell>
                <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoeda(custoMedio)}</TableCell>
              </TableRow>
            );
          })}
          <TableRow className="bg-gray-100 font-bold">
            <TableCell colSpan={3} className="text-xs py-1 border border-black">TOTAL</TableCell>
            <TableCell className="text-xs py-1 border border-black text-right">{formatarNumero(totalGeral.quantidade)}</TableCell>
            <TableCell className="text-xs py-1 border border-black text-right">{formatarMoeda(totalGeral.valor)}</TableCell>
            <TableCell className="text-xs py-1 border border-black"></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </RelatorioBase>
  );
}