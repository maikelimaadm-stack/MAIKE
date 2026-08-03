import React, { useState } from "react";
import { buscarAreasPorCriterio, criarArea, criarLinha, criarPonto } from "@/services/mapaService";
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
      toast.error("Cole ou carregue um arquivo GeoJSON ou KML");
      return;
    }

    const text = geoJsonText.split('\u0000').join('').replace(/\ufeff/g, '').trim();
    const isKml = text.startsWith('<') && text.toLowerCase().includes('<kml');

    setImporting(true);
    setProgress(0);
    setResultado(null);

    let importados = 0;
    let erros = 0;
    const detalhes = [];

    // Funções auxiliares
    const R = 6378137; // raio da terra em metros (WGS84)
    const toWebMercator = ([lat, lng]) => {
      const x = R * (lng * Math.PI / 180);
      const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
      return [x, y];
    };
    const polygonAreaHa = (coordsLL) => {
      if (!coordsLL || coordsLL.length < 3) return 0;
      // remover ponto repetido final se existir
      const clean = [...coordsLL];
      const first = clean[0];
      const last = clean[clean.length - 1];
      if (Math.abs(first[0] - last[0]) < 1e-10 && Math.abs(first[1] - last[1]) < 1e-10) {
        clean.pop();
      }
      const pts = clean.map(toWebMercator);
      let area = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        area += (pts[j][0] * pts[i][1]) - (pts[i][0] * pts[j][1]);
      }
      return Math.abs(area) / 2 / 10000; // m² → ha
    };
    const parseKmlCoordinates = (coordText) => {
      if (!coordText) return [];
      return coordText
        .trim()
        .split(/\s+/)
        .map((tok) => {
          const parts = tok.split(',');
          const lng = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          if (isNaN(lat) || isNaN(lng)) return null;
          return [lat, lng];
        })
        .filter(Boolean);
    };

    try {
      if (isKml) {
        // Processar KML
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const parseError = xml.getElementsByTagName('parsererror')[0];
        if (parseError) {
          throw new Error('KML inválido. Verifique o arquivo.');
        }
        const placemarks = Array.from(xml.getElementsByTagName('Placemark'));

        // Obter proximo numero sequencial de area
        let nextNumero = 1;
        try {
          const existentes = await buscarAreasPorCriterio({ empresa_id: empresaSelecionadaId });
          const maxNumero = (existentes || []).reduce((max, a) => {
            const n = parseInt(a.numero_area);
            return isNaN(n) ? max : Math.max(max, n);
          }, 0);
          nextNumero = maxNumero + 1;
        } catch (e) {
          nextNumero = 1;
        }

        const total = placemarks.length;
        for (let i = 0; i < placemarks.length; i++) {
          const pm = placemarks[i];
          const nameNode = pm.getElementsByTagName('name')[0];
          const rawName = (nameNode?.textContent || `Item ${i + 1}`).trim();
          const nome = rawName.split('\u0000').join('').replace(/\ufeff/g, '').trim();

          const polygon = pm.getElementsByTagName('Polygon')[0];
          const line = pm.getElementsByTagName('LineString')[0];
          const point = pm.getElementsByTagName('Point')[0];

          try {
            if (polygon) {
              const coordsNode = polygon.getElementsByTagName('coordinates')[0];
              const coordsLL = parseKmlCoordinates((coordsNode?.textContent || '').split('\u0000').join(''));
              if (coordsLL.length >= 3) {
                const areaHa = Number(polygonAreaHa(coordsLL).toFixed(2));
                await criarArea({
                  empresa_id: empresaSelecionadaId,
                  numero_area: String(nextNumero++),
                  nome: nome,
                  sigla: nome, // sigla = código/nome do KML
                  tamanho_hectares: areaHa,
                  tipo_pastagem: "",
                  coordenadas: { coords: coordsLL, cor: "#10b981" },
                  observacoes: "",
                  ativo: true
                });
                importados++;
                detalhes.push({ nome, tipo: "Área", status: "ok" });
              } else {
                erros++;
                detalhes.push({ nome, tipo: "Área", status: "erro", motivo: "Coordenadas insuficientes" });
              }
            } else if (line) {
              const coordsNode = line.getElementsByTagName('coordinates')[0];
              const coordsLL = parseKmlCoordinates((coordsNode?.textContent || '').split('\u0000').join(''));
              if (coordsLL.length >= 2) {
                await criarLinha({
                  empresa_id: empresaSelecionadaId,
                  nome: nome,
                  tipo: "Estrada",
                  coordenadas: { coords: coordsLL, cor: "#f59e0b" },
                  cor: "#f59e0b",
                  observacoes: "",
                  ativo: true
                });
                importados++;
                detalhes.push({ nome, tipo: "Linha", status: "ok" });
              } else {
                erros++;
                detalhes.push({ nome, tipo: "Linha", status: "erro", motivo: "Coordenadas insuficientes" });
              }
            } else if (point) {
              const coordsNode = point.getElementsByTagName('coordinates')[0];
              const coordsLL = parseKmlCoordinates((coordsNode?.textContent || '').split('\u0000').join(''));
              if (coordsLL[0]) {
                await criarPonto({
                  empresa_id: empresaSelecionadaId,
                  nome: nome,
                  tipo: "Outro",
                  coordenadas: { lat: coordsLL[0][0], lng: coordsLL[0][1] },
                  cor: "#3b82f6",
                  observacoes: "",
                  ativo: true
                });
                importados++;
                detalhes.push({ nome, tipo: "Ponto", status: "ok" });
              } else {
                erros++;
                detalhes.push({ nome, tipo: "Ponto", status: "erro", motivo: "Coordenadas inválidas" });
              }
            } else {
              erros++;
              detalhes.push({ nome, tipo: "Desconhecido", status: "erro", motivo: "Geometria não suportada" });
            }
          } catch (err) {
            erros++;
            detalhes.push({ nome, tipo: "?", status: "erro", motivo: err.message });
          }

          setProgress(Math.round(((i + 1) / total) * 100));
        }
      } else {
        // Processar GeoJSON (comportamento atual)
        let geoJson;
        try {
          geoJson = JSON.parse(text);
        } catch (error) {
          toast.error("JSON inválido. Verifique o formato.");
          setImporting(false);
          return;
        }
        if (!geoJson.features || !Array.isArray(geoJson.features)) {
          toast.error("GeoJSON inválido. Deve conter um array 'features'.");
          setImporting(false);
          return;
        }

        const total = geoJson.features.length;
        for (let i = 0; i < geoJson.features.length; i++) {
          const feature = geoJson.features[i];
          try {
            const geometryType = feature.geometry?.type;
            const coordinates = feature.geometry?.coordinates;
            const properties = feature.properties || {};

            if (geometryType === "Polygon" && coordinates?.[0]) {
              const coords = coordinates[0].map(coord => [coord[1], coord[0]]);
              const areaHa = properties.area_hectares || properties.grazableArea_hectares || properties.area || 0;
              const nomePasto = properties.title || properties.name || properties.Name || properties.NAME || 
                               properties.titulo || properties.nome || properties.NOME || properties.label || 
                               properties.Label || properties.LABEL || properties.description || `Área ${i + 1}`;
              await criarArea({
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
              detalhes.push({ nome: nomePasto, tipo: "Área", status: "ok" });
            } else if (geometryType === "Point" && coordinates) {
              await criarPonto({
                empresa_id: empresaSelecionadaId,
                nome: properties.title || properties.name || `Ponto ${i + 1}`,
                tipo: properties.type || "Outro",
                coordenadas: { lat: coordinates[1], lng: coordinates[0] },
                cor: properties.fillColour || properties.fillColor || "#3b82f6",
                observacoes: properties.description || "",
                ativo: true
              });
              importados++;
              detalhes.push({ nome: properties.title || `Ponto ${i + 1}`, tipo: "Ponto", status: "ok" });
            } else if (geometryType === "LineString" && coordinates) {
              const coords = coordinates.map(coord => [coord[1], coord[0]]);
              await criarLinha({
                empresa_id: empresaSelecionadaId,
                nome: properties.title || properties.name || `Linha ${i + 1}`,
                tipo: properties.type || "Estrada",
                coordenadas: { coords: coords, cor: properties.strokeColour || properties.strokeColor || "#f59e0b" },
                cor: properties.strokeColour || properties.strokeColor || "#f59e0b",
                observacoes: properties.description || "",
                ativo: true
              });
              importados++;
              detalhes.push({ nome: properties.title || `Linha ${i + 1}`, tipo: "Linha", status: "ok" });
            } else {
              erros++;
              detalhes.push({ nome: properties.title || `Item ${i + 1}`, tipo: geometryType || "Desconhecido", status: "erro", motivo: "Tipo não suportado" });
            }
          } catch (error) {
            erros++;
            detalhes.push({ nome: feature.properties?.title || `Item ${i + 1}`, tipo: "?", status: "erro", motivo: error.message });
          }
          setProgress(Math.round(((i + 1) / total) * 100));
        }
      }

      setImporting(false);
      setResultado({ importados, erros, total: importados + erros, detalhes });
      
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      queryClient.invalidateQueries({ queryKey: ['pontos'] });
      queryClient.invalidateQueries({ queryKey: ['linhas'] });

      if (importados > 0) {
        toast.success(`✅ ${importados} item(ns) importado(s)!`);
      }
      if (erros > 0) {
        toast.error(`❌ ${erros} item(ns) com erro`);
      }
    } catch (e) {
      setImporting(false);
      toast.error('Erro ao processar arquivo. Verifique se o conteúdo é um GeoJSON/KML válido.');
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
            Importar GeoJSON/KML
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded p-3">
            <div className="text-xs font-semibold text-blue-900 mb-1">💡 Formatos suportados</div>
            <div className="text-[10px] text-blue-700 space-y-1">
              <p>• GeoJSON: <strong>Polygon</strong> → Área, <strong>Point</strong> → Ponto, <strong>LineString</strong> → Linha</p>
              <p>• KML (.kml): também suportado com os mesmos tipos (Polygon/Point/LineString)</p>
              <p>• Áreas KML: numero_area será sequencial (1, 2, 3, ...), sigla = nome do Placemark, tamanho em ha com 2 casas decimais</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Carregar arquivo GeoJSON ou KML</Label>
            <Input
              type="file"
              accept=".json,.geojson,.kml,.xml"
              onChange={handleFileUpload}
              className="h-9 text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Ou cole o conteúdo GeoJSON/KML aqui</Label>
            <Textarea
              value={geoJsonText}
              onChange={(e) => setGeoJsonText(e.target.value)}
              placeholder='Cole GeoJSON (FeatureCollection) ou KML (XML com <kml> ... )'
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