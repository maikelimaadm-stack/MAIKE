import React, { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { B1MenuAcoesDaLinha } from "@/components/cadastro/base1/B1AcoesDaLinha";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import { FiltrosDaTelaContext } from "@/components/cadastro/base1/FiltrosRapidos";
import AbasEstoque from "@/components/estoque/AbasEstoque";
import JanelaLotesSaldo from "@/components/estoque/JanelaLotesSaldo";
import TabelaSaldoEstoque, {
  SALDO_ESTOQUE_CAMPOS_CARD,
  SALDO_ESTOQUE_COLUNAS,
  SALDO_ESTOQUE_STORAGE_KEY,
  textoBuscaSaldo,
  valorDoCampoSaldo,
} from "@/components/estoque/TabelaSaldoEstoque";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { listarDepositosDoFiltro, listarSaldoEstoque } from "@/services/estoqueConsultaService";

const OPCOES_SALDO = [
  { value: "COM", label: "Com saldo" },
  { value: "TODOS", label: "Com e sem saldo" },
];

/** Opções do filtro de depósito: "Todos" + os depósitos. @param {Array<{ id: string, nome: string }>} depositos */
export const opcoesDeDeposito = (depositos) => [{ value: "", label: "Todos os depósitos" }, ...depositos.map((d) => ({ value: d.id, label: d.nome }))];

const NO_OP = () => {};

/**
 * Aba Saldo (D-PROD-255): produto × depósito, derivado das camadas disponíveis. Lista Base1 keyset, filtros na faixa
 * (depósito; com saldo) e busca no servidor. Clicar numa linha abre os Movimentos daquele produto e depósito.
 * @param {{ empresaId: string|null, aba: 'saldo'|'movimentos', onAba: (a: 'saldo'|'movimentos') => void,
 *   onAbrirMovimentos: (alvo: { produto: { id: string, nome: string }, deposito: { id: string, nome: string } }) => void }} props
 */
export default function SaldoEstoque({ empresaId, aba, onAba, onAbrirMovimentos }) {
  const [depositoId, setDepositoId] = useState("");
  const [saldoFiltro, setSaldoFiltro] = useState("COM");
  // D-PROD-281: o detalhe por lote (produto que controla lote).
  const [lotesDe, setLotesDe] = useState(/** @type {any} */ (null));

  const depositosQuery = useQuery({ queryKey: ["estoque", "filtro-depositos"], queryFn: () => listarDepositosDoFiltro(), staleTime: 60 * 1000, enabled: Boolean(empresaId) });
  const depositos = depositosQuery.data ?? [];

  const fetchPage = useCallback(
    async ({ limit, cursor, q }) => {
      const pagina = await listarSaldoEstoque(empresaId, {
        limit,
        cursor,
        q,
        localId: depositoId || null,
        somenteComSaldo: saldoFiltro !== "TODOS",
      });
      return { ...pagina, items: pagina.items.map((i) => ({ ...i, id: String(i.chave) })) };
    },
    [empresaId, depositoId, saldoFiltro],
  );

  const controller = useCadastroBase1Controller({
    storageKey: SALDO_ESTOQUE_STORAGE_KEY,
    columnIds: SALDO_ESTOQUE_CAMPOS_CARD,
    listEnabled: Boolean(empresaId),
    queryKey: ["estoque", "saldo", empresaId, depositoId, saldoFiltro],
    fetchPage,
    duplicateLabelField: "produto_nome",
    searchPlaceholder: "Buscar saldos…",
    exportFileName: "estoque-saldo.csv",
    exportColumns: SALDO_ESTOQUE_COLUNAS,
    getExportFieldValue: valorDoCampoSaldo,
    getRecordTitle: (item) => String(item?.produto_nome ?? "Saldo"),
    getRecordCode: () => undefined,
    getSearchHaystack: (item) => textoBuscaSaldo(item),
    mapSearchSuggestion: (item) => ({ id: String(item.id), label: String(item.produto_nome ?? ""), secondary: String(item.local_estoque_nome ?? "") }),
    matchRowId: (item, id) => String(item.id) === String(id),
    getRowId: (item) => String(item.id),
    findRowById: (rows, id) => rows.find((r) => String(r.id) === String(id)),
    onSubmitRecord: NO_OP,
    onRequestDeleteMutation: NO_OP,
  });

  /** Clique na linha: Movimentos do produto naquele depósito. @param {any} linha */
  const abrir = (linha) =>
    onAbrirMovimentos({
      produto: { id: String(linha.produto_id), nome: String(linha.produto_nome ?? "") },
      deposito: { id: String(linha.local_estoque_id), nome: String(linha.local_estoque_nome ?? "") },
    });

  /** O ⚡ da linha (grade e cards). @param {any} linha */
  const renderAcoesDaLinha = (linha) => (
    <B1MenuAcoesDaLinha
      rotulo={`Ações do saldo de ${linha.produto_nome} em ${linha.local_estoque_nome}`}
      titulo={String(linha.produto_nome ?? "")}
      subtitulo={String(linha.local_estoque_nome ?? "")}
      grupos={[[
        { key: "movimentos", label: "Ver movimentos", onSelect: () => abrir(linha) },
        ...(linha.controla_lote ? [{ key: "lotes", label: "Ver lotes e validade", onSelect: () => setLotesDe(linha) }] : []),
      ]]}
      testId={`saldo-acoes-${linha.id}`}
    />
  );

  const filtrosDaTela = useMemo(
    () => [
      { id: "deposito", rotulo: "Depósito", nome: "Filtrar por depósito", opcoes: opcoesDeDeposito(depositos), valor: depositoId, padrao: "", onChange: setDepositoId, coluna: "deposito" },
      { id: "saldo", rotulo: "Saldo", nome: "Filtrar por saldo", opcoes: OPCOES_SALDO, valor: saldoFiltro, padrao: "COM", onChange: setSaldoFiltro },
    ],
    [depositos, depositoId, saldoFiltro],
  );

  const listErrorMessage = useMemo(
    () => getApiErrorMessage(controller.listaQueryError, "Não foi possível carregar o saldo do estoque. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  return (
    <FiltrosDaTelaContext.Provider value={filtrosDaTela}>
      <CadastroBase1Screen
        workspaceTitle="Estoque"
        searchPlaceholder="Buscar saldos…"
        columnsForCardsToolbar={SALDO_ESTOQUE_COLUNAS}
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
          <TabelaSaldoEstoque
            rows={controller.visibleRows}
            emptyText={empresaId ? "Nenhum saldo encontrado com estes filtros." : "Selecione uma fazenda"}
            onOpen={abrir}
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
      <JanelaLotesSaldo empresaId={empresaId} alvo={lotesDe} onFechar={() => setLotesDe(null)} />
    </FiltrosDaTelaContext.Provider>
  );
}
