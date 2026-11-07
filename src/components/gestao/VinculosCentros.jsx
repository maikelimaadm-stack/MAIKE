import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listarCentrosCustoVinculados,
  listarCentrosResultadoVinculados,
  listarOpcoesVinculoCentrosResultado,
  salvarCentrosResultadoVinculados,
} from "@/services/centroService";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { mensagemErroGestao } from "@/lib/gestaoErros";

const rotuloCentro = (c) => `${c.numero != null ? `${c.numero} · ` : ""}${c.nome}`;

/** Chave de query dos vínculos (relida depois de salvar). */
export const chaveVinculosCusto = (empresaId, id) => ["centros-gestao", "vinculos-custo", empresaId, id];

/**
 * Centros de Resultado vinculados a um Centro de Custo (N:N; não gera lançamento).
 * Leitura para quem vê a tela; seleção e gravação só com editar/salvar.
 * Mostra sempre a verdade do banco: relê depois de salvar.
 *
 * @param {{ empresaId: string|null, centroCustoId: string, podeEditar: boolean }} props
 */
export function VinculosCentroCusto({ empresaId, centroCustoId, podeEditar }) {
  const queryClient = useQueryClient();
  const chave = chaveVinculosCusto(empresaId, centroCustoId);
  const vinculados = useQuery({
    queryKey: chave,
    queryFn: () => listarCentrosResultadoVinculados(empresaId, centroCustoId),
    enabled: Boolean(empresaId && centroCustoId),
  });
  const [editando, setEditando] = useState(false);
  const opcoes = useQuery({
    queryKey: ["centros-gestao", "opcoes-vinculo", empresaId],
    queryFn: () => listarOpcoesVinculoCentrosResultado(empresaId),
    enabled: Boolean(empresaId && podeEditar && editando),
  });
  const [selecionados, setSelecionados] = useState(/** @type {string[]} */ ([]));

  const atuais = useMemo(() => /** @type {any[]} */ (vinculados.data ?? []), [vinculados.data]);
  useEffect(() => {
    if (!editando) setSelecionados(atuais.map((c) => c.id));
  }, [atuais, editando]);

  // Opções ativas + os já vinculados (inativos inclusos: podem ser mantidos ou removidos).
  const lista = useMemo(() => {
    const porId = new Map();
    for (const c of /** @type {any[]} */ (opcoes.data ?? [])) porId.set(c.id, { ...c, ativo: true });
    for (const c of atuais) if (!porId.has(c.id)) porId.set(c.id, c);
    return [...porId.values()].sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  }, [opcoes.data, atuais]);

  const salvar = useMutation({
    mutationFn: () => salvarCentrosResultadoVinculados(empresaId, centroCustoId, selecionados),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: chave });
      setEditando(false);
      if (r && typeof r === "object" && /** @type {any} */ (r).alterado === false) notifyInfo("Sem alterações", "Os vínculos já estavam assim.");
      else notifySuccess("Sucesso", "Vínculos atualizados");
    },
    onError: (err) => notifyWarning("Atenção", mensagemErroGestao(err, "Não foi possível salvar os vínculos.")),
  });

  const alternar = (id) => setSelecionados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <section className="cadastro-b1 mg-card mt-2 p-3" aria-label="Centros de Resultado vinculados" data-testid="vinculos-centro-custo">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">Centros de Resultado vinculados</h3>
        {podeEditar && !editando ? (
          <button type="button" className="tb-btn tb-btn-gray" onClick={() => setEditando(true)}>
            Alterar vínculos
          </button>
        ) : null}
      </div>
      {vinculados.isLoading ? <p className="text-xs">Carregando vínculos…</p> : null}
      {vinculados.isError ? (
        <p className="text-xs text-amber-800">{mensagemErroGestao(vinculados.error, "Não foi possível carregar os vínculos.")}</p>
      ) : null}
      {!editando ? (
        !vinculados.isLoading && !vinculados.isError ? (
          atuais.length ? (
            <ul className="flex flex-wrap gap-1.5" data-testid="vinculos-atuais">
              {atuais.map((c) => (
                <li key={c.id} className="rounded border px-2 py-0.5 text-xs uppercase">
                  {rotuloCentro(c)}
                  {c.ativo === false ? " (inativo)" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--mg-text-2,#475569)]">Nenhum centro de resultado vinculado.</p>
          )
        ) : null
      ) : (
        <div>
          {opcoes.isLoading ? <p className="text-xs">Carregando opções…</p> : null}
          {opcoes.isError ? <p className="text-xs text-amber-800">{mensagemErroGestao(opcoes.error, "Não foi possível carregar as opções.")}</p> : null}
          <div className="b1-multi" role="group" aria-label="Escolher centros de resultado">
            {lista.map((c) => {
              const on = selecionados.includes(c.id);
              return (
                <button key={c.id} type="button" role="checkbox" aria-checked={on} onClick={() => alternar(c.id)} className={`b1-multi__op${on ? " is-on" : ""}`}>
                  {rotuloCentro(c)}
                  {c.ativo === false ? " (inativo)" : ""}
                </button>
              );
            })}
            {!opcoes.isLoading && !lista.length ? <span className="text-xs">Nenhum centro de resultado ativo.</span> : null}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className="tb-btn tb-btn-gray" disabled={salvar.isPending} onClick={() => setEditando(false)}>
              Cancelar
            </button>
            <button type="button" className="tb-btn tb-btn-green" disabled={salvar.isPending || !empresaId} onClick={() => salvar.mutate()}>
              {salvar.isPending ? "Salvando…" : "Salvar vínculos"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Centros de Custo que apontam para um Centro de Resultado — SOMENTE LEITURA
 * (o vínculo é gravado na tela de Centros de Custo).
 * @param {{ empresaId: string|null, centroResultadoId: string }} props
 */
export function VinculosCentroResultado({ empresaId, centroResultadoId }) {
  const q = useQuery({
    queryKey: ["centros-gestao", "vinculos-resultado", empresaId, centroResultadoId],
    queryFn: () => listarCentrosCustoVinculados(empresaId, centroResultadoId),
    enabled: Boolean(empresaId && centroResultadoId),
  });
  const itens = /** @type {any[]} */ (q.data ?? []);
  return (
    <section className="cadastro-b1 mg-card mt-2 p-3" aria-label="Centros de Custo vinculados" data-testid="vinculos-centro-resultado">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">Centros de Custo vinculados (somente leitura)</h3>
      {q.isLoading ? <p className="text-xs">Carregando vínculos…</p> : null}
      {q.isError ? <p className="text-xs text-amber-800">{mensagemErroGestao(q.error, "Não foi possível carregar os vínculos.")}</p> : null}
      {!q.isLoading && !q.isError ? (
        itens.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {itens.map((c) => (
              <li key={c.id} className="rounded border px-2 py-0.5 text-xs uppercase">
                {rotuloCentro(c)}
                {c.ativo === false ? " (inativo)" : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--mg-text-2,#475569)]">Nenhum centro de custo vinculado. O vínculo é feito na tela Centros de Custo.</p>
        )
      ) : null}
    </section>
  );
}
