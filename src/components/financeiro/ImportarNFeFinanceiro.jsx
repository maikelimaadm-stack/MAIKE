
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Upload, Loader2, AlertCircle, Plus, CheckCircle, RefreshCw, Search, Trash2, CheckSquare, Edit2, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const ESTADOS_BRASIL = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  const valorNum = typeof valor === 'number' ? valor : parseFloat(String(valor).replace(',', '.')) || 0;
  return valorNum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const extrairDadosXML = (xmlText) => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");

  const getValor = (tag) => {
    const element = xmlDoc.getElementsByTagName(tag)[0];
    return element ? element.textContent : null;
  };

  const modelo = getValor('mod');
  if (modelo !== '55') {
    throw new Error('Não é NF-e modelo 55');
  }

  const numero = getValor('nNF');
  const serie = getValor('serie');
  const chave = getValor('chNFe') || xmlDoc.getElementsByTagName('infNFe')[0]?.getAttribute('Id')?.replace('NFe', '');
  const dataEmissao = getValor('dhEmi')?.split('T')[0] || getValor('dEmi');
  const cfop = getValor('CFOP');

  // VALORES TOTAIS DA NOTA
  const vProd = parseFloat(getValor('vProd')) || 0;
  const vFrete = parseFloat(getValor('vFrete')) || 0;
  const vSeg = parseFloat(getValor('vSeg')) || 0;
  const vOutro = parseFloat(getValor('vOutro')) || 0;
  const vDesc = parseFloat(getValor('vDesc')) || 0;
  const vIPI = parseFloat(getValor('vIPI')) || 0;
  const vICMS = parseFloat(getValor('vICMS')) || 0;
  const vPIS = parseFloat(getValor('vPIS')) || 0;
  const vCOFINS = parseFloat(getValor('vCOFINS')) || 0;
  const vBC = parseFloat(getValor('vBC')) || 0;
  const valorTotal = parseFloat(getValor('vNF')) || 0;

  const cnpjEmit = getValor('CNPJ');
  const cpfEmit = getValor('CPF');
  const razaoSocial = getValor('xNome') || getValor('xFant');
  const inscEstadual = getValor('IE');
  const telefone = getValor('fone');
  const email = getValor('email');
  const logradouro = getValor('xLgr');
  const numero_end = getValor('nro');
  const bairro = getValor('xBairro');
  const cidade = getValor('xMun');
  const estado = getValor('UF');
  const cep = getValor('CEP');

  const enderecoCompleto = numero_end ? `${logradouro}, ${numero_end}` : logradouro;

  // OBSERVAÇÕES COMPLETAS (SEM FILTRAR)
  const infAdic = xmlDoc.getElementsByTagName('infAdic')[0];
  let observacoes = '';
  
  if (infAdic) {
    const infCpl = infAdic.getElementsByTagName('infCpl')[0];
    if (infCpl) {
      observacoes = infCpl.textContent || '';
    }
  }

  // EXTRAIR FORMA DE PAGAMENTO
  let tPag = getValor('tPag');
  
  if (!tPag) {
    const pagElement = xmlDoc.getElementsByTagName('pag')[0];
    if (pagElement) {
      const detPagElement = pagElement.getElementsByTagName('detPag')[0];
      if (detPagElement) {
        tPag = detPagElement.getElementsByTagName('tPag')[0]?.textContent;
      }
    }
  }
  
  let formaPagamento = null;
  if (tPag) {
    const formasPag = {
      '01': 'Dinheiro',
      '02': 'Cheque',
      '03': 'Cartão de Crédito',
      '04': 'Cartão de Débito',
      '05': 'Crédito Loja',
      '10': 'Vale Alimentação',
      '11': 'Vale Refeição',
      '12': 'Vale Presente',
      '13': 'Vale Combustível',
      '15': 'Boleto Bancário',
      '17': 'PIX',
      '18': 'Transferência Bancária',
      '19': 'Depósito Bancária',
      '90': 'Sem Pagamento',
      '99': 'Outros'
    };
    formaPagamento = formasPag[tPag] || 'Outros';
  }

  // EXTRAIR PARCELAMENTO
  const parcelas = [];
  const dups = xmlDoc.getElementsByTagName('dup');
  
  for (let i = 0; i < dups.length; i++) {
    const dup = dups[i];
    const dVenc = dup.getElementsByTagName('dVenc')[0]?.textContent;
    const vDup = parseFloat(dup.getElementsByTagName('vDup')[0]?.textContent || 0);
    
    if (dVenc && vDup > 0) {
      parcelas.push({
        data: dVenc,
        valor: vDup
      });
    }
  }
  
  // Sort parcelas by date (keeping this as it's a good practice, even if not explicitly in the outline diff)
  parcelas.sort((a, b) => new Date(a.data) - new Date(b.data));

  // VERIFICAR SE ESTÁ PAGO
  let contaPaga = false;
  if (parcelas.length === 0 && tPag && tPag !== '15' && tPag !== '90' && tPag !== '99') {
    contaPaga = true;
  }

  const itensNFe = [];
  const dets = xmlDoc.getElementsByTagName('det');
  
  for (let i = 0; i < dets.length; i++) {
    const det = dets[i];
    const getTagDet = (tag) => {
      const el = det.getElementsByTagName(tag)[0];
      return el ? el.textContent : null;
    };

    const vDescItem = parseFloat(getTagDet('vDesc')) || 0;

    itensNFe.push({
      codigo: getTagDet('cProd') || '',
      descricao: getTagDet('xProd') || '',
      ncm: getTagDet('NCM') || '',
      cfop: getTagDet('CFOP') || cfop || '',
      unidade: getTagDet('uCom') || 'UN',
      quantidade: parseFloat(getTagDet('qCom')) || 0,
      valor_unitario: parseFloat(getTagDet('vUnCom')) || 0,
      valor_total: parseFloat(getTagDet('vProd')) || 0, // This is vProd for the item
      desconto_item: vDescItem
    });
  }

  if (itensNFe.length === 0) {
    throw new Error('NF-e sem produtos');
  }

  return {
    modelo,
    numero,
    serie,
    chave,
    data_emissao: dataEmissao,
    cnpj_emitente: cnpjEmit,
    cpf_emitente: cpfEmit,
    razao_social_emitente: razaoSocial,
    inscricao_estadual_emitente: inscEstadual,
    telefone_emitente: telefone,
    email_emitente: email,
    endereco_emitente: enderecoCompleto,
    bairro_emitente: bairro,
    cidade_emitente: cidade,
    estado_emitente: estado,
    cep_emitente: cep,
    cfop,
    valor_produtos: vProd,
    valor_frete: vFrete,
    valor_seguro: vSeg,
    valor_outras_despesas: vOutro,
    valor_desconto_total: vDesc,
    valor_ipi: vIPI,
    valor_icms: vICMS,
    valor_pis: vPIS,
    valor_cofins: vCOFINS,
    base_calculo_icms: vBC,
    valor_total: valorTotal,
    forma_pagamento: formaPagamento,
    observacoes_nfe: observacoes,
    parcelas: parcelas,
    conta_paga: contaPaga,
    itens: itensNFe
  };
};

