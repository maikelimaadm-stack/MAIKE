import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";
import { parseDecimalPtBR } from "@/domain/numeroPtBR";

/**
 * D-PROD-286 — seção "Unidades" do cadastro do produto: a lista de unidades de conversão da unidade de estoque.
 * Cada linha: unidade (sigla), Multiplica/Divide, fator, uso em compra e em saída, e a prévia em linguagem simples
 * ("1 SACO = 25 KG"). O servidor confere de novo (sigla, fator > 0, divide ≤ 10000, nunca a unidade de estoque);
 * unidade já usada em lançamento, tirada da lista, fica desativada em vez de apagada.
 */

export const SIGLAS_RESERVADAS = Object.freeze(["KG", "L", "UN"]);
const FATOR_DIVIDE_MAXIMO = 10000;

/** @param {any} produto */
export const linhasIniciaisConversao = (produto) =>
  (Array.isArray(produto?.unidades_conversao) ? produto.unidades_conversao : []).map((c) => ({
    id: c.id ?? null,
    sigla: String(c.sigla ?? ""),
    operacao: c.operacao === "DIVIDE" ? "DIVIDE" : "MULTIPLICA",
    fator: c.fator == null ? "" : String(Number(c.fator)).replace(".", ","),
    uso_compra: c.uso_compra !== false,
    uso_venda: c.uso_venda !== false,
    codigo_barras: c.codigo_barras ?? "",
    ativa: c.ativa !== false,
  }));

const novaLinha = () => ({ id: null, sigla: "", operacao: "MULTIPLICA", fator: "", uso_compra: true, uso_venda: true, codigo_barras: "", ativa: true });

