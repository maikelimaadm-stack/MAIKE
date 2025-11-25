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
    quantidade: 4,
    fichasPorPagina: 4,
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
                onChange={(e) => setConfig({ ...config, quantidade: parseInt(e.target.value) || 4 })}
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
                  <SelectItem value="2">2 fichas</SelectItem>
                  <SelectItem value="4">4 fichas</SelectItem>
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

      {/* Fichas estilo bloquinho */}
      <div className="p-4 print:p-0">
        {Array.from({ length: totalPaginas }).map((_, pageIndex) => (
          <div 
            key={pageIndex} 
            className="max-w-4xl mx-auto bg-white mb-4 print:mb-0 shadow-lg print:shadow-none"
            style={{ pageBreakAfter: pageIndex < totalPaginas - 1 ? 'always' : 'auto' }}
          >
            <div className={`grid ${config.fichasPorPagina === 4 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-1 grid-rows-2'} print:h-[297mm]`}>
              {Array.from({ length: config.fichasPorPagina }).map((_, fichaIndex) => {
                const fichaNumero = pageIndex * config.fichasPorPagina + fichaIndex + 1;
                if (fichaNumero > config.quantidade) return null;
                
                return (
                  <div 
                    key={fichaIndex} 
                    className="border border-dashed border-slate-400 p-3 relative"
                    style={{ height: config.fichasPorPagina === 4 ? '148.5mm' : '148.5mm' }}
                  >
                    {/* Cabeçalho compacto */}
                    <div className="flex justify-between items-start border-b border-slate-900 pb-1 mb-2">
                      <div>
                        <h1 className="text-sm font-bold text-slate-900 leading-tight">{empresa?.apelido || empresa?.nome || 'FAZENDA'}</h1>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] font-bold text-slate-700">FICHA Nº</div>
                        <div className="w-12 h-5 border border-slate-400 bg-slate-50"></div>
                      </div>
                    </div>

                    {/* Linha 1: Data, Operador */}
                    <div className="grid grid-cols-3 gap-1 mb-1">
                      <div className="border border-slate-300 p-1">
                        <div className="text-[8px] text-slate-500 font-semibold">DATA</div>
                        <div className="h-4 border-b border-dotted border-slate-400"></div>
                      </div>
                      <div className="border border-slate-300 p-1 col-span-2">
                        <div className="text-[8px] text-slate-500 font-semibold">OPERADOR</div>
                        <div className="h-4 border-b border-dotted border-slate-400"></div>
                      </div>
                    </div>

                    {/* Linha 2: Operação, Área */}
                    <div className="grid grid-cols-2 gap-1 mb-1">
                      <div className="border border-slate-300 p-1">
                        <div className="text-[8px] text-slate-500 font-semibold">OPERAÇÃO</div>
                        <div className="h-4 border-b border-dotted border-slate-400"></div>
                      </div>
                      <div className="border border-slate-300 p-1">
                        <div className="text-[8px] text-slate-500 font-semibold">ÁREA/TALHÃO</div>
                        <div className="h-4 border-b border-dotted border-slate-400"></div>
                      </div>
                    </div>

                    {/* Linha 3: Máquina, Implemento */}
                    <div className="grid grid-cols-2 gap-1 mb-1">
                      <div className="border border-slate-300 p-1">
                        <div className="text-[8px] text-slate-500 font-semibold">MÁQUINA</div>
                        <div className="h-4 border-b border-dotted border-slate-400"></div>
                      </div>
                      <div className="border border-slate-300 p-1">
                        <div className="text-[8px] text-slate-500 font-semibold">IMPLEMENTO</div>
                        <div className="h-4 border-b border-dotted border-slate-400"></div>
                      </div>
                    </div>

                    {/* Horímetro */}
                    <div className="bg-slate-100 border border-slate-300 p-1 mb-1">
                      <div className="text-[8px] font-bold text-slate-700 mb-1">HORÍMETRO</div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="text-center">
                          <div className="text-[7px] text-slate-500">INÍCIO</div>
                          <div className="h-5 border border-slate-400 bg-white"></div>
                        </div>
                        <div className="text-center">
                          <div className="text-[7px] text-slate-500">FINAL</div>
                          <div className="h-5 border border-slate-400 bg-white"></div>
                        </div>
                        <div className="text-center">
                          <div className="text-[7px] text-slate-500">TOTAL</div>
                          <div className="h-5 border-2 border-slate-500 bg-slate-200 font-bold"></div>
                        </div>
                      </div>
                    </div>

                    {/* Produção */}
                    <div className="grid grid-cols-2 gap-1 mb-1">
                      <div className="bg-green-50 border border-green-300 p-1">
                        <div className="text-[8px] font-bold text-green-800">HECTARES</div>
                        <div className="flex items-center gap-1">
                          <div className="h-5 flex-1 border border-green-400 bg-white"></div>
                          <span className="text-[10px] font-semibold text-green-700">ha</span>
                        </div>
                      </div>
                      <div className="bg-amber-50 border border-amber-300 p-1">
                        <div className="text-[8px] font-bold text-amber-800">COMBUSTÍVEL</div>
                        <div className="flex items-center gap-1">
                          <div className="h-5 flex-1 border border-amber-400 bg-white"></div>
                          <span className="text-[10px] font-semibold text-amber-700">L</span>
                        </div>
                      </div>
                    </div>

                    {/* Produto */}
                    <div className="border border-slate-300 p-1 mb-1">
                      <div className="text-[8px] text-slate-500 font-semibold">PRODUTO APLICADO / QTD</div>
                      <div className="h-4 border-b border-dotted border-slate-400"></div>
                    </div>

                    {/* Observações */}
                    <div className="border border-slate-300 p-1 mb-2">
                      <div className="text-[8px] text-slate-500 font-semibold">OBS</div>
                      <div className="h-6"></div>
                    </div>

                    {/* Assinaturas */}
                    <div className="grid grid-cols-2 gap-4 absolute bottom-2 left-3 right-3">
                      <div className="text-center">
                        <div className="border-t border-slate-900 pt-0.5">
                          <div className="text-[7px] text-slate-600">Operador</div>
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="border-t border-slate-900 pt-0.5">
                          <div className="text-[7px] text-slate-600">Supervisor</div>
                        </div>
                      </div>
                    </div>

                    {/* Linha de corte */}
                    <div className="absolute -top-0.5 left-0 right-0 border-t border-dashed border-slate-300"></div>
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