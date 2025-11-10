import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShoppingCart, Save, X, Plus, Trash2, ArrowLeft, ArrowRight, FileText } from "lucide-react";
import { toast } from "sonner";

const formatarNumero = (num) => {
  if (!num && num !== 0) return '0,00';
  const numero = typeof num === 'number' ? num : parseFloat(String(num).replace(/\./g, '').replace(',', '.'));
  if (isNaN(numero)) return '0,00';
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const parseNumero = (str) => {
  if (!str) return 0;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;
};

export default function FormularioCompraFinanceiro({ onSubmit, onCancel, initialData, fornecedores, produtos }) {
  const [etapa, setEtapa] = useState(1);
  const [formData, setFormData] = useState({
    // ETAPA 1 - COMPRA
    nota_pedido: "",
    compra_nf: "",
    data_emissao: new Date().toISOString().split('T')[0],
    data_entrega: "",
    gerar_financeiro: true,
    baixar_estoque: false,
    possui_xml: false,
    possui_anexo: false,
    reposicao: false,
    empresa_id: localStorage.getItem('empresa_selecionada_id'),
    observacoes_compra: "",
    fornecedor_id: "",
    
    // PRODUTOS
    produtos_selecionados: [],
    produto_atual: {
      produto_id: "",
      quantidade: "",
      valor_total: "",
      valor_desconto: "0,00",
      entregue: true,
      quantidade_entregue: "",
      data_entregue: "",
      local_estoque: "",
      validade: "",
      lote: ""
    },
    
    // ETAPA 2 - FINANCEIRO
    tipo_lancamento: "pagar", // pagar ou pago
    ano: new Date().getFullYear().toString(),
    data_emissao_fin: new Date().toISOString().split('T')[0],
    movimento: "",
    debito_ativo: "",
    lancamento: "",
    observacoes_fin: "",
    dt_emissao_fin: new Date().toISOString().split('T')[0],
    valor: "",
    num_doc: "",
    
    // IMPOSTO/LIVRO CAIXA
    imposto: "",
    contribuinte: "",
    livro_caixa: "",
    contribuinte_destino: "",
    recibo: "",
    livro_caixa_tipo_doc: "",
    pessoa_recibo: "",
    livro_caixa_tipo_lanc: "",
    
    // PARCELAMENTO
    tem_entrada: false,
    num_parcelas: "",
    venc_primeira: "",
    tipo_venc: "",
    intervalo_dias: "",
    retorno: "",
    ano_saldo: "",
    esta: "",
    valor_parcela: "",
    
    // GRUPOS
    grupos_despesa_receita: [],
    centros_custo: []
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => base44.entities.Empresa.list(),
    initialData: [],
  });

  const { data: locais = [] } = useQuery({
    queryKey: ['locais'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: [],
  });

  const { data: centros = [] } = useQuery({
    queryKey: ['centros_compra', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: grupos = [] } = useQuery({
    queryKey: ['grupos_compra', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.GrupoFinanceiro.list();
      return all.filter(g => g.empresa_id === empresaSelecionadaId && g.ativo !== false && g.tipo === 'Despesa');
    },
    enabled: !!empresaSelecionadaId,
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleProdutoAtualChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      produto_atual: { ...prev.produto_atual, [field]: value }
    }));
  };

  const adicionarProduto = () => {
    const { produto_id, quantidade, valor_total } = formData.produto_atual;
    
    if (!produto_id || !quantidade || !valor_total) {
      toast.error('Preencha Produto, Quantidade e Valor Total!');
      return;
    }

    const produto = produtos.find(p => p.id === produto_id);
    if (!produto) return;

    const novoProduto = {
      ...formData.produto_atual,
      produto_nome: produto.nome_produto,
      valor_unitario: parseNumero(valor_total) / parseNumero(quantidade)
    };

    setFormData(prev => ({
      ...prev,
      produtos_selecionados: [...prev.produtos_selecionados, novoProduto],
      produto_atual: {
        produto_id: "",
        quantidade: "",
        valor_total: "",
        valor_desconto: "0,00",
        entregue: true,
        quantidade_entregue: "",
        data_entregue: "",
        local_estoque: "",
        validade: "",
        lote: ""
      }
    }));

    toast.success('✅ Produto adicionado!');
  };

  const removerProduto = (index) => {
    setFormData(prev => ({
      ...prev,
      produtos_selecionados: prev.produtos_selecionados.filter((_, i) => i !== index)
    }));
    toast.success('Produto removido!');
  };

  const adicionarGrupoDespesa = () => {
    const motivo = prompt('Digite o motivo da despesa:');
    const nFat = prompt('Digite o nº da fatura/nota:');
    const valor = prompt('Digite o valor:');
    
    if (motivo && valor) {
      setFormData(prev => ({
        ...prev,
        grupos_despesa_receita: [...prev.grupos_despesa_receita, { motivo, nFat, valor }]
      }));
    }
  };

  const adicionarCentroCusto = () => {
    const motivo = prompt('Digite o motivo:');
    const centro = prompt('Digite o centro de custo:');
    const valor = prompt('Digite o valor:');
    
    if (motivo && centro && valor) {
      setFormData(prev => ({
        ...prev,
        centros_custo: [...prev.centros_custo, { motivo, centro, valor }]
      }));
    }
  };

  const handleProximaEtapa = () => {
    if (!formData.compra_nf || !formData.fornecedor_id) {
      toast.error('Preencha COMPRA/NF e Fornecedor!');
      return;
    }
    
    if (formData.produtos_selecionados.length === 0) {
      toast.error('Adicione pelo menos 1 produto!');
      return;
    }
    
    setEtapa(2);
  };

  const handleSubmitFinal = (e) => {
    e.preventDefault();
    
    if (!formData.valor) {
      toast.error('Preencha o Valor do lançamento financeiro!');
      return;
    }

    onSubmit(formData);
  };

  const totalProdutos = formData.produtos_selecionados.reduce((sum, p) => 
    sum + parseNumero(p.valor_total), 0
  );

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="shadow-xl border-slate-200">
        <CardHeader className="bg-gradient-to-r from-emerald-50 to-green-50 border-b">
          <CardTitle className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-base">Compra com Lançamento Financeiro</div>
              <div className="text-xs text-slate-600 font-normal">
                Etapa {etapa} de 2 - {etapa === 1 ? 'Informações da Compra' : 'Informações Financeiras'}
              </div>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="p-4">
          {/* ETAPA 1 - COMPRA */}
          {etapa === 1 && (
            <div className="space-y-4">
              <Card className="bg-slate-50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Etapa 1 - Compra</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Nota/Pedido</Label>
                      <Input value={formData.nota_pedido} onChange={(e) => handleChange('nota_pedido', e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">COMPRA/NF *</Label>
                      <Input value={formData.compra_nf} onChange={(e) => handleChange('compra_nf', e.target.value)} required className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Emissão</Label>
                      <Input type="date" value={formData.data_emissao} onChange={(e) => handleChange('data_emissao', e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Data Entrega</Label>
                      <Input type="date" value={formData.data_entrega} onChange={(e) => handleChange('data_entrega', e.target.value)} className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Gerar Financeiro?</Label>
                      <Select value={formData.gerar_financeiro ? "sim" : "nao"} onValueChange={(v) => handleChange('gerar_financeiro', v === "sim")}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sim" className="text-xs">Sim</SelectItem>
                          <SelectItem value="nao" className="text-xs">Não</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Baixar Estoque?</Label>
                      <Select value={formData.baixar_estoque ? "sim" : "nao"} onValueChange={(v) => handleChange('baixar_estoque', v === "sim")}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="nao" className="text-xs">Não</SelectItem>
                          <SelectItem value="sim" className="text-xs">Sim</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">XML?</Label>
                      <Select value={formData.possui_xml ? "sim" : "nao"} onValueChange={(v) => handleChange('possui_xml', v === "sim")}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="nao" className="text-xs">Não</SelectItem>
                          <SelectItem value="sim" className="text-xs">Sim</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Possui Anexo?</Label>
                      <Select value={formData.possui_anexo ? "sim" : "nao"} onValueChange={(v) => handleChange('possui_anexo', v === "sim")}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="nao" className="text-xs">Não, possui</SelectItem>
                          <SelectItem value="sim" className="text-xs">Sim</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Reposição?</Label>
                      <Select value={formData.reposicao ? "sim" : "nao"} onValueChange={(v) => handleChange('reposicao', v === "sim")}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="nao" className="text-xs">Não</SelectItem>
                          <SelectItem value="sim" className="text-xs">Sim</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Empresa *</Label>
                      <div className="flex gap-1.5">
                        <Select value={formData.empresa_id} onValueChange={(v) => handleChange('empresa_id', v)} className="flex-1">
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {empresas.map(e => <SelectItem key={e.id} value={e.id} className="text-xs">{e.apelido || e.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8 bg-amber-500 hover:bg-amber-600 text-white">
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Fornecedor *</Label>
                    <Select value={formData.fornecedor_id} onValueChange={(v) => handleChange('fornecedor_id', v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione o fornecedor" /></SelectTrigger>
                      <SelectContent>
                        {fornecedores.map(f => <SelectItem key={f.id} value={f.id} className="text-xs">{f.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Observação</Label>
                    <Textarea value={formData.observacoes_compra} onChange={(e) => handleChange('observacoes_compra', e.target.value)} rows={2} className="text-xs" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-blue-50 border-blue-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Escolha os Produtos</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-5 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Produto *</Label>
                      <div className="flex gap-1.5">
                        <Select value={formData.produto_atual.produto_id} onValueChange={(v) => handleProdutoAtualChange('produto_id', v)} className="flex-1">
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            {produtos.map(p => <SelectItem key={p.id} value={p.id} className="text-xs">{p.nome_produto}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8 bg-amber-500 hover:bg-amber-600 text-white">
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Quantidade *</Label>
                      <Input value={formData.produto_atual.quantidade} onChange={(e) => handleProdutoAtualChange('quantidade', e.target.value)} placeholder="0,00" className="h-8 text-xs" />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">V. Total *</Label>
                      <Input value={formData.produto_atual.valor_total} onChange={(e) => handleProdutoAtualChange('valor_total', e.target.value)} placeholder="0,00" className="h-8 text-xs" />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">V. Desconto</Label>
                      <Input value={formData.produto_atual.valor_desconto} onChange={(e) => handleProdutoAtualChange('valor_desconto', e.target.value)} placeholder="0,00" className="h-8 text-xs" />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Entregue?</Label>
                      <Select value={formData.produto_atual.entregue ? "sim" : "nao"} onValueChange={(v) => handleProdutoAtualChange('entregue', v === "sim")}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sim" className="text-xs">Sim</SelectItem>
                          <SelectItem value="nao" className="text-xs">Não</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-5 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Q. Entregue</Label>
                      <Input value={formData.produto_atual.quantidade_entregue} onChange={(e) => handleProdutoAtualChange('quantidade_entregue', e.target.value)} className="h-8 text-xs" />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Dt. Entregue</Label>
                      <Input type="date" value={formData.produto_atual.data_entregue} onChange={(e) => handleProdutoAtualChange('data_entregue', e.target.value)} className="h-8 text-xs" />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Local(Estoque)</Label>
                      <Select value={formData.produto_atual.local_estoque} onValueChange={(v) => handleProdutoAtualChange('local_estoque', v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {locais.map(l => <SelectItem key={l.id} value={l.nome} className="text-xs">{l.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Validade</Label>
                      <Input type="date" value={formData.produto_atual.validade} onChange={(e) => handleProdutoAtualChange('validade', e.target.value)} className="h-8 text-xs" />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Lote</Label>
                      <Input value={formData.produto_atual.lote} onChange={(e) => handleProdutoAtualChange('lote', e.target.value)} className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button type="button" onClick={adicionarProduto} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
                      <Plus className="w-3 h-3" />
                      Adicionar
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Produtos Adicionados</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Produto</TableHead>
                        <TableHead className="text-xs">Quantidade</TableHead>
                        <TableHead className="text-xs">Entregue</TableHead>
                        <TableHead className="text-xs">Lote</TableHead>
                        <TableHead className="text-xs">V. Unit</TableHead>
                        <TableHead className="text-xs">V. Total</TableHead>
                        <TableHead className="text-xs">Ação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {formData.produtos_selecionados.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-xs text-slate-500 py-4">
                            Nenhum produto adicionado
                          </TableCell>
                        </TableRow>
                      ) : (
                        formData.produtos_selecionados.map((prod, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-xs">{prod.produto_nome}</TableCell>
                            <TableCell className="text-xs">{prod.quantidade}</TableCell>
                            <TableCell className="text-xs">{prod.entregue ? 'Sim' : 'Não'}</TableCell>
                            <TableCell className="text-xs">{prod.lote || '-'}</TableCell>
                            <TableCell className="text-xs">R$ {formatarNumero(prod.valor_unitario)}</TableCell>
                            <TableCell className="text-xs font-semibold">R$ {prod.valor_total}</TableCell>
                            <TableCell>
                              <Button type="button" variant="ghost" size="icon" onClick={() => removerProduto(idx)} className="h-7 w-7 text-red-600">
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>

                  {formData.produtos_selecionados.length > 0 && (
                    <div className="mt-3 flex justify-end text-sm font-bold">
                      Total: R$ {formatarNumero(totalProdutos)}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 gap-1 text-xs">
                  <X className="w-3 h-3" />
                  Cancelar
                </Button>
                <Button type="button" onClick={handleProximaEtapa} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
                  Próximo
                  <ArrowRight className="w-3 h-3" />
                </Button>
              </div>
            </div>
          )}

          {/* ETAPA 2 - FINANCEIRO */}
          {etapa === 2 && (
            <form onSubmit={handleSubmitFinal} className="space-y-4">
              <Card className="bg-slate-50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Etapa 2 - Financeiro/Dados</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Tabs value={formData.tipo_lancamento} onValueChange={(v) => handleChange('tipo_lancamento', v)} className="w-full">
                    <TabsList className="grid w-full grid-cols-2 h-8">
                      <TabsTrigger value="paga" className="text-xs h-7">Conta Paga</TabsTrigger>
                      <TabsTrigger value="pagar" className="text-xs h-7">Conta a Pagar</TabsTrigger>
                    </TabsList>
                  </Tabs>

                  <div className="grid grid-cols-4 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Ano</Label>
                      <Input value={formData.ano} onChange={(e) => handleChange('ano', e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Data Emissão</Label>
                      <Input type="date" value={formData.data_emissao_fin} onChange={(e) => handleChange('data_emissao_fin', e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Movimento</Label>
                      <Input value={formData.movimento} onChange={(e) => handleChange('movimento', e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Lançamento</Label>
                      <Input value={formData.lancamento} onChange={(e) => handleChange('lancamento', e.target.value)} className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Débito/Ativo</Label>
                      <Input value={formData.debito_ativo} onChange={(e) => handleChange('debito_ativo', e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Dt. Emissão</Label>
                      <Input type="date" value={formData.dt_emissao_fin} onChange={(e) => handleChange('dt_emissao_fin', e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Valor *</Label>
                      <Input value={formData.valor} onChange={(e) => handleChange('valor', e.target.value)} placeholder="0,00" required className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Observação</Label>
                      <Textarea value={formData.observacoes_fin} onChange={(e) => handleChange('observacoes_fin', e.target.value)} rows={2} className="text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Num. Doc</Label>
                      <Input value={formData.num_doc} onChange={(e) => handleChange('num_doc', e.target.value)} className="h-8 text-xs" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-4">
                <Card className="bg-orange-50 border-orange-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Grupo de Despesa e Receita</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Motivo</TableHead>
                          <TableHead className="text-xs">Nº Pgto (Despesa e Receita)</TableHead>
                          <TableHead className="text-xs">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {formData.grupos_despesa_receita.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-xs text-slate-500 py-2">
                              Nenhum grupo adicionado
                            </TableCell>
                          </TableRow>
                        ) : (
                          formData.grupos_despesa_receita.map((g, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="text-xs">{g.motivo}</TableCell>
                              <TableCell className="text-xs">{g.nFat}</TableCell>
                              <TableCell className="text-xs">{g.valor}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                    <Button type="button" onClick={adicionarGrupoDespesa} size="sm" className="mt-2 h-7 gap-1 text-xs bg-amber-500 hover:bg-amber-600">
                      <Plus className="w-3 h-3" />
                      Adicionar
                    </Button>
                  </CardContent>
                </Card>

                <Card className="bg-purple-50 border-purple-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Centro de Custo</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Motivo</TableHead>
                          <TableHead className="text-xs">Centro Custo</TableHead>
                          <TableHead className="text-xs">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {formData.centros_custo.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-xs text-slate-500 py-2">
                              Nenhum centro adicionado
                            </TableCell>
                          </TableRow>
                        ) : (
                          formData.centros_custo.map((c, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="text-xs">{c.motivo}</TableCell>
                              <TableCell className="text-xs">{c.centro}</TableCell>
                              <TableCell className="text-xs">{c.valor}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                    <Button type="button" onClick={adicionarCentroCusto} size="sm" className="mt-2 h-7 gap-1 text-xs bg-amber-500 hover:bg-amber-600">
                      <Plus className="w-3 h-3" />
                      Adicionar
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <div className="flex justify-between gap-2 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setEtapa(1)} size="sm" className="h-8 gap-1 text-xs">
                  <ArrowLeft className="w-3 h-3" />
                  Voltar
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 gap-1 text-xs">
                    <X className="w-3 h-3" />
                    Cancelar
                  </Button>
                  <Button type="submit" size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
                    <Save className="w-3 h-3" />
                    Salvar Compra
                  </Button>
                </div>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}