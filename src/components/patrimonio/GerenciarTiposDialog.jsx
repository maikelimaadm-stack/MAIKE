import React, { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Search, X } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { MobileSheetPortalCtx } from "@/components/common/MobileSheet";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import { lerErroGestao } from "@/lib/gestaoErros";
import { ehConflitoDeVersaoPatrimonio, ehNaoEncontradoPatrimonio, mensagemErroPatrimonio } from "@/lib/patrimonioErros";
import { NATUREZAS_PATRIMONIO, ROTULO_NATUREZA, ehNatureza } from "@/lib/patrimonioDominio";
import { FiltroOpcoes } from "@/components/patrimonio/PatrimonioFormParts";
import FormularioTipo from "@/components/patrimonio/FormularioTipo";
import { CHAVE_OPCOES_PATRIMONIO, LIMITES_BEM, LOCALE_BEM, lerDecimal, textoDecimal, usaCustoDeUso } from "@/components/patrimonio/bemFormulario";
import { CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import { comparar, formatarNumero } from "@/lib/dinheiroDecimal";
import {
  RECURSOS_CATALOGO,
  alterarSituacaoCatalogo,
  atualizarCatalogo,
  criarCatalogo,
  excluirCatalogo,
  listarCatalogoPagina,
} from "@/services/patrimonioCatalogoService";

/** Raiz das consultas da lista de tipos (o cadastro rápido e a gravação invalidam por ela). */
export const QUERY_CATALOGO = "patrimonio-catalogo";
/** Raiz das consultas dos Bens (página da grade e detalhe: `BensPatrimoniaisTela`). */
const QUERY_BENS = "bens-patrimoniais";

const POR_PAGINA = 50;
const ESPERA_BUSCA_MS = 300;
const FORM_TIPO_ID = "formulario-tipo-gerenciar";
const RECURSO = RECURSOS_CATALOGO.TIPOS;

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
 * Janela do motor Base1 (`B1Janela`, o desenho de "Configurar colunas"): título e ✕ no cabeçalho, pesquisa em
 * pílula, filtro, botões do motor (`tb-btn`) e os campos do "+ Novo tipo" no desenho do formulário.
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
  // D-PROD-201: a edição na linha também troca o teto de salto do medidor (tipos de máquina, veículo e equipamento).
  const [renomeando, setRenomeando] = useState(/** @type {{ id: string, nome: string, salto: string } | null} */ (null));
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
    const salto = lerDecimal(renomeando.salto, LIMITES_BEM.MEDIDA);
    if (!salto.ok) {
      setErroRenomear("Teto de salto: zero ou mais, até 4 casas decimais.");
      return;
    }
    const saltoGravado = typeof registro.salto_maximo_medidor === "string" ? registro.salto_maximo_medidor : null;
    const saltoMudou = (salto.valor === null) !== (saltoGravado === null) || (salto.valor !== null && saltoGravado !== null && comparar(salto.valor, saltoGravado) !== 0);
    setSalvando(true);
    try {
      const { alterado } = await atualizarCatalogo(RECURSO, registro, saltoMudou ? { nome, salto_maximo_medidor: salto.valor } : { nome });
      if (!alterado) notifySuccess("Sem alterações", "Nada foi alterado.");
      else notifySuccess("Sucesso", nome !== String(registro.nome ?? "") ? "Tipo renomeado" : "Tipo atualizado");
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
    <B1Janela
      aberto={aberto}
      onFechar={onFechar}
      titulo="Gerenciar tipos"
      descricao={
        <>
          Os tipos valem para todas as fazendas da conta. Cada tipo pertence a um Tipo de bem (benfeitoria, máquina, veículo, implemento, equipamento ou
          outro). Só dá para excluir um tipo que nenhum bem usa: troque antes o tipo desses bens.
        </>
      }
      podeFechar={!salvando}
      // Folha do celular aberta dentro da janela: o pedido de fechar (Escape) fecha só a folha.
      aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
      onEscapeKeyDown={(/** @type {KeyboardEvent} */ e) => {
        if (alvoFolha?.querySelector(".mk-sheet-root")) return;
        // Renomeação aberta: o Escape cancela só ela; a janela fica.
        if (renomeando) {
          e.preventDefault();
          cancelarRenomear();
        }
      }}
      className="b1-gerenciar"
      testId="gerenciar-tipos"
      contentProps={{ "data-permissao-explicita": "" }}
      fora={<div ref={setAlvoFolha} className="contents" data-testid="gerenciar-tipos-alvo-folha" />}
    >
      <MobileSheetPortalCtx.Provider value={alvoFolha}>
        {novo ? (
          <div className="b1-gerenciar__novo" data-testid="gerenciar-form">
            <FormularioTipo key="novo" formId={FORM_TIPO_ID} naturezaInicial={natureza !== "TODAS" ? natureza : null} onSubmit={criar} />
            <div className="b1-gerenciar__novo-acoes">
              <button type="button" className="tb-btn tb-btn-gray" onClick={() => setNovo(false)} disabled={salvando}>
                <X className="h-4 w-4" aria-hidden />
                Descartar
              </button>
              <button type="submit" form={FORM_TIPO_ID} className="tb-btn tb-btn-green" disabled={salvando} data-testid="gerenciar-salvar">
                <Check className="h-4 w-4" aria-hidden />
                {salvando ? "Salvando…" : "Criar tipo"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="b1-gerenciar__barra">
          <label className="mk-pill b1-gerenciar__busca">
            <Search size={14} aria-hidden />
            <input
              type="search"
              aria-label="Buscar tipos"
              placeholder="Buscar por nome…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              autoComplete="off"
              maxLength={120}
            />
            {busca ? (
              <button type="button" className="xlim" aria-label="Limpar busca" onClick={() => setBusca("")}>
                <X size={13} aria-hidden />
              </button>
            ) : null}
          </label>
          <FiltroOpcoes rotulo="Filtrar por tipo de bem" value={natureza} onChange={setNatureza} opcoes={OPCOES_TIPO_DE_BEM} />
          {acoes.criarCatalogo && !novo ? (
            <button type="button" className="tb-btn tb-btn-green b1-gerenciar__novo-btn" onClick={() => setNovo(true)} data-testid="gerenciar-novo">
              <Plus className="h-4 w-4" aria-hidden /> Novo tipo
            </button>
          ) : null}
        </div>

        <div className="b1-gerenciar__rolagem">
          {lista.isLoading ? (
            <p role="status" className="b1-gerenciar__estado">
              Carregando…
            </p>
          ) : lista.isError ? (
            <div role="alert" className="b1-gerenciar__estado b1-gerenciar__estado--erro">
              {mensagemErroPatrimonio(lista.error, "Não foi possível carregar os tipos.")}{" "}
              <button type="button" className="underline" onClick={() => lista.refetch()}>
                Tentar novamente
              </button>
            </div>
          ) : !itens.length ? (
            <p className="b1-gerenciar__estado" data-testid="gerenciar-vazio">
              Nenhum tipo encontrado.
            </p>
          ) : (
            <ul className="b1-gerenciar__lista" data-testid="gerenciar-lista-tipos" aria-label="Tipos">
              {itens.map((r) => {
                const id = String(r.id);
                const nome = String(r.nome ?? "");
                const n = naturezaDoTipo(r);
                const bens = textoDosBens(r);
                const inativo = r.ativo === false;
                const editandoEste = renomeando?.id === id;
                const comTeto = usaCustoDeUso(n);
                const teto = typeof r.salto_maximo_medidor === "string" && r.salto_maximo_medidor ? r.salto_maximo_medidor : null;
                const comVersao = Number.isInteger(r.versao);
                return (
                  <li key={id} className="b1-gerenciar__item" data-testid={`gerenciar-tipos-${id}`}>
                    {editandoEste ? (
                      <form
                        className="b1-gerenciar__renomear"
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
                            const valor = e.target.value;
                            setRenomeando((atual) => ({ id, nome: valor, salto: atual?.salto ?? "" }));
                            setErroRenomear(null);
                          }}
                          maxLength={120}
                          autoFocus
                          className="b1-gerenciar__campo"
                        />
                        {comTeto ? (
                          <CampoNumero
                            label="Teto de salto do medidor"
                            value={renomeando.salto}
                            onChange={(v) => {
                              setRenomeando((atual) => ({ id, nome: atual?.nome ?? nome, salto: v }));
                              setErroRenomear(null);
                            }}
                            locale={LOCALE_BEM}
                            limites={LIMITES_BEM.MEDIDA}
                            span={12}
                            testId={`gerenciar-tipos-${id}-salto`}
                          />
                        ) : null}
                        <span className="b1-gerenciar__acoes">
                          <button type="submit" className="tb-btn tb-btn-green" disabled={salvando}>
                            {salvando ? "Salvando…" : "Salvar"}
                          </button>
                          <button type="button" className="tb-btn" onClick={cancelarRenomear} disabled={salvando}>
                            Cancelar
                          </button>
                        </span>
                        {erroRenomear ? (
                          <p role="alert" className="b1-gerenciar__aviso b1-gerenciar__aviso--erro">
                            {erroRenomear}
                          </p>
                        ) : null}
                      </form>
                    ) : (
                      <div className="b1-gerenciar__txt">
                        <p className="b1-gerenciar__nome">{nome || "–"}</p>
                        <p className="b1-gerenciar__dados" data-testid={`gerenciar-tipos-${id}-dados`}>
                          {[
                            n ? ROTULO_NATUREZA[n] : "Tipo de bem não informado",
                            bens,
                            teto ? `Teto de salto: ${formatarNumero(teto, { locale: LOCALE_BEM, casasMin: 0, casasMax: 4 })}` : null,
                            inativo ? "Inativo" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    )}
                    {!editandoEste ? (
                      <span className="b1-gerenciar__acoes">
                        {acoes.editarCatalogo && comVersao ? (
                          <button
                            type="button"
                            className="tb-btn"
                            onClick={() => {
                              setRenomeando({ id, nome, salto: textoDecimal(teto) });
                              setErroRenomear(null);
                            }}
                            disabled={salvando}
                            aria-label={`Renomear ${nome || "tipo"}`}
                          >
                            Renomear
                          </button>
                        ) : null}
                        {acoes.inativarCatalogo && inativo && comVersao ? (
                          <button type="button" className="tb-btn" onClick={() => reativar(r)} disabled={salvando} aria-label={`Reativar ${nome || "tipo"}`}>
                            Reativar
                          </button>
                        ) : null}
                        {acoes.excluirCatalogo && comVersao ? (
                          <button type="button" className="tb-btn tb-btn-red" onClick={() => excluir(r)} disabled={salvando} aria-label={`Excluir ${nome || "tipo"}`}>
                            Excluir
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                    {emUso[id] ? (
                      <p role="alert" className="b1-gerenciar__aviso" data-testid={`gerenciar-tipo-em-uso-${id}`}>
                        {emUso[id]}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {lista.hasNextPage ? (
            <button type="button" className="tb-btn tb-btn-gray b1-gerenciar__mais" onClick={() => lista.fetchNextPage()} disabled={lista.isFetchingNextPage}>
              {lista.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
            </button>
          ) : null}
        </div>
      </MobileSheetPortalCtx.Provider>
    </B1Janela>
  );
}
