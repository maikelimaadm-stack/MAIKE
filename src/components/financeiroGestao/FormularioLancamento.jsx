import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Trash2 } from "lucide-react";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoDia, CampoNumero, EscolhaSegmentada, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import { SecaoItens, SecaoParcelas, SecaoRateio, SecaoRateioPorItem } from "@/components/financeiroGestao/SecoesLancamento";
import { DialogoEscopoPorItem } from "@/components/financeiroGestao/DialogosLancamento";
import {
  alvoDoErroDoRateioPorItem,
  calcularResumo,
  entrarNoPorItem,
  formularioDoDetalhe,
  formularioVazio,
  geralEmBranco,
  inicializacaoProporcional,
  itemVazio,
  linhasDoItem,
  montarDocumento,
  rateioVazio,
  temDadosPorItem,
  voltarAoGeral,
} from "@/components/financeiroGestao/lancamentoModelo";
import { lerErroGestao, mensagemErroGestao } from "@/lib/gestaoErros";
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
  rateio_itens: "Rateio por item",
  parcelas: "Parcelas",
  prazo_vencimento: "Vencimento",
});

/** @param {string} chave */
const rotuloDoErro = (chave) => {
  const [raiz, indice, sub, subindice] = chave.split(".");
  // Rateio POR ITEM (D-PROD-156): aponta o item E a linha.
  if (raiz === "itens" && indice != null && sub === "rateios" && subindice != null) return `Item ${Number(indice) + 1}, linha ${Number(subindice) + 1} do rateio`;
  if (raiz === "itens" && indice != null && sub === "rateio") return `Item ${Number(indice) + 1}, rateio`;
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
 *   erroServidor?: { erro: unknown, seq: number } | null,
 * }} props
 *   `erroServidor`: a última recusa do servidor ao gravar este formulário; no
 *   rateio POR ITEM (`details.indice` + `subindice`) ela aparece no campo exato.
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
  erroServidor = null,
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

  // Recusa do servidor no rateio POR ITEM: o índice/subíndice viram a CHAVE do
  // item e da linha (o estado vive na chave); a mensagem fica no campo exato até
  // o formulário mudar. O índice é o do CORPO ENVIADO: durante o PUT/POST o
  // formulário segue editável (mover/remover item ou linha), então ele é lido
  // pelo retrato das chaves tirado no envio, nunca pela posição atual.
  const formRef = useRef(form);
  formRef.current = form;
  const retratoEnviado = useRef(/** @type {Array<{ chave: string, linhas: string[] }> | null} */ (null));
  const retratar = (/** @type {any} */ f) => {
    retratoEnviado.current = f.itens.map((/** @type {any} */ i) => ({ chave: String(i.chave), linhas: linhasDoItem(f, i.chave).map((l) => String(l.chave)) }));
  };
  const seqVisto = useRef(erroServidor?.seq ?? 0);
  const [erroDoServidor, setErroDoServidor] = useState(
    /** @type {{ form: any, itemChave: string, linhaChave: string|null, campo: string, mensagem: string } | null} */ (null),
  );
  useEffect(() => {
    if (!erroServidor || erroServidor.seq <= seqVisto.current) return;
    seqVisto.current = erroServidor.seq;
    const f = formRef.current;
    const lido = lerErroGestao(erroServidor.erro);
    const alvo = alvoDoErroDoRateioPorItem(lido);
    if (!alvo || f.rateio_escopo !== "POR_ITEM") return;
    // Sem retrato (recusa que não veio de um envio deste formulário), vale a posição atual.
    const enviado = retratoEnviado.current ? retratoEnviado.current[alvo.indice] ?? null : { chave: f.itens[alvo.indice]?.chave, linhas: null };
    const k = enviado ? f.itens.findIndex((/** @type {any} */ i) => i.chave === enviado.chave) : -1;
    if (k < 0) return; // o item recusado foi removido enquanto o envio estava no ar
    const item = f.itens[k];
    const linhas = linhasDoItem(f, item.chave);
    const linhaChave = alvo.subindice == null ? null : enviado?.linhas ? enviado.linhas[alvo.subindice] ?? null : linhas[alvo.subindice]?.chave ?? null;
    const j = linhaChave ? linhas.findIndex((l) => l.chave === linhaChave) : -1;
    const linha = j >= 0 ? linhas[j] : null;
    // Linha única (100% automático) não tem campo de valor/percentual: o erro fica no item.
    const naLinha = Boolean(linha) && !(linhas.length === 1 && (alvo.campo === "valor" || alvo.campo === "percentual"));
    // A mensagem cita a posição ATUAL do item e da linha (não a do corpo enviado).
    const { indice: _i, subindice: _j, ...outros } = lido.details;
    const atual = { code: lido.code, details: { ...outros, field: lido.field, reason: lido.reason, indice: k, ...(naLinha ? { subindice: j } : {}) } };
    setErroDoServidor({
      form: f,
      itemChave: item.chave,
      linhaChave: naLinha && linha ? linha.chave : null,
      campo: naLinha ? alvo.campo : "rateio",
      mensagem: mensagemErroGestao(atual, "O servidor recusou o rateio deste item.", { locale, moeda, casas }),
    });
  }, [erroServidor, locale, moeda, casas]);
  let chaveErroServidor = null;
  if (erroDoServidor && erroDoServidor.form === form) {
    const k = form.itens.findIndex((/** @type {any} */ i) => i.chave === erroDoServidor.itemChave);
    const j = erroDoServidor.linhaChave ? linhasDoItem(form, erroDoServidor.itemChave).findIndex((l) => l.chave === erroDoServidor.linhaChave) : -1;
    if (k >= 0) chaveErroServidor = j >= 0 ? `itens.${k}.rateios.${j}.${erroDoServidor.campo}` : `itens.${k}.rateio`;
  }

  const erroDe = (/** @type {string} */ chave) => {
    const e = resumo.erros[chave];
    if (!e) return chave === chaveErroServidor ? erroDoServidor?.mensagem : undefined;
    // Formato/casas aparecem na hora; "obrigatório" só depois da 1ª tentativa.
    if (tentou || !/^Obrigatório|^Escolha|^Informe|^Inclua|^Descreva|^Confirme/.test(e)) return e;
    return undefined;
  };
  const ctx = { empresaId, locale, moeda, casas, readOnly, erroDe };
  const set = (/** @type {string} */ campo, /** @type {unknown} */ valor) => setForm((f) => ({ ...f, [campo]: valor }));

  const trocarDirecao = async (/** @type {string} */ direcao) => {
    const algoEscolhido =
      form.parceiro ||
      form.rateios.some((/** @type {any} */ r) => r.natureza) ||
      form.itens.some((/** @type {any} */ i) => linhasDoItem(form, i.chave).some((r) => r.natureza));
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
    setForm((f) => ({
      ...f,
      direcao,
      parceiro: null,
      rateios: f.rateios.map((/** @type {any} */ r) => ({ ...r, natureza: null })),
      rateios_itens: Object.fromEntries(Object.entries(f.rateios_itens ?? {}).map(([k, ls]) => [k, (Array.isArray(ls) ? ls : []).map((r) => ({ ...r, natureza: null }))])),
    }));
  };

  const trocarConteudo = async (/** @type {string} */ conteudo) => {
    // Sem produtos só existe o rateio GERAL (D-PROD-156): sempre, com ou sem itens.
    if (conteudo === "SEM_PRODUTOS" && form.itens.length) {
      const n = form.itens.length;
      const porItemAgora = form.rateio_escopo === "POR_ITEM";
      const ok = await confirmar({
        titulo: "Lançamento sem produtos",
        descricao: `Os ${n} ${n === 1 ? "item será removido" : "itens serão removidos"} deste lançamento (o valor passa a ser digitado)${
          porItemAgora ? " e as classificações por item serão descartadas (sem produtos o rateio é sempre geral)" : ""
        }. Continuar?`,
        textoConfirmar: "Tirar os itens",
        perigo: true,
      });
      if (!ok) return;
      setForm((f) => ({ ...voltarAoGeral(f), conteudo, itens: [] }));
      return;
    }
    setForm((f) =>
      conteudo === "SEM_PRODUTOS"
        ? { ...voltarAoGeral(f), conteudo }
        : { ...f, conteudo, itens: conteudo === "COM_PRODUTOS" && !f.itens.length ? [itemVazio("MERCADORIA")] : f.itens },
    );
  };

  // Escopo do rateio (D-PROD-156): GERAL ↔ POR_ITEM, nunca em silêncio.
  const [dialogoEscopo, setDialogoEscopo] = useState(false);
  const trocarEscopo = async (/** @type {string} */ escopo) => {
    if (escopo === "POR_ITEM") {
      setDialogoEscopo(true);
      return;
    }
    if (temDadosPorItem(form)) {
      // Depois de salvar por item, o documento não tem mais rateio geral (o
      // formulário recarregado vem com ele em branco): a pergunta diz isso.
      const geral = geralEmBranco(form)
        ? "O rateio geral começa em branco (não há rateio geral guardado neste formulário)."
        : "O rateio geral volta como estava.";
      const ok = await confirmar({
        titulo: "Voltar ao rateio geral",
        descricao: `As classificações por item serão descartadas (elas não são convertidas numa natureza só). ${geral} Continuar?`,
        textoConfirmar: "Descartar e voltar",
        perigo: true,
      });
      if (!ok) return;
    }
    setForm((f) => voltarAoGeral(f));
  };
  const proporcional = dialogoEscopo ? inicializacaoProporcional(form, resumo, { locale, casas }) : null;

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
    retratar(form);
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
    retratar(form);
    onConfirmar({ doc, alterado: !editando || JSON.stringify(doc) !== docInicial.current });
  };

  const comProdutos = form.conteudo === "COM_PRODUTOS";
  const porItem = comProdutos && form.rateio_escopo === "POR_ITEM";
  // POR_ITEM: confirmar só com todos os itens fechados; o aviso aponta o item e a linha.
  const confirmarBloqueado = porItem && !readOnly && !resumo.rateioItens?.fecha;
  const primeiroProblema = confirmarBloqueado ? resumo.rateioItens?.problemas[0] ?? null : null;
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
          {comProdutos ? (
            <EscolhaSegmentada
              rotulo="Rateio"
              testId="escolha-escopo-rateio"
              value={form.rateio_escopo}
              readOnly={readOnly}
              onChange={trocarEscopo}
              opcoes={[
                { value: "GERAL", label: "Geral" },
                { value: "POR_ITEM", label: "Por item" },
              ]}
            />
          ) : null}
          {porItem ? (
            <SecaoRateioPorItem form={form} resumo={resumo} ctx={ctx} setForm={setForm} itemComErroServidor={chaveErroServidor ? erroDoServidor?.itemChave ?? null : null} />
          ) : (
            <SecaoRateio form={form} resumo={resumo} ctx={ctx} setForm={setForm} />
          )}

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
                    disabled={ocupado || confirmarBloqueado}
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
            {onConfirmar && confirmarBloqueado ? (
              <p role="status" className="mt-2 min-w-0 break-words text-[12px] text-amber-900" data-testid="confirmar-bloqueado-rateio-item">
                Confirmar fica bloqueado até o rateio por item fechar
                {primeiroProblema ? ` — ${rotuloDoErro(primeiroProblema.chave)}: ${primeiroProblema.mensagem}.` : ": preencha os itens e as linhas de rateio."}
              </p>
            ) : null}
          </div>
        </form>
      </div>
      {dialogoEscopo && proporcional ? (
        <DialogoEscopoPorItem
          aberto
          proporcional={proporcional}
          onCancelar={() => setDialogoEscopo(false)}
          onProporcional={() => {
            if (!proporcional.possivel) return;
            const iniciais = proporcional.rateios_itens;
            setForm((f) => entrarNoPorItem(f, iniciais));
            setDialogoEscopo(false);
          }}
          onEmBranco={() => {
            setForm((f) => entrarNoPorItem(f, Object.fromEntries(f.itens.map((/** @type {any} */ i) => [i.chave, [rateioVazio()]]))));
            setDialogoEscopo(false);
          }}
        />
      ) : null}
    </CadastroFormShell>
  );
}
