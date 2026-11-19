import React, { useCallback, useMemo, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Pencil, MapPinned } from "lucide-react";
import { PillBtn } from "@/components/cadastro/base1/Base1Ui";
import { useQueryClient } from "@tanstack/react-query";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { useCadastroBase1FullListController } from "@/hooks/useCadastroBase1FullListController";
import { invalidarCachesDoMapa } from "@/components/mapa/invalidarCachesMapa";

/**
 * Uma aba do Cadastro de Áreas, Pontos e Linhas no motor Base1 (D-PROD-174): barra, faixa de filtros,
 * grade/cards e registro do motor. A geometria nasce e muda no mapa (o "+ Novo" abre o desenho); o registro
 * mostra os detalhes, travados até o "Editar", e quem salva é a barra do motor (o formulário grava sozinho,
 * como no painel do desenho, e avisa quando termina).
 *
 * @param {{
 *   titulo: string,
 *   abas: React.ReactNode,
 *   queryKey: unknown[],
 *   carregar: () => Promise<any[]>,
 *   habilitado: boolean,
 *   colunas: Array<{ id: string, label: string }>,
 *   valor: (item: any, coluna: string) => string,
 *   celula: (item: any, coluna: string) => React.ReactNode,
 *   comparar?: (a: any, b: any, coluna: string) => number | undefined,
 *   chaveColunas: string,
 *   buscaPlaceholder: string,
 *   vazio: string,
 *   arquivoCsv: string,
 *   rotuloDoItem: (item: any) => string,
 *   codigoDoItem?: (item: any) => string | undefined,
 *   textoDeBusca: (item: any) => string,
 *   formId: string,
 *   formulario: (p: { item: any, readOnly: boolean, onSalvo: (gravada?: any) => void, onSalvandoChange: (v: boolean) => void, chave: string }) => React.ReactNode,
 *   onNovo: () => void,
 *   rotuloNovo?: string,
 *   acoes: (p: { selecionados: any[], registro: any | null }) => Array<{ key: string, label: string, icon?: React.ReactNode, disabled?: boolean, hidden?: boolean, onSelect: () => void }>,
 *   excluir: (ids: string[], itens: any[]) => Promise<void>,
 *   dialogoExcluir: { title: string, descriptionOne: string, descriptionMany: (n: number) => string },
 * }} props
 */
