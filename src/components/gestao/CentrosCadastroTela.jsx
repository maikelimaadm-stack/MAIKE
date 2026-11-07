import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  alterarSituacaoCentro,
  atualizarCentro,
  caminhoDe,
  criarCentro,
  inativarCentros,
  listarCentrosPagina,
  listarOpcoesPai,
} from "@/services/centroService";
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import TabelaCentros, { CENTROS_COLUNAS, getCentroFieldValue } from "@/components/gestao/TabelaCentros";
import FormularioCentro from "@/components/gestao/FormularioCentro";
import { VinculosCentroCusto, VinculosCentroResultado } from "@/components/gestao/VinculosCentros";
import { AvisoGestao, FiltroSituacao, ativoDoFiltro } from "@/components/gestao/GestaoFormParts";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaGestao, useEmpresaRealSelecionadaId } from "@/hooks/useGestaoSessao";
import { TELAS_GESTAO } from "@/lib/gestaoPermissions";
import { ehNaoEncontradoGestao, mensagemErroGestao } from "@/lib/gestaoErros";

/** Configuração de cada tela (mesma forma, rótulos e chaves próprios). */
export const CONFIG_CENTROS = Object.freeze({
  custo: Object.freeze({
    tipo: /** @type {'custo'} */ ("custo"),
    tela: TELAS_GESTAO.CENTROS_CUSTO,
    titulo: "Centros de Custo",
    rotulo: "centro de custo",
    plural: "centros de custo",
    storageKey: "colunas_centros_custo_v1",
    droppableId: "colunas-centros-custo",
    formId: "formulario-centro-custo-base1",
    exportFileName: "centros-custo.csv",
  }),
  resultado: Object.freeze({
    tipo: /** @type {'resultado'} */ ("resultado"),
    tela: TELAS_GESTAO.CENTROS_RESULTADO,
    titulo: "Centros de Resultado",
    rotulo: "centro de resultado",
    plural: "centros de resultado",
    storageKey: "colunas_centros_resultado_v1",
    droppableId: "colunas-centros-resultado",
    formId: "formulario-centro-resultado-base1",
    exportFileName: "centros-resultado.csv",
  }),
});

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Tela Motor Base1 de Centros (D-PROD-145): lista com hierarquia (caminho e
 * pai), busca, filtro de situação; formulário com pai; inativar com
 * confirmação (sem exclusão física). No Centro de Custo, vínculo N:N com
 * Centros de Resultado; no Centro de Resultado, o vínculo é só leitura.
 *
 * @param {{ tipo: 'custo'|'resultado' }} props
 */
