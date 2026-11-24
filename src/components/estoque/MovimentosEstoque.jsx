import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { B1MenuAcoesDaLinha } from "@/components/cadastro/base1/B1AcoesDaLinha";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import { FiltrosDaTelaContext } from "@/components/cadastro/base1/FiltrosRapidos";
import AbasEstoque from "@/components/estoque/AbasEstoque";
import JanelaEntradaEstoque, { chaveDetalheEntrada } from "@/components/estoque/JanelaEntradaEstoque";
import JanelaMovimentoEstoque from "@/components/estoque/JanelaMovimentoEstoque";
import TelaNovoMovimentoEstoque, { FORMULARIO_NOVO_MOVIMENTO_ID, tituloDoMovimento } from "@/components/estoque/TelaNovoMovimentoEstoque";
import JanelaSaidaEstoque, { chaveDetalheSaida } from "@/components/estoque/JanelaSaidaEstoque";
import JanelaAjusteEstoque from "@/components/estoque/JanelaAjusteEstoque";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { opcoesDeDeposito } from "@/components/estoque/SaldoEstoque";
import TabelaMovimentosEstoque, {
  MOVIMENTOS_ESTOQUE_CAMPOS_CARD,
  MOVIMENTOS_ESTOQUE_COLUNAS,
  MOVIMENTOS_ESTOQUE_STORAGE_KEY,
  textoBuscaMovimento,
  valorDoCampoMovimento,
} from "@/components/estoque/TabelaMovimentosEstoque";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { hojeNoFuso } from "@/lib/diaCivil";
import { listEmpresas } from "@/services/empresaService";
import { OPCOES_EXCLUIDOS, OPCOES_ORIGEM, OPCOES_TIPO, ehDia, rotuloDoMovimento } from "@/lib/estoqueConsultaRegras";
import { listarDepositosDoFiltro, listarMovimentosEstoque, listarProdutosDoFiltro } from "@/services/estoqueConsultaService";

const NO_OP = () => {};

/** Opções do filtro de produto: "Todos" + os produtos (+ o escolhido, mesmo fora das 100 primeiras). */
export const opcoesDeProduto = (/** @type {Array<{ id: string, nome: string }>} */ produtos, /** @type {{ id: string, nome: string }|null} */ atual) => {
  const lista = atual && !produtos.some((p) => p.id === atual.id) ? [atual, ...produtos] : produtos;
  return [{ value: "", label: "Todos os produtos" }, ...lista.map((p) => ({ value: p.id, label: p.nome }))];
};

/**
 * Aba Movimentos (D-PROD-255, P1-04): o kardex da fazenda, paginado por keyset no servidor. Filtros na faixa (produto,
 * depósito, origem, tipo, data) e busca no servidor. Uma linha abre o detalhe numa janela só, somente leitura.
 * `inicial` traz o produto e o depósito escolhidos na aba Saldo.
 * D-PROD-259: "Novo movimento" (só com a ação `entrada` da tela; o servidor bloqueia de fato) abre UMA janela em que se
 * escolhe o tipo — Entrada ou Transferência — e tudo aparece junto nesta lista. O detalhe de um movimento de entrada
 * leva ao detalhe da entrada (editar a observação, excluir), na mesma tela.
 * D-PROD-264: "Novo movimento" aparece com a ação `entrada` OU a ação `saida`; a janela só oferece os tipos que as
 * ações permitem. O detalhe de um movimento de saída manual leva ao detalhe da saída (editar a observação, excluir).
 * D-PROD-272: o mesmo para o Ajuste de inventário (ação `ajuste`) e o detalhe do ajuste.
 * D-PROD-271: o "Editar" do detalhe da entrada ou da saída (com a ação e o fuso da fazenda) fecha o detalhe e abre a
 * janela "Novo movimento" em modo edição; salvar (ou cancelar) volta ao detalhe, já com a versão nova. O ajuste não
 * tem edição (só o estorno integral, no detalhe dele).
 * D-PROD-285: o "Novo movimento" (e a edição) deixou de ser janela: é o REGISTRO desta tela Base1 (tela cheia, com o
 * cabeçalho do registro e o ✕/✓ da barra, como os outros cadastros Base1). Fechar (ou lançar) volta para a lista.
 * D-PROD-273 (fatia 2): o movimento excluído e o estorno dele somem da lista (o servidor tira o par, com a paginação
 * certa); o filtro "Mostrar excluídos" (desligado por padrão) os traz de volta, com a etiqueta "Excluído" no original e
 * "Estorno da exclusão" no estorno. O saldo de cada movimento ativo vem do servidor já sem os excluídos.
 * @param {{ empresaId: string|null, aba: 'saldo'|'movimentos', onAba: (a: 'saldo'|'movimentos') => void, podeLancar?: boolean, podeSaida?: boolean, podeAjuste?: boolean,
 *   inicial?: { produto: { id: string, nome: string }|null, deposito: { id: string, nome: string }|null } | null }} props
 *   `podeLancar` é a ação `entrada`; `podeSaida`, a ação `saida`; `podeAjuste`, a ação `ajuste`.
 */
