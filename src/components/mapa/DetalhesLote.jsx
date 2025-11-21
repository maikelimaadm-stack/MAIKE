import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Move, Weight, Calendar, Users, TrendingUp, Activity } from "lucide-react";

export default function DetalhesLote({ lote, onClose }) {
  return (
    <div className="space-y-4 mt-4">
      <div className="bg-emerald-50 border border-emerald-200 rounded p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h3 className="text-lg font-bold text-emerald-900">{lote.nome}</h3>
            <p className="text-xs text-emerald-700">Código: {lote.numero_lote}</p>
          </div>
          <Badge className="bg-emerald-600 text-white">
            {lote.quantidade_cabecas} cabeças
          </Badge>
        </div>
        
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="bg-white rounded p-2">
            <div className="text-[10px] text-slate-500">Categoria</div>
            <div className="text-xs font-semibold">{lote.categoria || 'N/A'}</div>
          </div>
          <div className="bg-white rounded p-2">
            <div className="text-[10px] text-slate-500">Sexo</div>
            <div className="text-xs font-semibold">{lote.sexo || 'N/A'}</div>
          </div>
          <div className="bg-white rounded p-2">
            <div className="text-[10px] text-slate-500">Peso Médio</div>
            <div className="text-xs font-semibold">{lote.peso_medio_kg ? `${lote.peso_medio_kg} kg` : 'N/A'}</div>
          </div>
          <div className="bg-white rounded p-2">
            <div className="text-[10px] text-slate-500">Idade Média</div>
            <div className="text-xs font-semibold">{lote.idade_media_meses ? `${lote.idade_media_meses} meses` : 'N/A'}</div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-700">Informações Adicionais</div>
        
        <div className="bg-white border rounded p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600">Área Atual:</span>
            <span className="font-semibold">{lote.area_atual_nome || 'N/A'}</span>
          </div>
          {lote.raca_predominante && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">Raça:</span>
              <span className="font-semibold">{lote.raca_predominante}</span>
            </div>
          )}
          {lote.sistema_produtivo && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">Sistema:</span>
              <span className="font-semibold">{lote.sistema_produtivo}</span>
            </div>
          )}
          {lote.data_entrada && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">Data Entrada:</span>
              <span className="font-semibold">{new Date(lote.data_entrada).toLocaleDateString()}</span>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-700">Ações Rápidas</div>
        
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="outline" className="h-9 text-xs">
            <Move className="w-3 h-3 mr-1" />
            Movimentar
          </Button>
          <Button size="sm" variant="outline" className="h-9 text-xs">
            <Weight className="w-3 h-3 mr-1" />
            Pesar
          </Button>
          <Button size="sm" variant="outline" className="h-9 text-xs">
            <Activity className="w-3 h-3 mr-1" />
            Mudar Categoria
          </Button>
          <Button size="sm" variant="outline" className="h-9 text-xs">
            <Calendar className="w-3 h-3 mr-1" />
            Evento Sanitário
          </Button>
        </div>
      </div>

      {lote.observacoes && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-slate-700">Observações</div>
          <div className="bg-slate-50 rounded p-2 text-xs text-slate-600">
            {lote.observacoes}
          </div>
        </div>
      )}
    </div>
  );
}