import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FileCode, Plus, Edit, Trash2, Search, Download, Copy } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

export default function LayoutsImportacao() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState({
    nome_layout: "",
    tipo_arquivo: "NF-e",
    versao: "1.0",
    criar_rascunhos: true,
    auto_aprovar: false,
    padrao: false,
    ativo: true,
    observacoes: ""
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: layouts = [], isLoading } = useQuery({
    queryKey: ['layouts_importacao', empresaSelecionadaId],
    queryFn: async () => {
      if (!empresaSelecionadaId) return [];
      const all = await base44.entities.LayoutImportacao.list();
      return all.filter(l => l && l.empresa_id === empresaSelecionadaId) || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.LayoutImportacao.create({
      empresa_id: empresaSelecionadaId,
      ...data,
      mapeamento: {
        "numero_documento": "//nNF",
        "data_emissao": "//dhEmi",
        "valor_total": "//vNF",
        "fornecedor_cnpj": "//dest/CNPJ",
        "fornecedor_nome": "//dest/xNome"
      },
      regras_validacao: [],
      transformacoes: []
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['layouts_importacao'] });
      resetForm();
      toast.success('✅ Layout cadastrado!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.LayoutImportacao.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['layouts_importacao'] });
      resetForm();
      toast.success('✅ Layout atualizado!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.LayoutImportacao.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['layouts_importacao'] });
      toast.success('✅ Layout excluído!');
    },
  });

  const resetForm = () => {
    setFormData({
      nome_layout: "",
      tipo_arquivo: "NF-e",
      versao: "1.0",
      criar_rascunhos: true,
      auto_aprovar: false,
      padrao: false,
      ativo: true,
      observacoes: ""
    });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.nome_layout || !formData.tipo_arquivo) {
      toast.error('❌ Preencha os campos obrigatórios!');
      return;
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (layout) => {
    setFormData(layout);
    setEditingId(layout.id);
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('⚠️ Deseja excluir este layout?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleDuplicar = (layout) => {
    setFormData({
      ...layout,
      nome_layout: `${layout.nome_layout} (Cópia)`,
      padrao: false
    });
    setEditingId(null);
    setShowForm(true);
    toast.success('Layout duplicado! Altere o nome e salve.');
  };

  const layoutsFiltrados = layouts.filter(l => {
    const searchLower = searchTerm.toLowerCase();
    return !searchTerm ||
      l.nome_layout?.toLowerCase().includes(searchLower) ||
      l.tipo_arquivo?.toLowerCase().includes(searchLower);
  });

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Layouts de Importação</h1>
          <p className="text-sm text-slate-600 mt-1">Configure layouts para importação de XML/CNAB</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          Novo Layout
        </Button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card>
              <CardHeader className="border-b bg-slate-50">
                <CardTitle className="text-base">
                  {editingId ? 'Editar Layout' : 'Novo Layout de Importação'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Nome do Layout *</Label>
                      <Input
                        value={formData.nome_layout}
                        onChange={(e) => setFormData({...formData, nome_layout: e.target.value})}
                        placeholder="Ex: SSG Padrão v1"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Tipo de Arquivo *</Label>
                      <Select value={formData.tipo_arquivo} onValueChange={(v) => setFormData({...formData, tipo_arquivo: v})}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NF-e">NF-e</SelectItem>
                          <SelectItem value="NFS-e">NFS-e</SelectItem>
                          <SelectItem value="CNAB240">CNAB 240</SelectItem>
                          <SelectItem value="CNAB400">CNAB 400</SelectItem>
                          <SelectItem value="OFX">OFX</SelectItem>
                          <SelectItem value="XML Genérico">XML Genérico</SelectItem>
                          <SelectItem value="CSV">CSV</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Versão</Label>
                    <Input
                      value={formData.versao}
                      onChange={(e) => setFormData({...formData, versao: e.target.value})}
                      placeholder="1.0"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Observações/Documentação</Label>
                    <Textarea
                      value={formData.observacoes}
                      onChange={(e) => setFormData({...formData, observacoes: e.target.value})}
                      rows={3}
                      className="text-xs"
                      placeholder="Descreva o propósito deste layout, regras especiais, etc."
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={formData.criar_rascunhos}
                        onCheckedChange={(v) => setFormData({...formData, criar_rascunhos: v})}
                      />
                      <Label className="text-sm">Criar como rascunho se houver avisos</Label>
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        checked={formData.auto_aprovar}
                        onCheckedChange={(v) => setFormData({...formData, auto_aprovar: v})}
                      />
                      <Label className="text-sm">Auto-aprovar importações sem erros</Label>
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        checked={formData.padrao}
                        onCheckedChange={(v) => setFormData({...formData, padrao: v})}
                      />
                      <Label className="text-sm">Layout padrão para este tipo</Label>
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        checked={formData.ativo}
                        onCheckedChange={(v) => setFormData({...formData, ativo: v})}
                      />
                      <Label className="text-sm">Layout ativo</Label>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancelar
                    </Button>
                    <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                      {editingId ? 'Atualizar' : 'Cadastrar'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TABELA */}
      <Card>
        <CardHeader className="border-b bg-slate-50">
          <div className="flex justify-between items-center">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileCode className="w-5 h-5" />
              Layouts Cadastrados
              <Badge variant="secondary">{layoutsFiltrados.length}</Badge>
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar layout..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="h-8 text-xs">Nome</TableHead>
                <TableHead className="h-8 text-xs">Tipo Arquivo</TableHead>
                <TableHead className="h-8 text-xs">Versão</TableHead>
                <TableHead className="h-8 text-xs">Padrão</TableHead>
                <TableHead className="h-8 text-xs">Status</TableHead>
                <TableHead className="h-8 text-xs text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-4 text-xs">Carregando...</TableCell>
                </TableRow>
              ) : layoutsFiltrados.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <FileCode className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="text-xs text-slate-500">Nenhum layout cadastrado</p>
                  </TableCell>
                </TableRow>
              ) : (
                layoutsFiltrados.map((layout) => (
                  <TableRow key={layout.id} className="hover:bg-slate-50">
                    <TableCell className="py-2 text-xs font-medium">{layout.nome_layout}</TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className="text-xs">{layout.tipo_arquivo}</Badge>
                    </TableCell>
                    <TableCell className="py-2 text-xs">{layout.versao}</TableCell>
                    <TableCell className="py-2">
                      {layout.padrao && <Badge className="bg-blue-100 text-blue-800 text-xs">Padrão</Badge>}
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge className={layout.ativo ? 'bg-green-100 text-green-800 text-xs' : 'bg-slate-100 text-slate-800 text-xs'}>
                        {layout.ativo ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex gap-1 justify-center">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(layout)} className="h-6 w-6" title="Editar">
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDuplicar(layout)} className="h-6 w-6" title="Duplicar">
                          <Copy className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(layout.id)} className="h-6 w-6 text-red-600" title="Excluir">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}