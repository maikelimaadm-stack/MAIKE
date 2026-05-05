import React from "react";
import { Label } from "@/components/ui/label";

const COL_SPAN_CLASSES = {
  1: "col-span-12 md:col-span-1",
  2: "col-span-12 md:col-span-2",
  3: "col-span-12 md:col-span-3",
  4: "col-span-12 md:col-span-4",
  5: "col-span-12 md:col-span-5",
  6: "col-span-12 md:col-span-6",
  7: "col-span-12 md:col-span-7",
  8: "col-span-12 md:col-span-8",
  9: "col-span-12 md:col-span-9",
  10: "col-span-12 md:col-span-10",
  11: "col-span-12 md:col-span-11",
  12: "col-span-12",
};

export default function ConfigurableField({ field, children }) {
  const colSpan = Math.min(Math.max(Number(field.colSpan || 12), 1), 12);

  return (
    <div className={`${COL_SPAN_CLASSES[colSpan]} space-y-1`} data-field-id={field.id}>
      {field.label && (
        <Label className="text-xs uppercase text-slate-700">
          {field.label}
          {field.required && <span className="text-red-600 ml-0.5">*</span>}
        </Label>
      )}
      {children}
      {field.helpText && <p className="text-[10px] text-slate-500">{field.helpText}</p>}
    </div>
  );
}