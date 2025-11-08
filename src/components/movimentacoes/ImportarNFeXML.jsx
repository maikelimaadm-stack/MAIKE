import React, { useState } from "react";
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
import { FileText, Upload, CheckCircle, AlertCircle, Plus, RefreshCw, Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const formatarNumero = (num) => {
  if (!num && num !== 0) return '0,00';
  return num.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const parseNumero = (str) => {
  if (!str) return 0;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;
};

export default function ImportarNFeXML({ open, onClose, onSuccess, produtos, fornecedores }) {
  const [etapa, setEtapa] = useState(1);
  const [processando, setProcessando] = useState(false);
  const [xmlFile, setXmlFile] = useState(null);
  const [dadosNFe, setDadosNFe] = useState(null);
  const [fornecedorSelecionado, setFornecedorSelecionado] = useState(null);
  const [itensNFe, setItensNFe] = useState([]);
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
  const [itemEditando, setItemEditando] = useState(null);
  const [novoFornecedor, setNovoFornecedor] = useState({ tipo_pessoa: "Jurídica", nome: "", cnpj: "", cpf: "" });
  const [novoProduto, setNovoProduto] = useState({ nome: "", codigo: "", ncm: "", unidade: "", categoria: "" });

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
      toast.success('Fornecedor cadastrado!');
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
      toast.success('Produto cadastrado e associado!');
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

      const resultado = await base44.integrations.Core.InvokeLLM({
        prompt: `Você é um extrator de dados de NF-e. Extraia os dados do XML abaixo e retorne EXATAMENTE no formato JSON solicitado.

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
  "razao_social_emitente": "string",
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
            cnpj_emitente: { type: "string" },
            razao_social_emitente: { type: "string" },
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

      if (resultado.modelo !== "55") {
        toast.error('❌ Arquivo não é uma NF-e válida (modelo 55)!');
        setProcessando(false);
        return;
      }

      const movimentacoes = await base44.entities.MovimentacaoEstoque.list();
      const jaImportada = movimentacoes.find(m => m.chave_documento === resultado.chave);
      
      if (jaImportada) {
        toast.error('❌ Esta NF-e já foi importada anteriormente!');
        setProcessando(false);
        return;
      }

      setXmlFile(file_url);
      setDadosNFe(resultado);
      setEtapa(2);
      
      const fornecedor = fornecedores.find(f => 
        f.cnpj?.replace(/\D/g, '') === resultado.cnpj_emitente?.replace(/\D/g, '')
      );
      
      if (fornecedor) {
        setFornecedorSelecionado(fornecedor);
        toast.success('✅ Fornecedor identificado automaticamente!');
        setTimeout(() => setEtapa(3), 500);
      }

    } catch (error) {
      toast.error('Erro ao processar XML. Verifique o arquivo.');
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
          cfop_ajustado: item.cfop
        };
      });
      
      setItensNFe(itensComAssociacao);
    }
  }, [etapa, dadosNFe, produtos]);

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
      cpf: novoFornecedor.cpf?.replace(/\D/g, '')
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
      preco_custo: itemEditando?.valor_unitario || 0
    });
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
    toast.success('Produto associado!');
  };

  const handleAjustarItem = (index, campo, valor) => {
    const itensAtualizados = itensNFe.map(item => {
      if (item.index === index) {
        return { ...item, [campo]: valor };
      }
      return item;
    });
    setItensNFe(itensAtualizados);
  };

  const handleConfirmarImportacao = async () => {
    const itensPendentes = itensNFe.filter(i => i.status === 'pendente');
    
    if (itensPendentes.length > 0) {
      toast.error(`❌ ${itensPendentes.length} produto(s) sem associação! Cadastre ou associe todos.`);
      return;
    }

    if (!dadosComplementares.local_estoque) {
      toast.error('Selecione o local de estoque!');
      return;
    }

    setProcessando(true);

    try {
      const movimentacoes = [];

      for (const item of itensNFe) {
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
      }

      await onSuccess({
        fornecedor_id: fornecedorSelecionado.id,
        dadosNFe,
        itens: movimentacoes,
        dadosComplementares,
        xmlFile
      });

      toast.success(`✅ NF-e importada! ${itensNFe.length} produto(s) lançado(s).`);
      onClose();
      resetar();
    } catch (error) {
      toast.error('Erro ao confirmar importação');
      console.error(error);
    } finally {
      setProcessando(false);
    }
  };

  const resetar = () => {
    setEtapa(1);
    setXmlFile(null);
    setDadosNFe(null);
    setFornecedorSelecionado(null);
    setItensNFe([]);
    setDadosComplementares({ local_estoque: "", centro_custo_id: "", frete: "0,00", tipo_frete: "CIF", desconto_total: "0,00", outras_despesas: "0,00", observacoes: "" });
  };

  const totalItens = dadosNFe?.valor_total || 0;
  const totalAjustado = totalItens + parseNumero(dadosComplementares.frete) + parseNumero(dadosComplementares.outras_despesas) - parseNumero(dadosComplementares.desconto_total);

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

          {etapa === 1 && (
            <div className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Selecione o arquivo XML da Nota Fiscal Eletrônica (modelo 55) para importação automática.
                </AlertDescription>
              </Alert>

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
                  <div><strong>Valor:</strong> R$ {formatarNumero(dadosNFe.valor_total)}</div>
                </CardContent>
              </Card>

              <div className="space-y-3">
                <h3 className="font-semibold">Fornecedor</h3>
                {fornecedorSelecionado ? (
                  <Alert className="bg-green-50 border-green-300">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertDescription>
                      <strong>{fornecedorSelecionado.nome}</strong> - CNPJ: {fornecedorSelecionado.cnpj}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert className="bg-orange-50 border-orange-300">
                    <AlertCircle className="h-4 w-4 text-orange-600" />
                    <AlertDescription>
                      Fornecedor não encontrado: <strong>{dadosNFe.razao_social_emitente}</strong> (CNPJ: {dadosNFe.cnpj_emitente})
                      <Button size="sm" className="ml-4" onClick={() => { setNovoFornecedor({ ...novoFornecedor, nome: dadosNFe.razao_social_emitente, cnpj: dadosNFe.cnpj_emitente }); setShowNovoFornecedor(true); }}>
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
              <h3 className="font-semibold">Produtos da NF-e ({itensNFe.length})</h3>
              
              <div className="overflow-auto max-h-96 border rounded">
                <Table>
                  <TableHeader className="sticky top-0 bg-white">
                    <TableRow>
                      <TableHead className="w-12">Status</TableHead>
                      <TableHead>Código XML</TableHead>
                      <TableHead>Descrição XML</TableHead>
                      <TableHead>Produto Associado</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Vlr Unit.</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itensNFe.map((item) => (
                      <TableRow key={item.index}>
                        <TableCell>
                          {item.status === 'associado' ? (
                            <CheckCircle className="w-4 h-4 text-green-600" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-orange-600" />
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{item.codigo}</TableCell>
                        <TableCell className="text-xs">{item.descricao}</TableCell>
                        <TableCell className="text-xs">
                          {item.produto_nome || <span className="text-orange-600">Não associado</span>}
                        </TableCell>
                        <TableCell className="text-right">{item.quantidade_ajustada}</TableCell>
                        <TableCell className="text-right">R$ {item.valor_unitario_ajustado}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {item.status === 'pendente' && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => { setItemEditando(item); setNovoProduto({ nome: item.descricao, codigo: item.codigo, ncm: item.ncm, unidade: item.unidade, categoria: "" }); setShowNovoProduto(true); }}>
                                  <Plus className="w-3 h-3 mr-1" />
                                  Novo
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => { setItemEditando(item); setShowTrocarProduto(true); }}>
                                  <RefreshCw className="w-3 h-3" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-between gap-3">
                <Button variant="outline" onClick={() => setEtapa(2)}>Voltar</Button>
                <Button onClick={() => setEtapa(4)} className="bg-green-600" disabled={itensNFe.some(i => i.status === 'pendente')}>
                  Avançar
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
                  <Label>Desconto</Label>
                  <Input value={dadosComplementares.desconto_total} onChange={(e) => setDadosComplementares({ ...dadosComplementares, desconto_total: e.target.value })} placeholder="0,00" />
                </div>
                <div className="space-y-2">
                  <Label>Outras Despesas</Label>
                  <Input value={dadosComplementares.outras_despesas} onChange={(e) => setDadosComplementares({ ...dadosComplementares, outras_despesas: e.target.value })} placeholder="0,00" />
                </div>
              </div>

              <Card className="bg-slate-50">
                <CardContent className="p-4">
                  <div className="flex justify-between text-lg font-bold">
                    <span>TOTAL GERAL:</span>
                    <span className="text-green-700">R$ {formatarNumero(totalAjustado)}</span>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between gap-3">
                <Button variant="outline" onClick={() => setEtapa(3)}>Voltar</Button>
                <Button onClick={handleConfirmarImportacao} className="bg-green-600 gap-2" disabled={processando}>
                  {processando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Confirmar e Lançar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showNovoFornecedor} onOpenChange={setShowNovoFornecedor}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar Fornecedor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
              <Label>Nome/Razão Social *</Label>
              <Input value={novoFornecedor.nome} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, nome: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
            </div>
            {novoFornecedor.tipo_pessoa === 'Jurídica' ? (
              <div className="space-y-2">
                <Label>CNPJ *</Label>
                <Input value={novoFornecedor.cnpj} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>CPF *</Label>
                <Input value={novoFornecedor.cpf} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cpf: e.target.value })} placeholder="000.000.000-00" />
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowNovoFornecedor(false)}>Cancelar</Button>
              <Button onClick={handleCadastrarFornecedor} className="bg-green-600">
                <Save className="w-4 h-4 mr-2" />
                Salvar
              </Button>
            </div>
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
                <Input value={novoProduto.unidade} onChange={(e) => setNovoProduto({ ...novoProduto, unidade: e.target.value })} placeholder="UN, KG, LT" className="uppercase" style={{ textTransform: 'uppercase' }} />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowNovoProduto(false)}>Cancelar</Button>
              <Button onClick={handleCadastrarProduto} className="bg-green-600">Salvar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showTrocarProduto} onOpenChange={setShowTrocarProduto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Trocar por Produto Existente</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtos.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.codigo_interno}</TableCell>
                    <TableCell className="text-sm">{p.nome_produto}</TableCell>
                    <TableCell>{p.unidade_medida}</TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => handleTrocarProduto(p)}>Selecionar</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}