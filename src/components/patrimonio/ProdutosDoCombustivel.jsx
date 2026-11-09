import React, { useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import { lerErroGestao } from "@/lib/gestaoErros";
import { mensagemErroPatrimonio } from "@/lib/patrimonioErros";
import {
  alterarSituacaoVinculoCombustivel,
  disponibilidadeDoProduto,
  listarOpcoesProdutosCombustivel,
  listarProdutosDoCombustivel,
  situacaoDoVinculoCombustivel,
  vincularProdutoAoCombustivel,
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

/**
 * Produtos vinculados ao combustível NESTA fazenda (D-PROD-157, R2) — seção do
 * registro aberto (leitura) na tela Combustíveis.
 *
 * O combustível é do tenant; o vínculo é POR EMPRESA e aponta para o Produto
 * real do cadastro (fonte única; nada é copiado). Só classifica: sem preço,
 * custo, saldo ou conversão — a unidade de estoque aparece como está.
 *
 *  - sem empresa real → aviso e nada é lido;
 *  - lista keyset com ativos e inativos (rastreabilidade): vínculo inativo,
 *    produto inativo e produto movido para outra fazenda ficam rotulados e
 *    "não são oferecidos";
 *  - "Vincular produto" (ação criar): seletor paginado no servidor só com
 *    produtos ATIVOS da fazenda; o produto já ativo em OUTRO combustível aparece
 *    marcado e não pode ser escolhido (o servidor é a barreira final: 409);
 *  - inativar/reativar por vínculo, com confirmação (ação `inativar`); o
 *    combustível inativo não oferece vincular nem reativar.
 *
 * Empresa e combustível são capturados NO CLIQUE (variáveis da mutação); o pai
 * monta a seção com `key` empresa+combustível, então trocar de registro ou de
 * fazenda zera o painel.
 *
 * @param {{
 *   empresaId: string|null,
 *   combustivel: { id: string, nome?: string|null, ativo?: boolean },
 *   acoes: { criar: boolean, inativar: boolean },
 * }} props
 */
export default function ProdutosDoCombustivel({ empresaId, combustivel, acoes }) {
  const queryClient = useQueryClient();
  const tipoId = String(combustivel.id);
  const tipoAtivo = combustivel.ativo !== false;
  const nomeDoTipo = combustivel.nome || "este combustível";
  const [vinculando, setVinculando] = useState(false);
  const [escolhido, setEscolhido] = useState(/** @type {{ id: string, rotulo: string }|null} */ (null));
  const [bloqueio, setBloqueio] = useState(/** @type {string|null} */ (null));
  const enviando = useRef(false);

  const lista = useInfiniteQuery({
    queryKey: chaveProdutosDoCombustivel(empresaId, tipoId),
    queryFn: ({ pageParam }) => listarProdutosDoCombustivel(empresaId, tipoId, { cursor: pageParam ?? null }),
    initialPageParam: /** @type {string|null} */ (null),
    getNextPageParam: (ultima) => (ultima?.has_more && ultima.next_cursor ? ultima.next_cursor : undefined),
    enabled: Boolean(empresaId),
  });

  const vinculos = useMemo(() => {
    const vistos = new Set();
    /** @type {any[]} */
    const todos = [];
    for (const pagina of lista.data?.pages ?? []) {
      for (const v of pagina.items ?? []) {
        if (!v || vistos.has(v.id)) continue;
        vistos.add(v.id);
        todos.push(v);
      }
    }
    return todos;
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

  const vincular = useMutation({
    /** @param {{ empresaId: string, tipoId: string, produtoId: string }} v */
    mutationFn: (v) => vincularProdutoAoCombustivel(v.empresaId, v.tipoId, v.produtoId),
    onSuccess: (_r, v) => {
      reler(v.empresaId, v.tipoId);
      setVinculando(false);
      setEscolhido(null);
      setBloqueio(null);
      notifySuccess("Sucesso", "Produto vinculado");
    },
    onError: (err, v) => tratarErro(err, v, "Não foi possível vincular o produto."),
    onSettled: () => {
      enviando.current = false;
    },
  });

  const situacao = useMutation({
    /** @param {{ empresaId: string, tipoId: string, vinculo: { id: string, versao: number }, ativo: boolean }} v */
    mutationFn: (v) => alterarSituacaoVinculoCombustivel(v.empresaId, v.vinculo, v.ativo),
    onSuccess: (_r, v) => {
      reler(v.empresaId, v.tipoId);
      notifySuccess("Sucesso", v.ativo ? "Vínculo reativado" : "Vínculo inativado");
    },
    onError: (err, v) => tratarErro(err, v, v.ativo ? "Não foi possível reativar o vínculo." : "Não foi possível inativar o vínculo."),
  });

  if (!empresaId) {
    return (
      <section className="cadastro-b1 mg-card mt-2 p-3" aria-label="Produtos vinculados nesta fazenda" data-testid="combustivel-produtos">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">Produtos vinculados nesta fazenda</h3>
        <AvisoGestao testId="combustivel-produtos-sem-empresa">
          Selecione uma empresa (fazenda) no topo da tela para ver e vincular os produtos deste combustível.
        </AvisoGestao>
      </section>
    );
  }

  /** Empresa real já garantida (o aviso acima cobre a falta dela). */
  const empresa = empresaId;
  const podeVincular = acoes.criar && tipoAtivo;

  const abrirVinculacao = () => {
    setEscolhido(null);
    setBloqueio(null);
    setVinculando(true);
  };
  const fecharVinculacao = () => {
    setVinculando(false);
    setEscolhido(null);
    setBloqueio(null);
  };

  /** Escolha no seletor: produto preso a outro combustível (ou já neste) não pode ser escolhido. @param {any} opcao */
  const escolher = (opcao) => {
    if (!opcao) {
      setEscolhido(null);
      setBloqueio(null);
      return;
    }
    const d = disponibilidadeDoProduto(opcao, tipoId);
    if (!d.livre) {
      setEscolhido(null);
      setBloqueio(d.motivo);
      return;
    }
    setBloqueio(null);
    setEscolhido({ id: String(opcao.id), rotulo: String(opcao.nome ?? "") });
  };

  const gravar = () => {
    if (!escolhido || enviando.current || vincular.isPending) return;
    enviando.current = true;
    vincular.mutate({ empresaId: empresa, tipoId, produtoId: escolhido.id });
  };

  /** @param {any} v @param {boolean} ativo */
  const pedirSituacao = async (v, ativo) => {
    const nome = v?.produto?.nome || "produto";
    const ok = await confirmar({
      titulo: ativo ? "Reativar vínculo" : "Inativar vínculo",
      descricao: ativo
        ? `Reativar o vínculo de "${nome}" com ${nomeDoTipo}? Ele volta a ser oferecido nesta fazenda.`
        : `Inativar o vínculo de "${nome}" com ${nomeDoTipo}? Ele deixa de ser oferecido nesta fazenda; o vínculo continua na lista. Nada é apagado.`,
      textoConfirmar: ativo ? "Reativar" : "Inativar",
      perigo: !ativo,
    });
    if (ok) situacao.mutate({ empresaId: empresa, tipoId, vinculo: { id: String(v.id), versao: v.versao }, ativo });
  };

  return (
    <section className="cadastro-b1 mg-card mt-2 p-3" aria-label="Produtos vinculados nesta fazenda" data-testid="combustivel-produtos">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">Produtos vinculados nesta fazenda</h3>
        {podeVincular && !vinculando ? (
          <button type="button" className={`inline-flex items-center gap-1.5 ${CLS_ACAO}`} onClick={abrirVinculacao}>
            <Plus aria-hidden size={14} />
            Vincular produto
          </button>
        ) : null}
      </div>
      <p className="mb-2 text-[11px] text-[var(--mg-text-2,#475569)]">
        Produtos do cadastro de Produtos desta fazenda que são deste combustível. O vínculo só classifica: não mexe em estoque, custo ou preço, e a unidade de
        estoque aparece como está.
      </p>
      {!tipoAtivo ? <AvisoGestao testId="combustivel-produtos-tipo-inativo">Combustível inativo: reative-o para vincular ou reativar produtos.</AvisoGestao> : null}

      {vinculando && podeVincular ? (
        <div className="mg-b1-form-grid mb-2 grid grid-cols-12 gap-x-3 gap-y-2 rounded-md border border-[var(--mg-divider,#cbd5e1)] p-2" data-testid="combustivel-produto-vincular">
          <SeletorPaginadoGestao
            rotulo="Produto desta fazenda"
            testId="combustivel-produto-seletor"
            chave={["patrimonio", "combustivel-produtos", empresa, tipoId]}
            buscar={({ q, cursor, limit }) => listarOpcoesProdutosCombustivel(empresa, { q, cursor, limit })}
            value={escolhido}
            onChange={escolher}
            rotuloDaOpcao={(o) => String(o?.nome ?? "")}
            detalheDaOpcao={(o) => disponibilidadeDoProduto(o, tipoId).detalhe}
            readOnly={vincular.isPending}
            obrigatorio
            span={12}
          />
          {bloqueio ? (
            <p className="col-span-12 text-xs text-amber-800" role="alert" data-testid="combustivel-produto-bloqueado">
              {bloqueio}
            </p>
          ) : null}
          <div className="col-span-12 flex flex-wrap gap-2">
            <button type="button" className={CLS_ACAO} aria-label="Cancelar vinculação" disabled={vincular.isPending} onClick={fecharVinculacao}>
              Cancelar
            </button>
            <button type="button" className={CLS_ACAO} disabled={!escolhido || vincular.isPending} onClick={gravar}>
              {vincular.isPending ? "Gravando…" : "Gravar vínculo"}
            </button>
          </div>
        </div>
      ) : null}

      {lista.isLoading ? (
        <p className="text-xs" role="status">
          Carregando produtos vinculados…
        </p>
      ) : null}
      {lista.isError ? (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <p className="text-xs text-amber-800">{mensagemErroPatrimonio(lista.error, "Não foi possível carregar os produtos vinculados.")}</p>
          <button type="button" className={CLS_ACAO} onClick={() => lista.refetch()}>
            Tentar novamente
          </button>
        </div>
      ) : null}
      {lista.isSuccess && !vinculos.length ? <p className="text-xs text-[var(--mg-text-2,#475569)]">Nenhum produto vinculado nesta fazenda.</p> : null}
      {vinculos.length ? (
        <ul className="flex flex-col gap-1.5" data-testid="combustivel-produtos-lista">
          {vinculos.map((v) => {
            const s = situacaoDoVinculoCombustivel(v);
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
                    Inativar vínculo
                  </button>
                ) : null}
                {acoes.inativar && tipoAtivo && s.podeReativar ? (
                  <button type="button" className={CLS_ACAO} disabled={situacao.isPending} onClick={() => pedirSituacao(v, true)}>
                    Reativar vínculo
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {lista.hasNextPage && !lista.isError ? (
        <button type="button" className={`mt-2 ${CLS_ACAO}`} disabled={lista.isFetchingNextPage} onClick={() => lista.fetchNextPage()}>
          {lista.isFetchingNextPage ? "Carregando…" : "Carregar mais vínculos"}
        </button>
      ) : null}
    </section>
  );
}
