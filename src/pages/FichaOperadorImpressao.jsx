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
                    className="border border-dashed border-black p-2 relative"
                    style={{ height: alturaFicha }}
                  >
                    {/* Cabeçalho compacto */}
                    <div className="flex justify-between items-center border-b-2 border-black pb-1 mb-1">
                      <h1 className="text-xs font-bold text-black leading-tight">{empresa?.apelido || empresa?.nome || 'FAZENDA'}</h1>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-bold text-black">Nº</span>
                        <div className="w-8 h-4 border border-black"></div>
                      </div>
                    </div>

                    {/* Linha 1: Data, Operador */}
                    <div className="grid grid-cols-4 gap-1 mb-1">
                      <div className="border border-black p-0.5">
                        <div className="text-[9px] text-black font-bold">DATA</div>
                        <div className="h-3 border-b border-dotted border-black"></div>
                      </div>
                      <div className="border border-black p-0.5 col-span-3">
                        <div className="text-[9px] text-black font-bold">OPERADOR</div>
                        <div className="h-3 border-b border-dotted border-black"></div>
                      </div>
                    </div>

                    {/* Linha 2: Operação, Área, Máquina */}
                    <div className="grid grid-cols-3 gap-1 mb-1">
                      <div className="border border-black p-0.5">
                        <div className="text-[9px] text-black font-bold">OPERAÇÃO</div>
                        <div className="h-3 border-b border-dotted border-black"></div>
                      </div>
                      <div className="border border-black p-0.5">
                        <div className="text-[9px] text-black font-bold">ÁREA</div>
                        <div className="h-3 border-b border-dotted border-black"></div>
                      </div>
                      <div className="border border-black p-0.5">
                        <div className="text-[9px] text-black font-bold">MÁQUINA</div>
                        <div className="h-3 border-b border-dotted border-black"></div>
                      </div>
                    </div>

                    {/* Horímetro e Produção na mesma linha */}
                    <div className="grid grid-cols-5 gap-1 mb-1">
                      <div className="border border-black p-0.5 text-center">
                        <div className="text-[8px] text-black font-bold">H.INÍCIO</div>
                        <div className="h-4 border border-black bg-white"></div>
                      </div>
                      <div className="border border-black p-0.5 text-center">
                        <div className="text-[8px] text-black font-bold">H.FINAL</div>
                        <div className="h-4 border border-black bg-white"></div>
                      </div>
                      <div className="border-2 border-black p-0.5 text-center">
                        <div className="text-[8px] text-black font-bold">TOTAL H</div>
                        <div className="h-4 border border-black"></div>
                      </div>
                      <div className="border border-black p-0.5 text-center">
                        <div className="text-[8px] text-black font-bold">HECTARES</div>
                        <div className="h-4 border border-black bg-white"></div>
                      </div>
                      <div className="border border-black p-0.5 text-center">
                        <div className="text-[8px] text-black font-bold">COMB. (L)</div>
                        <div className="h-4 border border-black bg-white"></div>
                      </div>
                    </div>

                    {/* Produto e Obs */}
                    <div className="grid grid-cols-2 gap-1 mb-1">
                      <div className="border border-black p-0.5">
                        <div className="text-[9px] text-black font-bold">PRODUTO/QTD</div>
                        <div className="h-3 border-b border-dotted border-black"></div>
                      </div>
                      <div className="border border-black p-0.5">
                        <div className="text-[9px] text-black font-bold">OBS</div>
                        <div className="h-3 border-b border-dotted border-black"></div>
                      </div>
                    </div>

                    {/* Assinaturas */}
                    <div className="grid grid-cols-2 gap-2 absolute bottom-1 left-2 right-2">
                      <div className="text-center">
                        <div className="border-t border-black pt-0.5">
                          <div className="text-[8px] text-black font-semibold">Operador</div>
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="border-t border-black pt-0.5">
                          <div className="text-[8px] text-black font-semibold">Supervisor</div>
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