export default function ImportarNFeFinanceiro({ open, onClose, onSuccess, fornecedores, produtos }) {
  const [etapa, setEtapa] = useState(1);
  const [processando, setProcessando] = useState(false);
  const [dadosNFe, setDadosNFe] = useState(null);
  const [fornecedorSelecionado, setFornecedorSelecionado] = useState(null);
  const [itensNFe, setItensNFe] = useState([]);
  const [itensSelecionados, setItensSelecionados] = useState([]);
  const [itemEditando, setItemEditando] = useState(null);
  const [localEstoque, setLocalEstoque] = useState("");
  
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
  
  const [showNovoFornecedor, setShowNovoFornecedor] = useState(false);
  const [showBuscaProduto, setShowBuscaProduto] = useState(false);
  const [showNovoProduto, setShowNovoProduto] = useState(false);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [showCadastroEmMassa, setShowCadastroEmMassa] = useState(false);
  
  const [novoProduto, setNovoProduto] = useState({
    nome_produto: "",
    codigo_interno: "",
    codigo_barras: "",
    unidade_medida: "UN",
    categoria: "",
    descricao: "",
    preco_custo: ""
  });

  const [showNovaUnidade, setShowNovaUnidade] = useState(false);
  const [novaUnidade, setNovaUnidade] = useState({ sigla: "", nome: "" });
  
  const [showNovaCategoria, setShowNovaCategoria] = useState(false);
  const [novaCategoria, setNovaCategoria] = useState({ nome: "", descricao: "" });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: unidadesMedida = [] } = useQuery({
    queryKey: ['unidades_medida'],
    queryFn: () => base44.entities.UnidadeMedida.list(),
    initialData: [],
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias_produtos'],
    queryFn: () => base44.entities.Categoria.list(),
    initialData: [],
  });

  const { data: locaisEstoque = [] } = useQuery({
    queryKey: ['locais_estoque'],
    queryFn: () => base44.entities.LocalEstoque.list(),
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
      toast.success('✅ Fornecedor cadastrado!');
      setEtapa(3);
    },
  });

  const createUnidadeMutation = useMutation({
    mutationFn: async (data) => {
      const all = await base44.entities.UnidadeMedida.list();
      const maxNum = all.reduce((max, u) => Math.max(max, parseInt(u.numero) || 0), 0);
      return base44.entities.UnidadeMedida.create({
        ...data,
        numero: String(maxNum + 1)
      });
    },
    onSuccess: (newUnidade) => {
      queryClient.invalidateQueries({ queryKey: ['unidades_medida'] });
      setNovoProduto(prev => ({ ...prev, unidade_medida: newUnidade.sigla }));
      setShowNovaUnidade(false);
      setNovaUnidade({ sigla: "", nome: "" });
      toast.success('✅ Unidade cadastrada!');
    },
  });

  const createCategoriaMutation = useMutation({
    mutationFn: async (data) => {
      const all = await base44.entities.Categoria.list();
      const maxNum = all.reduce((max, c) => Math.max(max, parseInt(c.numero_categoria) || 0), 0);
      return base44.entities.Categoria.create({
        ...data,
        numero_categoria: String(maxNum + 1)
      });
    },
    onSuccess: (newCategoria) => {
      queryClient.invalidateQueries({ queryKey: ['categorias_produtos'] });
      setNovoProduto(prev => ({ ...prev, categoria: newCategoria.nome }));
      setShowNovaCategoria(false);
      setNovaCategoria({ nome: "", descricao: "" });
      toast.success('✅ Categoria cadastrada!');
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
      if (itemEditando) {
        setItensNFe(prev => prev.map(item => 
          item.index === itemEditando.index 
            ? { ...item, produto_id: newProduto.id, produto_nome: newProduto.nome_produto, status: 'associado' }
            : item
        ));
        setItemEditando(null);
      }
      setShowNovoProduto(false);
      setNovoProduto({ nome_produto: "", codigo_interno: "", codigo_barras: "", unidade_medida: "UN", categoria: "", descricao: "", preco_custo: "" });
      toast.success('✅ Produto cadastrado!');
    },
  });

  const handleUploadXML = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setProcessando(true);
    
    try {
      toast.info('📄 Lendo XML...');
      
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const response = await fetch(file_url);
      const xmlText = await response.text();

      const resultado = extrairDadosXML(xmlText);
      
      toast.success(`✅ ${resultado.itens.length} produto(s) encontrado(s)`);
      
      setDadosNFe(resultado);
      
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
      toast.error(`❌ ${error.message || 'Erro ao processar XML'}`);
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
          valor_total: item.valor_total, // This is vProd for the item
          desconto_item: item.desconto_item || 0,
          produto_id: prod?.id,
          produto_nome: prod?.nome_produto,
          status: prod ? 'associado' : 'pendente'
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
    if (!novoProduto.nome_produto) {
      toast.error('❌ Nome do produto obrigatório!');
      return;
    }
    const precoCustoParsed = novoProduto.preco_custo ? parseFloat(String(novoProduto.preco_custo).replace(',', '.')) : 0;
    if (isNaN(precoCustoParsed)) {
      toast.error('❌ Preço de custo inválido!');
      return;
    }

    createProdutoMutation.mutate({
      nome_produto: novoProduto.nome_produto.toUpperCase(),
      codigo_interno: novoProduto.codigo_interno?.toUpperCase(),
      codigo_barras: novoProduto.codigo_barras,
      unidade_medida: novoProduto.unidade_medida.toUpperCase(),
      categoria: novoProduto.categoria?.toUpperCase(),
      descricao: novoProduto.descricao?.toUpperCase(),
      preco_custo: precoCustoParsed
    });
  };

  const handleAbrirCadastroProduto = (item) => {
    const unidadeCadastrada = unidadesMedida.find(u => u.sigla === item.unidade);
    const precoCusto = item.quantidade > 0 ? (item.valor_total / item.quantidade) : 0;
    
    setNovoProduto({
      nome_produto: item.descricao || "",
      codigo_interno: item.codigo || "",
      codigo_barras: "",
      unidade_medida: unidadeCadastrada ? unidadeCadastrada.sigla : (item.unidade || "UN"),
      categoria: "",
      descricao: "",
      preco_custo: precoCusto.toFixed(2).replace('.', ',')
    });
    
    setItemEditando(item); // Set itemEditando for onSuccess to work
    setShowNovoProduto(true);
  };

  const handleCadastrarUnidade = () => {
    if (!novaUnidade.sigla) {
      toast.error('❌ Sigla obrigatória!');
      return;
    }
    if (!novaUnidade.nome) {
      toast.error('❌ Nome obrigatório!');
      return;
    }

    createUnidadeMutation.mutate({
      sigla: novaUnidade.sigla.toUpperCase(),
      nome: novaUnidade.nome.toUpperCase()
    });
  };

  const handleCadastrarCategoria = () => {
    if (!novaCategoria.nome) {
      toast.error('❌ Nome obrigatório!');
      return;
    }

    createCategoriaMutation.mutate({
      nome: novaCategoria.nome.toUpperCase(),
      descricao: novaCategoria.descricao?.toUpperCase()
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

        const precoCusto = item.quantidade > 0 ? (item.valor_total / item.quantidade) : 0;

        const newProduto = await base44.entities.Produto.create({
          empresa_id: empresaSelecionadaId,
          numero_produto: String(maxNum + 1),
          nome_produto: item.descricao.toUpperCase(),
          codigo_interno: item.codigo?.toUpperCase(),
          codigo_barras: '', // XML doesn't provide this directly
          unidade_medida: unidadeFinal.toUpperCase(),
          categoria: '', // XML doesn't provide this directly
          descricao: '', // Full description not usually in XML items
          preco_custo: precoCusto,
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

  const handleTrocarProduto = (produto) => {
    setItensNFe(prev => prev.map(item => 
      item.index === itemEditando?.index 
        ? { ...item, produto_id: produto.id, produto_nome: produto.nome_produto, status: 'associado' }
        : item
    ));
    
    setShowBuscaProduto(false);
    setItemEditando(null);
    setBuscaProduto("");
    toast.success('✅ Produto associado!');
  };

  const handleEditarItem = (item) => {
    setItemEditando({ ...item });
  };

  const handleSalvarEdicao = () => {
    if (itemEditando.quantidade <= 0) {
      toast.error('❌ Quantidade deve ser maior que zero!');
      return;
    }
    if (itemEditando.valor_total <= 0) {
      toast.error('❌ Valor total deve ser maior que zero!');
      return;
    }
    
    setItensNFe(prev => prev.map(item => 
      item.index === itemEditando.index ? itemEditando : item
    ));
    setItemEditando(null);
    toast.success('✅ Item atualizado!');
  };

  const handleCancelarEdicao = () => {
    setItemEditando(null);
  };

  const handleToggleSelecao = (index) => {
    setItensSelecionados(prev => 
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const handleRemoverItem = (index) => {
    if (window.confirm('❌ Deseja remover este item do lançamento?')) {
      setItensNFe(prev => prev.filter(i => i.index !== index));
      setItensSelecionados(prev => prev.filter(i => i !== index));
      toast.success('✅ Item removido!');
    }
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

    if (pendentes.length > 0) {
      toast.error(`❌ ${pendentes.length} produto(s) sem associação!`);
      return;
    }

    if (!localEstoque) {
      toast.error('❌ Selecione o local de estoque!');
      return;
    }

    const temParcelas = dadosNFe.parcelas && dadosNFe.parcelas.length > 0;

    const totalProdutos = itensParaImportar.reduce((sum, i) => {
      const total = i.valor_total - (i.desconto_item || 0);
      return sum + total;
    }, 0);
    
    const frete = dadosNFe.valor_frete || 0;
    const outrasDespesas = dadosNFe.valor_outras_despesas || 0;

    onSuccess({
      fornecedor_id: fornecedorSelecionado.id,
      tipo_documento: "NF-e",
      numero_documento: dadosNFe.numero,
      serie_documento: dadosNFe.serie,
      chave_nfe: dadosNFe.chave,
      cfop: dadosNFe.cfop,
      data_emissao: dadosNFe.data_emissao,
      forma_pagamento_id: dadosNFe.forma_pagamento || '',
      observacoes_nfe: dadosNFe.observacoes_nfe || '',
      conta_paga: dadosNFe.conta_paga || false,
      parcelar: temParcelas,
      parcelas: temParcelas ? dadosNFe.parcelas.map(p => ({
        data: p.data,
        valor: String(p.valor.toFixed(2)).replace('.', ',')
      })) : [],
      valor_produtos: dadosNFe.valor_produtos,
      valor_frete: dadosNFe.valor_frete,
      valor_seguro: dadosNFe.valor_seguro,
      valor_outras_despesas: dadosNFe.valor_outras_despesas,
      valor_desconto_total: dadosNFe.valor_desconto_total,
      valor_ipi: dadosNFe.valor_ipi,
      valor_icms: dadosNFe.valor_icms,
      valor_pis: dadosNFe.valor_pis,
      valor_cofins: dadosNFe.valor_cofins,
      base_calculo_icms: dadosNFe.base_calculo_icms,
      frete: String(frete.toFixed(2)).replace('.', ','),
      outras_despesas: String(outrasDespesas.toFixed(2)).replace('.', ','),
      local_estoque: localEstoque,
      produtos_selecionados: itensParaImportar.map(i => ({
        produto_id: i.produto_id,
        produto_nome: i.produto_nome,
        quantidade: String(i.quantidade).replace('.', ','),
        valor_total: String(i.valor_total).replace('.', ','),
        desconto_item: String(i.desconto_item || 0).replace('.', ','),
        unidade: i.unidade
      })),
      lancar_produtos: true,
      dar_entrada_estoque: true
    });
    
    onClose();
    resetar();
  };

  const resetar = () => {
    setEtapa(1);
    setDadosNFe(null);
    setFornecedorSelecionado(null);
    setItensNFe([]);
    setItensSelecionados([]);
    setItemEditando(null);
    setLocalEstoque("");
    setNovoFornecedor({ tipo_pessoa: "Jurídica", nome: "", cnpj: "", cpf: "", inscricao_estadual: "", telefone: "", email: "", endereco: "", cidade: "", estado: "", cep: "" });
    setNovoProduto({ nome_produto: "", codigo_interno: "", codigo_barras: "", unidade_medida: "UN", categoria: "", descricao: "", preco_custo: "" });
    setShowNovoFornecedor(false);
    setShowBuscaProduto(false);
    setShowNovoProduto(false);
    setBuscaProduto("");
    setShowCadastroEmMassa(false);
    setShowNovaUnidade(false);
    setNovaUnidade({ sigla: "", nome: "" });
    setShowNovaCategoria(false);
    setNovaCategoria({ nome: "", descricao: "" });
  };

  const produtosFiltrados = produtos.filter(p => 
    !buscaProduto || 
    p.nome_produto?.toLowerCase().includes(buscaProduto.toLowerCase()) ||
    p.codigo_interno?.toLowerCase().includes(buscaProduto.toLowerCase())
  );

  const estadosOptions = ESTADOS_BRASIL.map(uf => ({ value: uf, label: uf }));
  const unidadesOptions = unidadesMedida.map(u => ({ value: u.sigla, label: `${u.sigla} - ${u.nome}` }));
  const categoriasOptions = categorias.map(c => ({ value: c.nome, label: c.nome }));

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !processando) { onClose(); resetar(); } }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-emerald-600" />
              Importar NF-e (XML) - Etapa {etapa} de 3
            </DialogTitle>
            <DialogDescription className="text-xs">
              Os dados serão importados para o formulário de lançamento
            </DialogDescription>
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
                <CardContent className="p-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div><strong>Número:</strong> {dadosNFe.numero}</div>
                  <div><strong>Série:</strong> {dadosNFe.serie}</div>
                  <div><strong>Data:</strong> {new Date(dadosNFe.data_emissao).toLocaleDateString('pt-BR')}</div>
                  <div><strong>Valor:</strong> {formatarMoeda(dadosNFe.valor_total)}</div>
                </CardContent>
              </Card>

              <div className="space-y-3">
                <h3 className="font-semibold text-xs">Cadastrar Fornecedor</h3>
                
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

                <div className="grid grid-cols-2 gap-3">
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

                <div className="grid grid-cols-2 gap-3">
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

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Cidade</Label>
                    <Input value={novoFornecedor.cidade} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cidade: e.target.value })} placeholder="CIDADE" className="uppercase h-8 text-xs" style={{ textTransform: 'uppercase' }} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Estado</Label>
                    <Combobox
                      options={estadosOptions}
                      value={novoFornecedor.estado}
                      onValueChange={(v) => setNovoFornecedor({ ...novoFornecedor, estado: v })}
                      placeholder="UF"
                      searchPlaceholder="Buscar estado..."
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">CEP</Label>
                    <Input value={novoFornecedor.cep} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cep: e.target.value })} placeholder="00000-000" className="h-8 text-xs" />
                  </div>
                </div>

                <div className="flex justify-between gap-2 pt-3 border-t">
                  <Button variant="outline" onClick={() => setEtapa(1)} size="sm" className="h-8 text-xs">Voltar</Button>
                  <Button onClick={handleCadastrarFornecedor} size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs" disabled={createFornecedorMutation.isPending}>
                    {createFornecedorMutation.isPending ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Salvando...</> : 'Cadastrar e Continuar'}
                  </Button>
                </div>
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
                    <Button size="sm" onClick={handleCadastrarProdutosEmMassa} className="bg-emerald-600 hover:bg-emerald-700 h-7 gap-1 text-xs" disabled={showCadastroEmMassa}>
                      {showCadastroEmMassa ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Plus className="w-3 h-3" />}
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
                      <TableHead className="text-right">Un.</TableHead>
                      <TableHead className="text-right">Vlr Total</TableHead>
                      <TableHead className="text-right">Desc.</TableHead>
                      <TableHead className="text-right">Líquido</TableHead>
                      <TableHead className="text-center w-32">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itensNFe.map((item) => {
                      const valorLiquido = item.valor_total - (item.desconto_item || 0);
                      const valorUnitario = item.quantidade > 0 ? (valorLiquido / item.quantidade) : 0;
                      const isEditing = itemEditando?.index === item.index;
                      
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
                            {isEditing ? (
                              <Input 
                                type="number" 
                                value={itemEditando.quantidade} 
                                onChange={(e) => setItemEditando({...itemEditando, quantidade: parseFloat(e.target.value) || 0})} 
                                className="h-7 w-20 text-xs text-right"
                                step="0.01"
                              />
                            ) : (
                              <span className="font-mono text-xs">{item.quantidade.toFixed(2).replace('.', ',')}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditing ? (
                              <Input 
                                value={itemEditando.unidade} 
                                onChange={(e) => setItemEditando({...itemEditando, unidade: e.target.value.toUpperCase()})} 
                                className="h-7 w-16 text-xs text-center uppercase"
                                maxLength={4}
                              />
                            ) : (
                              <span className="font-mono text-xs">{item.unidade}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditing ? (
                              <Input 
                                type="number" 
                                value={itemEditando.valor_total} 
                                onChange={(e) => setItemEditando({...itemEditando, valor_total: parseFloat(e.target.value) || 0})} 
                                className="h-7 w-24 text-xs text-right"
                                step="0.01"
                              />
                            ) : (
                              <span className="font-mono text-xs">{formatarMoeda(item.valor_total)}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditing ? (
                              <Input 
                                type="number" 
                                value={itemEditando.desconto_item || 0} 
                                onChange={(e) => setItemEditando({...itemEditando, desconto_item: parseFloat(e.target.value) || 0})} 
                                className="h-7 w-20 text-xs text-right"
                                step="0.01"
                              />
                            ) : (
                              <span className="font-mono text-xs text-red-600">{formatarMoeda(item.desconto_item || 0)}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="font-mono font-bold text-green-700 text-xs">
                              {formatarMoeda(valorLiquido)}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              Un: {formatarMoeda(valorUnitario)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1 justify-center flex-wrap">
                              {isEditing ? (
                                <>
                                  <Button size="sm" variant="ghost" onClick={handleSalvarEdicao} className="h-6 w-6 p-0 text-green-600" title="Salvar">
                                    <Save className="w-3 h-3" />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={handleCancelarEdicao} className="h-6 w-6 p-0 text-red-600" title="Cancelar">
                                    <X className="w-3 h-3" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    onClick={() => handleEditarItem(item)} 
                                    className="h-6 w-6 p-0 text-blue-600" 
                                    title="Editar valores"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </Button>
                                  
                                  {item.status === 'pendente' && (
                                    <Button 
                                      size="sm" 
                                      variant="ghost" 
                                      onClick={() => handleAbrirCadastroProduto(item)} 
                                      className="h-6 w-6 p-0 text-emerald-600" 
                                      title="Cadastrar este produto"
                                    >
                                      <Plus className="w-3 h-3" />
                                    </Button>
                                  )}
                                  
                                  <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    onClick={() => { setItemEditando(item); setShowBuscaProduto(true); }} 
                                    className="h-6 w-6 p-0 text-purple-600" 
                                    title="Trocar produto"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                  </Button>
                                  
                                  <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    onClick={() => handleRemoverItem(item.index)} 
                                    className="h-6 w-6 p-0 text-red-600" 
                                    title="Remover do lançamento"
                                  >
                                    <Trash2 className="w-3 h-3" />
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

              {/* RESUMO DOS VALORES */}
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-3">
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between font-semibold text-slate-700">
                      <span>💰 RESUMO FINANCEIRO DA NF-e</span>
                    </div>
                    <div className="border-t pt-1.5 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-600">Subtotal Produtos (bruto):</span>
                        <span className="font-mono">{formatarMoeda(itensNFe.filter(i => itensSelecionados.includes(i.index)).reduce((s, i) => s + i.valor_total, 0))}</span>
                      </div>
                      <div className="flex justify-between text-red-600">
                        <span>(-) Descontos nos Produtos:</span>
                        <span className="font-mono">{formatarMoeda(itensNFe.filter(i => itensSelecionados.includes(i.index)).reduce((s, i) => s + (i.desconto_item || 0), 0))}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-blue-700 border-t pt-1">
                        <span>= Subtotal Produtos (líquido):</span>
                        <span className="font-mono">{formatarMoeda(itensNFe.filter(i => itensSelecionados.includes(i.index)).reduce((s, i) => s + (i.valor_total - (i.desconto_item || 0)), 0))}</span>
                      </div>
                      <div className="flex justify-between text-amber-700">
                        <span>(+) Frete:</span>
                        <span className="font-mono">{formatarMoeda(dadosNFe.valor_frete || 0)}</span>
                      </div>
                      <div className="flex justify-between text-amber-700">
                        <span>(+) Outras Despesas:</span>
                        <span className="font-mono">{formatarMoeda(dadosNFe.valor_outras_despesas || 0)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-emerald-700 text-base border-t-2 border-emerald-300 pt-1.5 mt-1">
                        <span>= VALOR TOTAL A PAGAR:</span>
                        <span className="font-mono">{formatarMoeda(
                          itensNFe.filter(i => itensSelecionados.includes(i.index)).reduce((s, i) => s + (i.valor_total - (i.desconto_item || 0)), 0) +
                          (dadosNFe.valor_frete || 0) +
                          (dadosNFe.valor_outras_despesas || 0)
                        )}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* LOCAL DE ESTOQUE */}
              <Card className="bg-amber-50 border-amber-200">
                <CardHeader className="py-2 px-3">
                  <CardTitle className="text-sm">📦 Local de Destino do Estoque</CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Onde os produtos serão armazenados? *</Label>
                    <Select value={localEstoque} onValueChange={setLocalEstoque}>
                      <SelectTrigger className="h-9 text-xs bg-white">
                        <SelectValue placeholder="Selecione o local de estoque" />
                      </SelectTrigger>
                      <SelectContent>
                        {locaisEstoque.map(l => (
                          <SelectItem key={l.id} value={l.nome} className="text-xs">{l.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-amber-700">⚠️ Este campo é obrigatório para dar entrada no estoque</p>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between gap-2 pt-3 border-t">
                <Button variant="outline" onClick={() => setEtapa(fornecedorSelecionado ? 1 : 2)} size="sm" className="h-8 text-xs">Voltar</Button>
                <Button 
                  onClick={handleConfirmarImportacao} 
                  className="bg-emerald-600 hover:bg-emerald-700 h-8 gap-1 text-xs"
                  disabled={itensSelecionados.length === 0 || !localEstoque}
                >
                  <CheckCircle className="w-3 h-3" />
                  Importar para Formulário ({itensSelecionados.length})
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* DIALOG: BUSCAR PRODUTO */}
      <Dialog open={showBuscaProduto} onOpenChange={setShowBuscaProduto}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm flex justify-between items-center">
              <span>Associar Produto Existente</span>
              <Button onClick={() => { setShowBuscaProduto(false); setShowNovoProduto(true); }} size="sm" className="h-7 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
                <Plus className="w-3 h-3" />
                Novo Produto
              </Button>
            </DialogTitle>
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

      {/* DIALOG: NOVO PRODUTO - MELHORADO */}
      <Dialog open={showNovoProduto} onOpenChange={setShowNovoProduto}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">Cadastrar Novo Produto</DialogTitle>
            <DialogDescription className="text-xs">
              Preencha os dados do produto para associá-lo à NF-e
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Nome do Produto *</Label>
              <Input 
                value={novoProduto.nome_produto} 
                onChange={(e) => setNovoProduto({...novoProduto, nome_produto: e.target.value})} 
                placeholder="NOME DO PRODUTO" 
                className="h-9 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Código Interno</Label>
                <Input 
                  value={novoProduto.codigo_interno} 
                  onChange={(e) => setNovoProduto({...novoProduto, codigo_interno: e.target.value})} 
                  placeholder="CÓDIGO" 
                  className="h-9 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Código de Barras</Label>
                <Input 
                  value={novoProduto.codigo_barras} 
                  onChange={(e) => setNovoProduto({...novoProduto, codigo_barras: e.target.value})} 
                  placeholder="7891234567890" 
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Unidade de Medida *</Label>
                <div className="flex gap-1.5">
                  <Select 
                    value={novoProduto.unidade_medida} 
                    onValueChange={(v) => setNovoProduto({...novoProduto, unidade_medida: v})}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {unidadesMedida.map(u => (
                        <SelectItem key={u.id} value={u.sigla} className="text-xs">
                          {u.sigla} - {u.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="icon" 
                    onClick={() => setShowNovaUnidade(true)} 
                    className="h-9 w-9"
                    title="Cadastrar nova unidade"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Categoria</Label>
                <div className="flex gap-1.5">
                  <Select 
                    value={novoProduto.categoria} 
                    onValueChange={(v) => setNovoProduto({...novoProduto, categoria: v})}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {categorias.map(c => (
                        <SelectItem key={c.id} value={c.nome} className="text-xs">
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="icon" 
                    onClick={() => setShowNovaCategoria(true)} 
                    className="h-9 w-9"
                    title="Cadastrar nova categoria"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Descrição</Label>
              <Textarea 
                value={novoProduto.descricao} 
                onChange={(e) => setNovoProduto({...novoProduto, descricao: e.target.value})} 
                placeholder="DESCRIÇÃO DETALHADA DO PRODUTO..." 
                className="text-xs uppercase min-h-20"
                style={{ textTransform: 'uppercase' }}
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Preço de Custo</Label>
              <Input 
                type="text" 
                value={String(novoProduto.preco_custo).replace('.', ',')} 
                onChange={(e) => setNovoProduto({...novoProduto, preco_custo: e.target.value})} 
                placeholder="0,00" 
                className="h-9 text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button variant="outline" onClick={() => setShowNovoProduto(false)} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button 
                onClick={handleCadastrarProduto} 
                size="sm" 
                className="bg-emerald-600 hover:bg-emerald-700 h-8 gap-1 text-xs" 
                disabled={createProdutoMutation.isPending}
              >
                {createProdutoMutation.isPending ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />Salvando...</>
                ) : (
                  <><Save className="w-3 h-3" />Salvar e Associar</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG: NOVA UNIDADE */}
      <Dialog open={showNovaUnidade} onOpenChange={setShowNovaUnidade}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Cadastrar Nova Unidade de Medida</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Sigla *</Label>
              <Input 
                value={novaUnidade.sigla} 
                onChange={(e) => setNovaUnidade({...novaUnidade, sigla: e.target.value})} 
                placeholder="UN" 
                className="h-9 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                maxLength={10}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Nome *</Label>
              <Input 
                value={novaUnidade.nome} 
                onChange={(e) => setNovaUnidade({...novaUnidade, nome: e.target.value})} 
                placeholder="UNIDADE" 
                className="h-9 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button variant="outline" onClick={() => setShowNovaUnidade(false)} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button 
                onClick={handleCadastrarUnidade} 
                size="sm" 
                className="bg-emerald-600 hover:bg-emerald-700 h-8 gap-1 text-xs" 
                disabled={createUnidadeMutation.isPending}
              >
                {createUnidadeMutation.isPending ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />Salvando...</>
                ) : (
                  <><Save className="w-3 h-3" />Salvar</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG: NOVA CATEGORIA */}
      <Dialog open={showNovaCategoria} onOpenChange={setShowNovaCategoria}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Cadastrar Nova Categoria</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Nome *</Label>
              <Input 
                value={novaCategoria.nome} 
                onChange={(e) => setNovaCategoria({...novaCategoria, nome: e.target.value})} 
                placeholder="NOME DA CATEGORIA" 
                className="h-9 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Descrição</Label>
              <Textarea 
                value={novaCategoria.descricao} 
                onChange={(e) => setNovaCategoria({...novaCategoria, descricao: e.target.value})} 
                placeholder="DESCRIÇÃO DA CATEGORIA..." 
                className="text-xs uppercase min-h-20"
                style={{ textTransform: 'uppercase' }}
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button variant="outline" onClick={() => setShowNovaCategoria(false)} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button 
                onClick={handleCadastrarCategoria} 
                size="sm" 
                className="bg-emerald-600 hover:bg-emerald-700 h-8 gap-1 text-xs" 
                disabled={createCategoriaMutation.isPending}
              >
                {createCategoriaMutation.isPending ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />Salvando...</>
                ) : (
                  <><Save className="w-3 h-3" />Salvar</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG: CADASTRO EM MASSA */}
      <Dialog open={showCadastroEmMassa} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              Cadastrando Produtos
            </DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
