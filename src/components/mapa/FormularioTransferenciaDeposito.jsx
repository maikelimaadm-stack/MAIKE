import React, { useMemo, useState } from "react";
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
import { produtoSuportaSacos, sacosParaKg, kgParaSacos } from "../suplementacao/unidadeConversaoUtils";

export default function FormularioTransferenciaDeposito({ deposito, initialDirection = "entrada", onSuccess, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const direction = initialDirection;
  const [localRelacionadoId, setLocalRelacionadoId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [unidadeInput, setUnidadeInput] = useState("KG");
  const [saving, setSaving] = useState(false);

  const { data: user } = useQuery({ queryKey: ["user-transferencia-deposito"], queryFn: () => base44.auth.me() });
  const { data: locais = [] } = useQuery({ queryKey: ["locais-estoque-deposito"], queryFn: () => base44.entities.LocalEstoque.list() });

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-suplementacao-transferencia", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: lotesNota = [] } = useQuery({
    queryKey: ["estoque-lotes-transferencia", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.EstoqueLoteNota.list();
      return all.filter((l) => l.empresa_id === empresaSelecionadaId && l.status === "Disponivel");
    },
    enabled: !!empresaSelecionadaId,
  });

  const outrosLocais = useMemo(() => locais.filter((l) => l.id !== deposito.local_estoque_id), [locais, deposito.local_estoque_id]);

  const localOrigemId = direction === "entrada" ? localRelacionadoId : deposito.local_estoque_id;
  const localOrigemNome = direction === "entrada"
    ? outrosLocais.find((l) => l.id === localRelacionadoId)?.nome || ""
    : deposito.local_estoque_nome;
  const localDestinoId = direction === "entrada" ? deposito.local_estoque_id : localRelacionadoId;
  const localDestinoNome = direction === "entrada"
    ? deposito.local_estoque_nome
    : outrosLocais.find((l) => l.id === localRelacionadoId)?.nome || "";

  const localFonteId = direction === "entrada" ? localRelacionadoId : deposito.local_estoque_id;
  const localFonteNome = direction === "entrada"
    ? outrosLocais.find((l) => l.id === localRelacionadoId)?.nome || ""
    : deposito.local_estoque_nome;

  // Filter products: only those with saldo in the SOURCE local
  const produtosDisponiveis = useMemo(() => {
    if (!localFonteId) return [];
    return produtos.filter((p) => {
      const categoriaSuplementacao = normalizeText(p.categoria).includes("SUPLEMENTAC");
      if (!categoriaSuplementacao) return false;
      return obterSaldoTransferivelProduto({ produto: p, lotesNota, localEstoqueId: localFonteId, localEstoqueNome: localFonteNome }) > 0;
    });
  }, [direction, localRelacionadoId, deposito.local_estoque_id, produtos, lotesNota, localFonteId, localFonteNome]);

  const produtoSelecionado = useMemo(() => produtos.find((p) => p.id === produtoId) || null, [produtos, produtoId]);
  const suportaSacos = useMemo(() => produtoSelecionado ? produtoSuportaSacos(produtoSelecionado) : false, [produtoSelecionado]);
  const pesoPorSaco = Number(produtoSelecionado?.peso_por_saco_kg || 0);

  const saldoDisponivel = useMemo(() => {
    if (!produtoSelecionado || !localOrigemId) return 0;
    return obterSaldoTransferivelProduto({ produto: produtoSelecionado, lotesNota, localEstoqueId: localOrigemId, localEstoqueNome: localOrigemNome });
  }, [produtoSelecionado, localOrigemId, localOrigemNome, lotesNota]);

  const saldoEmSacos = useMemo(() => {
    if (!suportaSacos || pesoPorSaco <= 0) return 0;
    return kgParaSacos(saldoDisponivel, pesoPorSaco);
  }, [saldoDisponivel, suportaSacos, pesoPorSaco]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!localRelacionadoId) return toast.error("Selecione o local.");
    if (!produtoSelecionado) return toast.error("Selecione um produto.");

    const inputNum = parseNumber(quantidade);
    const quantidadeFinal = unidadeInput === "SACO" ? sacosParaKg(inputNum, pesoPorSaco) : inputNum;
    if (quantidadeFinal <= 0) return toast.error("Informe uma quantidade válida.");
    if (quantidadeFinal > saldoDisponivel) return toast.error("Quantidade maior que o saldo disponível.");

    setSaving(true);
    try {
      await registrarTransferenciaEntreLocais({
        empresaId: empresaSelecionadaId, userEmail: user?.email, produto: produtoSelecionado,
        quantidade: quantidadeFinal, localOrigemId, localOrigemNome, localDestinoId, localDestinoNome,
        observacoes: observacoes || `Transferência pelo depósito ${deposito.nome_ponto}`, lotesNota,
      });
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && ["estoque-lotes-transferencia", "saldo-deposito", "cochos-vinculados-deposito", "lotes-nota-suplementacao", "mapa-pontos-supl", "movimentacoes", "produtos", "historico-deposito"].includes(q.queryKey[0]) });
      toast.success("Transferência registrada.");
      onSuccess?.();
    } catch (error) {
      toast.error(error.message || "Erro ao registrar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="py-2 px-3 border-b bg-slate-50">
        <CardTitle className="text-sm font-semibold text-slate-900">{direction === "entrada" ? "Entrada no Depósito" : "Saída do Depósito"}</CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        <form onSubmit={handleSubmit} className="space-y-1">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
            <div>
              <label className="text-[12px] text-slate-500 pl-1 leading-none">{direction === "entrada" ? "Local de Origem" : "Local de Destino"} <span className="text-red-500">*</span></label>
              <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors"><Select value={localRelacionadoId} onValueChange={(v) => { setLocalRelacionadoId(v); setProdutoId(""); setQuantidade(""); }}>
                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="Selecione o local" /></SelectTrigger>
                <SelectContent>{outrosLocais.map((l) => <SelectItem key={l.id} value={l.id} className="text-xs">{l.nome}</SelectItem>)}</SelectContent>
              </Select></div>
            </div>
            <div>
              <label className="text-[12px] text-slate-500 pl-1 leading-none">Produto de Suplementação <span className="text-red-500">*</span></label>
              <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors"><Select value={produtoId} onValueChange={(v) => { setProdutoId(v); setUnidadeInput("KG"); setQuantidade(""); }} disabled={!localFonteId}>
                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue placeholder="Selecione o produto" /></SelectTrigger>
                <SelectContent>{produtosDisponiveis.map((p) => <SelectItem key={p.id} value={p.id} className="text-xs">{p.nome_produto} ({p.unidade_medida || "KG"})</SelectItem>)}</SelectContent>
              </Select></div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
            <div>
              <label className="text-[12px] text-slate-500 pl-1 leading-none">Unidade</label>
              <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors"><Select value={unidadeInput} onValueChange={setUnidadeInput} disabled={!suportaSacos}>
                <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="KG" className="text-xs">KG</SelectItem>
                  {suportaSacos && <SelectItem value="SACO" className="text-xs">Sacas ({pesoPorSaco} kg/saco)</SelectItem>}
                </SelectContent>
              </Select></div>
            </div>
            <div>
              <label className="text-[12px] text-slate-500 pl-1 leading-none">Quantidade ({unidadeInput === "SACO" ? "sacas" : "kg"}) <span className="text-red-500">*</span></label>
              <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors"><Input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} type="number" step="0.01" className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" placeholder="0,00" /></div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Origem: <span className="font-semibold text-slate-900">{localOrigemNome || "-"}</span></div>
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Destino: <span className="font-semibold text-slate-900">{localDestinoNome || "-"}</span></div>
            <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Saldo (kg): <span className="font-semibold text-slate-900">{formatQuantidadeTecnica(saldoDisponivel, 3)}</span></div>
            {suportaSacos && <div className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600">Saldo (sacas): <span className="font-semibold text-slate-900">{saldoEmSacos.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>}
          </div>

          <div>
            <label className="text-[12px] text-slate-500 pl-1 leading-none">Observações</label>
            <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors"><Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} className="text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></div>
          </div>

          <div className="flex justify-end gap-1 pt-1 border-t">
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}