export default function TelaCadastroMapa({
  titulo,
  abas,
  queryKey,
  carregar,
  habilitado,
  colunas,
  valor,
  celula,
  comparar,
  chaveColunas,
  buscaPlaceholder,
  vazio,
  arquivoCsv,
  rotuloDoItem,
  codigoDoItem,
  textoDeBusca,
  formId,
  formulario,
  onNovo,
  rotuloNovo = "Novo",
  acoes,
  excluir,
  dialogoExcluir,
}) {
  const queryClient = useQueryClient();
  const [salvando, setSalvando] = useState(false);
  const excluirRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));

  const controller = useCadastroBase1FullListController({
    storageKey: chaveColunas,
    columnIds: colunas.map((c) => c.id),
    listEnabled: habilitado,
    queryKey,
    fetchAll: carregar,
    duplicateLabelField: "nome",
    exportFileName: arquivoCsv,
    exportColumns: colunas,
    getExportFieldValue: valor,
    getRecordTitle: (item) => (item ? rotuloDoItem(item) : titulo),
    getRecordCode: (item) => (item && codigoDoItem ? codigoDoItem(item) : undefined),
    getSearchHaystack: textoDeBusca,
    mapSearchSuggestion: (item) => ({ id: String(item.id), label: rotuloDoItem(item), secondary: codigoDoItem?.(item) || undefined }),
    matchRowId: (item, id) => String(item.id) === String(id),
    getRowId: (item) => String(item.id),
    findRowById: (rows, id) => rows.find((r) => String(r.id) === String(id)),
    // O formulário do registro grava sozinho (mesma regra do painel do desenho); a barra só dispara o submit.
    onSubmitRecord: () => {},
    onRequestDeleteMutation: (ids) => excluirRef.current(ids),
  });

  excluirRef.current = (ids) => {
    const itens = controller.allItems.filter((item) => ids.includes(String(item.id)));
    void excluir(ids, itens).then(() => {
      controller.chrome.setSelectedIds([]);
      if (controller.showForm && controller.editingItem?.id && ids.includes(String(controller.editingItem.id))) {
        controller.recordHelpers.closeForm();
      }
    });
  };

  const selecionados = useMemo(
    () => controller.allItems.filter((item) => controller.chrome.selectedIds.includes(String(item.id))),
    [controller.allItems, controller.chrome.selectedIds],
  );
  const registro = controller.showForm ? controller.editingItem : null;

  // Registro aberto agora (o salvar termina depois do refetch; o usuário pode ter trocado de registro).
  const registroAbertoRef = useRef(/** @type {any} */ (null));
  registroAbertoRef.current = registro;
  const editandoRef = useRef(false);
  editandoRef.current = controller.isEditing;
  const { setEditingItem, setIsEditing, recarregarLista, recordHelpers } = controller;
  const { bumpFormEpoch } = recordHelpers;

  /**
   * Depois de gravar: trava o registro e troca o `editingItem` pela linha recarregada da lista,
   * para o título, o código e os campos mostrarem o que foi gravado (não o objeto aberto antes).
   * O formulário entrega o registro gravado (área, linha); a linha da lista vem enriquecida
   * (setor, áreas do ponto), então ela prevalece quando chega.
   * @param {any} [gravada]
   */
  const aoSalvar = useCallback(
    async (gravada) => {
      const id = registroAbertoRef.current?.id;
      setIsEditing(false);
      const mesmoRegistro = (atual) => id != null && atual?.id != null && String(atual.id) === String(id);
      if (gravada && typeof gravada === "object" && mesmoRegistro(gravada)) {
        setEditingItem((atual) => (mesmoRegistro(atual) ? { ...atual, ...gravada } : atual));
        bumpFormEpoch();
      }
      // A lista desta aba e as leituras do Mapa Geral ('mapa-cache').
      void invalidarCachesDoMapa(queryClient, [/** @type {string} */ (queryKey[0])]);
      if (id == null) return;
      try {
        const resultado = await recarregarLista();
        const linha = (resultado?.data ?? []).find((r) => String(r?.id) === String(id));
        // Não remonta por cima de uma nova edição já aberta (perderia o que está sendo digitado).
        if (!linha || !mesmoRegistro(registroAbertoRef.current) || editandoRef.current) return;
        setEditingItem((atual) => (mesmoRegistro(atual) ? linha : atual));
        bumpFormEpoch();
      } catch {
        /* a lista mostra o próprio erro de carregamento */
      }
    },
    [queryClient, queryKey, recarregarLista, setEditingItem, setIsEditing, bumpFormEpoch],
  );

  // Cancelar a edição de um registro gravado descarta o digitado: o motor só sai do modo
  // edição, então o formulário (estado inicializado do `item`) precisa remontar (formEpoch).
  const cancelarEdicao = useCallback(() => {
    if (controller.isEditing && controller.editingItem?.id) bumpFormEpoch();
    controller.cancelForm();
  }, [controller, bumpFormEpoch]);

  const screenController = { ...controller, saving: salvando, openNew: onNovo, cancelForm: cancelarEdicao };
  const acoesDisponiveis = acoes({ selecionados, registro });
  const alvoEdicao = registro || (selecionados.length === 1 ? selecionados[0] : null);
  const editarMapa = alvoEdicao ? acoes({ selecionados, registro: alvoEdicao }).find((acao) => acao.key === "editar-no-mapa" && !acao.hidden) : null;
  const rotuloGeometria = editarMapa?.label.includes("posição") ? "Editar posição" : editarMapa?.label.includes("traçado") ? "Editar traçado" : "Editar área";

  return (
    <CadastroBase1Screen
      workspaceTitle={titulo}
      searchPlaceholder={buscaPlaceholder}
      createLabel={rotuloNovo}
      formId={formId}
      columnsForCardsToolbar={colunas}
      controller={screenController}
      listErrorMessage="Não foi possível carregar a lista. Verifique sua conexão e tente novamente."
      recordCode={registro && codigoDoItem ? codigoDoItem(registro) : undefined}
      listBanner={controller.showForm ? null : abas}
      showDuplicate={false}
      showEdit={false}
      extraToolbar={alvoEdicao && !controller.isEditing ? (
        <Menu.Root modal={false}>
          {/* O menu pode desmontar ao abrir o editor; não deve bloquear a página. */}
          <Menu.Trigger asChild>
            <PillBtn type="button" tone="gray" disabled={salvando} aria-label="Editar" title="Editar">
              <Pencil className="h-4 w-4" aria-hidden="true" />
              <span>Editar</span><ChevronDown className="h-3 w-3" aria-hidden="true" />
            </PillBtn>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content align="start" sideOffset={6} className="z-[100] min-w-48 rounded-lg border bg-white p-1 text-sm shadow-lg">
              <Menu.Item className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 outline-none focus:bg-slate-100" onSelect={() => controller.handleEditSelected()}>
                <Pencil className="h-4 w-4" aria-hidden="true" />Editar detalhes
              </Menu.Item>
              {editarMapa ? (
                <Menu.Item disabled={salvando || editarMapa.disabled} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 outline-none focus:bg-slate-100 data-[disabled]:opacity-50" onSelect={editarMapa.onSelect}>
                  <MapPinned className="h-4 w-4" aria-hidden="true" />{rotuloGeometria}
                </Menu.Item>
              ) : null}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      ) : null}
      additionalMoreActions={acoesDisponiveis.flatMap((acao) => acao.key !== "editar-no-mapa" ? [acao] : (
        controller.isEditing && editarMapa ? [{
          ...acao,
          label: `${acao.label} — salve ou cancele os detalhes primeiro`,
          icon: <MapPinned className="h-4 w-4" aria-hidden="true" />,
          whileEditing: true,
          disabled: true,
        }] : []
      ))}
      deleteDialog={dialogoExcluir}
      recordForm={
        registro
          ? formulario({
              item: registro,
              readOnly: !controller.isEditing,
              onSalvo: aoSalvar,
              onSalvandoChange: setSalvando,
              // Cancelar a edição remonta o formulário com os dados gravados (formEpoch do motor).
              chave: `${registro.id}-${controller.formEpoch}`,
            })
          : null
      }
      listSlot={
        <CadastroBase1Grade
          rows={controller.visibleRows}
          columns={colunas}
          storageKey={chaveColunas}
          droppableId={`colunas-${chaveColunas}`}
          getFieldValue={valor}
          renderCell={celula}
          compararParaOrdenar={comparar}
          defaultSortKey="nome"
          emptyText={vazio}
          onOpen={controller.handleEdit}
          showConfigColunas={controller.showConfigColunas}
          setShowConfigColunas={controller.setShowConfigColunas}
          searchQuery=""
          matchesSearch={controller.matchesSearch}
          resetFiltersKey={controller.chrome.resetFiltersKey}
          configureColumnsAnchorRef={controller.configureColumnsAnchorRef}
          isLoading={controller.isLoading}
          onSelectionChange={controller.chrome.onSelectionChange}
          onFiltersActiveChange={controller.chrome.setFiltersActive}
          viewMode={controller.chrome.viewMode === "cards" ? "cards" : "table"}
          cardFields={controller.cardsPrefs.cardFields}
          cardsPerRow={controller.cardsPrefs.cardsPerRow}
          cardsTitleColId="nome"
          cardsCodeColId="codigo"
        />
      }
    />
  );
}
