import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutPanelTop, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import loteRepository from "@/core/repositories/loteRepository";

export default function ConfiguracaoLayoutLoteDialog({ open, onOpenChange, inline = false }) {
  const queryClient = useQueryClient();
  const [selectedSectionId, setSelectedSectionId] = useState("geral");
  const [newTabName, setNewTabName] = useState("");

  const { data: sections = [] } = useQuery({
    queryKey: ["lote-layout-sections"],
    queryFn: () => loteRepository.listLayoutSections(),
    enabled: open,
    initialData: []
  });

  const { data: campos = [] } = useQuery({
    queryKey: ["lote-layout-campos"],
    queryFn: () => loteRepository.listCamposLayout(),
    enabled: open,
    initialData: []
  });

  const selectedSection = sections.find((secao) => secao.section_id === selectedSectionId) || sections.find((secao) => secao.section_id !== "principal") || sections[0];
  const camposDaSecao = useMemo(() => campos.filter((campo) => campo.section_id === selectedSection?.section_id).sort((a, b) => (a.ordem || 0) - (b.ordem || 0)), [campos, selectedSection]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lote-layout-sections"] }),
      queryClient.invalidateQueries({ queryKey: ["lote-layout-campos"] }),
      queryClient.invalidateQueries({ queryKey: ["lote-campos-layout"] }),
      queryClient.invalidateQueries({ queryKey: ["lote-campos-personalizados"] })
    ]);
  };

  const updateSectionMutation = useMutation({ mutationFn: ({ id, data }) => loteRepository.updateLayoutSection(id, data), onSuccess: invalidate });
  const createSectionMutation = useMutation({ mutationFn: (data) => loteRepository.createLayoutSection(data), onSuccess: async (secao) => { setSelectedSectionId(secao.section_id); setNewTabName(""); await invalidate(); toast.success("Aba criada."); } });
  const updateCampoMutation = useMutation({ mutationFn: ({ id, data }) => loteRepository.updateCampoLayout(id, data), onSuccess: invalidate });

  const handleCreateTab = () => {
    const titulo = newTabName.trim().toUpperCase();
    if (!titulo) return toast.error("Informe o nome da nova aba.");
    createSectionMutation.mutate({ titulo });
  };

  const moveSection = (secao, direction) => {
    const editable = sections.filter((item) => item.section_id !== "principal");
    const index = editable.findIndex((item) => item.id === secao.id);
    const other = editable[index + direction];
    if (!other) return;
    updateSectionMutation.mutate({ id: secao.id, data: { ordem: other.ordem || 0 } });
    updateSectionMutation.mutate({ id: other.id, data: { ordem: secao.ordem || 0 } });
  };

  const moveCampo = (campo, direction) => {
    const index = camposDaSecao.findIndex((item) => item.id === campo.id);
    const other = camposDaSecao[index + direction];
    if (!other) return;
    updateCampoMutation.mutate({ id: campo.id, data: { ordem: other.ordem || 0 } });
    updateCampoMutation.mutate({ id: other.id, data: { ordem: campo.ordem || 0 } });
  };

  const updateCampo = (campo, data) => {
    if (campo.metadata?.protected_required && data.visivel_form === false) return toast.error("Este campo é obrigatório do sistema e não pode ser ocultado.");
    if (campo.metadata?.protected_required && data.obrigatorio === false) return toast.error("Este campo é obrigatório do sistema.");
    updateCampoMutation.mutate({ id: campo.id, data });
  };

  const content = (
    <div className="w-full h-full overflow-hidden flex flex-col bg-white">
      {!inline && <DialogHeader className="sr-only"><DialogTitle>Configurar layout do lote</DialogTitle></DialogHeader>}
      <div className="h-8 flex items-center gap-2 border-b border-slate-200 px-2 bg-white">
        <Button type="button" variant="outline" size="icon" className="h-7 w-8 rounded-none" onClick={() => onOpenChange(false)}><X className="w-3.5 h-3.5" /></Button>
        <Badge className="bg-slate-600 text-white rounded-sm">LAYOUT</Badge>
        <span className="text-xs font-semibold text-slate-700 uppercase">Configuração de abas e campos do Cadastro de Lotes</span>
      </div>

      <div className="grid grid-cols-[280px_minmax(0,1fr)] flex-1 min-h-0">
        <aside className="border-r border-slate-200 bg-slate-50 flex flex-col min-h-0">
          <div className="p-2 border-b border-slate-200 bg-white space-y-2">
            <div className="text-xs font-semibold text-slate-700 uppercase flex items-center gap-2"><LayoutPanelTop className="w-4 h-4" /> Abas/Painéis</div>
            <div className="flex gap-1">
              <Input value={newTabName} onChange={(e) => setNewTabName(e.target.value)} placeholder="NOVA ABA" className="h-7 text-xs uppercase" />
              <Button type="button" size="sm" className="h-7 px-2" onClick={handleCreateTab}><Plus className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
          <div className="overflow-auto flex-1 p-2 space-y-1">
            {sections.map((secao) => {
              const selected = selectedSection?.section_id === secao.section_id;
              return (
                <button key={secao.id || secao.section_id} type="button" onClick={() => setSelectedSectionId(secao.section_id)} className={`w-full flex items-center gap-2 px-2 py-2 border text-left text-xs ${selected ? "bg-green-500 text-white border-green-600" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"}`}>
                  <span className="flex-1 truncate font-medium uppercase">{secao.titulo}</span>
                  {secao.section_id === "principal" && <Badge variant="secondary" className="text-[10px]">fixo</Badge>}
                </button>
              );
            })}
          </div>
          {selectedSection && selectedSection.section_id !== "principal" && (
            <div className="p-2 border-t border-slate-200 bg-white space-y-2">
              <Input value={selectedSection.titulo || ""} onChange={(e) => updateSectionMutation.mutate({ id: selectedSection.id, data: { titulo: e.target.value.toUpperCase() } })} className="h-7 text-xs uppercase" />
              <div className="grid grid-cols-2 gap-1">
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => moveSection(selectedSection, -1)}><ArrowUp className="w-3 h-3" /> Subir</Button>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => moveSection(selectedSection, 1)}><ArrowDown className="w-3 h-3" /> Descer</Button>
              </div>
            </div>
          )}
        </aside>

        <main className="min-w-0 flex flex-col min-h-0 bg-white">
          <div className="h-9 px-3 border-b border-slate-200 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-700 uppercase">Campos em: {selectedSection?.titulo || "Selecione uma aba"}</div>
            <div className="text-[11px] text-slate-500">Mova campos entre abas, altere ordem, visibilidade e obrigatoriedade.</div>
          </div>
          <div className="overflow-auto flex-1">
            <Table className="min-w-[920px] border-separate border-spacing-0 table-fixed">
              <TableHeader>
                <TableRow className="bg-white sticky top-0 z-10">
                  <TableHead className="h-7 text-xs border-r border-b w-[260px]">Campo</TableHead>
                  <TableHead className="h-7 text-xs border-r border-b w-[140px]">Origem</TableHead>
                  <TableHead className="h-7 text-xs border-r border-b w-[220px]">Aba</TableHead>
                  <TableHead className="h-7 text-xs border-r border-b w-[110px] text-center">Visível</TableHead>
                  <TableHead className="h-7 text-xs border-r border-b w-[130px] text-center">Obrigatório</TableHead>
                  <TableHead className="h-7 text-xs border-r border-b w-[130px] text-center">Ordem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {camposDaSecao.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-xs text-slate-400 border-b">Nenhum campo nesta aba.</TableCell></TableRow>
                ) : camposDaSecao.map((campo) => (
                  <TableRow key={campo.id || campo.field_id} className="hover:bg-slate-50">
                    <TableCell className="px-2 py-1 text-xs border-r border-b font-medium text-slate-700">{campo.label}</TableCell>
                    <TableCell className="px-2 py-1 text-xs border-r border-b"><Badge variant={campo.origem === "fixo" ? "secondary" : "outline"} className="text-[10px]">{campo.origem === "fixo" ? "Fixo" : "Personalizado"}</Badge></TableCell>
                    <TableCell className="px-2 py-1 text-xs border-r border-b">
                      <Select value={campo.section_id} onValueChange={(value) => updateCampo(campo, { section_id: value, ordem: 999 })}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {sections.filter((secao) => secao.ativo !== false).map((secao) => <SelectItem key={secao.section_id} value={secao.section_id} className="text-xs">{secao.titulo}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-xs border-r border-b text-center">
                      <button type="button" onClick={() => updateCampo(campo, { visivel_form: campo.visivel_form === false })} className="inline-flex items-center gap-1 text-xs text-slate-700">
                        {campo.visivel_form === false ? <EyeOff className="w-4 h-4 text-slate-400" /> : <Eye className="w-4 h-4 text-green-600" />}
                      </button>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-xs border-r border-b text-center"><Switch checked={!!campo.obrigatorio} onCheckedChange={(checked) => updateCampo(campo, { obrigatorio: checked })} /></TableCell>
                    <TableCell className="px-2 py-1 text-xs border-r border-b text-center">
                      <div className="inline-flex gap-1">
                        <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => moveCampo(campo, -1)}><ArrowUp className="w-3 h-3" /></Button>
                        <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => moveCampo(campo, 1)}><ArrowDown className="w-3 h-3" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </main>
      </div>
    </div>
  );

  if (inline) return open ? content : null;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="!fixed !inset-0 !left-0 !top-0 !translate-x-0 !translate-y-0 !w-screen !max-w-none !h-screen !max-h-none overflow-hidden flex flex-col !p-0 !rounded-none">{content}</DialogContent></Dialog>;
}