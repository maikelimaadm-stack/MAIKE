import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowRightLeft, Save, X, Plus, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import DialogCadastroRapido from "../financeiro/DialogCadastroRapido.jsx";

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

const TIPOS_DETALHADOS = {
  'Entrada': [
    'Compra',
    'Compra à Vista',
    'Compra a Prazo',
    'Devolução de Cliente',
    'Doação Recebida',
    'Bonificação',
    'Produção',
    'Importação',
    'Transferência Recebida',
    'Acerto de Estoque',
    'Outros'
  ],
  'Saída': [
    'Venda',
    'Venda à Vista',
    'Venda a Prazo',
    'Devolução ao Fornecedor',
    'Doação',
    'Perda',
    'Quebra',
    'Consumo Interno',
    'Produção',
    'Transferência Enviada',
    'Acerto de Estoque',
    'Outros'
  ],
  'Transferência': [
    'Entre Locais',
    'Entre Fazendas',
    'Entre Filiais',
    'Outros'
  ],
  'Ajuste': [
    'Ajuste Positivo',
    'Ajuste Negativo',
    'Inventário',
    'Correção',
    'Outros'
  ]
};

export default function FormularioMovimentacao({ onSubmit, onCancel, initialData = null, produtos, fornecedores }) {
  const [formData, setFormData] = useState({
    tipo_movimentacao: initialData?.tipo_movimentacao || "",
    tipo_detalhado: initialData?.tipo_detalhado?.toUpperCase() || "",
    local_estoque_origem: initialData?.local_estoque_origem?.toUpperCase() || "",
    local_estoque_destino: initialData?.local_estoque_destino?.toUpperCase() || "",
    tipo_documento: initialData?.tipo_documento || "Nota Fiscal",
    numero_documento: initialData?.numero_documento || "",
    data_documento: initialData?.data_documento || "",
    fornecedor_id: initialData?.fornecedor_id || "",
    cliente_nome: initialData?.cliente_nome?.toUpperCase() || "",
    centro_custo_id: initialData?.centro_custo_id || "",
    motivo_movimentacao: initialData?.motivo_movimentacao?.toUpperCase() || "",
    observacoes: initialData?.observacoes?.toUpperCase() || ""
  });

  const [produtosLista, setProdutosLista] = useState([]);
  const [produtoAtual, setProdutoAtual] = useState({
    produto_id: "",
    quantidade: "",
    valor_unitario: ""
  });

  const [showDialogLocal, setShowDialogLocal] = useState(false);
  const [showDialogCentro, setShowDialogCentro] = useState(false);
  const [showDialogProduto, setShowDialogProduto] = useState(false);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

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

  const handleChange = (field, value) => {
    let processedValue = value;
    if (['tipo_detalhado', 'local_estoque_origem', 'local_estoque_destino', 'cliente_nome', 'motivo_movimentacao', 'observacoes'].includes(field) && typeof value === 'string') {
      processedValue = value.toUpperCase();
    }
    setFormData(prev => ({ ...prev, [field]: processedValue }));
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

    const novoProduto = {
      produto_id: produtoAtual.produto_id,
      produto_nome: produto?.nome_produto,
      produto_codigo: produto?.codigo_interno,
      unidade_medida: produto?.unidade_medida,
      quantidade: parseNumero(produtoAtual.quantidade),
      valor_unitario: produtoAtual.valor_unitario ? parseNumero(produtoAtual.valor_unitario) : 0,
      valor_total: produtoAtual.valor_unitario ? parseNumero(produtoAtual.quantidade) * parseNumero(produtoAtual.valor_unitario) : 0
    };

    setProdutosLista([...produtosLista, novoProduto]);
    setProdutoAtual({ produto_id: "", quantidade: "", valor_unitario: "" });
    toast.success('Produto adicionado!');
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

    if (formData.tipo_movimentacao === 'Entrada' && !formData.local_estoque_destino) {
      toast.error('Defina o local de destino!');
      return;
    }

    if (formData.tipo_movimentacao === 'Saída' && !formData.local_estoque_origem) {
      toast.error('Defina o local de origem!');
      return;
    }

    if (formData.tipo_movimentacao === 'Transferência' && (!formData.local_estoque_origem || !formData.local_estoque_destino)) {
      toast.error('Defina origem e destino!');
      return;
    }

    const centro = centros.find(c => c.id === formData.centro_custo_id);
    const fornecedor = fornecedores.find(f => f.id === formData.fornecedor_id);

    const dadosComuns = {
      tipo_movimentacao: formData.tipo_movimentacao,
      tipo_detalhado: formData.tipo_detalhado.toUpperCase(),
      local_estoque_origem: formData.local_estoque_origem?.toUpperCase() || undefined,
      local_estoque_destino: formData.local_estoque_destino?.toUpperCase() || undefined,
      tipo_documento: formData.tipo_documento || undefined,
      numero_documento: formData.numero_documento?.toUpperCase() || undefined,
      data_documento: formData.data_documento || undefined,
      fornecedor_id: formData.fornecedor_id || undefined,
      fornecedor_nome: fornecedor?.nome?.toUpperCase(),
      cliente_nome: formData.cliente_nome?.toUpperCase() || undefined,
      centro_custo_id: formData.centro_custo_id || undefined,
      centro_custo_nome: centro?.nome?.toUpperCase(),
      motivo_movimentacao: formData.motivo_movimentacao.toUpperCase(),
      observacoes: formData.observacoes?.toUpperCase() || undefined,
      data_movimentacao: new Date().toISOString(),
      status: 'Ativa'
    };

    onSubmit({ ...dadosComuns, produtos: produtosLista });
  };

  const produtosOptions = produtos.map(p => ({ value: p.id, label: p.nome_produto }));
  const fornecedoresOptions = fornecedores.map(f => ({ value: f.id, label: f.nome }));
  const locaisOptions = locais.map(l => ({ value: l.nome, label: l.nome }));
  const centrosOptions = centros.map(c => ({ value: c.id, label: c.nome }));

  const tiposDetalhadosDisponiveis = TIPOS_DETALHADOS[formData.tipo_movimentacao] || [];

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
                        <SelectItem key={tipo} value={tipo.toUpperCase()} className="text-xs">{tipo}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Centro de Custo</Label>
                  <div className="flex gap-2">
                    <Combobox
                      options={centrosOptions}
                      value={formData.centro_custo_id}
                      onValueChange={(v) => handleChange('centro_custo_id', v)}
                      placeholder="Selecione"
                      searchPlaceholder="Buscar centro..."
                      className="flex-1 h-8 text-xs"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogCentro(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Local Origem</Label>
                  <div className="flex gap-2">
                    <Combobox
                      options={locaisOptions}
                      value={formData.local_estoque_origem}
                      onValueChange={(v) => handleChange('local_estoque_origem', v)}
                      placeholder="Selecione"
                      searchPlaceholder="Buscar local..."
                      className="flex-1 h-8 text-xs"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogLocal(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Local Destino</Label>
                  <div className="flex gap-2">
                    <Combobox
                      options={locaisOptions}
                      value={formData.local_estoque_destino}
                      onValueChange={(v) => handleChange('local_estoque_destino', v)}
                      placeholder="Selecione"
                      searchPlaceholder="Buscar local..."
                      className="flex-1 h-8 text-xs"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogLocal(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Tipo Documento</Label>
                  <Select value={formData.tipo_documento} onValueChange={(v) => handleChange('tipo_documento', v)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Nota Fiscal" className="text-xs">Nota Fiscal</SelectItem>
                      <SelectItem value="Recibo" className="text-xs">Recibo</SelectItem>
                      <SelectItem value="Pedido de Compra" className="text-xs">Pedido de Compra</SelectItem>
                      <SelectItem value="Ordem de Serviço" className="text-xs">Ordem de Serviço</SelectItem>
                      <SelectItem value="Sem Documento" className="text-xs">Sem Documento</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nº Documento</Label>
                  <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Data Documento</Label>
                  <Input type="date" value={formData.data_documento} onChange={(e) => handleChange('data_documento', e.target.value)} className="h-8 text-xs" />
                </div>

                {formData.tipo_movimentacao === 'Entrada' && (
                  <div className="space-y-1">
                    <Label className="text-xs">Fornecedor</Label>
                    <Combobox
                      options={fornecedoresOptions}
                      value={formData.fornecedor_id}
                      onValueChange={(v) => handleChange('fornecedor_id', v)}
                      placeholder="Selecione o fornecedor"
                      searchPlaceholder="Buscar fornecedor..."
                      className="h-8 text-xs"
                    />
                  </div>
                )}

                {formData.tipo_movimentacao === 'Saída' && (
                  <div className="space-y-1">
                    <Label className="text-xs">Cliente/Destinatário</Label>
                    <Input value={formData.cliente_nome} onChange={(e) => handleChange('cliente_nome', e.target.value)} placeholder="NOME DO CLIENTE" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Motivo da Movimentação *</Label>
                <Input value={formData.motivo_movimentacao} onChange={(e) => handleChange('motivo_movimentacao', e.target.value)} placeholder="DESCREVA O MOTIVO" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} required />
              </div>

              <div className="border-t pt-4">
                <Label className="text-xs font-semibold">Adicionar Produtos *</Label>
                <div className="grid grid-cols-12 gap-2 mt-2">
                  <div className="col-span-5">
                    <Combobox
                      options={produtosOptions}
                      value={produtoAtual.produto_id}
                      onValueChange={(v) => setProdutoAtual({...produtoAtual, produto_id: v})}
                      placeholder="Selecione o produto"
                      searchPlaceholder="Buscar produto..."
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="col-span-2">
                    <Input 
                      value={produtoAtual.quantidade} 
                      onChange={(e) => setProdutoAtual({...produtoAtual, quantidade: e.target.value})} 
                      placeholder="Qtd" 
                      className="h-8 text-xs" 
                    />
                  </div>
                  <div className="col-span-2">
                    <Input 
                      value={produtoAtual.valor_unitario} 
                      onChange={(e) => setProdutoAtual({...produtoAtual, valor_unitario: e.target.value})} 
                      placeholder="Valor Un." 
                      className="h-8 text-xs" 
                    />
                  </div>
                  <div className="col-span-3 flex gap-2">
                    <Button type="button" onClick={handleAdicionarProduto} size="sm" className="h-8 text-xs flex-1 bg-emerald-600 hover:bg-emerald-700">
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Adicionar
                    </Button>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogProduto(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {produtosLista.length > 0 && (
                  <div className="mt-3 border rounded">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead className="text-xs">Produto</TableHead>
                          <TableHead className="text-xs">Código</TableHead>
                          <TableHead className="text-xs">Unidade</TableHead>
                          <TableHead className="text-xs text-right">Quantidade</TableHead>
                          <TableHead className="text-xs text-right">Valor Un.</TableHead>
                          <TableHead className="text-xs text-right">Total</TableHead>
                          <TableHead className="text-xs w-12"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {produtosLista.map((prod, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-xs">{prod.produto_nome}</TableCell>
                            <TableCell className="text-xs">{prod.produto_codigo || '-'}</TableCell>
                            <TableCell className="text-xs">{prod.unidade_medida || '-'}</TableCell>
                            <TableCell className="text-xs text-right">{formatarNumero(prod.quantidade)}</TableCell>
                            <TableCell className="text-xs text-right">R$ {formatarNumero(prod.valor_unitario)}</TableCell>
                            <TableCell className="text-xs text-right font-semibold">R$ {formatarNumero(prod.valor_total)}</TableCell>
                            <TableCell>
                              <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoverProduto(prod.produto_id)} className="h-6 w-6">
                                <Trash2 className="w-3.5 h-3.5 text-red-600" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-slate-50 font-semibold">
                          <TableCell colSpan={5} className="text-xs text-right">Total Geral:</TableCell>
                          <TableCell className="text-xs text-right">R$ {formatarNumero(produtosLista.reduce((acc, p) => acc + p.valor_total, 0))}</TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Observações</Label>
                <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="OBSERVAÇÕES ADICIONAIS..." className="text-xs uppercase" style={{ textTransform: 'uppercase' }} rows={2} />
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

      <DialogCadastroRapido tipo="local_estoque" open={showDialogLocal} onClose={() => setShowDialogLocal(false)} onSuccess={(id) => { const local = locais.find(l => l.id === id); if (local) { if (!formData.local_estoque_destino) handleChange('local_estoque_destino', local.nome); if (!formData.local_estoque_origem) handleChange('local_estoque_origem', local.nome); } setShowDialogLocal(false); }} />
      <DialogCadastroRapido tipo="centro_custo" open={showDialogCentro} onClose={() => setShowDialogCentro(false)} onSuccess={(id) => { handleChange('centro_custo_id', id); setShowDialogCentro(false); }} />
      <DialogCadastroRapido tipo="produto" open={showDialogProduto} onClose={() => setShowDialogProduto(false)} onSuccess={(id) => { setProdutoAtual({...produtoAtual, produto_id: id}); setShowDialogProduto(false); }} />
    </>
  );
}