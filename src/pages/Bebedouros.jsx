import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import React, { useCallback, useMemo, useState } from "react";
import { useBebedouros } from "@/hooks/useBebedouros";
import { useQuery } from "@tanstack/react-query";
import { listarHistorico, listarSanidade } from "@/services/bebedouroDataService";
import BebedouroResumoCards from "@/components/bebedouros/BebedouroResumoCards";
import DetalhesBebedouro from "@/components/bebedouros/DetalhesBebedouro";
import BebedouroStatusBadge from "@/components/bebedouros/BebedouroStatusBadge";
import { buildBebedouroAlertas, getBebedouroStatusVisual } from "@/services/bebedouroService";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import CadastroRecordHeader from "@/components/cadastro/base1/CadastroRecordHeader";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { useCadastroPageListBindings } from "@/hooks/useCadastroPageListBindings";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

const COLUNAS = [
  { id: "nome", label: "Nome", default: true, sortable: true, width: 180 },
  { id: "pastos", label: "Pastos atendidos", default: true, sortable: true, width: 220 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 120 },
  { id: "origem_agua", label: "Origem da água", default: true, sortable: true, width: 140 },
  { id: "capacidade", label: "Capacidade", default: true, sortable: true, align: "right", width: 120 },
  { id: "status", label: "Status", default: true, sortable: true, align: "center", width: 110 },
];

