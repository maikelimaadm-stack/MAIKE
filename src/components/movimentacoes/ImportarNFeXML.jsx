
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, Upload, CheckCircle, AlertCircle, Plus, RefreshCw, Loader2, Save, X, Search, Trash2, CheckSquare, Edit2 } from "lucide-react";
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

const ESTADOS_BRASIL = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

const UNIDADES_MEDIDA = [
  'UN', 'KG', 'G', 'MG', 'L', 'ML', 'M', 'M2', 'M3', 'CM', 'MM', 
  'CX', 'PC', 'SC', 'FD', 'TON', 'KIT', 'JG', 'PAR', 'DZ'
];

export default function ImportarNFeXML({ open, onClose, onSuccess, produtos, fornecedores }) {
  const [etapa, setEtapa] = useState(1);
  const [processando, setProcessando] = useState(false);
  const [xmlFile, setXmlFile] = useState(null);
  const [dadosNFe, setDadosNFe] = useState(null);
  const [fornecedorSelecionado, setFornecedorSelecionado] = useState(null);
  const [itensNFe, setItensNFe] = useState([]);
  const [itensSelecionados, setItensSelecionados] = useState([]);
  const [editandoItemIndex, setEditandoItemIndex] = useState(null); // New state for inline editing
  const [dadosComplementares, setDadosComplementares] = useState({
    local_estoque: "",
    centro_custo_id: "",
    frete: "0,00",
    tipo_frete: "CIF",
    desconto_total: "0,00",
    outras_despesas: "0,00",
    observacoes: ""
  });

  const [showNovoFornecedor, setShowNovoFornecedor] = useState(false);
  const [showNovoProduto, setShowNovoProduto] = useState(false);
  const [showTrocarProduto, setShowTrocarProduto] = useState(false);
  const [showCadastroEmMassa, setShowCadastroEmMassa] = useState(false);
  const [showProgressoImportacao, setShowProgressoImportacao] = useState(false);
  const [progressoImportacao, setProgressoImportacao] = useState({ current: 0, total: 0 });
  const [itemEditando, setItemEditando] = useState(null);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [erroExtracao, setErroExtracao] = useState(null);
  
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

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: locais = [] } = useQuery({
    queryKey: ['locais'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: [],
  });

  const { data: centros = [] } = useQuery({
    queryKey: ['centros', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId);
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
      const allFornecedores = await base44.entities.Fornecedor.list();
      const maxNum = allFornecedores.reduce((max, f) => Math.max(max, parseInt(f.numero_cadastro) || 0), 0);
      return base44.entities.Fornecedor.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_cadastro: String(maxNum + 1)
      });
    },
    onSuccess: (newFornecedor) => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
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
      const allProdutos = await base44.entities.Produto.list();
      const maxNum = allProdutos.reduce((max, p) => Math.max(max, parseInt(p.numero_produto) || 0), 0);
      return base44.entities.Produto.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_produto: String(maxNum + 1),
        estoque_atual: 0
      });
    },
    onSuccess: (newProduto) => {
      queryClient.invalidateQueries({ queryKey: ['produtos'] });
      
      const itensAtualizados = itensNFe.map(item => {
        if (item.index === itemEditando?.index) {
          return { ...item, produto_id: newProduto.id, produto_nome: newProduto.nome_produto, status: 'associado' };
        }
        return item;
      });
      
      setItensNFe(itensAtualizados);
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

  const handleUploadXML = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setProcessando(true);
    setErroExtracao(null);
    
    try {
      toast.info(`📄 Processando: ${file.name}`);
      
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      toast.info('🔍 Extraindo dados do XML...');
      const response = await fetch(file_url);
      const xmlText = await response.text();

      toast.info('🤖 Analisando nota fiscal...');
      
      let resultado;
      try {
        resultado = await base44.integrations.Core.InvokeLLM({
          prompt: `Você é um extrator de dados de NF-e. Extraia os dados do XML abaixo e retorne EXATAMENTE no formato JSON solicitado.

IMPORTANTE: 
- Se o XML não for uma NF-e válida (modelo 55), retorne modelo como string vazia
- Para campos que não existirem no XML, use null
- Números devem ser sempre numéricos, não strings
- CNPJ/CPF devem ter apenas números

XML:
${xmlText}

Retorne um JSON com esta estrutura EXATA:
{
  "modelo": "55",
  "numero": "string",
  "serie": "string",
  "chave": "string (44 dígitos)",
  "data_emissao": "YYYY-MM-DD",
  "cnpj_emitente": "string (apenas números)",
  "cpf_emitente": "string (apenas números se for PF, senão null)",
  "razao_social_emitente": "string",
  "inscricao_estadual_emitente": "string ou null",
  "telefone_emitente": "string ou null",
  "email_emitente": "string ou null",
  "endereco_emitente": "string (logradouro + número)",
  "bairro_emitente": "string ou null",
  "cidade_emitente": "string",
  "estado_emitente": "string (UF - 2 letras)",
  "cep_emitente": "string (apenas números)",
  "valor_total": number,
  "itens": [
    {
      "codigo": "string",
      "descricao": "string",
      "ncm": "string",
      "cfop": "string",
      "unidade": "string",
      "quantidade": number,
      "valor_unitario": number,
      "valor_total": number
    }
  ]
}`,
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
      } catch (llmError) {
        console.error('Erro LLM:', llmError);
        setErroExtracao({
          tipo: 'llm',
          mensagem: 'Erro ao processar XML com IA',
          detalhes: llmError.message || 'Erro desconhecido',
          xmlUrl: file_url
        });
        setProcessando(false);
        toast.error('❌ Erro ao processar XML - verifique os detalhes');
        return;
      }

      if (!resultado || resultado.modelo !== "55") {
        setErroExtracao({
          tipo: 'modelo',
          mensagem: 'Arquivo não é uma NF-e válida (modelo 55)',
          detalhes: resultado ? `Modelo detectado: ${resultado.modelo || 'não identificado'}` : 'Não foi possível extrair dados',
          xmlUrl: file_url
        });
        setProcessando(false);
        toast.error('❌ Arquivo não é uma NF-e válida (modelo 55)');
        return;
      }

      if (!resultado.itens || resultado.itens.length === 0) {
        setErroExtracao({
          tipo: 'itens',
          mensagem: 'NF-e não possui itens',
          detalhes: 'O XML não contém produtos para importar',
          xmlUrl: file_url
        });
        setProcessando(false);
        toast.error('❌ NF-e não possui itens para importar');
        return;
      }

      toast.success('✅ XML processado com sucesso!');
      
      const movimentacoes = await base44.entities.MovimentacaoEstoque.list();
      const jaImportada = movimentacoes.find(m => m.chave_documento === resultado.chave);
      
      if (jaImportada) {
        if (window.confirm(`⚠️ ATENÇÃO: Esta NF-e (${resultado.numero}) já foi importada anteriormente em ${new Date(jaImportada.data_movimentacao).toLocaleString('pt-BR')}!\n\nDeseja importar novamente?`)) {
          // Continua
        } else {
          setProcessando(false);
          return;
        }
      }

      setXmlFile(file_url);
      setDadosNFe(resultado);
      setEtapa(2);
      
      const documentoEmitente = resultado.cnpj_emitente || resultado.cpf_emitente;
      const fornecedor = fornecedores.find(f => 
        f.cnpj?.replace(/\D/g, '') === documentoEmitente?.replace(/\D/g, '') ||
        f.cpf?.replace(/\D/g, '') === documentoEmitente?.replace(/\D/g, '')
      );
      
      if (fornecedor) {
        setFornecedorSelecionado(fornecedor);
        toast.success('✅ Fornecedor identificado automaticamente!');
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
      }

    } catch (error) {
      console.error('Erro geral:', error);
      setErroExtracao({
        tipo: 'geral',
        mensagem: 'Erro ao processar XML',
        detalhes: error.message || 'Erro desconhecido ao processar arquivo',
        xmlUrl: xmlFile // Use xmlFile if it was successfully uploaded to get file_url
      });
      toast.error('❌ Erro ao processar XML - verifique os detalhes');
    } finally {
      e.target.value = '';
      if (!erroExtracao) {
        setProcessando(false);
      }
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
          desconto_item: "0,00",
          cfop_ajustado: item.cfop,
          incluir: true
        };
      });
      
      setItensNFe(itensComAssociacao);
      setItensSelecionados(itensComAssociacao.map(i => i.index));
    }
  }, [etapa, dadosNFe, produtos]);

  const handleAtualizarItem = (index, campo, valor) => {
    setItensNFe(prev => prev.map(item => {
      if (item.index === index) {
        const updated = { ...item, [campo]: valor };
        
        // Recalcular valor_total se quantidade ou valor_unitario mudaram
        if (campo === 'quantidade_ajustada' || campo === 'valor_unitario_ajustado' || campo === 'desconto_item') {
          const qtd = parseNumero(campo === 'quantidade_ajustada' ? valor : updated.quantidade_ajustada);
          const vlrUnit = parseNumero(campo === 'valor_unitario_ajustado' ? valor : updated.valor_unitario_ajustado);
          const desc = parseNumero(campo === 'desconto_item' ? valor : updated.desconto_item);
          updated.valor_total_ajustado = qtd * vlrUnit - desc;
        }
        
        return updated;
      }
      return item;
    }));
  };

  const handleCadastrarFornecedor = () => {
    if (!novoFornecedor.nome) {
      toast.error('Nome é obrigatório!');
      return;
    }
    
    if (novoFornecedor.tipo_pessoa === 'Jurídica' && !novoFornecedor.cnpj) {
      toast.error('CNPJ é obrigatório para pessoa jurídica!');
      return;
    }
    
    if (novoFornecedor.tipo_pessoa === 'Física' && !novoFornecedor.cpf) {
      toast.error('CPF é obrigatório para pessoa física!');
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
      preco_custo: parseNumero(itemEditando?.valor_unitario_ajustado) || 0 // Use adjusted value
    });
  };

  const handleCadastrarProdutosEmMassa = async () => {
    const itensPendentes = itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index));
    
    if (itensPendentes.length === 0) {
      toast.error('Nenhum produto pendente selecionado para cadastro em massa!');
      return;
    }

    setShowCadastroEmMassa(true);
    let cadastrados = 0;
    queryClient.invalidateQueries({ queryKey: ['produtos'] }); // Invalidate products query before starting to fetch latest

    for (const item of itensPendentes) {
      try {
        const allProdutos = await base44.entities.Produto.list();
        const maxNum = allProdutos.reduce((max, p) => Math.max(max, parseInt(p.numero_produto) || 0), 0);
        
        const newProduto = await base44.entities.Produto.create({
          empresa_id: empresaSelecionadaId,
          numero_produto: String(maxNum + 1),
          nome_produto: item.descricao.toUpperCase(),
          codigo_interno: item.codigo?.toUpperCase(),
          unidade_medida: item.unidade?.toUpperCase() || 'UN',
          preco_custo: parseNumero(item.valor_unitario_ajustado), // Use adjusted value
          estoque_atual: 0
        });

        setItensNFe(prevItens => prevItens.map(i => {
          if (i.index === item.index) {
            return { ...i, produto_id: newProduto.id, produto_nome: newProduto.nome_produto, status: 'associado' };
          }
          return i;
        }));
        cadastrados++;
        
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to avoid overwhelming
      } catch (error) {
        console.error('Erro ao cadastrar produto:', error);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['produtos'] });
    setShowCadastroEmMassa(false);
    toast.success(`✅ ${cadastrados} produto(s) cadastrado(s) em massa!`);
  };

  const handleTrocarProduto = (produto) => {
    const itensAtualizados = itensNFe.map(item => {
      if (item.index === itemEditando?.index) {
        return { ...item, produto_id: produto.id, produto_nome: produto.nome_produto, status: 'associado' };
      }
      return item;
    });
    
    setItensNFe(itensAtualizados);
    setShowTrocarProduto(false);
    setItemEditando(null);
    setBuscaProduto("");
    toast.success('Produto associado!');
  };

  const handleRemoverItem = (index) => {
    if (window.confirm('Deseja remover este item da importação?')) {
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
    if (itensSelecionados.length === itensNFe.length) {
      setItensSelecionados([]);
    } else {
      setItensSelecionados(itensNFe.map(i => i.index));
    }
  };

  const handleConfirmarImportacao = async () => {
    const itensParaImportar = itensNFe.filter(i => itensSelecionados.includes(i.index));
    const itensPendentes = itensParaImportar.filter(i => i.status === 'pendente');
    
    if (itensParaImportar.length === 0) {
      toast.error('❌ Nenhum item selecionado para importação!');
      return;
    }

    if (itensPendentes.length > 0) {
      toast.error(`❌ ${itensPendentes.length} produto(s) sem associação! Cadastre ou associe todos os itens selecionados.`);
      return;
    }

    if (!dadosComplementares.local_estoque) {
      toast.error('Selecione o local de estoque!');
      return;
    }

    setShowProgressoImportacao(true);
    setProgressoImportacao({ current: 0, total: itensParaImportar.length });

    try {
      const movimentacoes = [];

      for (let i = 0; i < itensParaImportar.length; i++) {
        const item = itensParaImportar[i];
        const qtd = parseNumero(item.quantidade_ajustada);
        const vlrUnit = parseNumero(item.valor_unitario_ajustado);

        movimentacoes.push({
          tipo: 'Entrada',
          tipo_detalhado: 'Compra',
          produto_id: item.produto_id,
          quantidade: qtd,
          valor_unitario: vlrUnit,
          cfop: item.cfop_ajustado,
          numero_nfe: dadosNFe.numero,
          serie_nfe: dadosNFe.serie,
          chave_nfe: dadosNFe.chave
        });

        setProgressoImportacao({ current: i + 1, total: itensParaImportar.length });
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      await onSuccess({
        fornecedor_id: fornecedorSelecionado.id,
        dadosNFe,
        itens: movimentacoes,
        dadosComplementares,
        xmlFile
      });

      toast.success(`✅ NF-e importada! ${itensParaImportar.length} produto(s) lançado(s).`);
      
      setTimeout(() => {
        setShowProgressoImportacao(false);
        onClose();
        resetar();
      }, 1000);
    } catch (error) {
      toast.error('Erro ao confirmar importação');
      console.error(error);
      setShowProgressoImportacao(false);
    }
  };

  const resetar = () => {
    setEtapa(1);
    setXmlFile(null);
    setDadosNFe(null);
    setFornecedorSelecionado(null);
    setItensNFe([]);
    setItensSelecionados([]);
    setEditandoItemIndex(null); // Reset editing index
    setDadosComplementares({ local_estoque: "", centro_custo_id: "", frete: "0,00", tipo_frete: "CIF", desconto_total: "0,00", outras_despesas: "0,00", observacoes: "" });
  };

  // Calcular subtotal apenas dos itens selecionados
  const itensSelecionadosData = itensNFe.filter(i => itensSelecionados.includes(i.index));
  const subtotalItens = itensSelecionadosData.reduce((sum, item) => {
    const qtd = parseNumero(item.quantidade_ajustada);
    const vlrUnit = parseNumero(item.valor_unitario_ajustado);
    const desc = parseNumero(item.desconto_item || "0,00");
    return sum + (qtd * vlrUnit - desc);
  }, 0);

  const totalAjustado = subtotalItens + parseNumero(dadosComplementares.frete) + parseNumero(dadosComplementares.outras_despesas) - parseNumero(dadosComplementares.desconto_total);
  const progressPercentage = progressoImportacao.total > 0 ? Math.round((progressoImportacao.current / progressoImportacao.total) * 100) : 0;
  const produtosFiltrados = produtos.filter(p => 
    !buscaProduto || 
    p.nome_produto?.toLowerCase().includes(buscaProduto.toLowerCase()) ||
    p.codigo_interno?.toLowerCase().includes(buscaProduto.toLowerCase())
  );

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { onClose(); resetar(); setErroExtracao(null); } }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-green-600" />
              Importar NF-e (XML) - Etapa {etapa} de 4
            </DialogTitle>
          </DialogHeader>

          {etapa === 1 && (
            <div className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Selecione o arquivo XML da Nota Fiscal Eletrônica (modelo 55) para importação automática.
                </AlertDescription>
              </Alert>

              {erroExtracao && (
                <Alert className="bg-red-50 border-red-300">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription>
                    <div className="space-y-2">
                      <p className="font-semibold text-red-800">❌ {erroExtracao.mensagem}</p>
                      <p className="text-sm text-red-700">{erroExtracao.detalhes}</p>
                      {erroExtracao.xmlUrl && (
                        <div className="flex gap-2 mt-3">
                          <Button size="sm" variant="outline" onClick={() => window.open(erroExtracao.xmlUrl, '_blank')} className="text-xs">
                            Ver XML Original
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setErroExtracao(null)} className="text-xs">
                            Tentar Outro Arquivo
                          </Button>
                        </div>
                      )}
                      <p className="text-xs text-red-600 mt-2">💡 Dica: Faça o lançamento manual se o XML não for compatível</p>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
                <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <p className="text-sm text-slate-600 mb-4">Selecione o arquivo XML da NF-e</p>
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
                    Processando XML...
                  </div>
                )}
              </div>
            </div>
          )}

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
                  <div><strong>Valor NF-e:</strong> R$ {formatarNumero(dadosNFe.valor_total)}</div>
                </CardContent>
              </Card>

              <div className="space-y-3">
                <h3 className="font-semibold">Fornecedor</h3>
                {fornecedorSelecionado ? (
                  <Alert className="bg-green-50 border-green-300">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertDescription>
                      <strong>{fornecedorSelecionado.nome}</strong> - {fornecedorSelecionado.cnpj || fornecedorSelecionado.cpf}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert className="bg-orange-50 border-orange-300">
                    <AlertCircle className="h-4 w-4 text-orange-600" />
                    <AlertDescription>
                      Fornecedor não encontrado: <strong>{dadosNFe.razao_social_emitente}</strong>
                      <Button size="sm" className="ml-4" onClick={() => setShowNovoFornecedor(true)}>
                        <Plus className="w-3 h-3 mr-1" />
                        Cadastrar
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                {fornecedorSelecionado && (
                  <div className="flex justify-end gap-3">
                    <Button variant="outline" onClick={() => setEtapa(1)}>Voltar</Button>
                    <Button onClick={() => setEtapa(3)} className="bg-green-600">Avançar</Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {etapa === 3 && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold">Produtos da NF-e ({itensNFe.length})</h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={handleSelecionarTodos}>
                    <CheckSquare className="w-3 h-3 mr-1" />
                    {itensSelecionados.length === itensNFe.length && itensNFe.length > 0 ? 'Desmarcar Todos' : 'Selecionar Todos'}
                  </Button>
                  {itensSelecionados.length > 0 && itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index)).length > 0 && (
                    <Button size="sm" onClick={handleCadastrarProdutosEmMassa} className="bg-blue-600">
                      <Plus className="w-3 h-3 mr-1" />
                      Cadastrar Selecionados ({itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index)).length})
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
                      <TableHead className="w-12">Status</TableHead>
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
                              <CheckCircle className="w-4 h-4 text-green-600" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-orange-600" />
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div>
                              <div className="font-semibold">{item.produto_nome || <span className="text-orange-600">Não associado</span>}</div>
                              <div className="text-slate-500 text-xs">{item.descricao}</div>
                              <div className="text-slate-400 text-xs font-mono">Cód: {item.codigo}</div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditando ? (
                              <Input
                                value={item.quantidade_ajustada}
                                onChange={(e) => handleAtualizarItem(item.index, 'quantidade_ajustada', e.target.value)}
                                className="w-24 text-right"
                                placeholder="0,00"
                              />
                            ) : (
                              <span className="font-mono">{item.quantidade_ajustada}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditando ? (
                              <Input
                                value={item.valor_unitario_ajustado}
                                onChange={(e) => handleAtualizarItem(item.index, 'valor_unitario_ajustado', e.target.value)}
                                className="w-28 text-right"
                                placeholder="0,00"
                              />
                            ) : (
                              <span className="font-mono">R$ {item.valor_unitario_ajustado}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditando ? (
                              <Input
                                value={item.desconto_item || "0,00"}
                                onChange={(e) => handleAtualizarItem(item.index, 'desconto_item', e.target.value)}
                                className="w-24 text-right"
                                placeholder="0,00"
                              />
                            ) : (
                              <span className="font-mono text-red-600">
                                {parseNumero(item.desconto_item) > 0 ? `R$ ${item.desconto_item}` : '-'}
                              </span>
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
                              {item.status === 'pendente' && (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => { setItemEditando(item); setNovoProduto({ nome: item.descricao, codigo: item.codigo, codigo_barras: "", ncm: item.ncm, unidade: item.unidade || "UN", categoria: "", descricao: "" }); setShowNovoProduto(true); }}>
                                    <Plus className="w-3 h-3" />
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => { setItemEditando(item); setShowTrocarProduto(true); }}>
                                    <RefreshCw className="w-3 h-3" />
                                  </Button>
                                </>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => handleRemoverItem(item.index)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
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

              <Card className="bg-blue-50 border-blue-300">
                <CardContent className="p-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Itens Selecionados:</span>
                      <span className="font-semibold">{itensSelecionados.length} de {itensNFe.length}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-blue-700">
                      <span>Subtotal Produtos:</span>
                      <span>R$ {formatarNumero(subtotalItens)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between gap-3">
                <Button variant="outline" onClick={() => setEtapa(2)}>Voltar</Button>
                <Button 
                  onClick={() => setEtapa(4)} 
                  className="bg-green-600" 
                  disabled={
                    itensSelecionados.length === 0 || 
                    itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index)).length > 0
                  }
                >
                  Avançar ({itensSelecionados.length} item{itensSelecionados.length !== 1 ? 's' : ''})
                </Button>
              </div>
            </div>
          )}

          {etapa === 4 && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
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

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Frete</Label>
                  <Input value={dadosComplementares.frete} onChange={(e) => setDadosComplementares({ ...dadosComplementares, frete: e.target.value })} placeholder="0,00" />
                </div>
                <div className="space-y-2">
                  <Label>Desconto Geral</Label>
                  <Input value={dadosComplementares.desconto_total} onChange={(e) => setDadosComplementares({ ...dadosComplementares, desconto_total: e.target.value })} placeholder="0,00" />
                </div>
                <div className="space-y-2">
                  <Label>Outras Despesas</Label>
                  <Input value={dadosComplementares.outras_despesas} onChange={(e) => setDadosComplementares({ ...dadosComplementares, outras_despesas: e.target.value })} placeholder="0,00" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea 
                  value={dadosComplementares.observacoes} 
                  onChange={(e) => setDadosComplementares({ ...dadosComplementares, observacoes: e.target.value })} 
                  placeholder="OBSERVAÇÕES SOBRE A IMPORTAÇÃO..."
                  className="uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              <Card className="bg-green-50 border-green-300">
                <CardContent className="p-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Subtotal Produtos:</span>
                      <span className="font-mono">R$ {formatarNumero(subtotalItens)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>+ Frete:</span>
                      <span className="font-mono">R$ {dadosComplementares.frete}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>+ Outras Despesas:</span>
                      <span className="font-mono">R$ {dadosComplementares.outras_despesas}</span>
                    </div>
                    <div className="flex justify-between text-sm text-red-600">
                      <span>- Desconto:</span>
                      <span className="font-mono">R$ {dadosComplementares.desconto_total}</span>
                    </div>
                    <div className="border-t-2 border-green-400 pt-2 flex justify-between text-lg font-bold text-green-700">
                      <span>TOTAL FINAL:</span>
                      <span>R$ {formatarNumero(totalAjustado)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between gap-3">
                <Button variant="outline" onClick={() => setEtapa(3)}>Voltar</Button>
                <Button onClick={handleConfirmarImportacao} className="bg-green-600 gap-2" disabled={processando}>
                  <CheckCircle className="w-4 h-4" />
                  Confirmar e Lançar ({itensSelecionados.length} item{itensSelecionados.length !== 1 ? 's' : ''})
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showNovoFornecedor} onOpenChange={setShowNovoFornecedor}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cadastrar Novo Fornecedor</DialogTitle>
            <DialogDescription>Preencha os dados do fornecedor para continuar a importação</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de Pessoa *</Label>
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
              <Label>{novoFornecedor.tipo_pessoa === 'Jurídica' ? 'Razão Social' : 'Nome Completo'} *</Label>
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
                <Input value={novoFornecedor.telefone} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, telefone: e.target.value })} placeholder="(00) 00000-0000" />
              </div>
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input type="email" value={novoFornecedor.email} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, email: e.target.value })} placeholder="email@exemplo.com" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Endereço</Label>
              <Input value={novoFornecedor.endereco} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, endereco: e.target.value })} placeholder="RUA, NÚMERO, BAIRRO" className="uppercase" style={{ textTransform: 'uppercase' }} />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Input value={novoFornecedor.cidade} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cidade: e.target.value })} placeholder="CIDADE" className="uppercase" style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="space-y-2">
                <Label>Estado</Label>
                <Select value={novoFornecedor.estado} onValueChange={(v) => setNovoFornecedor({ ...novoFornecedor, estado: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="UF" />
                  </SelectTrigger>
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

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => setShowNovoFornecedor(false)}>Cancelar</Button>
              <Button onClick={handleCadastrarFornecedor} className="bg-green-600" disabled={createFornecedorMutation.isPending}>
                {createFornecedorMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Salvar e Continuar
                  </>
                )}
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
              <Label>Nome do Produto *</Label>
              <Input value={novoProduto.nome} onChange={(e) => setNovoProduto({ ...novoProduto, nome: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Código Interno</Label>
                <Input value={novoProduto.codigo} onChange={(e) => setNovoProduto({ ...novoProduto, codigo: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="space-y-2">
                <Label>Código de Barras</Label>
                <Input value={novoProduto.codigo_barras} onChange={(e) => setNovoProduto({ ...novoProduto, codigo_barras: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>NCM</Label>
                <Input value={novoProduto.ncm} onChange={(e) => setNovoProduto({ ...novoProduto, ncm: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Unidade de Medida *</Label>
                <Select value={novoProduto.unidade} onValueChange={(v) => setNovoProduto({ ...novoProduto, unidade: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIDADES_MEDIDA.map(un => <SelectItem key={un} value={un}>{un}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={novoProduto.categoria} onValueChange={(v) => setNovoProduto({ ...novoProduto, categoria: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {categorias.map(c => <SelectItem key={c.id} value={c.nome}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea value={novoProduto.descricao} onChange={(e) => setNovoProduto({ ...novoProduto, descricao: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => setShowNovoProduto(false)}>Cancelar</Button>
              <Button onClick={handleCadastrarProduto} className="bg-green-600" disabled={createProdutoMutation.isPending}>
                {createProdutoMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Salvar e Associar
                  </>
                )}
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
            <Input
              placeholder="Buscar por nome ou código..."
              value={buscaProduto}
              onChange={(e) => setBuscaProduto(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-white">
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtosFiltrados.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                      Nenhum produto encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  produtosFiltrados.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.codigo_interno || '-'}</TableCell>
                      <TableCell className="text-sm">{p.nome_produto}</TableCell>
                      <TableCell className="text-xs">{p.categoria || '-'}</TableCell>
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

      <Dialog open={showCadastroEmMassa} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              Cadastrando Produtos
            </DialogTitle>
            <DialogDescription>
              Aguarde enquanto os produtos selecionados são cadastrados...
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <Dialog open={showProgressoImportacao} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-green-600" />
              Importando NF-e
            </DialogTitle>
            <DialogDescription>
              Lançando produtos no estoque...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progresso</span>
                <span className="font-semibold">{progressoImportacao.current} de {progressoImportacao.total}</span>
              </div>
              <Progress value={progressPercentage} className="h-3" />
              <p className="text-center text-sm font-medium text-green-600">{progressPercentage}%</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
