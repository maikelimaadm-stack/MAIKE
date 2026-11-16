import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiltrosDaTelaContext } from "@/components/cadastro/base1/FiltrosRapidos";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import TabelaAbastecimentos, { ABASTECIMENTOS_CAMPOS_CARD, ABASTECIMENTOS_COLUNAS, ABASTECIMENTOS_STORAGE_KEY, valorDoCampoAbastecimento } from "@/components/patrimonio/TabelaAbastecimentos";
import FormularioAbastecimento, { FORMULARIO_ABASTECIMENTO_ID } from "@/components/patrimonio/FormularioAbastecimento";
import ConsultaAbastecimento from "@/components/patrimonio/ConsultaAbastecimento";
import PainelConsumoBem from "@/components/patrimonio/PainelConsumoBem";
import { DialogoCancelarAbastecimento, DialogoPreviaAbastecimento } from "@/components/patrimonio/DialogosAbastecimento";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { CampoDia } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaAbastecimento, useEmpresaRealSelecionadaId } from "@/hooks/usePatrimonioSessao";
import { QUERY_RAIZ_ABASTECIMENTOS as QUERY_RAIZ, useFluxoAbastecimento } from "@/hooks/useFluxoAbastecimento";
import { useAuth } from "@/lib/AuthContext";
import { notifyWarning } from "@/lib/maikeNotify";
import { hojeNoFuso } from "@/lib/diaCivil";
import { ehNaoEncontradoPatrimonio, mensagemErroAbastecimento } from "@/lib/patrimonioErros";
import { formatarQuantidade, formularioVazio, rotuloDoBem, totaisConfirmados } from "@/lib/abastecimentoRegras";
import { listEmpresas } from "@/services/empresaService";
import { detalharAbastecimento, listarAbastecimentosPagina, listarOpcoesAbastecimento } from "@/services/abastecimentoService";

const OPCOES_SITUACAO = [
  { value: "TODOS", label: "Todas as situações" },
  { value: "CONFIRMADO", label: "Confirmados" },
  { value: "CANCELADO", label: "Cancelados" },
];

/**
 * Abastecimentos (Patrimônio e Frota P1-02, D-PROD-159; simplificados pela
 * D-PROD-162) — da EMPRESA selecionada.
 *
 * Lista keyset com filtros (bem, produto, situação, período) e busca no
 * servidor (nº, referência); coluna Quantidade = número + unidade do Produto.
 * Novo abastecimento: máquina → PRODUTO (dos "Produtos aceitos" dos tanques do
 * bem) → tanque (se > 1) → local → quantidade na unidade do Produto (L ou kg) →
 * medidor → "Completou o tanque?" → REVISÃO = prévia no servidor (sem escrita:
 * baixa EXATA na unidade do Produto, lotes FIFO, custo estimado, medidor,
 * bloqueios) → confirmação com `operation_id` persistente (duplo clique = 1
 * envio; sem resposta = resultado incerto, nunca sucesso; repetir reaproveita a
 * chave). O registro gravado é só CONSULTA: quantidade e unidade, custo FIFO
 * final, lotes, movimento e estorno, leitura, consumo; o cancelamento (ação
 * própria `cancelar`) estorna exatamente aos lotes de origem. Sem fator kg/L e
 * sem tipo de combustível (D-PROD-162).
 *
 * Salvaguardas de Gestão: sem empresa real nada é lido; trocar de empresa
 * fecha registro e diálogos e descarta respostas atrasadas.
 */
