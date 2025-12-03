import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Plus, FileText, Edit, Trash2, Copy, Eye, MoreVertical, 
  GripVertical, X, Printer, Settings 
} from "lucide-react";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

const TIPOS_CAMPO = [
  { value: 'texto', label: 'Campo de Texto', icon: '📝' },
  { value: 'texto_longo', label: 'Área de Texto', icon: '📄' },
  { value: 'numero', label: 'Campo Numérico', icon: '🔢' },
  { value: 'data', label: 'Campo de Data', icon: '📅' },
  { value: 'hora', label: 'Campo de Hora', icon: '🕐' },
  { value: 'checkbox', label: 'Checkbox', icon: '☑️' },
  { value: 'selecao', label: 'Seleção (Opções)', icon: '📋' },
  { value: 'assinatura', label: 'Campo de Assinatura', icon: '✍️' },
  { value: 'separador', label: 'Linha Separadora', icon: '➖' },
  { value: 'titulo_secao', label: 'Título de Seção', icon: '📌' },
  { value: 'tabela', label: 'Tabela/Grid', icon: '📊' },
  { value: 'espaco', label: 'Espaço em Branco', icon: '⬜' },
];

const LARGURAS = [
  { value: '100%', label: 'Largura Total' },
  { value: '50%', label: 'Metade (50%)' },
  { value: '33%', label: 'Um Terço (33%)' },
  { value: '25%', label: 'Um Quarto (25%)' },
  { value: '66%', label: 'Dois Terços (66%)' },
  { value: '75%', label: 'Três Quartos (75%)' },
];

