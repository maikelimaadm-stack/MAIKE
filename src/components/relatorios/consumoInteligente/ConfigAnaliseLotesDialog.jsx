import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COLUNAS_ANALISE_LOTES } from "./colunasAnaliseLotes";

function MultiFiltro({ titulo, opcoes, selecionados, onToggle, onSelectAll, onClear, renderLabel }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          {titulo} {selecionados.length > 0 ? `(${selecionados.length})` : ''}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 max-h-96 overflow-auto">
        <div className="space-y-2">
          <div className="flex items-center justify-between sticky top-0 bg-white pb-2">
            <h4 className="text-xs font-semibold uppercase">{titulo}</h4>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={onSelectAll}>Todos</Button>
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={onClear}>Nenhum</Button>
            </div>
          </div>
          {opcoes.map((opcao) => (
            <div key={opcao} className="flex items-center gap-2">
              <Checkbox checked={selecionados.includes(opcao)} onCheckedChange={() => onToggle(opcao)} />
              <label className="text-xs cursor-pointer uppercase">{renderLabel ? renderLabel(opcao) : opcao}</label>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function ConfigAnaliseLotesDialog({
  open,
  onOpenChange,
  dataInicio,
  setDataInicio,
  dataFim,
  setDataFim,
  modoVisualizacao,
  setModoVisualizacao,
  mostrarDetalhes,
  setMostrarDetalhes,
  ordenacao,
  setOrdenacao,
  retiros,
  retirosSelecionados,
  toggleRetiro,
  selecionarTodosRetiros,
  limparRetiros,
  produtos,
  produtosSelecionados,
  toggleProduto,
  selecionarTodosProdutos,
  limparProdutos,
  lotes,
  lotesSelecionados,
  toggleLote,
  selecionarTodosLotes,
  limparLotes,
  colunasVisiveis,
  toggleColuna,
  limparFiltros,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-sm font-bold text-slate-900 uppercase">Filtros e Configurações</DialogTitle>
        </DialogHeader>
        <div className="p-6 pt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="space-y-1">
              <Label className="text-xs uppercase">Data Início</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase">Data Fim</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase">Modo</Label>
              <Select value={modoVisualizacao} onValueChange={setModoVisualizacao}>
                <SelectTrigger className="h-8 text-xs uppercase"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="resumo" className="text-xs uppercase">Resumo por Lote</SelectItem>
                  <SelectItem value="detalhado" className="text-xs uppercase">Lista Detalhada</SelectItem>
                  <SelectItem value="ambos" className="text-xs uppercase">Os Dois Modos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase">Ordenação</Label>
              <Select value={ordenacao} onValueChange={setOrdenacao}>
                <SelectTrigger className="h-8 text-xs uppercase"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="data_asc" className="text-xs uppercase">Data Crescente</SelectItem>
                  <SelectItem value="data_desc" className="text-xs uppercase">Data Decrescente</SelectItem>
                  <SelectItem value="lote_asc" className="text-xs uppercase">Lote A-Z</SelectItem>
                  <SelectItem value="consumo_desc" className="text-xs uppercase">Maior Consumo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase">Detalhes</Label>
              <Button type="button" variant={mostrarDetalhes ? "default" : "outline"} size="sm" className={`h-8 w-full text-xs uppercase ${mostrarDetalhes ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`} onClick={() => setMostrarDetalhes(!mostrarDetalhes)}>
                {mostrarDetalhes ? 'Mostrar' : 'Ocultar'}
              </Button>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <MultiFiltro titulo="Retiros" opcoes={retiros} selecionados={retirosSelecionados} onToggle={toggleRetiro} onSelectAll={selecionarTodosRetiros} onClear={limparRetiros} />
            <MultiFiltro titulo="Produtos" opcoes={produtos} selecionados={produtosSelecionados} onToggle={toggleProduto} onSelectAll={selecionarTodosProdutos} onClear={limparProdutos} />
            <MultiFiltro titulo="Lotes" opcoes={lotes} selecionados={lotesSelecionados} onToggle={toggleLote} onSelectAll={selecionarTodosLotes} onClear={limparLotes} />
          </div>

          <div className="rounded-xl border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase">Colunas Visíveis</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {COLUNAS_ANALISE_LOTES.map((coluna) => (
                <div key={coluna.id} className="flex items-center gap-2">
                  <Checkbox checked={colunasVisiveis.includes(coluna.id)} onCheckedChange={() => toggleColuna(coluna.id)} />
                  <label className="text-xs uppercase cursor-pointer">{coluna.label}</label>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={limparFiltros}>Limpar Filtros</Button>
            <Button type="button" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => onOpenChange(false)}>Aplicar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}