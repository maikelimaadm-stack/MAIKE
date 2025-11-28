import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { 
  Plus, Edit2, Trash2, Search, Building2, MapPin, Phone, User, 
  MoreVertical, Save, X, Landmark
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TIPOS_SETOR = [
  { value: "Próprio", label: "Próprio", cor: "bg-emerald-100 text-emerald-800" },
  { value: "Arrendado", label: "Arrendado", cor: "bg-blue-100 text-blue-800" },
  { value: "Parceria", label: "Parceria", cor: "bg-purple-100 text-purple-800" },
  { value: "Terceiros", label: "Terceiros", cor: "bg-orange-100 text-orange-800" },
];

const ESTADOS_BR = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", 
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

export default function CadastroSetores() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [deletarId, setDeletarId] = useState(null);
  
  const [formData, setFormData] = useState({
    nome: "",
    sigla: "",
    tipo: "Próprio",
    responsavel: "",
    telefone: "",
    endereco: "",
    cidade: "",
    estado: "",
    area_total: "",
    capacidade_animais: "",
    observacoes: "",
    ativo: true
  });

  const { data: setores = [], isLoading } = useQuery({
    queryKey: ['setores', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Setor.list();
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const allSetores = await base44.entities.Setor.list();
      const maxNum = allSetores.reduce((max, s) => Math.max(max, parseInt(s.numero_setor) || 0), 0);
      
      return base44.entities.Setor.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_setor: String(maxNum + 1),
        area_total: data.area_total ? parseFloat(data.area_total) : null,
        capacidade_animais: data.capacidade_animais ? parseInt(data.capacidade_animais) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setores'] });
      toast.success('Setor cadastrado com sucesso!');
      resetForm();
    },
    onError: () => toast.error('Erro ao cadastrar setor')
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return base44.entities.Setor.update(id, {
        ...data,
        area_total: data.area_total ? parseFloat(data.area_total) : null,
        capacidade_animais: data.capacidade_animais ? parseInt(data.capacidade_animais) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setores'] });
      toast.success('Setor atualizado!');
      resetForm();
    },
    onError: () => toast.error('Erro ao atualizar setor')
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Setor.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setores'] });
      toast.success('Setor excluído!');
      setShowDelete(false);
      setDeletarId(null);
    },
    onError: () => toast.error('Erro ao excluir setor')
  });

  const resetForm = () => {
    setFormData({
      nome: "",
      sigla: "",
      tipo: "Próprio",
      responsavel: "",
      telefone: "",
      endereco: "",
      cidade: "",
      estado: "",
      area_total: "",
      capacidade_animais: "",
      observacoes: "",
      ativo: true
    });
    setEditando(null);
    setShowForm(false);
  };

  const handleEdit = (setor) => {
    setFormData({
      nome: setor.nome || "",
      sigla: setor.sigla || "",
      tipo: setor.tipo || "Próprio",
      responsavel: setor.responsavel || "",
      telefone: setor.telefone || "",
      endereco: setor.endereco || "",
      cidade: setor.cidade || "",
      estado: setor.estado || "",
      area_total: setor.area_total || "",
      capacidade_animais: setor.capacidade_animais || "",
      observacoes: setor.observacoes || "",
      ativo: setor.ativo !== false
    });
    setEditando(setor);
    setShowForm(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.nome) {
      toast.error('Informe o nome do setor');
      return;
    }
    
    if (editando) {
      updateMutation.mutate({ id: editando.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const filteredSetores = setores.filter(s => {
    const searchLower = searchTerm.toLowerCase();
    return (
      s.nome?.toLowerCase().includes(searchLower) ||
      s.sigla?.toLowerCase().includes(searchLower) ||
      s.tipo?.toLowerCase().includes(searchLower) ||
      s.cidade?.toLowerCase().includes(searchLower)
    );
  });

  const getTipoBadge = (tipo) => {
    const config = TIPOS_SETOR.find(t => t.value === tipo) || TIPOS_SETOR[0];
    return <Badge className={`${config.cor} text-xs`}>{config.label}</Badge>;
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Landmark className="w-5 h-5" />
            Cadastro de Setores / Fazendas
          </h1>
          <p className="text-xs text-slate-600">Gerencie setores, fazendas próprias, arrendadas e parceiras</p>
        </div>
        <Button 
          onClick={() => { resetForm(); setShowForm(true); }} 
          size="sm" 
          className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700"
        >
          <Plus className="w-3.5 h-3.5" />
          Novo Setor
        </Button>
      </div>

      {/* Formulário */}
      {showForm && (
        <Card className="shadow-lg border-slate-200">
          <CardHeader className="bg-slate-50 border-b py-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              {editando ? 'Editar Setor' : 'Novo Setor'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs font-medium">Nome do Setor/Fazenda *</Label>
                  <Input
                    value={formData.nome}
                    onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                    placeholder="Ex: Fazenda Santa Maria"
                    className="h-9 text-sm"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Sigla</Label>
                  <Input
                    value={formData.sigla}
                    onChange={(e) => setFormData({ ...formData, sigla: e.target.value.toUpperCase() })}
                    placeholder="Ex: FSM"
                    className="h-9 text-sm"
                    maxLength={10}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Tipo *</Label>
                  <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_SETOR.map(t => (
                        <SelectItem key={t.value} value={t.value} className="text-sm">
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Responsável</Label>
                  <Input
                    value={formData.responsavel}
                    onChange={(e) => setFormData({ ...formData, responsavel: e.target.value })}
                    placeholder="Nome do responsável"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Telefone</Label>
                  <Input
                    value={formData.telefone}
                    onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                    placeholder="(00) 00000-0000"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Área Total (ha)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.area_total}
                    onChange={(e) => setFormData({ ...formData, area_total: e.target.value })}
                    placeholder="0,00"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Capacidade (animais)</Label>
                  <Input
                    type="number"
                    value={formData.capacidade_animais}
                    onChange={(e) => setFormData({ ...formData, capacidade_animais: e.target.value })}
                    placeholder="0"
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-xs font-medium">Endereço</Label>
                  <Input
                    value={formData.endereco}
                    onChange={(e) => setFormData({ ...formData, endereco: e.target.value })}
                    placeholder="Endereço completo"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Cidade</Label>
                  <Input
                    value={formData.cidade}
                    onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
                    placeholder="Cidade"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Estado</Label>
                  <Select value={formData.estado} onValueChange={(v) => setFormData({ ...formData, estado: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="UF" />
                    </SelectTrigger>
                    <SelectContent>
                      {ESTADOS_BR.map(uf => (
                        <SelectItem key={uf} value={uf} className="text-sm">{uf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Observações</Label>
                  <Textarea
                    value={formData.observacoes}
                    onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                    placeholder="Observações gerais..."
                    className="text-sm"
                    rows={2}
                  />
                </div>
                <div className="flex items-center gap-3 pt-4">
                  <Switch
                    checked={formData.ativo}
                    onCheckedChange={(v) => setFormData({ ...formData, ativo: v })}
                  />
                  <Label className="text-xs font-medium">Setor Ativo</Label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="outline" onClick={resetForm} size="sm" className="h-8 text-xs">
                  <X className="w-3.5 h-3.5 mr-1" />
                  Cancelar
                </Button>
                <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                  <Save className="w-3.5 h-3.5 mr-1" />
                  {editando ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Lista de Setores */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="bg-white border-b py-2 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Setores ({setores.length})</CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input 
                placeholder="Buscar..." 
                value={searchTerm} 
                onChange={(e) => setSearchTerm(e.target.value)} 
                className="pl-9 h-8 w-48 text-xs" 
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs font-semibold w-8"></TableHead>
                  <TableHead className="text-xs font-semibold">Sigla</TableHead>
                  <TableHead className="text-xs font-semibold">Nome</TableHead>
                  <TableHead className="text-xs font-semibold">Tipo</TableHead>
                  <TableHead className="text-xs font-semibold">Responsável</TableHead>
                  <TableHead className="text-xs font-semibold">Cidade/UF</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Área (ha)</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Capacidade</TableHead>
                  <TableHead className="text-xs font-semibold text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-slate-400 text-xs">Carregando...</TableCell>
                  </TableRow>
                ) : filteredSetores.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-slate-400 text-xs">
                      Nenhum setor cadastrado
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSetores.map((setor) => (
                    <TableRow key={setor.id} className="hover:bg-slate-50">
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <MoreVertical className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => handleEdit(setor)} className="text-xs">
                              <Edit2 className="w-3 h-3 mr-2" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              onClick={() => { setDeletarId(setor.id); setShowDelete(true); }} 
                              className="text-xs text-red-600"
                            >
                              <Trash2 className="w-3 h-3 mr-2" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      <TableCell className="text-xs font-mono font-semibold text-blue-700">{setor.sigla || '-'}</TableCell>
                      <TableCell className="text-xs font-medium">{setor.nome}</TableCell>
                      <TableCell>{getTipoBadge(setor.tipo)}</TableCell>
                      <TableCell className="text-xs">{setor.responsavel || '-'}</TableCell>
                      <TableCell className="text-xs">
                        {setor.cidade && setor.estado ? `${setor.cidade}/${setor.estado}` : setor.cidade || setor.estado || '-'}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        {setor.area_total ? setor.area_total.toLocaleString('pt-BR') : '-'}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        {setor.capacidade_animais ? setor.capacidade_animais.toLocaleString('pt-BR') : '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={setor.ativo !== false ? "default" : "secondary"} className="text-[10px]">
                          {setor.ativo !== false ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog Confirmar Exclusão */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Confirmar Exclusão</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Tem certeza que deseja excluir este setor? Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowDelete(false)} variant="outline" size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button 
                onClick={() => deleteMutation.mutate(deletarId)} 
                size="sm" 
                className="h-8 text-xs bg-red-600 hover:bg-red-700"
              >
                Excluir
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}