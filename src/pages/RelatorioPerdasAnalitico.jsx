import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import RelatorioBase from "../components/relatorios/RelatorioBase";
import { FiltroData, FiltroMultiplo, BotaoLimparFiltros } from "../components/relatorios/FiltrosRelatorio";
import { format } from "date-fns";
import { getLocalEstoque, getLabelOperacao } from "../components/movimentacoes/utils/movimentacaoUtils";

const formatarNumero = (num) => {
  if (!num && num !== 0) return "0,00";
  return Number(num).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatarData = (dataString) => {
  if (!dataString) return '-';
  try {
    return format(new Date(dataString), 'dd/MM/yyyy');
  } catch {
    return '-';
  }
};

export default function RelatorioPerdasAnalitico() {
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [motivosSelecionados, setMotivosSelecionados] = useState([]);
  const [locaisSelecionados, setLocaisSelecionados] = useState([]);
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);

  const empresaId = localStorage.getItem('empresa_selecionada_id');

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['movimentacoes-perdas', empresaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list('-data_movimentacao');
      return all.filter(m => 
        m.empresa_id === empresaId && 
        m.status === 'Ativa' && 
        m.tipo_movimentacao === 'Saída' &&
        m.tipo_detalhado === 'perda_quebra'
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

  const { data: locais = [] } = useQuery({
    queryKey: ['locais-perdas'],
    queryFn: () => base44.entities.LocalEstoque.list(),
  });

  const motivosUnicos = [...new Set(movimentacoes.map(m => m.motivo_perda || m.motivo_movimentacao))].filter(Boolean).sort();
  const locaisOpcoes = locais.map(l => l.id);
  const nomeLocal = (id) => locais.find(l => l.id === id)?.nome || id;
  const produtosUnicos = [...new Set(movimentacoes.map(m => m.produto_nome))].filter(Boolean).sort();

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
      const motivo = m.motivo_perda || m.motivo_movimentacao;
      if (motivosSelecionados.length > 0 && !motivosSelecionados.includes(motivo)) return false;
      if (locaisSelecionados.length > 0 && !locaisSelecionados.includes(m.local_estoque_origem)) return false;
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(m.produto_nome)) return false;
      return true;
    });
  }, [movimentacoes, dataInicio, dataFim, motivosSelecionados, locaisSelecionados, produtosSelecionados]);

  const totalQuantidade = movimentacoesFiltradas.reduce((s, m) => s + (m.quantidade || 0), 0);
  const totalValor = movimentacoesFiltradas.reduce((s, m) => s + (m.valor_total || 0), 0);

  const limparFiltros = () => {
    setDataInicio("");
    setDataFim("");
    setMotivosSelecionados([]);
    setLocaisSelecionados([]);
    setProdutosSelecionados([]);
  };

  return (
    <RelatorioBase
      titulo="Perdas e Quebras"
      subtitulo="Análise de perdas de estoque"
      empresaAtual={empresaAtual}
      resumoTotais={`${movimentacoesFiltradas.length} ocorrências | Quantidade: ${formatarNumero(totalQuantidade)} | Valor: ${formatarMoeda(totalValor)}`}
      filtros={
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <FiltroData label="Data Início" value={dataInicio} onChange={setDataInicio} />
            <FiltroData label="Data Fim" value={dataFim} onChange={setDataFim} />
          </div>

          <div className="flex gap-2 flex-wrap">
            <FiltroMultiplo
              label="Motivos"
              selecionados={motivosSelecionados}
              opcoes={motivosUnicos}
              onToggle={(v) => toggleFiltro(motivosSelecionados, setMotivosSelecionados, v)}
            />
            <FiltroMultiplo
              label="Locais"
              selecionados={locaisSelecionados}
              opcoes={locaisOpcoes}
              renderLabel={nomeLocal}
              onToggle={(v) => toggleFiltro(locaisSelecionados, setLocaisSelecionados, v)}
            />
            <FiltroMultiplo
              label="Produtos"
              selecionados={produtosSelecionados}
              opcoes={produtosUnicos}
              onToggle={(v) => toggleFiltro(produtosSelecionados, setProdutosSelecionados, v)}
            />
            <BotaoLimparFiltros onClick={limparFiltros} />
          </div>
        </div>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs font-bold py-1 border border-black">Data</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Local</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Vlr Unit.</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Vlr Total</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Motivo</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Detalhamento</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Responsável</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {movimentacoesFiltradas.map((m) => (
            <TableRow key={m.id} className="hover:bg-gray-50">
              <TableCell className="text-xs py-1 border border-gray-300">{formatarData(m.data_movimentacao)}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{m.produto_nome}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{nomeLocal(m.local_estoque_origem) || '-'}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(m.quantidade)}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoeda(m.valor_unitario)}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold">{formatarMoeda(m.valor_total)}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{m.motivo_perda || '-'}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300 max-w-[150px] truncate">{m.motivo_movimentacao || '-'}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{m.usuario_responsavel || m.created_by || '-'}</TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-gray-100 font-bold">
            <TableCell colSpan={3} className="text-xs py-1 border border-black">TOTAL</TableCell>
            <TableCell className="text-xs py-1 border border-black text-right">{formatarNumero(totalQuantidade)}</TableCell>
            <TableCell className="text-xs py-1 border border-black"></TableCell>
            <TableCell className="text-xs py-1 border border-black text-right">{formatarMoeda(totalValor)}</TableCell>
            <TableCell colSpan={3} className="text-xs py-1 border border-black"></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </RelatorioBase>
  );
}