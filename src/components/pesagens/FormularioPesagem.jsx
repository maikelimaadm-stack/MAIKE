import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, X } from "lucide-react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";

export default function FormularioPesagem({ onSubmit, onCancel, initialData = null, isEditing = false }) {
  const getDataAtual = () => {
    return new Date().toISOString().split('T')[0];
  };

  const getDataInicial = () => {
    if (!initialData?.data_pesagem) return getDataAtual();
    try {
      const date = new Date(initialData.data_pesagem);
      if (isNaN(date.getTime())) return getDataAtual();
      return date.toISOString().split('T')[0];
    } catch {
      return getDataAtual();
    }
  };

  const [formData, setFormData] = useState({
    data_pesagem: getDataInicial(),
    tipo_pesagem: initialData?.tipo_pesagem || "",
    placa_caminhao: initialData?.placa_caminhao?.toUpperCase() || "",
    nome_motorista: initialData?.nome_motorista?.toUpperCase() || "",
    produto: initialData?.produto?.toUpperCase() || "",
    fornecedor_destino: initialData?.fornecedor_destino?.toUpperCase() || "",
    peso_tara: initialData?.peso_tara || "",
    peso_bruto: initialData?.peso_bruto || "",
    peso_liquido: initialData?.peso_liquido || 0,
    observacoes: initialData?.observacoes?.toUpperCase() || ""
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores_pesagem', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list('nome');
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos_pesagem', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list('nome_produto');
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
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
    let processedValue = value;
    if (['placa_caminhao', 'nome_motorista', 'produto', 'fornecedor_destino', 'observacoes'].includes(field) && typeof value === 'string') {
      processedValue = value.toUpperCase();
    }
    setFormData(prev => ({ ...prev, [field]: processedValue }));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {isEditing ? 'Editar Pesagem' : 'Nova Pesagem'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Data da Pesagem *</Label>
                <Input
                  type="date"
                  value={formData.data_pesagem}
                  onChange={(e) => handleChange('data_pesagem', e.target.value)}
                  required
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Tipo de Pesagem *</Label>
                <Select value={formData.tipo_pesagem} onValueChange={(value) => handleChange('tipo_pesagem', value)} required>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Entrada" className="text-xs">Entrada</SelectItem>
                    <SelectItem value="Saída" className="text-xs">Saída</SelectItem>
                    <SelectItem value="Ambos" className="text-xs">Ambos</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Placa do Caminhão</Label>
                <Input
                  value={formData.placa_caminhao}
                  onChange={(e) => handleChange('placa_caminhao', e.target.value)}
                  placeholder="ABC-1234"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome do Motorista</Label>
                <Input
                  value={formData.nome_motorista}
                  onChange={(e) => handleChange('nome_motorista', e.target.value)}
                  placeholder="NOME COMPLETO"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Produto/Insumo</Label>
                <Select value={formData.produto} onValueChange={(value) => handleChange('produto', value)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {produtos.map(p => (
                      <SelectItem key={p.id} value={p.nome_produto} className="text-xs">{p.nome_produto}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Fornecedor/Destino</Label>
                <Select value={formData.fornecedor_destino} onValueChange={(value) => handleChange('fornecedor_destino', value)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {fornecedores.map(f => (
                      <SelectItem key={f.id} value={f.nome} className="text-xs">{f.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Peso Tara (kg) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.peso_tara}
                  onChange={(e) => handleChange('peso_tara', e.target.value)}
                  placeholder="0.00"
                  required
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Peso Bruto (kg) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.peso_bruto}
                  onChange={(e) => handleChange('peso_bruto', e.target.value)}
                  placeholder="0.00"
                  required
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Peso Líquido (kg)</Label>
                <Input
                  value={formData.peso_liquido.toFixed(2)}
                  readOnly
                  className="h-8 text-xs font-semibold bg-slate-50"
                />
              </div>
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
              <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
                {isEditing ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}