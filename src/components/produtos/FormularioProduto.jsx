
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Save, X, Tag, Barcode, Hash, FileText, DollarSign, TrendingUp, Box, Plus, Warehouse } from "lucide-react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

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
    local_estoque: initialData?.local_estoque || "",
    observacoes: initialData?.observacoes || ""
  });

  const [showUnidadeDialog, setShowUnidadeDialog] = useState(false);
  const [showCategoriaDialog, setShowCategoriaDialog] = useState(false);
  const [showLocalDialog, setShowLocalDialog] = useState(false);
  const [newUnidade, setNewUnidade] = useState({ sigla: "", descricao: "" });
  const [newCategoria, setNewCategoria] = useState({ nome: "", subcategoria: "", descricao: "" });
  const [newLocal, setNewLocal] = useState({ nome: "", descricao: "", capacidade: "" });

  const queryClient = useQueryClient();

  // Buscar unidades de medida
  const { data: unidades = [] } = useQuery({
    queryKey: ['unidades_medida'],
    queryFn: async () => {
      const data = await base44.entities.UnidadeMedida.list();
      return data.sort((a, b) => a.sigla.localeCompare(b.sigla));
    },
  });

  // Buscar categorias
  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: async () => {
      const data = await base44.entities.Categoria.list();
      return data.sort((a, b) => a.nome.localeCompare(b.nome));
    },
  });

  // Buscar locais de estoque
  const { data: locais = [] } = useQuery({
    queryKey: ['locais_estoque'],
    queryFn: async () => {
      const data = await base44.entities.LocalEstoque.list();
      return data.sort((a, b) => a.nome.localeCompare(b.nome));
    },
  });

  // Mutation para criar unidade
  const createUnidadeMutation = useMutation({
    mutationFn: (data) => base44.entities.UnidadeMedida.create(data),
    onSuccess: (newUnidade) => {
      queryClient.invalidateQueries({ queryKey: ['unidades_medida'] });
      setFormData(prev => ({ ...prev, unidade_medida: newUnidade.sigla }));
      setShowUnidadeDialog(false);
      setNewUnidade({ sigla: "", descricao: "" });
      toast.success('Unidade cadastrada com sucesso!');
    },
  });

  // Mutation para criar categoria
  const createCategoriaMutation = useMutation({
    mutationFn: (data) => base44.entities.Categoria.create(data),
    onSuccess: (newCat) => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      setFormData(prev => ({ ...prev, categoria: newCat.nome }));
      setShowCategoriaDialog(false);
      setNewCategoria({ nome: "", subcategoria: "", descricao: "" });
      toast.success('Categoria cadastrada com sucesso!');
    },
  });

  // Mutation para criar local
  const createLocalMutation = useMutation({
    mutationFn: (data) => base44.entities.LocalEstoque.create(data),
    onSuccess: (newLoc) => {
      queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
      setFormData(prev => ({ ...prev, local_estoque: newLoc.nome }));
      setShowLocalDialog(false);
      setNewLocal({ nome: "", descricao: "", capacidade: "" });
      toast.success('Local cadastrado com sucesso!');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    // Validação antes de enviar
    if (!formData.nome_produto || !formData.nome_produto.trim()) {
      toast.error('Nome do produto é obrigatório!');
      return;
    }

    onSubmit(formData);
  };

  const handleChange = (field, value) => {
    if (typeof value === 'string' && !['codigo_barras', 'preco_custo', 'preco_venda', 'estoque_atual', 'estoque_minimo'].includes(field)) {
      value = value.toUpperCase();
    }
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveUnidade = (e) => {
    e.preventDefault();
    if (!newUnidade.sigla || !newUnidade.descricao) {
      toast.error('Preencha todos os campos obrigatórios!');
      return;
    }
    const dataToSend = {
      sigla: newUnidade.sigla.toUpperCase(),
      descricao: newUnidade.descricao.toUpperCase()
    };
    createUnidadeMutation.mutate(dataToSend);
  };

  const handleSaveCategoria = (e) => {
    e.preventDefault();
    if (!newCategoria.nome) {
      toast.error('Nome da categoria é obrigatório!');
      return;
    }
    const dataToSend = {
      nome: newCategoria.nome.toUpperCase(),
      subcategoria: newCategoria.subcategoria?.toUpperCase() || undefined,
      descricao: newCategoria.descricao?.toUpperCase() || undefined
    };
    createCategoriaMutation.mutate(dataToSend);
  };

  const handleSaveLocal = (e) => {
    e.preventDefault();
    if (!newLocal.nome) {
      toast.error('Nome do local é obrigatório!');
      return;
    }
    const dataToSend = {
      nome: newLocal.nome.toUpperCase(),
      descricao: newLocal.descricao?.toUpperCase() || undefined,
      capacidade: newLocal.capacidade?.toUpperCase() || undefined
    };
    createLocalMutation.mutate(dataToSend);
  };

  return (
    <>
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
                  placeholder="NOME DO PRODUTO"
                  required
                  className="border-slate-300 focus:border-green-500 uppercase"
                  style={{ textTransform: 'uppercase' }}
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
                    placeholder="CÓDIGO"
                    className="border-slate-300 focus:border-green-500 uppercase"
                    style={{ textTransform: 'uppercase' }}
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
                  <div className="flex gap-2">
                    <Select value={formData.categoria} onValueChange={(value) => handleChange('categoria', value)}>
                      <SelectTrigger className="border-slate-300 focus:border-green-500 flex-1">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {categorias.map((cat) => (
                          <SelectItem key={cat.id} value={cat.nome}>
                            {cat.nome}{cat.subcategoria ? ` - ${cat.subcategoria}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowCategoriaDialog(true)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
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
                  placeholder="DESCRIÇÃO DETALHADA DO PRODUTO..."
                  className="border-slate-300 focus:border-green-500 min-h-20 uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              {/* Unidade e Preços */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium flex items-center gap-2">
                    <Box className="w-4 h-4 text-cyan-600" />
                    Unidade de Medida
                  </Label>
                  <div className="flex gap-2">
                    <Select value={formData.unidade_medida} onValueChange={(value) => handleChange('unidade_medida', value)}>
                      <SelectTrigger className="border-slate-300 focus:border-green-500 flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {unidades.map((un) => (
                          <SelectItem key={un.id} value={un.sigla}>
                            {un.sigla} - {un.descricao}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowUnidadeDialog(true)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium flex items-center gap-2">
                    <Warehouse className="w-4 h-4 text-indigo-600" />
                    Local de Estoque
                  </Label>
                  <div className="flex gap-2">
                    <Select value={formData.local_estoque} onValueChange={(value) => handleChange('local_estoque', value)}>
                      <SelectTrigger className="border-slate-300 focus:border-green-500 flex-1">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {locais.map((loc) => (
                          <SelectItem key={loc.id} value={loc.nome}>
                            {loc.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowLocalDialog(true)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
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
                  onChange={(e) => handleChange('observacoes', e.target.value.toUpperCase())}
                  placeholder="INFORMAÇÕES ADICIONAIS SOBRE O PRODUTO..."
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
                  {isEditing ? 'Atualizar' : 'Salvar'} Produto
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      {/* Dialog Nova Unidade */}
      <Dialog open={showUnidadeDialog} onOpenChange={setShowUnidadeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Unidade de Medida</DialogTitle>
            <DialogDescription>Cadastre uma nova unidade de medida</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveUnidade} className="space-y-4">
            <div className="space-y-2">
              <Label>Sigla *</Label>
              <Input
                value={newUnidade.sigla}
                onChange={(e) => setNewUnidade({ ...newUnidade, sigla: e.target.value.toUpperCase() })}
                placeholder="EX: UN, KG, LT"
                required
                maxLength={5}
                className="uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição *</Label>
              <Input
                value={newUnidade.descricao}
                onChange={(e) => setNewUnidade({ ...newUnidade, descricao: e.target.value.toUpperCase() })}
                placeholder="UNIDADE, QUILOGRAMA, LITRO"
                required
                className="uppercase"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowUnidadeDialog(false)}>Cancelar</Button>
              <Button type="submit" disabled={createUnidadeMutation.isPending}>
                {createUnidadeMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Nova Categoria */}
      <Dialog open={showCategoriaDialog} onOpenChange={setShowCategoriaDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Categoria</DialogTitle>
            <DialogDescription>Cadastre uma nova categoria de produto</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveCategoria} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da Categoria *</Label>
              <Input
                value={newCategoria.nome}
                onChange={(e) => setNewCategoria({ ...newCategoria, nome: e.target.value.toUpperCase() })}
                placeholder="INSUMOS, FERRAMENTAS, ETC"
                required
                className="uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label>Subcategoria (Opcional)</Label>
              <Input
                value={newCategoria.subcategoria}
                onChange={(e) => setNewCategoria({ ...newCategoria, subcategoria: e.target.value.toUpperCase() })}
                placeholder="EX: HERBICIDAS, FUNGICIDAS"
                className="uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição (Opcional)</Label>
              <Textarea
                value={newCategoria.descricao}
                onChange={(e) => setNewCategoria({ ...newCategoria, descricao: e.target.value.toUpperCase() })}
                placeholder="DESCRIÇÃO DA CATEGORIA"
                className="uppercase"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowCategoriaDialog(false)}>Cancelar</Button>
              <Button type="submit" disabled={createCategoriaMutation.isPending}>
                {createCategoriaMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Novo Local */}
      <Dialog open={showLocalDialog} onOpenChange={setShowLocalDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Local de Estoque</DialogTitle>
            <DialogDescription>Cadastre um novo local de estoque</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveLocal} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do Local *</Label>
              <Input
                value={newLocal.nome}
                onChange={(e) => setNewLocal({ ...newLocal, nome: e.target.value.toUpperCase() })}
                placeholder="GALPÃO 1, DEPÓSITO A, ETC"
                required
                className="uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label>Capacidade</Label>
              <Input
                value={newLocal.capacidade}
                onChange={(e) => setNewLocal({ ...newLocal, capacidade: e.target.value.toUpperCase() })}
                placeholder="EX: 500 SACAS, 10 TONELADAS"
                className="uppercase"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowLocalDialog(false)}>Cancelar</Button>
              <Button type="submit" disabled={createLocalMutation.isPending}>
                {createLocalMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
