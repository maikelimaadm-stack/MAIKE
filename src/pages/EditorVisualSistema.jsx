import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings, Eye, Save, RotateCcw, Download, Upload, Palette, Type, Layout as LayoutIcon, Square } from "lucide-react";
import { toast } from "sonner";
import { createPageUrl } from "@/utils";

const AVAILABLE_PAGES = [
  { id: "Home", name: "Dashboard" },
  { id: "Pesagens", name: "Pesagens" },
  { id: "LancamentoPesagensIndividuais", name: "Lançamento de Pesagens" },
  { id: "PesagensIndividuais", name: "Pesagens Individuais" },
  { id: "RelatorioPesagensIndividuais", name: "Relatório Pesagens Individuais" },
  { id: "CustosSafra", name: "Custos de Safra" },
  { id: "RelatorioCustosSafra", name: "Relatório Custos Safra" },
  { id: "MovimentacoesEstoque", name: "Movimentações Estoque" },
  { id: "RelatorioEstoque", name: "Relatório Estoque" },
  { id: "LancamentoFinanceiro", name: "Lançamento Financeiro" },
  { id: "RelatorioFinanceiro", name: "Relatório Financeiro" },
  { id: "CaixaBancos", name: "Caixa & Bancos" },
  { id: "FluxoCaixa", name: "Fluxo de Caixa" },
  { id: "LivroCaixa", name: "Livro-Caixa" },
  { id: "Fornecedores", name: "Fornecedores" },
  { id: "Produtos", name: "Produtos" },
  { id: "Empresa", name: "Empresa" },
  { id: "GerenciarSafras", name: "Safras" },
  { id: "Usuarios", name: "Usuários" },
  { id: "CotacoesPecuaria", name: "Cotações de Produtos" },
  { id: "LotesAnimaisCotacao", name: "Lotes de Animais" },
  { id: "AplicacoesMedicamentos", name: "Aplicações de Medicamentos" },
  { id: "SimulacaoResultados", name: "Simulação de Resultados" },
  { id: "ControlePecuaria", name: "Controle de Pecuária" },
  { id: "CadastroLotes", name: "Cadastro de Lotes" },
  { id: "MapaGeral", name: "Mapa Geral" },
  { id: "MapaCadastro", name: "Mapa Cadastro" },
  { id: "DashboardSuplementacao", name: "Dashboard Suplementação" },
  { id: "CadastroMaquinas", name: "Cadastro de Máquinas" },
  { id: "OperacoesAgricolas", name: "Operações Agrícolas" },
  { id: "ConfiguracoesGerais", name: "Configurações Gerais" },
  { id: "FichasPersonalizadas", name: "Fichas Personalizadas" },
].sort((a, b) => a.name.localeCompare(b.name));

const DEFAULT_CONFIG = {
  globalStyles: {
    // Cores principais
    primaryColor: "#10b981",
    primaryHover: "#059669",
    secondaryColor: "#6b7280",
    dangerColor: "#ef4444",
    backgroundColor: "#f8fafc",
    textColor: "#1e293b",
    borderColor: "#e2e8f0",
    
    // Tipografia
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSizeBase: "14px",
    fontSizeSmall: "12px",
    fontSizeLarge: "16px",
    
    // Espaçamentos
    paddingBase: "1rem",
    marginBase: "1rem",
    borderRadius: "0.5rem",
    
    // Botões
    buttonHeight: "2rem",
    buttonPadding: "0.5rem 1rem",
    buttonFontSize: "12px",
    
    // Tabelas
    tableHeaderBg: "#f1f5f9",
    tableHeaderBorder: "1px solid #000",
    tableCellBorder: "1px solid #d1d5db",
    tableRowHover: "#f9fafb",
    
    // Cards
    cardBg: "#ffffff",
    cardBorder: "1px solid #e2e8f0",
    cardShadow: "0 1px 3px rgba(0,0,0,0.1)",
  },
  pageStyles: {},
};

