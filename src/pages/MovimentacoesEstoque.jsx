import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Settings, Download } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format } from "date-fns";

import MovimentacaoEstoqueFormV2 from "../components/movimentacoes/MovimentacaoEstoqueFormV2";
import TabelaMovimentacoes from "../components/movimentacoes/TabelaMovimentacoes";
import ImportarNFeMovimentacao from "../components/movimentacoes/ImportarNFeMovimentacao";
import { getLabelOperacao, getLocalEstoque } from "../components/movimentacoes/utils/movimentacaoUtils";

export default function MovimentacoesEstoque() {
  const [showForm, setShowForm] = useState(false);
  const [editingMovimentacao, setEditingMovimentacao] = useState(null);
  const [showImportXML, setShowImportXML] = useState(false);
  const [showConfigColunas, setShowConfigColunas] = useState(false);

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

  const handleSubmit = async (formData) => {
    const { tipo_movimentacao, tipo_detalhado, data_movimentacao, local_estoque_origem, local_origem, local_estoque_destino, local_destino, observacoes: obs, dados_financeiro, produtos_selecionados } = formData;

    // Gerar número sequencial
    const maxNum = movimentacoes.reduce((max, m) => {
      const n = parseInt(m.numero_movimentacao, 10);
      return !isNaN(n) && n > max ? n : max;
    }, 0);
    let seqNum = maxNum;

    // Dados do financeiro integrado (se houver)
    const fornId = dados_financeiro?.fornecedor_id || '';
    const fornNome = dados_financeiro?.fornecedor_nome || '';
    const numDoc = dados_financeiro?.numero_documento || '';
    const dataDoc = dados_financeiro?.data_emissao || '';

    const user = await base44.auth.me();

    for (const item of produtos_selecionados) {
      seqNum++;
      const prod = produtos.find(p => p.id === item.produto_id);
      if (!prod) { toast.error(`Produto ${item.produto_nome} não encontrado`); return; }

      const estoqueAntes = prod.estoque_atual || 0;
      let estoqueDepois = estoqueAntes;

      // ===== ENTRADA =====
      if (tipo_movimentacao === 'Entrada') {
        estoqueDepois = estoqueAntes + item.quantidade;

        // Criar registro de MovimentacaoEstoque
        const movData = {
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
          local_estoque_destino: local_estoque_destino || '',
          local_destino: local_destino || '',
          fornecedor_id: fornId,
          fornecedor_nome: fornNome,
          numero_documento: numDoc,
          data_documento: dataDoc || undefined,
          saldo_antes: estoqueAntes,
          saldo_depois: estoqueDepois,
          observacoes: obs || '',
          responsavel: user?.email || '',
          usuario_responsavel: user?.email || '',
          status: 'Ativa',
          origem_sistema: 'manual',
        };
        await base44.entities.MovimentacaoEstoque.create(movData);

        // Criar lote FIFO (EstoqueLoteNota)
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

        // Atualizar estoque do produto
        await base44.entities.Produto.update(prod.id, { estoque_atual: estoqueDepois });
      }

      // ===== SAÍDA =====
      else if (tipo_movimentacao === 'Saída' && tipo_detalhado !== 'transferencia') {
        estoqueDepois = estoqueAntes - item.quantidade;

        // FIFO: consumir lotes mais antigos primeiro
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
          const novoDisponivel = lote.quantidade_disponivel - consumir;
          await base44.entities.EstoqueLoteNota.update(lote.id, {
            quantidade_disponivel: novoDisponivel,
            status: novoDisponivel <= 0 ? 'Esgotado' : 'Disponivel',
          });
          qtdRestante -= consumir;
        }

        const movData = {
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
          local_estoque_origem: local_estoque_origem || '',
          local_origem: local_origem || '',
          fornecedor_id: fornId,
          fornecedor_nome: fornNome,
          numero_documento: numDoc,
          saldo_antes: estoqueAntes,
          saldo_depois: estoqueDepois,
          observacoes: obs || '',
          responsavel: user?.email || '',
          usuario_responsavel: user?.email || '',
          status: 'Ativa',
          origem_sistema: 'manual',
        };
        await base44.entities.MovimentacaoEstoque.create(movData);
        await base44.entities.Produto.update(prod.id, { estoque_atual: estoqueDepois });
      }

      // ===== TRANSFERÊNCIA =====
      else if (tipo_detalhado === 'transferencia') {
        // Saída da origem
        estoqueDepois = estoqueAntes - item.quantidade;

        // FIFO na origem
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

        // Movimento saída
        const movSaida = {
          empresa_id: empresaSelecionadaId,
          numero_movimentacao: String(seqNum).padStart(6, '0'),
          tipo_movimentacao: 'Saída',
          tipo_detalhado: 'transferencia',
          data_movimentacao: data_movimentacao + 'T00:00:00',
          produto_id: item.produto_id,
          produto_nome: item.produto_nome,
          quantidade: item.quantidade,
          unidade_medida: item.unidade || prod.unidade_medida || '',
          valor_unitario: custoMedioTransf,
          valor_total: item.quantidade * custoMedioTransf,
          local_estoque_origem: local_estoque_origem || '',
          local_origem: local_origem || '',
          local_estoque_destino: local_estoque_destino || '',
          local_destino: local_destino || '',
          saldo_antes: estoqueAntes,
          saldo_depois: estoqueDepois,
          observacoes: obs || '',
          responsavel: user?.email || '',
          usuario_responsavel: user?.email || '',
          status: 'Ativa',
          origem_sistema: 'manual',
        };
        await base44.entities.MovimentacaoEstoque.create(movSaida);

        // Criar lote FIFO no destino
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

        // Estoque do produto não muda no total (saiu de um lugar, entrou em outro)
        // Mas se o estoque_atual do produto é global, mantém igual
      }
    }

    queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
    queryClient.invalidateQueries({ queryKey: ['produtos'] });
    setShowForm(false);
    setEditingMovimentacao(null);
    toast.success('Movimentação registrada com sucesso!');
  };

  const handleEdit = (movimentacao) => {
    setEditingMovimentacao(movimentacao);
    setShowForm(true);
  };

  const handleCancel = async (id, isBulk = false) => {
    const mov = movimentacoes.find(m => m.id === id);
    if (!mov) return;

    const bloqueado = mov.bloqueado_exclusao_estoque
      || (mov.exclusao_somente_em && mov.exclusao_somente_em !== 'estoque')
      || ['suplementacao', 'transferencia_enviada', 'transferencia_recebida'].includes(mov.tipo_detalhado);

    if (bloqueado) {
      toast.error('Esse lançamento não pode ser cancelado pela tela de estoque.');
      return;
    }

    if (!isBulk && !window.confirm('Cancelar movimentação e reverter estoque?')) return;

    const produto = produtos.find(p => p.id === mov.produto_id);
    if (!produto) { toast.error('Produto não encontrado'); return; }

    let novoEstoque = produto.estoque_atual || 0;

    if (mov.tipo_movimentacao === 'Entrada') {
      novoEstoque -= mov.quantidade;
      // Reverter FIFO: buscar lote correspondente e reduzir quantidade_disponivel
      const lotes = await base44.entities.EstoqueLoteNota.filter({
        produto_id: mov.produto_id,
        local_estoque_id: mov.local_estoque_destino || '',
      });
      // Encontrar o lote mais recente com quantidade suficiente (pela movimentação)
      const loteCorr = lotes.find(l =>
        l.quantidade_disponivel >= mov.quantidade &&
        (l.numero_documento || '') === (mov.numero_documento || '')
      ) || lotes.find(l => l.quantidade_disponivel >= mov.quantidade);
      if (loteCorr) {
        const novoDisp = loteCorr.quantidade_disponivel - mov.quantidade;
        await base44.entities.EstoqueLoteNota.update(loteCorr.id, {
          quantidade_disponivel: novoDisp,
          status: novoDisp <= 0 ? 'Esgotado' : 'Disponivel',
        });
      }
    } else if (mov.tipo_movimentacao === 'Saída') {
      novoEstoque += mov.quantidade;
      // Reverter FIFO saída: restaurar lotes (cria novo lote com custo da movimentação)
      await base44.entities.EstoqueLoteNota.create({
        empresa_id: empresaSelecionadaId,
        produto_id: mov.produto_id,
        produto_nome: mov.produto_nome || produto.nome_produto,
        local_estoque_id: mov.local_estoque_origem || '',
        local_estoque_nome: mov.local_origem || '',
        numero_documento: 'REV-' + (mov.numero_movimentacao || ''),
        data_documento: new Date().toISOString().slice(0, 10),
        custo_unitario: mov.valor_unitario || 0,
        quantidade_entrada: mov.quantidade,
        quantidade_disponivel: mov.quantidade,
        status: 'Disponivel',
      });
    }

    await base44.entities.MovimentacaoEstoque.update(id, {
      status: 'Cancelada',
      data_cancelamento: new Date().toISOString(),
      motivo_cancelamento: 'CANCELAMENTO'
    });
    await base44.entities.Produto.update(produto.id, { estoque_atual: novoEstoque });

    if (!isBulk) {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      toast.success('Movimentação cancelada!');
    }
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

  const handleImportacaoXML = (dadosImportacao) => {
    setShowImportXML(false);
    toast.info('Importação XML em construção.');
  };

  return (
    <div className="p-1 md:p-1 space-y-1">
      {!showForm && (
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

      {!showForm && (
        <TabelaMovimentacoes
          movimentacoes={movimentacoes}
          onEdit={handleEdit}
          onCancel={handleCancel}
          isLoading={isLoading}
          showConfigColunas={showConfigColunas}
          setShowConfigColunas={setShowConfigColunas}
        />
      )}

      <ImportarNFeMovimentacao
        open={showImportXML}
        onClose={() => setShowImportXML(false)}
        onSuccess={handleImportacaoXML}
        produtos={produtos}
        fornecedores={fornecedores}
      />
    </div>
  );
}