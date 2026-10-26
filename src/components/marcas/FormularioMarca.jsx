import React, { useState } from "react";
import { toast } from "sonner";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";

export const FORMULARIO_MARCA_ID = "formulario-marca-base1";

export default function FormularioMarca({
  onSubmit,
  onCancel,
  initialData,
  variant = "card",
  toolbarActions = false,
  isSubmitting = false,
  readOnly = false,
}) {
  const isEditing = !!initialData?.id;
  const embedded = variant === "embedded";
  const [form, setForm] = useState(() => ({
    nome: initialData?.nome || "",
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
    if (!form.nome?.trim()) {
      setInvalidFields(["nome"]);
      toast.error("Nome é obrigatório!");
      return;
    }
    onSubmit({
      nome: form.nome.toUpperCase(),
      descricao: form.descricao?.toUpperCase() || undefined,
      ativo: form.ativo,
    });
  };

  const formBody = (
    <form
      id={FORMULARIO_MARCA_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form"
    >
      {isEditing && initialData?.numero_marca ? (
        <B1Field label="Nº" span={3} hasValue locked disabled>
          <input
            type="text"
            value={String(initialData.numero_marca)}
            className={B1_FIELD_CTL_CLS}
            readOnly
            tabIndex={-1}
            aria-readonly="true"
          />
        </B1Field>
      ) : null}
      <B1Field
        label="Nome"
        required
        span={isEditing && initialData?.numero_marca ? 9 : 6}
        hasValue={Boolean(form.nome?.trim())}
        locked={readOnly}
        disabled={readOnly}
        error={invalidFields.includes("nome") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={form.nome}
          onChange={(e) => handleChange("nome", e.target.value)}
          placeholder="NOME DA MARCA"
          className={B1_FIELD_CTL_CLS}
          autoComplete="off"
          readOnly={readOnly}
        />
      </B1Field>
      <B1Field
        label="Descrição"
        span={6}
        hasValue={Boolean(form.descricao?.trim())}
        locked={readOnly}
        disabled={readOnly}
      >
        <input
          type="text"
          value={form.descricao}
          onChange={(e) => handleChange("descricao", e.target.value)}
          placeholder="DESCRIÇÃO"
          className={B1_FIELD_CTL_CLS}
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
        ariaLabel="Marca ativa"
      />
      {!toolbarActions ? (
        <div className="col-span-12">
          <CadastroFormActions
            onCancel={onCancel}
            submitLabel={isEditing ? "Atualizar" : "Salvar"}
            isSubmitting={isSubmitting}
          />
        </div>
      ) : null}
    </form>
  );

  return (
    <CadastroFormShell embedded={embedded} title={isEditing ? "Editar Marca" : "Nova Marca"}>
      <div className={embedded ? "mg-b1-record-form" : undefined}>{formBody}</div>
    </CadastroFormShell>
  );
}
