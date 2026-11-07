import React, { useMemo, useRef, useState } from "react";
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
 * Blindagem (R2/B3): o `PUT` substitui o conjunto inteiro, então um envio errado
 * APAGA vínculos. Por isso:
 *  - a edição só abre com o conjunto REAL já lido com sucesso (nem carregando,
 *    nem com erro, nem relendo); a seleção inicial é a foto desse conjunto;
 *  - salvar exige as opções carregadas (lista completa) e nada pendente;
 *  - empresa, centro e ids são capturados NO CLIQUE e vão como variáveis da
 *    mutação; resposta de outro registro nunca é aplicada a este;
 *  - esvaziar um conjunto que tinha vínculos pede confirmação explícita;
 *  - o pai monta este componente com `key` empresa+centro: trocar de registro
 *    ou de empresa zera edição, seleção e confirmação.
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
  const [confirmarVazio, setConfirmarVazio] = useState(false);
  const opcoes = useQuery({
    queryKey: ["centros-gestao", "opcoes-vinculo", empresaId],
    queryFn: () => listarOpcoesVinculoCentrosResultado(empresaId),
    enabled: Boolean(empresaId && podeEditar && editando),
  });
  const [selecionados, setSelecionados] = useState(/** @type {string[]} */ ([]));
  const enviando = useRef(false);

  const atuais = useMemo(() => /** @type {any[]} */ (vinculados.data ?? []), [vinculados.data]);
  // Conjunto real conhecido: leitura concluída com sucesso e nada sendo relido.
  const conjuntoReal = vinculados.isSuccess && !vinculados.isFetching && Array.isArray(vinculados.data);

  // Opções ativas + os já vinculados (inativos inclusos: podem ser mantidos ou removidos).
  const lista = useMemo(() => {
    const porId = new Map();
    for (const c of /** @type {any[]} */ (opcoes.data ?? [])) porId.set(c.id, { ...c, ativo: true });
    for (const c of atuais) if (!porId.has(c.id)) porId.set(c.id, c);
    return [...porId.values()].sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  }, [opcoes.data, atuais]);

  const salvar = useMutation({
    /** @param {{ empresaId: string, centroCustoId: string, ids: string[] }} v */
    mutationFn: (v) => salvarCentrosResultadoVinculados(v.empresaId, v.centroCustoId, v.ids),
    onSuccess: async (r, v) => {
      // Relê a chave DO REGISTRO SALVO (não a do registro que estiver na tela agora).
      await queryClient.invalidateQueries({ queryKey: chaveVinculosCusto(v.empresaId, v.centroCustoId) });
      setEditando(false);
      setConfirmarVazio(false);
      if (r && typeof r === "object" && /** @type {any} */ (r).alterado === false) notifyInfo("Sem alterações", "Os vínculos já estavam assim.");
      else notifySuccess("Sucesso", "Vínculos atualizados");
    },
    onError: (err) => notifyWarning("Atenção", mensagemErroGestao(err, "Não foi possível salvar os vínculos.")),
    onSettled: () => {
      enviando.current = false;
    },
  });

  const abrirEdicao = () => {
    if (!conjuntoReal) return;
    setSelecionados(atuais.map((c) => c.id)); // foto do conjunto lido
    setConfirmarVazio(false);
    setEditando(true);
  };
  const cancelar = () => {
    setEditando(false);
    setConfirmarVazio(false);
  };
  const alternar = (id) => {
    setConfirmarVazio(false);
    setSelecionados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const podeSalvar = Boolean(empresaId && centroCustoId) && conjuntoReal && opcoes.isSuccess && !opcoes.isFetching && !salvar.isPending;
  const enviar = () => {
    if (!podeSalvar || enviando.current) return;
    const ids = [...selecionados];
    if (!ids.length && atuais.length && !confirmarVazio) {
      setConfirmarVazio(true);
      return;
    }
    enviando.current = true;
    salvar.mutate({ empresaId: /** @type {string} */ (empresaId), centroCustoId, ids });
  };

  return (
    <section className="cadastro-b1 mg-card mt-2 p-3" aria-label="Centros de Resultado vinculados" data-testid="vinculos-centro-custo">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">Centros de Resultado vinculados</h3>
        {podeEditar && !editando ? (
          <button type="button" className="tb-btn tb-btn-gray" disabled={!conjuntoReal} onClick={abrirEdicao}>
            Alterar vínculos
          </button>
        ) : null}
      </div>
      {vinculados.isLoading ? <p className="text-xs">Carregando vínculos…</p> : null}
      {vinculados.isError ? (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <p className="text-xs text-amber-800">{mensagemErroGestao(vinculados.error, "Não foi possível carregar os vínculos.")}</p>
          <button type="button" className="tb-btn tb-btn-gray" onClick={() => vinculados.refetch()}>
            Tentar novamente
          </button>
        </div>
      ) : null}
      {!editando ? (
        conjuntoReal ? (
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
          {opcoes.isError ? (
            <div className="flex flex-wrap items-center gap-2" role="alert">
              <p className="text-xs text-amber-800">{mensagemErroGestao(opcoes.error, "Não foi possível carregar as opções.")}</p>
              <button type="button" className="tb-btn tb-btn-gray" onClick={() => opcoes.refetch()}>
                Tentar novamente
              </button>
            </div>
          ) : null}
          <div className="b1-multi" role="group" aria-label="Escolher centros de resultado">
            {lista.map((c) => {
              const on = selecionados.includes(c.id);
              return (
                <button key={c.id} type="button" role="checkbox" aria-checked={on} disabled={salvar.isPending} onClick={() => alternar(c.id)} className={`b1-multi__op${on ? " is-on" : ""}`}>
                  {rotuloCentro(c)}
                  {c.ativo === false ? " (inativo)" : ""}
                </button>
              );
            })}
            {opcoes.isSuccess && !lista.length ? <span className="text-xs">Nenhum centro de resultado ativo.</span> : null}
          </div>
          {confirmarVazio ? (
            <p className="mt-2 text-xs text-amber-800" role="alert" data-testid="vinculos-confirmar-vazio">
              Nenhum centro selecionado: salvar vai REMOVER todos os vínculos deste centro de custo. Clique em “Confirmar remoção” para seguir.
            </p>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button type="button" className="tb-btn tb-btn-gray" disabled={salvar.isPending} onClick={cancelar}>
              Cancelar
            </button>
            <button type="button" className="tb-btn tb-btn-green" disabled={!podeSalvar} onClick={enviar}>
              {salvar.isPending ? "Salvando…" : confirmarVazio ? "Confirmar remoção" : "Salvar vínculos"}
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
