import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X, Scale } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function TicketPesagem({ pesagem, open, onClose }) {
  if (!pesagem) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl print:max-w-full">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Scale className="w-5 h-5" />
              Ticket de Pesagem
            </span>
            <div className="flex gap-2">
              <Button onClick={handlePrint} size="sm" className="gap-2">
                <Printer className="w-4 h-4" />
                Imprimir
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="print:p-8" id="ticket-content">
          {/* Header do Ticket */}
          <div className="text-center border-b-2 border-slate-800 pb-6 mb-6">
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center">
                <Scale className="w-7 h-7 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-slate-900">WeighFlow</h1>
            </div>
            <p className="text-slate-600 font-medium">Sistema de Controle de Pesagens</p>
            <p className="text-sm text-slate-500 mt-1">
              Ticket gerado em {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
            </p>
          </div>

          {/* Informações Principais */}
          <div className="space-y-6 mb-6">
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Informações da Pesagem</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Data da Pesagem</p>
                  <p className="text-lg font-semibold text-slate-900">
                    {format(new Date(pesagem.data_pesagem), "dd/MM/yyyy", { locale: ptBR })}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Tipo de Pesagem</p>
                  <p className="text-lg font-semibold text-slate-900">{pesagem.tipo_pesagem}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Veículo e Motorista</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Placa do Caminhão</p>
                  <p className="text-lg font-bold text-blue-700 uppercase">{pesagem.placa_caminhao}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Nome do Motorista</p>
                  <p className="text-lg font-semibold text-slate-900">{pesagem.nome_motorista}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Produto e Origem/Destino</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Produto/Insumo</p>
                  <p className="text-lg font-semibold text-slate-900">{pesagem.produto}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Fornecedor/Destino</p>
                  <p className="text-lg font-semibold text-slate-900">{pesagem.fornecedor_destino || '-'}</p>
                </div>
              </div>
            </div>

            {/* Pesos - Destaque Principal */}
            <div className="bg-gradient-to-br from-blue-50 to-slate-50 rounded-xl p-6 border-2 border-blue-300">
              <h2 className="text-xl font-bold text-slate-900 mb-6 text-center">Medições de Peso</h2>
              <div className="grid grid-cols-3 gap-6">
                <div className="text-center">
                  <p className="text-xs text-slate-600 uppercase tracking-wider mb-2 font-semibold">Peso Tara</p>
                  <div className="bg-white rounded-lg p-4 border-2 border-slate-300">
                    <p className="text-3xl font-bold text-slate-700">{pesagem.peso_tara?.toFixed(2)}</p>
                    <p className="text-sm text-slate-500 mt-1">kg</p>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-600 uppercase tracking-wider mb-2 font-semibold">Peso Bruto</p>
                  <div className="bg-white rounded-lg p-4 border-2 border-slate-300">
                    <p className="text-3xl font-bold text-slate-700">{pesagem.peso_bruto?.toFixed(2)}</p>
                    <p className="text-sm text-slate-500 mt-1">kg</p>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-xs text-green-700 uppercase tracking-wider mb-2 font-bold">Peso Líquido</p>
                  <div className="bg-green-500 rounded-lg p-4 border-2 border-green-600 shadow-lg">
                    <p className="text-4xl font-bold text-white">{pesagem.peso_liquido?.toFixed(2)}</p>
                    <p className="text-sm text-green-100 mt-1 font-semibold">kg</p>
                  </div>
                </div>
              </div>
              <p className="text-center text-xs text-slate-500 mt-4 font-mono">
                Cálculo: {pesagem.peso_bruto?.toFixed(2)} kg - {pesagem.peso_tara?.toFixed(2)} kg = {pesagem.peso_liquido?.toFixed(2)} kg
              </p>
            </div>

            {pesagem.observacoes && (
              <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-300">
                <h2 className="text-lg font-bold text-slate-900 mb-2">Observações</h2>
                <p className="text-slate-700 whitespace-pre-wrap">{pesagem.observacoes}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t-2 border-slate-800 pt-6 mt-8">
            <div className="text-center space-y-2">
              <p className="text-sm text-slate-600">
                Este documento comprova a pesagem realizada no sistema WeighFlow
              </p>
              <p className="text-xs text-slate-500 font-mono">
                Registro ID: {pesagem.id}
              </p>
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
            width: 100%;
          }
        }
      `}</style>
    </Dialog>
  );
}