import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Leaf, Loader2, AlertTriangle, Check, Trash2, Edit2, RefreshCw, Maximize2, Minimize2 } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";

const loadGoogleMapsScript = () => {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=drawing,geometry`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

export default function DeteccaoMataIA({ 
  areasExistentes = [], 
  onMataCriada,
  empresaId 
}) {
  const [analisando, setAnalisando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [etapa, setEtapa] = useState("");
  const [matasDetectadas, setMatasDetectadas] = useState([]);
  const [matasConfirmadas, setMatasConfirmadas] = useState([]);
  const [polygonsNoMapa, setPolygonsNoMapa] = useState([]);
  const [showMapa, setShowMapa] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const queryClient = useQueryClient();
  
  // Inicializar mapa quando mostrar
  useEffect(() => {
    if (showMapa && !mapInstanceRef.current) {
      loadGoogleMapsScript().then(() => {
        if (!mapRef.current) return;
        
        const bounds = calcularLimitesFazenda();
        const center = bounds ? {
          lat: (bounds.minLat + bounds.maxLat) / 2,
          lng: (bounds.minLng + bounds.maxLng) / 2
        } : { lat: -15.0067, lng: -59.9533 };
        
        const map = new google.maps.Map(mapRef.current, {
          center,
          zoom: 14,
          mapTypeId: 'satellite',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        
        mapInstanceRef.current = map;
        
        // Desenhar áreas existentes (pastos)
        areasExistentes.forEach(area => {
          const coords = area.coordenadas?.coords || [];
          if (coords.length < 3) return;
          
          const paths = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
          const cor = area.coordenadas?.cor || '#FFCC00';
          
          new google.maps.Polygon({
            paths,
            strokeColor: cor,
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: cor,
            fillOpacity: 0.35,
            map
          });
        });
        
        // Ajustar zoom para mostrar todas as áreas
        if (bounds) {
          const mapBounds = new google.maps.LatLngBounds(
            { lat: bounds.minLat, lng: bounds.minLng },
            { lat: bounds.maxLat, lng: bounds.maxLng }
          );
          map.fitBounds(mapBounds, { padding: 50 });
        }
        
        setMapReady(true);
      });
    }
  }, [showMapa]);
  
  // Desenhar matas quando o mapa estiver pronto E tivermos matas detectadas
  useEffect(() => {
    if (mapReady && matasDetectadas.length > 0 && mapInstanceRef.current) {
      console.log('🌳 Desenhando matas no mapa:', matasDetectadas.length);
      desenharPoligonosNoMapa(matasDetectadas);
    }
  }, [mapReady, matasDetectadas]);

  // Mutation para criar área de mata
  const createMataMutation = useMutation({
    mutationFn: (data) => base44.entities.AreaPastagem.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] });
    },
  });

  // Calcular bounding box de todas as áreas existentes
  const calcularLimitesFazenda = () => {
    if (areasExistentes.length === 0) return null;

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    areasExistentes.forEach(area => {
      const coords = area.coordenadas?.coords || [];
      coords.forEach(c => {
        const lat = c[0] || c.lat;
        const lng = c[1] || c.lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      });
    });

    return { minLat, maxLat, minLng, maxLng };
  };

  // Calcular zoom ideal baseado no tamanho da área
  const calcularZoomIdeal = (bounds) => {
    const latDiff = bounds.maxLat - bounds.minLat;
    const lngDiff = bounds.maxLng - bounds.minLng;
    const maxDiff = Math.max(latDiff, lngDiff);
    
    // Quanto maior a área, menor o zoom
    if (maxDiff > 0.1) return 12;      // Área muito grande (>10km)
    if (maxDiff > 0.05) return 13;     // Área grande (~5km)
    if (maxDiff > 0.02) return 14;     // Área média (~2km)
    if (maxDiff > 0.01) return 15;     // Área pequena (~1km)
    return 16;                          // Área muito pequena
  };

  // Capturar screenshot do mapa
  const capturarImagemMapa = async () => {
    const bounds = calcularLimitesFazenda();
    if (!bounds) {
      toast.error("Nenhuma área cadastrada para análise");
      return null;
    }

    // Centralizar mapa nos limites da fazenda
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const centerLng = (bounds.minLng + bounds.maxLng) / 2;

    // Calcular zoom ideal para mostrar toda a fazenda
    const zoom = calcularZoomIdeal(bounds);

    // Usar Static Maps API do Google - tamanho máximo 640x640
    const width = 640;
    const height = 640;

    // Criar path com todos os polígonos para mostrar os limites
    let pathParam = '';
    areasExistentes.forEach(area => {
      const coords = area.coordenadas?.coords || [];
      if (coords.length >= 3) {
        const pathCoords = coords.map(c => `${c[0] || c.lat},${c[1] || c.lng}`).join('|');
        pathParam += `&path=color:0xFFFF0080|weight:2|fillcolor:0xFFFF0040|${pathCoords}`;
      }
    });

    const imageUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${centerLat},${centerLng}&zoom=${zoom}&size=${width}x${height}&maptype=satellite&key=AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8${pathParam}`;

    console.log('📸 Capturando imagem:', { centerLat, centerLng, zoom, bounds });

    return { imageUrl, bounds, centerLat, centerLng, zoom };
  };

  // Gerar descrição das áreas existentes para contexto
  const gerarContextoAreas = () => {
    return areasExistentes.map(a => ({
      nome: a.nome,
      tipo: a.tipo || 'Pasto',
      hectares: a.tamanho_hectares
    }));
  };

  // Analisar imagem com IA
  const analisarComIA = async (imageUrl, bounds, zoom) => {
    const areasContexto = gerarContextoAreas();
    
    // Calcular área total da fazenda
    const areaTotal = areasExistentes.reduce((sum, a) => sum + (a.tamanho_hectares || 0), 0);
    
    const prompt = `Você é um especialista em análise de imagens de satélite agrícolas e sensoriamento remoto.

CONTEXTO DA FAZENDA:
- Esta é uma imagem de satélite mostrando uma fazenda rural
- As áreas AMARELAS/DESTACADAS na imagem são os piquetes/pastos JÁ CADASTRADOS (${areasExistentes.length} áreas, total de ${areaTotal.toFixed(0)} hectares)
- Nomes das áreas cadastradas: ${areasContexto.map(a => a.nome).join(', ')}
- Você deve analisar DENTRO e AO REDOR dessas áreas amarelas

TAREFA PRINCIPAL:
Identifique TODAS as áreas de MATA/VEGETAÇÃO NATIVA visíveis na imagem, que são caracterizadas por:
- Cor VERDE ESCURO (diferente do verde claro das pastagens)
- Textura irregular/densa (copas de árvores)
- Geralmente aparecem nas bordas dos pastos, ao longo de rios/córregos, ou como "ilhas" de mata

O QUE PROCURAR:
1. ✅ Matas ciliares (ao longo de cursos d'água) - verde escuro linear
2. ✅ Reservas florestais - grandes manchas verde escuro
3. ✅ Vegetação de encosta - áreas íngremes com mata
4. ✅ Mata isolada entre pastos - pequenas manchas verde escuro
5. ✅ APPs (Áreas de Preservação Permanente)

O QUE NÃO IDENTIFICAR COMO MATA:
- ❌ Pastagens (verde claro/amarelado) - são as áreas amarelas destacadas
- ❌ Solo exposto (marrom/bege)
- ❌ Água (azul/preto)
- ❌ Construções

PARA CADA ÁREA DE MATA, forneça a POSIÇÃO EXATA na imagem:
- x_percent: posição horizontal (0=esquerda, 50=centro, 100=direita)
- y_percent: posição vertical (0=topo, 50=meio, 100=base)

Responda em JSON:
{
  "areas_mata": [
    {
      "id": "MAT-001",
      "localizacao_descritiva": "Entre Pasto 50 e Pasto 51, ao longo do córrego",
      "classificacao": "Mata Densa|Mata Média|Vegetação Rala",
      "densidade_percentual": 85,
      "area_estimada_ha": 15,
      "tipo_provavel": "APP|Reserva Legal|Mata Isolada|Mata Ciliar",
      "confianca": 90,
      "posicao_relativa": {
        "x_percent": 35,
        "y_percent": 60
      }
    }
  ],
  "analise_geral": {
    "total_areas_mata": 5,
    "area_total_estimada_ha": 120,
    "observacoes": "Identificadas matas ciliares ao longo do rio principal e reserva legal no canto sudeste"
  }
}`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      file_urls: [imageUrl],
      response_json_schema: {
        type: "object",
        properties: {
          areas_mata: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                localizacao_descritiva: { type: "string" },
                classificacao: { type: "string" },
                densidade_percentual: { type: "number" },
                area_estimada_ha: { type: "number" },
                tipo_provavel: { type: "string" },
                confianca: { type: "number" },
                posicao_relativa: {
                  type: "object",
                  properties: {
                    x_percent: { type: "number" },
                    y_percent: { type: "number" }
                  }
                }
              }
            }
          },
          analise_geral: {
            type: "object",
            properties: {
              total_areas_mata: { type: "number" },
              area_total_estimada_ha: { type: "number" },
              observacoes: { type: "string" }
            }
          }
        }
      }
    });

    return response;
  };

  // Converter posição relativa para coordenadas
  const converterParaCoordenadas = (posicao, bounds) => {
    const lat = bounds.maxLat - (posicao.y_percent / 100) * (bounds.maxLat - bounds.minLat);
    const lng = bounds.minLng + (posicao.x_percent / 100) * (bounds.maxLng - bounds.minLng);
    
    // Criar polígono aproximado (quadrado) baseado na área estimada
    return { lat, lng };
  };

  // Gerar polígono aproximado para área de mata
  const gerarPoligonoMata = (mata, bounds) => {
    const centro = converterParaCoordenadas(mata.posicao_relativa, bounds);
    
    // Calcular raio aproximado baseado na área em hectares
    // 1 hectare = 10000 m², raio = sqrt(area/pi)
    const areaM2 = (mata.area_estimada_ha || 1) * 10000;
    const raioM = Math.sqrt(areaM2 / Math.PI);
    
    // Converter para graus (aproximadamente)
    const raioDeg = raioM / 111000; // ~111km por grau
    
    // Criar polígono octogonal
    const pontos = [];
    for (let i = 0; i < 8; i++) {
      const angulo = (i * 45) * (Math.PI / 180);
      pontos.push([
        centro.lat + raioDeg * Math.cos(angulo),
        centro.lng + raioDeg * Math.sin(angulo) / Math.cos(centro.lat * Math.PI / 180)
      ]);
    }
    
    return pontos;
  };

  // Iniciar análise
  const iniciarAnalise = async () => {
    if (areasExistentes.length === 0) {
      toast.error("Cadastre áreas no mapa antes de analisar");
      return;
    }

    setAnalisando(true);
    setProgresso(0);
    setMatasDetectadas([]);

    try {
      // Etapa 1: Capturar imagem
      setEtapa("Capturando imagem de satélite...");
      setProgresso(20);
      const captura = await capturarImagemMapa();
      
      if (!captura) {
        throw new Error("Falha ao capturar imagem");
      }

      // Etapa 2: Analisar com IA
      setEtapa("Analisando vegetação com IA...");
      setProgresso(50);
      console.log('🔍 Enviando para análise:', captura.imageUrl);
      const resultado = await analisarComIA(captura.imageUrl, captura.bounds, captura.zoom);
      console.log('📊 Resultado da análise:', resultado);

      // Etapa 3: Processar resultados
      setEtapa("Processando áreas detectadas...");
      setProgresso(80);

      if (resultado?.areas_mata?.length > 0) {
        const matasProcessadas = resultado.areas_mata.map((mata, idx) => ({
          ...mata,
          id: `MAT-${String(idx + 1).padStart(3, '0')}`,
          coordenadas: gerarPoligonoMata(mata, captura.bounds),
          bounds: captura.bounds
        }));

        setMatasDetectadas(matasProcessadas);
        
        // Mostrar mapa - os polígonos serão desenhados pelo useEffect
        setShowMapa(true);
        
        toast.success(`${matasProcessadas.length} área(s) de mata detectada(s)! Veja no mapa abaixo.`);
      } else {
        toast.info("Nenhuma área de mata significativa detectada");
      }

      setProgresso(100);
      setEtapa("Análise concluída!");

    } catch (error) {
      console.error("Erro na análise:", error);
      toast.error("Erro ao analisar: " + error.message);
    } finally {
      setTimeout(() => {
        setAnalisando(false);
        setProgresso(0);
        setEtapa("");
      }, 1500);
    }
  };

  // Confirmar e salvar mata
  const confirmarMata = async (mata) => {
    try {
      const novaArea = {
        empresa_id: empresaId,
        nome: `Mata ${mata.tipo_provavel} - ${mata.id}`,
        tipo: "Reserva",
        categoria: mata.tipo_provavel,
        tamanho_hectares: mata.area_estimada_ha,
        coordenadas: {
          coords: mata.coordenadas,
          cor: "#166534" // Verde escuro
        },
        cor: "#166534",
        observacoes: `Detectado por IA em ${new Date().toLocaleDateString('pt-BR')}. Classificação: ${mata.classificacao}. Densidade: ${mata.densidade_percentual}%. Confiança: ${mata.confianca}%. Localização: ${mata.localizacao_descritiva}`,
        ativo: true
      };

      await createMataMutation.mutateAsync(novaArea);
      
      // Remover polígono temporário do mapa (será substituído pelo permanente após refresh)
      const itemRemover = polygonsNoMapa.find(p => p.mataId === mata.id);
      if (itemRemover) {
        itemRemover.polygon.setMap(null);
        itemRemover.labelOverlay.setMap(null);
        itemRemover.infoWindow.close();
        setPolygonsNoMapa(prev => prev.filter(p => p.mataId !== mata.id));
      }
      
      setMatasConfirmadas(prev => [...prev, mata.id]);
      setMatasDetectadas(prev => prev.filter(m => m.id !== mata.id));
      
      toast.success(`${mata.id} salvo como área de reserva!`);
      
      if (onMataCriada) onMataCriada(novaArea);

    } catch (error) {
      toast.error("Erro ao salvar: " + error.message);
    }
  };

  // Desenhar polígonos das matas detectadas no mapa
  const desenharPoligonosNoMapa = (matas) => {
    if (!mapInstanceRef.current || !window.google?.maps) return;
    
    const mapInstance = mapInstanceRef.current;
    
    // Limpar polígonos anteriores
    limparPoligonosDoMapa();
    
    const novosPolygons = [];
    
    matas.forEach((mata) => {
      const paths = mata.coordenadas.map(c => ({ lat: c[0], lng: c[1] }));
      
      // Cor baseada na classificação
      const cores = {
        "Mata Densa": { fill: "#166534", stroke: "#14532d" },
        "Mata Média": { fill: "#22c55e", stroke: "#15803d" },
        "Vegetação Rala": { fill: "#86efac", stroke: "#22c55e" }
      };
      const cor = cores[mata.classificacao] || cores["Mata Média"];
      
      const polygon = new google.maps.Polygon({
        paths,
        strokeColor: cor.stroke,
        strokeOpacity: 1,
        strokeWeight: 3,
        fillColor: cor.fill,
        fillOpacity: 0.5,
        editable: false,
        draggable: false,
        zIndex: 1000
      });
      
      polygon.setMap(mapInstance);
      
      // Adicionar label no centro
      const bounds = new google.maps.LatLngBounds();
      paths.forEach(p => bounds.extend(p));
      const center = bounds.getCenter();
      
      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 8px; font-size: 12px;">
            <strong style="color: #166534;">${mata.id}</strong><br/>
            <span>${mata.classificacao}</span><br/>
            <span>~${mata.area_estimada_ha?.toFixed(1)} ha</span><br/>
            <span style="color: #666;">${mata.tipo_provavel}</span>
          </div>
        `,
        position: center
      });
      
      polygon.addListener('click', () => {
        infoWindow.open(mapInstance);
      });
      
      // Criar label overlay
      const labelDiv = document.createElement('div');
      labelDiv.innerHTML = `
        <div style="
          background: rgba(22, 101, 52, 0.9);
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          text-align: center;
          white-space: nowrap;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        ">
          🌳 ${mata.id}<br/>
          <span style="font-size: 10px; font-weight: 400;">${mata.area_estimada_ha?.toFixed(1)}ha</span>
        </div>
      `;
      
      const labelOverlay = new google.maps.OverlayView();
      labelOverlay.onAdd = function() {
        const pane = this.getPanes().floatPane;
        pane.appendChild(labelDiv);
      };
      labelOverlay.draw = function() {
        const projection = this.getProjection();
        const position = projection.fromLatLngToDivPixel(center);
        labelDiv.style.position = 'absolute';
        labelDiv.style.left = position.x - 40 + 'px';
        labelDiv.style.top = position.y - 25 + 'px';
        labelDiv.style.zIndex = '9999';
      };
      labelOverlay.onRemove = function() {
        labelDiv.parentNode?.removeChild(labelDiv);
      };
      labelOverlay.setMap(mapInstance);
      
      novosPolygons.push({ polygon, labelOverlay, infoWindow, mataId: mata.id });
    });
    
    setPolygonsNoMapa(novosPolygons);
    
    // Centralizar mapa nas matas detectadas
    if (matas.length > 0) {
      const allBounds = new google.maps.LatLngBounds();
      matas.forEach(mata => {
        mata.coordenadas.forEach(c => allBounds.extend({ lat: c[0], lng: c[1] }));
      });
      mapInstance.fitBounds(allBounds, { padding: 50 });
    }
  };
  
  // Limpar polígonos do mapa
  const limparPoligonosDoMapa = () => {
    polygonsNoMapa.forEach(item => {
      item.polygon.setMap(null);
      item.labelOverlay.setMap(null);
      item.infoWindow.close();
    });
    setPolygonsNoMapa([]);
  };

  // Descartar mata
  const descartarMata = (mataId) => {
    // Remover polígono do mapa
    const itemRemover = polygonsNoMapa.find(p => p.mataId === mataId);
    if (itemRemover) {
      itemRemover.polygon.setMap(null);
      itemRemover.labelOverlay.setMap(null);
      itemRemover.infoWindow.close();
      setPolygonsNoMapa(prev => prev.filter(p => p.mataId !== mataId));
    }
    
    setMatasDetectadas(prev => prev.filter(m => m.id !== mataId));
    toast.info("Área descartada");
  };

  // Confirmar todas
  const confirmarTodas = async () => {
    for (const mata of matasDetectadas) {
      await confirmarMata(mata);
    }
  };

  const classificacaoCores = {
    "Mata Densa": "bg-green-700 text-white",
    "Mata Média": "bg-green-500 text-white",
    "Vegetação Rala": "bg-green-300 text-green-900"
  };

  return (
    <Card className="shadow-sm border-slate-300">
      <CardHeader className="bg-white border-b border-slate-200 py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Leaf className="w-4 h-4 text-green-600" />
            Detecção de Mata por IA
          </CardTitle>
          <Button
            onClick={iniciarAnalise}
            disabled={analisando || areasExistentes.length === 0}
            size="sm"
            className="h-8 text-xs bg-green-700 hover:bg-green-800"
          >
            {analisando ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Analisando...
              </>
            ) : (
              <>
                <RefreshCw className="w-3 h-3 mr-1" />
                Analisar Área
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Progresso da análise */}
        {analisando && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-slate-600">
              <span>{etapa}</span>
              <span>{progresso}%</span>
            </div>
            <Progress value={progresso} className="h-2" />
          </div>
        )}

        {/* Instruções */}
        {!analisando && matasDetectadas.length === 0 && (
          <div className="bg-slate-50 rounded-lg p-4 text-xs text-slate-600 space-y-2">
            <p className="font-semibold text-slate-700">Como funciona:</p>
            <ul className="list-disc ml-4 space-y-1">
              <li>A IA captura imagem de satélite de TODA a fazenda ({areasExistentes.length} áreas cadastradas)</li>
              <li>Analisa as áreas verdes escuras (mata) dentro e ao redor dos pastos</li>
              <li>Identifica: matas ciliares, reservas, APPs e vegetação nativa</li>
              <li>Você pode confirmar, editar ou descartar cada sugestão</li>
            </ul>
            <div className="mt-3 p-2 bg-emerald-50 border border-emerald-200 rounded">
              <p className="text-emerald-800 font-medium">
                📍 Perímetro de análise: {areasExistentes.reduce((sum, a) => sum + (a.tamanho_hectares || 0), 0).toFixed(0)} hectares cadastrados
              </p>
            </div>
            <p className="text-amber-700 flex items-center gap-1 mt-2">
              <AlertTriangle className="w-3 h-3" />
              A precisão depende da qualidade da imagem. Revise antes de confirmar.
            </p>
          </div>
        )}

        {/* Matas detectadas */}
        {matasDetectadas.length > 0 && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-slate-700">
                {matasDetectadas.length} área(s) detectada(s)
              </span>
              <Button
                onClick={confirmarTodas}
                size="sm"
                variant="outline"
                className="h-7 text-xs"
              >
                <Check className="w-3 h-3 mr-1" />
                Confirmar Todas
              </Button>
            </div>

            {matasDetectadas.map((mata) => (
              <div
                key={mata.id}
                className="border border-slate-200 rounded-lg p-3 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-900 text-sm">{mata.id}</span>
                      <Badge className={classificacaoCores[mata.classificacao] || "bg-green-100 text-green-800"}>
                        {mata.classificacao}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {mata.confianca}% confiança
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-600 space-y-0.5">
                      <div>📍 {mata.localizacao_descritiva}</div>
                      <div>📐 ~{mata.area_estimada_ha?.toFixed(1)} ha • Densidade: {mata.densidade_percentual}%</div>
                      <div>🏷️ Tipo provável: {mata.tipo_provavel}</div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      onClick={() => confirmarMata(mata)}
                      size="sm"
                      className="h-7 text-xs bg-green-600 hover:bg-green-700"
                    >
                      <Check className="w-3 h-3" />
                    </Button>
                    <Button
                      onClick={() => descartarMata(mata.id)}
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Matas confirmadas */}
        {matasConfirmadas.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <div className="text-xs text-green-800">
              <Check className="w-3 h-3 inline mr-1" />
              {matasConfirmadas.length} área(s) salva(s) como reserva
            </div>
          </div>
        )}
        
        {/* MAPA EMBUTIDO */}
        {showMapa && (
          <div className="border border-slate-300 rounded-lg overflow-hidden">
            <div className="bg-slate-100 px-3 py-2 flex items-center justify-between border-b">
              <span className="text-xs font-semibold text-slate-700">
                🗺️ Mapa com Matas Detectadas
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMapa(false)}
                className="h-6 text-xs"
              >
                <Minimize2 className="w-3 h-3 mr-1" />
                Ocultar
              </Button>
            </div>
            <div 
              ref={mapRef} 
              style={{ height: '400px', width: '100%' }}
              className="bg-slate-200"
            />
          </div>
        )}
        
        {!showMapa && matasDetectadas.length > 0 && (
          <Button
            variant="outline"
            onClick={() => setShowMapa(true)}
            className="w-full h-10 text-xs gap-2"
          >
            <Maximize2 className="w-4 h-4" />
            Ver Mapa com Matas Detectadas
          </Button>
        )}
      </CardContent>
    </Card>
  );
}