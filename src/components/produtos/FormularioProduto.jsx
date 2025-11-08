
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Save, X, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function FormularioProduto({ onSubmit, onCancel, initialData, isEditing }) {
  const [formData, setFormData] = useState(initialData || {
    nome_produto: "",
    codigo_interno: "",
    codigo_barras: "",
    categoria: "",
    descricao: "",
    unidade_medida: "",
    preco_custo: "",
    preco_venda: "",
    estoque_minimo: "0",
    local_estoque: "",
    observacoes: ""
  });

  const [showNovaUnidade, setShowNovaUnidade] = useState(false);
  const [showNovaCategoria, setShowNovaCategoria] = useState(false);
  const [showNovoLocal, setShowNovoLocal] = useState(false);
  const [novaUnidade, setNovaUnidade] = useState({ sigla: "", descricao: "" });
  const [novaCategoria, setNovaCategoria] = useState({ nome: "", subcategoria: "", descricao: "" });
  const [novoLocal, setNovoLocal] = useState({ nome: "", descricao: "", capacidade: "" });

  const queryClient = useQueryClient();

  const { data: unidades = [] } = useQuery({
    queryKey: ['unidades'],
    queryFn: () => base44.entities.UnidadeMedida.list(),
    initialData: [],
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list(),
    initialData: [],
  });

  const { data: locais = [] } = useQuery({
    queryKey: ['locais'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: [],
  });

  const createUnidadeMutation = useMutation({
    mutationFn: async (data) => {
      const allUnidades = await base44.entities.UnidadeMedida.list();
      const maxNum = allUnidades.reduce((max, u) => {
        const num = parseInt(u.numero_unidade);
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      const proximoNumero = maxNum + 1;
      return base44.entities.UnidadeMedida.create({ ...data, numero_unidade: String(proximoNumero) });
    },
    onSuccess: (newUnidade) => {
      queryClient.invalidateQueries({ queryKey: ['unidades'] });
      setFormData({ ...formData, unidade_medida: newUnidade.sigla });
      setShowNovaUnidade(false);
      setNovaUnidade({ sigla: "", descricao: "" });
      toast.success('Unidade cadastrada com sucesso!');
    },
  });

  const createCategoriaMutation = useMutation({
    mutationFn: async (data) => {
      const allCategorias = await base44.entities.Categoria.list();
      const maxNum = allCategorias.reduce((max, c) => {
        const num = parseInt(c.numero_categoria);
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      const proximoNumero = maxNum + 1;
      return base44.entities.Categoria.create({ ...data, numero_categoria: String(proximoNumero) });
    },
    onSuccess: (newCategoria) => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      setFormData({ ...formData, categoria: newCategoria.nome });
      setShowNovaCategoria(false);
      setNovaCategoria({ nome: "", subcategoria: "", descricao: "" });
      toast.success('Categoria cadastrada com sucesso!');
    },
  });

  const createLocalMutation = useMutation({
    mutationFn: async (data) => {
      const allLocais = await base44.entities.LocalEstoque.list();
      const maxNum = allLocais.reduce((max, l) => {
        const num = parseInt(l.numero_local);
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      const proximoNumero = maxNum + 1;
      return base44.entities.LocalEstoque.create({ ...data, numero_local: String(proximoNumero) });
    },
    onSuccess: (newLocal) => {
      queryClient.invalidateQueries({ queryKey: ['locais'] });
      setFormData({ ...formData, local_estoque: newLocal.nome });
      setShowNovoLocal(false);
      setNovoLocal({ nome: "", descricao: "", capacidade: "" });
      toast.success('Local de estoque cadastrado com sucesso!');
    },
  });

  const handleChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.nome_produto?.trim()) {
      toast.error('Nome do produto é obrigatório!');
      return;
    }

    if (!formData.codigo_interno?.trim()) {
      toast.error('Código interno é obrigatório!');
      return;
    }

    const data = {
      nome_produto: formData.nome_produto?.toUpperCase(),
      codigo_interno: formData.codigo_interno?.toUpperCase(), // No longer optional
      codigo_barras: formData.codigo_barras || undefined,
      categoria: formData.categoria?.toUpperCase() || undefined,
      descricao: formData.descricao?.toUpperCase() || undefined,
      unidade_medida: formData.unidade_medida?.toUpperCase(),
      preco_custo: parseFloat(formData.preco_custo) || 0,
      preco_venda: parseFloat(formData.preco_venda) || 0,
      estoque_minimo: parseFloat(formData.estoque_minimo) || 0,
      local_estoque: formData.local_estoque?.toUpperCase() || undefined,
      observacoes: formData.observacoes?.toUpperCase() || undefined
    };

    // Não incluir estoque_atual - será gerenciado por movimentações
    if (!isEditing) {
      data.estoque_atual = 0;
    }

    onSubmit(data);
  };

  const handleSalvarUnidade = () => {
    if (!novaUnidade.sigla || !novaUnidade.descricao) {
      toast.error('Preencha todos os campos obrigatórios!');
      return;
    }
    createUnidadeMutation.mutate({
      sigla: novaUnidade.sigla.toUpperCase(),
      descricao: novaUnidade.descricao.toUpperCase()
    });
  };

  const handleSalvarCategoria = () => {
    if (!novaCategoria.nome) {
      toast.error('Nome da categoria é obrigatório!');
      return;
    }
    createCategoriaMutation.mutate({
      nome: novaCategoria.nome.toUpperCase(),
      subcategoria: novaCategoria.subcategoria?.toUpperCase() || undefined,
      descricao: novaCategoria.descricao?.toUpperCase() || undefined
    });
  };

  const handleSalvarLocal = () => {
    if (!novoLocal.nome) {
      toast.error('Nome do local é obrigatório!');
      return;
    }
    createLocalMutation.mutate({
      nome: novoLocal.nome.toUpperCase(),
      descricao: novoLocal.descricao?.toUpperCase() || undefined,
      capacidade: novoLocal.capacidade?.toUpperCase() || undefined
    });
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Nome do Produto *</Label>
                  <Input
                    value={formData.nome_produto}
                    onChange={(e) => handleChange('nome_produto', e.target.value)}
                    placeholder="NOME DO PRODUTO"
                    required
                    className="border-slate-300 focus:border-green-500 uppercase"
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Código Interno *</Label> {/* Label updated */}
                  <Input
                    value={formData.codigo_interno}
                    onChange={(e) => handleChange('codigo_interno', e.target.value)}
                    placeholder="CÓDIGO INTERNO"
                    required {/* Added required prop */}
                    className="border-slate-300 focus:border-green-500 uppercase"
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Código de Barras</Label>
                  <Input
                    value={formData.codigo_barras}
                    onChange={(e) => handleChange('codigo_barras', e.target.value)}
                    placeholder="7891234567890"
                    className="border-slate-300 focus:border-green-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Categoria</Label>
                  <div className="flex gap-2">
                    <Select value={formData.categoria} onValueChange={(value) => handleChange('categoria', value)}>
                      <SelectTrigger className="border-slate-300 focus:border-green-500 flex-1">
                        <SelectValue placeholder="Selecione uma categoria" />
                      </SelectTrigger>
                      <SelectContent>
                        {categorias.map((cat) => (
                          <SelectItem key={cat.id} value={cat.nome}>
                            {cat.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowNovaCategoria(true)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Unidade de Medida *</Label>
                  <div className="flex gap-2">
                    <Select value={formData.unidade_medida} onValueChange={(value) => handleChange('unidade_medida', value)}>
                      <SelectTrigger className="border-slate-300 focus:border-green-500 flex-1">
                        <SelectValue placeholder="Selecione uma unidade" />
                      </SelectTrigger>
                      <SelectContent>
                        {unidades.map((un) => (
                          <SelectItem key={un.id} value={un.sigla}>
                            {un.sigla} - {un.descricao}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowNovaUnidade(true)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Descrição</Label>
                <Textarea
                  value={formData.descricao}
                  onChange={(e) => handleChange('descricao', e.target.value)}
                  placeholder="DESCRIÇÃO DETALHADA DO PRODUTO..."
                  className="border-slate-300 focus:border-green-500 min-h-20 uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Preço de Custo</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.preco_custo}
                    onChange={(e) => handleChange('preco_custo', e.target.value)}
                    placeholder="0.00"
                    className="border-slate-300 focus:border-green-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Preço de Venda</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.preco_venda}
                    onChange={(e) => handleChange('preco_venda', e.target.value)}
                    placeholder="0.00"
                    className="border-slate-300 focus:border-green-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-700 font-medium">Estoque Mínimo</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.estoque_minimo}
                    onChange={(e) => handleChange('estoque_minimo', e.target.value)}
                    placeholder="0"
                    className="border-slate-300 focus:border-green-500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Local de Estoque</Label>
                <div className="flex gap-2">
                  <Select value={formData.local_estoque} onValueChange={(value) => handleChange('local_estoque', value)}>
                    <SelectTrigger className="border-slate-300 focus:border-green-500 flex-1">
                        <SelectValue placeholder="Selecione um local" />
                    </SelectTrigger>
                    <SelectContent>
                      {locais.map((loc) => (
                        <SelectItem key={loc.id} value={loc.nome}>
                          {loc.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="icon" onClick={() => setShowNovoLocal(true)}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Observações</Label>
                <Textarea
                  value={formData.observacoes}
                  onChange={(e) => handleChange('observacoes', e.target.value)}
                  placeholder="OBSERVAÇÕES GERAIS..."
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
                  {isEditing ? 'Atualizar' : 'Salvar'} Produto
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      {/* Modal Nova Unidade */}
      <Dialog open={showNovaUnidade} onOpenChange={setShowNovaUnidade}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Unidade de Medida</DialogTitle>
            <DialogDescription>Cadastre uma nova unidade para usar no produto</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Sigla *</Label>
              <Input
                value={novaUnidade.sigla}
                onChange={(e) => setNovaUnidade({ ...novaUnidade, sigla: e.target.value })}
                placeholder="EX: KG, UN, LT"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
                maxLength={10}
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição *</Label>
              <Input
                value={novaUnidade.descricao}
                onChange={(e) => setNovaUnidade({ ...novaUnidade, descricao: e.target.value })}
                placeholder="DESCRIÇÃO DA UNIDADE"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setShowNovaUnidade(false); setNovaUnidade({ sigla: "", descricao: "" }); }}>
                Cancelar
              </Button>
              <Button onClick={handleSalvarUnidade} className="bg-green-600 hover:bg-green-700">
                Salvar Unidade
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Nova Categoria */}
      <Dialog open={showNovaCategoria} onOpenChange={setShowNovaCategoria}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Categoria</DialogTitle>
            <DialogDescription>Cadastre uma nova categoria para usar no produto</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                value={novaCategoria.nome}
                onChange={(e) => setNovaCategoria({ ...novaCategoria, nome: e.target.value })}
                placeholder="NOME DA CATEGORIA"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-2">
              <Label>Subcategoria</Label>
              <Input
                value={novaCategoria.subcategoria}
                onChange={(e) => setNovaCategoria({ ...novaCategoria, subcategoria: e.target.value })}
                placeholder="SUBCATEGORIA"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={novaCategoria.descricao}
                onChange={(e) => setNovaCategoria({ ...novaCategoria, descricao: e.target.value })}
                placeholder="DESCRIÇÃO DA CATEGORIA"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setShowNovaCategoria(false); setNovaCategoria({ nome: "", subcategoria: "", descricao: "" }); }}>
                Cancelar
              </Button>
              <Button onClick={handleSalvarCategoria} className="bg-green-600 hover:bg-green-700">
                Salvar Categoria
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Novo Local */}
      <Dialog open={showNovoLocal} onOpenChange={setShowNovoLocal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Local de Estoque</DialogTitle>
            <DialogDescription>Cadastre um novo local para usar no produto</DialogDescription>
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
                placeholder="DESCRIÇÃO DO LOCAL"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-2">
              <Label>Capacidade</Label>
              <Input
                value={novoLocal.capacidade}
                onChange={(e) => setNovoLocal({ ...novoLocal, capacidade: e.target.value })}
                placeholder="CAPACIDADE DO LOCAL"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setShowNovoLocal(false); setNovoLocal({ nome: "", descricao: "", capacidade: "" }); }}>
                Cancelar
              </Button>
              <Button onClick={handleSalvarLocal} className="bg-green-600 hover:bg-green-700">
                Salvar Local
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
