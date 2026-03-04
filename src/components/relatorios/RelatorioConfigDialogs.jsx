import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical } from "lucide-react";

export default function RelatorioConfigDialogs({
  // Detalhes Apartação
  showConfigColunasDetalhes,
  setShowConfigColunasDetalhes,
  COLUNAS_DETALHES_APARTACAO,
  colunasDetalhesVisiveis,
  toggleColunaDetalhe,
  colunasDetalhesOrdem,
  handleDragEndDetalhes,
  
  // Vendas
  showConfigColunasVendas,
  setShowConfigColunasVendas,
  COLUNAS_DETALHES_VENDAS,
  colunasVendasVisiveis,
  toggleColunaDetalheVendas,
  colunasVendasOrdem,
  handleDragEndDetalhesVendas,
  
  // Painel Apartação/Lote
  showConfigColunasPainel,
  setShowConfigColunasPainel,
  COLUNAS_PAINEL_APARTACAO,
  colunasPainelVisiveis,
  toggleColunaPainel,
  colunasPainelOrdem,
  handleDragEndPainel,
}) {
  return (
    <>
      {/* Dialog de Configuração de Colunas de Detalhes */}
      <Dialog open={showConfigColunasDetalhes} onOpenChange={setShowConfigColunasDetalhes}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas de Detalhes</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-2 gap-2">
                {COLUNAS_DETALHES_APARTACAO.map((coluna) => (
                  <label key={coluna.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <input
                      type="checkbox"
                      checked={colunasDetalhesVisiveis.includes(coluna.id)}
                      onChange={() => toggleColunaDetalhe(coluna.id)}
                      className="rounded"
                    />
                    <span>{coluna.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs text-slate-600 font-semibold mb-2">Ordem (arraste para reordenar)</p>
              <DragDropContext onDragEnd={handleDragEndDetalhes}>
                <Droppable droppableId="colunas-detalhes">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
                      {colunasDetalhesOrdem.map((colunaId, index) => {
                        const coluna = COLUNAS_DETALHES_APARTACAO.find(c => c.id === colunaId);
                        if (!coluna) return null;
                        return (
                          <Draggable key={colunaId} draggableId={colunaId} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`flex items-center gap-2 p-2 border rounded text-xs ${snapshot.isDragging ? 'bg-emerald-50 border-emerald-300' : 'bg-white'} ${!colunasDetalhesVisiveis.includes(colunaId) ? 'opacity-50' : ''}`}
                              >
                                <GripVertical className="w-4 h-4 text-slate-400" />
                                <span className="flex-1">{coluna.label}</span>
                                {colunasDetalhesVisiveis.includes(colunaId) && (
                                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Visível</span>
                                )}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => setShowConfigColunasDetalhes(false)} size="sm" className="h-7 text-xs">Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog de Configuração de Colunas de Detalhes - Vendas */}
      <Dialog open={showConfigColunasVendas} onOpenChange={setShowConfigColunasVendas}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas de Detalhes (Vendas)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-2 gap-2">
                {COLUNAS_DETALHES_VENDAS.map((coluna) => (
                  <label key={coluna.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <input
                      type="checkbox"
                      checked={colunasVendasVisiveis.includes(coluna.id)}
                      onChange={() => toggleColunaDetalheVendas(coluna.id)}
                      className="rounded"
                    />
                    <span>{coluna.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs text-slate-600 font-semibold mb-2">Ordem (arraste para reordenar)</p>
              <DragDropContext onDragEnd={handleDragEndDetalhesVendas}>
                <Droppable droppableId="colunas-detalhes-vendas">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
                      {colunasVendasOrdem.map((colunaId, index) => {
                        const coluna = COLUNAS_DETALHES_VENDAS.find(c => c.id === colunaId);
                        if (!coluna) return null;
                        return (
                          <Draggable key={colunaId} draggableId={colunaId} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`flex items-center gap-2 p-2 border rounded text-xs ${snapshot.isDragging ? 'bg-emerald-50 border-emerald-300' : 'bg-white'} ${!colunasVendasVisiveis.includes(colunaId) ? 'opacity-50' : ''}`}
                              >
                                <GripVertical className="w-4 h-4 text-slate-400" />
                                <span className="flex-1">{coluna.label}</span>
                                {colunasVendasVisiveis.includes(colunaId) && (
                                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Visível</span>
                                )}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => setShowConfigColunasVendas(false)} size="sm" className="h-7 text-xs">Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog de Configuração de Colunas do Painel (Apartação/Lote) */}
      <Dialog open={showConfigColunasPainel} onOpenChange={setShowConfigColunasPainel}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas do Painel (Apartação/Lote)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-2 gap-2">
                {COLUNAS_PAINEL_APARTACAO.map((coluna) => (
                  <label key={coluna.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <input
                      type="checkbox"
                      checked={colunasPainelVisiveis.includes(coluna.id)}
                      onChange={() => toggleColunaPainel(coluna.id)}
                      className="rounded"
                    />
                    <span>{coluna.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs text-slate-600 font-semibold mb-2">Ordem (arraste para reordenar)</p>
              <DragDropContext onDragEnd={handleDragEndPainel}>
                <Droppable droppableId="colunas-painel">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
                      {colunasPainelOrdem.map((colunaId, index) => {
                        const coluna = COLUNAS_PAINEL_APARTACAO.find(c => c.id === colunaId);
                        if (!coluna) return null;
                        return (
                          <Draggable key={colunaId} draggableId={colunaId} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`flex items-center gap-2 p-2 border rounded text-xs ${snapshot.isDragging ? 'bg-emerald-50 border-emerald-300' : 'bg-white'} ${!colunasPainelVisiveis.includes(colunaId) ? 'opacity-50' : ''}`}
                              >
                                <GripVertical className="w-4 h-4 text-slate-400" />
                                <span className="flex-1">{coluna.label}</span>
                                {colunasPainelVisiveis.includes(colunaId) && (
                                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Visível</span>
                                )}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => setShowConfigColunasPainel(false)} size="sm" className="h-7 text-xs">Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}