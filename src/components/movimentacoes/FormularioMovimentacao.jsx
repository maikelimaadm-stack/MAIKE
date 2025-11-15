import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowRightLeft, Save, X, Plus, Trash2, MoreVertical } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DialogCadastroRapido from "../financeiro/DialogCadastroRapido.jsx";
import AutocompleteGenerico from "../financeiro/AutocompleteGenerico.jsx";

const formatarNumero = (num) => {
  if (!num && num !== 0) return '';
  const numStr = String(num).replace('.', ',');
  const [inteiro, decimal] = numStr.split(',');
  const inteiroFormatado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimal !== undefined ? `${inteiroFormatado},${decimal}` : inteiroFormatado;
};

const parseNumero = (str) => {
  if (!str) return 0;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const capitalize = (str) => {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

const TIPOS_DETALHADOS = {
  'Entrada': ['Compra', 'Compra à Vista', 'Compra a Prazo', 'Devolução de Cliente', 'Doação Recebida', 'Bonificação', 'Produção', 'Importação', 'Transferência Recebida', 'Acerto de Estoque', 'Outros'],
  'Saída': ['Venda', 'Venda à Vista', 'Venda a Prazo', 'Devolução ao Fornecedor', 'Doação', 'Perda', 'Quebra', 'Consumo Interno', 'Produção', 'Transferência Enviada', 'Acerto de Estoque', 'Outros'],
  'Transferência': ['Entre Locais', 'Entre Empresas', 'Entre Filiais', 'Outros'],
  'Ajuste': ['Ajuste Positivo', 'Ajuste Negativo', 'Inventário', 'Correção', 'Outros']
};

export default function FormularioMovimentacao({ onSubmit, onCancel, initialData = null, produtos, fornecedores }) {
  const [formData, setFormData] = useState({
    tipo_movimentacao: initialData?.tipo_movimentacao || "",
    tipo_detalhado: initialData?.tipo_detalhado || "",
    local_estoque: initialData?.local_estoque_origem || initialData?.local_estoque_destino || "",
    local_destino: initialData?.local_estoque_destino || "",
    empresa_destino_id: initialData?.empresa_destino_id || "",
    tipo_documento: initialData?.tipo_documento || "Nota Fiscal",
    numero_documento: initialData?.numero_documento || "",
    serie_documento: initialData?.serie_documento || "",
    chave_documento: initialData?.chave_documento || "",
    data_documento: initialData?.data_documento || "",
    cfop: initialData?.cfop || "",
    natureza_operacao: initialData?.natureza_operacao || "",
    fornecedor_id: initialData?.fornecedor_id || "",
    cliente_nome: initialData?.cliente_nome || "",
    centro_custo_id: initialData?.centro_custo_id || "",
    motivo_movimentacao: initialData?.motivo_movimentacao || "",
    observacoes: initialData?.observacoes || ""
  });

  const [produtosLista, setProdutosLista] = useState([]);
  const [produtoAtual, setProdutoAtual] = useState({
    produto_id: "",
    quantidade: "",
    valor_unitario: "",
    desconto: "0,00"
  });

  const [showDialogLocal, setShowDialogLocal] = useState(false);
  const [showDialogCentro, setShowDialogCentro] = useState(false);
  const [showDialogProduto, setShowDialogProduto] = useState(false);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: locais = [] } = useQuery({
    queryKey: ['locais_mov'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: [],
  });

  const { data: centros = [] } = useQuery({
    queryKey: ['centros_mov', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresas_mov'],
    queryFn: () => base44.entities.Empresa.list(),
    initialData: [],
  });

  const { data: locaisEmpresaDestino = [] } = useQuery({
    queryKey: ['locais_empresa_destino', formData.empresa_destino_id],
    queryFn: () => base44.entities.LocalEstoque.list(),
    enabled: !!formData.empresa_destino_id,
    initialData: [],
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleAdicionarProduto = () => {
    if (!produtoAtual.produto_id || !produtoAtual.quantidade) {
      toast.error('Selecione um produto e informe a quantidade!');
      return;
    }

    const produto = produtos.find(p => p.id === produtoAtual.produto_id);
    const jaExiste = produtosLista.find(p => p.produto_id === produtoAtual.produto_id);

    if (jaExiste) {
      toast.error('Produto já adicionado à lista!');
      return;
    }

    const quantidade = parseNumero(produtoAtual.quantidade);
    const valorUnitario = produtoAtual.valor_unitario ? parseNumero(produtoAtual.valor_unitario) : 0;
    const desconto = produtoAtual.desconto ? parseNumero(produtoAtual.desconto) : 0;
    const subtotal = quantidade * valorUnitario;
    const valorTotal = subtotal - desconto;

    const novoProduto = {
      produto_id: produtoAtual.produto_id,
      produto_nome: produto?.nome_produto,
      produto_codigo: produto?.codigo_interno,
      unidade_medida: produto?.unidade_medida,
      quantidade,
      valor_unitario: valorUnitario,
      desconto,
      valor_total: valorTotal
    };

    setProdutosLista([...produtosLista, novoProduto]);
    setProdutoAtual({ produto_id: "", quantidade: "", valor_unitario: "", desconto: "0,00" });
    toast.success('Produto adicionado!');
  };

  const handleEditarProduto = (index) => {
    const produto = produtosLista[index];
    setProdutoAtual({
      produto_id: produto.produto_id,
      quantidade: formatarNumero(produto.quantidade),
      valor_unitario: formatarNumero(produto.valor_unitario),
      desconto: formatarNumero(produto.desconto)
    });
    handleRemoverProduto(produto.produto_id);
  };

  const handleRemoverProduto = (produto_id) => {
    setProdutosLista(produtosLista.filter(p => p.produto_id !== produto_id));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.tipo_movimentacao || produtosLista.length === 0 || !formData.tipo_detalhado || !formData.motivo_movimentacao) {
      toast.error('Preencha todos os campos obrigatórios e adicione pelo menos um produto!');
      return;
    }

    if ((formData.tipo_movimentacao === 'Entrada' || formData.tipo_movimentacao === 'Saída') && !formData.local_estoque) {
      toast.error('Defina o local de estoque!');
      return;
    }

    if (formData.tipo_movimentacao === 'Transferência' && (!formData.local_estoque || !formData.local_destino)) {
      toast.error('Defina local de origem e destino!');
      return;
    }

    if (formData.tipo_movimentacao === 'Transferência' && formData.tipo_detalhado === 'Entre Empresas' && !formData.empresa_destino_id) {
      toast.error('Selecione a empresa de destino!');
      return;
    }

    const centro = centros.find(c => c.id === formData.centro_custo_id);
    const fornecedor = fornecedores.find(f => f.id === formData.fornecedor_id);
    const empresaDestino = empresas.find(e => e.id === formData.empresa_destino_id);

    const dadosComuns = {
      tipo_movimentacao: formData.tipo_movimentacao,
      tipo_detalhado: formData.tipo_detalhado,
      local_estoque_origem: formData.tipo_movimentacao === 'Saída' || formData.tipo_movimentacao === 'Transferência' ? formData.local_estoque : undefined,
      local_estoque_destino: formData.tipo_movimentacao === 'Entrada' || formData.tipo_movimentacao === 'Transferência' ? (formData.tipo_movimentacao === 'Transferência' ? formData.local_destino : formData.local_estoque) : undefined,
      empresa_destino_id: formData.tipo_detalhado === 'Entre Empresas' ? formData.empresa_destino_id : undefined,
      empresa_destino_nome: empresaDestino?.nome,
      tipo_documento: formData.tipo_documento || undefined,
      numero_documento: formData.numero_documento || undefined,
      serie_documento: formData.serie_documento || undefined,
      chave_documento: formData.chave_documento || undefined,
      data_documento: formData.data_documento || undefined,
      cfop: formData.cfop || undefined,
      natureza_operacao: formData.natureza_operacao || undefined,
      fornecedor_id: formData.fornecedor_id || undefined,
      fornecedor_nome: fornecedor?.nome,
      cliente_nome: formData.cliente_nome || undefined,
      centro_custo_id: formData.centro_custo_id || undefined,
      centro_custo_nome: centro?.nome,
      motivo_movimentacao: formData.motivo_movimentacao,
      observacoes: formData.observacoes || undefined,
      data_movimentacao: new Date().toISOString(),
      status: 'Ativa'
    };

    onSubmit({ ...dadosComuns, produtos: produtosLista });
  };

  const tiposDetalhadosDisponiveis = TIPOS_DETALHADOS[formData.tipo_movimentacao] || [];
  const mostrarFornecedor = formData.tipo_movimentacao === 'Entrada';
  const mostrarCliente = formData.tipo_movimentacao === 'Saída' && ['Venda', 'Venda à Vista', 'Venda a Prazo'].some(t => formData.tipo_detalhado.includes(t));
  const mostrarDadosNFe = (formData.tipo_movimentacao === 'Entrada' && ['Compra', 'Compra à Vista', 'Compra a Prazo', 'Importação'].some(t => formData.tipo_detalhado.includes(t))) || 
                          (formData.tipo_movimentacao === 'Saída' && ['Venda', 'Venda à Vista', 'Venda a Prazo'].some(t => formData.tipo_detalhado.includes(t)));
  const mostrarLocalDestino = formData.tipo_movimentacao === 'Transferência';
  const mostrarEmpresaDestino = formData.tipo_movimentacao === 'Transferência' && formData.tipo_detalhado === 'Entre Empresas';

  const valorTotalGeral = produtosLista.reduce((acc, p) => acc + p.valor_total, 0);
  const descontoTotal = produtosLista.reduce((acc, p) => acc + p.desconto, 0);
  const subtotalGeral = produtosLista.reduce((acc, p) => acc + (p.quantidade * p.valor_unitario), 0);

  return (
    <>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
        <Card className="shadow-sm border-slate-300 bg-white">
          <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
            <CardTitle className="text-sm font-semibold text-slate-900">
              {initialData?.id ? 'Editar Movimentação' : 'Nova Movimentação de Estoque'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo de Movimentação *</Label>
                  <Select value={formData.tipo_movimentacao} onValueChange={(v) => { handleChange('tipo_movimentacao', v); handleChange('tipo_detalhado', ''); }} required>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Entrada" className="text-xs">Entrada</SelectItem>
                      <SelectItem value="Saída" className="text-xs">Saída</SelectItem>
                      <SelectItem value="Transferência" className="text-xs">Transferência</SelectItem>
                      <SelectItem value="Ajuste" className="text-xs">Ajuste</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Tipo Detalhado *</Label>
                  <Select value={formData.tipo_detalhado} onValueChange={(v) => handleChange('tipo_detalhado', v)} required disabled={!formData.tipo_movimentacao}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione o tipo acima" />
                    </SelectTrigger>
                    <SelectContent>
                      {tiposDetalhadosDisponiveis.map(tipo => (
                        <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Centro de Custo</Label>
                  <div className="flex gap-2">
                    <AutocompleteGenerico
                      items={centros}
                      value={formData.centro_custo_id}
                      onChange={(v) => handleChange('centro_custo_id', v)}
                      placeholder="Selecione o centro de custo"
                      displayField="nome"
                      searchFields={["nome", "codigo"]}
                      className="flex-1"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogCentro(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">
                    {formData.tipo_movimentacao === 'Entrada' ? 'Local Estoque Destino *' : 
                     formData.tipo_movimentacao === 'Saída' ? 'Local Estoque Origem *' : 
                     'Local Estoque Origem *'}
                  </Label>
                  <div className="flex gap-2">
                    <AutocompleteGenerico
                      items={locais}
                      value={formData.local_estoque}
                      onChange={(v) => handleChange('local_estoque', v)}
                      placeholder="Selecione o local"
                      displayField="nome"
                      searchFields={["nome", "descricao"]}
                      className="flex-1"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogLocal(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {mostrarLocalDestino && !mostrarEmpresaDestino && (
                  <div className="space-y-1">
                    <Label className="text-xs">Local Estoque Destino *</Label>
                    <div className="flex gap-2">
                      <AutocompleteGenerico
                        items={locais}
                        value={formData.local_destino}
                        onChange={(v) => handleChange('local_destino', v)}
                        placeholder="Selecione o local"
                        displayField="nome"
                        searchFields={["nome", "descricao"]}
                        className="flex-1"
                      />
                      <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogLocal(true)} className="h-8 w-8">
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                )}

                {mostrarEmpresaDestino && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs">Empresa Destino *</Label>
                      <AutocompleteGenerico
                        items={empresas}
                        value={formData.empresa_destino_id}
                        onChange={(v) => { handleChange('empresa_destino_id', v); handleChange('local_destino', ''); }}
                        placeholder="Selecione a empresa"
                        displayField="apelido"
                        searchFields={["apelido", "nome"]}
                        renderSubtext={(item) => item.nome}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Local na Empresa Destino *</Label>
                      <div className="flex gap-2">
                        <AutocompleteGenerico
                          items={locaisEmpresaDestino}
                          value={formData.local_destino}
                          onChange={(v) => handleChange('local_destino', v)}
                          placeholder="Selecione o local"
                          displayField="nome"
                          searchFields={["nome", "descricao"]}
                          className="flex-1"
                        />
                        <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogLocal(true)} className="h-8 w-8">
                          <Plus className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                {mostrarFornecedor && (
                  <div className="space-y-1">
                    <Label className="text-xs">Fornecedor *</Label>
                    <AutocompleteGenerico
                      items={fornecedores}
                      value={formData.fornecedor_id}
                      onChange={(v) => handleChange('fornecedor_id', v)}
                      placeholder="Selecione o fornecedor"
                      displayField="nome"
                      searchFields={["nome", "cpf", "cnpj"]}
                      renderSubtext={(item) => item.cpf || item.cnpj}
                    />
                  </div>
                )}

                {mostrarCliente && (
                  <div className="space-y-1">
                    <Label className="text-xs">Cliente/Destinatário</Label>
                    <Input value={formData.cliente_nome} onChange={(e) => handleChange('cliente_nome', e.target.value)} placeholder="Nome do Cliente" className="h-8 text-xs" />
                  </div>
                )}
              </div>

              {mostrarDadosNFe && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Tipo Documento</Label>
                      <Select value={formData.tipo_documento} onValueChange={(v) => handleChange('tipo_documento', v)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Nota Fiscal" className="text-xs">Nota Fiscal</SelectItem>
                          <SelectItem value="NF-e" className="text-xs">NF-e</SelectItem>
                          <SelectItem value="NFC-e" className="text-xs">NFC-e</SelectItem>
                          <SelectItem value="Recibo" className="text-xs">Recibo</SelectItem>
                          <SelectItem value="Outros" className="text-xs">Outros</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Nº Documento</Label>
                      <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" className="h-8 text-xs" />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Série</Label>
                      <Input value={formData.serie_documento} onChange={(e) => handleChange('serie_documento', e.target.value)} placeholder="001" className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Data Documento</Label>
                      <Input type="date" value={formData.data_documento} onChange={(e) => handleChange('data_documento', e.target.value)} className="h-8 text-xs" />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">CFOP</Label>
                      <Input value={formData.cfop} onChange={(e) => handleChange('cfop', e.target.value)} placeholder="0000" className="h-8 text-xs" maxLength={4} />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Natureza da Operação</Label>
                      <Input value={formData.natureza_operacao} onChange={(e) => handleChange('natureza_operacao', e.target.value)} placeholder="Compra para Comercialização" className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Chave NF-e (44 dígitos)</Label>
                    <Input value={formData.chave_documento} onChange={(e) => handleChange('chave_documento', e.target.value)} placeholder="00000000000000000000000000000000000000000000" className="h-8 text-xs" maxLength={44} />
                  </div>
                </>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Motivo da Movimentação *</Label>
                <Input value={formData.motivo_movimentacao} onChange={(e) => handleChange('motivo_movimentacao', e.target.value)} placeholder="Descreva o Motivo" className="h-8 text-xs" required />
              </div>

              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-2">
                  <Label className="text-xs font-semibold">Produtos *</Label>
                  <Button type="button" onClick={handleAdicionarProduto} size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700">
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar
                  </Button>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="w-8 text-xs"></TableHead>
                      <TableHead className="text-xs">Produto *</TableHead>
                      <TableHead className="text-xs text-right w-24">Qtd *</TableHead>
                      <TableHead className="text-xs text-right w-28">Total *</TableHead>
                      <TableHead className="text-xs text-right w-28">Desc.</TableHead>
                      <TableHead className="text-xs text-right w-28">Líquido</TableHead>
                      <TableHead className="text-xs w-12">UN</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {produtosLista.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-xs py-8 text-slate-500">
                          <AutocompleteGenerico
                            items={produtos}
                            value={produtoAtual.produto_id}
                            onChange={(v) => setProdutoAtual({...produtoAtual, produto_id: v})}
                            placeholder="Buscar produto..."
                            displayField="nome_produto"
                            searchFields={["nome_produto", "codigo_interno", "codigo_barras"]}
                            renderSubtext={(item) => item.codigo_interno}
                            className="max-w-md mx-auto"
                          />
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {produtosLista.map((prod, idx) => (
                          <TableRow key={idx}>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6">
                                    <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  <DropdownMenuItem onClick={() => handleEditarProduto(idx)} className="text-xs">
                                    Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => handleRemoverProduto(prod.produto_id)} className="text-xs text-red-600">
                                    Remover
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                            <TableCell className="text-xs font-medium">{prod.produto_nome}</TableCell>
                            <TableCell className="text-xs text-right">{formatarNumero(prod.quantidade)}</TableCell>
                            <TableCell className="text-xs text-right">{formatarMoeda(prod.quantidade * prod.valor_unitario)}</TableCell>
                            <TableCell className="text-xs text-right text-red-600">{formatarMoeda(prod.desconto)}</TableCell>
                            <TableCell className="text-xs text-right font-semibold text-emerald-700">{formatarMoeda(prod.valor_total)}</TableCell>
                            <TableCell className="text-xs text-slate-500">{prod.unidade_medida || '-'}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell colSpan={7} className="p-2">
                            <AutocompleteGenerico
                              items={produtos}
                              value={produtoAtual.produto_id}
                              onChange={(v) => setProdutoAtual({...produtoAtual, produto_id: v})}
                              placeholder="Buscar produto..."
                              displayField="nome_produto"
                              searchFields={["nome_produto", "codigo_interno", "codigo_barras"]}
                              renderSubtext={(item) => item.codigo_interno}
                            />
                          </TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>

                {produtosLista.length > 0 && produtoAtual.produto_id && (
                  <Card className="mt-3 bg-slate-50 border-slate-300">
                    <CardContent className="p-3">
                      <div className="grid grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Quantidade *</Label>
                          <Input 
                            value={produtoAtual.quantidade} 
                            onChange={(e) => setProdutoAtual({...produtoAtual, quantidade: e.target.value})} 
                            placeholder="0,00" 
                            className="h-8 text-xs" 
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Valor Unitário</Label>
                          <Input 
                            value={produtoAtual.valor_unitario} 
                            onChange={(e) => setProdutoAtual({...produtoAtual, valor_unitario: e.target.value})} 
                            placeholder="0,00" 
                            className="h-8 text-xs" 
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Desconto</Label>
                          <Input 
                            value={produtoAtual.desconto} 
                            onChange={(e) => setProdutoAtual({...produtoAtual, desconto: e.target.value})} 
                            placeholder="0,00" 
                            className="h-8 text-xs" 
                          />
                        </div>
                        <div className="flex items-end gap-2">
                          <Button type="button" onClick={handleAdicionarProduto} size="sm" className="h-8 text-xs flex-1 bg-emerald-600 hover:bg-emerald-700">
                            <Plus className="w-3.5 h-3.5 mr-1" />
                            Confirmar
                          </Button>
                          <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogProduto(true)} className="h-8 w-8">
                            <Plus className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {produtosLista.length > 0 && (
                  <Card className="mt-3 bg-blue-50 border-blue-200">
                    <CardContent className="p-3">
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-600">Total:</span>
                          <span className="font-bold">{formatarMoeda(subtotalGeral)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Desconto:</span>
                          <span className="font-bold text-red-600">{formatarMoeda(descontoTotal)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Líquido:</span>
                          <span className="font-bold text-emerald-700">{formatarMoeda(valorTotalGeral)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Observações</Label>
                <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="Observações Adicionais..." className="text-xs" rows={2} />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
                <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
                  {initialData?.id ? 'Atualizar' : 'Salvar Movimentação'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <DialogCadastroRapido tipo="local_estoque" open={showDialogLocal} onClose={() => setShowDialogLocal(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['locais_mov'] }); const local = locais.find(l => l.id === id); if (local && !formData.local_estoque) handleChange('local_estoque', local.nome); setShowDialogLocal(false); }} />
      <DialogCadastroRapido tipo="centro_custo" open={showDialogCentro} onClose={() => setShowDialogCentro(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['centros_mov'] }); handleChange('centro_custo_id', id); setShowDialogCentro(false); }} />
      <DialogCadastroRapido tipo="produto" open={showDialogProduto} onClose={() => setShowDialogProduto(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['produtos'] }); setProdutoAtual({...produtoAtual, produto_id: id}); setShowDialogProduto(false); }} />
    </>
  );
}