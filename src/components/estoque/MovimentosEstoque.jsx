import React, { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { B1MenuAcoesDaLinha } from "@/components/cadastro/base1/B1AcoesDaLinha";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import { FiltrosDaTelaContext } from "@/components/cadastro/base1/FiltrosRapidos";
import AbasEstoque from "@/components/estoque/AbasEstoque";
import JanelaMovimentoEstoque from "@/components/estoque/JanelaMovimentoEstoque";
import { opcoesDeDeposito } from "@/components/estoque/SaldoEstoque";
import TabelaMovimentosEstoque, {
  MOVIMENTOS_ESTOQUE_CAMPOS_CARD,
  MOVIMENTOS_ESTOQUE_COLUNAS,
  MOVIMENTOS_ESTOQUE_STORAGE_KEY,
  textoBuscaMovimento,
  valorDoCampoMovimento,
} from "@/components/estoque/TabelaMovimentosEstoque";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { OPCOES_ORIGEM, OPCOES_TIPO, ehDia, rotuloDoMovimento } from "@/lib/estoqueConsultaRegras";
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
 * @param {{ empresaId: string|null, aba: 'saldo'|'movimentos', onAba: (a: 'saldo'|'movimentos') => void,
 *   inicial?: { produto: { id: string, nome: string }|null, deposito: { id: string, nome: string }|null } | null }} props
 */
export default function MovimentosEstoque({ empresaId, aba, onAba, inicial = null }) {
  const [produto, setProduto] = useState(/** @type {{ id: string, nome: string }|null} */ (inicial?.produto ?? null));
  const [depositoId, setDepositoId] = useState(inicial?.deposito?.id ?? "");
  const [origem, setOrigem] = useState("");
  const [tipo, setTipo] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
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
      }),
    [empresaId, produto, depositoId, origem, tipo, de, ate],
  );

  const controller = useCadastroBase1Controller({
    storageKey: MOVIMENTOS_ESTOQUE_STORAGE_KEY,
    columnIds: MOVIMENTOS_ESTOQUE_CAMPOS_CARD,
    listEnabled: Boolean(empresaId) && !periodoInvertido,
    queryKey: ["estoque", "movimentos", empresaId, produto?.id ?? null, depositoId, origem, tipo, de, ate],
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
    () => /** @type {any[]} */ ([
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
    ]),
    [produtos, produto, depositosComAtual, depositoId, origem, tipo, de, ate],
  );

  const listErrorMessage = useMemo(
    () => getApiErrorMessage(controller.listaQueryError, "Não foi possível carregar os movimentos do estoque. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  return (
    <FiltrosDaTelaContext.Provider value={filtrosDaTela}>
      <CadastroBase1Screen
        workspaceTitle="Estoque"
        searchPlaceholder="Buscar movimentos…"
        columnsForCardsToolbar={MOVIMENTOS_ESTOQUE_COLUNAS}
        controller={{ ...controller, saving: false }}
        listErrorMessage={listErrorMessage}
        listBanner={<AbasEstoque aba={aba} onChange={onAba} />}
        showCreate={false}
        showEdit={false}
        showDuplicate={false}
        showDelete={false}
        deleteDialog={{ title: "", descriptionOne: "", descriptionMany: () => "" }}
        recordForm={null}
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
      <JanelaMovimentoEstoque movimento={aberto} empresaId={empresaId} onFechar={() => setAberto(null)} />
    </FiltrosDaTelaContext.Provider>
  );
}
