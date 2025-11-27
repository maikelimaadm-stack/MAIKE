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

const TIPOS_DETALHADOS = {
  'Entrada': ['Compra', 'Compra à Vista', 'Compra a Prazo', 'Devolução de Cliente', 'Doação Recebida', 'Bonificação', 'Produção', 'Importação', 'Transferência Recebida', 'Acerto de Estoque', 'Outros'],
  'Saída': ['Venda', 'Venda à Vista', 'Venda a Prazo', 'Devolução ao Fornecedor', 'Doação', 'Perda', 'Quebra', 'Consumo Interno', 'Produção', 'Transferência Enviada', 'Acerto de Estoque', 'Outros'],
  'Transferência': ['Entre Locais', 'Entre Empresas', 'Entre Filiais', 'Outros'],
  'Ajuste': ['Ajuste Positivo', 'Ajuste Negativo', 'Inventário', 'Correção', 'Outros']
};

export default function FormularioMovimentacao({ onSubmit, onCancel, initialData = null, produtos, fornecedores }) {
  const [formData, setFormData] = useState(() => {
    // Se estiver editando uma movimentação existente (sem produtos_selecionados), montar o produto
    let produtosSelecionados = initialData?.produtos_selecionados || [];
    
    // Se é uma edição de movimentação existente (tem produto_id mas não tem produtos_selecionados)
    if (initialData?.produto_id && produtosSelecionados.length === 0) {
      produtosSelecionados = [{
        produto_id: initialData.produto_id,
        produto_nome: initialData.produto_nome || '',
        quantidade: String(initialData.quantidade || '').replace('.', ','),
        valor_total: String(initialData.valor_total || '').replace('.', ','),
        desconto_item: '0,00',
        unidade: initialData.unidade_medida || ''
      }];
    }

    return {
      tipo_movimentacao: initialData?.tipo_movimentacao || "",
      tipo_detalhado: initialData?.tipo_detalhado || "",
      local_estoque: initialData?.local_estoque_origem || initialData?.local_estoque_destino || initialData?.local_estoque || "",
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
      observacoes: initialData?.observacoes || "",
      produtos_selecionados: produtosSelecionados
    };
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
    setFormData(prev => ({
      ...prev,
      produtos_selecionados: [...prev.produtos_selecionados, { produto_id: "", produto_nome: "", quantidade: "", valor_total: "", desconto_item: "0,00" }]
    }));
  };

  const handleRemoverProduto = (index) => {
    setFormData(prev => ({
      ...prev,
      produtos_selecionados: prev.produtos_selecionados.filter((_, i) => i !== index)
    }));
  };

  const handleAtualizarProduto = (index, campo, valor) => {
    setFormData(prev => ({
      ...prev,
      produtos_selecionados: prev.produtos_selecionados.map((p, i) => {
        if (i === index) {
          const updated = { ...p, [campo]: valor };

          if (campo === 'produto_id') {
            const produto = produtos.find(prod => prod.id === valor);
            if (produto) {
              updated.produto_nome = produto.nome_produto;
              updated.unidade = produto.unidade_medida;
            }
          }
          return updated;
        }
        return p;
      })
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.tipo_movimentacao || formData.produtos_selecionados.length === 0 || !formData.tipo_detalhado) {
      toast.error('Preencha todos os campos obrigatórios e adicione pelo menos um produto!');
      return;
    }

    if (formData.tipo_movimentacao === 'Ajuste' && !formData.motivo_movimentacao) {
      toast.error('Informe o motivo do ajuste!');
      return;
    }

    const produtosIncompletos = formData.produtos_selecionados.filter(p =>
      !p.produto_id || parseNumero(p.quantidade) <= 0 || parseNumero(p.valor_total) <= 0
    );
    if (produtosIncompletos.length > 0) {
      toast.error('Preencha todos os campos dos produtos!');
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

    if (formData.tipo_movimentacao === 'Entrada' && !formData.fornecedor_id) {
      toast.error('Selecione o fornecedor!');
      return;
    }

    const centro = centros.find(c => c.id === formData.centro_custo_id);
    const fornecedor = fornecedores.find(f => f.id === formData.fornecedor_id);
    const empresaDestino = empresas.find(e => e.id === formData.empresa_destino_id);

    const produtosProcessados = formData.produtos_selecionados.map(p => {
      const qtd = parseNumero(p.quantidade);
      const totalGross = parseNumero(p.valor_total);
      const desconto = parseNumero(p.desconto_item || "0");
      const valorLiquido = totalGross - desconto;
      const valorUnitario = qtd > 0 ? (valorLiquido / qtd) : 0;
      
      return {
        produto_id: p.produto_id,
        produto_nome: p.produto_nome,
        produto_codigo: p.produto_codigo,
        unidade_medida: p.unidade,
        quantidade: qtd,
        valor_unitario: valorUnitario,
        desconto: desconto,
        valor_total: valorLiquido
      };
    });

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

    onSubmit({ ...dadosComuns, produtos: produtosProcessados });
  };

  const tiposDetalhadosDisponiveis = TIPOS_DETALHADOS[formData.tipo_movimentacao] || [];
  const mostrarFornecedor = formData.tipo_movimentacao === 'Entrada';
  const mostrarCliente = formData.tipo_movimentacao === 'Saída' && ['Venda', 'Venda à Vista', 'Venda a Prazo'].some(t => formData.tipo_detalhado.includes(t));
  const mostrarDadosNFe = (formData.tipo_movimentacao === 'Entrada' && ['Compra', 'Compra à Vista', 'Compra a Prazo', 'Importação'].some(t => formData.tipo_detalhado.includes(t))) || 
                          (formData.tipo_movimentacao === 'Saída' && ['Venda', 'Venda à Vista', 'Venda a Prazo'].some(t => formData.tipo_detalhado.includes(t)));
  const mostrarLocalDestino = formData.tipo_movimentacao === 'Transferência';
  const mostrarEmpresaDestino = formData.tipo_movimentacao === 'Transferência' && formData.tipo_detalhado === 'Entre Empresas';

  const totalProdutosLiquido = formData.produtos_selecionados.reduce((sum, p) => {
    const total = parseNumero(p.valor_total || "0");
    const desc = parseNumero(p.desconto_item || "0");
    return sum + (total - desc);
  }, 0);

  const totalProdutosBruto = formData.produtos_selecionados.reduce((sum, p) => {
    return sum + parseNumero(p.valor_total || "0");
  }, 0);

  const totalDescontos = formData.produtos_selecionados.reduce((sum, p) => {
    return sum + parseNumero(p.desconto_item || "0");
  }, 0);

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
                      value={locais.find(l => l.nome === formData.local_estoque)?.id || ""}
                      onChange={(id) => {
                        const local = locais.find(l => l.id === id);
                        handleChange('local_estoque', local?.nome || "");
                      }}
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
                        value={locais.find(l => l.nome === formData.local_destino)?.id || ""}
                        onChange={(id) => {
                          const local = locais.find(l => l.id === id);
                          handleChange('local_destino', local?.nome || "");
                        }}
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
                          value={locaisEmpresaDestino.find(l => l.nome === formData.local_destino)?.id || ""}
                          onChange={(id) => {
                            const local = locaisEmpresaDestino.find(l => l.id === id);
                            handleChange('local_destino', local?.nome || "");
                          }}
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

              {formData.tipo_movimentacao === 'Ajuste' && (
                <div className="space-y-1">
                  <Label className="text-xs">Motivo do Ajuste *</Label>
                  <Input value={formData.motivo_movimentacao} onChange={(e) => handleChange('motivo_movimentacao', e.target.value)} placeholder="Descreva o motivo do ajuste" className="h-8 text-xs" required />
                </div>
              )}

              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-2">
                  <Label className="text-xs font-semibold">Produtos</Label>
                  <Button type="button" onClick={handleAdicionarProduto} variant="outline" size="sm" className="h-7 text-xs gap-1">
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar
                  </Button>
                </div>

                {formData.produtos_selecionados.length > 0 && (
                  <div className="border rounded bg-white">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead className="w-8 text-xs"></TableHead>
                          <TableHead className="min-w-[180px] text-xs">Produto *</TableHead>
                          <TableHead className="text-center w-16 text-xs">Qtd *</TableHead>
                          <TableHead className="text-center w-20 text-xs">Total *</TableHead>
                          <TableHead className="text-center w-20 text-xs">Desc.</TableHead>
                          <TableHead className="text-center w-24 text-xs">Líquido</TableHead>
                          <TableHead className="text-center w-12 text-xs">UN</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {formData.produtos_selecionados.map((produto, index) => {
                          const total = parseNumero(produto.valor_total || "0");
                          const desc = parseNumero(produto.desconto_item || "0");
                          const liquido = total - desc;
                          const qtd = parseNumero(produto.quantidade || "0");
                          const unitario = qtd > 0 ? (liquido / qtd) : 0;

                          return (
                            <TableRow key={index}>
                              <TableCell className="w-8">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-6 w-6">
                                      <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="start">
                                    <DropdownMenuItem onClick={() => handleRemoverProduto(index)} className="text-xs text-red-600">
                                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                                      Excluir
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                              <TableCell className="min-w-[180px]">
                                <AutocompleteGenerico
                                  items={produtos}
                                  value={produto.produto_id}
                                  onChange={(v) => handleAtualizarProduto(index, 'produto_id', v)}
                                  placeholder="Buscar produto..."
                                  displayField="nome_produto"
                                  searchFields={["nome_produto", "codigo_interno", "codigo_barras"]}
                                  renderSubtext={(p) => p.codigo_interno ? `Cód: ${p.codigo_interno}` : ''}
                                  className="w-full"
                                />
                              </TableCell>
                              <TableCell className="w-16">
                                <Input 
                                  value={produto.quantidade} 
                                  onChange={(e) => {
                                    const valor = e.target.value.replace(/[^\d,]/g, '');
                                    handleAtualizarProduto(index, 'quantidade', valor);
                                  }} 
                                  placeholder="0,00" 
                                  className="text-center h-6 text-xs" 
                                />
                              </TableCell>
                              <TableCell className="w-20">
                                <Input 
                                  value={produto.valor_total} 
                                  onChange={(e) => {
                                    const valor = e.target.value.replace(/[^\d,]/g, '');
                                    handleAtualizarProduto(index, 'valor_total', valor);
                                  }} 
                                  placeholder="0,00" 
                                  className="text-center h-6 text-xs" 
                                />
                              </TableCell>
                              <TableCell className="w-20">
                                <Input 
                                  value={produto.desconto_item || "0,00"} 
                                  onChange={(e) => {
                                    const valor = e.target.value.replace(/[^\d,]/g, '');
                                    handleAtualizarProduto(index, 'desconto_item', valor);
                                  }} 
                                  placeholder="0,00" 
                                  className="text-center h-6 text-xs" 
                                />
                              </TableCell>
                              <TableCell className="w-24">
                                <div className="text-center">
                                  <div className="font-bold text-xs">{formatarMoeda(liquido)}</div>
                                  <div className="text-[10px] text-slate-500">Un: {formatarMoeda(unitario)}</div>
                                </div>
                              </TableCell>
                              <TableCell className="text-center w-12">
                                <span className="text-xs font-mono">{produto.unidade || '-'}</span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {formData.produtos_selecionados.length > 0 && (
                  <div className="mt-3 bg-white border border-slate-300 rounded p-3">
                    <div className="space-y-1 text-xs">
                      <div className="font-semibold text-slate-800 mb-1">Valor a Pagar</div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Produtos (líquido):</span>
                        <span className="font-mono font-semibold text-slate-800">{formatarMoeda(totalProdutosLiquido)}</span>
                      </div>
                      <div className="flex justify-between font-bold border-t pt-1 mt-1 text-slate-900">
                        <span>TOTAL A PAGAR:</span>
                        <span className="font-mono text-base">{formatarMoeda(totalProdutosLiquido)}</span>
                      </div>
                    </div>
                  </div>
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
      <DialogCadastroRapido tipo="produto" open={showDialogProduto} onClose={() => setShowDialogProduto(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['produtos'] }); setShowDialogProduto(false); }} />
    </>
  );
}