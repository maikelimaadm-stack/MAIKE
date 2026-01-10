import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import FormularioMovimentacao from "../components/movimentacoes/FormularioMovimentacao";

export default function LancamentoProdutosEstoque() {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: produtos = [], isLoading: loadingProdutos } = useQuery({
    queryKey: ["produtos_lanc_entrada", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((p) => !p.empresa_id || p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ["fornecedores_lanc_entrada", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter((f) => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const handleSubmit = async (dados) => {
    try {
      const produtos = dados.produtos || [];
      if (!dados.tipo_movimentacao) dados.tipo_movimentacao = "Entrada";

      // Cria uma movimentação por produto selecionado (mantendo padrão da entidade)
      for (const p of produtos) {
        await base44.entities.MovimentacaoEstoque.create({
          empresa_id: empresaSelecionadaId,
          tipo_movimentacao: "Entrada",
          tipo_detalhado: dados.tipo_detalhado,
          produto_id: p.produto_id,
          produto_nome: p.produto_nome,
          produto_codigo: p.produto_codigo,
          unidade_medida: p.unidade_medida,
          quantidade: p.quantidade,
          valor_unitario: p.valor_unitario,
          valor_total: p.valor_total,
          local_estoque_destino: dados.local_estoque_destino || dados.local_estoque,
          data_movimentacao: dados.data_movimentacao,
          tipo_documento: dados.tipo_documento,
          numero_documento: dados.numero_documento,
          serie_documento: dados.serie_documento,
          chave_documento: dados.chave_documento,
          fornecedor_id: dados.fornecedor_id,
          fornecedor_nome: dados.fornecedor_nome,
          observacoes: dados.observacoes,
          status: "Ativa",
        });
      }

      toast.success(`${produtos.length} item(ns) lançados no estoque`);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const initialData = useMemo(() => ({ tipo_movimentacao: "Entrada" }), []);

  return (
    <div className="p-4 space-y-3">
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="py-2 px-3 bg-slate-50 border-b">
          <CardTitle className="text-sm font-semibold">Lançamento de Produtos no Estoque</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          {loadingProdutos ? (
            <div className="text-xs text-slate-500">Carregando...</div>
          ) : (
            <FormularioMovimentacao
              initialData={initialData}
              produtos={produtos}
              fornecedores={fornecedores}
              onSubmit={handleSubmit}
              onCancel={() => window.history.back()}
            />
          )}
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => window.history.back()} className="h-8 text-xs">
          Voltar
        </Button>
      </div>
    </div>
  );
}