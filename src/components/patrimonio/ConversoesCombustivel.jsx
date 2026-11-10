import React, { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import * as UiDialog from "@/components/ui/dialog";
import { CampoNumero, EscolhaSegmentada } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { configurarConversao, encerrarConversao, listarConversoesPagina, listarOpcoesAbastecimento } from "@/services/abastecimentoService";
import { mensagemErroAbastecimento } from "@/lib/patrimonioErros";
import { lerErroGestao } from "@/lib/gestaoErros";
import { confirmar } from "@/lib/maikeConfirmar";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { formatarInstante } from "@/lib/diaCivil";
import { LIMITES_ABASTECIMENTO, LOCALE_ABASTECIMENTO, formatarFator, validarConversao } from "@/lib/abastecimentoRegras";
import { BOTAO_PERIGO, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";

const Dialog = /** @type {any} */ (UiDialog.Dialog);
const DialogContent = /** @type {any} */ (UiDialog.DialogContent);
const DialogDescription = /** @type {any} */ (UiDialog.DialogDescription);
const DialogFooter = /** @type {any} */ (UiDialog.DialogFooter);
const DialogHeader = /** @type {any} */ (UiDialog.DialogHeader);
const DialogTitle = /** @type {any} */ (UiDialog.DialogTitle);

/** Raiz das consultas dos fatores (invalidada depois de salvar/encerrar). */
export const CHAVE_CONVERSOES = ["patrimonio-abastecimentos", "conversoes"];
/** Opções de produto do formulário de abastecimento (trazem o fator vigente). */
export const CHAVE_OPCOES_PRODUTOS_ABASTECIMENTO = ["lancamentos-financeiros-gestao", "opcoes", "patrimonio", "abastecimento", "produtos"];

const POR_PAGINA = 50;

const DECLARACAO =
  "Declaro que o estoque deste produto está em quilogramas (KG) e que este fator foi informado pelo responsável — não é densidade presumida.";

const SITUACOES = [
  { value: "TODAS", label: "Vigentes e históricos" },
  { value: "VIGENTES", label: "Só vigentes" },
];

/**
 * @typedef {{ tipo: { id: string, nome: string } | null, produto: { id: string, nome: string, conversao?: any } | null,
 *   kg_por_litro: string, declara: boolean, vigenteId: string|null, vigente: any }} FormFator
 */

/** @param {{ tipo: any, produto: any } | null} par @returns {FormFator} */
const formDoPar = (par) => ({
  tipo: par?.tipo ?? null,
  produto: par?.produto ?? null,
  kg_por_litro: "",
  declara: false,
  vigenteId: par?.produto?.conversao?.id ?? null,
  vigente: par?.produto?.conversao ?? null,
});

/**
 * Fatores de conversão kg/L da fazenda (D-PROD-159): por combustível × produto,
 * INFORMADOS pelo responsável e versionados. Alterar = nova versão (a vigente é
 * encerrada no mesmo comando); o histórico fica legível. Salvar envia o id da
 * vigente lida para o par (`conversao_vigente_id`): se outro usuário mudou no
 * meio, o servidor recusa (409) e a tela relê.
 * @param {{
 *   aberto: boolean,
 *   empresaId: string|null,
 *   podeConfigurar: boolean,
 *   parInicial: { tipo: any, produto: any } | null,
 *   onFechar: () => void,
 *   onSalvo?: (conversao: any) => void,
 * }} props
 */
export default function ConversoesCombustivel({ aberto, empresaId, podeConfigurar, parInicial, onFechar, onSalvo }) {
  const queryClient = useQueryClient();
  const [situacao, setSituacao] = useState("TODAS");
  const [tipoFiltro, setTipoFiltro] = useState(/** @type {{ id: string, rotulo: string } | null} */ (null));
  const [produtoFiltro, setProdutoFiltro] = useState(/** @type {{ id: string, rotulo: string } | null} */ (null));
  const [form, setForm] = useState(/** @type {FormFator|null} */ (null));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [aviso, setAviso] = useState(/** @type {string|null} */ (null));
  const [salvando, setSalvando] = useState(false);
  const enviando = useRef(false);

  // Abrir com um par (do formulário ou da prévia) já começa o novo fator dele.
  useEffect(() => {
    if (!aberto) {
      setForm(null);
      setErros({});
      setAviso(null);
      return;
    }
    if (parInicial && podeConfigurar) setForm(formDoPar(parInicial));
  }, [aberto, parInicial, podeConfigurar]);

  const lista = useInfiniteQuery({
    queryKey: [...CHAVE_CONVERSOES, empresaId, situacao, tipoFiltro?.id ?? null, produtoFiltro?.id ?? null],
    queryFn: ({ pageParam }) =>
      listarConversoesPagina(empresaId, {
        situacao: /** @type {any} */ (situacao),
        tipoCombustivelId: tipoFiltro?.id ?? null,
        produtoId: produtoFiltro?.id ?? null,
        cursor: pageParam ?? null,
        limit: POR_PAGINA,
      }),
    initialPageParam: /** @type {string|null} */ (null),
    getNextPageParam: (ultima) => (ultima?.has_more && ultima.next_cursor ? ultima.next_cursor : undefined),
    enabled: aberto && Boolean(empresaId),
  });
  const itens = (lista.data?.pages ?? []).flatMap((p) => /** @type {any[]} */ (p?.items ?? []));

  const reler = () => {
    queryClient.invalidateQueries({ queryKey: CHAVE_CONVERSOES });
    queryClient.invalidateQueries({ queryKey: CHAVE_OPCOES_PRODUTOS_ABASTECIMENTO });
  };

  const salvar = async () => {
    if (!form || !empresaId || enviando.current) return;
    const v = validarConversao({
      tipo_combustivel_id: form.tipo?.id ?? null,
      produto_id: form.produto?.id ?? null,
      kg_por_litro: form.kg_por_litro,
      declara_estoque_em_kg: form.declara,
    });
    setErros(v.erros);
    if (Object.keys(v.erros).length) return;
    enviando.current = true;
    setSalvando(true);
    setAviso(null);
    const emp = empresaId;
    try {
      const criado = await configurarConversao(emp, {
        tipoCombustivelId: /** @type {string} */ (form.tipo?.id),
        produtoId: /** @type {string} */ (form.produto?.id),
        kgPorLitro: form.kg_por_litro,
        declaraEstoqueEmKg: form.declara,
        conversaoVigenteId: form.vigenteId,
      });
      reler();
      setForm(null);
      notifySuccess("Fator salvo", `Fator ${formatarFator(/** @type {any} */ (criado)?.kg_por_litro)} kg/L vigente (versão ${/** @type {any} */ (criado)?.sequencia ?? "?"}).`);
      onSalvo?.(criado);
    } catch (erro) {
      const { code, details } = lerErroGestao(erro);
      if (code === "ABASTECIMENTO_CONVERSAO_ALTERADA") {
        // Outro usuário mudou o fator do par: relê e passa a apontar para a vigente atual.
        reler();
        const vigenteId = typeof details.conversao_vigente_id === "string" ? details.conversao_vigente_id : null;
        setForm((f) => (f ? { ...f, vigenteId, vigente: vigenteId ? { id: vigenteId, versao: details.conversao_vigente_versao } : null } : f));
        setAviso("O fator vigente deste par mudou enquanto você editava. A lista foi relida: confira e salve de novo. Nada foi gravado.");
      } else setAviso(mensagemErroAbastecimento(erro, "Não foi possível salvar o fator. Nada foi gravado."));
    } finally {
      enviando.current = false;
      setSalvando(false);
    }
  };

  /** @param {any} conversao */
  const encerrar = async (conversao) => {
    if (!empresaId || enviando.current) return;
    const ok = await confirmar({
      titulo: "Encerrar fator kg/L",
      descricao: `Encerrar o fator ${formatarFator(conversao.kg_por_litro)} kg/L de ${conversao.produto?.nome ?? "produto"}? Sem fator vigente, novos abastecimentos deste produto e combustível são recusados até um novo fator. O histórico continua.`,
      textoConfirmar: "Encerrar",
      perigo: true,
    });
    if (!ok) return;
    enviando.current = true;
    try {
      await encerrarConversao(empresaId, conversao);
      reler();
      notifySuccess("Fator encerrado", "O par ficou sem fator vigente.");
    } catch (erro) {
      reler();
      notifyWarning("Atenção", mensagemErroAbastecimento(erro, "Não foi possível encerrar o fator. Nada foi alterado."));
    } finally {
      enviando.current = false;
    }
  };

  /** @param {any} c */
  const alterar = (c) =>
    setForm({
      tipo: c.tipo_combustivel ? { id: String(c.tipo_combustivel.id), nome: String(c.tipo_combustivel.nome ?? "") } : null,
      produto: c.produto ? { id: String(c.produto.id), nome: String(c.produto.nome ?? "") } : null,
      kg_por_litro: "",
      declara: false,
      vigenteId: String(c.id),
      vigente: c,
    });

  const proximaVersao = Number.isInteger(form?.vigente?.sequencia) ? form.vigente.sequencia + 1 : null;

  return (
    <Dialog open={aberto} onOpenChange={(/** @type {boolean} */ o) => (!o && !salvando ? onFechar() : undefined)}>
      <DialogContent data-permissao-explicita="" data-testid="conversoes-combustivel" className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fatores de conversão kg/L</DialogTitle>
          <DialogDescription>
            Por combustível e produto desta fazenda. O fator é INFORMADO pelo responsável (nunca densidade presumida) e converte os litros abastecidos no KG
            baixado do estoque. Alterar cria uma nova versão; os abastecimentos já feitos guardam o fator que usaram.
          </DialogDescription>
        </DialogHeader>

        {podeConfigurar && !form ? (
          <div>
            <button type="button" className={BOTAO_PRIMARIO} onClick={() => setForm(formDoPar(null))} data-testid="conversao-nova">
              <Plus size={16} aria-hidden /> Novo fator
            </button>
          </div>
        ) : null}

        {form ? (
          <div className="mg-b1-form-grid grid min-w-0 grid-cols-12 gap-x-3 gap-y-2 rounded-md border border-[var(--mg-divider,#cbd5e1)] p-3" data-testid="conversao-form">
            <SeletorPaginadoGestao
              rotulo="Combustível"
              testId="conversao-tipo"
              chave={["patrimonio", "abastecimento", "tipos"]}
              buscar={({ q, cursor, limit }) => listarOpcoesAbastecimento("tipos", empresaId, { q, cursor, limit })}
              value={form.tipo ? { id: form.tipo.id, rotulo: form.tipo.nome } : null}
              onChange={(o) => setForm((f) => (f ? { ...f, tipo: o ? { id: String(o.id), nome: String(o.nome ?? "") } : null, produto: null, vigenteId: null, vigente: null } : f))}
              obrigatorio
              erro={erros.tipo_combustivel_id}
              span={6}
              maiusculas={false}
            />
            <SeletorPaginadoGestao
              rotulo="Produto"
              testId="conversao-produto"
              chave={["patrimonio", "abastecimento", "produtos", empresaId, form.tipo?.id ?? null]}
              buscar={({ q, cursor, limit }) => listarOpcoesAbastecimento("produtos", empresaId, { q, cursor, limit, tipoCombustivelId: form.tipo?.id })}
              value={form.produto ? { id: form.produto.id, rotulo: form.produto.nome } : null}
              onChange={(o) =>
                setForm((f) =>
                  f ? { ...f, produto: o ? { id: String(o.id), nome: String(o.nome ?? ""), conversao: o.conversao ?? null } : null, vigenteId: o?.conversao?.id ?? null, vigente: o?.conversao ?? null } : f,
                )
              }
              detalheDaOpcao={(o) => (o?.conversao ? `vigente: ${formatarFator(o.conversao.kg_por_litro)} kg/L` : "sem fator")}
              bloqueadoMotivo={form.tipo ? null : "Escolha o combustível primeiro"}
              obrigatorio
              erro={erros.produto_id}
              span={6}
              maiusculas={false}
            />
            <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="conversao-vigente">
              {form.produto
                ? form.vigente?.kg_por_litro
                  ? `Fator vigente: ${formatarFator(form.vigente.kg_por_litro)} kg/L (versão ${form.vigente.sequencia ?? "?"}). Salvar encerra este e cria a versão ${proximaVersao ?? "seguinte"}.`
                  : form.vigenteId
                    ? "Há um fator vigente para este par: salvar o substitui por uma nova versão."
                    : "Este par ainda não tem fator: salvar cria a versão 1."
                : null}
            </p>
            <CampoNumero
              label="Fator (kg por litro)"
              sufixo="kg/L"
              value={form.kg_por_litro}
              onChange={(v) => setForm((f) => (f ? { ...f, kg_por_litro: v } : f))}
              locale={LOCALE_ABASTECIMENTO}
              limites={LIMITES_ABASTECIMENTO.FATOR}
              required
              span={4}
              error={erros.kg_por_litro}
              ajuda="ex.: 0,84"
              testId="conversao-fator"
            />
            <label className="col-span-12 flex min-w-0 items-start gap-2 text-[13px] md:col-span-8">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 accent-emerald-600"
                style={{ width: 20, height: 20 }}
                checked={form.declara}
                onChange={(e) => setForm((f) => (f ? { ...f, declara: e.target.checked } : f))}
                data-testid="conversao-declaracao"
              />
              <span className="min-w-0 break-words">{DECLARACAO}</span>
            </label>
            {erros.declara_estoque_em_kg ? <p className="col-span-12 text-[12px] text-red-700">{erros.declara_estoque_em_kg}</p> : null}
            {aviso ? (
              <p role="alert" className="col-span-12 rounded-md border border-red-200 bg-red-50 p-2 text-[12px] text-red-800" data-testid="conversao-erro">
                {aviso}
              </p>
            ) : null}
            <div className="col-span-12 flex flex-wrap gap-2">
              <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setForm(null)} disabled={salvando}>
                Descartar
              </button>
              <button type="button" className={BOTAO_PRIMARIO} onClick={salvar} disabled={salvando} data-testid="conversao-salvar">
                {salvando ? "Salvando…" : "Salvar fator"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mg-b1-form-grid grid min-w-0 grid-cols-12 gap-x-3 gap-y-2">
          <SeletorPaginadoGestao
            rotulo="Filtrar por combustível"
            testId="conversoes-filtro-tipo"
            chave={["patrimonio", "abastecimento", "tipos", "filtro"]}
            buscar={({ q, cursor, limit }) => listarOpcoesAbastecimento("tipos", empresaId, { q, cursor, limit })}
            value={tipoFiltro}
            onChange={(o) => setTipoFiltro(o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null)}
            permitirLimpar
            textoVazio="Todos os combustíveis"
            span={6}
            maiusculas={false}
          />
          <SeletorPaginadoGestao
            rotulo="Filtrar por produto"
            testId="conversoes-filtro-produto"
            chave={["patrimonio", "abastecimento", "produtos-filtro", empresaId]}
            buscar={({ q, cursor, limit }) => listarOpcoesAbastecimento("produtos-filtro", empresaId, { q, cursor, limit })}
            value={produtoFiltro}
            onChange={(o) => setProdutoFiltro(o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null)}
            permitirLimpar
            textoVazio="Todos os produtos"
            span={6}
            maiusculas={false}
          />
          <EscolhaSegmentada rotulo="Situação" value={situacao} onChange={setSituacao} opcoes={SITUACOES} testId="conversoes-situacao" />
        </div>
        <div className="min-w-0 overflow-x-auto">
          {!empresaId ? (
            <p role="status">Selecione uma fazenda.</p>
          ) : lista.isLoading ? (
            <p role="status">Carregando fatores…</p>
          ) : lista.isError ? (
            <div role="alert" className="text-[13px] text-red-800">
              {mensagemErroAbastecimento(lista.error, "Não foi possível carregar os fatores.")}{" "}
              <button type="button" className="underline" onClick={() => lista.refetch()}>
                Tentar novamente
              </button>
            </div>
          ) : !itens.length ? (
            <p className="text-[13px]" data-testid="conversoes-vazio">
              Nenhum fator kg/L configurado nesta fazenda.
            </p>
          ) : (
            <table className="w-full text-[12px]" data-testid="conversoes-lista">
              <thead>
                <tr className="text-left text-[var(--mg-text-2,#475569)]">
                  <th className="py-1 pr-2">Combustível</th>
                  <th className="py-1 pr-2">Produto</th>
                  <th className="py-1 pr-2">Versão</th>
                  <th className="py-1 pr-2 text-right">kg/L</th>
                  <th className="py-1 pr-2">Situação</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {itens.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100" data-testid={`conversao-${c.id}`}>
                    <td className="py-1 pr-2">{c.tipo_combustivel?.nome ?? "—"}</td>
                    <td className="py-1 pr-2">{c.produto?.nome ?? "—"}</td>
                    <td className="py-1 pr-2">{c.sequencia}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{formatarFator(c.kg_por_litro)}</td>
                    <td className="py-1 pr-2">
                      {c.ativo ? (
                        <span className="font-semibold text-emerald-800">Vigente</span>
                      ) : (
                        <span className="text-[var(--mg-text-2,#475569)]">Encerrado{c.encerrado_em ? ` em ${formatarInstante(c.encerrado_em, "pt-BR")}` : ""}</span>
                      )}
                      {c.criado_por?.login ? <span className="block text-[11px] text-[var(--mg-text-2,#475569)]">por {c.criado_por.login}</span> : null}
                    </td>
                    <td className="py-1 text-right">
                      {podeConfigurar && c.ativo ? (
                        <span className="inline-flex flex-wrap justify-end gap-1">
                          <button type="button" className={`${BOTAO_SECUNDARIO} min-h-8 px-3`} onClick={() => alterar(c)} data-testid={`conversao-alterar-${c.id}`}>
                            Alterar
                          </button>
                          <button type="button" className={`${BOTAO_PERIGO} min-h-8 px-3`} onClick={() => encerrar(c)} data-testid={`conversao-encerrar-${c.id}`}>
                            Encerrar
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {lista.hasNextPage ? (
            <button type="button" className={`${BOTAO_SECUNDARIO} mt-2`} onClick={() => lista.fetchNextPage()} disabled={lista.isFetchingNextPage}>
              Carregar mais
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
