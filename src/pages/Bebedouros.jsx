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
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";

export default function Bebedouros() {
  const empresaId = localStorage.getItem("empresa_selecionada_id");
  const chrome = useCadastroListaChromeState();
  const [detalhe, setDetalhe] = useState(null);
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

  const filtrados = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return bebedouros;
    return bebedouros.filter((item) =>
      `${item.nome} ${item.codigo_interno} ${getPastosAtendidos(item)} ${item.origem_agua}`
        .toLowerCase()
        .includes(q)
    );
  }, [bebedouros, chrome.appliedSearch]);

  const alertas = useMemo(
    () =>
      bebedouros.flatMap((b) =>
        buildBebedouroAlertas(
          b,
          historico.filter((h) => h.bebedouro_id === b.id),
          sanidade.filter((s) => s.bebedouro_id === b.id)
        )
      ),
    [bebedouros, historico, sanidade]
  );

  const toggleSelect = (id) => {
    const { selectedIds, setSelectedIds } = chrome;
    setSelectedIds(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
    );
  };

  const handleEditSelected = () => {
    const item = bebedouros.find((b) => b.id === chrome.selectedIds[0]);
    if (item) setDetalhe(item);
  };

  const onViewModeChange = useCallback(
    (mode) => {
      chrome.handleViewModeChange(mode, { onOpenRecord: () => handleEditSelected() });
    },
    [chrome, bebedouros]
  );

  const mapaLink = (
    <Link
      to={createPageUrl("MapaCadastro")}
      className="tb-btn tb-btn-gray inline-flex items-center gap-1 no-underline"
    >
      Cadastrar no mapa
    </Link>
  );

  return (
    <CadastroWorkspace
      mode={detalhe ? "detail" : "list"}
      title={detalhe ? detalhe.nome || "Bebedouro" : "Bebedouros"}
      subtitle={
        detalhe
          ? "Histórico, sanidade e vínculos do ponto de água."
          : "Controle operacional, sanitário e histórico da água."
      }
      onBack={detalhe ? () => setDetalhe(null) : undefined}
    >
      {detalhe ? (
        <DetalhesBebedouro bebedouro={detalhe} />
      ) : (
        <div className="space-y-3">
          <BebedouroResumoCards bebedouros={bebedouros} historico={historico} alertas={alertas} />
          <CadastroListaChrome
            selectedCount={chrome.selectedIds.length}
            listados={bebedouros.length}
            filtrados={filtrados.length}
            totais={bebedouros.length}
            onNew={null}
            onEdit={handleEditSelected}
            onDelete={null}
            searchValue={chrome.searchInput}
            onSearchChange={chrome.setSearchInput}
            onSearchApply={chrome.applySearch}
            searchActive={chrome.searchActive}
            searchPlaceholder="Buscar bebedouros…"
            onClearFilters={chrome.clearFilters}
            filtersActive={chrome.filtersActive}
            viewMode={chrome.viewMode}
            onViewModeChange={onViewModeChange}
            recordModeAvailable
            extraToolbar={mapaLink}
            filterRailHint="Cadastro geométrico no mapa; aqui é a operação e o acompanhamento."
            onConfigureColumns={() => {}}
          >
            <div className="overflow-hidden">
              <div
                className="relative w-full overflow-auto max-h-[calc(100dvh-280px)] md:max-h-[calc(100dvh-220px)]"
                style={{ overscrollBehavior: "none" }}
              >
                <table className="w-full min-w-[900px] border-separate border-spacing-0 text-xs table-fixed">
                  <thead>
                    <tr className="sticky top-0 z-40 bg-white">
                      <th className="h-7 w-[25px] border-r border-b border-gray-200 p-0" />
                      <th className="h-7 px-2 text-left font-medium border-r border-b border-gray-200">Nome</th>
                      <th className="h-7 px-2 text-left font-medium border-r border-b border-gray-200">Pastos atendidos</th>
                      <th className="h-7 px-2 text-left font-medium border-r border-b border-gray-200">Tipo</th>
                      <th className="h-7 px-2 text-left font-medium border-r border-b border-gray-200">Origem da água</th>
                      <th className="h-7 px-2 text-right font-medium border-r border-b border-gray-200">Capacidade</th>
                      <th className="h-7 px-2 text-center font-medium border-r border-b border-gray-200">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtrados.map((item) => {
                      const h = historico.filter((x) => x.bebedouro_id === item.id);
                      const s = sanidade.filter((x) => x.bebedouro_id === item.id);
                      const visual = getBebedouroStatusVisual({ bebedouro: item, historico: h, sanidade: s });
                      return (
                        <tr
                          key={item.id}
                          className="border-b hover:bg-gray-100 cursor-pointer"
                          onDoubleClick={() => setDetalhe(item)}
                        >
                          <td className="h-7 p-0 text-center border-r border-b border-gray-300" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={chrome.selectedIds.includes(item.id)}
                              onChange={() => toggleSelect(item.id)}
                              aria-label={`Selecionar ${item.nome}`}
                            />
                          </td>
                          <td className="h-7 px-2 uppercase border-r border-b border-gray-300">{item.nome}</td>
                          <td className="h-7 px-2 border-r border-b border-gray-300">{getPastosAtendidos(item)}</td>
                          <td className="h-7 px-2 uppercase border-r border-b border-gray-300">{item.tipo}</td>
                          <td className="h-7 px-2 border-r border-b border-gray-300">{item.origem_agua || "-"}</td>
                          <td className="h-7 px-2 text-right font-mono border-r border-b border-gray-300">
                            {item.capacidade_litros
                              ? `${Number(item.capacidade_litros).toLocaleString("pt-BR")} L`
                              : "-"}
                          </td>
                          <td className="h-7 px-2 text-center border-r border-b border-gray-300">
                            <BebedouroStatusBadge visual={visual} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </CadastroListaChrome>
        </div>
      )}
    </CadastroWorkspace>
  );
}
