import React, { useState } from "react";
import { CircleCheck, FolderOpen, MapPin, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { B1MenuAcoesDaLinha } from "@/components/cadastro/base1/B1AcoesDaLinha";
import { useCelular } from "@/components/common/MobileSheet";
import { Selo } from "@/components/financeiroGestao/ConsultaLancamento";
import DialogoAreaDaAtividade from "@/components/lancamento-atividades/DialogoAreaDaAtividade";
import {
  CHAVE_DO_SELO_AREA,
  STATUS_AREA,
  areasDaAtividade,
  linhaDaAreaParaExibir,
  podeRemoverArea,
  rotuloDoStatusArea,
  textoDosContadores,
  totaisDaArea,
} from "@/lib/atividadeAreasRegras";
import { formatarMoedaAtividade } from "@/lib/atividadeLinhasRegras";
import { textoFeitaDePlanejada } from "@/lib/lancamentosDaAreaRegras";

const NOTA = "min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";

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
 * A tabela "Áreas da atividade" (D-PROD-249, a única lista de áreas da D-PROD-252): UMA tabela com todas as áreas, na ordem
 * da atividade — Área, Situação, Planejada, Feita, %, Custo, Último lançamento e o ⚡ — e a linha de total. O nome da área
 * abre a área (a tela dos lançamentos dela); o ⚡ abre a área e inicia, conclui, reabre, altera a planejada ou remove (o
 * que o status e a permissão deixam). Os números vêm só do servidor (`por_area` dos totais); sem valor, "—". No celular
 * continua uma tabela (`b1-tipo-tabela__rolagem`, rola na horizontal), com as colunas principais primeiro: Ações, Área,
 * Custo, Feita, %, e depois o resto. O texto de ajuda e os grupos "Em andamento / A iniciar / Concluídas" saíram.
 *
 * @param {{
 *   atividade: any,
 *   totais: any,
 *   lendoTotais: boolean,
 *   podeGerir: boolean,
 *   onAbrirArea: (atividadeAreaId: string) => void,
 *   onAtividadeAtualizada: (atividade: any) => void,
 * }} props `podeGerir`: a atividade ABERTA e a permissão de editá-la (iniciar, concluir, reabrir, adicionar, remover e a
 *   planejada).
 */
export default function CardAreasDaAtividade({ atividade, totais, lendoTotais, podeGerir, onAbrirArea, onAtividadeAtualizada }) {
  const celular = useCelular();
  const [dialogo, setDialogo] = useState(/** @type {{ modo: any, area: any } | null} */ (null));
  const areas = areasDaAtividade(atividade);

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
    const abrir = area.status !== STATUS_AREA.PLANEJADA ? [{ key: "abrir", label: "Abrir área", icon: <FolderOpen size={16} strokeWidth={1.75} />, onSelect: () => onAbrirArea(id) }] : [];
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
        subtitulo={[rotuloDoStatusArea(area.status), emAndamento || area.status === STATUS_AREA.CONCLUIDA ? textoFeitaDePlanejada(l) : l.planejada, l.custo !== "—" ? l.custo : ""].filter(Boolean).join(" · ")}
        grupos={[abrir, gerir]}
        testId={`area-acoes-${id}`}
      />
    );
  };

  // As colunas, na ordem do computador e do celular (o dado principal — Custo, Feita — aparece sem rolar).
  const COLUNAS = [
    { id: "situacao", rotulo: "Situação", numero: false },
    { id: "planejada", rotulo: "Planejada", numero: true },
    { id: "feita", rotulo: "Feita", numero: true },
    { id: "percentual", rotulo: "%", numero: false },
    { id: "custo", rotulo: "Custo", numero: true },
    { id: "ultimo", rotulo: "Último lançamento", numero: false },
  ];
  const ORDEM_CELULAR = ["custo", "feita", "percentual", "situacao", "planejada", "ultimo"];
  const colunas = celular ? ORDEM_CELULAR.map((id) => /** @type {any} */ (COLUNAS.find((c) => c.id === id))) : COLUNAS;

  /** @param {any} area @param {string} coluna */
  const celula = (area, coluna) => {
    const id = String(area.id);
    const l = linhaDaAreaParaExibir(area, totaisDaArea(totais, id));
    const planejada = area.status === STATUS_AREA.PLANEJADA;
    if (coluna === "situacao") return <Selo status={CHAVE_DO_SELO_AREA[area.status] ?? area.status} rotulo={rotuloDoStatusArea(area.status)} testId={`area-${id}-situacao`} />;
    if (coluna === "planejada") return l.planejada;
    if (planejada) return "—";
    if (coluna === "feita") return numeroOuLendo(area, "feita");
    if (coluna === "percentual") return <Barra barra={l.barra} texto={numeroOuLendo(area, "percentual")} testId={`area-${id}-percentual`} />;
    if (coluna === "custo") return numeroOuLendo(area, "custo");
    return area.status === STATUS_AREA.EM_ANDAMENTO ? numeroOuLendo(area, "ultimo") : l.conclusao;
  };

  const totalPlanejada = linhaDaAreaParaExibir({ area_planejada: totais?.area_planejada ?? atividade?.area_planejada }, { area_executada: totais?.area_executada ?? atividade?.area_executada });
  /** @param {string} coluna */
  const celulaDoTotal = (coluna) => {
    if (coluna === "planejada") return totalPlanejada.planejada;
    if (coluna === "feita") return lendoTotais && totalPlanejada.feita === "—" ? "…" : totalPlanejada.feita;
    if (coluna === "custo") return formatarMoedaAtividade(totais?.custo_total) || (lendoTotais ? "…" : "—");
    return "";
  };

  const tabela = (
    <div className="b1-tipo-tabela__rolagem">
      <table className="b1-tipo-tabela b1-areas-tabela" data-testid="areas-tabela">
        <thead>
          <tr>
            <th scope="col" className="b1-tipo-tabela__acoes">
              Ações
            </th>
            <th scope="col">Área</th>
            {colunas.map((c) => (
              <th key={c.id} scope="col" className={c.numero ? "is-numero" : undefined}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {areas.map((area) => {
            const id = String(area.id);
            const l = linhaDaAreaParaExibir(area, totaisDaArea(totais, id));
            return (
              <tr key={id} data-testid={`area-${id}`} data-status={area.status}>
                <td className="b1-tipo-tabela__acoes">{menuDaArea(area)}</td>
                <td className={celular ? undefined : "is-nome"}>
                  {area.status !== STATUS_AREA.PLANEJADA ? (
                    <button type="button" className="b1-tipo-tabela__abrir" onClick={() => onAbrirArea(id)} data-testid={`area-${id}-abrir`}>
                      {l.nome}
                    </button>
                  ) : (
                    l.nome
                  )}
                </td>
                {colunas.map((c) => (
                  <td key={c.id} className={c.numero ? "is-numero" : undefined} data-testid={c.id === "situacao" || c.id === "percentual" ? undefined : `area-${id}-${c.id}`}>
                    {celula(area, c.id)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr data-testid="areas-total">
            <td />
            <td>Total</td>
            {colunas.map((c) => (
              <td key={c.id} className={c.numero ? "is-numero" : undefined} data-testid={c.numero ? `areas-total-${c.id}` : undefined}>
                {celulaDoTotal(c.id)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
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
      {areas.length === 0 ? (
        <p className={NOTA} data-testid="atividade-areas-vazio">
          Esta atividade não tem áreas.{podeGerir ? " Use + Adicionar área." : ""}
        </p>
      ) : (
        tabela
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
