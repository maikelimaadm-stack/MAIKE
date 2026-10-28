import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { notifyWarning } from "@/lib/maikeNotify";

export const FORMULARIO_CATEGORIA_MANEJO_ID = "formulario-categoria-manejo-base1";

const MESES = [
  { label: "Jan", field: "gmd_janeiro" },
  { label: "Fev", field: "gmd_fevereiro" },
  { label: "Mar", field: "gmd_marco" },
  { label: "Abr", field: "gmd_abril" },
  { label: "Mai", field: "gmd_maio" },
  { label: "Jun", field: "gmd_junho" },
  { label: "Jul", field: "gmd_julho" },
  { label: "Ago", field: "gmd_agosto" },
  { label: "Set", field: "gmd_setembro" },
  { label: "Out", field: "gmd_outubro" },
  { label: "Nov", field: "gmd_novembro" },
  { label: "Dez", field: "gmd_dezembro" },
];

const REQUIRED_FIELDS = ["nome", "sigla", "especie", "sexo", "raca", "categoria_oficial"];
const UPPERCASE_FIELDS = ["nome", "sigla", "raca"];
const SELECT_EMPTY = "__VAZIO__";

export const getInitialFormData = () => ({
  nome: "",
  sigla: "",
  especie: "Bovinos",
  sexo: "",
  raca: "",
  idade_minima_meses: "",
  idade_maxima_meses: "",
  categoria_oficial: "",
  ganho_peso_anual_kg: "",
  gmd_janeiro: "",
  gmd_fevereiro: "",
  gmd_marco: "",
  gmd_abril: "",
  gmd_maio: "",
  gmd_junho: "",
  gmd_julho: "",
  gmd_agosto: "",
  gmd_setembro: "",
  gmd_outubro: "",
  gmd_novembro: "",
  gmd_dezembro: "",
});

export function buildFormInitialFromRecord(editando) {
  return {
    ...getInitialFormData(),
    ...editando,
    idade_minima_meses: editando.idade_minima_meses ?? "",
    idade_maxima_meses: editando.idade_maxima_meses ?? "",
    ganho_peso_anual_kg: editando.ganho_peso_anual_kg ?? "",
    gmd_janeiro: editando.gmd_janeiro ?? "",
    gmd_fevereiro: editando.gmd_fevereiro ?? "",
    gmd_marco: editando.gmd_marco ?? "",
    gmd_abril: editando.gmd_abril ?? "",
    gmd_maio: editando.gmd_maio ?? "",
    gmd_junho: editando.gmd_junho ?? "",
    gmd_julho: editando.gmd_julho ?? "",
    gmd_agosto: editando.gmd_agosto ?? "",
    gmd_setembro: editando.gmd_setembro ?? "",
    gmd_outubro: editando.gmd_outubro ?? "",
    gmd_novembro: editando.gmd_novembro ?? "",
    gmd_dezembro: editando.gmd_dezembro ?? "",
  };
}

