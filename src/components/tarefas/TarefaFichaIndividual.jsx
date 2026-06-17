import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import FotosTarefaGaleria from "@/components/tarefas/FotosTarefaGaleria";

const STATUS_CORES = {
  Pendente: "bg-yellow-100 text-yellow-800 border-yellow-300",
  "Em Andamento": "bg-blue-100 text-blue-800 border-blue-300",
  Concluída: "bg-emerald-100 text-emerald-800 border-emerald-300",
  Cancelada: "bg-slate-100 text-slate-600 border-slate-300",
};

const PRIORIDADE_CORES = {
  Baixa: "bg-blue-100 text-blue-800 border-blue-300",
  Média: "bg-yellow-100 text-yellow-800 border-yellow-300",
  Alta: "bg-red-100 text-red-800 border-red-300",
};

const fmt = (v) => v ? new Date(v).toLocaleDateString("pt-BR") : "—";
const fmtDt = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("pt-BR");
};

function Campo({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
      <span className="text-xs text-slate-900 font-medium break-words">{value || "—"}</span>
    </div>
  );
}

function Secao({ titulo, children }) {
  return (
    <div className="border border-slate-200 rounded-lg bg-white p-3 space-y-3">
      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider border-b pb-1">{titulo}</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {children}
      </div>
    </div>
  );
}

export default function TarefaFichaIndividual({ tarefas, indice, onAnterior, onProximo }) {
  const tarefa = tarefas[indice];
  if (!tarefa) return null;

  const total = tarefas.length;
  const fotos = [...(tarefa.fotos || []), ...(tarefa.anexos_urls || [])];

  return (
    <div className="space-y-3">
      {/* Navegação */}
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-4 py-2 shadow-sm">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onAnterior} disabled={indice === 0}>
          <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
        </Button>
        <div className="flex flex-col items-center">
          <span className="text-xs font-bold text-slate-700">
            {indice + 1} de {total}
          </span>
          <span className="text-[10px] text-slate-500">tarefas encontradas</span>
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onProximo} disabled={indice === total - 1}>
          Próxima <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Cabeçalho da tarefa */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm space-y-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <h2 className="text-base font-bold text-slate-900 flex-1">{tarefa.titulo || "Sem título"}</h2>
          <div className="flex gap-2 flex-wrap">
            <Badge className={`text-xs border ${STATUS_CORES[tarefa.status] || STATUS_CORES.Pendente}`}>
              {tarefa.status || "Pendente"}
            </Badge>
            <Badge className={`text-xs border ${PRIORIDADE_CORES[tarefa.prioridade] || PRIORIDADE_CORES.Média}`}>
              {tarefa.prioridade || "Média"}
            </Badge>
          </div>
        </div>
        {tarefa.descricao && (
          <p className="text-xs text-slate-600 leading-relaxed">{tarefa.descricao}</p>
        )}
      </div>

      {/* Identificação */}
      <Secao titulo="Identificação">
        <Campo label="Tipo Base" value={tarefa.tipo} />
        <Campo label="Tipo de Tarefa" value={tarefa.tipo_tarefa_nome} />
        <Campo label="Grupo de Atividade" value={tarefa.grupo_atividade_nome} />
        <Campo label="Solicitante" value={tarefa.solicitante} />
        <Campo label="Responsável Geral" value={tarefa.responsavel_geral} />
        <Campo label="Responsável Execução" value={tarefa.responsavel} />
      </Secao>

      {/* Localização */}
      <Secao titulo="Localização">
        <Campo label="Fazenda / Setor" value={tarefa.setor_nome} />
        <Campo label="Área / Piquete" value={tarefa.area_nome} />
        <Campo label="Lote" value={tarefa.lote_nome} />
        <Campo
          label="Coordenadas GPS"
          value={
            tarefa.coordenadas?.lat && tarefa.coordenadas?.lng
              ? `${Number(tarefa.coordenadas.lat).toFixed(6)}, ${Number(tarefa.coordenadas.lng).toFixed(6)}`
              : null
          }
        />
      </Secao>

      {/* Datas */}
      <Secao titulo="Datas">
        <Campo label="Data do Pedido" value={fmt(tarefa.data_pedido)} />
        <Campo label="Data Prevista" value={fmt(tarefa.data_prevista)} />
        <Campo label="Data de Início" value={fmtDt(tarefa.data_inicio)} />
        <Campo label="Data de Conclusão" value={fmt(tarefa.data_conclusao)} />
        <Campo label="Criado em" value={fmtDt(tarefa.created_date)} />
        <Campo label="Atualizado em" value={fmtDt(tarefa.updated_date)} />
      </Secao>

      {/* Observações */}
      {(tarefa.observacoes || tarefa.observacoes_conclusao) && (
        <div className="border border-slate-200 rounded-lg bg-white p-3 space-y-3">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider border-b pb-1">Observações</h3>
          {tarefa.observacoes && (
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-0.5">Obs. da Tarefa</span>
              <p className="text-xs text-slate-800 leading-relaxed">{tarefa.observacoes}</p>
            </div>
          )}
          {tarefa.observacoes_conclusao && (
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-0.5">Obs. de Conclusão</span>
              <p className="text-xs text-slate-800 leading-relaxed">{tarefa.observacoes_conclusao}</p>
            </div>
          )}
        </div>
      )}

      {/* Fotos */}
      {fotos.length > 0 && (
        <div className="border border-slate-200 rounded-lg bg-white p-3 space-y-2">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider border-b pb-1">
            Fotos ({fotos.length})
          </h3>
          <FotosTarefaGaleria tarefa={tarefa} />
        </div>
      )}
    </div>
  );
}