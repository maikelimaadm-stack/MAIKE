import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import RelatorioBase from "../components/relatorios/RelatorioBase";
import { FiltroData, BotaoLimparFiltros } from "../components/relatorios/FiltrosRelatorio";
import { format } from "date-fns";
import AutocompleteGenerico from "../components/financeiro/AutocompleteGenerico";
import { getLocalEstoque, getLabelOperacao } from "../components/movimentacoes/utils/movimentacaoUtils";
import { impactoSaldo } from "@/services/estoqueService";

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
    return format(new Date(dataString), 'dd/MM/yyyy HH:mm');
  } catch {
    return '-';
  }
};

export default function RelatorioKardex() {
  const [produtoId, setProdutoId] = useState("");
  const [localEstoqueId, setLocalEstoqueId] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  const empresaId = localStorage.getItem('empresa_selecionada_id');

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-kardex', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaId);
    },
    enabled: !!empresaId,
  });

  const { data: locais = [] } = useQuery({
    queryKey: ['locais-kardex'],
    queryFn: () => base44.entities.LocalEstoque.list(),
  });

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['movimentacoes-kardex', empresaId, produtoId, localEstoqueId],
    queryFn: async () => {
      if (!produtoId) return [];
      const all = await base44.entities.MovimentacaoEstoque.list('data_movimentacao');
      return all.filter(m => 
        m.empresa_id === empresaId && 
        m.status === 'Ativa' &&
        m.produto_id === produtoId &&
        (localEstoqueId ? (m.local_estoque_origem === localEstoqueId || m.local_estoque_destino === localEstoqueId) : true)
        );
    },
    enabled: !!empresaId && !!produtoId,
  });

  const { data: empresaAtual } = useQuery({
    queryKey: ['empresa-atual', empresaId],
    queryFn: async () => {
      const empresas = await base44.entities.Empresa.list();
      return empresas.find(e => e.id === empresaId) || null;
    },
    enabled: !!empresaId,
  });

  const produtoSelecionado = produtos.find(p => p.id === produtoId);
  const localSelecionado = locais.find(l => l.id === localEstoqueId);

  const movimentacoesOrdenadas = useMemo(
    () => [...movimentacoes].sort((a, b) => new Date(a.data_movimentacao) - new Date(b.data_movimentacao)),
    [movimentacoes],
  );

  // Saldo de ABERTURA: soma de tudo que ocorreu ANTES da data inicial do filtro.
  // (Antes o saldo progressivo começava em 0, ignorando o histórico anterior.)
  const saldoAbertura = useMemo(() => {
    if (!dataInicio) return 0;
    const iDate = new Date(dataInicio);
    iDate.setHours(0, 0, 0, 0);
    return movimentacoesOrdenadas
      .filter((m) => new Date(m.data_movimentacao) < iDate)
      .reduce((saldo, m) => saldo + impactoSaldo(m, localEstoqueId || null), 0);
  }, [movimentacoesOrdenadas, dataInicio, localEstoqueId]);

  const movimentacoesFiltradas = useMemo(() => {
    return movimentacoesOrdenadas.filter(m => {
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
      return true;
    });
  }, [movimentacoesOrdenadas, dataInicio, dataFim]);

  // Calcular saldo progressivo (partindo do saldo de abertura)
  const movimentacoesComSaldo = useMemo(() => {
    let saldo = saldoAbertura;
    return movimentacoesFiltradas.map(m => {
      const delta = impactoSaldo(m, localEstoqueId || null);
      saldo += delta;
      return { ...m, delta_saldo: delta, saldo_apos: saldo };
    });
  }, [movimentacoesFiltradas, localEstoqueId, saldoAbertura]);

  const limparFiltros = () => {
    setDataInicio("");
    setDataFim("");
    setProdutoId("");
    setLocalEstoqueId("");
  };

  return (
    <RelatorioBase
      titulo="Kardex do Produto"
      subtitulo="Movimentações detalhadas com saldo progressivo"
      empresaAtual={empresaAtual}
      resumoTotais={produtoSelecionado ? `Produto: ${produtoSelecionado.nome_produto} ${localSelecionado ? `| Local: ${localSelecionado.nome}` : ''} | ${movimentacoesComSaldo.length} movimentações` : 'Selecione um produto'}
      filtros={
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Produto *</Label>
              <AutocompleteGenerico
                items={produtos}
                value={produtoId}
                onChange={setProdutoId}
                placeholder="Selecione o produto"
                displayField="nome_produto"
                searchFields={["nome_produto", "codigo_interno", "codigo_barras"]}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Local (opcional)</Label>
              <AutocompleteGenerico
                items={locais}
                value={localEstoqueId}
                onChange={setLocalEstoqueId}
                placeholder="Todos"
                displayField="nome"
                searchFields={["nome"]}
                className="h-8"
              />
            </div>
            <FiltroData label="Data Início" value={dataInicio} onChange={setDataInicio} />
            <FiltroData label="Data Fim" value={dataFim} onChange={setDataFim} />
          </div>

          <div className="flex gap-2">
            <BotaoLimparFiltros onClick={limparFiltros} />
          </div>
        </div>
      }
    >
      {!produtoId ? (
        <div className="text-center py-12 text-slate-400">
          <p className="text-sm">Selecione um produto para visualizar o kardex</p>
        </div>
      ) : movimentacoesComSaldo.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p className="text-sm">Nenhuma movimentação encontrada para este produto</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-bold py-1 border border-black">Data</TableHead>
              <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>
              <TableHead className="text-xs font-bold py-1 border border-black">Operação</TableHead>
              <TableHead className="text-xs font-bold py-1 border border-black">Documento</TableHead>
              <TableHead className="text-xs font-bold py-1 border border-black text-right">Entrada</TableHead>
              <TableHead className="text-xs font-bold py-1 border border-black text-right">Saída</TableHead>
              <TableHead className="text-xs font-bold py-1 border border-black text-right bg-blue-50">Saldo</TableHead>
              <TableHead className="text-xs font-bold py-1 border border-black text-right">Custo Unit.</TableHead>
              <TableHead className="text-xs font-bold py-1 border border-black text-right">Valor</TableHead>
              <TableHead className="text-xs font-bold py-1 border border-black">Origem/Destino</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movimentacoesComSaldo.map((m) => {
              // delta_saldo já traz o sinal correto (entrada +, saída -, transferência por local)
              const delta = m.delta_saldo || 0;
              const qtdEntrada = delta > 0 ? delta : 0;
              const qtdSaida = delta < 0 ? Math.abs(delta) : 0;

              return (
                <TableRow key={m.id} className="hover:bg-gray-50">
                  <TableCell className="text-xs py-1 border border-gray-300">{formatarData(m.data_movimentacao)}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{m.tipo_movimentacao}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{getLabelOperacao(m.tipo_detalhado)}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{m.numero_documento || '-'}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono text-green-700">
                    {qtdEntrada > 0 ? formatarNumero(qtdEntrada) : ''}
                  </TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono text-red-700">
                    {qtdSaida > 0 ? formatarNumero(qtdSaida) : ''}
                  </TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold bg-blue-50">
                    {formatarNumero(m.saldo_apos)}
                  </TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoeda(m.valor_unitario)}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{formatarMoeda(m.valor_total)}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">
                    {m.fornecedor_nome || m.cliente_nome || getLocalEstoque(m) || '-'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </RelatorioBase>
  );
}