export default function FormularioCategoriaManejo({
  initialData,
  isEditing,
  onSubmit,
  onCancel,
  categoriasOficiaisDisponiveis = [],
  variant = "card",
  toolbarActions = false,
  isSubmitting = false,
  readOnly = false,
}) {
  const embedded = variant === "embedded";
  const isExistingRecord = Boolean(initialData?.id);
  const [invalidFields, setInvalidFields] = useState([]);
  const [formData, setFormData] = useState(initialData || getInitialFormData());

  const handleChange = (field, value) => {
    const nextValue =
      UPPERCASE_FIELDS.includes(field) && typeof value === "string" ? value.toUpperCase() : value;
    setFormData((prev) => ({ ...prev, [field]: nextValue }));
    setInvalidFields((prev) => prev.filter((item) => item !== field));
  };

  const isEmptyValue = (value) => {
    if (typeof value === "string") return value.trim() === "";
    return value === undefined || value === null || value === "";
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const missingFields = REQUIRED_FIELDS.filter((field) => isEmptyValue(formData?.[field]));
    if (missingFields.length > 0) {
      setInvalidFields(missingFields);
      notifyWarning("Atenção", "Preencha os campos obrigatórios.");
      return;
    }
    onSubmit(formData);
  };

  const locked = readOnly || isSubmitting;

  const formBody = (
    <form
      id={FORMULARIO_CATEGORIA_MANEJO_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-categoria-manejo"
    >
      <B1Field
        label="Nome da Categoria"
        required
        span={4}
        hasValue={Boolean(formData.nome?.trim())}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("nome") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={formData.nome || ""}
          onChange={(e) => handleChange("nome", e.target.value)}
          placeholder="NOME DA CATEGORIA"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Sigla"
        required
        span={4}
        hasValue={Boolean(formData.sigla?.trim())}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("sigla") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={formData.sigla || ""}
          onChange={(e) => handleChange("sigla", e.target.value)}
          placeholder="SIGLA"
          maxLength={10}
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Espécie"
        required
        span={4}
        hasValue={Boolean(formData.especie)}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("especie") ? "Obrigatório" : undefined}
      >
        {readOnly ? (
          <input type="text" readOnly value={formData.especie || ""} className={B1_FIELD_CTL_CLS} />
        ) : (
          <select
            value={formData.especie || "Bovinos"}
            onChange={(e) => handleChange("especie", e.target.value)}
            className={B1_FIELD_CTL_CLS}
          >
            <option value="Bovinos">Bovinos</option>
            <option value="Ovinos">Ovinos</option>
            <option value="Suínos">Suínos</option>
          </select>
        )}
      </B1Field>

      <B1Field
        label="Sexo"
        required
        span={4}
        hasValue={Boolean(formData.sexo)}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("sexo") ? "Obrigatório" : undefined}
      >
        {readOnly ? (
          <input type="text" readOnly value={formData.sexo || ""} className={B1_FIELD_CTL_CLS} />
        ) : (
          <select
            value={formData.sexo || SELECT_EMPTY}
            onChange={(e) => handleChange("sexo", e.target.value === SELECT_EMPTY ? "" : e.target.value)}
            className={B1_FIELD_CTL_CLS}
          >
            <option value={SELECT_EMPTY}>SELECIONE</option>
            <option value="Macho">Macho</option>
            <option value="Fêmea">Fêmea</option>
          </select>
        )}
      </B1Field>

      <B1Field
        label="Raça"
        required
        span={4}
        hasValue={Boolean(formData.raca?.trim())}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("raca") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={formData.raca || ""}
          onChange={(e) => handleChange("raca", e.target.value)}
          placeholder="RAÇA"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Categoria Oficial"
        required
        span={4}
        hasValue={Boolean(formData.categoria_oficial)}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("categoria_oficial") ? "Obrigatório" : undefined}
      >
        {readOnly ? (
          <input type="text" readOnly value={formData.categoria_oficial || ""} className={B1_FIELD_CTL_CLS} />
        ) : (
          <select
            value={formData.categoria_oficial || SELECT_EMPTY}
            onChange={(e) =>
              handleChange("categoria_oficial", e.target.value === SELECT_EMPTY ? "" : e.target.value)
            }
            className={B1_FIELD_CTL_CLS}
          >
            <option value={SELECT_EMPTY}>SELECIONE</option>
            {categoriasOficiaisDisponiveis.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        )}
      </B1Field>

      <B1Field label="Idade Mínima (meses)" span={4} hasValue={formData.idade_minima_meses !== ""} locked={readOnly} disabled={locked}>
        <input
          type="number"
          value={formData.idade_minima_meses}
          onChange={(e) => handleChange("idade_minima_meses", e.target.value)}
          placeholder="0"
          className={B1_FIELD_CTL_CLS}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field label="Idade Máxima (meses)" span={4} hasValue={formData.idade_maxima_meses !== ""} locked={readOnly} disabled={locked}>
        <input
          type="number"
          value={formData.idade_maxima_meses}
          onChange={(e) => handleChange("idade_maxima_meses", e.target.value)}
          placeholder="0"
          className={B1_FIELD_CTL_CLS}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Ganho de Peso Anual (kg)"
        span={4}
        hasValue={formData.ganho_peso_anual_kg !== ""}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("ganho_peso_anual_kg") ? "Obrigatório" : undefined}
      >
        <input
          type="number"
          step="0.01"
          value={formData.ganho_peso_anual_kg}
          onChange={(e) => handleChange("ganho_peso_anual_kg", e.target.value)}
          placeholder="0,00"
          className={`${B1_FIELD_CTL_CLS} text-right font-mono`}
          readOnly={readOnly}
        />
      </B1Field>

      <div className="col-span-12 font-semibold text-xs text-slate-700 pt-1">Previsão de GMD Mensal</div>

      {MESES.map((mes) => (
        <B1Field
          key={mes.field}
          label={mes.label}
          required
          span={2}
          hasValue={formData[mes.field] !== ""}
          locked={readOnly}
          disabled={locked}
          error={invalidFields.includes(mes.field) ? "Obrigatório" : undefined}
        >
          <input
            type="number"
            step="0.01"
            value={formData[mes.field]}
            onChange={(e) => handleChange(mes.field, e.target.value)}
            placeholder="0,00"
            className={`${B1_FIELD_CTL_CLS} text-right font-mono`}
            readOnly={readOnly}
          />
        </B1Field>
      ))}

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
    <CadastroFormShell
      embedded={embedded}
      title={isEditing ? "Editar Categoria de Manejo" : "Nova Categoria de Manejo"}
    >
      {formBody}
    </CadastroFormShell>
  );
}
