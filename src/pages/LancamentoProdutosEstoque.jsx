import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import FormularioMovimentacao from "../components/movimentacoes/FormularioMovimentacao";
import { registrarEntrada } from "@/services/estoqueService";

export default function LancamentoProdutosEstoque() {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: produtos = [], isLoading: loadingProdutos } = useQuery({
    queryKey: ["produtos_lanc_entrada", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId);
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
    const itens = dados.produtos || [];
    if (itens.length === 0) {
      toast.error("Adicione pelo menos um produto.");
      return;
    }

    // Local de destino: o formulário emite os campos *_id/_nome
    const localDestinoId = dados.local_estoque_destino_id || dados.local_estoque_destino || "";
    const localDestinoNome = dados.local_estoque_destino_nome || dados.local_destino || "";
    if (!localDestinoId) {
      toast.error("Selecione o local de estoque de destino.");
      return;
    }

    let usuario = null;
    try {
      usuario = await base44.auth.me();
    } catch {
      usuario = null;
    }

    let sucesso = 0;
    const falhas = [];

    // Registra cada entrada de forma COMPLETA (movimentação + lote FIFO + estoque_atual)
    for (const p of itens) {
      const produtoCompleto = produtos.find((prod) => prod.id === p.produto_id);
      if (!produtoCompleto) {
        falhas.push(`${p.produto_nome || "Produto"}: não encontrado`);
        continue;
      }
      try {
        await registrarEntrada({
          empresaId: empresaSelecionadaId,
          userEmail: usuario?.email,
          produto: produtoCompleto,
          quantidade: p.quantidade,
          custoUnitario: p.valor_unitario,
          valorTotal: p.valor_total,
          localDestinoId,
          localDestinoNome,
          tipoDetalhado: dados.tipo_detalhado,
          tipoDocumento: dados.tipo_documento,
          numeroDocumento: dados.numero_documento,
          serieDocumento: dados.serie_documento,
          chaveDocumento: dados.chave_documento,
          dataDocumento: dados.data_documento,
          dataMovimentacao: dados.data_movimentacao,
          fornecedorId: dados.fornecedor_id,
          fornecedorNome: dados.fornecedor_nome,
          observacoes: dados.observacoes,
        });
        sucesso += 1;
      } catch (e) {
        falhas.push(`${p.produto_nome || produtoCompleto.nome_produto}: ${e.message}`);
      }
    }

    if (sucesso > 0) toast.success(`${sucesso} item(ns) lançado(s) no estoque`);
    if (falhas.length > 0) toast.error(`Falha em ${falhas.length} item(ns): ${falhas.join(" | ")}`);
    if (sucesso > 0 && falhas.length === 0) {
      setTimeout(() => window.history.back(), 600);
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