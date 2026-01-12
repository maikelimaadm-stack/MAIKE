import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import RelatorioBase from "../components/relatorios/RelatorioBase";
import { FiltroData, FiltroMultiplo, FiltroSelect, BotaoLimparFiltros } from "../components/relatorios/FiltrosRelatorio";
import { format } from "date-fns";
import { toLabel, getLocalEstoque, getLabelOperacao } from "../components/movimentacoes/utils/movimentacaoUtils";

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

export default function RelatorioExtratoMovimentacoes() {
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [tiposSelecionados, setTiposSelecionados] = useState([]);
  const [operacoesSelecionadas, setOperacoesSelecionadas] = useState([]);
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [locaisSelecionados, setLocaisSelecionados] = useState([]);
  const [documentosSelecionados, setDocumentosSelecionados] = useState([]);
  const [ordenacao, setOrdenacao] = useState('data_desc');

  const empresaId = localStorage.getItem('empresa_selecionada_id');

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['movimentacoes-extrato', empresaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list('-data_movimentacao');
      return all.filter(m => m.empresa_id === empresaId && m.status === 'Ativa');
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

  const tiposUnicos = ['Entrada', 'Saída', 'Transferência', 'Ajuste'];
  // Operações únicas: extrair values únicos das movimentações
  const operacoesUnicasValues = [...new Set(movimentacoes.map(m => m.tipo_detalhado))].filter(Boolean).sort();
  const produtosUnicos = [...new Set(movimentacoes.map(m => m.produto_nome))].filter(Boolean).sort();
  // Locais usando função utilitária correta
  const locaisUnicos = [...new Set(movimentacoes.map(m => getLocalEstoque(m)))].filter(Boolean).sort();
  const documentosUnicos = [...new Set(movimentacoes.map(m => m.numero_documento))].filter(Boolean).sort();

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev => prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]);
  };

  const movimentacoesFiltradas = useMemo(() => {
    let filtered = movimentacoes.filter(m => {
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
      if (tiposSelecionados.length > 0 && !tiposSelecionados.includes(m.tipo_movimentacao)) return false;
      if (operacoesSelecionadas.length > 0 && !operacoesSelecionadas.includes(m.tipo_detalhado)) return false;
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(m.produto_nome)) return false;
      if (locaisSelecionados.length > 0) {
        const local = getLocalEstoque(m);
        if (!locaisSelecionados.includes(local)) return false;
      }
      if (documentosSelecionados.length > 0 && !documentosSelecionados.includes(m.numero_documento)) return false;
      return true;
    });

    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'data_desc': return new Date(b.data_movimentacao || 0) - new Date(a.data_movimentacao || 0);
        case 'data_asc': return new Date(a.data_movimentacao || 0) - new Date(b.data_movimentacao || 0);
        case 'valor_desc': return (b.valor_total || 0) - (a.valor_total || 0);
        case 'valor_asc': return (a.valor_total || 0) - (b.valor_total || 0);
        default: return 0;
      }
    });

    return filtered;
  }, [movimentacoes, dataInicio, dataFim, tiposSelecionados, operacoesSelecionadas, produtosSelecionados, locaisSelecionados, documentosSelecionados, ordenacao]);

  const totalEntradas = movimentacoesFiltradas.filter(m => m.tipo_movimentacao === 'Entrada').reduce((s, m) => s + (m.quantidade || 0), 0);
  const totalSaidas = movimentacoesFiltradas.filter(m => m.tipo_movimentacao === 'Saída').reduce((s, m) => s + (m.quantidade || 0), 0);
  const valorEntradas = movimentacoesFiltradas.filter(m => m.tipo_movimentacao === 'Entrada').reduce((s, m) => s + (m.valor_total || 0), 0);
  const valorSaidas = movimentacoesFiltradas.filter(m => m.tipo_movimentacao === 'Saída').reduce((s, m) => s + (m.valor_total || 0), 0);

  const limparFiltros = () => {
    setDataInicio("");
    setDataFim("");
    setTiposSelecionados([]);
    setOperacoesSelecionadas([]);
    setProdutosSelecionados([]);
    setLocaisSelecionados([]);
    setDocumentosSelecionados([]);
    setOrdenacao('data_desc');
  };

  return (
    <RelatorioBase
      titulo="Extrato de Movimentações"
      subtitulo="Todas as movimentações de estoque"
      empresaAtual={empresaAtual}
      resumoTotais={`${movimentacoesFiltradas.length} movimentações | E: ${formatarNumero(totalEntradas)} (${formatarMoeda(valorEntradas)}) | S: ${formatarNumero(totalSaidas)} (${formatarMoeda(valorSaidas)})`}
      filtros={
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <FiltroData label="Data Início" value={dataInicio} onChange={setDataInicio} />
            <FiltroData label="Data Fim" value={dataFim} onChange={setDataFim} />
            <FiltroSelect
              label="Ordenar Por"
              value={ordenacao}
              onChange={setOrdenacao}
              opcoes={[
                { value: 'data_desc', label: 'Data (Mais Recente)' },
                { value: 'data_asc', label: 'Data (Mais Antiga)' },
                { value: 'valor_desc', label: 'Valor (Maior)' },
                { value: 'valor_asc', label: 'Valor (Menor)' },
              ]}
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <FiltroMultiplo
              label="Tipos"
              selecionados={tiposSelecionados}
              opcoes={tiposUnicos}
              onToggle={(v) => toggleFiltro(tiposSelecionados, setTiposSelecionados, v)}
            />
            <FiltroMultiplo
              label="Operações"
              selecionados={operacoesSelecionadas}
              opcoes={operacoesUnicasValues}
              renderLabel={getLabelOperacao}
              onToggle={(v) => toggleFiltro(operacoesSelecionadas, setOperacoesSelecionadas, v)}
            />
            <FiltroMultiplo
              label="Produtos"
              selecionados={produtosSelecionados}
              opcoes={produtosUnicos}
              onToggle={(v) => toggleFiltro(produtosSelecionados, setProdutosSelecionados, v)}
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
            <TableHead className="text-xs font-bold py-1 border border-black">Data</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Operação</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">UN</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Vlr Unit.</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Vlr Total</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Origem</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Destino</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Doc.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {movimentacoesFiltradas.map((m) => (
            <TableRow key={m.id} className="hover:bg-gray-50">
              <TableCell className="text-xs py-1 border border-gray-300">{formatarData(m.data_movimentacao)}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{m.tipo_movimentacao}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{getLabelOperacao(m.tipo_detalhado)}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{m.produto_nome}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(m.quantidade)}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{m.unidade_medida || 'UN'}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoeda(m.valor_unitario)}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold">{formatarMoeda(m.valor_total)}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{m.local_estoque_origem || '-'}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{m.local_estoque_destino || '-'}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{m.numero_documento || '-'}</TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-gray-100 font-bold">
            <TableCell colSpan={4} className="text-xs py-1 border border-black">TOTAL</TableCell>
            <TableCell className="text-xs py-1 border border-black text-right">-</TableCell>
            <TableCell className="text-xs py-1 border border-black" colSpan={2}>-</TableCell>
            <TableCell className="text-xs py-1 border border-black text-right">
              E: {formatarMoeda(valorEntradas)} | S: {formatarMoeda(valorSaidas)}
            </TableCell>
            <TableCell colSpan={3} className="text-xs py-1 border border-black"></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </RelatorioBase>
  );
}