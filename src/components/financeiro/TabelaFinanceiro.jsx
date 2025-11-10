
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, DollarSign, Search, Settings, Eye, ArrowUpDown, ArrowUp, ArrowDown, Package, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0";
  const num = typeof numero === 'number' ? numero : parseFloat(String(numero).replace(/\./g, '').replace(',', '.'));
  if (isNaN(num)) return "0";
  return num.toLocaleString('pt-BR');
};

const formatarNumeroDecimal = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  const num = typeof numero === 'number' ? numero : parseFloat(String(numero).replace(/\./g, '').replace(',', '.'));
  if (isNaN(num)) return "0,00";
  return num.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const formatarData = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString + 'T00:00:00');
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR');
  } catch {
    return '-';
  }
};

const formatarDataHora = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleString('pt-BR');
  } catch {
    return '-';
  }
};

const calcularDias = (dataVencimento) => {
  if (!dataVencimento) return '-';
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const venc = new Date(dataVencimento + 'T00:00:00');
    if (isNaN(venc.getTime())) return '-';
    venc.setHours(0, 0, 0, 0);
    const diff = Math.floor((venc - hoje) / (1000 * 60 * 60 * 24));
    
    if (diff > 0) return `${diff}d p/ vencer`;
    if (diff < 0) return `${Math.abs(diff)}d vencido`;
    return 'Vence hoje';
  } catch {
    return '-';
  }
};

const getBadgeStyle = (status) => {
  const styles = {
    'Pendente': 'bg-yellow-100 text-yellow-800',
    'Pago Parcial': 'bg-blue-100 text-blue-800',
    'Pago': 'bg-green-100 text-green-800',
    'Vencido': 'bg-red-100 text-red-800',
    'Cancelado': 'bg-gray-100 text-gray-800',
  };
  return styles[status] || 'bg-gray-100 text-gray-800';
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true },
  { id: 'emissao', label: 'Emissão', default: true },
  { id: 'vencimento', label: 'Vencimento', default: true },
  { id: 'dias', label: 'Dias', default: true },
  { id: 'fornecedor_cliente', label: 'Fornecedor/Cliente', default: true },
  { id: 'tipo_documento', label: 'Tipo Doc', default: true },
  { id: 'documento', label: 'Nº Doc', default: true },
  { id: 'chave_nfe', label: 'Chave NF-e', default: false },
  { id: 'serie', label: 'Série', default: false },
  { id: 'cfop', label: 'CFOP', default: false },
  { id: 'valor_original', label: 'Vlr. Original', default: false },
  { id: 'valor_total', label: 'Vlr. Total', default: true },
  { id: 'valor_pago', label: 'Vlr. Pago', default: true },
  { id: 'saldo', label: 'Vlr. Saldo', default: true },
  { id: 'status', label: 'Status', default: true },
  { id: 'safra', label: 'Safra', default: false },
  { id: 'centro_custo', label: 'Centro Custo', default: false },
  { id: 'plano_contas', label: 'Plano Contas', default: false },
  { id: 'grupo', label: 'Grupo', default: false },
  { id: 'forma_pagamento', label: 'Forma Pgto', default: false },
  { id: 'lancar_produtos', label: 'Lançou Produtos', default: false },
  { id: 'dar_entrada_estoque', label: 'Entrada Estoque', default: false },
  { id: 'local_estoque', label: 'Local Estoque', default: false },
  { id: 'valor_produtos_nfe', label: 'Vlr. Produtos NF-e', default: false },
  { id: 'valor_frete_nfe', label: 'Vlr. Frete NF-e', default: false },
  { id: 'valor_seguro_nfe', label: 'Vlr. Seguro NF-e', default: false },
  { id: 'valor_outras_despesas_nfe', label: 'Outras Desp. NF-e', default: false },
  { id: 'valor_desconto_total_nfe', label: 'Desc. Total NF-e', default: false },
  { id: 'valor_ipi', label: 'IPI', default: false },
  { id: 'valor_icms', label: 'ICMS', default: false },
  { id: 'valor_pis', label: 'PIS', default: false },
  { id: 'valor_cofins', label: 'COFINS', default: false },
  { id: 'base_calculo_icms', label: 'Base Cálc. ICMS', default: false },
  { id: 'observacoes', label: 'Observações', default: false },
  { id: 'observacoes_nfe', label: 'Obs. NF-e', default: false },
];

