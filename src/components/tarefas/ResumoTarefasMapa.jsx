import { CORES_PRIORIDADE_TAREFA } from "@/lib/tarefas/prioridade";
import React from "react";
import { ClipboardList, Plus } from "lucide-react";
import CascaDetalhe from "@/components/mapa/detalhes-lote/CascaDetalhe";
import { Abas, Chip, Item, Kpis, ListaItens, RodapePilulas, Vazio } from "@/components/mapa/detalhes-lote/blocos";

/*
 * D-PROD-321 — Tarefas, parte 2: o resumo das tarefas no estilo dos detalhes do lote (casca v12), no lugar da
 * grade de cadastro. Abas Abertas · Concluídas, números do topo, um cartão por tarefa (toque abre os detalhes) e
 * "Nova tarefa" no rodapé.
 */

/** Situações abertas (as outras são encerradas). */
const ABERTAS = new Set(["Pendente", "Em Andamento"]);
const PESO_PRIORIDADE = { Urgente: -1, Alta: 0, Média: 1, Baixa: 2 };
/** Cor da prioridade: a mesma dos alfinetes e dos detalhes. */
export const COR_PRIORIDADE = CORES_PRIORIDADE_TAREFA;
// O selo destaca a Urgente e a Alta; a cor de cada prioridade fica no quadradinho do cartão.
const TOM_PRIORIDADE = { Urgente: "atencao", Alta: "atencao", Média: "neutro", Baixa: "neutro" };

/** "2026-11-28…" → "28/11". @param {unknown} v */
const diaCurto = (v) => {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : "";
};
/** @param {unknown} v */
const dia = (v) => String(v ?? "").slice(0, 10);

/** O dia de hoje no aparelho (AAAA-MM-DD). */
const hojeNoAparelho = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * @param {any} t
 * @param {(p: string) => string} prioridadeDe
 * @param {string} hoje
 */
const descrever = (t, prioridadeDe, hoje) => {
  const status = String(t?.status || "Pendente");
  const aberta = ABERTAS.has(status);
  const prazo = dia(t?.data_prevista);
  const atrasada = aberta && Boolean(prazo) && prazo < hoje;
  const prioridade = prioridadeDe(t?.prioridade || "Média");
  return { t, status, aberta, prazo, atrasada, prioridade };
};

/**
 * @param {{
 *   tarefas: any[],
 *   onAbrir: (tarefa: any) => void,
 *   onNova?: (() => void) | null,
 *   prioridadeDe: (p: string) => string,
 *   hoje?: string,
 *   titulo?: string,
 *   sub?: string,
 *   anim?: "empurrar" | "voltar" | null,
 * }} props
 */
export default function ResumoTarefasMapa({ tarefas, onAbrir, onNova = null, prioridadeDe, hoje, titulo = "Tarefas", sub = "", anim = null }) {
  const [aba, setAba] = React.useState("abertas");
  const diaDeHoje = hoje || hojeNoAparelho();
  const todas = React.useMemo(
    () => (Array.isArray(tarefas) ? tarefas : []).map((t) => descrever(t, prioridadeDe, diaDeHoje)),
    [tarefas, prioridadeDe, diaDeHoje]
  );
  const abertas = React.useMemo(
    () =>
      todas
        .filter((x) => x.aberta)
        .sort(
          (a, b) =>
            Number(b.atrasada) - Number(a.atrasada) ||
            (PESO_PRIORIDADE[a.prioridade] ?? 1) - (PESO_PRIORIDADE[b.prioridade] ?? 1) ||
            (a.prazo || "9999").localeCompare(b.prazo || "9999") ||
            String(a.t?.titulo || "").localeCompare(String(b.t?.titulo || ""), "pt-BR")
        ),
    [todas]
  );
  const encerradas = React.useMemo(
    () =>
      todas
        .filter((x) => !x.aberta)
        .sort((a, b) =>
          String(b.t?.data_conclusao || b.t?.updated_date || "").localeCompare(String(a.t?.data_conclusao || a.t?.updated_date || ""))
        ),
    [todas]
  );
  const lista = aba === "abertas" ? abertas : encerradas;

  const kpis =
    aba === "abertas"
      ? [
          { chave: "pendentes", rotulo: "Pendentes", valor: abertas.filter((x) => x.status === "Pendente").length },
          { chave: "andamento", rotulo: "Andamento", valor: abertas.filter((x) => x.status === "Em Andamento").length },
          { chave: "atrasadas", rotulo: "Atrasadas", valor: abertas.filter((x) => x.atrasada).length, cor: "#dc2626" },
        ]
      : [
          { chave: "concluidas", rotulo: "Concluídas", valor: encerradas.filter((x) => x.status === "Concluída").length },
          { chave: "canceladas", rotulo: "Canceladas", valor: encerradas.filter((x) => x.status === "Cancelada").length },
        ];

  const abas = [
    { id: "abertas", rotulo: `Abertas (${abertas.length})` },
    { id: "concluidas", rotulo: `Concluídas (${encerradas.length})` },
  ];

  const rodape = onNova ? (
    <RodapePilulas rotulo="Ações das tarefas" itens={[{ chave: "nova", rotulo: "Nova tarefa", icone: Plus, principal: true, onClick: onNova }]} />
  ) : null;

  return (
    <CascaDetalhe
      titulo={titulo}
      sub={sub}
      rodape={rodape}
      className="mk-dp-tarefas"
      // D-PROD-325: de volta dos detalhes, a lista entra deslizando como nas telas do lote.
      anim={anim}
      cabecalhoDoCorpo={<Abas abas={abas} ativa={aba} onMudar={setAba} rotulo="Tarefas" />}
    >
      <Kpis colunas={kpis.length} itens={kpis} />
      {lista.length ? (
        <ListaItens titulo={aba === "abertas" ? "Tarefas abertas" : "Tarefas concluídas e canceladas"} rotulo={aba === "abertas" ? "Tarefas abertas" : "Tarefas encerradas"}>
          {lista.map(({ t, status, atrasada, prazo, prioridade }) => {
            const local = t?.area_nome || t?.lote_nome || (t?.setor_nome ? `${t.setor_nome} (sem pasto)` : "Sem local");
            const meta = [local, prazo ? `Prazo ${diaCurto(prazo)}` : "Sem prazo", t?.responsavel || "Sem responsável"].join(" · ");
            return (
              <Item
                key={t?.id}
                icone={ClipboardList}
                cor={COR_PRIORIDADE[prioridade] || COR_PRIORIDADE.Média}
                titulo={String(t?.titulo || "Tarefa").toUpperCase()}
                meta={meta}
                // D-PROD-324: feita ou alterada sem internet e ainda não enviada.
                sub={[status, atrasada ? "atrasada" : null, t?._isOffline ? "aguardando envio" : null].filter(Boolean).join(" · ")}
                chip={<Chip tom={TOM_PRIORIDADE[prioridade] || "neutro"}>{prioridade}</Chip>}
                chevron
                onClick={() => onAbrir(t)}
              />
            );
          })}
        </ListaItens>
      ) : (
        <Vazio icone={ClipboardList}>{aba === "abertas" ? "Nenhuma tarefa aberta." : "Nenhuma tarefa concluída ou cancelada."}</Vazio>
      )}
    </CascaDetalhe>
  );
}
