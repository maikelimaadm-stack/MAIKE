import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Upload, FileJson, CheckCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ImportarGeoJSON({ open, onOpenChange }) {
  const [geoJsonText, setGeoJsonText] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultado, setResultado] = useState(null);
  
  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setGeoJsonText(event.target.result);
    };
    reader.readAsText(file);
  };

  const handleImportar = async () => {
    if (!geoJsonText.trim()) {
      toast.error("Cole ou carregue um arquivo GeoJSON");
      return;
    }

    let geoJson;
    try {
      geoJson = JSON.parse(geoJsonText);
    } catch (error) {
      toast.error("JSON inválido. Verifique o formato.");
      return;
    }

    if (!geoJson.features || !Array.isArray(geoJson.features)) {
      toast.error("GeoJSON inválido. Deve conter um array 'features'.");
      return;
    }

    setImporting(true);
    setProgress(0);
    setResultado(null);

    const total = geoJson.features.length;
    let importados = 0;
    let erros = 0;
    const detalhes = [];

    for (let i = 0; i < geoJson.features.length; i++) {
      const feature = geoJson.features[i];
      
      try {
        const geometryType = feature.geometry?.type;
        const coordinates = feature.geometry?.coordinates;
        const properties = feature.properties || {};

        if (geometryType === "Polygon" && coordinates?.[0]) {
          // Converter coordenadas GeoJSON [lng, lat] para nosso formato [lat, lng]
          const coords = coordinates[0].map(coord => [coord[1], coord[0]]);
          
          // Calcular área em hectares se não vier no GeoJSON
          const areaHa = properties.area_hectares || properties.grazableArea_hectares || properties.area || 0;
          
          // Buscar nome em vários campos possíveis
          const nomePasto = properties.title || properties.name || properties.Name || properties.NAME || 
                           properties.titulo || properties.nome || properties.NOME || properties.label || 
                           properties.Label || properties.LABEL || properties.description || `Área ${i + 1}`;
          
          await base44.entities.AreaPastagem.create({
            empresa_id: empresaSelecionadaId,
            nome: nomePasto,
            tamanho_hectares: areaHa,
            tipo_pastagem: properties.cropType || properties.vegetation || "",
            coordenadas: {
              coords: coords,
              cor: properties.fillColour || properties.fillColor || "#10b981"
            },
            observacoes: properties.pastureState || "",
            ativo: true
          });
          
          importados++;
          detalhes.push({ nome: properties.title || `Área ${i + 1}`, tipo: "Área", status: "ok" });
        } 
        else if (geometryType === "Point" && coordinates) {
          await base44.entities.PontoReferencia.create({
            empresa_id: empresaSelecionadaId,
            nome: properties.title || properties.name || `Ponto ${i + 1}`,
            tipo: properties.type || "Outro",
            coordenadas: {
              lat: coordinates[1],
              lng: coordinates[0]
            },
            cor: properties.fillColour || properties.fillColor || "#3b82f6",
            observacoes: properties.description || "",
            ativo: true
          });
          
          importados++;
          detalhes.push({ nome: properties.title || `Ponto ${i + 1}`, tipo: "Ponto", status: "ok" });
        }
        else if (geometryType === "LineString" && coordinates) {
          const coords = coordinates.map(coord => [coord[1], coord[0]]);
          
          await base44.entities.LinhaGeografica.create({
            empresa_id: empresaSelecionadaId,
            nome: properties.title || properties.name || `Linha ${i + 1}`,
            tipo: properties.type || "Estrada",
            coordenadas: {
              coords: coords,
              cor: properties.strokeColour || properties.strokeColor || "#f59e0b"
            },
            cor: properties.strokeColour || properties.strokeColor || "#f59e0b",
            observacoes: properties.description || "",
            ativo: true
          });
          
          importados++;
          detalhes.push({ nome: properties.title || `Linha ${i + 1}`, tipo: "Linha", status: "ok" });
        }
        else {
          erros++;
          detalhes.push({ nome: properties.title || `Item ${i + 1}`, tipo: geometryType || "Desconhecido", status: "erro", motivo: "Tipo não suportado" });
        }
      } catch (error) {
        erros++;
        detalhes.push({ nome: feature.properties?.title || `Item ${i + 1}`, tipo: "?", status: "erro", motivo: error.message });
      }

      setProgress(Math.round(((i + 1) / total) * 100));
    }

    setImporting(false);
    setResultado({ importados, erros, total, detalhes });
    
    queryClient.invalidateQueries({ queryKey: ['areas'] });
    queryClient.invalidateQueries({ queryKey: ['pontos'] });
    queryClient.invalidateQueries({ queryKey: ['linhas'] });

    if (importados > 0) {
      toast.success(`✅ ${importados} item(ns) importado(s)!`);
    }
    if (erros > 0) {
      toast.error(`❌ ${erros} item(ns) com erro`);
    }
  };

  const handleClose = () => {
    setGeoJsonText("");
    setProgress(0);
    setResultado(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileJson className="w-4 h-4 text-emerald-600" />
            Importar GeoJSON
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded p-3">
            <div className="text-xs font-semibold text-blue-900 mb-1">💡 Formatos suportados</div>
            <div className="text-[10px] text-blue-700 space-y-1">
              <p>• <strong>Polygon</strong> → Será importado como Área</p>
              <p>• <strong>Point</strong> → Será importado como Ponto</p>
              <p>• <strong>LineString</strong> → Será importado como Linha</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Carregar arquivo GeoJSON</Label>
            <Input
              type="file"
              accept=".json,.geojson"
              onChange={handleFileUpload}
              className="h-9 text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Ou cole o conteúdo GeoJSON aqui</Label>
            <Textarea
              value={geoJsonText}
              onChange={(e) => setGeoJsonText(e.target.value)}
              placeholder='{"type": "FeatureCollection", "features": [...]}'
              className="h-40 text-xs font-mono"
            />
          </div>

          {importing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Importando...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {resultado && (
            <div className="border rounded p-3 space-y-2">
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1 text-emerald-600">
                  <CheckCircle className="w-4 h-4" />
                  <span>{resultado.importados} importado(s)</span>
                </div>
                {resultado.erros > 0 && (
                  <div className="flex items-center gap-1 text-red-600">
                    <AlertCircle className="w-4 h-4" />
                    <span>{resultado.erros} erro(s)</span>
                  </div>
                )}
              </div>
              
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1">Nome</th>
                      <th className="text-left py-1">Tipo</th>
                      <th className="text-left py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.detalhes.map((item, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="py-1">{item.nome}</td>
                        <td className="py-1">{item.tipo}</td>
                        <td className="py-1">
                          {item.status === "ok" ? (
                            <span className="text-emerald-600">✓</span>
                          ) : (
                            <span className="text-red-600" title={item.motivo}>✗</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={handleClose} size="sm" className="h-8 text-xs">
              {resultado ? "Fechar" : "Cancelar"}
            </Button>
            {!resultado && (
              <Button 
                onClick={handleImportar} 
                disabled={importing || !geoJsonText.trim()}
                size="sm" 
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                <Upload className="w-3 h-3 mr-1" />
                {importing ? "Importando..." : "Importar"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}