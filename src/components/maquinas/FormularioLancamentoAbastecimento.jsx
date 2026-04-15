import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const REQUIRED_FIELDS = ["data_abastecimento", "maquina_id", "tipo_servico", "responsavel", "produto_id", "local_estoque_id", "quantidade_litros"];

const getFieldClassName = (hasError, readOnly = false) => {
  if (hasError) return "h-8 text-xs border-red-500 bg-red-50 focus-visible:ring-red-500";
  if (readOnly) return "h-8 text-xs bg-slate-50";
  return "h-8 text-xs uppercase";
};

export default function FormularioLancamentoAbastecimento({ abastecimento, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [saldoDisponivel, setSaldoDisponivel] = useState(null);
  const [formData, setFormData] = useState({
    data_abastecimento: abastecimento?.data_abastecimento || new Date().toISOString().split("T")[0],
    maquina_id: abastecimento?.maquina_id || "",
    tipo_servico: abastecimento?.tipo_servico || "ABASTECIMENTO",
    responsavel: abastecimento?.responsavel || "",
    produto_id: abastecimento?.produto_id || "",
    local_estoque_id: abastecimento?.local_estoque_id || "",
    quantidade_litros: abastecimento?.quantidade_litros || "",
    medicao: abastecimento?.medicao || "",
  });

  const { data: maquinas = [] } = useQuery({
    queryKey: ["maquinas-abastecimento", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Maquina.list();
      return all.filter((m) => m.empresa_id === empresaSelecionadaId && m.status !== "Inativo" && m.status !== "Vendido");
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-combustivel", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId && p.tipo_uso === "Combustível" && p.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: locais = [] } = useQuery({
    queryKey: ["locais-estoque-abastecimento"],
    queryFn: () => base44.entities.LocalEstoque.list(),
  });

  const { data: usuarios = [] } = useQuery({
    queryKey: ["usuarios-responsaveis"],
    queryFn: async () => {
      const all = await base44.entities.User.list();
      return all;
    },
  });

  const maquinaSelecionada = useMemo(() => maquinas.find((m) => m.id === formData.maquina_id), [maquinas, formData.maquina_id]);

  const produtosPermitidos = useMemo(() => {
    if (!maquinaSelecionada) return [];
    const vinculados = maquinaSelecionada.produtos_combustiveis_vinculados || [];
    return vinculados
      .map((item) => {
        const produto = produtos.find((p) => p.id === item.produto_id);
        return produto ? { ...produto, principal: item.principal } : null;
      })
      .filter(Boolean);
  }, [maquinaSelecionada, produtos]);

  const produtoPrincipal = useMemo(() => produtosPermitidos.find((p) => p.principal), [produtosPermitidos]);

  useEffect(() => {
    if (!maquinaSelecionada) return;
    if (!abastecimento && produtoPrincipal) {
      setFormData((prev) => ({ ...prev, produto_id: produtoPrincipal.id }));
    }
    if (!abastecimento && maquinaSelecionada.tipo_medicao !== "Nenhum") {
      setFormData((prev) => ({ ...prev, medicao: "" }));
    }
  }, [maquinaSelecionada?.id, produtoPrincipal?.id]);

  useEffect(() => {
    const carregarSaldo = async () => {
      if (!empresaSelecionadaId || !formData.produto_id || !formData.local_estoque_id) {
        setSaldoDisponivel(null);
        return;
      }
      const lotes = await base44.entities.EstoqueLoteNota.filter({
        empresa_id: empresaSelecionadaId,
        produto_id: formData.produto_id,
        local_estoque_id: formData.local_estoque_id,
        status: "Disponivel",
      });
      const saldo = lotes.reduce((acc, lote) => acc + (lote.quantidade_disponivel || 0), 0);
      setSaldoDisponivel(saldo);
    };
    carregarSaldo();
  }, [empresaSelecionadaId, formData.produto_id, formData.local_estoque_id]);

  const consumoCalculado = useMemo(() => {
    if (!maquinaSelecionada || maquinaSelecionada.tipo_medicao === "Nenhum") return null;
    const atual = Number(maquinaSelecionada.medicao_atual || 0);
    const nova = Number(formData.medicao || 0);
    const qtd = Number(formData.quantidade_litros || 0);
    if (!nova || !qtd || nova <= atual) return null;
    return ((nova - atual) / qtd).toFixed(2);
  }, [maquinaSelecionada, formData.medicao, formData.quantidade_litros]);

  const mutation = useMutation({
    mutationFn: async (data) => {
      if (!maquinaSelecionada) throw new Error("Selecione um ativo");
      const produtoSelecionado = produtosPermitidos.find((p) => p.id === data.produto_id);
      if (!produtoSelecionado) throw new Error("Produto não permitido para este ativo");

      const quantidade = Number(data.quantidade_litros);
      if (quantidade <= 0) throw new Error("Quantidade deve ser maior que zero");
      if ((saldoDisponivel || 0) < quantidade) throw new Error("Saldo insuficiente no local selecionado");

      const medicaoAtual = Number(maquinaSelecionada.medicao_atual || 0);
      const novaMedicao = Number(data.medicao || 0);
      if (maquinaSelecionada.tipo_medicao !== "Nenhum" && novaMedicao <= medicaoAtual) {
        throw new Error("Nova medição deve ser maior que a medição atual");
      }

      const lotes = await base44.entities.EstoqueLoteNota.filter({
        empresa_id: empresaSelecionadaId,
        produto_id: data.produto_id,
        local_estoque_id: data.local_estoque_id,
        status: "Disponivel",
      });

      const lotesOrdenados = [...lotes].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
      let restante = quantidade;
      const lotesConsumidos = [];

      for (const lote of lotesOrdenados) {
        if (restante <= 0) break;
        const consumir = Math.min(lote.quantidade_disponivel || 0, restante);
        if (consumir > 0) {
          lotesConsumidos.push({
            lote_id: lote.id,
            numero_documento: lote.numero_documento,
            fornecedor_nome: lote.fornecedor_nome,
            quantidade_consumida: consumir,
            custo_unitario: lote.custo_unitario,
          });
          restante -= consumir;
        }
      }

      if (restante > 0) throw new Error("Não foi possível aplicar FIFO para toda a quantidade");

      if (abastecimento?.id) {
        throw new Error("Edição será aplicada na próxima etapa");
      }

      const abastecimentoCriado = await base44.entities.AbastecimentoMaquina.create({
        empresa_id: empresaSelecionadaId,
        maquina_id: maquinaSelecionada.id,
        maquina_nome: maquinaSelecionada.nome,
        produto_id: produtoSelecionado.id,
        produto_nome: produtoSelecionado.nome_produto,
        data_abastecimento: data.data_abastecimento,
        quantidade_litros: quantidade,
        medicao: maquinaSelecionada.tipo_medicao !== "Nenhum" ? novaMedicao : null,
        operador: data.responsavel,
        observacoes: `Tipo de serviço: ${data.tipo_servico}`,
        local_estoque_id: data.local_estoque_id,
        local_estoque_nome: locais.find((l) => l.id === data.local_estoque_id)?.nome || "",
        tipo_servico: data.tipo_servico,
        responsavel: data.responsavel,
      });

      const referencia = abastecimentoCriado.id;

      await base44.entities.MovimentacaoEstoque.create({
        empresa_id: empresaSelecionadaId,
        tipo_movimentacao: "Saída",
        tipo_detalhado: "ABASTECIMENTO",
        data_movimentacao: new Date(`${data.data_abastecimento}T12:00:00`).toISOString(),
        data_documento: data.data_abastecimento,
        produto_id: produtoSelecionado.id,
        produto_nome: produtoSelecionado.nome_produto,
        quantidade,
        unidade_medida: produtoSelecionado.unidade_medida || "LT",
        local_estoque_origem: data.local_estoque_id,
        local_origem: locais.find((l) => l.id === data.local_estoque_id)?.nome || "",
        maquina_vinculada_id: maquinaSelecionada.id,
        maquina_vinculada_nome: maquinaSelecionada.nome,
        vinculado: true,
        tipo_vinculo: "maquina",
        lotes_consumidos: lotesConsumidos,
        referencia,
        observacoes: `Saída automática por abastecimento ${referencia}`,
      });

      for (const item of lotesConsumidos) {
        const lote = lotesOrdenados.find((l) => l.id === item.lote_id);
        const novaQtd = (lote.quantidade_disponivel || 0) - item.quantidade_consumida;
        await base44.entities.EstoqueLoteNota.update(item.lote_id, {
          quantidade_disponivel: novaQtd,
          status: novaQtd > 0 ? "Disponivel" : "Esgotado",
        });
      }

      if (maquinaSelecionada.tipo_medicao !== "Nenhum") {
        await base44.entities.Maquina.update(maquinaSelecionada.id, { medicao_atual: novaMedicao });
      }

      return abastecimentoCriado;
    },
    onSuccess: () => {
      toast.success("Abastecimento lançado com sucesso");
      onSave();
    },
    onError: (error) => toast.error(error.message),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setTentouSalvar(true);
    for (const field of REQUIRED_FIELDS) {
      if (!formData[field]) {
        toast.error("Preencha os campos obrigatórios");
        return;
      }
    }
    if (maquinaSelecionada?.tipo_medicao !== "Nenhum" && !formData.medicao) {
      toast.error("Informe a nova medição");
      return;
    }
    mutation.mutate(formData);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
      <Card className="rounded-xl border bg-card text-card-foreground shadow">
        <CardHeader className="py-3 px-3 border-b">
          <CardTitle className="text-sm">{abastecimento ? "Editar Lançamento de Abastecimento" : "Novo Lançamento de Abastecimento"}</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="p-2 bg-white border border-slate-200 rounded-lg space-y-2">
              <div className="text-xs font-semibold text-slate-700 uppercase">Dados Gerais</div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <div>
                  <label className="text-xs uppercase">Data *</label>
                  <Input type="date" value={formData.data_abastecimento} onChange={(e) => setFormData({ ...formData, data_abastecimento: e.target.value })} className={getFieldClassName(tentouSalvar && !formData.data_abastecimento)} />
                </div>
                <div>
                  <label className="text-xs uppercase">Ativo *</label>
                  <Select value={formData.maquina_id} onValueChange={(value) => setFormData({ ...formData, maquina_id: value, produto_id: "", medicao: "" })}>
                    <SelectTrigger className={getFieldClassName(tentouSalvar && !formData.maquina_id)}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                    <SelectContent>{maquinas.map((item) => <SelectItem key={item.id} value={item.id} className="text-xs uppercase">{item.nome}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs uppercase">Tipo de Serviço *</label>
                  <Select value={formData.tipo_servico} onValueChange={(value) => setFormData({ ...formData, tipo_servico: value })}>
                    <SelectTrigger className={getFieldClassName(tentouSalvar && !formData.tipo_servico)}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ABASTECIMENTO" className="text-xs uppercase">ABASTECIMENTO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs uppercase">Responsável *</label>
                  <Select value={formData.responsavel} onValueChange={(value) => setFormData({ ...formData, responsavel: value })}>
                    <SelectTrigger className={getFieldClassName(tentouSalvar && !formData.responsavel)}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                    <SelectContent>{usuarios.map((u) => <SelectItem key={u.id} value={u.full_name || u.email} className="text-xs uppercase">{u.full_name || u.email}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="p-2 bg-white border border-slate-200 rounded-lg space-y-2">
              <div className="text-xs font-semibold text-slate-700 uppercase">Abastecimento</div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <div>
                  <label className="text-xs uppercase">Produto *</label>
                  <Select value={formData.produto_id} onValueChange={(value) => setFormData({ ...formData, produto_id: value })} disabled={!maquinaSelecionada}>
                    <SelectTrigger className={getFieldClassName(tentouSalvar && !formData.produto_id)}><SelectValue placeholder={!maquinaSelecionada ? "SELECIONE O ATIVO" : "SELECIONE"} /></SelectTrigger>
                    <SelectContent>{produtosPermitidos.map((item) => <SelectItem key={item.id} value={item.id} className="text-xs uppercase">{item.nome_produto}{item.principal ? " (PRINCIPAL)" : ""}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs uppercase">Local de Estoque *</label>
                  <Select value={formData.local_estoque_id} onValueChange={(value) => setFormData({ ...formData, local_estoque_id: value })}>
                    <SelectTrigger className={getFieldClassName(tentouSalvar && !formData.local_estoque_id)}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                    <SelectContent>{locais.map((item) => <SelectItem key={item.id} value={item.id} className="text-xs uppercase">{item.nome}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs uppercase">Quantidade *</label>
                  <Input type="number" step="0.01" min="0.01" value={formData.quantidade_litros} onChange={(e) => setFormData({ ...formData, quantidade_litros: e.target.value })} className={getFieldClassName(tentouSalvar && !formData.quantidade_litros)} placeholder="0,00" />
                </div>
                <div>
                  <label className="text-xs uppercase">Saldo Atual</label>
                  <Input readOnly value={saldoDisponivel == null ? "" : `${saldoDisponivel.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} className={getFieldClassName(false, true)} />
                </div>
              </div>
            </div>

            {maquinaSelecionada?.tipo_medicao !== "Nenhum" && (
              <div className="p-2 bg-white border border-slate-200 rounded-lg space-y-2">
                <div className="text-xs font-semibold text-slate-700 uppercase">Medição</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs uppercase">Medição Atual</label>
                    <Input readOnly value={maquinaSelecionada?.medicao_atual || 0} className={getFieldClassName(false, true)} />
                  </div>
                  <div>
                    <label className="text-xs uppercase">Nova Medição *</label>
                    <Input type="number" step="0.01" value={formData.medicao} onChange={(e) => setFormData({ ...formData, medicao: e.target.value })} className={getFieldClassName(tentouSalvar && !formData.medicao)} />
                  </div>
                  <div>
                    <label className="text-xs uppercase">Consumo</label>
                    <Input readOnly value={consumoCalculado ? `${consumoCalculado} ${maquinaSelecionada.tipo_medicao === "Horímetro" ? "H/L" : "KM/L"}` : ""} className={getFieldClassName(false, true)} />
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">Cancelar</Button>
              <Button type="submit" disabled={mutation.isPending} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">{mutation.isPending ? "Salvando..." : "Salvar"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}