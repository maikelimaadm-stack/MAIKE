import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Palette, Square, Type, Layout, Sparkles, Download, Upload, RotateCcw, Eye, Plus, Filter, Trash2, Circle, X } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_CONFIG = {
  theme: {
    primaryColor: "#059669",
    primaryHover: "#047857",
    secondaryColor: "#64748b",
    destructiveColor: "#dc2626",
    backgroundColor: "#f8fafc",
    cardBackground: "#ffffff",
    textPrimary: "#0f172a",
    textSecondary: "#64748b",
    borderColor: "#e2e8f0",
    borderRadius: "6px",
    fontSize: "14px",
  },
  buttons: {
    primary: {
      bgColor: "#059669",
      hoverColor: "#047857",
      textColor: "#ffffff",
      height: "32px",
      fontSize: "12px",
      padding: "0 12px",
      borderRadius: "6px",
      showIcon: true,
      iconSize: "14px",
    },
    secondary: {
      bgColor: "transparent",
      hoverColor: "#f1f5f9",
      textColor: "#64748b",
      borderColor: "#cbd5e1",
      height: "32px",
      fontSize: "12px",
      padding: "0 12px",
      borderRadius: "6px",
      showIcon: true,
      iconSize: "14px",
    },
    destructive: {
      bgColor: "#dc2626",
      hoverColor: "#b91c1c",
      textColor: "#ffffff",
      height: "32px",
      fontSize: "12px",
      padding: "0 12px",
      borderRadius: "6px",
      showIcon: true,
      iconSize: "14px",
    },
  },
  tables: {
    headerBg: "#000000",
    headerText: "#ffffff",
    headerBorder: "#000000",
    cellBorder: "#d1d5db",
    cellPadding: "4px 8px",
    fontSize: "12px",
    hoverBg: "#f9fafb",
    stripedRows: false,
    stripedBg: "#f8fafc",
  },
  forms: {
    labelFontSize: "12px",
    labelColor: "#475569",
    inputHeight: "32px",
    inputFontSize: "12px",
    inputBorderColor: "#cbd5e1",
    inputFocusBorder: "#059669",
    spacing: "16px",
  },
  layout: {
    maxWidth: "1600px",
    headerHeight: "60px",
    navHeight: "40px",
    contentPadding: "24px",
    cardPadding: "16px",
    cardShadow: "0 1px 3px 0 rgb(0 0 0 / 0.1)",
  },
};

