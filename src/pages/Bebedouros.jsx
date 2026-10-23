import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import React, { useCallback, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
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
          >
            <div className="overflow-auto border border-slate-200 rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-2 w-8" />
                    <th className="p-2 text-left">Nome</th>
                    <th className="p-2 text-left">Pastos atendidos</th>
                    <th className="p-2 text-left">Tipo</th>
                    <th className="p-2 text-left">Origem da água</th>
                    <th className="p-2 text-right">Capacidade</th>
                    <th className="p-2 text-center">Status</th>
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
                        className="border-t hover:bg-slate-50 cursor-pointer"
                        onClick={() => setDetalhe(item)}
                      >
                        <td className="p-2" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={chrome.selectedIds.includes(item.id)}
                            onCheckedChange={() => toggleSelect(item.id)}
                          />
                        </td>
                        <td className="p-2 font-medium">{item.nome}</td>
                        <td className="p-2">{getPastosAtendidos(item)}</td>
                        <td className="p-2">{item.tipo}</td>
                        <td className="p-2">{item.origem_agua || "-"}</td>
                        <td className="p-2 text-right">
                          {item.capacidade_litros
                            ? `${Number(item.capacidade_litros).toLocaleString("pt-BR")} L`
                            : "-"}
                        </td>
                        <td className="p-2 text-center">
                          <BebedouroStatusBadge visual={visual} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CadastroListaChrome>
        </div>
      )}
    </CadastroWorkspace>
  );
}
