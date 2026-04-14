import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Download } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format } from "date-fns";
import ConfirmDialog from "@/components/common/ConfirmDialog";

import MovimentacaoEstoqueFormV2 from "../components/movimentacoes/MovimentacaoEstoqueFormV2";
import TabelaMovimentacoes from "../components/movimentacoes/TabelaMovimentacoes";
import ImportarNFeMovimentacao from "../components/movimentacoes/ImportarNFeMovimentacao";
import { getLabelOperacao, getLocalEstoque } from "../components/movimentacoes/utils/movimentacaoUtils";

const gerarGrupoId = () => `MOV-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

export default function MovimentacoesEstoque() {
  const [showForm, setShowForm] = useState(false);
  const [editingMovimentacao, setEditingMovimentacao] = useState(null);
  const [showImportXML, setShowImportXML] = useState(false);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [showSaveProgress, setShowSaveProgress] = useState(false);
  const [progressoSalvamento, setProgressoSalvamento] = useState({ etapa: '', current: 0, total: 100 });
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [abaAtiva, setAbaAtiva] = useState("principais");

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ['movimentacoes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list('-created_date');
      return all.filter(m => m.empresa_id === empresaSelecionadaId && m.status !== 'Cancelada');
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Classificação: principais vs movimentações (igual financeiro)
  const isPrincipalOuAvulso = (m) => !m.movimentacao_grupo_id || m.is_registro_principal;
  const isMovimentacaoGrupo = (m) => !!m.movimentacao_grupo_id && m.total_movimentacoes_grupo > 1;
  const movPrincipais = useMemo(() => movimentacoes.filter(isPrincipalOuAvulso), [movimentacoes]);
  const movTodas = useMemo(() => movimentacoes.filter(isMovimentacaoGrupo), [movimentacoes]);

  const handleSubmit = async (formData) => {
    const { tipo_movimentacao, tipo_detalhado, data_movimentacao, local_estoque_origem, local_origem, local_estoque_destino, local_destino, observacoes: obs, dados_financeiro, produtos_selecionados } = formData;

    setShowSaveProgress(true);
    setProgressoSalvamento({ etapa: 'Preparando...', current: 5, total: 100 });

    // Se editando: excluir registros antigos do grupo e recriar
    if (editingMovimentacao) {
      if (editingMovimentacao.movimentacao_grupo_id) {
        const registrosAntigos = movimentacoes.filter(
          m => m.movimentacao_grupo_id === editingMovimentacao.movimentacao_grupo_id
        );
        setProgressoSalvamento({ etapa: 'Removendo registros antigos...', current: 10, total: 100 });
        // Reverter estoque dos registros antigos
        for (const mov of registrosAntigos) {
          const produto = produtos.find(p => p.id === mov.produto_id);
          if (produto) {
            let novoEstoque = produto.estoque_atual || 0;
            if (mov.tipo_movimentacao === 'Entrada') novoEstoque -= mov.quantidade;
            else if (mov.tipo_movimentacao === 'Saída') novoEstoque += mov.quantidade;
            await base44.entities.Produto.update(produto.id, { estoque_atual: novoEstoque });
          }
          await base44.entities.MovimentacaoEstoque.delete(mov.id);
        }
      } else {
        // Avulso
        const mov = editingMovimentacao;
        const produto = produtos.find(p => p.id === mov.produto_id);
        if (produto) {
          let novoEstoque = produto.estoque_atual || 0;
          if (mov.tipo_movimentacao === 'Entrada') novoEstoque -= mov.quantidade;
          else if (mov.tipo_movimentacao === 'Saída') novoEstoque += mov.quantidade;
          await base44.entities.Produto.update(produto.id, { estoque_atual: novoEstoque });
        }
        await base44.entities.MovimentacaoEstoque.delete(mov.id);
      }
    }

    // Gerar número sequencial
    const maxNum = movimentacoes.reduce((max, m) => {
      const n = parseInt(m.numero_movimentacao, 10);
      return !isNaN(n) && n > max ? n : max;
    }, 0);
    let seqNum = maxNum;

    const fornId = dados_financeiro?.fornecedor_id || '';
    const fornNome = dados_financeiro?.fornecedor_nome || '';
    const numDoc = dados_financeiro?.numero_documento || '';
    const dataDoc = dados_financeiro?.data_emissao || '';

    const user = await base44.auth.me();
    const totalProdutos = produtos_selecionados.length;
    const grupoId = totalProdutos > 1 ? gerarGrupoId() : null;

    for (let idx = 0; idx < totalProdutos; idx++) {
      const item = produtos_selecionados[idx];
      seqNum++;
      const prod = produtos.find(p => p.id === item.produto_id);
      if (!prod) { toast.error(`Produto ${item.produto_nome} não encontrado`); setShowSaveProgress(false); return; }

      const estoqueAntes = prod.estoque_atual || 0;
      let estoqueDepois = estoqueAntes;

      const baseMov = {
        empresa_id: empresaSelecionadaId,
        numero_movimentacao: String(seqNum).padStart(6, '0'),
        tipo_movimentacao,
        tipo_detalhado,
        data_movimentacao: data_movimentacao + 'T00:00:00',
        produto_id: item.produto_id,
        produto_nome: item.produto_nome,
        produto_codigo: prod.codigo_interno || '',
        quantidade: item.quantidade,
        unidade_medida: item.unidade || prod.unidade_medida || '',
        valor_unitario: item.valor_liquido_unitario || item.valor_unitario || 0,
        valor_total: item.valor_liquido || item.valor_total || 0,
        fornecedor_id: fornId,
        fornecedor_nome: fornNome,
        numero_documento: numDoc,
        data_documento: dataDoc || undefined,
        observacoes: obs || '',
        responsavel: user?.email || '',
        usuario_responsavel: user?.email || '',
        status: 'Ativa',
        origem_sistema: 'manual',
        movimentacao_grupo_id: grupoId,
        numero_movimentacao_seq: idx + 1,
        total_movimentacoes_grupo: totalProdutos,
        is_registro_principal: idx === 0,
        modo_saida_fifo: item.modo_saida_fifo || null,
        lotes_consumidos: item.lotes_consumidos || null,
      };

      // ===== ENTRADA =====
      if (tipo_movimentacao === 'Entrada') {
        estoqueDepois = estoqueAntes + item.quantidade;
        await base44.entities.MovimentacaoEstoque.create({
          ...baseMov,
          local_estoque_destino: local_estoque_destino || '',
          local_destino: local_destino || '',
          saldo_antes: estoqueAntes,
          saldo_depois: estoqueDepois,
        });
        await base44.entities.EstoqueLoteNota.create({
          empresa_id: empresaSelecionadaId,
          produto_id: item.produto_id,
          produto_nome: item.produto_nome,
          local_estoque_id: local_estoque_destino || '',
          local_estoque_nome: local_destino || '',
          numero_documento: numDoc || '',
          data_documento: dataDoc || data_movimentacao || '',
          fornecedor_id: fornId || '',
          fornecedor_nome: fornNome || '',
          custo_unitario: item.valor_liquido_unitario || item.valor_unitario || 0,
          quantidade_entrada: item.quantidade,
          quantidade_disponivel: item.quantidade,
          status: 'Disponivel',
        });
        await base44.entities.Produto.update(prod.id, { estoque_atual: estoqueDepois });
      }

      // ===== SAÍDA =====
      else if (tipo_movimentacao === 'Saída' && tipo_detalhado !== 'transferencia') {
        estoqueDepois = estoqueAntes - item.quantidade;

        // Se saída por nota com lotes manuais
        if (item.lotes_consumidos && item.lotes_consumidos.length > 0) {
          for (const lc of item.lotes_consumidos) {
            const lote = await base44.entities.EstoqueLoteNota.filter({ id: lc.lote_id });
            if (lote.length > 0) {
              const novoDisp = Math.max(0, (lote[0].quantidade_disponivel || 0) - lc.quantidade_consumida);
              await base44.entities.EstoqueLoteNota.update(lc.lote_id, {
                quantidade_disponivel: novoDisp,
                status: novoDisp <= 0 ? 'Esgotado' : 'Disponivel',
              });
            }
          }
        } else {
          // FIFO automático
          const localId = local_estoque_origem || '';
          let lotesDisponiveis = await base44.entities.EstoqueLoteNota.filter({
            produto_id: item.produto_id,
            status: 'Disponivel',
            ...(localId ? { local_estoque_id: localId } : {}),
          });
          lotesDisponiveis.sort((a, b) => new Date(a.data_documento || a.created_date) - new Date(b.data_documento || b.created_date));
          let qtdRestante = item.quantidade;
          for (const lote of lotesDisponiveis) {
            if (qtdRestante <= 0) break;
            const consumir = Math.min(qtdRestante, lote.quantidade_disponivel);
            const novoDisp = lote.quantidade_disponivel - consumir;
            await base44.entities.EstoqueLoteNota.update(lote.id, {
              quantidade_disponivel: novoDisp,
              status: novoDisp <= 0 ? 'Esgotado' : 'Disponivel',
            });
            qtdRestante -= consumir;
          }
        }

        await base44.entities.MovimentacaoEstoque.create({
          ...baseMov,
          local_estoque_origem: local_estoque_origem || '',
          local_origem: local_origem || '',
          saldo_antes: estoqueAntes,
          saldo_depois: estoqueDepois,
        });
        await base44.entities.Produto.update(prod.id, { estoque_atual: estoqueDepois });
      }

      // ===== TRANSFERÊNCIA =====
      else if (tipo_detalhado === 'transferencia') {
        estoqueDepois = estoqueAntes - item.quantidade;
        let lotesOrigem = await base44.entities.EstoqueLoteNota.filter({
          produto_id: item.produto_id,
          status: 'Disponivel',
          ...(local_estoque_origem ? { local_estoque_id: local_estoque_origem } : {}),
        });
        lotesOrigem.sort((a, b) => new Date(a.data_documento || a.created_date) - new Date(b.data_documento || b.created_date));
        let qtdRest = item.quantidade;
        let custoMedioTransf = item.valor_unitario || 0;
        let totalCusto = 0;
        let totalQtd = 0;
        for (const lote of lotesOrigem) {
          if (qtdRest <= 0) break;
          const consumir = Math.min(qtdRest, lote.quantidade_disponivel);
          totalCusto += consumir * (lote.custo_unitario || 0);
          totalQtd += consumir;
          const novoDisp = lote.quantidade_disponivel - consumir;
          await base44.entities.EstoqueLoteNota.update(lote.id, {
            quantidade_disponivel: novoDisp,
            status: novoDisp <= 0 ? 'Esgotado' : 'Disponivel',
          });
          qtdRest -= consumir;
        }
        if (totalQtd > 0) custoMedioTransf = totalCusto / totalQtd;

        await base44.entities.MovimentacaoEstoque.create({
          ...baseMov,
          tipo_movimentacao: 'Saída',
          valor_unitario: custoMedioTransf,
          valor_total: item.quantidade * custoMedioTransf,
          local_estoque_origem: local_estoque_origem || '',
          local_origem: local_origem || '',
          local_estoque_destino: local_estoque_destino || '',
          local_destino: local_destino || '',
          saldo_antes: estoqueAntes,
          saldo_depois: estoqueDepois,
        });
        await base44.entities.EstoqueLoteNota.create({
          empresa_id: empresaSelecionadaId,
          produto_id: item.produto_id,
          produto_nome: item.produto_nome,
          local_estoque_id: local_estoque_destino || '',
          local_estoque_nome: local_destino || '',
          numero_documento: numDoc || 'TRANSF',
          data_documento: data_movimentacao || '',
          custo_unitario: custoMedioTransf,
          quantidade_entrada: item.quantidade,
          quantidade_disponivel: item.quantidade,
          status: 'Disponivel',
        });
      }

      setProgressoSalvamento({
        etapa: `Produto ${idx + 1} de ${totalProdutos}...`,
        current: 10 + Math.round(((idx + 1) / totalProdutos) * 85),
        total: 100
      });
    }

    setProgressoSalvamento({ etapa: 'Concluído!', current: 100, total: 100 });
    await new Promise(resolve => setTimeout(resolve, 400));

    queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
    queryClient.invalidateQueries({ queryKey: ['produtos'] });
    setShowForm(false);
    setEditingMovimentacao(null);
    setShowSaveProgress(false);
    toast.success('Movimentação registrada com sucesso!');
  };

  const handleEdit = (movimentacao) => {
    // Só permite editar pelo registro principal
    let registroPrincipal = movimentacao;
    if (movimentacao.movimentacao_grupo_id && !movimentacao.is_registro_principal) {
      const principal = movimentacoes.find(
        m => m.movimentacao_grupo_id === movimentacao.movimentacao_grupo_id && m.is_registro_principal
      );
      if (principal) {
        toast.info('Redirecionando para o registro principal para edição...');
        registroPrincipal = principal;
      }
    }

    // Se faz parte de um grupo, reconstruir os produtos a partir dos registros
    if (registroPrincipal.movimentacao_grupo_id && registroPrincipal.total_movimentacoes_grupo > 1) {
      const todasMovs = movimentacoes
        .filter(m => m.movimentacao_grupo_id === registroPrincipal.movimentacao_grupo_id)
        .sort((a, b) => (a.numero_movimentacao_seq || 0) - (b.numero_movimentacao_seq || 0));

      const produtosReconstruidos = todasMovs.map(m => ({
        produto_id: m.produto_id,
        produto_nome: m.produto_nome,
        unidade_medida: m.unidade_medida,
        quantidade: m.quantidade,
        valor_unitario: m.valor_unitario,
        valor_total: m.valor_total,
        valor_desconto: 0,
        valor_liquido: m.valor_total,
        valor_liquido_unitario: m.valor_unitario,
        lotes_consumidos: m.lotes_consumidos || null,
      }));

      setEditingMovimentacao({
        ...registroPrincipal,
        produtos_para_editar: produtosReconstruidos,
      });
    } else {
      // Avulso: apenas 1 produto
      setEditingMovimentacao({
        ...registroPrincipal,
        produtos_para_editar: [{
          produto_id: registroPrincipal.produto_id,
          produto_nome: registroPrincipal.produto_nome,
          unidade_medida: registroPrincipal.unidade_medida,
          quantidade: registroPrincipal.quantidade,
          valor_unitario: registroPrincipal.valor_unitario,
          valor_total: registroPrincipal.valor_total,
          valor_desconto: 0,
          valor_liquido: registroPrincipal.valor_total,
          valor_liquido_unitario: registroPrincipal.valor_unitario,
          lotes_consumidos: registroPrincipal.lotes_consumidos || null,
        }],
      });
    }
    setShowForm(true);
  };

  const handleDelete = (id) => setDeleteConfirmId(id);

  const handleConfirmDelete = async () => {
    const mov = movimentacoes.find(m => m.id === deleteConfirmId);
    if (!mov) return;

    const bloqueado = mov.bloqueado_exclusao_estoque
      || (mov.exclusao_somente_em && mov.exclusao_somente_em !== 'estoque')
      || ['suplementacao', 'transferencia_enviada', 'transferencia_recebida'].includes(mov.tipo_detalhado);
    if (bloqueado) {
      toast.error('Esse lançamento não pode ser cancelado pela tela de estoque.');
      return;
    }

    // Se é registro principal de um grupo, cancelar todas as movimentações do grupo
    const registrosParaCancelar = mov.movimentacao_grupo_id
      ? movimentacoes.filter(m => m.movimentacao_grupo_id === mov.movimentacao_grupo_id)
      : [mov];

    for (const reg of registrosParaCancelar) {
      const produto = produtos.find(p => p.id === reg.produto_id);
      if (produto) {
        let novoEstoque = produto.estoque_atual || 0;
        if (reg.tipo_movimentacao === 'Entrada') {
          novoEstoque -= reg.quantidade;
          // Reverter lote FIFO
          const lotes = await base44.entities.EstoqueLoteNota.filter({
            produto_id: reg.produto_id,
            local_estoque_id: reg.local_estoque_destino || '',
          });
          const loteCorr = lotes.find(l =>
            l.quantidade_disponivel >= reg.quantidade &&
            (l.numero_documento || '') === (reg.numero_documento || '')
          ) || lotes.find(l => l.quantidade_disponivel >= reg.quantidade);
          if (loteCorr) {
            const novoDisp = loteCorr.quantidade_disponivel - reg.quantidade;
            await base44.entities.EstoqueLoteNota.update(loteCorr.id, {
              quantidade_disponivel: novoDisp,
              status: novoDisp <= 0 ? 'Esgotado' : 'Disponivel',
            });
          }
        } else if (reg.tipo_movimentacao === 'Saída') {
          novoEstoque += reg.quantidade;
          await base44.entities.EstoqueLoteNota.create({
            empresa_id: empresaSelecionadaId,
            produto_id: reg.produto_id,
            produto_nome: reg.produto_nome || produto.nome_produto,
            local_estoque_id: reg.local_estoque_origem || '',
            local_estoque_nome: reg.local_origem || '',
            numero_documento: 'REV-' + (reg.numero_movimentacao || ''),
            data_documento: new Date().toISOString().slice(0, 10),
            custo_unitario: reg.valor_unitario || 0,
            quantidade_entrada: reg.quantidade,
            quantidade_disponivel: reg.quantidade,
            status: 'Disponivel',
          });
        }
        await base44.entities.Produto.update(produto.id, { estoque_atual: novoEstoque });
      }
      await base44.entities.MovimentacaoEstoque.update(reg.id, {
        status: 'Cancelada',
        data_cancelamento: new Date().toISOString(),
        motivo_cancelamento: 'CANCELAMENTO'
      });
    }

    queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
    queryClient.invalidateQueries({ queryKey: ['produtos'] });
    toast.success('Movimentação cancelada!');
    setDeleteConfirmId(null);
  };

  const handleCancel = async (id, isBulk = false) => {
    if (!isBulk) {
      handleDelete(id);
      return;
    }
    // Bulk: cancelar diretamente
    const mov = movimentacoes.find(m => m.id === id);
    if (!mov) return;
    const bloqueado = mov.bloqueado_exclusao_estoque
      || (mov.exclusao_somente_em && mov.exclusao_somente_em !== 'estoque')
      || ['suplementacao', 'transferencia_enviada', 'transferencia_recebida'].includes(mov.tipo_detalhado);
    if (bloqueado) return;

    const produto = produtos.find(p => p.id === mov.produto_id);
    if (!produto) return;
    let novoEstoque = produto.estoque_atual || 0;
    if (mov.tipo_movimentacao === 'Entrada') novoEstoque -= mov.quantidade;
    else if (mov.tipo_movimentacao === 'Saída') novoEstoque += mov.quantidade;
    await base44.entities.MovimentacaoEstoque.update(id, { status: 'Cancelada', data_cancelamento: new Date().toISOString(), motivo_cancelamento: 'CANCELAMENTO' });
    await base44.entities.Produto.update(produto.id, { estoque_atual: novoEstoque });
  };

  const handleExport = () => {
    const csvRows = [['Nº', 'Data/Hora', 'Tipo', 'Tipo Detalhado', 'Produto', 'Qtd', 'Local Estoque', 'Documento', 'Motivo'].join(';')];
    movimentacoes.forEach(m => {
      csvRows.push([
        m.numero_movimentacao, format(new Date(m.data_movimentacao), 'dd/MM/yyyy HH:mm'),
        m.tipo_movimentacao, getLabelOperacao(m.tipo_detalhado), m.produto_nome,
        m.quantidade, getLocalEstoque(m), m.numero_documento || '', m.motivo_movimentacao || ''
      ].join(';'));
    });
    const blob = new Blob(['\ufeff' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `movimentacoes_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
    link.click();
    toast.success('Exportado!');
  };

  return (
    <div className="p-1 md:p-1 space-y-1">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
            <div>
              <h1 className="font-bold text-slate-800">Movimentações de Estoque</h1>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="h-7 w-7 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground">
                <Settings className="w-4 h-4" />
              </Button>
              <Button onClick={() => setShowImportXML(true)} variant="outline" size="sm" className="h-7 text-xs">
                Importação NF-e
              </Button>
              <Button onClick={handleExport} variant="outline" size="sm" className="h-7 text-xs">
                Exportar
              </Button>
              <Button onClick={() => { setEditingMovimentacao(null); setShowForm(true); }} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs">
                Adicionar
              </Button>
            </div>
          </div>

          <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
            <TabsList className="h-7 bg-slate-50 border">
              <TabsTrigger value="principais" className="text-[11px] h-5 px-2">Principais ({movPrincipais.length})</TabsTrigger>
              <TabsTrigger value="movimentacoes" className="text-[11px] h-5 px-2">Movimentações ({movTodas.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="principais" className="mt-1">
              <TabelaMovimentacoes
                movimentacoes={movPrincipais}
                onEdit={handleEdit}
                onCancel={handleCancel}
                isLoading={isLoading}
                showConfigColunas={abaAtiva === 'principais' ? showConfigColunas : false}
                setShowConfigColunas={setShowConfigColunas}
                modoVisualizacao="principais"
                allMovimentacoes={movimentacoes}
              />
            </TabsContent>
            <TabsContent value="movimentacoes" className="mt-1">
              <TabelaMovimentacoes
                movimentacoes={movTodas}
                onEdit={handleEdit}
                onCancel={handleCancel}
                isLoading={isLoading}
                showConfigColunas={abaAtiva === 'movimentacoes' ? showConfigColunas : false}
                setShowConfigColunas={setShowConfigColunas}
                modoVisualizacao="movimentacoes"
                allMovimentacoes={movimentacoes}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <MovimentacaoEstoqueFormV2
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingMovimentacao(null); }}
            initialData={editingMovimentacao}
            produtos={produtos}
            fornecedores={fornecedores}
          />
        )}
      </AnimatePresence>

      <ImportarNFeMovimentacao
        open={showImportXML}
        onClose={() => setShowImportXML(false)}
        onSuccess={() => { setShowImportXML(false); toast.info('Importação XML em construção.'); }}
        produtos={produtos}
        fornecedores={fornecedores}
      />

      <ConfirmDialog
        open={!!deleteConfirmId}
        onOpenChange={() => setDeleteConfirmId(null)}
        title="Confirmar cancelamento"
        description="Tem certeza que deseja cancelar esta movimentação e reverter o estoque? Se for um grupo, todas as movimentações vinculadas serão canceladas."
        onConfirm={handleConfirmDelete}
        confirmText="Cancelar Movimentação"
        cancelText="Voltar"
        variant="destructive"
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