export default function FichasPersonalizadas() {
  const [showEditor, setShowEditor] = useState(false);
  const [editingFicha, setEditingFicha] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: fichas = [], isLoading } = useQuery({
    queryKey: ['fichas-personalizadas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.FichaPersonalizada.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FichaPersonalizada.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['fichas-personalizadas']);
      setShowDeleteConfirm(null);
    },
  });

  const duplicarFicha = async (ficha) => {
    const { id, created_date, updated_date, created_by, ...dados } = ficha;
    await base44.entities.FichaPersonalizada.create({
      ...dados,
      nome: `${dados.nome} (Cópia)`,
    });
    queryClient.invalidateQueries(['fichas-personalizadas']);
  };

  const novaFicha = () => {
    setEditingFicha({
      empresa_id: empresaSelecionadaId,
      nome: '',
      descricao: '',
      orientacao: 'retrato',
      mostrar_logo: true,
      mostrar_cabecalho: true,
      titulo_ficha: '',
      subtitulo_ficha: '',
      campos: [],
      rodape: '',
      mostrar_data_impressao: true,
      ativa: true,
    });
    setShowEditor(true);
  };

  const editarFicha = (ficha) => {
    setEditingFicha({ ...ficha });
    setShowEditor(true);
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Fichas Personalizadas</h1>
          <p className="text-xs text-slate-600">Crie e gerencie suas fichas e relatórios para impressão</p>
        </div>
        <Button onClick={novaFicha} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
          <Plus className="w-3.5 h-3.5" />
          Nova Ficha
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-500">Carregando...</div>
      ) : fichas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-12 h-12 mx-auto mb-4 text-slate-300" />
            <h3 className="font-semibold text-slate-700 mb-1">Nenhuma ficha criada</h3>
            <p className="text-sm text-slate-500 mb-4">Crie sua primeira ficha personalizada para impressão</p>
            <Button onClick={novaFicha} size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4" />
              Criar Ficha
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {fichas.map((ficha) => (
            <Card key={ficha.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <FileText className="w-4 h-4 text-emerald-600" />
                      {ficha.nome}
                    </CardTitle>
                    {ficha.descricao && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{ficha.descricao}</p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => editarFicha(ficha)}>
                        <Edit className="w-4 h-4 mr-2" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => duplicarFicha(ficha)}>
                        <Copy className="w-4 h-4 mr-2" />
                        Duplicar
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => setShowDeleteConfirm(ficha.id)}
                        className="text-red-600"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline" className="text-[10px]">
                    {ficha.orientacao === 'paisagem' ? 'Paisagem' : 'Retrato'}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {ficha.campos?.length || 0} campos
                  </Badge>
                  {!ficha.ativa && (
                    <Badge variant="secondary" className="text-[10px]">Inativa</Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Link to={createPageUrl(`VisualizarFicha?id=${ficha.id}`)} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1">
                      <Eye className="w-3 h-3" />
                      Visualizar
                    </Button>
                  </Link>
                  <Link to={createPageUrl(`VisualizarFicha?id=${ficha.id}&print=1`)}>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                      <Printer className="w-3 h-3" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Editor de Ficha */}
      {showEditor && editingFicha && (
        <EditorFicha
          ficha={editingFicha}
          onClose={() => { setShowEditor(false); setEditingFicha(null); }}
          onSave={() => {
            queryClient.invalidateQueries(['fichas-personalizadas']);
            setShowEditor(false);
            setEditingFicha(null);
          }}
        />
      )}

      {/* Confirmação de Exclusão */}
      <Dialog open={!!showDeleteConfirm} onOpenChange={() => setShowDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir Ficha</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">Tem certeza que deseja excluir esta ficha? Esta ação não pode ser desfeita.</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowDeleteConfirm(null)} size="sm">Cancelar</Button>
            <Button 
              variant="destructive" 
              onClick={() => deleteMutation.mutate(showDeleteConfirm)}
              disabled={deleteMutation.isPending}
              size="sm"
            >
              Excluir
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditorFicha({ ficha, onClose, onSave }) {
  const [dados, setDados] = useState(ficha);
  const [saving, setSaving] = useState(false);
  const [showAddCampo, setShowAddCampo] = useState(false);
  const [editingCampo, setEditingCampo] = useState(null);

  const salvar = async () => {
    setSaving(true);
    try {
      if (dados.id) {
        const { id, created_date, updated_date, created_by, ...updateData } = dados;
        await base44.entities.FichaPersonalizada.update(id, updateData);
      } else {
        await base44.entities.FichaPersonalizada.create(dados);
      }
      onSave();
    } catch (error) {
      console.error('Erro ao salvar:', error);
      alert('Erro ao salvar ficha');
    } finally {
      setSaving(false);
    }
  };

  const adicionarCampo = (tipo) => {
    const novoCampo = {
      id: `campo_${Date.now()}`,
      tipo,
      label: TIPOS_CAMPO.find(t => t.value === tipo)?.label || 'Campo',
      largura: '100%',
      altura: tipo === 'texto_longo' ? 3 : tipo === 'assinatura' ? 2 : 1,
      obrigatorio: false,
      opcoes: tipo === 'selecao' ? ['Opção 1', 'Opção 2'] : [],
      colunas: tipo === 'tabela' ? 3 : 1,
      linhas: tipo === 'tabela' ? 5 : 1,
    };
    setDados({ ...dados, campos: [...(dados.campos || []), novoCampo] });
    setShowAddCampo(false);
  };

  const atualizarCampo = (index, campo) => {
    const novosCampos = [...dados.campos];
    novosCampos[index] = campo;
    setDados({ ...dados, campos: novosCampos });
  };

  const removerCampo = (index) => {
    const novosCampos = dados.campos.filter((_, i) => i !== index);
    setDados({ ...dados, campos: novosCampos });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(dados.campos);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setDados({ ...dados, campos: items });
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-sm">
            {dados.id ? 'Editar Ficha' : 'Nova Ficha'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
            {/* Configurações Gerais */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm text-slate-700 flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Configurações Gerais
              </h3>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Nome da Ficha *</Label>
                  <Input
                    value={dados.nome}
                    onChange={(e) => setDados({ ...dados, nome: e.target.value })}
                    placeholder="Ex: Ficha de Abastecimento"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Descrição</Label>
                  <Input
                    value={dados.descricao || ''}
                    onChange={(e) => setDados({ ...dados, descricao: e.target.value })}
                    placeholder="Descrição opcional"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Título na Ficha *</Label>
                  <Input
                    value={dados.titulo_ficha}
                    onChange={(e) => setDados({ ...dados, titulo_ficha: e.target.value })}
                    placeholder="Título que aparece na impressão"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Subtítulo</Label>
                  <Input
                    value={dados.subtitulo_ficha || ''}
                    onChange={(e) => setDados({ ...dados, subtitulo_ficha: e.target.value })}
                    placeholder="Subtítulo opcional"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Orientação</Label>
                  <Select value={dados.orientacao} onValueChange={(v) => setDados({ ...dados, orientacao: v })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="retrato">Retrato</SelectItem>
                      <SelectItem value="paisagem">Paisagem</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <Switch
                    checked={dados.ativa}
                    onCheckedChange={(v) => setDados({ ...dados, ativa: v })}
                  />
                  <Label className="text-xs">Ficha Ativa</Label>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Mostrar Logo</Label>
                  <Switch
                    checked={dados.mostrar_logo}
                    onCheckedChange={(v) => setDados({ ...dados, mostrar_logo: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Mostrar Cabeçalho Empresa</Label>
                  <Switch
                    checked={dados.mostrar_cabecalho}
                    onCheckedChange={(v) => setDados({ ...dados, mostrar_cabecalho: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Mostrar Data de Impressão</Label>
                  <Switch
                    checked={dados.mostrar_data_impressao}
                    onCheckedChange={(v) => setDados({ ...dados, mostrar_data_impressao: v })}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Rodapé</Label>
                <Textarea
                  value={dados.rodape || ''}
                  onChange={(e) => setDados({ ...dados, rodape: e.target.value })}
                  placeholder="Texto do rodapé (opcional)"
                  className="text-xs h-16"
                />
              </div>
            </div>

            {/* Campos da Ficha */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-slate-700">Campos da Ficha</h3>
                <Button 
                  size="sm" 
                  onClick={() => setShowAddCampo(true)}
                  className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                >
                  <Plus className="w-3 h-3" />
                  Adicionar Campo
                </Button>
              </div>

              {dados.campos?.length === 0 ? (
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center">
                  <p className="text-xs text-slate-500">Nenhum campo adicionado</p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setShowAddCampo(true)}
                    className="mt-2 h-7 text-xs"
                  >
                    Adicionar Primeiro Campo
                  </Button>
                </div>
              ) : (
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId="campos">
                    {(provided) => (
                      <div 
                        {...provided.droppableProps} 
                        ref={provided.innerRef}
                        className="space-y-2 max-h-[400px] overflow-auto"
                      >
                        {dados.campos.map((campo, index) => (
                          <Draggable key={campo.id} draggableId={campo.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={`flex items-center gap-2 p-2 border rounded-lg text-xs ${
                                  snapshot.isDragging ? 'bg-emerald-50 border-emerald-300' : 'bg-white'
                                }`}
                              >
                                <div {...provided.dragHandleProps}>
                                  <GripVertical className="w-4 h-4 text-slate-400" />
                                </div>
                                <span className="text-base">
                                  {TIPOS_CAMPO.find(t => t.value === campo.tipo)?.icon}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium truncate">{campo.label}</p>
                                  <p className="text-[10px] text-slate-500">
                                    {TIPOS_CAMPO.find(t => t.value === campo.tipo)?.label} • {campo.largura}
                                  </p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => setEditingCampo({ campo, index })}
                                >
                                  <Edit className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-red-500 hover:text-red-700"
                                  onClick={() => removerCampo(index)}
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t">
          <Button variant="outline" onClick={onClose} size="sm" className="h-8 text-xs">
            Cancelar
          </Button>
          <Button 
            onClick={salvar} 
            disabled={saving || !dados.nome || !dados.titulo_ficha}
            size="sm" 
            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
          >
            {saving ? 'Salvando...' : 'Salvar Ficha'}
          </Button>
        </div>

        {/* Modal Adicionar Campo */}
        <Dialog open={showAddCampo} onOpenChange={setShowAddCampo}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm">Adicionar Campo</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              {TIPOS_CAMPO.map((tipo) => (
                <Button
                  key={tipo.value}
                  variant="outline"
                  className="h-auto py-3 flex flex-col items-center gap-1 text-xs"
                  onClick={() => adicionarCampo(tipo.value)}
                >
                  <span className="text-xl">{tipo.icon}</span>
                  <span>{tipo.label}</span>
                </Button>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Modal Editar Campo */}
        {editingCampo && (
          <Dialog open={true} onOpenChange={() => setEditingCampo(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="text-sm">Editar Campo</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Rótulo/Label</Label>
                  <Input
                    value={editingCampo.campo.label}
                    onChange={(e) => setEditingCampo({
                      ...editingCampo,
                      campo: { ...editingCampo.campo, label: e.target.value }
                    })}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Largura</Label>
                  <Select 
                    value={editingCampo.campo.largura} 
                    onValueChange={(v) => setEditingCampo({
                      ...editingCampo,
                      campo: { ...editingCampo.campo, largura: v }
                    })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LARGURAS.map((l) => (
                        <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {['texto_longo', 'assinatura', 'espaco'].includes(editingCampo.campo.tipo) && (
                  <div>
                    <Label className="text-xs">Altura (linhas)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={editingCampo.campo.altura}
                      onChange={(e) => setEditingCampo({
                        ...editingCampo,
                        campo: { ...editingCampo.campo, altura: parseInt(e.target.value) || 1 }
                      })}
                      className="h-8 text-xs"
                    />
                  </div>
                )}
                {editingCampo.campo.tipo === 'tabela' && (
                  <>
                    <div>
                      <Label className="text-xs">Número de Colunas</Label>
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={editingCampo.campo.colunas}
                        onChange={(e) => setEditingCampo({
                          ...editingCampo,
                          campo: { ...editingCampo.campo, colunas: parseInt(e.target.value) || 1 }
                        })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Número de Linhas</Label>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={editingCampo.campo.linhas}
                        onChange={(e) => setEditingCampo({
                          ...editingCampo,
                          campo: { ...editingCampo.campo, linhas: parseInt(e.target.value) || 1 }
                        })}
                        className="h-8 text-xs"
                      />
                    </div>
                  </>
                )}
                {editingCampo.campo.tipo === 'selecao' && (
                  <div>
                    <Label className="text-xs">Opções (uma por linha)</Label>
                    <Textarea
                      value={(editingCampo.campo.opcoes || []).join('\n')}
                      onChange={(e) => setEditingCampo({
                        ...editingCampo,
                        campo: { ...editingCampo.campo, opcoes: e.target.value.split('\n').filter(o => o.trim()) }
                      })}
                      className="text-xs h-20"
                      placeholder="Opção 1&#10;Opção 2&#10;Opção 3"
                    />
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setEditingCampo(null)} size="sm" className="h-7 text-xs">
                  Cancelar
                </Button>
                <Button 
                  onClick={() => {
                    atualizarCampo(editingCampo.index, editingCampo.campo);
                    setEditingCampo(null);
                  }}
                  size="sm" 
                  className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                >
                  Salvar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}