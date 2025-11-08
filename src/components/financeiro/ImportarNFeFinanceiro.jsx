import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, Upload, Loader2, Save, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";

const formatarMoeda = (num) => {
  if (!num && num !== 0) return 'R$ 0,00';
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function ImportarNFeFinanceiro({ open, onClose, onSuccess }) {
  const [processando, setProcessando] = useState(false);
  const [dadosNFe, setDadosNFe] = useState(null);
  const [gerarFinanceiro, setGerarFinanceiro] = useState(true);
  const [gerarEstoque, setGerarEstoque] = useState(true);
  const [parcelas, setParcelas] = useState(1);

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
        prompt: `Extraia os dados desta NF-e (XML) e retorne em JSON:
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
            cnpj_emitente: { type: "string" },
            razao_social_emitente: { type: "string" }
          }
        }
      });

      if (resultado.modelo !== "55") {
        toast.error('❌ Arquivo não é uma NF-e válida (modelo 55)');
        setProcessando(false);
        return;
      }

      setDadosNFe(resultado);
      toast.success('✅ XML processado!');
      
    } catch (error) {
      toast.error('❌ Erro ao processar XML');
    } finally {
      setProcessando(false);
      e.target.value = '';
    }
  };

  const handleConfirmar = () => {
    onSuccess({
      dadosNFe,
      gerarFinanceiro,
      gerarEstoque,
      parcelas
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-green-600" />
            Importar NF-e - Lançamento Financeiro
          </DialogTitle>
          <DialogDescription>
            Importar XML e gerar lançamento financeiro automaticamente
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!dadosNFe ? (
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
          ) : (
            <>
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-4 grid grid-cols-2 gap-3 text-sm">
                  <div><strong>NF-e:</strong> {dadosNFe.numero}</div>
                  <div><strong>Série:</strong> {dadosNFe.serie}</div>
                  <div className="col-span-2"><strong>Fornecedor:</strong> {dadosNFe.razao_social_emitente}</div>
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
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Checkbox checked={gerarEstoque} onCheckedChange={setGerarEstoque} />
                  <label className="font-semibold">Baixar Estoque Automaticamente</label>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => { setDadosNFe(null); }}>
                  Cancelar
                </Button>
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
  );
}