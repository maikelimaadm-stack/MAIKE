import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { notifyWarning } from "@/lib/maikeNotify";

export const FORMULARIO_UNIDADE_MEDIDA_ID = "formulario-unidade-medida-base1";

export default function FormularioUnidadeMedida({
  onSubmit,
  onCancel,
  initialData,
  variant = "card",
  toolbarActions = false,
  isSubmitting = false,
  readOnly = false,
}) {
  const isExistingRecord = Boolean(initialData?.id);
  const embedded = variant === "embedded";
  const [form, setForm] = useState(() => ({
    sigla: initialData?.sigla || "",
    descricao: initialData?.descricao || "",
    ativo: initialData?.ativo !== false,
  }));
  const [invalidFields, setInvalidFields] = useState([]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setInvalidFields((prev) => prev.filter((f) => f !== field));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const missing = [];
    if (!form.sigla?.trim()) missing.push("sigla");
    if (!form.descricao?.trim()) missing.push("descricao");
    if (missing.length) {
      setInvalidFields(missing);
      notifyWarning("Atenção", "Preencha os campos obrigatórios: Sigla e Descrição.");
      return;
    }
    onSubmit({
      sigla: form.sigla.toUpperCase(),
      descricao: form.descricao.toUpperCase(),
      ativo: form.ativo,
    });
  };

  const formBody = (
    <form
      id={FORMULARIO_UNIDADE_MEDIDA_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-unidade"
    >
      <B1Field
        label="Sigla"
        required
        span={4}
        hasValue={Boolean(form.sigla?.trim())}
        locked={readOnly}
        disabled={readOnly}
        error={invalidFields.includes("sigla") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={form.sigla}
          onChange={(e) => handleChange("sigla", e.target.value)}
          placeholder="UN, KG, L"
          className={`${B1_FIELD_CTL_CLS} uppercase font-mono`}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Descrição"
        required
        span={8}
        hasValue={Boolean(form.descricao?.trim())}
        locked={readOnly}
        disabled={readOnly}
        error={invalidFields.includes("descricao") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={form.descricao}
          onChange={(e) => handleChange("descricao", e.target.value)}
          placeholder="UNIDADE, QUILOGRAMA"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1ChaveRow
        label="Ativo"
        span={6}
        checked={form.ativo}
        onChange={readOnly ? undefined : (v) => handleChange("ativo", v)}
        disabled={readOnly}
        ariaLabel="Unidade ativa"
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
    <CadastroFormShell
      embedded={embedded}
      title={isExistingRecord ? "Editar unidade" : "Nova unidade de medida"}
    >
      <div className={embedded ? "mg-b1-record-form" : undefined}>{formBody}</div>
    </CadastroFormShell>
  );
}
