import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { Plus } from "lucide-react";
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
      toast.success('Unidade cadastrada!');
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
      toast.success('Categoria cadastrada!');
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
      toast.success('Local cadastrado!');
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
      codigo_interno: formData.codigo_interno?.toUpperCase(),
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

    if (!isEditing) {
      data.estoque_atual = 0;
    }

    onSubmit(data);
  };

  const categoriasFixas = [{ value: 'SUPLEMENTAÇÃO', label: 'SUPLEMENTAÇÃO' }];
  const categoriasOptions = [...categoriasFixas, ...categorias.map(c => ({ value: c.nome, label: c.nome }))];
  const unidadesOptions = unidades.map(u => ({ value: u.sigla, label: `${u.sigla} - ${u.descricao}` }));
  const locaisOptions = locais.map(l => ({ value: l.nome, label: l.nome }));

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
      >
        <Card className="shadow-sm border-slate-300 bg-white">
          <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
            <CardTitle className="text-sm font-semibold text-slate-900">
              {isEditing ? 'Editar Produto' : 'Novo Produto'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nome do Produto *</Label>
                  <Input
                    value={formData.nome_produto}
                    onChange={(e) => handleChange('nome_produto', e.target.value)}
                    placeholder="NOME DO PRODUTO"
                    required
                    className="h-8 text-xs uppercase"
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Código Interno *</Label>
                  <Input
                    value={formData.codigo_interno}
                    onChange={(e) => handleChange('codigo_interno', e.target.value)}
                    placeholder="CÓDIGO INTERNO"
                    required
                    className="h-8 text-xs uppercase"
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Código de Barras</Label>
                  <Input
                    value={formData.codigo_barras}
                    onChange={(e) => handleChange('codigo_barras', e.target.value)}
                    placeholder="7891234567890"
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Categoria</Label>
                  <div className="flex gap-2">
                    <Combobox
                      options={categoriasOptions}
                      value={formData.categoria}
                      onValueChange={(value) => handleChange('categoria', value)}
                      placeholder="Selecione"
                      searchPlaceholder="Buscar..."
                      className="flex-1 h-8 text-xs"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowNovaCategoria(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Unidade de Medida *</Label>
                  <div className="flex gap-2">
                    <Combobox
                      options={unidadesOptions}
                      value={formData.unidade_medida}
                      onValueChange={(value) => handleChange('unidade_medida', value)}
                      placeholder="Selecione"
                      searchPlaceholder="Buscar..."
                      className="flex-1 h-8 text-xs"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowNovaUnidade(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Local de Estoque</Label>
                  <div className="flex gap-2">
                    <Combobox
                      options={locaisOptions}
                      value={formData.local_estoque}
                      onValueChange={(value) => handleChange('local_estoque', value)}
                      placeholder="Selecione"
                      searchPlaceholder="Buscar..."
                      className="flex-1 h-8 text-xs"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowNovoLocal(true)} className="h-8 w-8">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Preço de Custo</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.preco_custo}
                    onChange={(e) => handleChange('preco_custo', e.target.value)}
                    placeholder="0.00"
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Preço de Venda</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.preco_venda}
                    onChange={(e) => handleChange('preco_venda', e.target.value)}
                    placeholder="0.00"
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Estoque Mínimo</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.estoque_minimo}
                    onChange={(e) => handleChange('estoque_minimo', e.target.value)}
                    placeholder="0"
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Descrição</Label>
                <Textarea
                  value={formData.descricao}
                  onChange={(e) => handleChange('descricao', e.target.value)}
                  placeholder="DESCRIÇÃO DETALHADA DO PRODUTO..."
                  className="text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                  rows={2}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Observações</Label>
                <Textarea
                  value={formData.observacoes}
                  onChange={(e) => handleChange('observacoes', e.target.value)}
                  placeholder="OBSERVAÇÕES GERAIS..."
                  className="text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
                <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
                  {isEditing ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={showNovaUnidade} onOpenChange={setShowNovaUnidade}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Nova Unidade de Medida</DialogTitle>
            <DialogDescription className="text-xs">Cadastre uma nova unidade</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Sigla *</Label>
              <Input
                value={novaUnidade.sigla}
                onChange={(e) => setNovaUnidade({ ...novaUnidade, sigla: e.target.value })}
                placeholder="EX: KG, UN, LT"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                maxLength={10}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição *</Label>
              <Input
                value={novaUnidade.descricao}
                onChange={(e) => setNovaUnidade({ ...novaUnidade, descricao: e.target.value })}
                placeholder="DESCRIÇÃO DA UNIDADE"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowNovaUnidade(false); setNovaUnidade({ sigla: "", descricao: "" }); }} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={() => createUnidadeMutation.mutate({ sigla: novaUnidade.sigla.toUpperCase(), descricao: novaUnidade.descricao.toUpperCase() })} size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNovaCategoria} onOpenChange={setShowNovaCategoria}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Nova Categoria</DialogTitle>
            <DialogDescription className="text-xs">Cadastre uma nova categoria</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Nome *</Label>
              <Input
                value={novaCategoria.nome}
                onChange={(e) => setNovaCategoria({ ...novaCategoria, nome: e.target.value })}
                placeholder="NOME DA CATEGORIA"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Subcategoria</Label>
              <Input
                value={novaCategoria.subcategoria}
                onChange={(e) => setNovaCategoria({ ...novaCategoria, subcategoria: e.target.value })}
                placeholder="SUBCATEGORIA"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
              <Textarea
                value={novaCategoria.descricao}
                onChange={(e) => setNovaCategoria({ ...novaCategoria, descricao: e.target.value })}
                placeholder="DESCRIÇÃO"
                className="text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowNovaCategoria(false); setNovaCategoria({ nome: "", subcategoria: "", descricao: "" }); }} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={() => createCategoriaMutation.mutate({ nome: novaCategoria.nome.toUpperCase(), subcategoria: novaCategoria.subcategoria?.toUpperCase(), descricao: novaCategoria.descricao?.toUpperCase() })} size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNovoLocal} onOpenChange={setShowNovoLocal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Novo Local de Estoque</DialogTitle>
            <DialogDescription className="text-xs">Cadastre um novo local</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Nome *</Label>
              <Input
                value={novoLocal.nome}
                onChange={(e) => setNovoLocal({ ...novoLocal, nome: e.target.value })}
                placeholder="NOME DO LOCAL"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
              <Textarea
                value={novoLocal.descricao}
                onChange={(e) => setNovoLocal({ ...novoLocal, descricao: e.target.value })}
                placeholder="DESCRIÇÃO"
                className="text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Capacidade</Label>
              <Input
                value={novoLocal.capacidade}
                onChange={(e) => setNovoLocal({ ...novoLocal, capacidade: e.target.value })}
                placeholder="CAPACIDADE"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowNovoLocal(false); setNovoLocal({ nome: "", descricao: "", capacidade: "" }); }} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={() => createLocalMutation.mutate({ nome: novoLocal.nome.toUpperCase(), descricao: novoLocal.descricao?.toUpperCase(), capacidade: novoLocal.capacidade?.toUpperCase() })} size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}