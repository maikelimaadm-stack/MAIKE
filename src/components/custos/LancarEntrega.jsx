import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Truck, Package, Calendar, CheckCircle, FileText, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export default function LancarEntrega({ custo, open, onClose, onSuccess }) {
  const [quantidadeEntregue, setQuantidadeEntregue] = useState("");
  const [dataEntrega, setDataEntrega] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [numeroNfe, setNumeroNfe] = useState("");
  const [chaveNfe, setChaveNfe] = useState("");
  const [observacoesNfe, setObservacoesNfe] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const qtdEntrega = parseFloat(quantidadeEntregue);
    if (isNaN(qtdEntrega) || qtdEntrega <= 0) {
      toast.error('Informe uma quantidade válida!');
      return;
    }

    const qtdJaEntregue = custo.quantidade_entregue || 0;
    const qtdRestante = custo.quantidade - qtdJaEntregue;

    if (qtdEntrega > qtdRestante) {
      toast.error(`Quantidade excede o restante a entregar (${formatarNumero(qtdRestante)} ${custo.unidade_medida})!`);
      return;
    }

    setIsSubmitting(true);

    try {
      const novaQuantidadeEntregue = qtdJaEntregue + qtdEntrega;
      const statusEntrega = novaQuantidadeEntregue >= custo.quantidade ? 'Entregue' : 'Em Trânsito';

      // 1. Atualizar o custo com nova quantidade entregue
      await base44.entities.CustoSafra.update(custo.id, {
        quantidade_entregue: novaQuantidadeEntregue,
        data_entrega: dataEntrega,
        status_entrega: statusEntrega
      });

      // 2. Criar registro no histórico de entregas
      await base44.entities.HistoricoEntrega.create({
        empresa_id: custo.empresa_id,
        custo_safra_id: custo.id,
        safra_id: custo.safra_id,
        fornecedor_id: custo.fornecedor_id,
        fornecedor_nome: custo.fornecedor_nome,
        produto_id: custo.produto_id,
        produto_nome: custo.produto_nome,
        quantidade_entregue: qtdEntrega,
        unidade_medida: custo.unidade_medida,
        data_entrega: dataEntrega,
        numero_nfe: numeroNfe?.toUpperCase() || undefined,
        chave_nfe: chaveNfe || undefined,
        observacoes_nfe: observacoesNfe?.toUpperCase() || undefined,
        observacoes: observacoes?.toUpperCase() || undefined
      });

      // 3. DAR ENTRADA NO ESTOQUE DO PRODUTO
      try {
        const produto = await base44.entities.Produto.list();
        const produtoEncontrado = produto.find(p => p.id === custo.produto_id);
        
        if (produtoEncontrado) {
          const estoqueAtual = produtoEncontrado.estoque_atual || 0;
          const novoEstoque = estoqueAtual + qtdEntrega;
          
          await base44.entities.Produto.update(custo.produto_id, {
            estoque_atual: novoEstoque
          });
          
          toast.success(`✅ Entrega lançada! Estoque atualizado: ${formatarNumero(novoEstoque)} ${custo.unidade_medida}`);
        } else {
          toast.success(`✅ Entrega de ${formatarNumero(qtdEntrega)} ${custo.unidade_medida} lançada!`);
          toast.warning('⚠️ Produto não encontrado para atualizar estoque.');
        }
      } catch (error) {
        console.error('Erro ao atualizar estoque:', error);
        toast.success(`✅ Entrega de ${formatarNumero(qtdEntrega)} ${custo.unidade_medida} lançada!`);
        toast.warning('⚠️ Erro ao atualizar estoque do produto.');
      }
      
      // Limpar formulário
      setQuantidadeEntregue("");
      setNumeroNfe("");
      setChaveNfe("");
      setObservacoesNfe("");
      setObservacoes("");
      
      onSuccess();
    } catch (error) {
      console.error('Erro ao lançar entrega:', error);
      toast.error('Erro ao lançar entrega. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!custo) return null;

  const qtdJaEntregue = custo.quantidade_entregue || 0;
  const qtdRestante = custo.quantidade - qtdJaEntregue;
  const percentualEntregue = (qtdJaEntregue / custo.quantidade) * 100;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-green-600" />
            Lançar Entrega
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Alerta sobre atualização de estoque */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold">Atualização Automática de Estoque</p>
              <p>A quantidade entregue será automaticamente adicionada ao estoque do produto.</p>
            </div>
          </div>

          {/* Informações do Pedido */}
          <Card className="bg-slate-50 border-slate-200">
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-600">Fornecedor</p>
                  <p className="font-bold text-slate-900">{custo.fornecedor_nome}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Produto</p>
                  <p className="font-bold text-slate-900">{custo.produto_nome}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-slate-600">Quantidade Total</p>
                  <p className="font-bold text-green-700">
                    {formatarNumero(custo.quantidade)} {custo.unidade_medida}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Já Entregue</p>
                  <p className="font-bold text-blue-700">
                    {formatarNumero(qtdJaEntregue)} {custo.unidade_medida}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Restante</p>
                  <p className="font-bold text-orange-700">
                    {formatarNumero(qtdRestante)} {custo.unidade_medida}
                  </p>
                </div>
              </div>

              {/* Barra de Progresso */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-600">
                  <span>Progresso da Entrega</span>
                  <span>{percentualEntregue.toFixed(1)}%</span>
                </div>
                <Progress value={percentualEntregue} className="h-2" />
              </div>
            </CardContent>
          </Card>

          {/* Formulário de Lançamento */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-green-600" />
                  Quantidade Entregue *
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={quantidadeEntregue}
                  onChange={(e) => setQuantidadeEntregue(e.target.value)}
                  placeholder={`0.00 (máx: ${formatarNumero(qtdRestante)})`}
                  required
                  className="border-slate-300 focus:border-green-500 text-lg font-semibold"
                  disabled={isSubmitting || qtdRestante <= 0}
                />
                <p className="text-xs text-slate-500">
                  Unidade: {custo.unidade_medida}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  Data da Entrega *
                </Label>
                <Input
                  type="date"
                  value={dataEntrega}
                  onChange={(e) => setDataEntrega(e.target.value)}
                  required
                  className="border-slate-300 focus:border-green-500"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Dados da NF-e */}
            <div className="border-t pt-4">
              <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                Dados da Nota Fiscal
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Número da NF-e</Label>
                  <Input
                    value={numeroNfe}
                    onChange={(e) => setNumeroNfe(e.target.value)}
                    placeholder="000000"
                    className="border-slate-300 focus:border-green-500 uppercase"
                    style={{ textTransform: 'uppercase' }}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Chave de Acesso NF-e</Label>
                  <Input
                    value={chaveNfe}
                    onChange={(e) => setChaveNfe(e.target.value)}
                    placeholder="44 dígitos"
                    maxLength={44}
                    className="border-slate-300 focus:border-green-500"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div className="space-y-2 mt-4">
                <Label>Observações da NF-e</Label>
                <Textarea
                  value={observacoesNfe}
                  onChange={(e) => setObservacoesNfe(e.target.value)}
                  placeholder="INFORMAÇÕES SOBRE A NOTA FISCAL..."
                  className="border-slate-300 focus:border-green-500 min-h-16 uppercase"
                  style={{ textTransform: 'uppercase' }}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Observações Gerais */}
            <div className="space-y-2">
              <Label>Observações da Entrega</Label>
              <Textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="OBSERVAÇÕES GERAIS SOBRE ESTA ENTREGA..."
                className="border-slate-300 focus:border-green-500 min-h-16 uppercase"
                style={{ textTransform: 'uppercase' }}
                disabled={isSubmitting}
              />
            </div>

            {qtdRestante <= 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <p className="text-sm text-green-800 font-medium">
                  Pedido já foi entregue completamente!
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button 
                type="submit" 
                className="bg-green-600 hover:bg-green-700"
                disabled={isSubmitting || qtdRestante <= 0}
              >
                {isSubmitting ? (
                  <>Lançando...</>
                ) : (
                  <>
                    <Truck className="w-4 h-4 mr-2" />
                    Lançar Entrega
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}