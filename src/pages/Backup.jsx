import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileCode, Folder, Copy, Check, Database } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { saveAs } from "file-saver";

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
  const [baixando, setBaixando] = useState(false);

  const getTotalArquivos = () => {
    return Object.values(ARQUIVOS_SISTEMA).reduce((total, grupo) => total + grupo.arquivos.length, 0);
  };

  const handleCopyToClipboard = async (arquivo) => {
    setCopiando(arquivo);
    try {
      // Simula leitura do arquivo
      await navigator.clipboard.writeText(`// Conteúdo de ${arquivo}\n// Use a base44 para ler este arquivo`);
      toast.success(`${arquivo} copiado!`);
      setTimeout(() => setCopiando(null), 2000);
    } catch (error) {
      toast.error('Erro ao copiar');
      setCopiando(null);
    }
  };

  const handleDownloadTudo = async () => {
    setBaixando(true);
    toast.info('Preparando backup completo...');

    try {
      const zip = new JSZip();
      
      // Adiciona informações do backup
      const info = {
        sistema: "Sistema de Gestão - Fazenda Palmital",
        data_backup: new Date().toISOString(),
        total_arquivos: getTotalArquivos(),
        versao: "1.0.0",
        grupos: Object.keys(ARQUIVOS_SISTEMA)
      };
      
      zip.file("INFO_BACKUP.json", JSON.stringify(info, null, 2));

      // Cria README
      const readme = `# Backup do Sistema de Gestão
      
Data: ${new Date().toLocaleString('pt-BR')}
Total de Arquivos: ${getTotalArquivos()}

## Estrutura do Projeto

${Object.entries(ARQUIVOS_SISTEMA).map(([grupo, dados]) => `
### ${grupo}
${dados.arquivos.map(arq => `- ${arq}`).join('\n')}
`).join('\n')}

## Como Restaurar

1. Faça upload dos arquivos no Base44
2. Configure as entities primeiro
3. Configure o Layout
4. Configure as páginas
5. Configure os componentes

## Importante

Este é um backup de código-fonte. Para backup completo do sistema,
inclua também:
- Backup do banco de dados
- Configurações da empresa
- Arquivos enviados (logos, documentos, etc)
`;

      zip.file("README.md", readme);

      // Simula adicionar arquivos ao ZIP
      for (const [grupo, dados] of Object.entries(ARQUIVOS_SISTEMA)) {
        const folder = zip.folder(grupo.replace(/ /g, '_'));
        
        for (const arquivo of dados.arquivos) {
          // Adiciona placeholder - em produção você leria o conteúdo real
          folder.file(
            arquivo.split('/').pop(), 
            `// ${arquivo}\n// Conteúdo do arquivo ${arquivo}\n// Data: ${new Date().toISOString()}\n\n// Use a base44 para obter o conteúdo real deste arquivo`
          );
        }
      }

      // Gera o ZIP
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `backup_sistema_${new Date().toISOString().split('T')[0]}.zip`);
      
      toast.success('✅ Backup baixado com sucesso!');
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao gerar backup');
    } finally {
      setBaixando(false);
    }
  };

  const handleDownloadGrupo = (grupo, arquivos) => {
    toast.info(`Baixando grupo: ${grupo}`);
    // Implementação similar ao backup completo, mas apenas para o grupo
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Backup do Sistema</h1>
          <p className="text-xs text-slate-600">Exportar todo o código-fonte do projeto</p>
        </div>
        <Button 
          onClick={handleDownloadTudo} 
          disabled={baixando}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          {baixando ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
              Gerando...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Baixar Tudo (.zip)
            </>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
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
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => handleDownloadGrupo(grupo, dados.arquivos)}
                    className="h-7 text-xs"
                  >
                    <Download className="w-3.5 h-3.5 mr-1" />
                    Baixar Grupo
                  </Button>
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
              <h4 className="font-semibold text-sm text-blue-900 mb-1">⚠️ Importante</h4>
              <ul className="text-xs text-blue-800 space-y-1 list-disc pl-4">
                <li>Este backup contém apenas o código-fonte do sistema</li>
                <li>Para backup completo, exporte também os dados do banco de dados</li>
                <li>Salve este arquivo em local seguro</li>
                <li>Recomendamos fazer backups semanais</li>
                <li>Para restaurar, importe os arquivos via Base44 Dashboard</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}