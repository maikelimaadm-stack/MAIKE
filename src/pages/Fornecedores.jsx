
import React, { useState } from "react";
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

export default function Fornecedores() {
  const [showForm, setShowForm] = useState(false);
  const [editingFornecedor, setEditingFornecedor] = useState(null);
  const [fichaFornecedor, setFichaFornecedor] = useState(null);
  const [showImportProgress, setShowImportProgress] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, errors: 0 });

  const queryClient = useQueryClient();

  const { data: fornecedores, isLoading } = useQuery({
    queryKey: ['fornecedores'],
    queryFn: () => base44.entities.Fornecedor.list('-created_date'),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Fornecedor.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      setShowForm(false);
      setEditingFornecedor(null);
      toast.success('Fornecedor cadastrado com sucesso!');
    },
    onError: (error) => {
      console.error("Erro ao criar fornecedor:", error);
      toast.error('Erro ao salvar fornecedor. Tente novamente.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Fornecedor.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      setShowForm(false);
      setEditingFornecedor(null);
      toast.success('Fornecedor atualizado com sucesso!');
    },
    onError: (error) => {
      console.error("Erro ao atualizar fornecedor:", error);
      toast.error('Erro ao atualizar fornecedor. Tente novamente.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Fornecedor.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      toast.success('Fornecedor excluído com sucesso!');
    },
    onError: (error) => {
      console.error("Erro ao excluir fornecedor:", error);
      toast.error('Erro ao excluir fornecedor. Tente novamente.');
    }
  });

  const handleSubmit = async (data) => {
    // Gerar número único se for novo cadastro
    if (!editingFornecedor) {
      const totalFornecedores = fornecedores.length;
      const proximoNumero = (totalFornecedores + 1).toString().padStart(6, '0');
      data.numero_cadastro = `${proximoNumero}`;
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

  const handleDelete = (id) => {
    if (window.confirm('Tem certeza que deseja excluir este fornecedor/cliente?')) {
      deleteMutation.mutate(id);
    }
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
    const headers = ['Tipo', 'Nome', 'CPF', 'RG', 'Data Nascimento', 'CNPJ', 'Razão Social', 'Inscrição Estadual', 'Responsável', 'Telefone', 'Email', 'Endereço', 'Cidade', 'Estado', 'CEP', 'Observações', 'Número Cadastro'];
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
        f.observacoes || '',
        f.numero_cadastro || ''
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
        const lines = text.split('\n');
        const validRecords = [];
        let errorCount = 0;

        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const values = lines[i].split(';');
          // Ensure enough columns for basic data, if number_cadastro is the last it might be optional for import
          if (values.length < 2) { 
            errorCount++;
            continue;
          }

          try {
            const fornecedor = {
              tipo_pessoa: values[0]?.trim(),
              nome: values[1]?.trim(),
              cpf: values[2]?.trim() || undefined,
              rg: values[3]?.trim() || undefined,
              data_nascimento: values[4]?.trim() || undefined,
              cnpj: values[5]?.trim() || undefined,
              razao_social: values[6]?.trim() || undefined,
              inscricao_estadual: values[7]?.trim() || undefined,
              nome_responsavel: values[8]?.trim() || undefined,
              telefone: values[9]?.trim() || undefined,
              email: values[10]?.trim() || undefined,
              endereco: values[11]?.trim() || undefined,
              cidade: values[12]?.trim() || undefined,
              estado: values[13]?.trim() || undefined,
              cep: values[14]?.trim() || undefined,
              observacoes: values[15]?.trim() || undefined,
              numero_cadastro: values[16]?.trim() || undefined // If not present, the backend or a later step might generate it
            };

            if (!fornecedor.nome || !fornecedor.tipo_pessoa) {
              throw new Error("Dados inválidos: Nome e Tipo de Pessoa são obrigatórios.");
            }

            validRecords.push(fornecedor);
          } catch (err) {
            console.error(`Erro na linha ${i + 1}:`, err.message);
            errorCount++;
          }
        }

        if (validRecords.length === 0) {
          toast.error('Nenhum registro válido encontrado no arquivo!');
          return;
        }

        setShowImportProgress(true);
        setImportProgress({ current: 0, total: validRecords.length, errors: errorCount });

        const batchSize = 10;
        let imported = 0;
        let errorsInImport = 0; // Track errors during the actual import API call

        for (let i = 0; i < validRecords.length; i += batchSize) {
          const batch = validRecords.slice(i, i + batchSize);
          
          try {
            await base44.entities.Fornecedor.bulkCreate(batch);
            imported += batch.length;
          } catch (error) {
            console.error('Erro no lote:', error);
            // If bulkCreate fails, try individual creates to identify specific errors
            for (const record of batch) {
              try {
                // Generate numero_cadastro if not provided in the CSV for individual creates
                if (!record.numero_cadastro) {
                  const currentFornecedores = await queryClient.fetchQuery({ queryKey: ['fornecedores'] });
                  const proximoNumero = (currentFornecedores.length + 1).toString().padStart(6, '0');
                  record.numero_cadastro = `${proximoNumero}`;
                }
                await base44.entities.Fornecedor.create(record);
                imported++;
              } catch (e) {
                errorsInImport++;
              }
            }
          }
          
          setImportProgress({ current: imported, total: validRecords.length, errors: errorCount + errorsInImport });
        }

        await queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
        
        setTimeout(() => {
          setShowImportProgress(false);
          const totalErrors = errorCount + errorsInImport;
          if (totalErrors > 0) {
            toast.success(`${imported} registros importados! ${totalErrors} com erro.`);
          } else {
            toast.success(`${imported} registros importados com sucesso!`);
          }
        }, 1000);

      } catch (error) {
        console.error('Erro ao importar:', error);
        setShowImportProgress(false);
        toast.error('Erro ao importar dados. Verifique o arquivo.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const downloadTemplate = () => {
    const csvRows = [];
    const headers = ['Tipo', 'Nome', 'CPF', 'RG', 'Data Nascimento', 'CNPJ', 'Razão Social', 'Inscrição Estadual', 'Responsável', 'Telefone', 'Email', 'Endereço', 'Cidade', 'Estado', 'CEP', 'Observações', 'Número Cadastro'];
    csvRows.push(headers.join(';'));
    
    const example = ['Física', 'Exemplo Fornecedor', '000.000.000-00', '00.000.000-0', '01/01/1990', '', '', '', '', '(00) 00000-0000', 'exemplo@email.com', 'Rua Exemplo, 123', 'Vila Bela', 'MT', '00000-000', 'Exemplo de fornecedor', '000001'];
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
                💡 Dica: Registros são importados em lotes para maior velocidade
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
