import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1, B1TituloGrupo } from "@/components/cadastro/base1/B1Field";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { notifyWarning } from "@/lib/maikeNotify";
import CategoriaOficialCatalogoSelect from "@/components/catalogoGlobal/CategoriaOficialCatalogoSelect";
import B1Select from "@/components/cadastro/base1/B1Select";

export const FORMULARIO_CATEGORIA_MANEJO_ID = "formulario-categoria-manejo-base1";

const REQUIRED_FIELDS = ["nome"];
const UPPERCASE_FIELDS = ["nome", "sigla"];
const FAIXA_IDADE_FIELDS = ["idade_minima_meses", "idade_maxima_meses"];
const SELECT_EMPTY = "__VAZIO__";

export const MENSAGEM_FAIXA_IDADE_INVALIDA = "A idade inicial não pode ser maior que a final.";

/** Vazio → null; senão inteiro (o service grava com `parseInt`). */
const idadeOuNula = (valor) => {
  if (valor === undefined || valor === null || String(valor).trim() === "") return null;
  const n = parseInt(String(valor).trim(), 10);
  return Number.isFinite(n) ? n : null;
};

/** Faixa de idade: as duas pontas são opcionais; com as duas preenchidas, De ≤ a. */
export const faixaIdadeValida = (formData) => {
  const minima = idadeOuNula(formData?.idade_minima_meses);
  const maxima = idadeOuNula(formData?.idade_maxima_meses);
  return minima === null || maxima === null || minima <= maxima;
};

export const getInitialFormData = () => ({
  nome: "",
  sigla: "",
  especie: "Bovinos",
  sexo: "",
  idade_minima_meses: "",
  idade_maxima_meses: "",
  catalogo_categoria_visual_id: "",
});

export function buildFormInitialFromRecord(editando) {
  return {
    ...getInitialFormData(),
    ...editando,
    catalogo_categoria_visual_id: editando.catalogo_categoria_visual_id ?? "",
    idade_minima_meses: editando.idade_minima_meses ?? "",
    idade_maxima_meses: editando.idade_maxima_meses ?? "",
  };
}

export default function FormularioCategoriaManejo({
  initialData,
  isEditing,
  onSubmit,
  onCancel,
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
    // Mexer numa ponta da faixa de idade limpa o erro das duas.
    const limpar = FAIXA_IDADE_FIELDS.includes(field) ? FAIXA_IDADE_FIELDS : [field];
    setInvalidFields((prev) => prev.filter((item) => !limpar.includes(item)));
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
    if (!faixaIdadeValida(formData)) {
      // A mensagem aparece uma vez, sob o "a" (fim da faixa).
      setInvalidFields(["idade_maxima_meses"]);
      notifyWarning("Atenção", MENSAGEM_FAIXA_IDADE_INVALIDA);
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
      data-densidade={DENSIDADE_BASE1}
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
        span={4}
        hasValue={Boolean(formData.sigla?.trim())}
        locked={readOnly}
        disabled={locked}
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
        span={4}
        hasValue={Boolean(formData.especie)}
        locked={readOnly}
        disabled={locked}
      >
        {readOnly ? (
          <input type="text" readOnly value={formData.especie || ""} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            value={formData.especie || "Bovinos"}
            onChange={(e) => handleChange("especie", e.target.value)}
            className={B1_FIELD_CTL_CLS}
          >
            <option value="Bovinos">Bovinos</option>
            <option value="Ovinos">Ovinos</option>
            <option value="Suínos">Suínos</option>
          </B1Select>
        )}
      </B1Field>

      <B1Field
        label="Sexo"
        span={4}
        hasValue={Boolean(formData.sexo)}
        locked={readOnly}
        disabled={locked}
      >
        {readOnly ? (
          <input type="text" readOnly value={formData.sexo || ""} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            value={formData.sexo || SELECT_EMPTY}
            onChange={(e) => handleChange("sexo", e.target.value === SELECT_EMPTY ? "" : e.target.value)}
            className={B1_FIELD_CTL_CLS}
          >
            <option value={SELECT_EMPTY}>SELECIONE</option>
            <option value="Macho">Macho</option>
            <option value="Fêmea">Fêmea</option>
          </B1Select>
        )}
      </B1Field>

      <B1Field
        label="Ícone oficial (catálogo MAK Gestão)"
        span={4}
        // Sempre mostra um texto ("SEM VÍNCULO" ou o nome): o rótulo fica no alto.
        hasValue
        locked={readOnly}
        disabled={locked}
      >
        <CategoriaOficialCatalogoSelect
          value={formData.catalogo_categoria_visual_id || ""}
          onChange={(id) => handleChange("catalogo_categoria_visual_id", id)}
          className={B1_FIELD_CTL_CLS}
          readOnly={readOnly}
        />
      </B1Field>

      <B1TituloGrupo titulo="Faixa de idade (meses)" />

      <B1Field
        label="De"
        span={4}
        hasValue={formData.idade_minima_meses !== ""}
        locked={readOnly}
        disabled={locked}
      >
        <input
          type="number"
          value={formData.idade_minima_meses}
          onChange={(e) => handleChange("idade_minima_meses", e.target.value)}
          placeholder="0"
          className={B1_FIELD_CTL_CLS}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="a"
        span={4}
        hasValue={formData.idade_maxima_meses !== ""}
        locked={readOnly}
        disabled={locked}
        error={invalidFields.includes("idade_maxima_meses") ? MENSAGEM_FAIXA_IDADE_INVALIDA : undefined}
      >
        <input
          type="number"
          value={formData.idade_maxima_meses}
          onChange={(e) => handleChange("idade_maxima_meses", e.target.value)}
          placeholder="0"
          className={B1_FIELD_CTL_CLS}
          readOnly={readOnly}
        />
      </B1Field>

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
