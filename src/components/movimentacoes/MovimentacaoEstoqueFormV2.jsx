import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import AutocompleteGenerico from "../financeiro/AutocompleteGenerico.jsx";
import { formatarMoedaInput, formatarMoeda } from "@/components/financeiro/moedaUtils";
import ProdutosMovimentacaoSection from "./ProdutosMovimentacaoSection";
import IntegrarFinanceiroDialog from "./IntegrarFinanceiroDialog";

const OPERACOES_ENTRADA = [
  { value: 'compra', label: 'Compra' },
  { value: 'devolucao_cliente', label: 'Devolução de Cliente' },
  { value: 'devolucao_fornecedor', label: 'Devolução de Fornecedor' },
  { value: 'bonificacao', label: 'Bonificação' },
  { value: 'producao_entrada', label: 'Produção Interna' },
  { value: 'ajuste_positivo', label: 'Ajuste Positivo' },
  { value: 'outros_entrada', label: 'Outros' },
];

const OPERACOES_SAIDA = [
  { value: 'venda', label: 'Venda' },
  { value: 'consumo_interno', label: 'Consumo Interno' },
  { value: 'suplementacao', label: 'Suplementação' },
  { value: 'aplicacao_area', label: 'Aplicação em Área' },
  { value: 'manutencao', label: 'Manutenção' },
  { value: 'perda_quebra', label: 'Perda/Quebra' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'ajuste_negativo', label: 'Ajuste Negativo' },
  { value: 'outros_saida', label: 'Outros' },
];

const FL = ({ label, required, error, children }) => (
  <div>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className={`rounded-md border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'} focus-within:border-emerald-500 transition-colors`}>
      {children}
    </div>
  </div>
);

const INPUT_CLS = "h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent";
const SELECT_CLS = "h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent";
const AC_INPUT_CLS = "border-0 shadow-none focus-visible:ring-0 bg-transparent h-7 text-xs";

