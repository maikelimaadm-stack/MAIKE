import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Save, X, Tag, Barcode, Hash, FileText, DollarSign, TrendingUp, Box } from "lucide-react";
import { motion } from "framer-motion";

export default function FormularioProduto({ onSubmit, onCancel, initialData = null, isEditing = false }) {
  const [formData, setFormData] = useState({
    nome_produto: initialData?.nome_produto || "",
    codigo_interno: initialData?.codigo_interno || "",
    codigo_barras: initialData?.codigo_barras || "",
    categoria: initialData?.categoria || "",
    descricao: initialData?.descricao || "",
    unidade_medida: initialData?.unidade_medida || "UN",
    preco_custo: initialData?.preco_custo || "",
    preco_venda: initialData?.preco_venda || "",
    estoque_atual: initialData?.estoque_atual || 0,
    estoque_minimo: initialData?.estoque_minimo || 0,
    observacoes: initialData?.observacoes || ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

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
              <Package className="w-5 h-5 text-white" />
            </div>
            {isEditing ? 'Editar Produto' : 'Novo Produto'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Identificação */}
            <div className="space-y-2">
              <Label className="text-slate-700 font-medium flex items-center gap-2">
                <Package className="w-4 h-4 text-green-600" />
                Nome do Produto *
              </Label>
              <Input
                value={formData.nome_produto}
                onChange={(e) => handleChange('nome_produto', e.target.value)}
                placeholder="Nome do produto"
                required
                className="border-slate-300 focus:border-green-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Hash className="w-4 h-4 text-blue-600" />
                  Código Interno
                </Label>
                <Input
                  value={formData.codigo_interno}
                  onChange={(e) => handleChange('codigo_interno', e.target.value)}
                  placeholder="Código"
                  className="border-slate-300 focus:border-green-500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Barcode className="w-4 h-4 text-purple-600" />
                  Código de Barras
                </Label>
                <Input
                  value={formData.codigo_barras}
                  onChange={(e) => handleChange('codigo_barras', e.target.value)}
                  placeholder="EAN/UPC"
                  className="border-slate-300 focus:border-green-500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Tag className="w-4 h-4 text-orange-600" />
                  Categoria
                </Label>
                <Input
                  value={formData.categoria}
                  onChange={(e) => handleChange('categoria', e.target.value)}
                  placeholder="Ex: Insumos, Ferramentas..."
                  className="border-slate-300 focus:border-green-500"
                />
              </div>
            </div>

            {/* Descrição */}
            <div className="space-y-2">
              <Label className="text-slate-700 font-medium flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-600" />
                Descrição
              </Label>
              <Textarea
                value={formData.descricao}
                onChange={(e) => handleChange('descricao', e.target.value)}
                placeholder="Descrição detalhada do produto..."
                className="border-slate-300 focus:border-green-500 min-h-20"
              />
            </div>

            {/* Unidade e Preços */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Box className="w-4 h-4 text-cyan-600" />
                  Unidade de Medida
                </Label>
                <Select value={formData.unidade_medida} onValueChange={(value) => handleChange('unidade_medida', value)}>
                  <SelectTrigger className="border-slate-300 focus:border-green-500">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UN">Unidade (UN)</SelectItem>
                    <SelectItem value="KG">Quilograma (KG)</SelectItem>
                    <SelectItem value="LT">Litro (LT)</SelectItem>
                    <SelectItem value="MT">Metro (MT)</SelectItem>
                    <SelectItem value="M²">Metro Quadrado (M²)</SelectItem>
                    <SelectItem value="M³">Metro Cúbico (M³)</SelectItem>
                    <SelectItem value="CX">Caixa (CX)</SelectItem>
                    <SelectItem value="PC">Peça (PC)</SelectItem>
                    <SelectItem value="SC">Saca (SC)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-amber-600" />
                  Preço de Custo
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.preco_custo}
                  onChange={(e) => handleChange('preco_custo', parseFloat(e.target.value) || 0)}
                  placeholder="0,00"
                  className="border-slate-300 focus:border-green-500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  Preço de Venda
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.preco_venda}
                  onChange={(e) => handleChange('preco_venda', parseFloat(e.target.value) || 0)}
                  placeholder="0,00"
                  className="border-slate-300 focus:border-green-500"
                />
              </div>
            </div>

            {/* Estoque */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Box className="w-4 h-4 text-green-600" />
                  Estoque Atual
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.estoque_atual}
                  onChange={(e) => handleChange('estoque_atual', parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className="border-slate-300 focus:border-green-500 text-lg font-semibold"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Box className="w-4 h-4 text-orange-600" />
                  Estoque Mínimo
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.estoque_minimo}
                  onChange={(e) => handleChange('estoque_minimo', parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className="border-slate-300 focus:border-green-500"
                />
              </div>
            </div>

            {/* Observações */}
            <div className="space-y-2">
              <Label className="text-slate-700 font-medium flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-600" />
                Observações
              </Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="Informações adicionais sobre o produto..."
                className="border-slate-300 focus:border-green-500 min-h-20"
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
                {isEditing ? 'Atualizar' : 'Salvar'} Produto
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}