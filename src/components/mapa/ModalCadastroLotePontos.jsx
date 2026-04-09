import React, { useEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { X, Check, Trash2, Target, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import useSetorAreas from "@/hooks/useSetorAreas";

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";

const createPoint = (coords = null) => ({
  tempId: crypto.randomUUID(),
  nome: "",
  sigla: "",
  tipo: "",
  observacoes: "",
  setor_id: "",
  coordenadas: coords || null,
});

const loadGoogleMapsScript = () => {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

export default function ModalCadastroLotePontos({ open, onOpenChange }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const { setores } = useSetorAreas(empresaSelecionadaId);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const readyRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [mapType, setMapType] = useState("satellite");
  const [pontos, setPontos] = useState([]);
  const [activePointId, setActivePointId] = useState(null);

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((item) => item.tipo_entidade === "Ponto" && item.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const activePoint = useMemo(() => pontos.find((item) => item.tempId === activePointId) || null, [pontos, activePointId]);

  const resetState = () => {
    setPontos([]);
    setActivePointId(null);
    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];
  };

  const updatePoint = (tempId, changes) => {
    setPontos((prev) => prev.map((item) => item.tempId === tempId ? { ...item, ...changes } : item));
  };

  const removePoint = (tempId) => {
    setPontos((prev) => {
      const next = prev.filter((item) => item.tempId !== tempId);
      if (activePointId === tempId) setActivePointId(next[0]?.tempId || null);
      return next;
    });
  };

  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }

    let timeoutId;

    loadGoogleMapsScript().then(() => {
      timeoutId = setTimeout(() => {
        readyRef.current = true;
        setMapReady(true);
        if (!mapRef.current || mapInstanceRef.current) return;

        const map = new google.maps.Map(mapRef.current, {
          center: { lat: -15.0067, lng: -59.9533 },
          zoom: 17,
          mapTypeId: "satellite",
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: "greedy",
          zoomControl: false,
          disableDoubleClickZoom: false,
          draggable: true,
          scrollwheel: true,
          clickableIcons: false,
        });

        map.addListener("click", (event) => {
          const novo = createPoint({
            lat: Number(event.latLng.lat().toFixed(6)),
            lng: Number(event.latLng.lng().toFixed(6)),
          });
          setPontos((prev) => [...prev, novo]);
          setActivePointId(novo.tempId);
        });

        google.maps.event.addListenerOnce(map, "tilesloaded", () => {
          setMapReady(true);
        });

        mapInstanceRef.current = map;
      }, 100);
    }).catch(() => toast.error("Erro ao carregar mapa"));

    return () => clearTimeout(timeoutId);
  }, [open]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.setMapTypeId(mapType);
  }, [mapType]);

  useEffect(() => {
    if (!mapInstanceRef.current || !readyRef.current) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    pontos.forEach((ponto, index) => {
      if (!ponto.coordenadas) return;
      const ativo = ponto.tempId === activePointId;
      const marker = new google.maps.Marker({
        position: ponto.coordenadas,
        map: mapInstanceRef.current,
        draggable: true,
        label: {
          text: String(index + 1),
          color: "#ffffff",
          fontSize: "11px",
          fontWeight: "700",
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: ativo ? 11 : 9,
          fillColor: ativo ? "#16a34a" : "#2563eb",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });

      marker.addListener("click", () => setActivePointId(ponto.tempId));
      marker.addListener("dragend", (event) => {
        updatePoint(ponto.tempId, {
          coordenadas: {
            lat: Number(event.latLng.lat().toFixed(6)),
            lng: Number(event.latLng.lng().toFixed(6)),
          },
        });
      });

      markersRef.current.push(marker);
    });
  }, [pontos, activePointId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const pontosValidos = pontos.filter((item) => item.nome && item.tipo && item.coordenadas);
      if (!pontosValidos.length) throw new Error("Preencha os dados dos pontos marcados.");

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
          coordenadas: item.coordenadas,
        };
      });

      return base44.entities.PontoReferencia.bulkCreate(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["pontos", "mapa-pontos"].includes(query.queryKey[0]) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Pontos salvos com sucesso.");
      onOpenChange(false);
    },
    onError: (error) => toast.error(error.message || "Erro ao salvar os pontos."),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-white">
      <div
        ref={mapRef}
        style={{ height: "100%", width: "100%", backgroundColor: "#e5e7eb", touchAction: "manipulation" }}
        className="absolute inset-0"
      />

      <Button onClick={() => onOpenChange(false)} variant="secondary" size="icon" className="absolute top-4 left-4 z-20 h-12 w-12 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white">
        <X className="w-6 h-6 text-slate-700" />
      </Button>

      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <Button variant={mapType === "roadmap" ? "default" : "secondary"} size="sm" onClick={() => setMapType("roadmap")} className="h-9 px-3 text-xs bg-white/90 backdrop-blur-sm shadow-lg">Mapa</Button>
        <Button variant={mapType === "satellite" ? "default" : "secondary"} size="sm" onClick={() => setMapType("satellite")} className="h-9 px-3 text-xs bg-white/90 backdrop-blur-sm shadow-lg">Satélite</Button>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => {
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition(
                (position) => {
                  const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
                  mapInstanceRef.current?.setCenter(pos);
                  mapInstanceRef.current?.setZoom(18);
                },
                () => toast.error("Erro ao obter localização")
              );
            }
          }}
          className="h-9 w-9 bg-white/90 backdrop-blur-sm shadow-lg"
        >
          <Target className="w-4 h-4" />
        </Button>
      </div>

      {!mapReady && (
        <div className="absolute top-1/2 left-[calc(50%-190px)] z-20 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white px-6 py-4 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
            <span className="font-semibold text-slate-700">Carregando mapa...</span>
          </div>
        </div>
      )}

      <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-black/70 px-4 py-2 text-xs font-semibold text-white">
        Clique no mapa para marcar vários pontos e depois preencha os dados de cada um ao lado.
      </div>

      <div className="absolute right-0 top-0 z-20 h-full w-full max-w-[380px] border-l bg-white shadow-2xl">
        <div className="flex h-full flex-col">
          <div className="border-b bg-slate-50 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">Cadastro em lote de pontos</div>
            <div className="text-xs text-slate-500">Mesmo fluxo do marcar no mapa, salvando tudo de uma vez.</div>
          </div>

          <div className="border-b px-4 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600 uppercase">Pontos marcados</span>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={resetState}>
                <RefreshCw className="w-3.5 h-3.5" />
                Limpar
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {pontos.map((item, index) => (
                <button
                  key={item.tempId}
                  type="button"
                  onClick={() => setActivePointId(item.tempId)}
                  className={`rounded-md border px-2 py-1 text-xs ${activePointId === item.tempId ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600"}`}
                >
                  Ponto {index + 1}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activePoint ? (
              <div className="space-y-3">
                <Card className="p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-900 uppercase">Dados do ponto</div>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removePoint(activePoint.tempId)}>
                      <Trash2 className="w-4 h-4 text-slate-500" />
                    </Button>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Nome do ponto</Label>
                    <Input value={activePoint.nome} onChange={(e) => updatePoint(activePoint.tempId, { nome: e.target.value })} className="h-8 text-xs uppercase" placeholder="NOME DO PONTO" />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs uppercase">Sigla</Label>
                      <Input value={activePoint.sigla} onChange={(e) => updatePoint(activePoint.tempId, { sigla: e.target.value })} className="h-8 text-xs uppercase" placeholder="SIGLA" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs uppercase">Setor</Label>
                      <Select value={activePoint.setor_id || "__none__"} onValueChange={(value) => updatePoint(activePoint.tempId, { setor_id: value === "__none__" ? "" : value })}>
                        <SelectTrigger className="h-8 text-xs uppercase">
                          <SelectValue placeholder="SELECIONE" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs uppercase">SELECIONE</SelectItem>
                          {setores.map((setor) => (
                            <SelectItem key={setor.id} value={setor.id} className="text-xs uppercase">{setor.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Ponto de referência</Label>
                    <Select value={activePoint.tipo} onValueChange={(value) => updatePoint(activePoint.tempId, { tipo: value })}>
                      <SelectTrigger className="h-8 text-xs uppercase">
                        <SelectValue placeholder="SELECIONE O TIPO" />
                      </SelectTrigger>
                      <SelectContent>
                        {iconesConfig.map((item) => (
                          <SelectItem key={item.id} value={item.categoria} className="text-xs uppercase">{item.categoria}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                    LAT {activePoint.coordenadas?.lat} / LNG {activePoint.coordenadas?.lng}
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Observações</Label>
                    <Textarea value={activePoint.observacoes} onChange={(e) => updatePoint(activePoint.tempId, { observacoes: e.target.value })} className="min-h-[110px] text-xs uppercase" placeholder="OBSERVAÇÕES" />
                  </div>
                </Card>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-500">
                Clique no mapa para começar a marcar os pontos.
              </div>
            )}
          </div>

          <div className="border-t px-4 py-3">
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>Cancelar</Button>
              <Button type="button" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || pontos.length === 0}>
                <Check className="w-3.5 h-3.5" />
                {saveMutation.isPending ? "Salvando..." : "Salvar todos"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}