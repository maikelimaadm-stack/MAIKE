import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Syringe } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function DialogSanidade({ open, onOpenChange, numeroAnimal, empresaId }) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);

  // Formulário
  const [dataAplicacao, setDataAplicacao] = useState(new Date().toISOString().split('T')[0]);
  const [medicamento, setMedicamento] = useState("");
  const [finalidade, setFinalidade] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [unidadeMedida, setUnidadeMedida] = useState("ml");
  const [custoUnitario, setCustoUnitario] = useState("");
  const [observacao, setObservacao] = useState("");

  // Buscar registros de sanidade
  const { data: registros = [] } = useQuery({
    queryKey: ['sanidade', numeroAnimal, empresaId],
    queryFn: async () => {
      const all = await base44.entities.SanidadeAnimal.list('-data_aplicacao');
      return all.filter(s => s.numero_animal === numeroAnimal && s.empresa_id === empresaId);
    },
    enabled: !!numeroAnimal && !!empresaId && open,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.SanidadeAnimal.delete(id),
    onSuccess: () => {
      toast.success("Registro excluído!");
      queryClient.invalidateQueries({ queryKey: ['sanidade'] });
    },
  });

  const handleSalvar = async () => {
    if (!medicamento.trim()) {
      toast.error("Medicamento obrigatório!");
      return;
    }
    if (!quantidade || parseFloat(quantidade) <= 0) {
      toast.error("Quantidade obrigatória!");
      return;
    }

    setIsSaving(true);
    const qtd = parseFloat(quantidade);
    const custo = parseFloat(custoUnitario) || 0;
    const custoTotal = qtd * custo;

    try {
      await base44.entities.SanidadeAnimal.create({
        empresa_id: empresaId,
        numero_animal: numeroAnimal,
        data_aplicacao: dataAplicacao,
        medicamento: medicamento.trim(),
        finalidade: finalidade.trim() || null,
        quantidade: qtd,
        unidade_medida: unidadeMedida,
        custo_unitario: custo > 0 ? custo : null,
        custo_total: custoTotal > 0 ? custoTotal : null,
        observacao: observacao.trim() || null,
      });

      toast.success("✓ Registro de sanidade salvo!");
      queryClient.invalidateQueries({ queryKey: ['sanidade'] });

      // Limpar formulário
      setMedicamento("");
      setFinalidade("");
      setQuantidade("");
      setCustoUnitario("");
      setObservacao("");
    } catch (error) {
      toast.error("Erro ao salvar: " + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const custoTotalCalc = quantidade && custoUnitario 
    ? (parseFloat(quantidade) * parseFloat(custoUnitario)).toFixed(2) 
    : "0.00";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-700">
            <Syringe className="w-5 h-5" />
            Sanidade - Animal {numeroAnimal}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* Formulário */}
          <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
            <h3 className="text-xs font-semibold text-emerald-800 mb-3">Novo Registro</h3>
            <div className="grid grid-cols-7 gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Data Aplicação</Label>
                <Input
                  type="date"
                  value={dataAplicacao}
                  onChange={(e) => setDataAplicacao(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Medicamento *</Label>
                <Input
                  value={medicamento}
                  onChange={(e) => setMedicamento(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ex: Ivermectina"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Finalidade</Label>
                <Input
                  value={finalidade}
                  onChange={(e) => setFinalidade(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ex: Vermífugo"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Qtd. *</Label>
                <Input
                  type="number"
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="10"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Un.</Label>
                <Input
                  value={unidadeMedida}
                  onChange={(e) => setUnidadeMedida(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="ml"
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 mt-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Custo Unit. (R$)</Label>
                <Input
                  type="number"
                  value={custoUnitario}
                  onChange={(e) => setCustoUnitario(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Custo Total</Label>
                <div className="h-8 flex items-center text-xs font-semibold text-emerald-700">
                  R$ {custoTotalCalc}
                </div>
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Observação</Label>
                <Input
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Observações..."
                />
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <Button 
                onClick={handleSalvar} 
                disabled={isSaving}
                size="sm" 
                className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
              >
                <Plus className="w-3.5 h-3.5" />
                {isSaving ? 'Salvando...' : 'Adicionar Registro'}
              </Button>
            </div>
          </div>

          {/* Histórico */}
          <div>
            <h3 className="text-xs font-semibold text-slate-700 mb-2">Histórico de Sanidade</h3>
            {registros.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">
                <Syringe className="w-12 h-12 mx-auto mb-2 opacity-30" />
                Nenhum registro de sanidade
              </div>
            ) : (
              <div className="border rounded overflow-auto max-h-64">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Data</TableHead>
                      <TableHead className="text-xs">Medicamento</TableHead>
                      <TableHead className="text-xs">Finalidade</TableHead>
                      <TableHead className="text-xs text-right">Qtd.</TableHead>
                      <TableHead className="text-xs text-right">Custo</TableHead>
                      <TableHead className="text-xs">Obs.</TableHead>
                      <TableHead className="text-xs w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {registros.map((reg) => (
                      <TableRow key={reg.id} className="hover:bg-slate-50">
                        <TableCell className="text-xs">{new Date(reg.data_aplicacao).toLocaleDateString('pt-BR')}</TableCell>
                        <TableCell className="text-xs font-medium">{reg.medicamento}</TableCell>
                        <TableCell className="text-xs">{reg.finalidade || '-'}</TableCell>
                        <TableCell className="text-xs text-right">{reg.quantidade} {reg.unidade_medida}</TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          {reg.custo_total ? `R$ ${reg.custo_total.toFixed(2)}` : '-'}
                        </TableCell>
                        <TableCell className="text-xs">{reg.observacao || '-'}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-red-500"
                            onClick={() => {
                              if (confirm('Excluir este registro?')) {
                                deleteMutation.mutate(reg.id);
                              }
                            }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Totais */}
            {registros.length > 0 && (
              <div className="mt-2 p-2 bg-slate-100 rounded text-xs">
                <div className="flex justify-between">
                  <span className="font-semibold">Total de Registros:</span>
                  <span>{registros.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-semibold">Custo Total Sanidade:</span>
                  <span className="font-mono text-emerald-700">
                    R$ {registros.reduce((s, r) => s + (r.custo_total || 0), 0).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} size="sm" className="h-8 text-xs">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}