
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AutocompleteGenerico from "./AutocompleteGenerico.jsx";

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
  if (modelo !== '55') throw new Error('Não é NF-e modelo 55');

  const numero = getValor('nNF');
  const serie = getValor('serie');
  const chave = getValor('chNFe') || xmlDoc.getElementsByTagName('infNFe')[0]?.getAttribute('Id')?.replace('NFe', '');
  const dataEmissao = getValor('dhEmi')?.split('T')[0] || getValor('dEmi');
  const cfop = getValor('CFOP');

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
  const cMun = getValor('cMun');

  const enderecoCompleto = numero_end ? `${logradouro}, ${numero_end}` : logradouro;

  const infAdic = xmlDoc.getElementsByTagName('infAdic')[0];
  let observacoes = '';
  if (infAdic) {
    const infCpl = infAdic.getElementsByTagName('infCpl')[0];
    if (infCpl) observacoes = infCpl.textContent || '';
  }

  let tPag = getValor('tPag');
  if (!tPag) {
    const pagElement = xmlDoc.getElementsByTagName('pag')[0];
    if (pagElement) {
      const detPagElement = pagElement.getElementsByTagName('detPag')[0];
      if (detPagElement) tPag = detPagElement.getElementsByTagName('tPag')[0]?.textContent;
    }
  }
  
  let formaPagamento = null;
  if (tPag) {
    const formasPag = {
      '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de Crédito', '04': 'Cartão de Débito',
      '05': 'Crédito Loja', '10': 'Vale Alimentação', '11': 'Vale Refeição', '12': 'Vale Presente',
      '13': 'Vale Combustível', '15': 'Boleto Bancário', '17': 'PIX', '18': 'Transferência Bancária',
      '19': 'Depósito Bancária', '90': 'Sem Pagamento', '99': 'Outros'
    };
    formaPagamento = formasPag[tPag] || 'Outros';
  }

  const parcelas = [];
  const dups = xmlDoc.getElementsByTagName('dup');
  for (let i = 0; i < dups.length; i++) {
    const dup = dups[i];
    const dVenc = dup.getElementsByTagName('dVenc')[0]?.textContent;
    const vDup = parseFloat(dup.getElementsByTagName('vDup')[0]?.textContent || 0);
    if (dVenc && vDup > 0) parcelas.push({ data: dVenc, valor: vDup });
  }
  parcelas.sort((a, b) => new Date(a.data) - new Date(b.data));

  let contaPaga = false;
  if (parcelas.length === 0 && tPag && tPag !== '15' && tPag !== '90' && tPag !== '99') contaPaga = true;

  const itensNFe = [];
  let somaProdutosItens = 0;
  let somaDescontoItens = 0;
  
  const dets = xmlDoc.getElementsByTagName('det');
  for (let i = 0; i < dets.length; i++) {
    const det = dets[i];
    const getTagDet = (tag) => {
      const el = det.getElementsByTagName(tag)[0];
      return el ? el.textContent : null;
    };
    
    const vDescItem = parseFloat(getTagDet('vDesc')) || 0;
    const vProdItem = parseFloat(getTagDet('vProd')) || 0;
    
    somaProdutosItens += vProdItem;
    somaDescontoItens += vDescItem;
    
    itensNFe.push({
      codigo: getTagDet('cProd') || '',
      descricao: getTagDet('xProd') || '',
      ncm: getTagDet('NCM') || '',
      cfop: getTagDet('CFOP') || cfop || '',
      unidade: getTagDet('uCom') || 'UN',
      quantidade: parseFloat(getTagDet('qCom')) || 0,
      valor_unitario: parseFloat(getTagDet('vUnCom')) || 0,
      valor_total: vProdItem,
      desconto_item: vDescItem
    });
  }

  if (itensNFe.length === 0) throw new Error('NF-e sem produtos');

  const valorCalculado = vProd - vDesc + vFrete + vSeg + vOutro + vIPI;

  return {
    modelo, numero, serie, chave, data_emissao: dataEmissao,
    cnpj_emitente: cnpjEmit, cpf_emitente: cpfEmit, razao_social_emitente: razaoSocial,
    inscricao_estadual_emitente: inscEstadual, telefone_emitente: telefone, email_emitente: email,
    endereco_emitente: enderecoCompleto, bairro_emitente: bairro, cidade_emitente: cidade,
    estado_emitente: estado, cep_emitente: cep, codigo_ibge_emitente: cMun, cfop,
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
    valor_calculado: valorCalculado,
    soma_produtos_itens: somaProdutosItens,
    soma_desconto_itens: somaDescontoItens,
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
    tipo_pessoa: "Jurídica", nome: "", cnpj: "", cpf: "", inscricao_estadual: "",
    telefone: "", email: "", endereco: "", estado: "", cidade: "", cep: "", codigo_ibge: ""
  });
  
  const [showBuscaProduto, setShowBuscaProduto] = useState(false);
  const [showNovoProduto, setShowNovoProduto] = useState(false);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [showCadastroEmMassa, setShowCadastroEmMassa] = useState(false);
  const [showNovoFornecedor, setShowNovoFornecedor] = useState(false);
  
  const [novoProduto, setNovoProduto] = useState({
    nome_produto: "", codigo_interno: "", codigo_barras: "",
    unidade_medida: "UN", categoria: "", descricao: "", preco_custo: ""
  });

  const [showNovaUnidade, setShowNovaUnidade] = useState(false);
  const [novaUnidade, setNovaUnidade] = useState({ sigla: "", nome: "" });
  
  const [showNovaCategoria, setShowNovaCategoria] = useState(false);
  const [novaCategoria, setNovaCategoria] = useState({ nome: "", descricao: "" });

  const [showNovoLocal, setShowNovoLocal] = useState(false);
  const [novoLocal, setNovoLocal] = useState({ nome: "", descricao: "" });

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

  const { data: cidades = [] } = useQuery({
    queryKey: ['cidades'],
    queryFn: async () => {
      const cidadesList = await base44.entities.Cidade.list();
      return cidadesList;
    },
    initialData: [],
  });

  const createFornecedorMutation = useMutation({
    mutationFn: async (data) => {
      const all = await base44.entities.Fornecedor.list();
      const maxNum = all.reduce((max, f) => Math.max(max, parseInt(f.numero_cadastro) || 0), 0);
      return base44.entities.Fornecedor.create({ ...data, empresa_id: empresaSelecionadaId, numero_cadastro: String(maxNum + 1) });
    },
    onSuccess: (newFornecedor) => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores_financeiro'] });
      setFornecedorSelecionado(newFornecedor);
      toast.success('Fornecedor cadastrado!');
      setEtapa(3);
    },
  });

  const createUnidadeMutation = useMutation({
    mutationFn: async (data) => {
      const all = await base44.entities.UnidadeMedida.list();
      const maxNum = all.reduce((max, u) => Math.max(max, parseInt(u.numero) || 0), 0);
      return base44.entities.UnidadeMedida.create({ ...data, numero: String(maxNum + 1) });
    },
    onSuccess: (newUnidade) => {
      queryClient.invalidateQueries({ queryKey: ['unidades_medida'] });
      setNovoProduto(prev => ({ ...prev, unidade_medida: newUnidade.sigla }));
      setShowNovaUnidade(false);
      setNovaUnidade({ sigla: "", nome: "" });
      toast.success('Unidade cadastrada!');
    },
  });

  const createCategoriaMutation = useMutation({
    mutationFn: async (data) => {
      const all = await base44.entities.Categoria.list();
      const maxNum = all.reduce((max, c) => Math.max(max, parseInt(c.numero_categoria) || 0), 0);
      return base44.entities.Categoria.create({ ...data, numero_categoria: String(maxNum + 1) });
    },
    onSuccess: (newCategoria) => {
      queryClient.invalidateQueries({ queryKey: ['categorias_produtos'] });
      setNovoProduto(prev => ({ ...prev, categoria: newCategoria.nome }));
      setShowNovaCategoria(false);
      setNovaCategoria({ nome: "", descricao: "" });
      toast.success('Categoria cadastrada!');
    },
  });

  const createLocalMutation = useMutation({
    mutationFn: async (data) => {
      const all = await base44.entities.LocalEstoque.list();
      const maxNum = all.reduce((max, l) => Math.max(max, parseInt(l.numero_local) || 0), 0);
      return base44.entities.LocalEstoque.create({ ...data, numero_local: String(maxNum + 1) });
    },
    onSuccess: (newLocal) => {
      queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
      setLocalEstoque(newLocal.nome);
      setShowNovoLocal(false);
      setNovoLocal({ nome: "", descricao: "" });
      toast.success('Local cadastrado!');
    },
  });

  const createProdutoMutation = useMutation({
    mutationFn: async (data) => {
      const all = await base44.entities.Produto.list();
      const maxNum = all.reduce((max, p) => Math.max(max, parseInt(p.numero_produto) || 0), 0);
      return base44.entities.Produto.create({ ...data, empresa_id: empresaSelecionadaId, numero_produto: String(maxNum + 1), estoque_atual: 0 });
    },
    onSuccess: (newProduto) => {
      queryClient.invalidateQueries({ queryKey: ['produtos_financeiro'] });
      if (itemEditando) {
        setItensNFe(prev => prev.map(item => 
          item.index === itemEditando.index ? { ...item, produto_id: newProduto.id, produto_nome: newProduto.nome_produto, status: 'associado' } : item
        ));
        setItemEditando(null);
      }
      setShowNovoProduto(false);
      setNovoProduto({ nome_produto: "", codigo_interno: "", codigo_barras: "", unidade_medida: "UN", categoria: "", descricao: "", preco_custo: "" });
      toast.success('Produto cadastrado!');
    },
  });

  const handleUploadXML = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setProcessando(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const response = await fetch(file_url);
      const xmlText = await response.text();
      const resultado = extrairDadosXML(xmlText);
      
      toast.success(`${resultado.itens.length} produto(s) encontrado(s)`);
      setDadosNFe(resultado);
      
      const documentoEmitente = resultado.cnpj_emitente || resultado.cpf_emitente;
      const forn = fornecedores.find(f => 
        f.cnpj?.replace(/\D/g, '') === documentoEmitente?.replace(/\D/g, '') ||
        f.cpf?.replace(/\D/g, '') === documentoEmitente?.replace(/\D/g, '')
      );
      
      if (forn) {
        setFornecedorSelecionado(forn);
        toast.success(`Fornecedor: ${forn.nome}`);
        setEtapa(3);
      } else {
        const enderecoCompleto = resultado.bairro_emitente ? `${resultado.endereco_emitente}, ${resultado.bairro_emitente}` : resultado.endereco_emitente;
        setNovoFornecedor({
          tipo_pessoa: resultado.cnpj_emitente ? "Jurídica" : "Física",
          nome: resultado.razao_social_emitente || "",
          cnpj: resultado.cnpj_emitente || "",
          cpf: resultado.cpf_emitente || "",
          inscricao_estadual: resultado.inscricao_estadual_emitente || "",
          telefone: resultado.telefone_emitente || "",
          email: resultado.email_emitente || "",
          endereco: enderecoCompleto || "",
          estado: resultado.estado_emitente || "",
          cidade: resultado.cidade_emitente || "",
          cep: resultado.cep_emitente || "",
          codigo_ibge: resultado.codigo_ibge_emitente || ""
        });
        setEtapa(2);
      }
    } catch (error) {
      console.error('Erro:', error);
      toast.error(error.message || 'Erro ao processar XML');
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
          index, codigo: item.codigo || '', descricao: item.descricao || '',
          ncm: item.ncm || '', cfop: item.cfop || '', unidade: unidadeFinal,
          quantidade: parseFloat(item.quantidade) || 0, valor_total: item.valor_total,
          desconto_item: item.desconto_item || 0, valor_unitario: parseFloat(item.valor_unitario) || 0,
          produto_id: prod?.id, produto_nome: prod?.nome_produto,
          status: prod ? 'associado' : 'pendente'
        };
      });
      setItensNFe(itensComAssociacao);
      setItensSelecionados(itensComAssociacao.map(i => i.index));
    }
  }, [etapa, dadosNFe, produtos, unidadesMedida]);

  const handleCadastrarFornecedor = () => {
    if (!novoFornecedor.nome) {
      toast.error('Nome obrigatório!');
      return;
    }
    if (novoFornecedor.tipo_pessoa === 'Jurídica' && !novoFornecedor.cnpj) {
      toast.error('CNPJ obrigatório!');
      return;
    }
    if (novoFornecedor.tipo_pessoa === 'Física' && !novoFornecedor.cpf) {
      toast.error('CPF obrigatório!');
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
      estado: novoFornecedor.estado,
      cidade: novoFornecedor.cidade?.toUpperCase(),
      codigo_ibge: novoFornecedor.codigo_ibge,
      cep: novoFornecedor.cep?.replace(/\D/g, '')
    });
  };

  const handleCadastrarProduto = () => {
    if (!novoProduto.nome_produto) {
      toast.error('Nome obrigatório!');
      return;
    }
    const precoCustoParsed = novoProduto.preco_custo ? parseFloat(String(novoProduto.preco_custo).replace(',', '.')) : 0;
    if (isNaN(precoCustoParsed)) {
      toast.error('Preço inválido!');
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
    setItemEditando(item);
    setShowNovoProduto(true);
  };

  const handleCadastrarUnidade = () => {
    if (!novaUnidade.sigla || !novaUnidade.nome) {
      toast.error('Preencha todos os campos!');
      return;
    }
    createUnidadeMutation.mutate({ sigla: novaUnidade.sigla.toUpperCase(), nome: novaUnidade.nome.toUpperCase() });
  };

  const handleCadastrarCategoria = () => {
    if (!novaCategoria.nome) {
      toast.error('Nome obrigatório!');
      return;
    }
    createCategoriaMutation.mutate({ nome: novaCategoria.nome.toUpperCase(), descricao: novaCategoria.descricao?.toUpperCase() });
  };

  const handleCadastrarLocal = () => {
    if (!novoLocal.nome) {
      toast.error('Nome obrigatório!');
      return;
    }
    createLocalMutation.mutate({ nome: novoLocal.nome.toUpperCase(), descricao: novoLocal.descricao?.toUpperCase() });
  };

  const handleCadastrarProdutosEmMassa = async () => {
    const pendentes = itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index));
    if (pendentes.length === 0) {
      toast.error('Nenhum produto pendente!');
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
          codigo_barras: '',
          unidade_medida: unidadeFinal.toUpperCase(),
          categoria: '',
          descricao: '',
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
        console.error('Erro:', error);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['produtos_financeiro'] });
    setShowCadastroEmMassa(false);
    toast.success(`${cadastrados} produto(s) cadastrado(s)!`);
  };

  const handleTrocarProduto = (produto) => {
    setItensNFe(prev => prev.map(item => 
      item.index === itemEditando?.index ? { ...item, produto_id: produto.id, produto_nome: produto.nome_produto, status: 'associado' } : item
    ));
    setShowBuscaProduto(false);
    setItemEditando(null);
    setBuscaProduto("");
    toast.success('Produto associado!');
  };

  const handleToggleSelecao = (index) => {
    setItensSelecionados(prev => prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]);
  };

  const handleRemoverItem = (index) => {
    if (window.confirm('Remover item?')) {
      setItensNFe(prev => prev.filter(i => i.index !== index));
      setItensSelecionados(prev => prev.filter(i => i !== index));
      toast.success('Item removido!');
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
      toast.error('Nenhum item selecionado!');
      return;
    }
    if (pendentes.length > 0) {
      toast.error(`${pendentes.length} produto(s) sem associação!`);
      return;
    }
    if (!localEstoque) {
      toast.error('Selecione o local de estoque!');
      return;
    }

    const temParcelas = dadosNFe.parcelas && dadosNFe.parcelas.length > 0;
    const valorProdutosBruto = dadosNFe.soma_produtos_itens || dadosNFe.valor_produtos || 0;
    const valorDescontoTotal = dadosNFe.valor_desconto_total || 0;
    
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
      parcelas: temParcelas ? dadosNFe.parcelas.map(p => ({ data: p.data, valor: String(p.valor.toFixed(2)).replace('.', ',')})) : [],
      valor_produtos: String(valorProdutosBruto.toFixed(2)).replace('.', ','),
      valor_frete: String((dadosNFe.valor_frete || 0).toFixed(2)).replace('.', ','),
      valor_seguro: String((dadosNFe.valor_seguro || 0).toFixed(2)).replace('.', ','),
      valor_outras_despesas: String((dadosNFe.valor_outras_despesas || 0).toFixed(2)).replace('.', ','),
      valor_desconto_total: String(valorDescontoTotal.toFixed(2)).replace('.', ','),
      valor_ipi: String((dadosNFe.valor_ipi || 0).toFixed(2)).replace('.', ','),
      valor_icms: String((dadosNFe.valor_icms || 0).toFixed(2)).replace('.', ','),
      valor_pis: String((dadosNFe.valor_pis || 0).toFixed(2)).replace('.', ','),
      valor_cofins: String((dadosNFe.valor_cofins || 0).toFixed(2)).replace('.', ','),
      base_calculo_icms: String((dadosNFe.base_calculo_icms || 0).toFixed(2)).replace('.', ','),
      frete: String((dadosNFe.valor_frete || 0).toFixed(2)).replace('.', ','),
      outras_despesas: String((dadosNFe.valor_outras_despesas || 0).toFixed(2)).replace('.', ','),
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
      dar_entrada_estoque: true,
      usar_valor_nfe_total: true
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
    setNovoFornecedor({ tipo_pessoa: "Jurídica", nome: "", cnpj: "", cpf: "", inscricao_estadual: "", telefone: "", email: "", endereco: "", estado: "", cidade: "", cep: "", codigo_ibge: "" });
    setNovoProduto({ nome_produto: "", codigo_interno: "", codigo_barras: "", unidade_medida: "UN", categoria: "", descricao: "", preco_custo: "" });
    setShowBuscaProduto(false);
    setShowNovoProduto(false);
    setBuscaProduto("");
    setShowCadastroEmMassa(false);
    setShowNovaUnidade(false);
    setNovaUnidade({ sigla: "", nome: "" });
    setShowNovaCategoria(false);
    setNovaCategoria({ nome: "", descricao: "" });
    setShowNovoLocal(false);
    setNovoLocal({ nome: "", descricao: "" });
    setShowNovoFornecedor(false);
  };

  const produtosFiltrados = produtos.filter(p => 
    !buscaProduto || 
    p.nome_produto?.toLowerCase().includes(buscaProduto.toLowerCase()) ||
    p.codigo_interno?.toLowerCase().includes(buscaProduto.toLowerCase())
  );

  const cidadesFiltradas = cidades.filter(c => c.estado === novoFornecedor.estado);

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !processando) { onClose(); resetar(); } }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-slate-900">Importar NF-e - Etapa {etapa} de 3</DialogTitle>
          </DialogHeader>

          {etapa === 1 && (
            <div className="space-y-2">
              <div className="border-2 border-dashed border-slate-300 rounded p-2.5 text-center hover:border-slate-400 transition-colors">
                <p className="text-xs text-slate-600 mb-1">Selecione o arquivo XML da NF-e</p>
                <Input type="file" accept=".xml" onChange={handleUploadXML} disabled={processando} className="max-w-md mx-auto h-7 text-xs" />
                {processando && (
                  <div className="mt-2">
                    <Loader2 className="w-4 h-4 animate-spin mx-auto text-emerald-600" />
                    <p className="text-xs text-slate-600 mt-1">Processando...</p>
                  </div>
                )}
              </div>
              
              {cidades.length === 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded p-2 text-xs">
                  <p className="font-semibold text-orange-900 mb-1">⚠️ Banco de cidades vazio</p>
                  <p className="text-orange-800 mb-2">O banco de cidades ainda não foi populado. Acesse a página "Popular Cidades" no menu para carregar todas as cidades brasileiras.</p>
                  <Button size="sm" onClick={() => window.open('/PopularCidades', '_blank')} className="h-6 text-xs">
                    Ir para Popular Cidades
                  </Button>
                </div>
              )}
            </div>
          )}

          {etapa === 2 && dadosNFe && (
            <div className="space-y-1.5">
              <Card className="bg-blue-50 border-blue-300 shadow-sm">
                <CardContent className="p-1.5 text-xs space-y-0.5">
                  <div className="font-semibold text-blue-900">📊 Resumo da NF-e</div>
                  <div className="grid grid-cols-4 gap-1.5 pt-0.5 border-t border-blue-200">
                    <div><strong>Número:</strong> {dadosNFe.numero}</div>
                    <div><strong>Série:</strong> {dadosNFe.serie}</div>
                    <div><strong>Data:</strong> {new Date(dadosNFe.data_emissao).toLocaleDateString('pt-BR')}</div>
                    <div><strong>CFOP:</strong> {dadosNFe.cfop || '-'}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 pt-0.5 border-t border-blue-200">
                    <div><strong>Valor Produtos (XML):</strong> <span className="font-mono">{formatarMoeda(dadosNFe.valor_produtos)}</span></div>
                    <div><strong>Desconto Total (XML):</strong> <span className="font-mono text-red-600">{formatarMoeda(dadosNFe.valor_desconto_total)}</span></div>
                    <div><strong>Frete + Seg + Outras:</strong> <span className="font-mono">{formatarMoeda((dadosNFe.valor_frete || 0) + (dadosNFe.valor_seguro || 0) + (dadosNFe.valor_outras_despesas || 0))}</span></div>
                    <div><strong>IPI:</strong> <span className="font-mono">{formatarMoeda(dadosNFe.valor_ipi || 0)}</span></div>
                  </div>
                  <div className="pt-0.5 border-t border-blue-200 flex justify-between font-bold text-blue-900">
                    <span>TOTAL NF-e (vNF):</span>
                    <span className="font-mono text-base">{formatarMoeda(dadosNFe.valor_total)}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-slate-200">
                <CardHeader className="pb-1 px-2 pt-1">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-xs font-semibold">Cadastrar Fornecedor</CardTitle>
                    <Button type="button" size="sm" variant="outline" onClick={() => setShowNovoFornecedor(true)} className="h-6 gap-1 text-xs">
                      <Plus className="w-3 h-3" />
                      Novo
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-2 space-y-1">
                  <div className="space-y-1">
                    <Label className="text-xs">Tipo de Pessoa *</Label>
                    <Select value={novoFornecedor.tipo_pessoa} onValueChange={(v) => setNovoFornecedor({ ...novoFornecedor, tipo_pessoa: v })}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Jurídica" className="text-xs">Pessoa Jurídica</SelectItem>
                        <SelectItem value="Física" className="text-xs">Pessoa Física</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">{novoFornecedor.tipo_pessoa === 'Jurídica' ? 'Razão Social' : 'Nome Completo'} *</Label>
                    <Input value={novoFornecedor.nome} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, nome: e.target.value })} className="uppercase h-7 text-xs" style={{ textTransform: 'uppercase' }} />
                  </div>

                  <div className="grid grid-cols-2 gap-1">
                    {novoFornecedor.tipo_pessoa === 'Jurídica' ? (
                      <>
                        <div className="space-y-1">
                          <Label className="text-xs">CNPJ *</Label>
                          <Input value={novoFornecedor.cnpj} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cnpj: e.target.value })} placeholder="00.000.000/0000-00" className="h-7 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Inscrição Estadual</Label>
                          <Input value={novoFornecedor.inscricao_estadual} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, inscricao_estadual: e.target.value })} className="uppercase h-7 text-xs" style={{ textTransform: 'uppercase' }} />
                        </div>
                      </>
                    ) : (
                      <div className="space-y-1">
                        <Label className="text-xs">CPF *</Label>
                        <Input value={novoFornecedor.cpf} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cpf: e.target.value })} placeholder="000.000.000-00" className="h-7 text-xs" />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-1">
                    <div className="space-y-1">
                      <Label className="text-xs">Telefone</Label>
                      <Input value={novoFornecedor.telefone} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, telefone: e.target.value })} placeholder="(00) 00000-0000" className="h-7 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">E-mail</Label>
                      <Input type="email" value={novoFornecedor.email} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, email: e.target.value })} placeholder="email@exemplo.com" className="h-7 text-xs" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Endereço</Label>
                    <Input value={novoFornecedor.endereco} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, endereco: e.target.value })} placeholder="RUA, NÚMERO, BAIRRO" className="uppercase h-7 text-xs" style={{ textTransform: 'uppercase' }} />
                  </div>

                  <div className="grid grid-cols-4 gap-1">
                    <div className="space-y-1">
                      <Label className="text-xs">Estado *</Label>
                      <Select value={novoFornecedor.estado} onValueChange={(v) => setNovoFornecedor({ ...novoFornecedor, estado: v, cidade: "", codigo_ibge: "" })}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="UF" /></SelectTrigger>
                        <SelectContent>
                          {['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'].map(uf => (
                            <SelectItem key={uf} value={uf} className="text-xs">{uf}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">Cidade *</Label>
                      <Select 
                        value={novoFornecedor.cidade} 
                        onValueChange={(v) => {
                          const cidadeSelecionada = cidades.find(c => c.nome === v && c.estado === novoFornecedor.estado);
                          setNovoFornecedor({ 
                            ...novoFornecedor, 
                            cidade: v,
                            codigo_ibge: cidadeSelecionada?.codigo_ibge || ""
                          });
                        }} 
                        disabled={!novoFornecedor.estado}
                      >
                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={novoFornecedor.estado ? "Selecione" : "Escolha UF"} /></SelectTrigger>
                        <SelectContent className="max-h-[200px]">
                          {cidadesFiltradas.length === 0 ? (
                            <SelectItem value="_none" disabled className="text-xs">
                              {cidades.length === 0 ? 'Banco vazio' : 'Nenhuma cidade'}
                            </SelectItem>
                          ) : (
                            cidadesFiltradas.map(c => (
                              <SelectItem key={c.id} value={c.nome} className="text-xs">{c.nome}</SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">CEP</Label>
                      <Input value={novoFornecedor.cep} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cep: e.target.value })} placeholder="00000-000" className="h-7 text-xs" />
                    </div>
                  </div>

                  {novoFornecedor.codigo_ibge && (
                    <div className="bg-slate-50 border border-slate-200 rounded p-1.5">
                      <div className="text-[10px] text-slate-600">
                        <strong>Código IBGE:</strong> {novoFornecedor.codigo_ibge}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-between gap-2 pt-1 border-t">
                <Button variant="outline" onClick={() => setEtapa(1)} size="sm" className="h-7 text-xs">Voltar</Button>
                <Button onClick={handleCadastrarFornecedor} size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-7 text-xs" disabled={createFornecedorMutation.isPending}>
                  {createFornecedorMutation.isPending ? 'Salvando...' : 'Cadastrar e Continuar'}
                </Button>
              </div>
            </div>
          )}

          {etapa === 3 && dadosNFe && (
            <div className="space-y-1.5">
              <Card className="bg-blue-50 border-blue-300 shadow-sm">
                <CardContent className="p-1.5 text-xs">
                  <div className="grid grid-cols-4 gap-1.5">
                    <div><strong>NF-e:</strong> {dadosNFe.numero}/{dadosNFe.serie}</div>
                    <div><strong>Data:</strong> {new Date(dadosNFe.data_emissao).toLocaleDateString('pt-BR')}</div>
                    <div><strong>Total NF-e:</strong> <span className="font-mono font-bold text-blue-900">{formatarMoeda(dadosNFe.valor_total)}</span></div>
                    <div><strong>Fornecedor:</strong> {fornecedorSelecionado?.nome}</div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between items-center">
                <h3 className="font-semibold text-xs">Produtos ({itensNFe.length})</h3>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={handleSelecionarTodos} className="h-6 text-xs">
                    {itensSelecionados.length === itensNFe.length && itensNFe.length > 0 ? 'Desmarcar' : 'Selecionar'}
                  </Button>
                  {itensSelecionados.length > 0 && itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index)).length > 0 && (
                    <Button size="sm" onClick={handleCadastrarProdutosEmMassa} className="bg-emerald-600 hover:bg-emerald-700 h-6 text-xs" disabled={showCadastroEmMassa}>
                      {showCadastroEmMassa ? 'Cadastrando...' : `Cadastrar (${itensNFe.filter(i => i.status === 'pendente' && itensSelecionados.includes(i.index)).length})`}
                    </Button>
                  )}
                </div>
              </div>
              
              <div className="overflow-auto max-h-80 border rounded">
                <Table>
                  <TableHeader className="sticky top-0 bg-slate-50 z-10">
                    <TableRow className="border-b">
                      <TableHead className="w-10 text-xs">
                        <Checkbox checked={itensSelecionados.length === itensNFe.length && itensNFe.length > 0} onCheckedChange={handleSelecionarTodos} />
                      </TableHead>
                      <TableHead className="w-10 text-xs">St</TableHead>
                      <TableHead className="text-xs">Produto</TableHead>
                      <TableHead className="text-right text-xs">Qtd</TableHead>
                      <TableHead className="text-right text-xs">Vlr Unit</TableHead>
                      <TableHead className="text-right text-xs">Total Bruto</TableHead>
                      <TableHead className="text-right text-xs">Desc. Item</TableHead>
                      <TableHead className="text-right text-xs">Total Líq.</TableHead>
                      <TableHead className="text-center w-20 text-xs">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itensNFe.map((item) => (
                      <TableRow key={item.index} className={!itensSelecionados.includes(item.index) ? 'opacity-40' : ''}>
                        <TableCell>
                          <Checkbox checked={itensSelecionados.includes(item.index)} onCheckedChange={() => handleToggleSelecao(item.index)} />
                        </TableCell>
                        <TableCell>
                          <div className={`w-2.5 h-2.5 rounded-full ${item.status === 'associado' ? 'bg-emerald-600' : 'bg-orange-400'}`} />
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium">{item.produto_nome || <span className="text-orange-600">Não associado</span>}</div>
                          <div className="text-slate-500 text-[10px]">{item.descricao}</div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{item.quantidade.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatarMoeda(item.valor_unitario)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatarMoeda(item.valor_total)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-red-600">{formatarMoeda(item.desconto_item || 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold text-emerald-700">{formatarMoeda(item.valor_total - (item.desconto_item || 0))}</TableCell>
                        <TableCell>
                          <div className="flex gap-0.5 justify-center">
                            {item.status === 'pendente' && (
                              <Button size="sm" variant="ghost" onClick={() => handleAbrirCadastroProduto(item)} className="h-6 w-6 p-0 text-emerald-600" title="Cadastrar">
                                <Plus className="w-3 h-3" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => { setItemEditando(item); setShowBuscaProduto(true); }} className="h-6 w-6 p-0 text-slate-600" title="Trocar">
                              <Search className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleRemoverItem(item.index)} className="h-6 w-6 p-0 text-red-600" title="Remover">
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-slate-100 font-semibold border-t-2">
                      <TableCell colSpan={5} className="text-xs">TOTAL SELECIONADO</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatarMoeda(itensNFe.filter(i => itensSelecionados.includes(i.index)).reduce((s, i) => s + i.valor_total, 0))}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-red-600">{formatarMoeda(itensNFe.filter(i => itensSelecionados.includes(i.index)).reduce((s, i) => s + (i.desconto_item || 0), 0))}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-700 font-bold">{formatarMoeda(itensNFe.filter(i => itensSelecionados.includes(i.index)).reduce((s, i) => s + (i.valor_total - (i.desconto_item || 0)), 0))}</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <Card className="bg-emerald-50 border-emerald-300">
                <CardContent className="p-1.5 text-xs space-y-0.5">
                  <div className="font-semibold text-emerald-900">💰 Cálculo Final - Valor a Pagar</div>
                  <div className="flex justify-between">
                    <span>Produtos (bruto) - XML:</span>
                    <span className="font-mono">{formatarMoeda(dadosNFe.valor_produtos)}</span>
                  </div>
                  {dadosNFe.valor_desconto_total > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>- Desconto Total NF-e:</span>
                      <span className="font-mono">{formatarMoeda(dadosNFe.valor_desconto_total)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-emerald-300 pt-0.5">
                    <span>= Líquido Produtos:</span>
                    <span className="font-mono font-semibold">{formatarMoeda(dadosNFe.valor_produtos - dadosNFe.valor_desconto_total)}</span>
                  </div>
                  {dadosNFe.valor_frete > 0 && (
                    <div className="flex justify-between">
                      <span>+ Frete:</span>
                      <span className="font-mono">{formatarMoeda(dadosNFe.valor_frete)}</span>
                    </div>
                  )}
                  {dadosNFe.valor_seguro > 0 && (
                    <div className="flex justify-between">
                      <span>+ Seguro:</span>
                      <span className="font-mono">{formatarMoeda(dadosNFe.valor_seguro)}</span>
                    </div>
                  )}
                  {dadosNFe.valor_outras_despesas > 0 && (
                    <div className="flex justify-between">
                      <span>+ Outras Despesas:</span>
                      <span className="font-mono">{formatarMoeda(dadosNFe.valor_outras_despesas)}</span>
                    </div>
                  )}
                  {dadosNFe.valor_ipi > 0 && (
                    <div className="flex justify-between">
                      <span>+ IPI:</span>
                      <span className="font-mono">{formatarMoeda(dadosNFe.valor_ipi)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t-2 border-emerald-400 pt-1 text-emerald-900 text-sm">
                    <span>TOTAL A PAGAR:</span>
                    <span className="font-mono">{formatarMoeda(dadosNFe.valor_total)}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-50 border-slate-200">
                <CardHeader className="py-1 px-2">
                  <CardTitle className="text-xs font-semibold">Local de Estoque</CardTitle>
                </CardHeader>
                <CardContent className="p-2">
                  <div className="flex gap-1">
                    <AutocompleteGenerico
                      items={locaisEstoque}
                      value={locaisEstoque.find(l => l.nome === localEstoque)?.id || ""}
                      onChange={(id) => {
                        const local = locaisEstoque.find(l => l.id === id);
                        setLocalEstoque(local?.nome || "");
                      }}
                      placeholder="Buscar local..."
                      displayField="nome"
                      searchFields={["nome", "descricao"]}
                      className="flex-1"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowNovoLocal(true)} className="h-7 w-7">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between gap-2 pt-1 border-t">
                <Button variant="outline" onClick={() => setEtapa(fornecedorSelecionado ? 1 : 2)} size="sm" className="h-7 text-xs">Voltar</Button>
                <Button onClick={handleConfirmarImportacao} className="bg-emerald-600 hover:bg-emerald-700 h-7 text-xs" disabled={itensSelecionados.length === 0 || !localEstoque}>
                  Importar ({itensSelecionados.length})
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showBuscaProduto} onOpenChange={setShowBuscaProduto}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Buscar Produto Existente</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-2 flex-1 overflow-auto">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input 
                value={buscaProduto}
                onChange={(e) => setBuscaProduto(e.target.value)}
                placeholder="Buscar por nome ou código..."
                className="pl-9 h-8 text-xs"
                autoFocus
              />
            </div>

            <div className="border rounded overflow-auto max-h-96">
              {produtosFiltrados.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Nenhum produto encontrado</p>
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-50 sticky top-0">
                    <TableRow>
                      <TableHead className="text-xs">Produto</TableHead>
                      <TableHead className="text-xs">Código</TableHead>
                      <TableHead className="text-xs text-center">UN</TableHead>
                      <TableHead className="text-xs text-center">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {produtosFiltrados.map((produto) => (
                      <TableRow key={produto.id} className="hover:bg-slate-50">
                        <TableCell className="text-xs font-medium">{produto.nome_produto}</TableCell>
                        <TableCell className="text-xs font-mono text-slate-600">{produto.codigo_interno || '-'}</TableCell>
                        <TableCell className="text-xs text-center font-mono">{produto.unidade_medida}</TableCell>
                        <TableCell className="text-center">
                          <Button size="sm" onClick={() => handleTrocarProduto(produto)} className="h-6 text-xs bg-emerald-600 hover:bg-emerald-700">
                            Selecionar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => { setShowBuscaProduto(false); setItemEditando(null); setBuscaProduto(""); }} size="sm" className="h-7 text-xs">
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNovoProduto} onOpenChange={setShowNovoProduto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">Cadastrar Novo Produto</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Nome do Produto *</Label>
                <Input 
                  value={novoProduto.nome_produto} 
                  onChange={(e) => setNovoProduto({ ...novoProduto, nome_produto: e.target.value })} 
                  className="uppercase h-7 text-xs" 
                  style={{ textTransform: 'uppercase' }}
                  placeholder="NOME DO PRODUTO"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Código Interno</Label>
                <Input 
                  value={novoProduto.codigo_interno} 
                  onChange={(e) => setNovoProduto({ ...novoProduto, codigo_interno: e.target.value })} 
                  className="uppercase h-7 text-xs" 
                  style={{ textTransform: 'uppercase' }}
                  placeholder="CÓDIGO"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Unidade de Medida *</Label>
                <div className="flex gap-1">
                  <Select value={novoProduto.unidade_medida} onValueChange={(v) => setNovoProduto({ ...novoProduto, unidade_medida: v })}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {unidadesMedida.map(u => (
                        <SelectItem key={u.id} value={u.sigla} className="text-xs">{u.sigla} - {u.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="icon" onClick={() => setShowNovaUnidade(true)} className="h-7 w-7">
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Categoria</Label>
                <div className="flex gap-1">
                  <Select value={novoProduto.categoria} onValueChange={(v) => setNovoProduto({ ...novoProduto, categoria: v })}>
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {categorias.map(c => (
                        <SelectItem key={c.id} value={c.nome} className="text-xs">{c.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="icon" onClick={() => setShowNovaCategoria(true)} className="h-7 w-7">
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Código de Barras</Label>
                <Input 
                  value={novoProduto.codigo_barras} 
                  onChange={(e) => setNovoProduto({ ...novoProduto, codigo_barras: e.target.value })} 
                  placeholder="000000000000"
                  className="h-7 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Preço de Custo</Label>
                <Input 
                  value={novoProduto.preco_custo} 
                  onChange={(e) => setNovoProduto({ ...novoProduto, preco_custo: e.target.value })} 
                  placeholder="0,00"
                  className="h-7 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
              <Textarea 
                value={novoProduto.descricao} 
                onChange={(e) => setNovoProduto({ ...novoProduto, descricao: e.target.value })} 
                className="uppercase text-xs" 
                style={{ textTransform: 'uppercase' }}
                placeholder="DESCRIÇÃO..."
                rows={2}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => { setShowNovoProduto(false); setItemEditando(null); }} size="sm" className="h-7 text-xs">
              Cancelar
            </Button>
            <Button onClick={handleCadastrarProduto} size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={createProdutoMutation.isPending}>
              {createProdutoMutation.isPending ? 'Salvando...' : 'Cadastrar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNovaUnidade} onOpenChange={setShowNovaUnidade}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Nova Unidade de Medida</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">Sigla *</Label>
              <Input 
                value={novaUnidade.sigla} 
                onChange={(e) => setNovaUnidade({ ...novaUnidade, sigla: e.target.value })} 
                placeholder="UN"
                className="uppercase h-7 text-xs"
                style={{ textTransform: 'uppercase' }}
                maxLength={5}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nome/Descrição *</Label>
              <Input 
                value={novaUnidade.nome} 
                onChange={(e) => setNovaUnidade({ ...novaUnidade, nome: e.target.value })} 
                placeholder="UNIDADE"
                className="uppercase h-7 text-xs"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => { setShowNovaUnidade(false); setNovaUnidade({ sigla: "", nome: "" }); }} size="sm" className="h-7 text-xs">
              Cancelar
            </Button>
            <Button onClick={handleCadastrarUnidade} size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={createUnidadeMutation.isPending}>
              {createUnidadeMutation.isPending ? 'Salvando...' : 'Cadastrar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNovaCategoria} onOpenChange={setShowNovaCategoria}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Nova Categoria</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">Nome *</Label>
              <Input 
                value={novaCategoria.nome} 
                onChange={(e) => setNovaCategoria({ ...novaCategoria, nome: e.target.value })} 
                placeholder="CATEGORIA"
                className="uppercase h-7 text-xs"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
              <Textarea 
                value={novaCategoria.descricao} 
                onChange={(e) => setNovaCategoria({ ...novaCategoria, descricao: e.target.value })} 
                placeholder="DESCRIÇÃO..."
                className="uppercase text-xs"
                style={{ textTransform: 'uppercase' }}
                rows={2}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => { setShowNovaCategoria(false); setNovaCategoria({ nome: "", descricao: "" }); }} size="sm" className="h-7 text-xs">
              Cancelar
            </Button>
            <Button onClick={handleCadastrarCategoria} size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={createCategoriaMutation.isPending}>
              {createCategoriaMutation.isPending ? 'Salvando...' : 'Cadastrar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNovoLocal} onOpenChange={setShowNovoLocal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Novo Local de Estoque</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">Nome *</Label>
              <Input 
                value={novoLocal.nome} 
                onChange={(e) => setNovoLocal({ ...novoLocal, nome: e.target.value })} 
                placeholder="GALPÃO 1"
                className="uppercase h-7 text-xs"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
              <Textarea 
                value={novoLocal.descricao} 
                onChange={(e) => setNovoLocal({ ...novoLocal, descricao: e.target.value })} 
                placeholder="DESCRIÇÃO DO LOCAL..."
                className="uppercase text-xs"
                style={{ textTransform: 'uppercase' }}
                rows={2}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => { setShowNovoLocal(false); setNovoLocal({ nome: "", descricao: "" }); }} size="sm" className="h-7 text-xs">
              Cancelar
            </Button>
            <Button onClick={handleCadastrarLocal} size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={createLocalMutation.isPending}>
              {createLocalMutation.isPending ? 'Salvando...' : 'Cadastrar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCadastroEmMassa} onOpenChange={() => {}}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Cadastrando Produtos...</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
