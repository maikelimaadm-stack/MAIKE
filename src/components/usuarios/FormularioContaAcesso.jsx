import React, { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import CadastroFormField, { CADASTRO_INPUT_CLS } from "@/components/cadastro/base1/CadastroFormField";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";

const INPUT_CLS = `${CADASTRO_INPUT_CLS} w-full px-2`;

export default function FormularioContaAcesso({ onSubmit, onCancel, initialData }) {
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
    setForm((prev) => ({ ...prev, [field]: value }));
    setInvalidFields((prev) => prev.filter((f) => f !== field));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
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
      return;
    }

    onSubmit({
      nome: form.nome.trim(),
      login: form.login.trim(),
      senha: form.senha,
    });
  };

  const fieldError = (name) => invalidFields.includes(name);

  return (
    <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <CadastroFormShell
        embedded
        title={isEditing ? "Editar conta MAIKE" : "Nova conta MAIKE"}
        subtitle="Login e senha usados na entrada nativa. Permissões de menu ficam na tabela abaixo."
      >
        <form onSubmit={handleSubmit} className="space-y-2 max-w-xl">
          <CadastroFormField label="Nome" required error={fieldError("nome")}>
            <input
              type="text"
              value={form.nome}
              onChange={(e) => handleChange("nome", e.target.value)}
              placeholder="Nome de exibição"
              className={INPUT_CLS}
            />
          </CadastroFormField>
          {!isEditing ? (
            <>
              <CadastroFormField label="Login (usuário)" required error={fieldError("login")}>
                <input
                  type="text"
                  value={form.login}
                  onChange={(e) => handleChange("login", e.target.value)}
                  placeholder="Identificador de entrada"
                  className={INPUT_CLS}
                  autoComplete="off"
                />
              </CadastroFormField>
              <CadastroFormField label="Senha inicial" required error={fieldError("senha")}>
                <input
                  type="password"
                  value={form.senha}
                  onChange={(e) => handleChange("senha", e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className={INPUT_CLS}
                  autoComplete="new-password"
                />
              </CadastroFormField>
            </>
          ) : (
            <CadastroFormField label="Nova senha (opcional)" error={fieldError("nova_senha")}>
              <input
                type="password"
                value={form.nova_senha}
                onChange={(e) => handleChange("nova_senha", e.target.value)}
                placeholder="Deixe em branco para manter"
                className={INPUT_CLS}
                autoComplete="new-password"
              />
            </CadastroFormField>
          )}
          {isEditing ? (
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pl-1">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => handleChange("ativo", e.target.checked)}
                className="rounded border-slate-300"
              />
              Conta ativa (desmarcado impede login)
            </label>
          ) : null}
          <CadastroFormActions
            onCancel={onCancel}
            submitLabel={isEditing ? "Salvar conta" : "Criar conta"}
          />
        </form>
      </CadastroFormShell>
    </motion.div>
  );
}
