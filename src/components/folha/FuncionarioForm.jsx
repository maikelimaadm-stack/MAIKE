import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function FuncionarioForm({ open, onClose, initialData, onSaved }) {
  const queryClient = useQueryClient();
  const empresaId = typeof window !== 'undefined' ? localStorage.getItem('empresa_selecionada_id') : null;

  const [form, setForm] = React.useState(() => initialData || {
    empresa_id: empresaId || null,
    nome_completo: "",
    cpf: "",
    cargo: "",
    salario_base: 0,
    tipo_contrato: "CLT",
    jornada_mensal: 220,
    dependentes_irrf: 0,
    data_admissao: "",
    status: "Ativo",
    dados_bancarios: { banco: "", agencia: "", conta: "", pix: "", tipo_conta: "" }
  });

  React.useEffect(() => {
    setForm(prev => ({ ...prev, ...(initialData || {}), empresa_id: empresaId || prev.empresa_id }));
  }, [initialData, empresaId]);

  const createMut = useMutation({
    mutationFn: (data) => base44.entities.FolhaFuncionario.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['folha-funcionarios'] }); onSaved?.(); }
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FolhaFuncionario.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['folha-funcionarios'] }); onSaved?.(); }
  });

  const salvar = async () => {
    if (!form.nome_completo || !form.cpf || !form.salario_base) return;
    if (initialData?.id) await updateMut.mutateAsync({ id: initialData.id, data: form });
    else await createMut.mutateAsync(form);
    onClose?.();
  };

  const maskCPF = (v) => v.replace(/\D/g, '')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{initialData ? 'Editar Funcionário' : 'Novo Funcionário'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Nome completo</Label>
            <Input className="h-8 text-xs" value={form.nome_completo} onChange={e=>setForm({...form, nome_completo: e.target.value})} />
          </div>
          <div>
            <Label className="text-xs">CPF</Label>
            <Input className="h-8 text-xs" value={maskCPF(form.cpf)} onChange={e=>setForm({...form, cpf: e.target.value})} />
          </div>
          <div>
            <Label className="text-xs">Cargo</Label>
            <Input className="h-8 text-xs" value={form.cargo} onChange={e=>setForm({...form, cargo: e.target.value})} />
          </div>
          <div>
            <Label className="text-xs">Salário base</Label>
            <Input type="number" className="h-8 text-xs" value={form.salario_base} onChange={e=>setForm({...form, salario_base: parseFloat(e.target.value||'0')})} />
          </div>
          <div>
            <Label className="text-xs">Tipo de contrato</Label>
            <Select value={form.tipo_contrato} onValueChange={v=>setForm({...form, tipo_contrato: v})}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CLT" className="text-xs">CLT</SelectItem>
                <SelectItem value="Autonomo" className="text-xs">Autônomo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Jornada mensal (h)</Label>
            <Input type="number" className="h-8 text-xs" value={form.jornada_mensal} onChange={e=>setForm({...form, jornada_mensal: parseFloat(e.target.value||'0')})} />
          </div>
          <div>
            <Label className="text-xs">Dependentes IRRF</Label>
            <Input type="number" className="h-8 text-xs" value={form.dependentes_irrf} onChange={e=>setForm({...form, dependentes_irrf: parseInt(e.target.value||'0',10)})} />
          </div>
          <div>
            <Label className="text-xs">Data de admissão</Label>
            <Input type="date" className="h-8 text-xs" value={form.data_admissao||''} onChange={e=>setForm({...form, data_admissao: e.target.value})} />
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v=>setForm({...form, status: v})}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Ativo" className="text-xs">Ativo</SelectItem>
                <SelectItem value="Inativo" className="text-xs">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Banco</Label>
              <Input className="h-8 text-xs" value={form.dados_bancarios?.banco||''} onChange={e=>setForm({...form, dados_bancarios: {...form.dados_bancarios, banco: e.target.value}})} />
            </div>
            <div>
              <Label className="text-xs">Agência</Label>
              <Input className="h-8 text-xs" value={form.dados_bancarios?.agencia||''} onChange={e=>setForm({...form, dados_bancarios: {...form.dados_bancarios, agencia: e.target.value}})} />
            </div>
            <div>
              <Label className="text-xs">Conta</Label>
              <Input className="h-8 text-xs" value={form.dados_bancarios?.conta||''} onChange={e=>setForm({...form, dados_bancarios: {...form.dados_bancarios, conta: e.target.value}})} />
            </div>
            <div>
              <Label className="text-xs">PIX</Label>
              <Input className="h-8 text-xs" value={form.dados_bancarios?.pix||''} onChange={e=>setForm({...form, dados_bancarios: {...form.dados_bancarios, pix: e.target.value}})} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Cancelar</Button>
          <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={salvar}>Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}