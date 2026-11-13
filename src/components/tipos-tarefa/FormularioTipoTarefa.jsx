import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { notifyWarning } from "@/lib/maikeNotify";
import B1Select from "@/components/cadastro/base1/B1Select";

export const FORMULARIO_TIPO_TAREFA_ID = "formulario-tipo-tarefa-base1";

const SELECT_EMPTY = "__VAZIO__";
const UPPERCASE_FIELDS = ["nome_tipo", "descricao"];

export default function FormularioTipoTarefa({
  initialData,
  grupos = [],
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
  const [formData, setFormData] = useState(() => ({
    nome_tipo: initialData?.nome_tipo || "",
    grupo_atividade_id: initialData?.grupo_atividade_id || "",
    grupo_atividade_nome: initialData?.grupo_atividade_nome || "",
    ativo: initialData?.ativo ?? true,
    descricao: initialData?.descricao || "",
  }));

  const handleChange = (field, value) => {
    const normalizedValue =
      UPPERCASE_FIELDS.includes(field) && typeof value === "string" ? value.toUpperCase() : value;
    setInvalidFields((prev) => prev.filter((f) => f !== field));
    setFormData((prev) => ({ ...prev, [field]: normalizedValue }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const missing = [];
    if (!formData.nome_tipo?.trim()) missing.push("nome_tipo");
    if (!formData.grupo_atividade_id?.trim()) missing.push("grupo_atividade_id");
    if (missing.length) {
      setInvalidFields(missing);
      notifyWarning("Atenção", "Preencha os campos obrigatórios: Tipo e Grupo.");
      return;
    }
    const grupo = grupos.find((item) => item.id === formData.grupo_atividade_id);
    onSubmit({
      ...formData,
      nome_tipo: String(formData.nome_tipo || "").toUpperCase(),
      descricao: String(formData.descricao || "").toUpperCase(),
      grupo_atividade_nome: grupo?.nome_grupo || formData.grupo_atividade_nome || "",
    });
  };

  const grupoLabel =
    grupos.find((g) => g.id === formData.grupo_atividade_id)?.nome_grupo ||
    formData.grupo_atividade_nome ||
    "";

  const formBody = (
    <form
      id={FORMULARIO_TIPO_TAREFA_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-tipo-tarefa"
      data-densidade={DENSIDADE_BASE1}
    >
      <B1Field
        label="Tipo de Tarefa"
        required
        span={6}
        hasValue={Boolean(formData.nome_tipo?.trim())}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
        error={invalidFields.includes("nome_tipo") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={formData.nome_tipo}
          onChange={(e) => handleChange("nome_tipo", e.target.value)}
          placeholder="NOME DO TIPO"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Grupo"
        required
        span={6}
        hasValue={Boolean(formData.grupo_atividade_id)}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
        error={invalidFields.includes("grupo_atividade_id") ? "Obrigatório" : undefined}
      >
        {readOnly ? (
          <input type="text" readOnly value={grupoLabel.toUpperCase()} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            value={formData.grupo_atividade_id || SELECT_EMPTY}
            onChange={(e) =>
              handleChange("grupo_atividade_id", e.target.value === SELECT_EMPTY ? "" : e.target.value)
            }
            className={B1_FIELD_CTL_CLS}
          >
            <option value={SELECT_EMPTY}>SELECIONE</option>
            {grupos.map((grupo) => (
              <option key={grupo.id} value={grupo.id}>
                {String(grupo.nome_grupo || "").toUpperCase()}
                {grupo.ativo === false ? " (INATIVO)" : ""}
              </option>
            ))}
          </B1Select>
        )}
      </B1Field>

      <B1ChaveRow
        label="Ativo"
        span={6}
        checked={formData.ativo}
        onChange={readOnly ? undefined : (v) => handleChange("ativo", v)}
        disabled={readOnly || isSubmitting}
        ariaLabel="Tipo ativo"
      />

      <B1Field
        label="Descrição"
        span={12}
        hasValue={Boolean(formData.descricao?.trim())}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
      >
        <textarea
          value={formData.descricao}
          onChange={(e) => handleChange("descricao", e.target.value)}
          placeholder="DESCRIÇÃO DO TIPO"
          className={`${B1_FIELD_CTL_CLS} uppercase min-h-[3rem] resize-y`}
          rows={2}
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
      title={isEditing ? "Editar Tipo de Tarefa" : "Novo Tipo de Tarefa"}
    >
      {formBody}
    </CadastroFormShell>
  );
}
