
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Scale, TrendingUp, TrendingDown, Package, Download, Upload, FileSpreadsheet, Trash2, Loader2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

import FormularioPesagem from "../components/pesagens/FormularioPesagem";
import TabelaPesagens from "../components/pesagens/TabelaPesagens";
import TicketPesagem from "../components/pesagens/TicketPesagem";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export default function Dashboard() {
  const [showForm, setShowForm] = useState(false);
  const [editingPesagem, setEditingPesagem] = useState(null);
  const [ticketPesagem, setTicketPesagem] = useState(null);
  const [showImportProgress, setShowImportProgress] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, errors: 0 });

  const queryClient = useQueryClient();

  const { data: pesagens, isLoading } = useQuery({
    queryKey: ['pesagens'],
    queryFn: () => base44.entities.Pesagem.list('-created_date'),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Pesagem.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pesagens'] });
      setShowForm(false);
      setEditingPesagem(null);
      toast.success('Pesagem registrada com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao registrar pesagem. Tente novamente.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Pesagem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pesagens'] });
      setShowForm(false);
      setEditingPesagem(null);
      toast.success('Pesagem atualizada com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao atualizar pesagem. Tente novamente.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Pesagem.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pesagens'] });
      toast.success('Pesagem excluída com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao excluir pesagem. Tente novamente.');
    }
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      for (const pesagem of pesagens) {
        await base44.entities.Pesagem.delete(pesagem.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pesagens'] });
      toast.success('Todos os registros foram excluídos!');
    },
    onError: () => {
      toast.error('Erro ao excluir registros.');
    }
  });

  const handleSubmit = (data) => {
    if (editingPesagem) {
      updateMutation.mutate({ id: editingPesagem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (pesagem) => {
    setEditingPesagem(pesagem);
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Tem certeza que deseja excluir esta pesagem?')) {
      deleteMutation.mutate(id);
    }
  };

  const handlePrint = (pesagem) => {
    setTicketPesagem(pesagem);
  };

  const handleNewPesagem = () => {
    setEditingPesagem(null);
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingPesagem(null);
  };

  const handleDeleteAll = () => {
    if (window.confirm(`Tem certeza que deseja excluir TODAS as ${pesagens.length} pesagens? Esta ação não pode ser desfeita!`)) {
      if (window.confirm('CONFIRME NOVAMENTE: Deseja realmente excluir TODOS os registros de pesagens?')) {
        deleteAllMutation.mutate();
      }
    }
  };

  const parseDecimalBR = (value) => {
    if (!value) return 0;
    return parseFloat(value.toString().replace(/\./g, '').replace(',', '.')) || 0;
  };

  const parseDateBR = (dateStr) => {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return dateStr;
  };

  const handleExport = () => {
    const csvRows = [];
    const headers = ['Data', 'Tipo', 'Placa', 'Motorista', 'Produto', 'Fornecedor/Destino', 'Peso Tara (kg)', 'Peso Bruto (kg)', 'Peso Líquido (kg)', 'Observações'];
    csvRows.push(headers.join(';'));

    pesagens.forEach(p => {
      const row = [
        format(new Date(p.data_pesagem), 'dd/MM/yyyy'),
        p.tipo_pesagem,
        p.placa_caminhao,
        p.nome_motorista,
        p.produto,
        p.fornecedor_destino || '',
        p.peso_tara.toString().replace('.', ','),
        p.peso_bruto.toString().replace('.', ','),
        p.peso_liquido.toString().replace('.', ','),
        p.observacoes || ''
      ];
      csvRows.push(row.join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pesagens_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
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

        // Parse todas as linhas primeiro
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          const values = lines[i].split(';');
          if (values.length < 9) {
            errorCount++;
            continue;
          }

          try {
            const dataFormatada = parseDateBR(values[0].trim());
            const pesoTara = parseDecimalBR(values[6]);
            const pesoBruto = parseDecimalBR(values[7]);
            const pesoLiquido = parseDecimalBR(values[8]);

            const pesagem = {
              data_pesagem: dataFormatada,
              tipo_pesagem: values[1].trim(),
              placa_caminhao: values[2].trim(),
              nome_motorista: values[3].trim(),
              produto: values[4].trim(),
              fornecedor_destino: values[5].trim() || undefined,
              peso_tara: pesoTara,
              peso_bruto: pesoBruto,
              peso_liquido: pesoLiquido,
              observacoes: values[9]?.trim() || undefined
            };

            if (!pesagem.data_pesagem || !pesagem.tipo_pesagem || !pesagem.placa_caminhao || 
                !pesagem.nome_motorista || !pesagem.produto || isNaN(pesagem.peso_tara) || 
                isNaN(pesagem.peso_bruto) || isNaN(pesagem.peso_liquido)) {
              throw new Error("Dados inválidos");
            }
            
            validRecords.push(pesagem);
          } catch (err) {
            console.error(`Erro na linha ${i + 1}:`, err);
            errorCount++;
          }
        }

        if (validRecords.length === 0) {
          toast.error('Nenhum registro válido encontrado no arquivo!');
          return;
        }

        // Mostrar progresso
        setShowImportProgress(true);
        setImportProgress({ current: 0, total: validRecords.length, errors: errorCount });

        // Importar em lotes de 10
        const batchSize = 10;
        let imported = 0;

        for (let i = 0; i < validRecords.length; i += batchSize) {
          const batch = validRecords.slice(i, i + batchSize);
          
          try {
            // Assuming base44.entities.Pesagem.bulkCreate exists and handles an array of objects
            await base44.entities.Pesagem.bulkCreate(batch);
            imported += batch.length;
          } catch (error) {
            console.error('Erro no lote, tentando individualmente:', error);
            // Fallback: try individual creation if bulk failed
            for (const record of batch) {
              try {
                await base44.entities.Pesagem.create(record);
                imported++;
              } catch (e) {
                errorCount++; // Increment error count for individual failures
              }
            }
          }
          
          setImportProgress({ current: imported, total: validRecords.length, errors: errorCount });
        }

        // Atualizar dados
        await queryClient.invalidateQueries({ queryKey: ['pesagens'] });
        
        setTimeout(() => {
          setShowImportProgress(false);
          if (errorCount > 0) {
            toast.success(`${imported} registros importados! ${errorCount} com erro.`);
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
    
    // Limpar o input para permitir reimportar o mesmo arquivo
    event.target.value = '';
  };

  const downloadTemplate = () => {
    const csvRows = [];
    const headers = ['Data', 'Tipo', 'Placa', 'Motorista', 'Produto', 'Fornecedor/Destino', 'Peso Tara (kg)', 'Peso Bruto (kg)', 'Peso Líquido (kg)', 'Observações'];
    csvRows.push(headers.join(';'));
    
    const example = [
      '04/11/2025',
      'Entrada',
      'ABC1234',
      'JOÃO SILVA',
      'Soja',
      'Fornecedor Exemplo',
      '5.000,00',
      '25.000,00',
      '20.000,00',
      'Observações exemplo'
    ];
    csvRows.push(example.join(';'));

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_pesagens.csv';
    link.click();
  };

  const totalPesagens = pesagens.length;
  const pesagensEntrada = pesagens.filter(p => p.tipo_pesagem === 'Entrada').length;
  const pesagensSaida = pesagens.filter(p => p.tipo_pesagem === 'Saída').length;
  const pesoTotalLiquido = pesagens.reduce((sum, p) => sum + (p.peso_liquido || 0), 0);

  const progressPercentage = importProgress.total > 0 
    ? Math.round((importProgress.current / importProgress.total) * 100) 
    : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Cards de Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Total de Pesagens</CardTitle>
            <Scale className="h-5 h-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">{totalPesagens}</div>
            <p className="text-xs text-green-600 mt-1">Registros totais</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Entradas</CardTitle>
            <TrendingDown className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-900">{pesagensEntrada}</div>
            <p className="text-xs text-blue-600 mt-1">Pesagens de entrada</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-orange-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Saídas</CardTitle>
            <TrendingUp className="h-5 w-5 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-900">{pesagensSaida}</div>
            <p className="text-xs text-orange-600 mt-1">Pesagens de saída</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-purple-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Peso Total</CardTitle>
            <Package className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-900">{formatarNumero(pesoTotalLiquido)}</div>
            <p className="text-xs text-purple-600 mt-1">Kg líquidos totais</p>
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
                id="import-pesagens"
              />
              <Button
                onClick={() => document.getElementById('import-pesagens').click()}
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
            <Button
              onClick={handleDeleteAll}
              variant="outline"
              className="gap-2 border-red-300 text-red-700 hover:bg-red-50"
              disabled={pesagens.length === 0}
            >
              <Trash2 className="w-4 h-4" />
              Excluir Todos ({pesagens.length})
            </Button>
          </div>
          <Button
            onClick={handleNewPesagem}
            className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg"
            size="lg"
          >
            <Plus className="w-5 h-5" />
            Nova Pesagem
          </Button>
        </div>
      )}

      {/* Formulário */}
      <AnimatePresence>
        {showForm && (
          <FormularioPesagem
            onSubmit={handleSubmit}
            onCancel={handleCancelForm}
            initialData={editingPesagem}
            isEditing={!!editingPesagem}
          />
        )}
      </AnimatePresence>

      {/* Tabela */}
      <TabelaPesagens
        pesagens={pesagens}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onPrint={handlePrint}
        isLoading={isLoading}
      />

      {/* Modal de Ticket */}
      <TicketPesagem
        pesagem={ticketPesagem}
        open={!!ticketPesagem}
        onClose={() => setTicketPesagem(null)}
      />

      {/* Modal de Progresso de Importação */}
      <Dialog open={showImportProgress} onOpenChange={setShowImportProgress}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-green-600" />
              Importando Dados
            </DialogTitle>
            <DialogDescription>
              Aguarde enquanto importamos os registros. Isso pode levar alguns instantes.
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
                💡 Dica: Registros são importados em lotes para maior velocidade.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