export default function EditorVisualSistema() {
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem('visual_editor_config_v2');
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });

  const [selectedPage, setSelectedPage] = useState("");
  const [activeTab, setActiveTab] = useState("global");
  const iframeRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('visual_editor_config_v2', JSON.stringify(config));
    aplicarEstilos();
  }, [config]);

  const aplicarEstilos = () => {
    const root = document.documentElement;
    const styles = config.globalStyles;
    
    // Aplicar variáveis CSS globais
    root.style.setProperty('--editor-primary', styles.primaryColor);
    root.style.setProperty('--editor-primary-hover', styles.primaryHover);
    root.style.setProperty('--editor-secondary', styles.secondaryColor);
    root.style.setProperty('--editor-danger', styles.dangerColor);
    root.style.setProperty('--editor-bg', styles.backgroundColor);
    root.style.setProperty('--editor-text', styles.textColor);
    root.style.setProperty('--editor-border', styles.borderColor);
    root.style.setProperty('--editor-font-family', styles.fontFamily);
    root.style.setProperty('--editor-font-size', styles.fontSizeBase);
    root.style.setProperty('--editor-button-height', styles.buttonHeight);
    root.style.setProperty('--editor-card-bg', styles.cardBg);
    
    // Criar CSS customizado
    let customCSS = `
      /* Estilos Globais do Editor Visual */
      body {
        background-color: ${styles.backgroundColor} !important;
        color: ${styles.textColor} !important;
        font-family: ${styles.fontFamily} !important;
      }
      
      .bg-emerald-600 {
        background-color: ${styles.primaryColor} !important;
      }
      
      .hover\\:bg-emerald-700:hover {
        background-color: ${styles.primaryHover} !important;
      }
      
      .text-emerald-600 {
        color: ${styles.primaryColor} !important;
      }
      
      button[class*="bg-emerald"] {
        background-color: ${styles.primaryColor} !important;
      }
      
      button[class*="bg-emerald"]:hover {
        background-color: ${styles.primaryHover} !important;
      }
      
      table thead {
        background-color: ${styles.tableHeaderBg} !important;
      }
      
      table th {
        border: ${styles.tableHeaderBorder} !important;
      }
      
      table td {
        border: ${styles.tableCellBorder} !important;
      }
      
      table tbody tr:hover {
        background-color: ${styles.tableRowHover} !important;
      }
      
      .card, [class*="Card"] {
        background-color: ${styles.cardBg} !important;
        border: ${styles.cardBorder} !important;
        box-shadow: ${styles.cardShadow} !important;
      }
    `;
    
    // Aplicar estilos específicos da página
    if (selectedPage && config.pageStyles[selectedPage]) {
      const pageStyles = config.pageStyles[selectedPage];
      customCSS += `
        /* Estilos da página ${selectedPage} */
        ${pageStyles.customCSS || ''}
      `;
    }
    
    // Inserir/atualizar o CSS no documento
    let styleEl = document.getElementById('visual-editor-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'visual-editor-styles';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = customCSS;
  };

  const updateGlobalStyle = (key, value) => {
    setConfig(prev => ({
      ...prev,
      globalStyles: { ...prev.globalStyles, [key]: value }
    }));
    toast.success('Estilo atualizado!');
  };

  const updatePageStyle = (key, value) => {
    if (!selectedPage) return;
    setConfig(prev => ({
      ...prev,
      pageStyles: {
        ...prev.pageStyles,
        [selectedPage]: {
          ...(prev.pageStyles[selectedPage] || {}),
          [key]: value
        }
      }
    }));
    toast.success('Estilo da página atualizado!');
  };

  const resetarConfig = () => {
    if (confirm('Deseja resetar todas as configurações?')) {
      setConfig(DEFAULT_CONFIG);
      localStorage.removeItem('visual_editor_config_v2');
      toast.success('Configurações resetadas!');
    }
  };

  const exportarConfig = () => {
    const dataStr = JSON.stringify(config, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'visual-config.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Configuração exportada!');
  };

  const importarConfig = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target.result);
          setConfig(imported);
          toast.success('Configuração importada!');
        } catch (error) {
          toast.error('Erro ao importar!');
        }
      };
      reader.readAsText(file);
    }
  };

  const abrirPaginaNovaAba = () => {
    if (!selectedPage) {
      toast.error('Selecione uma página primeiro!');
      return;
    }
    const url = createPageUrl(selectedPage);
    window.open(url, '_blank');
    toast.success('Página aberta em nova aba!');
  };

  return (
    <div className="p-4 space-y-4">
      <Card className="shadow-sm">
        <CardHeader className="py-3 px-4 bg-slate-100 border-b flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Settings className="w-5 h-5 text-emerald-600" />
            Editor Visual do Sistema
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportarConfig} className="h-8 text-xs gap-1">
              <Download className="w-3.5 h-3.5" />
              Exportar
            </Button>
            <label>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" as="span">
                <Upload className="w-3.5 h-3.5" />
                Importar
              </Button>
              <input type="file" accept=".json" onChange={importarConfig} className="hidden" />
            </label>
            <Button variant="outline" size="sm" onClick={resetarConfig} className="h-8 text-xs gap-1">
              <RotateCcw className="w-3.5 h-3.5" />
              Resetar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="global" className="text-xs">Estilos Globais</TabsTrigger>
              <TabsTrigger value="page" className="text-xs">Editar Página</TabsTrigger>
              <TabsTrigger value="preview" className="text-xs">Preview</TabsTrigger>
            </TabsList>

            {/* TAB ESTILOS GLOBAIS */}
            <TabsContent value="global" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Cores */}
                <Card className="bg-slate-50">
                  <CardHeader className="py-2 px-3 border-b">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Palette className="w-4 h-4" />
                      Cores do Sistema
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 space-y-3">
                    {[
                      { key: 'primaryColor', label: 'Cor Primária' },
                      { key: 'primaryHover', label: 'Cor Primária (Hover)' },
                      { key: 'secondaryColor', label: 'Cor Secundária' },
                      { key: 'dangerColor', label: 'Cor de Perigo' },
                      { key: 'backgroundColor', label: 'Cor de Fundo' },
                      { key: 'textColor', label: 'Cor do Texto' },
                      { key: 'borderColor', label: 'Cor das Bordas' },
                    ].map(({ key, label }) => (
                      <div key={key} className="space-y-1">
                        <Label className="text-xs">{label}</Label>
                        <div className="flex gap-2">
                          <Input 
                            type="color" 
                            value={config.globalStyles[key]} 
                            onChange={(e) => updateGlobalStyle(key, e.target.value)}
                            className="h-8 w-16"
                          />
                          <Input 
                            value={config.globalStyles[key]} 
                            onChange={(e) => updateGlobalStyle(key, e.target.value)}
                            className="h-8 flex-1 text-xs font-mono"
                          />
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Tipografia */}
                <Card className="bg-slate-50">
                  <CardHeader className="py-2 px-3 border-b">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Type className="w-4 h-4" />
                      Tipografia
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Fonte Principal</Label>
                      <Select 
                        value={config.globalStyles.fontFamily} 
                        onValueChange={(v) => updateGlobalStyle('fontFamily', v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="system-ui, -apple-system, sans-serif">System (Padrão)</SelectItem>
                          <SelectItem value="Arial, sans-serif">Arial</SelectItem>
                          <SelectItem value="'Times New Roman', serif">Times New Roman</SelectItem>
                          <SelectItem value="'Courier New', monospace">Courier New</SelectItem>
                          <SelectItem value="Georgia, serif">Georgia</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Tamanho Base</Label>
                      <Input 
                        value={config.globalStyles.fontSizeBase} 
                        onChange={(e) => updateGlobalStyle('fontSizeBase', e.target.value)}
                        className="h-8 text-xs"
                        placeholder="14px"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Tamanho Pequeno</Label>
                      <Input 
                        value={config.globalStyles.fontSizeSmall} 
                        onChange={(e) => updateGlobalStyle('fontSizeSmall', e.target.value)}
                        className="h-8 text-xs"
                        placeholder="12px"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Tabelas */}
                <Card className="bg-slate-50">
                  <CardHeader className="py-2 px-3 border-b">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <LayoutIcon className="w-4 h-4" />
                      Tabelas
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Background do Cabeçalho</Label>
                      <Input 
                        value={config.globalStyles.tableHeaderBg} 
                        onChange={(e) => updateGlobalStyle('tableHeaderBg', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Borda do Cabeçalho</Label>
                      <Input 
                        value={config.globalStyles.tableHeaderBorder} 
                        onChange={(e) => updateGlobalStyle('tableHeaderBorder', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Borda das Células</Label>
                      <Input 
                        value={config.globalStyles.tableCellBorder} 
                        onChange={(e) => updateGlobalStyle('tableCellBorder', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Cards */}
                <Card className="bg-slate-50">
                  <CardHeader className="py-2 px-3 border-b">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Square className="w-4 h-4" />
                      Cards
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Background</Label>
                      <Input 
                        value={config.globalStyles.cardBg} 
                        onChange={(e) => updateGlobalStyle('cardBg', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Borda</Label>
                      <Input 
                        value={config.globalStyles.cardBorder} 
                        onChange={(e) => updateGlobalStyle('cardBorder', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Sombra</Label>
                      <Input 
                        value={config.globalStyles.cardShadow} 
                        onChange={(e) => updateGlobalStyle('cardShadow', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* TAB EDITAR PÁGINA */}
            <TabsContent value="page" className="space-y-4 mt-4">
              <Card className="bg-blue-50 border-blue-200">
                <CardHeader className="py-2 px-3 border-b border-blue-300">
                  <CardTitle className="text-sm font-semibold text-blue-800">Selecione a Página</CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Página</Label>
                    <Select value={selectedPage} onValueChange={setSelectedPage}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Escolha uma página" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {AVAILABLE_PAGES.map(page => (
                          <SelectItem key={page.id} value={page.id} className="text-xs">
                            {page.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedPage && (
                    <>
                      <Button 
                        size="sm" 
                        onClick={abrirPaginaNovaAba}
                        className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 w-full"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Abrir Página em Nova Aba
                      </Button>

                      <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                        <p className="text-xs text-yellow-800 font-medium mb-2">💡 Como Usar:</p>
                        <ol className="text-xs text-yellow-700 space-y-1 list-decimal list-inside">
                          <li>Abra a página em nova aba</li>
                          <li>Volte aqui e ajuste os estilos</li>
                          <li>Veja as mudanças em tempo real na outra aba</li>
                          <li>CSS customizado abaixo se aplica só a esta página</li>
                        </ol>
                      </div>

                      <Card className="bg-slate-50 mt-3">
                        <CardHeader className="py-2 px-3 border-b">
                          <CardTitle className="text-sm font-semibold">CSS Customizado da Página</CardTitle>
                        </CardHeader>
                        <CardContent className="p-3">
                          <textarea
                            value={config.pageStyles[selectedPage]?.customCSS || ''}
                            onChange={(e) => updatePageStyle('customCSS', e.target.value)}
                            placeholder="/* Adicione CSS customizado aqui */
.minha-classe {
  color: red;
}"
                            className="w-full h-40 p-2 text-xs font-mono border rounded resize-none"
                          />
                        </CardContent>
                      </Card>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB PREVIEW */}
            <TabsContent value="preview" className="space-y-4 mt-4">
              <Card className="bg-slate-50">
                <CardHeader className="py-2 px-3 border-b">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    Preview dos Estilos
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="space-y-4 p-4 rounded border" style={{
                    backgroundColor: config.globalStyles.backgroundColor,
                    color: config.globalStyles.textColor,
                    fontFamily: config.globalStyles.fontFamily,
                  }}>
                    <h3 className="text-sm font-semibold">Exemplos de Botões</h3>
                    <div className="flex gap-2 flex-wrap">
                      <Button 
                        size="sm"
                        className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                      >
                        Botão Primário
                      </Button>
                      <Button 
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                      >
                        Botão Secundário
                      </Button>
                      <Button 
                        variant="destructive"
                        size="sm"
                        className="h-8 text-xs"
                      >
                        Botão Excluir
                      </Button>
                    </div>

                    <h3 className="text-sm font-semibold mt-6">Exemplo de Tabela</h3>
                    <div className="border rounded overflow-hidden">
                      <table className="w-full text-xs">
                        <thead style={{ backgroundColor: config.globalStyles.tableHeaderBg }}>
                          <tr>
                            <th className="p-2 text-left" style={{ border: config.globalStyles.tableHeaderBorder }}>Coluna 1</th>
                            <th className="p-2 text-left" style={{ border: config.globalStyles.tableHeaderBorder }}>Coluna 2</th>
                            <th className="p-2 text-left" style={{ border: config.globalStyles.tableHeaderBorder }}>Coluna 3</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr style={{ cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = config.globalStyles.tableRowHover} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                            <td className="p-2" style={{ border: config.globalStyles.tableCellBorder }}>Dado 1</td>
                            <td className="p-2" style={{ border: config.globalStyles.tableCellBorder }}>Dado 2</td>
                            <td className="p-2" style={{ border: config.globalStyles.tableCellBorder }}>Dado 3</td>
                          </tr>
                          <tr style={{ cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = config.globalStyles.tableRowHover} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                            <td className="p-2" style={{ border: config.globalStyles.tableCellBorder }}>Dado 4</td>
                            <td className="p-2" style={{ border: config.globalStyles.tableCellBorder }}>Dado 5</td>
                            <td className="p-2" style={{ border: config.globalStyles.tableCellBorder }}>Dado 6</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <h3 className="text-sm font-semibold mt-6">Exemplo de Card</h3>
                    <div 
                      className="p-4 rounded" 
                      style={{
                        backgroundColor: config.globalStyles.cardBg,
                        border: config.globalStyles.cardBorder,
                        boxShadow: config.globalStyles.cardShadow,
                      }}
                    >
                      <h4 className="font-semibold mb-2">Título do Card</h4>
                      <p className="text-xs">Conteúdo do card com texto de exemplo.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}