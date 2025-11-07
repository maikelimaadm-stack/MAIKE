import React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export default function TicketPesagem({ pesagem, open, onClose }) {
  // Buscar dados da empresa
  const { data: empresaAtual } = useQuery({
    queryKey: ['empresa-ticket', pesagem?.empresa_id],
    queryFn: async () => {
      if (!pesagem?.empresa_id) return null;
      const empresas = await base44.entities.Empresa.list();
      return empresas.find(e => e.id === pesagem.empresa_id) || null;
    },
    enabled: !!pesagem?.empresa_id,
  });

  const handlePrint = () => {
    window.print();
  };

  if (!pesagem) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
        <div className="print:hidden flex justify-end gap-2 mb-4">
          <Button onClick={handlePrint} className="gap-2">
            <Printer className="w-4 h-4" />
            Imprimir
          </Button>
          <Button onClick={onClose} variant="outline" className="gap-2">
            <X className="w-4 h-4" />
            Fechar
          </Button>
        </div>

        <div className="bg-white p-8 print:p-4">
          <style dangerouslySetInnerHTML={{__html: `
            @media print {
              @page {
                size: A4;
                margin: 1cm;
              }
              body * {
                visibility: hidden;
              }
              .ticket-print, .ticket-print * {
                visibility: visible;
              }
              .ticket-print {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
              }
            }
          `}} />

          <div className="ticket-print">
            {/* Cabeçalho com dados da empresa */}
            <div className="flex items-start justify-between border-b-2 border-black pb-4 mb-6">
              {empresaAtual?.logotipo_url ? (
                <img 
                  src={empresaAtual.logotipo_url} 
                  alt={empresaAtual.apelido}
                  className="h-20 object-contain"
                />
              ) : (
                <div className="w-20 h-20 bg-gray-200 rounded flex items-center justify-center">
                  <span className="text-xs text-gray-500">Logo</span>
                </div>
              )}
              <div className="text-right">
                <h1 className="text-2xl font-bold">{empresaAtual?.apelido || empresaAtual?.nome || 'Empresa'}</h1>
                <p className="text-base">{empresaAtual?.nome || ''}</p>
                {empresaAtual?.endereco && <p className="text-sm">{empresaAtual.endereco}</p>}
                {empresaAtual?.cidade && empresaAtual?.estado && (
                  <p className="text-sm">{empresaAtual.cidade} - {empresaAtual.estado}</p>
                )}
                {empresaAtual?.telefone && <p className="text-sm">Tel: {empresaAtual.telefone}</p>}
                {empresaAtual?.email && <p className="text-sm">E-mail: {empresaAtual.email}</p>}
              </div>
            </div>

            {/* Título */}
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold">TICKET DE PESAGEM</h2>
              <p className="text-lg mt-2">Nº {pesagem.numero_registro}</p>
            </div>

            {/* Dados da Pesagem */}
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="border-b border-gray-300 pb-2">
                  <p className="text-sm text-gray-600">Data:</p>
                  <p className="text-lg font-bold">
                    {pesagem.data_pesagem ? format(new Date(pesagem.data_pesagem), "dd/MM/yyyy", { locale: ptBR }) : '-'}
                  </p>
                </div>
                <div className="border-b border-gray-300 pb-2">
                  <p className="text-sm text-gray-600">Tipo:</p>
                  <p className="text-lg font-bold">{pesagem.tipo_pesagem}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="border-b border-gray-300 pb-2">
                  <p className="text-sm text-gray-600">Placa:</p>
                  <p className="text-lg font-bold uppercase">{pesagem.placa_caminhao || '-'}</p>
                </div>
                <div className="border-b border-gray-300 pb-2">
                  <p className="text-sm text-gray-600">Motorista:</p>
                  <p className="text-lg font-bold">{pesagem.nome_motorista || '-'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="border-b border-gray-300 pb-2">
                  <p className="text-sm text-gray-600">Produto:</p>
                  <p className="text-lg font-bold">{pesagem.produto || '-'}</p>
                </div>
                <div className="border-b border-gray-300 pb-2">
                  <p className="text-sm text-gray-600">Fornecedor/Destino:</p>
                  <p className="text-lg font-bold">{pesagem.fornecedor_destino || '-'}</p>
                </div>
              </div>

              {/* Pesos */}
              <div className="bg-gray-100 p-4 rounded-lg">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-sm text-gray-600">Peso Tara</p>
                    <p className="text-2xl font-bold text-blue-600">{formatarNumero(pesagem.peso_tara)} kg</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Peso Bruto</p>
                    <p className="text-2xl font-bold text-purple-600">{formatarNumero(pesagem.peso_bruto)} kg</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Peso Líquido</p>
                    <p className="text-3xl font-bold text-green-600">{formatarNumero(pesagem.peso_liquido)} kg</p>
                  </div>
                </div>
              </div>

              {/* Observações */}
              {pesagem.observacoes && (
                <div className="border-t border-gray-300 pt-4">
                  <p className="text-sm text-gray-600 mb-2">Observações:</p>
                  <p className="text-base">{pesagem.observacoes}</p>
                </div>
              )}

              {/* Assinaturas */}
              <div className="grid grid-cols-2 gap-8 mt-12">
                <div className="text-center">
                  <div className="border-t border-black pt-2">
                    <p className="text-sm">Operador</p>
                  </div>
                </div>
                <div className="text-center">
                  <div className="border-t border-black pt-2">
                    <p className="text-sm">Responsável</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Rodapé */}
            <div className="mt-8 text-center text-xs text-gray-500">
              <p>Emitido em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}