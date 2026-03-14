import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { normalizeText, obterSaldoProdutoLocal, parseNumber, registrarSaidaSuplementacao } from "./estoqueSuplementacaoUtils";

export default function FormularioLancamentoSuplementacao({ ponto, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [progresso, setProgresso] = useState({ show: false, atual: 0, total: 0, mensagem: "" });
  const [formData, setFormData] = useState({
    data_lancamento: new Date().toISOString().split("T")[0],
    produto: ponto?.produto_padrao || "",
    quantidade_total_kg: "",
    sobra_kg: "0",
    observacoes: "",
  });

  const { data: user } = useQuery({ queryKey: ["user-suplementacao-form"], queryFn: () => base44.auth.me() });

  const { data: lotes = [], isLoading: loadingLotes } = useQuery({
    queryKey: ["lotes-area", ponto?.area_vinculada_id],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && lote.area_atual_id === ponto?.area_vinculada_id && lote.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId && !!ponto?.area_vinculada_id,
  });

  const { data: fatores = [] } = useQuery({
    queryKey: ["fatores-consumo", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.FatorConsumoCategoria.list();
      return all.filter((fator) => fator.empresa_id === empresaSelecionadaId && fator.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: ultimoEvento } = useQuery({
    queryKey: ["ultimo-evento-ponto", ponto?.id],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter((evento) => evento.ponto_suplementacao_id === ponto?.id).sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0] || null;
    },
    enabled: !!ponto?.id,
  });

  const { data: produtosSuplementacao = [] } = useQuery({
    queryKey: ["produtos-suplementacao-lancamento", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((produto) => produto.empresa_id === empresaSelecionadaId && normalizeText(produto.categoria).includes("SUPLEMENTAC"));
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: depositoVinculado = null } = useQuery({
    queryKey: ["deposito-vinculado-cocho", ponto?.deposito_origem_id, ponto?.deposito_origem_nome],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.find((item) => item.id === ponto?.deposito_origem_id)
        || all.find((item) => normalizeText(item.nome_ponto) === normalizeText(ponto?.deposito_origem_nome) && normalizeText(item.categoria_ponto) === "DEPOSITO")
        || null;
    },
    enabled: !!ponto,
  });

  const { data: lotesNota = [] } = useQuery({
    queryKey: ["lotes-nota-suplementacao", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.EstoqueLoteNota.list();
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && lote.status === "Disponivel");
    },
    enabled: !!empresaSelecionadaId,
  });

  const totalCabecas = lotes.reduce((total, lote) => total + (lote.quantidade_cabecas || 0), 0);
  const diasPeriodo = ultimoEvento ? Math.max(1, Math.ceil((new Date(formData.data_lancamento) - new Date(ultimoEvento.data_lancamento)) / 86400000)) : null;
  const pesoTotalConsumo = lotes.reduce((total, lote) => {
    const fator = fatores.find((item) => normalizeText(item.categoria) === normalizeText(lote.categoria))?.fator || 1;
    return total + ((lote.quantidade_cabecas || 0) * fator);
  }, 0);

  const produtosDisponiveis = useMemo(() => {
    if (!depositoVinculado?.local_estoque_id) return produtosSuplementacao;
    return produtosSuplementacao.filter((produto) => obterSaldoProdutoLocal(lotesNota, produto.id, depositoVinculado.local_estoque_id) > 0);
  }, [depositoVinculado, produtosSuplementacao, lotesNota]);

  const produtoSelecionado = useMemo(() => {
    return produtosSuplementacao.find((produto) => normalizeText(produto.nome_produto) === normalizeText(formData.produto)) || null;
  }, [produtosSuplementacao, formData.produto]);

  const saldoNoDeposito = useMemo(() => {
    if (!depositoVinculado?.local_estoque_id || !produtoSelecionado) return 0;
    return obterSaldoProdutoLocal(lotesNota, produtoSelecionado.id, depositoVinculado.local_estoque_id);
  }, [depositoVinculado, produtoSelecionado, lotesNota]);

  const handleSalvar = async () => {
    const quantidadeTotal = parseNumber(formData.quantidade_total_kg);

    if (!formData.produto) return toast.error("Selecione um produto.");
    if (quantidadeTotal <= 0) return toast.error("Informe a quantidade fornecida.");
    if (totalCabecas === 0) return toast.error("Não há lotes ativos na área.");
    if (depositoVinculado?.local_estoque_id && !produtoSelecionado) return toast.error("O produto selecionado não foi encontrado no cadastro.");
    if (depositoVinculado?.local_estoque_id && quantidadeTotal > saldoNoDeposito) return toast.error("Saldo insuficiente no depósito vinculado.");

    try {
      const totalPassos = (ultimoEvento ? 1 : 0) + (depositoVinculado?.local_estoque_id ? 1 : 0) + 1 + lotes.length;
      let passoAtual = 0;
      setProgresso({ show: true, atual: 0, total: totalPassos, mensagem: "Iniciando lançamento..." });

      if (ultimoEvento && diasPeriodo > 0) {
        setProgresso({ show: true, atual: ++passoAtual, total: totalPassos, mensagem: "Fechando período anterior..." });
        const quantidadeConsumidaAnterior = (ultimoEvento.quantidade_total_kg || 0) - (ultimoEvento.sobra_kg || 0);
        const consumoDiarioAnterior = quantidadeConsumidaAnterior / diasPeriodo;
        const consumoUnitarioAnterior = ultimoEvento.peso_total_consumo > 0 ? quantidadeConsumidaAnterior / (diasPeriodo * ultimoEvento.peso_total_consumo) : 0;

        await base44.entities.SuplementacaoEvento.update(ultimoEvento.id, { dias_periodo: diasPeriodo, consumo_diario_grupo_kg: consumoDiarioAnterior });

        const todosLotes = await base44.entities.SuplementacaoLote.list();
        const lotesEventoAnterior = todosLotes.filter((item) => item.suplementacao_evento_id === ultimoEvento.id);
        for (const loteAnterior of lotesEventoAnterior) {
          const fatorLote = loteAnterior.fator_consumo || 1;
          const consumoPorCabecaDia = consumoUnitarioAnterior * fatorLote;
          const consumoTotalPeriodo = consumoPorCabecaDia * (loteAnterior.cabecas_na_area || 0) * diasPeriodo;
          await base44.entities.SuplementacaoLote.update(loteAnterior.id, {
            dias_periodo: diasPeriodo,
            consumo_unitario_dia: consumoUnitarioAnterior,
            consumo_por_cabeca_dia_kg: consumoPorCabecaDia,
            consumo_total_lote_periodo_kg: consumoTotalPeriodo,
          });
        }
      }

      let movimentoEstoque = null;
      if (depositoVinculado?.local_estoque_id && produtoSelecionado) {
        setProgresso({ show: true, atual: ++passoAtual, total: totalPassos, mensagem: "Baixando saldo do depósito..." });
        const saidaRegistrada = await registrarSaidaSuplementacao({
          empresaId: empresaSelecionadaId,
          userEmail: user?.email,
          produto: produtoSelecionado,
          quantidade: quantidadeTotal,
          localOrigemId: depositoVinculado.local_estoque_id,
          localOrigemNome: depositoVinculado.local_estoque_nome,
          areaId: ponto.area_vinculada_id,
          areaNome: ponto.area_vinculada_nome,
          observacoes: `Saída automática para o cocho ${ponto.nome_ponto}${formData.observacoes ? ` - ${formData.observacoes}` : ""}`,
          lotesNota,
        });
        movimentoEstoque = saidaRegistrada.movimentacao;
      }

      setProgresso({ show: true, atual: ++passoAtual, total: totalPassos, mensagem: "Criando evento de suplementação..." });
      const novoEvento = await base44.entities.SuplementacaoEvento.create({
        empresa_id: empresaSelecionadaId,
        ponto_suplementacao_id: ponto.id,
        ponto_nome: ponto.nome_ponto,
        area_id: ponto.area_vinculada_id,
        area_nome: ponto.area_vinculada_nome,
        data_lancamento: formData.data_lancamento,
        produto: formData.produto,
        quantidade_total_kg: quantidadeTotal,
        sobra_kg: parseNumber(formData.sobra_kg || 0),
        dias_periodo: null,
        consumo_diario_grupo_kg: null,
        total_cabecas_afetadas: totalCabecas,
        peso_total_consumo: pesoTotalConsumo,
        movimentacao_estoque_id: movimentoEstoque?.id || null,
        observacoes: formData.observacoes || null,
      });

      for (let index = 0; index < lotes.length; index++) {
        const lote = lotes[index];
        const fator = fatores.find((item) => normalizeText(item.categoria) === normalizeText(lote.categoria))?.fator || 1;
        setProgresso({ show: true, atual: ++passoAtual, total: totalPassos, mensagem: `Registrando lote ${index + 1}/${lotes.length}...` });
        await base44.entities.SuplementacaoLote.create({
          empresa_id: empresaSelecionadaId,
          suplementacao_evento_id: novoEvento.id,
          lote_id: lote.id,
          lote_nome: lote.nome,
          categoria: lote.categoria,
          fator_consumo: fator,
          data_lancamento: formData.data_lancamento,
          produto: formData.produto,
          cabecas_na_area: lote.quantidade_cabecas,
          peso_consumo_lote: (lote.quantidade_cabecas || 0) * fator,
          dias_periodo: null,
          consumo_unitario_dia: null,
          consumo_por_cabeca_dia_kg: null,
          consumo_total_lote_periodo_kg: null,
        });
      }

      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["eventos-ponto", "ultimo-evento-ponto", "lotes-nota-suplementacao", "mapa-eventos-supl", "movimentacoes", "produtos"].includes(query.queryKey[0]) });
      setProgresso({ show: true, atual: totalPassos, total: totalPassos, mensagem: "Concluído!" });
      toast.success("Suplementação registrada com sucesso.");
      setTimeout(() => {
        setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
        onCancel();
      }, 400);
    } catch (error) {
      setProgresso({ show: false, atual: 0, total: 0, mensagem: "" });
      toast.error(error.message || "Erro ao registrar suplementação.");
    }
  };

  const botaoHabilitado = totalCabecas > 0 && formData.produto && formData.quantidade_total_kg;

  return (
    <>
      <Card>
        <CardHeader className="bg-slate-50 border-b py-3"><CardTitle className="text-sm font-semibold text-slate-900">Lançar Suplementação - {ponto?.nome_ponto}</CardTitle></CardHeader>
        <CardContent className="p-4 max-h-[calc(100vh-200px)] overflow-y-auto">
          <div className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 text-xs">
                <div><span className="text-slate-600">Área:</span><span className="font-semibold text-slate-900 ml-2">{ponto?.area_vinculada_nome || "-"}</span></div>
                <div><span className="text-slate-600">Depósito:</span><span className="font-semibold text-slate-900 ml-2">{depositoVinculado?.nome_ponto || "Não vinculado"}</span></div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-600">Lotes na área:</span>
                {loadingLotes ? <Badge variant="outline" className="text-xs">Carregando...</Badge> : <Badge variant="outline" className="text-xs">{lotes.length} lote(s) - {totalCabecas} cabeças</Badge>}
                {depositoVinculado?.local_estoque_nome && <Badge variant="outline" className="text-xs">Local: {depositoVinculado.local_estoque_nome}</Badge>}
              </div>
              {ultimoEvento && diasPeriodo && <div className="pt-2 border-t border-slate-200 text-xs text-blue-700">Último lançamento: {new Date(ultimoEvento.data_lancamento).toLocaleDateString()} • Período: {diasPeriodo} dia(s)</div>}
            </div>

            {!depositoVinculado?.local_estoque_id && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Este cocho ainda não tem depósito vinculado. O lançamento será salvo sem baixa automática de estoque.</div>}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Data do lançamento *</Label>
                <Input type="date" value={formData.data_lancamento} onChange={(e) => setFormData((prev) => ({ ...prev, data_lancamento: e.target.value }))} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Produto *</Label>
                <Select value={formData.produto} onValueChange={(value) => setFormData((prev) => ({ ...prev, produto: value }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione o produto" /></SelectTrigger>
                  <SelectContent>
                    {produtosDisponiveis.map((produto) => <SelectItem key={produto.id} value={produto.nome_produto} className="text-xs">{produto.nome_produto}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Quantidade total fornecida (kg) *</Label>
                <Input type="number" step="0.01" value={formData.quantidade_total_kg} onChange={(e) => setFormData((prev) => ({ ...prev, quantidade_total_kg: e.target.value }))} className="h-8 text-xs" placeholder="0,00" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Sobra no cocho (kg)</Label>
                <Input type="number" step="0.01" value={formData.sobra_kg} onChange={(e) => setFormData((prev) => ({ ...prev, sobra_kg: e.target.value }))} className="h-8 text-xs" placeholder="0,00" />
              </div>
            </div>

            {depositoVinculado?.local_estoque_id && produtoSelecionado && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between"><div><div className="text-xs text-slate-500">Saldo disponível no depósito</div><div className="text-sm font-semibold text-slate-900">{saldoNoDeposito.toFixed(2)} {produtoSelecionado.unidade_medida || "KG"}</div></div><Badge variant="outline" className="text-xs">Baixa automática ativa</Badge></div>}

            {formData.quantidade_total_kg && totalCabecas > 0 && lotes.length > 0 && <div className="bg-slate-50 border border-slate-300 rounded-lg p-3"><div className="text-xs font-semibold text-slate-900 mb-3">Consumo por Lote</div><div className="space-y-2">{lotes.map((lote) => { const fator = fatores.find((item) => normalizeText(item.categoria) === normalizeText(lote.categoria))?.fator || 1; const pesoConsumoLote = (lote.quantidade_cabecas || 0) * fator; const percentualConsumo = pesoTotalConsumo > 0 ? (pesoConsumoLote / pesoTotalConsumo) * 100 : 0; return <div key={lote.id} className="bg-white border border-slate-200 rounded-md p-2"><div className="flex items-center justify-between mb-1"><div className="font-semibold text-xs text-slate-900">{lote.nome}</div><Badge variant="outline" className="text-[10px]">{lote.categoria}</Badge></div><div className="grid grid-cols-3 gap-2 text-[10px]"><div><div className="text-slate-500">Cabeças</div><div className="font-bold text-slate-900">{lote.quantidade_cabecas}</div></div><div><div className="text-slate-500">Fator</div><div className="font-bold text-slate-900">{fator.toFixed(2)}</div></div><div><div className="text-slate-500">% Consumo</div><div className="font-bold text-emerald-700">{percentualConsumo.toFixed(1)}%</div></div></div></div>; })}</div></div>}

            <div className="space-y-1">
              <Label className="text-xs">Observações</Label>
              <Textarea value={formData.observacoes} onChange={(e) => setFormData((prev) => ({ ...prev, observacoes: e.target.value }))} className="text-xs" rows={3} />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">Cancelar</Button>
              <Button type="button" onClick={handleSalvar} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={!botaoHabilitado || progresso.show}>{progresso.show ? "Registrando..." : "Salvar"}</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={progresso.show} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="text-sm">Salvando...</DialogTitle></DialogHeader><div className="space-y-2"><p className="text-xs text-slate-600">{progresso.mensagem}</p><Progress value={progresso.total ? (progresso.atual / progresso.total) * 100 : 0} className="w-full h-1.5" /></div></DialogContent>
      </Dialog>
    </>
  );
}