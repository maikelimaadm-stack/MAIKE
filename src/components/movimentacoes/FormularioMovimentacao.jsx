import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRightLeft, Save, X, Upload, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Alert, AlertDescription } from "@/components/ui/alert";

const TIPOS_DETALHADOS = {
  'Entrada': [
    { value: 'Compra', label: 'Compra' },
    { value: 'Devolução', label: 'Devolução de Cliente' },
    { value: 'Transferência Recebida', label: 'Transferência Recebida' },
    { value: 'Ajuste Positivo', label: 'Ajuste Positivo' },
    { value: 'Retorno de Produção', label: 'Retorno de Produção' },
  ],
  'Saída': [
    { value: 'Venda', label: 'Venda' },
    { value: 'Transferência Enviada', label: 'Transferência Enviada' },
    { value: 'Consumo Interno', label: 'Consumo Interno' },
    { value: 'Perda/Quebra', label: 'Perda/Quebra' },
    { value: 'Ajuste Negativo', label: 'Ajuste Negativo' },
    { value: 'Envio para Produção', label: 'Envio para Produção' },
  ],
  'Transferência': [
    { value: 'Transferência Entre Locais', label: 'Transferência Entre Locais' },
  ],
  'Ajuste': [
    { value: 'Correção', label: 'Correção' },
    { value: 'Inventário', label: 'Inventário' },
    { value: 'Regularização Manual', label: 'Regularização Manual' },
  ]
};

const TIPOS_DOCUMENTO = [
  'Nota Fiscal',
  'Recibo',
  'Pedido de Compra',
  'Ordem de Serviço',
  'Devolução',
  'Nota Fiscal de Venda',
  'Recibo de Entrega',
  'Ordem de Consumo',
  'Documento de Perda',
  'Documento de Transferência',
  'Sem Documento'
];