export default function AbastecimentosTela() {
  const queryClient = useQueryClient();
  const { clienteId } = useAuth();
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaAbastecimento();
  const escopo = `${clienteId || "sem-tenant"}:${acoes.login || "sem-login"}`;

  const [bemFiltro, setBemFiltro] = useState(/** @type {{ id: string, rotulo: string } | null} */ (null));
  const [produtoFiltro, setProdutoFiltro] = useState(/** @type {{ id: string, rotulo: string } | null} */ (null));
  const [statusFiltro, setStatusFiltro] = useState("TODOS");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const periodoInvertido = Boolean(dataDe && dataAte && dataDe > dataAte);

  // Fuso da FAZENDA (o "hoje" do abastecimento): mesmo resumo de empresas do Layout.
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

  const [consumoBem, setConsumoBem] = useState(/** @type {any} */ (null));

  const listEnabled = Boolean(empresaId) && acoes.ver && !periodoInvertido;

  const fetchPage = useCallback(
    ({ limit, cursor, q }) =>
      listarAbastecimentosPagina(empresaId, {
        limit,
        cursor,
        q: q || undefined,
        bemId: bemFiltro?.id ?? null,
        produtoId: produtoFiltro?.id ?? null,
        status: statusFiltro !== "TODOS" ? statusFiltro : null,
        dataDe: dataDe || null,
        dataAte: dataAte || null,
      }),
    [empresaId, bemFiltro, produtoFiltro, statusFiltro, dataDe, dataAte],
  );

  const controller = useCadastroBase1Controller({
    storageKey: ABASTECIMENTOS_STORAGE_KEY,
    columnIds: ABASTECIMENTOS_CAMPOS_CARD,
    listEnabled,
    queryKey: [QUERY_RAIZ, "page", empresaId, bemFiltro?.id ?? null, produtoFiltro?.id ?? null, statusFiltro, dataDe, dataAte],
    fetchPage,
    duplicateLabelField: "numero",
    searchPlaceholder: "Buscar nº ou referência…",
    exportFileName: "abastecimentos.csv",
    exportColumns: ABASTECIMENTOS_COLUNAS,
    getExportFieldValue: valorDoCampoAbastecimento,
    getRecordTitle: (item) => (item?.id ? `Abastecimento nº ${item.numero ?? ""}` : "Novo abastecimento"),
    getRecordCode: (item) => (item?.id && item?.numero != null ? String(item.numero) : undefined),
    getSearchHaystack: (a) => [a.numero, a.referencia_externa, rotuloDoBem(a.bem), a.produto?.nome].filter((v) => v != null).join(" "),
    mapSearchSuggestion: (a) => ({ id: String(a.id), label: `Nº ${a.numero ?? ""} — ${rotuloDoBem(a.bem)}`, secondary: a.referencia_externa || undefined }),
    matchRowId: (a, id) => String(a.id) === String(id),
    getRowId: (a) => String(a.id),
    findRowById: (rows, id) => rows.find((a) => String(a.id) === String(id)),
    // O formulário não "salva": o ✓ e o botão "Revisar abastecimento" pedem a prévia.
    onSubmitRecord: () => {},
    // Abastecimento não se apaga: cancela com estorno (ação própria).
    onRequestDeleteMutation: () => {},
  });

  // Formulário, revisão, confirmação e cancelamento: o MESMO fluxo do Lançamento de Atividades (D-PROD-210).
  const fluxo = useFluxoAbastecimento({
    empresaId,
    hoje,
    podeCriar: acoes.criar,
    escopo,
    // Gravado (ou cancelado) com a fazenda ainda selecionada: abre a consulta do registro devolvido.
    onConcluido: (registro, emp) => abrirRegistro(registro, emp),
    onNaoEncontrado: () => controller.closeForm(),
  });
  const { form, setForm, erros, limparErro, previa, previaAberta, setPreviaAberta, previando, situacaoPrevia, cancelando, setCancelando } = fluxo;

  // Troca de empresa: nada da empresa anterior continua na tela.
  const empresaAnterior = useRef(empresaId);
  const trocandoEmpresa = empresaAnterior.current !== empresaId;
  const { closeForm } = controller;
  useEffect(() => {
    if (empresaAnterior.current === empresaId) return;
    empresaAnterior.current = empresaId;
    closeForm();
    fluxo.reiniciar();
    setConsumoBem(null);
    setBemFiltro(null);
    setProdutoFiltro(null);
  }, [empresaId, closeForm]);
  const empresaAtual = useRef(empresaId);
  empresaAtual.current = empresaId;
  /** @param {string|null} emp */
  const daEmpresaAtual = (emp) => Boolean(emp) && emp === empresaAtual.current;

  // Registro aberto: a lista traz o RESUMO; a consulta usa o DETALHE.
  const registroLista = controller.editingItem;
  const idAberto = controller.showForm && registroLista?.id ? String(registroLista.id) : null;
  const detalheQuery = useQuery({
    queryKey: [QUERY_RAIZ, "detalhe", empresaId, idAberto],
    queryFn: () => detalharAbastecimento(empresaId, /** @type {string} */ (idAberto)),
    enabled: Boolean(empresaId && idAberto && acoes.ver && !trocandoEmpresa),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const detalhe = /** @type {any} */ (detalheQuery.data ?? null);
  useEffect(() => {
    if (!detalheQuery.error) return;
    if (ehNaoEncontradoPatrimonio(detalheQuery.error)) {
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "page"] });
      closeForm();
    }
    notifyWarning("Atenção", mensagemErroAbastecimento(detalheQuery.error, "Não foi possível abrir o abastecimento."));
  }, [detalheQuery.error]);

  /** Novo abastecimento: formulário em branco no "hoje" da fazenda. */
  const abrirNovo = () => {
    fluxo.iniciar(formularioVazio(hoje));
    controller.openNew();
  };

  /** Mostra o detalhe devolvido pelo servidor (somente leitura). @param {any} registro @param {string} emp */
  const abrirRegistro = (registro, emp) => {
    if (!registro || typeof registro !== "object" || !registro.id) return;
    queryClient.setQueryData([QUERY_RAIZ, "detalhe", emp, String(registro.id)], registro);
    if (!daEmpresaAtual(emp)) return;
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(registro);
    controller.setIsEditing(false);
    controller.recordHelpers.setShowForm(true);
    controller.recordHelpers.bumpFormEpoch();
    controller.recordHelpers.chrome.onSelectionChange([String(registro.id)]);
  };

  // ─── Avisos e filtros ───────────────────────────────────────────────
  const listErrorMessage = useMemo(
    () => mensagemErroAbastecimento(controller.listaQueryError, "Não foi possível carregar os abastecimentos. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  let aviso = null;
  if (!empresaId) {
    aviso = <AvisoGestao testId="abastecimento-sem-empresa">Selecione uma fazenda para ver e lançar abastecimentos.</AvisoGestao>;
  } else if (acoes.carregando) {
    aviso = (
      <AvisoGestao tone="blue" testId="abastecimento-carregando">
        Carregando permissões…
      </AvisoGestao>
    );
  } else if (!acoes.ver) {
    aviso = <AvisoGestao testId="abastecimento-sem-permissao">Você não tem permissão para ver os abastecimentos desta fazenda.</AvisoGestao>;
  }

  const filtros =
    empresaId && acoes.ver && !controller.showForm ? (
      <div className="cadastro-b1 mg-card mb-2 p-2" data-testid="abastecimento-filtros">
        <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2">
          <SeletorPaginadoGestao
            rotulo="Bem"
            testId="abastecimento-filtro-bem"
            chave={["patrimonio", "abastecimento", "bens-filtro", empresaId]}
            buscar={({ q, cursor, limit }) => listarOpcoesAbastecimento("bens", empresaId, { q, cursor, limit, uso: "filtro" })}
            value={bemFiltro}
            onChange={(o) => setBemFiltro(o ? { id: String(o.id), rotulo: rotuloDoBem(o) } : null)}
            rotuloDaOpcao={rotuloDoBem}
            permitirLimpar
            textoVazio="Todos os bens"
            span={3}
            maiusculas={false}
          />
          <SeletorPaginadoGestao
            rotulo="Produto"
            testId="abastecimento-filtro-produto"
            chave={["patrimonio", "abastecimento", "produtos-filtro", empresaId]}
            buscar={({ q, cursor, limit }) => listarOpcoesAbastecimento("produtos-filtro", empresaId, { q, cursor, limit })}
            value={produtoFiltro}
            onChange={(o) => setProdutoFiltro(o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null)}
            permitirLimpar
            textoVazio="Todos os produtos"
            span={3}
            maiusculas={false}
          />
          <CampoDia label="De" value={dataDe} onChange={setDataDe} span={3} testId="abastecimento-filtro-de" />
          <CampoDia label="Até" value={dataAte} onChange={setDataAte} span={3} testId="abastecimento-filtro-ate" />
        </div>
        {periodoInvertido ? (
          <p role="alert" className="mt-1 text-[12px] text-red-700" data-testid="abastecimento-periodo-invertido">
            A data final do período é anterior à inicial.
          </p>
        ) : null}
      </div>
    ) : null;

  const listaVazia = listEnabled && !controller.showForm && !controller.isLoading && !controller.listaErro && controller.visibleRows.length === 0;
  const totais = !controller.showForm && controller.visibleRows.length ? totaisConfirmados(controller.visibleRows) : null;

  const banner = (
    <>
      {aviso}
      {semFuso && acoes.ver ? (
        <AvisoGestao testId="abastecimento-sem-fuso">
          Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de lançar abastecimentos.
        </AvisoGestao>
      ) : null}
      {filtros}
      {listaVazia ? <AvisoGestao testId="abastecimento-lista-vazia">Nenhum abastecimento encontrado com estes filtros.</AvisoGestao> : null}
      {totais && totais.quantidade ? (
        <p className="mb-2 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="abastecimento-totais">
          Confirmados na lista: {totais.quantidade}
          {totais.totais.map((t) => ` · ${formatarQuantidade(t.total, t.unidade)}`).join("")}
        </p>
      ) : null}
    </>
  );

  // ─── Conteúdo do registro ───────────────────────────────────────────
  let conteudoRegistro = null;
  if (controller.showForm) {
    if (idAberto) {
      conteudoRegistro = detalhe ? (
        <ConsultaAbastecimento
          key={`${idAberto}-${detalhe.versao ?? 0}-${controller.formEpoch}`}
          detalhe={detalhe}
          fuso={fuso}
          podeCancelar={acoes.cancelar}
          onCancelar={() => setCancelando(detalhe)}
          onVerConsumo={() => setConsumoBem(detalhe.bem ?? null)}
        />
      ) : (
        <p className="p-3 text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="abastecimento-detalhe-carregando" role="status">
          {detalheQuery.isError ? "Não foi possível abrir o abastecimento." : "Carregando abastecimento…"}
        </p>
      );
    } else if (empresaId && acoes.criar) {
      conteudoRegistro = (
        <FormularioAbastecimento
          key={`novo-${controller.formEpoch}`}
          empresaId={empresaId}
          form={form}
          setForm={setForm}
          hoje={hoje}
          erros={erros}
          limparErro={limparErro}
          previando={previando}
          situacaoPrevia={situacaoPrevia}
          onPrevia={fluxo.pedirPrevia}
          onReabrirPrevia={() => setPreviaAberta(true)}
        />
      );
    }
  }

  const registroAtual = idAberto ? (detalhe ?? registroLista) : null;

  // Filtro da consulta como pílula na faixa do motor, não na barra (D-PROD-172).
  const filtrosDaTela =
    empresaId && acoes.ver
      ? [{ id: "status", rotulo: "Situação", nome: "Filtrar por situação", opcoes: OPCOES_SITUACAO, valor: statusFiltro, padrao: "TODOS", onChange: setStatusFiltro, coluna: "status" }]
      : [];

  return (
    // Os botões seguem a regra EXATA do servidor (novo|salvar, cancelar):
    // a heurística de texto do Layout não se aplica ("Confirmar
    // abastecimento" não exige `salvar`).
    <div data-permissao-explicita="" className="contents">
      <FiltrosDaTelaContext.Provider value={filtrosDaTela}>
      <CadastroBase1Screen
        permissaoExplicita
        workspaceTitle="Abastecimentos"
        searchPlaceholder="Buscar nº ou referência…"
        createLabel="Novo abastecimento"
        formId={idAberto ? undefined : FORMULARIO_ABASTECIMENTO_ID}
        columnsForCardsToolbar={ABASTECIMENTOS_COLUNAS}
        controller={{ ...controller, saving: previando, openNew: abrirNovo }}
        listErrorMessage={listErrorMessage}
        recordCode={registroAtual?.numero != null ? String(registroAtual.numero) : undefined}
        listBanner={banner}
        showCreate={Boolean(empresaId) && acoes.criar && fusoOk}
        showEdit={false}
        showDuplicate={false}
        showDelete={false}
        deleteDialog={{
          title: "Cancelar abastecimento",
          confirmText: "Cancelar",
          descriptionOne: "Abastecimento não se exclui: use Cancelar abastecimento.",
          descriptionMany: () => "Abastecimento não se exclui: use Cancelar abastecimento.",
        }}
        recordForm={conteudoRegistro}
        listSlot={
          <TabelaAbastecimentos
            rows={controller.visibleRows}
            onEdit={controller.handleEdit}
            isLoading={controller.isLoading}
            emptyText={empresaId ? "Nenhum abastecimento encontrado com estes filtros." : "Selecione uma fazenda"}
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

      {previa ? (
        <DialogoPreviaAbastecimento
          key={`previa-${previa.seq}`}
          aberto={previaAberta && situacaoPrevia === "valida"}
          previa={previa.resposta}
          origem={fluxo.origemDaPrevia}
          custoExterno={fluxo.custoExternoDaPrevia}
          podeConfirmar={acoes.criar}
          onFechar={() => setPreviaAberta(false)}
          onConfirmar={fluxo.confirmarDaPrevia}
          onConsultar={fluxo.consultarConfirmacao}
        />
      ) : null}

      {cancelando ? (
        <DialogoCancelarAbastecimento
          key={`cancelar-${cancelando.id}-${cancelando.versao}`}
          aberto
          registro={cancelando}
          onFechar={() => setCancelando(null)}
          onEnviar={fluxo.enviarCancelamento}
          onConsultar={fluxo.consultarCancelamento}
        />
      ) : null}

      <PainelConsumoBem aberto={Boolean(consumoBem)} empresaId={empresaId} bem={consumoBem} onFechar={() => setConsumoBem(null)} />
      </FiltrosDaTelaContext.Provider>
    </div>
  );
}
