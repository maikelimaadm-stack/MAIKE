import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link2 } from "lucide-react";
import {
  OPERACOES_COM_CLIENTE,
  OPERACOES_COM_DOCUMENTO,
  OPERACOES_COM_FINANCEIRO,
  OPERACOES_COM_FORNECEDOR,
  OPERACOES_COM_MOTIVO,
} from "./movimentacaoOperacaoRules";
import { motion } from "framer-motion";
import { toast } from "sonner";

import AutocompleteGenerico from "../financeiro/AutocompleteGenerico.jsx";
import { formatarMoedaInput, formatarMoeda } from "@/components/financeiro/moedaUtils";
import ProdutosMovimentacaoSection from "./ProdutosMovimentacaoSection";
import IntegrarFinanceiroDialog from "./IntegrarFinanceiroDialog";
import { formatDatePtBr } from "./utils/movimentacaoDisplayUtils";

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
  const getTodayDateString = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  };

  const [dataMovimentacao, setDataMovimentacao] = useState(initialData?.data_movimentacao?.split('T')[0] || getTodayDateString());
  const [localOrigemId, setLocalOrigemId] = useState(initialData?.local_estoque_origem || '');
  const [localDestinoId, setLocalDestinoId] = useState(initialData?.local_estoque_destino || '');
  const [observacoes, setObservacoes] = useState(initialData?.observacoes || '');
  const [fornecedorId, setFornecedorId] = useState(initialData?.fornecedor_id || '');
  const [clienteNome, setClienteNome] = useState(initialData?.cliente_nome || '');
  const [numeroDocumento, setNumeroDocumento] = useState(initialData?.numero_documento || '');
  const [dataDocumento, setDataDocumento] = useState(initialData?.data_documento || '');
  const [tipoDocumentoId, setTipoDocumentoId] = useState(initialData?.tipo_documento_id || '');
  const [motivoMovimentacao, setMotivoMovimentacao] = useState(initialData?.motivo_movimentacao || '');
  const [invalidFields, setInvalidFields] = useState([]);

  // ===== Integração financeira =====
  const [showFinanceiro, setShowFinanceiro] = useState(false);
  const [dadosFinanceiro, setDadosFinanceiro] = useState(initialData?.dados_financeiro_integrado || null);

  // ===== Itens/Produtos =====
  const [itens, setItens] = useState(() => {
    if (initialData?.produtos_para_editar) {
      return initialData.produtos_para_editar.map(p => ({
        produto_id: p.produto_id || '',
        produto_nome: p.produto_nome || '',
        unidade_medida: p.unidade_medida || '',
        quantidade: p.quantidade || 0,
        valor_unitario: p.valor_unitario || 0,
        valor_total: (p.quantidade || 0) * (p.valor_unitario || 0),
        valor_desconto: p.valor_desconto || 0,
        valor_liquido: p.valor_liquido || p.valor_total || 0,
        valor_liquido_unitario: p.valor_liquido_unitario || p.valor_unitario || 0,
        _lotes_consumidos: p.lotes_consumidos || null,
      }));
    }
    return [];
  });

  // ===== Queries =====
  const { data: locais = [] } = useQuery({
    queryKey: ['locais_estoque_form'],
    queryFn: () => base44.entities.LocalEstoque.list(),
  });

  const { data: tiposDocumento = [] } = useQuery({
    queryKey: ['tipos_documento_movimentacao_form', empresaId],
    queryFn: async () => {
      const all = await base44.entities.TipoDocumento.list();
      return all.filter(t => t.empresa_id === empresaId && t.ativo !== false);
    },
    enabled: !!empresaId,
  });

  const operacoesDisponiveis = useMemo(() => {
    return tipo === 'Entrada' ? OPERACOES_ENTRADA : OPERACOES_SAIDA;
  }, [tipo]);

  const ehTransferencia = operacao === 'transferencia';
  const podeIntegrarFinanceiro = OPERACOES_COM_FINANCEIRO.includes(operacao);
  const exibeCamposDocumento = OPERACOES_COM_DOCUMENTO.includes(operacao) && !dadosFinanceiro;
  const exibeFornecedor = OPERACOES_COM_FORNECEDOR.includes(operacao) && !dadosFinanceiro;
  const exibeCliente = OPERACOES_COM_CLIENTE.includes(operacao) && !dadosFinanceiro;
  const exibeMotivoMovimentacao = OPERACOES_COM_MOTIVO.includes(operacao);

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

  const handleFinanceiroSalvo = async (data) => {
    setDadosFinanceiro(data);
    toast.success('Dados financeiros vinculados à movimentação!');
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

    if (exibeFornecedor && !fornecedorId) missing.push('fornecedor_id');
    if (exibeCliente && !clienteNome) missing.push('cliente_nome');
    if (exibeCamposDocumento) {
      if (!tipoDocumentoId) missing.push('tipo_documento_id');
      if (!numeroDocumento) missing.push('numero_documento');
      if (!dataDocumento) missing.push('data_documento');
    }
    if (exibeMotivoMovimentacao && !motivoMovimentacao) missing.push('motivo_movimentacao');

    // Validar que todos os itens tem produto e quantidade
    const itensInvalidos = itens.some(it => !it.produto_id || it.quantidade <= 0);
    if (itensInvalidos) {
      toast.error('Todos os itens precisam ter produto e quantidade!');
      return;
    }

    if (tipo === 'Saída') {
      const itemComSaldoInsuficiente = itens.find(it => it.produto_id && it.quantidade > 0 && (it._saldo_insuficiente || (it._saldo_disponivel != null && it.quantidade > it._saldo_disponivel)));
      if (itemComSaldoInsuficiente) {
        toast.error(`O produto ${itemComSaldoInsuficiente.produto_nome || 'selecionado'} está com saldo insuficiente.`);
        return;
      }
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

    const fornecedorSelecionado = fornecedores.find(f => f.id === fornecedorId);
    const tipoDocumentoSelecionado = tiposDocumento.find(t => t.id === tipoDocumentoId);

    onSubmit({
      tipo_movimentacao: tipo,
      tipo_detalhado: operacao,
      data_movimentacao: dataMovimentacao ? `${dataMovimentacao}T12:00:00.000Z` : undefined,
      local_estoque_origem: localOrigemId || undefined,
      local_origem: localOrigem?.nome || undefined,
      local_estoque_destino: localDestinoId || (tipo === 'Entrada' ? localOrigemId : undefined),
      local_destino: localDestino?.nome || (tipo === 'Entrada' ? localOrigem?.nome : undefined),
      fornecedor_id: dadosFinanceiro?.fornecedor_id || fornecedorId || undefined,
      fornecedor_nome: dadosFinanceiro?.fornecedor_nome || fornecedorSelecionado?.nome || undefined,
      cliente_nome: dadosFinanceiro?.cliente_nome || clienteNome?.toUpperCase() || undefined,
      tipo_documento_id: dadosFinanceiro?.tipo_documento_id || tipoDocumentoId || undefined,
      tipo_documento: dadosFinanceiro?.tipo_documento_nome || tipoDocumentoSelecionado?.nome || undefined,
      numero_documento: dadosFinanceiro?.numero_documento || numeroDocumento?.toUpperCase() || undefined,
      data_documento: dadosFinanceiro?.data_emissao || dataDocumento || undefined,
      motivo_movimentacao: motivoMovimentacao?.toUpperCase() || undefined,
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
        lotes_consumidos: it._lotes_consumidos || null,
        modo_saida_fifo: it._lotes_consumidos ? 'por_nota' : 'automatico',
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
              <CardTitle className="text-sm font-semibold text-slate-900 uppercase">
                {isEditing ? 'EDITAR MOVIMENTAÇÃO' : 'NOVA MOVIMENTAÇÃO DE ESTOQUE'}
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

              {(exibeFornecedor || exibeCliente || exibeCamposDocumento) && (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-1">
                  {exibeFornecedor && (
                    <FL label="Fornecedor" required error={invalidFields.includes('fornecedor_id')}>
                      <AutocompleteGenerico
                        items={fornecedores}
                        value={fornecedorId}
                        onChange={(v) => { setFornecedorId(v); handleChange('fornecedor_id', v); }}
                        placeholder="BUSCAR FORNECEDOR..."
                        displayField="nome"
                        searchFields={["nome", "cnpj", "cpf"]}
                        className="w-full"
                        inputClassName={AC_INPUT_CLS}
                      />
                    </FL>
                  )}

                  {exibeCliente && (
                    <FL label="Cliente" required error={invalidFields.includes('cliente_nome')}>
                      <AutocompleteGenerico
                        items={fornecedores}
                        value={clienteNome}
                        onChange={(v) => {
                          const clienteSelecionado = fornecedores.find(f => f.id === v);
                          setClienteNome(clienteSelecionado?.nome || '');
                          handleChange('cliente_nome', v);
                        }}
                        placeholder="BUSCAR CLIENTE..."
                        displayField="nome"
                        searchFields={["nome", "cnpj", "cpf"]}
                        className="w-full"
                        inputClassName={AC_INPUT_CLS}
                      />
                    </FL>
                  )}

                  {exibeCamposDocumento && (
                    <>
                      <FL label="Tipo Documento" required error={invalidFields.includes('tipo_documento_id')}>
                        <AutocompleteGenerico
                          items={tiposDocumento}
                          value={tipoDocumentoId}
                          onChange={(v) => { setTipoDocumentoId(v); handleChange('tipo_documento_id', v); }}
                          placeholder="BUSCAR..."
                          displayField="nome"
                          searchFields={["nome", "sigla"]}
                          className="w-full"
                          inputClassName={AC_INPUT_CLS}
                        />
                      </FL>
                      <FL label="Nº Documento" required error={invalidFields.includes('numero_documento')}>
                        <Input value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value.toUpperCase())} placeholder="000000" className={`${INPUT_CLS} uppercase`} />
                      </FL>
                      <FL label="Data Documento" required error={invalidFields.includes('data_documento')}>
                        <Input type="date" value={dataDocumento} onChange={(e) => setDataDocumento(e.target.value)} className={INPUT_CLS} />
                      </FL>
                    </>
                  )}
                </div>
              )}

              {exibeMotivoMovimentacao && (
                <FL label="Motivo da Movimentação" required error={invalidFields.includes('motivo_movimentacao')}>
                  <Input value={motivoMovimentacao} onChange={(e) => setMotivoMovimentacao(e.target.value.toUpperCase())} placeholder="INFORME O MOTIVO" className={`${INPUT_CLS} uppercase`} />
                </FL>
              )}

              {/* Observações */}
              <FL label="Observações">
                <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value.toUpperCase())} placeholder="OBSERVAÇÕES..." className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent min-h-[36px]" rows={1} />
              </FL>

              {/* Botão Integrar Financeiro */}
              {podeIntegrarFinanceiro && (
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
              )}

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
                    <span className="text-xs font-semibold text-slate-900">{dataEmissaoFinanceiro ? formatDatePtBr(dataEmissaoFinanceiro) : '-'}</span>
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
            tipoMovimentacao={tipo}
            localEstoqueOrigemId={localOrigemId}
          />

          {/* ===== BOTÕES ===== */}
          <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
            <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">
              {isEditing ? 'Atualizar' : 'Salvar'}            </Button>
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