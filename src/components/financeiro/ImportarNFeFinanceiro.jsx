
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
import { Progress } from "@/components/ui/progress"; // Added Progress import
import { FileText, Upload, Loader2, Save, AlertCircle, Plus, CheckCircle, RefreshCw, Search, Trash2, Edit2, CheckSquare } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DialogCadastroRapido from "./DialogCadastroRapido.jsx";

const formatarNumero = (num) => {
  if (!num && num !== 0) return '0,00';
  const numero = typeof num === 'number' ? num : parseFloat(String(num).replace(/\./g, '').replace(',', '.'));
  if (isNaN(numero)) return '0,00';
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const parseNumero = (str) => {
  if (!str) return 0;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;
};

const ESTADOS_BRASIL = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export default function ImportarNFeFinanceiro({ open, onClose, onSuccess, fornecedores, produtos }) {
  const [processando, setProcessando] = useState(false);
  const [xmlFile, setXmlFile] = useState(null);
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
  const [showNovoFornecedor, setShowNovoFornecedor] = useState(false);
  const [showNovoProduto, setShowNovoProduto] = useState(false);
  const [showTrocarProduto, setShowTrocarProduto] = useState(false);
  const [showCadastroEmMassa, setShowCadastroEmMassa] = useState(false);
  const [itemEditando, setItemEditando] = useState(null);
  const [buscaProduto, setBuscaProduto] = useState("");
  
  const [showDialogLocal, setShowDialogLocal] = useState(false);
  const [showDialogCentro, setShowDialogCentro] = useState(false);
  const [showDialogPlano, setShowDialogPlano] = useState(false);
  const [showDialogGrupo, setShowDialogGrupo] = useState(false);
  const [showProgressoImportacao, setShowProgressoImportacao] = useState(false);
  const [progressoImportacao, setProgressoImportacao] = useState({ etapa: '', current: 0, total: 0 });
  
  const [dadosComplementares, setDadosComplementares] = useState({
    local_estoque: "",
    centro_custo_id: "",
    plano_contas_id: "",
    grupo_id: "",
    frete: "0,00",
    desconto_total: "0,00",
    outras_despesas: "0,00",
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
    codigo_barras: "",
    ncm: "",
    unidade: "UN",
    categoria: "",
    descricao: ""
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

  const { data: planos = [] } = useQuery({
    queryKey: ['planos_import', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PlanoContas.list('codigo');
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.ativo !== false && p.tipo === 'Despesa');
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: grupos = [] } = useQuery({
    queryKey: ['grupos_import', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.GrupoFinanceiro.list();
      return all.filter(g => g.empresa_id === empresaSelecionadaId && g.ativo !== false && g.tipo === 'Despesa');
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list(),
    initialData: [],
  });

  const { data: unidadesMedida = [] } = useQuery({
    queryKey: ['unidades_medida'],
    queryFn: () => base44.entities.UnidadeMedida.list(),
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
      setShowNovoFornecedor(false);
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
      setNovoProduto({
        nome: "",
        codigo: "",
        codigo_barras: "",
        ncm: "",
        unidade: "UN",
        categoria: "",
        descricao: ""
      });
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
    const valorTotal = dadosNFe?.valor_total || 0;
    const newNumberOfParcelas = parcelas.length + 1;
    const equalParcelValue = valorTotal / newNumberOfParcelas;

    const updatedParcelas = Array.from({ length: newNumberOfParcelas }, (_, i) => {
      const currentParcel = parcelas[i];
      let date = currentParcel?.data || (i === 0 ? dataVencimento : calcularDataProximaMes(parcelas[i-1]?.data || dataVencimento));
      if (i === newNumberOfParcelas - 1 && !ultimaParcela) {
        date = proximaData;
      } else if (i === newNumberOfParcelas - 1 && ultimaParcela) {
        date = calcularDataProximaMes(parcelas[i-1]?.data || dataVencimento);
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
    const valorTotal = dadosNFe?.valor_total || 0;
    const equalParcelValue = valorTotal / newParcelas.length;

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
      toast.info(`📄 Processando: ${file.name}`);
      
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setXmlFile(file_url);

      toast.info('🔍 Extraindo dados do XML...');
      const response = await fetch(file_url);
      const xmlText = await response.text();

      toast.info('🤖 Analisando nota fiscal...');
      
      const resultado = await base44.integrations.Core.InvokeLLM({
        prompt: `Você é um extrator de dados de NF-e. Extraia os dados do XML abaixo e retorne EXATAMENTE no formato JSON solicitado.

IMPORTANTE: 
- Se o XML não for uma NF-e válida (modelo 55), retorne modelo como string vazia
- Para campos que não existirem no XML, use null
- Números devem ser sempre numéricos, não strings
- CNPJ/CPF devem ter apenas números

XML:
${xmlText}`,
        response_json_schema: {
          type: "object",
          properties: {
            modelo: { type: "string" },
            numero: { type: "string" },
            serie: { type: "string" },
            chave: { type: "string" },
            data_emissao: { type: "string" },
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
            valor_total: { type: "number" },
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
        toast.error('❌ Não é NF-e modelo 55');
        setProcessando(false);
        return;
      }

      if (!resultado.itens || resultado.itens.length === 0) {
        toast.error('❌ NF-e sem produtos');
        setProcessando(false);
        return;
      }

      console.log('✅ XML processado:', resultado);
      toast.success(`✅ ${resultado.itens.length} produto(s) encontrado(s)`);
      
      setDadosNFe(resultado);
      
      if (resultado.data_emissao) {
        setDataVencimento(resultado.data_emissao);
        console.log('📅 Data vencimento:', resultado.data_emissao);
      } else {
        const hoje = new Date().toISOString().split('T')[0];
        setDataVencimento(hoje);
        console.log('📅 Data vencimento padrão (hoje):', hoje);
      }
      
      const documentoEmitente = resultado.cnpj_emitente || resultado.cpf_emitente;
      const forn = fornecedores.find(f => 
        f.cnpj?.replace(/\D/g, '') === documentoEmitente?.replace(/\D/g, '') ||
        f.cpf?.replace(/\D/g, '') === documentoEmitente?.replace(/\D/g, '')
      );
      
      if (forn) {
        setFornecedorSelecionado(forn);
        toast.success(`✅ Fornecedor: ${forn.nome}`);
        setEtapa(3);
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
      console.error('❌ Erro:', error);
      toast.error(`❌ Erro ao processar XML: ${error.message || ''}`);
    } finally {
      setProcessando(false);
      e.target.value = '';
    }
  };

  useEffect(() => {
    if (etapa === 3 && dadosNFe?.itens) {
      const itensComAssociacao = dadosNFe.itens.map((item, index) => {
        const prod = produtos.find(p => 
          p.codigo_interno === item.codigo ||
          p.codigo_barras === item.codigo ||
          p.nome_produto?.toLowerCase().includes(item.descricao?.toLowerCase())
        );

        const unidadeXML = item.unidade?.toUpperCase();
        const unidadeCadastrada = unidadesMedida.find(u => u.sigla === unidadeXML);
        const unidadeFinal = unidadeCadastrada ? unidadeCadastrada.sigla : (unidadeXML || 'UN');

        return {
          index,
          codigo: item.codigo || '',
          descricao: item.descricao || '',
          ncm: item.ncm || '',
          cfop: item.cfop || '',
          unidade: unidadeFinal,
          quantidade: item.quantidade || 0,
          valor_unitario: item.valor_unitario || 0,
          produto_id: prod?.id,
          produto_nome: prod?.nome_produto,
          status: prod ? 'associado' : 'pendente',
          quantidade_ajustada: formatarNumero(item.quantidade || 0),
          valor_unitario_ajustado: formatarNumero(item.valor_unitario || 0),
          desconto_item: "0,00",
          cfop_ajustado: item.cfop || '',
        };
      });
      
      setItensNFe(itensComAssociacao);
      setItensSelecionados(itensComAssociacao.map(i => i.index));
    }
  }, [etapa, dadosNFe, produtos, unidadesMedida]);

  const handleCadastrarFornecedor = () => {
    if (!novoFornecedor.nome) {
      toast.error('❌ Nome obrigatório!');
      return;
    }

    if (novoFornecedor.tipo_pessoa === 'Jurídica' && !novoFornecedor.cnpj) {
      toast.error('❌ CNPJ obrigatório para pessoa jurídica!');
      return;
    }

    if (novoFornecedor.tipo_pessoa === 'Física' && !novoFornecedor.cpf) {
      toast.error('❌ CPF obrigatório para pessoa física!');
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
      toast.error('❌ Nome e unidade obrigatórios!');
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
    const pendentes = itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index));
    
    if (pendentes.length === 0) {
      toast.error('❌ Nenhum produto pendente selecionado!');
      return;
    }
    
    setShowCadastroEmMassa(true);
    let cadastrados = 0;

    for (const item of pendentes) {
      try {
        const all = await base44.entities.Produto.list();
        const maxNum = all.reduce((max, p) => Math.max(max, parseInt(p.numero_produto) || 0), 0);
        
        const unidadeCadastrada = unidadesMedida.find(u => u.sigla === item.unidade);
        const unidadeFinal = unidadeCadastrada ? unidadeCadastrada.sigla : (item.unidade || 'UN');

        const newProduto = await base44.entities.Produto.create({
          empresa_id: empresaSelecionadaId,
          numero_produto: String(maxNum + 1),
          nome_produto: item.descricao.toUpperCase(),
          codigo_interno: item.codigo?.toUpperCase(),
          unidade_medida: unidadeFinal.toUpperCase(),
          preco_custo: parseNumero(item.valor_unitario_ajustado),
          estoque_atual: 0
        });

        setItensNFe(prevItens => prevItens.map(i => {
          if (i.index === item.index) {
            return { ...i, produto_id: newProduto.id, produto_nome: newProduto.nome_produto, status: 'associado' };
          }
          return i;
        }));
        cadastrados++;
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('Erro ao cadastrar produto:', error);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['produtos_financeiro'] });
    setShowCadastroEmMassa(false);
    toast.success(`✅ ${cadastrados} produto(s) cadastrado(s)!`);
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

  const handleRemoverItem = (index) => {
    if (window.confirm('Deseja remover este item?')) {
      setItensNFe(prev => prev.filter(item => item.index !== index));
      setItensSelecionados(prev => prev.filter(i => i !== index));
      toast.success('Item removido!');
    }
  };

  const handleToggleSelecao = (index) => {
    setItensSelecionados(prev => 
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const handleSelecionarTodos = () => {
    if (itensSelecionados.length === itensNFe.length && itensNFe.length > 0) {
      setItensSelecionados([]);
    } else {
      setItensSelecionados(itensNFe.map(i => i.index));
    }
  };

  const handleConfirmarImportacao = () => {
    const itensParaImportar = itensNFe.filter(i => itensSelecionados.includes(i.index));
    const pendentes = itensParaImportar.filter(i => i.status === 'pendente');
    
    if (itensParaImportar.length === 0) {
      toast.error('❌ Nenhum item selecionado!');
      return;
    }

    if (gerarEstoque && pendentes.length > 0) {
      toast.error(`❌ ${pendentes.length} produto(s) sem associação!`);
      return;
    }
    
    if (gerarEstoque && !dadosComplementares.local_estoque) {
      toast.error('❌ OBRIGATÓRIO: Selecione o Local de Estoque!');
      return;
    }

    if (gerarFinanceiro && !dataVencimento) {
      toast.error('❌ OBRIGATÓRIO: Defina a Data de Vencimento!');
      return;
    }
    
    if (gerarFinanceiro && !dadosComplementares.plano_contas_id) {
      toast.error('❌ OBRIGATÓRIO: Selecione o Plano de Contas!');
      return;
    }

    if (gerarFinanceiro && !dadosComplementares.grupo_id) {
      toast.error('❌ OBRIGATÓRIO: Selecione o Grupo Financeiro!');
      return;
    }

    if (gerarFinanceiro && parcelar) {
      if (parcelas.length === 0) {
        toast.error('❌ Configure as parcelas!');
        return;
      }
      const totalParcelasCalculado = parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);
      if (Math.abs(totalParcelasCalculado - dadosNFe.valor_total) > 0.01) {
        toast.error('❌ Total das parcelas diferente do valor da NF-e!');
        return;
      }
      if (parcelas.some(p => !p.data || !p.valor || parseNumero(p.valor) <= 0)) {
        toast.error('❌ OBRIGATÓRIO: Todas parcelas precisam de data e valor válidos!');
        return;
      }
    }

    console.log('✅ Confirmando importação:', {
      dadosNFe,
      dataVencimento,
      fornecedor_id: fornecedorSelecionado.id,
      dadosComplementares
    });

    // Fechar dialog de configuração e abrir dialog de progresso
    setShowProgressoImportacao(true);
    setProgressoImportacao({ etapa: '🚀 Iniciando importação...', current: 0, total: 100 });

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
        valor_unitario: parseNumero(i.valor_unitario_ajustado),
        desconto_item: parseNumero(i.desconto_item)
      })),
      dadosComplementares: {
        local_estoque: dadosComplementares.local_estoque,
        centro_custo_id: dadosComplementares.centro_custo_id,
        plano_contas_id: dadosComplementares.plano_contas_id,
        grupo_id: dadosComplementares.grupo_id,
        frete: parseNumero(dadosComplementares.frete),
        desconto_total: parseNumero(dadosComplementares.desconto_total),
        outras_despesas: parseNumero(dadosComplementares.outras_despesas),
        observacoes: dadosComplementares.observacoes
      },
      gerarFinanceiro,
      gerarEstoque,
      gerarLivroFiscal,
      parcelar,
      parcelas: parcelar ? parcelas.map(p => ({ data: p.data, valor: parseNumero(p.valor) })) : [],
      setProgressoImportacao  // Passar função para atualizar progresso
    });
  };

  const resetar = () => {
    setEtapa(1);
    setXmlFile(null);
    setDadosNFe(null);
    setFornecedorSelecionado(null);
    setItensNFe([]);
    setItensSelecionados([]);
    setEditandoItemIndex(null);
    setDadosComplementares({ local_estoque: "", centro_custo_id: "", plano_contas_id: "", grupo_id: "", frete: "0,00", desconto_total: "0,00", outras_despesas: "0,00", observacoes: "" });
    setDataVencimento("");
    setGerarFinanceiro(true);
    setGerarEstoque(true);
    setGerarLivroFiscal(true);
    setParcelar(false);
    setParcelas([]);
    setNovoFornecedor({ tipo_pessoa: "Jurídica", nome: "", cnpj: "", cpf: "", inscricao_estadual: "", telefone: "", email: "", endereco: "", cidade: "", estado: "", cep: "" });
    setNovoProduto({ nome: "", codigo: "", codigo_barras: "", ncm: "", unidade: "UN", categoria: "", descricao: "" });
    setShowProgressoImportacao(false); // Reset progress dialog
    setProgressoImportacao({ etapa: '', current: 0, total: 0 }); // Reset progress
  };

  const itensSelecionadosData = itensNFe.filter(i => itensSelecionados.includes(i.index));
  const subtotalItens = itensSelecionadosData.reduce((sum, item) => {
    const qtd = parseNumero(item.quantidade_ajustada);
    const vlrUnit = parseNumero(item.valor_unitario_ajustado);
    const descItem = parseNumero(item.desconto_item || "0,00");
    return sum + (qtd * vlrUnit - descItem);
  }, 0);

  const totalAjustado = subtotalItens + parseNumero(dadosComplementares.frete) + parseNumero(dadosComplementares.outras_despesas) - parseNumero(dadosComplementares.desconto_total);
  const totalParcelas = parcelas.reduce((sum, p) => sum + parseNumero(p.valor), 0);
  const parcelasInvalidas = parcelar && (parcelas.length === 0 || Math.abs(totalParcelas - (dadosNFe?.valor_total || 0)) > 0.01 || parcelas.some(p => !p.data || !p.valor || parseNumero(p.valor) <= 0));
  const produtosFiltrados = produtos.filter(p => 
    !buscaProduto || 
    p.nome_produto?.toLowerCase().includes(buscaProduto.toLowerCase()) ||
    p.codigo_interno?.toLowerCase().includes(buscaProduto.toLowerCase())
  );
  const progressPercentage = progressoImportacao.total > 0 ? Math.round((progressoImportacao.current / progressoImportacao.total) * 100) : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { onClose(); resetar(); } }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-emerald-600" />
              Importar NF-e (XML) - Etapa {etapa} de 4
            </DialogTitle>
          </DialogHeader>

          {/* ETAPA 1: UPLOAD */}
          {etapa === 1 && (
            <div className="space-y-3">
              <Alert className="py-2">
                <AlertCircle className="h-3 w-3" />
                <AlertDescription className="text-xs">
                  Selecione o arquivo XML da NF-e (modelo 55)
                </AlertDescription>
              </Alert>

              <div className="border-2 border-dashed rounded p-6 text-center hover:border-emerald-400 transition-colors">
                <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                <p className="text-xs text-slate-600 mb-3">Selecione o arquivo XML</p>
                <Input
                  type="file"
                  accept=".xml"
                  onChange={handleUploadXML}
                  disabled={processando}
                  className="max-w-md mx-auto h-8 text-xs"
                />
                {processando && (
                  <div className="mt-4">
                    <Loader2 className="w-4 h-4 animate-spin mx-auto text-blue-600" />
                    <p className="text-xs text-slate-600 mt-2">Processando...</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ETAPA 2: FORNECEDOR */}
          {etapa === 2 && dadosNFe && (
            <div className="space-y-3">
              <Card className="bg-blue-50 border-blue-200 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs">Dados da NF-e</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div><strong>Número:</strong> {dadosNFe.numero}</div>
                  <div><strong>Série:</strong> {dadosNFe.serie}</div>
                  <div><strong>Data:</strong> {new Date(dadosNFe.data_emissao).toLocaleDateString('pt-BR')}</div>
                  <div><strong>Valor:</strong> R$ {formatarNumero(dadosNFe.valor_total)}</div>
                  <div className="col-span-2 md:col-span-4">
                    <strong>Chave:</strong> <span className="font-mono text-[10px]">{dadosNFe.chave}</span>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                <h3 className="font-semibold text-xs">Fornecedor</h3>
                <Alert className="bg-orange-50 border-orange-300 py-2">
                  <AlertCircle className="h-3 w-3 text-orange-600" />
                  <AlertDescription className="text-xs">
                    Não encontrado: <strong>{dadosNFe.razao_social_emitente}</strong>
                    <Button size="sm" className="ml-3 h-7 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowNovoFornecedor(true)}>
                      <Plus className="w-3 h-3" />
                      Cadastrar
                    </Button>
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          )}

          {/* ETAPA 3: PRODUTOS */}
          {etapa === 3 && dadosNFe && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold text-xs">Produtos ({itensNFe.length})</h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={handleSelecionarTodos} className="h-7 gap-1 text-xs">
                    <CheckSquare className="w-3 h-3" />
                    {itensSelecionados.length === itensNFe.length && itensNFe.length > 0 ? 'Desmarcar' : 'Selecionar'}
                  </Button>
                  {itensSelecionados.length > 0 && itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index)).length > 0 && (
                    <Button size="sm" onClick={handleCadastrarProdutosEmMassa} className="bg-emerald-600 hover:bg-emerald-700 h-7 gap-1 text-xs">
                      <Plus className="w-3 h-3" />
                      Cadastrar ({itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index)).length})
                    </Button>
                  )}
                </div>
              </div>
              
              <div className="overflow-auto max-h-96 border rounded">
                <Table>
                  <TableHeader className="sticky top-0 bg-white z-10">
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox 
                          checked={itensSelecionados.length === itensNFe.length && itensNFe.length > 0}
                          onCheckedChange={handleSelecionarTodos}
                        />
                      </TableHead>
                      <TableHead className="w-16">Status</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Vlr Unit.</TableHead>
                      <TableHead className="text-right">Desc.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-center">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itensNFe.map((item) => {
                      const isEditando = editandoItemIndex === item.index;
                      const valorTotal = parseNumero(item.quantidade_ajustada) * parseNumero(item.valor_unitario_ajustado) - parseNumero(item.desconto_item || "0,00");
                      
                      return (
                        <TableRow key={item.index} className={!itensSelecionados.includes(item.index) ? 'opacity-50 bg-slate-50' : ''}>
                          <TableCell>
                            <Checkbox 
                              checked={itensSelecionados.includes(item.index)}
                              onCheckedChange={() => handleToggleSelecao(item.index)}
                            />
                          </TableCell>
                          <TableCell>
                            {item.status === 'associado' ? (
                              <CheckCircle className="w-5 h-5 text-green-600" />
                            ) : (
                              <AlertCircle className="w-5 h-5 text-orange-600" />
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="font-semibold">{item.produto_nome || <span className="text-orange-600">Não associado</span>}</div>
                            <div className="text-slate-500 text-xs">{item.descricao}</div>
                            <div className="text-slate-400 text-xs font-mono">Cód: {item.codigo}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditando ? (
                              <Input
                                value={item.quantidade_ajustada}
                                onChange={(e) => handleAtualizarItem(item.index, 'quantidade_ajustada', e.target.value)}
                                className="w-24 text-right h-7 text-xs"
                              />
                            ) : (
                              <span className="font-mono text-xs">{item.quantidade_ajustada}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditando ? (
                              <Input
                                value={item.valor_unitario_ajustado}
                                onChange={(e) => handleAtualizarItem(item.index, 'valor_unitario_ajustado', e.target.value)}
                                className="w-28 text-right h-7 text-xs"
                              />
                            ) : (
                              <span className="font-mono text-xs">R$ {item.valor_unitario_ajustado}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditando ? (
                              <Input
                                value={item.desconto_item || "0,00"}
                                onChange={(e) => handleAtualizarItem(item.index, 'desconto_item', e.target.value)}
                                className="w-24 text-right h-7 text-xs"
                              />
                            ) : (
                              <span className="font-mono text-slate-50 text-xs">R$ {formatarNumero(parseNumero(item.desconto_item))}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="font-mono font-bold text-green-700 text-xs">R$ {formatarNumero(valorTotal)}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1 justify-center">
                              {isEditando ? (
                                <Button size="sm" variant="ghost" onClick={() => setEditandoItemIndex(null)} className="text-green-600 h-7 w-7 p-0">
                                  <CheckCircle className="w-3 h-3" />
                                </Button>
                              ) : (
                                <Button size="sm" variant="ghost" onClick={() => setEditandoItemIndex(item.index)} title="Editar valores" className="h-7 w-7 p-0">
                                  <Edit2 className="w-3 h-3" />
                                </Button>
                              )}
                              {item.status === 'pendente' && (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => { setItemEditando(item); setNovoProduto({ nome: item.descricao, codigo: item.codigo, codigo_barras: "", ncm: item.ncm, unidade: item.unidade || "UN", categoria: "", descricao: "" }); setShowNovoProduto(true); }} className="h-7 w-7 p-0">
                                    <Plus className="w-3 h-3" />
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => { setItemEditando(item); setShowTrocarProduto(true); }} className="h-7 w-7 p-0">
                                    <RefreshCw className="w-3 h-3" />
                                  </Button>
                                </>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => handleRemoverItem(item.index)} className="text-red-600 hover:bg-red-50 h-7 w-7 p-0">
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <Card className="bg-blue-50 border-blue-300 shadow-sm">
                <CardContent className="p-3">
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span>Itens Selecionados:</span>
                      <span className="font-semibold">{itensSelecionados.length} de {itensNFe.length}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-blue-700">
                      <span>Subtotal Produtos:</span>
                      <span>R$ {formatarNumero(subtotalItens)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => setEtapa(fornecedorSelecionado ? 1 : 2)} size="sm" className="h-8 text-xs">Voltar</Button>
                <Button 
                  onClick={() => setEtapa(4)} 
                  className="bg-emerald-600 hover:bg-emerald-700 h-8 gap-1 text-xs"
                  disabled={itensSelecionados.length === 0}
                >
                  Avançar ({itensSelecionados.length} {itensSelecionados.length === 1 ? 'item' : 'itens'})
                </Button>
              </div>
            </div>
          )}

          {/* ETAPA 4: CONFIGURAÇÕES FINAIS */}
          {etapa === 4 && dadosNFe && (
            <div className="space-y-3">
              {/* CHECKBOXES DE LANÇAMENTO */}
              <div className="space-y-3 p-3 bg-slate-50 rounded border">
                <div className="flex items-center space-x-2">
                  <Checkbox checked={gerarFinanceiro} onCheckedChange={setGerarFinanceiro} id="fin" />
                  <label htmlFor="fin" className="font-semibold cursor-pointer text-xs">💰 Gerar Lançamento Financeiro</label>
                </div>

                {gerarFinanceiro && (
                  <div className="ml-6 p-3 bg-white rounded border space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Plano de Contas</Label>
                        <div className="flex gap-1.5">
                          <Select value={dadosComplementares.plano_contas_id} onValueChange={(v) => setDadosComplementares({ ...dadosComplementares, plano_contas_id: v })} className="flex-1">
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                            <SelectContent>
                              {planos.map(p => <SelectItem key={p.id} value={p.id} className="text-xs">{p.codigo} - {p.descricao}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogPlano(true)} className="h-8 w-8">
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Grupo Financeiro</Label>
                        <div className="flex gap-1.5">
                          <Select value={dadosComplementares.grupo_id} onValueChange={(v) => setDadosComplementares({ ...dadosComplementares, grupo_id: v })} className="flex-1">
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                            <SelectContent>
                              {grupos.map(g => <SelectItem key={g.id} value={g.id} className="text-xs">{g.descricao}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogGrupo(true)} className="h-8 w-8">
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1 text-xs">
                        Data de Vencimento
                        <span className="text-red-600 font-bold">*</span>
                      </Label>
                      <Input type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} required className="h-8 text-xs" />
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox checked={parcelar} onCheckedChange={(v) => { setParcelar(v); if (!v) setParcelas([]); }} id="parcelar" />
                      <label htmlFor="parcelar" className="font-semibold cursor-pointer text-xs">Parcelar lançamento</label>
                    </div>

                    {parcelar && (
                      <div className="space-y-2 p-2 bg-slate-50 rounded">
                        <div className="flex justify-between items-center">
                          <Label className="text-xs">Parcelas ({parcelas.length})</Label>
                          <Button type="button" size="sm" onClick={adicionarParcela} className="h-7 gap-1 text-xs">
                            <Plus className="w-3 h-3" />
                            Adicionar
                          </Button>
                        </div>

                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-16 text-xs">Nº</TableHead>
                              <TableHead className="text-xs">Vencimento *</TableHead>
                              <TableHead className="text-right text-xs">Valor *</TableHead>
                              <TableHead className="w-12"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {parcelas.map((parcela, index) => (
                              <TableRow key={index}>
                                <TableCell className="font-bold text-xs">{index + 1}</TableCell>
                                <TableCell>
                                  <Input type="date" value={parcela.data} onChange={(e) => atualizarParcela(index, 'data', e.target.value)} className="h-7 text-xs" />
                                </TableCell>
                                <TableCell>
                                  <Input value={parcela.valor} onChange={(e) => atualizarParcela(index, 'valor', e.target.value)} placeholder="0,00" className="text-right h-7 text-xs" />
                                </TableCell>
                                <TableCell>
                                  <Button type="button" variant="ghost" size="icon" onClick={() => removerParcela(index)} disabled={parcelas.length <= 1} className="h-7 w-7 p-0">
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>

                        <Card className={`${parcelasInvalidas ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}`}>
                          <CardContent className="p-3">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="flex justify-between">
                                <span>Total Parcelas:</span>
                                <span className="font-bold">R$ {formatarNumero(totalParcelas)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Valor NF-e:</span>
                                <span className="font-bold">R$ {formatarNumero(dadosNFe.valor_total)}</span>
                              </div>
                            </div>
                            {parcelasInvalidas && (
                              <p className="text-xs text-red-600 mt-2 text-center">⚠️ Valores diferentes ou inválidos!</p>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Checkbox checked={gerarEstoque} onCheckedChange={setGerarEstoque} id="est" />
                  <label htmlFor="est" className="font-semibold cursor-pointer text-xs">📦 Entrada em Estoque</label>
                </div>

                {gerarEstoque && (
                  <div className="ml-6 p-3 bg-white rounded border space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1 text-xs">
                          Local de Estoque
                          <span className="text-red-600 font-bold">*</span>
                        </Label>
                        <div className="flex gap-1.5">
                          <Select value={dadosComplementares.local_estoque} onValueChange={(v) => setDadosComplementares({ ...dadosComplementares, local_estoque: v })} className="flex-1">
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                            <SelectContent>
                              {locais.map(l => <SelectItem key={l.id} value={l.nome} className="text-xs">{l.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogLocal(true)} className="h-8 w-8">
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Centro de Custo</Label>
                        <div className="flex gap-1.5">
                          <Select value={dadosComplementares.centro_custo_id} onValueChange={(v) => setDadosComplementares({ ...dadosComplementares, centro_custo_id: v })} className="flex-1">
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                            <SelectContent>
                              {centros.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button type="button" variant="outline" size="icon" onClick={() => setShowDialogCentro(true)} className="h-8 w-8">
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Frete</Label>
                        <Input value={dadosComplementares.frete} onChange={(e) => setDadosComplementares({ ...dadosComplementares, frete: e.target.value })} placeholder="0,00" className="h-8 text-xs" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Desconto Geral</Label>
                        <Input value={dadosComplementares.desconto_total} onChange={(e) => setDadosComplementares({ ...dadosComplementares, desconto_total: e.target.value })} placeholder="0,00" className="h-8 text-xs" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Outras Despesas</Label>
                        <Input value={dadosComplementares.outras_despesas} onChange={(e) => setDadosComplementares({ ...dadosComplementares, outras_despesas: e.target.value })} placeholder="0,00" className="h-8 text-xs" />
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Checkbox checked={gerarLivroFiscal} onCheckedChange={setGerarLivroFiscal} id="liv" />
                  <label htmlFor="liv" className="font-semibold cursor-pointer text-xs">📚 Livro Fiscal</label>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Observações</Label>
                <Textarea 
                  value={dadosComplementares.observacoes} 
                  onChange={(e) => setDadosComplementares({ ...dadosComplementares, observacoes: e.target.value })} 
                  rows={2}
                  className="text-xs uppercase" 
                  style={{ textTransform: 'uppercase' }}
                  placeholder="OBSERVAÇÕES..."
                />
              </div>

              <Card className="bg-emerald-50 border-emerald-300 shadow-sm">
                <CardContent className="p-3">
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span>Subtotal:</span><span className="font-mono">R$ {formatarNumero(subtotalItens)}</span></div>
                    <div className="flex justify-between"><span>+ Frete:</span><span className="font-mono">R$ {dadosComplementares.frete}</span></div>
                    <div className="flex justify-between"><span>+ Outras Despesas:</span><span className="font-mono">R$ {dadosComplementares.outras_despesas}</span></div>
                    <div className="flex justify-between text-red-600"><span>- Desconto:</span><span className="font-mono">R$ {dadosComplementares.desconto_total}</span></div>
                    <div className="border-t-2 border-emerald-400 pt-1.5 flex justify-between font-bold text-emerald-700">
                      <span>TOTAL FINAL:</span>
                      <span>R$ {formatarNumero(totalAjustado)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => setEtapa(3)} size="sm" className="h-8 text-xs">Voltar</Button>
                <Button onClick={handleConfirmarImportacao} size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 gap-1 text-xs" disabled={gerarFinanceiro && parcelar && parcelasInvalidas}>
                  <CheckCircle className="w-3 h-3" />
                  Confirmar e Importar ({itensSelecionados.length} {itensSelecionados.length === 1 ? 'item' : 'itens'})
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* DIALOG PROGRESSO */}
      <Dialog open={showProgressoImportacao} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              Importando NF-e
            </DialogTitle>
            <DialogDescription className="text-xs">{progressoImportacao.etapa}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-600">Progresso</span>
                <span className="font-semibold text-slate-900">{progressoImportacao.current}/{progressoImportacao.total}</span>
              </div>
              <Progress value={progressPercentage} className="h-1.5" />
              <p className="text-center text-xs font-semibold text-emerald-600">{progressPercentage}%</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOGS AUXILIARES */}
      <Dialog open={showNovoFornecedor} onOpenChange={setShowNovoFornecedor}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cadastrar Novo Fornecedor</DialogTitle>
            <DialogDescription>Preencha os dados do fornecedor para continuar a importação</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">Tipo de Pessoa *</Label>
              <Select value={novoFornecedor.tipo_pessoa} onValueChange={(v) => setNovoFornecedor({ ...novoFornecedor, tipo_pessoa: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Jurídica" className="text-xs">Pessoa Jurídica</SelectItem>
                  <SelectItem value="Física" className="text-xs">Pessoa Física</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">{novoFornecedor.tipo_pessoa === 'Jurídica' ? 'Razão Social' : 'Nome Completo'} *</Label>
              <Input value={novoFornecedor.nome} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, nome: e.target.value })} className="uppercase h-8 text-xs" style={{ textTransform: 'uppercase' }} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {novoFornecedor.tipo_pessoa === 'Jurídica' ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs">CNPJ *</Label>
                    <Input value={novoFornecedor.cnpj} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cnpj: e.target.value })} placeholder="00.000.000/0000-00" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Inscrição Estadual</Label>
                    <Input value={novoFornecedor.inscricao_estadual} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, inscricao_estadual: e.target.value })} className="uppercase h-8 text-xs" style={{ textTransform: 'uppercase' }} />
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs">CPF *</Label>
                  <Input value={novoFornecedor.cpf} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cpf: e.target.value })} placeholder="000.000.000-00" className="h-8 text-xs" />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Telefone</Label>
                <Input value={novoFornecedor.telefone} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, telefone: e.target.value })} placeholder="(00) 00000-0000" className="h-8 text-xs" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">E-mail</Label>
                <Input type="email" value={novoFornecedor.email} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, email: e.target.value })} placeholder="email@exemplo.com" className="h-8 text-xs" />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Endereço</Label>
              <Input value={novoFornecedor.endereco} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, endereco: e.target.value })} placeholder="RUA, NÚMERO, BAIRRO" className="uppercase h-8 text-xs" style={{ textTransform: 'uppercase' }} />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Cidade</Label>
                <Input value={novoFornecedor.cidade} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cidade: e.target.value })} placeholder="CIDADE" className="uppercase h-8 text-xs" style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Estado</Label>
                <Select value={novoFornecedor.estado} onValueChange={(v) => setNovoFornecedor({ ...novoFornecedor, estado: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="UF" /></SelectTrigger>
                  <SelectContent>
                    {ESTADOS_BRASIL.map(uf => <SelectItem key={uf} value={uf} className="text-xs">{uf}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">CEP</Label>
                <Input value={novoFornecedor.cep} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cep: e.target.value })} placeholder="00000-000" className="h-8 text-xs" />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => setShowNovoFornecedor(false)} className="h-8 text-xs">Cancelar</Button>
              <Button onClick={handleCadastrarFornecedor} className="bg-green-600 h-8 text-xs" disabled={createFornecedorMutation.isPending}>
                {createFornecedorMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</> : <><Save className="w-4 h-4 mr-2" />Salvar e Continuar</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNovoProduto} onOpenChange={setShowNovoProduto}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cadastrar Novo Produto</DialogTitle>
            <DialogDescription>Preencha os dados do produto para associá-lo à NF-e</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">Nome do Produto *</Label>
              <Input value={novoProduto.nome} onChange={(e) => setNovoProduto({ ...novoProduto, nome: e.target.value })} className="uppercase h-8 text-xs" style={{ textTransform: 'uppercase' }} />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Código Interno</Label>
                <Input value={novoProduto.codigo} onChange={(e) => setNovoProduto({ ...novoProduto, codigo: e.target.value })} className="uppercase h-8 text-xs" style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Código de Barras</Label>
                <Input value={novoProduto.codigo_barras} onChange={(e) => setNovoProduto({ ...novoProduto, codigo_barras: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">NCM</Label>
                <Input value={novoProduto.ncm} onChange={(e) => setNovoProduto({ ...novoProduto, ncm: e.target.value })} className="h-8 text-xs" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Unidade de Medida *</Label>
                <Select value={novoProduto.unidade} onValueChange={(v) => setNovoProduto({ ...novoProduto, unidade: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {unidadesMedida.map(un => <SelectItem key={un.id} value={un.sigla} className="text-xs">{un.sigla} - {un.descricao}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Categoria</Label>
                <Select value={novoProduto.categoria} onValueChange={(v) => setNovoProduto({ ...novoProduto, categoria: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {categorias.map(c => <SelectItem key={c.id} value={c.nome} className="text-xs">{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Descrição</Label>
              <Textarea value={novoProduto.descricao} onChange={(e) => setNovoProduto({ ...novoProduto, descricao: e.target.value })} className="uppercase h-8 text-xs" style={{ textTransform: 'uppercase' }} />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => setShowNovoProduto(false)} className="h-8 text-xs">Cancelar</Button>
              <Button onClick={handleCadastrarProduto} className="bg-green-600 h-8 text-xs" disabled={createProdutoMutation.isPending}>
                {createProdutoMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</> : <><Save className="w-4 h-4 mr-2" />Salvar e Associar</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showTrocarProduto} onOpenChange={setShowTrocarProduto}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Trocar por Produto Existente</DialogTitle>
            <DialogDescription>Selecione um produto cadastrado para associar</DialogDescription>
          </DialogHeader>
          
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <Input placeholder="Buscar por nome ou código..." value={buscaProduto} onChange={(e) => setBuscaProduto(e.target.value)} className="pl-10 h-8 text-xs" />
          </div>

          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-white">
                <TableRow>
                  <TableHead className="text-xs">Código</TableHead>
                  <TableHead className="text-xs">Nome</TableHead>
                  <TableHead className="text-xs">Categoria</TableHead>
                  <TableHead className="text-xs">Unidade</TableHead>
                  <TableHead className="text-xs">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtosFiltrados.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-slate-500 text-xs">Nenhum produto encontrado</TableCell>
                  </TableRow>
                ) : (
                  produtosFiltrados.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.codigo_interno || '-'}</TableCell>
                      <TableCell className="text-xs">{p.nome_produto}</TableCell>
                      <TableCell className="text-xs">{p.categoria || '-'}</TableCell>
                      <TableCell className="text-xs">{p.unidade_medida}</TableCell>
                      <TableCell>
                        <Button size="sm" onClick={() => handleTrocarProduto(p)} className="bg-green-600 h-7 text-xs">
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

      <Dialog open={showCadastroEmMassa} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              Cadastrando Produtos
            </DialogTitle>
            <DialogDescription className="text-sm">Aguarde enquanto os produtos selecionados são cadastrados...</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <DialogCadastroRapido tipo="local_estoque" open={showDialogLocal} onClose={() => setShowDialogLocal(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['locais'] }); const local = locais.find(l => l.id === id); if (local) setDadosComplementares({ ...dadosComplementares, local_estoque: local.nome }); setShowDialogLocal(false); }} />
      <DialogCadastroRapido tipo="centro_custo" open={showDialogCentro} onClose={() => setShowDialogCentro(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['centros_import'] }); setDadosComplementares({ ...dadosComplementares, centro_custo_id: id }); setShowDialogCentro(false); }} />
      <DialogCadastroRapido tipo="plano_contas" open={showDialogPlano} onClose={() => setShowDialogPlano(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['planos_import'] }); setDadosComplementares({ ...dadosComplementares, plano_contas_id: id }); setShowDialogPlano(false); }} tipoFinanceiro="Despesa" />
      <DialogCadastroRapido tipo="grupo_financeiro" open={showDialogGrupo} onClose={() => setShowDialogGrupo(false)} onSuccess={(id) => { queryClient.invalidateQueries({ queryKey: ['grupos_import'] }); setDadosComplementares({ ...dadosComplementares, grupo_id: id }); setShowDialogGrupo(false); }} tipoFinanceiro="Despesa" />
    </>
  );
}
