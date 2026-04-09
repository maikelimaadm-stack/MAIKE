import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import useSetorAreas from "@/hooks/useSetorAreas";
import SelecaoPontosMapa from "./SelecaoPontosMapa";

const createEmptyPoint = () => ({
  tempId: crypto.randomUUID(),
  nome: "",
  sigla: "",
  tipo: "",
  observacoes: "",
  setor_id: "",
  coordenadas: { lat: "", lng: "" },
});

export default function ModalCadastroLotePontos({ open, onOpenChange }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [pontos, setPontos] = useState([createEmptyPoint()]);
  const [activePointId, setActivePointId] = useState(null);
  const [showMapaSelecao, setShowMapaSelecao] = useState(false);
  const { setores } = useSetorAreas(empresaSelecionadaId);

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((item) => item.tipo_entidade === "Ponto" && item.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const activePoint = useMemo(() => {
    const currentId = activePointId || pontos[0]?.tempId;
    return pontos.find((item) => item.tempId === currentId) || null;
  }, [pontos, activePointId]);

  const updatePoint = (tempId, changes) => {
    setPontos((prev) => prev.map((item) => item.tempId === tempId ? { ...item, ...changes } : item));
  };

  const addPoint = () => {
    const novo = createEmptyPoint();
    setPontos((prev) => [...prev, novo]);
    setActivePointId(novo.tempId);
  };

  const removePoint = (tempId) => {
    setPontos((prev) => {
      const next = prev.filter((item) => item.tempId !== tempId);
      if (!next.length) {
        const vazio = createEmptyPoint();
        setActivePointId(vazio.tempId);
        return [vazio];
      }
      if (activePointId === tempId) setActivePointId(next[0].tempId);
      return next;
    });
  };

  const resetState = () => {
    const vazio = createEmptyPoint();
    setPontos([vazio]);
    setActivePointId(vazio.tempId);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const pontosValidos = pontos.filter((item) => item.nome && item.tipo && item.coordenadas.lat !== "" && item.coordenadas.lng !== "");
      if (!pontosValidos.length) throw new Error("Preencha pelo menos um ponto completo.");

      const existentes = await base44.entities.PontoReferencia.list();
      const maxNumeroPonto = existentes.reduce((maximo, ponto) => Math.max(maximo, parseInt(ponto.numero_ponto) || 0), 0);

      const payload = pontosValidos.map((item, index) => {
        const configIcone = iconesConfig.find((icone) => icone.categoria === item.tipo);
        return {
          empresa_id: empresaSelecionadaId,
          numero_ponto: String(maxNumeroPonto + index + 1),
          nome: item.nome.toUpperCase(),
          sigla: item.sigla?.toUpperCase() || "",
          tipo: item.tipo,
          observacoes: item.observacoes?.toUpperCase() || "",
          configuracao_icone_id: configIcone?.id || null,
          icone_url: configIcone?.icone_url || null,
          sub_icone_url: configIcone?.sub_icone_url || null,
          cor: configIcone?.cor_padrao || "#0066ff",
          setor_id: item.setor_id || null,
          ativo: true,
          coordenadas: {
            lat: Number(item.coordenadas.lat),
            lng: Number(item.coordenadas.lng),
          },
        };
      });

      return base44.entities.PontoReferencia.bulkCreate(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["pontos", "mapa-pontos"].includes(query.queryKey[0]) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Pontos cadastrados em lote com sucesso.");
      resetState();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao salvar os pontos.");
    },
  });

  return (
    <>
      {showMapaSelecao && (
        <SelecaoPontosMapa
          initialPoints={pontos.filter((item) => item.coordenadas.lat !== "" && item.coordenadas.lng !== "").map((item) => ({
            id: item.tempId,
            lat: Number(item.coordenadas.lat),
            lng: Number(item.coordenadas.lng),
          }))}
          onClose={() => setShowMapaSelecao(false)}
          onConfirmSelection={(selectedPoints) => {
            const converted = selectedPoints.map((item, index) => ({
              tempId: item.id || crypto.randomUUID(),
              nome: pontos.find((ponto) => ponto.tempId === item.id)?.nome || "",
              sigla: pontos.find((ponto) => ponto.tempId === item.id)?.sigla || "",
              tipo: pontos.find((ponto) => ponto.tempId === item.id)?.tipo || "",
              observacoes: pontos.find((ponto) => ponto.tempId === item.id)?.observacoes || "",
              setor_id: pontos.find((ponto) => ponto.tempId === item.id)?.setor_id || "",
              coordenadas: { lat: String(item.lat), lng: String(item.lng) },
            }));
            setPontos(converted.length ? converted : [createEmptyPoint()]);
            setActivePointId(converted[0]?.tempId || null);
            setShowMapaSelecao(false);
          }}
        />
      )}

      <Dialog open={open} onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) resetState();
      }}>
      <DialogContent className="max-w-5xl p-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b bg-slate-50">
          <DialogTitle className="text-sm font-semibold text-slate-900">Cadastro em lote de pontos</DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-[260px_1fr] min-h-[520px]">
          <div className="border-r bg-slate-50/60 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-medium text-slate-600 uppercase">Pontos</span>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowMapaSelecao(true)}>
                  Marcar no mapa
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={addPoint}>
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar
                </Button>
              </div>
            </div>

            <div className="space-y-2 max-h-[430px] overflow-y-auto pr-1">
              {pontos.map((item, index) => {
                const ativo = activePoint?.tempId === item.tempId;
                return (
                  <Card key={item.tempId} className={`cursor-pointer border ${ativo ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white"}`} onClick={() => setActivePointId(item.tempId)}>
                    <CardContent className="p-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">{item.nome || `PONTO ${index + 1}`}</div>
                        <div className="text-[11px] text-slate-500 truncate">{item.tipo || "SEM TIPO"}</div>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-slate-500" onClick={(e) => {
                        e.stopPropagation();
                        removePoint(item.tempId);
                      }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          <div className="p-4 space-y-3">
            {activePoint && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Nome do ponto</Label>
                    <Input value={activePoint.nome} onChange={(e) => updatePoint(activePoint.tempId, { nome: e.target.value })} className="h-8 text-xs uppercase" placeholder="NOME DO PONTO" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Sigla</Label>
                    <Input value={activePoint.sigla} onChange={(e) => updatePoint(activePoint.tempId, { sigla: e.target.value })} className="h-8 text-xs uppercase" placeholder="SIGLA" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Tipo do ponto</Label>
                    <Select value={activePoint.tipo} onValueChange={(value) => updatePoint(activePoint.tempId, { tipo: value })}>
                      <SelectTrigger className="h-8 text-xs uppercase">
                        <SelectValue placeholder="SELECIONE O TIPO" />
                      </SelectTrigger>
                      <SelectContent>
                        {iconesConfig.map((item) => (
                          <SelectItem key={item.id} value={item.categoria} className="text-xs uppercase">
                            {item.categoria}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Setor</Label>
                    <Select value={activePoint.setor_id || "__none__"} onValueChange={(value) => updatePoint(activePoint.tempId, { setor_id: value === "__none__" ? "" : value })}>
                      <SelectTrigger className="h-8 text-xs uppercase">
                        <SelectValue placeholder="SELECIONE O SETOR" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-xs uppercase">SELECIONE</SelectItem>
                        {setores.map((setor) => (
                          <SelectItem key={setor.id} value={setor.id} className="text-xs uppercase">
                            {setor.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Latitude</Label>
                    <Input type="number" value={activePoint.coordenadas.lat} onChange={(e) => updatePoint(activePoint.tempId, { coordenadas: { ...activePoint.coordenadas, lat: e.target.value } })} className="h-8 text-xs" placeholder="-15.000000" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Longitude</Label>
                    <Input type="number" value={activePoint.coordenadas.lng} onChange={(e) => updatePoint(activePoint.tempId, { coordenadas: { ...activePoint.coordenadas, lng: e.target.value } })} className="h-8 text-xs" placeholder="-59.000000" />
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  Você pode preencher manualmente ou usar o botão "Marcar no mapa" para selecionar os pontos visualmente.
                </div>

                <div className="space-y-1">
                  <Label className="text-xs uppercase">Observações</Label>
                  <Textarea value={activePoint.observacoes} onChange={(e) => updatePoint(activePoint.tempId, { observacoes: e.target.value })} className="text-xs uppercase min-h-[120px]" placeholder="OBSERVAÇÕES" />
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>Cancelar</Button>
              <Button type="button" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Salvando..." : "Salvar todos"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}