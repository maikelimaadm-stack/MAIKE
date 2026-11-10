import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ListChecks, Plus, Trash2 } from "lucide-react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";
import { AvisoGestao, CampoTexto } from "@/components/gestao/GestaoFormParts";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoDia, CampoNumero, EscolhaSegmentada, IndicadorDiferenca, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import {
  ERRO_SOMA_ITEM_PERCENTUAL,
  ERRO_SOMA_ITEM_VALOR,
  MAX_ITENS,
  MAX_PARCELAS,
  MAX_RATEIOS,
  adicionarItemAoFormulario,
  classificacaoParaTodos,
  gerarParcelas,
  linhasDoItem,
  moverItemDoFormulario,
  parcelaVazia,
  produtoAceitaSaco,
  produtoEmLitros,
  unidadeAoEscolherProduto,
  rateioVazio,
  removerItemDoFormulario,
  temDadosPorItem,
} from "@/components/financeiroGestao/lancamentoModelo";
import { LIMITES, comparar, formatarMoeda, formatarNumero, subtrair } from "@/lib/dinheiroDecimal";
import { MAX_RATEIOS_POR_ITEM } from "@/lib/rateioPorItem";
import { confirmar } from "@/lib/maikeConfirmar";
import { formatarDia } from "@/lib/diaCivil";
import { buscarOpcoesLancamento, listarSaldosProduto } from "@/services/operacaoFinanceiraService";
import { notifyWarning } from "@/lib/maikeNotify";

/**
 * @typedef {{ empresaId: string|null, locale: string, moeda: string, casas: number, readOnly: boolean,
 *   erroDe: (chave: string) => string|undefined }} ContextoSecao
 */

const BOTAO_LINHA =
  "inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-4 text-[13px] font-medium hover:bg-slate-50 disabled:opacity-50";
