
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Users, Building2, UserCircle, Download, Upload, FileSpreadsheet, Loader2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

import FormularioFornecedor from "../components/fornecedores/FormularioFornecedor";
import TabelaFornecedores from "../components/fornecedores/TabelaFornecedores";
import FichaFornecedor from "../components/fornecedores/FichaFornecedor";

// Função global para obter próximo número único do sistema
async function getNextSystemNumber() {
  try {
    const [pesagens, fornecedores, produtos] = await Promise.all([
      base44.entities.Pesagem.list(),
      base44.entities.Fornecedor.list(),
      base44.entities.Produto.list()
    ]);

    const numeros = [
      ...pesagens.map(p => parseInt(p.numero_registro, 10)).filter(n => !isNaN(n)),
      ...fornecedores.map(f => parseInt(f.numero_cadastro, 10)).filter(n => !isNaN(n)),
      ...produtos.map(p => parseInt(p.numero_produto, 10)).filter(n => !isNaN(n))
    ];

    const positiveNumbers = numeros.filter(n => n > 0);

    return positiveNumbers.length > 0 ? Math.max(...positiveNumbers) + 1 : 1;
  } catch (error) {
    console.error("Erro ao buscar números existentes:", error);
    // Fallback: If cannot fetch, return a timestamp for uniqueness, though not sequential
    return Date.now(); 
  }
}

