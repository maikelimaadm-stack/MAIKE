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
    // TODO: Implementar nova lógica de processamento
    toast.info('Formulário em construção.');
  };

  const handleEdit = (movimentacao) => {
    setEditingMovimentacao(movimentacao);
    setShowForm(true);
  };

  const handleCancel = async (id) => {
    const mov = movimentacoes.find(m => m.id === id);
    if (!mov) return;

    const bloqueado = mov.bloqueado_exclusao_estoque
      || (mov.exclusao_somente_em && mov.exclusao_somente_em !== 'estoque')
      || ['suplementacao', 'transferencia_enviada', 'transferencia_recebida'].includes(mov.tipo_detalhado);

    if (bloqueado) {
      toast.error('Esse lançamento não pode ser cancelado pela tela de estoque.');
      return;
    }

    if (!window.confirm('Cancelar movimentação e reverter estoque?')) return;

    const produto = produtos.find(p => p.id === mov.produto_id);
    if (!produto) { toast.error('Produto não encontrado'); return; }

    let novoEstoque = produto.estoque_atual || 0;
    if (mov.tipo_movimentacao === 'Entrada') novoEstoque -= mov.quantidade;
    else if (mov.tipo_movimentacao === 'Saída') novoEstoque += mov.quantidade;

    await base44.entities.MovimentacaoEstoque.update(id, {
      status: 'Cancelada',
      data_cancelamento: new Date().toISOString(),
      motivo_cancelamento: 'CANCELAMENTO'
    });
    await base44.entities.Produto.update(produto.id, { estoque_atual: novoEstoque });

    queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
    queryClient.invalidateQueries({ queryKey: ['produtos'] });
    toast.success('Movimentação cancelada!');
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
    // TODO: processar dados importados no novo formulário
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