import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Settings, X, MousePointer, Type, Palette, Move, Image, Plus,
  Save, Trash2, Eye, EyeOff, Upload
} from "lucide-react";
import { toast } from "sonner";

const COMMON_ICONS = [
  'Plus', 'Save', 'Trash2', 'Edit2', 'Eye', 'Download', 'Upload', 
  'Search', 'Filter', 'X', 'Check', 'AlertCircle', 'Calendar',
  'User', 'Settings', 'FileText', 'Home', 'ChevronDown', 'ChevronRight'
];

export default function EditorVisualPanel({ onClose }) {
  const [selectedElement, setSelectedElement] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: 20, y: 20 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [elementProps, setElementProps] = useState({
    text: '',
    backgroundColor: '',
    color: '',
    padding: '',
    margin: '',
    fontSize: '',
    icon: '',
  });

  useEffect(() => {
    // Ativar modo de edição
    document.body.style.cursor = 'crosshair';
    
    // Criar overlay de destaque
    const overlay = document.createElement('div');
    overlay.id = 'visual-editor-highlight';
    overlay.style.cssText = `
      position: absolute;
      border: 2px solid #10b981;
      background: rgba(16, 185, 129, 0.1);
      pointer-events: none;
      transition: all 0.1s;
      z-index: 999998;
      display: none;
    `;
    document.body.appendChild(overlay);

    const label = document.createElement('div');
    label.id = 'visual-editor-label';
    label.style.cssText = `
      position: absolute;
      background: #10b981;
      color: white;
      padding: 2px 8px;
      font-size: 10px;
      font-weight: bold;
      border-radius: 3px;
      z-index: 999998;
      display: none;
    `;
    document.body.appendChild(label);

    // Handler de mouseover
    const handleMouseOver = (e) => {
      if (e.target.closest('#visual-editor-panel')) return;
      if (e.target.closest('#visual-editor-highlight')) return;
      if (e.target.closest('#visual-editor-label')) return;
      
      const rect = e.target.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.left = (rect.left + window.scrollX) + 'px';
      overlay.style.top = (rect.top + window.scrollY) + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
      
      label.style.display = 'block';
      label.style.left = (rect.left + window.scrollX) + 'px';
      label.style.top = (rect.top + window.scrollY - 22) + 'px';
      label.textContent = e.target.tagName.toLowerCase();
    };

    // Handler de click
    const handleClick = (e) => {
      if (e.target.closest('#visual-editor-panel')) return;
      if (e.target.closest('#visual-editor-highlight')) return;
      if (e.target.closest('#visual-editor-label')) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const element = e.target;
      element.setAttribute('data-editor-selected', 'true');
      
      setSelectedElement(element);
      
      const computedStyle = window.getComputedStyle(element);
      setElementProps({
        text: element.textContent || '',
        backgroundColor: rgbToHex(computedStyle.backgroundColor),
        color: rgbToHex(computedStyle.color),
        padding: computedStyle.padding,
        margin: computedStyle.margin,
        fontSize: computedStyle.fontSize,
        icon: '',
      });
      
      toast.success('Elemento selecionado! Edite no painel.');
    };

    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('click', handleClick, true);

    return () => {
      document.body.style.cursor = '';
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('click', handleClick, true);
      overlay?.remove();
      label?.remove();
    };
  }, []);

  const rgbToHex = (rgb) => {
    if (!rgb || rgb === 'transparent') return '#ffffff';
    const result = rgb.match(/\d+/g);
    if (!result) return '#ffffff';
    return '#' + result.map(x => {
      const hex = parseInt(x).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  };

  const aplicarMudancas = () => {
    if (!selectedElement) return;
    
    if (elementProps.text) {
      selectedElement.textContent = elementProps.text;
    }
    if (elementProps.backgroundColor) {
      selectedElement.style.backgroundColor = elementProps.backgroundColor;
    }
    if (elementProps.color) {
      selectedElement.style.color = elementProps.color;
    }
    if (elementProps.padding) {
      selectedElement.style.padding = elementProps.padding;
    }
    if (elementProps.margin) {
      selectedElement.style.margin = elementProps.margin;
    }
    if (elementProps.fontSize) {
      selectedElement.style.fontSize = elementProps.fontSize;
    }
    
    toast.success('Mudanças aplicadas!');
  };

  const removerElemento = () => {
    if (!selectedElement) return;
    if (confirm('Remover este elemento?')) {
      selectedElement.remove();
      setSelectedElement(null);
      toast.success('Elemento removido!');
    }
  };

  const handlePanelMouseDown = (e) => {
    if (e.target.closest('.panel-content')) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX - panelPosition.x,
      y: e.clientY - panelPosition.y
    });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPanelPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragStart]);

  return (
    <div
      id="visual-editor-panel"
      style={{
        position: 'fixed',
        left: panelPosition.x,
        top: panelPosition.y,
        zIndex: 999999,
        maxWidth: '400px',
        cursor: isDragging ? 'grabbing' : 'default'
      }}
    >
      <Card className="shadow-2xl border-2 border-emerald-500">
        <CardHeader 
          className="py-2 px-3 bg-emerald-600 text-white cursor-grab active:cursor-grabbing"
          onMouseDown={handlePanelMouseDown}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Editor Visual
            </CardTitle>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6 text-white hover:bg-emerald-700"
              onClick={onClose}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-3 panel-content bg-white max-h-[80vh] overflow-auto">
          {!selectedElement ? (
            <div className="text-center py-8 text-slate-500">
              <MousePointer className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium mb-1">Clique em um elemento</p>
              <p className="text-xs">Passe o mouse e clique para editar</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-2 bg-emerald-50 border border-emerald-200 rounded">
                <p className="text-xs font-semibold text-emerald-800">
                  {selectedElement.tagName.toLowerCase()}
                </p>
              </div>

              {/* Texto */}
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <Type className="w-3 h-3" />
                  Texto
                </Label>
                <Input 
                  value={elementProps.text}
                  onChange={(e) => setElementProps({...elementProps, text: e.target.value})}
                  className="h-8 text-xs"
                  placeholder="Texto do elemento"
                />
              </div>

              {/* Cor de Fundo */}
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <Palette className="w-3 h-3" />
                  Cor de Fundo
                </Label>
                <div className="flex gap-2">
                  <Input 
                    type="color" 
                    value={elementProps.backgroundColor}
                    onChange={(e) => setElementProps({...elementProps, backgroundColor: e.target.value})}
                    className="h-8 w-16"
                  />
                  <Input 
                    value={elementProps.backgroundColor}
                    onChange={(e) => setElementProps({...elementProps, backgroundColor: e.target.value})}
                    className="h-8 flex-1 text-xs"
                  />
                </div>
              </div>

              {/* Cor do Texto */}
              <div className="space-y-1">
                <Label className="text-xs">Cor do Texto</Label>
                <div className="flex gap-2">
                  <Input 
                    type="color" 
                    value={elementProps.color}
                    onChange={(e) => setElementProps({...elementProps, color: e.target.value})}
                    className="h-8 w-16"
                  />
                  <Input 
                    value={elementProps.color}
                    onChange={(e) => setElementProps({...elementProps, color: e.target.value})}
                    className="h-8 flex-1 text-xs"
                  />
                </div>
              </div>

              {/* Tamanho da Fonte */}
              <div className="space-y-1">
                <Label className="text-xs">Tamanho da Fonte</Label>
                <Input 
                  value={elementProps.fontSize}
                  onChange={(e) => setElementProps({...elementProps, fontSize: e.target.value})}
                  className="h-8 text-xs"
                  placeholder="14px"
                />
              </div>

              {/* Padding */}
              <div className="space-y-1">
                <Label className="text-xs">Espaçamento Interno (Padding)</Label>
                <Input 
                  value={elementProps.padding}
                  onChange={(e) => setElementProps({...elementProps, padding: e.target.value})}
                  className="h-8 text-xs"
                  placeholder="8px"
                />
              </div>

              {/* Margin */}
              <div className="space-y-1">
                <Label className="text-xs">Espaçamento Externo (Margin)</Label>
                <Input 
                  value={elementProps.margin}
                  onChange={(e) => setElementProps({...elementProps, margin: e.target.value})}
                  className="h-8 text-xs"
                  placeholder="4px"
                />
              </div>

              {/* Ícone (se for botão) */}
              {selectedElement.tagName === 'BUTTON' && (
                <div className="space-y-1">
                  <Label className="text-xs">Adicionar Ícone</Label>
                  <Select 
                    value={elementProps.icon}
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
              )}

              {/* Botões de Ação */}
              <div className="pt-3 border-t space-y-2">
                <Button 
                  onClick={aplicarMudancas}
                  className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 w-full"
                >
                  <Save className="w-3.5 h-3.5" />
                  Aplicar Mudanças
                </Button>
                
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    variant="outline"
                    onClick={() => setSelectedElement(null)}
                    className="h-8 text-xs gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Desselecionar
                  </Button>
                  
                  <Button 
                    variant="destructive"
                    onClick={removerElemento}
                    className="h-8 text-xs gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remover
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}