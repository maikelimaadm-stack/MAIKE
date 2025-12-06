import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings, Eye, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createPageUrl } from "@/utils";
import EditorVisualPanel from "@/components/editor/EditorVisualPanel";

const AVAILABLE_PAGES = [
  { id: "Home", name: "Dashboard" },
  { id: "Pesagens", name: "Pesagens" },
  { id: "LancamentoPesagensIndividuais", name: "Lançamento de Pesagens" },
  { id: "PesagensIndividuais", name: "Pesagens Individuais" },
  { id: "RelatorioPesagensIndividuais", name: "Relatório Pesagens Individuais" },
  { id: "CustosSafra", name: "Custos de Safra" },
  { id: "MovimentacoesEstoque", name: "Movimentações Estoque" },
  { id: "LancamentoFinanceiro", name: "Lançamento Financeiro" },
  { id: "Fornecedores", name: "Fornecedores" },
  { id: "Produtos", name: "Produtos" },
].sort((a, b) => a.name.localeCompare(b.name));

export default function EditorVisualSistema() {
  const [selectedPage, setSelectedPage] = useState("");
  const [showEditor, setShowEditor] = useState(false);

  const ativarEditor = () => {
    if (!selectedPage) {
      toast.error('Selecione uma página primeiro!');
      return;
    }
    setShowEditor(true);
    toast.success('Editor ativado! Clique em elementos para editar.');
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        <Card>
          <CardHeader className="py-3 px-4 bg-slate-100 border-b">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Settings className="w-5 h-5 text-emerald-600" />
              Editor Visual Interativo
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-4">
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-4">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">1. Selecione a Página para Editar</Label>
                      <Select value={selectedPage} onValueChange={setSelectedPage}>
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Escolha uma página" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {AVAILABLE_PAGES.map(page => (
                            <SelectItem key={page.id} value={page.id} className="text-sm">
                              {page.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {selectedPage && (
                      <>
                        <div className="pt-2 border-t">
                          <Label className="text-xs font-semibold">2. Abrir Página em Modo de Edição</Label>
                          <p className="text-xs text-slate-600 mb-2">Clique nos elementos para editá-los</p>
                          <Button 
                            onClick={abrirPagina}
                            className="h-9 text-sm gap-2 bg-emerald-600 hover:bg-emerald-700 w-full"
                          >
                            <Eye className="w-4 h-4" />
                            Abrir e Começar a Editar
                          </Button>
                        </div>

                        {editMode && (
                          <div className="p-3 bg-green-50 border border-green-200 rounded">
                            <p className="text-xs text-green-800 font-medium mb-1">✅ Modo de Edição Ativo</p>
                            <p className="text-xs text-green-700">
                              Vá até a aba da página e clique nos elementos para editá-los aqui.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {selectedElement && (
                <Card className="bg-slate-50 border-2 border-emerald-500">
                  <CardHeader className="py-2 px-3 border-b bg-emerald-50">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <MousePointer className="w-4 h-4 text-emerald-600" />
                        Editando: {selectedElement.tag}
                        {selectedElement.text && (
                          <span className="text-xs text-slate-600 font-normal">
                            "{selectedElement.text.substring(0, 30)}..."
                          </span>
                        )}
                      </CardTitle>
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
                  <CardContent className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <h4 className="text-xs font-semibold text-slate-700">Cores</h4>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">Cor de Fundo</Label>
                          <div className="flex gap-2">
                            <Input 
                              type="color" 
                              value={elementProps.backgroundColor || '#ffffff'}
                              onChange={(e) => setElementProps({...elementProps, backgroundColor: e.target.value})}
                              className="h-8 w-16"
                            />
                            <Input 
                              value={elementProps.backgroundColor || ''}
                              onChange={(e) => setElementProps({...elementProps, backgroundColor: e.target.value})}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Cor do Texto</Label>
                          <div className="flex gap-2">
                            <Input 
                              type="color" 
                              value={elementProps.color || '#000000'}
                              onChange={(e) => setElementProps({...elementProps, color: e.target.value})}
                              className="h-8 w-16"
                            />
                            <Input 
                              value={elementProps.color || ''}
                              onChange={(e) => setElementProps({...elementProps, color: e.target.value})}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h4 className="text-xs font-semibold text-slate-700">Espaçamento</h4>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">Padding (Interno)</Label>
                          <Input 
                            value={elementProps.padding || ''}
                            onChange={(e) => setElementProps({...elementProps, padding: e.target.value})}
                            className="h-8 text-xs"
                            placeholder="8px"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Margin (Externo)</Label>
                          <Input 
                            value={elementProps.margin || ''}
                            onChange={(e) => setElementProps({...elementProps, margin: e.target.value})}
                            className="h-8 text-xs"
                            placeholder="4px"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Arredondamento</Label>
                          <Select 
                            value={elementProps.borderRadius || ''}
                            onValueChange={(v) => setElementProps({...elementProps, borderRadius: v})}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Sem arredondamento</SelectItem>
                              <SelectItem value="4px">Pequeno (4px)</SelectItem>
                              <SelectItem value="8px">Médio (8px)</SelectItem>
                              <SelectItem value="12px">Grande (12px)</SelectItem>
                              <SelectItem value="9999px">Circular</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {selectedElement.tag === 'button' && (
                        <div className="space-y-3 md:col-span-2">
                          <h4 className="text-xs font-semibold text-slate-700">Ícone do Botão</h4>
                          
                          <div className="space-y-1">
                            <Label className="text-xs">Adicionar Ícone</Label>
                            <Select 
                              value={elementProps.icon || ''}
                              onValueChange={(v) => setElementProps({...elementProps, icon: v})}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Escolha um ícone" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={null}>Sem ícone</SelectItem>
                                {COMMON_ICONS.map(icon => (
                                  <SelectItem key={icon} value={icon} className="text-xs">
                                    {icon}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-4 border-t flex gap-2">
                      <Button 
                        onClick={aplicarMudancas}
                        className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 flex-1"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Aplicar Mudanças
                      </Button>
                      <Button 
                        variant="outline"
                        onClick={() => setSelectedElement(null)}
                        className="h-8 text-xs"
                      >
                        Cancelar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="bg-yellow-50 border-yellow-200">
                <CardHeader className="py-2 px-3 border-b border-yellow-300">
                  <CardTitle className="text-sm font-semibold text-yellow-800">📚 Como Usar</CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <ol className="text-xs text-yellow-800 space-y-2 list-decimal list-inside">
                    <li>Selecione a página que deseja customizar</li>
                    <li>Clique em "Abrir e Começar a Editar"</li>
                    <li>Na nova aba, passe o mouse sobre elementos (destaque verde)</li>
                    <li>Clique no elemento que deseja editar</li>
                    <li>Volte para esta aba e veja o painel de edição</li>
                    <li>Ajuste cores, espaçamentos, ícones etc</li>
                    <li>Clique em "Aplicar Mudanças" para salvar</li>
                  </ol>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}