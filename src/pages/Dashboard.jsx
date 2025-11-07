
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Scale, TrendingUp, TrendingDown, Package, Download, Upload, FileSpreadsheet, Loader2, AlertCircle, X } from "lucide-react";
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
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";

import FormularioPesagem from "../components/pesagens/FormularioPesagem";
import TabelaPesagens from "../components/pesagens/TabelaPesagens";
import TicketPesagem from "../components/pesagens/TicketPesagem";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  const num = parseFloat(numero);
  if (isNaN(num)) return "0,00";
  return num.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

// Função global para obter próximo número único do sistema
const getNextSystemNumber = async () => {
  try {
    const [pesagens, fornecedores, produtos] = await Promise.all([
      base44.entities.Pesagem.list(),
      base44.entities.Fornecedor.list(),
      base44.entities.Produto.list()
    ]);

    const allNumbers = [];

    pesagens.forEach(p => {
      const num = parseInt(p.numero_registro, 10);
      if (!isNaN(num) && num > 0) {
        allNumbers.push(num);
      }
    });

    fornecedores.forEach(f => {
      const num = parseInt(f.numero_cadastro, 10);
      if (!isNaN(num) && num > 0) {
        allNumbers.push(num);
      }
    });

    produtos.forEach(p => {
      const num = parseInt(p.numero_produto, 10);
      if (!isNaN(num) && num > 0) {
        allNumbers.push(num);
      }
    });

    return allNumbers.length > 0 ? Math.max(...allNumbers) + 1 : 1;
  } catch (error) {
    console.error('Erro ao obter próximo número sequencial:', error);
    return Date.now(); // Fallback to a unique timestamp
  }
};