export default function MovimentosEstoque({ empresaId, aba, onAba, podeLancar = false, podeSaida = false, podeAjuste = false, inicial = null }) {
  const queryClient = useQueryClient();
  const podeAlgum = podeLancar || podeSaida || podeAjuste;
  const [lancando, setLancando] = useState(false);
  const [entradaAberta, setEntradaAberta] = useState(/** @type {{ id: string, numero: string } | null} */ (null));
  const [saidaAberta, setSaidaAberta] = useState(/** @type {{ id: string, numero: string } | null} */ (null));
  const [ajusteAberto, setAjusteAberto] = useState(/** @type {{ id: string, numero: string } | null} */ (null));
  const [editando, setEditando] = useState(/** @type {{ tipo: 'entrada'|'saida', documento: any } | null} */ (null));
  // Fuso da FAZENDA (o "hoje" do lançamento): o mesmo resumo de empresas do Layout.
  const empresasQuery = useQuery({ queryKey: ["empresas"], queryFn: () => listEmpresas(), enabled: Boolean(empresaId) && podeAlgum, staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false });
  const fuso = useMemo(() => {
    const empresa = (Array.isArray(empresasQuery.data) ? empresasQuery.data : []).find((e) => String(e?.id) === String(empresaId));
    return typeof empresa?.fuso_horario === "string" && empresa.fuso_horario ? empresa.fuso_horario : null;
  }, [empresasQuery.data, empresaId]);
  const hoje = hojeNoFuso(fuso);
  const semFuso = podeAlgum && Boolean(empresaId) && empresasQuery.isSuccess && !fuso;
  const [produto, setProduto] = useState(/** @type {{ id: string, nome: string }|null} */ (inicial?.produto ?? null));
  const [depositoId, setDepositoId] = useState(inicial?.deposito?.id ?? "");
  const [origem, setOrigem] = useState("");
  const [tipo, setTipo] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  // D-PROD-273 (fatia 2): o par excluído some da lista (o servidor tira); "Mostrar excluídos" o traz, marcado.
  const [excluidos, setExcluidos] = useState("");
  const mostrarExcluidos = excluidos === "sim";
  const [aberto, setAberto] = useState(/** @type {any} */ (null));
  const periodoInvertido = Boolean(ehDia(de) && ehDia(ate) && de > ate);

  const produtosQuery = useQuery({ queryKey: ["estoque", "filtro-produtos", empresaId], queryFn: () => listarProdutosDoFiltro(empresaId), staleTime: 60 * 1000, enabled: Boolean(empresaId) });
  const depositosQuery = useQuery({ queryKey: ["estoque", "filtro-depositos"], queryFn: () => listarDepositosDoFiltro(), staleTime: 60 * 1000, enabled: Boolean(empresaId) });
  const produtos = produtosQuery.data ?? [];
  const depositos = depositosQuery.data ?? [];
  // O depósito vindo do Saldo pode não estar nas primeiras opções: o rótulo dele já é conhecido.
  const depositosComAtual = useMemo(() => {
    if (!depositoId || depositos.some((d) => d.id === depositoId)) return depositos;
    const nome = inicial?.deposito?.id === depositoId ? inicial.deposito.nome : depositoId;
    return [{ id: depositoId, nome }, ...depositos];
  }, [depositos, depositoId, inicial]);

  const fetchPage = useCallback(
    ({ limit, cursor, q }) =>
      listarMovimentosEstoque(empresaId, {
        limit,
        cursor,
        q,
        produtoId: produto?.id ?? null,
        localId: depositoId || null,
        origem: origem || null,
        tipo: tipo || null,
        dataDe: ehDia(de) ? de : null,
        dataAte: ehDia(ate) ? ate : null,
        incluirExcluidos: mostrarExcluidos,
      }),
    [empresaId, produto, depositoId, origem, tipo, de, ate, mostrarExcluidos],
  );

  const controller = useCadastroBase1Controller({
    storageKey: MOVIMENTOS_ESTOQUE_STORAGE_KEY,
    columnIds: MOVIMENTOS_ESTOQUE_CAMPOS_CARD,
    listEnabled: Boolean(empresaId) && !periodoInvertido,
    queryKey: ["estoque", "movimentos", empresaId, produto?.id ?? null, depositoId, origem, tipo, de, ate, mostrarExcluidos],
    fetchPage,
    duplicateLabelField: "numero",
    searchPlaceholder: "Buscar movimentos…",
    exportFileName: "estoque-movimentos.csv",
    exportColumns: MOVIMENTOS_ESTOQUE_COLUNAS,
    getExportFieldValue: valorDoCampoMovimento,
    getRecordTitle: (item) => (item?.id ? `Movimento nº ${item.numero ?? ""}` : "Movimento"),
    getRecordCode: (item) => (item?.numero ? String(item.numero) : undefined),
    getSearchHaystack: (item) => textoBuscaMovimento(item),
    mapSearchSuggestion: (item) => ({ id: String(item.id), label: `Nº ${item.numero ?? ""} — ${item.produto_nome ?? ""}`, secondary: rotuloDoMovimento(item) }),
    matchRowId: (item, id) => String(item.id) === String(id),
    getRowId: (item) => String(item.id),
    findRowById: (rows, id) => rows.find((r) => String(r.id) === String(id)),
    onSubmitRecord: NO_OP,
    onRequestDeleteMutation: NO_OP,
  });

  /** O ⚡ da linha (grade e cards). @param {any} linha */
  const renderAcoesDaLinha = (linha) => (
    <B1MenuAcoesDaLinha
      rotulo={`Ações do movimento nº ${linha.numero}`}
      titulo={`Nº ${linha.numero} · ${linha.produto_nome ?? ""}`}
      subtitulo={rotuloDoMovimento(linha)}
      grupos={[[{ key: "detalhes", label: "Ver detalhes", onSelect: () => setAberto(linha) }]]}
      testId={`movimento-acoes-${linha.id}`}
    />
  );

  const filtrosDaTela = useMemo(
    () => /** @type {import("@/components/cadastro/base1/FiltrosRapidos").FiltroDaTela[]} */ ([
      {
        id: "produto",
        rotulo: "Produto",
        nome: "Filtrar por produto",
        opcoes: opcoesDeProduto(produtos, produto),
        valor: produto?.id ?? "",
        padrao: "",
        coluna: "produto",
        onChange: (/** @type {string} */ id) => setProduto(id ? { id, nome: (produtos.find((p) => p.id === id) ?? produto)?.nome ?? "" } : null),
      },
      { id: "deposito", rotulo: "Depósito", nome: "Filtrar por depósito", opcoes: opcoesDeDeposito(depositosComAtual), valor: depositoId, padrao: "", onChange: setDepositoId, coluna: "deposito" },
      { id: "origem", rotulo: "Origem", nome: "Filtrar por origem", opcoes: OPCOES_ORIGEM, valor: origem, padrao: "", onChange: setOrigem, coluna: "origem" },
      { id: "tipo", rotulo: "Tipo", nome: "Filtrar por tipo", opcoes: OPCOES_TIPO, valor: tipo, padrao: "", onChange: setTipo, coluna: "tipo" },
      {
        id: "periodo",
        tipo: /** @type {const} */ ("periodo"),
        rotulo: "Data",
        nome: "Filtrar por data",
        de,
        ate,
        coluna: "data",
        testId: "estoque-filtro-data",
        onChange: (/** @type {{ de: string, ate: string }} */ p) => {
          setDe(p.de);
          setAte(p.ate);
        },
      },
      { id: "excluidos", rotulo: "Mostrar excluídos", nome: "Mostrar excluídos", opcoes: OPCOES_EXCLUIDOS, valor: excluidos, padrao: "", onChange: setExcluidos, ocultarPadrao: true },
    ]),
    [produtos, produto, depositosComAtual, depositoId, origem, tipo, de, ate, excluidos],
  );

  const listErrorMessage = useMemo(
    () => getApiErrorMessage(controller.listaQueryError, "Não foi possível carregar os movimentos do estoque. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  // D-PROD-285: a tela do movimento é o registro da CadastroBase1Screen (estado da página, sem rota nova).
  const [enviandoTela, setEnviandoTela] = useState(false);
  const telaAberta = Boolean(empresaId) && ((lancando && podeAlgum) || Boolean(editando));
  const fecharTela = () => {
    if (enviandoTela) return;
    if (editando) {
      // Cancelar a edição volta ao detalhe do documento.
      const { tipo: tipoEditado, documento } = editando;
      setEditando(null);
      const doc = { id: String(documento.id), numero: String(documento.numero ?? "") };
      if (tipoEditado === "saida") setSaidaAberta(doc);
      else setEntradaAberta(doc);
    } else setLancando(false);
  };
  const controllerDaTela = telaAberta
    ? {
        ...controller,
        saving: enviandoTela,
        showForm: true,
        isEditing: true,
        detailTitle: tituloDoMovimento(editando),
        editingItem: null,
        recordNavRows: [],
        recordIndex: 0,
        cancelForm: fecharTela,
        onViewModeChange: (/** @type {any} */ modo) => {
          if (enviandoTela) return;
          fecharTela();
          controller.onViewModeChange(modo);
        },
        openNew: () => setLancando(true),
      }
    : { ...controller, saving: false, openNew: () => setLancando(true) };

  const aoLancar = async (/** @type {{ tipo: string, entrada?: any, saida?: any, ajuste?: any, editada?: boolean }} */ r) => {
    setLancando(false);
    setEditando(null);
    await queryClient.invalidateQueries({ queryKey: ["estoque"] });
    // Edição: o detalhe reabre já com a versão nova (a resposta do PATCH é o detalhe completo).
    if (r?.editada && r.entrada?.id) queryClient.setQueryData(chaveDetalheEntrada(empresaId, String(r.entrada.id)), r.entrada);
    if (r?.editada && r.saida?.id) queryClient.setQueryData(chaveDetalheSaida(empresaId, String(r.saida.id)), r.saida);
    if (r?.entrada?.id) setEntradaAberta({ id: String(r.entrada.id), numero: String(r.entrada.numero ?? "") });
    if (r?.saida?.id) setSaidaAberta({ id: String(r.saida.id), numero: String(r.saida.numero ?? "") });
    if (r?.ajuste?.id) setAjusteAberto({ id: String(r.ajuste.id), numero: String(r.ajuste.numero ?? "") });
  };

  return (
    // Os botões seguem a regra EXATA do servidor (as ações `entrada`, `saida` e `ajuste`): a heurística de texto do Layout não se aplica.
    <div data-permissao-explicita="" className="contents">
    <FiltrosDaTelaContext.Provider value={filtrosDaTela}>
      <CadastroBase1Screen
        permissaoExplicita
        workspaceTitle="Estoque"
        searchPlaceholder="Buscar movimentos…"
        createLabel="Novo movimento"
        columnsForCardsToolbar={MOVIMENTOS_ESTOQUE_COLUNAS}
        controller={controllerDaTela}
        formId={FORMULARIO_NOVO_MOVIMENTO_ID}
        listErrorMessage={listErrorMessage}
        listBanner={
          telaAberta ? null : (
          <>
            <AbasEstoque aba={aba} onChange={onAba} />
            {semFuso ? <AvisoGestao testId="movimento-sem-fuso">Configure o fuso horário da fazenda (Empresa) para lançar movimentos.</AvisoGestao> : null}
          </>
          )
        }
        showCreate={Boolean(empresaId) && podeAlgum && Boolean(fuso)}
        showEdit={false}
        showDuplicate={false}
        showDelete={false}
        deleteDialog={{ title: "", descriptionOne: "", descriptionMany: () => "" }}
        recordForm={
          telaAberta && empresaId ? (
            <TelaNovoMovimentoEstoque
              key={editando ? `editar-${editando.tipo}-${editando.documento?.id}` : "novo"}
              edicao={editando}
              empresaId={empresaId}
              hoje={hoje}
              podeEntrada={podeLancar}
              podeSaida={podeSaida}
              podeAjuste={editando ? false : podeAjuste}
              onFechar={fecharTela}
              onEnviando={setEnviandoTela}
              onLancado={aoLancar}
            />
          ) : null
        }
        listSlot={
          <TabelaMovimentosEstoque
            rows={controller.visibleRows}
            emptyText={empresaId ? "Nenhum movimento encontrado com estes filtros." : "Selecione uma fazenda"}
            onOpen={setAberto}
            renderAcoesDaLinha={renderAcoesDaLinha}
            isLoading={controller.isLoading}
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
      <JanelaMovimentoEstoque
        movimento={aberto}
        empresaId={empresaId}
        onFechar={() => setAberto(null)}
        onAbrirEntrada={(/** @type {{ id: string, numero: string }} */ doc) => {
          setAberto(null);
          setEntradaAberta({ id: String(doc.id), numero: String(doc.numero ?? "") });
        }}
        onAbrirSaida={(/** @type {{ id: string, numero: string }} */ doc) => {
          setAberto(null);
          setSaidaAberta({ id: String(doc.id), numero: String(doc.numero ?? "") });
        }}
        onAbrirAjuste={(/** @type {{ id: string, numero: string }} */ doc) => {
          setAberto(null);
          setAjusteAberto({ id: String(doc.id), numero: String(doc.numero ?? "") });
        }}
      />
    </FiltrosDaTelaContext.Provider>
    <JanelaEntradaEstoque
      entrada={entradaAberta}
      empresaId={empresaId}
      podeLancar={podeLancar}
      onFechar={() => setEntradaAberta(null)}
      onEditar={fuso ? (/** @type {any} */ detalhe) => {
        setEntradaAberta(null);
        setEditando({ tipo: "entrada", documento: detalhe });
      } : undefined}
    />
    <JanelaSaidaEstoque
      saida={saidaAberta}
      empresaId={empresaId}
      podeSaida={podeSaida}
      onFechar={() => setSaidaAberta(null)}
      onEditar={fuso ? (/** @type {any} */ detalhe) => {
        setSaidaAberta(null);
        setEditando({ tipo: "saida", documento: detalhe });
      } : undefined}
    />
    <JanelaAjusteEstoque ajuste={ajusteAberto} empresaId={empresaId} podeAjuste={podeAjuste} onFechar={() => setAjusteAberto(null)} />
    </div>
  );
}