export default function FormularioMovimentacao({ onSubmit, onCancel, initialData, isEditing, produtos, fornecedores }) {
  const [formData, setFormData] = useState(initialData || {
    tipo_movimentacao: "Entrada",
    tipo_detalhado: "Compra",
    data_movimentacao: new Date().toISOString().slice(0, 16),
    produto_id: "",
    quantidade: "",
    local_estoque_origem: "",
    local_estoque_destino: "",
    valor_unitario: "",
    valor_total: "",
    tipo_documento: "Nota Fiscal",
    numero_documento: "",
    chave_documento: "",
    data_documento: new Date().toISOString().split('T')[0],
    fornecedor_id: "",
    cliente_nome: "",
    forma_aquisicao: "",
    motivo_movimentacao: "",
    centro_custo: "",
    observacoes: "",
    anexos: []
  });

  const [uploadingFile, setUploadingFile] = useState(false);

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

  useEffect(() => {
    if (formData.tipo_movimentacao) {
      const primeiroTipo = TIPOS_DETALHADOS[formData.tipo_movimentacao]?.[0]?.value;
      if (primeiroTipo && !formData.tipo_detalhado) {
        setFormData(prev => ({ ...prev, tipo_detalhado: primeiroTipo }));
      }
    }
  }, [formData.tipo_movimentacao]);

  const handleChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingFile(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      const novoAnexo = {
        nome: file.name,
        url: file_url,
        tipo: file.type
      };

      setFormData(prev => ({
        ...prev,
        anexos: [...(prev.anexos || []), novoAnexo]
      }));

      toast.success('Arquivo anexado com sucesso!');
    } catch (error) {
      toast.error('Erro ao fazer upload do arquivo');
    } finally {
      setUploadingFile(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.produto_id) {
      toast.error('Selecione um produto!');
      return;
    }

    if (!formData.quantidade || parseFloat(formData.quantidade) <= 0) {
      toast.error('Informe uma quantidade válida maior que zero!');
      return;
    }

    if (!formData.tipo_detalhado) {
      toast.error('Selecione o tipo detalhado da movimentação!');
      return;
    }

    if (!formData.motivo_movimentacao?.trim()) {
      toast.error('Informe o motivo/justificativa da movimentação!');
      return;
    }

    if (formData.tipo_movimentacao === 'Entrada') {
      if (!formData.local_estoque_destino) {
        toast.error('Informe o local de destino para entrada!');
        return;
      }
      if (formData.tipo_detalhado === 'Compra' && !formData.numero_documento) {
        toast.error('Número do documento é obrigatório para compras!');
        return;
      }
    } else if (formData.tipo_movimentacao === 'Saída') {
      if (!formData.local_estoque_origem) {
        toast.error('Informe o local de origem para saída!');
        return;
      }
      
      const produto = produtos.find(p => p.id === formData.produto_id);
      const estoqueDisponivel = produto?.estoque_atual || 0;
      const qtdSaida = parseFloat(formData.quantidade);
      
      if (qtdSaida > estoqueDisponivel) {
        toast.error(`Saldo insuficiente! Disponível: ${estoqueDisponivel} ${produto?.unidade_medida || ''}`);
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
    } else if (formData.tipo_movimentacao === 'Ajuste') {
      if (!formData.motivo_movimentacao?.trim()) {
        toast.error('Justificativa é obrigatória para ajustes!');
        return;
      }
    }

    onSubmit(formData);
  };

  const produtoSelecionado = produtos.find(p => p.id === formData.produto_id);
  const tiposDetalhadosDisponiveis = TIPOS_DETALHADOS[formData.tipo_movimentacao] || [];

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
            {/* Tipo e Data */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Tipo Principal *</Label>
                <Select value={formData.tipo_movimentacao} onValueChange={(value) => handleChange('tipo_movimentacao', value)}>
                  <SelectTrigger className="border-slate-300 focus:border-green-500">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Entrada">Entrada</SelectItem>
                    <SelectItem value="Saída">Saída</SelectItem>
                    <SelectItem value="Transferência">Transferência</SelectItem>
                    <SelectItem value="Ajuste">Ajuste</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Tipo Detalhado *</Label>
                <Select value={formData.tipo_detalhado} onValueChange={(value) => handleChange('tipo_detalhado', value)}>
                  <SelectTrigger className="border-slate-300 focus:border-green-500">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {tiposDetalhadosDisponiveis.map((tipo) => (
                      <SelectItem key={tipo.value} value={tipo.value}>
                        {tipo.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Data e Hora *</Label>
                <Input
                  type="datetime-local"
                  value={formData.data_movimentacao}
                  onChange={(e) => handleChange('data_movimentacao', e.target.value)}
                  required
                  className="border-slate-300 focus:border-green-500"
                />
              </div>
            </div>

            {/* Produto e Quantidade */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Produto *</Label>
                <Select value={formData.produto_id} onValueChange={(value) => handleChange('produto_id', value)}>
                  <SelectTrigger className="border-slate-300 focus:border-green-500">
                    <SelectValue placeholder="Selecione o produto" />
                  </SelectTrigger>
                  <SelectContent>
                    {produtos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.codigo_interno ? `[${p.codigo_interno}] ` : ''}{p.nome_produto} ({p.unidade_medida})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {produtoSelecionado && (
                  <Alert className="mt-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Estoque atual: <strong>{produtoSelecionado.estoque_atual || 0} {produtoSelecionado.unidade_medida}</strong>
                      {produtoSelecionado.preco_custo > 0 && ` | Custo: R$ ${produtoSelecionado.preco_custo.toFixed(2)}`}
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Quantidade *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={formData.quantidade}
                  onChange={(e) => handleChange('quantidade', e.target.value)}
                  placeholder="0.00"
                  required
                  className="border-slate-300 focus:border-green-500 text-lg font-semibold"
                />
              </div>
            </div>

            {/* Locais */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {(formData.tipo_movimentacao === 'Saída' || formData.tipo_movimentacao === 'Transferência') && (
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Local de Origem *</Label>
                  <Select value={formData.local_estoque_origem} onValueChange={(value) => handleChange('local_estoque_origem', value)}>
                    <SelectTrigger className="border-slate-300 focus:border-green-500">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {locais.map((l) => (
                        <SelectItem key={l.id} value={l.nome}>{l.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(formData.tipo_movimentacao === 'Entrada' || formData.tipo_movimentacao === 'Transferência') && (
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Local de Destino *</Label>
                  <Select value={formData.local_estoque_destino} onValueChange={(value) => handleChange('local_estoque_destino', value)}>
                    <SelectTrigger className="border-slate-300 focus:border-green-500">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {locais.map((l) => (
                        <SelectItem key={l.id} value={l.nome}>{l.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Valores */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Valor Unitário *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.valor_unitario}
                  onChange={(e) => handleChange('valor_unitario', e.target.value)}
                  placeholder="0.00"
                  required
                  className="border-slate-300 focus:border-green-500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Valor Total</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.valor_total}
                  placeholder="0.00"
                  className="border-slate-300 bg-slate-50 font-bold"
                  readOnly
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Centro de Custo</Label>
                <Input
                  value={formData.centro_custo}
                  onChange={(e) => handleChange('centro_custo', e.target.value)}
                  placeholder="SETOR OU CENTRO DE CUSTO"
                  className="border-slate-300 focus:border-green-500 uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
            </div>

            {/* Documento */}
            <div className="border-t pt-6">
              <h3 className="font-semibold text-slate-700 mb-4">Documento Fiscal/Comercial</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="space-y-2">
                  <Label>Tipo de Documento</Label>
                  <Select value={formData.tipo_documento} onValueChange={(value) => handleChange('tipo_documento', value)}>
                    <SelectTrigger className="border-slate-300 focus:border-green-500">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_DOCUMENTO.map((tipo) => (
                        <SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Número do Documento</Label>
                  <Input
                    value={formData.numero_documento}
                    onChange={(e) => handleChange('numero_documento', e.target.value)}
                    placeholder="000000"
                    className="border-slate-300 focus:border-green-500 uppercase"
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Chave do Documento</Label>
                  <Input
                    value={formData.chave_documento}
                    onChange={(e) => handleChange('chave_documento', e.target.value)}
                    placeholder="44 dígitos (NF-e)"
                    maxLength={44}
                    className="border-slate-300 focus:border-green-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Data do Documento</Label>
                  <Input
                    type="date"
                    value={formData.data_documento}
                    onChange={(e) => handleChange('data_documento', e.target.value)}
                    className="border-slate-300 focus:border-green-500"
                  />
                </div>
              </div>
            </div>

            {/* Fornecedor/Cliente */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {formData.tipo_movimentacao === 'Entrada' && (
                <div className="space-y-2">
                  <Label>Fornecedor</Label>
                  <Select value={formData.fornecedor_id} onValueChange={(value) => handleChange('fornecedor_id', value)}>
                    <SelectTrigger className="border-slate-300 focus:border-green-500">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {fornecedores.map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formData.tipo_movimentacao === 'Saída' && (
                <div className="space-y-2">
                  <Label>Cliente/Destinatário</Label>
                  <Input
                    value={formData.cliente_nome}
                    onChange={(e) => handleChange('cliente_nome', e.target.value)}
                    placeholder="NOME DO CLIENTE OU DESTINATÁRIO"
                    className="border-slate-300 focus:border-green-500 uppercase"
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>
              )}

              {formData.tipo_movimentacao === 'Entrada' && (
                <div className="space-y-2">
                  <Label>Forma de Aquisição</Label>
                  <Select value={formData.forma_aquisicao} onValueChange={(value) => handleChange('forma_aquisicao', value)}>
                    <SelectTrigger className="border-slate-300 focus:border-green-500">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Compra">Compra</SelectItem>
                      <SelectItem value="Transferência">Transferência</SelectItem>
                      <SelectItem value="Devolução">Devolução</SelectItem>
                      <SelectItem value="Bonificação">Bonificação</SelectItem>
                      <SelectItem value="Doação">Doação</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Motivo/Justificativa */}
            <div className="space-y-2">
              <Label className="text-slate-700 font-medium">Motivo/Justificativa *</Label>
              <Textarea
                value={formData.motivo_movimentacao}
                onChange={(e) => handleChange('motivo_movimentacao', e.target.value)}
                placeholder="DESCREVA O MOTIVO OU JUSTIFICATIVA DESTA MOVIMENTAÇÃO..."
                required
                className="border-slate-300 focus:border-green-500 min-h-20 uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            {/* Observações */}
            <div className="space-y-2">
              <Label className="text-slate-700 font-medium">Observações Complementares</Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="OBSERVAÇÕES ADICIONAIS..."
                className="border-slate-300 focus:border-green-500 min-h-20 uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            {/* Anexos */}
            <div className="space-y-2">
              <Label className="text-slate-700 font-medium">Anexar Documentos (PDF, XML, Imagens)</Label>
              <div className="flex gap-2">
                <Input
                  type="file"
                  onChange={handleFileUpload}
                  accept=".pdf,.xml,.jpg,.jpeg,.png"
                  disabled={uploadingFile}
                  className="border-slate-300 focus:border-green-500"
                />
                <Button type="button" disabled={uploadingFile} variant="outline">
                  <Upload className="w-4 h-4 mr-2" />
                  {uploadingFile ? 'Enviando...' : 'Anexar'}
                </Button>
              </div>
              {formData.anexos && formData.anexos.length > 0 && (
                <div className="mt-2 space-y-1">
                  {formData.anexos.map((anexo, idx) => (
                    <div key={idx} className="text-xs flex items-center gap-2 bg-slate-50 p-2 rounded">
                      <span>📎 {anexo.nome}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const novosAnexos = formData.anexos.filter((_, i) => i !== idx);
                          setFormData(prev => ({ ...prev, anexos: novosAnexos }));
                        }}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Botões */}
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