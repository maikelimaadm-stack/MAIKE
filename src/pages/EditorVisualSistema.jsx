import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
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
      {showEditor && <EditorVisualPanel onClose={() => setShowEditor(false)} />}
      
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader className="py-3 px-4 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white border-b">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Editor Visual - Edite Qualquer Página
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-6">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Página para Editar</Label>
                <Select value={selectedPage} onValueChange={setSelectedPage}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Escolha a página que deseja customizar" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {AVAILABLE_PAGES.map(page => (
                      <SelectItem key={page.id} value={page.id}>
                        {page.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedPage && (
                <Button 
                  onClick={ativarEditor}
                  size="lg"
                  className="w-full h-12 text-base gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  <Sparkles className="w-5 h-5" />
                  Ativar Editor Visual Nesta Página
                </Button>
              )}

              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-blue-900 mb-3">🎨 Como Usar o Editor:</h3>
                  <ol className="text-sm text-blue-800 space-y-2 list-decimal list-inside">
                    <li>Selecione a página que deseja editar acima</li>
                    <li>Clique em "Ativar Editor Visual"</li>
                    <li>Um painel flutuante aparecerá na tela</li>
                    <li>Passe o mouse sobre qualquer elemento (destaque verde)</li>
                    <li>Clique no elemento para selecioná-lo</li>
                    <li>Edite cores, textos, tamanhos, espaçamentos no painel</li>
                    <li>Clique em "Aplicar Mudanças" para ver em tempo real</li>
                    <li>Arraste o painel verde para movê-lo</li>
                  </ol>
                </CardContent>
              </Card>

              <Card className="bg-slate-50">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">✨ Recursos do Editor:</h3>
                  <ul className="text-xs text-slate-600 space-y-1">
                    <li>✓ Editar textos de botões e elementos</li>
                    <li>✓ Mudar cores de fundo e texto</li>
                    <li>✓ Ajustar espaçamentos (padding e margin)</li>
                    <li>✓ Mudar tamanho de fontes</li>
                    <li>✓ Adicionar ícones em botões</li>
                    <li>✓ Remover elementos indesejados</li>
                    <li>✓ Painel flutuante e móvel</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}