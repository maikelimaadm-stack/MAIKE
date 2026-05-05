import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfigurableField from "./ConfigurableField";
import { applyFormRules } from "@/services/dynamicRulesEngine";

const fieldClassName = "h-8 text-xs";
const uppercaseClassName = "h-8 text-xs uppercase";

function getOptions(field, context) {
  if (typeof field.options === "function") return field.options(context) || [];
  if (field.optionsSource === "produtos") return (context.produtos || []).map((produto) => ({ value: produto.nome_produto, label: produto.nome_produto }));
  if (field.optionsSource === "fornecedores") return (context.fornecedores || []).map((fornecedor) => ({ value: fornecedor.nome, label: fornecedor.nome }));
  return field.options || [];
}

function renderFieldControl(field, formData, onChange, context) {
  const value = formData[field.name] ?? "";
  const commonProps = {
    value,
    required: field.required,
    disabled: field.disabled,
  };

  if (field.type === "select") {
    return (
      <Select value={String(value || "")} onValueChange={(selectedValue) => onChange(field.name, selectedValue)} required={field.required}>
        <SelectTrigger className={field.uppercase ? uppercaseClassName : fieldClassName} aria-invalid={field.required && !value ? "true" : undefined}>
          <SelectValue placeholder={field.placeholder || "SELECIONE"} />
        </SelectTrigger>
        <SelectContent>
          {getOptions(field, context).map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs uppercase">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === "textarea") {
    return (
      <Textarea
        {...commonProps}
        rows={field.rows || 2}
        placeholder={field.placeholder}
        onChange={(event) => onChange(field.name, event.target.value)}
        className="text-xs uppercase"
        style={field.uppercase ? { textTransform: "uppercase" } : undefined}
      />
    );
  }

  if (field.type === "readonlyNumber") {
    const numberValue = Number(value || 0);
    return (
      <Input
        value={numberValue.toFixed(field.decimals ?? 2)}
        readOnly
        className="h-8 text-xs font-semibold bg-slate-50"
      />
    );
  }

  return (
    <Input
      {...commonProps}
      aria-invalid={field.required && !value ? "true" : undefined}
      type={field.type || "text"}
      step={field.step}
      placeholder={field.placeholder}
      readOnly={field.readOnly}
      onChange={(event) => onChange(field.name, event.target.value)}
      className={field.uppercase ? uppercaseClassName : fieldClassName}
      style={field.uppercase ? { textTransform: "uppercase" } : undefined}
    />
  );
}

export default function ConfigurableForm({ config, formData, onChange, context = {} }) {
  const runtimeConfig = applyFormRules(config, formData);

  return (
    <div className="space-y-3">
      {runtimeConfig.sections.map((section) => (
        <section key={section.id} data-section-id={section.id} className={section.className || "space-y-2"}>
          {section.title && <h3 className="text-xs font-semibold uppercase text-slate-700">{section.title}</h3>}
          <div className="grid grid-cols-12 gap-3">
            {section.fields.map((field) => (
              <ConfigurableField key={field.id} field={field}>
                {renderFieldControl(field, formData, onChange, context)}
              </ConfigurableField>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}