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
import { FileText, Upload, Loader2, Save, AlertCircle, Plus, CheckCircle, RefreshCw, CheckSquare, Edit2, Search, Trash2 } from "lucide-react";
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

const formatarDataParaBR = (dataString) => {
  if (!dataString) return '-';
  try {
    const data = new Date(dataString + 'T00:00:00');
    if (isNaN(data.getTime())) return '-';
    return data.toLocaleDateString('pt-BR');
  } catch {
    return '-';
  }
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
  const [parcelar, setParcelar] = useState(false);
  const [parcelas, setParcelas] = useState([]);
  const [dataVencimento, setDataVencimento] = useState("");
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
      toast.success('✅ Produto cadastrado e associado!');
    },
  });

  const calcularDataProximaMes = (dataBase) => {
    if (!dataBase) return new Date().toISOString().split('T')[0];
    try {
      const data = new Date(dataBase + "T00:00:00");
      if (isNaN(data.getTime())) return new Date().toISOString().split('T')[0];
      data.setMonth(data.getMonth() + 1);
      return data.toISOString().split('T')[0];
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  };

  const adicionarParcela = () => {
    const ultimaParcela = parcelas[parcelas.length - 1];
    const proximaData = ultimaParcela ? calcularDataProximaMes(ultimaParcela.data) : dataVencimento;
    const valorTotal = dadosNFe.valor_total;
    const newNumberOfParcelas = parcelas.length + 1;
    const equalParcelValue = valorTotal / newNumberOfParcelas;

    const updatedParcelas = Array.from({ length: newNumberOfParcelas }, (_, i) => {
        const currentParcel = parcelas[i];
        let date = currentParcel?.data || (i === 0 ? dataVencimento : calcularDataProximaMes(parcelas[i-1]?.data || dataVencimento));
        if (i === newNumberOfParcelas -1 && !ultimaParcela) {
          date = dataVencimento;
        } else if (i === newNumberOfParcelas -1 && ultimaParcela) {
          date = calcularDataProximaMes(parcelas[i-1]?.data || dataVencimento);
        } else {
          date = currentParcel?.data || (i === 0 ? dataVencimento : calcularDataProximaMes(parcelas[i-1]?.data || dataVencimento));
        }

        return {
            data: date,
            valor: formatarNumero(equalParcelValue)
        };
    });
    
    setParcelas(updatedParcelas);
  };

  const removerParcela = (index) => {
    if (parcelas.length <= 1) {
      toast.error('Mínimo de 1 parcela!');
      return;
    }
    const newParcelas = parcelas.filter((_, i) => i !== index);
    const valorTotal = dadosNFe.valor_total;
    const newNumberOfParcelas = newParcelas.length;
    const equalParcelValue = valorTotal / newNumberOfParcelas;

    const updatedParcelas = newParcelas.map(p => ({
        ...p,
        valor: formatarNumero(equalParcelValue)
    }));
    
    setParcelas(updatedParcelas);
  };

  const atualizarParcela = (index, campo, valor) => {
    setParcelas(prev => prev.map((p, i) => i === index ? { ...p, [campo]: valor } : p));
  };

  useEffect(() => {
    if (parcelar && parcelas.length === 0 && dataVencimento && dadosNFe?.valor_total) {
      const valorTotal = dadosNFe.valor_total || 0;
      const valorParcela = valorTotal / 2;
      
      setParcelas([
        { data: dataVencimento, valor: formatarNumero(valorParcela) },
        { data: calcularDataProximaMes(dataVencimento), valor: formatarNumero(valorParcela) }
      ]);
    } else if (!parcelar) {
      setParcelas([]);
    }
  }, [parcelar, dataVencimento, dadosNFe?.valor_total]);

  const handleUploadXML = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setProcessando(true);
    
    try {
      toast.info(`📄 Enviando: ${file.name}`);
      
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      const response = await fetch(file_url);
      const xmlText = await response.text();

      toast.info('🤖 Extraindo dados com IA...');
      
      const resultado = await base44.integrations.Core.InvokeLLM({
        prompt: `Extraia TODOS os dados desta NF-e incluindo produtos. Retorne JSON conforme schema:

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
            cidade_emitente: { type: "string", default: "CIDADE_NAO_INFORMADA" },
            estado_emitente: { type: "string", default: "UF" },
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
          },
          required: ["modelo", "numero", "serie", "data_emissao", "valor_total", "razao_social_emitente", "endereco_emitente", "cidade_emitente", "estado_emitente", "cep_emitente", "itens"]
        }
      });

      if (!resultado || resultado.modelo !== "55") {
        toast.error('❌ Não é NF-e modelo 55');
        setProcessando(false);
        return;
      }

      if (!resultado.itens || resultado.itens.length === 0) {
        toast.error('❌ NF-e sem produtos');
        setProcessando(false);
        return;
      }

      toast.success(`✅ ${resultado.itens.length} produto(s) encontrado(s)`);
      
      setDadosNFe(resultado);
      setDataVencimento(resultado.data_emissao || new Date().toISOString().split('T')[0]);
      
      const doc = resultado.cnpj_emitente || resultado.cpf_emitente;
      const forn = fornecedores.find(f => 
        f.cnpj?.replace(/\D/g, '') === doc?.replace(/\D/g, '') ||
        f.cpf?.replace(/\D/g, '') === doc?.replace(/\D/g, '')
      );
      
      if (forn) {
        setFornecedorSelecionado(forn);
        toast.success(`✅ Fornecedor: ${forn.nome}`);
        setEtapa(3);
      } else {
        setNovoFornecedor({
          tipo_pessoa: resultado.cnpj_emitente ? "Jurídica" : "Física",
          nome: resultado.razao_social_emitente || "",
          cnpj: resultado.cnpj_emitente || "",
          cpf: resultado.cpf_emitente || "",
          inscricao_estadual: resultado.inscricao_estadual_emitente || "",
          telefone: resultado.telefone_emitente || "",
          email: resultado.email_emitente || "",
          endereco: resultado.bairro_emitente ? `${resultado.endereco_emitente}, ${resultado.bairro_emitente}` : resultado.endereco_emitente,
          cidade: resultado.cidade_emitente || "",
          estado: resultado.estado_emitente || "",
          cep: resultado.cep_emitente || ""
        });
        setEtapa(2);
      }
      
    } catch (error) {
      console.error('❌ Erro:', error);
      toast.error(`❌ Erro ao processar XML: ${error.message || ''}`);
    } finally {
      setProcessando(false);
      e.target.value = '';
    }
  };

  useEffect(() => {
    if (etapa === 3 && dadosNFe?.itens) {
      const itens = dadosNFe.itens.map((item, index) => {
        const prod = produtos.find(p => 
          p.codigo_interno === item.codigo ||
          p.codigo_barras === item.codigo ||
          p.nome_produto?.toLowerCase().includes(item.descricao?.toLowerCase())
        );

        return {
          index,
          codigo: item.codigo || '',
          descricao: item.descricao || '',
          ncm: item.ncm || '',
          cfop: item.cfop || '',
          unidade: item.unidade || 'UN',
          quantidade: item.quantidade || 0,
          valor_unitario: item.valor_unitario || 0,
          produto_id: prod?.id,
          produto_nome: prod?.nome_produto,
          status: prod ? 'associado' : 'pendente',
          quantidade_ajustada: formatarNumero(item.quantidade || 0),
          valor_unitario_ajustado: formatarNumero(item.valor_unitario || 0),
          cfop_ajustado: item.cfop || '',
        };
      });
      
      setItensNFe(itens);
      setItensSelecionados(itens.map(i => i.index));
    }
  }, [etapa, dadosNFe, produtos]);

  const handleCadastrarFornecedor = () => {
    if (!novoFornecedor.nome) {
      toast.error('Nome obrigatório!');
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
      toast.error('Nome e unidade obrigatórios!');
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
    const pendentes = itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index));
    
    if (pendentes.length === 0) {
      toast.error('Nenhum produto pendente para cadastro!');
      return;
    }
    
    setShowCadastroEmMassa(true);

    const createdProductPromises = pendentes.map(async (item) => {
        const all = await base44.entities.Produto.list();
        const maxNum = all.reduce((max, p) => Math.max(max, parseInt(p.numero_produto) || 0), 0);
        
        return base44.entities.Produto.create({
            empresa_id: empresaSelecionadaId,
            numero_produto: String(maxNum + 1),
            nome_produto: item.descricao.toUpperCase(),
            codigo_interno: item.codigo?.toUpperCase(),
            unidade_medida: item.unidade?.toUpperCase() || 'UN',
            preco_custo: parseNumero(item.valor_unitario_ajustado),
            estoque_atual: 0
        });
    });

    try {
        const newProducts = await Promise.all(createdProductPromises);
        
        setItensNFe(prev => prev.map(item => {
            const newProduct = newProducts.find(np => 
                (np.codigo_interno === item.codigo || np.nome_produto === item.descricao.toUpperCase()) &&
                item.status === 'pendente'
            );
            if (newProduct) {
                return { ...item, produto_id: newProduct.id, produto_nome: newProduct.nome_produto, status: 'associado' };
            }
            return item;
        }));

        queryClient.invalidateQueries({ queryKey: ['produtos_financeiro'] });
        toast.success(`✅ ${pendentes.length} produto(s) cadastrado(s)!`);

    } catch (error) {
        console.error("Erro ao cadastrar produtos em massa:", error);
        toast.error("❌ Erro ao cadastrar produtos em massa.");
    } finally {
        setShowCadastroEmMassa(false);
    }
  };

  const handleAtualizarItem = (index, campo, valor) => {
    setItensNFe(prev => prev.map(item => 
      item.index === index ? { ...item, [campo]: valor } : item
    ));
  };

  const handleTrocarProduto = (produto) => {
    setItensNFe(prev => prev.map(item => 
      item.index === itemEditando?.index 
        ? { ...item, produto_id: produto.id, produto_nome: produto.nome_produto, status: 'associado' }
        : item
    ));
    
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
    const pendentes = itensParaImportar.filter(i => i.status === 'pendente');
    
    if (gerarEstoque && pendentes.length > 0) {
      toast.error(`❌ ${pendentes.length} produto(s) sem associação!`);
      return;
    }
    
    if (gerarEstoque && !dadosComplementares.local_estoque) {
      toast.error('❌ Selecione o local!');
      return;
    }

    if (gerarFinanceiro && !dataVencimento) {
      toast.error('❌ Defina a data de vencimento padrão!');
      return;
    }

    if (gerarFinanceiro && parcelar) {
      if (parcelas.length === 0) {
        toast.error('❌ Configure as parcelas!');
        return;
      }
      const totalParcelas = parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);
      if (Math.abs(totalParcelas - dadosNFe.valor_total) > 0.01) {
        toast.error('❌ Total das parcelas diferente do valor da NF-e!');
        return;
      }
      if (parcelas.some(p => !p.data || !p.valor || parseNumero(p.valor) <= 0)) {
        toast.error('❌ Todas as parcelas devem ter data e valor válidos!');
        return;
      }
    }

    console.log('✅ Confirmando:', {
      itens: itensParaImportar.length,
      gerarEstoque,
      gerarFinanceiro,
      gerarLivroFiscal,
      dataVencimento,
      parcelar,
      parcelas: parcelar ? parcelas : []
    });

    onSuccess({
      dadosNFe,
      fornecedor_id: fornecedorSelecionado.id,
      dataVencimento,
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
      parcelar,
      parcelas: parcelar ? parcelas.map(p => ({ data: p.data, valor: parseNumero(p.valor) })) : []
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
    setDataVencimento("");
    setGerarFinanceiro(true);
    setGerarEstoque(true);
    setGerarLivroFiscal(true);
    setParcelar(false);
    setParcelas([]);
    setNovoFornecedor({ tipo_pessoa: "Jurídica", nome: "", cnpj: "", cpf: "", inscricao_estadual: "", telefone: "", email: "", endereco: "", cidade: "", estado: "", cep: "" });
    setNovoProduto({ nome: "", codigo: "", unidade: "UN", categoria: "" });
  };

  const produtosFiltrados = produtos.filter(p => 
    !buscaProduto || 
    p.nome_produto?.toLowerCase().includes(buscaProduto.toLowerCase()) ||
    p.codigo_interno?.toLowerCase().includes(buscaProduto.toLowerCase())
  );

  const totalParcelas = parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);
  const parcelasInvalidas = parcelar && (parcelas.length === 0 || Math.abs(totalParcelas - (dadosNFe?.valor_total || 0)) > 0.01 || parcelas.some(p => !p.data || !p.valor || parseNumero(p.valor) <= 0));

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { onClose(); resetar(); } }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-green-600" />
              Importar NF-e - Etapa {etapa} de 4
            </DialogTitle>
          </DialogHeader>

          {etapa === 1 && (
            <div className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>Selecione o XML da NF-e modelo 55</AlertDescription>
              </Alert>

              <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-green-400 transition-colors">
                <Upload className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                <Input type="file" accept=".xml" onChange={handleUploadXML} disabled={processando} className="max-w-md mx-auto" />
                {processando && (
                  <div className="mt-6">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-blue-600" />
                    <p className="text-sm text-slate-600 mt-2">Processando...</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {etapa === 2 && dadosNFe && (
            <div className="space-y-4">
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-4 grid grid-cols-2 gap-2 text-sm">
                  <div><strong>NF-e:</strong> {dadosNFe.numero}</div>
                  <div><strong>Valor:</strong> {formatarMoeda(dadosNFe.valor_total)}</div>
                </CardContent>
              </Card>

              <Alert className="bg-orange-50 border-orange-300">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertDescription>
                  <strong>Fornecedor não cadastrado:</strong> {dadosNFe.razao_social_emitente}
                </AlertDescription>
              </Alert>

              <Card>
                <CardHeader><CardTitle className="text-base">Cadastrar Fornecedor</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Tipo *</Label>
                    <Select value={novoFornecedor.tipo_pessoa} onValueChange={(v) => setNovoFornecedor({ ...novoFornecedor, tipo_pessoa: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Jurídica">Jurídica</SelectItem>
                        <SelectItem value="Física">Física</SelectItem>
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

                  <div className="flex justify-between gap-3 pt-4 border-t">
                    <Button type="button" variant="outline" onClick={() => setEtapa(1)}>← Voltar</Button>
                    <Button onClick={handleCadastrarFornecedor} className="bg-green-600" disabled={createFornecedorMutation.isPending}>
                      {createFornecedorMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</> : <><Save className="w-4 h-4 mr-2" />Salvar →</>}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {etapa === 3 && dadosNFe && itensNFe.length > 0 && (
            <div className="space-y-4">
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-4 grid grid-cols-3 gap-2 text-sm">
                  <div><strong>Fornecedor:</strong> {fornecedorSelecionado?.nome}</div>
                  <div><strong>NF-e:</strong> {dadosNFe.numero}</div>
                  <div><strong>Valor:</strong> {formatarMoeda(dadosNFe.valor_total)}</div>
                </CardContent>
              </Card>

              <div className="flex justify-between">
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
                  <TableHeader className="sticky top-0 bg-white z-10">
                    <TableRow>
                      <TableHead className="w-12"><Checkbox checked={itensSelecionados.length === itensNFe.length} onCheckedChange={handleSelecionarTodos} /></TableHead>
                      <TableHead className="w-12">OK</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Vlr Unit.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itensNFe.map((item) => {
                      const isEdit = editandoItemIndex === item.index;
                      const total = parseNumero(item.quantidade_ajustada) * parseNumero(item.valor_unitario_ajustado);

                      return (
                        <TableRow key={item.index} className={!itensSelecionados.includes(item.index) ? 'opacity-40' : ''}>
                          <TableCell><Checkbox checked={itensSelecionados.includes(item.index)} onCheckedChange={() => handleToggleSelecao(item.index)} /></TableCell>
                          <TableCell>
                            {item.status === 'associado' ? <CheckCircle className="w-4 h-4 text-green-600" /> : <AlertCircle className="w-4 h-4 text-orange-600" />}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="font-semibold">{item.produto_nome || <span className="text-orange-600">NÃO ASSOCIADO</span>}</div>
                            <div className="text-slate-500 text-xs">{item.descricao}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            {isEdit ? <Input value={item.quantidade_ajustada} onChange={(e) => handleAtualizarItem(item.index, 'quantidade_ajustada', e.target.value)} className="w-20" /> : <span className="font-mono">{item.quantidade_ajustada}</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEdit ? <Input value={item.valor_unitario_ajustado} onChange={(e) => handleAtualizarItem(item.index, 'valor_unitario_ajustado', e.target.value)} className="w-24" /> : <span className="font-mono">R$ {item.valor_unitario_ajustado}</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold text-green-700">R$ {formatarNumero(total)}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {isEdit ? (
                                <Button size="sm" variant="ghost" onClick={() => setEditandoItemIndex(null)}><CheckCircle className="w-3 h-3" /></Button>
                              ) : (
                                <Button size="sm" variant="ghost" onClick={() => setEditandoItemIndex(item.index)}><Edit2 className="w-3 h-3" /></Button>
                              )}
                              <Button size="sm" variant="outline" onClick={() => { setItemEditando(item); setNovoProduto({ nome: item.descricao, codigo: item.codigo, unidade: item.unidade || "UN" }); setShowNovoProduto(true); }}>
                                <Plus className="w-3 h-3" />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => { setItemEditando(item); setShowTrocarProduto(true); }}>
                                <RefreshCw className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-between gap-3">
                <Button variant="outline" onClick={() => setEtapa(1)}>← Voltar</Button>
                <Button onClick={() => setEtapa(4)} className="bg-green-600">Avançar → ({itensSelecionados.length})</Button>
              </div>
            </div>
          )}

          {etapa === 4 && dadosNFe && (
            <div className="space-y-4">
              <div className="space-y-4 p-4 bg-slate-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <Checkbox checked={gerarFinanceiro} onCheckedChange={setGerarFinanceiro} id="fin" />
                  <label htmlFor="fin" className="font-semibold cursor-pointer">💰 Gerar Lançamento Financeiro</label>
                </div>

                {gerarFinanceiro && (
                  <div className="ml-8 p-4 bg-white rounded border space-y-4">
                    <div className="space-y-2">
                      <Label>Data de Vencimento (padrão) *</Label>
                      <Input type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} required />
                    </div>

                    <div className="flex items-center space-x-3">
                      <Checkbox checked={parcelar} onCheckedChange={(v) => { setParcelar(v); if (!v) setParcelas([]); }} id="parcelar" />
                      <label htmlFor="parcelar" className="font-semibold cursor-pointer">Parcelar lançamento</label>
                    </div>

                    {parcelar && (
                      <div className="space-y-3 p-3 bg-slate-50 rounded">
                        <div className="flex justify-between items-center">
                          <Label>Parcelas ({parcelas.length})</Label>
                          <Button type="button" size="sm" onClick={adicionarParcela}>
                            <Plus className="w-3 h-3 mr-1" />
                            Adicionar
                          </Button>
                        </div>

                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-16">Nº</TableHead>
                              <TableHead>Vencimento</TableHead>
                              <TableHead className="text-right">Valor</TableHead>
                              <TableHead className="w-12"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {parcelas.map((parcela, index) => (
                              <TableRow key={index}>
                                <TableCell className="font-bold">{index + 1}</TableCell>
                                <TableCell>
                                  <Input type="date" value={parcela.data} onChange={(e) => atualizarParcela(index, 'data', e.target.value)} />
                                </TableCell>
                                <TableCell>
                                  <Input value={parcela.valor} onChange={(e) => atualizarParcela(index, 'valor', e.target.value)} placeholder="0,00" className="text-right" />
                                </TableCell>
                                <TableCell>
                                  <Button type="button" variant="ghost" size="icon" onClick={() => removerParcela(index)} disabled={parcelas.length <= 1}>
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>

                        <Card className={`${Math.abs(totalParcelas - dadosNFe.valor_total) > 0.01 ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}`}>
                          <CardContent className="p-3">
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="flex justify-between">
                                <span>Total Parcelas:</span>
                                <span className="font-bold">{formatarMoeda(totalParcelas)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Valor NF-e:</span>
                                <span className="font-bold">{formatarMoeda(dadosNFe.valor_total)}</span>
                              </div>
                            </div>
                            {Math.abs(totalParcelas - dadosNFe.valor_total) > 0.01 && (
                              <p className="text-xs text-red-600 mt-2 text-center">⚠️ Valores diferentes!</p>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center space-x-3">
                  <Checkbox checked={gerarEstoque} onCheckedChange={setGerarEstoque} id="est" />
                  <label htmlFor="est" className="font-semibold cursor-pointer">📦 Entrada em Estoque</label>
                </div>

                {gerarEstoque && (
                  <div className="ml-8 p-3 bg-white rounded border">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Local *</Label>
                        <Select value={dadosComplementares.local_estoque} onValueChange={(v) => setDadosComplementares({ ...dadosComplementares, local_estoque: v })}>
                          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            {locais.map(l => <SelectItem key={l.id} value={l.nome}>{l.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Centro Custo</Label>
                        <Select value={dadosComplementares.centro_custo_id} onValueChange={(v) => setDadosComplementares({ ...dadosComplementares, centro_custo_id: v })}>
                          <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                          <SelectContent>
                            {centros.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-3">
                  <Checkbox checked={gerarLivroFiscal} onCheckedChange={setGerarLivroFiscal} id="liv" />
                  <label htmlFor="liv" className="font-semibold cursor-pointer">📚 Livro Fiscal</label>
                </div>

                <div className="space-y-2">
                  <Label>Observações</Label>
                  <Textarea value={dadosComplementares.observacoes} onChange={(e) => setDadosComplementares({ ...dadosComplementares, observacoes: e.target.value })} rows={2} />
                </div>
              </div>

              <Card className="bg-green-50 border-green-300">
                <CardContent className="p-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span>Fornecedor:</span><strong>{fornecedorSelecionado?.nome}</strong></div>
                  <div className="flex justify-between"><span>Produtos:</span><strong>{itensSelecionados.length} de {itensNFe.length}</strong></div>
                  {gerarFinanceiro && (
                    <>
                      <div className="flex justify-between"><span>Vencimento:</span><strong>{formatarDataParaBR(dataVencimento)}</strong></div>
                      {parcelar && <div className="flex justify-between"><span>Parcelas:</span><strong>{parcelas.length}x</strong></div>}
                    </>
                  )}
                  <div className="flex justify-between text-lg font-bold text-green-700 border-t pt-2"><span>Valor NF-e:</span><span>{formatarMoeda(dadosNFe.valor_total)}</span></div>
                </CardContent>
              </Card>

              <div className="flex justify-between gap-3">
                <Button variant="outline" onClick={() => setEtapa(3)}>← Voltar</Button>
                <Button onClick={handleConfirmar} className="bg-green-600 px-8 py-6 text-lg" disabled={parcelasInvalidas}>
                  <CheckCircle className="w-5 h-5 mr-2" />
                  Confirmar e Importar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showNovoProduto} onOpenChange={setShowNovoProduto}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cadastrar Produto</DialogTitle></DialogHeader>
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNIDADES_MEDIDA.map(un => <SelectItem key={un} value={un}>{un}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowNovoProduto(false)}>Cancelar</Button>
              <Button onClick={handleCadastrarProduto} className="bg-green-600" disabled={createProdutoMutation.isPending}>
                {createProdutoMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</> : <><Save className="w-4 h-4 mr-2" />Salvar</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showTrocarProduto} onOpenChange={setShowTrocarProduto}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Associar Produto</DialogTitle></DialogHeader>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Buscar..." value={buscaProduto} onChange={(e) => setBuscaProduto(e.target.value)} className="pl-10" />
          </div>
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-white">
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
              Cadastrando...
            </DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}