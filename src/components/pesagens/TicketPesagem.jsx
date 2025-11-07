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

  // Usar numero_registro ao invés do id para o romaneio
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
      <DialogContent className="max-w-md p-0 print:max-w-full print:shadow-none print:border-0 print:p-0">
        <div className="print:hidden flex justify-end gap-2 p-4 border-b">
          <Button onClick={handlePrint} size="sm" className="gap-2 bg-green-600 hover:bg-green-700">
            <Printer className="w-4 h-4" />
            Imprimir
          </Button>
          <Button variant="outline" onClick={onClose} size="sm" className="gap-2">
            <X className="w-4 h-4" />
            Fechar
          </Button>
        </div>

        <div id="ticket-content" className="p-6 print:p-2">
          <style dangerouslySetInnerHTML={{__html: `
            @media print {
              @page {
                size: 80mm auto;
                margin: 0;
              }
              body {
                margin: 0;
                padding: 0;
              }
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
                width: 80mm;
                padding: 3mm;
                margin: 0;
              }
              .print\\:hidden {
                display: none !important;
              }
            }
          `}} />
          
          {/* Ticket Térmico 80mm */}
          <div className="bg-white font-mono text-xs leading-tight" style={{ width: '80mm', fontFamily: 'Courier New, monospace', fontSize: '11px' }}>
            {/* Logo e Cabeçalho */}
            <div className="text-center mb-3">
              <img 
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
                alt="Fazenda Palmital"
                className="mx-auto mb-2"
                style={{ maxWidth: '120px', height: 'auto' }}
              />
              <div className="font-bold text-sm">FAZENDA PALMITAL</div>
              <div className="mt-1" style={{ lineHeight: '1.3' }}>
                Email: fazendapalmital@gmail.com<br/>
                Insc. Est. 13.261.179-1<br/>
                CPF 705.881.208-04<br/>
                Cel (65) 9 9916-3376<br/>
                Vila Bela da Santíssima Trindade (MT)
              </div>
            </div>

            {/* Linha separadora */}
            <div className="border-t-2 border-dashed border-black my-2"></div>

            {/* Dados Principais */}
            <div className="space-y-1 mb-2">
              <div>ROMANEIO...: {romaneio}</div>
              <div className="break-words">Forn./Desti....: {pesagem.fornecedor_destino?.toUpperCase() || 'NÃO INFORMADO'}</div>
              <div className="break-words">Produto........: {pesagem.produto?.toUpperCase() || 'NÃO INFORMADO'}</div>
              <div>Data...........: {formatarData(pesagem.data_pesagem)}</div>
              <div>Placa..........: {pesagem.placa_caminhao?.toUpperCase() || 'NÃO INFORMADO'}</div>
              <div>Motorista......: {pesagem.nome_motorista?.toUpperCase() || 'NÃO INFORMADO'}</div>
            </div>

            {/* Linha separadora */}
            <div className="border-t-2 border-dashed border-black my-2"></div>

            {/* Dados da Pesagem */}
            <div className="text-center font-bold mb-1">Dados Pesagem</div>
            <div className="space-y-1 mb-2">
              <div>Tara...........: {formatarNumero(pesagem.peso_tara)} kg</div>
              <div>Bruto..........: {formatarNumero(pesagem.peso_bruto)} kg</div>
              <div>Líquido........: {formatarNumero(pesagem.peso_liquido)} kg</div>
            </div>

            {/* Linha separadora */}
            <div className="border-t-2 border-dashed border-black my-2"></div>

            {/* Observação */}
            {pesagem.observacoes && (
              <>
                <div className="text-center font-bold mb-1">Observação</div>
                <div className="break-words mb-2">{pesagem.observacoes?.toUpperCase()}</div>
                <div className="border-t-2 border-dashed border-black my-2"></div>
              </>
            )}

            {/* Rodapé */}
            <div className="text-center text-xs">
              Data e hora impressão: {format(new Date(), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}