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

export default function FichaProduto({ produto, open, onClose }) {
  if (!produto) return null;

  const handlePrint = () => {
    window.print();
  };

  const estoqueAbaixoMinimo = (produto.estoque_atual || 0) <= (produto.estoque_minimo || 0);
  const margemLucro = produto.preco_custo > 0 
    ? (((produto.preco_venda - produto.preco_custo) / produto.preco_custo) * 100).toFixed(2) 
    : 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl p-0 print:max-w-full print:shadow-none print:border-0">
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

        <div id="ficha-content" className="p-8">
          <style dangerouslySetInnerHTML={{__html: `
            @media print {
              @page {
                size: A4;
                margin: 1cm;
              }
              body * {
                visibility: hidden;
              }
              #ficha-content,
              #ficha-content * {
                visibility: visible;
              }
              #ficha-content {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
              }
            }
          `}} />
          
          {/* Cabeçalho */}
          <div className="flex items-start justify-between border-b-2 border-black pb-4 mb-6">
            <img 
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
              alt="Fazenda Palmital"
              className="h-16 print:h-20"
            />
            <div className="text-right">
              <h1 className="text-2xl font-bold">Fazenda Palmital</h1>
              <p className="text-sm">Antonio Lemos Beraldo</p>
              <p className="text-xs">Vila Bela da Ss. Trindade - MT</p>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-xl font-bold text-center">FICHA DE PRODUTO</h2>
          </div>

          {/* Nome do Produto */}
          <div className="mb-6">
            <p className="text-xs text-gray-600 uppercase">Nome do Produto</p>
            <p className="font-bold text-2xl border-b-2 border-gray-300">{produto.nome_produto}</p>
          </div>

          {/* Códigos e Categoria */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div>
              <p className="text-xs text-gray-600 uppercase">Código Interno</p>
              <p className="font-semibold border-b border-gray-300">{produto.codigo_interno || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase">Código de Barras</p>
              <p className="font-semibold font-mono border-b border-gray-300">{produto.codigo_barras || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase">Categoria</p>
              <p className="font-semibold border-b border-gray-300">{produto.categoria || '-'}</p>
            </div>
          </div>

          {/* Descrição */}
          {produto.descricao && (
            <div className="mb-6">
              <p className="text-xs text-gray-600 uppercase">Descrição</p>
              <p className="border border-gray-300 p-3 rounded min-h-[60px]">{produto.descricao}</p>
            </div>
          )}

          {/* Preços e Unidade */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div>
              <p className="text-xs text-gray-600 uppercase">Unidade</p>
              <p className="font-bold text-lg border-b border-gray-300">{produto.unidade_medida}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase">Preço de Custo</p>
              <p className="font-bold text-lg border-b border-gray-300">R$ {formatarNumero(produto.preco_custo || 0)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase">Preço de Venda</p>
              <p className="font-bold text-lg text-green-700 border-b border-gray-300">R$ {formatarNumero(produto.preco_venda || 0)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase">Margem de Lucro</p>
              <p className="font-bold text-lg border-b border-gray-300">{margemLucro}%</p>
            </div>
          </div>

          {/* Estoque */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className={estoqueAbaixoMinimo ? 'bg-orange-100 p-3 rounded' : ''}>
              <p className="text-xs text-gray-600 uppercase">Estoque Atual</p>
              <p className={`font-bold text-2xl ${estoqueAbaixoMinimo ? 'text-orange-700' : 'text-slate-900'}`}>
                {formatarNumero(produto.estoque_atual || 0)} {produto.unidade_medida}
              </p>
              {estoqueAbaixoMinimo && (
                <p className="text-xs text-orange-700 font-semibold mt-1">⚠️ Estoque abaixo do mínimo!</p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase">Estoque Mínimo</p>
              <p className="font-bold text-2xl">{formatarNumero(produto.estoque_minimo || 0)} {produto.unidade_medida}</p>
            </div>
          </div>

          {/* Observações */}
          {produto.observacoes && (
            <div className="mb-6">
              <p className="text-xs text-gray-600 uppercase">Observações</p>
              <p className="border border-gray-300 p-3 rounded min-h-[60px]">{produto.observacoes}</p>
            </div>
          )}

          {/* Rodapé */}
          <div className="text-center text-xs text-gray-500 mt-8 pt-4 border-t">
            Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}