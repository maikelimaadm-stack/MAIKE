import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DescontosPersonalizados from "./DescontosPersonalizados";

const formatBRL = (n) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n||0));

export default function FichaFuncionario() {
  const empresaId = typeof window !== 'undefined' ? localStorage.getItem('empresa_selecionada_id') : null;
  const { data: funcionarios = [] } = useQuery({
    queryKey: ['folha-funcionarios', empresaId],
    queryFn: async () => {
      const all = await base44.entities.FolhaFuncionario.list();
      return all.filter(f => !empresaId || f.empresa_id === empresaId);
    }
  });
  const { data: cfgs = [] } = useQuery({
    queryKey: ['folha-config', empresaId],
    queryFn: async () => {
      const all = await base44.entities.FolhaConfiguracao.list();
      return all.filter(c => !empresaId || c.empresa_id === empresaId);
    }
  });

  const cfg = React.useMemo(() => {
    const c = cfgs[0] || {};
    return {
      jornada: c.jornada_padrao || 220,
      adicionalNoturno: c.adicional_noturno_percentual ?? 0.2,
      fgts: c.fgts_percentual ?? 0.08,
      vtMax: c.vt_percentual_max ?? 0.06,
      irrfDependente: c.irrf_deducao_dependente ?? 189.59,
      inss: c.inss_tabela?.length ? c.inss_tabela : [
        { ate: 1320, aliquota: 0.075 },
        { ate: 2571.29, aliquota: 0.09 },
        { ate: 3856.94, aliquota: 0.12 },
        { ate: 7507.49, aliquota: 0.14 }
      ],
      irrf: c.irrf_tabela?.length ? c.irrf_tabela : [
        { ate: 2112.00, aliquota: 0.0, deducao: 0 },
        { ate: 2826.65, aliquota: 0.075, deducao: 158.40 },
        { ate: 3751.05, aliquota: 0.15, deducao: 370.40 },
        { ate: 4664.68, aliquota: 0.225, deducao: 651.73 },
        { ate: null, aliquota: 0.275, deducao: 884.96 }
      ],
    };
  }, [cfgs]);

  const [form, setForm] = React.useState({
    funcionarioId: '', mes: String(new Date().getMonth()+1).padStart(2,'0'), ano: String(new Date().getFullYear()),
    he50: 0, he100: 0, horasNoturnas: 0, comissao: 0, bonificacao: 0,
    descontosPerso: [], status: 'Aberta'
  });

  const funcionario = funcionarios.find(f => f.id === form.funcionarioId) || null;
  const valorHora = funcionario ? Number(funcionario.salario_base || 0) / Number(funcionario.jornada_mensal || cfg.jornada) : 0;

  const calcINSS = (base) => {
    let restante = base; let anterior = 0; let total = 0;
    for (const faixa of cfg.inss) {
      const limite = faixa.ate ?? Infinity;
      const parcela = Math.max(Math.min(restante, limite - anterior), 0);
      if (parcela <= 0) break;
      total += parcela * (faixa.aliquota || 0);
      anterior = limite;
      restante = base - anterior;
      if (!isFinite(limite)) break;
    }
    return Math.max(0, Math.min(total, base));
  };

  const calcIRRF = (base) => {
    const faixa = cfg.irrf.find(f => f.ate === null || base <= f.ate) || cfg.irrf[cfg.irrf.length - 1];
    const imposto = base * (faixa.aliquota || 0) - (faixa.deducao || 0);
    return Math.max(0, imposto);
  };

  const proventosBase = funcionario ? Number(funcionario.salario_base || 0) : 0;
  const vHE50 = valorHora * Number(form.he50 || 0) * 1.5;
  const vHE100 = valorHora * Number(form.he100 || 0) * 2;
  const vNoturno = valorHora * Number(form.horasNoturnas || 0) * Number(cfg.adicionalNoturno || 0);
  const vComissao = Number(form.comissao || 0);
  const vBonus = Number(form.bonificacao || 0);
  const proventos = proventosBase + vHE50 + vHE100 + vNoturno + vComissao + vBonus;

  const totalPerso = (form.descontosPerso||[]).reduce((s, d) => s + Number(d.valor||0), 0);
  const baseINSS = Math.max(0, proventos);
  const inss = calcINSS(baseINSS);
  const baseIR = Math.max(0, baseINSS - inss - (funcionario?.dependentes_irrf||0) * cfg.irrfDependente);
  const irrf = calcIRRF(baseIR);
  const descontos = totalPerso + inss + irrf;
  const liquido = proventos - descontos;
  const fgts = Number(cfg.fgts || 0) * proventos;

  const queryClient = useQueryClient();
  const { data: fichaExistente } = useQuery({
    queryKey: ['folha-ficha', form.funcionarioId, form.mes, form.ano, empresaId || 'sem-empresa'],
    queryFn: async () => {
      if (!form.funcionarioId) return null;
      try {
        const where = { funcionario_id: form.funcionarioId, mes: form.mes, ano: form.ano };
        if (empresaId) where.empresa_id = empresaId;
        const res = await base44.entities.FolhaFicha.filter(where);
        return Array.isArray(res) && res.length ? res[0] : null;
      } catch { return null; }
    },
    enabled: !!form.funcionarioId,
  });

  React.useEffect(() => {
    if (fichaExistente) {
      setForm((prev) => ({
        ...prev,
        descontosPerso: fichaExistente.descontos_personalizados || [],
        status: fichaExistente.status || 'Aberta'
      }));
    } else {
      setForm((prev) => ({ ...prev, descontosPerso: [], status: 'Aberta' }));
    }
  }, [fichaExistente?.id]);

  const salvarMut = useMutation({
    mutationFn: async () => {
      const empId = empresaId || funcionario?.empresa_id || null;
      const payload = {
        empresa_id: empId,
        funcionario_id: form.funcionarioId,
        mes: form.mes,
        ano: form.ano,
        status: form.status,
        proventos: {
          salario_base: proventosBase,
          he50_horas: form.he50,
          he100_horas: form.he100,
          horas_noturnas: form.horasNoturnas,
          comissao: form.comissao,
          bonificacao: form.bonificacao,
          valor_hora: valorHora,
          total_proventos: proventos,
        },
        descontos_personalizados: form.descontosPerso,
        inss, irrf, fgts,
        totais: { total_descontos: descontos, liquido },
      };
      if (fichaExistente?.id) return base44.entities.FolhaFicha.update(fichaExistente.id, payload);
      return base44.entities.FolhaFicha.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folha-ficha'] });
    }
  });

  const fecharMut = useMutation({
    mutationFn: async () => {
      if (!fichaExistente?.id) return;
      return base44.entities.FolhaFicha.update(fichaExistente.id, { status: 'Fechada' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folha-ficha'] });
    }
  });

  const disabled = form.status === 'Fechada';

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">Ficha Mensal por Funcionário</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="md:col-span-2">
            <Label className="text-xs">Funcionário</Label>
            <Select value={form.funcionarioId} onValueChange={v=>setForm({...form, funcionarioId: v})} disabled={disabled}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {funcionarios.map(f=> (
                  <SelectItem key={f.id} value={f.id} className="text-xs">{f.nome_completo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Mês</Label>
            <Input className="h-8 text-xs" value={form.mes} onChange={e=>setForm({...form, mes: e.target.value})} disabled={disabled} />
          </div>
          <div>
            <Label className="text-xs">Ano</Label>
            <Input className="h-8 text-xs" value={form.ano} onChange={e=>setForm({...form, ano: e.target.value})} disabled={disabled} />
          </div>
          <div>
            <Label className="text-xs">HE 50% (h)</Label>
            <Input type="number" className="h-8 text-xs" value={form.he50} onChange={e=>setForm({...form, he50: parseFloat(e.target.value||'0')})} disabled={disabled} />
          </div>
          <div>
            <Label className="text-xs">HE 100% (h)</Label>
            <Input type="number" className="h-8 text-xs" value={form.he100} onChange={e=>setForm({...form, he100: parseFloat(e.target.value||'0')})} disabled={disabled} />
          </div>
          <div>
            <Label className="text-xs">Noturno (h)</Label>
            <Input type="number" className="h-8 text-xs" value={form.horasNoturnas} onChange={e=>setForm({...form, horasNoturnas: parseFloat(e.target.value||'0')})} disabled={disabled} />
          </div>
          <div>
            <Label className="text-xs">Comissão (R$)</Label>
            <Input type="number" className="h-8 text-xs" value={form.comissao} onChange={e=>setForm({...form, comissao: parseFloat(e.target.value||'0')})} disabled={disabled} />
          </div>
          <div>
            <Label className="text-xs">Bônus (R$)</Label>
            <Input type="number" className="h-8 text-xs" value={form.bonificacao} onChange={e=>setForm({...form, bonificacao: parseFloat(e.target.value||'0')})} disabled={disabled} />
          </div>
        </div>

        <DescontosPersonalizados value={form.descontosPerso} onChange={(v)=>setForm({...form, descontosPerso: v})} disabled={disabled} />

        {funcionario && (
          <div className="overflow-x-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="text-xs font-bold py-1 border border-black">Descrição</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Salário base</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL(proventosBase)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">HE 50%</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL(vHE50)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">HE 100%</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL(vHE100)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Adicional noturno</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL(vNoturno)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Comissão</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL(vComissao)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Bonificação</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL(vBonus)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50 bg-gray-200"><TableCell className="text-xs py-1 border border-gray-300 font-semibold">Total Proventos</TableCell><TableCell className="text-xs py-1 border border-gray-300 font-semibold">{formatBRL(proventos)}</TableCell></TableRow>
                {form.descontosPerso.map((d, idx)=> (
                  <TableRow key={idx} className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">{d.descricao}</TableCell><TableCell className="text-xs py-1 border border-gray-300">-{formatBRL(d.valor)}</TableCell></TableRow>
                ))}
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">INSS</TableCell><TableCell className="text-xs py-1 border border-gray-300">-{formatBRL(inss)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">IRRF</TableCell><TableCell className="text-xs py-1 border border-gray-300">-{formatBRL(irrf)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50 bg-gray-200"><TableCell className="text-xs py-1 border border-gray-300 font-semibold">Total Descontos</TableCell><TableCell className="text-xs py-1 border border-gray-300 font-semibold">-{formatBRL(descontos)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50 bg-emerald-50"><TableCell className="text-xs py-1 border border-gray-300 font-semibold">Salário Líquido</TableCell><TableCell className="text-xs py-1 border border-gray-300 font-semibold">{formatBRL(liquido)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">FGTS (informativo)</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL(fgts)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex items-center gap-2 justify-end">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>window.location.reload()}>Limpar</Button>
          <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={()=>salvarMut.mutate()} disabled={!funcionario || disabled}>Salvar</Button>
          <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={()=>fecharMut.mutate()} disabled={!fichaExistente?.id || disabled}>Fechar Ficha</Button>
        </div>
      </CardContent>
    </Card>
  );
}