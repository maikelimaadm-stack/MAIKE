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
import { FileText, Upload, Loader2, Save, AlertCircle, Plus, CheckCircle, RefreshCw, Trash2, CheckSquare, Edit2, Search } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";

const formatarNumero = (num) => {
  if (!num && num !== 0) return '0,00';
  return num.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
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

export default function ImportarNFeFinanceiro({ open, onClose, onSuccess, fornecedores }) {
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
  const [showNovoFornecedor, setShowNovoFornecedor] = useState(false);
  const [showNovoProduto, setShowNovoProduto] = useState(false);
  const [showTrocarProduto, setShowTrocarProduto] = useState(false);
  const [showCadastroEmMassa, setShowCadastroEmMassa] = useState(false);
  const [itemEditando, setItemEditando] = useState(null);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [dadosComplementares, setDadosComplementares] = useState({
    local_estoque: "",
    centro_custo_id: "",
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
    codigo_barras: "",
    ncm: "",
    unidade: "UN",
    categoria: "",
    descricao: ""
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos_import_fin', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: locais = [] } = useQuery({
    queryKey: ['locais'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: [],
  });

  const { data: centros = [] } = useQuery({
    queryKey: ['centros_import_fin', empresaSelecionadaId],
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
      setFornecedorSelecionado(newFornecedor);
      setShowNovoFornecedor(false);
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
      queryClient.invalidateQueries({ queryKey: ['produtos_import_fin'] });
      
      setItensNFe(prev => prev.map(item => {
        if (item.index === itemEditando?.index) {
          return { ...item, produto_id: newProduto.id, produto_nome: newProduto.nome_produto, status: 'associado' };
        }
        return item;
      }));
      
      setShowNovoProduto(false);
      setItemEditando(null);
      toast.success('✅ Produto cadastrado e associado!');
    },
  });

  const handleUploadXML = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setProcessando(true);
    
    try {
      toast.info(`📄 Processando: ${file.name}`);
      
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const response = await fetch(file_url);
      const xmlText = await response.text();

      toast.info('🤖 Analisando nota fiscal...');
      
      const resultado = await base44.integrations.Core.InvokeLLM({
        prompt: `Extraia TODOS os dados desta NF-e (XML) incluindo itens/produtos:

${xmlText}`,
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

      if (!resultado || resultado.modelo !== "55") {
        toast.error('❌ Arquivo não é uma NF-e válida (modelo 55)');
        setProcessando(false);
        return;
      }

      if (!resultado.itens || resultado.itens.length === 0) {
        toast.error('❌ NF-e não possui itens');
        setProcessando(false);
        return;
      }

      setDadosNFe(resultado);
      
      const documentoEmitente = resultado.cnpj_emitente || resultado.cpf_emitente;
      const fornecedor = fornecedores.find(f => 
        f.cnpj?.replace(/\D/g, '') === documentoEmitente?.replace(/\D/g, '') ||
        f.cpf?.replace(/\D/g, '') === documentoEmitente?.replace(/\D/g, '')
      );
      
      if (fornecedor) {
        setFornecedorSelecionado(fornecedor);
        toast.success('✅ XML processado! Fornecedor identificado.');
        setTimeout(() => setEtapa(3), 500);
      } else {
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
      toast.error('❌ Erro ao processar XML');
      console.error(error);
    } finally {
      setProcessando(false);
      e.target.value = '';
    }
  };

  useEffect(() => {
    if (etapa === 3 && dadosNFe?.itens) {
      const itensComAssociacao = dadosNFe.itens.map((item, index) => {
        const produtoEncontrado = produtos.find(p => 
          p.codigo_interno === item.codigo ||
          p.codigo_barras === item.codigo ||
          p.nome_produto?.toLowerCase().includes(item.descricao?.toLowerCase())
        );

        return {
          index,
          ...item,
          produto_id: produtoEncontrado?.id,
          produto_nome: produtoEncontrado?.nome_produto,
          status: produtoEncontrado ? 'associado' : 'pendente',
          quantidade_ajustada: formatarNumero(item.quantidade),
          valor_unitario_ajustado: formatarNumero(item.valor_unitario),
          cfop_ajustado: item.cfop,
        };
      });
      
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
      codigo_barras: novoProduto.codigo_barras,
      unidade_medida: novoProduto.unidade.toUpperCase(),
      categoria: novoProduto.categoria?.toUpperCase(),
      descricao: novoProduto.descricao?.toUpperCase(),
      preco_custo: parseNumero(itemEditando?.valor_unitario_ajustado) || 0
    });
  };

  const handleCadastrarProdutosEmMassa = async () => {
    const itensPendentes = itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index));
    
    if (itensPendentes.length === 0) {
      toast.error('Nenhum produto pendente!');
      return;
    }

    setShowCadastroEmMassa(true);
    
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
        
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('Erro:', error);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['produtos_import_fin'] });
    setShowCadastroEmMassa(false);
    toast.success('✅ Produtos cadastrados!');
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
    toast.success('Produto associado!');
  };

  const handleToggleSelecao = (index) => {
    setItensSelecionados(prev => 
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const handleSelecionarTodos = () => {
    if (itensSelecionados.length === itensNFe.length) {
      setItensSelecionados([]);
    } else {
      setItensSelecionados(itensNFe.map(i => i.index));
    }
  };

  const handleConfirmar = () => {
    const itensParaImportar = itensNFe.filter(i => itensSelecionados.includes(i.index));
    const itensPendentes = itensParaImportar.filter(i => i.status === 'pendente');
    
    if (gerarEstoque) {
      if (itensPendentes.length > 0) {
        toast.error(`❌ ${itensPendentes.length} produto(s) sem associação!`);
        return;
      }
      if (!dadosComplementares.local_estoque) {
        toast.error('Selecione o local de estoque!');
        return;
      }
    }

    onSuccess({
      dadosNFe,
      fornecedor_id: fornecedorSelecionado.id,
      itens: itensParaImportar,
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
    setDadosComplementares({ local_estoque: "", centro_custo_id: "" });
    setGerarFinanceiro(true);
    setGerarEstoque(true);
    setGerarLivroFiscal(true);
    setParcelas(1);
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
          </DialogHeader>

          <div className="space-y-4">
            {/* ETAPA 1: Upload XML */}
            {etapa === 1 && (
              <>
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Selecione o arquivo XML da NF-e modelo 55
                  </AlertDescription>
                </Alert>

                <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
                  <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <Input
                    type="file"
                    accept=".xml"
                    onChange={handleUploadXML}
                    disabled={processando}
                    className="max-w-md mx-auto"
                  />
                  {processando && (
                    <div className="mt-4 flex items-center justify-center gap-2 text-blue-600">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processando...
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
                    <CardTitle className="text-sm">Dados da NF-e</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 text-sm">
                    <div><strong>Número:</strong> {dadosNFe.numero}</div>
                    <div><strong>Série:</strong> {dadosNFe.serie}</div>
                    <div className="col-span-2"><strong>Chave:</strong> {dadosNFe.chave}</div>
                    <div><strong>Data:</strong> {new Date(dadosNFe.data_emissao).toLocaleDateString('pt-BR')}</div>
                    <div><strong>Valor:</strong> {formatarMoeda(dadosNFe.valor_total)}</div>
                  </CardContent>
                </Card>

                <Alert className="bg-orange-50 border-orange-300">
                  <AlertCircle className="h-4 w-4 text-orange-600" />
                  <AlertDescription>
                    Fornecedor não encontrado: <strong>{dadosNFe.razao_social_emitente}</strong>
                  </AlertDescription>
                </Alert>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Cadastrar Fornecedor</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Tipo *</Label>
                      <Select value={novoFornecedor.tipo_pessoa} onValueChange={(v) => setNovoFornecedor({ ...novoFornecedor, tipo_pessoa: v })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Jurídica">Pessoa Jurídica</SelectItem>
                          <SelectItem value="Física">Pessoa Física</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Nome *</Label>
                      <Input value={novoFornecedor.nome} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, nome: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {novoFornecedor.tipo_pessoa === 'Jurídica' ? (
                        <>
                          <div className="space-y-2">
                            <Label>CNPJ *</Label>
                            <Input value={novoFornecedor.cnpj} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cnpj: e.target.value })} />
                          </div>
                          <div className="space-y-2">
                            <Label>Insc. Estadual</Label>
                            <Input value={novoFornecedor.inscricao_estadual} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, inscricao_estadual: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                          </div>
                        </>
                      ) : (
                        <div className="space-y-2">
                          <Label>CPF *</Label>
                          <Input value={novoFornecedor.cpf} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cpf: e.target.value })} />
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Cidade</Label>
                        <Input value={novoFornecedor.cidade} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cidade: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                      </div>
                      <div className="space-y-2">
                        <Label>UF</Label>
                        <Select value={novoFornecedor.estado} onValueChange={(v) => setNovoFornecedor({ ...novoFornecedor, estado: v })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ESTADOS_BRASIL.map(uf => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>CEP</Label>
                        <Input value={novoFornecedor.cep} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cep: e.target.value })} />
                      </div>
                    </div>

                    <div className="flex justify-end gap-3">
                      <Button variant="outline" onClick={() => setEtapa(1)}>Voltar</Button>
                      <Button onClick={handleCadastrarFornecedor} className="bg-green-600">
                        <Save className="w-4 h-4 mr-2" />
                        Salvar e Continuar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ETAPA 3: Produtos */}
            {etapa === 3 && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold">Produtos ({itensNFe.length})</h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleSelecionarTodos}>
                      <CheckSquare className="w-3 h-3 mr-1" />
                      {itensSelecionados.length === itensNFe.length ? 'Desmarcar' : 'Selecionar'} Todos
                    </Button>
                    {itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index)).length > 0 && (
                      <Button size="sm" onClick={handleCadastrarProdutosEmMassa} className="bg-blue-600">
                        <Plus className="w-3 h-3 mr-1" />
                        Cadastrar ({itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index)).length})
                      </Button>
                    )}
                  </div>
                </div>
                
                <div className="overflow-auto max-h-96 border rounded">
                  <Table>
                    <TableHeader className="sticky top-0 bg-white">
                      <TableRow>
                        <TableHead className="w-12"><Checkbox checked={itensSelecionados.length === itensNFe.length} onCheckedChange={handleSelecionarTodos} /></TableHead>
                        <TableHead className="w-12">Status</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-right">Qtd</TableHead>
                        <TableHead className="text-right">Vlr Unit.</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itensNFe.map((item) => {
                        const isEditando = editandoItemIndex === item.index;
                        const valorTotal = parseNumero(item.quantidade_ajustada) * parseNumero(item.valor_unitario_ajustado);
                        
                        return (
                          <TableRow key={item.index} className={!itensSelecionados.includes(item.index) ? 'opacity-50' : ''}>
                            <TableCell><Checkbox checked={itensSelecionados.includes(item.index)} onCheckedChange={() => handleToggleSelecao(item.index)} /></TableCell>
                            <TableCell>
                              {item.status === 'associado' ? <CheckCircle className="w-4 h-4 text-green-600" /> : <AlertCircle className="w-4 h-4 text-orange-600" />}
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="font-semibold">{item.produto_nome || <span className="text-orange-600">Não associado</span>}</div>
                              <div className="text-slate-500 text-xs">{item.descricao}</div>
                            </TableCell>
                            <TableCell className="text-right">
                              {isEditando ? (
                                <Input value={item.quantidade_ajustada} onChange={(e) => handleAtualizarItem(item.index, 'quantidade_ajustada', e.target.value)} className="w-24" />
                              ) : (
                                <span className="font-mono">{item.quantidade_ajustada}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {isEditando ? (
                                <Input value={item.valor_unitario_ajustado} onChange={(e) => handleAtualizarItem(item.index, 'valor_unitario_ajustado', e.target.value)} className="w-28" />
                              ) : (
                                <span className="font-mono">R$ {item.valor_unitario_ajustado}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono font-bold text-green-700">R$ {formatarNumero(valorTotal)}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {isEditando ? (
                                  <Button size="sm" variant="ghost" onClick={() => setEditandoItemIndex(null)}><CheckCircle className="w-3 h-3" /></Button>
                                ) : (
                                  <Button size="sm" variant="ghost" onClick={() => setEditandoItemIndex(item.index)}><Edit2 className="w-3 h-3" /></Button>
                                )}
                                {item.status === 'pendente' && (
                                  <>
                                    <Button size="sm" variant="outline" onClick={() => { setItemEditando(item); setNovoProduto({ nome: item.descricao, codigo: item.codigo, unidade: item.unidade || "UN" }); setShowNovoProduto(true); }}>
                                      <Plus className="w-3 h-3" />
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => { setItemEditando(item); setShowTrocarProduto(true); }}>
                                      <RefreshCw className="w-3 h-3" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => setEtapa(1)}>Voltar</Button>
                  <Button onClick={() => setEtapa(4)} className="bg-green-600">
                    Avançar ({itensSelecionados.length} itens)
                  </Button>
                </div>
              </div>
            )}

            {/* ETAPA 4: Configurações Finais */}
            {etapa === 4 && (
              <div className="space-y-4">
                <div className="space-y-4 p-4 bg-slate-50 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Checkbox checked={gerarFinanceiro} onCheckedChange={setGerarFinanceiro} />
                    <label className="font-semibold">Gerar Lançamento Financeiro</label>
                  </div>

                  {gerarFinanceiro && (
                    <div className="ml-6 space-y-2">
                      <Label>Número de Parcelas</Label>
                      <Input type="number" min="1" max="120" value={parcelas} onChange={(e) => setParcelas(e.target.value)} />
                      <p className="text-xs text-slate-600">* Configure valores e datas na próxima tela</p>
                    </div>
                  )}

                  <div className="flex items-center space-x-2">
                    <Checkbox checked={gerarEstoque} onCheckedChange={setGerarEstoque} />
                    <label className="font-semibold">Dar Entrada em Estoque</label>
                  </div>

                  {gerarEstoque && (
                    <div className="ml-6 grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Local de Estoque *</Label>
                        <Select value={dadosComplementares.local_estoque} onValueChange={(v) => setDadosComplementares({ ...dadosComplementares, local_estoque: v })}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            {locais.map(l => <SelectItem key={l.id} value={l.nome}>{l.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Centro de Custo</Label>
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
                  )}

                  <div className="flex items-center space-x-2">
                    <Checkbox checked={gerarLivroFiscal} onCheckedChange={setGerarLivroFiscal} />
                    <label className="font-semibold">Registrar no Livro Fiscal</label>
                  </div>
                </div>

                <Card className="bg-blue-50 border-blue-300">
                  <CardContent className="p-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Itens Selecionados:</span>
                        <span className="font-semibold">{itensSelecionados.length}</span>
                      </div>
                      <div className="flex justify-between text-lg font-bold text-blue-700">
                        <span>Valor Total NF-e:</span>
                        <span>{formatarMoeda(dadosNFe.valor_total)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex justify-between gap-3">
                  <Button variant="outline" onClick={() => setEtapa(3)}>Voltar</Button>
                  <Button onClick={handleConfirmar} className="bg-green-600">
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Confirmar Importação
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNovoProduto} onOpenChange={setShowNovoProduto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar Produto</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={novoProduto.nome} onChange={(e) => setNovoProduto({ ...novoProduto, nome: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Código</Label>
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
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowNovoProduto(false)}>Cancelar</Button>
              <Button onClick={handleCadastrarProduto} className="bg-green-600">
                <Save className="w-4 h-4 mr-2" />
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showTrocarProduto} onOpenChange={setShowTrocarProduto}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Trocar Produto</DialogTitle>
          </DialogHeader>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Buscar..." value={buscaProduto} onChange={(e) => setBuscaProduto(e.target.value)} className="pl-10" />
          </div>
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtosFiltrados.map(p => (
                  <TableRow key={p.id}>
                    <TableCell>{p.nome_produto}</TableCell>
                    <TableCell className="font-mono text-xs">{p.codigo_interno || '-'}</TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => handleTrocarProduto(p)} className="bg-green-600">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Selecionar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCadastroEmMassa} onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              Cadastrando Produtos...
            </DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}