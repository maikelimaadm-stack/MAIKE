import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";
import { AvisoGestao, CampoTexto } from "@/components/gestao/GestaoFormParts";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoDia, CampoNumero, EscolhaSegmentada, IndicadorDiferenca, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import { MAX_ITENS, MAX_PARCELAS, MAX_RATEIOS, gerarParcelas, itemVazio, parcelaVazia, produtoAceitaSaco, rateioVazio } from "@/components/financeiroGestao/lancamentoModelo";
import { LIMITES, comparar, formatarMoeda, formatarNumero, subtrair } from "@/lib/dinheiroDecimal";
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

/** @param {any} o */
const rotuloProduto = (o) => String(o?.nome ?? "");

/**
 * Uma linha de item (mercadoria ou serviço).
 * @param {{ item: any, indice: number, resumoItem: any, direcao: string, ctx: ContextoSecao,
 *   alterar: (patch: object) => void, remover: () => void }} props
 */
function LinhaItem({ item, indice, resumoItem, direcao, ctx, alterar, remover }) {
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
  const base = `itens.${indice}`;

  return (
    <div data-testid={`item-${indice}`} className="col-span-12 min-w-0 rounded-lg border border-[var(--mg-divider,#cbd5e1)] bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase text-[var(--mg-text-2,#475569)]">Item {indice + 1}</p>
        {!readOnly ? (
          <button type="button" className={BOTAO_REMOVER} aria-label={`Remover item ${indice + 1}`} title={`Remover item ${indice + 1}`} onClick={remover}>
            <Trash2 size={16} aria-hidden />
          </button>
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
              detalheDaOpcao={(o) => (o?.unidade_principal_estoque === "SACO" && o?.peso_por_saco_kg ? `saco de ${formatarNumero(String(o.peso_por_saco_kg), { locale, casasMax: 4 })} kg` : null)}
              onChange={(o) =>
                alterar({
                  produto: o ? { id: String(o.id), rotulo: rotuloProduto(o), unidade_principal_estoque: o.unidade_principal_estoque, peso_por_saco_kg: o.peso_por_saco_kg == null ? null : String(o.peso_por_saco_kg) } : null,
                  unidade: "KG",
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
                          {s.local_nome}: {formatarNumero(s.disponivel_kg, { locale, casasMax: 4 })} kg
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
                <option value="KG">KG</option>
                {aceitaSaco || item.unidade === "SACO" ? <option value="SACO">SACO</option> : null}
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
        {mercadoria && resumoItem?.kg ? (
          <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid={`item-${indice}-kg`}>
            {direcao === "PAGAR" ? "Entra no estoque" : "Sai do estoque"}: {formatarNumero(resumoItem.kg, { locale, casasMax: 4 })} kg
            {item.unidade === "SACO" ? " (convertido pelo peso do saco)" : ""}
            {faltaSaldo ? <strong className="ml-1 text-amber-800">— acima do saldo deste local ({formatarNumero(saldoDoLocal.disponivel_kg, { locale, casasMax: 4 })} kg)</strong> : null}
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
  const removerItem = (/** @type {number} */ i) => setForm((f) => ({ ...f, itens: f.itens.filter((/** @type {any} */ _, /** @type {number} */ k) => k !== i) }));
  const adicionar = (/** @type {string} */ tipo) => {
    if (form.itens.length >= MAX_ITENS) return notifyWarning("Atenção", `No máximo ${MAX_ITENS} itens por lançamento.`);
    setForm((f) => ({ ...f, itens: [...f.itens, itemVazio(tipo)] }));
  };
  return (
    <>
      {form.itens.map((/** @type {any} */ item, /** @type {number} */ i) => (
        <LinhaItem
          key={item.chave}
          item={item}
          indice={i}
          resumoItem={resumo.itens[i]}
          direcao={form.direcao}
          ctx={ctx}
          alterar={(patch) => alterarItem(i, patch)}
          remover={() => removerItem(i)}
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
