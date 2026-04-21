import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import FormularioLancamentoSuplementacao from "./FormularioLancamentoSuplementacao";

const createItem = () => ({
  id: crypto.randomUUID(),
  pontoId: "",
  pontoNome: "",
  saved: false,
});

export default function FormularioLancamentoSuplementacaoLote({ pontos = [], onCancel, onSaved }) {
  const queryClient = useQueryClient();
  const [itens, setItens] = useState([createItem()]);
  const [itemEditandoId, setItemEditandoId] = useState(null);
  const [progresso, setProgresso] = useState({ show: false, atual: 0, total: 0, mensagem: "" });

  const pontosOrdenados = useMemo(() => {
    return [...pontos].sort((a, b) => (a.nome_ponto || "").localeCompare(b.nome_ponto || ""));
  }, [pontos]);

  const itemEditando = itens.find((item) => item.id === itemEditandoId) || null;
  const pontoEditando = pontosOrdenados.find((ponto) => ponto.id === itemEditando?.pontoId) || null;

  const handleAddItem = () => {
    setItens((current) => [...current, createItem()]);
  };

  const handleRemoveItem = (id) => {
    setItens((current) => current.length === 1 ? current : current.filter((item) => item.id !== id));
  };

  const handleSelectPonto = (id, pontoId) => {
    const ponto = pontosOrdenados.find((item) => item.id === pontoId);
    setItens((current) => current.map((item) => item.id === id ? {
      ...item,
      pontoId,
      pontoNome: ponto?.nome_ponto || "",
      saved: false,
    } : item));
  };

  const handleSalvarTudo = async () => {
    const pendentes = itens.filter((item) => item.pontoId && !item.saved);
    if (pendentes.length > 0) {
      toast.error("Finalize os lançamentos pendentes antes de salvar tudo.");
      return;
    }

    const selecionados = itens.filter((item) => item.pontoId);
    if (selecionados.length === 0) {
      toast.error("Selecione pelo menos um cocho.");
      return;
    }

    setProgresso({ show: true, atual: 1, total: 1, mensagem: "Concluindo lançamentos em lote..." });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mapa-eventosSuplementacao"] }),
      queryClient.invalidateQueries({ queryKey: ["pontos-suplementacao"] }),
    ]);
    setProgresso({ show: true, atual: 1, total: 1, mensagem: "Concluído!" });
    setTimeout(() => {
      setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
      onSaved?.();
    }, 300);
  };

  return (
    <>
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-emerald-50 border-b border-emerald-200 py-2 px-3">
          <CardTitle className="text-sm font-bold text-emerald-900">Lançamento de Suplementação em Lote</CardTitle>
        </CardHeader>
        <CardContent className="p-2 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] text-slate-600">
            Monte vários lançamentos, cocho por cocho, e finalize tudo de uma vez. A lógica de cálculo e estoque continua igual ao lançamento individual.
          </div>

          <div className="space-y-1">
            {itens.map((item, index) => (
              <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">Lançamento {index + 1}</Badge>
                    {item.saved && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Preenchido</Badge>}
                  </div>
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => handleRemoveItem(item.id)} disabled={itens.length === 1}>
                    <Trash2 className="w-3.5 h-3.5" /> Remover
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
                  <div>
                    <label className="text-xs uppercase text-slate-500">Cocho</label>
                    <Select value={item.pontoId} onValueChange={(value) => handleSelectPonto(item.id, value)}>
                      <SelectTrigger className="h-8 text-xs uppercase">
                        <SelectValue placeholder="SELECIONE O COCHO" />
                      </SelectTrigger>
                      <SelectContent>
                        {pontosOrdenados.map((ponto) => (
                          <SelectItem key={ponto.id} value={ponto.id} className="text-xs uppercase">
                            {ponto.nome_ponto}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => {
                      if (!item.pontoId) {
                        toast.error("Selecione o cocho primeiro.");
                        return;
                      }
                      setItemEditandoId(item.id);
                    }}
                  >
                    {item.saved ? "Editar" : "Preencher"}
                  </Button>
                </div>

                {item.pontoNome && (
                  <div className="text-[10px] text-slate-500 uppercase">Cocho selecionado: <span className="font-semibold text-slate-700">{item.pontoNome}</span></div>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col md:flex-row justify-between gap-2 pt-2 border-t">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={handleAddItem}>
              <Plus className="w-3.5 h-3.5" /> Adicionar lançamento
            </Button>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel}>Cancelar</Button>
              <Button type="button" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSalvarTudo}>
                Salvar tudo
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!itemEditandoId} onOpenChange={(open) => !open && setItemEditandoId(null)}>
        <DialogContent className="max-w-[880px] max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="text-sm">Preencher lançamento</DialogTitle>
          </DialogHeader>
          {pontoEditando && itemEditando && (
            <FormularioLancamentoSuplementacao
              ponto={pontoEditando}
              onCancel={() => setItemEditandoId(null)}
              onSubmit={() => {}}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={progresso.show} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Salvando...</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-600">{progresso.mensagem}</p>
            <Progress value={progresso.total ? (progresso.atual / progresso.total) * 100 : 0} className="w-full h-1.5" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}