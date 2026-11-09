import React, { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RECURSOS_CATALOGO,
  alterarSituacaoCatalogo,
  atualizarCatalogo,
  criarCatalogo,
  instalarCatalogoPadrao,
  listarCatalogoPagina,
  resumoCatalogoPadrao,
} from "@/services/patrimonioCatalogoService";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import GradePatrimonio from "@/components/patrimonio/GradePatrimonio";
import { FAMILIAS_CAMPOS_CARD, GRADE_FAMILIAS } from "@/components/patrimonio/TabelaFamilias";
import { GRADE_TIPOS, TIPOS_CAMPOS_CARD } from "@/components/patrimonio/TabelaTipos";
import { GRADE_PERFIS, PERFIS_CAMPOS_CARD } from "@/components/patrimonio/TabelaPerfisMedicao";
import { COMBUSTIVEIS_CAMPOS_CARD, GRADE_COMBUSTIVEIS } from "@/components/patrimonio/TabelaCombustiveis";
import FormularioFamilia, { FORMULARIO_FAMILIA_ID } from "@/components/patrimonio/FormularioFamilia";
import FormularioTipo, { FORMULARIO_TIPO_ID } from "@/components/patrimonio/FormularioTipo";
import FormularioPerfilMedicao, { FORMULARIO_PERFIL_MEDICAO_ID } from "@/components/patrimonio/FormularioPerfilMedicao";
import FormularioCombustivel, { FORMULARIO_COMBUSTIVEL_ID } from "@/components/patrimonio/FormularioCombustivel";
import { FiltroOpcoes } from "@/components/patrimonio/PatrimonioFormParts";
import { AvisoGestao, FiltroSituacao, ativoDoFiltro } from "@/components/gestao/GestaoFormParts";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaPatrimonio } from "@/hooks/usePatrimonioSessao";
import { TELAS_PATRIMONIO } from "@/lib/patrimonioPermissions";
import { NATUREZAS_PATRIMONIO, ROTULO_NATUREZA } from "@/lib/patrimonioDominio";
import { ehConflitoDeVersaoPatrimonio, ehNaoEncontradoPatrimonio, mensagemErroPatrimonio } from "@/lib/patrimonioErros";

/** Raiz das consultas dos catálogos (lista, detalhe do tipo) e dos seletores de patrimônio. */
const QUERY_RAIZ = "patrimonio-catalogo";
const QUERY_OPCOES = ["lancamentos-financeiros-gestao", "opcoes", "patrimonio"];