export default function Dashboard() {
  const [showForm, setShowForm] = useState(false);
  const [editingPesagem, setEditingPesagem] = useState(null);
  const [ticketPesagem, setTicketPesagem] = useState(null);
  const [showImportProgress, setShowImportProgress] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, errors: 0 });
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [validRecordsToImport, setValidRecordsToImport] = useState([]);

  const queryClient = useQueryClient();

  // Pegar empresa selecionada
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: pesagens, isLoading } = useQuery({
    queryKey: ['pesagens', empresaSelecionadaId],
    queryFn: async () => {
      const allPesagens = await base44.entities.Pesagem.list('-created_date');
      // Filtrar apenas pesagens da empresa selecionada
      return allPesagens.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    initialData: [],
    enabled: !!empresaSelecionadaId, // Only run query if an company is selected
  });

  // Numerar registros existentes automaticamente
  useEffect(() => {
    const numerarRegistrosExistentes = async () => {
      // Only run if data is loaded, there are pesagens, and form is not open
      if (isLoading || !pesagens || pesagens.length === 0 || showForm || !empresaSelecionadaId) {
        return;
      }

      const registrosSemNumero = pesagens.filter(p => !p.numero_registro || String(p.numero_registro).trim() === '');
      
      if (registrosSemNumero.length > 0) {
        console.log(`Numerando ${registrosSemNumero.length} registros sem número...`);
        
        let updateCount = 0;
        for (const pesagem of registrosSemNumero) {
          try {
            const proximoNumero = await getNextSystemNumber();
            await base44.entities.Pesagem.update(pesagem.id, {
              numero_registro: String(proximoNumero)
            });
            updateCount++;
          } catch (error) {
            console.error(`Erro ao numerar registro ${pesagem.id}:`, error);
          }
        }
        
        if (updateCount > 0) {
          queryClient.invalidateQueries({ queryKey: ['pesagens'] });
          toast.info(`${updateCount} registros foram numerados automaticamente.`);
        }
      }
    };

    numerarRegistrosExistentes();
  }, [pesagens, queryClient, isLoading, showForm, empresaSelecionadaId]);

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

  const handleSubmit = async (data) => {
    // Adicionar empresa_id aos dados
    data.empresa_id = empresaSelecionadaId;
    
    if (!editingPesagem) {
      const proximoNumero = await getNextSystemNumber();
      data.numero_registro = String(proximoNumero);
    }
    
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

  const handleDelete = (id, skipConfirm = false) => {
    if (skipConfirm || window.confirm('⚠️ ATENÇÃO: Deseja realmente excluir esta pesagem? Esta ação não pode ser desfeita.')) {
      return deleteMutation.mutateAsync(id);
    }
    return Promise.reject('Cancelado');
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
    // Ensure 'numero_registro' is included in export if it's new
    const headers = ['Número Registro', 'Data', 'Tipo', 'Placa', 'Motorista', 'Produto', 'Fornecedor/Destino', 'Peso Tara (kg)', 'Peso Bruto (kg)', 'Peso Líquido (kg)', 'Observações'];
    csvRows.push(headers.join(';'));

    pesagens.forEach(p => {
      const row = [
        p.numero_registro || '', // Include numero_registro
        format(new Date(p.data_pesagem), 'dd/MM/yyyy'),
        p.tipo_pesagem,
        p.placa_caminhao || '',
        p.nome_motorista || '',
        p.produto || '',
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
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length <= 1) {
          toast.error('O arquivo está vazio ou não contém dados válidos!');
          return;
        }

        let currentNextSystemNumber = await getNextSystemNumber(); // Get the starting number for the import batch
        
        const validRecords = [];
        const errors = [];

        for (let i = 1; i < lines.length; i++) { // Start from 1 to skip header
          const values = lines[i].split(';');
          
          const numeroRegistroIndex = 0;
          const dataIndex = 1;
          const tipoIndex = 2;
          const placaIndex = 3;
          const motoristaIndex = 4;
          const produtoIndex = 5;
          const fornecedorDestinoIndex = 6;
          const pesoTaraIndex = 7;
          const pesoBrutoIndex = 8;
          const pesoLiquidoIndex = 9;
          const observacoesIndex = 10;

          const errosLinha = [];

          if (values.length < 10) { // Minimum 10 columns (from "Número Registro" to "Peso Líquido (kg)")
            errors.push({
              linha: i + 1,
              erro: 'Número insuficiente de colunas (mínimo 10 colunas: "Número Registro" a "Peso Líquido (kg)")',
              dados: values.join(';')
            });
            continue;
          }

          try {
            // Validar campos obrigatórios
            const dataFormatada = parseDateBR(values[dataIndex]?.trim());
            if (!dataFormatada) {
              errosLinha.push('Data inválida ou ausente (formato DD/MM/AAAA)');
            }

            const tipoValue = values[tipoIndex]?.trim();
            if (!tipoValue || !['Entrada', 'Saída', 'Ambos'].includes(tipoValue)) {
              errosLinha.push('Tipo de pesagem inválido ou ausente (deve ser: Entrada, Saída ou Ambos)');
            }

            const pesoTara = parseDecimalBR(values[pesoTaraIndex]);
            if (isNaN(pesoTara)) {
              errosLinha.push('Peso Tara inválido');
            }

            const pesoBruto = parseDecimalBR(values[pesoBrutoIndex]);
            if (isNaN(pesoBruto)) {
              errosLinha.push('Peso Bruto inválido');
            }

            const pesoLiquido = parseDecimalBR(values[pesoLiquidoIndex]);
            if (isNaN(pesoLiquido)) {
              errosLinha.push('Peso Líquido inválido');
            }

            if (errosLinha.length > 0) {
              errors.push({
                linha: i + 1,
                erro: errosLinha.join(', '),
                dados: values.join(';')
              });
              continue;
            }

            const numeroFornecido = values[numeroRegistroIndex]?.trim();
            const numeroRegistro = numeroFornecido && numeroFornecido !== '' ? numeroFornecido : String(currentNextSystemNumber);

            const pesagem = {
              numero_registro: numeroRegistro,
              data_pesagem: dataFormatada,
              tipo_pesagem: tipoValue,
              placa_caminhao: values[placaIndex]?.trim()?.toUpperCase() || undefined,
              nome_motorista: values[motoristaIndex]?.trim()?.toUpperCase() || undefined,
              produto: values[produtoIndex]?.trim()?.toUpperCase() || undefined,
              fornecedor_destino: values[fornecedorDestinoIndex]?.trim()?.toUpperCase() || undefined,
              peso_tara: pesoTara,
              peso_bruto: pesoBruto,
              peso_liquido: pesoLiquido,
              observacoes: values[observacoesIndex]?.trim()?.toUpperCase() || undefined,
              empresa_id: empresaSelecionadaId, // Add empresa_id to imported records
            };

            validRecords.push(pesagem);
            
            if (!numeroFornecido || numeroFornecido === '') {
              currentNextSystemNumber++; // Increment only if we assigned a new number
            }
          } catch (err) {
            errors.push({
              linha: i + 1,
              erro: err.message || 'Erro desconhecido',
              dados: values.join(';')
            });
          }
        }

        // Se houver erros, mostrar diálogo
        if (errors.length > 0) {
          setImportErrors(errors);
          setValidRecordsToImport(validRecords);
          setShowErrorDialog(true);
          return;
        }

        // Se não houver erros, importar diretamente
        if (validRecords.length === 0) {
          toast.error('Nenhum registro válido encontrado para importação!');
          return;
        }

        await executarImportacao(validRecords);

      } catch (error) {
        console.error('Erro geral ao importar:', error);
        toast.error('Erro ao processar arquivo. Verifique o formato.');
      }
    };
    reader.readAsText(file, 'UTF-8');
    event.target.value = '';
  };

  const executarImportacao = async (validRecords) => {
    setShowImportProgress(true);
    setImportProgress({ current: 0, total: validRecords.length, errors: 0 });

    let imported = 0;
    let actualErrors = 0;

    for (const record of validRecords) {
      try {
        await base44.entities.Pesagem.create(record);
        imported++;
        setImportProgress(prev => ({ ...prev, current: prev.current + 1 }));
      } catch (error) {
        console.error(`Erro ao criar registro:`, error);
        actualErrors++;
        setImportProgress(prev => ({ ...prev, errors: prev.errors + 1 }));
      }
    }
    
    await queryClient.invalidateQueries({ queryKey: ['pesagens'] });
    
    setImportProgress({ current: validRecords.length, total: validRecords.length, errors: actualErrors });

    setTimeout(() => {
      setShowImportProgress(false);
      if (actualErrors > 0) {
        toast.success(`${imported} registros importados! ${actualErrors} com erro.`);
      } else {
        toast.success(`${imported} registros importados com sucesso!`);
      }
    }, 1000);
  };

  const confirmarImportacaoComErros = async () => {
    setShowErrorDialog(false);
    await executarImportacao(validRecordsToImport);
  };

  const cancelarImportacao = () => {
    setShowErrorDialog(false);
    setImportErrors([]);
    setValidRecordsToImport([]);
    toast.info('Importação cancelada. Corrija os erros e tente novamente.');
  };

  const downloadTemplate = () => {
    const csvRows = [];
    const headers = ['Número Registro', 'Data', 'Tipo', 'Placa', 'Motorista', 'Produto', 'Fornecedor/Destino', 'Peso Tara (kg)', 'Peso Bruto (kg)', 'Peso Líquido (kg)', 'Observações'];
    csvRows.push(headers.join(';'));
    
    const example = [
      '', // Número Registro (deixe em branco para gerar automaticamente, ou preencha se quiser um número específico)
      '04/11/2025',
      'Entrada',
      'ABC1234',
      'JOÃO SILVA',
      'SOJA',
      'FORNECEDOR EXEMPLO',
      '5000.00',
      '25000.00',
      '20000.00',
      'OBSERVAÇÕES EXEMPLO'
    ];
    csvRows.push(example.join(';'));

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_pesagens.csv';
    link.click();
  };

  const downloadErrosImportacao = () => {
    const csvRows = [];
    const headers = ['Linha', 'Erro', 'Número Registro', 'Data', 'Tipo', 'Placa', 'Motorista', 'Produto', 'Fornecedor/Destino', 'Peso Tara (kg)', 'Peso Bruto (kg)', 'Peso Líquido (kg)', 'Observações'];
    csvRows.push(headers.join(';'));

    importErrors.forEach(erro => {
      const dados = erro.dados.split(';');
      const row = [
        erro.linha,
        erro.erro,
        ...dados
      ];
      csvRows.push(row.join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `erros_importacao_pesagens_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
    link.click();
    toast.success('Planilha de erros baixada com sucesso!');
  };

  const totalPesagens = pesagens.length;
  const pesagensEntrada = pesagens.filter(p => p.tipo_pesagem === 'Entrada').length;
  const pesagensSaida = pesagens.filter(p => p.tipo_pesagem === 'Saída').length;
  const pesagensAmbos = pesagens.filter(p => p.tipo_pesagem === 'Ambos').length;
  const pesoTotalLiquido = pesagens.reduce((sum, p) => sum + (p.peso_liquido || 0), 0);

  const progressPercentage = importProgress.total > 0 
    ? Math.round((importProgress.current / importProgress.total) * 100) 
    : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Cards de Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
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

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-indigo-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Ambos</CardTitle>
            <Scale className="h-5 w-5 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-indigo-900">{pesagensAmbos}</div>
            <p className="text-xs text-indigo-600 mt-1">Entrada e Saída</p>
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

      {/* Modal de Erros de Validação */}
      <Dialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-700">
              <AlertCircle className="w-6 h-6" />
              Erros Encontrados na Importação
            </DialogTitle>
            <DialogDescription>
              Foram encontrados {importErrors.length} erro(s) no arquivo. 
              {validRecordsToImport.length > 0 && ` ${validRecordsToImport.length} registro(s) estão válidos e podem ser importados.`}
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-auto border rounded-lg">
            <Table>
              <TableHeader className="sticky top-0 bg-white z-10">
                <TableRow>
                  <TableHead className="w-20">Linha</TableHead>
                  <TableHead>Erro</TableHead>
                  <TableHead>Dados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importErrors.map((erro, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-bold text-orange-700">
                      {erro.linha}
                    </TableCell>
                    <TableCell className="text-red-600">
                      {erro.erro}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {erro.dados}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 pt-4 border-t">
            {validRecordsToImport.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  💡 <strong>{validRecordsToImport.length} registro(s) válido(s)</strong> podem ser importados mesmo com os erros acima.
                </p>
              </div>
            )}
            
            <div className="flex justify-between items-center gap-3">
              <Button 
                variant="outline"
                onClick={downloadErrosImportacao}
                className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-50"
              >
                <Download className="w-4 h-4" />
                Baixar Planilha de Erros
              </Button>

              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  onClick={cancelarImportacao}
                  className="gap-2"
                >
                  <X className="w-4 h-4" />
                  Cancelar e Corrigir
                </Button>
                
                {validRecordsToImport.length > 0 && (
                  <Button 
                    onClick={confirmarImportacaoComErros}
                    className="bg-orange-600 hover:bg-orange-700 gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Importar {validRecordsToImport.length} Válido(s)
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
