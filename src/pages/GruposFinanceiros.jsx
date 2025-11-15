
import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Save, X, Edit2, Trash2, ChevronRight, ChevronDown, FolderTree } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const GRUPOS_PADRAO = {
  Despesa: [
    { codigo: "1.0", descricao: "FORNECEDORES", nivel: 1 },
    { codigo: "1.1", descricao: "Fornecedores de Insumos", nivel: 2, pai: "1.0" },
    { codigo: "1.2", descricao: "Fornecedores de Serviços", nivel: 2, pai: "1.0" },
    { codigo: "1.3", descricao: "Fornecedores de Combustível", nivel: 2, pai: "1.0" },
    { codigo: "2.0", descricao: "FOLHA DE PAGAMENTO", nivel: 1 },
    { codigo: "2.1", descricao: "Salários", nivel: 2, pai: "2.0" },
    { codigo: "2.2", descricao: "Encargos Sociais", nivel: 2, pai: "2.0" },
    { codigo: "2.3", descricao: "Benefícios", nivel: 2, pai: "2.0" },
    { codigo: "3.0", descricao: "DESPESAS GERAIS", nivel: 1 },
    { codigo: "3.1", descricao: "Energia Elétrica", nivel: 2, pai: "3.0" },
    { codigo: "3.2", descricao: "Água", nivel: 2, pai: "3.0" },
    { codigo: "3.3", descricao: "Telefone e Internet", nivel: 2, pai: "3.0" },
    { codigo: "4.0", descricao: "IMPOSTOS", nivel: 1 },
    { codigo: "4.1", descricao: "Impostos Federais", nivel: 2, pai: "4.0" },
    { codigo: "4.2", descricao: "Impostos Estaduais", nivel: 2, pai: "4.0" },
    { codigo: "4.3", descricao: "Impostos Municipais", nivel: 2, pai: "4.0" },
    { codigo: "5.0", descricao: "FINANCEIRO", nivel: 1 },
    { codigo: "5.1", descricao: "Juros e Multas", nivel: 2, pai: "5.0" },
    { codigo: "5.2", descricao: "Tarifas Bancárias", nivel: 2, pai: "5.0" },
  ],
  Receita: [
    { codigo: "1.0", descricao: "CLIENTES", nivel: 1 },
    { codigo: "1.1", descricao: "Venda de Produtos", nivel: 2, pai: "1.0" },
    { codigo: "1.2", descricao: "Prestação de Serviços", nivel: 2, pai: "1.0" },
    { codigo: "2.0", descricao: "RECEITAS FINANCEIRAS", nivel: 1 },
    { codigo: "2.1", descricao: "Rendimentos", nivel: 2, pai: "2.0" },
    { codigo: "2.2", descricao: "Descontos Obtidos", nivel: 2, pai: "2.0" },
    { codigo: "3.0", descricao: "OUTRAS RECEITAS", nivel: 1 },
    { codigo: "3.1", descricao: "Arrendamentos", nivel: 2, pai: "3.0" },
    { codigo: "3.2", descricao: "Vendas Diversas", nivel: 2, pai: "3.0" },
  ]
};

