import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Filter, Eye, Palette, MapPin, Beef, Droplets, Trees, Weight, Scale, Calendar } from "lucide-react";

// Cores por tipo de cultura
export const CORES_TIPO_CULTURA = {
  'Pastagem': '#22c55e',
  'Agricultura': '#eab308',
  'Reserva': '#0ea5e9',
  'APP': '#06b6d4',
  'Infraestrutura': '#94a3b8',
};

// Cores por aproveitamento
export const CORES_APROVEITAMENTO = {
  'Alta': '#22c55e',
  'Média': '#f59e0b',
  'Baixa': '#ef4444',
};

// Cores por status de ocupação
export const CORES_OCUPACAO = {
  'Disponível': '#94a3b8',
  'Médio': '#f59e0b',
  'Alto': '#ef4444',
  'Sobrepastoreado': '#991b1b',
};

// Cores por faixa de UA/ha (baseado em dados Embrapa/Scot Consultoria)
// 1 UA = 450 kg PV. Usa ÁREA EFETIVA (pastejada), não área total.
// Faixas consideram pastagem tropical com margem de ~20% acima do ideal.
export const CORES_UA_HA = {
  'Sem gado': '#d1d5db',
  'Sublotação (< 0,8 UA/ha)': '#86efac',
  'Moderada (0,8 - 1,2 UA/ha)': '#22c55e',
  'Ideal (1,2 - 1,8 UA/ha)': '#3b82f6',
  'Alta (1,8 - 2,4 UA/ha)': '#f59e0b',
  'Superlotação (> 2,4 UA/ha)': '#ef4444',
};

// Cores por situação do pasto (Ocupado vs Vazio)
export const CORES_SITUACAO_PASTO = {
  'Vazio - Sem histórico': '#d1d5db',
  'Vazio - Em descanso': '#86efac',
  'Ocupado - Normal': '#3b82f6',
  'Ocupado - Atenção (> 45d)': '#f59e0b',
  'Ocupado - Crítico (> 90d)': '#ef4444',
};

// Cores por categoria de gado (genérico)
export const CORES_CATEGORIA_GADO = [
  '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#6366f1',
  '#d946ef', '#0ea5e9', '#84cc16', '#f43f5e', '#a855f7',
];

export const MODOS_COLORACAO = [
  { id: 'padrao', label: 'Padrão (cor da área)', icon: Palette },
  { id: 'tipo_cultura', label: 'Tipo de Cultura', icon: Trees },
  { id: 'aproveitamento', label: 'Aproveitamento', icon: MapPin },
  { id: 'ocupacao', label: 'Ocupação', icon: Beef },
  { id: 'categoria_gado', label: 'Categoria do Gado', icon: Beef },
  { id: 'tipo_pastagem', label: 'Tipo de Pastagem', icon: Droplets },
  { id: 'ua_ha', label: 'UA por Hectare', icon: Scale },
  { id: 'situacao_pasto', label: 'Situação do Pasto', icon: Calendar },
];

