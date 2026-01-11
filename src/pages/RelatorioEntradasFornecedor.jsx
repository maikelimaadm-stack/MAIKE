import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import RelatorioBase from "../components/relatorios/RelatorioBase";
import { FiltroData, FiltroMultiplo, BotaoLimparFiltros } from "../components/relatorios/FiltrosRelatorio";

const formatarNumero = (num) => {
  if (!num && num !== 0) return "0,00";
  return Number(num).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function RelatorioEntradasFornecedor() {
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [fornecedoresSelecionados, setFornecedoresSelecionados] = useState([]);
  const [locaisSelecionados, setLocaisSelecionados] = useState([]);

  const empresaId = localStorage.getItem('empresa_selecionada_id');

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['movimentacoes-entradas', empresaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list('-data_movimentacao');
      return all.filter(m => 
        m.empresa_id === empresaId && 
        m.status === 'Ativa' && 
        m.tipo_movimentacao === 'Entrada' &&
        m.fornecedor_id
      );
    },
    enabled: !!empresaId,
  });

  const { data: empresaAtual } = useQuery({
    queryKey: ['empresa-atual', empresaId],
    queryFn: async () => {
      const empresas = await base44.entities.Empresa.list();
      return empresas.find(e => e.id === empresaId) || null;
    },
    enabled: !!empresaId,
  });

  const fornecedoresUnicos = [...new Set(movimentacoes.map(m => m.fornecedor_nome))].filter(Boolean).sort();
  const locaisUnicos = [...new Set(movimentacoes.map(m => m.local_estoque_destino))].filter(Boolean).sort();

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
      if (fornecedoresSelecionados.length > 0 && !fornecedoresSelecionados.includes(m.fornecedor_nome)) return false;
      if (locaisSelecionados.length > 0 && !locaisSelecionados.includes(m.local_estoque_destino)) return false;
      return true;
    });
  }, [movimentacoes, dataInicio, dataFim, fornecedoresSelecionados, locaisSelecionados]);

  const entradasPorFornecedor = useMemo(() => {
    const grupos = {};
    movimentacoesFiltradas.forEach(m => {
      const key = m.fornecedor_id;
      if (!grupos[key]) {
        grupos[key] = {
          fornecedor_nome: m.fornecedor_nome,
          quantidade_total: 0,
          valor_total: 0,
          numero_notas: 0
        };
      }
      grupos[key].quantidade_total += m.quantidade || 0;
      grupos[key].valor_total += m.valor_total || 0;
      if (m.numero_documento) grupos[key].numero_notas++;
    });
    return Object.values(grupos).sort((a, b) => b.valor_total - a.valor_total);
  }, [movimentacoesFiltradas]);

  const totalGeral = entradasPorFornecedor.reduce((acc, f) => ({
    quantidade: acc.quantidade + f.quantidade_total,
    valor: acc.valor + f.valor_total,
    notas: acc.notas + f.numero_notas
  }), { quantidade: 0, valor: 0, notas: 0 });

  const limparFiltros = () => {
    setDataInicio("");
    setDataFim("");
    setFornecedoresSelecionados([]);
    setLocaisSelecionados([]);
  };

  return (
    <RelatorioBase
      titulo="Entradas por Fornecedor"
      subtitulo="Resumo de compras por fornecedor"
      empresaAtual={empresaAtual}
      resumoTotais={`${entradasPorFornecedor.length} fornecedor(es) | ${totalGeral.notas} nota(s) | Valor: ${formatarMoeda(totalGeral.valor)}`}
      filtros={
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <FiltroData label="Data Início" value={dataInicio} onChange={setDataInicio} />
            <FiltroData label="Data Fim" value={dataFim} onChange={setDataFim} />
          </div>

          <div className="flex gap-2 flex-wrap">
            <FiltroMultiplo
              label="Fornecedores"
              selecionados={fornecedoresSelecionados}
              opcoes={fornecedoresUnicos}
              onToggle={(v) => toggleFiltro(fornecedoresSelecionados, setFornecedoresSelecionados, v)}
            />
            <FiltroMultiplo
              label="Locais"
              selecionados={locaisSelecionados}
              opcoes={locaisUnicos}
              onToggle={(v) => toggleFiltro(locaisSelecionados, setLocaisSelecionados, v)}
            />
            <BotaoLimparFiltros onClick={limparFiltros} />
          </div>
        </div>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs font-bold py-1 border border-black">Fornecedor</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Nº Notas</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd Total</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Valor Total</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Ticket Médio</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entradasPorFornecedor.map((f, idx) => {
            const ticketMedio = f.numero_notas > 0 ? f.valor_total / f.numero_notas : 0;
            return (
              <TableRow key={idx} className="hover:bg-gray-50">
                <TableCell className="text-xs py-1 border border-gray-300">{f.fornecedor_nome}</TableCell>
                <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{f.numero_notas}</TableCell>
                <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(f.quantidade_total)}</TableCell>
                <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold">{formatarMoeda(f.valor_total)}</TableCell>
                <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoeda(ticketMedio)}</TableCell>
              </TableRow>
            );
          })}
          <TableRow className="bg-gray-100 font-bold">
            <TableCell className="text-xs py-1 border border-black">TOTAL</TableCell>
            <TableCell className="text-xs py-1 border border-black text-right">{totalGeral.notas}</TableCell>
            <TableCell className="text-xs py-1 border border-black text-right">{formatarNumero(totalGeral.quantidade)}</TableCell>
            <TableCell className="text-xs py-1 border border-black text-right">{formatarMoeda(totalGeral.valor)}</TableCell>
            <TableCell className="text-xs py-1 border border-black"></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </RelatorioBase>
  );
}