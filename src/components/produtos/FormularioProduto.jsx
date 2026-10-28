import React, { useRef, useState, useMemo } from "react";
import { carregarFontesDoFormulario, normalizarProduto } from "@/services/produtoService";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { sugerirPercentualPV } from "../suplementacao/suplementacaoRules";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";
import { formatarMoedaInput, parseMoedaInput } from "@/components/financeiro/moedaUtils";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { notifyWarning } from "@/lib/maikeNotify";

export const FORMULARIO_PRODUTO_ID = "formulario-produto-base1";

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

const parseNumero = (val) => {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return val;
  return parseMoedaInput(val);
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
      observacoes: "",
      ativo: true,
    };
    if (initialData) return { ...defaults, ...initialData, ativo: initialData.ativo !== false };
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

    if (missingFields.length > 0) {
      setInvalidFields(missingFields);
      notifyWarning("Atenção", "Preencha os campos obrigatórios.");
      if (missingFields[0] === "nome_produto") scrollToField(nomeProdutoRef.current);
      if (missingFields[0] === "codigo_interno") scrollToField(codigoInternoRef.current);
      if (missingFields[0] === "peso_por_saco_kg") scrollToField(pesoSacoRef.current);
      return;
    }

    onSubmit(normalizarProduto(formData, { isEditing }));
  };

  const acCls = `${B1_FIELD_CTL_CLS} w-full min-w-0`;

  const formBody = (
    <form
      id={FORMULARIO_PRODUTO_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-produto"
    >
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
          <select
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
          </select>
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
              <select
                value={formData.tipo_consumo || ""}
                onChange={(e) => handleChange("tipo_consumo", e.target.value)}
                className={B1_FIELD_CTL_CLS}
              >
                <option value="">SELECIONE</option>
                <option value="CONSUMO_DIARIO">CONSUMO DIÁRIO</option>
                <option value="CONSUMO_LIVRE">CONSUMO LIVRE</option>
              </select>
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

      <div className="col-span-12 font-semibold text-xs text-slate-700 pt-1">Unidade de Estoque</div>

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
            value={formData.unidade_principal_estoque === "SACO" ? "SACOS" : "QUILOGRAMAS (KG)"}
            className={B1_FIELD_CTL_CLS}
          />
        ) : (
          <select
            value={formData.unidade_principal_estoque || "KG"}
            onChange={(e) => handleChange("unidade_principal_estoque", e.target.value)}
            className={B1_FIELD_CTL_CLS}
          >
            <option value="KG">QUILOGRAMAS (KG)</option>
            <option value="SACO">SACOS</option>
          </select>
        )}
      </B1Field>

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

      {!toolbarActions ? (
        <div className="col-span-12">
          <CadastroFormActions
            onCancel={onCancel}
            submitLabel={isExistingRecord ? "Atualizar" : "Salvar"}
            isSubmitting={isSubmitting}
          />
        </div>
      ) : null}
    </form>
  );

  return (
    <CadastroFormShell embedded={embedded} title={isEditing ? "Editar Produto" : "Novo Produto"}>
      {formBody}
    </CadastroFormShell>
  );
}
