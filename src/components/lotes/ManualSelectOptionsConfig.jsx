import React from "react";

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-[190px_minmax(0,1fr)] items-start gap-1">
      <label className="text-[12px] text-slate-600 text-right leading-none pt-1">{label}:</label>
      <div className="min-h-[92px] border border-slate-300 bg-white focus-within:border-green-500 transition-colors overflow-hidden [&_textarea]:rounded-none [&_textarea]:border-0 [&_textarea]:shadow-none [&_textarea]:focus-visible:ring-0">
        {children}
      </div>
    </div>
  );
}

export default function ManualSelectOptionsConfig({ form, updateForm }) {
  const protectedOptions = form.metadata?.protected_options || [];
  const handleChange = (event) => {
    const typedOptions = String(event.target.value || "").split("\n").map((item) => item.trim().toUpperCase()).filter(Boolean);
    const merged = [...new Set([...protectedOptions, ...typedOptions])].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })).join("\n");
    updateForm("options_text", merged);
  };

  return (
    <>
      <Field label="Opções da lista">
        <textarea
          value={form.options_text || ""}
          onChange={handleChange}
          placeholder="DIGITE UMA OPÇÃO POR LINHA"
          className="w-full min-h-[90px] resize-none bg-transparent px-2 py-1 text-xs uppercase outline-none"
          style={{ textTransform: "uppercase" }}
        />
      </Field>
      <div className="ml-[191px] border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-600">
        Cadastre as opções manualmente, uma por linha. Opções nativas/pré-cadastradas são protegidas e não podem ser removidas.
      </div>
    </>
  );
}