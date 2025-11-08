
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Upload, Loader2, Save, AlertCircle, Plus, CheckCircle, RefreshCw, CheckSquare, Edit2, Search } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const formatarNumero = (num) => {
  if (!num && num !== 0) return '0,00';
  const fixed = typeof num === 'number' ? num.toFixed(2) : String(num);
  return fixed.replace('.', ',');
};

const parseNumero = (str) => {
  if (!str) return 0;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;
};

const formatarMoeda = (num) => {
  if (!num && num !== 0) return 'R$ 0,00';
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const ESTADOS_BRASIL = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const UNIDADES_MEDIDA = ['UN', 'KG', 'G', 'MG', 'L', 'ML', 'M', 'M2', 'M3', 'CM', 'MM', 'CX', 'PC', 'SC', 'FD', 'TON', 'KIT', 'JG', 'PAR', 'DZ'];

export default function ImportarNFeFinanceiro({ open, onClose, onSuccess, fornecedores, produtos }) {
  const [processando, setProcessando] = useState(false);
  const [dadosNFe, setDadosNFe] = useState(null);
  const [fornecedorSelecionado, setFornecedorSelecionado] = useState(null);
  const [itensNFe, setItensNFe] = useState([]);
  const [itensSelecionados, setItensSelecionados] = useState([]);
  const [editandoItemIndex, setEditandoItemIndex] = useState(null);
  const [gerarFinanceiro, setGerarFinanceiro] = useState(true);
  const [gerarEstoque, setGerarEstoque] = useState(true);
  const [gerarLivroFiscal, setGerarLivroFiscal] = useState(true);
  const [parcelas, setParcelas] = useState(1);
  const [etapa, setEtapa] = useState(1);
  const [showNovoProduto, setShowNovoProduto] = useState(false);
  const [showTrocarProduto, setShowTrocarProduto] = useState(false);
  const [showCadastroEmMassa, setShowCadastroEmMassa] = useState(false);
  const [itemEditando, setItemEditando] = useState(null);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [dadosComplementares, setDadosComplementares] = useState({
    local_estoque: "",
    centro_custo_id: "",
    observacoes: ""
  });
  
  const [novoFornecedor, setNovoFornecedor] = useState({
    tipo_pessoa: "Jurídica",
    nome: "",
    cnpj: "",
    cpf: "",
    inscricao_estadual: "",
    telefone: "",
    email: "",
    endereco: "",
    cidade: "",
    estado: "",
    cep: ""
  });
  
  const [novoProduto, setNovoProduto] = useState({
    nome: "",
    codigo: "",
    unidade: "UN",
    categoria: ""
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: locais = [] } = useQuery({
    queryKey: ['locais'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: [],
  });

  const { data: centros = [] } = useQuery({
    queryKey: ['centros_import', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list(),
    initialData: [],
  });

  const createFornecedorMutation = useMutation({
    mutationFn: async (data) => {
      const all = await base44.entities.Fornecedor.list();
      const maxNum = all.reduce((max, f) => Math.max(max, parseInt(f.numero_cadastro) || 0), 0);
      return base44.entities.Fornecedor.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_cadastro: String(maxNum + 1)
      });
    },
    onSuccess: (newFornecedor) => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores_financeiro'] });
      setFornecedorSelecionado(newFornecedor);
      toast.success('✅ Fornecedor cadastrado!');
      setEtapa(3);
    },
  });

  const createProdutoMutation = useMutation({
    mutationFn: async (data) => {
      const all = await base44.entities.Produto.list();
      const maxNum = all.reduce((max, p) => Math.max(max, parseInt(p.numero_produto) || 0), 0);
      return base44.entities.Produto.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_produto: String(maxNum + 1),
        estoque_atual: 0
      });
    },
    onSuccess: (newProduto) => {
      queryClient.invalidateQueries({ queryKey: ['produtos_financeiro'] });
      
      setItensNFe(prev => prev.map(item => {
        if (item.index === itemEditando?.index) {
          return { ...item, produto_id: newProduto.id, produto_nome: newProduto.nome_produto, status: 'associado' };
        }
        return item;
      }));
      
      setShowNovoProduto(false);
      setItemEditando(null);
      toast.success('✅ Produto cadastrado!');
    },
  });

  const handleUploadXML = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setProcessando(true);
    
    try {
      toast.info(`📄 Enviando arquivo: ${file.name}`);
      
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      toast.info('📥 Baixando XML...');
      const response = await fetch(file_url);
      const xmlText = await response.text();

      toast.info('🤖 Analisando nota fiscal com IA...');
      
      const resultado = await base44.integrations.Core.InvokeLLM({
        prompt: `Você é um extrator de dados de NF-e. Analise o XML abaixo e extraia TODOS os dados estruturados.

REGRAS IMPORTANTES:
1. Se não for NF-e modelo 55, retorne modelo como string vazia ""
2. Para dados não encontrados, use null
3. Números devem ser numéricos (não string)
4. CNPJ/CPF apenas números, sem formatação
5. Data no formato YYYY-MM-DD
6. Extraia TODOS os itens/produtos da nota

XML DA NF-e:
${xmlText}

Retorne o JSON estruturado conforme schema.`,
        response_json_schema: {
          type: "object",
          properties: {
            modelo: { type: "string" },
            numero: { type: "string" },
            serie: { type: "string" },
            chave: { type: "string" },
            data_emissao: { type: "string" },
            valor_total: { type: "number" },
            cnpj_emitente: { type: ["string", "null"] },
            cpf_emitente: { type: ["string", "null"] },
            razao_social_emitente: { type: "string" },
            inscricao_estadual_emitente: { type: ["string", "null"] },
            telefone_emitente: { type: ["string", "null"] },
            email_emitente: { type: ["string", "null"] },
            endereco_emitente: { type: "string" },
            bairro_emitente: { type: ["string", "null"] },
            cidade_emitente: { type: "string" },
            estado_emitente: { type: "string" },
            cep_emitente: { type: "string" },
            cfop: { type: "string" },
            natureza_operacao: { type: "string" },
            itens: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  codigo: { type: "string" },
                  descricao: { type: "string" },
                  ncm: { type: "string" },
                  cfop: { type: "string" },
                  unidade: { type: "string" },
                  quantidade: { type: "number" },
                  valor_unitario: { type: "number" },
                  valor_total: { type: "number" }
                }
              }
            }
          }
        }
      });

      console.log('✅ Resultado LLM:', resultado);

      if (!resultado || !resultado.modelo || resultado.modelo !== "55") {
        toast.error('❌ Arquivo não é uma NF-e válida (modelo 55)');
        console.error('Modelo inválido:', resultado);
        setProcessando(false);
        return;
      }

      if (!resultado.itens || resultado.itens.length === 0) {
        toast.error('❌ NF-e não possui produtos/itens');
        console.error('Sem itens:', resultado);
        setProcessando(false);
        return;
      }

      toast.success(`✅ XML processado! ${resultado.itens.length} produto(s) encontrado(s)`);
      
      setDadosNFe(resultado);
      
      const documentoEmitente = resultado.cnpj_emitente || resultado.cpf_emitente;
      
      if (!documentoEmitente) {
        toast.warning('⚠️ Documento do fornecedor não encontrado no XML');
      }
      
      const fornecedor = fornecedores.find(f => 
        f.cnpj?.replace(/\D/g, '') === documentoEmitente?.replace(/\D/g, '') ||
        f.cpf?.replace(/\D/g, '') === documentoEmitente?.replace(/\D/g, '')
      );
      
      if (fornecedor) {
        setFornecedorSelecionado(fornecedor);
        toast.success(`✅ Fornecedor encontrado: ${fornecedor.nome}`);
        setEtapa(3);
      } else {
        toast.warning('⚠️ Fornecedor não cadastrado - preencha os dados');
        
        const enderecoCompleto = resultado.bairro_emitente 
          ? `${resultado.endereco_emitente}, ${resultado.bairro_emitente}`
          : resultado.endereco_emitente;

        setNovoFornecedor({
          tipo_pessoa: resultado.cnpj_emitente ? "Jurídica" : "Física",
          nome: resultado.razao_social_emitente || "",
          cnpj: resultado.cnpj_emitente || "",
          cpf: resultado.cpf_emitente || "",
          inscricao_estadual: resultado.inscricao_estadual_emitente || "",
          telefone: resultado.telefone_emitente || "",
          email: resultado.email_emitente || "",
          endereco: enderecoCompleto || "",
          cidade: resultado.cidade_emitente || "",
          estado: resultado.estado_emitente || "",
          cep: resultado.cep_emitente || ""
        });
        setEtapa(2);
      }
      
    } catch (error) {
      console.error('❌ Erro completo:', error);
      toast.error('❌ Erro ao processar XML. Verifique o console para detalhes.');
    } finally {
      setProcessando(false);
      e.target.value = '';
    }
  };

  useEffect(() => {
    if (etapa === 3 && dadosNFe?.itens && produtos) {
      console.log('🔍 Associando produtos...', dadosNFe.itens.length, 'itens');
      
      const itensComAssociacao = dadosNFe.itens.map((item, index) => {
        const produtoEncontrado = produtos.find(p => 
          p.codigo_interno === item.codigo ||
          p.codigo_barras === item.codigo ||
          p.nome_produto?.toLowerCase().includes(item.descricao?.toLowerCase())
        );

        const itemProcessado = {
          index,
          codigo: item.codigo || '',
          descricao: item.descricao || '',
          ncm: item.ncm || '',
          cfop: item.cfop || '',
          unidade: item.unidade || 'UN',
          quantidade: item.quantidade || 0,
          valor_unitario: item.valor_unitario || 0,
          valor_total: item.valor_total || 0,
          produto_id: produtoEncontrado?.id,
          produto_nome: produtoEncontrado?.nome_produto,
          status: produtoEncontrado ? 'associado' : 'pendente',
          quantidade_ajustada: formatarNumero(item.quantidade || 0),
          valor_unitario_ajustado: formatarNumero(item.valor_unitario || 0),
          cfop_ajustado: item.cfop || '',
        };
        
        return itemProcessado;
      });
      
      console.log('✅ Itens processados:', itensComAssociacao);
      
      setItensNFe(itensComAssociacao);
      setItensSelecionados(itensComAssociacao.map(i => i.index));
    }
  }, [etapa, dadosNFe, produtos]);

  const handleCadastrarFornecedor = () => {
    if (!novoFornecedor.nome) {
      toast.error('Nome é obrigatório!');
      return;
    }

    createFornecedorMutation.mutate({
      tipo_pessoa: novoFornecedor.tipo_pessoa,
      nome: novoFornecedor.nome.toUpperCase(),
      cnpj: novoFornecedor.cnpj?.replace(/\D/g, ''),
      cpf: novoFornecedor.cpf?.replace(/\D/g, ''),
      inscricao_estadual: novoFornecedor.inscricao_estadual?.toUpperCase(),
      telefone: novoFornecedor.telefone,
      email: novoFornecedor.email?.toLowerCase(),
      endereco: novoFornecedor.endereco?.toUpperCase(),
      cidade: novoFornecedor.cidade?.toUpperCase(),
      estado: novoFornecedor.estado,
      cep: novoFornecedor.cep?.replace(/\D/g, '')
    });
  };

  const handleCadastrarProduto = () => {
    if (!novoProduto.nome || !novoProduto.unidade) {
      toast.error('Nome e unidade são obrigatórios!');
      return;
    }

    createProdutoMutation.mutate({
      nome_produto: novoProduto.nome.toUpperCase(),
      codigo_interno: novoProduto.codigo?.toUpperCase(),
      unidade_medida: novoProduto.unidade.toUpperCase(),
      categoria: novoProduto.categoria?.toUpperCase(),
      preco_custo: parseNumero(itemEditando?.valor_unitario_ajustado) || 0
    });
  };

  const handleCadastrarProdutosEmMassa = async () => {
    const itensPendentes = itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index));
    
    if (itensPendentes.length === 0) {
      toast.error('Nenhum produto pendente selecionado!');
      return;
    }

    setShowCadastroEmMassa(true);
    let cadastrados = 0;
    
    for (const item of itensPendentes) {
      try {
        const all = await base44.entities.Produto.list();
        const maxNum = all.reduce((max, p) => Math.max(max, parseInt(p.numero_produto) || 0), 0);
        
        const newProduto = await base44.entities.Produto.create({
          empresa_id: empresaSelecionadaId,
          numero_produto: String(maxNum + 1),
          nome_produto: item.descricao.toUpperCase(),
          codigo_interno: item.codigo?.toUpperCase(),
          unidade_medida: item.unidade?.toUpperCase() || 'UN',
          preco_custo: parseNumero(item.valor_unitario_ajustado),
          estoque_atual: 0
        });

        setItensNFe(prev => prev.map(i => {
          if (i.index === item.index) {
            return { ...i, produto_id: newProduto.id, produto_nome: newProduto.nome_produto, status: 'associado' };
          }
          return i;
        }));
        
        cadastrados++;
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('Erro ao cadastrar produto:', error);
        toast.error(`Erro ao cadastrar ${item.descricao}`);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['produtos_financeiro'] });
    setShowCadastroEmMassa(false);
    toast.success(`✅ ${cadastrados} produto(s) cadastrado(s)!`);
  };

  const handleAtualizarItem = (index, campo, valor) => {
    setItensNFe(prev => prev.map(item => {
      if (item.index === index) {
        return { ...item, [campo]: valor };
      }
      return item;
    }));
  };

  const handleTrocarProduto = (produto) => {
    setItensNFe(prev => prev.map(item => {
      if (item.index === itemEditando?.index) {
        return { ...item, produto_id: produto.id, produto_nome: produto.nome_produto, status: 'associado' };
      }
      return item;
    }));
    
    setShowTrocarProduto(false);
    setItemEditando(null);
    setBuscaProduto("");
    toast.success('✅ Produto associado!');
  };

  const handleToggleSelecao = (index) => {
    setItensSelecionados(prev => 
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const handleSelecionarTodos = () => {
    setItensSelecionados(itensSelecionados.length === itensNFe.length ? [] : itensNFe.map(i => i.index));
  };

  const handleConfirmar = () => {
    const itensParaImportar = itensNFe.filter(i => itensSelecionados.includes(i.index));
    const itensPendentes = itensParaImportar.filter(i => i.status === 'pendente');
    
    console.log('🔍 Confirmando importação:', {
      total: itensParaImportar.length,
      pendentes: itensPendentes.length,
      gerarEstoque,
      gerarFinanceiro,
      gerarLivroFiscal
    });
    
    if (gerarEstoque && itensPendentes.length > 0) {
      toast.error(`❌ ${itensPendentes.length} produto(s) sem associação! Cadastre ou associe todos.`);
      return;
    }
    
    if (gerarEstoque && !dadosComplementares.local_estoque) {
      toast.error('❌ Selecione o local de estoque!');
      return;
    }

    console.log('✅ Enviando dados para importação...');

    onSuccess({
      dadosNFe,
      fornecedor_id: fornecedorSelecionado.id,
      itens: itensParaImportar.map(i => ({
        produto_id: i.produto_id,
        produto_nome: i.produto_nome,
        descricao: i.descricao,
        codigo: i.codigo,
        ncm: i.ncm,
        cfop: i.cfop_ajustado,
        unidade: i.unidade,
        quantidade: parseNumero(i.quantidade_ajustada),
        valor_unitario: parseNumero(i.valor_unitario_ajustado)
      })),
      dadosComplementares,
      gerarFinanceiro,
      gerarEstoque,
      gerarLivroFiscal,
      parcelas: parseInt(parcelas)
    });
  };

  const resetar = () => {
    setEtapa(1);
    setDadosNFe(null);
    setFornecedorSelecionado(null);
    setItensNFe([]);
    setItensSelecionados([]);
    setEditandoItemIndex(null);
    setDadosComplementares({ local_estoque: "", centro_custo_id: "", observacoes: "" });
    setGerarFinanceiro(true);
    setGerarEstoque(true);
    setGerarLivroFiscal(true);
    setParcelas(1);
    setNovoFornecedor({
      tipo_pessoa: "Jurídica",
      nome: "",
      cnpj: "",
      cpf: "",
      inscricao_estadual: "",
      telefone: "",
      email: "",
      endereco: "",
      cidade: "",
      estado: "",
      cep: ""
    });
    setNovoProduto({
      nome: "",
      codigo: "",
      unidade: "UN",
      categoria: ""
    });
  };

  const produtosFiltrados = produtos.filter(p => 
    !buscaProduto || 
    p.nome_produto?.toLowerCase().includes(buscaProduto.toLowerCase()) ||
    p.codigo_interno?.toLowerCase().includes(buscaProduto.toLowerCase())
  );

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { onClose(); resetar(); } }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-green-600" />
              Importar NF-e (XML) - Etapa {etapa} de 4
            </DialogTitle>
            <DialogDescription>
              Siga as etapas para importar a nota fiscal e lançar no sistema
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* ETAPA 1: Upload XML */}
            {etapa === 1 && (
              <>
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Selecione o arquivo XML da NF-e (modelo 55). O sistema irá extrair automaticamente os dados.
                  </AlertDescription>
                </Alert>

                <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-green-400 transition-colors">
                  <Upload className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                  <p className="text-sm text-slate-600 mb-4 font-medium">Arraste o XML aqui ou clique para selecionar</p>
                  <Input
                    type="file"
                    accept=".xml"
                    onChange={handleUploadXML}
                    disabled={processando}
                    className="max-w-md mx-auto"
                  />
                  {processando && (
                    <div className="mt-6 space-y-3">
                      <div className="flex items-center justify-center gap-2 text-blue-600">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="font-medium">Processando XML...</span>
                      </div>
                      <p className="text-xs text-slate-500">Isso pode levar alguns segundos</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ETAPA 2: Cadastrar Fornecedor */}
            {etapa === 2 && dadosNFe && (
              <div className="space-y-4">
                <Card className="bg-blue-50 border-blue-200">
                  <CardHeader>
                    <CardTitle className="text-sm">📄 Dados da NF-e Extraídos</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 text-sm">
                    <div><strong>Número:</strong> {dadosNFe.numero}</div>
                    <div><strong>Série:</strong> {dadosNFe.serie}</div>
                    <div className="col-span-2"><strong>Chave:</strong> <span className="font-mono text-xs">{dadosNFe.chave}</span></div>
                    <div><strong>Data:</strong> {new Date(dadosNFe.data_emissao).toLocaleDateString('pt-BR')}</div>
                    <div><strong>Valor:</strong> <span className="text-green-700 font-bold">{formatarMoeda(dadosNFe.valor_total)}</span></div>
                    <div className="col-span-2"><strong>Produtos:</strong> {dadosNFe.itens?.length || 0} item(ns)</div>
                  </CardContent>
                </Card>

                <Alert className="bg-orange-50 border-orange-300">
                  <AlertCircle className="h-4 w-4 text-orange-600" />
                  <AlertDescription>
                    <strong>Fornecedor não cadastrado:</strong> {dadosNFe.razao_social_emitente}
                    <br />
                    <span className="text-xs">Preencha os dados abaixo para cadastrar</span>
                  </AlertDescription>
                </Alert>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Cadastrar Fornecedor</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Tipo de Pessoa *</Label>
                      <Select value={novoFornecedor.tipo_pessoa} onValueChange={(v) => setNovoFornecedor({ ...novoFornecedor, tipo_pessoa: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Jurídica">Pessoa Jurídica</SelectItem>
                          <SelectItem value="Física">Pessoa Física</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Nome/Razão Social *</Label>
                      <Input value={novoFornecedor.nome} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, nome: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {novoFornecedor.tipo_pessoa === 'Jurídica' ? (
                        <>
                          <div className="space-y-2">
                            <Label>CNPJ *</Label>
                            <Input value={novoFornecedor.cnpj} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
                          </div>
                          <div className="space-y-2">
                            <Label>Inscrição Estadual</Label>
                            <Input value={novoFornecedor.inscricao_estadual} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, inscricao_estadual: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                          </div>
                        </>
                      ) : (
                        <div className="space-y-2">
                          <Label>CPF *</Label>
                          <Input value={novoFornecedor.cpf} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cpf: e.target.value })} placeholder="000.000.000-00" />
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Telefone</Label>
                        <Input value={novoFornecedor.telefone} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, telefone: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>E-mail</Label>
                        <Input value={novoFornecedor.email} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, email: e.target.value })} />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Endereço</Label>
                      <Input value={novoFornecedor.endereco} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, endereco: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Cidade</Label>
                        <Input value={novoFornecedor.cidade} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cidade: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                      </div>
                      <div className="space-y-2">
                        <Label>Estado (UF)</Label>
                        <Select value={novoFornecedor.estado} onValueChange={(v) => setNovoFornecedor({ ...novoFornecedor, estado: v })}>
                          <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                          <SelectContent>
                            {ESTADOS_BRASIL.map(uf => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>CEP</Label>
                        <Input value={novoFornecedor.cep} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cep: e.target.value })} placeholder="00000-000" />
                      </div>
                    </div>

                    <div className="flex justify-between gap-3 pt-4 border-t">
                      <Button type="button" variant="outline" onClick={() => setEtapa(1)}>
                        ← Voltar e Trocar XML
                      </Button>
                      <Button onClick={handleCadastrarFornecedor} className="bg-green-600" disabled={createFornecedorMutation.isPending}>
                        {createFornecedorMutation.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</>
                        ) : (
                          <><Save className="w-4 h-4 mr-2" />Salvar e Continuar →</>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ETAPA 3: Produtos */}
            {etapa === 3 && itensNFe && (
              <div className="space-y-4">
                <Card className="bg-blue-50 border-blue-200">
                  <CardContent className="p-4 grid grid-cols-3 gap-3 text-sm">
                    <div><strong>Fornecedor:</strong> {fornecedorSelecionado?.nome}</div>
                    <div><strong>NF-e:</strong> {dadosNFe.numero}</div>
                    <div><strong>Valor:</strong> {formatarMoeda(dadosNFe.valor_total)}</div>
                  </CardContent>
                </Card>

                <div className="flex justify-between items-center">
                  <h3 className="font-semibold text-lg">Produtos da Nota ({itensNFe.length})</h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleSelecionarTodos}>
                      <CheckSquare className="w-3 h-3 mr-1" />
                      {itensSelecionados.length === itensNFe.length && itensNFe.length > 0 ? 'Desmarcar' : 'Selecionar'} Todos
                    </Button>
                    {itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index)).length > 0 && (
                      <Button size="sm" onClick={handleCadastrarProdutosEmMassa} className="bg-blue-600" disabled={showCadastroEmMassa}>
                        <Plus className="w-3 h-3 mr-1" />
                        Cadastrar em Massa ({itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index)).length})
                      </Button>
                    )}
                  </div>
                </div>

                <div className="overflow-auto max-h-96 border rounded-lg">
                  <Table>
                    <TableHeader className="sticky top-0 bg-white z-10">
                      <TableRow>
                        <TableHead className="w-12"><Checkbox checked={itensSelecionados.length === itensNFe.length && itensNFe.length > 0} onCheckedChange={handleSelecionarTodos} /></TableHead>
                        <TableHead className="w-12">Status</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-right">Qtd</TableHead>
                        <TableHead className="text-right">Vlr Unit.</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-center">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itensNFe.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-slate-400">
                            Nenhum produto encontrado
                          </TableCell>
                        </TableRow>
                      ) : (
                        itensNFe.map((item) => {
                          const isEditando = editandoItemIndex === item.index;
                          const valorTotal = parseNumero(item.quantidade_ajustada) * parseNumero(item.valor_unitario_ajustado);

                          return (
                            <TableRow key={item.index} className={!itensSelecionados.includes(item.index) ? 'opacity-40 bg-slate-50' : ''}>
                              <TableCell>
                                <Checkbox checked={itensSelecionados.includes(item.index)} onCheckedChange={() => handleToggleSelecao(item.index)} />
                              </TableCell>
                              <TableCell>
                                {item.status === 'associado' ? (
                                  <CheckCircle className="w-4 h-4 text-green-600" title="Produto associado" />
                                ) : (
                                  <AlertCircle className="w-4 h-4 text-orange-600" title="Produto não associado" />
                                )}
                              </TableCell>
                              <TableCell className="text-xs max-w-xs">
                                <div className="font-semibold text-slate-900">
                                  {item.produto_nome || <span className="text-orange-600">⚠️ NÃO ASSOCIADO</span>}
                                </div>
                                <div className="text-slate-500 text-xs mt-1">{item.descricao}</div>
                                <div className="text-slate-400 text-xs font-mono">Cód: {item.codigo} • NCM: {item.ncm}</div>
                              </TableCell>
                              <TableCell className="text-right">
                                {isEditando ? (
                                  <Input value={item.quantidade_ajustada} onChange={(e) => handleAtualizarItem(item.index, 'quantidade_ajustada', e.target.value)} className="w-20 text-right text-xs" />
                                ) : (
                                  <span className="font-mono text-sm">{item.quantidade_ajustada} {item.unidade}</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {isEditando ? (
                                  <Input value={item.valor_unitario_ajustado} onChange={(e) => handleAtualizarItem(item.index, 'valor_unitario_ajustado', e.target.value)} className="w-28 text-right text-xs" />
                                ) : (
                                  <span className="font-mono text-sm">R$ {item.valor_unitario_ajustado}</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <span className="font-mono font-bold text-green-700">R$ {formatarNumero(valorTotal)}</span>
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1 justify-center">
                                  {isEditando ? (
                                    <Button size="sm" variant="ghost" onClick={() => setEditandoItemIndex(null)} className="text-green-600">
                                      <CheckCircle className="w-3 h-3" />
                                    </Button>
                                  ) : (
                                    <Button size="sm" variant="ghost" onClick={() => setEditandoItemIndex(item.index)} title="Editar valores">
                                      <Edit2 className="w-3 h-3" />
                                    </Button>
                                  )}
                                  
                                  <Button size="sm" variant="outline" onClick={() => { 
                                    setItemEditando(item); 
                                    setNovoProduto({ nome: item.descricao, codigo: item.codigo, unidade: item.unidade || "UN", categoria: "" }); 
                                    setShowNovoProduto(true); 
                                  }} title="Cadastrar novo produto">
                                    <Plus className="w-3 h-3" />
                                  </Button>
                                  
                                  <Button size="sm" variant="outline" onClick={() => { setItemEditando(item); setShowTrocarProduto(true); }} title="Trocar/associar produto">
                                    <RefreshCw className="w-3 h-3" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>

                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    💡 <strong>Dica:</strong> Use <Plus className="w-3 h-3 inline" /> para cadastrar novo produto ou <RefreshCw className="w-3 h-3 inline" /> para associar a um existente
                  </AlertDescription>
                </Alert>

                <div className="flex justify-between gap-3">
                  <Button variant="outline" onClick={() => setEtapa(1)}>
                    ← Voltar e Trocar XML
                  </Button>
                  <Button onClick={() => setEtapa(4)} className="bg-green-600">
                    Avançar para Configurações → ({itensSelecionados.length} selecionados)
                  </Button>
                </div>
              </div>
            )}

            {/* ETAPA 4: Configurações Finais */}
            {etapa === 4 && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">O que deseja fazer com esta NF-e?</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-4 p-4 bg-slate-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <Checkbox checked={gerarFinanceiro} onCheckedChange={setGerarFinanceiro} id="gerar-financeiro" />
                        <label htmlFor="gerar-financeiro" className="font-semibold cursor-pointer">💰 Gerar Lançamento Financeiro (Contas a Pagar)</label>
                      </div>

                      {gerarFinanceiro && (
                        <div className="ml-8 space-y-3 p-3 bg-white rounded border">
                          <div className="space-y-2">
                            <Label>Número de Parcelas</Label>
                            <Input type="number" min="1" max="120" value={parcelas} onChange={(e) => setParcelas(e.target.value)} className="w-32" />
                            <p className="text-xs text-slate-600">Você configurará valores e datas individuais após confirmar</p>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center space-x-3">
                        <Checkbox checked={gerarEstoque} onCheckedChange={setGerarEstoque} id="gerar-estoque" />
                        <label htmlFor="gerar-estoque" className="font-semibold cursor-pointer">📦 Dar Entrada em Estoque</label>
                      </div>

                      {gerarEstoque && (
                        <div className="ml-8 space-y-3 p-3 bg-white rounded border">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>Local de Estoque *</Label>
                              <Select value={dadosComplementares.local_estoque} onValueChange={(v) => setDadosComplementares({ ...dadosComplementares, local_estoque: v })}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione onde entrará" />
                                </SelectTrigger>
                                <SelectContent>
                                  {locais.map(l => <SelectItem key={l.id} value={l.nome}>{l.nome}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-2">
                              <Label>Centro de Custo (opcional)</Label>
                              <Select value={dadosComplementares.centro_custo_id} onValueChange={(v) => setDadosComplementares({ ...dadosComplementares, centro_custo_id: v })}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                  {centros.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center space-x-3">
                        <Checkbox checked={gerarLivroFiscal} onCheckedChange={setGerarLivroFiscal} id="gerar-livro" />
                        <label htmlFor="gerar-livro" className="font-semibold cursor-pointer">📚 Registrar no Livro Fiscal</label>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Observações</Label>
                      <Textarea
                        value={dadosComplementares.observacoes}
                        onChange={(e) => setDadosComplementares({ ...dadosComplementares, observacoes: e.target.value })}
                        placeholder="Observações sobre esta importação..."
                        rows={3}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-green-50 border-green-300">
                  <CardContent className="p-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Fornecedor:</span>
                        <span className="font-semibold">{fornecedorSelecionado?.nome}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Produtos Selecionados:</span>
                        <span className="font-semibold">{itensSelecionados.length} de {itensNFe.length}</span>
                      </div>
                      <div className="border-t pt-2 flex justify-between text-lg font-bold text-green-700">
                        <span>Valor Total NF-e:</span>
                        <span>{formatarMoeda(dadosNFe.valor_total)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex justify-between gap-3">
                  <Button variant="outline" onClick={() => setEtapa(3)}>
                    ← Voltar para Produtos
                  </Button>
                  <Button onClick={handleConfirmar} className="bg-green-600 text-lg px-6 py-6" disabled={processando}>
                    <CheckCircle className="w-5 h-5 mr-2" />
                    Confirmar e Importar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Novo Produto */}
      <Dialog open={showNovoProduto} onOpenChange={setShowNovoProduto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cadastrar Novo Produto</DialogTitle>
            <DialogDescription>Dados pré-preenchidos do XML</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do Produto *</Label>
              <Input value={novoProduto.nome} onChange={(e) => setNovoProduto({ ...novoProduto, nome: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Código Interno</Label>
                <Input value={novoProduto.codigo} onChange={(e) => setNovoProduto({ ...novoProduto, codigo: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="space-y-2">
                <Label>Unidade *</Label>
                <Select value={novoProduto.unidade} onValueChange={(v) => setNovoProduto({ ...novoProduto, unidade: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIDADES_MEDIDA.map(un => <SelectItem key={un} value={un}>{un}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={novoProduto.categoria} onValueChange={(v) => setNovoProduto({ ...novoProduto, categoria: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  {categorias.map(c => <SelectItem key={c.id} value={c.nome}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowNovoProduto(false)}>Cancelar</Button>
              <Button onClick={handleCadastrarProduto} className="bg-green-600" disabled={createProdutoMutation.isPending}>
                {createProdutoMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" />Salvar e Associar</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Trocar Produto */}
      <Dialog open={showTrocarProduto} onOpenChange={setShowTrocarProduto}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Associar a Produto Existente</DialogTitle>
            <DialogDescription>Busque e selecione o produto cadastrado</DialogDescription>
          </DialogHeader>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Buscar por nome ou código..." value={buscaProduto} onChange={(e) => setBuscaProduto(e.target.value)} className="pl-10" />
          </div>
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-white">
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtosFiltrados.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-slate-400">Nenhum produto encontrado</TableCell>
                  </TableRow>
                ) : (
                  produtosFiltrados.map(p => (
                    <TableRow key={p.id} className="hover:bg-green-50">
                      <TableCell>{p.nome_produto}</TableCell>
                      <TableCell className="font-mono text-xs">{p.codigo_interno || '-'}</TableCell>
                      <TableCell>{p.unidade_medida}</TableCell>
                      <TableCell>
                        <Button size="sm" onClick={() => handleTrocarProduto(p)} className="bg-green-600">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Selecionar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Cadastro em Massa */}
      <Dialog open={showCadastroEmMassa} onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              Cadastrando Produtos em Massa
            </DialogTitle>
            <DialogDescription>
              Aguarde enquanto os produtos são cadastrados automaticamente...
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
