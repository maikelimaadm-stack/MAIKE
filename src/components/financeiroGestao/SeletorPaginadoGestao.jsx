import React, { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";
import { focoFicaOndeEsta } from "@/components/cadastro/base1/janelaUnica";
import { mensagemErroGestao } from "@/lib/gestaoErros";
import { cn } from "@/lib/utils";

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
 * Filho do `B1Field`: ele põe no filho o `id` do `<label for>` (e, com erro, `aria-invalid`/`aria-describedby`).
 * Aqui esses atributos vão para o BOTÃO do campo; a caixa em volta só posiciona o ✕ de limpar.
 * @param {{ caixaRef: React.Ref<HTMLDivElement>, botao: (doCampo: Record<string, any>) => React.ReactNode, extra?: React.ReactNode } & Record<string, any>} props
 */
function CaixaDoCampo({ caixaRef, botao, extra = null, ...doCampo }) {
  return (
    <div ref={caixaRef} className="relative mk-sel-campo w-full">
      {botao(doCampo)}
      {extra}
    </div>
  );
}

/**
 * Seletor PAGINADO e pesquisado no servidor (D-PROD-155), genérico para as
 * opções da Central de Lançamentos (parceiro, produto, local, natureza,
 * centros), do Patrimônio e da Gestão. Nunca carrega "tudo": a busca vai ao
 * servidor com espera de 300 ms, "Carregar mais" segue `next_cursor` (sem
 * teto), falha mostra o erro e "Tentar novamente" (repete o MESMO cursor quando
 * a lista já é parcial). O valor atual aparece mesmo fora da página carregada.
 *
 * Desenho do campo de escolha do motor (D-PROD-172), como o `AutocompleteGenerico`:
 * o campo vazio fica com o rótulo dentro (sem "— Escolha —"), o ✕ limpa quando
 * `permitirLimpar`; a lista abre na janela flutuante do motor (`mk-sel-pop`), logo
 * abaixo do campo inteiro, com "Pesquisar…" em cima e o "+" de cadastrar dentro da
 * pesquisa; no celular, na folha de baixo. Bloqueado, o motivo fica no `title`.
 *
 * D-PROD-162: `onCriarNovo` (opcional) põe o "+ {rotuloCriarNovo}" (cadastro
 * rápido, D-PROD-95), que recebe o texto da busca e fecha a lista.
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
 * }} props `textoVazio` fica por compatibilidade: no desenho do motor o campo vazio não escreve nada.
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
  textoVazio = "",
  erro = undefined,
  span = 6,
  maiusculas = true,
  onCriarNovo = undefined,
  rotuloCriarNovo = "Cadastrar novo",
}) {
  const celular = useCelular();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const q = useValorAtrasado(busca.trim(), ESPERA_BUSCA_MS);
  const bloqueado = readOnly || Boolean(bloqueadoMotivo);
  const chaveTexto = JSON.stringify(chave);
  const campoRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const saiuParaFora = React.useRef(false);
  const botaoRef = React.useRef(/** @type {HTMLButtonElement | null} */ (null));
  const campo = React.useCallback(() => campoRef.current?.closest(".mg-field") ?? campoRef.current, []);
  const ancoraRef = React.useMemo(() => ({ current: { getBoundingClientRect: () => (campo() ?? document.body).getBoundingClientRect() } }), [campo]);

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
  const caixa = maiusculas ? "uppercase" : "";

  const fechar = () => {
    setAberto(false);
    setBusca("");
  };
  const escolher = (opcao) => {
    // Escolheu: o foco volta JÁ para o campo, como numa lista nativa. Deixado para a devolução atrasada do Radix
    // (um setTimeout no fim da janela), ele podia cair depois que o usuário abriu a lista seguinte e fechá-la.
    if (!celular) botaoRef.current?.focus();
    onChange(opcao);
    fechar();
  };
  const criarNovo = () => {
    const termo = busca.trim();
    fechar();
    onCriarNovo?.(termo);
  };

  // Campo aberto (como no design): `is-open` no .mg-field enquanto a lista está aberta.
  useEffect(() => {
    const el = campoRef.current?.closest(".mg-field");
    if (!el) return undefined;
    el.classList.toggle("is-open", aberto);
    if (aberto) saiuParaFora.current = false;
    return () => el.classList.remove("is-open");
  }, [aberto]);

  const botaoCriar = onCriarNovo ? (
    <button
      type="button"
      className="b1-pq__btn b1-pq__novo"
      aria-label={`+ ${rotuloCriarNovo}`}
      title={rotuloCriarNovo}
      onClick={criarNovo}
      data-testid={`${testId}-criar-novo`}
    >
      <Plus size={celular ? 20 : 16} aria-hidden />
    </button>
  ) : null;

  const estados = (
    <>
      {consulta.isLoading ? <div className="mk-sel-vazio">Carregando…</div> : null}
      {consulta.isError ? (
        <div role="alert" className="mk-sel-vazio b1-seletor-erro">
          <p>
            {temPaginas ? "Lista incompleta: não foi possível carregar mais opções." : "Não foi possível carregar as opções."} {mensagemErroGestao(consulta.error, "")}
          </p>
          <button
            type="button"
            className="tb-btn tb-btn-gray"
            onClick={() => (temPaginas ? consulta.fetchNextPage() : consulta.refetch())}
            disabled={consulta.isFetching}
          >
            {consulta.isFetching ? "Carregando…" : "Tentar novamente"}
          </button>
        </div>
      ) : null}
      {!consulta.isLoading && !consulta.isError && opcoes.length === 0 ? (
        <div className="mk-sel-vazio">{q ? "Nada encontrado para a busca." : "Nenhuma opção ativa disponível."}</div>
      ) : null}
      {consulta.hasNextPage && !consulta.isError ? (
        <div className="mk-sel-mais">
          <button type="button" onClick={() => consulta.fetchNextPage()} disabled={consulta.isFetchingNextPage}>
            {consulta.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      ) : null}
    </>
  );

  /** Uma opção da lista (painel do desktop ou folha do celular). @param {any} o */
  const linha = (o) => {
    const detalhe = detalheDaOpcao(o);
    const on = value?.id === String(o.id);
    return (
      <button
        key={o.id}
        type="button"
        role="option"
        aria-selected={on}
        onClick={() => escolher(o)}
        className={celular ? cn("mgs__op", on && "is-on") : cn("mk-sel-op", on && "is-on")}
        title={rotuloDaOpcao(o)}
      >
        <span className={celular ? "mgs__label" : "mk-sel-op__txt"}>
          <span className={cn(celular ? "" : "mk-sel-op__label", caixa)}>
            {o.numero != null ? <span className="mk-sel-op__cod mr-2">{String(o.numero)}</span> : null}
            {rotuloDaOpcao(o)}
          </span>
          {detalhe ? <span className={celular ? "mgs__sec" : "mk-sel-op__sub"}>{detalhe}</span> : null}
        </span>
        {on ? <Check size={celular ? 14 : 15} aria-hidden className={celular ? undefined : "mk-sel-op__check"} /> : null}
      </button>
    );
  };

  const lista = (
    <div id={idLista} role="listbox" aria-label={`Opções de ${rotulo.toLowerCase()}`} className={celular ? "mgs__lista" : "mk-sel-lista b1-lista"}>
      {opcoes.map(linha)}
    </div>
  );

  const vazio = !value?.rotulo;
  const campoDoFormulario = (
    <B1Field label={rotulo} required={obrigatorio} span={span} hasValue={!vazio} locked={readOnly} disabled={bloqueado} open={aberto} error={erro}>
      <CaixaDoCampo
        caixaRef={campoRef}
        botao={(doCampo) => (
          <button
            {...doCampo}
            ref={botaoRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={aberto}
            aria-controls={aberto ? idLista : undefined}
            aria-label={value?.rotulo ? `${rotulo}: ${value.rotulo}` : rotulo}
            data-testid={testId}
            disabled={bloqueado}
            onClick={() => {
              if (aberto) fechar();
              else setAberto(true);
            }}
            className={`${B1_FIELD_CTL_CLS} b1-select-btn text-left`}
            title={value?.rotulo || (bloqueadoMotivo && !readOnly ? bloqueadoMotivo : undefined)}
            {...(vazio ? { "data-placeholder": "" } : {})}
          >
            <span className={`b1-select-btn__v truncate ${caixa}`}>{value?.rotulo ?? ""}</span>
            {!bloqueado ? <ChevronDown aria-hidden className="b1-select-btn__c" /> : null}
          </button>
        )}
        extra={
          permitirLimpar && value && !bloqueado ? (
            <button
              type="button"
              aria-label="Limpar"
              title="Limpar"
              onClick={(e) => {
                e.stopPropagation();
                escolher(null);
              }}
              className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" aria-hidden />
            </button>
          ) : null
        }
      />
    </B1Field>
  );

  if (celular) {
    return (
      <>
        {campoDoFormulario}
        {aberto && !bloqueado ? (
          <MobileSheet open onClose={fechar} label={rotulo} title={rotulo} className={cn("mk-base1-sheet", maiusculas && "b1-maiusculas")}>
            <div data-testid={`${testId}-painel`} className="contents">
              <div className="mk-pill mgs__busca">
                {busca ? (
                  <button type="button" className="mk-pill__clear" aria-label="Limpar pesquisa" onClick={() => setBusca("")}>
                    <X size={14} aria-hidden />
                  </button>
                ) : (
                  <span className="mk-pill__icon" aria-hidden>
                    <Search size={14} />
                  </span>
                )}
                <input
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Pesquisar…"
                  aria-label={`Buscar ${rotulo.toLowerCase()}`}
                  autoComplete="off"
                  maxLength={120}
                />
                {botaoCriar}
              </div>
              {lista}
              {estados}
            </div>
          </MobileSheet>
        ) : null}
      </>
    );
  }

  return (
    <Popover.Root
      open={aberto && !bloqueado}
      onOpenChange={(o) => {
        if (!o) fechar();
      }}
    >
      <Popover.Anchor virtualRef={/** @type {any} */ (ancoraRef)} />
      {campoDoFormulario}
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={4}
          avoidCollisions
          collisionPadding={8}
          className={cn("mk-sel-pop b1-lista-pop b1-seletor-servidor", maiusculas && "b1-maiusculas")}
          data-testid={`${testId}-painel`}
          onInteractOutside={(e) => {
            // Clique no próprio campo: quem abre e fecha é o campo (senão fechava no pointerdown e reabria no click).
            const el = campo();
            if (el && e.target instanceof Node && el.contains(e.target)) e.preventDefault();
            else saiuParaFora.current = true;
          }}
          onCloseAutoFocus={(e) => {
            // Fechou porque o usuário foi para outro lugar (ex.: outra lista): o foco fica lá.
            if (saiuParaFora.current || focoFicaOndeEsta(e)) {
              saiuParaFora.current = false;
              e.preventDefault();
              return;
            }
            const alvo = botaoRef.current;
            if (alvo instanceof HTMLElement) {
              e.preventDefault();
              alvo.focus();
            }
          }}
        >
          <div className="b1-pq">
            <input
              autoFocus
              type="search"
              className="b1-pq__in"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquisar…"
              aria-label={`Buscar ${rotulo.toLowerCase()}`}
              autoComplete="off"
              maxLength={120}
            />
            {busca ? (
              <button type="button" className="mk-sel-busca__limpar b1-pq__btn" aria-label="Limpar pesquisa" title="Limpar pesquisa" onClick={() => setBusca("")}>
                <X size={14} aria-hidden />
              </button>
            ) : null}
            {botaoCriar}
          </div>
          {lista}
          {estados}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
