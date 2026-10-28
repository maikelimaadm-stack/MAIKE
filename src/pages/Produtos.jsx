import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listarProdutosPagina,
  listarProdutosDaEmpresa,
  criarProduto,
  atualizarProduto,
  excluirProdutos,
  importarProdutos,
  isProdutoDeleteBlockedError,
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Download, Upload, FileSpreadsheet, Loader2, AlertCircle, X, RefreshCw } from "lucide-react";
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
import {
  notifyError,
  notifyExclusoesEmpilhadas,
  notifySuccess,
  notifyWarning,
} from "@/lib/maikeNotify";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import TabelaProdutos, { PRODUTOS_COLUNAS, getProdutoFieldValue } from "../components/produtos/TabelaProdutos";
import FormularioProduto, { FORMULARIO_PRODUTO_ID } from "../components/produtos/FormularioProduto";
import FichaProduto from "../components/produtos/FichaProduto";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

const PRODUTOS_STORAGE_KEY = "colunas_produtos_v2";

export default function Produtos() {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaSelecionadaId();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));
  const prevEmpresaRef = useRef(empresaId);

  const [fichaProduto, setFichaProduto] = useState(null);
  const [showImportProgress, setShowImportProgress] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, errors: 0 });
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [validRecordsToImport, setValidRecordsToImport] = useState([]);

  const fetchProdutosPage = useCallback(
    ({ limit, cursor, q }) =>
      listarProdutosPagina(empresaId, {
        limit,
        cursor,
        q: q || undefined,
      }),
    [empresaId],
  );

  const controller = useCadastroBase1Controller({
    storageKey: PRODUTOS_STORAGE_KEY,
    columnIds: PRODUTOS_COLUNAS.map((c) => c.id),
    listEnabled: Boolean(empresaId),
    queryKey: ["produtos", "page", empresaId],
    fetchPage: fetchProdutosPage,
    duplicateLabelField: "nome_produto",
    searchPlaceholder: "Buscar produtos…",
    exportFileName: "produtos.csv",
    exportColumns: PRODUTOS_COLUNAS,
    getExportFieldValue: getProdutoFieldValue,
    getRecordTitle: (item) => (item?.id ? item.nome_produto || "Produto" : "Novo produto"),
    getRecordCode: (item) => {
      if (item?.codigo_interno) return String(item.codigo_interno);
      if (item?.numero_produto != null) return String(item.numero_produto);
      return undefined;
    },
    getSearchHaystack: (p) =>
      [p.nome_produto, p.codigo_interno, p.categoria, p.marca, p.numero_produto].filter(Boolean).join(" "),
    mapSearchSuggestion: (p) => ({
      id: String(p.id),
      label: p.nome_produto || "Produto",
      secondary: p.numero_produto ? `Nº ${p.numero_produto}` : p.codigo_interno || undefined,
    }),
    matchRowId: (p, id) => String(p.id) === String(id),
    getRowId: (p) => String(p.id),
    findRowById: (rows, id) => rows.find((p) => String(p.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: (ids) => deleteRef.current(ids),
  });

  useEffect(() => {
    if (prevEmpresaRef.current === empresaId) return;
    prevEmpresaRef.current = empresaId;
    controller.recordHelpers.closeForm();
    controller.chrome.setSelectedIds([]);
    controller.handleClearFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- troca de empresa apenas
  }, [empresaId]);

  const createMutation = useMutation({
    mutationFn: (data) => criarProduto({ dados: data, empresaId, produtos: controller.visibleRows }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["produtos"] });
      controller.recordHelpers.recordBeforeNewRef.current = null;
      if (created && typeof created === "object" && created.id) {
        controller.recordHelpers.setEditingItem(created);
        controller.recordHelpers.setIsEditing(false);
        controller.recordHelpers.setShowForm(true);
        controller.recordHelpers.chrome.setViewMode("record");
        controller.recordHelpers.chrome.onSelectionChange([String(created.id)]);
      } else {
        controller.recordHelpers.closeForm();
      }
      notifySuccess("Sucesso", "Produto cadastrado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o produto.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data, oldData }) =>
      atualizarProduto({ id, dados: data, oldData, empresaId, produtos: controller.visibleRows }),
    onSuccess: (updated, { id, data }) => {
      queryClient.invalidateQueries({ queryKey: ["produtos"] });
      const merged = {
        ...(controller.editingItem?.id === id ? controller.editingItem : {}),
        id,
        ...data,
        ...(updated && typeof updated === "object" ? updated : {}),
      };
      controller.setEditingItem(merged);
      controller.setIsEditing(false);
      notifySuccess("Sucesso", "Produto atualizado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o produto.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids) => excluirProdutos(ids),
    onSuccess: ({ excluidas, falhas }) => {
      queryClient.invalidateQueries({ queryKey: ["produtos"] });
      controller.chrome.setSelectedIds([]);
      if (
        controller.showForm &&
        controller.editingItem?.id &&
        excluidas.some((id) => String(id) === String(controller.editingItem.id))
      ) {
        controller.recordHelpers.closeForm();
      }
      if (excluidas.length) {
        notifyExclusoesEmpilhadas(excluidas.length, { singular: "Produto excluído" });
      }
      for (const falha of falhas) {
        if (isProdutoDeleteBlockedError(falha.erro)) {
          const quantidade = /** @type {any} */ (falha.erro).details?.quantidade ?? 0;
          emitDeleteDialog(
            `Este produto já possui ${quantidade} registro(s) lançados em movimentações de estoque e não pode ser excluído.`,
          );
        } else {
          notifyError(
            "Atenção",
            getApiErrorMessage(falha.erro, "Não foi possível excluir o produto."),
          );
        }
      }
    },
    onError: (err) => {
      controller.setDeleteState({ open: false, ids: [] });
      if (hasApiErrorCode(err, API_ERROR_CODES.PRODUTO_DELETE_BLOCKED)) {
        const quantidade = /** @type {any} */ (err).details?.quantidade ?? 0;
        emitDeleteDialog(
          `Este produto já possui ${quantidade} registro(s) lançados em movimentações de estoque e não pode ser excluído.`,
        );
        return;
      }
      notifyError("Atenção", getApiErrorMessage(err, "Não foi possível excluir o produto."));
    },
  });

  submitRef.current = (data) => {
    if (controller.editingItem?.id) {
      updateMutation.mutate({
        id: controller.editingItem.id,
        data,
        oldData: controller.editingItem,
      });
    } else {
      createMutation.mutate(data);
    }
  };
  deleteRef.current = (ids) => deleteMutation.mutate(ids);

  const saving = createMutation.isPending || updateMutation.isPending;

  const listErrorMessage = useMemo(
    () =>
      getApiErrorMessage(
        controller.listaQueryError,
        "Não foi possível carregar os produtos. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  const baixarCsv = (conteudo, nomeArquivo) => {
    const blob = new Blob([BOM_UTF8 + conteudo], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = nomeArquivo;
    link.click();
  };

  const handleExportEmpresaCompleta = async () => {
    if (!empresaId) return;
    try {
      const todos = await listarProdutosDaEmpresa(empresaId);
      baixarCsv(montarCsvDeProdutos(todos), `produtos_${format(new Date(), "yyyy-MM-dd")}.csv`);
      toast.success("Exportado!");
    } catch {
      toast.error("Erro ao exportar!");
    }
  };

  const downloadTemplate = () => {
    baixarCsv(montarTemplateCsv(), "modelo_produtos.csv");
  };

  const downloadErrosImportacao = () => {
    baixarCsv(montarCsvDeErros(importErrors), `erros_produtos_${format(new Date(), "yyyy-MM-dd")}.csv`);
    toast.success("Planilha de erros baixada!");
  };

  const executarImportacao = async (validRecords) => {
    setShowImportProgress(true);
    setImportProgress({ current: 0, total: validRecords.length, errors: 0 });

    const { importados, falhas } = await importarProdutos(validRecords, ({ atual }) => {
      setImportProgress((prev) => ({ ...prev, current: atual }));
    });

    await queryClient.invalidateQueries({ queryKey: ["produtos"] });

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
        const { validos, erros } = parseCsvDeProdutos(String(e.target.result ?? ""), {
          empresaId,
        });

        if (erros.length > 0) {
          setImportErrors(erros);
          setValidRecordsToImport(validos);
          setShowErrorDialog(true);
          return;
        }

        if (validos.length === 0) {
          toast.error("Nenhum registro válido!");
          return;
        }

        await executarImportacao(validos);
      } catch (error) {
        console.error("Erro ao importar:", error);
        toast.error("Erro ao importar!");
      }
    };
    reader.readAsText(file, "UTF-8");
    event.target.value = "";
  };

  const confirmarImportacaoComErros = async () => {
    setShowErrorDialog(false);
    await executarImportacao(validRecordsToImport);
  };

  const cancelarImportacao = () => {
    setShowErrorDialog(false);
    setImportErrors([]);
    setValidRecordsToImport([]);
    toast.info("Importação cancelada.");
  };

  const handlePrintFicha = () => {
    const id = controller.chrome.selectedIds[0];
    const row = id
      ? controller.visibleRows.find((p) => String(p.id) === String(id))
      : controller.editingItem;
    if (row) setFichaProduto(row);
    else window.print();
  };

  const progressPercentage =
    importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0;

  const extraToolbar = (
    <>
      <button type="button" className="tb-btn tb-btn-gray" onClick={() => controller.recarregarLista()}>
        <RefreshCw aria-hidden />
        Atualizar
      </button>
      <button type="button" className="tb-btn tb-btn-gray" onClick={handleExportEmpresaCompleta}>
        <Download aria-hidden />
        Exportar
      </button>
      <button type="button" className="tb-btn tb-btn-gray" onClick={downloadTemplate}>
        <FileSpreadsheet aria-hidden />
        Modelo
      </button>
      <label className="inline-flex">
        <span className="tb-btn tb-btn-gray cursor-pointer">
          <Upload aria-hidden />
          Importar
        </span>
        <input type="file" accept=".csv" onChange={handleImport} className="hidden" disabled={showImportProgress} />
      </label>
    </>
  );

  const recordCode = controller.editingItem?.codigo_interno
    ? String(controller.editingItem.codigo_interno)
    : controller.editingItem?.numero_produto != null
      ? String(controller.editingItem.numero_produto)
      : undefined;

  const screenController = { ...controller, saving };

  return (
    <>
      <CadastroBase1Screen
        workspaceTitle="Produtos"
        searchPlaceholder="Buscar produtos…"
        formId={FORMULARIO_PRODUTO_ID}
        columnsForCardsToolbar={PRODUTOS_COLUNAS}
        controller={screenController}
        listErrorMessage={listErrorMessage}
        recordCode={recordCode}
        extraToolbar={extraToolbar}
        onExportCsv={controller.exportCsv}
        onPrint={handlePrintFicha}
        deleteDialog={{
          title: "Confirmar exclusão",
          descriptionOne: "Excluir este produto? A ação fica registrada na auditoria.",
          descriptionMany: (n) => `Excluir ${n} produtos? A ação fica registrada na auditoria.`,
        }}
        recordForm={
          <FormularioProduto
            key={`${controller.editingItem?.id ?? "produto-nova"}-${controller.formEpoch}`}
            variant="embedded"
            toolbarActions
            readOnly={!controller.isEditing}
            isSubmitting={saving}
            initialData={controller.editingItem}
            isEditing={!!controller.editingItem?.id}
            onSubmit={controller.handleSubmit}
            onCancel={controller.cancelForm}
          />
        }
        listSlot={
          <TabelaProdutos
            produtos={controller.visibleRows}
            onEdit={controller.handleEdit}
            isLoading={controller.isLoading}
            showConfigColunas={controller.showConfigColunas}
            setShowConfigColunas={controller.setShowConfigColunas}
            searchQuery=""
            matchesSearch={controller.matchesSearch}
            resetFiltersKey={controller.chrome.resetFiltersKey}
            onSelectionChange={controller.chrome.onSelectionChange}
            onFiltersActiveChange={controller.chrome.setFiltersActive}
            viewMode={controller.chrome.viewMode === "cards" ? "cards" : "table"}
            cardFields={controller.cardsPrefs.cardFields}
            cardsPerRow={controller.cardsPrefs.cardsPerRow}
            configureColumnsAnchorRef={controller.configureColumnsAnchorRef}
          />
        }
      />

      <FichaProduto produto={fichaProduto} open={!!fichaProduto} onClose={() => setFichaProduto(null)} />

      <Dialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-700">
              <AlertCircle className="w-6 h-6" />
              Erros Encontrados na Importação
            </DialogTitle>
            <DialogDescription>
              Foram encontrados {importErrors.length} erro(s) no arquivo.
              {validRecordsToImport.length > 0 &&
                ` ${validRecordsToImport.length} registro(s) estão válidos e podem ser importados.`}
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
                    <TableCell className="font-bold text-orange-700">{erro.linha}</TableCell>
                    <TableCell className="text-red-600">{erro.erro}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">{erro.dados}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-col gap-3 pt-4 border-t">
            {validRecordsToImport.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  <strong>{validRecordsToImport.length} registro(s) válido(s)</strong> podem ser importados mesmo com
                  os erros acima.
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
                <Button variant="outline" onClick={cancelarImportacao} className="gap-2">
                  <X className="w-4 h-4" />
                  Cancelar e Corrigir
                </Button>
                {validRecordsToImport.length > 0 && (
                  <Button onClick={confirmarImportacaoComErros} className="bg-orange-600 hover:bg-orange-700 gap-2">
                    <Upload className="w-4 h-4" />
                    Importar {validRecordsToImport.length} Válido(s)
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showImportProgress} onOpenChange={setShowImportProgress}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-green-600" />
              Importando Produtos
            </DialogTitle>
            <DialogDescription>Aguarde enquanto importamos os registros…</DialogDescription>
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
              <p className="text-center text-sm font-medium text-green-600">{progressPercentage}%</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
