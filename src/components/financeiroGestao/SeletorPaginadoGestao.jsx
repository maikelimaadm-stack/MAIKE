import React, { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, Search, X } from "lucide-react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
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
 * Seletor PAGINADO e pesquisado no servidor (D-PROD-155), genérico para as
 * opções da Central de Lançamentos (parceiro, produto, local, natureza,
 * centros). Nunca carrega "tudo": a busca vai ao servidor com espera de 300 ms,
 * "Carregar mais" segue `next_cursor` (sem teto), falha mostra o erro e
 * "Tentar novamente" (repete o MESMO cursor quando a lista já é parcial). O
 * valor atual aparece mesmo fora da página carregada. O painel é inline (fica
 * dentro da tela e do `data-permissao-explicita`).
 *
 * D-PROD-161: `onCriarNovo` (opcional) põe no painel aberto o botão
 * "+ {rotuloCriarNovo}" (cadastro rápido, D-PROD-95), que recebe o texto da
 * busca e fecha o painel. Sem `onCriarNovo` a renderização é a de sempre (a
 * P3 usa este componente; snapshot em `seletorPaginadoCriarNovo.test.jsx`).
 *
 * @param {{
 *   rotulo: string,
 *   testId: string,
 *   chave: unknown[],
 *   buscar: (args: { q: string, cursor: string|null, limit: number }) => Promise<{ itens: any[], has_more: boolean, next_cursor: string|null }>,
 *   value: { id: string, rotulo: string } | null,
 *   onChange: (opcao: any | null) => void,
 *   rotuloDaOpcao?: (opcao: any) => string,
 *   detalheDaOpcao?: (opcao: any) => string | null,
 *   readOnly?: boolean,
 *   bloqueadoMotivo?: string | null,
 *   obrigatorio?: boolean,
 *   permitirLimpar?: boolean,
 *   textoVazio?: string,
 *   erro?: string,
 *   span?: number,
 *   maiusculas?: boolean,
 *   onCriarNovo?: (busca: string) => void,
 *   rotuloCriarNovo?: string,
 * }} props
 */
