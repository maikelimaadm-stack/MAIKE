import React, { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileCode, Folder, Copy, Check, Database } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";

const ARQUIVOS_SISTEMA = {
  "Layout": {
    arquivos: ["Layout.jsx"]
  },
  "Pages": {
    arquivos: [
      "Home.jsx",
      "Dashboard.jsx",
      "Pesagens.jsx",
      "CustosSafra.jsx",
      "MovimentacoesEstoque.jsx",
      "LancamentoFinanceiro.jsx",
      "CaixaBancos.jsx",
      "PlanoContas.jsx",
      "GruposFinanceiros.jsx",
      "FluxoCaixa.jsx",
      "LivroCaixa.jsx",
      "LivrosFiscais.jsx",
      "Empresa.jsx",
      "GerenciarSafras.jsx",
      "Fornecedores.jsx",
      "Produtos.jsx",
      "AtivosFixos.jsx",
      "GerenciarCidades.jsx",
      "PopularCidades.jsx",
      "UnidadesMedida.jsx",
      "Categorias.jsx",
      "LocaisEstoque.jsx",
      "CentrosCusto.jsx",
      "Usuarios.jsx",
      "RelatorioPesagens.jsx",
      "RelatorioCustosSafra.jsx",
      "RelatorioEstoque.jsx",
      "RelatorioHistoricoEntregas.jsx",
      "RelatorioFinanceiro.jsx",
      "RelatorioFornecedores.jsx",
      "RelatorioProdutos.jsx",
      "ConfiguracoesGerais.jsx",
      "Backup.jsx"
    ]
  },
  "Components - Pesagens": {
    arquivos: [
      "components/pesagens/FormularioPesagem.jsx",
      "components/pesagens/TabelaPesagens.jsx",
      "components/pesagens/TicketPesagem.jsx"
    ]
  },
  "Components - Fornecedores": {
    arquivos: [
      "components/fornecedores/FormularioFornecedor.jsx",
      "components/fornecedores/TabelaFornecedores.jsx",
      "components/fornecedores/FichaFornecedor.jsx"
    ]
  },
  "Components - Produtos": {
    arquivos: [
      "components/produtos/FormularioProduto.jsx",
      "components/produtos/TabelaProdutos.jsx",
      "components/produtos/FichaProduto.jsx"
    ]
  },
  "Components - Custos": {
    arquivos: [
      "components/custos/FormularioCusto.jsx",
      "components/custos/TabelaCustos.jsx",
      "components/custos/LancarEntrega.jsx"
    ]
  },
  "Components - Movimentações": {
    arquivos: [
      "components/movimentacoes/FormularioMovimentacao.jsx",
      "components/movimentacoes/TabelaMovimentacoes.jsx",
      "components/movimentacoes/ImportarNFeMovimentacao.jsx",
      "components/movimentacoes/ImportarNFeXML.jsx"
    ]
  },
  "Components - Financeiro": {
    arquivos: [
      "components/financeiro/FormularioFinanceiro.jsx",
      "components/financeiro/FormularioCompraFinanceiro.jsx",
      "components/financeiro/TabelaFinanceiro.jsx",
      "components/financeiro/BaixaFinanceira.jsx",
      "components/financeiro/ImportarNFeFinanceiro.jsx",
      "components/financeiro/DialogCadastroRapido.jsx",
      "components/financeiro/AutocompleteGenerico.jsx",
      "components/financeiro/ComboboxFornecedor.jsx"
    ]
  },
  "Components - Empresa": {
    arquivos: [
      "components/empresa/FormularioEmpresa.jsx",
      "components/empresa/TabelaEmpresas.jsx"
    ]
  },
  "Entities": {
    arquivos: [
      "entities/Pesagem.json",
      "entities/Fornecedor.json",
      "entities/Produto.json",
      "entities/UnidadeMedida.json",
      "entities/Categoria.json",
      "entities/LocalEstoque.json",
      "entities/Empresa.json",
      "entities/Safra.json",
      "entities/CustoSafra.json",
      "entities/HistoricoEntrega.json",
      "entities/MovimentacaoEstoque.json",
      "entities/CentroCusto.json",
      "entities/LancamentoFinanceiro.json",
      "entities/BaixaFinanceira.json",
      "entities/PlanoContas.json",
      "entities/GrupoFinanceiro.json",
      "entities/FormaPagamento.json",
      "entities/LivroFiscal.json",
      "entities/Cidade.json",
      "entities/ContaBancaria.json",
      "entities/MovimentacaoBancaria.json",
      "entities/AtivoFixo.json"
    ]
  }
};

