import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import FormularioLancamentoSuplementacao from "./FormularioLancamentoSuplementacao";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

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
      <div className="fixed inset-0 z-50 bg-white">
        <div className="w-full h-full relative bg-slate-100">
          <div className="absolute inset-0" />

          <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-full shadow-lg border border-slate-200">
            <span className="text-xs font-semibold text-slate-700">Lançamento em lote</span>
            <Badge variant="outline" className="text-[10px]">{itens.length} item(ns)</Badge>
          </div>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-white/90 backdrop-blur-sm px-2 py-1.5 rounded-full shadow-lg border border-slate-200">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={handleAddItem}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Adicionar
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel}>Cancelar</Button>
            <Button type="button" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSalvarTudo}>
              Salvar tudo
            </Button>
          </div>
        </div>

        <Sheet open={true} onOpenChange={(open) => { if (!open) onCancel?.(); }}>
          <SheetContent side="right" className="bg-background px-1 py-1 fixed z-50 gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out inset-y-0 right-0 h-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm w-[320px] sm:w-[420px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Lançamento em Lote</SheetTitle>
            </SheetHeader>

            <div className="mt-1 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600 uppercase">{itens.length} lançamento(s)</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {itens.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setItemEditandoId(item.id)}
                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${itemEditandoId === item.id ? "border-emerald-600 bg-emerald-50 text-emerald-700 font-semibold" : "border-slate-200 bg-white text-slate-600"}`}
                  >
                    {item.pontoNome || `Lançamento ${index + 1}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative mt-2 space-y-2">
              {itemEditando && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 z-10 h-6 w-6 hover:bg-red-100"
                  onClick={() => handleRemoveItem(itemEditando.id)}
                  disabled={itens.length === 1}
                  title="Remover lançamento"
                >
                  <Trash2 className="w-4 h-4 text-red-600" />
                </Button>
              )}

              {itemEditando && (
                <div className="rounded-lg border border-slate-200 bg-white p-2 space-y-2">
                  <div>
                    <label className="text-xs uppercase text-slate-500">Cocho</label>
                    <Select value={itemEditando.pontoId} onValueChange={(value) => handleSelectPonto(itemEditando.id, value)}>
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

                  {itemEditando.pontoNome && (
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] text-slate-500 uppercase">Selecionado: <span className="font-semibold text-slate-700">{itemEditando.pontoNome}</span></div>
                      <Badge className={itemEditando.saved ? "bg-emerald-100 text-emerald-700 text-[10px]" : "bg-slate-100 text-slate-700 text-[10px]"}>
                        {itemEditando.saved ? "Preenchido" : "Pendente"}
                      </Badge>
                    </div>
                  )}

                  {itemEditando.pontoId && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white w-full"
                      onClick={() => setItemEditandoId(itemEditando.id)}
                    >
                      {itemEditando.saved ? "Editar lançamento" : "Preencher lançamento"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <Dialog open={!!itemEditandoId && !!pontoEditando} onOpenChange={(open) => !open && setItemEditandoId(null)}>
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