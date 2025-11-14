
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Plus, Search, Edit, Trash2, Database, Loader2, X, Download, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export default function GerenciarCidades() {
  const [showForm, setShowForm] = useState(false);
  const [editingCidade, setEditingCidade] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState("");
  const [showImportar, setShowImportar] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [progresso, setProgresso] = useState({ total: 0, processado: 0 });
  const [concluido, setConcluido] = useState(false);

  const [formData, setFormData] = useState({
    nome: "",
    estado: "",
    codigo_ibge: ""
  });

  const queryClient = useQueryClient();

  const { data: cidades = [], isLoading } = useQuery({
    queryKey: ['cidades_gerenciar'],
    queryFn: () => base44.entities.Cidade.list('nome'),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      // Verificar se código IBGE já existe
      const existente = cidades.find(c => c.codigo_ibge === data.codigo_ibge);
      if (existente) {
        throw new Error('Código IBGE já cadastrado!');
      }
      return base44.entities.Cidade.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cidades_gerenciar'] });
      queryClient.invalidateQueries({ queryKey: ['cidades'] });
      setShowForm(false);
      setFormData({ nome: "", estado: "", codigo_ibge: "" });
      toast.success('Cidade cadastrada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao cadastrar');
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      // Verificar se código IBGE já existe em outra cidade
      const existente = cidades.find(c => c.codigo_ibge === data.codigo_ibge && c.id !== id);
      if (existente) {
        throw new Error('Código IBGE já cadastrado em outra cidade!');
      }
      return base44.entities.Cidade.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cidades_gerenciar'] });
      queryClient.invalidateQueries({ queryKey: ['cidades'] });
      setShowForm(false);
      setEditingCidade(null);
      setFormData({ nome: "", estado: "", codigo_ibge: "" });
      toast.success('Cidade atualizada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao atualizar');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Cidade.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cidades_gerenciar'] });
      queryClient.invalidateQueries({ queryKey: ['cidades'] });
      toast.success('Cidade excluída!');
    },
    onError: () => {
      toast.error('Erro ao excluir');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.nome || !formData.estado || !formData.codigo_ibge) {
      toast.error('Preencha todos os campos obrigatórios!');
      return;
    }

    if (formData.codigo_ibge.length !== 7) {
      toast.error('Código IBGE deve ter 7 dígitos!');
      return;
    }

    const dataToSubmit = {
      nome: formData.nome.toUpperCase(),
      estado: formData.estado,
      codigo_ibge: formData.codigo_ibge
    };

    if (editingCidade) {
      updateMutation.mutate({ id: editingCidade.id, data: dataToSubmit });
    } else {
      createMutation.mutate(dataToSubmit);
    }
  };

  const handleEdit = (cidade) => {
    setEditingCidade(cidade);
    setFormData({
      nome: cidade.nome,
      estado: cidade.estado,
      codigo_ibge: cidade.codigo_ibge
    });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Deseja realmente excluir esta cidade?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleNovo = () => {
    setEditingCidade(null);
    setFormData({ nome: "", estado: "", codigo_ibge: "" });
    setShowForm(true);
  };

  const handleCancelar = () => {
    setShowForm(false);
    setEditingCidade(null);
    setFormData({ nome: "", estado: "", codigo_ibge: "" });
  };

  const popularCidades = async () => {
    setProcessando(true);
    setConcluido(false);
    
    try {
      toast.info('Buscando cidades do IBGE...');
      
      const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios');
      const data = await response.json();
      
      setProgresso({ total: data.length, processado: 0 });
      
      const cidadesExistentes = await base44.entities.Cidade.list();
      const codigosExistentes = new Set(cidadesExistentes.map(c => c.codigo_ibge));
      
      const cidadesParaInserir = data
        .filter(c => !codigosExistentes.has(String(c.id)))
        .map(c => ({
          nome: c.nome,
          estado: c.microrregiao.mesorregiao.UF.sigla,
          codigo_ibge: String(c.id)
        }));
      
      if (cidadesParaInserir.length === 0) {
        toast.info('Todas as cidades já estão cadastradas!');
        setProcessando(false);
        setConcluido(true);
        return;
      }

      toast.info(`${cidadesParaInserir.length} cidades para importar...`);

      // Inserir uma por uma com retry
      let totalImportadas = 0;
      let erros = 0;
      
      for (let i = 0; i < cidadesParaInserir.length; i++) {
        const cidade = cidadesParaInserir[i];
        let tentativas = 0;
        let sucesso = false;
        
        while (tentativas < 3 && !sucesso) {
          try {
            await base44.entities.Cidade.create(cidade);
            totalImportadas++;
            sucesso = true;
          } catch (error) {
            tentativas++;
            if (tentativas < 3) {
              await new Promise(resolve => setTimeout(resolve, 500 * tentativas));
            } else {
              console.error(`Erro ao importar ${cidade.nome}:`, error);
              erros++;
            }
          }
        }
        
        setProgresso({ total: cidadesParaInserir.length, processado: i + 1 });
        
        // Atualizar cache a cada 100 cidades
        if ((i + 1) % 100 === 0) {
          queryClient.invalidateQueries({ queryKey: ['cidades_gerenciar'] });
          queryClient.invalidateQueries({ queryKey: ['cidades'] });
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          // Delay pequeno entre cada inserção
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      queryClient.invalidateQueries({ queryKey: ['cidades_gerenciar'] });
      queryClient.invalidateQueries({ queryKey: ['cidades'] });
      setConcluido(true);
      
      if (erros > 0) {
        toast.success(`✅ ${totalImportadas} cidades importadas! (${erros} erros)`);
      } else {
        toast.success(`✅ ${totalImportadas} cidades importadas com sucesso!`);
      }
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao importar: ' + error.message);
    } finally {
      setProcessando(false);
    }
  };

  const cidadesFiltradas = cidades.filter(c => {
    const matchNome = !searchTerm || c.nome?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchEstado = !estadoFiltro || c.estado === estadoFiltro;
    return matchNome && matchEstado;
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Gerenciar Cidades</h1>
          <p className="text-sm text-slate-600">Cadastro de cidades brasileiras com código IBGE</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowImportar(true)} variant="outline" size="sm" className="h-9 gap-1.5">
            <Database className="w-4 h-4" />
            Importar IBGE
          </Button>
          <Button onClick={handleNovo} size="sm" className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4" />
            Nova Cidade
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-lg border-slate-300">
              <CardHeader className="bg-gradient-to-r from-emerald-50 to-green-50 border-b border-slate-200 py-3 px-4">
                <CardTitle className="text-sm font-semibold">
                  {editingCidade ? 'Editar Cidade' : 'Nova Cidade'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Estado *</Label>
                      <Select value={formData.estado} onValueChange={(v) => setFormData({ ...formData, estado: v })}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'].map(uf => (
                            <SelectItem key={uf} value={uf} className="text-xs">{uf}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Nome da Cidade *</Label>
                      <Input 
                        value={formData.nome} 
                        onChange={(e) => setFormData({ ...formData, nome: e.target.value })} 
                        placeholder="NOME DA CIDADE" 
                        className="h-8 text-xs uppercase" 
                        style={{ textTransform: 'uppercase' }}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Código IBGE *</Label>
                      <Input 
                        value={formData.codigo_ibge} 
                        onChange={(e) => setFormData({ ...formData, codigo_ibge: e.target.value.replace(/\D/g, '') })} 
                        placeholder="0000000" 
                        className="h-8 text-xs"
                        maxLength={7}
                        required
                      />
                      <p className="text-[10px] text-slate-500">7 dígitos obrigatórios e únicos</p>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button type="button" variant="outline" onClick={handleCancelar} size="sm" className="h-8 text-xs">
                      <X className="w-3 h-3 mr-1" />
                      Cancelar
                    </Button>
                    <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                      <Plus className="w-3 h-3 mr-1" />
                      {editingCidade ? 'Atualizar' : 'Cadastrar'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="shadow-sm border-slate-300">
        <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-sm font-semibold text-slate-900">
              Cidades Cadastradas ({cidadesFiltradas.length})
            </CardTitle>
            <div className="flex gap-2 items-center">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input 
                  placeholder="Buscar cidade..." 
                  value={searchTerm} 
                  onChange={(e) => setSearchTerm(e.target.value)} 
                  className="pl-8 h-8 w-56 text-xs" 
                />
              </div>
              <Select value={estadoFiltro} onValueChange={setEstadoFiltro}>
                <SelectTrigger className="h-8 w-24 text-xs">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null} className="text-xs">Todos</SelectItem>
                  {['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'].map(uf => (
                    <SelectItem key={uf} value={uf} className="text-xs">{uf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[600px]">
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0">
                <TableRow>
                  <TableHead className="text-xs">Código IBGE</TableHead>
                  <TableHead className="text-xs">Cidade</TableHead>
                  <TableHead className="text-xs text-center">UF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-12 text-slate-400 text-xs">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : cidadesFiltradas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-12 text-slate-400 text-xs">
                      Nenhuma cidade encontrada
                    </TableCell>
                  </TableRow>
                ) : (
                  cidadesFiltradas.map((cidade) => (
                    <ContextMenu key={cidade.id}>
                      <ContextMenuTrigger asChild>
                        <TableRow className="hover:bg-slate-50 cursor-context-menu">
                          <TableCell className="font-mono text-xs text-slate-600">{cidade.codigo_ibge}</TableCell>
                          <TableCell className="text-xs font-medium">{cidade.nome}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-xs bg-slate-100 text-slate-700">
                              {cidade.estado}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => handleEdit(cidade)} className="text-xs">
                          <Edit className="w-3 h-3 mr-2" />
                          Editar
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleDelete(cidade.id)} className="text-xs text-red-600">
                          <Trash2 className="w-3 h-3 mr-2" />
                          Excluir
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showImportar} onOpenChange={setShowImportar}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-600" />
              Importar Cidades do IBGE
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs">
              <p className="font-semibold text-blue-900 mb-2">ℹ️ Sobre esta importação</p>
              <p className="text-blue-800 mb-2">
                Esta ferramenta irá buscar <strong>todas as 5.570+ cidades brasileiras</strong> diretamente da API oficial do IBGE 
                e salvar no banco de dados.
              </p>
              <p className="text-blue-800 text-[10px]">
                ✅ Cidades já cadastradas serão ignoradas (sem duplicação)<br/>
                ✅ Apenas novas cidades serão importadas
              </p>
            </div>

            {processando && (
              <div className="bg-slate-50 border border-slate-200 rounded p-3">
                <div className="flex items-center gap-3 mb-2">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                  <span className="font-semibold text-sm">Importando...</span>
                </div>
                <div className="text-xs text-slate-600 mb-2">
                  {progresso.processado} de {progresso.total} cidades importadas
                </div>
                <Progress value={progresso.total > 0 ? (progresso.processado / progresso.total) * 100 : 0} className="h-2" />
              </div>
            )}

            {concluido && (
              <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <div>
                    <p className="font-semibold text-emerald-900 text-sm">Importação concluída!</p>
                    <p className="text-xs text-emerald-800">Todas as cidades foram importadas com sucesso.</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setShowImportar(false)} size="sm" className="h-8 text-xs">
                Fechar
              </Button>
              <Button 
                onClick={popularCidades} 
                disabled={processando}
                size="sm"
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                {processando ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                    Importando...
                  </>
                ) : (
                  <>
                    <Download className="w-3 h-3 mr-1.5" />
                    Importar do IBGE
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
