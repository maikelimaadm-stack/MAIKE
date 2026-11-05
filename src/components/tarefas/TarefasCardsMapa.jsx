import React, { useCallback, useMemo, useState } from "react";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { Base1CardsToolbar } from "@/components/cadastro/base1/Base1Cards";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { useCadastroCardsPrefs } from "@/hooks/useCadastroCardsPrefs";
import { confirmarExclusao } from "@/lib/maikeConfirmar";
import TarefaDetalhesDialog from "@/components/tarefas/TarefaDetalhesDialog";

/**
 * Campos da tarefa, na ordem dos cards e do "Filtrar por campo".
 * @type {Array<{ id: string, label: string, filterKind?: "texto" | "num" | "data" }>}
 */
export const COLUNAS_TAREFA = [
  { id: "titulo", label: "Tarefa" },
  { id: "status", label: "Status" },
  { id: "prioridade", label: "Prioridade" },
  { id: "data_prevista", label: "Prazo", filterKind: "data" },
  { id: "area_nome", label: "Área" },
  { id: "responsavel", label: "Responsável" },
  { id: "tipo_tarefa_nome", label: "Tipo de Tarefa" },
  { id: "grupo_atividade_nome", label: "Grupo" },
  { id: "descricao", label: "Descrição" },
  { id: "solicitante", label: "Solicitante" },
  { id: "data_pedido", label: "Data Pedido", filterKind: "data" },
  { id: "data_conclusao", label: "Conclusão", filterKind: "data" },
  { id: "setor_nome", label: "Fazenda" },
  { id: "observacoes", label: "Observações" },
];

/** O que aparece no card por padrão (o usuário muda em ⚡ › Campos dos cards). */
const CAMPOS_PADRAO = ["status", "prioridade", "data_prevista", "area_nome", "responsavel", "tipo_tarefa_nome"];
const STORAGE_KEY = "tarefas_mapa_cards";

const COR_STATUS = { Pendente: "#eab308", "Em Andamento": "#3b82f6", Concluída: "#22c55e", Cancelada: "#94a3b8" };
const COR_PRIORIDADE = { Baixa: "#60a5fa", Média: "#eab308", Alta: "#ef4444" };

const dataBR = (v) => {
  if (!v) return "";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
};

/**
 * Tarefas do mapa em cards, no mesmo padrão dos cadastros (D-PROD-133):
 * barra com + / Filtros / Busca / ⚡, cards Base1 (seleção, campos e layout
 * configuráveis), "Filtrar por campo" e o resumo Listados/Filtrados/Totais.
 * Abrir o card mostra os detalhes; editar e excluir agem sobre os selecionados.
 * Substitui a tabela antiga do painel de tarefas.
 *
 * @param {{
 *   tarefas: object[],
 *   onAdd: () => void,
 *   onEdit: (tarefa: object) => void,
 *   onDelete: (ids: string[]) => void,
 *   normalizeTaskPriority?: (p: string) => string,
 * }} props
 */
