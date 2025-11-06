import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function TicketPesagem({ pesagem, open, onClose }) {
  if (!pesagem) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md print:max-w-full print:shadow-none">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center justify-between">
            <span>Ticket de Pesagem</span>
            <Button onClick={handlePrint} size="sm" className="gap-2">
              <Printer className="w-4 h-4" />
              Imprimir
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="print:p-0" id="ticket-content">
          <style jsx>{`
            @media print {
              @page {
                size: 80mm auto;
                margin: 0;
              }
              body {
                margin: 0;
                padding: 0;
              }
            }
          `}</style>
          
          {/* Ticket Térmico 80mm */}
          <div className="bg-white p-4 font-mono text-sm" style={{ width: '80mm', fontFamily: 'Courier New, monospace' }}>
            {/* Cabeçalho */}
            <div className="text-center border-b border-dashed border-black pb-2 mb-2">
              <div className="font-bold text-base">FAZENDA PALMITAL</div>
              <div className="text-xs leading-tight mt-1">
                Email: fazendapalmital@gmail.com<br/>
                Insc. Est.: 13.261.179-1<br/>
                CPF: 705.881.208-04<br/>
                Cel: (65) 9 9916-3376<br/>
                Vila Bela da Santíssima Trindade (MT)
              </div>
            </div>

            {/* Dados Principais */}
            <div className="text-xs space-y-0.5 border-b border-dashed border-black pb-2 mb-2">
              <div>ROMANEIO....: {pesagem.id?.substring(0, 8).toUpperCase() || '--------'}</div>
              <div>Forn./Desti.: {pesagem.fornecedor_destino?.toUpperCase() || 'NÃO INFORMADO'}</div>
              <div>Produto.....: {pesagem.produto?.toUpperCase()}</div>
              <div>Data........: {format(new Date(pesagem.data_pesagem), "dd/MM/yyyy", { locale: ptBR })}</div>
              <div>Placa.......: {pesagem.placa_caminhao?.toUpperCase()}</div>
              <div>Motorista...: {pesagem.nome_motorista?.toUpperCase()}</div>
            </div>

            {/* Dados da Pesagem */}
            <div className="border-b border-dashed border-black pb-2 mb-2">
              <div className="text-center font-bold text-xs mb-1">Dados da Pesagem</div>
              <div className="text-xs space-y-0.5">
                <div>Tara........: {pesagem.peso_tara?.toFixed(3).replace('.', ',')}</div>
                <div>Bruto.......: {pesagem.peso_bruto?.toFixed(3).replace('.', ',')}</div>
                <div className="font-bold">Líquido.....: {pesagem.peso_liquido?.toFixed(3).replace('.', ',')}</div>
              </div>
            </div>

            {/* Observação */}
            {pesagem.observacoes && (
              <div className="border-b border-dashed border-black pb-2 mb-2">
                <div className="text-xs font-bold">Observação:</div>
                <div className="text-xs whitespace-pre-wrap">{pesagem.observacoes?.toUpperCase()}</div>
              </div>
            )}

            {/* Rodapé */}
            <div className="text-center text-xs">
              <div>Data e hora de impressão:</div>
              <div>{format(new Date(), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR })}</div>
            </div>
          </div>
        </div>

        <div className="print:hidden flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose} className="gap-2">
            <X className="w-4 h-4" />
            Fechar
          </Button>
        </div>
      </DialogContent>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #ticket-content,
          #ticket-content * {
            visibility: visible;
          }
          #ticket-content {
            position: absolute;
            left: 0;
            top: 0;
          }
        }
      `}</style>
    </Dialog>
  );
}