export default function GruposFinanceiros() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [expandedNodes, setExpandedNodes] = useState({});
  const [tipoFiltro, setTipoFiltro] = useState("Despesa");
  
  const [formData, setFormData] = useState({
    codigo: "",
    descricao: "",
    tipo: "Despesa",
    grupo_pai_id: ""
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: grupos = [], isLoading } = useQuery({
    queryKey: ['grupos_hierarquico', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.GrupoFinanceiro.list('codigo');
      return all.filter(g => g.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const maxNum = grupos.reduce((max, g) => Math.max(max, parseInt(g.numero_grupo) || 0), 0);
      
      const nivel = data.grupo_pai_id 
        ? (grupos.find(g => g.id === data.grupo_pai_id)?.nivel || 0) + 1
        : data.codigo.split('.').length;

      return base44.entities.GrupoFinanceiro.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_grupo: String(maxNum + 1),
        nivel,
        ativo: true
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grupos_hierarquico'] });
      setShowForm(false);
      setEditingItem(null);
      setFormData({ codigo: "", descricao: "", tipo: "Despesa", grupo_pai_id: "" });
      toast.success('✅ Grupo salvo!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.GrupoFinanceiro.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grupos_hierarquico'] });
      setShowForm(false);
      setEditingItem(null);
      setFormData({ codigo: "", descricao: "", tipo: "Despesa", grupo_pai_id: "" });
      toast.success('✅ Grupo atualizado!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.GrupoFinanceiro.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grupos_hierarquico'] });
      toast.success('✅ Grupo excluído!');
    },
  });

  const inserirPadrao = async () => {
    if (grupos.length > 0) {
      if (!window.confirm('⚠️ Já existem grupos cadastrados. Deseja adicionar os grupos padrão mesmo assim?')) {
        return;
      }
    }

    const tipos = ['Despesa', 'Receita'];
    let contador = grupos.length;

    for (const tipo of tipos) {
      const gruposDoTipo = GRUPOS_PADRAO[tipo];
      const mapa = {};

      for (const grupo of gruposDoTipo) {
        contador++;
        
        let grupo_pai_id = undefined;
        if (grupo.pai) {
          grupo_pai_id = mapa[grupo.pai];
        }

        const created = await base44.entities.GrupoFinanceiro.create({
          empresa_id: empresaSelecionadaId,
          numero_grupo: String(contador),
          codigo: grupo.codigo,
          descricao: grupo.descricao,
          tipo: tipo,
          grupo_pai_id,
          nivel: grupo.nivel,
          ativo: true
        });

        mapa[grupo.codigo] = created.id;
      }
    }

    queryClient.invalidateQueries({ queryKey: ['grupos_hierarquico'] });
    toast.success('✅ Grupos padrão inseridos!');
  };

  const buildTree = (tipo) => {
    const filtered = grupos.filter(g => g.tipo === tipo && g.ativo !== false);
    const roots = filtered.filter(g => !g.grupo_pai_id);
    
    const buildChildren = (parentId) => {
      return filtered.filter(g => g.grupo_pai_id === parentId);
    };

    const tree = [];
    roots.forEach(root => {
      const node = { ...root, children: buildChildren(root.id) };
      const addChildren = (n) => {
        if (n.children.length > 0) {
          n.children = n.children.map(child => ({
            ...child,
            children: buildChildren(child.id)
          }));
          n.children.forEach(addChildren);
        }
      };
      addChildren(node);
      tree.push(node);
    });

    return tree;
  };

  const tree = useMemo(() => buildTree(tipoFiltro), [grupos, tipoFiltro]);

  const toggleNode = (id) => {
    setExpandedNodes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const renderTree = (nodes, level = 0) => {
    return nodes.map(node => (
      <div key={node.id} className="select-none">
        <div 
          className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-50 rounded group"
          style={{ paddingLeft: `${level * 24 + 8}px` }}
        >
          {node.children.length > 0 ? (
            <button onClick={() => toggleNode(node.id)} className="w-4 h-4 flex items-center justify-center">
              {expandedNodes[node.id] ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
              )}
            </button>
          ) : (
            <div className="w-4" />
          )}
          
          <span className={`font-mono text-xs ${node.children.length > 0 ? 'font-bold text-blue-700' : 'text-slate-600'}`}>
            {node.codigo}
          </span>
          
          <span className={`flex-1 text-sm ${node.children.length > 0 ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
            {node.descricao}
          </span>
          
          {node.children.length > 0 && (
            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">Grupo</span>
          )}
          
          <div className="opacity-0 group-hover:opacity-100 flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setEditingItem(node);
                setFormData({
                  codigo: node.codigo,
                  descricao: node.descricao,
                  tipo: node.tipo,
                  grupo_pai_id: node.grupo_pai_id || ""
                });
                setShowForm(true);
              }}
              className="h-7 w-7"
            >
              <Edit2 className="w-3 h-3 text-blue-600" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (window.confirm('⚠️ Excluir este grupo?')) {
                  deleteMutation.mutate(node.id);
                }
              }}
              className="h-7 w-7"
            >
              <Trash2 className="w-3 h-3 text-red-600" />
            </Button>
          </div>
        </div>
        
        {expandedNodes[node.id] && node.children.length > 0 && (
          <div>
            {renderTree(node.children, level + 1)}
          </div>
        )}
      </div>
    ));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.codigo || !formData.descricao) {
      toast.error('❌ Preencha código e descrição!');
      return;
    }

    const data = {
      codigo: formData.codigo.toUpperCase(),
      descricao: formData.descricao.toUpperCase(),
      tipo: formData.tipo,
      grupo_pai_id: formData.grupo_pai_id || undefined
    };

    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const gruposParaSelect = grupos.filter(g => g.tipo === formData.tipo && g.nivel === 1);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Grupos Financeiros</h1>
          <p className="text-xs text-slate-600">Estrutura hierárquica de grupos</p>
        </div>
        <div className="flex gap-2">
          {grupos.length === 0 && (
            <Button onClick={inserirPadrao} variant="outline" size="sm" className="gap-1 text-xs h-8">
              <FolderTree className="w-3.5 h-3.5" />
              Inserir Padrão
            </Button>
          )}
          <Button onClick={() => { setShowForm(!showForm); setEditingItem(null); setFormData({ codigo: "", descricao: "", tipo: "Despesa", grupo_pai_id: "" }); }} size="sm" className="gap-1 text-xs h-8 bg-slate-700 hover:bg-slate-800">
            <Plus className="w-3.5 h-3.5" />
            Novo
          </Button>
        </div>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-emerald-200 bg-emerald-50">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">{editingItem ? 'Editar' : 'Novo'} Grupo Financeiro</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Código *</Label>
                    <Input value={formData.codigo} onChange={(e) => setFormData({ ...formData, codigo: e.target.value })} placeholder="1.1" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">Descrição *</Label>
                    <Input value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} placeholder="DESCRIÇÃO" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tipo *</Label>
                    <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v, grupo_pai_id: "" })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Despesa" className="text-xs">Despesa</SelectItem>
                        <SelectItem value="Receita" className="text-xs">Receita</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Grupo Pai (Opcional)</Label>
                    <Select value={formData.grupo_pai_id} onValueChange={(v) => setFormData({ ...formData, grupo_pai_id: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Nenhum (raiz)" /></SelectTrigger>
                      <SelectContent>
                        {gruposParaSelect.map(g => (
                          <SelectItem key={g.id} value={g.id} className="text-xs">{g.codigo} - {g.descricao}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t">
                  <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingItem(null); }} size="sm" className="h-8 text-xs">
                    <X className="w-3 h-3 mr-1" />
                    Cancelar
                  </Button>
                  <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
                    <Save className="w-3 h-3 mr-1" />
                    Salvar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <Card className="shadow-sm">
        <CardHeader className="pb-3 border-b">
          <div className="flex justify-between items-center">
            <CardTitle className="text-sm">Estrutura de Grupos</CardTitle>
            <Select value={tipoFiltro} onValueChange={setTipoFiltro}>
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Despesa" className="text-xs">Despesas</SelectItem>
                <SelectItem value="Receita" className="text-xs">Receitas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-12 text-slate-400">Carregando...</div>
          ) : tree.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <FolderTree className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Nenhum grupo cadastrado</p>
              <Button onClick={inserirPadrao} variant="outline" size="sm" className="mt-3 gap-1 text-xs">
                <FolderTree className="w-3 h-3" />
                Inserir Padrão
              </Button>
            </div>
          ) : (
            <div className="p-3">
              {renderTree(tree)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
