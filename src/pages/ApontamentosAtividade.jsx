import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FiltrosDaTelaContext } from "@/components/cadastro/base1/FiltrosRapidos";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import { AvisoGestao, CampoSelect } from "@/components/gestao/GestaoFormParts";
import { CampoDia } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { DialogoAcao } from "@/components/financeiroGestao/DialogosLancamento";
import FormularioApontamentoAtividade, {
  FORMULARIO_APONTAMENTO_ATIVIDADE_ID,
} from "@/components/apontamentos-atividade/FormularioApontamentoAtividade";
import TabelaApontamentosAtividade, {
  APONTAMENTOS_ATIVIDADE_CAMPOS_CARD,
  APONTAMENTOS_ATIVIDADE_COLUNAS,
  APONTAMENTOS_ATIVIDADE_STORAGE_KEY,
  valorDoCampoApontamento,
} from "@/components/apontamentos-atividade/TabelaApontamentosAtividade";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaApontamento, useEmpresaRealSelecionadaId } from "@/hooks/useApontamentoAtividadeSessao";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { hojeNoFuso } from "@/lib/diaCivil";
import {
  CODIGOS_RELER_APONTAMENTO,
  NATUREZAS_MAQUINA,
  STATUS_CANCELADO,
  STATUS_CONFIRMADO,
  campoDoErroApontamento,
  codigoDoErroApontamento,
  mensagemErroApontamento,
  rotuloDaArea,
  rotuloDoBem,
} from "@/lib/apontamentoAtividadeRegras";
import { listEmpresas } from "@/services/empresaService";
import {
  atualizarApontamento,
  cancelarApontamento,
  criarApontamento,
  detalharApontamento,
  listarApontamentosPagina,
  listarAreasDoApontamento,
  listarOpcoesApontamento,
  listarTiposAtividade,
} from "@/services/apontamentoAtividadeService";

const QUERY_RAIZ = "apontamentos-atividade";

const OPCOES_SITUACAO = [
  { value: "TODOS", label: "Todas as situações" },
  { value: STATUS_CONFIRMADO, label: "Confirmados" },
  { value: STATUS_CANCELADO, label: "Cancelados" },
];

/** Formatação das mensagens do diálogo de ação (não há dinheiro neste diálogo). */
const CONTEXTO_MENSAGENS = Object.freeze({ locale: "pt-BR", moeda: "BRL", casas: 2 });

/**
 * Apontamentos de Atividade (D-PROD-188, Fatia C) — a EXECUÇÃO de um Tipo de
 * Atividade na EMPRESA selecionada. A TAREFA é a demanda; a ATIVIDADE é a
 * operação feita (máquina, implemento, operador, área, horário e produção).
 * Base enxuta, sem itens de custo.
 *
 * Lista keyset com filtros (tipo, máquina, área, período e situação) e busca
 * pelo nº no servidor. Novo e editar no formulário Base1; sem exclusão física:
 * o apontamento CONFIRMADO se cancela com motivo (ação Excluir da tela) e o
 * CANCELADO abre só leitura. Edição e cancelamento levam a `versao` lida.
 *
 * Salvaguardas de Gestão: sem empresa real nada é lido; trocar de empresa
 * fecha o registro e os diálogos; sem fuso da fazenda não há "hoje" nem hora,
 * então novo e editar ficam fechados (o servidor recusaria).
 */
