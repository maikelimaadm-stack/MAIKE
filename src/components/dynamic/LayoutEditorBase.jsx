import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { GripVertical } from "lucide-react";

export default function LayoutEditorBase({ config, onToggleField }) {
  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-slate-50 border-b border-slate-200 py-2 px-4">
        <CardTitle className="text-sm font-semibold text-slate-900">Editor de Layout</CardTitle>
      </CardHeader>
      <CardContent className="p-3 space-y-3">
        {config.sections.map((section) => (
          <div key={section.id} className="border rounded-lg p-2 space-y-2" data-section-id={section.id}>
            <p className="text-xs font-semibold uppercase text-slate-700">{section.title || section.id}</p>
            <div className="space-y-1">
              {section.fields.map((field) => (
                <div key={field.id} data-field-id={field.id} className="flex items-center gap-2 p-2 rounded border bg-white text-xs">
                  <GripVertical className="w-3.5 h-3.5 text-slate-400" />
                  <Checkbox checked={!field.hidden} onCheckedChange={() => onToggleField?.(field)} />
                  <span className="flex-1">{field.label}</span>
                  <span className="text-slate-500">{field.type}</span>
                  <span className="text-slate-500">{field.colSpan}/12</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}