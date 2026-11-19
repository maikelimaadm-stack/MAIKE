import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { B1MenuAcoesDaLinha } from "@/components/cadastro/base1/B1AcoesDaLinha";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import { FiltrosDaTelaContext } from "@/components/cadastro/base1/FiltrosRapidos";
import AbasEstoque from "@/components/estoque/AbasEstoque";
import JanelaEntradaEstoque from "@/components/estoque/JanelaEntradaEstoque";
import JanelaNovaEntradaEstoque from "@/components/estoque/JanelaNovaEntradaEstoque";
import { opcoesDeProduto } from "@/components/estoque/MovimentosEstoque";
import TabelaEntradasEstoque, {
  ENTRADAS_ESTOQUE_CAMPOS_CARD,
  ENTRADAS_ESTOQUE_COLUNAS,
  ENTRADAS_ESTOQUE_STORAGE_KEY,
} from "@/components/estoque/TabelaEntradasEstoque";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { listEmpresas } from "@/services/empresaService";
import { hojeNoFuso } from "@/lib/diaCivil";
import { ehDia } from "@/lib/estoqueConsultaRegras";
import {
  OPCOES_MOTIVO_ENTRADA,
  OPCOES_STATUS_ENTRADA,
  ROTULO_MOTIVO,
  textoBuscaEntrada,
  valorDoCampoEntrada,
} from "@/lib/estoqueEntradasRegras";
import { listarProdutosDoFiltro } from "@/services/estoqueConsultaService";
import { listarEntradasEstoque } from "@/services/estoqueEntradasService";

const NO_OP = () => {};

/**
 * Aba Entradas (D-PROD-257): as entradas manuais documentadas e os saldos de implantação da fazenda, paginadas no
 * servidor. Filtros na faixa (produto, motivo, situação, data) e busca no servidor. Uma linha abre o detalhe numa
 * janela só. "Nova entrada" abre UM formulário (janela) e só aparece com a ação `entrada` da tela (o servidor
 * bloqueia de fato, 403). O inventário inicial é o motivo "Saldo de implantação", não uma aba.
 * @param {{ empresaId: string|null, aba: 'saldo'|'movimentos'|'entradas', onAba: (a: 'saldo'|'movimentos'|'entradas') => void, podeLancar: boolean }} props
 */
