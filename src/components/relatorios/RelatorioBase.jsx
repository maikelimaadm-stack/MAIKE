import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function RelatorioBase({ 
  titulo, 
  subtitulo,
  empresaAtual,
  filtros,
  children,
  orientacao = "paisagem",
  resumoTotais
}) {
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 space-y-2">
      {/* Cabeçalho da Página */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{titulo}</h1>
          {subtitulo && <p className="text-xs text-slate-600">{subtitulo}</p>}
        </div>
        <Button onClick={() => window.print()} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
          <Printer className="w-3.5 h-3.5" />
          Imprimir
        </Button>
      </div>

      {/* Filtros */}
      {filtros && (
        <Card className="print:hidden">
          <CardContent className="p-4">
            {filtros}
          </CardContent>
        </Card>
      )}

      {/* Área de Impressão */}
      <div className={`bg-white print:shadow-none ${orientacao === 'paisagem' ? 'print:landscape' : ''}`}>
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page { size: ${orientacao === 'paisagem' ? 'A4 landscape' : 'A4 portrait'}; margin: 1.5cm 1cm 2cm 1cm; }
            body * { visibility: hidden; }
            .print-area, .print-area * { visibility: visible; }
            .print-area { position: absolute; left: 0; top: 0; width: 100%; }
            header, nav, .no-print, .print\\:hidden { display: none !important; }
          }
        `}} />

        <div className="print-area p-8 print:p-0">
          {/* Cabeçalho do Relatório */}
          <div className="border-b-2 border-black pb-1 mb-2">
            <div className="flex items-center justify-between gap-3">
              {empresaAtual?.logotipo_url && (
                <img src={empresaAtual.logotipo_url} alt={empresaAtual.apelido || "Logo"} className="h-24 w-24 object-contain" />
              )}
              <div className="flex-1 text-center">
                <h1 className="text-base font-bold leading-tight uppercase">{empresaAtual?.nome || 'Empresa'}</h1>
                {empresaAtual?.apelido && empresaAtual.apelido !== empresaAtual.nome && (
                  <p className="text-xs leading-tight">{empresaAtual.apelido}</p>
                )}
                {empresaAtual?.endereco && (
                  <p className="text-xs leading-tight">
                    {empresaAtual.endereco}
                    {empresaAtual?.cidade && empresaAtual?.estado && `, ${empresaAtual.cidade}-${empresaAtual.estado}`}
                  </p>
                )}
              </div>
            </div>
            <div>
              <h2 className="text-base font-bold">{titulo}</h2>
              {resumoTotais && <p className="text-xs text-gray-600">{resumoTotais}</p>}
            </div>
          </div>

          {/* Conteúdo do Relatório */}
          {children}

          {/* Rodapé */}
          <div className="mt-6 pt-2 border-t border-gray-300 text-center text-xs text-gray-500">
            <p>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
        </div>
      </div>
    </div>
  );
}