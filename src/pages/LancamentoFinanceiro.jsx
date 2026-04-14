import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Settings } from "lucide-react";
import ConfirmDialog from "@/components/common/ConfirmDialog";

import FormularioCompraFinanceiro from "../components/financeiro/FormularioCompraFinanceiro.jsx";
import TabelaFinanceiro from "../components/financeiro/TabelaFinanceiro.jsx";
import BaixaFinanceira from "../components/financeiro/BaixaFinanceira.jsx";
import ImportarNFeFinanceiro from "../components/financeiro/ImportarNFeFinanceiro.jsx";

// Gera próximo número sequencial de lançamento
const getNextNumeroLancamento = async (empresaId) => {
  const all = await base44.entities.LancamentoFinanceiro.list();
  const filtered = all.filter(l => l && l.empresa_id === empresaId);
  return String(filtered.reduce((max, l) => Math.max(max, parseInt(l.numero_lancamento) || 0), 0) + 1);
};

// Gera um ID de grupo único
const gerarGrupoId = () => `GRP-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

export default function LancamentoFinanceiro() {
  const [abaAtiva, setAbaAtiva] = useState("lancamentos");
  const [subAbaPagar, setSubAbaPagar] = useState("principais");
  const [subAbaReceber, setSubAbaReceber] = useState("principais");
  const [tipoLancamento, setTipoLancamento] = useState("Pagar");
  const [showForm, setShowForm] = useState(false);
  const [editingLancamento, setEditingLancamento] = useState(null);
  const [baixaLancamento, setBaixaLancamento] = useState(null);
  const [dadosBaixaLote, setDadosBaixaLote] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [showXmlImport, setShowXmlImport] = useState(false);
  const [dadosXML, setDadosXML] = useState(null);
  const [showSaveProgress, setShowSaveProgress] = useState(false);
  const [progressoSalvamento, setProgressoSalvamento] = useState({ etapa: '', current: 0, total: 100 });
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [cancelarBaixaConfirmId, setCancelarBaixaConfirmId] = useState(null);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: lancamentos = [], isLoading: loadingLancamentos } = useQuery({
    queryKey: ['lancamentos_financeiros', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoFinanceiro.list('-data_emissao');
      return all.filter(l => l && l.empresa_id === empresaSelecionadaId).map(l => ({
        ...l,
        valor_pago: l.valor_pago ?? 0,
        valor_total: l.valor_total ?? 0
      }));
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list('nome');
      return all.filter(f => f && f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list('nome_produto');
      return all.filter(p => p && p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const baixas = await base44.entities.BaixaFinanceira.list();
      const baixaAssociada = baixas.find(b => b && b.lancamento_id === id);
      if (baixaAssociada) {
        throw new Error('Não é possível excluir lançamento com baixa associada. Cancele a baixa primeiro.');
      }
      return base44.entities.LancamentoFinanceiro.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      toast.success('Lançamento excluído!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao excluir');
    }
  });

  const cancelarBaixaMutation = useMutation({
    mutationFn: async (lancamentoId) => {
      const baixas = await base44.entities.BaixaFinanceira.list();
      const baixasDoLancamento = baixas.filter(b => b && b.lancamento_id === lancamentoId);
      for (const baixa of baixasDoLancamento) {
        await base44.entities.BaixaFinanceira.delete(baixa.id);
      }
      await base44.entities.LancamentoFinanceiro.update(lancamentoId, {
        status: 'Aberto',
        valor_pago: 0
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      toast.success('Baixa cancelada!');
    },
    onError: (error) => {
      toast.error('Erro ao cancelar baixa: ' + (error.message || 'Erro desconhecido'));
    }
  });

  // --- SUBMIT: Cria parcelas como registros individuais ---
  const handleSubmit = async (data) => {
    if (editingLancamento) {
      // EDIÇÃO: Se é registro principal, propaga para parcelas do mesmo grupo
      const camposPropagar = {
        tipo: data.tipo,
        descricao: data.descricao,
        data_emissao: data.data_emissao,
        fornecedor_id: data.fornecedor_id,
        fornecedor_nome: data.fornecedor_nome,
        cliente_id: data.cliente_id,
        cliente_nome: data.cliente_nome,
        tipo_documento_id: data.tipo_documento_id,
        tipo_documento_nome: data.tipo_documento_nome,
        numero_documento: data.numero_documento,
        conta_financeira_id: data.conta_financeira_id,
        conta_financeira_nome: data.conta_financeira_nome,
        forma_pagamento_id: data.forma_pagamento_id,
        forma_pagamento_nome: data.forma_pagamento_nome,
        motivo_compra_id: data.motivo_compra_id,
        motivo_compra_nome: data.motivo_compra_nome,
        rateio_grupos: data.rateio_grupos,
        rateio_centros_custo: data.rateio_centros_custo,
        produtos_lancamento: data.produtos_lancamento,
        observacao: data.observacao,
        anexos_urls: data.anexos_urls,
      };

      // Atualiza o registro principal com todos os dados
      await base44.entities.LancamentoFinanceiro.update(editingLancamento.id, {
        ...camposPropagar,
        valor_total: data.valor_total,
        data_vencimento: data.data_vencimento,
      });

      // Se faz parte de um grupo, propaga para as outras parcelas
      if (editingLancamento.parcelamento_grupo_id) {
        const parceirasDoGrupo = lancamentos.filter(
          l => l.parcelamento_grupo_id === editingLancamento.parcelamento_grupo_id && l.id !== editingLancamento.id
        );
        for (const parcela of parceirasDoGrupo) {
          await base44.entities.LancamentoFinanceiro.update(parcela.id, camposPropagar);
        }
        if (parceirasDoGrupo.length > 0) {
          toast.info(`${parceirasDoGrupo.length} parcela(s) do grupo atualizadas automaticamente.`);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      setEditingLancamento(null);
      setShowForm(false);
      toast.success('Lançamento atualizado!');
      return;
    }

    // CRIAÇÃO: Cada parcela vira um registro separado
    const parcelas = data.parcelas || [];
    const totalParcelas = Math.max(parcelas.length, 1);
    const grupoId = totalParcelas > 1 ? gerarGrupoId() : null;
    const valorTotalLancamento = parcelas.reduce((s, p) => s + (p.valor || 0), 0) || data.valor_total;

    setShowSaveProgress(true);
    setProgressoSalvamento({ etapa: 'Gerando numeração...', current: 5, total: 100 });

    let baseNumero = parseInt(await getNextNumeroLancamento(empresaSelecionadaId));

    for (let i = 0; i < totalParcelas; i++) {
      const parcela = parcelas[i] || {};
      const obsParcela = parcela.observacao_parcela ? parcela.observacao_parcela.toUpperCase() : '';
      
      const dadosParcela = {
        empresa_id: data.empresa_id,
        numero_lancamento: String(baseNumero + i),
        tipo: data.tipo,
        descricao: totalParcelas > 1 ? `${data.descricao} - PARCELA ${i + 1}/${totalParcelas}` : data.descricao,
        status: 'Aberto',
        valor_total: parcela.valor || data.valor_total,
        valor_total_lancamento: valorTotalLancamento,
        valor_pago: 0,
        data_emissao: data.data_emissao,
        data_vencimento: parcela.data_vencimento || data.data_vencimento,
        fornecedor_id: data.fornecedor_id,
        fornecedor_nome: data.fornecedor_nome,
        cliente_id: data.cliente_id,
        cliente_nome: data.cliente_nome,
        tipo_documento_id: data.tipo_documento_id,
        tipo_documento_nome: data.tipo_documento_nome,
        numero_documento: data.numero_documento,
        conta_financeira_id: data.conta_financeira_id,
        conta_financeira_nome: data.conta_financeira_nome,
        forma_pagamento_id: data.forma_pagamento_id,
        forma_pagamento_nome: data.forma_pagamento_nome,
        motivo_compra_id: data.motivo_compra_id,
        motivo_compra_nome: data.motivo_compra_nome,
        parcelamento_grupo_id: grupoId,
        numero_parcela_seq: i + 1,
        total_parcelas_grupo: totalParcelas,
        is_registro_principal: i === 0,
        rateio_grupos: data.rateio_grupos,
        rateio_centros_custo: data.rateio_centros_custo,
        produtos_lancamento: data.produtos_lancamento,
        observacao: data.observacao,
        observacao_parcela: obsParcela || undefined,
        anexos_urls: data.anexos_urls,
      };

      await base44.entities.LancamentoFinanceiro.create(dadosParcela);
      setProgressoSalvamento({
        etapa: totalParcelas > 1 ? `Parcela ${i + 1} de ${totalParcelas}...` : 'Salvando...',
        current: Math.round(((i + 1) / totalParcelas) * 95),
        total: 100
      });
    }

    setProgressoSalvamento({ etapa: 'Concluído!', current: 100, total: 100 });
    await new Promise(resolve => setTimeout(resolve, 400));

    queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
    queryClient.invalidateQueries({ queryKey: ['produtos_financeiro'] });
    setShowForm(false);
    setEditingLancamento(null);
    setDadosXML(null);
    setShowSaveProgress(false);
    toast.success(totalParcelas > 1 ? `${totalParcelas} parcelas lançadas com sucesso!` : 'Lançamento salvo com sucesso!');
  };

  const handleDelete = (id) => setDeleteConfirmId(id);

  const handleEdit = (lanc) => {
    // Só permite editar pelo registro principal se for parcelado
    if (lanc.parcelamento_grupo_id && !lanc.is_registro_principal) {
      // Busca o registro principal
      const principal = lancamentos.find(
        l => l.parcelamento_grupo_id === lanc.parcelamento_grupo_id && l.is_registro_principal
      );
      if (principal) {
        toast.info('Redirecionando para o registro principal para edição...');
        setEditingLancamento(principal);
        setShowForm(true);
        return;
      }
    }
    setEditingLancamento(lanc);
    setShowForm(true);
  };

  const handleBaixa = async (lancamento, dadosLote = null) => {
    if (dadosLote?.baixa_automatica_lote) {
      const user = await base44.auth.me();
      const allBaixas = await base44.entities.BaixaFinanceira.list();
      const maxNumBaixa = allBaixas.reduce((max, b) => Math.max(max, parseInt(b?.numero_baixa) || 0), 0);
      const saldoDisponivel = (lancamento.valor_total || 0) - (lancamento.valor_pago || 0);

      await base44.entities.BaixaFinanceira.create({
        empresa_id: empresaSelecionadaId,
        numero_baixa: String(maxNumBaixa + 1),
        lancamento_id: lancamento.id,
        data_baixa: dadosLote.data_baixa,
        valor_baixa: saldoDisponivel,
        valor_juros: 0,
        valor_multa: 0,
        valor_desconto: 0,
        forma_pagamento_id: dadosLote.forma_pagamento_id,
        forma_pagamento_nome: dadosLote.forma_pagamento_nome,
        observacoes: (dadosLote.observacoes || 'BAIXA EM LOTE').toUpperCase(),
        usuario_responsavel: user.email
      });

      await base44.entities.LancamentoFinanceiro.update(lancamento.id, {
        valor_pago: lancamento.valor_total,
        status: 'Pago'
      });
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      toast.success('Baixa aplicada com sucesso!');
    } else {
      setBaixaLancamento(lancamento);
      setDadosBaixaLote(dadosLote);
    }
  };

  const handleCancelarBaixa = (lancamento) => setCancelarBaixaConfirmId(lancamento.id);

  const handleImportarXMLSuccess = (dadosImportados) => {
    setDadosXML(dadosImportados);
    setShowXmlImport(false);
    setShowForm(true);
  };

  const handleNewLancamento = () => {
    setEditingLancamento(null);
    setDadosXML(null);
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setEditingLancamento(null);
    setDadosXML(null);
    setShowForm(false);
  };

  const handleUpdateLote = async (ids, dadosAtualizados) => {
    for (const id of ids) {
      await base44.entities.LancamentoFinanceiro.update(id, dadosAtualizados);
    }
    queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
  };

  const lancamentosPagar = useMemo(() => lancamentos.filter(l => l && l.tipo === 'Pagar'), [lancamentos]);
  const lancamentosReceber = useMemo(() => lancamentos.filter(l => l && l.tipo === 'Receber'), [lancamentos]);

  // Principais: registro principal do grupo OU lançamentos avulsos (sem grupo)
  const isPrincipalOuAvulso = (l) => !l.parcelamento_grupo_id || l.is_registro_principal;
  // Parcelas: todos os registros que fazem parte de um grupo de parcelamento (inclui parcela 1, 2, 3...)
  const isParcela = (l) => !!l.parcelamento_grupo_id && l.total_parcelas_grupo > 1;

  // Lançamentos únicos (para aba Lançamentos): só principais e avulsos
  const lancamentosPrincipais = useMemo(() => lancamentos.filter(isPrincipalOuAvulso), [lancamentos]);

  const pagarPrincipais = useMemo(() => lancamentosPagar.filter(isPrincipalOuAvulso), [lancamentosPagar]);
  const pagarParcelas = useMemo(() => lancamentosPagar.filter(isParcela), [lancamentosPagar]);
  const receberPrincipais = useMemo(() => lancamentosReceber.filter(isPrincipalOuAvulso), [lancamentosReceber]);
  const receberParcelas = useMemo(() => lancamentosReceber.filter(isParcela), [lancamentosReceber]);

  return (
    <div className="p-1 md:p-1 space-y-1">
      {!showForm && !baixaLancamento && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
            <div>
              <h1 className="font-bold text-slate-800">Lançamentos Financeiros</h1>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 w-7">
                <Settings className="w-4 h-4" />
              </Button>
              {abaAtiva === 'lancamentos' && (
                <>
                  <Button onClick={() => setShowXmlImport(true)} variant="outline" size="sm" className="h-7 text-xs">
                    Importar XML
                  </Button>
                  <Button onClick={() => { handleNewLancamento(); }} size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600">
                    Adicionar
                  </Button>
                </>
              )}
            </div>
          </div>

          <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
            <TabsList className="grid w-full max-w-lg grid-cols-3 h-8 bg-slate-100">
              <TabsTrigger value="lancamentos" className="text-xs">Lançamentos ({lancamentosPrincipais.length})</TabsTrigger>
              <TabsTrigger value="pagar" className="text-xs">Contas a Pagar ({pagarPrincipais.length})</TabsTrigger>
              <TabsTrigger value="receber" className="text-xs">Contas a Receber ({receberPrincipais.length})</TabsTrigger>
            </TabsList>

            {/* ABA LANÇAMENTOS - apenas registros principais (sem sub-abas) */}
            <TabsContent value="lancamentos" className="mt-1">
              <TabelaFinanceiro
                lancamentos={lancamentosPrincipais}
                tipo="Todos"
                modoVisualizacao="principais"
                modoTela="lancamentos"
                onEdit={handleEdit}
                onDelete={handleDelete}
                onBaixa={handleBaixa}
                onCancelarBaixa={handleCancelarBaixa}
                isLoading={loadingLancamentos}
                fornecedores={fornecedores}
                onUpdateLote={handleUpdateLote}
                showConfigColunas={abaAtiva === 'lancamentos' ? showConfigColunas : false}
                setShowConfigColunas={setShowConfigColunas}
              />
            </TabsContent>

            {/* ABA CONTAS A PAGAR - consulta e gerenciamento */}
            <TabsContent value="pagar" className="mt-0 space-y-1">
              <Tabs value={subAbaPagar} onValueChange={setSubAbaPagar}>
                <TabsList className="h-7 bg-slate-50 border">
                  <TabsTrigger value="principais" className="text-[11px] h-5 px-2">Principais ({pagarPrincipais.length})</TabsTrigger>
                  <TabsTrigger value="parcelas" className="text-[11px] h-5 px-2">Parcelas ({pagarParcelas.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="principais" className="mt-1">
                  <TabelaFinanceiro
                    lancamentos={pagarPrincipais}
                    tipo="Pagar"
                    modoVisualizacao="principais"
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onBaixa={handleBaixa}
                    onCancelarBaixa={handleCancelarBaixa}
                    isLoading={loadingLancamentos}
                    fornecedores={fornecedores}
                    onUpdateLote={handleUpdateLote}
                    showConfigColunas={abaAtiva === 'pagar' && subAbaPagar === 'principais' ? showConfigColunas : false}
                    setShowConfigColunas={setShowConfigColunas}
                  />
                </TabsContent>
                <TabsContent value="parcelas" className="mt-1">
                  <TabelaFinanceiro
                    lancamentos={pagarParcelas}
                    tipo="Pagar"
                    modoVisualizacao="parcelas"
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onBaixa={handleBaixa}
                    onCancelarBaixa={handleCancelarBaixa}
                    isLoading={loadingLancamentos}
                    fornecedores={fornecedores}
                    onUpdateLote={handleUpdateLote}
                    showConfigColunas={abaAtiva === 'pagar' && subAbaPagar === 'parcelas' ? showConfigColunas : false}
                    setShowConfigColunas={setShowConfigColunas}
                  />
                </TabsContent>
              </Tabs>
            </TabsContent>

            {/* ABA CONTAS A RECEBER - consulta e gerenciamento */}
            <TabsContent value="receber" className="mt-0 space-y-1">
              <Tabs value={subAbaReceber} onValueChange={setSubAbaReceber}>
                <TabsList className="h-7 bg-slate-50 border">
                  <TabsTrigger value="principais" className="text-[11px] h-5 px-2">Principais ({receberPrincipais.length})</TabsTrigger>
                  <TabsTrigger value="parcelas" className="text-[11px] h-5 px-2">Parcelas ({receberParcelas.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="principais" className="mt-1">
                  <TabelaFinanceiro
                    lancamentos={receberPrincipais}
                    tipo="Receber"
                    modoVisualizacao="principais"
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onBaixa={handleBaixa}
                    onCancelarBaixa={handleCancelarBaixa}
                    isLoading={loadingLancamentos}
                    fornecedores={fornecedores}
                    onUpdateLote={handleUpdateLote}
                    showConfigColunas={abaAtiva === 'receber' && subAbaReceber === 'principais' ? showConfigColunas : false}
                    setShowConfigColunas={setShowConfigColunas}
                  />
                </TabsContent>
                <TabsContent value="parcelas" className="mt-1">
                  <TabelaFinanceiro
                    lancamentos={receberParcelas}
                    tipo="Receber"
                    modoVisualizacao="parcelas"
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onBaixa={handleBaixa}
                    onCancelarBaixa={handleCancelarBaixa}
                    isLoading={loadingLancamentos}
                    fornecedores={fornecedores}
                    onUpdateLote={handleUpdateLote}
                    showConfigColunas={abaAtiva === 'receber' && subAbaReceber === 'parcelas' ? showConfigColunas : false}
                    setShowConfigColunas={setShowConfigColunas}
                  />
                </TabsContent>
              </Tabs>
            </TabsContent>
          </Tabs>
        </>
      )}

      {showForm && (
        <FormularioCompraFinanceiro
          onSubmit={handleSubmit}
          onCancel={handleCancelForm}
          initialData={editingLancamento || dadosXML}
          fornecedores={fornecedores}
          tipoLancamento={editingLancamento?.tipo || dadosXML?.tipo || tipoLancamento}
        />
      )}

      {baixaLancamento && (
        <BaixaFinanceira
          lancamento={baixaLancamento}
          dadosLote={dadosBaixaLote}
          onClose={() => { setBaixaLancamento(null); setDadosBaixaLote(null); }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
            setBaixaLancamento(null);
            setDadosBaixaLote(null);
          }}
        />
      )}

      <ImportarNFeFinanceiro
        open={showXmlImport}
        onClose={() => setShowXmlImport(false)}
        onSuccess={handleImportarXMLSuccess}
        fornecedores={fornecedores}
        produtos={produtos}
      />

      <ConfirmDialog
        open={!!deleteConfirmId}
        onOpenChange={() => setDeleteConfirmId(null)}
        title="Confirmar exclusão"
        description="Tem certeza que deseja excluir este lançamento? Esta ação não pode ser desfeita."
        onConfirm={() => { deleteMutation.mutate(deleteConfirmId); setDeleteConfirmId(null); }}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />

      <ConfirmDialog
        open={!!cancelarBaixaConfirmId}
        onOpenChange={() => setCancelarBaixaConfirmId(null)}
        title="Cancelar baixa"
        description="Deseja cancelar a baixa deste lançamento? O valor pago será zerado."
        onConfirm={() => { cancelarBaixaMutation.mutate(cancelarBaixaConfirmId); setCancelarBaixaConfirmId(null); }}
        confirmText="Cancelar Baixa"
        cancelText="Voltar"
        variant="warning"
      />

      <Dialog open={showSaveProgress} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Salvando...</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-600">{progressoSalvamento.etapa}</p>
            <Progress value={progressoSalvamento.current} className="w-full h-1.5" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}