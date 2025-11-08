
import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, Plus, TrendingUp, TrendingDown, AlertCircle, FileText } from "lucide-react";
import { toast } from "sonner";
import FormularioFinanceiro from "../components/financeiro/FormularioFinanceiro.jsx";
import TabelaFinanceiro from "../components/financeiro/TabelaFinanceiro.jsx";
import BaixaFinanceira from "../components/financeiro/BaixaFinanceira.jsx";
import ImportarNFeFinanceiro from "../components/financeiro/ImportarNFeFinanceiro.jsx";

const getNextNumber = async (empresaId) => {
  const all = await base44.entities.LancamentoFinanceiro.list();
  const filtered = all.filter(l => l.empresa_id === empresaId);
  const maxNum = filtered.reduce((max, l) => Math.max(max, parseInt(l.numero_lancamento) || 0), 0);
  return maxNum + 1;
};

const getNextNumeroMovimentacao = async (empresaId) => {
  const all = await base44.entities.MovimentacaoEstoque.list();
  const filtered = all.filter(m => m.empresa_id === empresaId);
  const maxNum = filtered.reduce((max, m) => Math.max(max, parseInt(m.numero_movimentacao) || 0), 0);
  return maxNum + 1;
};

const getNextNumeroLivro = async (empresaId) => {
  const all = await base44.entities.LivroFiscal.list();
  const filtered = all.filter(l => l.empresa_id === empresaId);
  const maxNum = filtered.reduce((max, l) => Math.max(max, parseInt(l.numero_registro) || 0), 0);
  return maxNum + 1;
};

