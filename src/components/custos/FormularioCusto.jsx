import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    // Special handling for these fields to convert to uppercase
    if (['forma_pagamento', 'observacoes'].includes(field) && typeof value === 'string') {
      processedValue = value.toUpperCase();
    }
    setFormData(prev => ({ ...prev, [field]: processedValue }));
  };

  const valorTotal = (parseFloat(formData.quantidade) || 0) * (parseFloat(formData.valor_unitario) || 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {isEditing ? 'Editar Lançamento' : 'Novo Lançamento'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Fornecedor *</Label>
                <Select
                  value={formData.fornecedor_id}
                  onValueChange={(value) => handleChange('fornecedor_id', value)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {fornecedores.map(f => (
                      <SelectItem key={f.id} value={f.id} className="text-xs">{f.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Produto *</Label>
                <Select
                  value={formData.produto_id}
                  onValueChange={(value) => handleChange('produto_id', value)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {produtos.map(p => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">{p.nome_produto}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Quantidade *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.quantidade}
                  onChange={(e) => handleChange('quantidade', e.target.value)}
                  placeholder="0.00"
                  required
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Valor Unitário (R$) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.valor_unitario}
                  onChange={(e) => handleChange('valor_unitario', e.target.value)}
                  placeholder="0.00"
                  required
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Valor Total (R$)</Label>
                <Input
                  value={valorTotal.toFixed(2)}
                  readOnly
                  className="h-8 text-xs font-semibold bg-slate-50"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Prazo de Entrega</Label>
                <Input
                  type="date"
                  value={formData.prazo_entrega}
                  onChange={(e) => handleChange('prazo_entrega', e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Data da Entrega</Label>
                <Input
                  type="date"
                  value={formData.data_entrega}
                  onChange={(e) => handleChange('data_entrega', e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Status da Entrega</Label>
                <Select
                  value={formData.status_entrega}
                  onValueChange={(value) => handleChange('status_entrega', value)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pendente" className="text-xs">Pendente</SelectItem>
                    <SelectItem value="Em Trânsito" className="text-xs">Em Trânsito</SelectItem>
                    <SelectItem value="Entregue" className="text-xs">Entregue</SelectItem>
                    <SelectItem value="Cancelado" className="text-xs">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Forma de Pagamento</Label>
              <Input
                value={formData.forma_pagamento}
                onChange={(e) => handleChange('forma_pagamento', e.target.value)}
                placeholder="À VISTA, PRAZO, ETC"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Observações</Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="INFORMAÇÕES ADICIONAIS..."
                className="text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
              )}
              <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                {isEditing ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}