export default function MovimentacaoEstoqueFormV2({ onSubmit, onCancel, initialData = null, produtos = [], fornecedores = [] }) {
  const empresaId = localStorage.getItem('empresa_selecionada_id');
  const isEditing = !!initialData?.id;

  // ===== Estado do cabeçalho =====
  const [tipo, setTipo] = useState(initialData?.tipo_movimentacao === 'Saída' ? 'Saída' : 'Entrada');
  const [operacao, setOperacao] = useState(initialData?.tipo_detalhado || '');
  const [dataMovimentacao, setDataMovimentacao] = useState(initialData?.data_movimentacao?.split('T')[0] || new Date().toISOString().slice(0, 10));
  const [localOrigemId, setLocalOrigemId] = useState(initialData?.local_estoque_origem || '');
  const [localDestinoId, setLocalDestinoId] = useState(initialData?.local_estoque_destino || '');
  const [observacoes, setObservacoes] = useState(initialData?.observacoes || '');
  const [invalidFields, setInvalidFields] = useState([]);

  // ===== Integração financeira =====
  const [showFinanceiro, setShowFinanceiro] = useState(false);
  const [dadosFinanceiro, setDadosFinanceiro] = useState(null);

  // ===== Itens/Produtos =====
  const [itens, setItens] = useState([]);

  // ===== Queries =====
  const { data: locais = [] } = useQuery({
    queryKey: ['locais_estoque_form'],
    queryFn: () => base44.entities.LocalEstoque.list(),
  });

  const operacoesDisponiveis = useMemo(() => {
    return tipo === 'Entrada' ? OPERACOES_ENTRADA : OPERACOES_SAIDA;
  }, [tipo]);

  const ehTransferencia = operacao === 'transferencia';

  // Dados vindos do financeiro
  const fornecedorNomeFinanceiro = dadosFinanceiro?.fornecedor_nome || '';
  const numeroDocumentoFinanceiro = dadosFinanceiro?.numero_documento || '';
  const dataEmissaoFinanceiro = dadosFinanceiro?.data_emissao || '';
  const valorTotalFinanceiro = dadosFinanceiro?.valor_total || 0;
  const valorDescontoFinanceiro = dadosFinanceiro?.valor_desconto || 0;
  const valorLiquidoFinanceiro = dadosFinanceiro ? Math.max(0, valorTotalFinanceiro - valorDescontoFinanceiro) : null;

  const handleTipoChange = (novoTipo) => {
    setTipo(novoTipo);
    setOperacao('');
    setLocalDestinoId('');
  };

  const handleChange = (field, value) => {
    setInvalidFields(prev => prev.filter(f => f !== field));
  };

  const handleFinanceiroSalvo = (data) => {
    setDadosFinanceiro(data);
    toast.success('Dados financeiros integrados!');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const missing = [];
    if (!tipo) missing.push('tipo');
    if (!operacao) missing.push('operacao');
    if (!dataMovimentacao) missing.push('data');

    // Local origem obrigatório para saída
    if (tipo === 'Saída' && !localOrigemId) missing.push('local_origem');
    // Local destino obrigatório para entrada
    if (tipo === 'Entrada' && !localDestinoId && !localOrigemId) missing.push('local_destino');
    // Transferência precisa de ambos
    if (ehTransferencia) {
      if (!localOrigemId) missing.push('local_origem');
      if (!localDestinoId) missing.push('local_destino');
    }

    if (itens.length === 0) {
      toast.error('Adicione pelo menos um produto!');
      return;
    }

    // Validar que todos os itens tem produto e quantidade
    const itensInvalidos = itens.some(it => !it.produto_id || it.quantidade <= 0);
    if (itensInvalidos) {
      toast.error('Todos os itens precisam ter produto e quantidade!');
      return;
    }

    // Se integrado com financeiro, validar que totais batem
    if (valorLiquidoFinanceiro != null) {
      const totalProdutos = itens.reduce((sum, it) => sum + (it.valor_liquido || 0), 0);
      if (Math.abs(totalProdutos - valorLiquidoFinanceiro) > 0.01) {
        toast.error(`Total líquido dos produtos (${formatarMoeda(totalProdutos)}) difere do financeiro (${formatarMoeda(valorLiquidoFinanceiro)}). Ajuste antes de salvar.`);
        return;
      }
    }

    if (missing.length > 0) {
      setInvalidFields(missing);
      toast.error('Preencha os campos obrigatórios!');
      return;
    }

    const localOrigem = locais.find(l => l.id === localOrigemId);
    const localDestino = locais.find(l => l.id === localDestinoId);

    onSubmit({
      tipo_movimentacao: tipo,
      tipo_detalhado: operacao,
      data_movimentacao: dataMovimentacao,
      local_estoque_origem: localOrigemId || undefined,
      local_origem: localOrigem?.nome || undefined,
      local_estoque_destino: localDestinoId || (tipo === 'Entrada' ? localOrigemId : undefined),
      local_destino: localDestino?.nome || (tipo === 'Entrada' ? localOrigem?.nome : undefined),
      observacoes: observacoes?.toUpperCase() || undefined,
      dados_financeiro: dadosFinanceiro || undefined,
      produtos_selecionados: itens.map(it => ({
        produto_id: it.produto_id,
        produto_nome: it.produto_nome,
        unidade: it.unidade_medida,
        quantidade: it.quantidade,
        valor_unitario: it.valor_unitario,
        valor_total: it.valor_total,
        valor_desconto: it.valor_desconto,
        valor_liquido: it.valor_liquido,
        valor_liquido_unitario: it.valor_liquido_unitario,
      })),
    });
  };

  return (
    <>
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <form onSubmit={handleSubmit} className="space-y-1">

          {/* ===== CARD CABEÇALHO ===== */}
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
              <CardTitle className="text-sm font-semibold text-slate-900">
                {isEditing ? 'Editar Movimentação' : 'Nova Movimentação de Estoque'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-1 space-y-1">

              {/* Linha 1: Tipo | Operação | Data | Local */}
              <div className="grid grid-cols-2 lg:grid-cols-12 gap-1">
                <div className="lg:col-span-2">
                  <FL label="Tipo" required error={invalidFields.includes('tipo')}>
                    <Select value={tipo} onValueChange={handleTipoChange}>
                      <SelectTrigger className={SELECT_CLS}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Entrada" className="text-xs">ENTRADA</SelectItem>
                        <SelectItem value="Saída" className="text-xs">SAÍDA</SelectItem>
                      </SelectContent>
                    </Select>
                  </FL>
                </div>
                <div className="lg:col-span-3">
                  <FL label="Operação" required error={invalidFields.includes('operacao')}>
                    <Select value={operacao} onValueChange={(v) => { setOperacao(v); handleChange('operacao', v); }}>
                      <SelectTrigger className={SELECT_CLS}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                      <SelectContent>
                        {operacoesDisponiveis.map(op => (
                          <SelectItem key={op.value} value={op.value} className="text-xs">{op.label.toUpperCase()}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FL>
                </div>
                <div className="lg:col-span-2">
                  <FL label="Data" required error={invalidFields.includes('data')}>
                    <Input type="date" value={dataMovimentacao} onChange={(e) => setDataMovimentacao(e.target.value)} className={INPUT_CLS} />
                  </FL>
                </div>
                <div className={ehTransferencia ? "lg:col-span-3" : "lg:col-span-5"}>
                  <FL label={tipo === 'Entrada' ? 'Local de Estoque (Destino)' : 'Local de Estoque (Origem)'} required error={invalidFields.includes('local_origem') || invalidFields.includes('local_destino')}>
                    <AutocompleteGenerico
                      items={locais}
                      value={tipo === 'Entrada' ? (localDestinoId || localOrigemId) : localOrigemId}
                      onChange={(v) => {
                        if (tipo === 'Entrada') { setLocalDestinoId(v); setLocalOrigemId(v); }
                        else setLocalOrigemId(v);
                        handleChange('local_origem', v);
                      }}
                      placeholder="BUSCAR LOCAL..."
                      displayField="nome"
                      searchFields={["nome"]}
                      className="w-full"
                      inputClassName={AC_INPUT_CLS}
                    />
                  </FL>
                </div>
                {ehTransferencia && (
                  <div className="lg:col-span-2">
                    <FL label="Local Estoque (Destino)" required error={invalidFields.includes('local_destino')}>
                      <AutocompleteGenerico
                        items={locais}
                        value={localDestinoId}
                        onChange={(v) => { setLocalDestinoId(v); handleChange('local_destino', v); }}
                        placeholder="BUSCAR DESTINO..."
                        displayField="nome"
                        searchFields={["nome"]}
                        className="w-full"
                        inputClassName={AC_INPUT_CLS}
                      />
                    </FL>
                  </div>
                )}
              </div>

              {/* Observações */}
              <FL label="Observações">
                <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value.toUpperCase())} placeholder="OBSERVAÇÕES..." className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent min-h-[36px]" rows={1} />
              </FL>

              {/* Botão Integrar Financeiro */}
              <div className="flex items-center gap-2 pt-1 border-t">
                <Button
                  type="button"
                  variant={dadosFinanceiro ? "default" : "outline"}
                  size="sm"
                  className={`h-7 text-xs gap-1 ${dadosFinanceiro ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
                  onClick={() => setShowFinanceiro(true)}
                >
                  <Link2 className="w-3.5 h-3.5" />
                  {dadosFinanceiro ? 'Financeiro Integrado ✓' : 'Integrar com Financeiro?'}
                </Button>
                {dadosFinanceiro && (
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-red-500" onClick={() => setDadosFinanceiro(null)}>
                    Remover integração
                  </Button>
                )}
              </div>

              {/* Resumo do financeiro integrado */}
              {dadosFinanceiro && (
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-1 bg-blue-50 border border-blue-200 rounded-lg p-1">
                  <div>
                    <span className="text-[10px] text-blue-600 block">Fornecedor</span>
                    <span className="text-xs font-semibold text-slate-900 truncate block">{fornecedorNomeFinanceiro || '-'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-blue-600 block">Nº Documento</span>
                    <span className="text-xs font-semibold text-slate-900">{numeroDocumentoFinanceiro || '-'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-blue-600 block">Data Emissão</span>
                    <span className="text-xs font-semibold text-slate-900">{dataEmissaoFinanceiro ? new Date(dataEmissaoFinanceiro + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-blue-600 block">Valor Total</span>
                    <span className="text-xs font-semibold font-mono text-slate-900">{formatarMoeda(valorTotalFinanceiro)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-blue-600 block">Desconto</span>
                    <span className="text-xs font-semibold font-mono text-red-600">{formatarMoeda(valorDescontoFinanceiro)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-blue-600 block">Valor Líquido</span>
                    <span className="text-xs font-bold font-mono text-emerald-700">{formatarMoeda(valorLiquidoFinanceiro)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ===== CARD PRODUTOS ===== */}
          <ProdutosMovimentacaoSection
            itens={itens}
            onChange={setItens}
            produtos={produtos}
            valorLiquidoFinanceiro={valorLiquidoFinanceiro}
          />

          {/* ===== BOTÕES ===== */}
          <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
            <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">
              {isEditing ? 'Atualizar' : 'Salvar Movimentação'}
            </Button>
          </div>
        </form>
      </motion.div>

      <IntegrarFinanceiroDialog
        open={showFinanceiro}
        onOpenChange={setShowFinanceiro}
        onSave={handleFinanceiroSalvo}
        fornecedores={fornecedores}
        dadosFinanceiro={dadosFinanceiro}
      />
    </>
  );
}