import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";

const REQUIRED_FIELDS = ["data_abastecimento", "maquina_id", "grupo_atividade_id", "tipo_servico", "responsavel", "local_estoque_id", "produto_id", "quantidade_litros"];

export default function FormularioLancamentoAbastecimento({ abastecimento, onSave, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [saldoDisponivel, setSaldoDisponivel] = useState(null);

  const [formData, setFormData] = useState({
    data_abastecimento: abastecimento?.data_abastecimento || new Date().toISOString().split("T")[0],
    maquina_id: abastecimento?.maquina_id || "",
    grupo_atividade_id: abastecimento?.grupo_atividade_id || "",
    tipo_servico: abastecimento?.tipo_servico || "",
    responsavel: abastecimento?.responsavel || "",
    local_estoque_id: abastecimento?.local_estoque_id || "",
    produto_id: abastecimento?.produto_id || "",
    quantidade_litros: abastecimento?.quantidade_litros || "",
    medicao: abastecimento?.medicao || "",
    observacoes: abastecimento?.observacoes || "",
  });

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // ========== QUERIES ==========

  const { data: maquinas = [] } = useQuery({
    queryKey: ["maquinas-abastecimento", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Maquina.list();
      return all.filter((m) => m.empresa_id === empresaSelecionadaId && m.status !== "Inativo" && m.status !== "Vendido");
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: todosProdutos = [] } = useQuery({
    queryKey: ["produtos-empresa", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId && p.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: locais = [] } = useQuery({
    queryKey: ["locais-estoque-abastecimento"],
    queryFn: () => base44.entities.LocalEstoque.list(),
  });

  const { data: gruposAtividade = [] } = useQuery({
    queryKey: ["grupos-atividade-abastecimento"],
    queryFn: async () => {
      const all = await base44.entities.GrupoAtividade.list();
      return all.filter((g) => g.ativo !== false);
    },
  });

  const { data: tiposTarefa = [] } = useQuery({
    queryKey: ["tipos-tarefa-abastecimento"],
    queryFn: async () => {
      const all = await base44.entities.TipoTarefa.list();
      return all.filter((t) => t.ativo !== false);
    },
  });

  const { data: lotesEstoque = [] } = useQuery({
    queryKey: ["lotes-estoque-abastecimento", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.EstoqueLoteNota.list();
      return all.filter((l) => l.empresa_id === empresaSelecionadaId && l.status === "Disponivel" && (l.quantidade_disponivel || 0) > 0);
    },
    enabled: !!empresaSelecionadaId,
  });

  // ========== DERIVADOS ==========

  const maquinaSelecionada = useMemo(() => maquinas.find((m) => m.id === formData.maquina_id), [maquinas, formData.maquina_id]);

  // IDs dos produtos combustíveis vinculados ao ativo selecionado
  const produtosCombustivelIds = useMemo(() => {
    if (!maquinaSelecionada) return [];
    return (maquinaSelecionada.produtos_combustiveis_vinculados || []).map((v) => v.produto_id);
  }, [maquinaSelecionada]);

  // Locais de estoque que possuem saldo de algum combustível vinculado ao ativo
  const locaisFiltrados = useMemo(() => {
    if (produtosCombustivelIds.length === 0) return [];
    const locaisComSaldo = new Set();
    lotesEstoque.forEach((lote) => {
      if (produtosCombustivelIds.includes(lote.produto_id) && (lote.quantidade_disponivel || 0) > 0) {
        locaisComSaldo.add(lote.local_estoque_id);
      }
    });
    return locais.filter((l) => locaisComSaldo.has(l.id));
  }, [locais, lotesEstoque, produtosCombustivelIds]);

  // Produtos disponíveis = combustíveis do ativo que possuem saldo no local selecionado
  const produtosDisponiveis = useMemo(() => {
    if (!formData.local_estoque_id || produtosCombustivelIds.length === 0) return [];
    const produtosComSaldo = new Set();
    lotesEstoque.forEach((lote) => {
      if (lote.local_estoque_id === formData.local_estoque_id && produtosCombustivelIds.includes(lote.produto_id) && (lote.quantidade_disponivel || 0) > 0) {
        produtosComSaldo.add(lote.produto_id);
      }
    });
    return todosProdutos.filter((p) => produtosComSaldo.has(p.id));
  }, [todosProdutos, lotesEstoque, formData.local_estoque_id, produtosCombustivelIds]);

  // Tipos de tarefa filtrados pelo grupo selecionado
  const tiposFiltrados = useMemo(() => {
    if (!formData.grupo_atividade_id) return [];
    return tiposTarefa.filter((t) => t.grupo_atividade_id === formData.grupo_atividade_id);
  }, [tiposTarefa, formData.grupo_atividade_id]);

  // ========== EFEITOS ==========

  // Quando troca ativo: limpa local, produto, medição
  useEffect(() => {
    if (!formData.maquina_id) return;
    if (!abastecimento) {
      setFormData((prev) => ({ ...prev, local_estoque_id: "", produto_id: "", medicao: "" }));
    }
  }, [formData.maquina_id]);

  // Quando troca local: limpa produto, tenta selecionar o principal se houver só um
  useEffect(() => {
    if (!formData.local_estoque_id) {
      setFormData((prev) => ({ ...prev, produto_id: "" }));
      return;
    }
    if (!abastecimento) {
      if (produtosDisponiveis.length === 1) {
        setFormData((prev) => ({ ...prev, produto_id: produtosDisponiveis[0].id }));
      } else {
        // Verificar se o produto principal do ativo está disponível
        const vinculados = maquinaSelecionada?.produtos_combustiveis_vinculados || [];
        const principal = vinculados.find((v) => v.principal);
        if (principal && produtosDisponiveis.find((p) => p.id === principal.produto_id)) {
          setFormData((prev) => ({ ...prev, produto_id: principal.produto_id }));
        } else {
          setFormData((prev) => ({ ...prev, produto_id: "" }));
        }
      }
    }
  }, [formData.local_estoque_id, produtosDisponiveis.length]);

  // Quando troca grupo: limpa tipo de serviço
  useEffect(() => {
    if (!abastecimento) {
      setFormData((prev) => ({ ...prev, tipo_servico: "" }));
    }
  }, [formData.grupo_atividade_id]);

  // Carregar saldo disponível
  useEffect(() => {
    if (!empresaSelecionadaId || !formData.produto_id || !formData.local_estoque_id) {
      setSaldoDisponivel(null);
      return;
    }
    const saldo = lotesEstoque
      .filter((l) => l.produto_id === formData.produto_id && l.local_estoque_id === formData.local_estoque_id)
      .reduce((acc, l) => acc + (l.quantidade_disponivel || 0), 0);
    setSaldoDisponivel(saldo);
  }, [empresaSelecionadaId, formData.produto_id, formData.local_estoque_id, lotesEstoque]);

  // ========== CÁLCULO CONSUMO ==========

  const consumoCalculado = useMemo(() => {
    if (!maquinaSelecionada || maquinaSelecionada.tipo_medicao === "Nenhum") return null;
    const atual = Number(maquinaSelecionada.medicao_atual || 0);
    const nova = Number(formData.medicao || 0);
    const qtd = Number(formData.quantidade_litros || 0);
    if (!nova || !qtd || nova <= atual) return null;
    return ((nova - atual) / qtd).toFixed(2);
  }, [maquinaSelecionada, formData.medicao, formData.quantidade_litros]);

  // ========== MUTATION ==========

  const mutation = useMutation({
    mutationFn: async (data) => {
      if (!maquinaSelecionada) throw new Error("Selecione um ativo");
      const produtoSelecionado = todosProdutos.find((p) => p.id === data.produto_id);
      if (!produtoSelecionado) throw new Error("Produto não encontrado");

      const quantidade = Number(data.quantidade_litros);
      if (quantidade <= 0) throw new Error("Quantidade deve ser maior que zero");
      if ((saldoDisponivel || 0) < quantidade) throw new Error("Saldo insuficiente no local selecionado");

      const medicaoAtual = Number(maquinaSelecionada.medicao_atual || 0);
      const novaMedicao = Number(data.medicao || 0);
      if (maquinaSelecionada.tipo_medicao !== "Nenhum" && novaMedicao <= medicaoAtual) {
        throw new Error("Nova medição deve ser maior que a medição atual");
      }

      // FIFO
      const lotesLocal = lotesEstoque
        .filter((l) => l.produto_id === data.produto_id && l.local_estoque_id === data.local_estoque_id)
        .sort((a, b) => new Date(a.created_date) - new Date(b.created_date));

      let restante = quantidade;
      const lotesConsumidos = [];
      for (const lote of lotesLocal) {
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

      const grupoSel = gruposAtividade.find((g) => g.id === data.grupo_atividade_id);
      const localEstoqueSel = locais.find((l) => l.id === data.local_estoque_id);

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
        observacoes: data.observacoes || "",
        local_estoque_id: data.local_estoque_id,
        local_estoque_nome: localEstoqueSel?.nome || "",
        grupo_atividade_id: data.grupo_atividade_id,
        grupo_atividade_nome: grupoSel?.nome_grupo || "",
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
        local_origem: localEstoqueSel?.nome || "",
        maquina_vinculada_id: maquinaSelecionada.id,
        maquina_vinculada_nome: maquinaSelecionada.nome,
        vinculado: true,
        tipo_vinculo: "maquina",
        lotes_consumidos: lotesConsumidos,
        referencia,
        observacoes: `Saída automática por abastecimento ${referencia}`,
        status: "Ativa",
        origem_sistema: "manual",
        is_registro_principal: true,
        numero_movimentacao_seq: 1,
        total_movimentacoes_grupo: 1,
        bloqueado_exclusao_estoque: true,
        exclusao_somente_em: "estoque",
      });

      for (const item of lotesConsumidos) {
        const lote = lotesLocal.find((l) => l.id === item.lote_id);
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

  // ========== SUBMIT ==========

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

  // ========== HELPERS ==========

  const hasError = (field) => tentouSalvar && !formData[field];

  const fieldClass = (field, readOnly = false) => {
    if (hasError(field)) return "h-8 text-xs border-red-500 bg-red-50 focus-visible:ring-red-500";
    if (readOnly) return "h-8 text-xs bg-slate-50";
    return "h-8 text-xs";
  };

  // ========== RENDER ==========

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300 bg-white max-w-[1600px] w-full mx-auto">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-1 px-3">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {abastecimento ? "Editar Lançamento de Abastecimento" : "Novo Lançamento de Abastecimento"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          <form onSubmit={handleSubmit} className="space-y-1">

            {/* === DADOS GERAIS === */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] leading-tight">Data *</Label>
                <Input
                  type="date"
                  value={formData.data_abastecimento}
                  onChange={(e) => handleChange("data_abastecimento", e.target.value)}
                  className={fieldClass("data_abastecimento")}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] leading-tight">Ativo *</Label>
                <AutocompleteGenerico
                  items={maquinas}
                  value={formData.maquina_id}
                  onChange={(v) => handleChange("maquina_id", v)}
                  placeholder="Selecione o ativo"
                  displayField="nome"
                  searchFields={["nome", "codigo", "placa", "identificador_curto"]}
                  renderSubtext={(item) => [item.categoria, item.placa].filter(Boolean).join(" | ")}
                />
                {hasError("maquina_id") && <p className="text-[10px] text-red-500">Obrigatório</p>}
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] leading-tight">Grupo de Atividade *</Label>
                <AutocompleteGenerico
                  items={gruposAtividade}
                  value={formData.grupo_atividade_id}
                  onChange={(v) => handleChange("grupo_atividade_id", v)}
                  placeholder="Selecione o grupo"
                  displayField="nome_grupo"
                  searchFields={["nome_grupo"]}
                />
                {hasError("grupo_atividade_id") && <p className="text-[10px] text-red-500">Obrigatório</p>}
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] leading-tight">Tipo de Serviço *</Label>
                <AutocompleteGenerico
                  items={tiposFiltrados}
                  value={tiposFiltrados.find((t) => t.nome_tipo === formData.tipo_servico)?.id || ""}
                  onChange={(v) => {
                    const tipo = tiposFiltrados.find((t) => t.id === v);
                    handleChange("tipo_servico", tipo?.nome_tipo || "");
                  }}
                  placeholder={!formData.grupo_atividade_id ? "Selecione o grupo primeiro" : "Selecione o tipo"}
                  displayField="nome_tipo"
                  searchFields={["nome_tipo"]}
                />
                {hasError("tipo_servico") && <p className="text-[10px] text-red-500">Obrigatório</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] leading-tight">Responsável *</Label>
                <Input
                  value={formData.responsavel}
                  onChange={(e) => handleChange("responsavel", e.target.value.toUpperCase())}
                  className={fieldClass("responsavel")}
                  placeholder="Digite o responsável"
                  style={{ textTransform: "uppercase" }}
                />
              </div>
            </div>

            {/* === ABASTECIMENTO === */}
            <div className="pt-1 border-t">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] leading-tight">Local de Estoque *</Label>
                  <AutocompleteGenerico
                    items={locaisFiltrados}
                    value={formData.local_estoque_id}
                    onChange={(v) => handleChange("local_estoque_id", v)}
                    placeholder={!maquinaSelecionada ? "Selecione o ativo primeiro" : "Selecione o local"}
                    displayField="nome"
                    searchFields={["nome", "descricao"]}
                  />
                  {hasError("local_estoque_id") && <p className="text-[10px] text-red-500">Obrigatório</p>}
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] leading-tight">Saldo Atual</Label>
                  <Input
                    readOnly
                    value={saldoDisponivel == null ? "" : saldoDisponivel.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    className={fieldClass("", true)}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] leading-tight">Produto *</Label>
                  <AutocompleteGenerico
                    items={produtosDisponiveis}
                    value={formData.produto_id}
                    onChange={(v) => handleChange("produto_id", v)}
                    placeholder={!formData.local_estoque_id ? "Selecione o local primeiro" : "Selecione o produto"}
                    displayField="nome_produto"
                    searchFields={["nome_produto", "codigo_interno"]}
                    renderSubtext={(item) => item.unidade_medida || ""}
                  />
                  {hasError("produto_id") && <p className="text-[10px] text-red-500">Obrigatório</p>}
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] leading-tight">Quantidade *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={formData.quantidade_litros}
                    onChange={(e) => handleChange("quantidade_litros", e.target.value)}
                    className={fieldClass("quantidade_litros")}
                    placeholder="0,00"
                  />
                </div>
              </div>
            </div>

            {/* === MEDIÇÃO === */}
            {maquinaSelecionada && maquinaSelecionada.tipo_medicao !== "Nenhum" && (
              <div className="pt-1 border-t">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] leading-tight">Medição Atual</Label>
                    <Input readOnly value={maquinaSelecionada.medicao_atual || 0} className={fieldClass("", true)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] leading-tight">Nova Medição *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.medicao}
                      onChange={(e) => handleChange("medicao", e.target.value)}
                      className={fieldClass("medicao")}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] leading-tight">Consumo</Label>
                    <Input
                      readOnly
                      value={consumoCalculado ? `${consumoCalculado} ${maquinaSelecionada.tipo_medicao === "Horímetro" ? "H/L" : "KM/L"}` : ""}
                      className={fieldClass("", true)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* === OBSERVAÇÕES === */}
            <div className="pt-1 border-t space-y-1">
              <Label className="text-[11px] leading-tight">Observações</Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => handleChange("observacoes", e.target.value.toUpperCase())}
                className="text-xs"
                style={{ textTransform: "uppercase" }}
                rows={2}
                placeholder="Observações adicionais"
              />
            </div>

            {/* === BOTÕES === */}
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
                {mutation.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}