const BOTAO_REMOVER = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-200 text-red-700 hover:bg-red-50";
const BOTAO_ICONE =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white text-[var(--mg-text-2,#475569)] hover:bg-slate-50 disabled:opacity-40";

/** @param {any} o */
const rotuloProduto = (o) => String(o?.nome ?? "");

/**
 * Uma linha de item (mercadoria ou serviço). Subir/descer troca a ORDEM do item;
 * as linhas do rateio por item vão junto (vivem na chave do item).
 * @param {{ item: any, indice: number, total: number, resumoItem: any, direcao: string, ctx: ContextoSecao,
 *   alterar: (patch: object) => void, remover: () => void, mover: (delta: number) => void }} props
 */
function LinhaItem({ item, indice, total, resumoItem, direcao, ctx, alterar, remover, mover }) {
  const { empresaId, locale, moeda, casas, readOnly, erroDe } = ctx;
  const mercadoria = item.tipo_item === "MERCADORIA";
  const produtoId = mercadoria ? item.produto?.id ?? null : null;
  const venda = direcao === "RECEBER";
  const saldos = useQuery({
    queryKey: ["lancamentos-financeiros-gestao", "saldos", empresaId, produtoId],
    queryFn: () => listarSaldosProduto(empresaId, produtoId),
    enabled: Boolean(empresaId && produtoId && venda && !readOnly),
    staleTime: 15 * 1000,
  });
  const saldoDoLocal = item.local ? (saldos.data ?? []).find((s) => String(s.local_estoque_id) === String(item.local.id)) : null;
  const faltaSaldo = venda && saldoDoLocal && resumoItem?.kg && comparar(resumoItem.kg, saldoDoLocal.disponivel_kg) > 0;
  const aceitaSaco = produtoAceitaSaco(item.produto);
  // D-PROD-161: Produto em litros só aceita a unidade L, e o estoque dele é mostrado em L.
  const emLitros = produtoEmLitros(item.produto);
  const unidadeEstoque = emLitros ? "L" : "kg";
  const base = `itens.${indice}`;

  return (
    <div data-testid={`item-${indice}`} className="col-span-12 min-w-0 rounded-lg border border-[var(--mg-divider,#cbd5e1)] bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase text-[var(--mg-text-2,#475569)]">Item {indice + 1}</p>
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {total > 1 ? (
              <>
                <button type="button" className={BOTAO_ICONE} aria-label={`Mover item ${indice + 1} para cima`} title="Mover para cima" disabled={indice === 0} onClick={() => mover(-1)}>
                  <ChevronUp size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className={BOTAO_ICONE}
                  aria-label={`Mover item ${indice + 1} para baixo`}
                  title="Mover para baixo"
                  disabled={indice === total - 1}
                  onClick={() => mover(1)}
                >
                  <ChevronDown size={16} aria-hidden />
                </button>
              </>
            ) : null}
            <button type="button" className={BOTAO_REMOVER} aria-label={`Remover item ${indice + 1}`} title={`Remover item ${indice + 1}`} onClick={remover}>
              <Trash2 size={16} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-12 gap-3">
        <EscolhaSegmentada
          rotulo={`Tipo do item ${indice + 1}`}
          value={item.tipo_item}
          readOnly={readOnly}
          onChange={(tipo) =>
            alterar(
              tipo === "SERVICO"
                ? { tipo_item: "SERVICO", produto: null, local: null, unidade: "UN" }
                : { tipo_item: "MERCADORIA", unidade: "KG" },
            )
          }
          opcoes={[
            { value: "MERCADORIA", label: "Mercadoria (mexe no estoque)" },
            { value: "SERVICO", label: "Serviço" },
          ]}
        />
        {mercadoria ? (
          <>
            <SeletorPaginadoGestao
              rotulo="Produto"
              obrigatorio
              span={6}
              testId={`seletor-produto-${indice}`}
              chave={["produtos", empresaId]}
              buscar={(a) => buscarOpcoesLancamento("produtos", empresaId, a)}
              value={item.produto}
              readOnly={readOnly}
              erro={erroDe(`${base}.produto`)}
              rotuloDaOpcao={rotuloProduto}
              detalheDaOpcao={(o) =>
                o?.unidade_principal_estoque === "SACO" && o?.peso_por_saco_kg
                  ? `saco de ${formatarNumero(String(o.peso_por_saco_kg), { locale, casasMax: 4 })} kg`
                  : produtoEmLitros(o)
                    ? "estoque em litros (L)"
                    : null
              }
              onChange={(o) =>
                alterar({
                  produto: o ? { id: String(o.id), rotulo: rotuloProduto(o), unidade_principal_estoque: o.unidade_principal_estoque, peso_por_saco_kg: o.peso_por_saco_kg == null ? null : String(o.peso_por_saco_kg) } : null,
                  unidade: unidadeAoEscolherProduto(o),
                })
              }
            />
            <SeletorPaginadoGestao
              rotulo="Local de estoque"
              obrigatorio
              span={6}
              testId={`seletor-local-${indice}`}
              chave={["locais", empresaId]}
              buscar={(a) => buscarOpcoesLancamento("locais", empresaId, a)}
              value={item.local}
              readOnly={readOnly}
              erro={erroDe(`${base}.local`)}
              onChange={(o) => alterar({ local: o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null })}
            />
            {venda && produtoId && !readOnly ? (
              <div className="col-span-12 min-w-0 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid={`saldos-item-${indice}`}>
                {saldos.isLoading ? "Carregando saldo desta empresa…" : null}
                {saldos.isError ? <span className="text-red-700">Não foi possível ler o saldo. A confirmação confere de novo.</span> : null}
                {saldos.data ? (
                  saldos.data.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      <span>Saldo desta empresa:</span>
                      {saldos.data.map((s) => (
                        <button
                          key={s.local_estoque_id}
                          type="button"
                          onClick={() => alterar({ local: { id: String(s.local_estoque_id), rotulo: s.local_nome } })}
                          className="rounded-full border border-[var(--mg-divider,#cbd5e1)] px-2 py-0.5 uppercase hover:bg-slate-50"
                        >
                          {s.local_nome}: {formatarNumero(s.disponivel_kg, { locale, casasMax: 4 })} {unidadeEstoque}
                        </button>
                      ))}
                    </span>
                  ) : (
                    "Sem saldo deste produto nesta empresa."
                  )
                ) : null}
              </div>
            ) : null}
            <B1Field label="Unidade" span={4} hasValue locked={readOnly} disabled={readOnly} error={erroDe(`${base}.unidade`)}>
              <B1Select aria-label={`Unidade do item ${indice + 1}`} value={item.unidade} onChange={(e) => alterar({ unidade: e.target.value })} disabled={readOnly} className={B1_FIELD_CTL_CLS}>
                {emLitros ? (
                  <option value="L">L</option>
                ) : (
                  <>
                    <option value="KG">KG</option>
                    {aceitaSaco || item.unidade === "SACO" ? <option value="SACO">SACO</option> : null}
                    {item.unidade === "L" ? <option value="L">L</option> : null}
                  </>
                )}
              </B1Select>
            </B1Field>
          </>
        ) : (
          <CampoTexto
            label="Descrição do serviço"
            required
            span={8}
            value={item.descricao}
            onChange={(v) => alterar({ descricao: v })}
            readOnly={readOnly}
            maxLength={255}
            error={erroDe(`${base}.descricao`)}
          />
        )}
        <CampoNumero
          label="Quantidade"
          sufixo={mercadoria ? item.unidade : "UN"}
          required
          span={4}
          locale={locale}
          limites={LIMITES.QUANTIDADE}
          value={item.quantidade}
          onChange={(v) => alterar({ quantidade: v })}
          readOnly={readOnly}
          error={erroDe(`${base}.quantidade`)}
          testId={`item-${indice}-quantidade`}
        />
        <CampoNumero
          label="Valor unitário"
          required
          span={4}
          locale={locale}
          limites={LIMITES.PRECO}
          value={item.valor_unitario}
          onChange={(v) => alterar({ valor_unitario: v })}
          readOnly={readOnly}
          error={erroDe(`${base}.valor_unitario`)}
          testId={`item-${indice}-valor-unitario`}
        />
        <ValorCalculado
          label="Subtotal"
          span={4}
          valor={resumoItem?.subtotal ? formatarMoeda(resumoItem.subtotal, { locale, moeda, casas }) : "—"}
          testId={`item-${indice}-subtotal`}
        />
        {erroDe(`${base}.subtotal`) ? <p className="col-span-12 text-[12px] text-red-700">{erroDe(`${base}.subtotal`)}</p> : null}
        {erroDe(`${base}.liquido`) ? (
          <p role="alert" className="col-span-12 min-w-0 break-words text-[12px] text-red-700" data-testid={`item-${indice}-liquido-erro`}>
            {erroDe(`${base}.liquido`)}
          </p>
        ) : null}
        {mercadoria && resumoItem?.kg ? (
          <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid={`item-${indice}-kg`}>
            {direcao === "PAGAR" ? "Entra no estoque" : "Sai do estoque"}: {formatarNumero(resumoItem.kg, { locale, casasMax: 4 })} {unidadeEstoque}
            {item.unidade === "SACO" ? " (convertido pelo peso do saco)" : ""}
            {faltaSaldo ? <strong className="ml-1 text-amber-800">— acima do saldo deste local ({formatarNumero(saldoDoLocal.disponivel_kg, { locale, casasMax: 4 })} {unidadeEstoque})</strong> : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * (3) Itens — só no documento com produtos.
 * @param {{ form: any, resumo: any, ctx: ContextoSecao, setForm: (fn: (f: any) => any) => void }} props
 */
export function SecaoItens({ form, resumo, ctx, setForm }) {
  const alterarItem = (/** @type {number} */ i, /** @type {object} */ patch) =>
    setForm((f) => ({ ...f, itens: f.itens.map((/** @type {any} */ it, /** @type {number} */ k) => (k === i ? { ...it, ...patch } : it)) }));
  // Remover o item remove as linhas do rateio por item dele; mover leva as linhas junto.
  const removerItem = (/** @type {number} */ i) => setForm((f) => removerItemDoFormulario(f, i));
  const moverItem = (/** @type {number} */ i, /** @type {number} */ delta) => setForm((f) => moverItemDoFormulario(f, i, delta));
  const adicionar = (/** @type {string} */ tipo) => {
    if (form.itens.length >= MAX_ITENS) return notifyWarning("Atenção", `No máximo ${MAX_ITENS} itens por lançamento.`);
    setForm((f) => adicionarItemAoFormulario(f, tipo));
  };
  return (
    <>
      {form.itens.map((/** @type {any} */ item, /** @type {number} */ i) => (
        <LinhaItem
          key={item.chave}
          item={item}
          indice={i}
          total={form.itens.length}
          resumoItem={resumo.itens[i]}
          direcao={form.direcao}
          ctx={ctx}
          alterar={(patch) => alterarItem(i, patch)}
          remover={() => removerItem(i)}
          mover={(delta) => moverItem(i, delta)}
        />
      ))}
      {ctx.erroDe("itens") ? <p className="col-span-12 text-[12px] text-red-700">{ctx.erroDe("itens")}</p> : null}
      {!ctx.readOnly ? (
        <div className="col-span-12 flex flex-wrap gap-2">
          <button type="button" className={BOTAO_LINHA} onClick={() => adicionar("MERCADORIA")}>
            <Plus size={14} aria-hidden /> Mercadoria
          </button>
          <button type="button" className={BOTAO_LINHA} onClick={() => adicionar("SERVICO")}>
            <Plus size={14} aria-hidden /> Serviço
          </button>
        </div>
      ) : null}
    </>
  );
}

/** @param {string|null} diferenca @param {{ locale: string, moeda: string, casas: number }} c */
const estadoDiferenca = (diferenca, c) => {
  if (diferenca == null) return { estado: /** @type {'pendente'} */ ("pendente"), texto: "Preencha os valores para conferir a soma." };
  const cmp = comparar(diferenca, "0");
  if (cmp === 0) return { estado: /** @type {'fechado'} */ ("fechado"), texto: "Fechado: a soma é igual ao total." };
  const abs = diferenca.replace("-", "");
  return cmp > 0
    ? { estado: /** @type {'falta'} */ ("falta"), texto: `Falta ${formatarMoeda(abs, c)} para fechar o total.` }
    : { estado: /** @type {'sobra'} */ ("sobra"), texto: `Sobra ${formatarMoeda(abs, c)} acima do total.` };
};

/**
 * (4) Rateio GLOBAL por natureza + centros (VALOR padrão ou PERCENTUAL).
 * @param {{ form: any, resumo: any, ctx: ContextoSecao, setForm: (fn: (f: any) => any) => void }} props
 */
export function SecaoRateio({ form, resumo, ctx, setForm }) {
  const { empresaId, locale, moeda, casas, readOnly, erroDe } = ctx;
  const tipoNatureza = form.direcao === "RECEBER" ? "RECEITA" : "DESPESA";
  const umaLinha = form.rateios.length === 1;
  const alterar = (/** @type {number} */ i, /** @type {object} */ patch) =>
    setForm((f) => ({ ...f, rateios: f.rateios.map((/** @type {any} */ r, /** @type {number} */ k) => (k === i ? { ...r, ...patch } : r)) }));
  const remover = (/** @type {number} */ i) => setForm((f) => ({ ...f, rateios: f.rateios.filter((/** @type {any} */ _, /** @type {number} */ k) => k !== i) }));
  const adicionar = () => {
    if (form.rateios.length >= MAX_RATEIOS) return notifyWarning("Atenção", `No máximo ${MAX_RATEIOS} linhas de rateio.`);
    setForm((f) => {
      // A linha que era "100% automática" passa a ter o valor visível (editável).
      const primeira = f.rateios.length === 1 && resumo.rateio.valores[0] && f.rateio_modo === "VALOR" && !f.rateios[0].valor
        ? [{ ...f.rateios[0], valor: formatarNumero(resumo.rateio.valores[0], { locale, casasMin: casas, casasMax: casas }) }]
        : f.rateio_modo === "PERCENTUAL" && f.rateios.length === 1 && !f.rateios[0].percentual
          ? [{ ...f.rateios[0], percentual: "100" }]
          : f.rateios;
      return { ...f, rateios: [...primeira, rateioVazio()] };
    });
  };
  const c = { locale, moeda, casas };
  let indicador;
  if (form.rateio_modo === "PERCENTUAL") {
    const soma = resumo.rateio.somaPercentual;
    if (umaLinha) indicador = { estado: /** @type {'fechado'} */ ("fechado"), texto: "Uma linha: 100% automático." };
    else if (!soma) indicador = { estado: /** @type {'pendente'} */ ("pendente"), texto: "Preencha os percentuais para conferir a soma." };
    else {
      const cmp = comparar(soma, "100");
      indicador =
        cmp === 0
          ? { estado: /** @type {'fechado'} */ ("fechado"), texto: "Fechado: os percentuais somam 100%." }
          : cmp < 0
            ? { estado: /** @type {'falta'} */ ("falta"), texto: `Falta ${formatarNumero(subtrair("100", soma, 6), { locale, casasMax: 6 })}% para 100%.` }
            : { estado: /** @type {'sobra'} */ ("sobra"), texto: `Sobra ${formatarNumero(subtrair(soma, "100", 6), { locale, casasMax: 6 })}% acima de 100%.` };
    }
  } else {
    indicador = umaLinha && resumo.total ? { estado: /** @type {'fechado'} */ ("fechado"), texto: "Uma linha: 100% do total automático." } : estadoDiferenca(resumo.rateio.diferenca, c);
  }

  return (
    <>
      <EscolhaSegmentada
        rotulo="Modo do rateio"
        value={form.rateio_modo}
        readOnly={readOnly}
        onChange={(modo) => setForm((f) => ({ ...f, rateio_modo: modo }))}
        opcoes={[
          { value: "VALOR", label: "Por valor" },
          { value: "PERCENTUAL", label: "Por percentual" },
        ]}
      />
      {form.rateios.map((/** @type {any} */ r, /** @type {number} */ i) => {
        const base = `rateios.${i}`;
        const valorCalculado = resumo.rateio.valores[i];
        return (
          <div key={r.chave} data-testid={`rateio-${i}`} className="col-span-12 min-w-0 rounded-lg border border-[var(--mg-divider,#cbd5e1)] bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-semibold uppercase text-[var(--mg-text-2,#475569)]">Linha {i + 1}</p>
              {!readOnly && form.rateios.length > 1 ? (
                <button type="button" className={BOTAO_REMOVER} aria-label={`Remover linha ${i + 1} do rateio`} title={`Remover linha ${i + 1} do rateio`} onClick={() => remover(i)}>
                  <Trash2 size={16} aria-hidden />
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-12 gap-3">
              <SeletorPaginadoGestao
                rotulo={tipoNatureza === "RECEITA" ? "Natureza (receita)" : "Natureza (despesa)"}
                obrigatorio
                span={12}
                testId={`seletor-natureza-${i}`}
                chave={["naturezas", empresaId, tipoNatureza]}
                buscar={(a) => buscarOpcoesLancamento("naturezas", empresaId, { ...a, tipo: tipoNatureza })}
                value={r.natureza}
                readOnly={readOnly}
                erro={erroDe(`${base}.natureza`)}
                rotuloDaOpcao={(o) => String(o?.caminho || o?.nome || "")}
                onChange={(o) => alterar(i, { natureza: o ? { id: String(o.id), rotulo: String(o.caminho || o.nome || "") } : null })}
              />
              <SeletorPaginadoGestao
                rotulo="Centro de custo"
                span={6}
                testId={`seletor-centro-custo-${i}`}
                chave={["centros-custo", empresaId]}
                buscar={(a) => buscarOpcoesLancamento("centros-custo", empresaId, a)}
                value={r.centro_custo}
                readOnly={readOnly}
                permitirLimpar
                textoVazio="— Nenhum —"
                erro={erroDe(`${base}.centro_custo`)}
                onChange={(o) => alterar(i, { centro_custo: o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null })}
              />
              <SeletorPaginadoGestao
                rotulo="Centro de resultado"
                span={6}
                testId={`seletor-centro-resultado-${i}`}
                chave={["centros-resultado", empresaId]}
                buscar={(a) => buscarOpcoesLancamento("centros-resultado", empresaId, a)}
                value={r.centro_resultado}
                readOnly={readOnly}
                permitirLimpar
                textoVazio="— Nenhum —"
                erro={erroDe(`${base}.centro_resultado`)}
                onChange={(o) => alterar(i, { centro_resultado: o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null })}
              />
              {form.rateio_modo === "PERCENTUAL" ? (
                <>
                  {umaLinha ? (
                    <ValorCalculado label="Percentual" span={6} valor="100% (automático)" testId={`rateio-${i}-percentual-auto`} />
                  ) : (
                    <CampoNumero
                      label="Percentual"
                      sufixo="%"
                      required
                      span={6}
                      locale={locale}
                      limites={LIMITES.PERCENTUAL}
                      value={r.percentual}
                      onChange={(v) => alterar(i, { percentual: v })}
                      readOnly={readOnly}
                      error={erroDe(`${base}.percentual`)}
                      testId={`rateio-${i}-percentual`}
                    />
                  )}
                  <ValorCalculado label="Valor calculado" span={6} valor={valorCalculado ? formatarMoeda(valorCalculado, c) : "—"} testId={`rateio-${i}-valor-calculado`} />
                </>
              ) : umaLinha ? (
                <ValorCalculado label="Valor" span={6} valor={valorCalculado ? `${formatarMoeda(valorCalculado, c)} (100% automático)` : "— (100% do total)"} testId={`rateio-${i}-valor-auto`} />
              ) : (
                <>
                  <CampoNumero
                    label="Valor"
                    required
                    span={6}
                    locale={locale}
                    limites={{ casas, inteiros: LIMITES.DINHEIRO.inteiros }}
                    casasMin={casas}
                    value={r.valor}
                    onChange={(v) => alterar(i, { valor: v })}
                    readOnly={readOnly}
                    error={erroDe(`${base}.valor`)}
                    testId={`rateio-${i}-valor`}
                  />
                  <ValorCalculado
                    label="Percentual (informativo)"
                    span={6}
                    valor={resumo.rateio.percentuaisInformativos[i] ? `${formatarNumero(resumo.rateio.percentuaisInformativos[i], { locale, casasMin: 2, casasMax: 2 })}%` : "—"}
                  />
                </>
              )}
            </div>
          </div>
        );
      })}
      <IndicadorDiferenca testId="rateio-diferenca" estado={indicador.estado} texto={indicador.texto} />
      {erroDe("rateio") && indicador.estado === "pendente" ? <p className="col-span-12 text-[12px] text-red-700">{erroDe("rateio")}</p> : null}
      {!readOnly ? (
        <div className="col-span-12">
          <button type="button" className={BOTAO_LINHA} onClick={adicionar}>
            <Plus size={14} aria-hidden /> Linha de rateio
          </button>
        </div>
      ) : null}
    </>
  );
}

/** @typedef {{ estado: 'fechado'|'falta'|'sobra'|'pendente', texto: string, curto: string }} IndicadorItem */

/**
 * Diferença de UM item no rateio por item: o texto do indicador e o resumo
 * curto do cabeçalho ("diferença R$ 0,01" / "diferença 10%").
 * @param {any} conf item conferido (resumo.rateioItens.porItem[k]) @param {string} modo @param {number} nLinhas
 * @param {{ locale: string, moeda: string, casas: number }} c
 * @returns {IndicadorItem}
 */
const indicadorDoItem = (conf, modo, nLinhas, c) => {
  if (!nLinhas) return { estado: "pendente", texto: "Sem linha: inclua pelo menos uma classificação neste item.", curto: "sem classificação" };
  if (modo === "PERCENTUAL") {
    if (nLinhas === 1) return { estado: "fechado", texto: "Uma linha: 100% do líquido do item, automático.", curto: "diferença 0%" };
    const soma = conf?.somaPercentual;
    if (!soma) return { estado: "pendente", texto: "Preencha os percentuais para conferir a soma do item.", curto: "diferença —" };
    const cmp = comparar(soma, "100");
    if (cmp < 0) {
      const falta = formatarNumero(subtrair("100", soma, 6), { locale: c.locale, casasMax: 6 });
      return { estado: "falta", texto: `Falta ${falta}% para 100% neste item.`, curto: `diferença ${falta}%` };
    }
    if (cmp > 0) {
      const sobra = formatarNumero(subtrair(soma, "100", 6), { locale: c.locale, casasMax: 6 });
      return { estado: "sobra", texto: `Sobra ${sobra}% acima de 100% neste item.`, curto: `diferença ${sobra}%` };
    }
    if (!conf?.fecha) return { estado: "pendente", texto: "Os percentuais somam 100%, mas alguma linha ficaria com valor zero ou falta o líquido do item.", curto: "diferença —" };
    return { estado: "fechado", texto: "Fechado: os percentuais somam 100% do líquido do item.", curto: "diferença 0%" };
  }
  if (nLinhas === 1 && conf?.liquido) return { estado: "fechado", texto: "Uma linha: 100% do líquido do item, automático.", curto: `diferença ${formatarMoeda("0", c)}` };
  const dif = conf?.diferenca;
  if (dif == null) return { estado: "pendente", texto: "Preencha os valores para conferir com o líquido do item.", curto: "diferença —" };
  const cmp = comparar(dif, "0");
  if (cmp === 0) return { estado: "fechado", texto: "Fechado: a soma é igual ao líquido do item.", curto: `diferença ${formatarMoeda("0", c)}` };
  const abs = formatarMoeda(dif.replace("-", ""), c);
  return cmp > 0
    ? { estado: "falta", texto: `Falta ${abs} para fechar o líquido do item.`, curto: `diferença ${abs}` }
    : { estado: "sobra", texto: `Sobra ${abs} acima do líquido do item.`, curto: `diferença ${abs}` };
};

const CAMPOS_DA_LINHA = ["natureza", "centro_custo", "centro_resultado", "valor", "percentual"];

/**
 * (4) Rateio POR ITEM (D-PROD-156): um bloco compacto por item (recolhe e
 * expande) com "Item n · produto · líquido · diferença", as linhas (natureza,
 * centros e valor ou %) e "Adicionar linha"; a diferença por item e no total;
 * "Aplicar classificação a todos os itens". As linhas vivem na CHAVE do item.
 * @param {{ form: any, resumo: any, ctx: ContextoSecao, setForm: (fn: (f: any) => any) => void, itemComErroServidor?: string|null }} props
 */
export function SecaoRateioPorItem({ form, resumo, ctx, setForm, itemComErroServidor = null }) {
  const { empresaId, locale, moeda, casas, readOnly, erroDe } = ctx;
  const c = { locale, moeda, casas };
  const tipoNatureza = form.direcao === "RECEBER" ? "RECEITA" : "DESPESA";
  const rotuloNatureza = tipoNatureza === "RECEITA" ? "Natureza (receita)" : "Natureza (despesa)";
  const conferido = resumo.rateioItens;
  const [recolhidos, setRecolhidos] = useState(() => /** @type {Set<string>} */ (new Set()));
  const [painelTodos, setPainelTodos] = useState(false);
  const [todos, setTodos] = useState(() => /** @type {{ natureza: any, centro_custo: any, centro_resultado: any }} */ ({ natureza: null, centro_custo: null, centro_resultado: null }));
  // Trocar a direção zera as naturezas do formulário: a escolha pendente de "aplicar
  // a todos" (do tipo antigo: despesa × receita) também sai, senão ela voltaria aqui.
  const [direcaoDosTodos, setDirecaoDosTodos] = useState(form.direcao);
  if (direcaoDosTodos !== form.direcao) {
    setDirecaoDosTodos(form.direcao);
    setTodos({ natureza: null, centro_custo: null, centro_resultado: null });
  }

  const alterarLinhas = (/** @type {string} */ chave, /** @type {(ls: any[]) => any[]} */ fn) =>
    setForm((f) => ({ ...f, rateios_itens: { ...(f.rateios_itens ?? {}), [chave]: fn(linhasDoItem(f, chave)) } }));
  const alterarLinha = (/** @type {string} */ chave, /** @type {number} */ j, /** @type {object} */ patch) =>
    alterarLinhas(chave, (ls) => ls.map((l, k) => (k === j ? { ...l, ...patch } : l)));
  const removerLinha = (/** @type {string} */ chave, /** @type {number} */ j) => alterarLinhas(chave, (ls) => ls.filter((_, k) => k !== j));
  const adicionarLinha = (/** @type {string} */ chave, /** @type {number} */ k) => {
    if (linhasDoItem(form, chave).length >= MAX_RATEIOS_POR_ITEM) return notifyWarning("Atenção", `No máximo ${MAX_RATEIOS_POR_ITEM} linhas de rateio por item.`);
    const valorAuto = conferido?.porItem[k]?.valores[0] ?? null;
    alterarLinhas(chave, (ls) => {
      // A linha que era "100% automática" passa a ter o valor que estava À VISTA
      // (o líquido ou 100%), mesmo que guarde um valor antigo de quando o item
      // tinha mais linhas; sem líquido calculado, fica em branco.
      let primeira = ls;
      if (ls.length === 1 && form.rateio_modo === "VALOR") primeira = [{ ...ls[0], valor: valorAuto ? formatarNumero(valorAuto, { locale, casasMin: casas, casasMax: casas }) : "" }];
      else if (ls.length === 1) primeira = [{ ...ls[0], percentual: "100" }];
      return [...primeira, rateioVazio()];
    });
  };
  const alternar = (/** @type {string} */ chave) =>
    setRecolhidos((r) => {
      const novo = new Set(r);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  const algumAberto = form.itens.some((/** @type {any} */ i) => !recolhidos.has(i.chave));
  const aplicarATodos = async () => {
    if (!todos.natureza) return;
    if (temDadosPorItem(form)) {
      const n = form.itens.length;
      const ok = await confirmar({
        titulo: "Aplicar a todos os itens",
        descricao: `Cada um dos ${n} ${n === 1 ? "item" : "itens"} passa a ter uma linha só (100% do líquido) com esta classificação. As classificações atuais por item serão substituídas. Continuar?`,
        textoConfirmar: "Aplicar a todos",
      });
      if (!ok) return;
    }
    setForm((f) => ({ ...f, rateios_itens: classificacaoParaTodos(f, todos) }));
    setPainelTodos(false);
  };

  const fechados = (conferido?.porItem ?? []).filter((/** @type {any} */ i) => i.fecha).length;
  /** @type {{ estado: 'fechado'|'falta'|'sobra'|'pendente', texto: string }} */
  let indicadorTotal;
  const difTotal = conferido?.diferencaTotal ?? null;
  if (difTotal == null) indicadorTotal = { estado: "pendente", texto: `Total: ${fechados} de ${form.itens.length} itens fechados. Preencha todos os itens para conferir a soma com o total.` };
  else if (comparar(difTotal, "0") === 0 && conferido?.fecha) {
    indicadorTotal = { estado: "fechado", texto: `Fechado: a soma de todos os itens é igual ao total (${resumo.total ? formatarMoeda(resumo.total, c) : "—"}).` };
  } else if (comparar(difTotal, "0") === 0) indicadorTotal = { estado: "pendente", texto: `Total: ${fechados} de ${form.itens.length} itens fechados. Confira os itens marcados.` };
  else {
    const abs = formatarMoeda(difTotal.replace("-", ""), c);
    indicadorTotal =
      comparar(difTotal, "0") > 0
        ? { estado: "falta", texto: `Total: falta ${abs} para fechar (${fechados} de ${form.itens.length} itens fechados).` }
        : { estado: "sobra", texto: `Total: sobra ${abs} acima do total (${fechados} de ${form.itens.length} itens fechados).` };
  }

  return (
    <>
      <EscolhaSegmentada
        rotulo="Modo do rateio (vale para todos os itens)"
        value={form.rateio_modo}
        readOnly={readOnly}
        onChange={(modo) => setForm((f) => ({ ...f, rateio_modo: modo }))}
        opcoes={[
          { value: "VALOR", label: "Por valor" },
          { value: "PERCENTUAL", label: "Por percentual" },
        ]}
      />
      <p className="col-span-12 min-w-0 break-words text-[11px] text-[var(--mg-text-2,#475569)]">
        Cada item é classificado sobre o seu valor líquido (subtotal − desconto rateado + acréscimo rateado). É só classificação gerencial: não cria
        título nem mexe no estoque.
      </p>
      {!readOnly ? (
        <div className="col-span-12 flex min-w-0 flex-wrap gap-2">
          <button type="button" className={BOTAO_LINHA} aria-expanded={painelTodos} onClick={() => setPainelTodos((v) => !v)} data-testid="abrir-aplicar-todos">
            <ListChecks size={14} aria-hidden /> Aplicar classificação a todos os itens
          </button>
          {form.itens.length > 1 ? (
            <button
              type="button"
              className={BOTAO_LINHA}
              onClick={() => setRecolhidos(algumAberto ? new Set(form.itens.map((/** @type {any} */ i) => String(i.chave))) : new Set())}
              data-testid="rateio-itens-recolher-todos"
            >
              {algumAberto ? "Recolher todos" : "Expandir todos"}
            </button>
          ) : null}
        </div>
      ) : null}
      {painelTodos && !readOnly ? (
        <div className="col-span-12 min-w-0 rounded-lg border border-dashed border-[var(--mg-divider,#cbd5e1)] bg-slate-50 p-3" data-testid="aplicar-todos-painel">
          <p className="mb-2 text-[12px] font-semibold uppercase text-[var(--mg-text-2,#475569)]">Mesma classificação para todos os itens</p>
          <div className="grid grid-cols-12 gap-3">
            <SeletorPaginadoGestao
              rotulo={rotuloNatureza}
              obrigatorio
              span={12}
              testId="seletor-natureza-todos"
              chave={["naturezas", empresaId, tipoNatureza]}
              buscar={(a) => buscarOpcoesLancamento("naturezas", empresaId, { ...a, tipo: tipoNatureza })}
              value={todos.natureza}
              rotuloDaOpcao={(o) => String(o?.caminho || o?.nome || "")}
              onChange={(o) => setTodos((t) => ({ ...t, natureza: o ? { id: String(o.id), rotulo: String(o.caminho || o.nome || "") } : null }))}
            />
            <SeletorPaginadoGestao
              rotulo="Centro de custo"
              span={6}
              testId="seletor-centro-custo-todos"
              chave={["centros-custo", empresaId]}
              buscar={(a) => buscarOpcoesLancamento("centros-custo", empresaId, a)}
              value={todos.centro_custo}
              permitirLimpar
              textoVazio="— Nenhum —"
              onChange={(o) => setTodos((t) => ({ ...t, centro_custo: o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null }))}
            />
            <SeletorPaginadoGestao
              rotulo="Centro de resultado"
              span={6}
              testId="seletor-centro-resultado-todos"
              chave={["centros-resultado", empresaId]}
              buscar={(a) => buscarOpcoesLancamento("centros-resultado", empresaId, a)}
              value={todos.centro_resultado}
              permitirLimpar
              textoVazio="— Nenhum —"
              onChange={(o) => setTodos((t) => ({ ...t, centro_resultado: o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null }))}
            />
            <div className="col-span-12 flex min-w-0 flex-wrap items-center gap-2">
              <button type="button" className={BOTAO_LINHA} disabled={!todos.natureza} onClick={aplicarATodos} data-testid="aplicar-classificacao-todos">
                Aplicar a todos os itens
              </button>
              <span className="min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]">Cada item fica com uma linha de 100% (o líquido do item).</span>
            </div>
          </div>
        </div>
      ) : null}
      {form.itens.map((/** @type {any} */ item, /** @type {number} */ k) => {
        const linhas = linhasDoItem(form, item.chave);
        const conf = conferido?.porItem[k];
        const base = `itens.${k}`;
        const erroItem = erroDe(`${base}.rateio`);
        const comErro = Boolean(erroItem) || linhas.some((_, j) => CAMPOS_DA_LINHA.some((campo) => erroDe(`${base}.rateios.${j}.${campo}`)));
        const aberto = !recolhidos.has(item.chave) || comErro || itemComErroServidor === item.chave;
        const nome = item.tipo_item === "SERVICO" ? String(item.descricao ?? "").trim() || "Serviço" : item.produto?.rotulo || "Mercadoria sem produto";
        const indicador = indicadorDoItem(conf, form.rateio_modo, linhas.length, c);
        // A soma que não fecha já está no indicador (falta/sobra): o texto só repetiria.
        const erroRepetido = (indicador.estado === "falta" || indicador.estado === "sobra") && (erroItem === ERRO_SOMA_ITEM_VALOR || erroItem === ERRO_SOMA_ITEM_PERCENTUAL);
        const umaLinha = linhas.length === 1;
        return (
          <div key={item.chave} data-testid={`rateio-item-${k}`} className="col-span-12 min-w-0 rounded-lg border border-[var(--mg-divider,#cbd5e1)] bg-white">
            <button
              type="button"
              aria-expanded={aberto}
              aria-controls={aberto ? `rateio-item-${item.chave}-corpo` : undefined}
              onClick={() => alternar(item.chave)}
              className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 p-3 text-left"
              data-testid={`rateio-item-${k}-cabecalho`}
            >
              <span className="min-w-0 break-words text-[12px] font-semibold uppercase text-[var(--mg-text-1,#0f172a)]">
                Item {k + 1} · {nome}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[var(--mg-text-2,#475569)]">
                <span data-testid={`rateio-item-${k}-liquido`}>líquido {conf?.liquido ? formatarMoeda(conf.liquido, c) : "—"}</span>
                <span
                  data-testid={`rateio-item-${k}-diferenca-curta`}
                  data-estado={indicador.estado}
                  className={indicador.estado === "fechado" ? "text-emerald-800" : indicador.estado === "pendente" ? "" : "font-semibold text-amber-900"}
                >
                  · {indicador.curto}
                </span>
                <ChevronDown size={16} aria-hidden className={`shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`} />
              </span>
            </button>
            {aberto ? (
              <div id={`rateio-item-${item.chave}-corpo`} className="grid min-w-0 grid-cols-12 gap-3 border-t border-[var(--mg-divider,#cbd5e1)] px-3 pb-3 pt-2">
                {linhas.map((/** @type {any} */ r, /** @type {number} */ j) => {
                  const b = `${base}.rateios.${j}`;
                  const valorCalculado = conf?.valores[j] ?? null;
                  const prefixo = `rateio-item-${k}-linha-${j}`;
                  return (
                    <div key={r.chave} data-testid={prefixo} className="col-span-12 min-w-0 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-slate-50/60 p-2">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase text-[var(--mg-text-2,#475569)]">Linha {j + 1}</p>
                        {!readOnly && linhas.length > 1 ? (
                          <button
                            type="button"
                            className={BOTAO_REMOVER}
                            aria-label={`Remover linha ${j + 1} do item ${k + 1}`}
                            title={`Remover linha ${j + 1} do item ${k + 1}`}
                            onClick={() => removerLinha(item.chave, j)}
                          >
                            <Trash2 size={16} aria-hidden />
                          </button>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-12 gap-3">
                        <SeletorPaginadoGestao
                          rotulo={rotuloNatureza}
                          obrigatorio
                          span={12}
                          testId={`seletor-natureza-item-${k}-${j}`}
                          chave={["naturezas", empresaId, tipoNatureza]}
                          buscar={(a) => buscarOpcoesLancamento("naturezas", empresaId, { ...a, tipo: tipoNatureza })}
                          value={r.natureza}
                          readOnly={readOnly}
                          erro={erroDe(`${b}.natureza`)}
                          rotuloDaOpcao={(o) => String(o?.caminho || o?.nome || "")}
                          onChange={(o) => alterarLinha(item.chave, j, { natureza: o ? { id: String(o.id), rotulo: String(o.caminho || o.nome || "") } : null })}
                        />
                        <SeletorPaginadoGestao
                          rotulo="Centro de custo"
                          span={6}
                          testId={`seletor-centro-custo-item-${k}-${j}`}
                          chave={["centros-custo", empresaId]}
                          buscar={(a) => buscarOpcoesLancamento("centros-custo", empresaId, a)}
                          value={r.centro_custo}
                          readOnly={readOnly}
                          erro={erroDe(`${b}.centro_custo`)}
                          permitirLimpar
                          textoVazio="— Nenhum —"
                          onChange={(o) => alterarLinha(item.chave, j, { centro_custo: o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null })}
                        />
                        <SeletorPaginadoGestao
                          rotulo="Centro de resultado"
                          span={6}
                          testId={`seletor-centro-resultado-item-${k}-${j}`}
                          chave={["centros-resultado", empresaId]}
                          buscar={(a) => buscarOpcoesLancamento("centros-resultado", empresaId, a)}
                          value={r.centro_resultado}
                          readOnly={readOnly}
                          erro={erroDe(`${b}.centro_resultado`)}
                          permitirLimpar
                          textoVazio="— Nenhum —"
                          onChange={(o) => alterarLinha(item.chave, j, { centro_resultado: o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null })}
                        />
                        {form.rateio_modo === "PERCENTUAL" ? (
                          <>
                            {umaLinha ? (
                              <ValorCalculado label="Percentual" span={6} valor="100% (automático)" testId={`${prefixo}-percentual-auto`} />
                            ) : (
                              <CampoNumero
                                label="Percentual"
                                sufixo="%"
                                required
                                span={6}
                                locale={locale}
                                limites={LIMITES.PERCENTUAL}
                                value={r.percentual}
                                onChange={(v) => alterarLinha(item.chave, j, { percentual: v })}
                                readOnly={readOnly}
                                error={erroDe(`${b}.percentual`)}
                                testId={`${prefixo}-percentual`}
                              />
                            )}
                            <ValorCalculado label="Valor calculado" span={6} valor={valorCalculado ? formatarMoeda(valorCalculado, c) : "—"} testId={`${prefixo}-valor-calculado`} />
                          </>
                        ) : umaLinha ? (
                          <ValorCalculado
                            label="Valor"
                            span={12}
                            valor={valorCalculado ? `${formatarMoeda(valorCalculado, c)} (100% do líquido)` : "— (100% do líquido do item)"}
                            testId={`${prefixo}-valor-auto`}
                          />
                        ) : (
                          <>
                            <CampoNumero
                              label="Valor"
                              required
                              span={6}
                              locale={locale}
                              limites={{ casas, inteiros: LIMITES.DINHEIRO.inteiros }}
                              casasMin={casas}
                              value={r.valor}
                              onChange={(v) => alterarLinha(item.chave, j, { valor: v })}
                              readOnly={readOnly}
                              error={erroDe(`${b}.valor`)}
                              testId={`${prefixo}-valor`}
                            />
                            <ValorCalculado
                              label="% do líquido do item"
                              span={6}
                              valor={conf?.percentuaisInformativos[j] ? `${formatarNumero(conf.percentuaisInformativos[j], { locale, casasMin: 2, casasMax: 2 })}%` : "—"}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                <IndicadorDiferenca testId={`rateio-item-${k}-diferenca`} estado={indicador.estado} texto={indicador.texto} />
                {erroItem && !erroRepetido ? (
                  <p role="alert" className="col-span-12 min-w-0 break-words text-[12px] text-red-700" data-testid={`rateio-item-${k}-erro`}>
                    {erroItem}
                  </p>
                ) : null}
                {!readOnly ? (
                  <div className="col-span-12">
                    <button type="button" className={BOTAO_LINHA} onClick={() => adicionarLinha(item.chave, k)} data-testid={`rateio-item-${k}-adicionar`}>
                      <Plus size={14} aria-hidden /> Adicionar linha
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      <IndicadorDiferenca testId="rateio-itens-diferenca-total" estado={indicadorTotal.estado} texto={indicadorTotal.texto} />
      {erroDe("rateio_itens") ? <p className="col-span-12 text-[12px] text-red-700">{erroDe("rateio_itens")}</p> : null}
    </>
  );
}

/**
 * (5) Vencimentos: à vista (1, na emissão), a prazo (1 data) ou parcelado
 * (gerador + linhas editáveis; resto do arredondamento na ÚLTIMA).
 * @param {{ form: any, resumo: any, ctx: ContextoSecao, setForm: (fn: (f: any) => any) => void }} props
 */
export function SecaoParcelas({ form, resumo, ctx, setForm }) {
  const { locale, moeda, casas, readOnly, erroDe } = ctx;
  const c = { locale, moeda, casas };
  const [erroGerador, setErroGerador] = useState(/** @type {string|null} */ (null));
  const total = resumo.total ? formatarMoeda(resumo.total, c) : "—";

  if (form.condicao === "AVISTA") {
    return (
      <div className="col-span-12 min-w-0 rounded-lg border border-[var(--mg-divider,#cbd5e1)] bg-white p-3 text-[13px]" data-testid="parcela-avista">
        1 parcela de <strong>{total}</strong>, vencendo na emissão ({formatarDia(form.data_emissao, locale)}).
      </div>
    );
  }
  if (form.condicao === "PRAZO") {
    return (
      <>
        <CampoDia
          label="Vencimento"
          required
          span={6}
          value={form.prazo_vencimento ?? ""}
          min={form.data_emissao}
          onChange={(v) => setForm((f) => ({ ...f, prazo_vencimento: v }))}
          readOnly={readOnly}
          error={erroDe("prazo_vencimento")}
          testId="prazo-vencimento"
        />
        <ValorCalculado label="Valor da parcela única" span={6} valor={total} testId="prazo-valor" />
      </>
    );
  }

  const gerar = () => {
    const r = gerarParcelas({
      total: resumo.total,
      casas,
      locale,
      dataEmissao: form.data_emissao,
      quantidade: form.gerador.quantidade,
      primeiroVencimento: form.gerador.primeiro_vencimento,
      intervalo: form.gerador.intervalo,
      entrada: form.gerador.entrada,
    });
    if (!r.ok) {
      setErroGerador(r.erro);
      return;
    }
    setErroGerador(null);
    setForm((f) => ({
      ...f,
      parcelas: r.parcelas.map((p) => parcelaVazia(p.vencimento, formatarNumero(p.valor, { locale, casasMin: casas, casasMax: casas }))),
    }));
  };
  const setGerador = (/** @type {string} */ campo, /** @type {string} */ v) => setForm((f) => ({ ...f, gerador: { ...f.gerador, [campo]: v } }));
  const alterar = (/** @type {number} */ i, /** @type {object} */ patch) =>
    setForm((f) => ({ ...f, parcelas: f.parcelas.map((/** @type {any} */ p, /** @type {number} */ k) => (k === i ? { ...p, ...patch } : p)) }));
  const remover = (/** @type {number} */ i) => setForm((f) => ({ ...f, parcelas: f.parcelas.filter((/** @type {any} */ _, /** @type {number} */ k) => k !== i) }));
  const adicionar = () => {
    if (form.parcelas.length >= MAX_PARCELAS) return notifyWarning("Atenção", `No máximo ${MAX_PARCELAS} parcelas.`);
    setForm((f) => ({ ...f, parcelas: [...f.parcelas, parcelaVazia(f.parcelas[f.parcelas.length - 1]?.vencimento ?? f.data_emissao, "")] }));
  };

  return (
    <>
      {!readOnly ? (
        <div className="col-span-12 min-w-0 rounded-lg border border-dashed border-[var(--mg-divider,#cbd5e1)] bg-slate-50 p-3" data-testid="gerador-parcelas">
          <p className="mb-2 text-[12px] font-semibold uppercase text-[var(--mg-text-2,#475569)]">Gerar parcelas</p>
          <div className="grid grid-cols-12 gap-3">
            <CampoTexto label="Nº de parcelas" span={3} value={form.gerador.quantidade} onChange={(v) => setGerador("quantidade", v.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" />
            <CampoDia label="1º vencimento" span={3} value={form.gerador.primeiro_vencimento} min={form.data_emissao} onChange={(v) => setGerador("primeiro_vencimento", v)} testId="gerador-primeiro-vencimento" />
            <CampoTexto label="Intervalo (dias)" span={3} value={form.gerador.intervalo} onChange={(v) => setGerador("intervalo", v.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" />
            <CampoNumero
              label="Entrada (opcional)"
              span={3}
              locale={locale}
              limites={{ casas, inteiros: LIMITES.DINHEIRO.inteiros }}
              casasMin={casas}
              value={form.gerador.entrada}
              onChange={(v) => setGerador("entrada", v)}
              testId="gerador-entrada"
            />
            <div className="col-span-12 flex flex-wrap items-center gap-2">
              <button type="button" className={BOTAO_LINHA} onClick={gerar}>
                Gerar parcelas
              </button>
              <span className="text-[12px] text-[var(--mg-text-2,#475569)]">A entrada vence na emissão; o resto do arredondamento fica na última parcela.</span>
            </div>
            {erroGerador ? (
              <p role="alert" className="col-span-12 text-[12px] text-red-700">
                {erroGerador}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {form.parcelas.map((/** @type {any} */ p, /** @type {number} */ i) => (
        <div key={p.chave} data-testid={`parcela-${i}`} className="col-span-12 min-w-0 rounded-lg border border-[var(--mg-divider,#cbd5e1)] bg-white p-3">
          <div className="grid grid-cols-12 items-end gap-3">
            <p className="col-span-12 text-[12px] font-semibold uppercase text-[var(--mg-text-2,#475569)]">
              Parcela {i + 1}/{form.parcelas.length}
            </p>
            <CampoDia
              label="Vencimento"
              required
              span={6}
              value={p.vencimento}
              min={form.data_emissao}
              onChange={(v) => alterar(i, { vencimento: v })}
              readOnly={readOnly}
              error={erroDe(`parcelas.${i}.vencimento`)}
              testId={`parcela-${i}-vencimento`}
            />
            <CampoNumero
              label="Valor"
              required
              span={5}
              locale={locale}
              limites={{ casas, inteiros: LIMITES.DINHEIRO.inteiros }}
              casasMin={casas}
              value={p.valor}
              onChange={(v) => alterar(i, { valor: v })}
              readOnly={readOnly}
              error={erroDe(`parcelas.${i}.valor`)}
              testId={`parcela-${i}-valor`}
            />
            {!readOnly ? (
              <div className="col-span-12 flex justify-end md:col-span-1">
                <button type="button" className={BOTAO_REMOVER} aria-label={`Remover parcela ${i + 1}`} title={`Remover parcela ${i + 1}`} onClick={() => remover(i)}>
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ))}
      {!form.parcelas.length ? (
        <div className="col-span-12">
          <AvisoGestao tone="blue" testId="parcelas-vazias">
            Use “Gerar parcelas” (ou adicione as parcelas uma a uma). O parcelado tem de 2 a {MAX_PARCELAS} parcelas.
          </AvisoGestao>
        </div>
      ) : null}
      <IndicadorDiferenca testId="parcelas-diferenca" {...estadoDiferenca(resumo.diferencaParcelas, c)} />
      {erroDe("parcelas") ? <p className="col-span-12 text-[12px] text-red-700">{erroDe("parcelas")}</p> : null}
      {!readOnly ? (
        <div className="col-span-12">
          <button type="button" className={BOTAO_LINHA} onClick={adicionar}>
            <Plus size={14} aria-hidden /> Parcela
          </button>
        </div>
      ) : null}
    </>
  );
}
