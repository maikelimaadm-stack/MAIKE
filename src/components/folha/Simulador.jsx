import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const defaults = {
  jornada: 220,
  adicionalNoturno: 0.2,
  fgts: 0.08,
  vtMax: 0.06,
  irrfDependente: 189.59,
  inss: [
    { ate: 1320, aliquota: 0.075 },
    { ate: 2571.29, aliquota: 0.09 },
    { ate: 3856.94, aliquota: 0.12 },
    { ate: 7507.49, aliquota: 0.14 }
  ],
  irrf: [
    { ate: 2112.00, aliquota: 0.0, deducao: 0 },
    { ate: 2826.65, aliquota: 0.075, deducao: 158.40 },
    { ate: 3751.05, aliquota: 0.15, deducao: 370.40 },
    { ate: 4664.68, aliquota: 0.225, deducao: 651.73 },
    { ate: null, aliquota: 0.275, deducao: 884.96 }
  ]
};

export default function Simulador() {
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
      jornada: c.jornada_padrao || defaults.jornada,
      adicionalNoturno: c.adicional_noturno_percentual ?? defaults.adicionalNoturno,
      fgts: c.fgts_percentual ?? defaults.fgts,
      vtMax: c.vt_percentual_max ?? defaults.vtMax,
      irrfDependente: c.irrf_deducao_dependente ?? defaults.irrfDependente,
      inss: c.inss_tabela?.length ? c.inss_tabela : defaults.inss,
      irrf: c.irrf_tabela?.length ? c.irrf_tabela : defaults.irrf,
    };
  }, [cfgs]);

  const [form, setForm] = React.useState({
    funcionarioId: '',
    mes: String(new Date().getMonth()+1).padStart(2,'0'),
    ano: String(new Date().getFullYear()),
    he50: 0,
    he100: 0,
    horasNoturnas: 0,
    comissao: 0,
    bonificacao: 0,
    faltasDias: 0,
    atrasosHoras: 0,
    aplicaVT: true,
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

  const vFaltas = (proventosBase / 30) * Number(form.faltasDias || 0);
  const vAtrasos = valorHora * Number(form.atrasosHoras || 0);
  const baseINSS = Math.max(0, proventos - vFaltas - vAtrasos);
  const inss = calcINSS(baseINSS);
  const dedDep = (funcionario?.dependentes_irrf || 0) * Number(cfg.irrfDependente || 0);
  const baseIR = Math.max(0, baseINSS - inss - dedDep);
  const irrf = calcIRRF(baseIR);
  const vt = form.aplicaVT ? Math.min(Number(cfg.vtMax || 0) * proventosBase, proventosBase) : 0;
  const descontos = vFaltas + vAtrasos + inss + irrf + vt;
  const liquido = proventos - descontos;
  const fgts = Number(cfg.fgts || 0) * proventos;

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">Simulador de Cálculo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="md:col-span-2">
            <Label className="text-xs">Funcionário</Label>
            <Select value={form.funcionarioId} onValueChange={v=>setForm({...form, funcionarioId: v})}>
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
            <Input className="h-8 text-xs" value={form.mes} onChange={e=>setForm({...form, mes: e.target.value})} />
          </div>
          <div>
            <Label className="text-xs">Ano</Label>
            <Input className="h-8 text-xs" value={form.ano} onChange={e=>setForm({...form, ano: e.target.value})} />
          </div>
          <div>
            <Label className="text-xs">HE 50% (h)</Label>
            <Input type="number" className="h-8 text-xs" value={form.he50} onChange={e=>setForm({...form, he50: parseFloat(e.target.value||'0')})} />
          </div>
          <div>
            <Label className="text-xs">HE 100% (h)</Label>
            <Input type="number" className="h-8 text-xs" value={form.he100} onChange={e=>setForm({...form, he100: parseFloat(e.target.value||'0')})} />
          </div>
          <div>
            <Label className="text-xs">Noturno (h)</Label>
            <Input type="number" className="h-8 text-xs" value={form.horasNoturnas} onChange={e=>setForm({...form, horasNoturnas: parseFloat(e.target.value||'0')})} />
          </div>
          <div>
            <Label className="text-xs">Comissão (R$)</Label>
            <Input type="number" className="h-8 text-xs" value={form.comissao} onChange={e=>setForm({...form, comissao: parseFloat(e.target.value||'0')})} />
          </div>
          <div>
            <Label className="text-xs">Bônus (R$)</Label>
            <Input type="number" className="h-8 text-xs" value={form.bonificacao} onChange={e=>setForm({...form, bonificacao: parseFloat(e.target.value||'0')})} />
          </div>
          <div>
            <Label className="text-xs">Faltas (dias)</Label>
            <Input type="number" className="h-8 text-xs" value={form.faltasDias} onChange={e=>setForm({...form, faltasDias: parseFloat(e.target.value||'0')})} />
          </div>
          <div>
            <Label className="text-xs">Atrasos (h)</Label>
            <Input type="number" className="h-8 text-xs" value={form.atrasosHoras} onChange={e=>setForm({...form, atrasosHoras: parseFloat(e.target.value||'0')})} />
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" size="sm" className={`h-8 text-xs ${form.aplicaVT? 'border-emerald-600 text-emerald-700':''}`} onClick={()=>setForm({...form, aplicaVT: !form.aplicaVT})}>
              {form.aplicaVT? 'VT aplicado (máx 6%)' : 'Sem VT'}
            </Button>
          </div>
        </div>

        {funcionario && (
          <div className="overflow-x-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="text-xs font-bold py-1 border border-black">Descrição</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Valor (R$)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Salário base</TableCell><TableCell className="text-xs py-1 border border-gray-300">{proventosBase.toFixed(2)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">HE 50%</TableCell><TableCell className="text-xs py-1 border border-gray-300">{vHE50.toFixed(2)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">HE 100%</TableCell><TableCell className="text-xs py-1 border border-gray-300">{vHE100.toFixed(2)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Adicional noturno</TableCell><TableCell className="text-xs py-1 border border-gray-300">{vNoturno.toFixed(2)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Comissão</TableCell><TableCell className="text-xs py-1 border border-gray-300">{vComissao.toFixed(2)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Bonificação</TableCell><TableCell className="text-xs py-1 border border-gray-300">{vBonus.toFixed(2)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50 bg-gray-200"><TableCell className="text-xs py-1 border border-gray-300 font-semibold">Total Proventos</TableCell><TableCell className="text-xs py-1 border border-gray-300 font-semibold">{proventos.toFixed(2)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Faltas</TableCell><TableCell className="text-xs py-1 border border-gray-300">-{vFaltas.toFixed(2)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Atrasos</TableCell><TableCell className="text-xs py-1 border border-gray-300">-{vAtrasos.toFixed(2)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">INSS</TableCell><TableCell className="text-xs py-1 border border-gray-300">-{inss.toFixed(2)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">IRRF</TableCell><TableCell className="text-xs py-1 border border-gray-300">-{irrf.toFixed(2)}</TableCell></TableRow>
                {form.aplicaVT && (
                  <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Vale Transporte (máx 6%)</TableCell><TableCell className="text-xs py-1 border border-gray-300">-{vt.toFixed(2)}</TableCell></TableRow>
                )}
                <TableRow className="hover:bg-gray-50 bg-gray-200"><TableCell className="text-xs py-1 border border-gray-300 font-semibold">Total Descontos</TableCell><TableCell className="text-xs py-1 border border-gray-300 font-semibold">-{descontos.toFixed(2)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50 bg-emerald-50"><TableCell className="text-xs py-1 border border-gray-300 font-semibold">Salário Líquido</TableCell><TableCell className="text-xs py-1 border border-gray-300 font-semibold">{liquido.toFixed(2)}</TableCell></TableRow>
                <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">FGTS (informativo)</TableCell><TableCell className="text-xs py-1 border border-gray-300">{fgts.toFixed(2)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </div>
        )}

        <div className="text-xs text-slate-600 space-y-1">
          <p><strong>INSS:</strong> desconto progressivo por faixas sobre a base (proventos - faltas - atrasos). </p>
          <p><strong>IRRF:</strong> calculado sobre (base INSS - INSS - dedução por dependentes), conforme tabela.</p>
          <p><strong>FGTS:</strong> 8% sobre o salário bruto (informativo; não descontado do funcionário).</p>
        </div>
      </CardContent>
    </Card>
  );
}