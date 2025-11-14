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
import { Plus, Search, Edit, Trash2, Upload, Loader2, X, Download, CheckCircle, AlertCircle } from "lucide-react";
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
  const [progresso, setProgresso] = useState({ total: 0, processado: 0, erros: 0 });
  const [errosImportacao, setErrosImportacao] = useState([]);
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

  const handleImportarExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setProcessando(true);
    setConcluido(false);
    setErrosImportacao([]);
    setShowImportar(true);

    try {
      const text = await file.text();
      const linhas = text.split('\n').map(l => l.trim()).filter(l => l);
      
      if (linhas.length === 0) {
        throw new Error('Arquivo vazio!');
      }

      const cabecalho = linhas[0].split(/[;,\t]/);
      const dados = linhas.slice(1);

      const idxNome = cabecalho.findIndex(h => /nome|cidade/i.test(h));
      const idxEstado = cabecalho.findIndex(h => /estado|uf/i.test(h));
      const idxCodigo = cabecalho.findIndex(h => /codigo|ibge/i.test(h));

      if (idxNome === -1 || idxEstado === -1 || idxCodigo === -1) {
        throw new Error('Planilha deve ter as colunas: Nome, Estado, Codigo_IBGE');
      }

      setProgresso({ total: dados.length, processado: 0, erros: 0 });

      const cidadesExistentes = await base44.entities.Cidade.list();
      const codigosExistentes = new Set(cidadesExistentes.map(c => c.codigo_ibge));

      let totalImportadas = 0;
      const erros = [];

      for (let i = 0; i < dados.length; i++) {
        const linha = dados[i];
        const colunas = linha.split(/[;,\t]/);

        const nome = colunas[idxNome]?.trim().toUpperCase();
        const estado = colunas[idxEstado]?.trim().toUpperCase();
        const codigo_ibge = colunas[idxCodigo]?.trim();

        if (!nome || !estado || !codigo_ibge) {
          erros.push({ linha: i + 2, erro: 'Dados incompletos', dados: { nome, estado, codigo_ibge } });
          setProgresso(prev => ({ ...prev, processado: i + 1, erros: prev.erros + 1 }));
          continue;
        }

        if (codigo_ibge.length !== 7) {
          erros.push({ linha: i + 2, erro: 'Código IBGE deve ter 7 dígitos', dados: { nome, estado, codigo_ibge } });
          setProgresso(prev => ({ ...prev, processado: i + 1, erros: prev.erros + 1 }));
          continue;
        }

        // Ignorar se já existe
        if (codigosExistentes.has(codigo_ibge)) {
          setProgresso(prev => ({ ...prev, processado: i + 1 }));
          continue;
        }

        try {
          await base44.entities.Cidade.create({ nome, estado, codigo_ibge });
          codigosExistentes.add(codigo_ibge);
          totalImportadas++;
          setProgresso(prev => ({ ...prev, processado: i + 1 }));
          await new Promise(resolve => setTimeout(resolve, 30));
        } catch (error) {
          erros.push({ linha: i + 2, erro: error.message || 'Erro ao cadastrar', dados: { nome, estado, codigo_ibge } });
          setProgresso(prev => ({ ...prev, processado: i + 1, erros: prev.erros + 1 }));
        }
      }

      queryClient.invalidateQueries({ queryKey: ['cidades_gerenciar'] });
      queryClient.invalidateQueries({ queryKey: ['cidades'] });
      setErrosImportacao(erros);
      setConcluido(true);

      if (erros.length > 0) {
        toast.success(`✅ ${totalImportadas} cidades importadas! (${erros.length} erros)`);
      } else {
        toast.success(`✅ ${totalImportadas} cidades importadas com sucesso!`);
      }
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao processar arquivo: ' + error.message);
      setProcessando(false);
      setShowImportar(false);
    } finally {
      setProcessando(false);
      e.target.value = '';
    }
  };

  const baixarModelo = () => {
    const csv = 'Nome;Estado;Codigo_IBGE\nCUIABÁ;MT;5103403\nVÁRZEA GRANDE;MT;5108402\nRONDONÓPOLIS;MT;5107602';
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_cidades.csv';
    link.click();
    toast.success('Modelo baixado!');
  };

  const baixarRelatorioErros = () => {
    if (errosImportacao.length === 0) return;
    
    const linhas = ['Linha;Erro;Nome;Estado;Codigo_IBGE'];
    errosImportacao.forEach(e => {
      linhas.push(`${e.linha};${e.erro};${e.dados.nome || ''};${e.dados.estado || ''};${e.dados.codigo_ibge || ''}`);
    });
    
    const csv = linhas.join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `erros_importacao_cidades_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    toast.success('Relatório de erros baixado!');
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
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleImportarExcel}
            style={{ display: 'none' }}
            id="upload-cidades"
          />
          <Button 
            onClick={() => document.getElementById('upload-cidades').click()} 
            variant="outline" 
            size="sm" 
            className="h-9 gap-1.5"
          >
            <Upload className="w-4 h-4" />
            Importar Excel
          </Button>
          <Button onClick={baixarModelo} variant="outline" size="sm" className="h-9 gap-1.5">
            <Download className="w-4 h-4" />
            Baixar Modelo
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

      <Dialog open={showImportar} onOpenChange={(open) => !processando && setShowImportar(open)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Upload className="w-4 h-4 text-emerald-600" />
              Importar Cidades do Excel
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs">
              <p className="font-semibold text-blue-900 mb-2">ℹ️ Como importar</p>
              <p className="text-blue-800 mb-2">
                1. Baixe o modelo de planilha<br/>
                2. Preencha com: <strong>Nome</strong>, <strong>Estado</strong> e <strong>Codigo_IBGE</strong><br/>
                3. Faça upload do arquivo (CSV, XLS ou XLSX)
              </p>
              <p className="text-blue-800 text-[10px]">
                ✅ Códigos IBGE duplicados serão ignorados automaticamente
              </p>
            </div>

            {processando && (
              <div className="bg-slate-50 border border-slate-200 rounded p-3">
                <div className="flex items-center gap-3 mb-2">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                  <span className="font-semibold text-sm">Importando...</span>
                </div>
                <div className="text-xs text-slate-600 mb-2">
                  {progresso.processado} de {progresso.total} processadas
                  {progresso.erros > 0 && <span className="text-red-600"> • {progresso.erros} erros</span>}
                </div>
                <Progress value={progresso.total > 0 ? (progresso.processado / progresso.total) * 100 : 0} className="h-2" />
              </div>
            )}

            {concluido && (
              <div className={`border rounded p-3 ${errosImportacao.length > 0 ? 'bg-orange-50 border-orange-200' : 'bg-emerald-50 border-emerald-200'}`}>
                <div className="flex items-center gap-3">
                  {errosImportacao.length > 0 ? (
                    <AlertCircle className="w-5 h-5 text-orange-600" />
                  ) : (
                    <CheckCircle className="w-5 h-5 text-emerald-600" />
                  )}
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{errosImportacao.length > 0 ? 'Importação concluída com erros' : 'Importação concluída!'}</p>
                    <p className="text-xs">
                      {progresso.total - progresso.erros} cidades importadas
                      {errosImportacao.length > 0 && ` • ${errosImportacao.length} erros`}
                    </p>
                  </div>
                  {errosImportacao.length > 0 && (
                    <Button onClick={baixarRelatorioErros} variant="outline" size="sm" className="h-7 text-xs">
                      <Download className="w-3 h-3 mr-1" />
                      Baixar Erros
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setShowImportar(false)} size="sm" className="h-8 text-xs" disabled={processando}>
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}