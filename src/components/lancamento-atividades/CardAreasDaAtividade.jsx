import React, { useState } from "react";
import { CircleCheck, FolderOpen, MapPin, Play, Plus, RotateCcw, Ruler, Trash2 } from "lucide-react";
import { B1MenuAcoesDaLinha } from "@/components/cadastro/base1/B1AcoesDaLinha";
import { useCelular } from "@/components/common/MobileSheet";
import { Selo } from "@/components/financeiroGestao/ConsultaLancamento";
import DialogoAreaDaAtividade from "@/components/lancamento-atividades/DialogoAreaDaAtividade";
import TabelaBase1 from "@/components/lancamento-atividades/TabelaBase1";
import {
  CHAVE_DO_SELO_AREA,
  STATUS_AREA,
  areasDaAtividade,
  linhaDaAreaParaExibir,
  podeRemoverArea,
  rotuloDoStatusArea,
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
 * A tabela das áreas da atividade (D-PROD-249, a única lista de áreas da D-PROD-252; emenda 2: a grade Base1 da lista, sem
 * cartão, título nem contadores): UMA tabela (`TabelaBase1`) com todas as áreas, na ordem da atividade — Área, Situação,
 * Planejada, Feita, %, Custo, Último lançamento e o ⚡ — e a linha de total no `<tfoot>`. O nome da área (ou dois cliques na
 * linha) abre a área; o ⚡ abre a área e inicia, conclui, reabre, altera a planejada ou remove (o que o status e a permissão
 * deixam). Os números vêm só do servidor (`por_area` dos totais); sem valor, "—". No celular as colunas principais vêm
 * primeiro: Área, Custo, Feita, %, e depois o resto.
 *
 * @param {{
 *   atividade: any,
 *   totais: any,
 *   lendoTotais: boolean,
 *   podeGerir: boolean,
 *   apontamentos?: any[],
 *   podeInformarFeita?: boolean,
 *   onAbrirArea: (atividadeAreaId: string) => void,
 *   onAtividadeAtualizada: (atividade: any) => void,
 * }} props `podeGerir`: a atividade ABERTA e a permissão de editá-la (iniciar, concluir, reabrir, adicionar, remover e a
 *   planejada). `podeInformarFeita`: a atividade aberta com a permissão de editar lançamento — a Feita (ha) da área em
 *   andamento ou concluída se informa pelo número da coluna ou pelo ⚡ ("Hectares feitos"); grava no lançamento da área.
 */
export default function CardAreasDaAtividade({ atividade, totais, lendoTotais, podeGerir, apontamentos = [], podeInformarFeita = false, onAbrirArea, onAtividadeAtualizada }) {
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
    const feita = podeInformarFeita && area.status !== STATUS_AREA.PLANEJADA ? [{ key: "feita", label: "Hectares feitos", icon: <Ruler size={16} strokeWidth={1.75} />, onSelect: () => setDialogo({ modo: "feita", area }) }] : [];
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
        grupos={[abrir, feita, gerir]}
        testId={`area-acoes-${id}`}
      />
    );
  };

  // As colunas, na ordem do computador e do celular (o dado principal — Custo, Feita — aparece sem rolar).
  const COLUNAS = [
    { id: "area", label: "Área", sortable: true, width: 200 },
    { id: "situacao", label: "Situação", sortable: true, width: 130 },
    { id: "planejada", label: "Planejada", sortable: true, align: "right", width: 110 },
    { id: "feita", label: "Feita", sortable: true, align: "right", width: 110 },
    { id: "percentual", label: "%", sortable: true, width: 130 },
    { id: "custo", label: "Custo", sortable: true, align: "right", width: 130 },
    { id: "ultimo", label: "Último lançamento", sortable: true, width: 150 },
  ];
  const ORDEM_CELULAR = ["area", "custo", "feita", "percentual", "situacao", "planejada", "ultimo"];
  const colunas = celular ? ORDEM_CELULAR.map((id) => /** @type {any} */ (COLUNAS.find((c) => c.id === id))) : COLUNAS;

  /** O texto de cada coluna de uma área (também o do filtro, da ordem e do balão da grade). @param {any} area @param {string} coluna */
  const texto = (area, coluna) => {
    const id = String(area.id);
    const l = linhaDaAreaParaExibir(area, totaisDaArea(totais, id));
    if (coluna === "area") return l.nome;
    if (coluna === "situacao") return rotuloDoStatusArea(area.status);
    if (coluna === "planejada") return l.planejada;
    if (area.status === STATUS_AREA.PLANEJADA) return "—";
    if (coluna === "ultimo") return area.status === STATUS_AREA.EM_ANDAMENTO ? numeroOuLendo(area, "ultimo") : l.conclusao;
    return numeroOuLendo(area, coluna);
  };

  /** @param {any} area @param {string} coluna */
  const celula = (area, coluna) => {
    const id = String(area.id);
    const l = linhaDaAreaParaExibir(area, totaisDaArea(totais, id));
    const valor = texto(area, coluna);
    if (coluna === "area") {
      return area.status !== STATUS_AREA.PLANEJADA ? (
        <button type="button" className="b1-tipo-tabela__abrir" onClick={() => onAbrirArea(id)} data-testid={`area-${id}-abrir`}>
          {valor}
        </button>
      ) : (
        <span data-testid={`area-${id}-nome`}>{valor}</span>
      );
    }
    if (coluna === "situacao") return <Selo status={CHAVE_DO_SELO_AREA[area.status] ?? area.status} rotulo={valor} testId={`area-${id}-situacao`} />;
    if (coluna === "percentual" && area.status !== STATUS_AREA.PLANEJADA) return <Barra barra={l.barra} texto={valor} testId={`area-${id}-percentual`} />;
    if (coluna === "feita" && podeInformarFeita && area.status !== STATUS_AREA.PLANEJADA) {
      return (
        <button type="button" className="b1-tipo-tabela__abrir" onClick={() => setDialogo({ modo: "feita", area })} title="Informar os hectares feitos" data-testid={`area-${id}-feita-editar`}>
          {valor}
        </button>
      );
    }
    return <span data-testid={`area-${id}-${coluna}`}>{valor}</span>;
  };

  const totalPlanejada = linhaDaAreaParaExibir({ area_planejada: totais?.area_planejada ?? atividade?.area_planejada }, { area_executada: totais?.area_executada ?? atividade?.area_executada });
  /** @param {string} coluna */
  const celulaDoTotal = (coluna) => {
    if (coluna === "area") return "Total";
    if (coluna === "planejada") return totalPlanejada.planejada;
    if (coluna === "feita") return lendoTotais && totalPlanejada.feita === "—" ? "…" : totalPlanejada.feita;
    if (coluna === "custo") return formatarMoedaAtividade(totais?.custo_total) || (lendoTotais ? "…" : "—");
    return "";
  };

  return (
    <section className="b1-tabela-tela" aria-label="Áreas da atividade" data-testid="atividade-areas">
      {podeGerir ? (
        <div className="b1-tabela-tela__acoes">
          <button type="button" className="b1-tipo-lancar" onClick={() => setDialogo({ modo: "adicionar", area: null })} data-testid="atividade-areas-adicionar">
            <Plus size={13} strokeWidth={2} aria-hidden /> Adicionar área
          </button>
        </div>
      ) : null}
      {areas.length === 0 ? (
        <p className={NOTA} data-testid="atividade-areas-vazio">
          Esta atividade não tem áreas.{podeGerir ? " Use + Adicionar área." : ""}
        </p>
      ) : (
        <TabelaBase1
          testId="areas-tabela"
          chave="lancamento-atividade-areas"
          colunas={colunas}
          linhas={areas}
          valorDoCampo={texto}
          renderCelula={celula}
          renderAcoes={menuDaArea}
          onAbrir={(area) => area.status !== STATUS_AREA.PLANEJADA && onAbrirArea(String(area.id))}
          rodape={(ids, comSelecao) => (
            <tr data-testid="areas-total">
              {comSelecao ? <td /> : null}
              {ids.map((id) => (
                <td key={id} className={id === "planejada" || id === "feita" || id === "custo" ? "is-numero text-right tabular-nums" : undefined}>
                  <span data-testid={id === "area" || id === "percentual" || id === "situacao" || id === "ultimo" ? undefined : `areas-total-${id}`}>{celulaDoTotal(id)}</span>
                </td>
              ))}
            </tr>
          )}
        />
      )}
      {dialogo ? (
        <DialogoAreaDaAtividade
          key={`${dialogo.modo}-${dialogo.area?.id ?? "nova"}-${dialogo.area?.versao ?? 0}`}
          modo={dialogo.modo}
          atividade={atividade}
          area={dialogo.area}
          apontamentos={apontamentos}
          feitaAtual={dialogo.modo === "feita" ? totaisDaArea(totais, dialogo.area?.id)?.area_executada ?? null : null}
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
