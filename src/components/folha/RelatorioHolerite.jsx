import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Printer } from "lucide-react";

const formatBRL = (n) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n||0));

export default function RelatorioHolerite() {
  const empresaId = typeof window !== 'undefined' ? localStorage.getItem('empresa_selecionada_id') : null;
  const { data: funcionarios = [] } = useQuery({
    queryKey: ['folha-funcionarios', empresaId],
    queryFn: async () => {
      const all = await base44.entities.FolhaFuncionario.list();
      return all.filter(f => !empresaId || f.empresa_id === empresaId);
    }
  });

  const [form, setForm] = React.useState({ funcionarioId: '', mes: String(new Date().getMonth()+1).padStart(2,'0'), ano: String(new Date().getFullYear()) });

  const { data: ficha } = useQuery({
    queryKey: ['folha-ficha-rel', form.funcionarioId, form.mes, form.ano, empresaId || 'sem-empresa'],
    queryFn: async () => {
      if (!form.funcionarioId) return null;
      const where = { funcionario_id: form.funcionarioId, mes: form.mes, ano: form.ano };
      if (empresaId) where.empresa_id = empresaId;
      const res = await base44.entities.FolhaFicha.filter(where);
      return Array.isArray(res) && res.length ? res[0] : null;
    },
    enabled: !!form.funcionarioId,
  });

  const func = funcionarios.find(f => f.id === form.funcionarioId) || {};

  return (
    <Card>
      <CardHeader className="py-3 flex items-center justify-between">
        <CardTitle className="text-sm">Holerite Individual</CardTitle>
        <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={()=>window.print()}>
          <Printer className="w-3.5 h-3.5 mr-1.5" /> Imprimir
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 print:hidden">
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
        </div>

        {ficha ? (
          <div className="bg-white print-area">
            <div className="border-b-2 border-black pb-1 mb-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <h2 className="text-sm font-bold leading-tight">Holerite - {form.mes}/{form.ano}</h2>
                  <p className="text-xs text-slate-600">{func.nome_completo} • CPF: {func.cpf}</p>
                  <p className="text-xs text-slate-600">Cargo: {func.cargo || '-'} • Contrato: {func.tipo_contrato}</p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="text-xs font-bold py-1 border border-black">Descrição</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Proventos</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">Descontos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Salário base</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL(ficha.proventos?.salario_base)}</TableCell><TableCell className="text-xs py-1 border border-gray-300">-</TableCell></TableRow>
                  <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">HE 50%</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL((ficha.proventos?.valor_hora||0)*(ficha.proventos?.he50_horas||0)*1.5)}</TableCell><TableCell className="text-xs py-1 border border-gray-300">-</TableCell></TableRow>
                  <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">HE 100%</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL((ficha.proventos?.valor_hora||0)*(ficha.proventos?.he100_horas||0)*2)}</TableCell><TableCell className="text-xs py-1 border border-gray-300">-</TableCell></TableRow>
                  <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Adicional noturno</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL((ficha.proventos?.valor_hora||0)*(ficha.proventos?.horas_noturnas||0)*(0.2))}</TableCell><TableCell className="text-xs py-1 border border-gray-300">-</TableCell></TableRow>
                  <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Comissão</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL(ficha.proventos?.comissao)}</TableCell><TableCell className="text-xs py-1 border border-gray-300">-</TableCell></TableRow>
                  <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">Bonificação</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL(ficha.proventos?.bonificacao)}</TableCell><TableCell className="text-xs py-1 border border-gray-300">-</TableCell></TableRow>

                  {(ficha.descontos_personalizados||[]).map((d, idx)=> (
                    <TableRow key={idx} className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">{d.descricao}</TableCell><TableCell className="text-xs py-1 border border-gray-300">-</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL(d.valor)}</TableCell></TableRow>
                  ))}

                  <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">INSS</TableCell><TableCell className="text-xs py-1 border border-gray-300">-</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL(ficha.inss)}</TableCell></TableRow>
                  <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">IRRF</TableCell><TableCell className="text-xs py-1 border border-gray-300">-</TableCell><TableCell className="text-xs py-1 border border-gray-300">{formatBRL(ficha.irrf)}</TableCell></TableRow>

                  <TableRow className="hover:bg-gray-50 bg-gray-200"><TableCell className="text-xs py-1 border border-gray-300 font-semibold">Totais</TableCell><TableCell className="text-xs py-1 border border-gray-300 font-semibold">{formatBRL(ficha.proventos?.total_proventos)}</TableCell><TableCell className="text-xs py-1 border border-gray-300 font-semibold">{formatBRL(ficha.totais?.total_descontos)}</TableCell></TableRow>
                  <TableRow className="hover:bg-emerald-50"><TableCell className="text-xs py-1 border border-gray-300 font-semibold">Salário Líquido</TableCell><TableCell className="text-xs py-1 border border-gray-300 font-semibold" colSpan={2}>{formatBRL(ficha.totais?.liquido)}</TableCell></TableRow>
                  <TableRow className="hover:bg-gray-50"><TableCell className="text-xs py-1 border border-gray-300">FGTS (informativo)</TableCell><TableCell className="text-xs py-1 border border-gray-300" colSpan={2}>{formatBRL(ficha.fgts)}</TableCell></TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-500">Selecione funcionário/mês/ano e salve a ficha para gerar o holerite.</div>
        )}
      </CardContent>
    </Card>
  );
}