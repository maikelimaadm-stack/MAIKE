import React, { useState } from "react";
import { Plus, X } from "lucide-react";
import { notifyWarning } from "@/lib/maikeNotify";
import { AvisoGestao, CampoSelect, CampoTexto } from "@/components/gestao/GestaoFormParts";
import { CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { listarOpcoesBem } from "@/services/bemPatrimonialService";
import { SELO_UNIDADE_DO_PRODUTO, UNIDADES_ESTOQUE_TANQUE, unidadeEfetivaDoEstoque } from "@/lib/patrimonioDominio";
import { LIMITES_BEM, LIMITE_PRODUTOS_POR_TANQUE, LIMITE_TANQUES_ATIVOS, LOCALE_BEM, novaChave, produtoDoTanque } from "@/components/patrimonio/bemFormulario";

/** @typedef {import('./bemFormulario').TanqueForm} TanqueForm */
/** @typedef {import('./bemFormulario').ProdutoDoTanque} ProdutoDoTanque */
/** @typedef {{ indice: number, produto_id: string, reason: string }} ProdutoRecusado */

/** Nome do tanque para leitores de tela: o identificador ou o número da linha. @param {TanqueForm} t @param {number} i */
const nomeDoTanque = (t, i) => t.identificador.trim() || String(i + 1);

/**
 * Selo da unidade de estoque do Produto ("L", "kg"; SACO = "kg · saco", porque o
 * saco guarda o estoque em quilos); outra (legada) vai como veio.
 * @param {string|null} u
 */
const seloDaUnidade = (u) => (u ? /** @type {Record<string, string>} */ (SELO_UNIDADE_DO_PRODUTO)[u] ?? u : "?");

/** Filtro de unidade do seletor (achado D8; D-PROD-163 com os sacos): Todos (padrão), Litros, Quilos, Sacos. */
const OPCOES_FILTRO_UNIDADE = [
  { value: "TODAS", label: "Todos" },
  { value: "L", label: "Litros (L)" },
  { value: "KG", label: "Quilos (kg)" },
  { value: "SACO", label: "Sacos (estoque em kg)" },
];

/** Motivo por que um Produto aceito já não serve (riscado na tela). */
const MOTIVO_RECUSA = /** @type {Record<string, string>} */ ({
  inativo: "inativo",
  outra_empresa: "outra fazenda",
  unidade_incompativel: "unidade não aceita",
  inexistente: "não está mais disponível",
});

export const AVISO_TANQUE_SEM_PRODUTO = "Este tanque não pode ser abastecido até ter um Produto aceito.";
export const AVISO_PRODUTO_EM_KG = "Produto em quilos ou em sacos tem estoque em quilos: no abastecimento digita-se kg, não sacos nem os litros da bomba.";
/** Regra dos Produtos aceitos (D-PROD-163), sob os tanques. */
export const NOTA_PRODUTOS_ACEITOS =
  "Os Produtos aceitos vêm do estoque desta fazenda, em qualquer unidade (litros, quilos ou sacos). O abastecimento baixa do estoque exatamente a quantidade digitada, na unidade de estoque do Produto (litros para L; quilos para KG e SACO); a capacidade do tanque só é conferida para Produto em litros.";

/**
 * Motivo de recusa de um Produto aceito: o que o servidor apontou no último
 * envio (422 `TANQUE_PRODUTO_INVALIDO`, inclusive "outra fazenda") ou o que o
 * detalhe já mostra (Produto inativo; unidade fora de L, KG e SACO). `null` = serve.
 * @param {ProdutoDoTanque} p @param {ProdutoRecusado|null} recusa
 */
const motivoDoProduto = (p, recusa) => {
  if (recusa && recusa.produto_id === p.id) return MOTIVO_RECUSA[recusa.reason] ?? "recusado";
  if (!p.ativo) return MOTIVO_RECUSA.inativo;
  if (!p.unidade || !UNIDADES_ESTOQUE_TANQUE.includes(p.unidade)) return MOTIVO_RECUSA.unidade_incompativel;
  return null;
};

/**
 * Tanques de máquinas, veículos e equipamentos (D-PROD-157; D-PROD-162;
 * D-PROD-163): identificador, capacidade em litros, observação e os **Produtos
 * aceitos** — Produtos ativos do estoque DESTA fazenda, em QUALQUER unidade de
 * estoque (litros `L`, quilos `KG` ou sacos `SACO`), escolhidos por um seletor
 * paginado (busca por nome/código no servidor, selo da unidade de estoque em
 * cada opção — o SACO aparece em kg —, filtro opcional Litros | Quilos | Sacos
 * | Todos). Até 20 por tanque (P-02). Tanque sem Produto pode ser gravado: a
 * tela avisa que ele não pode ser abastecido (P-01). Produto em quilos ou em
 * sacos aceito: aviso de que no abastecimento se digita kg (achado D8).
 *
 * Produto aceito que ficou inativo, de outra fazenda ou fora de L/KG/SACO aparece
 * riscado com o motivo e pode ser retirado (o "outra fazenda" vem do 422 do
 * servidor, que aponta o Produto: `recusa`).
 *
 * Tanque já gravado NUNCA sai da lista: ele é inativado (e pode ser reativado);
 * só o tanque novo, ainda não gravado, pode ser tirado. Até 10 tanques ativos.
 * Nada aqui calcula consumo nem mexe em estoque.
 *
 * @param {{
 *   tanques: TanqueForm[],
 *   onChange: (atualizar: (atual: TanqueForm[]) => TanqueForm[]) => void,
 *   readOnly: boolean,
 *   erros: Record<string, string>,
 *   limparErro: (chave: string) => void,
 *   empresaId: string|null,
 *   podeListarProdutos?: boolean,
 *   recusa?: ProdutoRecusado|null,
 *   onRetirarRecusado?: () => void,
 * }} props
 */
export default function TanquesBem({ tanques, onChange, readOnly, erros, limparErro, empresaId, podeListarProdutos = true, recusa = null, onRetirarRecusado = undefined }) {
  const [filtros, setFiltros] = useState(/** @type {Record<string, string>} */ ({}));
  const ativos = tanques.filter((t) => t.ativo).length;

  /** @param {string} chave @param {Partial<TanqueForm>} mudanca */
  const alterar = (chave, mudanca) => onChange((atual) => atual.map((t) => (t.chave === chave ? { ...t, ...mudanca } : t)));

  const adicionar = () => {
    if (ativos >= LIMITE_TANQUES_ATIVOS) {
      notifyWarning("Atenção", `Um bem pode ter no máximo ${LIMITE_TANQUES_ATIVOS} tanques ativos.`);
      return;
    }
    onChange((atual) => [...atual, { chave: novaChave("tanque"), id: null, identificador: "", capacidade: "", observacao: "", ativo: true, produtos: [] }]);
    limparErro("tanques");
  };

  /** @param {TanqueForm} t */
  const alternarSituacao = (t) => {
    if (!t.ativo && ativos >= LIMITE_TANQUES_ATIVOS) {
      notifyWarning("Atenção", `Um bem pode ter no máximo ${LIMITE_TANQUES_ATIVOS} tanques ativos.`);
      return;
    }
    alterar(t.chave, { ativo: !t.ativo });
    limparErro("tanques");
  };

  /** Os erros (e a marca do servidor) são por linha: tirar uma linha desalinha os índices, então saem todos. @param {string} chave */
  const tirar = (chave) => {
    onChange((atual) => atual.filter((t) => t.chave !== chave));
    limparErro("tanques");
    if (recusa) onRetirarRecusado?.();
  };

  /** @param {TanqueForm} t @param {number} i @param {any} opcao */
  const aceitar = (t, i, opcao) => {
    const produto = produtoDoTanque(opcao);
    if (!produto) return;
    onChange((atual) =>
      atual.map((x) => {
        if (x.chave !== t.chave || x.produtos.some((p) => p.id === produto.id)) return x;
        if (x.produtos.length >= LIMITE_PRODUTOS_POR_TANQUE) return x;
        return { ...x, produtos: [...x.produtos, produto] };
      }),
    );
    if (t.produtos.length >= LIMITE_PRODUTOS_POR_TANQUE) notifyWarning("Atenção", `Um tanque aceita no máximo ${LIMITE_PRODUTOS_POR_TANQUE} Produtos.`);
    limparErro(`tanques.${i}.produtos`);
  };

  /** @param {TanqueForm} t @param {number} i @param {string} produtoId */
  const retirar = (t, i, produtoId) => {
    alterar(t.chave, { produtos: t.produtos.filter((p) => p.id !== produtoId) });
    limparErro(`tanques.${i}.produtos`);
    if (recusa && recusa.indice === i && recusa.produto_id === produtoId) onRetirarRecusado?.();
  };

  return (
    <div className="mg-b1-form-grid col-span-12 grid grid-cols-12 gap-x-3 gap-y-2" data-testid="bem-tanques">
      {tanques.length === 0 ? <p className="col-span-12 text-xs text-[var(--mg-text-2,#475569)]">Nenhum tanque.</p> : null}
      {tanques.map((t, i) => {
        const nome = nomeDoTanque(t, i);
        const travado = readOnly || !t.ativo;
        const filtro = filtros[t.chave] ?? "TODAS";
        const cheio = t.produtos.length >= LIMITE_PRODUTOS_POR_TANQUE;
        const recusaDaLinha = recusa && recusa.indice === i ? recusa : null;
        const temKg = t.produtos.some((p) => unidadeEfetivaDoEstoque(p.unidade) === "KG");
        return (
          <div key={t.chave} className="col-span-12 grid grid-cols-12 gap-x-3 gap-y-2 rounded-md border border-[var(--mg-divider,#cbd5e1)] p-2" data-testid={`bem-tanque-${i}`}>
            <div className="col-span-12 flex min-h-8 flex-wrap items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1 break-words font-medium uppercase">
                Tanque {i + 1}
                {!t.ativo ? <span className="ml-2 normal-case text-[11px] text-amber-700">(inativo)</span> : null}
              </span>
              {!readOnly && t.id ? (
                <button
                  type="button"
                  aria-label={`${t.ativo ? "Inativar" : "Reativar"} o tanque ${nome}`}
                  onClick={() => alternarSituacao(t)}
                  className="min-h-8 rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-3 text-xs font-medium"
                >
                  {t.ativo ? "Inativar tanque" : "Reativar tanque"}
                </button>
              ) : null}
              {!readOnly && !t.id ? (
                <button
                  type="button"
                  aria-label={`Tirar o tanque ${nome} (ainda não gravado)`}
                  onClick={() => tirar(t.chave)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--mg-divider,#cbd5e1)]"
                >
                  <X aria-hidden size={14} />
                </button>
              ) : null}
            </div>
            <CampoTexto
              label="Identificador"
              required
              span={4}
              value={t.identificador}
              onChange={(v) => {
                alterar(t.chave, { identificador: v });
                limparErro(`tanques.${i}.identificador`);
              }}
              readOnly={travado}
              maxLength={40}
              placeholder="EX.: PRINCIPAL"
              error={erros[`tanques.${i}.identificador`]}
            />
            <CampoNumero
              label="Capacidade"
              sufixo="L"
              value={t.capacidade}
              onChange={(v) => {
                alterar(t.chave, { capacidade: v });
                limparErro(`tanques.${i}.capacidade`);
              }}
              locale={LOCALE_BEM}
              limites={LIMITES_BEM.MEDIDA}
              readOnly={travado}
              required
              span={4}
              error={erros[`tanques.${i}.capacidade`] || null}
              testId={`bem-tanque-capacidade-${i}`}
            />
            <CampoTexto label="Observação" span={4} value={t.observacao} onChange={(v) => alterar(t.chave, { observacao: v })} readOnly={travado} maxLength={255} />

            <div className="col-span-12 min-w-0" data-testid={`bem-tanque-produtos-${i}`}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">
                Produtos aceitos <span className="font-normal normal-case">({t.produtos.length} de {LIMITE_PRODUTOS_POR_TANQUE})</span>
              </p>
              {t.produtos.length ? (
                <ul className="flex flex-wrap gap-1.5" aria-label={`Produtos aceitos do tanque ${nome}`}>
                  {t.produtos.map((p) => {
                    const motivo = motivoDoProduto(p, recusaDaLinha);
                    return (
                      <li
                        key={p.id}
                        className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-[12px] ${
                          motivo ? "border-amber-300 bg-amber-50 text-amber-900" : "border-[var(--mg-divider,#cbd5e1)] bg-white"
                        }`}
                        data-testid={`bem-tanque-${i}-produto-${p.id}`}
                        data-motivo={motivo ?? undefined}
                      >
                        <span className={`min-w-0 break-words uppercase ${motivo ? "line-through" : ""}`}>{p.rotulo || "Produto"}</span>
                        <span className="rounded bg-slate-100 px-1 text-[10px] font-semibold normal-case text-slate-700">{seloDaUnidade(p.unidade)}</span>
                        {motivo ? <span className="text-[11px] normal-case">({motivo})</span> : null}
                        {!travado ? (
                          <button
                            type="button"
                            aria-label={`Tirar ${p.rotulo || "o Produto"} dos Produtos aceitos do tanque ${nome}`}
                            onClick={() => retirar(t, i, p.id)}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                          >
                            <X aria-hidden size={12} />
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {!t.produtos.length && t.ativo ? (
                <p className="mt-1 text-[11px] text-amber-800" role="status" data-testid={`bem-tanque-sem-produto-${i}`}>
                  {AVISO_TANQUE_SEM_PRODUTO}
                </p>
              ) : null}
              {temKg ? (
                <p className="mt-1 text-[11px] text-[var(--mg-text-2,#475569)]" data-testid={`bem-tanque-aviso-kg-${i}`}>
                  {AVISO_PRODUTO_EM_KG}
                </p>
              ) : null}
              {erros[`tanques.${i}.produtos`] ? (
                <p className="mt-1 text-[11px] text-red-700" role="alert">
                  {erros[`tanques.${i}.produtos`]}
                </p>
              ) : null}
            </div>
            {!travado && podeListarProdutos && !cheio ? (
              <>
                <SeletorPaginadoGestao
                  rotulo="Aceitar Produto"
                  testId={`bem-tanque-seletor-produto-${i}`}
                  chave={["patrimonio", "produtos-tanque", empresaId, filtro]}
                  buscar={({ q, cursor, limit }) =>
                    listarOpcoesBem("produtos", empresaId, { q, cursor, limit, unidade: filtro === "TODAS" ? null : /** @type {'L'|'KG'|'SACO'} */ (filtro) })
                  }
                  value={null}
                  onChange={(o) => aceitar(t, i, o)}
                  detalheDaOpcao={(o) => {
                    const codigo = typeof o?.codigo_interno === "string" && o.codigo_interno ? `${o.codigo_interno} · ` : "";
                    const jaAceito = t.produtos.some((p) => p.id === String(o?.id)) ? " · já aceito" : "";
                    return `${codigo}${seloDaUnidade(o?.unidade_principal_estoque ?? null)}${jaAceito}`;
                  }}
                  textoVazio="— Escolha um Produto para aceitar —"
                  span={8}
                />
                <CampoSelect
                  label="Unidade"
                  value={filtro}
                  onChange={(v) => setFiltros((f) => ({ ...f, [t.chave]: v || "TODAS" }))}
                  options={OPCOES_FILTRO_UNIDADE}
                  span={4}
                />
              </>
            ) : null}
            {!travado && cheio ? (
              <p className="col-span-12 text-[11px] text-[var(--mg-text-2,#475569)]" role="status">
                Limite de {LIMITE_PRODUTOS_POR_TANQUE} Produtos aceitos neste tanque: tire um para aceitar outro.
              </p>
            ) : null}
            {!travado && !podeListarProdutos ? (
              <p className="col-span-12 text-[11px] text-[var(--mg-text-2,#475569)]" role="status">
                Você não tem permissão para escolher os Produtos aceitos (cadastrar ou editar bens).
              </p>
            ) : null}
          </div>
        );
      })}
      {erros.tanques ? (
        <p className="col-span-12 text-[11px] text-red-700" role="alert">
          {erros.tanques}
        </p>
      ) : null}
      {!readOnly && tanques.length ? (
        <div className="col-span-12">
          <AvisoGestao tone="blue" testId="bem-tanques-nota">
            {NOTA_PRODUTOS_ACEITOS}
          </AvisoGestao>
        </div>
      ) : null}
      {!readOnly && ativos < LIMITE_TANQUES_ATIVOS ? (
        <div className="col-span-12">
          <button
            type="button"
            onClick={adicionar}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-4 text-[13px] font-medium"
          >
            <Plus aria-hidden size={14} />
            Adicionar tanque
          </button>
        </div>
      ) : null}
    </div>
  );
}
