import React, { useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { EscolhaDeProdutos, NOTA_COMBUSTIVEL_M3 } from "@/components/patrimonio/ProdutosNovoCombustivel";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import { lerErroGestao } from "@/lib/gestaoErros";
import { mensagemErroPatrimonio } from "@/lib/patrimonioErros";
import {
  alterarSituacaoVinculoCombustivel,
  associarProdutosAoCombustivel,
  listarProdutosDoCombustivel,
  situacaoDoVinculoCombustivel,
} from "@/services/combustivelProdutoService";

/** Chave da lista de vínculos (prefixo dos catálogos: a tela relê junto ao gravar o combustível). */
export const chaveProdutosDoCombustivel = (/** @type {string|null} */ empresaId, /** @type {string} */ tipoId) => [
  "patrimonio-catalogo",
  "combustiveis",
  "produtos",
  empresaId,
  tipoId,
];

/** Prefixo das opções de seletor do patrimônio (o `SeletorPaginadoGestao` usa essa raiz). */
const CHAVE_OPCOES = ["lancamentos-financeiros-gestao", "opcoes", "patrimonio"];

/** Erros em que a verdade do servidor mudou: a lista e as opções são relidas. */
const RELER_NOS_ERROS = new Set([
  "COMBUSTIVEL_PRODUTO_INVALIDO",
  "COMBUSTIVEL_PRODUTO_DUPLICADO",
  "COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO",
  "COMBUSTIVEL_PRODUTO_NAO_ENCONTRADO",
  "PATRIMONIO_VERSAO_CONFLITO",
]);

const CLS_ACAO = "min-h-8 rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-3 text-xs font-medium";
const CLS_TITULO = "text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]";
const CLS_GRUPO = "mt-2 text-[11px] font-semibold text-[var(--mg-text-2,#475569)]";

export const AJUDA_TROCA_DE_ASSOCIACAO =
  "Trocar a associação vale para os próximos abastecimentos: os já lançados continuam com o Produto e o fator da época. Nada é apagado.";
export const AVISO_EDICAO_ASSOCIACOES = "As associações são gravadas na hora, independentemente do botão Salvar.";

/** @typedef {{ id: string, nome: string, codigo: string|null, mensagem: string }} FalhaDeAssociacao */
/** @typedef {{ resolvidos: string[], falhas: FalhaDeAssociacao[] }} ResultadoDoLote */

/**
 * Aplica o resultado de UM lote à lista de "Não associados" (função pura: o
 * pai e a seção sem pai usam a mesma). Tira os `resolvidos` (associados por
 * este lote, inclusive `ja_vinculado`, ou descartados), atualiza no lugar ou
 * acrescenta as `falhas` deste lote e mantém o resto: a resposta atrasada de
 * um lote antigo nunca apaga a falha de outro lote.
 * @param {FalhaDeAssociacao[]} atual @param {ResultadoDoLote} lote
 * @returns {FalhaDeAssociacao[]}
 */
export const aplicarResultadoDoLote = (atual, { resolvidos, falhas }) => {
  const tirar = new Set(resolvidos.map(String));
  const novas = new Map(falhas.map((f) => [String(f.id), f]));
  /** @type {FalhaDeAssociacao[]} */
  const proximas = [];
  for (const f of atual) {
    const id = String(f.id);
    const nova = novas.get(id);
    if (nova) {
      proximas.push(nova);
      novas.delete(id);
    } else if (!tirar.has(id)) {
      proximas.push(f);
    }
  }
  return [...proximas, ...novas.values()];
};

/**
 * Aviso de falha de um lote. A resposta pode chegar com OUTRA fazenda ou OUTRO
 * registro na tela, onde o bloco "Não associados" não está: o aviso diz onde vê-lo.
 * @param {{ empresaId: string, tipoId: string, empresaNome: string|null, tipoNome: string|null }} v
 * @param {number} f @param {number} n
 * @param {{ empresaId: string|null, tipoId: string|null } | null} tela  o que está na tela agora (null = sem pai: a própria seção)
 */
const avisoDeFalhas = (v, f, n, tela) => {
  const base = `${f} de ${n} produto(s) não foram associados`;
  const mesmaFazenda = !tela || tela.empresaId === v.empresaId;
  const mesmoRegistro = !tela || tela.tipoId === v.tipoId;
  if (mesmaFazenda && mesmoRegistro) return `${base}. Veja "Não associados" e tente de novo.`;
  const doTipo = v.tipoNome ? ` ao combustível ${v.tipoNome}` : " ao combustível de origem";
  if (mesmaFazenda) return `${base}${doTipo} nesta fazenda. Abra esse registro para ver "Não associados" e tentar de novo.`;
  const origem = v.empresaNome ? `na fazenda anterior (${v.empresaNome})` : "na fazenda anterior";
  const abrir = mesmoRegistro ? "" : " e abra esse registro";
  return `${base}${doTipo} ${origem}. Volte para essa fazenda no topo da tela${abrir} para ver "Não associados" e tentar de novo.`;
};

/**
 * "Produtos associados nesta fazenda" (D-PROD-157 R2; UX-02, D-PROD-160) —
 * seção do registro GRAVADO na tela Combustíveis, em leitura E em edição (em
 * edição a associação continua gravando na hora, com aviso).
 *
 * O combustível é do tenant; a associação é POR EMPRESA e aponta para o
 * Produto real do cadastro (fonte única; nada é copiado). Só classifica: sem
 * preço, custo, saldo ou conversão — a unidade de estoque aparece como está.
 * Trocar a associação vale para os PRÓXIMOS abastecimentos (o histórico guarda
 * o Produto e o fator da época) e nunca edita o bem nem os tanques.
 *
 *  - sem empresa real → aviso e nada é lido;
 *  - grupos a partir das páginas carregadas: "Associados" (oferecidos no
 *    abastecimento) e "Inativos" (associação inativa, produto inativo ou
 *    movido para outra fazenda — rotulados, rastreáveis);
 *  - "Associar produtos" (ação criar, combustível ativo): seletor paginado no
 *    servidor só com Produtos ATIVOS da fazenda, VÁRIOS de uma vez; o já
 *    associado a outro combustível aparece marcado e não pode (o servidor é a
 *    barreira final: 409). Resultado por Produto: tudo ok → sucesso; alguma
 *    falha → aviso (nunca sucesso) e o bloco "Não associados" com "Tentar de
 *    novo" só do que falhou (repetir nunca duplica);
 *  - inativar/reativar por associação, com confirmação (ação `inativar`); o
 *    combustível inativo não oferece associar nem reativar.
 *
 * Empresa e combustível são capturados NO CLIQUE (variáveis da mutação); o pai
 * monta a seção com `key` empresa+combustível, então trocar de registro ou de
 * fazenda zera o painel (nada da fazenda anterior aparece).
 *
 * "Não associados": com `onResultadoDoLote` o PAI guarda as falhas por
 * empresa+combustível e a seção mostra `falhasGuardadas`. A associação pode
 * terminar com a seção já desmontada (troca de fazenda ou de registro no
 * meio): o resultado vai direto ao pai com a empresa e o combustível do
 * clique, e reaparece ao voltar para eles. Cada lote manda só o SEU delta
 * (`aplicarResultadoDoLote`), nunca a lista inteira: uma resposta atrasada
 * não apaga a falha de um lote mais novo; "Descartar" tira só o que estava
 * no bloco. Com `telaAtual`, o aviso de falha que chega com outra fazenda ou
 * outro registro na tela diz onde ver o bloco. Sem pai, as falhas ficam na seção.
 *
 * @param {{
 *   empresaId: string|null,
 *   empresaNome?: string|null,
 *   combustivel: { id: string, nome?: string|null, ativo?: boolean, unidade?: string|null },
 *   acoes: { criar: boolean, inativar: boolean },
 *   editando?: boolean,
 *   falhasGuardadas?: FalhaDeAssociacao[] | null,
 *   onResultadoDoLote?: (r: { empresaId: string, tipoId: string } & ResultadoDoLote) => void,
 *   telaAtual?: () => { empresaId: string|null, tipoId: string|null },
 * }} props
 */
export default function ProdutosDoCombustivel({
  empresaId,
  empresaNome = null,
  combustivel,
  acoes,
  editando = false,
  falhasGuardadas = null,
  onResultadoDoLote,
  telaAtual,
}) {
  const queryClient = useQueryClient();
  const tipoId = String(combustivel.id);
  const tipoAtivo = combustivel.ativo !== false;
  const nomeDoTipo = combustivel.nome || "este combustível";
  const emLitros = !combustivel.unidade || combustivel.unidade === "L";
  const [associando, setAssociando] = useState(false);
  const [escolhidos, setEscolhidos] = useState(/** @type {Array<{ id: string, nome: string }>} */ ([]));
  const [falhasLocais, setFalhasLocais] = useState(/** @type {FalhaDeAssociacao[]} */ ([]));
  const falhas = onResultadoDoLote ? (Array.isArray(falhasGuardadas) ? falhasGuardadas : []) : falhasLocais;
  // Do pai, pela última renderização: a mutação pode terminar depois desta seção desmontar.
  const avisarLote = useRef(onResultadoDoLote);
  avisarLote.current = onResultadoDoLote;
  const telaAtualRef = useRef(telaAtual);
  telaAtualRef.current = telaAtual;
  const enviando = useRef(false);

  /** Só o delta deste lote (o pai aplica com atualização funcional). @param {string} emp @param {string} tipo @param {ResultadoDoLote} lote */
  const registrarLote = (emp, tipo, lote) => {
    if (avisarLote.current) avisarLote.current({ empresaId: emp, tipoId: tipo, ...lote });
    else setFalhasLocais((atual) => aplicarResultadoDoLote(atual, lote));
  };

  const lista = useInfiniteQuery({
    queryKey: chaveProdutosDoCombustivel(empresaId, tipoId),
    queryFn: ({ pageParam }) => listarProdutosDoCombustivel(empresaId, tipoId, { cursor: pageParam ?? null }),
    initialPageParam: /** @type {string|null} */ (null),
    getNextPageParam: (ultima) => (ultima?.has_more && ultima.next_cursor ? ultima.next_cursor : undefined),
    enabled: Boolean(empresaId),
  });

  const { associados, inativos } = useMemo(() => {
    const vistos = new Set();
    /** @type {Array<{ v: any, s: ReturnType<typeof situacaoDoVinculoCombustivel> }>} */
    const sim = [];
    /** @type {Array<{ v: any, s: ReturnType<typeof situacaoDoVinculoCombustivel> }>} */
    const nao = [];
    for (const pagina of lista.data?.pages ?? []) {
      for (const v of pagina.items ?? []) {
        if (!v || vistos.has(v.id)) continue;
        vistos.add(v.id);
        const s = situacaoDoVinculoCombustivel(v);
        (s.oferecido ? sim : nao).push({ v, s });
      }
    }
    return { associados: sim, inativos: nao };
  }, [lista.data]);

  /** @param {string} empresa @param {string} tipo */
  const reler = (empresa, tipo) => {
    queryClient.invalidateQueries({ queryKey: chaveProdutosDoCombustivel(empresa, tipo) });
    queryClient.invalidateQueries({ queryKey: CHAVE_OPCOES });
  };

  /** @param {unknown} err @param {{ empresaId: string, tipoId: string }} v @param {string} fallback */
  const tratarErro = (err, v, fallback) => {
    if (RELER_NOS_ERROS.has(lerErroGestao(err).code ?? "")) reler(v.empresaId, v.tipoId);
    notifyWarning("Atenção", mensagemErroPatrimonio(err, fallback));
  };

  const associar = useMutation({
    /**
     * @param {{ empresaId: string, tipoId: string, empresaNome: string|null, tipoNome: string|null,
     *   origem: "painel"|"repetir", produtos: Array<{ id: string, nome: string }> }} v
     */
    mutationFn: (v) => associarProdutosAoCombustivel(v.empresaId, v.tipoId, v.produtos),
    // Roda mesmo com a seção desmontada: o resultado vai ao pai com a empresa e o combustível do clique.
    onSuccess: (r, v) => {
      reler(v.empresaId, v.tipoId);
      const n = v.produtos.length;
      registrarLote(v.empresaId, v.tipoId, { resolvidos: r.associados.map((p) => String(p.id)), falhas: r.falhas });
      // "Tentar de novo" não mexe no painel: o que foi escolhido lá continua lá.
      if (v.origem === "painel") {
        setAssociando(false);
        setEscolhidos([]);
      }
      if (!r.falhas.length) {
        notifySuccess("Sucesso", n === 1 ? "Produto associado" : `${n} produtos associados`);
      } else {
        notifyWarning("Atenção", avisoDeFalhas(v, r.falhas.length, n, telaAtualRef.current ? telaAtualRef.current() : null));
      }
    },
    // `associarProdutosAoCombustivel` não lança; isto só cobre o inesperado.
    onError: (err, v) => tratarErro(err, v, "Não foi possível associar os produtos."),
    onSettled: () => {
      enviando.current = false;
    },
  });

  const situacao = useMutation({
    /** @param {{ empresaId: string, tipoId: string, vinculo: { id: string, versao: number }, ativo: boolean }} v */
    mutationFn: (v) => alterarSituacaoVinculoCombustivel(v.empresaId, v.vinculo, v.ativo),
    onSuccess: (_r, v) => {
      reler(v.empresaId, v.tipoId);
      notifySuccess("Sucesso", v.ativo ? "Associação reativada" : "Associação inativada");
    },
    onError: (err, v) => tratarErro(err, v, v.ativo ? "Não foi possível reativar a associação." : "Não foi possível inativar a associação."),
  });

  if (!empresaId) {
    return (
      <section className="cadastro-b1 mg-card mt-2 p-3" aria-label="Produtos associados nesta fazenda" data-testid="combustivel-produtos">
        <h3 className={`mb-2 ${CLS_TITULO}`}>Produtos associados nesta fazenda</h3>
        <AvisoGestao testId="combustivel-produtos-sem-empresa">
          Selecione uma empresa (fazenda) no topo da tela para ver e associar os produtos deste combustível.
        </AvisoGestao>
      </section>
    );
  }

  /** Empresa real já garantida (o aviso acima cobre a falta dela). */
  const empresa = empresaId;
  const podeAssociar = acoes.criar && tipoAtivo;
  const ocupado = associar.isPending;

  const abrirAssociacao = () => {
    setEscolhidos([]);
    setAssociando(true);
  };
  const fecharAssociacao = () => {
    setAssociando(false);
    setEscolhidos([]);
  };

  /** @param {Array<{ id: string, nome: string }>} produtos @param {"painel"|"repetir"} origem */
  const gravar = (produtos, origem) => {
    if (!produtos.length || enviando.current || associar.isPending) return;
    enviando.current = true;
    associar.mutate({
      empresaId: empresa,
      tipoId,
      empresaNome,
      tipoNome: combustivel.nome || null,
      origem,
      produtos: produtos.map((p) => ({ id: String(p.id), nome: String(p.nome ?? "") })),
    });
  };

  /** @param {any} v @param {boolean} ativo */
  const pedirSituacao = async (v, ativo) => {
    const nome = v?.produto?.nome || "produto";
    const ok = await confirmar({
      titulo: ativo ? "Reativar associação" : "Inativar associação",
      descricao: ativo
        ? `Reativar a associação de "${nome}" com ${nomeDoTipo}? Ele volta a ser oferecido nos próximos abastecimentos desta fazenda.`
        : `Inativar a associação de "${nome}" com ${nomeDoTipo}? Ele deixa de ser oferecido nos próximos abastecimentos desta fazenda. Abastecimentos já lançados não mudam e nada é apagado.`,
      textoConfirmar: ativo ? "Reativar" : "Inativar",
      perigo: !ativo,
    });
    if (ok) situacao.mutate({ empresaId: empresa, tipoId, vinculo: { id: String(v.id), versao: v.versao }, ativo });
  };

  /** @param {{ v: any, s: ReturnType<typeof situacaoDoVinculoCombustivel> }} linha */
  const renderLinha = ({ v, s }) => {
    const produto = v.produto && typeof v.produto === "object" ? v.produto : {};
    return (
      <li
        key={v.id}
        className="flex flex-wrap items-center gap-2 rounded border border-[var(--mg-divider,#cbd5e1)] px-2 py-1.5 text-xs"
        data-testid={`combustivel-produto-${v.id}`}
      >
        <span className="min-w-0 flex-1 break-words">
          <span className="font-medium uppercase">{String(produto.nome ?? "")}</span>
          {produto.codigo_interno ? <span className="ml-2 font-mono text-[var(--mg-text-3,#94a3b8)]">{String(produto.codigo_interno)}</span> : null}
          <span className="ml-2 text-[var(--mg-text-2,#475569)]">Unidade de estoque: {String(produto.unidade_principal_estoque ?? "—")}</span>
        </span>
        <span className={s.oferecido ? "text-emerald-700" : "text-amber-800"} data-testid={`combustivel-produto-situacao-${v.id}`}>
          {s.texto}
        </span>
        {acoes.inativar && s.podeInativar ? (
          <button type="button" className={CLS_ACAO} disabled={situacao.isPending} onClick={() => pedirSituacao(v, false)}>
            Inativar associação
          </button>
        ) : null}
        {acoes.inativar && tipoAtivo && s.podeReativar ? (
          <button type="button" className={CLS_ACAO} disabled={situacao.isPending} onClick={() => pedirSituacao(v, true)}>
            Reativar associação
          </button>
        ) : null}
      </li>
    );
  };

  return (
    <section className="cadastro-b1 mg-card mt-2 min-w-0 p-3" aria-label="Produtos associados nesta fazenda" data-testid="combustivel-produtos">
      <h3 className={CLS_TITULO}>Produtos associados nesta fazenda</h3>
      <p className="mt-1 text-xs font-medium text-[var(--mg-text-1,#0f172a)]" data-testid="combustivel-produtos-fazenda">
        Fazenda: {empresaNome || "a selecionada no topo da tela"}
      </p>
      <p className="mb-2 mt-1 text-[11px] text-[var(--mg-text-2,#475569)]">{AJUDA_TROCA_DE_ASSOCIACAO}</p>
      {!emLitros ? (
        <AvisoGestao tone="blue" testId="combustivel-produtos-nota-m3">
          {NOTA_COMBUSTIVEL_M3}
        </AvisoGestao>
      ) : null}
      {editando ? (
        <AvisoGestao tone="blue" testId="combustivel-produtos-aviso-edicao">
          {AVISO_EDICAO_ASSOCIACOES}
        </AvisoGestao>
      ) : null}
      {!tipoAtivo ? <AvisoGestao testId="combustivel-produtos-tipo-inativo">Combustível inativo: reative-o para associar ou reativar produtos.</AvisoGestao> : null}

      {falhas.length ? (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900" role="alert" data-testid="combustivel-produtos-nao-associados">
          <p className="font-semibold">Não associados ({falhas.length})</p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
            {falhas.map((f) => (
              <li key={f.id} className="break-words" data-testid={`combustivel-produto-falha-${f.id}`}>
                <span className="font-medium uppercase">{f.nome}</span>: {f.mensagem}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            {podeAssociar ? (
              <button type="button" className={CLS_ACAO} disabled={ocupado} onClick={() => gravar(falhas, "repetir")}>
                {ocupado ? "Gravando…" : "Tentar de novo"}
              </button>
            ) : null}
            <button
              type="button"
              className={CLS_ACAO}
              disabled={ocupado}
              onClick={() => registrarLote(empresa, tipoId, { resolvidos: falhas.map((f) => String(f.id)), falhas: [] })}
            >
              Descartar
            </button>
          </div>
        </div>
      ) : null}

      {lista.isLoading ? (
        <p className="text-xs" role="status">
          Carregando produtos associados…
        </p>
      ) : null}
      {lista.isError ? (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <p className="text-xs text-amber-800">{mensagemErroPatrimonio(lista.error, "Não foi possível carregar os produtos associados.")}</p>
          <button type="button" className={CLS_ACAO} onClick={() => lista.refetch()}>
            Tentar novamente
          </button>
        </div>
      ) : null}

      {lista.isSuccess ? (
        <>
          <p className={CLS_GRUPO}>Associados ({associados.length})</p>
          {associados.length ? (
            <ul className="mt-1 flex flex-col gap-1.5" aria-label="Associados" data-testid="combustivel-produtos-associados">
              {associados.map(renderLinha)}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-[var(--mg-text-2,#475569)]">Nenhum produto associado nesta fazenda.</p>
          )}
          {inativos.length ? (
            <>
              <p className={CLS_GRUPO}>Inativos ({inativos.length})</p>
              <ul className="mt-1 flex flex-col gap-1.5" aria-label="Inativos" data-testid="combustivel-produtos-inativos">
                {inativos.map(renderLinha)}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
      {lista.hasNextPage && !lista.isError ? (
        <button type="button" className={`mt-2 ${CLS_ACAO}`} disabled={lista.isFetchingNextPage} onClick={() => lista.fetchNextPage()}>
          {lista.isFetchingNextPage ? "Carregando…" : "Carregar mais vínculos"}
        </button>
      ) : null}

      {podeAssociar ? (
        <div className="mt-3 min-w-0" data-testid="combustivel-produtos-disponiveis">
          <p className={CLS_GRUPO}>Disponíveis</p>
          {!associando ? (
            <>
              <p className="mt-1 text-[11px] text-[var(--mg-text-2,#475569)]">Produtos ativos desta fazenda que ainda não estão associados a nenhum combustível.</p>
              <button type="button" className={`mt-1 inline-flex items-center gap-1.5 ${CLS_ACAO}`} onClick={abrirAssociacao}>
                <Plus aria-hidden size={14} />
                Associar produtos
              </button>
            </>
          ) : (
            <div className="mg-b1-form-grid mt-1 grid grid-cols-12 gap-x-3 gap-y-2 rounded-md border border-[var(--mg-divider,#cbd5e1)] p-2" data-testid="combustivel-produto-vincular">
              <EscolhaDeProdutos
                empresaId={empresa}
                tipoId={tipoId}
                escolhidos={escolhidos}
                onChange={setEscolhidos}
                readOnly={ocupado}
                chave={["patrimonio", "combustivel-produtos", empresa, tipoId]}
                ids={{
                  seletor: "combustivel-produto-seletor",
                  bloqueado: "combustivel-produto-bloqueado",
                  lista: "combustivel-produto-pendentes",
                  pendente: (id) => `combustivel-produto-pendente-${id}`,
                }}
              />
              <div className="col-span-12 flex flex-wrap gap-2">
                <button type="button" className={CLS_ACAO} aria-label="Cancelar associação" disabled={ocupado} onClick={fecharAssociacao}>
                  Cancelar
                </button>
                <button type="button" className={CLS_ACAO} disabled={!escolhidos.length || ocupado} onClick={() => gravar(escolhidos, "painel")}>
                  {ocupado ? "Gravando…" : `Associar ${escolhidos.length} produto(s)`}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
