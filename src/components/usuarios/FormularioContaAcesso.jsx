import React, { useState } from "react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { toast } from "sonner";

export const FORMULARIO_CONTA_ACESSO_ID = "formulario-conta-acesso-base1";

export default function FormularioContaAcesso({
  onSubmit,
  onCancel,
  initialData,
  variant = "card",
  toolbarActions = false,
  isSubmitting = false,
  readOnly = false,
}) {
  const embedded = variant === "embedded";
  const isEditing = Boolean(initialData?.id);
  const [form, setForm] = useState(() => ({
    nome: initialData?.nome || initialData?.full_name || "",
    login: initialData?.login || initialData?.email || "",
    senha: "",
    nova_senha: "",
    ativo: initialData?.ativo !== false,
  }));
  const [invalidFields, setInvalidFields] = useState([]);

  const handleChange = (field, value) => {
    if (readOnly) return;
    setForm((prev) => ({ ...prev, [field]: value }));
    setInvalidFields((prev) => prev.filter((f) => f !== field));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const invalid = [];
    if (!form.nome?.trim()) invalid.push("nome");
    if (!isEditing) {
      if (!form.login?.trim()) invalid.push("login");
      if (!form.senha || form.senha.length < 8) invalid.push("senha");
    } else if (form.nova_senha && form.nova_senha.length < 8) {
      invalid.push("nova_senha");
    }
    if (invalid.length) {
      setInvalidFields(invalid);
      toast.error("Preencha os campos obrigatórios. A senha precisa ter pelo menos 8 caracteres.");
      return;
    }

    if (isEditing) {
      const patch = { nome: form.nome.trim(), ativo: form.ativo };
      if (form.nova_senha) patch.nova_senha = form.nova_senha;
      onSubmit(patch);
      setForm((prev) => ({ ...prev, senha: "", nova_senha: "" }));
      return;
    }

    onSubmit({
      nome: form.nome.trim(),
      login: form.login.trim(),
      senha: form.senha,
    });
    setForm((prev) => ({ ...prev, senha: "" }));
  };

  const fieldError = (name) => (invalidFields.includes(name) ? "invalid" : undefined);

  const loginField = isEditing ? (
    <B1Field label="Login (imutável)" locked>
      <input
        type="text"
        readOnly
        value={form.login}
        className={`${B1_FIELD_CTL_CLS} font-mono opacity-80`}
        tabIndex={-1}
      />
    </B1Field>
  ) : (
    <B1Field label="Login (usuário)" required error={fieldError("login")} disabled={readOnly} hasValue={Boolean(form.login)}>
      <input
        type="text"
        value={form.login}
        onChange={(e) => handleChange("login", e.target.value)}
        placeholder="Identificador de entrada"
        className={B1_FIELD_CTL_CLS}
        autoComplete="off"
        readOnly={readOnly}
        disabled={readOnly}
      />
    </B1Field>
  );

  return (
    <CadastroFormShell
      embedded={embedded}
      title={isEditing ? "Editar conta" : "Nova conta"}
      subtitle="Login e senha da entrada nativa MAIKE. Permissões de menu ficam em Administração › Permissões."
    >
      <form id={FORMULARIO_CONTA_ACESSO_ID} onSubmit={handleSubmit} className="space-y-2 max-w-xl">
        <B1Field label="Nome" required error={fieldError("nome")} disabled={readOnly}>
          <input
            type="text"
            value={form.nome}
            onChange={(e) => handleChange("nome", e.target.value)}
            placeholder="Nome de exibição"
            className={B1_FIELD_CTL_CLS}
            readOnly={readOnly}
            disabled={readOnly}
          />
        </B1Field>
        {loginField}
        {!isEditing ? (
          <B1Field label="Senha inicial" required error={fieldError("senha")} disabled={readOnly}>
            <input
              type="password"
              value={form.senha}
              onChange={(e) => handleChange("senha", e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className={B1_FIELD_CTL_CLS}
              autoComplete="new-password"
              readOnly={readOnly}
              disabled={readOnly}
            />
          </B1Field>
        ) : (
          <B1Field label="Nova senha (opcional)" error={fieldError("nova_senha")} disabled={readOnly}>
            <input
              type="password"
              value={form.nova_senha}
              onChange={(e) => handleChange("nova_senha", e.target.value)}
              placeholder="Deixe em branco para manter"
              className={B1_FIELD_CTL_CLS}
              autoComplete="new-password"
              readOnly={readOnly}
              disabled={readOnly}
            />
          </B1Field>
        )}
        {isEditing ? (
          <B1ChaveRow
            label="Conta ativa"
            checked={form.ativo}
            onChange={(checked) => handleChange("ativo", checked)}
            disabled={readOnly}
          />
        ) : null}
        {!toolbarActions ? (
          <CadastroFormActions
            onCancel={onCancel}
            submitLabel={isEditing ? "Salvar conta" : "Criar conta"}
            isSubmitting={isSubmitting}
          />
        ) : null}
      </form>
    </CadastroFormShell>
  );
}
