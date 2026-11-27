import React, { useRef, useState, useMemo } from "react";
import { carregarFontesDoFormulario, normalizarProduto } from "@/services/produtoService";
import { useQuery } from "@tanstack/react-query";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";
import { formatarMoedaInput, parseMoedaInput } from "@/components/financeiro/moedaUtils";
import UnidadesConversaoProduto, { linhasIniciaisConversao, errosDasConversoes } from "./UnidadesConversaoProduto";
import { parseDecimalPtBR } from "@/domain/numeroPtBR";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import Base1PanelTabs from "@/components/cadastro/base1/Base1PanelTabs";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { notifyWarning } from "@/lib/maikeNotify";
import B1Select from "@/components/cadastro/base1/B1Select";

export const FORMULARIO_PRODUTO_ID = "formulario-produto-base1";

/** D-PROD-161: texto fixo; o formulário não tem campo de estoque atual. */
export const AVISO_ESTOQUE_CADASTRO = "Estoque é alterado em Entradas/Movimentações, não no Cadastro de Produtos";

const TIPOS_USO = [
  "Administrativo",
  "Infraestrutura",
  "Investimento",
  "Lavoura",
  "Manutenção",
  "Máquinas",
  "Nutrição Animal",
  "Operacional",
  "Outros",
  "Produção Animal",
];

/** Sigla aparada e em maiúsculas. @param {unknown} v */
const sigla = (v) => String(v ?? "").trim().toUpperCase();

/**
 * D-PROD-371 — a Unidade de Medida é a unidade de estoque do produto (um campo só). O que vai em
 * `unidade_principal_estoque`: no produto novo, ou quando a pessoa troca a Unidade de Medida, a sigla escolhida; sem
 * troca, a que o produto já tem (o produto antigo pode ter estoque noutra unidade, ou no SACO legado, que guarda kg).
 * @param {Record<string, any>} formData @param {Record<string, any>|null|undefined} initialData
 */
export const unidadePrincipalDoFormulario = (formData, initialData) => {
  const escolhida = sigla(formData?.unidade_medida);
  const gravada = initialData?.id ? String(initialData.unidade_principal_estoque || "KG") : null;
  if (gravada !== null && escolhida === sigla(initialData?.unidade_medida)) return gravada;
  return escolhida || gravada || "KG";
};

/** A unidade de estoque efetiva (o SACO legado e o vazio são KG). @param {unknown} u */
const unidadeEfetiva = (u) => {
  const s = sigla(u);
  return !s || s === "SACO" ? "KG" : s;
};

/**
 * Leitura ÚNICA dos campos com máscara (D-PROD-161): o MESMO número serve para
 * exibir (`formatarMoedaInput`) e para enviar. O texto do estado é o que o
 * usuário digitou sobre a máscara de centavos ("0,002" → 0,02); lê-lo de outro
 * jeito no envio gravava outro valor (o Peso por saco vira o fator SACO→KG).
 */
const parseNumero = (val) => {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return val;
  return parseMoedaInput(val);
};

/**
 * Campos com máscara numérica no formulário. D-PROD-288: preço de custo, preço de venda, local de estoque, consumo
 * (%PV) e peso por saco saíram da tela: o consumo fica nas Formulações e o saco vira uma unidade de conversão.
 */
const CAMPOS_MASCARADOS = ["estoque_minimo"];

/** Texto decimal do servidor ("4.0000") para o campo, com vírgula ("4" e "0,5"). Sem número, vazio. @param {unknown} valor */
const textoDecimalParaCampo = (valor) => {
  if (valor === null || valor === undefined || String(valor).trim() === "") return "";
  const n = Number(String(valor).trim().replace(",", "."));
  return Number.isFinite(n) ? String(n).replace(".", ",") : "";
};

/** A quantidade padrão é válida quando vazia (sem padrão) ou um número maior que zero. @param {unknown} valor */
const quantidadePadraoValida = (valor) => {
  const t = String(valor ?? "").trim();
  if (!t) return true;
  const n = parseDecimalPtBR(t);
  return n !== null && n > 0;
};

/**
 * Valor lido do servidor ainda não é texto de máscara: decimal canônico
 * ("30.0000") vira número uma vez, para a máscara não o ler como 300000 centavos.
 */
