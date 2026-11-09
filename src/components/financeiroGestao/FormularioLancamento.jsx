import React, { useMemo, useRef, useState } from "react";
import { CheckCircle2, Trash2 } from "lucide-react";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoDia, CampoNumero, EscolhaSegmentada, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import { SecaoItens, SecaoParcelas, SecaoRateio } from "@/components/financeiroGestao/SecoesLancamento";
import { calcularResumo, formularioDoDetalhe, formularioVazio, itemVazio, montarDocumento } from "@/components/financeiroGestao/lancamentoModelo";
import { LIMITES, formatarMoeda } from "@/lib/dinheiroDecimal";
import { confirmar } from "@/lib/maikeConfirmar";
import { notifyWarning } from "@/lib/maikeNotify";
import { ROTULO_METODO, buscarOpcoesLancamento } from "@/services/operacaoFinanceiraService";

export const FORMULARIO_LANCAMENTO_ID = "formulario-lancamento-financeiro-base1";

const PAPEIS = /** @type {Record<string, string>} */ ({
  fornecedor: "fornecedor",
  cliente: "cliente",
  prestador_servico: "prestador de serviço",
  transportador: "transportador",
  outros: "outros",
});

/** Rótulos dos campos para o aviso "revise os campos". */
const ROTULOS_ERRO = /** @type {Record<string, string>} */ ({
  parceiro: "Parceiro",
  data_emissao: "Emissão",
  data_operacional: "Data operacional",
  efeito_fisico_confirmado: "Declaração da mercadoria",
  valor_bruto: "Valor",
  valor_desconto: "Desconto",
  valor_acrescimo: "Acréscimo",
  total: "Total",
  itens: "Itens",
  rateio: "Rateio",
  parcelas: "Parcelas",
  prazo_vencimento: "Vencimento",
});

/** @param {string} chave */
const rotuloDoErro = (chave) => {
  const [raiz, indice] = chave.split(".");
  if (raiz === "itens" && indice != null) return `Item ${Number(indice) + 1}`;
  if (raiz === "rateios" && indice != null) return `Rateio, linha ${Number(indice) + 1}`;
  if (raiz === "parcelas" && indice != null) return `Parcela ${Number(indice) + 1}`;
  return ROTULOS_ERRO[raiz] ?? raiz;
};

/**
 * Formulário do lançamento (D-PROD-155) em 6 seções: Tipo, Dados gerais,
 * Itens, Rateio, Vencimentos e Prévia/confirmação. O rascunho é um documento
 * COMPLETO (o servidor valida tudo no POST/PUT, §8.3).
 *
 * @param {{
 *   empresaId: string|null,
 *   perfil: { locale: string, moeda: string, moeda_casas: number, metodos_permitidos: string[] },
 *   hoje: string,
 *   fusoConfigurado: boolean,
 *   initialData?: any,
 *   readOnly?: boolean,
 *   onSubmit: (doc: Record<string, unknown>) => void,
 *   onConfirmar?: ((p: { doc: Record<string, unknown>|null, alterado: boolean }) => void) | null,
 *   onDescartar?: (() => void) | null,
 *   ocupado?: boolean,
 * }} props
 */
