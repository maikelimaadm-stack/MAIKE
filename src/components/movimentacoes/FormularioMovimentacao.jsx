import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRightLeft, Save, X, Upload, AlertCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  'Nota Fiscal de Venda',
  'Recibo',
  'Pedido de Compra',
  'Ordem de Serviço',
  'Ordem de Consumo',
  'Documento de Transferência',
  'Documento de Perda',
  'Devolução',
  'Sem Documento'
];

const formatarNumero = (num) => {
  if (!num && num !== 0) return '';
  return String(num).replace('.', ',');
};

const parseNumero = (str) => {
  if (!str) return 0;
  return parseFloat(String(str).replace(',', '.')) || 0;
};

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
    serie_documento: "",
    data_documento: new Date().toISOString().split('T')[0],
    fornecedor_id: "",
    cliente_nome: "",
    motivo_movimentacao: "",
    centro_custo_id: "",
    observacoes: "",
    anexos: []
  });

  const [uploadingFile, setUploadingFile] = useState(false);
  const [showNovoLocal, setShowNovoLocal] = useState(false);
  const [showNovoCentro, setShowNovoCentro] = useState(false);
  const [novoLocal, setNovoLocal] = useState({ nome: "", descricao: "" });
  const [novoCentro, setNovoCentro] = useState({ nome: "", tipo: "Setor", codigo: "", descricao: "" });

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: locais = [] } = useQuery({
    queryKey: ['locais'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: [],
  });

  const { data: centros = [] } = useQuery({
    queryKey: ['centros', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    initialData: [],
    enabled: !!empresaSelecionadaId,
  });

  const createLocalMutation = useMutation({
    mutationFn: async (data) => {
      const allLocais = await base44.entities.LocalEstoque.list();
      const maxNum = allLocais.reduce((max, l) => Math.max(max, parseInt(l.numero_local) || 0), 0);
      return base44.entities.LocalEstoque.create({ ...data, numero_local: String(maxNum + 1) });
    },
    onSuccess: (newLocal) => {
      queryClient.invalidateQueries({ queryKey: ['locais'] });
      setFormData(prev => ({ ...prev, local_estoque_destino: newLocal.nome }));
      setShowNovoLocal(false);
      setNovoLocal({ nome: "", descricao: "" });
      toast.success('Local cadastrado!');
    },
  });

  const createCentroMutation = useMutation({
    mutationFn: async (data) => {
      const allCentros = await base44.entities.CentroCusto.list();
      const maxNum = allCentros.reduce((max, c) => Math.max(max, parseInt(c.numero_centro) || 0), 0);
      return base44.entities.CentroCusto.create({ 
        ...data, 
        empresa_id: empresaSelecionadaId,
        numero_centro: String(maxNum + 1) 
      });
    },
    onSuccess: (newCentro) => {
      queryClient.invalidateQueries({ queryKey: ['centros'] });
      setFormData(prev => ({ ...prev, centro_custo_id: newCentro.id }));
      setShowNovoCentro(false);
      setNovoCentro({ nome: "", tipo: "Setor", codigo: "", descricao: "" });
      toast.success('Centro de custo cadastrado!');
    },
  });

  useEffect(() => {
    const qtd = parseNumero(formData.quantidade);
    const vlrUnit = parseNumero(formData.valor_unitario);
    if (qtd > 0 && vlrUnit > 0) {
      setFormData(prev => ({ ...prev, valor_total: formatarNumero((qtd * vlrUnit).toFixed(2)) }));
    }
  }, [formData.quantidade, formData.valor_unitario]);

  useEffect(() => {
    if (formData.tipo_movimentacao) {
      const primeiroTipo = TIPOS_DETALHADOS[formData.tipo_movimentacao]?.[0]?.value;
      if (primeiroTipo && (!formData.tipo_detalhado || !TIPOS_DETALHADOS[formData.tipo_movimentacao].find(t => t.value === formData.tipo_detalhado))) {
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
      
      setFormData(prev => ({
        ...prev,
        anexos: [...(prev.anexos || []), { nome: file.name, url: file_url, tipo: file.type }]
      }));

      toast.success('Arquivo anexado!');
    } catch (error) {
      toast.error('Erro ao fazer upload');
    } finally {
      setUploadingFile(false);
      e.target.value = '';
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.produto_id) {
      toast.error('Selecione um produto!');
      return;
    }

    const qtd = parseNumero(formData.quantidade);
    if (!qtd || qtd <= 0) {
      toast.error('Quantidade deve ser maior que zero!');
      return;
    }

    if (!formData.motivo_movimentacao?.trim()) {
      toast.error('Informe o motivo/justificativa!');
      return;
    }

    const produto = produtos.find(p => p.id === formData.produto_id);
    const estoqueDisponivel = produto?.estoque_atual || 0;

    if (formData.tipo_movimentacao === 'Entrada') {
      if (!formData.local_estoque_destino) {
        toast.error('Informe o local de destino!');
        return;
      }
      if (formData.tipo_detalhado === 'Compra' && !formData.numero_documento) {
        toast.error('Número do documento é obrigatório para compras!');
        return;
      }
    } else if (formData.tipo_movimentacao === 'Saída') {
      if (!formData.local_estoque_origem) {
        toast.error('Informe o local de origem!');
        return;
      }
      
      if (estoqueDisponivel === 0) {
        toast.error(`❌ SALDO ZERADO! O produto ${produto.nome_produto} não possui estoque disponível.`);
        return;
      }
      
      if (qtd > estoqueDisponivel) {
        toast.error(`❌ SALDO INSUFICIENTE! Disponível: ${formatarNumero(estoqueDisponivel)} ${produto.unidade_medida}`);
        return;
      }
    } else if (formData.tipo_movimentacao === 'Transferência') {
      if (!formData.local_estoque_origem || !formData.local_estoque_destino) {
        toast.error('Informe origem e destino!');
        return;
      }
      if (formData.local_estoque_origem === formData.local_estoque_destino) {
        toast.error('Origem e destino devem ser diferentes!');
        return;
      }
      
      if (estoqueDisponivel === 0) {
        toast.error(`❌ SALDO ZERADO! O produto ${produto.nome_produto} não possui estoque disponível.`);
        return;
      }
      
      if (qtd > estoqueDisponivel) {
        toast.error(`❌ SALDO INSUFICIENTE! Disponível: ${formatarNumero(estoqueDisponivel)} ${produto.unidade_medida}`);
        return;
      }
    }

    onSubmit({
      ...formData,
      quantidade: qtd,
      valor_unitario: parseNumero(formData.valor_unitario),
      valor_total: parseNumero(formData.valor_total)
    });
  };

  const produtoSelecionado = produtos.find(p => p.id === formData.produto_id);
  const tiposDetalhadosDisponiveis = TIPOS_DETALHADOS[formData.tipo_movimentacao] || [];
  
  const isTransferencia = formData.tipo_movimentacao === 'Transferência';
  const mostrarValores = formData.tipo_movimentacao === 'Entrada' && (formData.tipo_detalhado === 'Compra' || formData.tipo_detalhado === 'Ajuste Positivo');
  const mostrarDocumentoCompleto = formData.tipo_documento === 'Nota Fiscal' || formData.tipo_documento === 'Nota Fiscal de Venda';

  return (
    <>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
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
                        <SelectItem key={tipo.value} value={tipo.value}>{tipo.label}</SelectItem>
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
                    <Alert className={`mt-2 ${produtoSelecionado.estoque_atual === 0 ? 'border-red-300 bg-red-50' : ''}`}>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        Estoque: <strong>{formatarNumero(produtoSelecionado.estoque_atual || 0)} {produtoSelecionado.unidade_medida}</strong>
                        {produtoSelecionado.estoque_atual === 0 && ' ⚠️ ZERADO'}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Quantidade *</Label>
                  <Input
                    value={formData.quantidade}
                    onChange={(e) => handleChange('quantidade', e.target.value)}
                    placeholder="0,00"
                    required
                    className="border-slate-300 focus:border-green-500 text-lg font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {(formData.tipo_movimentacao === 'Saída' || isTransferencia) && (
                  <div className="space-y-2">
                    <Label className="text-slate-700 font-medium">Local de Origem *</Label>
                    <div className="flex gap-2">
                      <Select value={formData.local_estoque_origem} onValueChange={(value) => handleChange('local_estoque_origem', value)} className="flex-1">
                        <SelectTrigger className="border-slate-300 focus:border-green-500">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {locais.map((l) => (
                            <SelectItem key={l.id} value={l.nome}>{l.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="outline" size="icon" onClick={() => setShowNovoLocal(true)}>
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {(formData.tipo_movimentacao === 'Entrada' || isTransferencia) && (
                  <div className="space-y-2">
                    <Label className="text-slate-700 font-medium">Local de Destino *</Label>
                    <div className="flex gap-2">
                      <Select value={formData.local_estoque_destino} onValueChange={(value) => handleChange('local_estoque_destino', value)} className="flex-1">
                        <SelectTrigger className="border-slate-300 focus:border-green-500">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {locais.map((l) => (
                            <SelectItem key={l.id} value={l.nome}>{l.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="outline" size="icon" onClick={() => setShowNovoLocal(true)}>
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {mostrarValores && !isTransferencia && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-slate-700 font-medium">Valor Unitário</Label>
                    <Input
                      value={formData.valor_unitario}
                      onChange={(e) => handleChange('valor_unitario', e.target.value)}
                      placeholder="0,00"
                      className="border-slate-300 focus:border-green-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-700 font-medium">Valor Total</Label>
                    <Input
                      value={formData.valor_total}
                      placeholder="0,00"
                      className="border-slate-300 bg-slate-50 font-bold"
                      readOnly
                    />
                  </div>
                </div>
              )}

              {!isTransferencia && (
                <div className="border-t pt-6">
                  <h3 className="font-semibold text-slate-700 mb-4">Documento Fiscal/Comercial</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

                    {mostrarDocumentoCompleto && (
                      <>
                        <div className="space-y-2">
                          <Label>Série</Label>
                          <Input
                            value={formData.serie_documento}
                            onChange={(e) => handleChange('serie_documento', e.target.value)}
                            placeholder="1"
                            className="border-slate-300 focus:border-green-500"
                          />
                        </div>

                        <div className="space-y-2 md:col-span-2">
                          <Label>Chave de Acesso (44 dígitos)</Label>
                          <Input
                            value={formData.chave_documento}
                            onChange={(e) => handleChange('chave_documento', e.target.value)}
                            placeholder="44 dígitos"
                            maxLength={44}
                            className="border-slate-300 focus:border-green-500"
                          />
                        </div>
                      </>
                    )}

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
              )}

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
                      placeholder="NOME DO CLIENTE"
                      className="border-slate-300 focus:border-green-500 uppercase"
                      style={{ textTransform: 'uppercase' }}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Centro de Custo / Setor</Label>
                  <div className="flex gap-2">
                    <Select value={formData.centro_custo_id} onValueChange={(value) => handleChange('centro_custo_id', value)} className="flex-1">
                      <SelectTrigger className="border-slate-300 focus:border-green-500">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {centros.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.codigo ? `[${c.codigo}] ` : ''}{c.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowNovoCentro(true)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Motivo/Justificativa *</Label>
                <Textarea
                  value={formData.motivo_movimentacao}
                  onChange={(e) => handleChange('motivo_movimentacao', e.target.value)}
                  placeholder="DESCREVA O MOTIVO..."
                  required
                  className="border-slate-300 focus:border-green-500 min-h-20 uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea
                  value={formData.observacoes}
                  onChange={(e) => handleChange('observacoes', e.target.value)}
                  placeholder="OBSERVAÇÕES ADICIONAIS..."
                  className="border-slate-300 focus:border-green-500 min-h-16 uppercase"
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
                  {isEditing ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={showNovoLocal} onOpenChange={setShowNovoLocal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Local de Estoque</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                value={novoLocal.nome}
                onChange={(e) => setNovoLocal({ ...novoLocal, nome: e.target.value })}
                placeholder="NOME DO LOCAL"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={novoLocal.descricao}
                onChange={(e) => setNovoLocal({ ...novoLocal, descricao: e.target.value })}
                placeholder="DESCRIÇÃO"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setShowNovoLocal(false); setNovoLocal({ nome: "", descricao: "" }); }}>
                Cancelar
              </Button>
              <Button onClick={() => createLocalMutation.mutate({ nome: novoLocal.nome.toUpperCase(), descricao: novoLocal.descricao?.toUpperCase() })} className="bg-green-600">
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNovoCentro} onOpenChange={setShowNovoCentro}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Centro de Custo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                value={novoCentro.nome}
                onChange={(e) => setNovoCentro({ ...novoCentro, nome: e.target.value })}
                placeholder="NOME DO CENTRO DE CUSTO"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo *</Label>
              <Select value={novoCentro.tipo} onValueChange={(value) => setNovoCentro({ ...novoCentro, tipo: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Setor">Setor</SelectItem>
                  <SelectItem value="Departamento">Departamento</SelectItem>
                  <SelectItem value="Filial">Filial</SelectItem>
                  <SelectItem value="Projeto">Projeto</SelectItem>
                  <SelectItem value="Outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Código</Label>
              <Input
                value={novoCentro.codigo}
                onChange={(e) => setNovoCentro({ ...novoCentro, codigo: e.target.value })}
                placeholder="CÓDIGO"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setShowNovoCentro(false); setNovoCentro({ nome: "", tipo: "Setor", codigo: "", descricao: "" }); }}>
                Cancelar
              </Button>
              <Button onClick={() => createCentroMutation.mutate({ nome: novoCentro.nome.toUpperCase(), tipo: novoCentro.tipo, codigo: novoCentro.codigo?.toUpperCase() })} className="bg-green-600">
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}