export default function TabelaFinanceiro({ lancamentos, tipo, onEdit, onDelete, onBaixa, onCancelarBaixa, isLoading, fornecedores, produtos }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("vencimento");
  const [sortDirection, setSortDirection] = useState("asc");
  const [detalhesAberto, setDetalhesAberto] = useState(null);
  const [produtosAberto, setProdutosAberto] = useState(null);
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem(`colunas_tabela_financeiro_${tipo.toLowerCase()}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const toggleColuna = (colunaId) => {
    const novasColunas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter(id => id !== colunaId)
      : [...colunasVisiveis, colunaId];
    
    setColunasVisiveis(novasColunas);
    localStorage.setItem(`colunas_tabela_financeiro_${tipo.toLowerCase()}`, JSON.stringify(novasColunas));
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-50" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1 text-green-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-green-600" />;
  };

  const lancamentosFiltrados = lancamentos.filter((l) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      l.numero_lancamento?.toLowerCase().includes(search) ||
      l.fornecedor_nome?.toLowerCase().includes(search) ||
      l.cliente_nome?.toLowerCase().includes(search) ||
      l.numero_documento?.toLowerCase().includes(search) ||
      l.tipo_documento?.toLowerCase().includes(search) ||
      l.chave_nfe?.toLowerCase().includes(search) ||
      l.safra_nome?.toLowerCase().includes(search) ||
      l.centro_custo_nome?.toLowerCase().includes(search) ||
      l.plano_contas_nome?.toLowerCase().includes(search) ||
      l.grupo_nome?.toLowerCase().includes(search) ||
      l.forma_pagamento_nome?.toLowerCase().includes(search) ||
      l.local_estoque?.toLowerCase().includes(search)
    );
  });

  const lancamentosOrdenados = [...lancamentosFiltrados].sort((a, b) => {
    let aValue, bValue;

    switch (sortField) {
      case 'numero':
        aValue = parseInt(a.numero_lancamento) || 0;
        bValue = parseInt(b.numero_lancamento) || 0;
        break;
      case 'emissao':
        aValue = new Date(a.data_emissao).getTime();
        bValue = new Date(b.data_emissao).getTime();
        break;
      case 'vencimento':
        aValue = new Date(a.data_vencimento).getTime();
        bValue = new Date(b.data_vencimento).getTime();
        break;
      case 'fornecedor_cliente':
        aValue = (a.fornecedor_nome || a.cliente_nome || '').toLowerCase();
        bValue = (b.fornecedor_nome || b.cliente_nome || '').toLowerCase();
        break;
      case 'tipo_documento':
        aValue = (a.tipo_documento || '').toLowerCase();
        bValue = (b.tipo_documento || '').toLowerCase();
        break;
      case 'documento':
        aValue = (a.numero_documento || '').toLowerCase();
        bValue = (b.numero_documento || '').toLowerCase();
        break;
      case 'valor_original':
        aValue = a.valor_original || 0;
        bValue = b.valor_original || 0;
        break;
      case 'valor_total':
        aValue = a.valor_total || 0;
        bValue = b.valor_total || 0;
        break;
      case 'valor_pago':
        aValue = a.valor_pago || 0;
        bValue = b.valor_pago || 0;
        break;
      case 'saldo':
        aValue = a.valor_saldo || a.valor_total || 0;
        bValue = b.valor_saldo || b.valor_total || 0;
        break;
      case 'status':
        aValue = (a.status || '').toLowerCase();
        bValue = (b.status || '').toLowerCase();
        break;
      case 'safra':
        aValue = (a.safra_nome || '').toLowerCase();
        bValue = (b.safra_nome || '').toLowerCase();
        break;
      case 'centro_custo':
        aValue = (a.centro_custo_nome || '').toLowerCase();
        bValue = (b.centro_custo_nome || '').toLowerCase();
        break;
      case 'plano_contas':
        aValue = (a.plano_contas_nome || '').toLowerCase();
        bValue = (b.plano_contas_nome || '').toLowerCase();
        break;
      case 'grupo':
        aValue = (a.grupo_nome || '').toLowerCase();
        bValue = (b.grupo_nome || '').toLowerCase();
        break;
      case 'forma_pagamento':
        aValue = (a.forma_pagamento_nome || '').toLowerCase();
        bValue = (b.forma_pagamento_nome || '').toLowerCase();
        break;
      default:
        return 0;
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const abrirDetalhes = (lancamento) => {
    setDetalhesAberto(lancamento);
  };

  const abrirProdutos = (lancamento) => {
    setProdutosAberto(lancamento);
  };

  const fornecedorDoLancamento = (lancamento) => fornecedores?.find(f => f.id === lancamento.fornecedor_id);

  return (
    <>
      <Card className="shadow-xl border-slate-200">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-blue-50 border-b">
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-3">
              <DollarSign className="w-5 h-5" />
              Contas a {tipo}
            </span>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10 w-64" />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" title="Configurar Colunas">
                    <Settings className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 max-h-96 overflow-y-auto">
                  <DropdownMenuLabel>Colunas Visíveis</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {COLUNAS_DISPONIVEIS.map((coluna) => (
                    <DropdownMenuCheckboxItem key={coluna.id} checked={colunasVisiveis.includes(coluna.id)} onCheckedChange={() => toggleColuna(coluna.id)}>
                      {coluna.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  {colunasVisiveis.includes('numero') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('numero')}>
                      <div className="flex items-center">Nº {getSortIcon('numero')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('emissao') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('emissao')}>
                      <div className="flex items-center">Emissão {getSortIcon('emissao')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('vencimento') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('vencimento')}>
                      <div className="flex items-center">Vencimento {getSortIcon('vencimento')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('dias') && <TableHead>Dias</TableHead>}
                  {colunasVisiveis.includes('fornecedor_cliente') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('fornecedor_cliente')}>
                      <div className="flex items-center">{tipo === 'Pagar' ? 'Fornecedor' : 'Cliente'} {getSortIcon('fornecedor_cliente')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('tipo_documento') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('tipo_documento')}>
                      <div className="flex items-center">Tipo Doc {getSortIcon('tipo_documento')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('documento') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('documento')}>
                      <div className="flex items-center">Nº Doc {getSortIcon('documento')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('chave_nfe') && <TableHead>Chave NF-e</TableHead>}
                  {colunasVisiveis.includes('serie') && <TableHead>Série</TableHead>}
                  {colunasVisiveis.includes('cfop') && <TableHead>CFOP</TableHead>}
                  {colunasVisiveis.includes('valor_original') && (
                    <TableHead className="text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('valor_original')}>
                      <div className="flex items-center justify-end">Vlr. Original {getSortIcon('valor_original')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('valor_total') && (
                    <TableHead className="text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('valor_total')}>
                      <div className="flex items-center justify-end">Vlr. Total {getSortIcon('valor_total')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('valor_pago') && (
                    <TableHead className="text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('valor_pago')}>
                      <div className="flex items-center justify-end">Vlr. Pago {getSortIcon('valor_pago')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('saldo') && (
                    <TableHead className="text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('saldo')}>
                      <div className="flex items-center justify-end">Vlr. Saldo {getSortIcon('saldo')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('status') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('status')}>
                      <div className="flex items-center">Status {getSortIcon('status')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('safra') && <TableHead>Safra</TableHead>}
                  {colunasVisiveis.includes('centro_custo') && <TableHead>Centro Custo</TableHead>}
                  {colunasVisiveis.includes('plano_contas') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('plano_contas')}>
                      <div className="flex items-center">Plano Contas {getSortIcon('plano_contas')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('grupo') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('grupo')}>
                      <div className="flex items-center">Grupo {getSortIcon('grupo')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('forma_pagamento') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('forma_pagamento')}>
                      <div className="flex items-center">Forma Pgto {getSortIcon('forma_pagamento')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('lancar_produtos') && <TableHead className="text-center">Lançou Prod.</TableHead>}
                  {colunasVisiveis.includes('dar_entrada_estoque') && <TableHead className="text-center">Entrada Est.</TableHead>}
                  {colunasVisiveis.includes('local_estoque') && <TableHead>Local Estoque</TableHead>}
                  {colunasVisiveis.includes('valor_produtos_nfe') && <TableHead className="text-right">Vlr. Prod. NF-e</TableHead>}
                  {colunasVisiveis.includes('valor_frete_nfe') && <TableHead className="text-right">Vlr. Frete NF-e</TableHead>}
                  {colunasVisiveis.includes('valor_seguro_nfe') && <TableHead className="text-right">Vlr. Seg. NF-e</TableHead>}
                  {colunasVisiveis.includes('valor_outras_despesas_nfe') && <TableHead className="text-right">Out. Desp. NF-e</TableHead>}
                  {colunasVisiveis.includes('valor_desconto_total_nfe') && <TableHead className="text-right">Desc. Tot. NF-e</TableHead>}
                  {colunasVisiveis.includes('valor_ipi') && <TableHead className="text-right">IPI</TableHead>}
                  {colunasVisiveis.includes('valor_icms') && <TableHead className="text-right">ICMS</TableHead>}
                  {colunasVisiveis.includes('valor_pis') && <TableHead className="text-right">PIS</TableHead>}
                  {colunasVisiveis.includes('valor_cofins') && <TableHead className="text-right">COFINS</TableHead>}
                  {colunasVisiveis.includes('base_calculo_icms') && <TableHead className="text-right">Base ICMS</TableHead>}
                  {colunasVisiveis.includes('observacoes') && <TableHead>Observações</TableHead>}
                  {colunasVisiveis.includes('observacoes_nfe') && <TableHead>Obs. NF-e</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={50} className="text-center py-12 text-slate-400">Carregando...</TableCell>
                    </TableRow>
                  ) : lancamentosOrdenados.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={50} className="text-center py-12 text-slate-400">Nenhum lançamento encontrado</TableCell>
                    </TableRow>
                  ) : (
                    lancamentosOrdenados.map((lancamento) => {
                      const temProdutos = lancamento.produtos_lancamento && lancamento.produtos_lancamento.length > 0;
                      
                      return (
                        <ContextMenu key={lancamento.id}>
                          <ContextMenuTrigger asChild>
                            <motion.tr 
                              initial={{ opacity: 0 }} 
                              animate={{ opacity: 1 }} 
                              exit={{ opacity: 0 }} 
                              className="hover:bg-slate-50 transition-colors"
                            >
                              {colunasVisiveis.includes('numero') && <TableCell className="font-bold">{formatarNumero(parseInt(lancamento.numero_lancamento))}</TableCell>}
                              {colunasVisiveis.includes('emissao') && <TableCell className="text-xs">{formatarData(lancamento.data_emissao)}</TableCell>}
                              {colunasVisiveis.includes('vencimento') && <TableCell className="text-xs">{formatarData(lancamento.data_vencimento)}</TableCell>}
                              {colunasVisiveis.includes('dias') && (
                                <TableCell className="text-xs">
                                  {lancamento.status === 'Pendente' && (
                                    <span className={`font-medium ${calcularDias(lancamento.data_vencimento).includes('vencido') ? 'text-red-600' : 'text-blue-600'}`}>
                                      {calcularDias(lancamento.data_vencimento)}
                                    </span>
                                  )}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('fornecedor_cliente') && (
                                <TableCell className="max-w-xs truncate">
                                  {lancamento.fornecedor_nome || lancamento.cliente_nome || '-'}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('tipo_documento') && (
                                <TableCell className="text-xs">{lancamento.tipo_documento || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('documento') && (
                                <TableCell className="font-mono text-xs">{lancamento.numero_documento || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('chave_nfe') && (
                                <TableCell className="font-mono text-xs max-w-xs truncate">{lancamento.chave_nfe || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('serie') && <TableCell className="text-xs">{lancamento.serie_documento || '-'}</TableCell>}
                              {colunasVisiveis.includes('cfop') && <TableCell className="text-xs">{lancamento.cfop || '-'}</TableCell>}
                              {colunasVisiveis.includes('valor_original') && <TableCell className="text-right font-mono">{formatarMoeda(lancamento.valor_original || 0)}</TableCell>}
                              {colunasVisiveis.includes('valor_total') && <TableCell className="text-right font-mono font-semibold">{formatarMoeda(lancamento.valor_total || 0)}</TableCell>}
                              {colunasVisiveis.includes('valor_pago') && <TableCell className="text-right font-mono text-blue-700">{formatarMoeda(lancamento.valor_pago || 0)}</TableCell>}
                              {colunasVisiveis.includes('saldo') && <TableCell className="text-right font-mono font-bold text-red-700">{formatarMoeda(lancamento.valor_saldo || lancamento.valor_total || 0)}</TableCell>}
                              {colunasVisiveis.includes('status') && (
                                <TableCell>
                                  <Badge className={getBadgeStyle(lancamento.status)}>{lancamento.status}</Badge>
                                  {lancamento.numero_parcela && (
                                    <div className="text-xs text-slate-500 mt-1">
                                      Parcela {lancamento.numero_parcela}/{lancamento.total_parcelas}
                                    </div>
                                  )}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('safra') && <TableCell className="text-xs">{lancamento.safra_nome || '-'}</TableCell>}
                              {colunasVisiveis.includes('centro_custo') && <TableCell className="text-xs">{lancamento.centro_custo_nome || '-'}</TableCell>}
                              {colunasVisiveis.includes('plano_contas') && <TableCell className="text-xs max-w-xs truncate">{lancamento.plano_contas_nome || '-'}</TableCell>}
                              {colunasVisiveis.includes('grupo') && <TableCell className="text-xs">{lancamento.grupo_nome || '-'}</TableCell>}
                              {colunasVisiveis.includes('forma_pagamento') && <TableCell className="text-xs">{lancamento.forma_pagamento_nome || '-'}</TableCell>}
                              {colunasVisiveis.includes('lancar_produtos') && <TableCell className="text-center">{lancamento.lancar_produtos ? '✓' : '-'}</TableCell>}
                              {colunasVisiveis.includes('dar_entrada_estoque') && <TableCell className="text-center">{lancamento.dar_entrada_estoque ? '✓' : '-'}</TableCell>}
                              {colunasVisiveis.includes('local_estoque') && <TableCell className="text-xs">{lancamento.local_estoque || '-'}</TableCell>}
                              {colunasVisiveis.includes('valor_produtos_nfe') && <TableCell className="text-right font-mono text-xs">{formatarMoeda(lancamento.valor_produtos || 0)}</TableCell>}
                              {colunasVisiveis.includes('valor_frete_nfe') && <TableCell className="text-right font-mono text-xs">{formatarMoeda(lancamento.valor_frete || 0)}</TableCell>}
                              {colunasVisiveis.includes('valor_seguro_nfe') && <TableCell className="text-right font-mono text-xs">{formatarMoeda(lancamento.valor_seguro || 0)}</TableCell>}
                              {colunasVisiveis.includes('valor_outras_despesas_nfe') && <TableCell className="text-right font-mono text-xs">{formatarMoeda(lancamento.valor_outras_despesas || 0)}</TableCell>}
                              {colunasVisiveis.includes('valor_desconto_total_nfe') && <TableCell className="text-right font-mono text-xs">{formatarMoeda(lancamento.valor_desconto_total || 0)}</TableCell>}
                              {colunasVisiveis.includes('valor_ipi') && <TableCell className="text-right font-mono text-xs">{formatarMoeda(lancamento.valor_ipi || 0)}</TableCell>}
                              {colunasVisiveis.includes('valor_icms') && <TableCell className="text-right font-mono text-xs">{formatarMoeda(lancamento.valor_icms || 0)}</TableCell>}
                              {colunasVisiveis.includes('valor_pis') && <TableCell className="text-right font-mono text-xs">{formatarMoeda(lancamento.valor_pis || 0)}</TableCell>}
                              {colunasVisiveis.includes('valor_cofins') && <TableCell className="text-right font-mono text-xs">{formatarMoeda(lancamento.valor_cofins || 0)}</TableCell>}
                              {colunasVisiveis.includes('base_calculo_icms') && <TableCell className="text-right font-mono text-xs">{formatarMoeda(lancamento.base_calculo_icms || 0)}</TableCell>}
                              {colunasVisiveis.includes('observacoes') && <TableCell className="text-xs max-w-xs truncate">{lancamento.observacoes || '-'}</TableCell>}
                              {colunasVisiveis.includes('observacoes_nfe') && <TableCell className="text-xs max-w-xs truncate">{lancamento.observacoes_nfe || '-'}</TableCell>}
                            </motion.tr>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onClick={() => abrirDetalhes(lancamento)}>
                              <Eye className="w-4 h-4 mr-2 text-blue-600" />
                              Ver Detalhes
                            </ContextMenuItem>
                            {temProdutos && (
                              <ContextMenuItem onClick={() => abrirProdutos(lancamento)}>
                                <Package className="w-4 h-4 mr-2 text-green-600" />
                                Ver Produtos
                              </ContextMenuItem>
                            )}
                            {lancamento.status !== 'Pago' && lancamento.status !== 'Cancelado' && (
                              <ContextMenuItem onClick={() => onBaixa(lancamento)}>
                                <DollarSign className="w-4 h-4 mr-2 text-green-600" />
                                Dar Baixa
                              </ContextMenuItem>
                            )}
                            {lancamento.status === 'Pago' && onCancelarBaixa && (
                              <ContextMenuItem onClick={() => onCancelarBaixa(lancamento)}>
                                <XCircle className="w-4 h-4 mr-2 text-orange-600" />
                                Cancelar Baixa
                              </ContextMenuItem>
                            )}
                            <ContextMenuItem onClick={() => onDelete(lancamento.id)}>
                              <Trash2 className="w-4 h-4 mr-2 text-red-600" />
                              Excluir
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* DIALOG DETALHES - COMPLETO */}
      <Dialog open={!!detalhesAberto} onOpenChange={(open) => !open && setDetalhesAberto(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do Lançamento #{detalhesAberto?.numero_lancamento}</DialogTitle>
          </DialogHeader>
          {detalhesAberto && (
            <div className="space-y-4">
              {/* INFORMAÇÕES GERAIS */}
              <Card>
                <CardHeader><CardTitle className="text-base">Informações Gerais</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div><strong>Nº:</strong> {formatarNumero(parseInt(detalhesAberto.numero_lancamento))}</div>
                  <div><strong>Tipo:</strong> {detalhesAberto.tipo}</div>
                  <div><strong>Emissão:</strong> {formatarData(detalhesAberto.data_emissao)}</div>
                  <div><strong>Vencimento:</strong> {formatarData(detalhesAberto.data_vencimento)}</div>
                  <div><strong>Tipo Doc:</strong> {detalhesAberto.tipo_documento || '-'}</div>
                  <div><strong>Nº Doc:</strong> {detalhesAberto.numero_documento || '-'}</div>
                  {detalhesAberto.chave_nfe && (
                    <div className="col-span-2"><strong>Chave NF-e:</strong> <span className="font-mono text-xs">{detalhesAberto.chave_nfe}</span></div>
                  )}
                  {detalhesAberto.serie_documento && (
                    <div><strong>Série:</strong> {detalhesAberto.serie_documento}</div>
                  )}
                  {detalhesAberto.cfop && (
                    <div><strong>CFOP:</strong> {detalhesAberto.cfop}</div>
                  )}
                  <div><strong>Lançou Produtos:</strong> {detalhesAberto.lancar_produtos ? 'Sim' : 'Não'}</div>
                  <div><strong>Deu Entrada Estoque:</strong> {detalhesAberto.dar_entrada_estoque ? 'Sim' : 'Não'}</div>
                  {detalhesAberto.local_estoque && (
                    <div><strong>Local Estoque:</strong> {detalhesAberto.local_estoque}</div>
                  )}
                </CardContent>
              </Card>

              {/* RASTREAMENTO */}
              <Card className="bg-blue-50 border-blue-200">
                <CardHeader><CardTitle className="text-base">🔍 Rastreamento</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div><strong>Criado por:</strong> {detalhesAberto.created_by || '-'}</div>
                  <div><strong>Data Criação:</strong> {formatarDataHora(detalhesAberto.created_date)}</div>
                  <div><strong>Última Edição:</strong> {formatarDataHora(detalhesAberto.updated_date)}</div>
                  <div><strong>Tipo Origem:</strong> <Badge className="ml-2">{detalhesAberto.origem_importacao === 'XML' ? '📋 Importação XML' : '✍️ Cadastro Manual'}</Badge></div>
                </CardContent>
              </Card>

              {/* FORNECEDOR/CLIENTE */}
              {tipo === 'Pagar' && detalhesAberto.fornecedor_id && (
                <Card className="bg-purple-50 border-purple-200">
                  <CardHeader><CardTitle className="text-base">Fornecedor</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {(() => {
                      const fornecedor = fornecedorDoLancamento(detalhesAberto);
                      return fornecedor ? (
                        <>
                          <div><strong>Nome:</strong> {fornecedor.nome}</div>
                          <div><strong>Tipo:</strong> {fornecedor.tipo_pessoa}</div>
                          <div><strong>CPF/CNPJ:</strong> {fornecedor.cpf || fornecedor.cnpj || '-'}</div>
                          <div><strong>Telefone:</strong> {fornecedor.telefone || '-'}</div>
                          <div><strong>Email:</strong> {fornecedor.email || '-'}</div>
                        </>
                      ) : <div className="text-slate-500">Fornecedor não encontrado</div>;
                    })()}
                  </CardContent>
                </Card>
              )}

              {/* CLASSIFICAÇÃO */}
              <Card className="bg-green-50 border-green-200">
                <CardHeader><CardTitle className="text-base">Classificação Financeira</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div><strong>Plano Contas:</strong> {detalhesAberto.plano_contas_nome || '-'}</div>
                  <div><strong>Grupo:</strong> {detalhesAberto.grupo_nome || '-'}</div>
                  <div><strong>Centro Custo:</strong> {detalhesAberto.centro_custo_nome || '-'}</div>
                  <div><strong>Safra:</strong> {detalhesAberto.safra_nome || '-'}</div>
                  <div><strong>Forma Pgto:</strong> {detalhesAberto.forma_pagamento_nome || '-'}</div>
                </CardContent>
              </Card>

              {/* VALORES */}
              <Card>
                <CardHeader><CardTitle className="text-base">Valores</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div><strong>Vlr. Original:</strong> {formatarMoeda(detalhesAberto.valor_original || 0)}</div>
                  <div><strong>Juros:</strong> {formatarMoeda(detalhesAberto.valor_juros || 0)}</div>
                  <div><strong>Multa:</strong> {formatarMoeda(detalhesAberto.valor_multa || 0)}</div>
                  <div><strong>Desconto:</strong> {formatarMoeda(detalhesAberto.valor_desconto || 0)}</div>
                  <div className="col-span-2 text-lg"><strong>Vlr. Total:</strong> <span className="text-blue-700 font-bold">{formatarMoeda(detalhesAberto.valor_total || 0)}</span></div>
                  <div className="text-blue-700"><strong>Vlr. Pago:</strong> {formatarMoeda(detalhesAberto.valor_pago || 0)}</div>
                  <div className="text-red-700"><strong>Vlr. Saldo:</strong> {formatarMoeda(detalhesAberto.valor_saldo || detalhesAberto.valor_total || 0)}</div>
                </CardContent>
              </Card>

              {/* VALORES NF-E */}
              {(detalhesAberto.valor_produtos || detalhesAberto.valor_frete || detalhesAberto.valor_ipi) && (
                <Card className="bg-purple-50 border-purple-200">
                  <CardHeader><CardTitle className="text-base">Valores Detalhados NF-e</CardTitle></CardHeader>
                  <CardContent className="grid grid-cols-3 gap-3 text-sm">
                    <div><strong>Vlr. Produtos:</strong> {formatarMoeda(detalhesAberto.valor_produtos || 0)}</div>
                    <div><strong>Vlr. Frete:</strong> {formatarMoeda(detalhesAberto.valor_frete || 0)}</div>
                    <div><strong>Vlr. Seguro:</strong> {formatarMoeda(detalhesAberto.valor_seguro || 0)}</div>
                    <div><strong>Outras Desp.:</strong> {formatarMoeda(detalhesAberto.valor_outras_despesas || 0)}</div>
                    <div><strong>Desc. Total:</strong> {formatarMoeda(detalhesAberto.valor_desconto_total || 0)}</div>
                    <div><strong>IPI:</strong> {formatarMoeda(detalhesAberto.valor_ipi || 0)}</div>
                    <div><strong>ICMS:</strong> {formatarMoeda(detalhesAberto.valor_icms || 0)}</div>
                    <div><strong>PIS:</strong> {formatarMoeda(detalhesAberto.valor_pis || 0)}</div>
                    <div><strong>COFINS:</strong> {formatarMoeda(detalhesAberto.valor_cofins || 0)}</div>
                    <div><strong>Base ICMS:</strong> {formatarMoeda(detalhesAberto.base_calculo_icms || 0)}</div>
                  </CardContent>
                </Card>
              )}

              {/* OBSERVAÇÕES */}
              {(detalhesAberto.observacoes || detalhesAberto.observacoes_nfe) && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Observações</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {detalhesAberto.observacoes && (
                      <div>
                        <strong className="text-sm">Observações Personalizadas:</strong>
                        <p className="text-sm whitespace-pre-wrap mt-1 bg-slate-50 p-2 rounded">{detalhesAberto.observacoes}</p>
                      </div>
                    )}
                    {detalhesAberto.observacoes_nfe && (
                      <div>
                        <strong className="text-sm">Observações da NF-e:</strong>
                        <p className="text-sm whitespace-pre-wrap mt-1 bg-purple-50 p-2 rounded">{detalhesAberto.observacoes_nfe}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* DIALOG PRODUTOS */}
      <Dialog open={!!produtosAberto} onOpenChange={(open) => !open && setProdutosAberto(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-green-600" />
              Produtos Vinculados - Lançamento #{produtosAberto?.numero_lancamento}
            </DialogTitle>
          </DialogHeader>
          {produtosAberto?.produtos_lancamento?.length > 0 ? (
            <Card className="bg-green-50 border-green-200">
              <CardContent className="p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead>UN</TableHead>
                      <TableHead className="text-right">Vlr. Unit.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {produtosAberto.produtos_lancamento.map((pl, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-semibold">{pl.produto_nome || '-'}</TableCell>
                        <TableCell className="font-mono text-xs">{pl.codigo || '-'}</TableCell>
                        <TableCell className="text-right font-mono">{formatarNumeroDecimal(pl.quantidade)}</TableCell>
                        <TableCell className="text-xs">{pl.unidade}</TableCell>
                        <TableCell className="text-right font-mono">{formatarMoeda(pl.valor_unitario)}</TableCell>
                        <TableCell className="text-right font-mono font-bold text-green-700">{formatarMoeda(pl.quantidade * pl.valor_unitario)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-green-100 font-bold">
                      <TableCell colSpan={5} className="text-right">TOTAL PRODUTOS:</TableCell>
                      <TableCell className="text-right text-green-800">
                        {formatarMoeda(produtosAberto.produtos_lancamento.reduce((s, p) => s + (p.quantidade * p.valor_unitario), 0))}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Nenhum produto vinculado a este lançamento</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
