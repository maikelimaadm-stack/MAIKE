import React, { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  normalizeText,
  obterSaldoTransferivelProduto,
  parseNumber,
  registrarTransferenciaEntreLocais,
} from "../suplementacao/estoqueSuplementacaoUtils";
import { formatQuantidadeTecnica } from "../suplementacao/formatters";

export default function FormularioTransferenciaDeposito({ deposito, initialDirection = "entrada", onSuccess, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const direction = initialDirection;
  const [localRelacionadoId, setLocalRelacionadoId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: user } = useQuery({
    queryKey: ["user-transferencia-deposito"],
    queryFn: () => base44.auth.me(),
  });

  const { data: locais = [] } = useQuery({
    queryKey: ["locais-estoque-deposito"],
    queryFn: () => base44.entities.LocalEstoque.list(),
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-suplementacao-transferencia", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((produto) => produto.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: lotesNota = [] } = useQuery({
    queryKey: ["estoque-lotes-transferencia", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.EstoqueLoteNota.list();
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && lote.status === "Disponivel");
    },
    enabled: !!empresaSelecionadaId,
  });

  const outrosLocais = useMemo(() => {
    return locais.filter((local) => local.id !== deposito.local_estoque_id);
  }, [locais, deposito.local_estoque_id]);

  const localOrigemId = direction === "entrada" ? localRelacionadoId : deposito.local_estoque_id;
  const localOrigemNome = direction === "entrada"
    ? outrosLocais.find((local) => local.id === localRelacionadoId)?.nome || ""
    : deposito.local_estoque_nome;
  const localDestinoId = direction === "entrada" ? deposito.local_estoque_id : localRelacionadoId;
  const localDestinoNome = direction === "entrada"
    ? deposito.local_estoque_nome
    : outrosLocais.find((local) => local.id === localRelacionadoId)?.nome || "";

  const localFonteNome = direction === "entrada"
    ? outrosLocais.find((local) => local.id === localRelacionadoId)?.nome || ""
    : deposito.local_estoque_nome;

  const produtosDisponiveis = useMemo(() => {
    const localFonte = direction === "entrada" ? localRelacionadoId : deposito.local_estoque_id;
    if (!localFonte) return [];

    return produtos.filter((produto) => obterSaldoTransferivelProduto({
      produto,
      lotesNota,
      localEstoqueId: localFonte,
      localEstoqueNome: localFonteNome,
    }) > 0);
  }, [direction, localRelacionadoId, deposito.local_estoque_id, produtos, lotesNota, localFonteNome]);

  const produtoSelecionado = useMemo(() => {
    return produtos.find((produto) => produto.id === produtoId) || null;
  }, [produtos, produtoId]);

  const saldoDisponivel = useMemo(() => {
    if (!produtoSelecionado || !localOrigemId) return 0;
    return obterSaldoTransferivelProduto({
      produto: produtoSelecionado,
      lotesNota,
      localEstoqueId: localOrigemId,
      localEstoqueNome: localOrigemNome,
    });
  }, [produtoSelecionado, localOrigemId, localOrigemNome, lotesNota]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!localRelacionadoId) {
      toast.error("Selecione o outro local da transferência.");
      return;
    }

    if (!produtoSelecionado) {
      toast.error("Selecione um produto.");
      return;
    }

    const quantidadeFinal = parseNumber(quantidade);
    if (quantidadeFinal <= 0) {
      toast.error("Informe uma quantidade válida.");
      return;
    }

    if (quantidadeFinal > saldoDisponivel) {
      toast.error("A quantidade informada é maior que o saldo disponível.");
      return;
    }

    setSaving(true);
    try {
      await registrarTransferenciaEntreLocais({
        empresaId: empresaSelecionadaId,
        userEmail: user?.email,
        produto: produtoSelecionado,
        quantidade: quantidadeFinal,
        localOrigemId,
        localOrigemNome,
        localDestinoId,
        localDestinoNome,
        observacoes: observacoes || `Transferência pelo depósito ${deposito.nome_ponto}`,
        lotesNota,
      });

      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && [
        "estoque-lotes-transferencia",
        "saldo-deposito",
        "cochos-vinculados-deposito",
        "lotes-nota-suplementacao",
        "mapa-pontos-supl",
        "movimentacoes",
        "produtos",
      ].includes(query.queryKey[0]) });

      toast.success("Transferência registrada com sucesso.");
      onSuccess?.();
    } catch (error) {
      toast.error(error.message || "Erro ao registrar transferência.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="py-3 px-4 border-b bg-slate-50">
        <CardTitle className="text-sm font-semibold text-slate-900">Transferência do Depósito</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">{direction === "entrada" ? "Local de Origem" : "Local de Destino"}</Label>
              <Select value={localRelacionadoId} onValueChange={(value) => {
                setLocalRelacionadoId(value);
                setProdutoId("");
                setQuantidade("");
              }}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione o local" />
                </SelectTrigger>
                <SelectContent>
                  {outrosLocais.map((local) => (
                    <SelectItem key={local.id} value={local.id} className="text-xs">{local.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Produto de Suplementação</Label>
              <Select value={produtoId} onValueChange={setProdutoId} disabled={!localRelacionadoId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione o produto" />
                </SelectTrigger>
                <SelectContent>
                  {produtosDisponiveis.map((produto) => (
                    <SelectItem key={produto.id} value={produto.id} className="text-xs">{produto.nome_produto}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Quantidade</Label>
              <Input
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                type="number"
                step="0.01"
                className="h-8 text-xs"
                placeholder="0,00"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Local de origem</div>
              <div className="text-sm font-semibold text-slate-900">{localOrigemNome || "-"}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Saldo disponível</div>
              <div className="flex items-center gap-2 pt-1">
                <Badge variant="outline" className="text-xs">{formatQuantidadeTecnica(saldoDisponivel, 3)}</Badge>
                <span className="text-xs text-slate-500">{produtoSelecionado?.unidade_medida || "KG"}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={3}
              className="text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={saving}>
              {saving ? "Salvando..." : "Salvar Transferência"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}