/** Configuração de cada tela de catálogo (mesma forma; rótulos, colunas e formulário próprios). */
export const CONFIG_CATALOGOS = Object.freeze({
  familias: Object.freeze({
    tela: TELAS_PATRIMONIO.FAMILIAS,
    titulo: "Famílias Patrimoniais",
    rotulo: "família patrimonial",
    plural: "famílias patrimoniais",
    novo: "Nova família patrimonial",
    vazio: "Nenhuma família patrimonial encontrada",
    criado: "Família patrimonial criada",
    atualizado: "Família patrimonial atualizada",
    inativado: "Família patrimonial inativada",
    reativado: "Família patrimonial reativada",
    efeitoInativar: "Ela deixa de ser oferecida para novos tipos e bens; os bens já cadastrados continuam legíveis. Nada é apagado.",
    efeitoReativar: "Ela volta a ser oferecida para novos tipos e bens.",
    exportFileName: "familias-patrimoniais.csv",
    formId: FORMULARIO_FAMILIA_ID,
    Formulario: FormularioFamilia,
    grade: GRADE_FAMILIAS,
    camposCard: FAMILIAS_CAMPOS_CARD,
  }),
  tipos: Object.freeze({
    tela: TELAS_PATRIMONIO.TIPOS,
    titulo: "Tipos Patrimoniais",
    rotulo: "tipo patrimonial",
    plural: "tipos patrimoniais",
    novo: "Novo tipo patrimonial",
    vazio: "Nenhum tipo patrimonial encontrado",
    criado: "Tipo patrimonial criado",
    atualizado: "Tipo patrimonial atualizado",
    inativado: "Tipo patrimonial inativado",
    reativado: "Tipo patrimonial reativado",
    efeitoInativar: "Ele deixa de ser oferecido para novos bens; os bens já cadastrados continuam legíveis. Nada é apagado.",
    efeitoReativar: "Ele volta a ser oferecido para novos bens.",
    exportFileName: "tipos-patrimoniais.csv",
    formId: FORMULARIO_TIPO_ID,
    Formulario: FormularioTipo,
    grade: GRADE_TIPOS,
    camposCard: TIPOS_CAMPOS_CARD,
  }),
  "perfis-medicao": Object.freeze({
    tela: TELAS_PATRIMONIO.PERFIS_MEDICAO,
    titulo: "Perfis de Medição",
    rotulo: "perfil de medição",
    plural: "perfis de medição",
    novo: "Novo perfil de medição",
    vazio: "Nenhum perfil de medição encontrado",
    criado: "Perfil de medição criado",
    atualizado: "Perfil de medição atualizado",
    inativado: "Perfil de medição inativado",
    reativado: "Perfil de medição reativado",
    efeitoInativar: "Ele deixa de ser oferecido para novas medições; as medições já gravadas continuam legíveis. Nada é apagado.",
    efeitoReativar: "Ele volta a ser oferecido para novas medições.",
    exportFileName: "perfis-medicao.csv",
    formId: FORMULARIO_PERFIL_MEDICAO_ID,
    Formulario: FormularioPerfilMedicao,
    grade: GRADE_PERFIS,
    camposCard: PERFIS_CAMPOS_CARD,
  }),
  combustiveis: Object.freeze({
    tela: TELAS_PATRIMONIO.COMBUSTIVEIS,
    titulo: "Combustíveis",
    rotulo: "combustível",
    plural: "combustíveis",
    novo: "Novo combustível",
    vazio: "Nenhum combustível encontrado",
    criado: "Combustível criado",
    atualizado: "Combustível atualizado",
    inativado: "Combustível inativado",
    reativado: "Combustível reativado",
    efeitoInativar: "Ele deixa de ser oferecido para novos tanques; os tanques que já o usam continuam legíveis. Nada é apagado.",
    efeitoReativar: "Ele volta a ser oferecido para novos tanques.",
    exportFileName: "combustiveis.csv",
    formId: FORMULARIO_COMBUSTIVEL_ID,
    Formulario: FormularioCombustivel,
    grade: GRADE_COMBUSTIVEIS,
    camposCard: COMBUSTIVEIS_CAMPOS_CARD,
  }),
});

const OPCOES_FILTRO_NATUREZA = [{ value: "TODAS", label: "Todas as naturezas" }, ...NATUREZAS_PATRIMONIO.map((n) => ({ value: n, label: ROTULO_NATUREZA[n] }))];

/** @param {string} s */
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Resumo da instalação do catálogo padrão (criados, já existentes, conflitos).
 * @param {{ resumo: { criados: string, existentes: string, conflitos: string[] }, onFechar: () => void }} props
 */
