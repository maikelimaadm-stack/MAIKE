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

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const TIPOS_DETALHADOS = {
  'Entrada': ['COMPRA', 'COMPRA À VISTA', 'COMPRA A PRAZO', 'DEVOLUÇÃO DE CLIENTE', 'DOAÇÃO RECEBIDA', 'BONIFICAÇÃO', 'PRODUÇÃO', 'IMPORTAÇÃO', 'TRANSFERÊNCIA RECEBIDA', 'ACERTO DE ESTOQUE', 'OUTROS'],
  'Saída': ['VENDA', 'VENDA À VISTA', 'VENDA A PRAZO', 'DEVOLUÇÃO AO FORNECEDOR', 'DOAÇÃO', 'PERDA', 'QUEBRA', 'CONSUMO INTERNO', 'PRODUÇÃO', 'TRANSFERÊNCIA ENVIADA', 'ACERTO DE ESTOQUE', 'OUTROS'],
  'Transferência': ['ENTRE LOCAIS', 'ENTRE FAZENDAS', 'ENTRE FILIAIS', 'OUTROS'],
  'Ajuste': ['AJUSTE POSITIVO', 'AJUSTE NEGATIVO', 'INVENTÁRIO', 'CORREÇÃO', 'OUTROS']
};

export default function FormularioMovimentacao({ onSubmit, onCancel, initialData = null, produtos, fornecedores }) {
  const [formData, setFormData] = useState({
    tipo_movimentacao: initialData?.tipo_movimentacao || "",
    tipo_detalhado: initialData?.tipo_detalhado?.toUpperCase() || "",
    local_estoque: initialData?.local_estoque_origem?.toUpperCase() || initialData?.local_estoque_destino?.toUpperCase() || "",
    local_destino: initialData?.local_estoque_destino?.toUpperCase() || "",
    tipo_documento: initialData?.tipo_documento || "NOTA FISCAL",
    numero_documento: initialData?.numero_documento || "",
    serie_documento: initialData?.serie_documento || "",
    chave_documento: initialData?.chave_documento || "",
    data_documento: initialData?.data_documento || "",
    cfop: initialData?.cfop || "",
    natureza_operacao: initialData?.natureza_operacao || "",
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
    valor_unitario: "",
    desconto: "0,00"
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
    if (['tipo_detalhado', 'local_estoque', 'local_destino', 'cliente_nome', 'motivo_movimentacao', 'observacoes', 'natureza_operacao'].includes(field) && typeof value === 'string') {
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

  const handleRemoverProduto = (produto_id) => {
    setProdutosLista(produtosLista.filter(p => p.produto_id !== produto_id));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.tipo_movimentacao || produtosLista.length === 0 || !formData.tipo_detalhado || !formData.motivo_movimentacao) {
      toast.error('Preencha todos os campos obrigatórios e adicione pelo menos um produto!');
      return;
    }

    if (formData.tipo_movimentacao === 'Entrada' && !formData.local_estoque) {
      toast.error('Defina o local de estoque de destino!');
      return;
    }

    if (formData.tipo_movimentacao === 'Saída' && !formData.local_estoque) {
      toast.error('Defina o local de estoque de origem!');
      return;
    }

    if (formData.tipo_movimentacao === 'Transferência' && (!formData.local_estoque || !formData.local_destino)) {
      toast.error('Defina local de origem e destino!');
      return;
    }

    const centro = centros.find(c => c.id === formData.centro_custo_id);
    const fornecedor = fornecedores.find(f => f.id === formData.fornecedor_id);

    const dadosComuns = {
      tipo_movimentacao: formData.tipo_movimentacao,
      tipo_detalhado: formData.tipo_detalhado,
      local_estoque_origem: formData.tipo_movimentacao === 'Saída' || formData.tipo_movimentacao === 'Transferência' ? formData.local_estoque : undefined,
      local_estoque_destino: formData.tipo_movimentacao === 'Entrada' || formData.tipo_movimentacao === 'Transferência' ? (formData.tipo_movimentacao === 'Transferência' ? formData.local_destino : formData.local_estoque) : undefined,
      tipo_documento: formData.tipo_documento || undefined,
      numero_documento: formData.numero_documento?.toUpperCase() || undefined,
      serie_documento: formData.serie_documento?.toUpperCase() || undefined,
      chave_documento: formData.chave_documento || undefined,
      data_documento: formData.data_documento || undefined,
      cfop: formData.cfop || undefined,
      natureza_operacao: formData.natureza_operacao?.toUpperCase() || undefined,
      fornecedor_id: formData.fornecedor_id || undefined,
      fornecedor_nome: fornecedor?.nome?.toUpperCase(),
      cliente_nome: formData.cliente_nome?.toUpperCase() || undefined,
      centro_custo_id: formData.centro_custo_id || undefined,
      centro_custo_nome: centro?.nome?.toUpperCase(),
      motivo_movimentacao: formData.motivo_movimentacao,
      observacoes: formData.observacoes || undefined,
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
  const mostrarFornecedor = formData.tipo_movimentacao === 'Entrada' && ['COMPRA', 'COMPRA À VISTA', 'COMPRA A PRAZO', 'IMPORTAÇÃO'].some(t => formData.tipo_detalhado.includes(t));
  const mostrarCliente = formData.tipo_movimentacao === 'Saída' && ['VENDA', 'VENDA À VISTA', 'VENDA A PRAZO'].some(t => formData.tipo_detalhado.includes(t));
  const mostrarDadosNFe = ['COMPRA', 'VENDA', 'IMPORTAÇÃO'].some(t => formData.tipo_detalhado.includes(t));
  const mostrarLocalDestino = formData.tipo_movimentacao === 'Transferência';

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
                  <Label className="text-xs">
                    {formData.tipo_movimentacao === 'Entrada' ? 'Local Estoque Destino *' : 
                     formData.tipo_movimentacao === 'Saída' ? 'Local Estoque Origem *' : 
                     'Local Estoque Origem *'}
                  </Label>
                  <div className="flex gap-2">
                    <Combobox
                      options={locaisOptions}
                      value={formData.local_estoque}
                      onValueChange={(v) => handleChange('local_estoque', v)}
                      placeholder="Selecione"
                      searchPlaceholder="Buscar local..."
                      className="flex-1 h-8 text-xs"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogLocal(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {mostrarLocalDestino && (
                  <div className="space-y-1">
                    <Label className="text-xs">Local Estoque Destino *</Label>
                    <div className="flex gap-2">
                      <Combobox
                        options={locaisOptions}
                        value={formData.local_destino}
                        onValueChange={(v) => handleChange('local_destino', v)}
                        placeholder="Selecione"
                        searchPlaceholder="Buscar local..."
                        className="flex-1 h-8 text-xs"
                      />
                      <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogLocal(true)} className="h-8 w-8">
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                )}

                {mostrarFornecedor && (
                  <div className="space-y-1">
                    <Label className="text-xs">Fornecedor</Label>
                    <Combobox
                      options={fornecedoresOptions}
                      value={formData.fornecedor_id}
                      onValueChange={(v) => handleChange('fornecedor_id', v)}
                      placeholder="Selecione"
                      searchPlaceholder="Buscar fornecedor..."
                      className="h-8 text-xs"
                    />
                  </div>
                )}

                {mostrarCliente && (
                  <div className="space-y-1">
                    <Label className="text-xs">Cliente/Destinatário</Label>
                    <Input value={formData.cliente_nome} onChange={(e) => handleChange('cliente_nome', e.target.value)} placeholder="NOME DO CLIENTE" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
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
                          <SelectItem value="NOTA FISCAL" className="text-xs">Nota Fiscal</SelectItem>
                          <SelectItem value="NF-E" className="text-xs">NF-e</SelectItem>
                          <SelectItem value="NFC-E" className="text-xs">NFC-e</SelectItem>
                          <SelectItem value="RECIBO" className="text-xs">Recibo</SelectItem>
                          <SelectItem value="OUTROS" className="text-xs">Outros</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Nº Documento</Label>
                      <Input value={formData.numero_documento} onChange={(e) => handleChange('numero_documento', e.target.value)} placeholder="000000" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Série</Label>
                      <Input value={formData.serie_documento} onChange={(e) => handleChange('serie_documento', e.target.value)} placeholder="001" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
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
                      <Input value={formData.natureza_operacao} onChange={(e) => handleChange('natureza_operacao', e.target.value)} placeholder="COMPRA PARA COMERCIALIZAÇÃO" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
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
                <Input value={formData.motivo_movimentacao} onChange={(e) => handleChange('motivo_movimentacao', e.target.value)} placeholder="DESCREVA O MOTIVO" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} required />
              </div>

              <div className="border-t pt-4">
                <Label className="text-xs font-semibold">Adicionar Produtos *</Label>
                <div className="grid grid-cols-12 gap-2 mt-2">
                  <div className="col-span-4">
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
                      placeholder="Vlr. Un." 
                      className="h-8 text-xs" 
                    />
                  </div>
                  <div className="col-span-2">
                    <Input 
                      value={produtoAtual.desconto} 
                      onChange={(e) => setProdutoAtual({...produtoAtual, desconto: e.target.value})} 
                      placeholder="Desconto" 
                      className="h-8 text-xs" 
                    />
                  </div>
                  <div className="col-span-2 flex gap-2">
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
                          <TableHead className="text-xs text-right">Vlr. Unit.</TableHead>
                          <TableHead className="text-xs text-right">Subtotal</TableHead>
                          <TableHead className="text-xs text-right">Desconto</TableHead>
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
                            <TableCell className="text-xs text-right">R$ {formatarNumero(prod.quantidade * prod.valor_unitario)}</TableCell>
                            <TableCell className="text-xs text-right text-red-600">R$ {formatarNumero(prod.desconto)}</TableCell>
                            <TableCell className="text-xs text-right font-semibold">R$ {formatarNumero(prod.valor_total)}</TableCell>
                            <TableCell>
                              <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoverProduto(prod.produto_id)} className="h-6 w-6">
                                <Trash2 className="w-3.5 h-3.5 text-red-600" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-slate-50 font-semibold">
                          <TableCell colSpan={5} className="text-xs text-right">Subtotal:</TableCell>
                          <TableCell className="text-xs text-right">{formatarMoeda(subtotalGeral)}</TableCell>
                          <TableCell className="text-xs text-right text-red-600">{formatarMoeda(descontoTotal)}</TableCell>
                          <TableCell className="text-xs text-right">{formatarMoeda(valorTotalGeral)}</TableCell>
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

      <DialogCadastroRapido tipo="local_estoque" open={showDialogLocal} onClose={() => setShowDialogLocal(false)} onSuccess={(id) => { const local = locais.find(l => l.id === id); if (local) { if (!formData.local_estoque) handleChange('local_estoque', local.nome); } setShowDialogLocal(false); }} />
      <DialogCadastroRapido tipo="centro_custo" open={showDialogCentro} onClose={() => setShowDialogCentro(false)} onSuccess={(id) => { handleChange('centro_custo_id', id); setShowDialogCentro(false); }} />
      <DialogCadastroRapido tipo="produto" open={showDialogProduto} onClose={() => setShowDialogProduto(false)} onSuccess={(id) => { setProdutoAtual({...produtoAtual, produto_id: id}); setShowDialogProduto(false); }} />
    </>
  );
}