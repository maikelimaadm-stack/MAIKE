import React, { useState } from "react";
import { ChevronDown, ChevronRight, CircleCheck, List, MapPin, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { B1MenuAcoesDaLinha } from "@/components/cadastro/base1/B1AcoesDaLinha";
import { useCelular } from "@/components/common/MobileSheet";
import { Selo } from "@/components/financeiroGestao/ConsultaLancamento";
import DialogoAreaDaAtividade from "@/components/lancamento-atividades/DialogoAreaDaAtividade";
import {
  CHAVE_DO_SELO_AREA,
  STATUS_AREA,
  gruposDasAreas,
  linhaDaAreaParaExibir,
  podeRemoverArea,
  rotuloDoStatusArea,
  textoDosContadores,
  totaisDaArea,
} from "@/lib/atividadeAreasRegras";

const NOTA = "min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";
const BOTAO_INICIAR =
  "inline-flex min-h-8 items-center gap-1.5 rounded-full bg-emerald-600 px-3 text-[12.5px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60";

/**
 * A barra do "% feito" (só com o valor do servidor). @param {{ barra: number|null, texto: string, testId: string }} props
 */
function Barra({ barra, texto, testId }) {
  return (
    <span className="flex min-w-[88px] items-center gap-2" data-testid={testId}>
      <span className="tabular-nums">{texto}</span>
      {barra !== null ? (
        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[#ECEBE6]" role="progressbar" aria-label="Área feita" aria-valuemin={0} aria-valuemax={100} aria-valuenow={barra}>
          <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${barra}%` }} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * D-PROD-249 — o card "Áreas da atividade" da atividade aberta: "abri uma atividade com 5 áreas — não vão aparecer as 5
 * áreas para mim como em andamento; eu vou escolher INICIAR a área" (o proprietário).
 *
 * Três grupos, nesta ordem: **Em andamento** (planejada, feita, % com a barra, custo, custo/ha, iniciada em, último
 * lançamento e o ⚡ com os 4 lançamentos — a janela do tipo FIXA nesta área —, Ver lançamentos da área e Concluir
 * área), **A iniciar** (planejada e o botão "Iniciar área", que pede a data; o ⚡ com Iniciar, Área planejada e Remover
 * — só sem lançamento) e **Concluídas** (recolhido; o ⚡ com Reabrir e Ver lançamentos). O título leva os contadores
 * ("2 em andamento · 3 a iniciar · 0 concluídas") e, para quem edita a atividade aberta, "+ Adicionar área". Os números
 * de cada área vêm só do servidor (`por_area` dos totais); sem valor, "—". No celular, cada área vira um cartão.
 *
 * @param {{
 *   atividade: any,
 *   totais: any,
 *   lendoTotais: boolean,
 *   podeGerir: boolean,
 *   lancamentos: ReadonlyArray<{ tipo: string, rotulo: string, Icone: any, lancar: boolean }>,
 *   onLancarNaArea: (tipo: string, aba: 'lista'|'dados', atividadeAreaId: string) => void,
 *   onVerLancamentosDaArea: (atividadeAreaId: string) => void,
 *   onAtividadeAtualizada: (atividade: any) => void,
 * }} props `podeGerir`: a atividade ABERTA e a permissão de editá-la (iniciar, concluir, reabrir, adicionar, remover e a
 *   planejada); `lancamentos`: os tipos que o tipo da atividade permite, com `lancar` (a permissão de lançar).
 */
export default function CardAreasDaAtividade({ atividade, totais, lendoTotais, podeGerir, lancamentos, onLancarNaArea, onVerLancamentosDaArea, onAtividadeAtualizada }) {
  const celular = useCelular();
  const [concluidasAbertas, setConcluidasAbertas] = useState(false);
  const [dialogo, setDialogo] = useState(/** @type {{ modo: any, area: any } | null} */ (null));
  const grupos = gruposDasAreas(atividade);
  const total = grupos.reduce((t, g) => t + g.areas.length, 0);

  /** @param {any} area @param {string} campo */
  const numeroOuLendo = (area, campo) => {
    const v = /** @type {any} */ (linhaDaAreaParaExibir(area, totaisDaArea(totais, area.id)))[campo];
    return v === "—" && lendoTotais ? "…" : v;
  };

  /** O ⚡ de uma área. @param {any} area */
  const menuDaArea = (area) => {
    const id = String(area.id);
    const numeros = totaisDaArea(totais, id);
    const l = linhaDaAreaParaExibir(area, numeros);
    const emAndamento = area.status === STATUS_AREA.EM_ANDAMENTO;
    const lancar = emAndamento
      ? lancamentos.filter((t) => t.lancar).map((t) => ({ key: `lancar-${t.tipo}`, label: t.rotulo, icon: <t.Icone size={16} strokeWidth={1.75} />, onSelect: () => onLancarNaArea(t.tipo, "dados", id) }))
      : [];
    const ver = area.status !== STATUS_AREA.PLANEJADA ? [{ key: "ver", label: "Ver lançamentos da área", icon: <List size={16} strokeWidth={1.75} />, onSelect: () => onVerLancamentosDaArea(id) }] : [];
    /** @type {any[]} */
    const gerir = podeGerir
      ? [
          area.status === STATUS_AREA.PLANEJADA ? { key: "iniciar", label: "Iniciar área", icon: <Play size={16} strokeWidth={1.75} />, onSelect: () => setDialogo({ modo: "iniciar", area }) } : null,
          emAndamento ? { key: "concluir", label: "Concluir área", icon: <CircleCheck size={16} strokeWidth={1.75} />, onSelect: () => setDialogo({ modo: "concluir", area }) } : null,
          area.status === STATUS_AREA.CONCLUIDA ? { key: "reabrir", label: "Reabrir área", icon: <RotateCcw size={16} strokeWidth={1.75} />, onSelect: () => setDialogo({ modo: "reabrir", area }) } : null,
          { key: "planejada", label: "Área planejada", icon: <MapPin size={16} strokeWidth={1.75} />, onSelect: () => setDialogo({ modo: "planejada", area }) },
          podeRemoverArea(area, numeros) ? { key: "remover", label: "Remover área", icon: <Trash2 size={16} strokeWidth={1.75} />, danger: true, onSelect: () => setDialogo({ modo: "remover", area }) } : null,
        ].filter(Boolean)
      : [];
    return (
      <B1MenuAcoesDaLinha
        rotulo={`Ações da área ${l.nome}`}
        titulo={l.nome}
        subtitulo={[rotuloDoStatusArea(area.status), emAndamento || area.status === STATUS_AREA.CONCLUIDA ? `${l.feita} de ${l.planejada}` : l.planejada, l.custo !== "—" ? l.custo : ""].filter(Boolean).join(" · ")}
        grupos={[lancar, ver, gerir]}
        testId={`area-acoes-${id}`}
      />
    );
  };

  /** O botão primário da área a iniciar. @param {any} area */
  const botaoIniciar = (area) =>
    podeGerir ? (
      <button type="button" className={BOTAO_INICIAR} onClick={() => setDialogo({ modo: "iniciar", area })} data-testid={`area-iniciar-${area.id}`}>
        <Play size={13} strokeWidth={2.2} aria-hidden /> Iniciar área
      </button>
    ) : (
      <span className={NOTA}>A iniciar</span>
    );

  /** Uma tabela do grupo (computador). @param {{ status: string, areas: any[] }} g */
  const tabela = (g) => {
    const andamento = g.status === STATUS_AREA.EM_ANDAMENTO;
    const planejada = g.status === STATUS_AREA.PLANEJADA;
    return (
      <div className="b1-tipo-tabela__rolagem">
        <table className="b1-tipo-tabela b1-areas-tabela" data-testid={`areas-grupo-${g.status}`}>
          <thead>
            <tr>
              <th scope="col" className="b1-tipo-tabela__acoes">
                Ações
              </th>
              <th scope="col">Área</th>
              {planejada ? <th scope="col">Setor</th> : null}
              <th scope="col" className="is-numero">
                Planejada
              </th>
              {planejada ? (
                <th scope="col" aria-label="Iniciar" />
              ) : (
                <>
                  <th scope="col" className="is-numero">
                    Feita
                  </th>
                  <th scope="col">%</th>
                  <th scope="col" className="is-numero">
                    Custo
                  </th>
                  <th scope="col" className="is-numero">
                    Custo/ha
                  </th>
                  <th scope="col">Iniciada em</th>
                  <th scope="col">{andamento ? "Último lançamento" : "Concluída em"}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {g.areas.map((area) => {
              const id = String(area.id);
              const l = linhaDaAreaParaExibir(area, totaisDaArea(totais, id));
              return (
                <tr key={id} data-testid={`area-${id}`} data-status={area.status}>
                  <td className="b1-tipo-tabela__acoes">{menuDaArea(area)}</td>
                  <td className="is-nome">
                    {andamento || g.status === STATUS_AREA.CONCLUIDA ? (
                      <button type="button" className="b1-tipo-tabela__abrir" onClick={() => onVerLancamentosDaArea(id)} data-testid={`area-${id}-abrir`}>
                        {l.nome}
                      </button>
                    ) : (
                      l.nome
                    )}
                  </td>
                  {planejada ? <td>{l.setor || "—"}</td> : null}
                  <td className="is-numero" data-testid={`area-${id}-planejada`}>
                    {l.planejada}
                  </td>
                  {planejada ? (
                    <td className="text-right">{botaoIniciar(area)}</td>
                  ) : (
                    <>
                      <td className="is-numero" data-testid={`area-${id}-feita`}>
                        {numeroOuLendo(area, "feita")}
                      </td>
                      <td>
                        <Barra barra={l.barra} texto={numeroOuLendo(area, "percentual")} testId={`area-${id}-percentual`} />
                      </td>
                      <td className="is-numero" data-testid={`area-${id}-custo`}>
                        {numeroOuLendo(area, "custo")}
                      </td>
                      <td className="is-numero" data-testid={`area-${id}-custo-ha`}>
                        {numeroOuLendo(area, "custoPorHa")}
                      </td>
                      <td data-testid={`area-${id}-inicio`}>{l.inicio}</td>
                      <td data-testid={`area-${id}-${andamento ? "ultimo" : "conclusao"}`}>{andamento ? numeroOuLendo(area, "ultimo") : l.conclusao}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  /** Os cartões do grupo (celular). @param {{ status: string, areas: any[] }} g */
  const cartoes = (g) => (
    <ul className="flex flex-col gap-2" data-testid={`areas-grupo-${g.status}`}>
      {g.areas.map((area) => {
        const id = String(area.id);
        const l = linhaDaAreaParaExibir(area, totaisDaArea(totais, id));
        const planejada = g.status === STATUS_AREA.PLANEJADA;
        return (
          <li key={id} className="b1-tipo-card" data-testid={`area-${id}`} data-status={area.status}>
            <div className="b1-tipo-card__topo">
              <button type="button" className="b1-tipo-card__nome" onClick={() => (planejada ? undefined : onVerLancamentosDaArea(id))} data-testid={`area-${id}-abrir`}>
                <span className="b1-tipo-card__titulo">{l.nome}</span>
                <span className="b1-tipo-card__valor">{planejada ? l.planejada : numeroOuLendo(area, "custo")}</span>
              </button>
              {menuDaArea(area)}
            </div>
            {planejada ? (
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className={NOTA}>{[l.setor, `Planejada ${l.planejada}`].filter(Boolean).join(" · ")}</span>
                {botaoIniciar(area)}
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                <span className="text-[var(--mg-text-2,#475569)]">Feita / planejada</span>
                <span className="text-right font-semibold tabular-nums">
                  {numeroOuLendo(area, "feita")} / {l.planejada}
                </span>
                <span className="text-[var(--mg-text-2,#475569)]">% feito</span>
                <span className="flex justify-end">
                  <Barra barra={l.barra} texto={numeroOuLendo(area, "percentual")} testId={`area-${id}-percentual`} />
                </span>
                <span className="text-[var(--mg-text-2,#475569)]">Custo/ha</span>
                <span className="text-right font-semibold tabular-nums">{numeroOuLendo(area, "custoPorHa")}</span>
                <span className="text-[var(--mg-text-2,#475569)]">Iniciada em</span>
                <span className="text-right">{l.inicio}</span>
                <span className="text-[var(--mg-text-2,#475569)]">{g.status === STATUS_AREA.EM_ANDAMENTO ? "Último lançamento" : "Concluída em"}</span>
                <span className="text-right">{g.status === STATUS_AREA.EM_ANDAMENTO ? numeroOuLendo(area, "ultimo") : l.conclusao}</span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <section className="b1-aba-cartao b1-aberta-cartao" aria-labelledby="atividade-areas-t" data-testid="atividade-areas">
      <div className="b1-aba-cartao__cab b1-aberta-cartao__cab">
        <h3 className="b1-aba-cartao__titulo" id="atividade-areas-t">
          Áreas da atividade
        </h3>
        <span className="b1-aberta-cartao__sub" data-testid="atividade-areas-contadores">
          {textoDosContadores(atividade)}
        </span>
        {podeGerir ? (
          <button type="button" className="b1-tipo-lancar ml-auto" onClick={() => setDialogo({ modo: "adicionar", area: null })} data-testid="atividade-areas-adicionar">
            <Plus size={13} strokeWidth={2} aria-hidden /> Adicionar área
          </button>
        ) : null}
      </div>
      <p className={`${NOTA} mb-2`}>
        Cada lançamento (máquinas, insumos, mão de obra e custos extras) é de uma área, no dia em que foi feito. Inicie a área quando começar o trabalho
        nela; conclua quando terminar.
      </p>
      {total === 0 ? (
        <p className={NOTA} data-testid="atividade-areas-vazio">
          Esta atividade não tem áreas.{podeGerir ? " Use + Adicionar área." : ""}
        </p>
      ) : null}
      {grupos.map((g) =>
        g.areas.length === 0 && g.status !== STATUS_AREA.EM_ANDAMENTO ? null : (
          <div key={g.status} className="mt-3 min-w-0" data-testid={`areas-secao-${g.status}`}>
            {g.recolhido ? (
              <button
                type="button"
                className="b1-aberta-dias__toggle"
                aria-expanded={concluidasAbertas}
                onClick={() => setConcluidasAbertas((v) => !v)}
                data-testid="areas-concluidas-toggle"
              >
                {concluidasAbertas ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                <span className="text-[13px] font-semibold">{g.titulo}</span>
                <Selo status={CHAVE_DO_SELO_AREA[g.status]} rotulo={String(g.areas.length)} />
              </button>
            ) : (
              <p className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold">
                {g.titulo}
                <Selo status={CHAVE_DO_SELO_AREA[g.status]} rotulo={String(g.areas.length)} />
              </p>
            )}
            {g.recolhido && !concluidasAbertas ? null : g.areas.length === 0 ? (
              <p className={NOTA} data-testid={`areas-${g.status}-vazio`}>
                Nenhuma área em andamento.{podeGerir && grupos.some((x) => x.status === STATUS_AREA.PLANEJADA && x.areas.length) ? " Inicie uma área a iniciar para lançar nela." : ""}
              </p>
            ) : celular ? (
              cartoes(g)
            ) : (
              tabela(g)
            )}
          </div>
        ),
      )}
      {dialogo ? (
        <DialogoAreaDaAtividade
          key={`${dialogo.modo}-${dialogo.area?.id ?? "nova"}-${dialogo.area?.versao ?? 0}`}
          modo={dialogo.modo}
          atividade={atividade}
          area={dialogo.area}
          onFechar={() => setDialogo(null)}
          onFeito={(r) => {
            setDialogo(null);
            if (r?.atividade) onAtividadeAtualizada(r.atividade);
          }}
        />
      ) : null}
    </section>
  );
}
