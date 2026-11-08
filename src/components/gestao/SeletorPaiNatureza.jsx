import React, { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, Search, X } from "lucide-react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import { listarOpcoesPaiNatureza } from "@/services/naturezaFinanceiraService";
import { mensagemErroGestao } from "@/lib/gestaoErros";

const ESPERA_BUSCA_MS = 300;
const POR_PAGINA = 50;

/** @param {string} valor @param {number} ms */
function useValorAtrasado(valor, ms) {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}

/**
 * Seletor de natureza pai (D-PROD-153) — PAGINADO e pesquisado no servidor:
 * nada de carregar todas as naturezas. Digitar busca com `q` (com espera),
 * "Carregar mais" segue `next_cursor`. Só oferece ativas do `tipo` do
 * formulário; na edição o servidor tira o próprio nó e a subárvore
 * (`excluir_id`). O pai atual aparece mesmo fora da página carregada.
 *
 * @param {{
 *   empresaId: string|null,
 *   tipo: string|null,
 *   excluirId?: string|null,
 *   value: { id: string, rotulo: string } | null,
 *   onChange: (v: { id: string, rotulo: string } | null) => void,
 *   readOnly?: boolean,
 *   span?: number,
 * }} props
 */
export default function SeletorPaiNatureza({ empresaId, tipo, excluirId = null, value, onChange, readOnly = false, span = 6 }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const q = useValorAtrasado(busca.trim(), ESPERA_BUSCA_MS);
  const semTipo = !tipo;
  const bloqueado = readOnly || semTipo || !empresaId;

  // Tipo/empresa mudou ou ficou só leitura: fecha e esquece a busca.
  useEffect(() => {
    setAberto(false);
    setBusca("");
  }, [tipo, empresaId, readOnly]);

  const consulta = useInfiniteQuery({
    queryKey: ["naturezas-financeiras-gestao", "pais", empresaId, tipo, excluirId, q],
    queryFn: ({ pageParam }) => listarOpcoesPaiNatureza(empresaId, { tipo, q, excluirId, limit: POR_PAGINA, cursor: pageParam ?? null }),
    initialPageParam: /** @type {string|null} */ (null),
    getNextPageParam: (ultima) => (ultima?.has_more && ultima.next_cursor ? ultima.next_cursor : undefined),
    enabled: aberto && !bloqueado,
    staleTime: 15 * 1000,
  });

  const opcoes = useMemo(() => {
    const vistos = new Set();
    const lista = [];
    for (const pagina of consulta.data?.pages ?? []) {
      for (const o of pagina.itens ?? []) {
        if (vistos.has(o.id)) continue;
        vistos.add(o.id);
        lista.push(o);
      }
    }
    return lista;
  }, [consulta.data]);

  const temPaginas = (consulta.data?.pages?.length ?? 0) > 0;

  const escolher = (opcao) => {
    onChange(opcao ? { id: String(opcao.id), rotulo: opcao.caminho || opcao.nome } : null);
    setAberto(false);
    setBusca("");
  };

  const rotuloCampo = semTipo && !readOnly ? "Natureza pai (escolha o tipo antes)" : "Natureza pai";
  const exibido = value?.rotulo || "— Nenhum (raiz) —";

  return (
    <>
      <B1Field label={rotuloCampo} span={span} hasValue locked={readOnly} disabled={bloqueado} open={aberto}>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={aberto}
          aria-controls={aberto ? "seletor-pai-natureza-lista" : undefined}
          data-testid="seletor-pai-natureza"
          disabled={bloqueado}
          onClick={() => setAberto((v) => !v)}
          className={`${B1_FIELD_CTL_CLS} b1-select-btn text-left`}
          title={value?.rotulo || undefined}
        >
          <span className="b1-select-btn__v truncate">{exibido}</span>
          {!bloqueado ? <ChevronDown aria-hidden className="b1-select-btn__c" /> : null}
        </button>
      </B1Field>
      {aberto && !bloqueado ? (
        <div className="col-span-12 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white p-2" data-testid="seletor-pai-natureza-painel">
          <div className="flex items-center gap-2 rounded border border-[var(--mg-divider,#cbd5e1)] px-2">
            <Search aria-hidden size={14} className="shrink-0 text-[var(--mg-text-3,#94a3b8)]" />
            <input
              type="search"
              aria-label="Buscar natureza pai"
              placeholder="Buscar por nome ou código…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
              autoComplete="off"
              maxLength={120}
              autoFocus
            />
            <button type="button" aria-label="Fechar seleção de pai" onClick={() => setAberto(false)} className="inline-flex h-8 w-8 items-center justify-center">
              <X aria-hidden size={14} />
            </button>
          </div>
          <ul id="seletor-pai-natureza-lista" role="listbox" aria-label="Opções de natureza pai" className="mt-2 max-h-64 overflow-y-auto">
            <li>
              <button type="button" role="option" aria-selected={!value} onClick={() => escolher(null)} className="w-full rounded px-2 py-2 text-left text-[13px] hover:bg-slate-50">
                — Nenhum (raiz) —
              </button>
            </li>
            {opcoes.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value?.id === String(o.id)}
                  onClick={() => escolher(o)}
                  className="w-full rounded px-2 py-2 text-left text-[13px] uppercase hover:bg-slate-50"
                  title={o.caminho || o.nome}
                >
                  {o.numero != null ? <span className="mr-2 font-mono text-[var(--mg-text-3,#94a3b8)]">{String(o.numero)}</span> : null}
                  {o.caminho || o.nome}
                </button>
              </li>
            ))}
          </ul>
          {consulta.isLoading ? <p className="px-2 py-1 text-xs text-[var(--mg-text-2,#475569)]">Carregando…</p> : null}
          {consulta.isError ? (
            // R1: falha nunca passa por lista completa. Sem página nenhuma →
            // recarrega do início; com páginas → a lista é PARCIAL e "Tentar
            // novamente" repete o MESMO cursor (as já carregadas seguem escolhíveis).
            <div role="alert" className="px-2 py-1 text-xs text-red-700">
              <p>
                {temPaginas
                  ? "Lista incompleta: não foi possível carregar mais opções de pai."
                  : "Não foi possível carregar as opções de pai."}{" "}
                {mensagemErroGestao(consulta.error, "")}
              </p>
              <button
                type="button"
                onClick={() => (temPaginas ? consulta.fetchNextPage() : consulta.refetch())}
                disabled={consulta.isFetching}
                className="mt-1 h-9 w-full rounded border border-red-300 font-medium"
              >
                {consulta.isFetching ? "Carregando…" : "Tentar novamente"}
              </button>
            </div>
          ) : null}
          {!consulta.isLoading && !consulta.isError && opcoes.length === 0 ? (
            <p className="px-2 py-1 text-xs text-[var(--mg-text-2,#475569)]">{q ? "Nenhuma natureza encontrada para a busca." : "Nenhuma natureza ativa deste tipo para ser pai."}</p>
          ) : null}
          {consulta.hasNextPage && !consulta.isError ? (
            <button
              type="button"
              onClick={() => consulta.fetchNextPage()}
              disabled={consulta.isFetchingNextPage}
              className="mt-1 h-9 w-full rounded border border-[var(--mg-divider,#cbd5e1)] text-xs font-medium"
            >
              {consulta.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
