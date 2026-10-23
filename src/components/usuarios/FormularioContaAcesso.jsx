import React, { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";

const inputCls =
  "w-full h-8 text-xs rounded-md border border-slate-300 px-2 focus:outline-none focus:border-emerald-500 bg-white";

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

  const fieldError = (name) => (invalidFields.includes(name) ? "border-red-500 bg-red-50" : "");

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="rounded-lg border border-slate-300 bg-white shadow-sm overflow-hidden"
    >
      <div className="bg-slate-50 border-b px-4 py-2">
        <h2 className="text-sm font-semibold text-slate-800">
          {isEditing ? "Editar conta MAIKE" : "Nova conta MAIKE"}
        </h2>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Login e senha usados na entrada nativa. Permissões de menu ficam na tabela abaixo.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="p-4 space-y-3 max-w-xl">
        <div>
          <label className="text-[12px] text-slate-500 pl-1">Nome *</label>
          <input
            type="text"
            value={form.nome}
            onChange={(e) => handleChange("nome", e.target.value)}
            placeholder="Nome de exibição"
            className={`${inputCls} ${fieldError("nome")}`}
          />
        </div>
        {!isEditing ? (
          <>
            <div>
              <label className="text-[12px] text-slate-500 pl-1">Login (usuário) *</label>
              <input
                type="text"
                value={form.login}
                onChange={(e) => handleChange("login", e.target.value)}
                placeholder="Identificador de entrada"
                className={`${inputCls} ${fieldError("login")}`}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-[12px] text-slate-500 pl-1">Senha inicial *</label>
              <input
                type="password"
                value={form.senha}
                onChange={(e) => handleChange("senha", e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className={`${inputCls} ${fieldError("senha")}`}
                autoComplete="new-password"
              />
            </div>
          </>
        ) : (
          <div>
            <label className="text-[12px] text-slate-500 pl-1">Nova senha (opcional)</label>
            <input
              type="password"
              value={form.nova_senha}
              onChange={(e) => handleChange("nova_senha", e.target.value)}
              placeholder="Deixe em branco para manter"
              className={`${inputCls} ${fieldError("nova_senha")}`}
              autoComplete="new-password"
            />
          </div>
        )}
        {isEditing ? (
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => handleChange("ativo", e.target.checked)}
              className="rounded border-slate-300"
            />
            Conta ativa (desmarcado impede login)
          </label>
        ) : null}
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 text-xs px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="h-8 text-xs px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isEditing ? "Salvar conta" : "Criar conta"}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
