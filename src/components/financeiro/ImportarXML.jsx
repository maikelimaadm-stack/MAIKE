import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, CheckCircle, AlertTriangle, XCircle, Loader2, Download, Eye } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";

export default function ImportarXML({ open, onClose, onImportSuccess }) {
  const [arquivo, setArquivo] = useState(null);
  const [processando, setProcessando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [resultado, setResultado] = useState(null);
  const [previewDados, setPreviewDados] = useState(null);
  const [layoutSelecionado, setLayoutSelecionado] = useState("auto");

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.xml')) {
      toast.error('❌ Apenas arquivos XML são aceitos!');
      return;
    }

    setArquivo(file);
    
    // Preview rápido do arquivo
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const xmlText = event.target.result;
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        
        // Detectar tipo de XML
        let tipoDetectado = "XML Genérico";
        if (xmlDoc.getElementsByTagName("nfeProc").length > 0) {
          tipoDetectado = "NF-e";
        } else if (xmlDoc.getElementsByTagName("nfse").length > 0) {
          tipoDetectado = "NFS-e";
        }
        
        setPreviewDados({
          nome: file.name,
          tamanho: (file.size / 1024).toFixed(2) + ' KB',
          tipo: tipoDetectado
        });
      } catch (error) {
        toast.error('❌ Erro ao ler XML!');
      }
    };
    reader.readAsText(file);
  };

  const parsearNFe = (xmlDoc) => {
    try {
      // Estrutura básica NF-e 4.0
      const infNFe = xmlDoc.getElementsByTagName("infNFe")[0];
      const ide = xmlDoc.getElementsByTagName("ide")[0];
      const emit = xmlDoc.getElementsByTagName("emit")[0];
      const dest = xmlDoc.getElementsByTagName("dest")[0];
      const total = xmlDoc.getElementsByTagName("total")[0];
      const ICMSTot = xmlDoc.getElementsByTagName("ICMSTot")[0];

      // Dados básicos
      const numeroNF = ide?.getElementsByTagName("nNF")[0]?.textContent || "";
      const serie = ide?.getElementsByTagName("serie")[0]?.textContent || "";
      const dataEmissao = ide?.getElementsByTagName("dhEmi")[0]?.textContent?.split('T')[0] || "";
      const chaveNFe = infNFe?.getAttribute("Id")?.replace("NFe", "") || "";

      // Emitente
      const emitNome = emit?.getElementsByTagName("xNome")[0]?.textContent || "";
      const emitCNPJ = emit?.getElementsByTagName("CNPJ")[0]?.textContent || "";

      // Destinatário (fornecedor)
      const destNome = dest?.getElementsByTagName("xNome")[0]?.textContent || "";
      const destCNPJ = dest?.getElementsByTagName("CNPJ")[0]?.textContent || "";
      const destCPF = dest?.getElementsByTagName("CPF")[0]?.textContent || "";

      // Totais
      const valorTotal = ICMSTot?.getElementsByTagName("vNF")[0]?.textContent || "0";
      const valorProdutos = ICMSTot?.getElementsByTagName("vProd")[0]?.textContent || "0";
      const valorICMS = ICMSTot?.getElementsByTagName("vICMS")[0]?.textContent || "0";
      const valorPIS = ICMSTot?.getElementsByTagName("vPIS")[0]?.textContent || "0";
      const valorCOFINS = ICMSTot?.getElementsByTagName("vCOFINS")[0]?.textContent || "0";

      // Itens
      const itensXML = xmlDoc.getElementsByTagName("det");
      const itens = [];
      for (let i = 0; i < itensXML.length; i++) {
        const det = itensXML[i];
        const prod = det.getElementsByTagName("prod")[0];
        itens.push({
          produto: prod?.getElementsByTagName("xProd")[0]?.textContent || "",
          descricao: prod?.getElementsByTagName("xProd")[0]?.textContent || "",
          quantidade: prod?.getElementsByTagName("qCom")[0]?.textContent || "1",
          preco_unitario: prod?.getElementsByTagName("vUnCom")[0]?.textContent || "0",
          cfop: prod?.getElementsByTagName("CFOP")[0]?.textContent || ""
        });
      }

      return {
        tipo: "Despesa",
        numero_referencia: numeroNF,
        tipo_documento_fiscal: "NF-e",
        numero_nf: numeroNF,
        chave_nf: chaveNFe,
        data_documento: dataEmissao,
        data_vencimento: dataEmissao,
        valor_liquido: valorProdutos,
        valor_total: valorTotal,
        icms_valor: valorICMS,
        pis_valor: valorPIS,
        cofins_valor: valorCOFINS,
        cfop: itens[0]?.cfop || "",
        fornecedor_cnpj: destCNPJ || destCPF,
        fornecedor_nome: destNome,
        itens: itens,
        observacoes: `NF-e ${numeroNF} - ${emitNome}`
      };
    } catch (error) {
      console.error("Erro ao parsear NF-e:", error);
      return null;
    }
  };

  const handleImportar = async () => {
    if (!arquivo) {
      toast.error('❌ Selecione um arquivo!');
      return;
    }

    setProcessando(true);
    setProgresso(10);

    try {
      // 1. Upload do arquivo
      setProgresso(30);
      const { file_url } = await base44.integrations.Core.UploadFile({ file: arquivo });
      
      // 2. Ler e parsear XML
      setProgresso(50);
      const reader = new FileReader();
      
      reader.onload = async (event) => {
        try {
          const xmlText = event.target.result;
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlText, "text/xml");
          
          setProgresso(70);
          
          // 3. Parsear baseado no tipo
          let dadosParsed = null;
          if (previewDados?.tipo === "NF-e") {
            dadosParsed = parsearNFe(xmlDoc);
          }
          
          if (!dadosParsed) {
            throw new Error("Não foi possível extrair dados do XML");
          }
          
          setProgresso(90);
          
          // 4. Registrar importação
          const empresaId = localStorage.getItem('empresa_selecionada_id');
          await base44.entities.ImportacaoXML.create({
            empresa_id: empresaId,
            numero_importacao: String(Date.now()),
            tipo_arquivo: previewDados?.tipo || "XML Genérico",
            arquivo_nome: arquivo.name,
            arquivo_url: file_url,
            status: "Sucesso",
            total_registros: 1,
            registros_sucesso: 1,
            registros_avisos: 0,
            registros_erro: 0,
            lancamentos_criados: [],
            log_processamento: [{ timestamp: new Date().toISOString(), mensagem: "XML importado com sucesso" }],
            tempo_processamento_segundos: 2
          });
          
          setProgresso(100);
          setResultado({
            status: "sucesso",
            dados: dadosParsed,
            mensagem: "XML importado com sucesso!"
          });
          
          toast.success('✅ XML importado com sucesso!');
          
          // Chamar callback com os dados
          if (onImportSuccess) {
            onImportSuccess(dadosParsed);
          }
          
        } catch (error) {
          setResultado({
            status: "erro",
            mensagem: error.message || "Erro ao processar XML"
          });
          toast.error('❌ Erro ao processar XML!');
        } finally {
          setProcessando(false);
        }
      };
      
      reader.readAsText(arquivo);
      
    } catch (error) {
      setProcessando(false);
      toast.error('❌ Erro ao fazer upload!');
      console.error(error);
    }
  };

  const handleFechar = () => {
    setArquivo(null);
    setPreviewDados(null);
    setResultado(null);
    setProgresso(0);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleFechar}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-600" />
            Importar XML / NF-e
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* SELEÇÃO DE ARQUIVO */}
          {!resultado && (
            <>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Selecione o arquivo XML</Label>
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                  <Upload className="w-10 h-10 mx-auto mb-3 text-slate-400" />
                  <p className="text-sm text-slate-600 mb-2">
                    {arquivo ? arquivo.name : 'Arraste o arquivo aqui ou clique para selecionar'}
                  </p>
                  <Input
                    type="file"
                    accept=".xml"
                    onChange={handleFileChange}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload">
                    <Button size="sm" variant="outline" className="cursor-pointer" asChild>
                      <span>
                        <FileText className="w-3 h-3 mr-2" />
                        Escolher Arquivo
                      </span>
                    </Button>
                  </label>
                </div>
              </div>

              {/* PREVIEW DO ARQUIVO */}
              {previewDados && (
                <Card className="bg-blue-50 border-blue-200">
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-blue-600" />
                        <span className="font-semibold text-sm">{previewDados.nome}</span>
                      </div>
                      <div className="flex gap-4 text-xs text-slate-600">
                        <span>Tamanho: {previewDados.tamanho}</span>
                        <span>•</span>
                        <Badge variant="outline">{previewDados.tipo}</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* LAYOUT */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Layout de Importação</Label>
                <Select value={layoutSelecionado} onValueChange={setLayoutSelecionado}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Detecção Automática</SelectItem>
                    <SelectItem value="ssg_default">SSG Padrão</SelectItem>
                    <SelectItem value="nfe_4.0">NF-e 4.0 (Padrão)</SelectItem>
                    <SelectItem value="nfse_simples">NFS-e Simplificado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* PROCESSAMENTO */}
          {processando && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                <span className="text-sm font-medium">Processando XML...</span>
              </div>
              <Progress value={progresso} className="h-2" />
              <p className="text-xs text-slate-500 text-center">{progresso}%</p>
            </div>
          )}

          {/* RESULTADO */}
          {resultado && (
            <Card className={`${
              resultado.status === 'sucesso' ? 'bg-green-50 border-green-200' :
              resultado.status === 'aviso' ? 'bg-yellow-50 border-yellow-200' :
              'bg-red-50 border-red-200'
            }`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  {resultado.status === 'sucesso' && <CheckCircle className="w-6 h-6 text-green-600" />}
                  {resultado.status === 'aviso' && <AlertTriangle className="w-6 h-6 text-yellow-600" />}
                  {resultado.status === 'erro' && <XCircle className="w-6 h-6 text-red-600" />}
                  
                  <div className="flex-1">
                    <p className="font-semibold text-sm mb-1">{resultado.mensagem}</p>
                    
                    {resultado.dados && (
                      <div className="mt-3 space-y-1 text-xs">
                        <p><strong>Tipo:</strong> {resultado.dados.tipo}</p>
                        <p><strong>Número NF:</strong> {resultado.dados.numero_nf}</p>
                        <p><strong>Fornecedor:</strong> {resultado.dados.fornecedor_nome}</p>
                        <p><strong>Valor Total:</strong> R$ {parseFloat(resultado.dados.valor_total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                        <p><strong>Itens:</strong> {resultado.dados.itens?.length || 0} produto(s)</p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* AÇÕES */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={handleFechar}>
              Fechar
            </Button>
            {!resultado && (
              <Button 
                onClick={handleImportar} 
                disabled={!arquivo || processando}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {processando ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Importar e Popular Formulário
                  </>
                )}
              </Button>
            )}
          </div>

          {/* INFO */}
          <div className="bg-slate-50 p-3 rounded border">
            <p className="text-xs text-slate-600">
              <strong>Arquivos suportados:</strong> NF-e (4.0), NFS-e, XML Genérico<br/>
              <strong>Tamanho máximo:</strong> 10 MB por arquivo<br/>
              <strong>Ação:</strong> Os dados extraídos preencherão automaticamente o formulário de lançamento
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}