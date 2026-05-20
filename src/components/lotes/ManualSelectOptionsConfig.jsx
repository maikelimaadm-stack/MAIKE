import React, { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";

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

const normalizeOption = (value) => String(value || "").trim().toUpperCase();

export default function ManualSelectOptionsConfig({ form, updateForm }) {
  const protectedOptions = form.metadata?.protected_options || [];
  const protectedSet = useMemo(() => new Set(protectedOptions.map(normalizeOption)), [protectedOptions]);
  const editableOptionsText = useMemo(() => {
    return String(form.options_text || "")
      .split("\n")
      .map(normalizeOption)
      .filter((item) => item && !protectedSet.has(item))
      .join("\n");
  }, [form.options_text, protectedSet]);
  const [localOptionsText, setLocalOptionsText] = useState(editableOptionsText);

  useEffect(() => {
    setLocalOptionsText(editableOptionsText);
  }, [form.field_name, form.label]);

  const handleChange = (event) => {
    const value = event.target.value.toUpperCase();
    setLocalOptionsText(value);
    updateForm("options_text", value);
  };

  return (
    <>
      {protectedOptions.length > 0 && (
        <div className="ml-[191px] border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-600">
          <div className="mb-1 font-medium text-slate-700">Opções nativas protegidas:</div>
          <div className="flex flex-wrap gap-1">
            {protectedOptions.map((option) => <Badge key={option} variant="secondary" className="text-[10px]">{option}</Badge>)}
          </div>
        </div>
      )}
      <Field label="Novas opções">
        <textarea
          value={localOptionsText}
          onChange={handleChange}
          placeholder="DIGITE UMA OPÇÃO POR LINHA"
          className="w-full min-h-[90px] resize-none bg-transparent px-2 py-1 text-xs uppercase outline-none"
          style={{ textTransform: "uppercase" }}
        />
      </Field>
      {protectedOptions.length > 0 && (
        <div className="ml-[191px] border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-600">
          Digite uma opção por linha. As opções nativas ficam protegidas acima e serão mantidas automaticamente ao salvar.
        </div>
      )}
    </>
  );
}