export default function TarefasCardsMapa({ tarefas, onAdd, onEdit, onDelete, normalizeTaskPriority = (p) => p }) {
  const cardsPrefs = useCadastroCardsPrefs(STORAGE_KEY, CAMPOS_PADRAO);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [selecionados, setSelecionados] = useState(/** @type {string[]} */ ([]));
  const [filtrosAtivos, setFiltrosAtivos] = useState(false);
  const [resetFiltros, setResetFiltros] = useState(0);
  const [metricas, setMetricas] = useState({ listados: 0, filtrados: 0, totais: 0 });
  const [detalhe, setDetalhe] = useState(/** @type {object | null} */ (null));

  const getFieldValue = useCallback(
    (t, id) => {
      if (id === "prioridade") return normalizeTaskPriority(t.prioridade) || "";
      if (id.startsWith("data_")) return dataBR(t[id]);
      return t[id] == null ? "" : String(t[id]);
    },
    [normalizeTaskPriority],
  );

  const renderCell = useCallback(
    (t, id) => {
      const valor = getFieldValue(t, id);
      const cor = id === "status" ? COR_STATUS[valor] : id === "prioridade" ? COR_PRIORIDADE[valor] : null;
      if (!cor || !valor) return valor || "–";
      return (
        <span className="mk-tar-tag">
          <i style={{ background: cor }} aria-hidden />
          {valor}
        </span>
      );
    },
    [getFieldValue],
  );

  const casaBusca = useCallback(
    (t, q) => {
      const termo = q.trim().toLowerCase();
      if (!termo) return true;
      return COLUNAS_TAREFA.some((c) => getFieldValue(t, c.id).toLowerCase().includes(termo));
    },
    [getFieldValue],
  );

  const porId = useMemo(() => new Map(tarefas.map((t) => [String(t.id), t])), [tarefas]);

  const editarSelecionada = () => {
    const t = porId.get(selecionados[0]);
    if (t) onEdit(t);
  };

  const excluirSelecionadas = async () => {
    if (!selecionados.length) return;
    const ok = await confirmarExclusao(
      selecionados.length === 1 ? "Excluir esta tarefa?" : `Excluir ${selecionados.length} tarefas?`,
    );
    if (ok) {
      onDelete(selecionados);
      setSelecionados([]);
    }
  };

  return (
    <div className="cadastro-b1 cadastro-b1--full-page mk-tar-cards flex min-h-0 min-w-0 flex-col gap-1.5">
      <CadastroListaChrome
        {...BASE1_LISTA_INTEGRADA_VISUAL.chrome}
        fieldFilterAvailable
        viewMode="cards"
        cardsModeAvailable
        cardsToolbar={<Base1CardsToolbar columns={COLUNAS_TAREFA} cardsPrefs={cardsPrefs} />}
        createLabel="Nova tarefa"
        onNew={onAdd}
        onEdit={editarSelecionada}
        onDelete={excluirSelecionadas}
        selectedCount={selecionados.length}
        listados={metricas.listados}
        filtrados={metricas.filtrados}
        totais={metricas.totais}
        searchValue={busca}
        onSearchChange={setBusca}
        onSearchApply={(v) => setBuscaAplicada(typeof v === "string" ? v : busca)}
        searchCommittedValue={buscaAplicada}
        searchActive={Boolean(buscaAplicada)}
        searchPlaceholder="Buscar tarefa"
        onClearFilters={() => {
          setBusca("");
          setBuscaAplicada("");
          setResetFiltros((n) => n + 1);
        }}
        filtersActive={filtrosAtivos || Boolean(buscaAplicada)}
      >
        <CadastroBase1Grade
          {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
          rows={tarefas}
          columns={COLUNAS_TAREFA}
          storageKey={STORAGE_KEY}
          droppableId="tarefas-mapa-cards"
          getFieldValue={getFieldValue}
          renderCell={renderCell}
          defaultSortKey="data_prevista"
          viewMode="cards"
          cardFields={cardsPrefs.cardFields}
          cardsPerRow={cardsPrefs.cardsPerRow}
          cardsTitleColId="titulo"
          emptyText="Nenhuma tarefa encontrada"
          onOpen={setDetalhe}
          searchQuery={buscaAplicada}
          matchesSearch={casaBusca}
          resetFiltersKey={resetFiltros}
          onSelectionChange={setSelecionados}
          onFiltersActiveChange={setFiltrosAtivos}
          onListMetrics={setMetricas}
          rowKey={(t) => String(t.id)}
        />
      </CadastroListaChrome>

      {/* Abrir o card (duplo toque / Enter) mostra os detalhes, como antes na tabela. */}
      <TarefaDetalhesDialog
        open={Boolean(detalhe)}
        onOpenChange={(open) => !open && setDetalhe(null)}
        tarefa={detalhe}
        onSaved={(atualizada) => setDetalhe(atualizada)}
      />
    </div>
  );
}
