import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { DollarSign, Save, X, Package, Users, Calendar, Truck, CreditCard, FileText } from "lucide-react";
import { motion } from "framer-motion";

export default function FormularioCusto({ onSubmit, onCancel, initialData = null, isEditing = false, fornecedores = [], produtos = [] }) {
  const [formData, setFormData] = useState({
    fornecedor_id: initialData?.fornecedor_id || "",
    produto_id: initialData?.produto_id || "",
    quantidade: initialData?.quantidade || "",
    valor_unitario: initialData?.valor_unitario || "",
    prazo_entrega: initialData?.prazo_entrega || "",
    data_entrega: initialData?.data_entrega || "",
    status_entrega: initialData?.status_entrega || "Pendente",
    forma_pagamento: initialData?.forma_pagamento || "",
    observacoes: initialData?.observacoes || ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleChange = (field, value) => {
    let processedValue = value;
    if (['forma_pagamento', 'observacoes'].includes(field) && typeof value === 'string') {
      processedValue = value.toUpperCase();
    }
    setFormData(prev => ({ ...prev, [field]: processedValue }));
  };

  const valorTotal = (parseFloat(formData.quantidade) || 0) * (parseFloat(formData.valor_unitario) || 0);

  const fornecedoresOptions = fornecedores.map(f => ({ value: f.id, label: f.nome }));
  const produtosOptions = produtos.map(p => ({ value: p.id, label: p.nome_produto }));

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="shadow-xl border-slate-200 bg-white">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            {isEditing ? 'Editar Lançamento' : 'Novo Lançamento'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  Fornecedor *
                </Label>
                <Combobox
                  options={fornecedoresOptions}
                  value={formData.fornecedor_id}
                  onValueChange={(value) => handleChange('fornecedor_id', value)}
                  placeholder="Selecione o fornecedor"
                  searchPlaceholder="Buscar fornecedor..."
                  className="border-slate-300 focus:border-green-500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Package className="w-4 h-4 text-purple-600" />
                  Produto *
                </Label>
                <Combobox
                  options={produtosOptions}
                  value={formData.produto_id}
                  onValueChange={(value) => handleChange('produto_id', value)}
                  placeholder="Selecione o produto"
                  searchPlaceholder="Buscar produto..."
                  className="border-slate-300 focus:border-green-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Package className="w-4 h-4 text-green-600" />
                  Quantidade *
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.quantidade}
                  onChange={(e) => handleChange('quantidade', e.target.value)}
                  placeholder="0.00"
                  required
                  className="border-slate-300 focus:border-green-500 text-lg font-semibold"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  Valor Unitário (R$) *
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.valor_unitario}
                  onChange={(e) => handleChange('valor_unitario', e.target.value)}
                  placeholder="0.00"
                  required
                  className="border-slate-300 focus:border-green-500 text-lg font-semibold"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Valor Total (R$)</Label>
                <div className="h-10 px-3 rounded-lg border-2 border-green-500 bg-green-50 flex items-center">
                  <span className="text-2xl font-bold text-green-700">
                    {valorTotal.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-orange-600" />
                  Prazo de Entrega
                </Label>
                <Input
                  type="date"
                  value={formData.prazo_entrega}
                  onChange={(e) => handleChange('prazo_entrega', e.target.value)}
                  className="border-slate-300 focus:border-green-500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-orange-600" />
                  Data da Entrega
                </Label>
                <Input
                  type="date"
                  value={formData.data_entrega}
                  onChange={(e) => handleChange('data_entrega', e.target.value)}
                  className="border-slate-300 focus:border-green-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Truck className="w-4 h-4 text-indigo-600" />
                  Status da Entrega
                </Label>
                <Select 
                  value={formData.status_entrega} 
                  onValueChange={(value) => handleChange('status_entrega', value)}
                >
                  <SelectTrigger className="border-slate-300 focus:border-green-500">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pendente">Pendente</SelectItem>
                    <SelectItem value="Em Trânsito">Em Trânsito</SelectItem>
                    <SelectItem value="Entregue">Entregue</SelectItem>
                    <SelectItem value="Cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-cyan-600" />
                  Forma de Pagamento
                </Label>
                <Input
                  value={formData.forma_pagamento}
                  onChange={(e) => handleChange('forma_pagamento', e.target.value)}
                  placeholder="À VISTA, PRAZO, ETC"
                  className="border-slate-300 focus:border-green-500 uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-700 font-medium flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-600" />
                Observações
              </Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="INFORMAÇÕES ADICIONAIS..."
                className="border-slate-300 focus:border-green-500 min-h-20 uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
                  <X className="w-4 h-4" />
                  Cancelar
                </Button>
              )}
              <Button type="submit" className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg">
                <Save className="w-4 h-4" />
                {isEditing ? 'Atualizar' : 'Salvar'} Lançamento
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}