/** Fator digitado (pt-BR) → número, ou null. @param {unknown} v */
const lerFator = (v) => {
  const n = typeof v === "number" ? v : parseDecimalPtBR(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** "1 SACO = 25 KG" / "1 G = 0,001 KG"; vazio sem sigla ou fator. @param {any} l @param {string} unidadeEstoque */
export const previaDaConversao = (l, unidadeEstoque) => {
  const sigla = String(l?.sigla ?? "").trim().toUpperCase();
  const fator = lerFator(l?.fator);
  if (!sigla || !fator) return "";
  const um = l.operacao === "DIVIDE" ? 1 / fator : fator;
  return `1 ${sigla} = ${um.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} ${unidadeEstoque}`;
};

/** Erros por linha: `{ "0.sigla": "...", ... }`. @param {any[]} linhas @param {string} unidadeEstoque */
export const errosDasConversoes = (linhas, unidadeEstoque) => {
  /** @type {Record<string, string>} */
  const erros = {};
  const vistas = new Set();
  (linhas ?? []).forEach((l, i) => {
    const sigla = String(l?.sigla ?? "").trim().toUpperCase();
    if (!sigla && !String(l?.fator ?? "").trim()) return; // linha vazia: ignorada no envio
    if (!sigla) erros[`${i}.sigla`] = "Informe a unidade";
    else if (sigla.length > 8) erros[`${i}.sigla`] = "No máximo 8 caracteres";
    else if (sigla === unidadeEstoque) erros[`${i}.sigla`] = `Não pode ser a unidade de estoque (${unidadeEstoque})`;
    else if (SIGLAS_RESERVADAS.includes(sigla)) erros[`${i}.sigla`] = "KG, L e UN não são unidade de conversão";
    else if (vistas.has(sigla)) erros[`${i}.sigla`] = "Unidade repetida";
    vistas.add(sigla);
    const fator = lerFator(l?.fator);
    if (!fator) erros[`${i}.fator`] = "Fator maior que zero";
    else if (l.operacao === "DIVIDE" && fator > FATOR_DIVIDE_MAXIMO) erros[`${i}.fator`] = `No "divide", até ${FATOR_DIVIDE_MAXIMO.toLocaleString("pt-BR")}`;
    if (l?.uso_compra === false && l?.uso_venda === false) erros[`${i}.uso`] = "Marque compra ou saída";
  });
  return erros;
};

/**
 * @param {{ linhas: any[], onChange: (l: any[]) => void, unidadeEstoque: string, readOnly?: boolean, disabled?: boolean,
 *   mostrarErros?: boolean }} props
 */
export default function UnidadesConversaoProduto({ linhas, onChange, unidadeEstoque, readOnly = false, disabled = false, mostrarErros = false }) {
  const erros = mostrarErros ? errosDasConversoes(linhas, unidadeEstoque) : {};
  const mudar = (i, patch) => onChange(linhas.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const bloqueado = readOnly || disabled;
  return (
    <section className="col-span-12 min-w-0" data-testid="produto-unidades-conversao" aria-label="Unidades de conversão">
      <p className="mb-2 text-[12px] text-[var(--mg-text-2,#475569)]">
        Saldo e custo ficam sempre em <strong>{unidadeEstoque}</strong>. Aqui você cadastra as outras unidades usadas nos lançamentos, por
        exemplo SACO que multiplica 25 (1 SACO = 25 KG) ou G que divide 1000 (1 G = 0,001 KG).
      </p>
      {linhas.length === 0 ? (
        <p className="mb-2 text-[12px] text-slate-600" data-testid="produto-unidades-vazio">Nenhuma unidade de conversão.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {linhas.map((l, i) => {
          const previa = previaDaConversao(l, unidadeEstoque);
          const e = (/** @type {string} */ c) => erros[`${i}.${c}`];
          return (
            <li key={l.id ?? `nova-${i}`} className="rounded border border-[var(--mg-border,#e2e8f0)] p-2" data-testid={`produto-unidade-${i}`}>
              <div className="grid grid-cols-12 gap-x-2 gap-y-2 items-end">
                <label className="col-span-6 sm:col-span-3 min-w-0 text-[12px]">
                  <span className="block font-semibold">Unidade</span>
                  <input
                    type="text"
                    value={l.sigla}
                    maxLength={8}
                    onChange={(ev) => mudar(i, { sigla: ev.target.value.toUpperCase() })}
                    placeholder="SACO"
                    className={`${B1_FIELD_CTL_CLS} w-full uppercase`}
                    readOnly={bloqueado}
                    aria-invalid={Boolean(e("sigla"))}
                    aria-label={`Unidade ${i + 1}`}
                    data-testid={`produto-unidade-${i}-sigla`}
                  />
                  {e("sigla") ? <span className="text-red-700" role="alert">{e("sigla")}</span> : null}
                </label>
                <label className="col-span-6 sm:col-span-3 min-w-0 text-[12px]">
                  <span className="block font-semibold">Conta</span>
                  <B1Select
                    value={l.operacao}
                    onChange={(ev) => mudar(i, { operacao: ev.target.value })}
                    className={`${B1_FIELD_CTL_CLS} w-full`}
                    disabled={bloqueado}
                    aria-label={`Multiplica ou divide (unidade ${i + 1})`}
                    data-testid={`produto-unidade-${i}-operacao`}
                  >
                    <option value="MULTIPLICA">Multiplica</option>
                    <option value="DIVIDE">Divide</option>
                  </B1Select>
                </label>
                <label className="col-span-6 sm:col-span-2 min-w-0 text-[12px]">
                  <span className="block font-semibold">Fator</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={l.fator}
                    onChange={(ev) => mudar(i, { fator: ev.target.value.replace(/[^0-9.,]/g, "") })}
                    placeholder="25"
                    className={`${B1_FIELD_CTL_CLS} w-full text-right tabular-nums`}
                    readOnly={bloqueado}
                    aria-invalid={Boolean(e("fator"))}
                    aria-label={`Fator ${i + 1}`}
                    data-testid={`produto-unidade-${i}-fator`}
                  />
                  {e("fator") ? <span className="text-red-700" role="alert">{e("fator")}</span> : null}
                </label>
                <fieldset className="col-span-6 sm:col-span-3 min-w-0 text-[12px]">
                  <legend className="font-semibold">Usar em</legend>
                  <label className="mr-3 inline-flex items-center gap-1 min-h-[32px]">
                    <input type="checkbox" checked={l.uso_compra !== false} disabled={bloqueado} onChange={(ev) => mudar(i, { uso_compra: ev.target.checked })} data-testid={`produto-unidade-${i}-compra`} />
                    Compra
                  </label>
                  <label className="inline-flex items-center gap-1 min-h-[32px]">
                    <input type="checkbox" checked={l.uso_venda !== false} disabled={bloqueado} onChange={(ev) => mudar(i, { uso_venda: ev.target.checked })} data-testid={`produto-unidade-${i}-saida`} />
                    Saída
                  </label>
                  {e("uso") ? <span className="block text-red-700" role="alert">{e("uso")}</span> : null}
                </fieldset>
                <div className="col-span-12 sm:col-span-1 flex justify-end">
                  {!bloqueado ? (
                    <button type="button" className="tb-btn" onClick={() => onChange(linhas.filter((_, k) => k !== i))} aria-label={`Remover a unidade ${i + 1}`} data-testid={`produto-unidade-${i}-remover`}>
                      <Trash2 size={14} aria-hidden />
                    </button>
                  ) : null}
                </div>
                <p className="col-span-12 text-[12px] font-semibold text-[var(--mg-text,#0f172a)]" role="status" data-testid={`produto-unidade-${i}-previa`}>
                  {previa || "—"}
                  {l.ativa === false ? <span className="ml-2 font-normal text-amber-800">(desativada: já usada em lançamento)</span> : null}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {!bloqueado ? (
        <button type="button" className="tb-btn mt-2" onClick={() => onChange([...linhas, novaLinha()])} data-testid="produto-unidade-adicionar">
          <Plus size={14} aria-hidden /> Adicionar unidade
        </button>
      ) : null}
    </section>
  );
}
