import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRightLeft, Save, X } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function FormularioMovimentacao({ onSubmit, onCancel, initialData, isEditing, produtos, fornecedores }) {
  const [formData, setFormData] = useState(initialData || {
    tipo_movimentacao: "Entrada",
    data_movimentacao: new Date().toISOString().split('T')[0],
    produto_id: "",
    quantidade: "",
    local_estoque_origem: "",
    local_estoque_destino: "",
    numero_nfe: "",
    chave_nfe: "",
    fornecedor_id: "",
    cliente_destino: "",
    valor_unitario: "",
    valor_total: "",
    observacoes: ""
  });

  const { data: locais = [] } = useQuery({
    queryKey: ['locais'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: [],
  });

  useEffect(() => {
    if (formData.quantidade && formData.valor_unitario) {
      const total = parseFloat(formData.quantidade) * parseFloat(formData.valor_unitario);
      setFormData(prev => ({ ...prev, valor_total: total.toFixed(2) }));
    }
  }, [formData.quantidade, formData.valor_unitario]);

  const handleChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.produto_id) {
      toast.error('Selecione um produto!');
      return;
    }

    if (!formData.quantidade || parseFloat(formData.quantidade) <= 0) {
      toast.error('Informe uma quantidade válida!');
      return;
    }

    if (formData.tipo_movimentacao === 'Entrada') {
      if (!formData.local_estoque_destino) {
        toast.error('Informe o local de destino para entrada!');
        return;
      }
      if (!formData.numero_nfe || !formData.chave_nfe) {
        toast.error('Número e Chave da NF-e são obrigatórios para entradas!');
        return;
      }
    } else if (formData.tipo_movimentacao === 'Saída') {
      if (!formData.local_estoque_origem) {
        toast.error('Informe o local de origem para saída!');
        return;
      }
      if (!formData.cliente_destino) {
        toast.error('Informe o cliente ou destino para saída!');
        return;
      }
    } else if (formData.tipo_movimentacao === 'Transferência') {
      if (!formData.local_estoque_origem || !formData.local_estoque_destino) {
        toast.error('Informe origem e destino para transferência!');
        return;
      }
      if (formData.local_estoque_origem === formData.local_estoque_destino) {
        toast.error('Origem e destino devem ser diferentes!');
        return;
      }
    }

    onSubmit(formData);
  };

  const produtoSelecionado = produtos.find(p => p.id === formData.produto_id);

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
              <ArrowRightLeft className="w-5 h-5 text-white" />
            </div>
            {isEditing ? 'Editar Movimentação' : 'Nova Movimentação de Estoque'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Tipo de Movimentação *</Label>
                <Select value={formData.tipo_movimentacao} onValueChange={(value) => handleChange('tipo_movimentacao', value)}>
                  <SelectTrigger className="border-slate-300 focus:border-green-500">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Entrada">Entrada (Recebimento)</SelectItem>
                    <SelectItem value="Saída">Saída (Venda/Consumo)</SelectItem>
                    <SelectItem value="Transferência">Transferência (Entre Locais)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Data *</Label>
                <Input
                  type="date"
                  value={formData.data_movimentacao}
                  onChange={(e) => handleChange('data_movimentacao', e.target.value)}
                  required
                  className="border-slate-300 focus:border-green-500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Produto *</Label>
                <Select value={formData.produto_id} onValueChange={(value) => handleChange('produto_id', value)}>
                  <SelectTrigger className="border-slate-300 focus:border-green-500">
                    <SelectValue placeholder="Selecione o produto" />
                  </SelectTrigger>
                  <SelectContent>
                    {produtos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nome_produto} ({p.unidade_medida})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Quantidade *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.quantidade}
                  onChange={(e) => handleChange('quantidade', e.target.value)}
                  placeholder="0.00"
                  required
                  className="border-slate-300 focus:border-green-500 text-lg font-semibold"
                />
                {produtoSelecionado && (
                  <p className="text-xs text-slate-500">
                    Unidade: {produtoSelecionado.unidade_medida} | Estoque atual: {produtoSelecionado.estoque_atual || 0}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">
                  {formData.tipo_movimentacao === 'Saída' ? 'Local de Origem *' : 
                   formData.tipo_movimentacao === 'Transferência' ? 'Local de Origem *' :
                   'Local de Destino *'}
                </Label>
                {formData.tipo_movimentacao === 'Saída' || formData.tipo_movimentacao === 'Transferência' ? (
                  <Select value={formData.local_estoque_origem} onValueChange={(value) => handleChange('local_estoque_origem', value)}>
                    <SelectTrigger className="border-slate-300 focus:border-green-500">
                      <SelectValue placeholder="Selecione o local de origem" />
                    </SelectTrigger>
                    <SelectContent>
                      {locais.map((l) => (
                        <SelectItem key={l.id} value={l.nome}>
                          {l.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={formData.local_estoque_destino} onValueChange={(value) => handleChange('local_estoque_destino', value)}>
                    <SelectTrigger className="border-slate-300 focus:border-green-500">
                      <SelectValue placeholder="Selecione o local de destino" />
                    </SelectTrigger>
                    <SelectContent>
                      {locais.map((l) => (
                        <SelectItem key={l.id} value={l.nome}>
                          {l.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            {formData.tipo_movimentacao === 'Transferência' && (
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Local de Destino *</Label>
                <Select value={formData.local_estoque_destino} onValueChange={(value) => handleChange('local_estoque_destino', value)}>
                  <SelectTrigger className="border-slate-300 focus:border-green-500">
                    <SelectValue placeholder="Selecione o local de destino" />
                  </SelectTrigger>
                  <SelectContent>
                    {locais.map((l) => (
                      <SelectItem key={l.id} value={l.nome}>
                        {l.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {formData.tipo_movimentacao === 'Entrada' && (
              <>
                <div className="border-t pt-6">
                  <h3 className="font-semibold text-slate-700 mb-4">Dados da Nota Fiscal *</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <Label>Fornecedor</Label>
                      <Select value={formData.fornecedor_id} onValueChange={(value) => handleChange('fornecedor_id', value)}>
                        <SelectTrigger className="border-slate-300 focus:border-green-500">
                          <SelectValue placeholder="Selecione o fornecedor" />
                        </SelectTrigger>
                        <SelectContent>
                          {fornecedores.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Número da NF-e *</Label>
                      <Input
                        value={formData.numero_nfe}
                        onChange={(e) => handleChange('numero_nfe', e.target.value)}
                        placeholder="000000"
                        className="border-slate-300 focus:border-green-500 uppercase"
                        style={{ textTransform: 'uppercase' }}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Chave NF-e *</Label>
                      <Input
                        value={formData.chave_nfe}
                        onChange={(e) => handleChange('chave_nfe', e.target.value)}
                        placeholder="44 dígitos"
                        maxLength={44}
                        className="border-slate-300 focus:border-green-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Valor Unitário</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.valor_unitario}
                      onChange={(e) => handleChange('valor_unitario', e.target.value)}
                      placeholder="0.00"
                      className="border-slate-300 focus:border-green-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Valor Total</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.valor_total}
                      placeholder="0.00"
                      className="border-slate-300 focus:border-green-500 bg-slate-50"
                      readOnly
                    />
                  </div>
                </div>
              </>
            )}

            {formData.tipo_movimentacao === 'Saída' && (
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Cliente/Destino *</Label>
                <Input
                  value={formData.cliente_destino}
                  onChange={(e) => handleChange('cliente_destino', e.target.value)}
                  placeholder="NOME DO CLIENTE OU DESTINO"
                  className="border-slate-300 focus:border-green-500 uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-slate-700 font-medium">Observações</Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="OBSERVAÇÕES SOBRE A MOVIMENTAÇÃO..."
                className="border-slate-300 focus:border-green-500 min-h-20 uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
                <X className="w-4 h-4" />
                Cancelar
              </Button>
              <Button type="submit" className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg">
                <Save className="w-4 h-4" />
                {isEditing ? 'Atualizar' : 'Salvar'} Movimentação
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}