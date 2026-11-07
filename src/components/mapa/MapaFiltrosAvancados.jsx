import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import MapaFiltroSelecao from "./MapaFiltroSelecao";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import ToggleSwitch from "@/components/common/ToggleSwitch";

// Cores por tipo de cultura
export const CORES_TIPO_CULTURA = {
  'Pastagem': '#22c55e',
  'Agricultura': '#eab308',
  'Reserva': '#0ea5e9',
  'APP': '#06b6d4',
  'Infraestrutura': '#94a3b8'
};

// Cores por aproveitamento
export const CORES_APROVEITAMENTO = {
  'Alta': '#22c55e',
  'Média': '#f59e0b',
  'Baixa': '#ef4444'
};

// Cores por status de ocupação
export const CORES_OCUPACAO = {
  'Disponível': '#94a3b8',
  'Médio': '#f59e0b',
  'Alto': '#ef4444',
  'Sobrepastoreado': '#991b1b'
};

// Cores por faixa de UA/ha (baseado em dados Embrapa/Scot Consultoria)
export const CORES_UA_HA = {
  'Sem gado': '#d1d5db',
  'Sublotação (< 0,8 UA/ha)': '#86efac',
  'Moderada (0,8 - 1,2 UA/ha)': '#22c55e',
  'Ideal (1,2 - 1,8 UA/ha)': '#3b82f6',
  'Alta (1,8 - 2,4 UA/ha)': '#f59e0b',
  'Superlotação (> 2,4 UA/ha)': '#ef4444'
};

// Cores por situação do pasto (Ocupado vs Vazio)
export const CORES_SITUACAO_PASTO = {
  'Vazio - Sem histórico': '#d1d5db',
  'Vazio - Em descanso': '#86efac',
  'Ocupado - Normal': '#3b82f6',
  'Ocupado - Atenção (> 45d)': '#f59e0b',
  'Ocupado - Crítico (> 90d)': '#ef4444'
};

// Cores por categoria de gado
export const CORES_CATEGORIA_GADO = [
'#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#6366f1',
'#d946ef', '#0ea5e9', '#84cc16', '#f43f5e', '#a855f7'];

export const MODOS_COLORACAO = [
{ id: 'padrao', label: 'Padrão (cor da área)' },
{ id: 'tipo_cultura', label: 'Tipo de Cultura' },
{ id: 'aproveitamento', label: 'Aproveitamento' },
{ id: 'ocupacao', label: 'Ocupação' },
{ id: 'categoria_gado', label: 'Categoria de Manejo' },
{ id: 'tipo_pastagem', label: 'Tipo de Pastagem' },
{ id: 'ua_ha', label: 'UA por Hectare' },
{ id: 'situacao_pasto', label: 'Situação do Pasto' }];

/**
 * Camadas que o usuário pode ligar/desligar, conforme as permissões.
 * Usado pelo painel Visualização do Mapa Geral e pelos filtros avançados.
 */
export function camadasDoMapa({
  showAreas, setShowAreas, showPontos, setShowPontos, showLinhas, setShowLinhas, showLotes, setShowLotes,
  showTarefas, setShowTarefas, showCochos, setShowCochos, showDepositos, setShowDepositos, showAlertas, setShowAlertas,
  showUserLocation, setShowUserLocation, showNomesAreas, setShowNomesAreas, showHectaresAreas, setShowHectaresAreas,
  permissions = null
}) {
  return [

  permissions?.visualizar_areas !== false && { id: 'areas', label: 'Mapa de Áreas', checked: showAreas, onChange: () => setShowAreas((v) => !v) },
  permissions?.visualizar_nomes_areas !== false && permissions?.visualizar_areas !== false && { id: 'nomes', label: 'Detalhes Áreas', checked: showNomesAreas, onChange: () => setShowNomesAreas((v) => !v) },
  permissions?.visualizar_areas !== false && { id: 'hectares', label: 'Hectares', checked: showHectaresAreas, onChange: () => setShowHectaresAreas((v) => !v) },
  permissions?.visualizar_pontos_referencia !== false && { id: 'pontos', label: 'Pontos Referência', checked: showPontos, onChange: () => setShowPontos((v) => !v) },
  permissions?.visualizar_tarefas !== false && { id: 'tarefas', label: 'Tarefas', checked: showTarefas, onChange: () => setShowTarefas((v) => !v) },
  permissions?.visualizar_lotes !== false && { id: 'lotes', label: 'Lotes', checked: showLotes, onChange: () => setShowLotes((v) => !v) },
  permissions?.visualizar_linhas !== false && { id: 'linhas', label: 'Linhas (cercas, rios)', checked: showLinhas, onChange: () => setShowLinhas((v) => !v) },
  permissions?.visualizar_cochos_suplementacao !== false && { id: 'cochos', label: 'Cochos', checked: showCochos, onChange: () => setShowCochos((v) => !v) },
  permissions?.visualizar_cochos_suplementacao !== false && { id: 'depositos', label: 'Depósitos', checked: showDepositos, onChange: () => setShowDepositos((v) => !v) },
  permissions?.visualizar_alertas !== false && { id: 'alertas', label: 'Alertas', checked: showAlertas, onChange: () => setShowAlertas((v) => !v) },
  permissions?.visualizar_localizacao !== false && { id: 'localizacao', label: 'Localização', checked: showUserLocation, onChange: () => setShowUserLocation((v) => !v) }].
  filter(Boolean);
}