export default function CentrosCadastroTela({ tipo }) {
  const cfg = CONFIG_CENTROS[tipo];
  const queryRaiz = `centros-${tipo}-gestao`;
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaGestao(cfg.tela);
  const [situacao, setSituacao] = useState("ativos");
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));
  const podeGravar = Boolean(empresaId);

  const fetchPage = useCallback(
    ({ limit, cursor, q }) => listarCentrosPagina(tipo, empresaId, { limit, cursor, q: q || undefined, ativo: ativoDoFiltro(situacao) }),
    [tipo, empresaId, situacao],
  );

  const controller = useCadastroBase1Controller({
    storageKey: cfg.storageKey,
    columnIds: CENTROS_COLUNAS.map((c) => c.id),
    listEnabled: Boolean(empresaId) && acoes.ver,
    queryKey: [queryRaiz, "page", empresaId, situacao],
    fetchPage,
    duplicateLabelField: "nome",
    searchPlaceholder: `Buscar ${cfg.plural}…`,
    exportFileName: cfg.exportFileName,
    exportColumns: CENTROS_COLUNAS,
    getExportFieldValue: getCentroFieldValue,
    getRecordTitle: (item) => (item?.id ? item.nome || capital(cfg.rotulo) : `Novo ${cfg.rotulo}`),
    getRecordCode: (item) => (item?.numero != null ? String(item.numero) : undefined),
    getSearchHaystack: (c) => [c.nome, c.descricao, c.numero, c.pai_nome].filter((v) => v != null).join(" "),
    mapSearchSuggestion: (c) => ({ id: String(c.id), label: c.nome || capital(cfg.rotulo), secondary: c.pai_nome ? `em ${c.pai_nome}` : undefined }),
    matchRowId: (c, id) => String(c.id) === String(id),
    getRowId: (c) => String(c.id),
    findRowById: (rows, id) => rows.find((c) => String(c.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: (ids) => deleteRef.current(ids),
  });

  const empresaAnterior = useRef(empresaId);
  const { closeForm } = controller;
  useEffect(() => {
    if (empresaAnterior.current === empresaId) return;
    empresaAnterior.current = empresaId;
    closeForm();
  }, [empresaId, closeForm]);

  const registroAtual = controller.editingItem;
  const proprioId = registroAtual?.id ?? null;
  const editandoForm = controller.showForm && controller.isEditing;

  const opcoesPai = useQuery({
    queryKey: ["centros-gestao", tipo, "pais", empresaId, proprioId],
    queryFn: () => listarOpcoesPai(tipo, empresaId, proprioId),
    enabled: Boolean(empresaId) && editandoForm,
  });

  const rowsComCaminho = useMemo(() => {
    const porId = new Map(controller.lista.items.map((c) => [c.id, c]));
    return controller.visibleRows.map((c) => ({ ...c, caminho: caminhoDe(c, porId) }));
  }, [controller.visibleRows, controller.lista.items]);

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: [queryRaiz] });
    queryClient.invalidateQueries({ queryKey: ["centros-gestao"] });
  };

  const tratarErro = (err, fallback) => {
    if (ehNaoEncontradoGestao(err)) {
      invalidar();
      controller.recordHelpers.closeForm();
    }
    notifyWarning("Atenção", mensagemErroGestao(err, fallback));
  };

  const mostrarRegistro = (registro) => {
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(registro);
    controller.setIsEditing(false);
    controller.recordHelpers.bumpFormEpoch();
  };

  const createMutation = useMutation({
    /** @param {object} data */
    mutationFn: (data) => criarCentro(tipo, empresaId, data),
    onSuccess: (criado) => {
      invalidar();
      if (criado && typeof criado === "object" && "id" in criado && criado.id) {
        mostrarRegistro(criado);
        controller.recordHelpers.chrome.onSelectionChange([String(criado.id)]);
      } else {
        controller.recordHelpers.closeForm();
      }
      notifySuccess("Sucesso", `${capital(cfg.rotulo)} criado`);
    },
    onError: (err) => tratarErro(err, `Não foi possível salvar o ${cfg.rotulo}.`),
  });

  const updateMutation = useMutation({
    /** @param {{ original: any, data: object }} vars */
    mutationFn: ({ original, data }) => atualizarCentro(tipo, empresaId, original, data),
    onSuccess: ({ alterado, registro }) => {
      if (!alterado) {
        controller.setIsEditing(false);
        notifyInfo("Sem alterações", "Nada foi alterado.");
        return;
      }
      invalidar();
      mostrarRegistro(registro);
      notifySuccess("Sucesso", `${capital(cfg.rotulo)} atualizado`);
    },
    onError: (err) => tratarErro(err, `Não foi possível salvar o ${cfg.rotulo}.`),
  });

  const inativarMutation = useMutation({
    /** @param {string[]} ids */
    mutationFn: (ids) => inativarCentros(tipo, empresaId, ids),
    onSuccess: ({ ok, falhas }) => {
      invalidar();
      controller.chrome.setSelectedIds([]);
      if (controller.showForm && ok.some((id) => String(id) === String(controller.editingItem?.id))) {
        controller.recordHelpers.closeForm();
      }
      if (ok.length) notifySuccess("Sucesso", ok.length === 1 ? `${capital(cfg.rotulo)} inativado` : `${ok.length} ${cfg.plural} inativados`);
      if (falhas.length) {
        const motivo = mensagemErroGestao(falhas[0].erro, `Não foi possível inativar o ${cfg.rotulo}.`);
        notifyError("Atenção", falhas.length === 1 ? motivo : `${falhas.length} ${cfg.plural} não puderam ser inativados. ${motivo}`);
      }
    },
    onError: (err) => tratarErro(err, "Não foi possível inativar."),
  });

  const reativarMutation = useMutation({
    /** @param {string} id */
    mutationFn: (id) => alterarSituacaoCentro(tipo, empresaId, id, true),
    onSuccess: (registro) => {
      invalidar();
      if (registro && typeof registro === "object") mostrarRegistro(registro);
      notifySuccess("Sucesso", `${capital(cfg.rotulo)} reativado`);
    },
    onError: (err) => tratarErro(err, "Não foi possível reativar."),
  });

  submitRef.current = async (data) => {
    if (!podeGravar) {
      notifyWarning("Atenção", "Selecione uma empresa antes de gravar.");
      return;
    }
    const original = controller.editingItem;
    if (original?.id) {
      if (!acoes.editar) return;
      if (original.ativo !== false && /** @type {any} */ (data).ativo === false) {
        const ok = await confirmar({
          titulo: `Inativar ${cfg.rotulo}`,
          descricao: `Inativar este ${cfg.rotulo}? Ele deixa de ser oferecido para novos vínculos; nada é apagado.`,
          textoConfirmar: "Inativar",
          perigo: true,
        });
        if (!ok) return;
      }
      updateMutation.mutate({ original, data });
    } else {
      if (!acoes.criar) return;
      createMutation.mutate(data);
    }
  };
  deleteRef.current = (ids) => {
    if (!podeGravar || !acoes.editar) return;
    inativarMutation.mutate(ids);
  };

  const saving = createMutation.isPending || updateMutation.isPending || inativarMutation.isPending || reativarMutation.isPending;
  const podeReativar = acoes.editar && podeGravar && controller.showForm && registroAtual?.id && registroAtual.ativo === false;

  const listErrorMessage = useMemo(
    () => mensagemErroGestao(controller.listaQueryError, `Não foi possível carregar os ${cfg.plural}. Verifique sua conexão e tente novamente.`),
    [controller.listaQueryError, cfg.plural],
  );

  let aviso = null;
  if (!empresaId) {
    aviso = <AvisoGestao testId="gestao-sem-empresa">Selecione uma empresa no topo da tela para ver e gravar {cfg.plural}.</AvisoGestao>;
  } else if (!acoes.carregando && !acoes.ver) {
    aviso = <AvisoGestao testId="gestao-sem-permissao">Você não tem permissão para visualizar {cfg.titulo}.</AvisoGestao>;
  }

  const vinculos =
    registroAtual?.id && empresaId ? (
      tipo === "custo" ? (
        <VinculosCentroCusto empresaId={empresaId} centroCustoId={String(registroAtual.id)} podeEditar={acoes.editar && registroAtual.ativo !== false} />
      ) : (
        <VinculosCentroResultado empresaId={empresaId} centroResultadoId={String(registroAtual.id)} />
      )
    ) : null;

  return (
    <div data-permissao-explicita="" className="contents">
      <CadastroBase1Screen
        workspaceTitle={cfg.titulo}
        searchPlaceholder={`Buscar ${cfg.plural}…`}
        formId={cfg.formId}
        columnsForCardsToolbar={CENTROS_COLUNAS}
        controller={{ ...controller, saving }}
        listErrorMessage={listErrorMessage}
        recordCode={registroAtual?.numero != null ? String(registroAtual.numero) : undefined}
        listBanner={aviso}
        showCreate={podeGravar && acoes.criar}
        showDuplicate={podeGravar && acoes.criar}
        showEdit={podeGravar && acoes.editar}
        showDelete={podeGravar && acoes.editar}
        extraToolbar={<FiltroSituacao value={situacao} onChange={setSituacao} />}
        additionalMoreActions={
          podeReativar ? [{ key: "reativar", label: `Reativar ${cfg.rotulo}`, onSelect: () => reativarMutation.mutate(String(registroAtual.id)) }] : null
        }
        deleteDialog={{
          title: `Inativar ${cfg.rotulo}`,
          confirmText: "Inativar",
          descriptionOne: `Inativar este ${cfg.rotulo}? Nada é apagado; ele pode ser reativado. Centros com filhos ativos não podem ser inativados.`,
          descriptionMany: (n) => `Inativar ${n} ${cfg.plural}? Nada é apagado; eles podem ser reativados.`,
        }}
        recordForm={
          <>
            <FormularioCentro
              key={`${registroAtual?.id ?? "centro-novo"}-${controller.formEpoch}`}
              formId={cfg.formId}
              rotulo={cfg.rotulo}
              readOnly={!controller.isEditing}
              initialData={registroAtual}
              onSubmit={controller.handleSubmit}
              opcoesPai={/** @type {any[]} */ (opcoesPai.data ?? [])}
              carregandoPais={opcoesPai.isLoading && editandoForm}
            />
            {vinculos}
          </>
        }
        listSlot={
          <TabelaCentros
            rows={rowsComCaminho}
            storageKey={cfg.storageKey}
            droppableId={cfg.droppableId}
            onEdit={controller.handleEdit}
            isLoading={controller.isLoading}
            emptyText={empresaId ? `Nenhum ${cfg.rotulo} encontrado` : "Selecione uma empresa"}
            showConfigColunas={controller.showConfigColunas}
            setShowConfigColunas={controller.setShowConfigColunas}
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
    </div>
  );
}
