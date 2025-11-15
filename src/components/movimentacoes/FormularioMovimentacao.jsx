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
import { ArrowRightLeft, Save, X, Plus } from "lucide-react";
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

export default function FormularioMovimentacao({ onSubmit, onCancel, initialData = null, produtos, fornecedores }) {
  const [formData, setFormData] = useState({
    tipo_movimentacao: initialData?.tipo_movimentacao || "",
    tipo_detalhado: initialData?.tipo_detalhado?.toUpperCase() || "",
    produto_id: initialData?.produto_id || "",
    quantidade: initialData?.quantidade ? formatarNumero(initialData.quantidade) : "",
    local_estoque_origem: initialData?.local_estoque_origem?.toUpperCase() || "",
    local_estoque_destino: initialData?.local_estoque_destino?.toUpperCase() || "",
    valor_unitario: initialData?.valor_unitario ? formatarNumero(initialData.valor_unitario) : "",
    tipo_documento: initialData?.tipo_documento || "Nota Fiscal",
    numero_documento: initialData?.numero_documento || "",
    chave_documento: initialData?.chave_documento || "",
    data_documento: initialData?.data_documento || "",
    fornecedor_id: initialData?.fornecedor_id || "",
    cliente_nome: initialData?.cliente_nome?.toUpperCase() || "",
    centro_custo_id: initialData?.centro_custo_id || "",
    motivo_movimentacao: initialData?.motivo_movimentacao?.toUpperCase() || "",
    observacoes: initialData?.observacoes?.toUpperCase() || ""
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

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.tipo_movimentacao || !formData.produto_id || !formData.quantidade || !formData.tipo_detalhado || !formData.motivo_movimentacao) {
      toast.error('Preencha todos os campos obrigatórios!');
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

    const produto = produtos.find(p => p.id === formData.produto_id);
    const centro = centros.find(c => c.id === formData.centro_custo_id);

    const data = {
      tipo_movimentacao: formData.tipo_movimentacao,
      tipo_detalhado: formData.tipo_detalhado.toUpperCase(),
      produto_id: formData.produto_id,
      produto_nome: produto?.nome_produto?.toUpperCase(),
      produto_codigo: produto?.codigo_interno?.toUpperCase(),
      quantidade: parseNumero(formData.quantidade),
      unidade_medida: produto?.unidade_medida?.toUpperCase(),
      local_estoque_origem: formData.local_estoque_origem?.toUpperCase() || undefined,
      local_estoque_destino: formData.local_estoque_destino?.toUpperCase() || undefined,
      valor_unitario: formData.valor_unitario ? parseNumero(formData.valor_unitario) : undefined,
      valor_total: formData.valor_unitario ? parseNumero(formData.quantidade) * parseNumero(formData.valor_unitario) : undefined,
      tipo_documento: formData.tipo_documento || undefined,
      numero_documento: formData.numero_documento?.toUpperCase() || undefined,
      chave_documento: formData.chave_documento || undefined,
      data_documento: formData.data_documento || undefined,
      fornecedor_id: formData.fornecedor_id || undefined,
      fornecedor_nome: fornecedores.find(f => f.id === formData.fornecedor_id)?.nome?.toUpperCase(),
      cliente_nome: formData.cliente_nome?.toUpperCase() || undefined,
      centro_custo_id: formData.centro_custo_id || undefined,
      centro_custo_nome: centro?.nome?.toUpperCase(),
      motivo_movimentacao: formData.motivo_movimentacao.toUpperCase(),
      observacoes: formData.observacoes?.toUpperCase() || undefined,
      data_movimentacao: new Date().toISOString(),
      status: 'Ativa'
    };

    onSubmit(data);
  };

  const produtosOptions = produtos.map(p => ({ value: p.id, label: p.nome_produto }));
  const fornecedoresOptions = fornecedores.map(f => ({ value: f.id, label: f.nome }));
  const locaisOptions = locais.map(l => ({ value: l.nome, label: l.nome }));
  const centrosOptions = centros.map(c => ({ value: c.id, label: c.nome }));

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
                  <Select value={formData.tipo_movimentacao} onValueChange={(v) => handleChange('tipo_movimentacao', v)} required>
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
                  <Input value={formData.tipo_detalhado} onChange={(e) => handleChange('tipo_detalhado', e.target.value)} placeholder="COMPRA, VENDA, ETC" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} required />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Produto *</Label>
                  <div className="flex gap-2">
                    <Combobox
                      options={produtosOptions}
                      value={formData.produto_id}
                      onValueChange={(v) => handleChange('produto_id', v)}
                      placeholder="Selecione o produto"
                      searchPlaceholder="Buscar produto..."
                      className="flex-1 h-8 text-xs"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogProduto(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Quantidade *</Label>
                  <Input value={formData.quantidade} onChange={(e) => handleChange('quantidade', e.target.value)} placeholder="0,00" className="h-8 text-xs" required />
                </div>

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
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Valor Unitário</Label>
                  <Input value={formData.valor_unitario} onChange={(e) => handleChange('valor_unitario', e.target.value)} placeholder="0,00" className="h-8 text-xs" />
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

              <div className="space-y-1">
                <Label className="text-xs">Observações</Label>
                <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="OBSERVAÇÕES ADICIONAIS..." className="text-xs uppercase" style={{ textTransform: 'uppercase' }} rows={2} />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
                <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
                  {initialData?.id ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <DialogCadastroRapido tipo="local_estoque" open={showDialogLocal} onClose={() => setShowDialogLocal(false)} onSuccess={(id) => { const local = locais.find(l => l.id === id); if (local) { if (!formData.local_estoque_destino) handleChange('local_estoque_destino', local.nome); if (!formData.local_estoque_origem) handleChange('local_estoque_origem', local.nome); } setShowDialogLocal(false); }} />
      <DialogCadastroRapido tipo="centro_custo" open={showDialogCentro} onClose={() => setShowDialogCentro(false)} onSuccess={(id) => { handleChange('centro_custo_id', id); setShowDialogCentro(false); }} />
      <DialogCadastroRapido tipo="produto" open={showDialogProduto} onClose={() => setShowDialogProduto(false)} onSuccess={(id) => { handleChange('produto_id', id); setShowDialogProduto(false); }} />
    </>
  );
}