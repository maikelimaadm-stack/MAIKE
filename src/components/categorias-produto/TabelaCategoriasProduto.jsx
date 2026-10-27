import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";

export const CATEGORIAS_PRODUTO_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, width: 60 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 280 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80 },
  { id: "descricao", label: "Descrição", default: false, sortable: false, width: 220 },
];

/** @param {Map<string, { categoria_pai_id?: string | null }>} indice */
const paiEhDescendenteDe = (indice, ancestralId, nodeId, visitados = new Set()) => {
  if (!nodeId) return false;
  if (nodeId === ancestralId) return true;
  if (visitados.has(nodeId)) return false;
  visitados.add(nodeId);
  const registro = indice.get(nodeId);
  if (!registro?.categoria_pai_id) return false;
  return paiEhDescendenteDe(indice, ancestralId, registro.categoria_pai_id, visitados);
};

export function buildHierarchy(items) {
  const map = {};
  const indice = new Map();
  const roots = [];
  const ordenados = [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  ordenados.forEach((g) => {
    map[g.id] = { ...g, children: [], _hierarquiaAnomala: false };
    indice.set(g.id, g);
  });

  ordenados.forEach((g) => {
    const node = map[g.id];
    const paiId = g.categoria_pai_id;
    if (!paiId || paiId === g.id || !map[paiId]) {
      roots.push(node);
      if (paiId && paiId !== g.id && !map[paiId]) node._hierarquiaAnomala = true;
      return;
    }
    if (paiEhDescendenteDe(indice, g.id, paiId)) {
      node._hierarquiaAnomala = true;
      roots.push(node);
      return;
    }
    map[paiId].children.push(node);
  });

  const sortFn = (a, b) => (a.ordem ?? 999) - (b.ordem ?? 999);
  let counter = 0;
  const assignCodes = (nodes, depth = 0, visitados = new Set()) => {
    nodes.sort(sortFn);
    nodes.forEach((node) => {
      if (visitados.has(node.id)) return;
      visitados.add(node.id);
      counter += 1;
      node._numero = String(counter);
      node._depth = depth;
      if (node.children.length) assignCodes(node.children, depth + 1, visitados);
    });
  };
  assignCodes(roots);
  return { roots };
}

function flattenVisible(nodes, expanded) {
  const result = [];
  const walk = (list) => {
    list.forEach((node) => {
      result.push(node);
      if (node.children?.length && expanded[node.id]) walk(node.children);
    });
  };
  walk(nodes);
  return result;
}

export function getCategoriaProdutoFieldValue(item, colunaId) {
  if (colunaId === "numero") return item._numero || "";
  if (colunaId === "nome") return item.nome || "";
  if (colunaId === "ativo") return item.ativo !== false ? "Ativo" : "Inativo";
  if (colunaId === "descricao") return item.descricao || "";
  return "";
}

export default function TabelaCategoriasProduto(props) {
  const [expanded, setExpanded] = useState({});
  const { roots } = useMemo(() => buildHierarchy(props.categorias || []), [props.categorias]);

  const flatRows = useMemo(() => flattenVisible(roots, expanded), [roots, expanded]);

  const toggleExpand = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const renderCell = (item, colunaId) => {
    if (colunaId === "numero") return <span className="font-mono">{item._numero || "–"}</span>;
    if (colunaId === "nome") {
      const hasChildren = (item.children?.length || 0) > 0;
      const isExp = expanded[item.id];
      return (
        <div className="flex items-center" style={{ paddingLeft: `${(item._depth || 0) * 16}px` }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(item.id);
              }}
              className="mr-1 p-0.5 rounded hover:bg-slate-200"
            >
              {isExp ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
              )}
            </button>
          ) : (
            <span className="w-5" />
          )}
          <span
            className={`uppercase ${item.ativo === false ? "text-slate-400 line-through" : ""} ${!item.categoria_pai_id || item._hierarquiaAnomala ? "font-semibold" : ""}`}
            title={item._hierarquiaAnomala ? "Hierarquia inconsistente — exibido como raiz" : undefined}
          >
            {item.nome || "–"}
          </span>
        </div>
      );
    }
    if (colunaId === "ativo") {
      return item.ativo !== false ? (
        <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 border-0">
          Ativo
        </Badge>
      ) : (
        <Badge variant="secondary" className="text-[10px] bg-slate-100 text-slate-500 border-0">
          Inativo
        </Badge>
      );
    }
    if (colunaId === "descricao") return item.descricao || "–";
    return "–";
  };

  return (
    <CadastroBase1Grade
      rows={flatRows}
      columns={CATEGORIAS_PRODUTO_COLUNAS}
      storageKey="colunas_categorias_produto"
      droppableId="colunas-categorias-produto"
      getFieldValue={getCategoriaProdutoFieldValue}
      renderCell={renderCell}
      defaultSortKey="numero"
      emptyText="Nenhuma categoria encontrada"
      onOpen={props.onEdit}
      showConfigColunas={props.showConfigColunas}
      setShowConfigColunas={props.setShowConfigColunas}
      searchQuery={props.searchQuery}
      resetFiltersKey={props.resetFiltersKey}
      onSelectionChange={props.onSelectionChange}
      onFiltersActiveChange={props.onFiltersActiveChange}
      viewMode={props.viewMode}
      displayLimit={props.displayLimit}
      onListMetrics={props.onListMetrics}
      cardFields={props.cardFields}
      cardsPerRow={props.cardsPerRow}
    />
  );
}