export default function EntradasEstoque({ empresaId, aba, onAba, podeLancar }) {
  const queryClient = useQueryClient();
  const [produto, setProduto] = useState(/** @type {{ id: string, nome: string }|null} */ (null));
  const [motivo, setMotivo] = useState("");
  const [status, setStatus] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [aberto, setAberto] = useState(/** @type {any} */ (null));
  const [lancando, setLancando] = useState(false);
  const periodoInvertido = Boolean(ehDia(de) && ehDia(ate) && de > ate);

  // Fuso da FAZENDA (o "hoje" da entrada): o mesmo resumo de empresas do Layout.
  const empresasQuery = useQuery({ queryKey: ["empresas"], queryFn: () => listEmpresas(), enabled: Boolean(empresaId), staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false });
  const fuso = useMemo(() => {
    const empresa = (Array.isArray(empresasQuery.data) ? empresasQuery.data : []).find((e) => String(e?.id) === String(empresaId));
    return typeof empresa?.fuso_horario === "string" && empresa.fuso_horario ? empresa.fuso_horario : null;
  }, [empresasQuery.data, empresaId]);
  const hoje = hojeNoFuso(fuso);
  const semFuso = Boolean(empresaId) && empresasQuery.isSuccess && !fuso;

  const produtosQuery = useQuery({ queryKey: ["estoque", "filtro-produtos", empresaId], queryFn: () => listarProdutosDoFiltro(empresaId), staleTime: 60 * 1000, enabled: Boolean(empresaId) });
  const produtos = produtosQuery.data ?? [];

  const fetchPage = useCallback(
    ({ limit, cursor, q }) =>
      listarEntradasEstoque(empresaId, {
        limit,
        cursor,
        q,
        produtoId: produto?.id ?? null,
        motivo: motivo || null,
        status: status || null,
        dataDe: ehDia(de) ? de : null,
        dataAte: ehDia(ate) ? ate : null,
      }),
    [empresaId, produto, motivo, status, de, ate],
  );

  const controller = useCadastroBase1Controller({
    storageKey: ENTRADAS_ESTOQUE_STORAGE_KEY,
    columnIds: ENTRADAS_ESTOQUE_CAMPOS_CARD,
    listEnabled: Boolean(empresaId) && !periodoInvertido,
    queryKey: ["estoque", "entradas", empresaId, produto?.id ?? null, motivo, status, de, ate],
    fetchPage,
    duplicateLabelField: "numero",
    searchPlaceholder: "Buscar entradas…",
    exportFileName: "estoque-entradas.csv",
    exportColumns: ENTRADAS_ESTOQUE_COLUNAS,
    getExportFieldValue: valorDoCampoEntrada,
    getRecordTitle: (item) => (item?.id ? `Entrada nº ${item.numero ?? ""}` : "Nova entrada"),
    getRecordCode: (item) => (item?.numero ? String(item.numero) : undefined),
    getSearchHaystack: (item) => textoBuscaEntrada(item),
    mapSearchSuggestion: (item) => ({ id: String(item.id), label: `Nº ${item.numero ?? ""} — ${valorDoCampoEntrada(item, "produto")}`, secondary: ROTULO_MOTIVO[item.motivo] ?? "" }),
    matchRowId: (item, id) => String(item.id) === String(id),
    getRowId: (item) => String(item.id),
    findRowById: (rows, id) => rows.find((r) => String(r.id) === String(id)),
    onSubmitRecord: NO_OP,
    onRequestDeleteMutation: NO_OP,
  });

  /** O ⚡ da linha (grade e cards). @param {any} linha */
  const renderAcoesDaLinha = (linha) => (
    <B1MenuAcoesDaLinha
      rotulo={`Ações da entrada nº ${linha.numero}`}
      titulo={`Nº ${linha.numero} · ${valorDoCampoEntrada(linha, "produto")}`}
      subtitulo={ROTULO_MOTIVO[linha.motivo] ?? ""}
      grupos={[[{ key: "detalhes", label: "Ver detalhes", onSelect: () => setAberto(linha) }]]}
      testId={`entrada-acoes-${linha.id}`}
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
      { id: "motivo", rotulo: "Motivo", nome: "Filtrar por motivo", opcoes: OPCOES_MOTIVO_ENTRADA, valor: motivo, padrao: "", onChange: setMotivo, coluna: "motivo" },
      { id: "status", rotulo: "Situação", nome: "Filtrar por situação", opcoes: OPCOES_STATUS_ENTRADA, valor: status, padrao: "", onChange: setStatus, coluna: "situacao" },
      {
        id: "periodo",
        tipo: /** @type {const} */ ("periodo"),
        rotulo: "Data",
        nome: "Filtrar por data",
        de,
        ate,
        coluna: "data",
        testId: "estoque-entradas-filtro-data",
        onChange: (/** @type {{ de: string, ate: string }} */ p) => {
          setDe(p.de);
          setAte(p.ate);
        },
      },
    ]),
    [produtos, produto, motivo, status, de, ate],
  );

  const listErrorMessage = useMemo(
    () => getApiErrorMessage(controller.listaQueryError, "Não foi possível carregar as entradas do estoque. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  const aoCriar = async (/** @type {any} */ entrada) => {
    setLancando(false);
    await queryClient.invalidateQueries({ queryKey: ["estoque"] });
    if (entrada?.id) setAberto(entrada);
  };

  return (
    // Os botões seguem a regra EXATA do servidor (a ação `entrada`): a heurística de texto do Layout não se aplica.
    <div data-permissao-explicita="" className="contents">
      <FiltrosDaTelaContext.Provider value={filtrosDaTela}>
        <CadastroBase1Screen
          permissaoExplicita
          workspaceTitle="Estoque"
          searchPlaceholder="Buscar entradas…"
          createLabel="Nova entrada"
          columnsForCardsToolbar={ENTRADAS_ESTOQUE_COLUNAS}
          controller={{ ...controller, saving: false, openNew: () => setLancando(true) }}
          listErrorMessage={listErrorMessage}
          listBanner={
            <>
              <AbasEstoque aba={aba} onChange={onAba} />
              {semFuso ? <AvisoGestao testId="entrada-sem-fuso">Configure o fuso horário da fazenda (Empresa) para lançar entradas.</AvisoGestao> : null}
            </>
          }
          showCreate={Boolean(empresaId) && podeLancar && Boolean(fuso)}
          showEdit={false}
          showDuplicate={false}
          showDelete={false}
          deleteDialog={{ title: "", descriptionOne: "", descriptionMany: () => "" }}
          recordForm={null}
          listSlot={
            <TabelaEntradasEstoque
              rows={controller.visibleRows}
              emptyText={empresaId ? "Nenhuma entrada encontrada com estes filtros." : "Selecione uma fazenda"}
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
      </FiltrosDaTelaContext.Provider>
      {lancando && empresaId && podeLancar ? (
        <JanelaNovaEntradaEstoque aberto empresaId={empresaId} hoje={hoje} onFechar={() => setLancando(false)} onCriada={aoCriar} />
      ) : null}
      <JanelaEntradaEstoque entrada={aberto} empresaId={empresaId} podeLancar={podeLancar} onFechar={() => setAberto(null)} />
    </div>
  );
}
