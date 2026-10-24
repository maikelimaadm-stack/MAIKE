import React, { useState } from "react";
import { toast } from "sonner";
import B1Field, { B1_FIELD_INPUT_CLS } from "@/components/cadastro/base1/B1Field";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import B1Switch from "@/components/cadastro/base1/B1Switch";

export const FORMULARIO_MARCA_ID = "formulario-marca-base1";

export default function FormularioMarca({
  onSubmit,
  onCancel,
  initialData,
  variant = "card",
  toolbarActions = false,
  isSubmitting = false,
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
    <form id={FORMULARIO_MARCA_ID} onSubmit={handleSubmit} className="grid grid-cols-12 gap-3 p-1">
      <B1Field
        label="Nome"
        required
        span={6}
        hasValue={Boolean(form.nome?.trim())}
        error={invalidFields.includes("nome") ? "Obrigatório" : undefined}
      >
        <input
          type="text"
          value={form.nome}
          onChange={(e) => handleChange("nome", e.target.value)}
          placeholder="NOME DA MARCA"
          className={B1_FIELD_INPUT_CLS}
          autoComplete="off"
        />
      </B1Field>
      <B1Field label="Descrição" span={6} hasValue={Boolean(form.descricao?.trim())}>
        <input
          type="text"
          value={form.descricao}
          onChange={(e) => handleChange("descricao", e.target.value)}
          placeholder="DESCRIÇÃO"
          className={B1_FIELD_INPUT_CLS}
          autoComplete="off"
        />
      </B1Field>
      <B1Field label="Ativo" span={12} hasValue variant="switch">
        <B1Switch
          checked={form.ativo}
          onChange={(v) => handleChange("ativo", v)}
          ariaLabel="Marca ativa"
          showText
        />
      </B1Field>
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
      {formBody}
    </CadastroFormShell>
  );
}
