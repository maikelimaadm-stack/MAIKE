import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Leaf, Loader2, AlertTriangle, Check, Trash2, Edit2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function DeteccaoMataIA({ 
  mapInstance, 
  areasExistentes = [], 
  onMataCriada,
  empresaId 
}) {
  const [analisando, setAnalisando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [etapa, setEtapa] = useState("");
  const [matasDetectadas, setMatasDetectadas] = useState([]);
  const [matasConfirmadas, setMatasConfirmadas] = useState([]);
  const queryClient = useQueryClient();

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

    // Usar Static Maps API do Google
    const width = 640;
    const height = 640;
    const zoom = 15;

    const imageUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${centerLat},${centerLng}&zoom=${zoom}&size=${width}x${height}&maptype=satellite&key=AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8`;

    return { imageUrl, bounds, centerLat, centerLng };
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
  const analisarComIA = async (imageUrl, bounds) => {
    const areasContexto = gerarContextoAreas();
    
    const prompt = `Você é um especialista em análise de imagens de satélite agrícolas.

CONTEXTO:
- Esta é uma imagem de satélite de uma fazenda
- As áreas já cadastradas são: ${JSON.stringify(areasContexto)}
- Você deve identificar APENAS áreas de MATA/VEGETAÇÃO NATIVA dentro dos limites visíveis

TAREFA:
Analise a imagem e identifique áreas com:
1. Vegetação densa (mata fechada)
2. Mata nativa
3. Vegetação secundária
4. Áreas de preservação

Para cada área de mata identificada, forneça:
- Localização aproximada (ex: "canto superior esquerdo", "centro", "entre pasto X e Y")
- Classificação: "Mata Densa", "Mata Média" ou "Vegetação Rala"
- Densidade estimada em % (60-100%)
- Área aproximada em hectares
- Se parece ser APP, reserva legal ou mata isolada

IMPORTANTE:
- NÃO identifique pastagens como mata
- NÃO identifique áreas agrícolas como mata
- Foque em vegetação NATURAL não manejada
- Cores verde escuro uniforme geralmente indicam mata

Responda em JSON com este formato:
{
  "areas_mata": [
    {
      "id": "MAT-001",
      "localizacao_descritiva": "string",
      "classificacao": "Mata Densa|Mata Média|Vegetação Rala",
      "densidade_percentual": number,
      "area_estimada_ha": number,
      "tipo_provavel": "APP|Reserva Legal|Mata Isolada|Vegetação Secundária",
      "confianca": number (0-100),
      "posicao_relativa": {
        "x_percent": number (0-100, da esquerda),
        "y_percent": number (0-100, do topo)
      }
    }
  ],
  "analise_geral": {
    "total_areas_mata": number,
    "area_total_estimada_ha": number,
    "observacoes": "string"
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
      const resultado = await analisarComIA(captura.imageUrl, captura.bounds);

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
        toast.success(`${matasProcessadas.length} área(s) de mata detectada(s)!`);
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
        nome: `Mata identificada - IA (${mata.id})`,
        tipo: "Reserva",
        categoria: mata.tipo_provavel,
        tamanho_hectares: mata.area_estimada_ha,
        coordenadas: {
          coords: mata.coordenadas,
          cor: "#166534" // Verde escuro
        },
        cor: "#166534",
        observacoes: `Detectado por IA em ${new Date().toLocaleDateString('pt-BR')}. Classificação: ${mata.classificacao}. Densidade: ${mata.densidade_percentual}%. Confiança: ${mata.confianca}%`,
        ativo: true
      };

      await createMataMutation.mutateAsync(novaArea);
      
      setMatasConfirmadas(prev => [...prev, mata.id]);
      setMatasDetectadas(prev => prev.filter(m => m.id !== mata.id));
      
      toast.success(`${mata.id} salvo como área de reserva!`);
      
      if (onMataCriada) onMataCriada(novaArea);

    } catch (error) {
      toast.error("Erro ao salvar: " + error.message);
    }
  };

  // Descartar mata
  const descartarMata = (mataId) => {
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
              <li>A IA analisa a imagem de satélite da sua fazenda</li>
              <li>Identifica áreas com vegetação nativa (mata)</li>
              <li>Sugere polígonos para cada área detectada</li>
              <li>Você pode confirmar, editar ou descartar cada sugestão</li>
            </ul>
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
      </CardContent>
    </Card>
  );
}