export default function ApontamentosAtividade() {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaApontamento();
  const submitRef = useRef(/** @type {(data: any) => void} */ (() => {}));

  const [tipoFiltro, setTipoFiltro] = useState("");
  const [bemFiltro, setBemFiltro] = useState(/** @type {{ id: string, rotulo: string } | null} */ (null));
  const [areaFiltro, setAreaFiltro] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("TODOS");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const periodoInvertido = Boolean(dataDe && dataAte && dataDe > dataAte);
  const [cancelando, setCancelando] = useState(/** @type {any} */ (null));
  // Recusa do servidor que aponta um campo, presa ao registro em que aconteceu ('novo' ou o id).
  const [erroDoServidor, setErroDoServidor] = useState(/** @type {{ campo: string, mensagem: string, alvo: string } | null} */ (null));

  // Fuso da FAZENDA (o "hoje" e a hora do apontamento): o mesmo resumo de empresas do Layout.
  const empresasQuery = useQuery({
    queryKey: ["empresas"],
    queryFn: () => listEmpresas(),
    enabled: Boolean(empresaId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const fuso = useMemo(() => {
    const empresa = (Array.isArray(empresasQuery.data) ? empresasQuery.data : []).find((e) => String(e?.id) === String(empresaId));
    return typeof empresa?.fuso_horario === "string" && empresa.fuso_horario ? empresa.fuso_horario : null;
  }, [empresasQuery.data, empresaId]);
  const fusoOk = Boolean(fuso);
  const semFuso = Boolean(empresaId) && empresasQuery.isSuccess && !fuso;
  const hoje = hojeNoFuso(fuso);

  const { data: tipos = [] } = useQuery({
    queryKey: [QUERY_RAIZ, "tipos"],
    queryFn: () => listarTiposAtividade(),
    enabled: acoes.ver,
    staleTime: 30 * 1000,
  });
  const { data: areas = [] } = useQuery({
    queryKey: [QUERY_RAIZ, "areas", empresaId],
    queryFn: () => listarAreasDoApontamento(empresaId),
    enabled: Boolean(empresaId) && acoes.ver,
    staleTime: 30 * 1000,
  });

  const listEnabled = Boolean(empresaId) && acoes.ver && !periodoInvertido;

  const fetchPage = useCallback(
    (/** @type {{ limit: number, cursor: string|null, q?: string }} */ { limit, cursor, q }) =>
      listarApontamentosPagina(empresaId, {
        limit,
        cursor,
        q: q || undefined,
        tipoAtividadeId: tipoFiltro || null,
        bemId: bemFiltro?.id ?? null,
        areaId: areaFiltro || null,
        status: statusFiltro !== "TODOS" ? statusFiltro : null,
        dataDe: dataDe || null,
        dataAte: dataAte || null,
      }),
    [empresaId, tipoFiltro, bemFiltro, areaFiltro, statusFiltro, dataDe, dataAte],
  );

  const controller = useCadastroBase1Controller({
    storageKey: APONTAMENTOS_ATIVIDADE_STORAGE_KEY,
    columnIds: APONTAMENTOS_ATIVIDADE_CAMPOS_CARD,
    listEnabled,
    queryKey: [QUERY_RAIZ, "page", empresaId, tipoFiltro, bemFiltro?.id ?? null, areaFiltro, statusFiltro, dataDe, dataAte],
    fetchPage,
    duplicateLabelField: "numero",
    searchPlaceholder: "Buscar nº…",
    exportFileName: "apontamentos-atividade.csv",
    exportColumns: APONTAMENTOS_ATIVIDADE_COLUNAS,
    getExportFieldValue: valorDoCampoApontamento,
    getRecordTitle: (/** @type {any} */ item) => (item?.id ? `Apontamento nº ${item.numero ?? ""}` : "Novo apontamento de atividade"),
    getRecordCode: (/** @type {any} */ item) => (item?.id && item?.numero != null ? String(item.numero) : undefined),
    getSearchHaystack: (/** @type {any} */ a) =>
      [a.numero, a.tipo_atividade_nome, rotuloDoBem(a.bem), rotuloDaArea(a.area)].filter((v) => v != null && v !== "").join(" "),
    mapSearchSuggestion: (/** @type {any} */ a) => ({
      id: String(a.id),
      label: `Nº ${a.numero ?? ""} — ${a.tipo_atividade_nome ?? ""}`,
      secondary: rotuloDoBem(a.bem) || undefined,
    }),
    matchRowId: (/** @type {any} */ a, /** @type {string} */ id) => String(a.id) === String(id),
    getRowId: (/** @type {any} */ a) => String(a.id),
    findRowById: (/** @type {any[]} */ rows, /** @type {string} */ id) => rows.find((a) => String(a.id) === String(id)),
    onSubmitRecord: (/** @type {any} */ data) => submitRef.current(data),
    // Apontamento não se apaga: cancela com motivo (ação própria).
    onRequestDeleteMutation: () => {},
  });

  // Troca de empresa: nada da empresa anterior continua na tela.
  const empresaAnterior = useRef(empresaId);
  const { closeForm } = controller;
  useEffect(() => {
    if (empresaAnterior.current === empresaId) return;
    empresaAnterior.current = empresaId;
    closeForm();
    setCancelando(null);
    setBemFiltro(null);
    setAreaFiltro("");
    setErroDoServidor(null);
  }, [empresaId, closeForm]);
  // Resposta que chega depois de trocar a empresa não mexe no registro aberto da empresa nova.
  const empresaAtual = useRef(empresaId);
  empresaAtual.current = empresaId;
  /** @param {string|null|undefined} emp */
  const daEmpresaAtual = (emp) => Boolean(emp) && emp === empresaAtual.current;

  const invalidar = () => queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "page"] });

  /** Mostra o registro devolvido pelo servidor (somente leitura). @param {any} registro */
  const mostrarRegistro = (registro) => {
    if (!registro || typeof registro !== "object" || !registro.id) {
      controller.recordHelpers.closeForm();
      return;
    }
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(registro);
    controller.setIsEditing(false);
    controller.recordHelpers.setShowForm(true);
    controller.recordHelpers.bumpFormEpoch();
    controller.recordHelpers.chrome.setViewMode("record");
    controller.recordHelpers.chrome.onSelectionChange([String(registro.id)]);
  };

  /**
   * Recusa do servidor: relê o que mudou e destaca o campo apontado.
   * @param {unknown} erro @param {string} fallback @param {string} emp @param {string} alvo 'novo' ou o id do apontamento
   */
  const reagirAoErro = (erro, fallback, emp, alvo) => {
    const code = codigoDoErroApontamento(erro);
    if (code && CODIGOS_RELER_APONTAMENTO.includes(code)) {
      invalidar();
      if (code === "APONTAMENTO_ATIVIDADE_NOT_FOUND" && daEmpresaAtual(emp)) {
        setCancelando(null);
        closeForm();
      }
    }
    const mensagem = mensagemErroApontamento(erro, fallback);
    const campo = campoDoErroApontamento(erro);
    if (campo && daEmpresaAtual(emp)) setErroDoServidor({ campo, mensagem, alvo });
    return mensagem;
  };

  const createMutation = useMutation({
    /** @param {{ empresaId: string, data: Record<string, unknown> }} v */
    mutationFn: ({ empresaId: emp, data }) => criarApontamento(emp, data),
    onSuccess: (/** @type {any} */ criado, v) => {
      invalidar();
      if (!daEmpresaAtual(v.empresaId)) return notifyInfo("Gravação concluída", "O apontamento feito na empresa anterior foi gravado.");
      mostrarRegistro(criado);
      notifySuccess("Sucesso", `Apontamento nº ${criado?.numero ?? ""} registrado`);
    },
    onError: (err, v) => notifyWarning("Atenção", reagirAoErro(err, "Não foi possível salvar o apontamento.", v.empresaId, "novo")),
  });

  const updateMutation = useMutation({
    /** @param {{ empresaId: string, original: any, data: Record<string, any> }} v */
    mutationFn: ({ empresaId: emp, original, data }) => atualizarApontamento(emp, original, data),
    onSuccess: ({ alterado, registro }, v) => {
      if (!daEmpresaAtual(v.empresaId)) {
        invalidar();
        return notifyInfo("Gravação concluída", "O apontamento da empresa anterior foi atualizado.");
      }
      if (!alterado) {
        controller.setIsEditing(false);
        notifyInfo("Sem alterações", "Nada foi alterado.");
        return;
      }
      invalidar();
      mostrarRegistro(registro);
      notifySuccess("Sucesso", "Apontamento atualizado");
    },
    onError: (err, v) =>
      notifyWarning("Atenção", reagirAoErro(err, "Não foi possível salvar o apontamento.", v.empresaId, String(v.original?.id ?? "novo"))),
  });

  submitRef.current = (/** @type {Record<string, any>} */ data) => {
    if (!empresaId) {
      notifyWarning("Atenção", "Selecione uma fazenda antes de gravar.");
      return;
    }
    setErroDoServidor(null);
    const original = controller.editingItem;
    if (original?.id) {
      // Cancelado não aceita edição (o servidor também recusa).
      if (!acoes.editar || original.status !== STATUS_CONFIRMADO) return;
      updateMutation.mutate({ empresaId, original, data });
    } else {
      if (!acoes.criar) return;
      createMutation.mutate({ empresaId, data });
    }
  };

  // ─── Cancelamento ───────────────────────────────────────────────────
  /** @param {any} registro */
  const concluirCancelamento = (registro) => {
    invalidar();
    setCancelando(null);
    notifySuccess("Apontamento cancelado", `Apontamento nº ${registro?.numero ?? ""} cancelado. Ele continua no histórico; nada foi apagado.`);
    mostrarRegistro(registro);
  };

  /** @param {string} motivo */
  const enviarCancelamento = async (motivo) => {
    const registro = cancelando;
    const emp = empresaId;
    if (!registro || !emp) return;
    try {
      const r = await cancelarApontamento(emp, registro, motivo);
      if (daEmpresaAtual(emp)) concluirCancelamento(r);
    } catch (erro) {
      reagirAoErro(erro, "Não foi possível cancelar o apontamento. Nada foi alterado.", emp, String(registro.id));
      throw erro;
    }
  };

  /** "Consultar" depois de um envio sem resposta: relê o apontamento. */
  const consultarCancelamento = async () => {
    const registro = cancelando;
    const emp = empresaId;
    if (!registro || !emp) return;
    try {
      const atual = /** @type {any} */ (await detalharApontamento(emp, String(registro.id)));
      if (atual?.status === STATUS_CANCELADO) concluirCancelamento(atual);
      else notifyInfo("Ainda confirmado", "O cancelamento não foi gravado. Você pode repetir o envio.");
    } catch (erro) {
      notifyWarning("Atenção", mensagemErroApontamento(erro, "Não foi possível consultar agora. Tente de novo."));
    }
  };

  // ─── Avisos e filtros ───────────────────────────────────────────────
  const saving = createMutation.isPending || updateMutation.isPending;
  const registroAberto = controller.showForm && controller.editingItem?.id ? /** @type {any} */ (controller.editingItem) : null;
  const registroCancelado = registroAberto?.status === STATUS_CANCELADO;

  const listErrorMessage = useMemo(
    () => mensagemErroApontamento(controller.listaQueryError, "Não foi possível carregar os apontamentos. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  let aviso = null;
  if (!empresaId) {
    aviso = <AvisoGestao testId="apontamento-sem-empresa">Selecione uma fazenda para ver e lançar apontamentos de atividade.</AvisoGestao>;
  } else if (acoes.carregando) {
    aviso = (
      <AvisoGestao tone="blue" testId="apontamento-carregando">
        Carregando permissões…
      </AvisoGestao>
    );
  } else if (!acoes.ver) {
    aviso = <AvisoGestao testId="apontamento-sem-permissao">Você não tem permissão para ver os apontamentos de atividade desta fazenda.</AvisoGestao>;
  }

  const opcoesTipoFiltro = useMemo(
    () =>
      /** @type {any[]} */ (tipos).map((t) => ({
        value: String(t.id),
        label: `${String(t.nome_tipo ?? "")}${t.ativo === false ? " (INATIVO)" : ""}`,
      })),
    [tipos],
  );
  const opcoesAreaFiltro = useMemo(
    () => /** @type {any[]} */ (areas).map((a) => ({ value: String(a.id), label: rotuloDaArea(a) || String(a.id) })),
    [areas],
  );

  const filtros =
    empresaId && acoes.ver && !controller.showForm ? (
      <div className="cadastro-b1 mg-card mb-2 p-2" data-testid="apontamento-filtros">
        <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2">
          <CampoSelect label="Tipo de atividade" value={tipoFiltro} onChange={setTipoFiltro} options={opcoesTipoFiltro} placeholder="Todos os tipos" span={3} />
          <SeletorPaginadoGestao
            rotulo="Máquina/veículo"
            testId="apontamento-filtro-bem"
            chave={[QUERY_RAIZ, "bens-filtro", empresaId]}
            buscar={({ q, cursor, limit }) => listarOpcoesApontamento("bens", empresaId, { q, cursor, limit, natureza: NATUREZAS_MAQUINA })}
            value={bemFiltro}
            onChange={(o) => setBemFiltro(o ? { id: String(o.id), rotulo: rotuloDoBem(o) } : null)}
            rotuloDaOpcao={rotuloDoBem}
            permitirLimpar
            textoVazio="Todas as máquinas"
            span={3}
            maiusculas={false}
          />
          <CampoSelect label="Área" value={areaFiltro} onChange={setAreaFiltro} options={opcoesAreaFiltro} placeholder="Todas as áreas" span={2} />
          <CampoDia label="De" value={dataDe} onChange={setDataDe} span={2} testId="apontamento-filtro-de" />
          <CampoDia label="Até" value={dataAte} onChange={setDataAte} span={2} testId="apontamento-filtro-ate" />
        </div>
        {periodoInvertido ? (
          <p role="alert" className="mt-1 text-[12px] text-red-700" data-testid="apontamento-periodo-invertido">
            A data final do período é anterior à inicial.
          </p>
        ) : null}
      </div>
    ) : null;

  const listaVazia = listEnabled && !controller.showForm && !controller.isLoading && !controller.listaErro && controller.visibleRows.length === 0;

  const banner = (
    <>
      {aviso}
      {semFuso && acoes.ver ? (
        <AvisoGestao testId="apontamento-sem-fuso">
          Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de lançar ou editar apontamentos.
        </AvisoGestao>
      ) : null}
      {filtros}
      {listaVazia ? <AvisoGestao testId="apontamento-lista-vazia">Nenhum apontamento encontrado com estes filtros.</AvisoGestao> : null}
    </>
  );

  const podeGravar = Boolean(empresaId) && fusoOk;
  const filtrosDaTela =
    empresaId && acoes.ver
      ? [{ id: "status", rotulo: "Situação", nome: "Filtrar por situação", opcoes: OPCOES_SITUACAO, valor: statusFiltro, padrao: "TODOS", onChange: setStatusFiltro, coluna: "status" }]
      : [];

  const alvoAberto = registroAberto ? String(registroAberto.id) : "novo";
  const recordForm = controller.showForm ? (
    <FormularioApontamentoAtividade
      // Entrar ou sair da edição (✕) e a chegada do fuso remontam o formulário a partir do GRAVADO.
      key={`${registroAberto?.id ?? "apontamento-novo"}-${registroAberto?.versao ?? 0}-${controller.formEpoch}-${controller.isEditing ? "e" : "l"}-${fuso ?? "sem-fuso"}`}
      initialData={registroAberto}
      empresaId={empresaId}
      tipos={/** @type {any[]} */ (tipos)}
      areas={/** @type {any[]} */ (areas)}
      hoje={hoje}
      fuso={fuso}
      readOnly={!controller.isEditing}
      isSubmitting={saving}
      onSubmit={controller.handleSubmit}
      podeCancelar={acoes.cancelar && Boolean(empresaId)}
      onCancelar={() => setCancelando(registroAberto)}
      erroDoServidor={erroDoServidor?.alvo === alvoAberto ? erroDoServidor : null}
    />
  ) : null;

  return (
    // Os botões seguem a regra EXATA do servidor (novo|salvar, editar|salvar,
    // excluir = cancelar): a heurística de texto do Layout não se aplica.
    <div data-permissao-explicita="" className="contents">
      <FiltrosDaTelaContext.Provider value={filtrosDaTela}>
        <CadastroBase1Screen
          permissaoExplicita
          workspaceTitle="Apontamentos de atividade"
          searchPlaceholder="Buscar nº…"
          createLabel="Novo apontamento"
          formId={registroCancelado ? undefined : FORMULARIO_APONTAMENTO_ATIVIDADE_ID}
          columnsForCardsToolbar={APONTAMENTOS_ATIVIDADE_COLUNAS}
          controller={{ ...controller, saving }}
          listErrorMessage={listErrorMessage}
          recordCode={registroAberto?.numero != null ? String(registroAberto.numero) : undefined}
          listBanner={banner}
          showCreate={podeGravar && acoes.criar}
          showEdit={podeGravar && acoes.editar && !registroCancelado}
          showDuplicate={false}
          showDelete={false}
          deleteDialog={{
            title: "Cancelar apontamento",
            confirmText: "Cancelar",
            descriptionOne: "Apontamento não se exclui: use Cancelar apontamento.",
            descriptionMany: () => "Apontamento não se exclui: use Cancelar apontamento.",
          }}
          recordForm={recordForm}
          listSlot={
            <TabelaApontamentosAtividade
              rows={controller.visibleRows}
              onEdit={controller.handleEdit}
              isLoading={controller.isLoading}
              emptyText={empresaId ? "Nenhum apontamento encontrado com estes filtros." : "Selecione uma fazenda"}
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

        {cancelando ? (
          <DialogoAcao
            key={`cancelar-${cancelando.id}-${cancelando.versao}`}
            aberto
            titulo={`Cancelar apontamento ${cancelando.numero ? `nº ${cancelando.numero}` : ""}`.trim()}
            descricao="O apontamento continua no histórico como cancelado; nada é apagado e ele não aceita mais edição. Informe o motivo (pelo menos 3 caracteres)."
            rotuloBotao="Cancelar apontamento"
            testId="dialogo-cancelar-apontamento"
            contexto={CONTEXTO_MENSAGENS}
            onFechar={() => setCancelando(null)}
            onEnviar={enviarCancelamento}
            onConsultar={consultarCancelamento}
          />
        ) : null}
      </FiltrosDaTelaContext.Provider>
    </div>
  );
}
