import React, { useRef, useState, useMemo } from "react";
import { carregarFontesDoFormulario, normalizarProduto } from "@/services/produtoService";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { sugerirPercentualPV } from "../suplementacao/suplementacaoRules";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";
import { formatarMoedaInput, parseMoedaInput } from "@/components/financeiro/moedaUtils";
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

/** D-PROD-162: rótulo da unidade principal de estoque (L = litros; o resto, como antes). */
const ROTULO_UNIDADE_ESTOQUE = Object.freeze({ KG: "QUILOGRAMAS (KG)", SACO: "SACOS", L: "LITROS (L)" });
const rotuloUnidadeEstoque = (u) => (u === "SACO" || u === "L" ? ROTULO_UNIDADE_ESTOQUE[u] : ROTULO_UNIDADE_ESTOQUE.KG);

/** Sigla ou descrição de unidade de medida que é de litros (L, LT, LTS, LITRO, LITROS...). */
const ehUnidadeDeLitros = (sigla, descricao) =>
  /^(L|LT|LTS|LITROS?)$/i.test(String(sigla ?? "").trim()) || /LITRO/i.test(String(descricao ?? ""));

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

/** Campos com máscara numérica no formulário. */
const CAMPOS_MASCARADOS = [
  "preco_custo",
  "preco_venda",
  "estoque_minimo",
  "percentual_consumo_pv",
  "consumo_minimo_pv",
  "consumo_maximo_pv",
  "peso_por_saco_kg",
];

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
 * D-PROD-271 — a carência digitada: vazio vale (sem carência); senão inteiro de 0 a 365. Devolve a frase do erro ou "".
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
      // D-PROD-271: a carência da bula, em dias (texto do campo; vazio = sem carência).
      carencia_dias: "",
      observacoes: "",
      ativo: true,
    };
    if (initialData) {
      return {
        ...defaults,
        ...initialData,
        ...valoresIniciaisMascarados(initialData),
        carencia_dias: Number.isInteger(initialData.carencia_dias) ? String(initialData.carencia_dias) : "",
        ativo: initialData.ativo !== false,
      };
    }
    return defaults;
  });

  const [invalidFields, setInvalidFields] = useState([]);
  const nomeProdutoRef = useRef(null);
  const codigoInternoRef = useRef(null);
  const pesoSacoRef = useRef(null);

  const { data: fontes = { categorias: [], unidades: [], locais: [], marcas: [] } } = useQuery({
    queryKey: ["produto-form-fontes", empresaId],
    queryFn: () => carregarFontesDoFormulario(empresaId),
    initialData: { categorias: [], unidades: [], locais: [], marcas: [] },
  });

  const { categorias, unidades, locais, marcas } = fontes;

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

  const locaisItems = useMemo(
    () => locais.filter((l) => l.ativo !== false).map((l) => ({ id: l.nome, nome: l.nome })),
    [locais],
  );

  const marcasItems = useMemo(() => marcas.map((m) => ({ id: m.nome, nome: m.nome })), [marcas]);

  // D-PROD-162 (achado D5): estoque em LITROS com uma unidade de medida que não é de
  // litros pede conferência (aviso, não bloqueia).
  const unidadeMedidaEscolhida = unidadesItems.find((u) => u.id === formData.unidade_medida);
  const avisoLitros =
    formData.unidade_principal_estoque === "L" &&
    Boolean(String(formData.unidade_medida ?? "").trim()) &&
    !ehUnidadeDeLitros(formData.unidade_medida, unidadeMedidaEscolhida?.descricao);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setInvalidFields((prev) => prev.filter((f) => f !== field));
  };

  const precoCustoNum = useMemo(() => parseNumero(formData.preco_custo), [formData.preco_custo]);
  const precoVendaNum = useMemo(() => parseNumero(formData.preco_venda), [formData.preco_venda]);
  const estoqueMinNum = useMemo(() => parseNumero(formData.estoque_minimo), [formData.estoque_minimo]);
  const percentualPVNum = useMemo(() => parseNumero(formData.percentual_consumo_pv), [formData.percentual_consumo_pv]);
  const consumoMinPVNum = useMemo(() => parseNumero(formData.consumo_minimo_pv), [formData.consumo_minimo_pv]);
  const consumoMaxPVNum = useMemo(() => parseNumero(formData.consumo_maximo_pv), [formData.consumo_maximo_pv]);
  const pesoSacoNum = useMemo(() => parseNumero(formData.peso_por_saco_kg), [formData.peso_por_saco_kg]);

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
    if (!formData.codigo_interno?.trim()) missingFields.push("codigo_interno");
    if (!formData.unidade_medida?.trim()) missingFields.push("unidade_medida");
    if (!formData.categoria?.trim()) missingFields.push("categoria");
    if (!formData.local_estoque?.trim()) missingFields.push("local_estoque");
    if (formData.unidade_principal_estoque === "SACO" && !pesoSacoNum) {
      missingFields.push("peso_por_saco_kg");
    }
    // D-PROD-271: a carência, quando informada, é um número inteiro de dias de 0 a 365.
    if (erroDaCarencia(formData.carencia_dias)) missingFields.push("carencia_dias");

    if (missingFields.length > 0) {
      setInvalidFields(missingFields);
      notifyWarning("Atenção", "Preencha os campos obrigatórios.");
      if (missingFields[0] === "nome_produto") scrollToField(nomeProdutoRef.current);
      if (missingFields[0] === "codigo_interno") scrollToField(codigoInternoRef.current);
      if (missingFields[0] === "peso_por_saco_kg") scrollToField(pesoSacoRef.current);
      return;
    }

    // Envia o número EXIBIDO de cada campo com máscara (mesma leitura da tela).
    const exibidos = Object.fromEntries(CAMPOS_MASCARADOS.map((campo) => [campo, parseNumero(formData[campo])]));
    onSubmit(normalizarProduto({ ...formData, ...exibidos }, { isEditing }));
  };

  const acCls = `${B1_FIELD_CTL_CLS} w-full min-w-0`;
  const [abaAtiva, setAbaAtiva] = useState("principal");
  const abasProduto = useMemo(
    () => [
      { id: "principal", label: "Principal" },
      { id: "estoque", label: "Unidade de Estoque" },
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
          if (panelId === "estoque") {
            return (
              <div className="mg-b1-form-grid w-full min-h-0">
                <B1Field
                  label="Unidade principal de estoque"
                  span={6}
                  hasValue={Boolean(formData.unidade_principal_estoque)}
                  locked={readOnly}
                  disabled={locked}
                >
                  {readOnly ? (
                    <input
                      type="text"
                      readOnly
                      value={rotuloUnidadeEstoque(formData.unidade_principal_estoque)}
                      className={B1_FIELD_CTL_CLS}
                    />
                  ) : (
                    <B1Select
                      value={formData.unidade_principal_estoque || "KG"}
                      onChange={(e) => handleChange("unidade_principal_estoque", e.target.value)}
                      className={B1_FIELD_CTL_CLS}
                    >
                      <option value="KG">{ROTULO_UNIDADE_ESTOQUE.KG}</option>
                      <option value="SACO">{ROTULO_UNIDADE_ESTOQUE.SACO}</option>
                      <option value="L">{ROTULO_UNIDADE_ESTOQUE.L}</option>
                    </B1Select>
                  )}
                </B1Field>

                {avisoLitros ? (
                  <p className="col-span-12 text-[11px] text-amber-800 bg-amber-50 rounded px-2 py-1" role="status" data-testid="aviso-unidade-litros">
                    A unidade de medida do cadastro não é de litros; confira.
                  </p>
                ) : null}

                {formData.unidade_principal_estoque === "SACO" ? (
                  <B1Field
                    label="Peso por saco (kg)"
                    required
                    span={6}
                    hasValue={pesoSacoNum > 0}
                    locked={readOnly}
                    disabled={locked}
                    error={invalidFields.includes("peso_por_saco_kg") ? "Obrigatório" : undefined}
                  >
                    <input
                      ref={pesoSacoRef}
                      type="text"
                      inputMode="decimal"
                      value={formatarMoedaInput(pesoSacoNum)}
                      onChange={(e) => handleChange("peso_por_saco_kg", e.target.value)}
                      placeholder="0,00"
                      className={`${B1_FIELD_CTL_CLS} text-right font-mono`}
                      readOnly={readOnly}
                      aria-invalid={invalidFields.includes("peso_por_saco_kg")}
                    />
                  </B1Field>
                ) : null}

                {/* D-PROD-271: a carência da bula (dias sem gado no pasto depois da aplicação), para o "Pasto liberado em". */}
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

      <B1Field
        label="Código Interno"
        required
        span={3}
        hasValue={Boolean(formData.codigo_interno?.trim())}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("codigo_interno") ? "Obrigatório" : undefined}
      >
        <input
          ref={codigoInternoRef}
          type="text"
          value={formData.codigo_interno}
          onChange={(e) => handleChange("codigo_interno", e.target.value)}
          placeholder="CÓDIGO INTERNO"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
          aria-invalid={invalidFields.includes("codigo_interno")}
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

      <B1Field
        label="Local de Estoque"
        required
        span={3}
        hasValue={Boolean(formData.local_estoque?.trim())}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("local_estoque") ? "Obrigatório" : undefined}
      >
        <AutocompleteGenerico
          items={locaisItems}
          value={findItemId(locaisItems, formData.local_estoque)}
          onChange={(id) => handleChange("local_estoque", id || "")}
          placeholder="BUSCAR LOCAL..."
          displayField="nome"
          searchFields={["nome"]}
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

      <B1Field label="Preço de Custo" span={4} hasValue={precoCustoNum > 0} locked={readOnly} disabled={locked}>
        <input
          type="text"
          inputMode="decimal"
          value={formatarMoedaInput(precoCustoNum)}
          onChange={(e) => handleChange("preco_custo", e.target.value)}
          placeholder="0,00"
          className={`${B1_FIELD_CTL_CLS} text-right font-mono`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field label="Preço de Venda" span={4} hasValue={precoVendaNum > 0} locked={readOnly} disabled={locked}>
        <input
          type="text"
          inputMode="decimal"
          value={formatarMoedaInput(precoVendaNum)}
          onChange={(e) => handleChange("preco_venda", e.target.value)}
          placeholder="0,00"
          className={`${B1_FIELD_CTL_CLS} text-right font-mono`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field label="Estoque Mínimo" span={4} hasValue={estoqueMinNum > 0} locked={readOnly} disabled={locked}>
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
        <>
          <div className="col-span-12 flex flex-wrap items-center justify-between gap-2 border border-indigo-200 bg-indigo-50/50 rounded-md px-2 py-1">
            <span className="font-semibold text-xs text-slate-700">Configuração de Suplementação</span>
            {!readOnly && !formData.percentual_consumo_pv && formData.nome_produto ? (
              <button
                type="button"
                className="tb-btn tb-btn-gray text-indigo-700 border-indigo-300"
                disabled={isSubmitting}
                onClick={() => {
                  const sugestao = sugerirPercentualPV(formData.nome_produto);
                  if (sugestao) {
                    setFormData((prev) => ({
                      ...prev,
                      percentual_consumo_pv: sugestao.percentual_consumo_pv,
                      consumo_minimo_pv: sugestao.consumo_minimo_pv,
                      consumo_maximo_pv: sugestao.consumo_maximo_pv,
                      tipo_consumo: sugestao.tipo_consumo,
                    }));
                    toast.success(`Valores sugeridos para "${sugestao.label}" aplicados.`);
                  } else {
                    toast.info("Não há sugestão para este produto. Preencha manualmente.");
                  }
                }}
              >
                Sugerir valores
              </button>
            ) : null}
          </div>

          <B1Field label="Tipo de consumo" span={3} hasValue={Boolean(formData.tipo_consumo)} locked={readOnly} disabled={locked}>
            {readOnly ? (
              <input type="text" readOnly value={formData.tipo_consumo || "—"} className={B1_FIELD_CTL_CLS} />
            ) : (
              <B1Select
                value={formData.tipo_consumo || ""}
                onChange={(e) => handleChange("tipo_consumo", e.target.value)}
                className={B1_FIELD_CTL_CLS}
              >
                <option value="">SELECIONE</option>
                <option value="CONSUMO_DIARIO">CONSUMO DIÁRIO</option>
                <option value="CONSUMO_LIVRE">CONSUMO LIVRE</option>
              </B1Select>
            )}
          </B1Field>

          <B1Field label="%PV consumo padrão" span={3} hasValue={percentualPVNum > 0} locked={readOnly} disabled={locked}>
            <input
              type="text"
              inputMode="decimal"
              value={formatarMoedaInput(percentualPVNum)}
              onChange={(e) => handleChange("percentual_consumo_pv", e.target.value)}
              className={`${B1_FIELD_CTL_CLS} text-right font-mono`}
              readOnly={readOnly}
            />
          </B1Field>

          <B1Field label="%PV mínimo" span={3} hasValue={consumoMinPVNum > 0} locked={readOnly} disabled={locked}>
            <input
              type="text"
              inputMode="decimal"
              value={formatarMoedaInput(consumoMinPVNum)}
              onChange={(e) => handleChange("consumo_minimo_pv", e.target.value)}
              className={`${B1_FIELD_CTL_CLS} text-right font-mono`}
              readOnly={readOnly}
            />
          </B1Field>

          <B1Field label="%PV máximo" span={3} hasValue={consumoMaxPVNum > 0} locked={readOnly} disabled={locked}>
            <input
              type="text"
              inputMode="decimal"
              value={formatarMoedaInput(consumoMaxPVNum)}
              onChange={(e) => handleChange("consumo_maximo_pv", e.target.value)}
              className={`${B1_FIELD_CTL_CLS} text-right font-mono`}
              readOnly={readOnly}
            />
          </B1Field>

          <p className="col-span-12 text-[10px] text-indigo-700 bg-indigo-100 rounded px-2 py-1">
            Fórmula: consumo esperado (kg/dia) = peso vivo médio × (%PV ÷ 100) × nº cabeças.
          </p>
        </>
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
