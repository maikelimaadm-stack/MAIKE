import React, { useState } from "react";
import {
  listarProdutosDaEmpresa,
  proximoNumeroDeProduto,
  criarProduto,
  atualizarProduto,
  numerarProdutosSemNumero,
  excluirProduto,
  importarProdutos,
} from "@/services/produtoService";
import {
  BOM_UTF8,
  montarTemplateCsv,
  montarCsvDeProdutos,
  montarCsvDeErros,
  parseCsvDeProdutos,
} from "@/domain/produtos/csvProduto";
import { getApiErrorMessage, hasApiErrorCode, API_ERROR_CODES } from "@/apis/_core/ApiError";
import { emitDeleteDialog } from "@/lib/deleteDialogBus";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Settings, Download, Upload, FileSpreadsheet, Loader2, AlertCircle, X, Plus } from "lucide-react";
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
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";


import FormularioProduto from "../components/produtos/FormularioProduto";
import TabelaProdutos from "../components/produtos/TabelaProdutos";
import FichaProduto from "../components/produtos/FichaProduto";

// Próximo número de produto. Escopo P0.1: a sequência era global (Pesagem +
// Fornecedor + Produto); os domínios de pesagem e safra saíram do produto, então
// a numeração passa a considerar apenas Produto.
export default function Produtos() {
  const [showForm, setShowForm] = useState(false);
  const [editingProduto, setEditingProduto] = useState(null);
  const [fichaProduto, setFichaProduto] = useState(null);
  const [showImportProgress, setShowImportProgress] = useState(false);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, errors: 0 });

  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [validRecordsToImport, setValidRecordsToImport] = useState([]);

  const queryClient = useQueryClient();

  // Pegar empresa selecionada
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: produtos, isLoading, refetch } = useQuery({
    queryKey: ['produtos', empresaSelecionadaId],
    queryFn: () => listarProdutosDaEmpresa(empresaSelecionadaId),
    initialData: [],
    enabled: !!empresaSelecionadaId,
  });

  // Numerar produtos existentes automaticamente
  React.useEffect(() => {
    const numerarProdutosExistentes = async () => {
      const { numerados } = await numerarProdutosSemNumero(produtos);
      if (numerados.length) queryClient.invalidateQueries({ queryKey: ['produtos', empresaSelecionadaId] });
    };

    if (!isLoading && produtos && produtos.length > 0 && empresaSelecionadaId) {
      numerarProdutosExistentes();
    }
  }, [produtos, queryClient, isLoading, empresaSelecionadaId]);

  // A unicidade de nome por empresa e o `syncEntityReferences` vivem no service.
  const createMutation = useMutation({
    mutationFn: (data) => criarProduto({ dados: data, empresaId: empresaSelecionadaId, produtos }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['produtos', empresaSelecionadaId] });
      setShowForm(false);
      setEditingProduto(null);
      toast.success('Produto cadastrado!');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Não foi possível salvar o produto.'));
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data, oldData }) =>
      atualizarProduto({ id, dados: data, oldData, empresaId: empresaSelecionadaId, produtos }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['produtos', empresaSelecionadaId] });
      setShowForm(false);
      setEditingProduto(null);
      toast.success('Produto atualizado!');
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Não foi possível salvar o produto.'));
    }
  });

  /**
   * O bloqueio por movimentação virou `PRODUTO_DELETE_BLOCKED`.
   *
   * O legado abria o diálogo de dentro da mutation e sinalizava com
   * `new Error('DELETE_BLOCKED')`, reconhecido por comparação de texto. Agora a
   * decisão é por código e o diálogo é montado aqui, com a contagem que o
   * service devolve em `details`.
   */
  const deleteMutation = useMutation({
    mutationFn: (id) => excluirProduto(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['produtos', empresaSelecionadaId] });
      toast.success('Produto excluído!');
    },
    onError: (error) => {
      if (hasApiErrorCode(error, API_ERROR_CODES.PRODUTO_DELETE_BLOCKED)) {
        const quantidade = /** @type {any} */ (error).details?.quantidade ?? 0;
        emitDeleteDialog(
          `Este produto já possui ${quantidade} registro(s) lançados em movimentações de estoque e não pode ser excluído.`
        );
        return;
      }
      toast.error(getApiErrorMessage(error, 'Não foi possível excluir o produto.'));
    }
  });

  const handleSubmit = async (data) => {
    try {
      if (editingProduto) {
        await updateMutation.mutateAsync({ id: editingProduto.id, data, oldData: editingProduto });
      } else {
        await createMutation.mutateAsync(data);
      }
    } catch {
      // A mensagem já foi exibida por `onError` da mutation.
    }
  };

  const handleEdit = (produto) => {
    setEditingProduto(produto);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    try {
      await deleteMutation.mutateAsync(id);
    } catch (error) {
      console.error('Erro:', error);
    }
  };

  const handlePrint = (produto) => {
    setFichaProduto(produto);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingProduto(null);
  };

  /** O download é da tela; a montagem do CSV é pura. */
  const baixarCsv = (conteudo, nomeArquivo) => {
    const blob = new Blob([BOM_UTF8 + conteudo], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = nomeArquivo;
    link.click();
  };

  const handleExport = () => {
    baixarCsv(montarCsvDeProdutos(produtos), `produtos_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast.success('Exportado!');
  };

  const downloadErrosImportacao = () => {
    baixarCsv(montarCsvDeErros(importErrors), `erros_produtos_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast.success('Planilha de erros baixada!');
  };

  const executarImportacao = async (validRecords) => {
    setShowImportProgress(true);
    setImportProgress({ current: 0, total: validRecords.length, errors: 0 });

    const { importados, falhas } = await importarProdutos(validRecords, ({ atual }) => {
      setImportProgress(prev => ({ ...prev, current: atual }));
    });

    await queryClient.invalidateQueries({ queryKey: ['produtos', empresaSelecionadaId] });

    setImportProgress({ current: validRecords.length, total: validRecords.length, errors: falhas });

    setTimeout(() => {
      setShowImportProgress(false);
      toast.success(falhas > 0 ? `${importados} importados! ${falhas} erro(s).` : `${importados} importados!`);
    }, 1000);
  };

  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // A leitura do arquivo é da tela. Parse, validação e numeração são
        // puros — `parseCsvDeProdutos` em `src/domain/produtos/csvProduto.js`.
        const numeroInicial = await proximoNumeroDeProduto();
        const { validos, erros } = parseCsvDeProdutos(String(e.target.result ?? ''), {
          empresaId: empresaSelecionadaId,
          numeroInicial,
        });

        if (erros.length > 0) {
          setImportErrors(erros);
          setValidRecordsToImport(validos);
          setShowErrorDialog(true);
          return;
        }

        if (validos.length === 0) {
          toast.error('Nenhum registro válido!');
          return;
        }

        await executarImportacao(validos);

      } catch (error) {
        console.error('Erro ao importar:', error);
        toast.error('Erro ao importar!');
      }
    };
    reader.readAsText(file, 'UTF-8');
    event.target.value = '';
  };

  const confirmarImportacaoComErros = async () => {
    setShowErrorDialog(false);
    await executarImportacao(validRecordsToImport);
  };

  const cancelarImportacao = () => {
    setShowErrorDialog(false);
    setImportErrors([]);
    setValidRecordsToImport([]);
    toast.info('Importação cancelada.');
  };

  const downloadTemplate = () => {
    baixarCsv(montarTemplateCsv(), 'modelo_produtos.csv');
  };

  const formatarNumero = (numero) => {
    if (!numero && numero !== 0) return "0,00";
    return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };

  const progressPercentage = importProgress.total > 0 
    ? Math.round((importProgress.current / importProgress.total) * 100) 
    : 0;

  return (
    <div className="p-1 md:p-1 space-y-1">
      {!showForm && (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
          <div>
            <h1 className="font-bold text-slate-800">Produtos</h1>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="h-7 text-xs">Atualizar</Button>
            <Button onClick={handleExport} variant="outline" size="sm" className="h-7 text-xs"><Download className="w-3.5 h-3.5" /> Exportar</Button>
            <Button onClick={downloadTemplate} variant="outline" size="sm" className="h-7 text-xs"><FileSpreadsheet className="w-3.5 h-3.5" /> Modelo</Button>
            <label>
              <Button variant="outline" size="sm" className="h-7 text-xs cursor-pointer" asChild><span><Upload className="w-3.5 h-3.5" /> Importar</span></Button>
              <input type="file" accept=".csv" onChange={handleImport} className="hidden" disabled={showImportProgress} />
            </label>
            <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 w-7"><Settings className="w-4 h-4" /></Button>
            <Button onClick={() => { setEditingProduto(null); setShowForm(true); }} size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600">Adicionar</Button>
          </div>
        </div>
      )}

      {/* Formulário */}
      <AnimatePresence>
        {showForm && (
          <FormularioProduto
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingProduto(null); }}
            initialData={editingProduto}
            isEditing={!!editingProduto}
          />
        )}
      </AnimatePresence>

      {/* Tabela */}
      {!showForm && (
        <TabelaProdutos
          produtos={produtos}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onPrint={handlePrint}
          isLoading={isLoading}
          showConfigColunas={showConfigColunas}
          setShowConfigColunas={setShowConfigColunas}
        />
      )}

      {/* Modal de Ficha */}
      <FichaProduto
        produto={fichaProduto}
        open={!!fichaProduto}
        onClose={() => setFichaProduto(null)}
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
              Importando Produtos
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
                💡 Dica: Registros são importados individualmente para garantir numeração única
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}