export default function Financeiro() {
  const [tipoAba, setTipoAba] = useState("pagar");
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showBaixa, setShowBaixa] = useState(false);
  const [itemBaixa, setItemBaixa] = useState(null);
  const [showImportarXML, setShowImportarXML] = useState(false);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: lancamentos = [], isLoading } = useQuery({
    queryKey: ['lancamentos_financeiros', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoFinanceiro.list('-data_emissao');
      return all.filter(l => l.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list('nome');
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list('nome_produto');
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: safras = [] } = useQuery({
    queryKey: ['safras_financeiro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Safra.list();
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const numero = await getNextNumber(empresaSelecionadaId);
      
      const valorTotal = (data.valor_original || 0) + (data.valor_juros || 0) + (data.valor_multa || 0) - (data.valor_desconto || 0);
      
      const lancamento = {
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_lancamento: String(numero),
        valor_total: valorTotal,
        valor_pago: 0,
        valor_saldo: valorTotal,
        status: 'Pendente'
      };

      if (data.parcelas && data.parcelas.length > 0) {
        const lancamentoPai = await base44.entities.LancamentoFinanceiro.create(lancamento);
        
        for (let i = 0; i < data.parcelas.length; i++) {
          const parcela = data.parcelas[i];
          const numeroParcela = await getNextNumber(empresaSelecionadaId);
          
          await base44.entities.LancamentoFinanceiro.create({
            ...lancamento,
            numero_lancamento: String(numeroParcela),
            valor_original: parcela.valor,
            valor_total: parcela.valor,
            valor_saldo: parcela.valor,
            valor_juros: 0,
            valor_multa: 0,
            valor_desconto: 0,
            data_vencimento: parcela.data,
            numero_parcela: i + 1,
            total_parcelas: data.parcelas.length,
            lancamento_pai_id: lancamentoPai.id
          });
        }
        
        return lancamentoPai;
      } else {
        return base44.entities.LancamentoFinanceiro.create(lancamento);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      setShowForm(false);
      setEditingItem(null);
      toast.success('✅ Lançamento salvo!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => {
      const valorTotal = (data.valor_original || 0) + (data.valor_juros || 0) + (data.valor_multa || 0) - (data.valor_desconto || 0);
      return base44.entities.LancamentoFinanceiro.update(id, { ...data, valor_total: valorTotal });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      setShowForm(false);
      setEditingItem(null);
      toast.success('✅ Atualizado!');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const baixas = await base44.entities.BaixaFinanceira.list();
      const temBaixas = baixas.some(b => b.lancamento_id === id);
      if (temBaixas) {
        throw new Error('❌ Possui baixas!');
      }
      return base44.entities.LancamentoFinanceiro.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      toast.success('✅ Excluído!');
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const handleSubmit = (data) => {
    if (editingItem?.id) {
      updateMutation.mutate({ id: editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('⚠️ Excluir?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleBaixa = (item) => {
    setItemBaixa(item);
    setShowBaixa(true);
  };

  const handleImportarXMLSuccess = async (dados) => {
    try {
      console.log('🚀 Iniciando importação:', dados);
      
      const movIds = [];
      
      if (dados.gerarEstoque && dados.itens?.length > 0) {
        toast.info('📦 Lançando estoque...');
        
        for (const item of dados.itens) {
          const num = await getNextNumeroMovimentacao(empresaSelecionadaId);
          const prod = produtos.find(p => p.id === item.produto_id);
          
          const mov = await base44.entities.MovimentacaoEstoque.create({
            empresa_id: empresaSelecionadaId,
            numero_movimentacao: String(num),
            tipo_movimentacao: 'Entrada',
            tipo_detalhado: 'Compra',
            data_movimentacao: new Date().toISOString(),
            produto_id: item.produto_id,
            produto_nome: item.produto_nome,
            produto_codigo: item.codigo,
            quantidade: item.quantidade,
            unidade_medida: item.unidade,
            local_estoque_destino: dados.dadosComplementares.local_estoque,
            valor_unitario: item.valor_unitario,
            valor_total: item.quantidade * item.valor_unitario,
            custo_medio_antes: prod?.preco_custo || 0,
            custo_medio_depois: (prod?.estoque_atual > 0) 
              ? ((prod.preco_custo * prod.estoque_atual) + (item.valor_unitario * item.quantidade)) / (prod.estoque_atual + item.quantidade)
              : item.valor_unitario,
            saldo_antes: prod?.estoque_atual || 0,
            saldo_depois: (prod?.estoque_atual || 0) + item.quantidade,
            tipo_documento: 'Nota Fiscal',
            numero_documento: dados.dadosNFe.numero,
            chave_documento: dados.dadosNFe.chave,
            data_documento: dados.dadosNFe.data_emissao,
            fornecedor_id: dados.fornecedor_id,
            fornecedor_nome: fornecedores.find(f => f.id === dados.fornecedor_id)?.nome,
            centro_custo_id: dados.dadosComplementares?.centro_custo_id,
            motivo_movimentacao: `COMPRA NF-e ${dados.dadosNFe.numero}`,
            observacoes: dados.dadosComplementares?.observacoes || '',
            usuario_responsavel: (await base44.auth.me()).email,
            status: 'Ativa'
          });
          
          movIds.push(mov.id);
          
          await base44.entities.Produto.update(item.produto_id, {
            estoque_atual: (prod?.estoque_atual || 0) + item.quantidade,
            preco_custo: mov.custo_medio_depois
          });
        }
        
        toast.success(`✅ ${dados.itens.length} produto(s) no estoque!`);
      }

      let livroId = null;
      if (dados.gerarLivroFiscal && dados.itens?.length > 0) {
        toast.info('📚 Livro fiscal...');
        
        const num = await getNextNumeroLivro(empresaSelecionadaId);
        const forn = fornecedores.find(f => f.id === dados.fornecedor_id);
        
        const livro = await base44.entities.LivroFiscal.create({
          empresa_id: empresaSelecionadaId,
          numero_registro: String(num),
          tipo_livro: 'Entrada',
          tipo_documento: 'NF-e',
          numero_documento: dados.dadosNFe.numero,
          serie_documento: dados.dadosNFe.serie,
          chave_acesso: dados.dadosNFe.chave,
          data_emissao: dados.dadosNFe.data_emissao,
          data_entrada_saida: new Date().toISOString().split('T')[0],
          fornecedor_id: dados.fornecedor_id,
          fornecedor_nome: forn?.nome,
          fornecedor_cnpj_cpf: forn?.cnpj || forn?.cpf,
          cfop: dados.dadosNFe.cfop || '5102',
          natureza_operacao: dados.dadosNFe.natureza_operacao || 'COMPRA',
          valor_produtos: dados.itens.reduce((s, i) => s + (i.quantidade * i.valor_unitario), 0),
          valor_total_nota: dados.dadosNFe.valor_total,
          itens: dados.itens.map(i => ({
            produto_id: i.produto_id,
            produto_nome: i.produto_nome,
            codigo_produto: i.codigo,
            ncm: i.ncm,
            cfop: i.cfop,
            quantidade: i.quantidade,
            unidade: i.unidade,
            valor_unitario: i.valor_unitario,
            valor_total: i.quantidade * i.valor_unitario
          })),
          movimentacao_estoque_ids: movIds,
          status: 'Ativo'
        });
        
        livroId = livro.id;
        toast.success('✅ Livro fiscal!');
      }

      if (dados.gerarFinanceiro) {
        toast.info('💰 Abrindo formulário financeiro...');
        
        setEditingItem({
          tipo: 'Pagar',
          tipo_documento: 'NF-e',
          fornecedor_id: dados.fornecedor_id,
          numero_documento: dados.dadosNFe.numero,
          chave_nfe: dados.dadosNFe.chave,
          data_emissao: dados.dadosNFe.data_emissao,
          data_vencimento: dados.dataVencimento,
          valor_original: dados.dadosNFe.valor_total,
          valor_juros: 0,
          valor_multa: 0,
          valor_desconto: 0,
          observacoes: dados.dadosComplementares?.observacoes || `IMPORTAÇÃO NF-e ${dados.dadosNFe.numero}`,
          parcelar: dados.parcelar || false,
          parcelas: dados.parcelas || [],
          produtos_lancamento: dados.itens.map(i => ({
            produto_id: i.produto_id,
            produto_nome: i.produto_nome,
            quantidade: i.quantidade,
            valor_unitario: i.valor_unitario,
            desconto: 0
          }))
        });
        
        setShowImportarXML(false);
        setShowForm(true);
        toast.info('📝 Revise e salve o lançamento');
      } else {
        setShowImportarXML(false);
        queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
        queryClient.invalidateQueries({ queryKey: ['produtos_financeiro'] });
        toast.success('✅ Importação concluída!');
      }
      
    } catch (error) {
      console.error('❌ Erro:', error);
      toast.error('Erro: ' + error.message);
    }
  };

  const lancamentosPagar = lancamentos.filter(l => l.tipo === 'Pagar' && !l.lancamento_pai_id);
  const lancamentosReceber = lancamentos.filter(l => l.tipo === 'Receber' && !l.lancamento_pai_id);

  const estatisticas = useMemo(() => {
    const contasPagar = lancamentosPagar.filter(l => l.status !== 'Pago' && l.status !== 'Cancelado');
    const contasReceber = lancamentosReceber.filter(l => l.status !== 'Pago' && l.status !== 'Cancelado');
    const vencidos = lancamentos.filter(l => new Date(l.data_vencimento) < new Date() && l.status === 'Pendente');
    
    return {
      totalPagar: contasPagar.reduce((sum, l) => sum + (l.valor_saldo || 0), 0),
      totalReceber: contasReceber.reduce((sum, l) => sum + (l.valor_saldo || 0), 0),
      totalVencidos: vencidos.reduce((sum, l) => sum + (l.valor_saldo || 0), 0),
      qtdVencidos: vencidos.length
    };
  }, [lancamentos, lancamentosPagar, lancamentosReceber]);

  const formatarMoeda = (valor) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-green-900">Controle Financeiro</h1>
          <p className="text-green-700">Gerenciar contas a pagar e receber</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-lg border-red-200 bg-gradient-to-br from-white to-red-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-700">Contas a Pagar</CardTitle>
            <TrendingDown className="h-5 w-5 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-900">{formatarMoeda(estatisticas.totalPagar)}</div>
            <p className="text-xs text-red-600 mt-1">{lancamentosPagar.filter(l => l.status !== 'Pago' && l.status !== 'Cancelado').length} título(s)</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-700">Contas a Receber</CardTitle>
            <TrendingUp className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">{formatarMoeda(estatisticas.totalReceber)}</div>
            <p className="text-xs text-green-600 mt-1">{lancamentosReceber.filter(l => l.status !== 'Pago' && l.status !== 'Cancelado').length} título(s)</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-orange-200 bg-gradient-to-br from-white to-orange-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-700">Títulos Vencidos</CardTitle>
            <AlertCircle className="h-5 w-5 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-900">{formatarMoeda(estatisticas.totalVencidos)}</div>
            <p className="text-xs text-orange-600 mt-1">⚠️ {estatisticas.qtdVencidos} título(s)</p>
          </CardContent>
        </Card>
      </div>

      {!showForm && !showBaixa && (
        <div className="flex gap-3">
          <Button onClick={() => setShowImportarXML(true)} variant="outline" className="gap-2">
            <FileText className="w-5 h-5" />
            Importar NF-e (XML)
          </Button>
          <Button onClick={() => { setEditingItem(null); setShowForm(true); }} className="bg-green-600 gap-2">
            <Plus className="w-5 h-5" />
            Novo Lançamento
          </Button>
        </div>
      )}

      {showForm && (
        <FormularioFinanceiro
          onSubmit={handleSubmit}
          onCancel={() => { setShowForm(false); setEditingItem(null); }}
          initialData={editingItem}
          fornecedores={fornecedores}
          produtos={produtos}
          safras={safras}
        />
      )}

      {showBaixa && (
        <BaixaFinanceira
          lancamento={itemBaixa}
          onClose={() => { setShowBaixa(false); setItemBaixa(null); }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
            setShowBaixa(false);
            setItemBaixa(null);
          }}
        />
      )}

      <ImportarNFeFinanceiro
        open={showImportarXML}
        onClose={() => setShowImportarXML(false)}
        onSuccess={handleImportarXMLSuccess}
        fornecedores={fornecedores}
        produtos={produtos}
      />

      {!showForm && !showBaixa && (
        <Tabs value={tipoAba} onValueChange={setTipoAba}>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="pagar" className="gap-2">
              <TrendingDown className="w-4 h-4" />
              A Pagar ({lancamentosPagar.length})
            </TabsTrigger>
            <TabsTrigger value="receber" className="gap-2">
              <TrendingUp className="w-4 h-4" />
              A Receber ({lancamentosReceber.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pagar">
            <TabelaFinanceiro
              lancamentos={lancamentosPagar}
              tipo="Pagar"
              onEdit={handleEdit}
              onDelete={handleDelete}
              onBaixa={handleBaixa}
              isLoading={isLoading}
              fornecedores={fornecedores}
              produtos={produtos}
            />
          </TabsContent>

          <TabsContent value="receber">
            <TabelaFinanceiro
              lancamentos={lancamentosReceber}
              tipo="Receber"
              onEdit={handleEdit}
              onDelete={handleDelete}
              onBaixa={handleBaixa}
              isLoading={isLoading}
              fornecedores={fornecedores}
              produtos={produtos}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

const formatarNumero = (num) => {
  if (num === null || num === undefined) return '0,00';
  return String(num).replace('.', ',');
};
