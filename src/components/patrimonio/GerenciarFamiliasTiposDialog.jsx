import React, { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import * as UiDialog from "@/components/ui/dialog";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import { ehConflitoDeVersaoPatrimonio, mensagemErroPatrimonio } from "@/lib/patrimonioErros";
import { NATUREZAS_PATRIMONIO, ROTULO_NATUREZA } from "@/lib/patrimonioDominio";
import { ativoDoFiltro } from "@/components/gestao/GestaoFormParts";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { FiltroOpcoes } from "@/components/patrimonio/PatrimonioFormParts";
import FormularioFamilia from "@/components/patrimonio/FormularioFamilia";
import FormularioTipo from "@/components/patrimonio/FormularioTipo";
import { FAMILIAS_COLUNAS, getFamiliaFieldValue } from "@/components/patrimonio/TabelaFamilias";
import { TIPOS_COLUNAS, getTipoFieldValue } from "@/components/patrimonio/TabelaTipos";
import { CHAVE_OPCOES_PATRIMONIO } from "@/components/patrimonio/bemFormulario";
import {
  RECURSOS_CATALOGO,
  alterarSituacaoCatalogo,
  atualizarCatalogo,
  criarCatalogo,
  listarCatalogoPagina,
  listarOpcoesCatalogo,
} from "@/services/patrimonioCatalogoService";

// Os componentes de `ui/dialog` são forwardRef sem tipos: aqui valem como `any`.
const Dialog = /** @type {any} */ (UiDialog.Dialog);
const DialogContent = /** @type {any} */ (UiDialog.DialogContent);
const DialogDescription = /** @type {any} */ (UiDialog.DialogDescription);
const DialogFooter = /** @type {any} */ (UiDialog.DialogFooter);
const DialogHeader = /** @type {any} */ (UiDialog.DialogHeader);
const DialogTitle = /** @type {any} */ (UiDialog.DialogTitle);

/** Raiz das consultas das listas de catálogo (o cadastro rápido e o catálogo padrão invalidam por ela). */
export const QUERY_CATALOGO = "patrimonio-catalogo";

const POR_PAGINA = 50;
const ESPERA_BUSCA_MS = 300;
const FORM_FAMILIA_ID = "formulario-familia-gerenciar";
const FORM_TIPO_ID = "formulario-tipo-gerenciar";

const BOTAO_PRIMARIO =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-4 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60";
const BOTAO_SECUNDARIO =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-4 text-[13px] font-medium hover:bg-slate-50 disabled:opacity-60";
const BOTAO_LINHA = "inline-flex min-h-8 items-center justify-center rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-3 text-[12px] font-medium";

const OPCOES_NATUREZA = [{ value: "TODAS", label: "Todas as naturezas" }, ...NATUREZAS_PATRIMONIO.map((n) => ({ value: n, label: ROTULO_NATUREZA[n] }))];
const OPCOES_SITUACAO = [
  { value: "ativos", label: "Ativos" },
  { value: "inativos", label: "Inativos" },
  { value: "todos", label: "Todos" },
];

/** Colunas da lista do diálogo: as padrão de cada grade (sem a de situação, que vira a coluna de ações). */
const COLUNAS = Object.freeze({
  familias: FAMILIAS_COLUNAS.filter((c) => c.default && c.id !== "ativo"),
  tipos: TIPOS_COLUNAS.filter((c) => c.default && c.id !== "ativo"),
});
const VALOR_DO_CAMPO = Object.freeze({ familias: getFamiliaFieldValue, tipos: getTipoFieldValue });

const TEXTOS = Object.freeze({
  familias: {
    um: "família",
    vazio: "Nenhuma família encontrada.",
    nova: "Nova família",
    criada: "Família patrimonial criada",
    atualizada: "Família patrimonial atualizada",
    inativada: "Família patrimonial inativada",
    reativada: "Família patrimonial reativada",
    efeitoInativar: "Ela deixa de ser oferecida para novos tipos e bens; os bens já cadastrados continuam legíveis. Nada é apagado.",
    efeitoReativar: "Ela volta a ser oferecida para novos tipos e bens.",
  },
  tipos: {
    um: "tipo",
    vazio: "Nenhum tipo encontrado.",
    nova: "Novo tipo",
    criada: "Tipo patrimonial criado",
    atualizada: "Tipo patrimonial atualizado",
    inativada: "Tipo patrimonial inativado",
    reativada: "Tipo patrimonial reativado",
    efeitoInativar: "Ele deixa de ser oferecido para novos bens; os bens já cadastrados continuam legíveis. Nada é apagado.",
    efeitoReativar: "Ele volta a ser oferecido para novos bens.",
  },
});

const MENSAGEM_VERSAO =
  "Este cadastro foi alterado por outra pessoa enquanto você editava. A lista foi recarregada com a versão atual: confira e refaça a alteração. Nada foi gravado.";

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
 * "⋯ › Gerenciar famílias e tipos" do cadastro de Bens (D-PROD-161): famílias
 * e tipos deixaram de ter tela própria e vivem aqui.
 *
 * Duas listas keyset (Famílias, com filtro de natureza; Tipos, com filtro de
 * família), busca no servidor e filtro de situação. Ações pelas regras do
 * servidor sobre a tela de Bens (`acoesDeCatalogoNoBem`):
 *  - "+ Nova" (`criarCatalogo` = Bens novo|salvar|editar), com o código
 *    opcional (P-05);
 *  - "Editar" — renomear/descrever (`editarCatalogo` = Bens editar|salvar);
 *  - "Inativar"/"Reativar" (`inativarCatalogo` = Bens `inativar`), com
 *    confirmação. Nada é apagado.
 * Conflito de versão relê a lista e fecha o formulário (nada foi gravado).
 *
 * @param {{
 *   aberto: boolean,
 *   onFechar: () => void,
 *   acoes: { criarCatalogo: boolean, editarCatalogo: boolean, inativarCatalogo: boolean },
 * }} props
 */
export default function GerenciarFamiliasTiposDialog({ aberto, onFechar, acoes }) {
  const queryClient = useQueryClient();
  const [recurso, setRecurso] = useState(/** @type {'familias'|'tipos'} */ (RECURSOS_CATALOGO.FAMILIAS));
  const [busca, setBusca] = useState("");
  const q = useValorAtrasado(busca.trim(), ESPERA_BUSCA_MS);
  const [situacao, setSituacao] = useState("ativos");
  const [natureza, setNatureza] = useState("TODAS");
  const [familiaFiltro, setFamiliaFiltro] = useState(/** @type {{ id: string, rotulo: string } | null} */ (null));
  const [form, setForm] = useState(/** @type {{ registro: any|null } | null} */ (null));
  const [salvando, setSalvando] = useState(false);
  const ehFamilias = recurso === RECURSOS_CATALOGO.FAMILIAS;
  const textos = TEXTOS[recurso];

  const trocarRecurso = (/** @type {'familias'|'tipos'} */ r) => {
    if (salvando) return;
    setRecurso(r);
    setBusca("");
    setForm(null);
  };

  const filtroDaLista = ehFamilias ? natureza : (familiaFiltro?.id ?? null);
  const lista = useInfiniteQuery({
    queryKey: [QUERY_CATALOGO, recurso, "gerenciar", situacao, filtroDaLista, q],
    queryFn: ({ pageParam }) =>
      listarCatalogoPagina(recurso, {
        limit: POR_PAGINA,
        cursor: pageParam ?? null,
        q: q || undefined,
        ativo: ativoDoFiltro(situacao),
        natureza: ehFamilias && natureza !== "TODAS" ? natureza : null,
        familiaId: ehFamilias ? null : (familiaFiltro?.id ?? null),
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

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: [QUERY_CATALOGO] });
    queryClient.invalidateQueries({ queryKey: CHAVE_OPCOES_PATRIMONIO });
  };

  /** @param {unknown} erro @param {string} fallback */
  const tratarErro = (erro, fallback) => {
    if (ehConflitoDeVersaoPatrimonio(erro)) {
      invalidar();
      setForm(null);
      notifyWarning("Atenção", MENSAGEM_VERSAO);
      return;
    }
    notifyWarning("Atenção", mensagemErroPatrimonio(erro, fallback));
  };

  /** @param {Record<string, any>} dados */
  const salvar = async (dados) => {
    if (!form || salvando) return;
    setSalvando(true);
    try {
      if (form.registro?.id) {
        const { alterado } = await atualizarCatalogo(recurso, form.registro, dados);
        if (!alterado) notifySuccess("Sem alterações", "Nada foi alterado.");
        else notifySuccess("Sucesso", textos.atualizada);
      } else {
        await criarCatalogo(recurso, dados);
        notifySuccess("Sucesso", textos.criada);
      }
      invalidar();
      setForm(null);
    } catch (erro) {
      tratarErro(erro, `Não foi possível salvar (${textos.um}).`);
    } finally {
      setSalvando(false);
    }
  };

  /** @param {any} registro */
  const alternarSituacao = async (registro) => {
    if (salvando || !Number.isInteger(registro?.versao)) return;
    const reativar = registro.ativo === false;
    const verbo = reativar ? "Reativar" : "Inativar";
    const ok = await confirmar({
      titulo: `${verbo} ${textos.um}`,
      descricao: `${verbo} "${registro.nome || textos.um}"? ${reativar ? textos.efeitoReativar : textos.efeitoInativar}`,
      textoConfirmar: verbo,
      perigo: !reativar,
    });
    if (!ok) return;
    setSalvando(true);
    try {
      await alterarSituacaoCatalogo(recurso, registro, reativar);
      invalidar();
      notifySuccess("Sucesso", reativar ? textos.reativada : textos.inativada);
    } catch (erro) {
      tratarErro(erro, reativar ? "Não foi possível reativar." : "Não foi possível inativar.");
    } finally {
      setSalvando(false);
    }
  };

  const colunas = COLUNAS[recurso];
  const valorDoCampo = VALOR_DO_CAMPO[recurso];
  const formId = ehFamilias ? FORM_FAMILIA_ID : FORM_TIPO_ID;
  const comAcoes = acoes.editarCatalogo || acoes.inativarCatalogo;

  return (
    <Dialog open={aberto} onOpenChange={(/** @type {boolean} */ o) => (!o && !salvando ? onFechar() : undefined)}>
      <DialogContent data-permissao-explicita="" data-testid="gerenciar-familias-tipos" className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Famílias e tipos patrimoniais</DialogTitle>
          <DialogDescription>
            Do cadastro de toda a conta (valem para todas as fazendas). A família define a natureza do bem; o tipo fica dentro de uma família. Nada é apagado:
            inativar tira das opções de cadastro e os bens antigos continuam legíveis.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Catálogo">
          {[
            { id: RECURSOS_CATALOGO.FAMILIAS, label: "Famílias" },
            { id: RECURSOS_CATALOGO.TIPOS, label: "Tipos" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={recurso === t.id}
              onClick={() => trocarRecurso(/** @type {'familias'|'tipos'} */ (t.id))}
              className={`min-h-10 rounded-full border px-4 text-[13px] font-medium ${
                recurso === t.id ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-[var(--mg-divider,#cbd5e1)] bg-white"
              }`}
            >
              {t.label}
            </button>
          ))}
          {acoes.criarCatalogo && !form ? (
            <button type="button" className={`${BOTAO_PRIMARIO} ml-auto`} onClick={() => setForm({ registro: null })} data-testid="gerenciar-novo">
              <Plus size={16} aria-hidden /> {textos.nova}
            </button>
          ) : null}
        </div>

        {form ? (
          <div className="rounded-md border border-[var(--mg-divider,#cbd5e1)] p-2" data-testid="gerenciar-form">
            {ehFamilias ? (
              <FormularioFamilia key={form.registro?.id ?? "nova"} formId={formId} initialData={form.registro} onSubmit={salvar} />
            ) : (
              <FormularioTipo key={form.registro?.id ?? "novo"} formId={formId} initialData={form.registro} onSubmit={salvar} />
            )}
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setForm(null)} disabled={salvando}>
                Descartar
              </button>
              <button type="submit" form={formId} className={BOTAO_PRIMARIO} disabled={salvando} data-testid="gerenciar-salvar">
                {salvando ? "Salvando…" : form.registro?.id ? "Salvar alterações" : `Criar ${textos.um}`}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mg-b1-form-grid grid min-w-0 grid-cols-12 items-center gap-x-3 gap-y-2">
          <div className="col-span-12 flex min-w-0 items-center gap-2 rounded border border-[var(--mg-divider,#cbd5e1)] px-2 md:col-span-6">
            <Search aria-hidden size={14} className="shrink-0 text-[var(--mg-text-3,#94a3b8)]" />
            <input
              type="search"
              aria-label={ehFamilias ? "Buscar famílias" : "Buscar tipos"}
              placeholder="Buscar por nome ou código…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="h-10 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
              autoComplete="off"
              maxLength={120}
            />
          </div>
          <div className="col-span-12 flex flex-wrap items-center gap-2 md:col-span-6">
            {ehFamilias ? <FiltroOpcoes rotulo="Filtrar por natureza" value={natureza} onChange={setNatureza} opcoes={OPCOES_NATUREZA} /> : null}
            <FiltroOpcoes rotulo="Filtrar por situação" value={situacao} onChange={setSituacao} opcoes={OPCOES_SITUACAO} />
          </div>
          {!ehFamilias ? (
            <SeletorPaginadoGestao
              rotulo="Filtrar por família"
              testId="gerenciar-filtro-familia"
              chave={["patrimonio", RECURSOS_CATALOGO.FAMILIAS, "gerenciar"]}
              buscar={({ q: termo, cursor, limit }) => listarOpcoesCatalogo(RECURSOS_CATALOGO.FAMILIAS, { q: termo, cursor, limit })}
              value={familiaFiltro}
              onChange={(o) => setFamiliaFiltro(o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null)}
              detalheDaOpcao={(o) => /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[o?.natureza] ?? null}
              permitirLimpar
              textoVazio="Todas as famílias"
              span={12}
            />
          ) : null}
        </div>

        <div className="min-w-0 overflow-x-auto">
          {lista.isLoading ? (
            <p role="status" className="text-[13px]">
              Carregando…
            </p>
          ) : lista.isError ? (
            <div role="alert" className="text-[13px] text-red-800">
              {mensagemErroPatrimonio(lista.error, "Não foi possível carregar a lista.")}{" "}
              <button type="button" className="underline" onClick={() => lista.refetch()}>
                Tentar novamente
              </button>
            </div>
          ) : !itens.length ? (
            <p className="text-[13px]" data-testid="gerenciar-vazio">
              {textos.vazio}
            </p>
          ) : (
            <table className="w-full text-[12px]" data-testid={`gerenciar-lista-${recurso}`}>
              <thead>
                <tr className="text-left text-[var(--mg-text-2,#475569)]">
                  {colunas.map((c) => (
                    <th key={c.id} className="py-1 pr-2">
                      {c.label}
                    </th>
                  ))}
                  <th className="py-1 pr-2">Situação</th>
                  {comAcoes ? <th className="py-1" /> : null}
                </tr>
              </thead>
              <tbody>
                {itens.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100" data-testid={`gerenciar-${recurso}-${r.id}`}>
                    {colunas.map((c) => (
                      <td key={c.id} className={`py-1 pr-2 ${c.id === "codigo" ? "font-mono" : ""} ${c.id === "nome" ? "uppercase" : ""}`}>
                        {valorDoCampo(r, c.id) || "–"}
                      </td>
                    ))}
                    <td className="py-1 pr-2">{r.ativo === false ? "Inativo" : "Ativo"}</td>
                    {comAcoes ? (
                      <td className="py-1 text-right">
                        <span className="inline-flex flex-wrap justify-end gap-1">
                          {acoes.editarCatalogo ? (
                            <button
                              type="button"
                              className={BOTAO_LINHA}
                              onClick={() => setForm({ registro: r })}
                              disabled={salvando}
                              aria-label={`Editar ${r.nome || textos.um}`}
                            >
                              Editar
                            </button>
                          ) : null}
                          {acoes.inativarCatalogo && Number.isInteger(r.versao) ? (
                            <button
                              type="button"
                              className={BOTAO_LINHA}
                              onClick={() => alternarSituacao(r)}
                              disabled={salvando}
                              aria-label={`${r.ativo === false ? "Reativar" : "Inativar"} ${r.nome || textos.um}`}
                            >
                              {r.ativo === false ? "Reativar" : "Inativar"}
                            </button>
                          ) : null}
                        </span>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
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
      </DialogContent>
    </Dialog>
  );
}
