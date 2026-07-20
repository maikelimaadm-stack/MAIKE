
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export default function FichaProduto({ produto, open, onClose, empresa: empresaProp = null }) {
  const empresaSelecionadaId = typeof window !== "undefined" ? localStorage.getItem("empresa_selecionada_id") : null;

  // Carrega a empresa selecionada para o cabeçalho (fallback quando não vem por prop)
  const { data: empresaCarregada } = useQuery({
    queryKey: ["empresa-ficha-produto", empresaSelecionadaId],
    queryFn: async () => {
      const empresas = await base44.entities.Empresa.list();
      return empresas.find((e) => e.id === empresaSelecionadaId) || null;
    },
    enabled: !!empresaSelecionadaId && !empresaProp && open,
  });

  const empresa = empresaProp || empresaCarregada || null;

  if (!produto) return null;

  const handlePrint = () => {
    window.print();
  };

  const estoqueAbaixoMinimo =
    (produto.estoque_minimo || 0) > 0 && (produto.estoque_atual || 0) <= (produto.estoque_minimo || 0);
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
                margin: 0.5cm;
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
              .page-footer {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                height: 20px;
                font-size: 9px;
                display: flex;
                justify-content: space-between;
                padding: 0 0.5cm;
              }
            }
          `}} />
          
          {/* Cabeçalho */}
          <div className="flex items-start justify-between border-b-2 border-black pb-4 mb-6">
            {empresa?.logotipo_url ? (
              <img
                src={empresa.logotipo_url}
                alt={empresa.apelido || empresa.nome || "Logo"}
                className="h-16 print:h-20 object-contain"
              />
            ) : (
              <div />
            )}
            <div className="text-right">
              <h1 className="text-2xl font-bold">{empresa?.nome || empresa?.apelido || "Empresa"}</h1>
              {empresa?.apelido && empresa.apelido !== empresa.nome && (
                <p className="text-sm">{empresa.apelido}</p>
              )}
              {empresa?.endereco && (
                <p className="text-xs">
                  {empresa.endereco}
                  {empresa?.cidade && empresa?.estado ? `, ${empresa.cidade} - ${empresa.estado}` : ""}
                </p>
              )}
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

          {/* Rodapé customizado */}
          <div className="page-footer hidden print:flex">
            <span>Página 1 de 1</span>
            <span>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