export default function Bebedouros() {
  const empresaId = useEmpresaSelecionadaId();
  const chrome = useCadastroListaChromeState();
  const listBindings = useCadastroPageListBindings({
    storageKey: "colunas_bebedouros_v1",
    columns: COLUNAS,
    chrome,
  });
  const [detalhe, setDetalhe] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [recordToolbar, setRecordToolbar] = useState(null);
  const [subFlowLocked, setSubFlowLocked] = useState(false);
  const { data: bebedouros = [] } = useBebedouros(empresaId);
  const { data: historico = [] } = useQuery({
    queryKey: ["bebedouro-historico-all", empresaId],
    queryFn: () => listarHistorico(empresaId),
    enabled: !!empresaId,
    initialData: [],
  });
  const { data: sanidade = [] } = useQuery({
    queryKey: ["bebedouro-sanidade-all", empresaId],
    queryFn: () => listarSanidade(empresaId),
    enabled: !!empresaId,
    initialData: [],
  });

  const getPastosAtendidos = (item) =>
    Array.isArray(item.area_vinculada_nomes) && item.area_vinculada_nomes.length
      ? item.area_vinculada_nomes.join(", ")
      : item.pasto_nome || "-";

  const historicoPorBebedouro = useMemo(() => {
    const map = new Map();
    historico.forEach((h) => {
      const list = map.get(h.bebedouro_id) || [];
      list.push(h);
      map.set(h.bebedouro_id, list);
    });
    return map;
  }, [historico]);

  const sanidadePorBebedouro = useMemo(() => {
    const map = new Map();
    sanidade.forEach((s) => {
      const list = map.get(s.bebedouro_id) || [];
      list.push(s);
      map.set(s.bebedouro_id, list);
    });
    return map;
  }, [sanidade]);

  const filtradosCount = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return bebedouros.length;
    return bebedouros.filter((item) =>
      `${item.nome} ${item.codigo_interno} ${getPastosAtendidos(item)} ${item.origem_agua}`.toLowerCase().includes(q),
    ).length;
  }, [bebedouros, chrome.appliedSearch]);

  const alertas = useMemo(
    () =>
      bebedouros.flatMap((b) =>
        buildBebedouroAlertas(
          b,
          historico.filter((h) => h.bebedouro_id === b.id),
          sanidade.filter((s) => s.bebedouro_id === b.id),
        ),
      ),
    [bebedouros, historico, sanidade],
  );

  const inRecord = Boolean(detalhe);

  const exitRecord = useCallback(() => {
    setDetalhe(null);
    setRecordToolbar(null);
    setSubFlowLocked(false);
    chrome.exitRecordView();
  }, [chrome]);

  const openRecord = useCallback(
    (item) => {
      if (!item) return;
      chrome.setViewMode("record");
      if (!chrome.selectedIds.includes(item.id)) {
        chrome.onSelectionChange([item.id]);
      }
      setDetalhe(item);
    },
    [chrome],
  );

  const handleEditSelected = () => {
    const item = bebedouros.find((b) => b.id === chrome.selectedIds[0]);
    if (item) openRecord(item);
  };

  const onViewModeChange = useCallback(
    (mode) => {
      chrome.handleViewModeChange(mode, {
        onOpenRecord: () => handleEditSelected(),
        onExitRecord: exitRecord,
      });
    },
    [chrome, exitRecord, bebedouros],
  );

  const getFieldValue = (item, colId) => {
    if (colId === "nome") return item.nome || "";
    if (colId === "pastos") return getPastosAtendidos(item);
    if (colId === "tipo") return item.tipo || "";
    if (colId === "origem_agua") return item.origem_agua || "";
    if (colId === "capacidade") return item.capacidade_litros ? String(item.capacidade_litros) : "";
    if (colId === "status") {
      const h = historicoPorBebedouro.get(item.id) || [];
      const s = sanidadePorBebedouro.get(item.id) || [];
      const visual = getBebedouroStatusVisual({ bebedouro: item, historico: h, sanidade: s });
      return visual.label || visual.status || "";
    }
    return "";
  };

  const renderCell = (item, colId) => {
    if (colId === "nome") return <span className="uppercase">{item.nome || "–"}</span>;
    if (colId === "pastos") return getPastosAtendidos(item);
    if (colId === "tipo") return <span className="uppercase">{item.tipo || "–"}</span>;
    if (colId === "origem_agua") return item.origem_agua || "–";
    if (colId === "capacidade") {
      return item.capacidade_litros
        ? `${Number(item.capacidade_litros).toLocaleString("pt-BR")} L`
        : "–";
    }
    if (colId === "status") {
      const h = historicoPorBebedouro.get(item.id) || [];
      const s = sanidadePorBebedouro.get(item.id) || [];
      const visual = getBebedouroStatusVisual({ bebedouro: item, historico: h, sanidade: s });
      return <BebedouroStatusBadge visual={visual} />;
    }
    return "–";
  };

  const mapaLink = (
    <Link to={createPageUrl("MapaCadastro")} className="tb-btn tb-btn-gray inline-flex items-center gap-1 no-underline">
      Cadastrar no mapa
    </Link>
  );

  const recordNavRows = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return bebedouros;
    return bebedouros.filter((item) =>
      `${item.nome} ${item.codigo_interno} ${getPastosAtendidos(item)} ${item.origem_agua}`
        .toLowerCase()
        .includes(q),
    );
  }, [bebedouros, chrome.appliedSearch]);

  const recordIndex = detalhe
    ? Math.max(0, recordNavRows.findIndex((b) => b.id === detalhe.id))
    : 0;

  const goRecord = useCallback(
    (index) => {
      const row = recordNavRows[index];
      if (row) openRecord(row);
    },
    [recordNavRows, openRecord],
  );

  return (
    <CadastroWorkspace
      mode="list"
      title="Bebedouros"
      subtitle="Controle operacional, sanitário e histórico da água."
    >
      <CadastroListaChrome
        recordMode={inRecord}
        secondaryToolsLocked={inRecord && subFlowLocked}
        recordToolbar={recordToolbar}
        recordHeader={
          inRecord && detalhe ? (
            <CadastroRecordHeader
              title={detalhe.nome || "Bebedouro"}
              code={detalhe.codigo_interno || undefined}
              index={recordIndex}
              total={recordNavRows.length}
              onGo={goRecord}
              navDisabled={subFlowLocked}
            />
          ) : null
        }
        recordBody={
          inRecord && detalhe ? (
            <DetalhesBebedouro
              bebedouro={detalhe}
              onSubFlowChange={setSubFlowLocked}
              onRecordToolbarChange={setRecordToolbar}
            />
          ) : null
        }
        selectedCount={chrome.selectedIds.length}
        {...listBindings.listFooter.chromeFooter}
        onNew={null}
        onEdit={handleEditSelected}
        onDelete={null}
        onPrint={() => window.print()}
        cardsModeAvailable
        cardsToolbar={listBindings.cardsToolbar}
        searchValue={chrome.searchInput}
        onSearchChange={chrome.setSearchInput}
        onSearchApply={chrome.applySearch}
        searchActive={chrome.searchActive}
        searchPlaceholder="Buscar bebedouros…"
        onClearFilters={chrome.clearFilters}
        filtersActive={chrome.filtersActive}
        viewMode={inRecord ? "record" : chrome.viewMode}
        onViewModeChange={onViewModeChange}
        recordModeAvailable
        extraToolbar={inRecord ? null : mapaLink}
        filterRailHint="Cadastro geométrico no mapa; aqui é a operação e o acompanhamento."
        onConfigureColumns={() => setShowConfigColunas(true)}
      >
        {!inRecord ? (
          <div className="space-y-3">
            <BebedouroResumoCards bebedouros={bebedouros} historico={historico} alertas={alertas} />
            <div className="overflow-hidden">
              <CadastroBase1Grade
                rows={bebedouros}
                columns={COLUNAS}
                storageKey="colunas_bebedouros_v1"
                droppableId="colunas-bebedouros"
                getFieldValue={getFieldValue}
                renderCell={renderCell}
                defaultSortKey="nome"
                emptyText="Nenhum bebedouro encontrado"
                onOpen={(item) => openRecord(item)}
                searchQuery={chrome.appliedSearch}
                resetFiltersKey={chrome.resetFiltersKey}
                onSelectionChange={chrome.onSelectionChange}
                onFiltersActiveChange={chrome.setFiltersActive}
                viewMode={chrome.viewMode === "cards" ? "cards" : "table"}
                displayLimit={listBindings.listFooter.gradePaging.displayLimit}
                onListMetrics={listBindings.listFooter.gradePaging.onListMetrics}
                cardFields={listBindings.cardsPrefs.cardFields}
                cardsPerRow={listBindings.cardsPrefs.cardsPerRow}
                cardsTitleColId="nome"
                cardsCodeColId="codigo_interno"
                showConfigColunas={showConfigColunas}
                setShowConfigColunas={setShowConfigColunas}
                matchesSearch={(item, q) =>
                  `${item.nome} ${item.codigo_interno} ${getPastosAtendidos(item)} ${item.origem_agua}`
                    .toLowerCase()
                    .includes(q)
                }
              />
            </div>
          </div>
        ) : null}
      </CadastroListaChrome>
    </CadastroWorkspace>
  );
}
