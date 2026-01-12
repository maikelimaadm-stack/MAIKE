import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import RelatorioBase from "../components/relatorios/RelatorioBase";
import { FiltroMultiplo, FiltroSelect, BotaoLimparFiltros } from "../components/relatorios/FiltrosRelatorio";

const formatarNumero = (num) => {
  if (!num && num !== 0) return "0,00";
  return Number(num).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function RelatorioSaldoAtual() {
  const [locaisSelecionados, setLocaisSelecionados] = useState([]);
  const [categoriasSelecionadas, setCategoriasSelecionadas] = useState([]);
  const [apenasComSaldo, setApenasComSaldo] = useState(false);
  const [ordenacao, setOrdenacao] = useState('nome_asc');

  const empresaId = localStorage.getItem('empresa_selecionada_id');

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-saldo', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaId);
    },
    enabled: !!empresaId,
  });

  const { data: locais = [] } = useQuery({
    queryKey: ['locais-saldo'] ,
    queryFn: () => base44.entities.LocalEstoque.list(),
  });

  const { data: lotesNota = [] } = useQuery({
    queryKey: ['lotes-nota-saldo', empresaId],
    queryFn: async () => {
      const all = await base44.entities.EstoqueLoteNota.list();
      return all.filter(l => l.empresa_id === empresaId && l.status === 'Disponivel');
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

  // Calcular saldo por produto e local a partir dos lotes
  const saldosPorProdutoLocal = useMemo(() => {
    const saldos = {};
    lotesNota.forEach(l => {
      const key = `${l.produto_id}_${l.local_estoque_id}`;
      if (!saldos[key]) {
        saldos[key] = {
          produto_id: l.produto_id,
          produto_nome: l.produto_nome,
          local_estoque_id: l.local_estoque_id,
          local_estoque_nome: l.local_estoque_nome,
          quantidade: 0,
          custo_medio: 0,
          valor_total: 0
        };
      }
      const qtd = l.quantidade_disponivel || 0;
      const custo = l.custo_unitario || 0;
      const valorAnt = saldos[key].quantidade * saldos[key].custo_medio;
      const valorNovo = qtd * custo;
      saldos[key].quantidade += qtd;
      saldos[key].custo_medio = saldos[key].quantidade > 0 ? (valorAnt + valorNovo) / saldos[key].quantidade : 0;
      saldos[key].valor_total = saldos[key].quantidade * saldos[key].custo_medio;
    });
    return Object.values(saldos);
  }, [lotesNota]);

  // Enriquecer com dados do produto
  const dadosCompletos = useMemo(() => {
    return saldosPorProdutoLocal.map(s => {
      const prod = produtos.find(p => p.id === s.produto_id);
      return {
        ...s,
        numero_produto: prod?.numero_produto,
        codigo_interno: prod?.codigo_interno,
        categoria: prod?.categoria,
        unidade_medida: prod?.unidade_medida,
        estoque_minimo: prod?.estoque_minimo || 0
      };
    });
  }, [saldosPorProdutoLocal, produtos]);

  const locaisOpcoes = locais.map(l => l.id);
  const nomeLocal = (id) => locais.find(l => l.id === id)?.nome || id;
  const categoriasUnicas = [...new Set(dadosCompletos.map(d => d.categoria))].filter(Boolean).sort();

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev => prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]);
  };

  const dadosFiltrados = useMemo(() => {
    let filtered = dadosCompletos.filter(d => {
      if (locaisSelecionados.length > 0 && !locaisSelecionados.includes(d.local_estoque_id)) return false;
      if (categoriasSelecionadas.length > 0 && !categoriasSelecionadas.includes(d.categoria)) return false;
      if (apenasComSaldo && d.quantidade <= 0) return false;
      return true;
    });

    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'nome_asc': return (a.produto_nome || '').localeCompare(b.produto_nome || '');
        case 'nome_desc': return (b.produto_nome || '').localeCompare(a.produto_nome || '');
        case 'saldo_asc': return (a.quantidade || 0) - (b.quantidade || 0);
        case 'saldo_desc': return (b.quantidade || 0) - (a.quantidade || 0);
        case 'valor_asc': return (a.valor_total || 0) - (b.valor_total || 0);
        case 'valor_desc': return (b.valor_total || 0) - (a.valor_total || 0);
        default: return 0;
      }
    });

    return filtered;
  }, [dadosCompletos, locaisSelecionados, categoriasSelecionadas, apenasComSaldo, ordenacao]);

  const totalItens = dadosFiltrados.length;
  const totalQuantidade = dadosFiltrados.reduce((s, d) => s + (d.quantidade || 0), 0);
  const totalValor = dadosFiltrados.reduce((s, d) => s + (d.valor_total || 0), 0);

  const limparFiltros = () => {
    setLocaisSelecionados([]);
    setCategoriasSelecionadas([]);
    setApenasComSaldo(false);
    setOrdenacao('nome_asc');
  };

  return (
    <RelatorioBase
      titulo="Relatório de Saldo Atual"
      subtitulo="Estoque por produto e local"
      empresaAtual={empresaAtual}
      resumoTotais={`${totalItens} item(ns) | Quantidade Total: ${formatarNumero(totalQuantidade)} | Valor Total: ${formatarMoeda(totalValor)}`}
      filtros={
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <FiltroSelect
              label="Ordenar Por"
              value={ordenacao}
              onChange={setOrdenacao}
              opcoes={[
                { value: 'nome_asc', label: 'Nome (A-Z)' },
                { value: 'nome_desc', label: 'Nome (Z-A)' },
                { value: 'saldo_asc', label: 'Saldo (Menor)' },
                { value: 'saldo_desc', label: 'Saldo (Maior)' },
                { value: 'valor_asc', label: 'Valor (Menor)' },
                { value: 'valor_desc', label: 'Valor (Maior)' },
              ]}
            />
            
            <div className="space-y-1 flex items-end">
              <div className="flex items-center space-x-2">
                <input 
                  type="checkbox" 
                  id="apenasComSaldo"
                  checked={apenasComSaldo} 
                  onChange={(e) => setApenasComSaldo(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="apenasComSaldo" className="text-xs cursor-pointer">Apenas com saldo</label>
              </div>
            </div>
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
              label="Categorias"
              selecionados={categoriasSelecionadas}
              opcoes={categoriasUnicas}
              onToggle={(v) => toggleFiltro(categoriasSelecionadas, setCategoriasSelecionadas, v)}
            />
            <BotaoLimparFiltros onClick={limparFiltros} />
          </div>
        </div>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs font-bold py-1 border border-black">Nº</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Código</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Categoria</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">Local</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black">UN</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Saldo</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo Médio</TableHead>
            <TableHead className="text-xs font-bold py-1 border border-black text-right">Valor Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dadosFiltrados.map((d, idx) => (
            <TableRow key={idx} className="hover:bg-gray-50">
              <TableCell className="text-xs py-1 border border-gray-300">{d.numero_produto || '-'}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{d.codigo_interno || '-'}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{d.produto_nome}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{d.categoria || '-'}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{d.local_estoque_nome}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300">{d.unidade_medida || 'UN'}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarNumero(d.quantidade)}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoeda(d.custo_medio)}</TableCell>
              <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold">{formatarMoeda(d.valor_total)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-gray-100 font-bold">
            <TableCell colSpan={6} className="text-xs py-1 border border-black">TOTAL</TableCell>
            <TableCell className="text-xs py-1 border border-black text-right">{formatarNumero(totalQuantidade)}</TableCell>
            <TableCell className="text-xs py-1 border border-black text-right">-</TableCell>
            <TableCell className="text-xs py-1 border border-black text-right">{formatarMoeda(totalValor)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </RelatorioBase>
  );
}