export default function MapaFiltrosAvancados({
  // Visibilidade
  showAreas, setShowAreas,
  showPontos, setShowPontos,
  showLinhas, setShowLinhas,
  showLotes, setShowLotes,
  showPontosSuplementacao, setShowPontosSuplementacao,
  showAlertas, setShowAlertas,
  showUserLocation, setShowUserLocation,
  showNomesAreas, setShowNomesAreas,
  // Filtros de lotes
  filtroCategoria, setFiltroCategoria,
  filtroStatus, setFiltroStatus,
  filtroSistema, setFiltroSistema,
  filtroPesoMin, setFiltroPesoMin,
  filtroPesoMax, setFiltroPesoMax,
  // Filtros de área
  filtroTipoCultura, setFiltroTipoCultura,
  filtroTipoPastagem, setFiltroTipoPastagem,
  // Coloração
  modoColoracao, setModoColoracao,
  // Dados para opções
  categorias = [],
  tiposPastagem = [],
  sistemasProdutivos = [],
}) {
  return (
    <div className="space-y-4 pb-4">
      {/* ─── Camadas Visíveis ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Eye className="w-4 h-4 text-slate-600" />
          <span className="text-xs font-bold text-slate-800 uppercase">Camadas</span>
        </div>
        <div className="space-y-2">
          {[
            { label: 'Áreas / Pastos', checked: showAreas, onChange: () => setShowAreas(v => !v), color: 'bg-emerald-500' },
            { label: 'Nomes das Áreas', checked: showNomesAreas, onChange: () => setShowNomesAreas(v => !v), color: 'bg-slate-400' },
            { label: 'Lotes de Gado', checked: showLotes, onChange: () => setShowLotes(v => !v), color: 'bg-purple-500' },
            { label: 'Pontos Referência', checked: showPontos, onChange: () => setShowPontos(v => !v), color: 'bg-blue-500' },
            { label: 'Linhas (cercas, rios)', checked: showLinhas, onChange: () => setShowLinhas(v => !v), color: 'bg-amber-500' },
            { label: 'Cochos / Suplementação', checked: showPontosSuplementacao, onChange: () => setShowPontosSuplementacao(v => !v), color: 'bg-teal-500' },
            { label: 'Alertas', checked: showAlertas, onChange: () => setShowAlertas(v => !v), color: 'bg-red-500' },
            { label: 'Minha Localização', checked: showUserLocation, onChange: () => setShowUserLocation(v => !v), color: 'bg-blue-600' },
          ].map(item => (
            <label key={item.label} className="flex items-center justify-between cursor-pointer hover:bg-slate-50 px-2 py-1.5 rounded-lg">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                <span className="text-xs font-medium text-slate-700">{item.label}</span>
              </div>
              <Switch checked={item.checked} onCheckedChange={item.onChange} className="scale-75" />
            </label>
          ))}
        </div>
      </div>

      <Separator />

      {/* ─── Modo de Coloração das Áreas ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Palette className="w-4 h-4 text-slate-600" />
          <span className="text-xs font-bold text-slate-800 uppercase">Colorir Áreas por</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {MODOS_COLORACAO.map(modo => {
            const Icon = modo.icon;
            const ativo = modoColoracao === modo.id;
            return (
              <Button
                key={modo.id}
                variant={ativo ? 'default' : 'outline'}
                size="sm"
                onClick={() => setModoColoracao(modo.id)}
                className={`h-8 text-[10px] gap-1 justify-start ${ativo ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
              >
                <Icon className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{modo.label}</span>
              </Button>
            );
          })}
        </div>

        {/* Legenda do modo ativo */}
        {modoColoracao !== 'padrao' && (
          <div className="mt-3 bg-slate-50 rounded-lg p-2.5 space-y-1">
            <div className="text-[10px] font-bold text-slate-600 uppercase mb-1">Legenda</div>
            {modoColoracao === 'tipo_cultura' && Object.entries(CORES_TIPO_CULTURA).map(([k, c]) => (
              <LegendaItem key={k} cor={c} label={k} />
            ))}
            {modoColoracao === 'aproveitamento' && Object.entries(CORES_APROVEITAMENTO).map(([k, c]) => (
              <LegendaItem key={k} cor={c} label={k} />
            ))}
            {modoColoracao === 'ocupacao' && Object.entries(CORES_OCUPACAO).map(([k, c]) => (
              <LegendaItem key={k} cor={c} label={k} />
            ))}
            {modoColoracao === 'categoria_gado' && (
              <div className="text-[10px] text-slate-500">Cada categoria de gado terá uma cor distinta</div>
            )}
            {modoColoracao === 'tipo_pastagem' && (
              <div className="text-[10px] text-slate-500">Cada tipo de pastagem terá uma cor distinta</div>
            )}
            {modoColoracao === 'ua_ha' && (
              <>
                {Object.entries(CORES_UA_HA).map(([k, c]) => (
                  <LegendaItem key={k} cor={c} label={k} />
                ))}
                <div className="text-[9px] text-slate-500 mt-1 italic">* Usa área efetiva (pastejada). 1 UA = 450 kg PV</div>
              </>
            )}
            {modoColoracao === 'situacao_pasto' && Object.entries(CORES_SITUACAO_PASTO).map(([k, c]) => (
              <LegendaItem key={k} cor={c} label={k} />
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* ─── Filtros de Áreas ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-600" />
          <span className="text-xs font-bold text-slate-800 uppercase">Filtros de Áreas</span>
        </div>
        <div className="space-y-2.5 px-1">
          <div>
            <Label className="text-[10px] text-slate-600">Tipo de Cultura</Label>
            <Select value={filtroTipoCultura} onValueChange={setFiltroTipoCultura}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas" className="text-xs">Todas</SelectItem>
                <SelectItem value="Pastagem" className="text-xs">Pastagem</SelectItem>
                <SelectItem value="Agricultura" className="text-xs">Agricultura</SelectItem>
                <SelectItem value="Reserva" className="text-xs">Reserva</SelectItem>
                <SelectItem value="APP" className="text-xs">APP</SelectItem>
                <SelectItem value="Infraestrutura" className="text-xs">Infraestrutura</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-slate-600">Tipo de Pastagem</Label>
            <Select value={filtroTipoPastagem} onValueChange={setFiltroTipoPastagem}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas" className="text-xs">Todas</SelectItem>
                {tiposPastagem.map(tp => (
                  <SelectItem key={tp} value={tp} className="text-xs">{tp}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Separator />

      {/* ─── Filtros de Lotes ─── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Beef className="w-4 h-4 text-slate-600" />
          <span className="text-xs font-bold text-slate-800 uppercase">Filtros de Gado</span>
        </div>
        <div className="space-y-2.5 px-1">
          <div>
            <Label className="text-[10px] text-slate-600">Categoria</Label>
            <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas" className="text-xs">Todas</SelectItem>
                {categorias.map(cat => (
                  <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-slate-600">Sistema Produtivo</Label>
            <Select value={filtroSistema} onValueChange={setFiltroSistema}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                {sistemasProdutivos.map(sp => (
                  <SelectItem key={sp} value={sp} className="text-xs">{sp}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-slate-600">Alertas</Label>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                <SelectItem value="com_alerta" className="text-xs">Com Alerta</SelectItem>
                <SelectItem value="sem_alerta" className="text-xs">Sem Alerta</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-slate-600 flex items-center gap-1"><Weight className="w-3 h-3" /> Peso Mínimo (kg)</Label>
            <Input
              type="number" placeholder="Ex: 200" className="h-8 text-xs"
              value={filtroPesoMin || ''} onChange={e => setFiltroPesoMin(e.target.value ? Number(e.target.value) : null)}
            />
          </div>
          <div>
            <Label className="text-[10px] text-slate-600 flex items-center gap-1"><Weight className="w-3 h-3" /> Peso Máximo (kg)</Label>
            <Input
              type="number" placeholder="Ex: 500" className="h-8 text-xs"
              value={filtroPesoMax || ''} onChange={e => setFiltroPesoMax(e.target.value ? Number(e.target.value) : null)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendaItem({ cor, label }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-3 h-3 rounded-sm border border-white/50" style={{ backgroundColor: cor }} />
      <span className="text-[11px] text-slate-700">{label}</span>
    </div>
  );
}