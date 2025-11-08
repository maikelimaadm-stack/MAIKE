import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, DollarSign, Search, Settings, Eye, ArrowUpDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const formatarMoeda = (valor) => {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatarData = (dataString) => {
  if (!dataString) return '-';
  return new Date(dataString).toLocaleDateString('pt-BR');
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
  { id: 'fornecedor_cliente', label: 'Fornecedor/Cliente', default: true },
  { id: 'documento', label: 'Documento', default: true },
  { id: 'valor_original', label: 'Valor Original', default: false },
  { id: 'valor_total', label: 'Valor Total', default: true },
  { id: 'valor_pago', label: 'Pago', default: true },
  { id: 'saldo', label: 'Saldo', default: true },
  { id: 'status', label: 'Status', default: true },
  { id: 'safra', label: 'Safra', default: false },
  { id: 'produto', label: 'Produto', default: false },
  { id: 'centro_custo', label: 'Centro Custo', default: false },
  { id: 'forma_pagamento', label: 'Forma Pgto', default: false },
];

export default function TabelaFinanceiro({ lancamentos, tipo, onEdit, onDelete, onBaixa, isLoading, fornecedores, produtos }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [ordenacao, setOrdenacao] = useState("vencimento_asc");
  const [detalhesAberto, setDetalhesAberto] = useState(null);
  
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

  const lancamentosFiltrados = lancamentos.filter((l) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      l.numero_lancamento?.toLowerCase().includes(search) ||
      l.fornecedor_nome?.toLowerCase().includes(search) ||
      l.cliente_nome?.toLowerCase().includes(search) ||
      l.numero_documento?.toLowerCase().includes(search)
    );
  });

  const lancamentosOrdenados = [...lancamentosFiltrados].sort((a, b) => {
    switch (ordenacao) {
      case 'vencimento_asc':
        return new Date(a.data_vencimento) - new Date(b.data_vencimento);
      case 'vencimento_desc':
        return new Date(b.data_vencimento) - new Date(a.data_vencimento);
      case 'valor_asc':
        return (a.valor_total || 0) - (b.valor_total || 0);
      case 'valor_desc':
        return (b.valor_total || 0) - (a.valor_total || 0);
      case 'status_asc':
        return (a.status || '').localeCompare(b.status || '');
      case 'status_desc':
        return (b.status || '').localeCompare(a.status || '');
      default:
        return 0;
    }
  });

  const abrirDetalhes = (lancamento) => {
    setDetalhesAberto(lancamento);
  };

  const fornecedorDoLancamento = (lancamento) => {
    return fornecedores?.find(f => f.id === lancamento.fornecedor_id);
  };

  const produtoDoLancamento = (lancamento) => {
    return produtos?.find(p => p.id === lancamento.produto_id);
  };

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
                <Input
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <ArrowUpDown className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Ordenar Por</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={ordenacao === 'vencimento_asc'} onCheckedChange={() => setOrdenacao('vencimento_asc')}>
                    Vencimento (Mais Próximo)
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={ordenacao === 'vencimento_desc'} onCheckedChange={() => setOrdenacao('vencimento_desc')}>
                    Vencimento (Mais Distante)
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={ordenacao === 'valor_desc'} onCheckedChange={() => setOrdenacao('valor_desc')}>
                    Valor (Maior)
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={ordenacao === 'valor_asc'} onCheckedChange={() => setOrdenacao('valor_asc')}>
                    Valor (Menor)
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={ordenacao === 'status_asc'} onCheckedChange={() => setOrdenacao('status_asc')}>
                    Status (A-Z)
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <Settings className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Colunas Visíveis</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {COLUNAS_DISPONIVEIS.map((coluna) => (
                    <DropdownMenuCheckboxItem
                      key={coluna.id}
                      checked={colunasVisiveis.includes(coluna.id)}
                      onCheckedChange={() => toggleColuna(coluna.id)}
                    >
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
                  {colunasVisiveis.includes('numero') && <TableHead>Nº</TableHead>}
                  {colunasVisiveis.includes('emissao') && <TableHead>Emissão</TableHead>}
                  {colunasVisiveis.includes('vencimento') && <TableHead>Vencimento</TableHead>}
                  {colunasVisiveis.includes('fornecedor_cliente') && <TableHead>{tipo === 'Pagar' ? 'Fornecedor' : 'Cliente'}</TableHead>}
                  {colunasVisiveis.includes('documento') && <TableHead>Documento</TableHead>}
                  {colunasVisiveis.includes('valor_original') && <TableHead className="text-right">Valor Original</TableHead>}
                  {colunasVisiveis.includes('valor_total') && <TableHead className="text-right">Valor Total</TableHead>}
                  {colunasVisiveis.includes('valor_pago') && <TableHead className="text-right">Pago</TableHead>}
                  {colunasVisiveis.includes('saldo') && <TableHead className="text-right">Saldo</TableHead>}
                  {colunasVisiveis.includes('status') && <TableHead>Status</TableHead>}
                  {colunasVisiveis.includes('safra') && <TableHead>Safra</TableHead>}
                  {colunasVisiveis.includes('produto') && <TableHead>Produto</TableHead>}
                  {colunasVisiveis.includes('centro_custo') && <TableHead>Centro Custo</TableHead>}
                  {colunasVisiveis.includes('forma_pagamento') && <TableHead>Forma Pgto</TableHead>}
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={15} className="text-center py-12 text-slate-400">
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : lancamentosOrdenados.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={15} className="text-center py-12 text-slate-400">
                        Nenhum lançamento encontrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    lancamentosOrdenados.map((lancamento) => (
                      <motion.tr
                        key={lancamento.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="hover:bg-slate-50 transition-colors"
                      >
                        {colunasVisiveis.includes('numero') && (
                          <TableCell className="font-bold">{lancamento.numero_lancamento}</TableCell>
                        )}
                        {colunasVisiveis.includes('emissao') && (
                          <TableCell className="text-xs">{formatarData(lancamento.data_emissao)}</TableCell>
                        )}
                        {colunasVisiveis.includes('vencimento') && (
                          <TableCell className="text-xs">{formatarData(lancamento.data_vencimento)}</TableCell>
                        )}
                        {colunasVisiveis.includes('fornecedor_cliente') && (
                          <TableCell className="max-w-xs truncate">
                            <div className="flex items-center gap-2">
                              <span>{lancamento.fornecedor_nome || lancamento.cliente_nome || '-'}</span>
                              {(tipo === 'Pagar' && lancamento.fornecedor_id) && (
                                <Button size="sm" variant="ghost" onClick={() => abrirDetalhes(lancamento)} className="h-6 w-6 p-0">
                                  <Eye className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('documento') && (
                          <TableCell className="font-mono text-xs">{lancamento.numero_documento || '-'}</TableCell>
                        )}
                        {colunasVisiveis.includes('valor_original') && (
                          <TableCell className="text-right font-mono">{formatarMoeda(lancamento.valor_original || 0)}</TableCell>
                        )}
                        {colunasVisiveis.includes('valor_total') && (
                          <TableCell className="text-right font-mono font-semibold">{formatarMoeda(lancamento.valor_total || 0)}</TableCell>
                        )}
                        {colunasVisiveis.includes('valor_pago') && (
                          <TableCell className="text-right font-mono text-green-700">{formatarMoeda(lancamento.valor_pago || 0)}</TableCell>
                        )}
                        {colunasVisiveis.includes('saldo') && (
                          <TableCell className="text-right font-mono font-bold text-blue-700">{formatarMoeda(lancamento.valor_saldo || lancamento.valor_total || 0)}</TableCell>
                        )}
                        {colunasVisiveis.includes('status') && (
                          <TableCell>
                            <Badge className={getBadgeStyle(lancamento.status)}>{lancamento.status}</Badge>
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('safra') && (
                          <TableCell className="text-xs">{lancamento.safra_nome || '-'}</TableCell>
                        )}
                        {colunasVisiveis.includes('produto') && (
                          <TableCell className="max-w-xs truncate text-xs">
                            <div className="flex items-center gap-2">
                              <span>{lancamento.produto_nome || '-'}</span>
                              {lancamento.produto_id && (
                                <Button size="sm" variant="ghost" onClick={() => abrirDetalhes(lancamento)} className="h-6 w-6 p-0">
                                  <Eye className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('centro_custo') && (
                          <TableCell className="text-xs">{lancamento.centro_custo_nome || '-'}</TableCell>
                        )}
                        {colunasVisiveis.includes('forma_pagamento') && (
                          <TableCell className="text-xs">{lancamento.forma_pagamento_nome || '-'}</TableCell>
                        )}
                        <TableCell>
                          <div className="flex gap-1 justify-center">
                            <Button size="sm" variant="ghost" onClick={() => abrirDetalhes(lancamento)} title="Ver detalhes">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => onEdit(lancamento)} title="Editar">
                              <Edit className="w-4 h-4 text-blue-600" />
                            </Button>
                            {lancamento.status !== 'Pago' && lancamento.status !== 'Cancelado' && (
                              <Button size="sm" variant="ghost" onClick={() => onBaixa(lancamento)} title="Dar baixa" className="text-green-600">
                                <DollarSign className="w-4 h-4" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => onDelete(lancamento.id)} title="Excluir" className="text-red-600 hover:bg-red-50">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </motion.tr>
                    ))
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!detalhesAberto} onOpenChange={(open) => !open && setDetalhesAberto(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do Lançamento #{detalhesAberto?.numero_lancamento}</DialogTitle>
          </DialogHeader>
          {detalhesAberto && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Informações Gerais</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div><strong>Nº Lançamento:</strong> {detalhesAberto.numero_lancamento}</div>
                  <div><strong>Tipo:</strong> {detalhesAberto.tipo}</div>
                  <div><strong>Data Emissão:</strong> {formatarData(detalhesAberto.data_emissao)}</div>
                  <div><strong>Data Vencimento:</strong> {formatarData(detalhesAberto.data_vencimento)}</div>
                  <div><strong>Documento:</strong> {detalhesAberto.numero_documento || '-'}</div>
                  <div><strong>Tipo Doc:</strong> {detalhesAberto.tipo_documento || '-'}</div>
                  {detalhesAberto.chave_nfe && (
                    <div className="col-span-2"><strong>Chave NF-e:</strong> <span className="font-mono text-xs">{detalhesAberto.chave_nfe}</span></div>
                  )}
                </CardContent>
              </Card>

              {tipo === 'Pagar' && detalhesAberto.fornecedor_id && (
                <Card className="bg-blue-50 border-blue-200">
                  <CardHeader>
                    <CardTitle className="text-base">Dados do Fornecedor</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {(() => {
                      const fornecedor = fornecedorDoLancamento(detalhesAberto);
                      return fornecedor ? (
                        <>
                          <div><strong>Nome:</strong> {fornecedor.nome}</div>
                          <div><strong>Tipo:</strong> {fornecedor.tipo_pessoa}</div>
                          <div><strong>CPF/CNPJ:</strong> {fornecedor.cpf || fornecedor.cnpj || '-'}</div>
                          <div><strong>Telefone:</strong> {fornecedor.telefone || '-'}</div>
                          <div><strong>E-mail:</strong> {fornecedor.email || '-'}</div>
                          <div><strong>Cidade/UF:</strong> {fornecedor.cidade || '-'} / {fornecedor.estado || '-'}</div>
                        </>
                      ) : (
                        <div className="text-slate-500">Fornecedor não encontrado</div>
                      );
                    })()}
                  </CardContent>
                </Card>
              )}

              {detalhesAberto.produto_id && (
                <Card className="bg-green-50 border-green-200">
                  <CardHeader>
                    <CardTitle className="text-base">Produto Vinculado</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {(() => {
                      const produto = produtoDoLancamento(detalhesAberto);
                      return produto ? (
                        <>
                          <div><strong>Nome:</strong> {produto.nome_produto}</div>
                          <div><strong>Código:</strong> {produto.codigo_interno || '-'}</div>
                          <div><strong>Categoria:</strong> {produto.categoria || '-'}</div>
                          <div><strong>Unidade:</strong> {produto.unidade_medida}</div>
                          <div><strong>Estoque Atual:</strong> {produto.estoque_atual || 0}</div>
                          <div><strong>Preço Custo:</strong> {formatarMoeda(produto.preco_custo || 0)}</div>
                        </>
                      ) : (
                        <div className="text-slate-500">Produto não encontrado</div>
                      );
                    })()}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Valores</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div><strong>Valor Original:</strong> {formatarMoeda(detalhesAberto.valor_original || 0)}</div>
                  <div><strong>Juros:</strong> {formatarMoeda(detalhesAberto.valor_juros || 0)}</div>
                  <div><strong>Multa:</strong> {formatarMoeda(detalhesAberto.valor_multa || 0)}</div>
                  <div><strong>Desconto:</strong> {formatarMoeda(detalhesAberto.valor_desconto || 0)}</div>
                  <div className="col-span-2 text-lg"><strong>Valor Total:</strong> <span className="text-blue-700 font-bold">{formatarMoeda(detalhesAberto.valor_total || 0)}</span></div>
                  <div className="text-green-700"><strong>Valor Pago:</strong> {formatarMoeda(detalhesAberto.valor_pago || 0)}</div>
                  <div className="text-orange-700"><strong>Saldo:</strong> {formatarMoeda(detalhesAberto.valor_saldo || detalhesAberto.valor_total || 0)}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Classificações</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div><strong>Safra:</strong> {detalhesAberto.safra_nome || '-'}</div>
                  <div><strong>Centro Custo:</strong> {detalhesAberto.centro_custo_nome || '-'}</div>
                  <div><strong>Plano Contas:</strong> {detalhesAberto.plano_contas_nome || '-'}</div>
                  <div><strong>Grupo:</strong> {detalhesAberto.grupo_nome || '-'}</div>
                  <div><strong>Forma Pgto:</strong> {detalhesAberto.forma_pagamento_nome || '-'}</div>
                  <div><strong>Status:</strong> <Badge className={getBadgeStyle(detalhesAberto.status)}>{detalhesAberto.status}</Badge></div>
                </CardContent>
              </Card>

              {detalhesAberto.observacoes && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Observações</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap">{detalhesAberto.observacoes}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}