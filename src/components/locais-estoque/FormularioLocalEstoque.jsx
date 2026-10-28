import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { notifyWarning } from "@/lib/maikeNotify";

export const FORMULARIO_LOCAL_ESTOQUE_ID = "formulario-local-estoque-base1";

export default function FormularioLocalEstoque({
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
    nome: initialData?.nome || "",
    descricao: initialData?.descricao || "",
    capacidade: initialData?.capacidade || "",
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
    if (!form.nome?.trim()) missing.push("nome");
    if (missing.length) {
      setInvalidFields(missing);
      notifyWarning("Atenção", "Preencha o campo obrigatório: Nome.");
      return;
    }
    onSubmit({
      nome: form.nome.toUpperCase(),
      descricao: form.descricao?.trim() ? form.descricao.toUpperCase() : undefined,
      capacidade: form.capacidade?.trim() ? form.capacidade.toUpperCase() : undefined,
      ativo: form.ativo,
    });
  };

  const formBody = (
    <form
      id={FORMULARIO_LOCAL_ESTOQUE_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-local-estoque"
    >
      <B1Field
        label="Nome"
        required
        span={4}
        hasValue={Boolean(form.nome?.trim())}
        locked={readOnly}
        disabled={readOnly}
        error={invalidFields.includes("nome") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={form.nome}
          onChange={(e) => handleChange("nome", e.target.value)}
          placeholder="GALPÃO 1"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field label="Capacidade" span={4} hasValue={Boolean(form.capacidade?.trim())} locked={readOnly} disabled={readOnly}>
        <input
          type="text"
          value={form.capacidade}
          onChange={(e) => handleChange("capacidade", e.target.value)}
          placeholder="500 SACAS"
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field label="Descrição" span={4} hasValue={Boolean(form.descricao?.trim())} locked={readOnly} disabled={readOnly}>
        <textarea
          value={form.descricao}
          onChange={(e) => handleChange("descricao", e.target.value)}
          placeholder="DESCRIÇÃO"
          className={`${B1_FIELD_CTL_CLS} uppercase min-h-[2.5rem] resize-y`}
          rows={2}
          readOnly={readOnly}
        />
      </B1Field>
      <B1ChaveRow
        label="Ativo"
        span={6}
        checked={form.ativo}
        onChange={readOnly ? undefined : (v) => handleChange("ativo", v)}
        disabled={readOnly}
        ariaLabel="Local ativo"
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
      title={isExistingRecord ? "Editar local" : "Novo local de estoque"}
    >
      <div className={embedded ? "mg-b1-record-form" : undefined}>{formBody}</div>
    </CadastroFormShell>
  );
}