export default function MapaFiltrosAvancados({
  // Visibilidade
  showAreas, setShowAreas,
  showPontos, setShowPontos,
  showLinhas, setShowLinhas,
  showLotes, setShowLotes,
  showTarefas, setShowTarefas,
  showCochos, setShowCochos,
  showDepositos, setShowDepositos,
  showAlertas, setShowAlertas,
  showUserLocation, setShowUserLocation,
  showNomesAreas, setShowNomesAreas,
  showHectaresAreas, setShowHectaresAreas,
  // Filtros de lotes
  filtroCategoria, setFiltroCategoria,
  filtroIdentificador, setFiltroIdentificador,
  filtroStatus, setFiltroStatus,
  filtroSistema, setFiltroSistema,
  filtroAlertaTipo, setFiltroAlertaTipo,
  filtroPesoMin, setFiltroPesoMin,
  filtroPesoMax, setFiltroPesoMax,
  // Filtros de área
  filtroSetor, setFiltroSetor,
  filtroTipoCultura, setFiltroTipoCultura,
  filtroTipoPastagem, setFiltroTipoPastagem,
  // Coloração
  modoColoracao, setModoColoracao,
  // Dados para opções
  categorias = [],
  identificadores = [],
  tiposPastagem = [],
  setores = [],
  sistemasProdutivos = [],
  permissions = null,
  mostrarCores = true
}) {

  // D-PROD-132: "mostrar ou não" (camadas) fica nos Filtros; o "Demarcar áreas
  // por" (cores) vai para o painel Visualização quando `mostrarCores` é false.
  const availableLayers = camadasDoMapa({ showAreas, setShowAreas, showPontos, setShowPontos, showLinhas, setShowLinhas, showLotes, setShowLotes, showTarefas, setShowTarefas, showCochos, setShowCochos, showDepositos, setShowDepositos, showAlertas, setShowAlertas, showUserLocation, setShowUserLocation, showNomesAreas, setShowNomesAreas, showHectaresAreas, setShowHectaresAreas, permissions });

  return (
    <div className="mk-map-filters mk-map-filters--clean rounded space-y-1">
      {/* ─── Camadas Visíveis ─── */}
      {availableLayers.length > 0 &&
      <>
          <div className="mk-map-filter-section mk-map-filter-section--layers space-y-0 px-1">
            <div className="mk-map-filter-heading">
              <span className="text-xs font-bold text-slate-800 uppercase">Mostrar no mapa</span>
            </div>
            <div className="mk-map-layer-list">
              {availableLayers.map((item) =>
            <label key={item.label} className="mk-map-layer-row flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50 px-2 py-1.5 rounded-lg">
                  <span className="text-xs font-medium text-slate-700">{item.label}</span>
                  {/* D-PROD-132: mesma chave liga/desliga dos cadastros e lançamentos */}
                  <ToggleSwitch checked={item.checked} onChange={() => item.onChange()} ariaLabel={item.label} />
                </label>
            )}
            </div>
          </div>
          <Separator />
        </>
      }

      {/* ─── Modo de Coloração das Áreas ─── */}
      {mostrarCores && permissions?.visualizar_areas !== false &&
      <div className="mk-map-filter-section mk-map-filter-section--colors">
          <div className="mb-3">
            <span className="text-xs font-bold text-slate-800 uppercase">DEMARCAR ÁREAS POR</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {MODOS_COLORACAO.map((modo) => {
            const ativo = modoColoracao === modo.id;
            return (
              <Button
                key={modo.id}
                variant="outline"
                aria-pressed={ativo}
                size="sm"
                onClick={() => setModoColoracao(modo.id)}
                className={`mk-map-color-button h-8 text-[10px] justify-start ${ativo ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}>

                  <span className="truncate">{modo.label}</span>
                </Button>);

          })}
          </div>

          {/* Legenda do modo ativo */}
          {modoColoracao !== 'padrao' &&
        <div className="mt-3 bg-slate-50 rounded-lg p-2.5 space-y-1">
              <div className="text-[10px] font-bold text-slate-600 uppercase mb-1">Legenda</div>
              {modoColoracao === 'tipo_cultura' && Object.entries(CORES_TIPO_CULTURA).map(([k, c]) => <LegendaItem key={k} cor={c} label={k} />)}
              {modoColoracao === 'aproveitamento' && Object.entries(CORES_APROVEITAMENTO).map(([k, c]) => <LegendaItem key={k} cor={c} label={k} />)}
              {modoColoracao === 'ocupacao' && Object.entries(CORES_OCUPACAO).map(([k, c]) => <LegendaItem key={k} cor={c} label={k} />)}
              {modoColoracao === 'categoria_gado' && <div className="text-[10px] text-slate-500">Cada categoria de manejo terá uma cor distinta</div>}
              {modoColoracao === 'tipo_pastagem' && <div className="text-[10px] text-slate-500">Cada tipo de pastagem terá uma cor distinta</div>}
              {modoColoracao === 'ua_ha' &&
          <>
                  {Object.entries(CORES_UA_HA).map(([k, c]) => <LegendaItem key={k} cor={c} label={k} />)}
                  <div className="text-[9px] text-slate-500 mt-1 italic">* Usa área efetiva (pastejada). 1 UA = 450 kg PV</div>
                </>
          }
              {modoColoracao === 'situacao_pasto' && Object.entries(CORES_SITUACAO_PASTO).map(([k, c]) => <LegendaItem key={k} cor={c} label={k} />)}
            </div>
        }
        </div>
      }

      {mostrarCores && permissions?.visualizar_areas !== false && <Separator />}

      {/* ─── Filtros de Áreas ─── */}
      {permissions?.visualizar_areas !== false &&
      <div className="mk-map-filter-section mk-map-filter-section--fields">
          <div className="mk-map-filter-heading">
            <span className="text-xs font-bold text-slate-800 uppercase">Filtros de Áreas</span>
          </div>
          <div className="mk-map-filter-fields">
            <div>
              <Label className="text-[10px] text-slate-600">Setor</Label>
              <MapaFiltroSelecao value={filtroSetor} onChange={(e) => setFiltroSetor(e.target.value)} aria-label="Setor" className="h-8 text-xs">

                  <option value="todos" className="text-xs">Todos</option>
                  {setores.map((setor) => <option key={setor.id} value={setor.id} className="text-xs">{setor.nome}</option>)}

              </MapaFiltroSelecao>
            </div>
            <div>
              <Label className="text-[10px] text-slate-600">Tipo de Cultura</Label>
              <MapaFiltroSelecao value={filtroTipoCultura} onChange={(e) => setFiltroTipoCultura(e.target.value)} aria-label="Tipo de Cultura" className="h-8 text-xs">

                  <option value="todas" className="text-xs">Todas</option>
                  <option value="Pastagem" className="text-xs">Pastagem</option>
                  <option value="Agricultura" className="text-xs">Agricultura</option>
                  <option value="Reserva" className="text-xs">Reserva</option>
                  <option value="APP" className="text-xs">APP</option>
                  <option value="Infraestrutura" className="text-xs">Infraestrutura</option>

              </MapaFiltroSelecao>
            </div>
            <div>
              <Label className="text-[10px] text-slate-600">Tipo de Pastagem</Label>
              <MapaFiltroSelecao value={filtroTipoPastagem} onChange={(e) => setFiltroTipoPastagem(e.target.value)} aria-label="Tipo de Pastagem" className="h-8 text-xs">

                  <option value="todas" className="text-xs">Todas</option>
                  {tiposPastagem.map((tp) => <option key={tp} value={tp} className="text-xs">{tp}</option>)}

              </MapaFiltroSelecao>
            </div>
          </div>
        </div>
      }

      {permissions?.visualizar_lotes !== false && <Separator />}

      {/* ─── Filtros de Lotes ─── */}
      {permissions?.visualizar_lotes !== false &&
      <div className="mk-map-filter-section mk-map-filter-section--fields">
          <div className="mk-map-filter-heading">
            <span className="text-xs font-bold text-slate-800 uppercase">Filtros de Categorias de Manejo</span>
          </div>
          <div className="mk-map-filter-fields">
            <div>
              <Label className="text-[10px] text-slate-600">Categoria</Label>
              <MapaFiltroSelecao value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} aria-label="Categoria" className="h-8 text-xs">

                  <option value="todas" className="text-xs">Todas</option>
                  {categorias.map((cat) => <option key={cat} value={cat} className="text-xs">{cat}</option>)}

              </MapaFiltroSelecao>
            </div>
            <div>
              <Label className="text-[10px] text-slate-600">Sistema Produtivo</Label>
              <MapaFiltroSelecao value={filtroSistema} onChange={(e) => setFiltroSistema(e.target.value)} aria-label="Sistema Produtivo" className="h-8 text-xs">

                  <option value="todos" className="text-xs">Todos</option>
                  {sistemasProdutivos.map((sp) => <option key={sp} value={sp} className="text-xs">{sp}</option>)}

              </MapaFiltroSelecao>
            </div>
            <div>
              <Label className="text-[10px] text-slate-600">Identificador</Label>
              <MapaFiltroSelecao value={filtroIdentificador} onChange={(e) => setFiltroIdentificador(e.target.value)} aria-label="Identificador" className="h-8 text-xs">

                  <option value="todos" className="text-xs">Todos</option>
                  {identificadores.map((identificador) => <option key={identificador} value={identificador} className="text-xs">{identificador}</option>)}

              </MapaFiltroSelecao>
            </div>
            <div>
              <Label className="text-[10px] text-slate-600">Alertas</Label>
              <MapaFiltroSelecao value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} aria-label="Alertas" className="h-8 text-xs">

                  <option value="todos" className="text-xs">Todos</option>
                  <option value="com_alerta" className="text-xs">Com Alerta</option>
                  <option value="sem_alerta" className="text-xs">Sem Alerta</option>

              </MapaFiltroSelecao>
            </div>
            <div>
              <Label className="text-[10px] text-slate-600">Tipo de Alerta</Label>
              <MapaFiltroSelecao value={filtroAlertaTipo} onChange={(e) => setFiltroAlertaTipo(e.target.value)} aria-label="Tipo de Alerta" className="h-8 text-xs">

                  <option value="todos" className="text-xs">Todos</option>
                  <option value="suplementacao_pendente" className="text-xs">Suplementação</option>
                  <option value="cocho_sem_produto" className="text-xs">Cocho sem produto</option>
                  <option value="deposito_estoque_minimo" className="text-xs">Estoque mínimo</option>

              </MapaFiltroSelecao>
            </div>
            <div>
              <Label className="text-[10px] text-slate-600">Peso Mínimo (kg)</Label>
              <Input
              type="number"
              placeholder="Ex: 200"
              className="h-8 text-xs"
              value={filtroPesoMin || ''}
              onChange={(e) => setFiltroPesoMin(e.target.value ? Number(e.target.value) : null)} />

            </div>
            <div>
              <Label className="text-[10px] text-slate-600">Peso Máximo (kg)</Label>
              <Input
              type="number"
              placeholder="Ex: 500"
              className="h-8 text-xs"
              value={filtroPesoMax || ''}
              onChange={(e) => setFiltroPesoMax(e.target.value ? Number(e.target.value) : null)} />

            </div>
          </div>
        </div>
      }
    </div>);

}

function LegendaItem({ cor, label }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-3 h-3 rounded-sm border border-white/50" style={{ backgroundColor: cor }} />
      <span className="text-[11px] text-slate-700">{label}</span>
    </div>);

}
