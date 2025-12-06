import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings, Eye, Code, Save, RotateCcw, Download, Upload, Layers, MousePointer, Move, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

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
  theme: {
    primaryColor: "#10b981",
    secondaryColor: "#6b7280",
    dangerColor: "#ef4444",
    backgroundColor: "#f8fafc",
    textColor: "#1e293b",
  },
  buttons: {
    primaryBg: "bg-emerald-600",
    primaryHover: "hover:bg-emerald-700",
    secondaryVariant: "outline",
    size: "sm",
    iconSize: "w-3.5 h-3.5",
  },
  tables: {
    headerBg: "bg-slate-100",
    headerBorder: "border-black",
    cellBorder: "border-gray-300",
    rowHover: "hover:bg-gray-50",
  },
  pages: {},
};

export default function EditorVisualSistema() {
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem('visual_editor_config');
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });

  const [selectedPage, setSelectedPage] = useState("");
  const [selectedElement, setSelectedElement] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    localStorage.setItem('visual_editor_config', JSON.stringify(config));
    aplicarEstilos();
  }, [config]);

  const aplicarEstilos = () => {
    const root = document.documentElement;
    root.style.setProperty('--primary-color', config.theme.primaryColor);
    root.style.setProperty('--secondary-color', config.theme.secondaryColor);
    root.style.setProperty('--danger-color', config.theme.dangerColor);
    root.style.setProperty('--bg-color', config.theme.backgroundColor);
    root.style.setProperty('--text-color', config.theme.textColor);
  };

  const resetarConfig = () => {
    if (confirm('Deseja resetar todas as configurações para o padrão?')) {
      setConfig(DEFAULT_CONFIG);
      localStorage.removeItem('visual_editor_config');
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
          toast.error('Erro ao importar arquivo!');
        }
      };
      reader.readAsText(file);
    }
  };

  const iniciarEdicaoPagina = () => {
    if (!selectedPage) {
      toast.error('Selecione uma página primeiro!');
      return;
    }
    setEditMode(true);
    toast.info('Modo de edição ativado! Clique nos elementos para editá-los.');
  };

  const salvarEdicaoPagina = () => {
    setEditMode(false);
    toast.success('Edições salvas!');
  };

  const updateTheme = (key, value) => {
    setConfig(prev => ({
      ...prev,
      theme: { ...prev.theme, [key]: value }
    }));
  };

  const updateButtons = (key, value) => {
    setConfig(prev => ({
      ...prev,
      buttons: { ...prev.buttons, [key]: value }
    }));
  };

  const updateTables = (key, value) => {
    setConfig(prev => ({
      ...prev,
      tables: { ...prev.tables, [key]: value }
    }));
  };

  const updatePageElement = (elementId, properties) => {
    setConfig(prev => ({
      ...prev,
      pages: {
        ...prev.pages,
        [selectedPage]: {
          ...prev.pages[selectedPage],
          elements: {
            ...(prev.pages[selectedPage]?.elements || {}),
            [elementId]: properties
          }
        }
      }
    }));
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
          <Tabs defaultValue="theme" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="theme" className="text-xs">Tema Global</TabsTrigger>
              <TabsTrigger value="pages" className="text-xs">Editor de Páginas</TabsTrigger>
              <TabsTrigger value="components" className="text-xs">Componentes</TabsTrigger>
              <TabsTrigger value="preview" className="text-xs">Preview</TabsTrigger>
            </TabsList>

            {/* TAB TEMA GLOBAL */}
            <TabsContent value="theme" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="bg-slate-50">
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-sm font-semibold">Cores do Sistema</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Cor Primária</Label>
                      <div className="flex gap-2">
                        <Input 
                          type="color" 
                          value={config.theme.primaryColor} 
                          onChange={(e) => updateTheme('primaryColor', e.target.value)}
                          className="h-8 w-16"
                        />
                        <Input 
                          value={config.theme.primaryColor} 
                          onChange={(e) => updateTheme('primaryColor', e.target.value)}
                          className="h-8 flex-1 text-xs"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Cor Secundária</Label>
                      <div className="flex gap-2">
                        <Input 
                          type="color" 
                          value={config.theme.secondaryColor} 
                          onChange={(e) => updateTheme('secondaryColor', e.target.value)}
                          className="h-8 w-16"
                        />
                        <Input 
                          value={config.theme.secondaryColor} 
                          onChange={(e) => updateTheme('secondaryColor', e.target.value)}
                          className="h-8 flex-1 text-xs"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Cor de Perigo</Label>
                      <div className="flex gap-2">
                        <Input 
                          type="color" 
                          value={config.theme.dangerColor} 
                          onChange={(e) => updateTheme('dangerColor', e.target.value)}
                          className="h-8 w-16"
                        />
                        <Input 
                          value={config.theme.dangerColor} 
                          onChange={(e) => updateTheme('dangerColor', e.target.value)}
                          className="h-8 flex-1 text-xs"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Cor de Fundo</Label>
                      <div className="flex gap-2">
                        <Input 
                          type="color" 
                          value={config.theme.backgroundColor} 
                          onChange={(e) => updateTheme('backgroundColor', e.target.value)}
                          className="h-8 w-16"
                        />
                        <Input 
                          value={config.theme.backgroundColor} 
                          onChange={(e) => updateTheme('backgroundColor', e.target.value)}
                          className="h-8 flex-1 text-xs"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-slate-50">
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-sm font-semibold">Padrões de Botões</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Background Primário</Label>
                      <Input 
                        value={config.buttons.primaryBg} 
                        onChange={(e) => updateButtons('primaryBg', e.target.value)}
                        className="h-8 text-xs"
                        placeholder="bg-emerald-600"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Hover Primário</Label>
                      <Input 
                        value={config.buttons.primaryHover} 
                        onChange={(e) => updateButtons('primaryHover', e.target.value)}
                        className="h-8 text-xs"
                        placeholder="hover:bg-emerald-700"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Tamanho Padrão</Label>
                      <Select value={config.buttons.size} onValueChange={(v) => updateButtons('size', v)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="xs">Extra Pequeno (xs)</SelectItem>
                          <SelectItem value="sm">Pequeno (sm)</SelectItem>
                          <SelectItem value="default">Médio (default)</SelectItem>
                          <SelectItem value="lg">Grande (lg)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-slate-50">
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-sm font-semibold">Padrões de Tabelas</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Background do Cabeçalho</Label>
                      <Input 
                        value={config.tables.headerBg} 
                        onChange={(e) => updateTables('headerBg', e.target.value)}
                        className="h-8 text-xs"
                        placeholder="bg-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Borda do Cabeçalho</Label>
                      <Input 
                        value={config.tables.headerBorder} 
                        onChange={(e) => updateTables('headerBorder', e.target.value)}
                        className="h-8 text-xs"
                        placeholder="border-black"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Borda das Células</Label>
                      <Input 
                        value={config.tables.cellBorder} 
                        onChange={(e) => updateTables('cellBorder', e.target.value)}
                        className="h-8 text-xs"
                        placeholder="border-gray-300"
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* TAB EDITOR DE PÁGINAS */}
            <TabsContent value="pages" className="space-y-4 mt-4">
              <Card className="bg-blue-50 border-blue-200">
                <CardHeader className="py-2 px-3">
                  <CardTitle className="text-sm font-semibold text-blue-800 flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    Editor Visual de Páginas
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Selecione a Página para Editar</Label>
                    <Select value={selectedPage} onValueChange={setSelectedPage}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Escolha uma página" />
                      </SelectTrigger>
                      <SelectContent>
                        {AVAILABLE_PAGES.map(page => (
                          <SelectItem key={page.id} value={page.id}>
                            {page.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedPage && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        {!editMode ? (
                          <Button 
                            size="sm" 
                            onClick={iniciarEdicaoPagina}
                            className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                          >
                            <MousePointer className="w-3.5 h-3.5" />
                            Iniciar Edição Visual
                          </Button>
                        ) : (
                          <>
                            <Button 
                              size="sm" 
                              onClick={salvarEdicaoPagina}
                              className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                            >
                              <Save className="w-3.5 h-3.5" />
                              Salvar Edições
                            </Button>
                            <Button 
                              variant="outline"
                              size="sm" 
                              onClick={() => setEditMode(false)}
                              className="h-8 text-xs gap-1"
                            >
                              Cancelar
                            </Button>
                          </>
                        )}
                      </div>

                      {editMode && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                          <p className="text-xs text-yellow-800 font-medium">
                            ⚡ Modo de Edição Ativo
                          </p>
                          <p className="text-xs text-yellow-700 mt-1">
                            • Clique em qualquer elemento na página para selecioná-lo<br/>
                            • Use o painel de propriedades para editar cores, tamanhos, etc<br/>
                            • Arraste elementos para reposicioná-los
                          </p>
                        </div>
                      )}

                      {selectedElement && (
                        <Card className="bg-slate-50 mt-3">
                          <CardHeader className="py-2 px-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-sm font-semibold">Propriedades do Elemento</CardTitle>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6"
                                onClick={() => setSelectedElement(null)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent className="p-3 space-y-3">
                            <div className="space-y-1">
                              <Label className="text-xs">ID do Elemento</Label>
                              <Input 
                                value={selectedElement.id} 
                                disabled
                                className="h-8 text-xs bg-slate-200"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Cor de Fundo</Label>
                              <Input 
                                type="color" 
                                className="h-8"
                                onChange={(e) => {
                                  updatePageElement(selectedElement.id, {
                                    ...selectedElement.properties,
                                    backgroundColor: e.target.value
                                  });
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Cor do Texto</Label>
                              <Input 
                                type="color" 
                                className="h-8"
                                onChange={(e) => {
                                  updatePageElement(selectedElement.id, {
                                    ...selectedElement.properties,
                                    color: e.target.value
                                  });
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Classes CSS Personalizadas</Label>
                              <Input 
                                placeholder="bg-blue-500 text-white p-4"
                                className="h-8 text-xs"
                                onChange={(e) => {
                                  updatePageElement(selectedElement.id, {
                                    ...selectedElement.properties,
                                    customClasses: e.target.value
                                  });
                                }}
                              />
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-slate-50">
                <CardHeader className="py-2 px-3">
                  <CardTitle className="text-sm font-semibold">Instruções de Uso</CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <ol className="text-xs text-slate-700 space-y-2">
                    <li>1. Selecione a página que deseja customizar</li>
                    <li>2. Clique em "Iniciar Edição Visual"</li>
                    <li>3. Navegue até a página selecionada em outra aba</li>
                    <li>4. Clique nos elementos para editá-los</li>
                    <li>5. Volte aqui e ajuste as propriedades no painel</li>
                    <li>6. Salve as alterações</li>
                  </ol>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB COMPONENTES */}
            <TabsContent value="components" className="space-y-4 mt-4">
              <Card className="bg-slate-50">
                <CardHeader className="py-2 px-3">
                  <CardTitle className="text-sm font-semibold">Biblioteca de Componentes</CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <p className="text-xs text-slate-600">
                    Em breve: Biblioteca de componentes reutilizáveis que você pode arrastar para suas páginas.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB PREVIEW */}
            <TabsContent value="preview" className="space-y-4 mt-4">
              <Card className="bg-slate-50">
                <CardHeader className="py-2 px-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    Preview das Configurações
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="space-y-4 p-4 rounded border" style={{
                    backgroundColor: config.theme.backgroundColor,
                    color: config.theme.textColor
                  }}>
                    <h3 className="text-sm font-semibold">Exemplos de Botões</h3>
                    <div className="flex gap-2 flex-wrap">
                      <Button 
                        size={config.buttons.size}
                        className={`${config.buttons.primaryBg} ${config.buttons.primaryHover} text-white`}
                      >
                        Botão Primário
                      </Button>
                      <Button 
                        variant={config.buttons.secondaryVariant}
                        size={config.buttons.size}
                      >
                        Botão Secundário
                      </Button>
                      <Button 
                        variant="destructive"
                        size={config.buttons.size}
                      >
                        Botão Excluir
                      </Button>
                    </div>

                    <h3 className="text-sm font-semibold mt-6">Exemplo de Tabela</h3>
                    <div className="border rounded overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className={config.tables.headerBg}>
                          <tr>
                            <th className={`p-2 text-left border ${config.tables.headerBorder}`}>Coluna 1</th>
                            <th className={`p-2 text-left border ${config.tables.headerBorder}`}>Coluna 2</th>
                            <th className={`p-2 text-left border ${config.tables.headerBorder}`}>Coluna 3</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className={config.tables.rowHover}>
                            <td className={`p-2 border ${config.tables.cellBorder}`}>Dado 1</td>
                            <td className={`p-2 border ${config.tables.cellBorder}`}>Dado 2</td>
                            <td className={`p-2 border ${config.tables.cellBorder}`}>Dado 3</td>
                          </tr>
                          <tr className={config.tables.rowHover}>
                            <td className={`p-2 border ${config.tables.cellBorder}`}>Dado 4</td>
                            <td className={`p-2 border ${config.tables.cellBorder}`}>Dado 5</td>
                            <td className={`p-2 border ${config.tables.cellBorder}`}>Dado 6</td>
                          </tr>
                        </tbody>
                      </table>
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