export default function Fornecedores() {
  const [showForm, setShowForm] = useState(false);
  const [editingFornecedor, setEditingFornecedor] = useState(null);
  const [fichaFornecedor, setFichaFornecedor] = useState(null);
  const [showImportProgress, setShowImportProgress] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, errors: 0 });

  const queryClient = useQueryClient();

  // Pegar empresa selecionada
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: fornecedores, isLoading } = useQuery({
    queryKey: ['fornecedores', empresaSelecionadaId],
    queryFn: async () => {
      const allFornecedores = await base44.entities.Fornecedor.list('-created_date');
      // Filtrar apenas fornecedores da empresa selecionada
      return allFornecedores.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    initialData: [],
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      // Validar se já existe fornecedor com mesmo nome
      const existente = fornecedores.find(f => 
        f.nome.toUpperCase().trim() === data.nome.toUpperCase().trim() && 
        (!editingFornecedor || f.id !== editingFornecedor.id)
      );
      
      if (existente) {
        throw new Error('Já existe um fornecedor/cliente cadastrado com este nome.');
      }
      
      return base44.entities.Fornecedor.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      setShowForm(false);
      setEditingFornecedor(null);
      toast.success('Fornecedor/Cliente cadastrado com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao salvar. Tente novamente.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      // Validar se já existe fornecedor com mesmo nome
      const existente = fornecedores.find(f => 
        f.nome.toUpperCase().trim() === data.nome.toUpperCase().trim() && 
        f.id !== id
      );
      
      if (existente) {
        throw new Error('Já existe um fornecedor/cliente cadastrado com este nome.');
      }
      
      return base44.entities.Fornecedor.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      setShowForm(false);
      setEditingFornecedor(null);
      toast.success('Fornecedor/Cliente atualizado com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao atualizar. Tente novamente.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Fornecedor.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      toast.success('Fornecedor/Cliente excluído com sucesso!');
    },
    onError: (error) => {
      console.error("Erro ao excluir fornecedor:", error);
      toast.error('Erro ao excluir fornecedor/cliente. Tente novamente.');
    }
  });

  // Numerar cadastros existentes automaticamente
  useEffect(() => {
    const numerarCadastrosExistentes = async () => {
      const cadastrosSemNumero = fornecedores.filter(f => !f.numero_cadastro);
      
      if (cadastrosSemNumero.length > 0) {
        console.log(`[Fornecedores] Numerando ${cadastrosSemNumero.length} cadastros sem número...`);
        
        // Iterate and update each record sequentially to ensure unique numbering for each
        for (const fornecedor of cadastrosSemNumero) {
          try {
            const proximoNumero = await getNextSystemNumber();
            await base44.entities.Fornecedor.update(fornecedor.id, {
              ...fornecedor, // Spread existing data to ensure full object update
              numero_cadastro: String(proximoNumero)
            });
          } catch (error) {
            console.error(`Erro ao numerar cadastro ${fornecedor.id}:`, error);
          }
        }
        
        queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
        toast.success(`Fornecedores sem número cadastral foram numerados automaticamente.`);
      }
    };

    // Trigger numbering only if `fornecedores` array is loaded and not empty
    if (fornecedores && fornecedores.length > 0) {
      numerarCadastrosExistentes();
    }
  }, [fornecedores, queryClient]); // Dependencies: re-run if fornecedores data changes or queryClient instance changes

  const handleSubmit = async (data) => {
    // Adicionar empresa_id aos dados
    data.empresa_id = empresaSelecionadaId;
    
    // Gerar número único se for novo cadastro
    if (!editingFornecedor) {
      const proximoNumero = await getNextSystemNumber();
      data.numero_cadastro = String(proximoNumero);
    }
    
    if (editingFornecedor) {
      updateMutation.mutate({ id: editingFornecedor.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (fornecedor) => {
    setEditingFornecedor(fornecedor);
    setShowForm(true);
  };

  const handleDelete = (id, skipConfirm = false) => {
    if (skipConfirm || window.confirm('⚠️ ATENÇÃO: Deseja realmente excluir este fornecedor/cliente? Esta ação não pode ser desfeita.')) {
      return deleteMutation.mutateAsync(id);
    }
    return Promise.reject('Cancelado');
  };

  const handlePrint = (fornecedor) => {
    setFichaFornecedor(fornecedor);
  };

  const handleNew = () => {
    setEditingFornecedor(null);
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingFornecedor(null);
  };

  const handleExport = () => {
    const csvRows = [];
    const headers = ['Tipo', 'Nome', 'CPF', 'RG', 'Data Nascimento', 'CNPJ', 'Razão Social', 'Inscrição Estadual', 'Responsável', 'Telefone', 'Email', 'Endereço', 'Cidade', 'Estado', 'CEP', 'Observações'];
    csvRows.push(headers.join(';'));

    fornecedores.forEach(f => {
      const row = [
        f.tipo_pessoa,
        f.nome,
        f.cpf || '',
        f.rg || '',
        f.data_nascimento || '',
        f.cnpj || '',
        f.razao_social || '',
        f.inscricao_estadual || '',
        f.nome_responsavel || '',
        f.telefone || '',
        f.email || '',
        f.endereco || '',
        f.cidade || '',
        f.estado || '',
        f.cep || '',
        f.observacoes || ''
      ];
      csvRows.push(row.join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `fornecedores_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
    link.click();
    toast.success('Dados exportados com sucesso!');
  };

  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length <= 1) { // includes header line
          toast.error('O arquivo está vazio!');
          setShowImportProgress(false); // Ensure progress dialog is closed
          return;
        }

        setShowImportProgress(true);
        setImportProgress({ current: 0, total: lines.length - 1, errors: 0 }); // Total records to process, excluding header

        // CORREÇÃO: Buscar o maior número UMA VEZ antes do loop
        let proximoNumero = await getNextSystemNumber();

        const headers = lines[0].split(';');
        const headerMap = {
          'Tipo': 'tipo_pessoa',
          'Nome': 'nome',
          'CPF': 'cpf',
          'RG': 'rg',
          'Data Nascimento': 'data_nascimento',
          'CNPJ': 'cnpj',
          'Razão Social': 'razao_social',
          'Inscrição Estadual': 'inscricao_estadual',
          'Responsável': 'nome_responsavel',
          'Telefone': 'telefone',
          'Email': 'email',
          'Endereço': 'endereco',
          'Cidade': 'cidade',
          'Estado': 'estado',
          'CEP': 'cep',
          'Observações': 'observacoes',
        };

        const validRecords = [];
        let errorCount = 0;

        for (let i = 1; i < lines.length; i++) { // Start from second line (data)
          const values = lines[i].split(';');
          
          let fornecedor = {};
          for (let j = 0; j < headers.length; j++) {
            const propName = headerMap[headers[j]?.trim()];
            if (propName && values[j]) {
              fornecedor[propName] = values[j]?.trim();
            }
          }

          try {
            if (!fornecedor.nome || !fornecedor.tipo_pessoa) {
              throw new Error("Dados inválidos");
            }
            
            fornecedor.numero_cadastro = String(proximoNumero);
            proximoNumero++; // Incrementar localmente
            fornecedor.empresa_id = empresaSelecionadaId; // Assign current company ID
            
            validRecords.push(fornecedor);
          } catch (err) {
            console.error(`Erro na linha ${i + 1}:`, err.message);
            errorCount++;
          }
        }

        if (validRecords.length === 0) {
          setShowImportProgress(false);
          toast.error('Nenhum registro válido encontrado!');
          return;
        }

        let imported = 0;
        let errorsInImport = 0;

        for (const record of validRecords) {
          try {
            await base44.entities.Fornecedor.create(record);
            imported++;
            setImportProgress({ current: imported, total: validRecords.length, errors: errorCount + errorsInImport });
            await new Promise(resolve => setTimeout(resolve, 50)); // Small delay for UI update
          } catch (error) {
            errorsInImport++;
            console.error(`Erro ao importar registro:`, error);
            setImportProgress({ current: imported, total: validRecords.length, errors: errorCount + errorsInImport });
          }
        }

        await queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
        
        setTimeout(() => {
          setShowImportProgress(false);
          const totalErrors = errorCount + errorsInImport;
          if (totalErrors > 0) {
            toast.warning(`${imported} registros importados! ${totalErrors} com erro.`);
          } else {
            toast.success(`${imported} registros importados com sucesso!`);
          }
        }, 1000);

      } catch (error) {
        console.error('Erro geral ao importar:', error);
        setShowImportProgress(false);
        toast.error('Erro ao importar. Verifique o arquivo.');
      }
    };
    reader.readAsText(file, 'UTF-8'); // Specify UTF-8 encoding
    event.target.value = ''; // Clear file input
  };

  const downloadTemplate = () => {
    const csvRows = [];
    const headers = ['Tipo', 'Nome', 'CPF', 'RG', 'Data Nascimento', 'CNPJ', 'Razão Social', 'Inscrição Estadual', 'Responsável', 'Telefone', 'Email', 'Endereço', 'Cidade', 'Estado', 'CEP', 'Observações'];
    csvRows.push(headers.join(';'));
    
    const example = ['Física', 'EXEMPLO FORNECEDOR', '000.000.000-00', '00.000.000-0', '01/01/1990', '', '', '', '', '(00) 00000-0000', 'exemplo@email.com', 'RUA EXEMPLO, 123', 'VILA BELA', 'MT', '00000-000', 'EXEMPLO DE FORNECEDOR'];
    csvRows.push(example.join(';'));

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_fornecedores.csv';
    link.click();
  };

  const totalFornecedores = fornecedores.length;
  const pessoasFisicas = fornecedores.filter(f => f.tipo_pessoa === 'Física').length;
  const pessoasJuridicas = fornecedores.filter(f => f.tipo_pessoa === 'Jurídica').length;

  const progressPercentage = importProgress.total > 0 
    ? Math.round((importProgress.current / importProgress.total) * 100) 
    : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Cards de Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Total de Cadastros</CardTitle>
            <Users className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">{totalFornecedores}</div>
            <p className="text-xs text-green-600 mt-1">Fornecedores e clientes</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Pessoas Físicas</CardTitle>
            <UserCircle className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-900">{pessoasFisicas}</div>
            <p className="text-xs text-blue-600 mt-1">CPF cadastrados</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-purple-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Pessoas Jurídicas</CardTitle>
            <Building2 className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-900">{pessoasJuridicas}</div>
            <p className="text-xs text-purple-600 mt-1">CNPJ cadastrados</p>
          </CardContent>
        </Card>
      </div>

      {/* Botões */}
      {!showForm && (
        <div className="flex justify-between items-center">
          <div className="flex gap-3">
            <Button
              onClick={handleExport}
              variant="outline"
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              Exportar CSV
            </Button>
            <div>
              <input
                type="file"
                accept=".csv"
                onChange={handleImport}
                className="hidden"
                id="import-fornecedores"
              />
              <Button
                onClick={() => document.getElementById('import-fornecedores').click()}
                variant="outline"
                className="gap-2"
                disabled={showImportProgress}
              >
                <Upload className="w-4 h-4" />
                Importar CSV
              </Button>
            </div>
            <Button
              onClick={downloadTemplate}
              variant="outline"
              className="gap-2"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Baixar Modelo
            </Button>
          </div>
          <Button
            onClick={handleNew}
            className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg"
            size="lg"
          >
            <Plus className="w-5 h-5" />
            Novo Fornecedor/Cliente
          </Button>
        </div>
      )}

      {/* Formulário */}
      <AnimatePresence>
        {showForm && (
          <FormularioFornecedor
            onSubmit={handleSubmit}
            onCancel={handleCancelForm}
            initialData={editingFornecedor}
            isEditing={!!editingFornecedor}
          />
        )}
      </AnimatePresence>

      {/* Tabela */}
      <TabelaFornecedores
        fornecedores={fornecedores}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onPrint={handlePrint}
        isLoading={isLoading}
      />

      {/* Modal de Ficha */}
      <FichaFornecedor
        fornecedor={fichaFornecedor}
        open={!!fichaFornecedor}
        onClose={() => setFichaFornecedor(null)}
      />

      {/* Modal de Progresso de Importação */}
      <Dialog open={showImportProgress} onOpenChange={setShowImportProgress}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-green-600" />
              Importando Fornecedores
            </DialogTitle>
            <DialogDescription>
              Aguarde enquanto importamos os registros...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Progresso</span>
                <span className="font-semibold text-slate-900">
                  {importProgress.current} de {importProgress.total}
                </span>
              </div>
              <Progress value={progressPercentage} className="h-3" />
              <p className="text-center text-sm font-medium text-green-600">
                {progressPercentage}%
              </p>
            </div>
            
            {importProgress.errors > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <p className="text-sm text-orange-800">
                  ⚠️ {importProgress.errors} registro(s) com erro
                </p>
              </div>
            )}
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-700">
                💡 Dica: Registros são importados um a um para garantir numeração única.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
