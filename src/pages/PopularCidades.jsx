import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Database, CheckCircle } from "lucide-react";
import { toast } from "sonner";

export default function PopularCidades() {
  const [processando, setProcessando] = useState(false);
  const [progresso, setProgresso] = useState({ total: 0, processado: 0 });
  const [concluido, setConcluido] = useState(false);

  const popularCidades = async () => {
    setProcessando(true);
    setConcluido(false);
    
    try {
      // Verificar se já existem cidades
      const cidadesExistentes = await base44.entities.Cidade.list();
      if (cidadesExistentes.length > 0) {
        if (!window.confirm(`Já existem ${cidadesExistentes.length} cidades. Deseja recarregar?`)) {
          setProcessando(false);
          return;
        }
        // Deletar todas
        toast.info('Limpando banco...');
        for (const cidade of cidadesExistentes) {
          await base44.entities.Cidade.delete(cidade.id);
        }
      }

      toast.info('Buscando cidades do IBGE...');
      
      // Buscar todas as cidades da API do IBGE
      const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios');
      const data = await response.json();
      
      setProgresso({ total: data.length, processado: 0 });
      
      // Inserir em lotes de 50
      const batchSize = 50;
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        const cidadesParaInserir = batch.map(c => ({
          nome: c.nome,
          estado: c.microrregiao.mesorregiao.UF.sigla,
          codigo_ibge: String(c.id)
        }));
        
        await base44.entities.Cidade.bulkCreate(cidadesParaInserir);
        setProgresso({ total: data.length, processado: i + batch.length });
        
        // Pequeno delay para não sobrecarregar
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      setConcluido(true);
      toast.success(`✅ ${data.length} cidades cadastradas!`);
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao popular cidades: ' + error.message);
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div className="p-6">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-600" />
            Popular Banco de Cidades
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm">
            <p className="font-semibold text-blue-900 mb-2">ℹ️ Sobre esta ferramenta</p>
            <p className="text-blue-800 mb-2">
              Esta página irá buscar <strong>todas as cidades brasileiras (5570+)</strong> diretamente da API oficial do IBGE 
              e salvar no banco de dados da aplicação.
            </p>
            <p className="text-blue-800 text-xs">
              Execute apenas uma vez ou quando precisar atualizar os dados das cidades.
            </p>
          </div>

          {processando && (
            <div className="bg-slate-50 border border-slate-200 rounded p-4">
              <div className="flex items-center gap-3 mb-2">
                <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                <span className="font-semibold">Processando...</span>
              </div>
              <div className="text-sm text-slate-600">
                {progresso.processado} de {progresso.total} cidades importadas
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 mt-2">
                <div 
                  className="bg-emerald-600 h-2 rounded-full transition-all"
                  style={{ width: `${progresso.total > 0 ? (progresso.processado / progresso.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {concluido && (
            <div className="bg-emerald-50 border border-emerald-200 rounded p-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
                <div>
                  <p className="font-semibold text-emerald-900">Importação concluída!</p>
                  <p className="text-sm text-emerald-800">Todas as cidades foram cadastradas com sucesso.</p>
                </div>
              </div>
            </div>
          )}

          <Button 
            onClick={popularCidades} 
            disabled={processando}
            className="w-full h-10 bg-emerald-600 hover:bg-emerald-700"
          >
            {processando ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Importando...
              </>
            ) : (
              <>
                <Database className="w-4 h-4 mr-2" />
                Importar Cidades do IBGE
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}