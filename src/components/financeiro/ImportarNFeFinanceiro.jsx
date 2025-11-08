import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, Upload, Loader2, Save, AlertCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";

const formatarMoeda = (num) => {
  if (!num && num !== 0) return 'R$ 0,00';
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const ESTADOS_BRASIL = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export default function ImportarNFeFinanceiro({ open, onClose, onSuccess, fornecedores }) {
  const [processando, setProcessando] = useState(false);
  const [dadosNFe, setDadosNFe] = useState(null);
  const [fornecedorSelecionado, setFornecedorSelecionado] = useState(null);
  const [gerarFinanceiro, setGerarFinanceiro] = useState(true);
  const [gerarEstoque, setGerarEstoque] = useState(false);
  const [parcelas, setParcelas] = useState(1);
  const [etapa, setEtapa] = useState(1);
  const [showNovoFornecedor, setShowNovoFornecedor] = useState(false);
  const [novoFornecedor, setNovoFornecedor] = useState({
    tipo_pessoa: "Jurídica",
    nome: "",
    cnpj: "",
    cpf: "",
    telefone: "",
    email: "",
    endereco: "",
    cidade: "",
    estado: "",
    cep: ""
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

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
        prompt: `Extraia os dados desta NF-e (XML) e retorne em JSON. Se não for modelo 55, retorne modelo vazio:
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
            telefone_emitente: { type: ["string", "null"] },
            email_emitente: { type: ["string", "null"] },
            endereco_emitente: { type: "string" },
            cidade_emitente: { type: "string" },
            estado_emitente: { type: "string" },
            cep_emitente: { type: "string" }
          }
        }
      });

      if (!resultado || resultado.modelo !== "55") {
        toast.error('❌ Arquivo não é uma NF-e válida (modelo 55)');
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
        setEtapa(2);
        toast.success('✅ XML processado! Fornecedor identificado.');
      } else {
        setNovoFornecedor({
          tipo_pessoa: resultado.cnpj_emitente ? "Jurídica" : "Física",
          nome: resultado.razao_social_emitente || "",
          cnpj: resultado.cnpj_emitente || "",
          cpf: resultado.cpf_emitente || "",
          telefone: resultado.telefone_emitente || "",
          email: resultado.email_emitente || "",
          endereco: resultado.endereco_emitente || "",
          cidade: resultado.cidade_emitente || "",
          estado: resultado.estado_emitente || "",
          cep: resultado.cep_emitente || ""
        });
        setShowNovoFornecedor(true);
        toast.warning('⚠️ Fornecedor não encontrado - cadastre para continuar');
      }
      
    } catch (error) {
      toast.error('❌ Erro ao processar XML');
      console.error(error);
    } finally {
      setProcessando(false);
      e.target.value = '';
    }
  };

  const handleCadastrarFornecedor = async () => {
    if (!novoFornecedor.nome) {
      toast.error('Nome é obrigatório!');
      return;
    }

    try {
      const all = await base44.entities.Fornecedor.list();
      const maxNum = all.reduce((max, f) => Math.max(max, parseInt(f.numero_cadastro) || 0), 0);
      
      const newFornecedor = await base44.entities.Fornecedor.create({
        empresa_id: empresaSelecionadaId,
        numero_cadastro: String(maxNum + 1),
        tipo_pessoa: novoFornecedor.tipo_pessoa,
        nome: novoFornecedor.nome.toUpperCase(),
        cnpj: novoFornecedor.cnpj?.replace(/\D/g, ''),
        cpf: novoFornecedor.cpf?.replace(/\D/g, ''),
        telefone: novoFornecedor.telefone,
        email: novoFornecedor.email?.toLowerCase(),
        endereco: novoFornecedor.endereco?.toUpperCase(),
        cidade: novoFornecedor.cidade?.toUpperCase(),
        estado: novoFornecedor.estado,
        cep: novoFornecedor.cep?.replace(/\D/g, '')
      });

      setFornecedorSelecionado(newFornecedor);
      setShowNovoFornecedor(false);
      setEtapa(2);
      toast.success('✅ Fornecedor cadastrado!');
    } catch (error) {
      toast.error('Erro ao cadastrar fornecedor');
    }
  };

  const handleConfirmar = () => {
    onSuccess({
      dadosNFe,
      fornecedor_id: fornecedorSelecionado.id,
      gerarFinanceiro,
      gerarEstoque,
      parcelas: parseInt(parcelas)
    });
  };

  const resetar = () => {
    setEtapa(1);
    setDadosNFe(null);
    setFornecedorSelecionado(null);
    setGerarFinanceiro(true);
    setGerarEstoque(false);
    setParcelas(1);
    setShowNovoFornecedor(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { onClose(); resetar(); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-green-600" />
              Importar NF-e - Etapa {etapa} de 2
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {etapa === 1 && (
              <>
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Selecione o arquivo XML da NF-e para importação
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

            {etapa === 2 && dadosNFe && (
              <>
                <Card className="bg-blue-50 border-blue-200">
                  <CardContent className="p-4 grid grid-cols-2 gap-3 text-sm">
                    <div><strong>NF-e:</strong> {dadosNFe.numero}</div>
                    <div><strong>Série:</strong> {dadosNFe.serie}</div>
                    <div className="col-span-2"><strong>Fornecedor:</strong> {fornecedorSelecionado?.nome}</div>
                    <div><strong>Data:</strong> {new Date(dadosNFe.data_emissao).toLocaleDateString('pt-BR')}</div>
                    <div><strong>Valor:</strong> {formatarMoeda(dadosNFe.valor_total)}</div>
                  </CardContent>
                </Card>

                <div className="space-y-4 p-4 bg-slate-50 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Checkbox checked={gerarFinanceiro} onCheckedChange={setGerarFinanceiro} />
                    <label className="font-semibold">Gerar Lançamento Financeiro</label>
                  </div>

                  {gerarFinanceiro && (
                    <div className="ml-6 space-y-2">
                      <Label>Número de Parcelas</Label>
                      <Input type="number" min="1" max="120" value={parcelas} onChange={(e) => setParcelas(e.target.value)} />
                      <p className="text-xs text-slate-600">* Você poderá configurar valores e datas individuais na próxima tela</p>
                    </div>
                  )}

                  <div className="flex items-center space-x-2">
                    <Checkbox checked={gerarEstoque} onCheckedChange={setGerarEstoque} />
                    <label className="font-semibold">Baixar Estoque Automaticamente</label>
                  </div>
                </div>

                <div className="flex justify-between gap-3">
                  <Button variant="outline" onClick={() => setEtapa(1)}>Voltar</Button>
                  <Button onClick={handleConfirmar} className="bg-green-600">
                    <Save className="w-4 h-4 mr-2" />
                    Confirmar
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNovoFornecedor} onOpenChange={setShowNovoFornecedor}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cadastrar Fornecedor</DialogTitle>
            <DialogDescription>Dados extraídos do XML - complete e confirme</DialogDescription>
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

            <div className="grid grid-cols-2 gap-4">
              {novoFornecedor.tipo_pessoa === 'Jurídica' ? (
                <div className="space-y-2">
                  <Label>CNPJ *</Label>
                  <Input value={novoFornecedor.cnpj} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cnpj: e.target.value })} />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>CPF *</Label>
                  <Input value={novoFornecedor.cpf} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cpf: e.target.value })} />
                </div>
              )}
              
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input value={novoFornecedor.telefone} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, telefone: e.target.value })} />
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
                <Input value={novoFornecedor.cep} onChange={(e) => setNovoFornecedor({ ...novoFornecedor, cep: e.target.value })} />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => setShowNovoFornecedor(false)}>Cancelar</Button>
              <Button onClick={handleCadastrarFornecedor} className="bg-green-600">
                <Save className="w-4 h-4 mr-2" />
                Salvar e Continuar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}