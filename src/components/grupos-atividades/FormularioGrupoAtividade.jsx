import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { notifyWarning } from "@/lib/maikeNotify";

export const FORMULARIO_GRUPO_ATIVIDADE_ID = "formulario-grupo-atividade-base1";

const UPPERCASE_FIELDS = ["nome_grupo", "descricao", "observacoes"];

export default function FormularioGrupoAtividade({
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
  const [formData, setFormData] = useState(() => ({
    nome_grupo: initialData?.nome_grupo || "",
    ativo: initialData?.ativo ?? true,
    descricao: initialData?.descricao || "",
    observacoes: initialData?.observacoes || "",
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
    if (!formData.nome_grupo?.trim()) {
      setInvalidFields(["nome_grupo"]);
      notifyWarning("Atenção", "Preencha o campo obrigatório: Nome do Grupo.");
      return;
    }
    onSubmit({
      ...formData,
      nome_grupo: String(formData.nome_grupo || "").toUpperCase(),
      descricao: String(formData.descricao || "").toUpperCase(),
      observacoes: String(formData.observacoes || "").toUpperCase(),
    });
  };

  const formBody = (
    <form
      id={FORMULARIO_GRUPO_ATIVIDADE_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-grupo-atividade"
    >
      <B1Field
        label="Nome do Grupo"
        required
        span={6}
        hasValue={Boolean(formData.nome_grupo?.trim())}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
        error={invalidFields.includes("nome_grupo") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={formData.nome_grupo}
          onChange={(e) => handleChange("nome_grupo", e.target.value)}
          placeholder="NOME DO GRUPO"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
          data-field="nome_grupo"
        />
      </B1Field>

      <B1ChaveRow
        label="Ativo"
        span={6}
        checked={formData.ativo}
        onChange={readOnly ? undefined : (v) => handleChange("ativo", v)}
        disabled={readOnly || isSubmitting}
        ariaLabel="Grupo ativo"
      />

      <B1Field
        label="Descrição"
        span={6}
        hasValue={Boolean(formData.descricao?.trim())}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
      >
        <textarea
          value={formData.descricao}
          onChange={(e) => handleChange("descricao", e.target.value)}
          placeholder="DESCRIÇÃO DO GRUPO"
          className={`${B1_FIELD_CTL_CLS} uppercase min-h-[3rem] resize-y`}
          rows={2}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field
        label="Observações"
        span={6}
        hasValue={Boolean(formData.observacoes?.trim())}
        locked={readOnly}
        disabled={readOnly || isSubmitting}
      >
        <textarea
          value={formData.observacoes}
          onChange={(e) => handleChange("observacoes", e.target.value)}
          placeholder="OBSERVAÇÕES GERAIS..."
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
      title={isEditing ? "Editar Grupo de Atividades" : "Novo Grupo de Atividades"}
    >
      {formBody}
    </CadastroFormShell>
  );
}
