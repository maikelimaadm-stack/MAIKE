import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Scale, Save, X, Calculator } from "lucide-react";
import { motion } from "framer-motion";

export default function FormularioPesagem({ onSubmit, onCancel, initialData = null, isEditing = false }) {
  const [formData, setFormData] = useState({
    data_pesagem: initialData?.data_pesagem || new Date().toISOString().split('T')[0],
    tipo_pesagem: initialData?.tipo_pesagem || "",
    placa_caminhao: initialData?.placa_caminhao || "",
    nome_motorista: initialData?.nome_motorista || "",
    produto: initialData?.produto || "",
    fornecedor_destino: initialData?.fornecedor_destino || "",
    peso_tara: initialData?.peso_tara || "",
    peso_bruto: initialData?.peso_bruto || "",
    peso_liquido: initialData?.peso_liquido || 0,
    observacoes: initialData?.observacoes || ""
  });

  useEffect(() => {
    const tara = parseFloat(formData.peso_tara) || 0;
    const bruto = parseFloat(formData.peso_bruto) || 0;
    const liquido = bruto - tara;
    setFormData(prev => ({ ...prev, peso_liquido: liquido }));
  }, [formData.peso_tara, formData.peso_bruto]);

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
        <CardHeader className="bg-gradient-to-r from-blue-50 to-slate-50 border-b border-slate-200">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center">
              <Scale className="w-5 h-5 text-white" />
            </div>
            {isEditing ? 'Editar Pesagem' : 'Nova Pesagem'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="data_pesagem" className="text-slate-700 font-medium">
                  Data da Pesagem *
                </Label>
                <Input
                  id="data_pesagem"
                  type="date"
                  value={formData.data_pesagem}
                  onChange={(e) => handleChange('data_pesagem', e.target.value)}
                  required
                  className="border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tipo_pesagem" className="text-slate-700 font-medium">
                  Tipo de Pesagem *
                </Label>
                <Select value={formData.tipo_pesagem} onValueChange={(value) => handleChange('tipo_pesagem', value)} required>
                  <SelectTrigger className="border-slate-300 focus:border-blue-500 focus:ring-blue-500">
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Entrada">Entrada</SelectItem>
                    <SelectItem value="Saída">Saída</SelectItem>
                    <SelectItem value="Ambos">Ambos</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="placa_caminhao" className="text-slate-700 font-medium">
                  Placa do Caminhão *
                </Label>
                <Input
                  id="placa_caminhao"
                  value={formData.placa_caminhao}
                  onChange={(e) => handleChange('placa_caminhao', e.target.value.toUpperCase())}
                  placeholder="ABC-1234"
                  required
                  className="border-slate-300 focus:border-blue-500 focus:ring-blue-500 uppercase"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="nome_motorista" className="text-slate-700 font-medium">
                  Nome do Motorista *
                </Label>
                <Input
                  id="nome_motorista"
                  value={formData.nome_motorista}
                  onChange={(e) => handleChange('nome_motorista', e.target.value)}
                  placeholder="Nome completo"
                  required
                  className="border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="produto" className="text-slate-700 font-medium">
                  Produto/Insumo *
                </Label>
                <Input
                  id="produto"
                  value={formData.produto}
                  onChange={(e) => handleChange('produto', e.target.value)}
                  placeholder="Ex: Soja, Milho, Adubo"
                  required
                  className="border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fornecedor_destino" className="text-slate-700 font-medium">
                Fornecedor/Destino
              </Label>
              <Input
                id="fornecedor_destino"
                value={formData.fornecedor_destino}
                onChange={(e) => handleChange('fornecedor_destino', e.target.value)}
                placeholder="Nome do fornecedor ou destino"
                className="border-slate-300 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="peso_tara" className="text-slate-700 font-medium flex items-center gap-2">
                  Peso Tara (kg) *
                </Label>
                <Input
                  id="peso_tara"
                  type="number"
                  step="0.01"
                  value={formData.peso_tara}
                  onChange={(e) => handleChange('peso_tara', e.target.value)}
                  placeholder="0.00"
                  required
                  className="border-slate-300 focus:border-blue-500 focus:ring-blue-500 text-lg font-semibold"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="peso_bruto" className="text-slate-700 font-medium flex items-center gap-2">
                  Peso Bruto (kg) *
                </Label>
                <Input
                  id="peso_bruto"
                  type="number"
                  step="0.01"
                  value={formData.peso_bruto}
                  onChange={(e) => handleChange('peso_bruto', e.target.value)}
                  placeholder="0.00"
                  required
                  className="border-slate-300 focus:border-blue-500 focus:ring-blue-500 text-lg font-semibold"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  Peso Líquido (kg)
                </Label>
                <div className="h-10 px-3 rounded-lg border-2 border-green-500 bg-green-50 flex items-center">
                  <span className="text-2xl font-bold text-green-700">
                    {formData.peso_liquido.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="observacoes" className="text-slate-700 font-medium">
                Observações
              </Label>
              <Textarea
                id="observacoes"
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="Informações adicionais sobre a pesagem..."
                className="border-slate-300 focus:border-blue-500 focus:ring-blue-500 min-h-20"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
                  <X className="w-4 h-4" />
                  Cancelar
                </Button>
              )}
              <Button type="submit" className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 gap-2 shadow-lg">
                <Save className="w-4 h-4" />
                {isEditing ? 'Atualizar' : 'Salvar'} Pesagem
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}