const valoresIniciaisMascarados = (dados) => {
  const saida = {};
  for (const campo of CAMPOS_MASCARADOS) {
    if (typeof dados?.[campo] !== "string") continue;
    const numero = parseDecimalPtBR(dados[campo]);
    saida[campo] = numero ?? "";
  }
  return saida;
};

/**
 * D-PROD-274 — a carência digitada: vazio vale (sem carência); senão inteiro de 0 a 365. Devolve a frase do erro ou "".
 * @param {unknown} texto
 */
const erroDaCarencia = (texto) => {
  const t = String(texto ?? "").trim();
  if (!t) return "";
  if (!/^\d+$/.test(t)) return "Informe os dias em número inteiro.";
  return Number(t) > 365 ? "No máximo 365 dias." : "";
};

export default function FormularioProduto({
  onSubmit,
  onCancel,
  initialData,
  isEditing,
  variant = "card",
  toolbarActions = false,
  isSubmitting = false,
  readOnly = false,
}) {
  const embedded = variant === "embedded";
  const isExistingRecord = Boolean(initialData?.id);
  const empresaId = useEmpresaSelecionadaId();
  const locked = readOnly || isSubmitting;

  const [formData, setFormData] = useState(() => {
    const defaults = {
      nome_produto: "",
      tipo_uso: "",
      codigo_interno: "",
      codigo_barras: "",
      categoria: "",
      marca: "",
      descricao: "",
      unidade_medida: "",
      preco_custo: "",
      preco_venda: "",
      estoque_minimo: "",
      local_estoque: "",
      tipo_consumo: "",
      percentual_consumo_pv: "",
      consumo_minimo_pv: "",
      consumo_maximo_pv: "",
      unidade_principal_estoque: "KG",
      peso_por_saco_kg: "",
      // D-PROD-274: a carência da bula, em dias (texto do campo; vazio = sem carência).
      carencia_dias: "",
      // Diário da máquina (Fase 3): a quantidade por implemento cheio (texto) e a unidade (L ou KG). Só vai ao servidor
      // quando a pessoa mexe no campo (`quantidade_padrao_alterada`): o servidor antigo recusa campo desconhecido.
      quantidade_padrao: "",
      quantidade_padrao_unidade: "KG",
      quantidade_padrao_alterada: false,
      // D-PROD-282: controle de lote e de validade (Sim/Não; padrão Não).
      controla_lote: false,
      controla_validade: false,
      observacoes: "",
      ativo: true,
    };
    if (initialData) {
      return {
        ...defaults,
        ...initialData,
        ...valoresIniciaisMascarados(initialData),
        carencia_dias: Number.isInteger(initialData.carencia_dias) ? String(initialData.carencia_dias) : "",
        // Mostra o que vier do servidor (texto decimal com vírgula); sem ele, o campo abre vazio na unidade de estoque.
        quantidade_padrao: textoDecimalParaCampo(initialData.quantidade_padrao),
        quantidade_padrao_unidade: initialData.quantidade_padrao_unidade ?? (initialData.unidade_principal_estoque === "L" ? "L" : "KG"),
        quantidade_padrao_alterada: false,
        controla_lote: initialData.controla_lote === true,
        controla_validade: initialData.controla_validade === true,
        ativo: initialData.ativo !== false,
      };
    }
    return defaults;
  });

  const [invalidFields, setInvalidFields] = useState([]);
  const nomeProdutoRef = useRef(null);
  // D-PROD-288: as unidades de conversão do produto ("1 SACO = 25 KG"), editadas no próprio cadastro.
  const [conversoes, setConversoes] = useState(() => linhasIniciaisConversao(initialData));
  const [mostrarErrosConversao, setMostrarErrosConversao] = useState(false);

  const { data: fontes = { categorias: [], unidades: [], locais: [], marcas: [] } } = useQuery({
    queryKey: ["produto-form-fontes", empresaId],
    queryFn: () => carregarFontesDoFormulario(empresaId),
    initialData: { categorias: [], unidades: [], locais: [], marcas: [] },
  });

  const { categorias, unidades, marcas } = fontes;

  const categoriasItems = useMemo(() => {
    const ativas = categorias.filter((c) => c.ativo !== false);
    const items = [];
    ativas.forEach((cat) => {
      if (cat.categoria_pai_id) {
        const pai = ativas.find((p) => p.id === cat.categoria_pai_id);
        items.push({
          id: cat.nome,
          nome: pai ? `${pai.nome} > ${cat.nome}` : cat.nome,
          nome_busca: `${pai?.nome || ""} ${cat.nome}`,
        });
      } else {
        const temFilhos = ativas.some((c) => c.categoria_pai_id === cat.id);
        if (!temFilhos) {
          items.push({ id: cat.nome, nome: cat.nome, nome_busca: cat.nome });
        }
      }
    });
    return items;
  }, [categorias]);

  const unidadesItems = useMemo(
    () =>
      unidades
        .filter((u) => u.ativo !== false)
        .map((u) => ({
          id: u.sigla,
          nome: `${u.sigla} - ${u.descricao}`,
          sigla: u.sigla,
          descricao: u.descricao,
        })),
    [unidades],
  );

  const marcasItems = useMemo(() => marcas.map((m) => ({ id: m.nome, nome: m.nome })), [marcas]);

  const handleChange = (field, value) => {
    // Diário da máquina (Fase 3): mexer na quantidade padrão marca o campo como alterado (é o que vai ao servidor).
    const marcaAlteracao = field === "quantidade_padrao" || field === "quantidade_padrao_unidade" ? { quantidade_padrao_alterada: true } : {};
    setFormData((prev) => ({ ...prev, [field]: value, ...marcaAlteracao }));
    setInvalidFields((prev) => prev.filter((f) => f !== field));
  };

  const estoqueMinNum = useMemo(() => parseNumero(formData.estoque_minimo), [formData.estoque_minimo]);
  // D-PROD-371: a unidade de estoque sai da Unidade de Medida (KG, L, SC, UN...).
  const unidadePrincipal = unidadePrincipalDoFormulario(formData, initialData);
  const unidadeEstoque = unidadeEfetiva(unidadePrincipal);
  const rotuloEstoqueAtual = unidadeEstoque === "KG" ? "kg" : unidadeEstoque;
  // Produto antigo cuja unidade de estoque não é a Unidade de Medida mostrada (cadastro de antes da D-PROD-371).
  const estoqueEmOutraUnidade = isExistingRecord && Boolean(sigla(formData.unidade_medida)) && unidadeEstoque !== sigla(formData.unidade_medida);

  const findItemId = (items, value) => {
    if (!value) return "";
    const item = items.find((i) => i.id === value || i.nome === value);
    return item?.id || "";
  };

  const scrollToField = (element) => {
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => element.focus?.(), 250);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const missingFields = [];
    if (!formData.nome_produto?.trim()) missingFields.push("nome_produto");
    if (!formData.unidade_medida?.trim()) missingFields.push("unidade_medida");
    if (!formData.categoria?.trim()) missingFields.push("categoria");
    // D-PROD-288: as unidades de conversão (sigla, fator > 0, uso, nunca a unidade de estoque).
    if (Object.keys(errosDasConversoes(conversoes, unidadeEstoque)).length > 0) {
      missingFields.push("unidades_conversao");
      setMostrarErrosConversao(true);
    }
    // D-PROD-274: a carência, quando informada, é um número inteiro de dias de 0 a 365.
    if (erroDaCarencia(formData.carencia_dias)) missingFields.push("carencia_dias");
    // Diário da máquina (Fase 3): a quantidade por implemento cheio, quando a pessoa mexeu, tem de ser um número > 0.
    if (formData.quantidade_padrao_alterada && !quantidadePadraoValida(formData.quantidade_padrao)) missingFields.push("quantidade_padrao");

    if (missingFields.length > 0) {
      setInvalidFields(missingFields);
      notifyWarning("Atenção", "Preencha os campos obrigatórios.");
      if (missingFields[0] === "nome_produto") scrollToField(nomeProdutoRef.current);
      if (missingFields[0] === "unidades_conversao") setAbaAtiva("unidades");
      return;
    }

    // Envia o número EXIBIDO de cada campo com máscara (mesma leitura da tela).
    const exibidos = Object.fromEntries(CAMPOS_MASCARADOS.map((campo) => [campo, parseNumero(formData[campo])]));
    onSubmit(normalizarProduto({ ...formData, ...exibidos, unidade_principal_estoque: unidadePrincipal, unidades_conversao: conversoes }, { isEditing }));
  };

  const acCls = `${B1_FIELD_CTL_CLS} w-full min-w-0`;
  const [abaAtiva, setAbaAtiva] = useState("principal");
  const abasProduto = useMemo(
    () => [
      { id: "principal", label: "Principal" },
      { id: "estoque", label: "Estoque" },
      { id: "unidades", label: "Conversão de unidades" },
    ],
    [],
  );

  const formBody = (
    <form
      id={FORMULARIO_PRODUTO_ID}
      onSubmit={handleSubmit}
      className="b1 w-full min-h-0 flex flex-col gap-3"
      noValidate
      data-testid="b1-form-produto"
      data-densidade={DENSIDADE_BASE1}
    >
      <Base1PanelTabs
        tabs={abasProduto}
        value={abaAtiva}
        onChange={setAbaAtiva}
        animate={!readOnly}
        animationKey={initialData?.id ?? "novo"}
        renderPanel={(panelId) => {
          if (panelId === "unidades") {
            return (
              <div className="mg-b1-form-grid w-full min-h-0">
                <UnidadesConversaoProduto
                  linhas={conversoes}
                  onChange={setConversoes}
                  unidadeEstoque={unidadeEstoque}
                  readOnly={readOnly}
                  disabled={locked}
                  mostrarErros={mostrarErrosConversao}
                />
              </div>
            );
          }
          if (panelId === "estoque") {
            return (
              <div className="mg-b1-form-grid w-full min-h-0">
                {estoqueEmOutraUnidade ? (
                  <p className="col-span-12 text-[11px] text-amber-800 bg-amber-50 rounded px-2 py-1" role="status" data-testid="aviso-estoque-outra-unidade">
                    O estoque deste produto está em {unidadeEstoque}. Trocar a Unidade de Medida troca a unidade de estoque, o que só é possível sem estoque, lotes, movimentos ou lançamentos.
                  </p>
                ) : null}

                {/* D-PROD-161/284: o estoque atual é só leitura (cache do motor físico), na unidade de estoque. */}
                <B1Field label="Estoque atual" span={6} hasValue locked disabled>
                  <input
                    type="text"
                    readOnly
                    value={`${Number(initialData?.estoque_atual ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ${rotuloEstoqueAtual}`}
                    className={`${B1_FIELD_CTL_CLS} text-right tabular-nums`}
                    data-testid="produto-estoque-atual"
                  />
                </B1Field>

                {/* D-PROD-274: a carência da bula (dias sem gado no pasto depois da aplicação), para o "Pasto liberado em". */}
                <B1Field
                  label="Carência (dias)"
                  span={6}
                  hasValue={Boolean(String(formData.carencia_dias ?? "").trim())}
                  locked={readOnly}
                  disabled={locked}
                  error={invalidFields.includes("carencia_dias") ? erroDaCarencia(formData.carencia_dias) || undefined : undefined}
                  dica={<p className="mt-1 px-1 text-[12px] text-[var(--mg-text-2,#475569)]">da bula: dias sem gado no pasto depois de aplicar</p>}
                >
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formData.carencia_dias ?? ""}
                    onChange={(e) => handleChange("carencia_dias", e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                    placeholder="Ex.: 21"
                    className={`${B1_FIELD_CTL_CLS} text-right tabular-nums`}
                    readOnly={readOnly}
                    data-testid="produto-carencia-dias"
                    aria-invalid={invalidFields.includes("carencia_dias")}
                  />
                </B1Field>

                {/* Diário da máquina (Fase 3): quanto do produto vai em cada implemento cheio (ex.: 4 L em 2.000 L). Opcional. */}
                <B1Field
                  label="Quantidade por implemento cheio"
                  span={4}
                  hasValue={Boolean(String(formData.quantidade_padrao ?? "").trim())}
                  locked={readOnly}
                  disabled={locked}
                  fieldClassName="b1-campo--num"
                  error={invalidFields.includes("quantidade_padrao") ? "Informe um número maior que zero, ou deixe vazio." : undefined}
                  dica={<p className="mt-1 px-1 text-[12px] text-[var(--mg-text-2,#475569)]">opcional: o diário da máquina preenche a mistura com este valor</p>}
                >
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formData.quantidade_padrao ?? ""}
                    onChange={(e) => handleChange("quantidade_padrao", e.target.value.slice(0, 12))}
                    placeholder="Ex.: 4"
                    className={`${B1_FIELD_CTL_CLS} text-right tabular-nums`}
                    readOnly={readOnly}
                    data-testid="produto-quantidade-padrao"
                    aria-invalid={invalidFields.includes("quantidade_padrao")}
                  />
                </B1Field>
                <B1Field label="Unidade do implemento" span={2} hasValue locked={readOnly} disabled={locked}>
                  {readOnly ? (
                    <input
                      type="text"
                      readOnly
                      value={formData.quantidade_padrao_unidade === "L" ? "L" : "kg"}
                      className={B1_FIELD_CTL_CLS}
                      data-testid="produto-quantidade-padrao-unidade"
                    />
                  ) : (
                    <B1Select
                      value={formData.quantidade_padrao_unidade === "L" ? "L" : "KG"}
                      onChange={(e) => handleChange("quantidade_padrao_unidade", e.target.value)}
                      className={B1_FIELD_CTL_CLS}
                      aria-label="Unidade da quantidade por implemento cheio"
                      data-testid="produto-quantidade-padrao-unidade"
                    >
                      <option value="L">L</option>
                      <option value="KG">kg</option>
                    </B1Select>
                  )}
                </B1Field>

                <B1Field label="Observações" span={12} hasValue={Boolean(formData.observacoes?.trim())} locked={readOnly} disabled={locked}>
                  <textarea
                    value={formData.observacoes}
                    onChange={(e) => handleChange("observacoes", e.target.value)}
                    placeholder="OBSERVAÇÕES GERAIS..."
                    className={`${B1_FIELD_CTL_CLS} uppercase min-h-[3rem] resize-y`}
                    rows={2}
                    readOnly={readOnly}
                  />
                </B1Field>

                {/* D-PROD-282: lote e validade. Trocar só com saldo zero (o servidor recusa com a mensagem). */}
                <B1ChaveRow
                  label="Controla lote"
                  span={6}
                  checked={formData.controla_lote === true}
                  onChange={readOnly ? undefined : (v) => {
                    handleChange("controla_lote", v);
                    if (!v) handleChange("controla_validade", false);
                  }}
                  disabled={readOnly || isSubmitting}
                  ariaLabel="Controla lote"
                />
                <B1ChaveRow
                  label="Controla validade"
                  span={6}
                  checked={formData.controla_validade === true}
                  onChange={readOnly || formData.controla_lote !== true ? undefined : (v) => handleChange("controla_validade", v)}
                  disabled={readOnly || isSubmitting || formData.controla_lote !== true}
                  ariaLabel="Controla validade"
                />
                <B1ChaveRow
                  label="Ativo"
                  span={6}
                  checked={formData.ativo}
                  onChange={readOnly ? undefined : (v) => handleChange("ativo", v)}
                  disabled={readOnly || isSubmitting}
                  ariaLabel="Produto ativo"
                />
              </div>
            );
          }

          return (
            <div className="mg-b1-form-grid w-full min-h-0">
      <B1Field
        label="Nome do Produto"
        required
        span={6}
        hasValue={Boolean(formData.nome_produto?.trim())}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("nome_produto") ? "Obrigatório" : undefined}
      >
        <input
          ref={nomeProdutoRef}
          type="text"
          value={formData.nome_produto}
          onChange={(e) => handleChange("nome_produto", e.target.value)}
          placeholder="NOME DO PRODUTO"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          autoComplete="off"
          readOnly={readOnly}
          aria-invalid={invalidFields.includes("nome_produto")}
        />
      </B1Field>

      <B1Field label="Tipo de Uso" span={3} hasValue={Boolean(formData.tipo_uso)} locked={readOnly} disabled={locked}>
        {readOnly ? (
          <input type="text" readOnly value={formData.tipo_uso || "—"} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            value={formData.tipo_uso || ""}
            onChange={(e) => handleChange("tipo_uso", e.target.value)}
            className={B1_FIELD_CTL_CLS}
          >
            <option value="">SELECIONE</option>
            {TIPOS_USO.map((t) => (
              <option key={t} value={t}>
                {t.toUpperCase()}
              </option>
            ))}
          </B1Select>
        )}
      </B1Field>

      {/* D-PROD-288: código interno automático, igual ao número do cadastro; só leitura. */}
      <B1Field label="Código Interno" span={3} hasValue locked disabled>
        <input
          type="text"
          readOnly
          value={initialData?.codigo_interno || initialData?.numero_produto || "AUTOMÁTICO"}
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          data-testid="produto-codigo-interno"
        />
      </B1Field>

      <B1Field label="Código de Barras" span={3} hasValue={Boolean(formData.codigo_barras?.trim())} locked={readOnly} disabled={locked}>
        <input
          type="text"
          value={formData.codigo_barras}
          onChange={(e) => handleChange("codigo_barras", e.target.value)}
          placeholder="7891234567890"
          className={B1_FIELD_CTL_CLS}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Categoria"
        required
        span={3}
        hasValue={Boolean(formData.categoria?.trim())}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("categoria") ? "Obrigatório" : undefined}
      >
        <AutocompleteGenerico
          items={categoriasItems}
          value={findItemId(categoriasItems, formData.categoria)}
          onChange={(id) => handleChange("categoria", id || "")}
          placeholder="BUSCAR CATEGORIA..."
          displayField="nome"
          searchFields={["nome", "nome_busca"]}
          className="w-full"
          inputClassName={acCls}
          disabled={locked}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Unidade de Medida"
        required
        span={3}
        hasValue={Boolean(formData.unidade_medida?.trim())}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("unidade_medida") ? "Obrigatório" : undefined}
        dica={<p className="mt-1 px-1 text-[12px] text-[var(--mg-text-2,#475569)]">é a unidade do estoque: saldo e custo ficam nela</p>}
      >
        <AutocompleteGenerico
          items={unidadesItems}
          value={findItemId(unidadesItems, formData.unidade_medida)}
          onChange={(id) => handleChange("unidade_medida", id || "")}
          placeholder="BUSCAR UNIDADE..."
          displayField="nome"
          searchFields={["sigla", "descricao", "nome"]}
          renderItem={(u) => (
            <div className="text-xs text-slate-900">
              {u.sigla} - {u.descricao}
            </div>
          )}
          className="w-full"
          inputClassName={acCls}
          disabled={locked}
          readOnly={readOnly}
        />
      </B1Field>


      <B1Field label="Marca" span={3} hasValue={Boolean(formData.marca?.trim())} locked={readOnly} disabled={locked}>
        <AutocompleteGenerico
          items={marcasItems}
          value={findItemId(marcasItems, formData.marca)}
          onChange={(id) => handleChange("marca", id || "")}
          placeholder="BUSCAR MARCA..."
          displayField="nome"
          searchFields={["nome"]}
          className="w-full"
          inputClassName={acCls}
          disabled={locked}
          readOnly={readOnly}
        />
      </B1Field>



      <B1Field label="Estoque Mínimo" span={6} hasValue={estoqueMinNum > 0} locked={readOnly} disabled={locked}>
        <input
          type="text"
          inputMode="decimal"
          value={formatarMoedaInput(estoqueMinNum)}
          onChange={(e) => handleChange("estoque_minimo", e.target.value)}
          placeholder="0,00"
          className={`${B1_FIELD_CTL_CLS} text-right font-mono`}
          readOnly={readOnly}
        />
      </B1Field>

      {/* D-PROD-161: o cadastro não lança estoque; o saldo é do motor físico. */}
      <p
        role="note"
        data-testid="aviso-estoque-cadastro"
        className="col-span-12 text-xs text-slate-700 bg-slate-100 rounded px-2 py-1"
      >
        {AVISO_ESTOQUE_CADASTRO}
      </p>

      <B1Field label="Descrição" span={12} hasValue={Boolean(formData.descricao?.trim())} locked={readOnly} disabled={locked}>
        <textarea
          value={formData.descricao}
          onChange={(e) => handleChange("descricao", e.target.value)}
          placeholder="DESCRIÇÃO DETALHADA DO PRODUTO..."
          className={`${B1_FIELD_CTL_CLS} uppercase min-h-[3rem] resize-y`}
          rows={2}
          readOnly={readOnly}
        />
      </B1Field>

      {formData.tipo_uso === "Nutrição Animal" ? (
        <p role="note" className="col-span-12 text-xs text-slate-700 bg-slate-100 rounded px-2 py-1" data-testid="aviso-consumo-formulacao">
          O consumo (%PV padrão, mínimo e máximo) fica na Formulação do produto, não no cadastro.
        </p>
      ) : null}
            </div>
          );
        }}
      />

      {!toolbarActions ? (
        <CadastroFormActions
          onCancel={onCancel}
          submitLabel={isExistingRecord ? "Atualizar" : "Salvar"}
          isSubmitting={isSubmitting}
        />
      ) : null}
    </form>
  );

  return (
    <CadastroFormShell embedded={embedded} title={isEditing ? "Editar Produto" : "Novo Produto"}>
      {formBody}
    </CadastroFormShell>
  );
}
