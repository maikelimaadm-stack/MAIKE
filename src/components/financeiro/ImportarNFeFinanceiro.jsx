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
import { Progress } from "@/components/ui/progress";
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
  const [progresso, setProgresso] = useState({ etapa: '', percent: 0 });
  const [dadosNFe, setDadosNFe] = useState(null);
  const [fornecedorSelecionado, setFornecedorSelecionado] = useState(null);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: unidadesMedida = [] } = useQuery({
    queryKey: ['unidades_medida'],
    queryFn: () => base44.entities.UnidadeMedida.list(),
    initialData: [],
  });

  const autoCadastrarFornecedor = async (dadosEmitente) => {
    try {
      const all = await base44.entities.Fornecedor.list();
      const maxNum = all.reduce((max, f) => Math.max(max, parseInt(f.numero_cadastro) || 0), 0);
      
      const enderecoCompleto = dadosEmitente.bairro_emitente 
        ? `${dadosEmitente.endereco_emitente}, ${dadosEmitente.bairro_emitente}`
        : dadosEmitente.endereco_emitente;

      const novoFornecedor = await base44.entities.Fornecedor.create({
        empresa_id: empresaSelecionadaId,
        numero_cadastro: String(maxNum + 1),
        tipo_pessoa: dadosEmitente.cnpj_emitente ? "Jurídica" : "Física",
        nome: (dadosEmitente.razao_social_emitente || "").toUpperCase(),
        cnpj: dadosEmitente.cnpj_emitente?.replace(/\D/g, '') || "",
        cpf: dadosEmitente.cpf_emitente?.replace(/\D/g, '') || "",
        inscricao_estadual: (dadosEmitente.inscricao_estadual_emitente || "").toUpperCase(),
        telefone: dadosEmitente.telefone_emitente || "",
        email: (dadosEmitente.email_emitente || "").toLowerCase(),
        endereco: (enderecoCompleto || "").toUpperCase(),
        cidade: (dadosEmitente.cidade_emitente || "").toUpperCase(),
        estado: dadosEmitente.estado_emitente || "",
        cep: dadosEmitente.cep_emitente?.replace(/\D/g, '') || ""
      });

      queryClient.invalidateQueries({ queryKey: ['fornecedores_financeiro'] });
      return novoFornecedor;
    } catch (error) {
      console.error('Erro ao auto-cadastrar fornecedor:', error);
      throw error;
    }
  };

  const autoCadastrarProduto = async (item, dadosNFe) => {
    try {
      const all = await base44.entities.Produto.list();
      const maxNum = all.reduce((max, p) => Math.max(max, parseInt(p.numero_produto) || 0), 0);
      
      const unidadeXML = item.unidade?.toUpperCase();
      const unidadeCadastrada = unidadesMedida.find(u => u.sigla === unidadeXML);
      const unidadeFinal = unidadeCadastrada ? unidadeCadastrada.sigla : (unidadeXML || 'UN');

      const novoProduto = await base44.entities.Produto.create({
        empresa_id: empresaSelecionadaId,
        numero_produto: String(maxNum + 1),
        nome_produto: (item.descricao || "").toUpperCase(),
        codigo_interno: (item.codigo || "").toUpperCase(),
        unidade_medida: unidadeFinal.toUpperCase(),
        preco_custo: item.valor_unitario || 0,
        estoque_atual: 0
      });

      return novoProduto;
    } catch (error) {
      console.error('Erro ao auto-cadastrar produto:', error);
      throw error;
    }
  };

  const handleUploadXML = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setProcessando(true);
    setProgresso({ etapa: '📄 Fazendo upload...', percent: 5 });
    
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      setProgresso({ etapa: '🔍 Lendo XML...', percent: 15 });
      const response = await fetch(file_url);
      const xmlText = await response.text();

      setProgresso({ etapa: '🤖 Extraindo dados da NF-e...', percent: 25 });
      
      const resultado = await base44.integrations.Core.InvokeLLM({
        prompt: `Você é um extrator de dados de NF-e. Extraia TODOS os dados do XML abaixo.

IMPORTANTE: 
- Extraia TODOS os dados de pagamento (formas, valores, vencimentos)
- Se houver informação de pagamento, retorne status_pagamento como "pago" ou "pendente"
- Formas de pagamento: Dinheiro, Cartão de Crédito, Cartão de Débito, PIX, Boleto, etc.

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
            status_pagamento: { type: "string" },
            forma_pagamento: { type: ["string", "null"] },
            data_pagamento: { type: ["string", "null"] },
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

      setProgresso({ etapa: '🔎 Verificando fornecedor...', percent: 35 });
      
      const documentoEmitente = resultado.cnpj_emitente || resultado.cpf_emitente;
      let fornecedor = fornecedores.find(f => 
        f.cnpj?.replace(/\D/g, '') === documentoEmitente?.replace(/\D/g, '') ||
        f.cpf?.replace(/\D/g, '') === documentoEmitente?.replace(/\D/g, '')
      );
      
      if (!fornecedor) {
        setProgresso({ etapa: '👤 Cadastrando fornecedor...', percent: 45 });
        fornecedor = await autoCadastrarFornecedor(resultado);
        toast.success(`✅ Fornecedor cadastrado: ${fornecedor.nome}`);
      }

      setProgresso({ etapa: '📦 Associando produtos...', percent: 55 });
      
      const itensProcessados = [];
      for (let i = 0; i < resultado.itens.length; i++) {
        const item = resultado.itens[i];
        
        let produto = produtos.find(p => 
          p.codigo_interno === item.codigo ||
          p.codigo_barras === item.codigo ||
          p.nome_produto?.toLowerCase().includes(item.descricao?.toLowerCase())
        );

        if (!produto) {
          setProgresso({ etapa: `📦 Cadastrando produto ${i + 1}/${resultado.itens.length}...`, percent: 55 + (i / resultado.itens.length) * 25 });
          produto = await autoCadastrarProduto(item, resultado);
        }

        const unidadeXML = item.unidade?.toUpperCase();
        const unidadeCadastrada = unidadesMedida.find(u => u.sigla === unidadeXML);
        const unidadeFinal = unidadeCadastrada ? unidadeCadastrada.sigla : (unidadeXML || 'UN');

        itensProcessados.push({
          produto_id: produto.id,
          produto_nome: produto.nome_produto,
          descricao: item.descricao,
          codigo: item.codigo,
          ncm: item.ncm,
          cfop: item.cfop,
          unidade: unidadeFinal,
          quantidade: item.quantidade,
          valor_unitario: item.valor_unitario,
          desconto_item: 0
        });
      }

      setProgresso({ etapa: '✅ Importando para o financeiro...', percent: 90 });

      const dataVencimento = resultado.data_emissao || new Date().toISOString().split('T')[0];
      const contaPaga = resultado.status_pagamento === "pago";
      const dataPagamento = contaPaga ? (resultado.data_pagamento || resultado.data_emissao) : null;

      await onSuccess({
        dadosNFe: resultado,
        fornecedor_id: fornecedor.id,
        dataVencimento,
        itens: itensProcessados,
        dadosComplementares: {
          local_estoque: "",
          centro_custo_id: "",
          plano_contas_id: "",
          grupo_id: "",
          frete: 0,
          desconto_total: 0,
          outras_despesas: 0,
          observacoes: `IMPORTADO XML - ${resultado.chave}`
        },
        gerarFinanceiro: true,
        gerarEstoque: true,
        gerarLivroFiscal: true,
        parcelar: false,
        parcelas: [],
        conta_paga: contaPaga,
        data_pagamento: dataPagamento,
        valor_pago_total: contaPaga ? resultado.valor_total : 0,
        forma_pagamento_paga_nome: contaPaga ? resultado.forma_pagamento : null,
        auto_importacao: true
      });

      setProgresso({ etapa: '🎉 Concluído!', percent: 100 });
      toast.success(`🎉 NF-e importada! ${itensProcessados.length} produto(s)`);
      
      setTimeout(() => {
        onClose();
        resetar();
      }, 1000);

    } catch (error) {
      console.error('❌ Erro:', error);
      toast.error(`❌ Erro: ${error.message || 'Falha ao processar XML'}`);
    } finally {
      setProcessando(false);
      e.target.value = '';
    }
  };

  const resetar = () => {
    setDadosNFe(null);
    setFornecedorSelecionado(null);
    setProgresso({ etapa: '', percent: 0 });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !processando) { onClose(); resetar(); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileText className="w-4 h-4 text-emerald-600" />
            Importar NF-e (XML)
          </DialogTitle>
        </DialogHeader>

        {!processando ? (
          <div className="space-y-3">
            <Alert className="py-2">
              <AlertCircle className="h-3 w-3" />
              <AlertDescription className="text-xs">
                Selecione o arquivo XML da NF-e (modelo 55). O sistema vai:
                <ul className="list-disc list-inside mt-1">
                  <li>Auto-cadastrar fornecedor (se não existir)</li>
                  <li>Auto-cadastrar produtos (se não existirem)</li>
                  <li>Criar lançamento financeiro</li>
                  <li>Dar entrada em estoque</li>
                  <li>Registrar no livro fiscal</li>
                </ul>
              </AlertDescription>
            </Alert>

            <div className="border-2 border-dashed rounded p-8 text-center hover:border-emerald-400 transition-colors">
              <Upload className="w-12 h-12 text-slate-400 mx-auto mb-3" />
              <p className="text-sm text-slate-600 mb-4">Arraste o XML ou clique para selecionar</p>
              <Input
                type="file"
                accept=".xml"
                onChange={handleUploadXML}
                className="max-w-md mx-auto h-9 text-xs"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-600 font-medium">{progresso.etapa}</span>
                <span className="font-semibold text-emerald-600">{progresso.percent}%</span>
              </div>
              <Progress value={progresso.percent} className="h-2" />
            </div>
            <p className="text-center text-xs text-slate-500">Aguarde, processando...</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}