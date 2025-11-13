import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

import FormularioCompraFinanceiro from "../components/financeiro/FormularioCompraFinanceiro.jsx";
import TabelaFinanceiro from "../components/financeiro/TabelaFinanceiro.jsx";
import BaixaFinanceira from "../components/financeiro/BaixaFinanceira.jsx";
import ImportarNFeFinanceiro from "../components/financeiro/ImportarNFeFinanceiro.jsx";

const getNextNumber = async (empresaId) => {
  const all = await base44.entities.LancamentoFinanceiro.list();
  const filtered = all.filter(l => l && l.empresa_id === empresaId);
  return filtered.reduce((max, l) => Math.max(max, parseInt(l.numero_lancamento) || 0), 0) + 1;
};

export default function LancamentoFinanceiro() {
  const [abaAtiva, setAbaAtiva] = useState("pesquisar");
  const [tipoAtivo, setTipoAtivo] = useState("pagar");
  const [editingLancamento, setEditingLancamento] = useState(null);
  const [baixaLancamento, setBaixaLancamento] = useState(null);
  const [showImportXML, setShowImportXML] = useState(false);
  const [dadosXML, setDadosXML] = useState(null);
  const [showProgressoSalvamento, setShowProgressoSalvamento] = useState(false);
  const [progressoSalvamento, setProgressoSalvamento] = useState({ etapa: '', current: 0, total: 100 });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: lancamentos = [], isLoading: loadingLancamentos } = useQuery({
    queryKey: ['lancamentos_financeiros', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoFinanceiro.list('-data_emissao');
      return all.filter(l => l && l.empresa_id === empresaSelecionadaId).map(l => ({
        ...l,
        valor_saldo: l.valor_saldo ?? l.valor_total ?? 0,
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

  const createMutation = useMutation({
    mutationFn: async (data) => {
      setShowProgressoSalvamento(true);
      setProgressoSalvamento({ etapa: 'Iniciando...', current: 10, total: 100 });

      await new Promise(resolve => setTimeout(resolve, 300));
      
      const todosProdutos = await base44.entities.Produto.list();
      const produtosEmpresa = todosProdutos.filter(p => p && p.empresa_id === empresaSelecionadaId);
      const user = await base44.auth.me();

      const origem_importacao = data.origem_importacao || (data.chave_nfe ? 'XML' : 'MANUAL');
      const tipo_detalhado_base = data.tipo_documento || 'COMPRA';

      if (data.parcelas && data.parcelas.length > 0) {
        setProgressoSalvamento({ etapa: 'Criando parcelas...', current: 30, total: 100 });
        const lancamentosCriados = [];

        for (let i = 0; i < data.parcelas.length; i++) {
          const parcela = data.parcelas[i];
          const numero = await getNextNumber(empresaSelecionadaId);

          let valorOriginal;
          if (data.lancar_produtos) {
            const subtotalProdutos = data.produtos_selecionados?.reduce((sum, p) => {
              const totalItem = parseFloat(p.valor_total) || 0;
              const descontoItem = parseFloat(p.desconto_item) || 0;
              return sum + (totalItem - descontoItem);
            }, 0) || 0;
            valorOriginal = subtotalProdutos + (data.frete || 0) + (data.outras_despesas || 0);
          } else {
            valorOriginal = data.valor_original || 0;
          }

          const valorParcela = parcela.valor || 0;

          const lanc = await base44.entities.LancamentoFinanceiro.create({
            empresa_id: empresaSelecionadaId,
            numero_lancamento: String(numero),
            tipo: data.tipo,
            tipo_documento: data.tipo_documento,
            fornecedor_id: data.fornecedor_id,
            fornecedor_nome: data.fornecedor_nome,
            safra_id: data.safra_id,
            safra_nome: data.safra_nome,
            centro_custo_id: data.centro_custo_id,
            centro_custo_nome: data.centro_custo_nome,
            plano_contas_id: data.plano_contas_id,
            plano_contas_nome: data.plano_contas_nome,
            grupo_id: data.grupo_id,
            grupo_nome: data.grupo_nome,
            forma_pagamento_id: data.forma_pagamento_id,
            forma_pagamento_nome: data.forma_pagamento_nome,
            numero_documento: data.numero_documento,
            chave_nfe: data.chave_nfe,
            serie_documento: data.serie_documento,
            numero_boleto: data.numero_boleto,
            banco_boleto: data.banco_boleto,
            cfop: data.cfop,
            data_emissao: data.data_emissao,
            data_vencimento: parcela.data,
            valor_original: valorOriginal,
            valor_produtos: data.valor_produtos || 0,
            valor_frete: data.frete || 0,
            valor_seguro: data.valor_seguro || 0,
            valor_outras_despesas: data.outras_despesas || 0,
            valor_desconto_total: data.valor_desconto_total || 0,
            valor_ipi: data.valor_ipi || 0,
            valor_icms: data.valor_icms || 0,
            valor_pis: data.valor_pis || 0,
            valor_cofins: data.valor_cofins || 0,
            base_calculo_icms: data.base_calculo_icms || 0,
            valor_total: valorParcela,
            valor_saldo: valorParcela,
            valor_juros: 0,
            valor_multa: 0,
            valor_desconto: 0,
            valor_pago: 0,
            status: 'Pendente',
            observacoes: `${data.observacoes || ''} - PARCELA ${i + 1}/${data.parcelas.length}`.trim(),
            observacoes_nfe: data.observacoes_nfe,
            numero_parcela: i + 1,
            total_parcelas: data.parcelas.length,
            lancar_produtos: data.lancar_produtos,
            dar_entrada_estoque: data.dar_entrada_estoque,
            local_estoque: data.local_estoque,
            produtos_lancamento: data.produtos_selecionados,
            anexos: data.anexos,
            origem_importacao: origem_importacao,
            usuario_lancamento: user.email
          });

          if (data.dar_entrada_estoque && data.produtos_selecionados && data.produtos_selecionados.length > 0 && i === 0) {
            setProgressoSalvamento({ etapa: 'Atualizando estoque...', current: 60, total: 100 });

            for (const prodLanc of data.produtos_selecionados) {
              const produto = produtosEmpresa.find(p => p && p.id === prodLanc.produto_id);
              if (produto) {
                const novoEstoque = (produto.estoque_atual || 0) + (prodLanc.quantidade || 0);
                await base44.entities.Produto.update(produto.id, {
                  estoque_atual: novoEstoque
                });

                const allMov = await base44.entities.MovimentacaoEstoque.list();
                const maxNumMov = allMov.reduce((max, m) => Math.max(max, parseInt(m?.numero_movimentacao) || 0), 0);

                await base44.entities.MovimentacaoEstoque.create({
                  empresa_id: empresaSelecionadaId,
                  numero_movimentacao: String(maxNumMov + 1),
                  tipo_movimentacao: 'Entrada',
                  tipo_detalhado: tipo_detalhado_base,
                  tipo_documento: data.tipo_documento || 'NF-e',
                  numero_documento: data.numero_documento,
                  chave_documento: data.chave_nfe,
                  data_documento: data.data_emissao,
                  data_movimentacao: new Date().toISOString(),
                  fornecedor_id: data.fornecedor_id,
                  fornecedor_nome: data.fornecedor_nome,
                  safra_id: data.safra_id,
                  safra_nome: data.safra_nome,
                  centro_custo_id: data.centro_custo_id,
                  centro_custo_nome: data.centro_custo_nome,
                  produto_id: produto.id,
                  produto_nome: produto.nome_produto,
                  produto_categoria: produto.categoria,
                  produto_codigo: produto.codigo_interno,
                  quantidade: prodLanc.quantidade || 0,
                  unidade_medida: prodLanc.unidade,
                  valor_unitario: prodLanc.valor_unitario || 0,
                  valor_total: (prodLanc.quantidade || 0) * (prodLanc.valor_unitario || 0),
                  local_origem: data.fornecedor_nome,
                  local_estoque_origem: data.local_estoque,
                  saldo_antes: produto.estoque_atual || 0,
                  saldo_depois: novoEstoque,
                  motivo_movimentacao: `Entrada via Lançamento Financeiro - ${origem_importacao === 'XML' ? 'Importado via XML' : 'Cadastrado manualmente'}`,
                  observacoes: `ORIGEM: Lançamento Financeiro #${String(numero)} | ${data.observacoes || ''}`.trim(),
                  responsavel: user.email,
                  lancamento_origem_id: lanc.id,
                  status: 'Ativa'
                });
              }
            }
          }

          lancamentosCriados.push(lanc);
          setProgressoSalvamento({ etapa: `Parcela ${i + 1}/${data.parcelas.length}`, current: 30 + (i + 1) * (40 / data.parcelas.length), total: 100 });
        }

        setProgressoSalvamento({ etapa: 'Concluído!', current: 100, total: 100 });
        await new Promise(resolve => setTimeout(resolve, 500));
        toast.success(`${data.parcelas.length} lançamentos criados${data.dar_entrada_estoque ? ' e estoque atualizado' : ''}!`);
        return lancamentosCriados[0];
      } else {
        setProgressoSalvamento({ etapa: 'Salvando...', current: 50, total: 100 });
        const numero = await getNextNumber(empresaSelecionadaId);

        let valorTotal;
        if (data.lancar_produtos) {
          const subtotalProdutos = data.produtos_selecionados?.reduce((sum, p) => {
            const totalItem = parseFloat(p.valor_total) || 0;
            const descontoItem = parseFloat(p.desconto_item) || 0;
            return sum + (totalItem - descontoItem);
          }, 0) || 0;
          valorTotal = subtotalProdutos + (data.frete || 0) + (data.outras_despesas || 0);
        } else {
          valorTotal = (data.valor_original || 0) + (data.valor_juros || 0) + (data.valor_multa || 0) - (data.valor_desconto || 0);
        }

        const lanc = await base44.entities.LancamentoFinanceiro.create({
          ...data,
          empresa_id: empresaSelecionadaId,
          numero_lancamento: String(numero),
          valor_original: data.lancar_produtos ? valorTotal : (data.valor_original || 0),
          valor_produtos: data.valor_produtos || 0,
          valor_frete: data.frete || 0,
          valor_seguro: data.valor_seguro || 0,
          valor_outras_despesas: data.outras_despesas || 0,
          valor_desconto_total: data.valor_desconto_total || 0,
          valor_ipi: data.valor_ipi || 0,
          valor_icms: data.valor_icms || 0,
          valor_pis: data.valor_pis || 0,
          valor_cofins: data.valor_cofins || 0,
          base_calculo_icms: data.base_calculo_icms || 0,
          valor_total: valorTotal,
          valor_pago: data.conta_paga ? (data.valor_pago_total || 0) : 0,
          valor_saldo: data.conta_paga ? (valorTotal - (data.valor_pago_total || 0)) : valorTotal,
          valor_juros: data.lancar_produtos ? 0 : (data.valor_juros || 0),
          valor_multa: data.lancar_produtos ? 0 : (data.valor_multa || 0),
          valor_desconto: data.lancar_produtos ? 0 : (data.valor_desconto || 0),
          status: data.conta_paga ? 'Pago' : 'Pendente',
          observacoes_nfe: data.observacoes_nfe,
          origem_importacao: origem_importacao,
          usuario_lancamento: user.email
        });

        if (data.dar_entrada_estoque && data.produtos_selecionados && data.produtos_selecionados.length > 0) {
          setProgressoSalvamento({ etapa: 'Atualizando estoque...', current: 70, total: 100 });

          for (const prodLanc of data.produtos_selecionados) {
            const produto = produtosEmpresa.find(p => p && p.id === prodLanc.produto_id);
            if (produto) {
              const novoEstoque = (produto.estoque_atual || 0) + (prodLanc.quantidade || 0);
              await base44.entities.Produto.update(produto.id, {
                estoque_atual: novoEstoque
              });

              const allMov = await base44.entities.MovimentacaoEstoque.list();
              const maxNumMov = allMov.reduce((max, m) => Math.max(max, parseInt(m?.numero_movimentacao) || 0), 0);

              await base44.entities.MovimentacaoEstoque.create({
                empresa_id: empresaSelecionadaId,
                numero_movimentacao: String(maxNumMov + 1),
                tipo_movimentacao: 'Entrada',
                tipo_detalhado: tipo_detalhado_base,
                tipo_documento: data.tipo_documento || 'NF-e',
                numero_documento: data.numero_documento,
                chave_documento: data.chave_nfe,
                data_documento: data.data_emissao,
                data_movimentacao: new Date().toISOString(),
                fornecedor_id: data.fornecedor_id,
                fornecedor_nome: data.fornecedor_nome,
                safra_id: data.safra_id,
                safra_nome: data.safra_nome,
                centro_custo_id: data.centro_custo_id,
                centro_custo_nome: data.centro_custo_nome,
                produto_id: produto.id,
                produto_nome: produto.nome_produto,
                produto_categoria: produto.categoria,
                produto_codigo: produto.codigo_interno,
                quantidade: prodLanc.quantidade || 0,
                unidade_medida: prodLanc.unidade,
                valor_unitario: prodLanc.valor_unitario || 0,
                valor_total: (prodLanc.quantidade || 0) * (prodLanc.valor_unitario || 0),
                local_origem: data.fornecedor_nome,
                local_estoque_origem: data.local_estoque,
                saldo_antes: produto.estoque_atual || 0,
                saldo_depois: novoEstoque,
                motivo_movimentacao: `Entrada via Lançamento Financeiro - ${origem_importacao === 'XML' ? 'Importado via XML' : 'Cadastrado manualmente'}`,
                observacoes: `ORIGEM: Lançamento Financeiro #${numero} | ${data.observacoes || ''}`.trim(),
                responsavel: user.email,
                lancamento_origem_id: lanc.id,
                status: 'Ativa'
              });
            }
          }
        }

        if (data.conta_paga) {
          setProgressoSalvamento({ etapa: 'Registrando baixa...', current: 85, total: 100 });
          const allBaixas = await base44.entities.BaixaFinanceira.list();
          const maxNumBaixa = allBaixas.reduce((max, b) => Math.max(max, parseInt(b?.numero_baixa) || 0), 0);

          await base44.entities.BaixaFinanceira.create({
            empresa_id: empresaSelecionadaId,
            numero_baixa: String(maxNumBaixa + 1),
            lancamento_id: lanc.id,
            data_baixa: data.data_pagamento,
            valor_baixa: data.valor_pago_total || 0,
            valor_juros: 0,
            valor_multa: 0,
            valor_desconto: 0,
            forma_pagamento_id: data.forma_pagamento_paga_id,
            forma_pagamento_nome: data.forma_pagamento_paga_nome,
            observacoes: 'BAIXA AUTOMÁTICA NO CADASTRO',
            usuario_responsavel: user.email
          });
        }

        setProgressoSalvamento({ etapa: 'Concluído!', current: 100, total: 100 });
        await new Promise(resolve => setTimeout(resolve, 500));
        return lanc;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      queryClient.invalidateQueries({ queryKey: ['produtos_financeiro'] });
      setAbaAtiva("pesquisar");
      setEditingLancamento(null);
      setDadosXML(null);
      setShowProgressoSalvamento(false);
      toast.success('Lançamento salvo com sucesso!');
    },
    onError: (error) => {
      setShowProgressoSalvamento(false);
      toast.error('Erro ao salvar: ' + (error.message || 'Erro desconhecido'));
    }
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
      
      const lanc = await base44.entities.LancamentoFinanceiro.list();
      const lancamento = lanc.find(l => l && l.id === lancamentoId);
      
      if (lancamento) {
        await base44.entities.LancamentoFinanceiro.update(lancamentoId, {
          status: 'Pendente',
          valor_pago: 0,
          valor_saldo: lancamento.valor_total || 0
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      toast.success('Baixa cancelada!');
    },
    onError: (error) => {
      toast.error('Erro ao cancelar baixa: ' + (error.message || 'Erro desconhecido'));
    }
  });

  const handleSubmit = async (data) => {
    if (editingLancamento) {
      await base44.entities.LancamentoFinanceiro.update(editingLancamento.id, {
        ...data,
        valor_saldo: (data.valor_total || 0) - (data.valor_pago || 0)
      });
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      setEditingLancamento(null);
      setAbaAtiva("pesquisar");
      toast.success('Lançamento atualizado!');
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDelete = (id) => {
    if (window.confirm('Deseja realmente excluir este lançamento?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleBaixa = (lancamento) => {
    setBaixaLancamento(lancamento);
  };

  const handleCancelarBaixa = (lancamento) => {
    if (window.confirm('Deseja cancelar a baixa deste lançamento?')) {
      cancelarBaixaMutation.mutate(lancamento.id);
    }
  };

  const handleImportarXMLSuccess = (dadosImportados) => {
    setDadosXML(dadosImportados);
    setShowImportXML(false);
    setAbaAtiva("cadastrar");
  };

  const handleNovoCadastro = () => {
    setEditingLancamento(null);
    setDadosXML(null);
    setAbaAtiva("cadastrar");
  };

  const handleCancelarCadastro = () => {
    setEditingLancamento(null);
    setDadosXML(null);
    setAbaAtiva("pesquisar");
  };

  const lancamentosPagar = useMemo(() => lancamentos.filter(l => l && l.tipo === 'Pagar'), [lancamentos]);
  const lancamentosReceber = useMemo(() => lancamentos.filter(l => l && l.tipo === 'Receber'), [lancamentos]);

  return (
    <div className="p-4 bg-slate-50 min-h-screen">
      <div className="mb-3">
        <h1 className="text-xl font-bold text-slate-800">Lançamento Financeiro</h1>
        <p className="text-xs text-slate-600">Gestão de contas a pagar e receber</p>
      </div>

      <Card className="border border-slate-300">
        <CardContent className="p-0">
          <Tabs value={abaAtiva} onValueChange={setAbaAtiva} className="w-full">
            <TabsList className="w-full justify-start rounded-none border-b bg-slate-100 h-10">
              <TabsTrigger value="cadastrar" className="data-[state=active]:bg-white data-[state=active]:border data-[state=active]:border-b-0 rounded-t">
                Cadastrar
              </TabsTrigger>
              <TabsTrigger value="pesquisar" className="data-[state=active]:bg-white data-[state=active]:border data-[state=active]:border-b-0 rounded-t">
                Pesquisar
              </TabsTrigger>
              <TabsTrigger value="importar" className="data-[state=active]:bg-white data-[state=active]:border data-[state=active]:border-b-0 rounded-t">
                Importar de XML
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cadastrar" className="p-4 m-0">
              <FormularioCompraFinanceiro
                onSubmit={handleSubmit}
                onCancel={handleCancelarCadastro}
                initialData={editingLancamento || dadosXML}
                fornecedores={fornecedores}
                produtos={produtos}
              />
            </TabsContent>

            <TabsContent value="pesquisar" className="p-4 m-0">
              <div className="space-y-3">
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={handleNovoCadastro}>
                    Novo Lançamento
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowImportXML(true)}>
                    Importar XML
                  </Button>
                </div>

                <Tabs value={tipoAtivo} onValueChange={setTipoAtivo}>
                  <TabsList className="w-full justify-start border-b bg-slate-50 h-9 rounded-none">
                    <TabsTrigger value="pagar" className="data-[state=active]:border-b-2 data-[state=active]:border-b-slate-700 rounded-none">
                      Contas a Pagar ({lancamentosPagar.length})
                    </TabsTrigger>
                    <TabsTrigger value="receber" className="data-[state=active]:border-b-2 data-[state=active]:border-b-slate-700 rounded-none">
                      Contas a Receber ({lancamentosReceber.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="pagar" className="m-0 mt-3">
                    <TabelaFinanceiro
                      lancamentos={lancamentosPagar}
                      tipo="Pagar"
                      onEdit={(lanc) => { setEditingLancamento(lanc); setAbaAtiva("cadastrar"); }}
                      onDelete={handleDelete}
                      onBaixa={handleBaixa}
                      onCancelarBaixa={handleCancelarBaixa}
                      isLoading={loadingLancamentos}
                      fornecedores={fornecedores}
                      produtos={produtos}
                    />
                  </TabsContent>

                  <TabsContent value="receber" className="m-0 mt-3">
                    <TabelaFinanceiro
                      lancamentos={lancamentosReceber}
                      tipo="Receber"
                      onEdit={(lanc) => { setEditingLancamento(lanc); setAbaAtiva("cadastrar"); }}
                      onDelete={handleDelete}
                      onBaixa={handleBaixa}
                      onCancelarBaixa={handleCancelarBaixa}
                      isLoading={loadingLancamentos}
                      fornecedores={fornecedores}
                      produtos={produtos}
                    />
                  </TabsContent>
                </Tabs>
              </div>
            </TabsContent>

            <TabsContent value="importar" className="p-4 m-0">
              <div className="text-center py-8">
                <p className="text-sm text-slate-600 mb-4">Importar dados de XML (NF-e)</p>
                <Button onClick={() => setShowImportXML(true)}>
                  Selecionar Arquivo XML
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <BaixaFinanceira
        lancamento={baixaLancamento}
        onClose={() => setBaixaLancamento(null)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
          setBaixaLancamento(null);
        }}
      />

      <ImportarNFeFinanceiro
        open={showImportXML}
        onClose={() => setShowImportXML(false)}
        onSuccess={handleImportarXMLSuccess}
        fornecedores={fornecedores}
        produtos={produtos}
      />

      <Dialog open={showProgressoSalvamento} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Salvando Lançamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{progressoSalvamento.etapa}</p>
            <Progress value={progressoSalvamento.current} className="w-full" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}