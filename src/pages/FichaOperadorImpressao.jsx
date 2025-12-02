import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, FileText } from "lucide-react";

export default function FichaOperadorImpressao() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [config, setConfig] = useState({
    quantidade: 6,
    fichasPorPagina: 6,
  });

  const { data: empresa } = useQuery({
    queryKey: ['empresa-ficha', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Empresa.list();
      return all.find(e => e.id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const handlePrint = () => {
    window.print();
  };

  const totalPaginas = Math.ceil(config.quantidade / config.fichasPorPagina);

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Configurações - não aparece na impressão */}
      <div className="print:hidden p-4 bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Bloco de Fichas - Impressão
          </h1>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Qtd de Fichas</Label>
              <Input
                type="number"
                min="1"
                max="100"
                value={config.quantidade}
                onChange={(e) => setConfig({ ...config, quantidade: parseInt(e.target.value) || 6 })}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Fichas por Página</Label>
              <Select value={String(config.fichasPorPagina)} onValueChange={(v) => setConfig({ ...config, fichasPorPagina: parseInt(v) })}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4">4 fichas</SelectItem>
                  <SelectItem value="6">6 fichas</SelectItem>
                  <SelectItem value="8">8 fichas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <div className="text-sm text-slate-600">
                Total: <strong>{totalPaginas}</strong> página(s)
              </div>
            </div>
            <div className="flex items-end">
              <Button onClick={handlePrint} className="w-full h-9 gap-2">
                <Printer className="w-4 h-4" />
                Imprimir Bloco
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Fichas estilo bloquinho - PRETO E BRANCO */}
      <div className="p-4 print:p-0">
        {Array.from({ length: totalPaginas }).map((_, pageIndex) => (
          <div 
            key={pageIndex} 
            className="max-w-4xl mx-auto bg-white mb-4 print:mb-0 shadow-lg print:shadow-none"
            style={{ pageBreakAfter: pageIndex < totalPaginas - 1 ? 'always' : 'auto' }}
          >
            <div className={`grid ${config.fichasPorPagina === 4 ? 'grid-cols-2 grid-rows-2' : config.fichasPorPagina === 6 ? 'grid-cols-2 grid-rows-3' : 'grid-cols-2 grid-rows-4'} print:h-[297mm]`}>
              {Array.from({ length: config.fichasPorPagina }).map((_, fichaIndex) => {
                const fichaNumero = pageIndex * config.fichasPorPagina + fichaIndex + 1;
                if (fichaNumero > config.quantidade) return null;
                
                const alturaFicha = config.fichasPorPagina === 4 ? '148.5mm' : config.fichasPorPagina === 6 ? '99mm' : '74.25mm';
                
                return (
                  <div 
                    key={fichaIndex} 
                    className="border border-dashed border-black p-2 flex flex-col"
                    style={{ height: alturaFicha }}
                  >
                    {/* Cabeçalho */}
                    <div className="flex justify-between items-center border-b-2 border-black">
                      <span className="text-[10px] font-bold text-black">{empresa?.apelido || empresa?.nome || 'FAZENDA'}</span>
                      <div className="flex items-center">
                        <span className="text-[9px] font-bold text-black mr-1">Nº</span>
                        <div className="w-6 border-b border-black"></div>
                      </div>
                    </div>
                    
                    {/* Espaço para recorte/grampo */}
                    <div className="border-b border-dashed border-black" style={{ minHeight: '20px' }}></div>

                    {/* Todas as linhas com label inline */}
                    <div className="text-[10px] text-black space-y-0.5 flex-1">
                      <div className="flex border-b border-black" style={{ minHeight: '25px' }}>
                        <span className="font-bold w-12 flex-shrink-0">DATA:</span>
                        <span className="flex-1 border-l border-black pl-1"></span>
                        <span className="font-bold w-12 flex-shrink-0 border-l border-black pl-1">ÁREA:</span>
                        <span className="flex-1 border-l border-black pl-1"></span>
                      </div>
                      
                      <div className="flex border-b border-black" style={{ minHeight: '25px' }}>
                        <span className="font-bold w-20 flex-shrink-0">OPERADOR:</span>
                        <span className="flex-1 border-l border-black pl-1"></span>
                      </div>
                      
                      <div className="flex border-b border-black" style={{ minHeight: '25px' }}>
                        <span className="font-bold w-20 flex-shrink-0">OPERAÇÃO:</span>
                        <span className="flex-1 border-l border-black pl-1"></span>
                      </div>
                      
                      <div className="flex border-b border-black" style={{ minHeight: '25px' }}>
                        <span className="font-bold w-20 flex-shrink-0">MÁQUINA:</span>
                        <span className="flex-1 border-l border-black pl-1"></span>
                      </div>
                      
                      <div className="flex border-b border-black" style={{ minHeight: '25px' }}>
                        <span className="font-bold w-24 flex-shrink-0">IMPLEMENTO:</span>
                        <span className="flex-1 border-l border-black pl-1"></span>
                      </div>
                      
                      <div className="flex border-b border-black" style={{ minHeight: '25px' }}>
                        <span className="font-bold w-16 flex-shrink-0">H.INÍCIO:</span>
                        <span className="flex-1 border-l border-black pl-1"></span>
                        <span className="font-bold w-14 flex-shrink-0 border-l border-black pl-1">H.FINAL:</span>
                        <span className="flex-1 border-l border-black pl-1"></span>
                        <span className="font-bold w-20 flex-shrink-0 border-l border-black pl-1">TOTAL HRS:</span>
                        <span className="flex-1 border-l border-black pl-1"></span>
                      </div>
                      
                      <div className="flex border-b border-black" style={{ minHeight: '25px' }}>
                        <span className="font-bold w-20 flex-shrink-0">HECTARES:</span>
                        <span className="flex-1 border-l border-black pl-1"></span>
                        <span className="font-bold w-20 flex-shrink-0 border-l border-black pl-1">COMB. (L):</span>
                        <span className="flex-1 border-l border-black pl-1"></span>
                      </div>
                      
                      <div className="flex border-b border-black" style={{ minHeight: '40px' }}>
                        <span className="font-bold w-24 flex-shrink-0">PRODUTO/QTD:</span>
                        <span className="flex-1 border-l border-black pl-1"></span>
                      </div>
                      
                      <div className="flex border-b border-black" style={{ minHeight: '40px' }}>
                        <span className="font-bold w-10 flex-shrink-0">OBS:</span>
                        <span className="flex-1 border-l border-black pl-1"></span>
                      </div>
                    </div>

                    {/* Assinaturas - posicionadas mais abaixo */}
                    <div className="flex justify-between pt-2 mt-auto">
                      <div className="text-center flex-1">
                        <div className="border-t border-black mx-2">
                          <span className="text-[9px] text-black font-bold">Operador</span>
                        </div>
                      </div>
                      <div className="text-center flex-1">
                        <div className="border-t border-black mx-2">
                          <span className="text-[9px] text-black font-bold">Supervisor</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print\\:p-0 { padding: 0 !important; }
          .print\\:mb-0 { margin-bottom: 0 !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          .print\\:h-\\[297mm\\] { height: 297mm !important; }
          @page { margin: 0; size: A4; }
        }
      `}</style>
    </div>
  );
}