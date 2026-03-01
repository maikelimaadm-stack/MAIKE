import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import FuncionarioForm from "./FuncionarioForm";

const formatBRL = (n) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n||0));

export default function FuncionariosTable() {
  const empresaId = typeof window !== 'undefined' ? localStorage.getItem('empresa_selecionada_id') : null;
  const { data: funcionarios = [], refetch } = useQuery({
    queryKey: ['folha-funcionarios', empresaId],
    queryFn: async () => {
      const all = await base44.entities.FolhaFuncionario.list();
      return all.filter(f => !empresaId || f.empresa_id === empresaId);
    }
  });

  const [open, setOpen] = React.useState(false);
  const [edit, setEdit] = React.useState(null);

  const maskCPF = (cpf) => cpf || '';

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Funcionários</CardTitle>
          <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={()=>{setEdit(null); setOpen(true);}}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Novo Funcionário
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="text-xs font-bold py-1 border border-black">Nome</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">CPF</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Cargo</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Salário</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Contrato</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Dep.</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Status</TableHead>
                <TableHead className="text-xs font-bold py-1 border border-black">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {funcionarios.map(f => (
                <TableRow key={f.id} className="hover:bg-gray-50">
                  <TableCell className="text-xs py-1 border border-gray-300">{f.nome_completo}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{f.cpf}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{f.cargo || '-'}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{formatBRL(f.salario_base)}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{f.tipo_contrato}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{f.dependentes_irrf||0}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">{f.status}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300">
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{setEdit(f); setOpen(true);}}>
                      <Pencil className="w-3.5 h-3.5 mr-1.5" /> Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <FuncionarioForm open={open} onClose={()=>{setOpen(false); refetch();}} initialData={edit} onSaved={()=>refetch()} />
    </Card>
  );
}