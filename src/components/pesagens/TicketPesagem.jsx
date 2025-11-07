import React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export default function TicketPesagem({ pesagem, open, onClose }) {
  if (!pesagem) return null;

  const handlePrint = () => {
    window.print();
  };

  // Usar numero_registro para o romaneio (formato: 000001)
  const romaneio = pesagem.numero_registro ? String(pesagem.numero_registro).padStart(6, '0') : '------';

  const formatarData = (dataString) => {
    if (!dataString) return '--/--/----';
    try {
      const date = new Date(dataString);
      if (isNaN(date.getTime())) return '--/--/----';
      return format(date, "dd/MM/yyyy", { locale: ptBR });
    } catch {
      return '--/--/----';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[280px] p-0">
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page {
              size: 60mm auto;
              margin: 0;
            }
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              width: 60mm !important;
            }
            body * {
              visibility: hidden !important;
            }
            #ticket-print-area,
            #ticket-print-area * {
              visibility: visible !important;
            }
            #ticket-print-area {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 60mm !important;
              margin: 0 !important;
              padding: 2mm !important;
            }
          }
        `}} />
        
        <div className="print:hidden flex justify-end gap-2 p-3 border-b">
          <Button onClick={handlePrint} size="sm" className="gap-2 bg-green-600 hover:bg-green-700">
            <Printer className="w-4 h-4" />
            Imprimir
          </Button>
          <Button variant="outline" onClick={onClose} size="sm" className="gap-2">
            <X className="w-4 h-4" />
            Fechar
          </Button>
        </div>

        <div id="ticket-print-area" className="p-4 print:p-0">
          {/* Ticket Térmico 60mm */}
          <div className="bg-white font-mono text-xs leading-tight" style={{ width: '60mm', fontFamily: 'Courier New, monospace', fontSize: '10px' }}>
            {/* Logo e Cabeçalho */}
            <div className="text-center mb-2">
              <img 
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
                alt="Fazenda Palmital"
                className="mx-auto mb-1"
                style={{ maxWidth: '80px', height: 'auto' }}
              />
              <div className="font-bold text-xs">FAZENDA PALMITAL</div>
              <div className="text-[9px]" style={{ lineHeight: '1.2' }}>
                fazendapalmital@gmail.com<br/>
                Insc. Est. 13.261.179-1<br/>
                CPF 705.881.208-04<br/>
                (65) 9 9916-3376<br/>
                Vila Bela da Santissima Trindade-MT
              </div>
            </div>

            {/* Linha separadora */}
            <div className="border-t-2 border-dashed border-black my-1"></div>

            {/* Dados Principais */}
            <div className="space-y-0.5 mb-1 text-[9px]">
              <div><strong>ROMANEIO:</strong> {romaneio}</div>
              <div className="break-words"><strong>Forn/Dest:</strong> {pesagem.fornecedor_destino?.toUpperCase() || 'NAO INFORMADO'}</div>
              <div className="break-words"><strong>Produto:</strong> {pesagem.produto?.toUpperCase() || 'NAO INFORMADO'}</div>
              <div><strong>Data:</strong> {formatarData(pesagem.data_pesagem)}</div>
              <div><strong>Placa:</strong> {pesagem.placa_caminhao?.toUpperCase() || 'NAO INFORMADO'}</div>
              <div className="break-words"><strong>Motorista:</strong> {pesagem.nome_motorista?.toUpperCase() || 'NAO INFORMADO'}</div>
            </div>

            {/* Linha separadora */}
            <div className="border-t-2 border-dashed border-black my-1"></div>

            {/* Dados da Pesagem */}
            <div className="text-center font-bold mb-0.5 text-[9px]">DADOS PESAGEM</div>
            <div className="space-y-0.5 mb-1 text-[9px]">
              <div><strong>Tara:</strong> {formatarNumero(pesagem.peso_tara)} kg</div>
              <div><strong>Bruto:</strong> {formatarNumero(pesagem.peso_bruto)} kg</div>
              <div><strong>Liquido:</strong> {formatarNumero(pesagem.peso_liquido)} kg</div>
            </div>

            {/* Linha separadora */}
            <div className="border-t-2 border-dashed border-black my-1"></div>

            {/* Observação */}
            {pesagem.observacoes && (
              <>
                <div className="text-center font-bold mb-0.5 text-[9px]">OBSERVACAO</div>
                <div className="break-words mb-1 text-[9px]">{pesagem.observacoes?.toUpperCase()}</div>
                <div className="border-t-2 border-dashed border-black my-1"></div>
              </>
            )}

            {/* Rodapé */}
            <div className="text-center text-[8px]">
              Impresso em: {format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}