export default function SeletorPaginadoGestao({
  rotulo,
  testId,
  chave,
  buscar,
  value,
  onChange,
  rotuloDaOpcao = (o) => String(o?.nome ?? ""),
  detalheDaOpcao = () => null,
  readOnly = false,
  bloqueadoMotivo = null,
  obrigatorio = false,
  permitirLimpar = false,
  textoVazio = "— Escolha —",
  erro = undefined,
  span = 6,
  maiusculas = true,
  onCriarNovo = undefined,
  rotuloCriarNovo = "Cadastrar novo",
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const q = useValorAtrasado(busca.trim(), ESPERA_BUSCA_MS);
  const bloqueado = readOnly || Boolean(bloqueadoMotivo);
  const chaveTexto = JSON.stringify(chave);

  // Escopo mudou (empresa, direção, tipo) ou ficou só leitura: fecha e esquece a busca.
  useEffect(() => {
    setAberto(false);
    setBusca("");
  }, [chaveTexto, bloqueado]);

  const consulta = useInfiniteQuery({
    queryKey: ["lancamentos-financeiros-gestao", "opcoes", ...chave, q],
    queryFn: ({ pageParam }) => buscar({ q, cursor: pageParam ?? null, limit: POR_PAGINA }),
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
        if (!o || vistos.has(o.id)) continue;
        vistos.add(o.id);
        lista.push(o);
      }
    }
    return lista;
  }, [consulta.data]);

  const temPaginas = (consulta.data?.pages?.length ?? 0) > 0;
  const idLista = `${testId}-lista`;

  const escolher = (opcao) => {
    onChange(opcao);
    setAberto(false);
    setBusca("");
  };

  const criarNovo = () => {
    const termo = busca.trim();
    setAberto(false);
    setBusca("");
    onCriarNovo?.(termo);
  };

  const exibido = value?.rotulo || (bloqueadoMotivo && !readOnly ? bloqueadoMotivo : textoVazio);
  const caixa = maiusculas ? "uppercase" : "";

  return (
    <>
      <B1Field label={rotulo} required={obrigatorio} span={span} hasValue locked={readOnly} disabled={bloqueado} open={aberto} error={erro}>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={aberto}
          aria-controls={aberto ? idLista : undefined}
          aria-label={value?.rotulo ? `${rotulo}: ${value.rotulo}` : rotulo}
          data-testid={testId}
          disabled={bloqueado}
          onClick={() => setAberto((v) => !v)}
          className={`${B1_FIELD_CTL_CLS} b1-select-btn text-left`}
          title={value?.rotulo || undefined}
        >
          <span className={`b1-select-btn__v truncate ${value?.rotulo ? caixa : "normal-case text-[var(--mg-text-3,#94a3b8)]"}`}>{exibido}</span>
          {!bloqueado ? <ChevronDown aria-hidden className="b1-select-btn__c" /> : null}
        </button>
      </B1Field>
      {aberto && !bloqueado ? (
        <div className="col-span-12 min-w-0 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white p-2" data-testid={`${testId}-painel`}>
          <div className="flex items-center gap-2 rounded border border-[var(--mg-divider,#cbd5e1)] px-2">
            <Search aria-hidden size={14} className="shrink-0 text-[var(--mg-text-3,#94a3b8)]" />
            <input
              type="search"
              aria-label={`Buscar ${rotulo.toLowerCase()}`}
              placeholder="Buscar por nome ou código…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="h-10 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
              autoComplete="off"
              maxLength={120}
              autoFocus
            />
            <button
              type="button"
              aria-label={`Fechar seleção de ${rotulo.toLowerCase()}`}
              onClick={() => setAberto(false)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center"
            >
              <X aria-hidden size={14} />
            </button>
          </div>
          <ul id={idLista} role="listbox" aria-label={`Opções de ${rotulo.toLowerCase()}`} className="mt-2 max-h-64 overflow-y-auto">
            {permitirLimpar && value ? (
              <li>
                <button type="button" role="option" aria-selected={false} onClick={() => escolher(null)} className="min-h-10 w-full rounded px-2 py-2 text-left text-[13px] hover:bg-slate-50">
                  — Nenhum —
                </button>
              </li>
            ) : null}
            {opcoes.map((o) => {
              const detalhe = detalheDaOpcao(o);
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value?.id === String(o.id)}
                    onClick={() => escolher(o)}
                    className={`min-h-10 w-full rounded px-2 py-2 text-left text-[13px] hover:bg-slate-50 ${caixa}`}
                    title={rotuloDaOpcao(o)}
                  >
                    {o.numero != null ? <span className="mr-2 font-mono text-[var(--mg-text-3,#94a3b8)]">{String(o.numero)}</span> : null}
                    <span className="break-words">{rotuloDaOpcao(o)}</span>
                    {detalhe ? <span className="ml-2 normal-case text-[11px] text-[var(--mg-text-2,#475569)]">{detalhe}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {consulta.isLoading ? <p className="px-2 py-1 text-xs text-[var(--mg-text-2,#475569)]">Carregando…</p> : null}
          {consulta.isError ? (
            <div role="alert" className="px-2 py-1 text-xs text-red-700">
              <p>
                {temPaginas ? "Lista incompleta: não foi possível carregar mais opções." : "Não foi possível carregar as opções."} {mensagemErroGestao(consulta.error, "")}
              </p>
              <button
                type="button"
                onClick={() => (temPaginas ? consulta.fetchNextPage() : consulta.refetch())}
                disabled={consulta.isFetching}
                className="mt-1 h-10 w-full rounded border border-red-300 font-medium"
              >
                {consulta.isFetching ? "Carregando…" : "Tentar novamente"}
              </button>
            </div>
          ) : null}
          {!consulta.isLoading && !consulta.isError && opcoes.length === 0 ? (
            <p className="px-2 py-1 text-xs text-[var(--mg-text-2,#475569)]">{q ? "Nada encontrado para a busca." : "Nenhuma opção ativa disponível."}</p>
          ) : null}
          {consulta.hasNextPage && !consulta.isError ? (
            <button
              type="button"
              onClick={() => consulta.fetchNextPage()}
              disabled={consulta.isFetchingNextPage}
              className="mt-1 h-10 w-full rounded border border-[var(--mg-divider,#cbd5e1)] text-xs font-medium"
            >
              {consulta.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
            </button>
          ) : null}
          {onCriarNovo ? (
            <button
              type="button"
              onClick={criarNovo}
              className="mt-1 h-10 w-full rounded border border-emerald-300 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
              data-testid={`${testId}-criar-novo`}
            >
              + {rotuloCriarNovo}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
