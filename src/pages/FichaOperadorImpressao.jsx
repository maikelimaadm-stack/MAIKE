import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Printer, FileText } from "lucide-react";

export default function FichaOperadorImpressao() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [config, setConfig] = useState({
    quantidade: 1,
    area_id: '',
    maquina_id: '',
    tipo_operacao: '',
  });

  const { data: empresa } = useQuery({
    queryKey: ['empresa-ficha', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Empresa.list();
      return all.find(e => e.id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas-impressao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: maquinas = [] } = useQuery({
    queryKey: ['maquinas-impressao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Maquina.list();
      return all.filter(m => m.empresa_id === empresaSelecionadaId && m.status === 'Ativo' && m.tipo !== 'Implemento');
    },
    enabled: !!empresaSelecionadaId,
  });

  const handlePrint = () => {
    window.print();
  };

  const areaSelecionada = areas.find(a => a.id === config.area_id);
  const maquinaSelecionada = maquinas.find(m => m.id === config.maquina_id);

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Configurações - não aparece na impressão */}
      <div className="print:hidden p-4 bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Ficha de Operação - Impressão
          </h1>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Quantidade</Label>
              <Input
                type="number"
                min="1"
                max="10"
                value={config.quantidade}
                onChange={(e) => setConfig({ ...config, quantidade: parseInt(e.target.value) || 1 })}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Área (opcional)</Label>
              <Select value={config.area_id} onValueChange={(v) => setConfig({ ...config, area_id: v })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Deixar em branco</SelectItem>
                  {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Máquina (opcional)</Label>
              <Select value={config.maquina_id} onValueChange={(v) => setConfig({ ...config, maquina_id: v })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Deixar em branco</SelectItem>
                  {maquinas.map(m => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tipo Operação</Label>
              <Select value={config.tipo_operacao} onValueChange={(v) => setConfig({ ...config, tipo_operacao: v })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Deixar em branco</SelectItem>
                  <SelectItem value="Gradagem">Gradagem</SelectItem>
                  <SelectItem value="Aração">Aração</SelectItem>
                  <SelectItem value="Plantio">Plantio</SelectItem>
                  <SelectItem value="Pulverização">Pulverização</SelectItem>
                  <SelectItem value="Adubação">Adubação</SelectItem>
                  <SelectItem value="Colheita">Colheita</SelectItem>
                  <SelectItem value="Roçagem">Roçagem</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={handlePrint} className="w-full h-9 gap-2">
                <Printer className="w-4 h-4" />
                Imprimir
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Fichas para impressão */}
      <div className="p-4 print:p-0">
        {Array.from({ length: config.quantidade }).map((_, index) => (
          <div 
            key={index} 
            className="max-w-4xl mx-auto bg-white mb-4 print:mb-0 print:page-break-after-always shadow-lg print:shadow-none"
            style={{ pageBreakAfter: index < config.quantidade - 1 ? 'always' : 'auto' }}
          >
            <div className="p-6 print:p-4">
              {/* Cabeçalho */}
              <div className="border-b-2 border-slate-900 pb-3 mb-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h1 className="text-xl font-bold text-slate-900">{empresa?.nome || 'FAZENDA'}</h1>
                    <p className="text-sm text-slate-600">{empresa?.endereco || ''}</p>
                  </div>
                  <div className="text-right">
                    <h2 className="text-lg font-bold text-slate-900">FICHA DE OPERAÇÃO</h2>
                    <p className="text-sm text-slate-600">Nº ________</p>
                  </div>
                </div>
              </div>

              {/* Dados Principais */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="border border-slate-300 p-2">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Data</div>
                  <div className="h-6 border-b border-dotted border-slate-400"></div>
                </div>
                <div className="border border-slate-300 p-2 col-span-2">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Operador</div>
                  <div className="h-6 border-b border-dotted border-slate-400"></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="border border-slate-300 p-2">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Tipo de Operação</div>
                  <div className="h-6 flex items-center font-medium">
                    {config.tipo_operacao || <span className="border-b border-dotted border-slate-400 flex-1"></span>}
                  </div>
                </div>
                <div className="border border-slate-300 p-2">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Área / Talhão</div>
                  <div className="h-6 flex items-center font-medium">
                    {areaSelecionada?.nome || <span className="border-b border-dotted border-slate-400 flex-1"></span>}
                  </div>
                </div>
              </div>

              {/* Máquina e Implemento */}
              <div className="bg-slate-50 border border-slate-300 p-3 mb-4">
                <div className="text-xs font-bold text-slate-700 uppercase mb-2">Máquina / Equipamento</div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] text-slate-500">Máquina</div>
                    <div className="h-6 flex items-center font-medium border-b border-dotted border-slate-400">
                      {maquinaSelecionada?.nome || ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Implemento</div>
                    <div className="h-6 border-b border-dotted border-slate-400"></div>
                  </div>
                </div>
              </div>

              {/* Horímetro */}
              <div className="bg-purple-50 border border-purple-200 p-3 mb-4">
                <div className="text-xs font-bold text-purple-800 uppercase mb-2">Horímetro</div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-[10px] text-purple-600">Início</div>
                    <div className="h-8 border border-purple-300 bg-white flex items-center justify-center text-lg font-mono"></div>
                  </div>
                  <div>
                    <div className="text-[10px] text-purple-600">Final</div>
                    <div className="h-8 border border-purple-300 bg-white flex items-center justify-center text-lg font-mono"></div>
                  </div>
                  <div>
                    <div className="text-[10px] text-purple-600">Total Horas</div>
                    <div className="h-8 border-2 border-purple-400 bg-purple-100 flex items-center justify-center text-lg font-bold"></div>
                  </div>
                </div>
              </div>

              {/* Produção */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-green-50 border border-green-200 p-3">
                  <div className="text-xs font-bold text-green-800 uppercase mb-2">Área Trabalhada</div>
                  <div className="flex items-center gap-2">
                    <div className="h-10 flex-1 border-2 border-green-300 bg-white flex items-center justify-center text-xl font-bold"></div>
                    <span className="text-lg font-semibold text-green-700">ha</span>
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-200 p-3">
                  <div className="text-xs font-bold text-amber-800 uppercase mb-2">Combustível</div>
                  <div className="flex items-center gap-2">
                    <div className="h-10 flex-1 border-2 border-amber-300 bg-white flex items-center justify-center text-xl font-bold"></div>
                    <span className="text-lg font-semibold text-amber-700">L</span>
                  </div>
                </div>
              </div>

              {/* Produto Aplicado */}
              <div className="bg-orange-50 border border-orange-200 p-3 mb-4">
                <div className="text-xs font-bold text-orange-800 uppercase mb-2">Produto Aplicado (se houver)</div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <div className="text-[10px] text-orange-600">Nome do Produto</div>
                    <div className="h-6 border-b border-dotted border-orange-400"></div>
                  </div>
                  <div>
                    <div className="text-[10px] text-orange-600">Quantidade</div>
                    <div className="h-6 border-b border-dotted border-orange-400"></div>
                  </div>
                </div>
              </div>

              {/* Observações */}
              <div className="border border-slate-300 p-3 mb-4">
                <div className="text-xs font-bold text-slate-700 uppercase mb-2">Observações</div>
                <div className="h-16 border-b border-dotted border-slate-300"></div>
              </div>

              {/* Assinaturas */}
              <div className="grid grid-cols-2 gap-8 mt-8 pt-4">
                <div className="text-center">
                  <div className="border-t border-slate-900 pt-1">
                    <div className="text-xs text-slate-600">Assinatura do Operador</div>
                  </div>
                </div>
                <div className="text-center">
                  <div className="border-t border-slate-900 pt-1">
                    <div className="text-xs text-slate-600">Visto do Supervisor</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print\\:p-0 { padding: 0 !important; }
          .print\\:p-4 { padding: 1rem !important; }
          .print\\:mb-0 { margin-bottom: 0 !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          @page { margin: 0.5cm; size: A4; }
        }
      `}</style>
    </div>
  );
}