export default function EditorVisualSistema() {
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem('visual_config');
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });
  
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    localStorage.setItem('visual_config', JSON.stringify(config));
    applyStyles();
  }, [config]);

  const applyStyles = () => {
    const root = document.documentElement;
    root.style.setProperty('--primary-color', config.theme.primaryColor);
    root.style.setProperty('--primary-hover', config.theme.primaryHover);
    root.style.setProperty('--bg-color', config.theme.backgroundColor);
    root.style.setProperty('--card-bg', config.theme.cardBackground);
    root.style.setProperty('--text-primary', config.theme.textPrimary);
    root.style.setProperty('--text-secondary', config.theme.textSecondary);
    root.style.setProperty('--border-color', config.theme.borderColor);
  };

  const updateConfig = (path, value) => {
    setConfig(prev => {
      const newConfig = { ...prev };
      const keys = path.split('.');
      let current = newConfig;
      
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
      }
      
      current[keys[keys.length - 1]] = value;
      return newConfig;
    });
  };

  const resetConfig = () => {
    if (confirm('Resetar todas as configurações para o padrão?')) {
      setConfig(DEFAULT_CONFIG);
      toast.success('Configurações resetadas!');
    }
  };

  const exportConfig = () => {
    const dataStr = JSON.stringify(config, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', 'visual-config.json');
    linkElement.click();
    toast.success('Configuração exportada!');
  };

  const importConfig = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        setConfig(imported);
        toast.success('Configuração importada!');
      } catch (error) {
        toast.error('Erro ao importar arquivo');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-emerald-600" />
              Editor Visual do Sistema
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Personalize completamente a aparência do seu sistema
            </p>
          </div>
          
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setPreviewMode(!previewMode)}>
              <Eye className="w-3.5 h-3.5 mr-1" />
              {previewMode ? 'Editar' : 'Preview'}
            </Button>
            
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportConfig}>
              <Download className="w-3.5 h-3.5 mr-1" />
              Exportar
            </Button>
            
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => document.getElementById('import-config').click()}>
              <Upload className="w-3.5 h-3.5 mr-1" />
              Importar
            </Button>
            <input id="import-config" type="file" accept=".json" onChange={importConfig} className="hidden" />
            
            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={resetConfig}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Resetar
            </Button>
          </div>
        </div>

        {previewMode ? (
          <PreviewArea config={config} />
        ) : (
          <Tabs defaultValue="theme" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="theme">
                <Palette className="w-4 h-4 mr-2" />
                Tema
              </TabsTrigger>
              <TabsTrigger value="buttons">
                <Square className="w-4 h-4 mr-2" />
                Botões
              </TabsTrigger>
              <TabsTrigger value="tables">Tabelas</TabsTrigger>
              <TabsTrigger value="forms">
                <Type className="w-4 h-4 mr-2" />
                Formulários
              </TabsTrigger>
              <TabsTrigger value="layout">
                <Layout className="w-4 h-4 mr-2" />
                Layout
              </TabsTrigger>
            </TabsList>

            <TabsContent value="theme" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Cores do Sistema</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-4">
                  {Object.entries({
                    primaryColor: 'Cor Primária',
                    primaryHover: 'Cor Primária Hover',
                    secondaryColor: 'Cor Secundária',
                    destructiveColor: 'Cor Destrutiva',
                    backgroundColor: 'Cor de Fundo',
                    cardBackground: 'Fundo de Cards',
                    textPrimary: 'Texto Primário',
                    textSecondary: 'Texto Secundário',
                    borderColor: 'Cor de Borda',
                  }).map(([key, label]) => (
                    <div key={key} className="space-y-2">
                      <Label className="text-xs">{label}</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={config.theme[key]}
                          onChange={(e) => updateConfig(`theme.${key}`, e.target.value)}
                          className="w-16 h-8"
                        />
                        <Input
                          value={config.theme[key]}
                          onChange={(e) => updateConfig(`theme.${key}`, e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  ))}

                  <div className="space-y-2">
                    <Label className="text-xs">Raio de Borda</Label>
                    <Input value={config.theme.borderRadius} onChange={(e) => updateConfig('theme.borderRadius', e.target.value)} className="h-8 text-xs" placeholder="6px" />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Tamanho de Fonte Base</Label>
                    <Input value={config.theme.fontSize} onChange={(e) => updateConfig('theme.fontSize', e.target.value)} className="h-8 text-xs" placeholder="14px" />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="buttons" className="space-y-4">
              {['primary', 'secondary', 'destructive'].map(type => (
                <Card key={type}>
                  <CardHeader>
                    <CardTitle className="text-sm capitalize">Botão {type === 'primary' ? 'Primário' : type === 'secondary' ? 'Secundário' : 'Destrutivo'}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-4 gap-4">
                    {['bgColor', 'hoverColor', 'textColor'].map(prop => (
                      <div key={prop} className="space-y-2">
                        <Label className="text-xs">{prop === 'bgColor' ? 'Cor de Fundo' : prop === 'hoverColor' ? 'Cor Hover' : 'Cor do Texto'}</Label>
                        <div className="flex gap-2">
                          <Input type="color" value={config.buttons[type][prop]} onChange={(e) => updateConfig(`buttons.${type}.${prop}`, e.target.value)} className="w-16 h-8" />
                          <Input value={config.buttons[type][prop]} onChange={(e) => updateConfig(`buttons.${type}.${prop}`, e.target.value)} className="h-8 text-xs" />
                        </div>
                      </div>
                    ))}

                    <div className="space-y-2">
                      <Label className="text-xs">Altura</Label>
                      <Input value={config.buttons[type].height} onChange={(e) => updateConfig(`buttons.${type}.height`, e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Tamanho Fonte</Label>
                      <Input value={config.buttons[type].fontSize} onChange={(e) => updateConfig(`buttons.${type}.fontSize`, e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Padding</Label>
                      <Input value={config.buttons[type].padding} onChange={(e) => updateConfig(`buttons.${type}.padding`, e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Mostrar Ícone</Label>
                      <Switch checked={config.buttons[type].showIcon} onCheckedChange={(checked) => updateConfig(`buttons.${type}.showIcon`, checked)} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="tables" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Estilo de Tabelas</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-4">
                  {['headerBg', 'headerText', 'headerBorder', 'cellBorder', 'hoverBg', 'stripedBg'].map(prop => (
                    <div key={prop} className="space-y-2">
                      <Label className="text-xs">{prop.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</Label>
                      <div className="flex gap-2">
                        <Input type="color" value={config.tables[prop]} onChange={(e) => updateConfig(`tables.${prop}`, e.target.value)} className="w-16 h-8" />
                        <Input value={config.tables[prop]} onChange={(e) => updateConfig(`tables.${prop}`, e.target.value)} className="h-8 text-xs" />
                      </div>
                    </div>
                  ))}
                  <div className="space-y-2">
                    <Label className="text-xs">Padding das Células</Label>
                    <Input value={config.tables.cellPadding} onChange={(e) => updateConfig('tables.cellPadding', e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Linhas Zebradas</Label>
                    <Switch checked={config.tables.stripedRows} onCheckedChange={(checked) => updateConfig('tables.stripedRows', checked)} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="forms" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Estilo de Formulários</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-4">
                  {['labelColor', 'inputBorderColor', 'inputFocusBorder'].map(prop => (
                    <div key={prop} className="space-y-2">
                      <Label className="text-xs">{prop.replace(/([A-Z])/g, ' $1')}</Label>
                      <div className="flex gap-2">
                        <Input type="color" value={config.forms[prop]} onChange={(e) => updateConfig(`forms.${prop}`, e.target.value)} className="w-16 h-8" />
                        <Input value={config.forms[prop]} onChange={(e) => updateConfig(`forms.${prop}`, e.target.value)} className="h-8 text-xs" />
                      </div>
                    </div>
                  ))}
                  <div className="space-y-2">
                    <Label className="text-xs">Tamanho Fonte Label</Label>
                    <Input value={config.forms.labelFontSize} onChange={(e) => updateConfig('forms.labelFontSize', e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Altura do Input</Label>
                    <Input value={config.forms.inputHeight} onChange={(e) => updateConfig('forms.inputHeight', e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Espaçamento</Label>
                    <Input value={config.forms.spacing} onChange={(e) => updateConfig('forms.spacing', e.target.value)} className="h-8 text-xs" />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="layout" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Configurações de Layout</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-4">
                  {Object.keys(config.layout).map(key => (
                    <div key={key} className="space-y-2">
                      <Label className="text-xs">{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</Label>
                      <Input value={config.layout[key]} onChange={(e) => updateConfig(`layout.${key}`, e.target.value)} className="h-8 text-xs" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

function PreviewArea({ config }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Preview - Botões</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          <button style={{ backgroundColor: config.buttons.primary.bgColor, color: config.buttons.primary.textColor, height: config.buttons.primary.height, fontSize: config.buttons.primary.fontSize, padding: config.buttons.primary.padding, borderRadius: config.buttons.primary.borderRadius }} className="rounded font-medium">
            {config.buttons.primary.showIcon && <Plus style={{ width: config.buttons.primary.iconSize, height: config.buttons.primary.iconSize, display: 'inline', marginRight: '4px' }} />}
            Botão Primário
          </button>

          <button style={{ backgroundColor: config.buttons.secondary.bgColor, color: config.buttons.secondary.textColor, height: config.buttons.secondary.height, fontSize: config.buttons.secondary.fontSize, padding: config.buttons.secondary.padding, borderRadius: config.buttons.secondary.borderRadius, border: `1px solid ${config.buttons.secondary.borderColor || '#cbd5e1'}` }} className="rounded font-medium">
            {config.buttons.secondary.showIcon && <Filter style={{ width: config.buttons.secondary.iconSize, height: config.buttons.secondary.iconSize, display: 'inline', marginRight: '4px' }} />}
            Botão Secundário
          </button>

          <button style={{ backgroundColor: config.buttons.destructive.bgColor, color: config.buttons.destructive.textColor, height: config.buttons.destructive.height, fontSize: config.buttons.destructive.fontSize, padding: config.buttons.destructive.padding, borderRadius: config.buttons.destructive.borderRadius }} className="rounded font-medium">
            {config.buttons.destructive.showIcon && <Trash2 style={{ width: config.buttons.destructive.iconSize, height: config.buttons.destructive.iconSize, display: 'inline', marginRight: '4px' }} />}
            Botão Destrutivo
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Preview - Tabela</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Coluna 1', 'Coluna 2', 'Coluna 3'].map(col => (
                  <th key={col} style={{ backgroundColor: config.tables.headerBg, color: config.tables.headerText, border: `1px solid ${config.tables.headerBorder}`, padding: config.tables.cellPadding, fontSize: config.tables.fontSize }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map(i => (
                <tr key={i} style={{ backgroundColor: config.tables.stripedRows && i % 2 === 0 ? config.tables.stripedBg : 'transparent' }}>
                  {[1, 2, 3].map(j => (
                    <td key={j} style={{ border: `1px solid ${config.tables.cellBorder}`, padding: config.tables.cellPadding, fontSize: config.tables.fontSize }}>Dado {i}-{j}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}