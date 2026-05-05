import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Plus, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const FIELD_TYPES = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "textarea", label: "Texto longo" },
];

const slugifyFieldName = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export default function ConfiguracaoPesagens() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [formData, setFormData] = useState({
    label: "",
    field_name: "",
    tipo: "text",
    obrigatorio: false,
    col_span: 6,
    section_id: "geral",
    comportamento: "manual",
    entidade_origem: "",
    tela_origem: "",
    coluna_origem: "",
    tipo_soma: "sum",
    campos_soma: "",
  });

  const { data: currentUser } = useQuery({
    queryKey: ["current-user-config-pesagens"],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
  });

  const { data = {}, isLoading } = useQuery({
    queryKey: ["configuracao-pesagens", empresaSelecionadaId, currentUser?.email],
    queryFn: async () => {
      const [layouts, secoes, campos, personalizados] = await Promise.all([
        base44.entities.LayoutConfiguracao.filter({ tela: "Pesagens" }),
        base44.entities.LayoutSecao.list("ordem"),
        base44.entities.LayoutCampo.filter({ entity_name: "Pesagem" }, "ordem"),
        base44.entities.CampoPersonalizado.filter({ entity_name: "Pesagem" }, "label"),
      ]);

      const layout =
        layouts.find((l) => l.ativo !== false && l.escopo === "usuario" && l.user_email === currentUser?.email) ||
        layouts.find((l) => l.ativo !== false && l.escopo === "empresa" && l.empresa_id === empresaSelecionadaId) ||
        layouts.find((l) => l.ativo !== false && l.escopo === "sistema") ||
        layouts[0];

      const layoutSecoes = layout ? secoes.filter((s) => s.layout_id === layout.id && s.ativo !== false) : [];
      const layoutCampos = layout ? campos.filter((c) => c.layout_id === layout.id) : [];
      const secoesComPadrao = layoutSecoes.length ? layoutSecoes : [{ section_id: "geral", titulo: "Dados Gerais", ordem: 1 }];

      return { layout, secoes: secoesComPadrao, campos: layoutCampos, personalizados };
    },
    enabled: !!empresaSelecionadaId && !!currentUser?.email,
  });

  const selectedSectionId = formData.section_id || data.secoes?.[0]?.section_id || "geral";

  const customFieldsWithLayout = useMemo(() => {
    return (data.personalizados || []).map((field) => ({
      ...field,
      layoutCampo: (data.campos || []).find((campo) => campo.field_name === field.field_name && campo.origem === "customizado"),
    }));
  }, [data.personalizados, data.campos]);

  const createFieldMutation = useMutation({
    mutationFn: async () => {
      if (!formData.label.trim()) throw new Error("Informe o nome do campo.");

      let layout = data.layout;
      if (!layout?.id) {
        layout = await base44.entities.LayoutConfiguracao.create({
          tela: "Pesagens",
          nome: "Layout de Pesagens",
          descricao: "Layout padrão da tela de pesagens",
          escopo: empresaSelecionadaId ? "empresa" : "sistema",
          empresa_id: empresaSelecionadaId,
          ativo: true,
        });
      }

      const existingSection = (data.secoes || []).find((secao) => secao.section_id === selectedSectionId && secao.layout_id === layout.id);
      if (!existingSection) {
        await base44.entities.LayoutSecao.create({
          layout_id: layout.id,
          section_id: selectedSectionId,
          titulo: selectedSectionId === "geral" ? "Dados Gerais" : selectedSectionId,
          ordem: 1,
          ativo: true,
        });
      }

      const fieldName = slugifyFieldName(formData.field_name || formData.label);
      const fieldId = `custom_${fieldName}`;
      const nextOrder = Math.max(0, ...(data.campos || []).filter((c) => c.section_id === selectedSectionId).map((c) => Number(c.ordem || 0))) + 1;
      const regras = {
        comportamento: formData.comportamento,
        origem: formData.comportamento === "manual" ? null : {
          entidade: formData.entidade_origem,
          tela: formData.tela_origem,
          coluna: formData.coluna_origem,
        },
        soma: formData.comportamento === "soma" ? {
          tipo: formData.tipo_soma,
          campos: formData.campos_soma.split(",").map((campo) => campo.trim()).filter(Boolean),
        } : null,
      };

      await base44.entities.CampoPersonalizado.create({
        entity_name: "Pesagem",
        field_id: fieldId,
        field_name: fieldName,
        label: formData.label.trim().toUpperCase(),
        tipo: formData.tipo,
        empresa_id: empresaSelecionadaId,
        ativo: true,
        regras,
      });

      await base44.entities.LayoutCampo.create({
        layout_id: layout.id,
        section_id: selectedSectionId,
        field_id: fieldId,
        entity_name: "Pesagem",
        field_name: fieldName,
        origem: "customizado",
        label: formData.label.trim().toUpperCase(),
        tipo: formData.tipo,
        col_span: Number(formData.col_span || 6),
        ordem: nextOrder,
        obrigatorio: Boolean(formData.obrigatorio),
        ativo: true,
        uppercase: formData.tipo === "text" || formData.tipo === "textarea",
        regras,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuracao-pesagens"] });
      queryClient.invalidateQueries({ queryKey: ["layout-pesagens"] });
      setFormData({ label: "", field_name: "", tipo: "text", obrigatorio: false, col_span: 6, section_id: selectedSectionId, comportamento: "manual", entidade_origem: "", tela_origem: "", coluna_origem: "", tipo_soma: "sum", campos_soma: "" });
      toast.success("Campo personalizado criado!");
    },
    onError: (error) => toast.error(error.message || "Não foi possível salvar o campo."),
  });

  const toggleFieldMutation = useMutation({
    mutationFn: ({ campo, ativo }) => base44.entities.LayoutCampo.update(campo.id, { ativo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuracao-pesagens"] });
      queryClient.invalidateQueries({ queryKey: ["layout-pesagens"] });
      toast.success("Configuração atualizada!");
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Configuração de Pesagens</h1>
          <p className="text-xs text-slate-600">Configure campos personalizados e a exibição no formulário de pesagens.</p>
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate("/Pesagens")}>
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="rounded-xl border bg-card text-card-foreground shadow lg:col-span-1">
          <CardHeader className="py-3 px-4 border-b">
            <CardTitle className="text-sm flex items-center gap-2"><Plus className="w-4 h-4 text-emerald-600" /> Novo Campo</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="space-y-1">
              <Label className="text-xs uppercase">Nome exibido</Label>
              <Input className="h-8 text-xs uppercase" placeholder="EX: ORIGEM DA CARGA" value={formData.label} onChange={(e) => setFormData((prev) => ({ ...prev, label: e.target.value, field_name: slugifyFieldName(e.target.value) }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase">Chave do campo</Label>
              <Input className="h-8 text-xs" value={formData.field_name} onChange={(e) => setFormData((prev) => ({ ...prev, field_name: slugifyFieldName(e.target.value) }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs uppercase">Tipo</Label>
                <Select value={formData.tipo} onValueChange={(value) => setFormData((prev) => ({ ...prev, tipo: value }))}>
                  <SelectTrigger className="h-8 text-xs uppercase"><SelectValue /></SelectTrigger>
                  <SelectContent>{FIELD_TYPES.map((type) => <SelectItem key={type.value} value={type.value} className="text-xs uppercase">{type.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase">Tamanho</Label>
                <Select value={String(formData.col_span)} onValueChange={(value) => setFormData((prev) => ({ ...prev, col_span: Number(value) }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4" className="text-xs">1/3</SelectItem>
                    <SelectItem value="6" className="text-xs">1/2</SelectItem>
                    <SelectItem value="12" className="text-xs">Linha inteira</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase">Seção</Label>
              <Select value={selectedSectionId} onValueChange={(value) => setFormData((prev) => ({ ...prev, section_id: value }))}>
                <SelectTrigger className="h-8 text-xs uppercase"><SelectValue /></SelectTrigger>
                <SelectContent>{(data.secoes || [{ section_id: "geral", titulo: "Dados Gerais" }]).map((secao) => <SelectItem key={secao.section_id} value={secao.section_id} className="text-xs uppercase">{secao.titulo || secao.section_id}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500">Seção é o bloco onde o campo aparece no formulário.</p>
            </div>

            <div className="space-y-1 border rounded-lg p-3 bg-slate-50">
              <Label className="text-xs uppercase">Comportamento do campo</Label>
              <Select value={formData.comportamento} onValueChange={(value) => setFormData((prev) => ({ ...prev, comportamento: value }))}>
                <SelectTrigger className="h-8 text-xs uppercase"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual" className="text-xs uppercase">Manual</SelectItem>
                  <SelectItem value="selecao" className="text-xs uppercase">Seleção de registro</SelectItem>
                  <SelectItem value="soma" className="text-xs uppercase">Soma / cálculo</SelectItem>
                </SelectContent>
              </Select>

              {formData.comportamento !== "manual" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2">
                  <Input className="h-8 text-xs uppercase" placeholder="ENTIDADE ORIGEM" value={formData.entidade_origem} onChange={(e) => setFormData((prev) => ({ ...prev, entidade_origem: e.target.value }))} />
                  <Input className="h-8 text-xs uppercase" placeholder="PÁGINA/TELA ORIGEM" value={formData.tela_origem} onChange={(e) => setFormData((prev) => ({ ...prev, tela_origem: e.target.value }))} />
                  <Input className="h-8 text-xs uppercase" placeholder="COLUNA ORIGEM" value={formData.coluna_origem} onChange={(e) => setFormData((prev) => ({ ...prev, coluna_origem: e.target.value }))} />
                </div>
              )}

              {formData.comportamento === "soma" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
                  <Select value={formData.tipo_soma} onValueChange={(value) => setFormData((prev) => ({ ...prev, tipo_soma: value }))}>
                    <SelectTrigger className="h-8 text-xs uppercase"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sum" className="text-xs uppercase">Somar</SelectItem>
                      <SelectItem value="avg" className="text-xs uppercase">Média</SelectItem>
                      <SelectItem value="count" className="text-xs uppercase">Contar</SelectItem>
                      <SelectItem value="min" className="text-xs uppercase">Menor</SelectItem>
                      <SelectItem value="max" className="text-xs uppercase">Maior</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input className="h-8 text-xs" placeholder="campos que somam, separados por vírgula" value={formData.campos_soma} onChange={(e) => setFormData((prev) => ({ ...prev, campos_soma: e.target.value }))} />
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <Checkbox checked={formData.obrigatorio} onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, obrigatorio: Boolean(checked) }))} />
              Campo obrigatório
            </label>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 w-full" disabled={createFieldMutation.isPending || isLoading} onClick={() => createFieldMutation.mutate()}>
              <Save className="w-3.5 h-3.5" /> Salvar Campo
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-xl border bg-card text-card-foreground shadow lg:col-span-2">
          <CardHeader className="py-3 px-4 border-b">
            <CardTitle className="text-sm">Campos Personalizados de Pesagens</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs py-2 px-3">Ativo</TableHead>
                  <TableHead className="text-xs py-2 px-3">Campo</TableHead>
                  <TableHead className="text-xs py-2 px-3">Tipo</TableHead>
                  <TableHead className="text-xs py-2 px-3">Comportamento</TableHead>
                  <TableHead className="text-xs py-2 px-3">Seção</TableHead>
                  <TableHead className="text-xs py-2 px-3 text-right">Tamanho</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customFieldsWithLayout.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-xs text-slate-400">Nenhum campo personalizado criado.</TableCell></TableRow>
                ) : customFieldsWithLayout.map((field) => (
                  <TableRow key={field.id} className="hover:bg-gray-50">
                    <TableCell className="text-xs py-2 px-3">
                      <Checkbox checked={field.layoutCampo?.ativo !== false} disabled={!field.layoutCampo} onCheckedChange={(checked) => toggleFieldMutation.mutate({ campo: field.layoutCampo, ativo: Boolean(checked) })} />
                    </TableCell>
                    <TableCell className="text-xs py-2 px-3 font-medium uppercase">{field.label}</TableCell>
                    <TableCell className="text-xs py-2 px-3 uppercase">{field.tipo}</TableCell>
                    <TableCell className="text-xs py-2 px-3 uppercase">{field.regras?.comportamento || "manual"}</TableCell>
                    <TableCell className="text-xs py-2 px-3 uppercase">{field.layoutCampo?.section_id || "-"}</TableCell>
                    <TableCell className="text-xs py-2 px-3 text-right font-mono">{field.layoutCampo?.col_span || "-"}/12</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}