function ResumoCatalogoPadrao({ resumo, onFechar }) {
  return (
    <AvisoGestao tone="blue" testId="patrimonio-catalogo-padrao-resumo">
      <p className="font-semibold">Catálogo padrão instalado.</p>
      <p>Criados: {resumo.criados}.</p>
      <p>Já existiam: {resumo.existentes}.</p>
      {resumo.conflitos.length ? (
        <>
          <p>Conflitos ({resumo.conflitos.length}) — nada foi alterado nesses itens:</p>
          <ul className="list-disc pl-5">
            {resumo.conflitos.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>Sem conflitos.</p>
      )}
      <button type="button" className="mt-1 underline" onClick={onFechar}>
        Fechar resumo
      </button>
    </AvisoGestao>
  );
}

/**
 * Tela Motor Base1 de um catálogo de Patrimônio e Frota (D-PROD-157): lista
 * keyset com busca no servidor e filtro de situação (e de natureza, nas
 * famílias); formulário próprio de cada catálogo.
 *
 * Catálogos são do TENANT: não pedem empresa. Sem exclusão física e sem chave
 * Ativo no formulário: inativar/reativar é ação do menu (com confirmação) e
 * exige a ação extra `inativar`. Nas Famílias, o administrador instala o
 * catálogo padrão (idempotente) e vê o resumo.
 *
 * @param {{ recurso: 'familias'|'tipos'|'perfis-medicao'|'combustiveis' }} props
 */
export default function CatalogoPatrimonioTela({ recurso }) {
  const cfg = CONFIG_CATALOGOS[recurso];
  const queryClient = useQueryClient();
  const acoes = useAcoesTelaPatrimonio(cfg.tela);
  const [situacao, setSituacao] = useState("ativos");
  const [natureza, setNatureza] = useState("TODAS");
  const [resumoPadrao, setResumoPadrao] = useState(/** @type {ReturnType<typeof resumoCatalogoPadrao>|null} */ (null));
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const ehFamilias = recurso === RECURSOS_CATALOGO.FAMILIAS;

  const fetchPage = useCallback(
    ({ limit, cursor, q }) =>
      listarCatalogoPagina(recurso, {
        limit,
        cursor,
        q: q || undefined,
        ativo: ativoDoFiltro(situacao),
        natureza: ehFamilias && natureza !== "TODAS" ? natureza : undefined,
      }),
    [recurso, ehFamilias, situacao, natureza],
  );

  const controller = useCadastroBase1Controller({
    storageKey: cfg.grade.storageKey,
    columnIds: cfg.camposCard,
    listEnabled: acoes.ver,
    queryKey: [QUERY_RAIZ, recurso, "page", situacao, natureza],
    fetchPage,
    duplicateLabelField: "nome",
    searchPlaceholder: `Buscar ${cfg.plural}…`,
    exportFileName: cfg.exportFileName,
    exportColumns: cfg.grade.colunas,
    getExportFieldValue: cfg.grade.getFieldValue,
    getRecordTitle: (item) => (item?.id ? item.nome || capital(cfg.rotulo) : cfg.novo),
    // Rascunho de "Duplicar" herda o código do original: código só de registro gravado.
    getRecordCode: (item) => (item?.id && item?.codigo ? String(item.codigo) : undefined),
    getSearchHaystack: (r) => [r.codigo, r.nome, r.descricao].filter((v) => v != null).join(" "),
    mapSearchSuggestion: (r) => ({ id: String(r.id), label: r.nome || capital(cfg.rotulo), secondary: r.codigo || undefined }),
    matchRowId: (r, id) => String(r.id) === String(id),
    getRowId: (r) => String(r.id),
    findRowById: (rows, id) => rows.find((r) => String(r.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    // Sem exclusão física: a grade não oferece "Excluir" (inativar é ação própria).
    onRequestDeleteMutation: () => {},
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, recurso] });
    queryClient.invalidateQueries({ queryKey: QUERY_OPCOES });
  };

  const mostrarRegistro = (registro) => {
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(registro);
    controller.setIsEditing(false);
    controller.recordHelpers.bumpFormEpoch();
  };

  const tratarErro = (err, fallback) => {
    if (ehNaoEncontradoPatrimonio(err)) {
      invalidar();
      controller.recordHelpers.closeForm();
    } else if (ehConflitoDeVersaoPatrimonio(err)) {
      // Outra pessoa gravou antes: a lista relê a versão atual; o formulário
      // em edição continua aberto para a pessoa conferir o que digitou.
      invalidar();
    }
    notifyWarning("Atenção", mensagemErroPatrimonio(err, fallback));
  };

  const createMutation = useMutation({
    /** @param {{ data: object }} v */
    mutationFn: ({ data }) => criarCatalogo(recurso, /** @type {Record<string, any>} */ (data)),
    onSuccess: (criado) => {
      invalidar();
      if (criado && typeof criado === "object" && "id" in criado && criado.id) {
        mostrarRegistro(criado);
        controller.recordHelpers.chrome.onSelectionChange([String(criado.id)]);
      } else {
        controller.recordHelpers.closeForm();
      }
      notifySuccess("Sucesso", cfg.criado);
    },
    onError: (err) => tratarErro(err, `Não foi possível salvar o cadastro (${cfg.rotulo}).`),
  });

  const updateMutation = useMutation({
    /** @param {{ original: any, data: object }} v */
    mutationFn: ({ original, data }) => atualizarCatalogo(recurso, original, /** @type {Record<string, any>} */ (data)),
    onSuccess: ({ alterado, registro }) => {
      if (!alterado) {
        controller.setIsEditing(false);
        notifyInfo("Sem alterações", "Nada foi alterado.");
        return;
      }
      invalidar();
      mostrarRegistro(registro);
      notifySuccess("Sucesso", cfg.atualizado);
    },
    onError: (err) => tratarErro(err, `Não foi possível salvar o cadastro (${cfg.rotulo}).`),
  });

  const situacaoMutation = useMutation({
    /** @param {{ alvo: any, ativo: boolean }} v */
    mutationFn: ({ alvo, ativo }) => alterarSituacaoCatalogo(recurso, alvo, ativo),
    onSuccess: (registro, { alvo, ativo }) => {
      invalidar();
      const aberto = controller.showForm && String(controller.editingItem?.id) === String(alvo.id);
      if (aberto && registro && typeof registro === "object") mostrarRegistro(registro);
      notifySuccess("Sucesso", ativo ? cfg.reativado : cfg.inativado);
    },
    onError: (err, { ativo }) => tratarErro(err, ativo ? "Não foi possível reativar." : "Não foi possível inativar."),
  });

  const padraoMutation = useMutation({
    mutationFn: () => instalarCatalogoPadrao(),
    onSuccess: (resultado) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });
      queryClient.invalidateQueries({ queryKey: QUERY_OPCOES });
      setResumoPadrao(resumoCatalogoPadrao(resultado));
      notifySuccess("Catálogo padrão", "Instalação concluída. Confira o resumo acima da lista.");
    },
    onError: (err) => notifyWarning("Atenção", mensagemErroPatrimonio(err, "Não foi possível instalar o catálogo padrão.")),
  });

  submitRef.current = (data) => {
    const original = controller.editingItem;
    if (original?.id) {
      if (!acoes.editar) return;
      updateMutation.mutate({ original, data });
    } else {
      if (!acoes.criar) return;
      createMutation.mutate({ data });
    }
  };

  /** @param {any} alvo @param {boolean} ativo */
  const pedirSituacao = async (alvo, ativo) => {
    const verbo = ativo ? "Reativar" : "Inativar";
    const ok = await confirmar({
      titulo: `${verbo} ${cfg.rotulo}`,
      descricao: `${verbo} "${alvo.nome || cfg.rotulo}"? ${ativo ? cfg.efeitoReativar : cfg.efeitoInativar}`,
      textoConfirmar: verbo,
      perigo: !ativo,
    });
    if (ok) situacaoMutation.mutate({ alvo, ativo });
  };

  const pedirCatalogoPadrao = async () => {
    const ok = await confirmar({
      titulo: "Instalar catálogo padrão",
      descricao:
        "Cria só o que ainda falta, pelo código: famílias, tipos, perfis de medição e combustíveis de uso comum. Nada do que já existe é alterado; itens com o mesmo código e outra classificação aparecem como conflito.",
      textoConfirmar: "Instalar",
    });
    if (ok) padraoMutation.mutate();
  };

  const saving = createMutation.isPending || updateMutation.isPending || situacaoMutation.isPending;
  const registroAtual = controller.editingItem;

  // Alvo de inativar/reativar: o registro aberto (fora da edição) ou a única linha selecionada.
  const alvo = useMemo(() => {
    if (controller.showForm) return registroAtual?.id && !controller.isEditing ? registroAtual : null;
    const ids = controller.chrome.selectedIds;
    if (ids.length !== 1) return null;
    return controller.visibleRows.find((r) => String(r.id) === String(ids[0])) ?? null;
  }, [controller.showForm, controller.isEditing, registroAtual, controller.chrome.selectedIds, controller.visibleRows]);

  /** @type {Array<{ key: string, label: string, disabled?: boolean, onSelect: () => void }>} */
  const acoesDoMenu = [];
  if (acoes.inativar && alvo && Number.isInteger(alvo.versao)) {
    const reativar = alvo.ativo === false;
    acoesDoMenu.push({
      key: reativar ? "reativar" : "inativar",
      label: `${reativar ? "Reativar" : "Inativar"} ${cfg.rotulo}`,
      disabled: situacaoMutation.isPending,
      onSelect: () => {
        pedirSituacao(alvo, reativar);
      },
    });
  }
  if (ehFamilias && acoes.administrador) {
    acoesDoMenu.push({
      key: "catalogo-padrao",
      label: "Instalar catálogo padrão",
      disabled: padraoMutation.isPending,
      onSelect: () => {
        pedirCatalogoPadrao();
      },
    });
  }

  const listErrorMessage = useMemo(
    () => mensagemErroPatrimonio(controller.listaQueryError, `Não foi possível carregar ${cfg.plural}. Verifique sua conexão e tente novamente.`),
    [controller.listaQueryError, cfg.plural],
  );

  const semPermissao = !acoes.carregando && !acoes.ver;
  const Formulario = cfg.Formulario;

  /** Cancelar a edição de um registro gravado descarta o digitado: o formulário remonta do registro. */
  const cancelarEdicao = () => {
    if (controller.isEditing && controller.editingItem?.id) controller.recordHelpers.bumpFormEpoch();
    controller.cancelForm();
  };

  return (
    // Os botões já seguem a regra EXATA do servidor (novo|salvar, editar|salvar,
    // inativar) — a heurística de texto do Layout não se aplica.
    <div data-permissao-explicita="" className="contents">
      <CadastroBase1Screen
        permissaoExplicita
        workspaceTitle={cfg.titulo}
        searchPlaceholder={`Buscar ${cfg.plural}…`}
        formId={cfg.formId}
        columnsForCardsToolbar={cfg.grade.colunas}
        controller={{ ...controller, saving, cancelForm: cancelarEdicao }}
        listErrorMessage={listErrorMessage}
        recordCode={registroAtual?.id && registroAtual?.codigo ? String(registroAtual.codigo) : undefined}
        listBanner={
          semPermissao || resumoPadrao ? (
            <>
              {semPermissao ? <AvisoGestao testId="patrimonio-sem-permissao">Você não tem permissão para visualizar {cfg.titulo}.</AvisoGestao> : null}
              {resumoPadrao ? <ResumoCatalogoPadrao resumo={resumoPadrao} onFechar={() => setResumoPadrao(null)} /> : null}
            </>
          ) : null
        }
        showCreate={acoes.criar}
        showDuplicate={acoes.criar}
        showEdit={acoes.editar}
        showDelete={false}
        extraToolbar={
          <>
            {ehFamilias ? <FiltroOpcoes rotulo="Filtrar por natureza" value={natureza} onChange={setNatureza} opcoes={OPCOES_FILTRO_NATUREZA} /> : null}
            <FiltroSituacao value={situacao} onChange={setSituacao} />
          </>
        }
        additionalMoreActions={acoesDoMenu.length ? acoesDoMenu : null}
        deleteDialog={{
          title: `Inativar ${cfg.rotulo}`,
          confirmText: "Inativar",
          descriptionOne: cfg.efeitoInativar,
          descriptionMany: () => cfg.efeitoInativar,
        }}
        recordForm={
          <Formulario
            key={`${registroAtual?.id ?? `${recurso}-novo`}-${controller.formEpoch}`}
            readOnly={!controller.isEditing}
            initialData={registroAtual}
            onSubmit={controller.handleSubmit}
          />
        }
        listSlot={
          <GradePatrimonio
            definicao={cfg.grade}
            rows={controller.visibleRows}
            onEdit={controller.handleEdit}
            isLoading={controller.isLoading}
            emptyText={cfg.vazio}
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
