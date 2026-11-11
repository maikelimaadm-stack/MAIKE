import React, { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import * as UiDialog from "@/components/ui/dialog";
import { MobileSheetPortalCtx } from "@/components/common/MobileSheet";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import { lerErroGestao } from "@/lib/gestaoErros";
import { ehConflitoDeVersaoPatrimonio, ehNaoEncontradoPatrimonio, mensagemErroPatrimonio } from "@/lib/patrimonioErros";
import { NATUREZAS_PATRIMONIO, ROTULO_NATUREZA, ehNatureza } from "@/lib/patrimonioDominio";
import { FiltroOpcoes } from "@/components/patrimonio/PatrimonioFormParts";
import FormularioTipo from "@/components/patrimonio/FormularioTipo";
import { CHAVE_OPCOES_PATRIMONIO } from "@/components/patrimonio/bemFormulario";
import {
  RECURSOS_CATALOGO,
  alterarSituacaoCatalogo,
  atualizarCatalogo,
  criarCatalogo,
  excluirCatalogo,
  listarCatalogoPagina,
} from "@/services/patrimonioCatalogoService";

// Os componentes de `ui/dialog` são forwardRef sem tipos: aqui valem como `any`.
const Dialog = /** @type {any} */ (UiDialog.Dialog);
const DialogContent = /** @type {any} */ (UiDialog.DialogContent);
const DialogDescription = /** @type {any} */ (UiDialog.DialogDescription);
const DialogFooter = /** @type {any} */ (UiDialog.DialogFooter);
const DialogHeader = /** @type {any} */ (UiDialog.DialogHeader);
const DialogTitle = /** @type {any} */ (UiDialog.DialogTitle);

/** Raiz das consultas da lista de tipos (o cadastro rápido e a gravação invalidam por ela). */
export const QUERY_CATALOGO = "patrimonio-catalogo";
/** Raiz das consultas dos Bens (página da grade e detalhe: `BensPatrimoniaisTela`). */
const QUERY_BENS = "bens-patrimoniais";

const POR_PAGINA = 50;
const ESPERA_BUSCA_MS = 300;
const FORM_TIPO_ID = "formulario-tipo-gerenciar";
const RECURSO = RECURSOS_CATALOGO.TIPOS;

const BOTAO_PRIMARIO =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-4 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60";
const BOTAO_SECUNDARIO =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-4 text-[13px] font-medium hover:bg-slate-50 disabled:opacity-60";
const BOTAO_LINHA =
  "inline-flex min-h-8 items-center justify-center rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-3 text-[12px] font-medium disabled:opacity-60";
const BOTAO_LINHA_PERIGO =
  "inline-flex min-h-8 items-center justify-center rounded-full border border-red-200 bg-white px-3 text-[12px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-60";

const OPCOES_TIPO_DE_BEM = [{ value: "TODAS", label: "Todos os tipos de bem" }, ...NATUREZAS_PATRIMONIO.map((n) => ({ value: n, label: ROTULO_NATUREZA[n] }))];

const MENSAGEM_VERSAO =
  "Este tipo foi alterado por outra pessoa enquanto você editava. A lista foi recarregada com a versão atual: confira e refaça a alteração. Nada foi gravado.";

/** @param {string} valor @param {number} ms */
function useValorAtrasado(valor, ms) {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}

/** Tipo de bem do tipo: o do servidor (`natureza`) ou o da família dele. @param {any} r @returns {string|null} */
const naturezaDoTipo = (r) => {
  const n = r?.natureza ?? r?.familia?.natureza;
  return ehNatureza(n) ? n : null;
};

/** "2 bens" / "1 bem" / "Nenhum bem" quando o servidor manda a contagem; senão null. @param {any} r */
const textoDosBens = (r) => {
  const n = r?.bens_em_uso;
  if (!Number.isInteger(n) || n < 0) return null;
  if (n === 0) return "Nenhum bem";
  return n === 1 ? "1 bem" : `${n} bens`;
};

/**
 * "⋯ › Gerenciar tipos" do cadastro de Bens (D-PROD-169). O usuário não
 * cadastra família: cada tipo pertence a um "Tipo de bem" (a natureza, lista
 * fixa) e o servidor guarda o tipo na família padrão dele.
 *
 * Lista keyset dos tipos (ativos e inativos), com busca no servidor e filtro
 * pelo Tipo de bem. Ações pelas regras do servidor sobre a tela de Bens
 * (`acoesDeCatalogoNoBem`):
 *  - "+ Novo tipo" (`criarCatalogo`): Tipo de bem + Nome, POST `{natureza, nome}`;
 *  - "Renomear" na própria linha (`editarCatalogo`): PATCH `{versao, nome}`;
 *    Escape no campo cancela só a renomeação (o diálogo continua aberto);
 *  - "Excluir" (`excluirCatalogo`), com confirmação: DELETE com `versao`. Tipo
 *    em uso por algum bem → 409 `PATRIMONIO_TIPO_EM_USO`, e a linha mostra
 *    "Este tipo está em uso por N bem(ns)…";
 *  - "Reativar" um tipo antigo inativo (`inativarCatalogo`).
 * Conflito de versão relê a lista (nada foi gravado). Renomear, reativar e
 * excluir relêem também os Bens (grade e bem aberto mostram o nome do tipo).
 *
 * Responsivo sem rolagem horizontal: cada tipo é uma linha que quebra (nome e
 * dados à esquerda, ações abaixo no celular). No celular, as escolhas (filtro
 * "Tipo de bem" e o "Tipo de bem" do "+ Novo tipo") abrem em folha de baixo
 * (`B1Select` → `MobileSheet`): a folha nasce DENTRO deste diálogo (padrão da
 * D-PROD-161, `DetalhesDepositoSuplementacao`), senão o diálogo do Radix
 * bloqueia o toque nela; no celular o diálogo centraliza sem `transform`, para
 * a folha (`position: fixed`) ocupar a tela e não o cartão; com a folha aberta,
 * o pedido de fechar o diálogo (Escape) fecha só a folha.
 *
 * @param {{
 *   aberto: boolean,
 *   onFechar: () => void,
 *   acoes: { criarCatalogo: boolean, editarCatalogo: boolean, excluirCatalogo: boolean, inativarCatalogo: boolean },
 * }} props
 */
export default function GerenciarTiposDialog({ aberto, onFechar, acoes }) {
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const q = useValorAtrasado(busca.trim(), ESPERA_BUSCA_MS);
  const [natureza, setNatureza] = useState("TODAS");
  const [novo, setNovo] = useState(false);
  const [renomeando, setRenomeando] = useState(/** @type {{ id: string, nome: string } | null} */ (null));
  const [erroRenomear, setErroRenomear] = useState(/** @type {string|null} */ (null));
  const [emUso, setEmUso] = useState(/** @type {Record<string, string>} */ ({}));
  const [salvando, setSalvando] = useState(false);
  // Alvo das folhas do celular (B1Select) DENTRO do diálogo.
  const [alvoFolha, setAlvoFolha] = useState(/** @type {HTMLElement | null} */ (null));

  const lista = useInfiniteQuery({
    queryKey: [QUERY_CATALOGO, RECURSO, "gerenciar", natureza, q],
    queryFn: ({ pageParam }) =>
      listarCatalogoPagina(RECURSO, {
        limit: POR_PAGINA,
        cursor: pageParam ?? null,
        q: q || undefined,
        natureza: natureza !== "TODAS" ? natureza : null,
      }),
    initialPageParam: /** @type {string|null} */ (null),
    getNextPageParam: (ultima) => (ultima?.has_more && ultima.next_cursor ? ultima.next_cursor : undefined),
    enabled: aberto,
    staleTime: 15 * 1000,
  });
  const itens = useMemo(() => {
    const vistos = new Set();
    /** @type {any[]} */
    const saida = [];
    for (const pagina of lista.data?.pages ?? []) {
      for (const r of pagina.items ?? []) {
        if (!r || vistos.has(r.id)) continue;
        vistos.add(r.id);
        saida.push(r);
      }
    }
    return saida;
  }, [lista.data]);

  /**
   * Relê a lista de tipos e as opções do formulário. Renomear, reativar,
   * excluir e o conflito (alguém mudou o tipo) relêem também os Bens
   * (`QUERY_BENS`: a página da grade e o detalhe do bem aberto), que mostram o
   * nome do tipo; criar não muda nenhum bem.
   * @param {{ bens?: boolean }} [opcoes]
   */
  const invalidar = ({ bens = true } = {}) => {
    queryClient.invalidateQueries({ queryKey: [QUERY_CATALOGO] });
    queryClient.invalidateQueries({ queryKey: CHAVE_OPCOES_PATRIMONIO });
    if (bens) queryClient.invalidateQueries({ queryKey: [QUERY_BENS] });
  };

  /**
   * Descarta a renomeação (botão Cancelar e Escape). O Radix ouve o Escape no
   * `document` antes do campo, por isso o Escape é tratado no `onEscapeKeyDown`
   * do diálogo, que não fecha o diálogo enquanto há renomeação aberta.
   */
  const cancelarRenomear = () => {
    setRenomeando(null);
    setErroRenomear(null);
  };

  /** Erro comum: versão (relê), tipo que sumiu (relê) ou a mensagem do patrimônio. @param {unknown} erro @param {string} fallback */
  const tratarErro = (erro, fallback) => {
    if (ehConflitoDeVersaoPatrimonio(erro)) {
      invalidar();
      setRenomeando(null);
      notifyWarning("Atenção", MENSAGEM_VERSAO);
      return;
    }
    if (ehNaoEncontradoPatrimonio(erro)) {
      invalidar();
      setRenomeando(null);
    }
    notifyWarning("Atenção", mensagemErroPatrimonio(erro, fallback));
  };

  /** @param {{ natureza: string, nome: string }} dados */
  const criar = async (dados) => {
    if (salvando) return;
    setSalvando(true);
    try {
      await criarCatalogo(RECURSO, dados);
      notifySuccess("Sucesso", "Tipo criado");
      invalidar({ bens: false });
      setNovo(false);
    } catch (erro) {
      tratarErro(erro, "Não foi possível criar o tipo.");
    } finally {
      setSalvando(false);
    }
  };

  /** @param {any} registro */
  const salvarNome = async (registro) => {
    if (salvando || !renomeando) return;
    const nome = renomeando.nome.trim();
    if (!nome) {
      setErroRenomear("Informe o nome.");
      return;
    }
    setSalvando(true);
    try {
      const { alterado } = await atualizarCatalogo(RECURSO, registro, { nome });
      if (!alterado) notifySuccess("Sem alterações", "Nada foi alterado.");
      else notifySuccess("Sucesso", "Tipo renomeado");
      invalidar();
      setRenomeando(null);
      setErroRenomear(null);
    } catch (erro) {
      tratarErro(erro, "Não foi possível renomear o tipo.");
    } finally {
      setSalvando(false);
    }
  };

  /** @param {any} registro */
  const excluir = async (registro) => {
    if (salvando || !Number.isInteger(registro?.versao)) return;
    const ok = await confirmar({
      titulo: "Excluir tipo",
      descricao: `Excluir o tipo "${registro.nome || "tipo"}"? Ele sai da lista de vez. Só é possível quando nenhum bem (ativo ou inativo) usa o tipo.`,
      textoConfirmar: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    setSalvando(true);
    try {
      await excluirCatalogo(RECURSO, registro);
      setEmUso((atual) => {
        const { [String(registro.id)]: _removido, ...resto } = atual;
        return resto;
      });
      notifySuccess("Sucesso", "Tipo excluído");
      invalidar();
    } catch (erro) {
      if (lerErroGestao(erro).code === "PATRIMONIO_TIPO_EM_USO") {
        const mensagem = mensagemErroPatrimonio(erro, "Este tipo está em uso por bens.");
        setEmUso((atual) => ({ ...atual, [String(registro.id)]: mensagem }));
        notifyWarning("Atenção", mensagem);
        return;
      }
      tratarErro(erro, "Não foi possível excluir o tipo.");
    } finally {
      setSalvando(false);
    }
  };

  /** Reativar um tipo antigo inativo (ele volta a ser oferecido para os bens). @param {any} registro */
  const reativar = async (registro) => {
    if (salvando || !Number.isInteger(registro?.versao)) return;
    setSalvando(true);
    try {
      await alterarSituacaoCatalogo(RECURSO, registro, true);
      notifySuccess("Sucesso", "Tipo reativado");
      invalidar();
    } catch (erro) {
      tratarErro(erro, "Não foi possível reativar o tipo.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog
      open={aberto}
      onOpenChange={(/** @type {boolean} */ o) => {
        if (o || salvando) return;
        // Folha do celular aberta dentro do diálogo: o Escape fecha só a folha.
        if (alvoFolha?.querySelector(".mk-sheet-root")) return;
        onFechar();
      }}
    >
      <DialogContent
        onEscapeKeyDown={(/** @type {KeyboardEvent} */ e) => {
          // Folha do celular aberta: quem decide é o `onOpenChange` (fecha só a folha).
          if (alvoFolha?.querySelector(".mk-sheet-root")) return;
          // Renomeação aberta: o Escape cancela só ela; o diálogo fica.
          if (renomeando) {
            e.preventDefault();
            cancelarRenomear();
          }
        }}
        data-permissao-explicita=""
        data-testid="gerenciar-tipos"
        className="max-h-[92vh] max-w-3xl overflow-y-auto max-sm:inset-0 max-sm:m-auto max-sm:h-fit max-sm:transform-none max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=open]:slide-in-from-top-0 max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=closed]:slide-out-to-top-0"
      >
        <MobileSheetPortalCtx.Provider value={alvoFolha}>
          <DialogHeader>
            <DialogTitle>Gerenciar tipos</DialogTitle>
            <DialogDescription>
              Os tipos valem para todas as fazendas da conta. Cada tipo pertence a um Tipo de bem (benfeitoria, máquina, veículo, implemento, equipamento ou
              outro). Só dá para excluir um tipo que nenhum bem usa: troque antes o tipo desses bens.
            </DialogDescription>
          </DialogHeader>

          {novo ? (
            <div className="min-w-0 rounded-md border border-[var(--mg-divider,#cbd5e1)] p-2" data-testid="gerenciar-form">
              <FormularioTipo key="novo" formId={FORM_TIPO_ID} naturezaInicial={natureza !== "TODAS" ? natureza : null} onSubmit={criar} />
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setNovo(false)} disabled={salvando}>
                  Descartar
                </button>
                <button type="submit" form={FORM_TIPO_ID} className={BOTAO_PRIMARIO} disabled={salvando} data-testid="gerenciar-salvar">
                  {salvando ? "Salvando…" : "Criar tipo"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-[1_1_220px] items-center gap-2 rounded border border-[var(--mg-divider,#cbd5e1)] px-2">
              <Search aria-hidden size={14} className="shrink-0 text-[var(--mg-text-3,#94a3b8)]" />
              <input
                type="search"
                aria-label="Buscar tipos"
                placeholder="Buscar por nome…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="h-10 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                autoComplete="off"
                maxLength={120}
              />
            </div>
            <FiltroOpcoes rotulo="Filtrar por tipo de bem" value={natureza} onChange={setNatureza} opcoes={OPCOES_TIPO_DE_BEM} />
            {acoes.criarCatalogo && !novo ? (
              <button type="button" className={`${BOTAO_PRIMARIO} ml-auto`} onClick={() => setNovo(true)} data-testid="gerenciar-novo">
                <Plus size={16} aria-hidden /> Novo tipo
              </button>
            ) : null}
          </div>

          <div className="min-w-0">
            {lista.isLoading ? (
              <p role="status" className="text-[13px]">
                Carregando…
              </p>
            ) : lista.isError ? (
              <div role="alert" className="text-[13px] text-red-800">
                {mensagemErroPatrimonio(lista.error, "Não foi possível carregar os tipos.")}{" "}
                <button type="button" className="underline" onClick={() => lista.refetch()}>
                  Tentar novamente
                </button>
              </div>
            ) : !itens.length ? (
              <p className="text-[13px]" data-testid="gerenciar-vazio">
                Nenhum tipo encontrado.
              </p>
            ) : (
              <ul className="min-w-0 divide-y divide-slate-100" data-testid="gerenciar-lista-tipos" aria-label="Tipos">
                {itens.map((r) => {
                  const id = String(r.id);
                  const nome = String(r.nome ?? "");
                  const n = naturezaDoTipo(r);
                  const bens = textoDosBens(r);
                  const inativo = r.ativo === false;
                  const editandoEste = renomeando?.id === id;
                  const comVersao = Number.isInteger(r.versao);
                  return (
                    <li key={id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 py-2" data-testid={`gerenciar-tipos-${id}`}>
                      {editandoEste ? (
                        <form
                          className="flex min-w-0 flex-[1_1_240px] flex-wrap items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            salvarNome(r);
                          }}
                          noValidate
                        >
                          <input
                            type="text"
                            aria-label={`Novo nome do tipo ${nome}`}
                            value={renomeando.nome}
                            onChange={(e) => {
                              setRenomeando({ id, nome: e.target.value });
                              setErroRenomear(null);
                            }}
                            maxLength={120}
                            autoFocus
                            className="h-9 min-w-0 flex-[1_1_160px] rounded border border-[var(--mg-divider,#cbd5e1)] px-2 text-[13px] uppercase"
                          />
                          <span className="inline-flex gap-1">
                            <button type="submit" className={BOTAO_LINHA} disabled={salvando}>
                              {salvando ? "Salvando…" : "Salvar"}
                            </button>
                            <button
                              type="button"
                              className={BOTAO_LINHA}
                              onClick={cancelarRenomear}
                              disabled={salvando}
                            >
                              Cancelar
                            </button>
                          </span>
                          {erroRenomear ? (
                            <p role="alert" className="w-full text-[11px] text-red-700">
                              {erroRenomear}
                            </p>
                          ) : null}
                        </form>
                      ) : (
                        <div className="min-w-0 flex-[1_1_200px]">
                          <p className="break-words text-[13px] font-medium uppercase">{nome || "–"}</p>
                          <p className="text-[11px] text-[var(--mg-text-2,#475569)]" data-testid={`gerenciar-tipos-${id}-dados`}>
                            {[n ? ROTULO_NATUREZA[n] : "Tipo de bem não informado", bens, inativo ? "Inativo" : null].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                      )}
                      {!editandoEste ? (
                        <span className="inline-flex flex-wrap justify-end gap-1">
                          {acoes.editarCatalogo && comVersao ? (
                            <button
                              type="button"
                              className={BOTAO_LINHA}
                              onClick={() => {
                                setRenomeando({ id, nome });
                                setErroRenomear(null);
                              }}
                              disabled={salvando}
                              aria-label={`Renomear ${nome || "tipo"}`}
                            >
                              Renomear
                            </button>
                          ) : null}
                          {acoes.inativarCatalogo && inativo && comVersao ? (
                            <button type="button" className={BOTAO_LINHA} onClick={() => reativar(r)} disabled={salvando} aria-label={`Reativar ${nome || "tipo"}`}>
                              Reativar
                            </button>
                          ) : null}
                          {acoes.excluirCatalogo && comVersao ? (
                            <button type="button" className={BOTAO_LINHA_PERIGO} onClick={() => excluir(r)} disabled={salvando} aria-label={`Excluir ${nome || "tipo"}`}>
                              Excluir
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                      {emUso[id] ? (
                        <p role="alert" className="w-full text-[11px] text-amber-800" data-testid={`gerenciar-tipo-em-uso-${id}`}>
                          {emUso[id]}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {lista.hasNextPage ? (
              <button type="button" className={`${BOTAO_SECUNDARIO} mt-2`} onClick={() => lista.fetchNextPage()} disabled={lista.isFetchingNextPage}>
                {lista.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
              </button>
            ) : null}
          </div>
          <DialogFooter>
            <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={salvando}>
              Fechar
            </button>
          </DialogFooter>
        </MobileSheetPortalCtx.Provider>
        <div ref={setAlvoFolha} className="contents" data-testid="gerenciar-tipos-alvo-folha" />
      </DialogContent>
    </Dialog>
  );
}