export default function FormularioLancamento({
  empresaId,
  perfil,
  hoje,
  fusoConfigurado,
  initialData = null,
  readOnly = false,
  onSubmit,
  onConfirmar = null,
  onDescartar = null,
  ocupado = false,
}) {
  const locale = perfil.locale;
  const moeda = perfil.moeda;
  const casas = perfil.moeda_casas;
  const editando = Boolean(initialData?.id);
  const [form, setForm] = useState(() => (initialData?.id ? formularioDoDetalhe(initialData, { locale, casas, hoje }) : formularioVazio({ hoje })));
  const [tentou, setTentou] = useState(false);
  const resumo = useMemo(() => calcularResumo(form, { locale, casas, hoje, moeda }), [form, locale, casas, hoje, moeda]);

  // Documento como foi carregado: "Confirmar" só regrava (PUT) se algo mudou (§8.7).
  const docInicial = useRef(/** @type {string|null} */ (null));
  if (docInicial.current === null) {
    docInicial.current = editando && resumo.valido ? JSON.stringify(montarDocumento(form, resumo)) : "";
  }

  const c = { locale, moeda, casas };
  const erroDe = (/** @type {string} */ chave) => {
    const e = resumo.erros[chave];
    if (!e) return undefined;
    // Formato/casas aparecem na hora; "obrigatório" só depois da 1ª tentativa.
    if (tentou || !/^Obrigatório|^Escolha|^Informe|^Inclua|^Descreva|^Confirme/.test(e)) return e;
    return undefined;
  };
  const ctx = { empresaId, locale, moeda, casas, readOnly, erroDe };
  const set = (/** @type {string} */ campo, /** @type {unknown} */ valor) => setForm((f) => ({ ...f, [campo]: valor }));

  const trocarDirecao = async (/** @type {string} */ direcao) => {
    const algoEscolhido = form.parceiro || form.rateios.some((/** @type {any} */ r) => r.natureza);
    if (algoEscolhido) {
      const ok = await confirmar({
        titulo: "Trocar a direção",
        descricao:
          direcao === "RECEBER"
            ? "Trocar para A RECEBER limpa o parceiro e as naturezas escolhidas (a receber usa cliente e natureza de receita). Os itens e valores ficam."
            : "Trocar para A PAGAR limpa o parceiro e as naturezas escolhidas (a pagar usa fornecedor e natureza de despesa). Os itens e valores ficam.",
        textoConfirmar: "Trocar",
      });
      if (!ok) return;
    }
    setForm((f) => ({ ...f, direcao, parceiro: null, rateios: f.rateios.map((/** @type {any} */ r) => ({ ...r, natureza: null })) }));
  };

  const trocarConteudo = async (/** @type {string} */ conteudo) => {
    if (conteudo === "SEM_PRODUTOS" && form.itens.length) {
      const n = form.itens.length;
      const ok = await confirmar({
        titulo: "Lançamento sem produtos",
        descricao: `Os ${n} ${n === 1 ? "item será removido" : "itens serão removidos"} deste lançamento (o valor passa a ser digitado). Continuar?`,
        textoConfirmar: "Tirar os itens",
        perigo: true,
      });
      if (!ok) return;
      setForm((f) => ({ ...f, conteudo, itens: [] }));
      return;
    }
    setForm((f) => ({ ...f, conteudo, itens: conteudo === "COM_PRODUTOS" && !f.itens.length ? [itemVazio("MERCADORIA")] : f.itens }));
  };

  const validar = () => {
    if (resumo.valido) return true;
    setTentou(true);
    const chaves = Object.keys(resumo.erros);
    const nomes = [...new Set(chaves.map(rotuloDoErro))].slice(0, 4).join(", ");
    notifyWarning("Atenção", `Revise ${chaves.length === 1 ? "o campo" : "os campos"}: ${nomes}${chaves.length > 4 ? "…" : ""}.`);
    return false;
  };

  const enviar = (/** @type {React.FormEvent} */ e) => {
    e.preventDefault();
    if (readOnly || ocupado) return;
    if (!validar()) return;
    onSubmit(montarDocumento(form, resumo));
  };

  const pedirConfirmacao = () => {
    if (!onConfirmar || ocupado) return;
    if (readOnly) {
      onConfirmar({ doc: null, alterado: false });
      return;
    }
    if (!validar()) return;
    const doc = montarDocumento(form, resumo);
    onConfirmar({ doc, alterado: !editando || JSON.stringify(doc) !== docInicial.current });
  };

  const comProdutos = form.conteudo === "COM_PRODUTOS";
  const pagar = form.direcao === "PAGAR";
  const metodos = perfil.metodos_permitidos ?? [];

  return (
    <CadastroFormShell embedded title={editando ? "Editar lançamento" : "Novo lançamento"}>
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_LANCAMENTO_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="b1-form">
          {!fusoConfigurado ? (
            <div className="col-span-12">
              <AvisoGestao testId="lancamento-sem-fuso">
                A empresa não tem fuso horário configurado. Você pode salvar o rascunho, mas confirmar com mercadoria e registrar pagamentos exige o fuso
                (Administração › Empresa).
              </AvisoGestao>
            </div>
          ) : null}

          <SecaoForm titulo="1. Tipo" />
          <EscolhaSegmentada
            rotulo="Direção"
            testId="escolha-direcao"
            span={6}
            value={form.direcao}
            readOnly={readOnly}
            onChange={trocarDirecao}
            opcoes={[
              { value: "PAGAR", label: "A pagar" },
              { value: "RECEBER", label: "A receber" },
            ]}
          />
          <EscolhaSegmentada
            rotulo="Conteúdo"
            testId="escolha-conteudo"
            span={6}
            value={form.conteudo}
            readOnly={readOnly}
            onChange={trocarConteudo}
            opcoes={[
              { value: "SEM_PRODUTOS", label: "Sem produtos" },
              { value: "COM_PRODUTOS", label: "Com produtos" },
            ]}
          />
          <EscolhaSegmentada
            rotulo="Condição"
            testId="escolha-condicao"
            value={form.condicao}
            readOnly={readOnly}
            onChange={(v) => set("condicao", v)}
            opcoes={[
              { value: "AVISTA", label: "À vista" },
              { value: "PRAZO", label: "A prazo" },
              { value: "PARCELADO", label: "Parcelado" },
            ]}
          />

          <SecaoForm titulo="2. Dados gerais" />
          <SeletorPaginadoGestao
            rotulo={pagar ? "Parceiro (fornecedor ou prestador)" : "Parceiro (cliente)"}
            obrigatorio
            span={12}
            testId="seletor-parceiro"
            chave={["parceiros", empresaId, form.direcao]}
            buscar={(a) => buscarOpcoesLancamento("parceiros", empresaId, { ...a, direcao: form.direcao })}
            value={form.parceiro}
            readOnly={readOnly}
            erro={erroDe("parceiro")}
            detalheDaOpcao={(o) => (Array.isArray(o?.papeis) && o.papeis.length ? o.papeis.map((/** @type {string} */ p) => PAPEIS[p] ?? p).join(", ") : null)}
            onChange={(o) => set("parceiro", o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null)}
          />
          <CampoDia label="Emissão" required span={6} value={form.data_emissao} onChange={(v) => set("data_emissao", v)} readOnly={readOnly} error={erroDe("data_emissao")} testId="data-emissao" />
          <CampoTexto
            label="Nº do documento"
            span={6}
            value={form.documento_referencia}
            onChange={(v) => set("documento_referencia", v)}
            readOnly={readOnly}
            maxLength={64}
            error={erroDe("documento_referencia")}
            placeholder="NOTA, RECIBO…"
          />
          <CampoSelect
            label="Forma preferida (preferência — não registra pagamento)"
            span={12}
            value={form.metodo_preferido}
            onChange={(v) => set("metodo_preferido", v)}
            readOnly={readOnly}
            placeholder="— Sem preferência —"
            options={metodos.map((m) => ({ value: m, label: ROTULO_METODO[/** @type {keyof typeof ROTULO_METODO} */ (m)] ?? m }))}
          />
          <CampoTexto label="Histórico (descrição)" span={12} value={form.descricao} onChange={(v) => set("descricao", v)} readOnly={readOnly} maxLength={500} keepCase error={erroDe("descricao")} />
          {resumo.temMercadoria ? (
            <>
              <CampoDia
                label={pagar ? "Dia do recebimento da mercadoria" : "Dia da entrega da mercadoria"}
                required
                span={6}
                value={form.data_operacional}
                max={hoje}
                onChange={(v) => set("data_operacional", v)}
                readOnly={readOnly}
                error={erroDe("data_operacional")}
                testId="data-operacional"
              />
              <div className="col-span-12 min-w-0 md:col-span-6">
                <label className="flex min-h-10 items-start gap-2 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white p-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0 accent-emerald-600"
                    style={{ width: 20, height: 20 }}
                    checked={form.efeito_fisico_confirmado === true}
                    disabled={readOnly}
                    onChange={(e) => set("efeito_fisico_confirmado", e.target.checked)}
                    data-testid="declaracao-efeito-fisico"
                  />
                  <span>
                    {pagar ? "A mercadoria já foi recebida" : "A mercadoria já foi entregue"} (a confirmação mexe no estoque nesta data).
                  </span>
                </label>
                {erroDe("efeito_fisico_confirmado") ? <p className="mt-1 text-[11px] text-red-700">{erroDe("efeito_fisico_confirmado")}</p> : null}
              </div>
            </>
          ) : null}

          {comProdutos ? (
            <>
              <SecaoForm titulo="3. Itens" />
              <SecaoItens form={form} resumo={resumo} ctx={ctx} setForm={setForm} />
            </>
          ) : (
            <SecaoForm titulo="3. Valores" />
          )}
          {!comProdutos ? (
            <CampoNumero
              label="Valor"
              required
              span={4}
              locale={locale}
              limites={{ casas, inteiros: LIMITES.DINHEIRO.inteiros }}
              casasMin={casas}
              value={form.valor_bruto}
              onChange={(v) => set("valor_bruto", v)}
              readOnly={readOnly}
              error={erroDe("valor_bruto")}
              testId="valor-bruto"
            />
          ) : (
            <ValorCalculado label="Soma dos itens" span={4} valor={resumo.bruto ? formatarMoeda(resumo.bruto, c) : "—"} testId="valor-bruto-itens" />
          )}
          <CampoNumero
            label="Desconto"
            span={4}
            locale={locale}
            limites={{ casas, inteiros: LIMITES.DINHEIRO.inteiros }}
            casasMin={casas}
            value={form.valor_desconto}
            onChange={(v) => set("valor_desconto", v)}
            readOnly={readOnly}
            error={erroDe("valor_desconto")}
            testId="valor-desconto"
          />
          <CampoNumero
            label="Acréscimo"
            span={4}
            locale={locale}
            limites={{ casas, inteiros: LIMITES.DINHEIRO.inteiros }}
            casasMin={casas}
            value={form.valor_acrescimo}
            onChange={(v) => set("valor_acrescimo", v)}
            readOnly={readOnly}
            error={erroDe("valor_acrescimo")}
            testId="valor-acrescimo"
          />
          <ValorCalculado label={`Total (${moeda})`} span={12} destaque valor={resumo.total ? formatarMoeda(resumo.total, c) : "—"} testId="total-lancamento" />
          {erroDe("total") ? <p className="col-span-12 text-[12px] text-red-700">{erroDe("total")}</p> : null}
          {comProdutos ? (
            <p className="col-span-12 text-[11px] text-[var(--mg-text-2,#475569)]">
              Desconto e acréscimo são rateados entre os itens proporcionalmente ao subtotal. Na compra, o custo do lote é o valor líquido da mercadoria
              (a prévia mostra o rateio por item).
            </p>
          ) : null}

          <SecaoForm titulo="4. Rateio" />
          <SecaoRateio form={form} resumo={resumo} ctx={ctx} setForm={setForm} />

          <SecaoForm titulo="5. Vencimentos" />
          <SecaoParcelas form={form} resumo={resumo} ctx={ctx} setForm={setForm} />

          <SecaoForm titulo="6. Prévia e confirmação" />
          <div className="col-span-12 min-w-0 rounded-lg border border-[var(--mg-divider,#cbd5e1)] bg-white p-3 text-[13px]" data-testid="resumo-confirmacao">
            <p>
              {resumo.parcelas.length} {resumo.parcelas.length === 1 ? "parcela" : "parcelas"} · {resumo.itensEstoque}{" "}
              {resumo.itensEstoque === 1 ? "item no estoque" : "itens no estoque"} · total {resumo.total ? formatarMoeda(resumo.total, c) : "—"}
            </p>
            <p className="mt-1 text-[12px] text-[var(--mg-text-2,#475569)]">
              O rascunho não gera título nem mexe no estoque. Ao confirmar, a prévia mostra exatamente o que será criado. Pagamento e recebimento são
              registros gerenciais: não há conciliação bancária.
            </p>
            {onConfirmar || onDescartar ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {onConfirmar ? (
                  <button
                    type="button"
                    onClick={pedirConfirmacao}
                    disabled={ocupado}
                    data-testid="botao-confirmar-lancamento"
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <CheckCircle2 size={16} aria-hidden /> Confirmar lançamento
                  </button>
                ) : null}
                {onDescartar ? (
                  <button
                    type="button"
                    onClick={onDescartar}
                    disabled={ocupado}
                    data-testid="botao-descartar-rascunho"
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-red-300 bg-white px-4 text-[13px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    <Trash2 size={16} aria-hidden /> Descartar rascunho
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </form>
      </div>
    </CadastroFormShell>
  );
}