export default function Backup() {
  const [copiando, setCopiando] = useState(null);

  const getTotalArquivos = () => {
    return Object.values(ARQUIVOS_SISTEMA).reduce((total, grupo) => total + grupo.arquivos.length, 0);
  };

  const handleCopyToClipboard = async (arquivo) => {
    setCopiando(arquivo);
    try {
      await navigator.clipboard.writeText(arquivo);
      toast.success(`${arquivo} copiado!`);
      setTimeout(() => setCopiando(null), 2000);
    } catch (error) {
      toast.error('Erro ao copiar');
      setCopiando(null);
    }
  };

  const handleDownloadListaTXT = () => {
    const linhas = ['# BACKUP - LISTA DE ARQUIVOS DO SISTEMA', '', `Data: ${new Date().toLocaleString('pt-BR')}`, `Total: ${getTotalArquivos()} arquivos`, '', ''];
    
    Object.entries(ARQUIVOS_SISTEMA).forEach(([grupo, dados]) => {
      linhas.push(`## ${grupo} (${dados.arquivos.length} arquivos)`);
      linhas.push('');
      dados.arquivos.forEach(arquivo => {
        linhas.push(`- ${arquivo}`);
      });
      linhas.push('');
    });

    linhas.push('', '## INSTRUÇÕES PARA BACKUP MANUAL', '');
    linhas.push('1. Acesse o Base44 Dashboard');
    linhas.push('2. Para cada arquivo acima, faça o download via interface');
    linhas.push('3. Mantenha a estrutura de pastas');
    linhas.push('4. Para entities, exporte também os dados do banco');
    linhas.push('');

    const conteudo = linhas.join('\n');
    const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup_lista_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast.success('✅ Lista baixada!');
  };

  const handleCopyAllPaths = () => {
    const paths = [];
    Object.values(ARQUIVOS_SISTEMA).forEach(grupo => {
      paths.push(...grupo.arquivos);
    });
    
    navigator.clipboard.writeText(paths.join('\n'));
    toast.success(`${paths.length} caminhos copiados!`);
  };

  const [exportando, setExportando] = useState(false);
  const [importandoJson, setImportandoJson] = useState(false);
  const inputJsonRef = useRef(null);

  const [showImport, setShowImport] = useState(false);
  const [importPercent, setImportPercent] = useState(0);
  const [importStage, setImportStage] = useState("");
  const [importLogs, setImportLogs] = useState([]);
  const progressTimerRef = useRef(null);
  const [replaceAll, setReplaceAll] = useState(false);

  const baixarBackupJSON = async () => {
    try {
      setExportando(true);
      const res = await base44.functions.invoke('exportAllData');
      const blob = new Blob([JSON.stringify(res.data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_dados_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Backup de dados exportado com sucesso');
    } catch (e) {
      toast.error('Falha ao exportar backup');
    } finally {
      setExportando(false);
    }
  };





  const handleImport = async (file, type) => {
    try {
      setShowImport(true);
      setImportStage('Preparando arquivo...');
      setImportPercent(5);
      setImportLogs([]);

      if (type === 'json') {
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const dataObj = parsed.data || parsed;
          if (dataObj && typeof dataObj === 'object') {
            const entities = Object.keys(dataObj).filter(k => Array.isArray(dataObj[k]));
            const total = entities.reduce((s, k) => s + (dataObj[k]?.length || 0), 0);
            setImportLogs(prev => [
              ...prev,
              `Encontradas ${entities.length} entidades, ${total} registros.`
            ]);
          }
        } catch (_) {}
      }

      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      progressTimerRef.current = setInterval(() => {
        setImportPercent((p) => (p < 90 ? p + 1 : p));
      }, 500);

      setImportStage('Enviando arquivo...');
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      setImportStage('Importando registros no servidor...');
      const empresaId = localStorage.getItem('empresa_selecionada_id') || null;
      const payload = type === 'json'
        ? { json_url: file_url, mode: replaceAll ? 'replace' : 'append', target_empresa_id: empresaId }
        : { zip_url: file_url, mode: replaceAll ? 'replace' : 'append', target_empresa_id: empresaId };

      const res = await base44.functions.invoke('importBackup', payload);
      const summary = res.data?.summary || {};
      const imported = summary.imported || {};
      const errors = summary.errors || {};

      const logs = [];
      Object.keys(imported).forEach((e) => logs.push(`${e}: ${imported[e]} importados`));
      Object.keys(errors).forEach((e) => logs.push(`${e}: erro - ${errors[e]}`));

      if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
      setImportStage('Finalizando...');
      setImportPercent(100);
      setImportLogs((prev) => [...prev, ...logs]);
      toast.success('Importação concluída');
    } catch (e) {
      if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
      setImportStage('Falha na importação');
      toast.error('Falha ao importar');
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Backup do Sistema</h1>
          <p className="text-xs text-slate-600">Lista completa de arquivos do projeto</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button 
            onClick={baixarBackupJSON}
            className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs"
            size="sm"
            disabled={exportando}
          >
            <Download className="w-3.5 h-3.5 mr-2" />
            {exportando ? 'Exportando...' : 'Exportar Dados (.json)'}
          </Button
           <Button 
             onClick={() => inputJsonRef.current?.click()}
             className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs"
             size="sm"
             disabled={importandoJson}
           >
            <Download className="w-3.5 h-3.5 mr-2" />
            {importandoJson ? 'Importando...' : 'Importar Dados (.json)'}
          </Button>
          <div className="flex items-center gap-2 ml-2">
            <Checkbox id="replaceAll" checked={replaceAll} onCheckedChange={(v) => setReplaceAll(!!v)} />
            <label htmlFor="replaceAll" className="text-xs text-slate-700">Substituir tudo</label>
          </div>

          <Button 
            onClick={handleCopyAllPaths} 
            variant="outline"
            size="sm"
            className="h-8 text-xs"
          >
            <Copy className="w-3.5 h-3.5 mr-2" />
            Copiar Todos
          </Button>
          <Button 
            onClick={handleDownloadListaTXT}
            className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs"
            size="sm"
          >
            <Download className="w-3.5 h-3.5 mr-2" />
            Baixar Lista (.txt)
          </Button>
        </div>
        </div>


        <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Sincronização de Importação</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-slate-600">{importStage || 'Preparando...'}</div>
            <div className="flex items-center gap-2">
              <Progress value={importPercent} className="h-2 w-full" />
              <span className="text-xs w-10 text-right">{importPercent}%</span>
            </div>
            <div className="max-h-40 overflow-auto border rounded p-2 bg-white">
              {importLogs.length === 0 ? (
                <div className="text-xs text-slate-500">Aguarde...</div>
              ) : (
                importLogs.map((l, i) => (
                  <div key={i} className="text-xs">{l}</div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <input type="file" ref={inputJsonRef} accept="application/json" className="hidden" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImportandoJson(true);
        await handleImport(file, 'json');
        setImportandoJson(false);
        e.target.value = '';
      }} />


      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded">
                <FileCode className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{getTotalArquivos()}</p>
                <p className="text-xs text-slate-600">Arquivos</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded">
                <Folder className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{Object.keys(ARQUIVOS_SISTEMA).length}</p>
                <p className="text-xs text-slate-600">Grupos</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded">
                <Database className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">
                  {ARQUIVOS_SISTEMA.Entities.arquivos.length}
                </p>
                <p className="text-xs text-slate-600">Entidades</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded">
                <FileCode className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">
                  {ARQUIVOS_SISTEMA.Pages.arquivos.length}
                </p>
                <p className="text-xs text-slate-600">Páginas</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="bg-slate-50 border-b py-3">
          <CardTitle className="text-sm font-semibold">Estrutura do Projeto</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="space-y-6">
            {Object.entries(ARQUIVOS_SISTEMA).map(([grupo, dados]) => (
              <div key={grupo} className="border rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Folder className="w-4 h-4 text-slate-600" />
                    <h3 className="font-semibold text-sm text-slate-900">{grupo}</h3>
                    <Badge variant="outline" className="text-xs">
                      {dados.arquivos.length} arquivo(s)
                    </Badge>
                  </div>
                </div>
                <div className="divide-y">
                  {dados.arquivos.map((arquivo) => (
                    <div key={arquivo} className="px-4 py-2 flex items-center justify-between hover:bg-slate-50">
                      <div className="flex items-center gap-2">
                        <FileCode className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-xs font-mono text-slate-700">{arquivo}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopyToClipboard(arquivo)}
                        className="h-6 px-2"
                      >
                        {copiando === arquivo ? (
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex gap-3">
            <div className="text-blue-600 mt-0.5">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-sm text-blue-900 mb-1">⚠️ Como fazer backup completo</h4>
              <ul className="text-xs text-blue-800 space-y-1 list-disc pl-4">
                <li>Baixe a lista de arquivos clicando no botão acima</li>
                <li>Use o Base44 Dashboard para fazer download de cada arquivo</li>
                <li>Para backup de dados, você pode usar o botão "Exportar Dados (.json)" acima</li>
                <li>Salve tudo em local seguro (ex: Google Drive, Dropbox)</li>
                <li>Recomendamos fazer backups semanais</li>
                <li>Para restaurar, reimporte os arquivos via Base44 Dashboard</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}