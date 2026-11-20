import React, { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, X } from "lucide-react";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import { GRUPO_LAVOURA, GRUPO_PASTO, grupoDaArea } from "@/lib/atividadeFluxoCampo";
import { useCelular } from "@/components/common/MobileSheet";
import { formatarDecimalLinha } from "@/lib/atividadeLinhasRegras";
import { rotuloDaArea } from "@/lib/lancamentoAtividadesRegras";
import { alternarAreaNaAbertura, hectaresCanonicos, planejadaMaiorQueArea, totaisDaAbertura } from "@/lib/atividadeAreasRegras";

const NOTA = "min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";
const ENTRADA =
  "h-9 w-full min-w-0 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white px-2.5 text-right text-[13px] tabular-nums outline-none focus:border-emerald-500";

/** "Pasto" / "Talhão" / "Outra" — a classificação já usada na escolha de áreas. @param {any} a */
const rotuloDoTipo = (a) => {
  const g = grupoDaArea(a);
  return g === GRUPO_LAVOURA ? "Talhão" : g === GRUPO_PASTO ? "Pasto" : "Outra";
};

/** "10 ha" (sem valor, "—"). @param {unknown} v */
const ha = (v) => {
  const c = hectaresCanonicos(v);
  return c === null ? "—" : `${formatarDecimalLinha(c)} ha`;
};

/**
 * D-PROD-249 — o campo "Áreas" da abertura da atividade: as áreas ativas da fazenda para MARCAR (busca + caixas) e,
 * conforme a pessoa marca, a lista das escolhidas abaixo — Área · Setor · Tamanho (ha) · Área planejada (ha, editável,
 * padrão = o tamanho) · ✕ — e a linha de total. Todas entram "a iniciar": o lançamento começa quando a pessoa inicia
 * a área. No celular, a lista vira cartões.
 *
 * @param {{
 *   areasDoMapa: any[],
 *   linhas: import("@/lib/atividadeAreasRegras").LinhaDaAbertura[],
 *   onChange: (linhas: import("@/lib/atividadeAreasRegras").LinhaDaAbertura[]) => void,
 *   erros?: Record<string, string>,
 *   obrigatorio?: boolean,
 *   readOnly?: boolean,
 *   carregando?: boolean,
 * }} props `erros`: `areas` (nenhuma escolhida e o tipo exige) e `area:<id>` (a planejada daquela área).
 */
export default function SeletorAreasDaAtividade({ areasDoMapa, linhas, onChange, erros = {}, obrigatorio = false, readOnly = false, carregando = false }) {
  const celular = useCelular();
  const ativas = useMemo(() => areasDoMapa.filter((a) => a && a.id != null && a.ativo !== false), [areasDoMapa]);
  const escolhidas = new Set(linhas.map((l) => l.area_id));
  const total = totaisDaAbertura(linhas, ativas);
  const resumo = !linhas.length
    ? "Selecione as áreas…"
    : linhas.length === 1
      ? rotuloDaArea(ativas.find((a) => String(a.id) === linhas[0].area_id)) || "1 área"
      : `${linhas.length} áreas selecionadas`;
  const areaDe = (/** @type {string} */ id) => ativas.find((a) => String(a.id) === id) ?? null;

  /** @param {string} id @param {string} v */
  const mudarPlanejada = (id, v) => onChange(linhas.map((l) => (l.area_id === id ? { ...l, area_planejada: v } : l)));
  /** @param {string} id */
  const remover = (id) => onChange(linhas.filter((l) => l.area_id !== id));

  /** @param {import("@/lib/atividadeAreasRegras").LinhaDaAbertura} l */
  const campoPlanejada = (l) => {
    const a = areaDe(l.area_id);
    const erro = erros[`area:${l.area_id}`];
    return (
      <span className="flex min-w-0 flex-col gap-0.5">
        <input
          type="text"
          inputMode="decimal"
          className={`${ENTRADA}${erro ? " border-red-400" : ""}`}
          value={l.area_planejada}
          onChange={(e) => mudarPlanejada(l.area_id, e.target.value)}
          readOnly={readOnly}
          aria-label={`Área planejada de ${rotuloDaArea(a)} (ha)`}
          aria-invalid={erro ? true : undefined}
          data-testid={`areas-abertura-planejada-${l.area_id}`}
        />
        {erro ? <span className="text-[11px] text-red-700">{erro}</span> : null}
        {!erro && planejadaMaiorQueArea(l.area_planejada, a?.tamanho_hectares) ? <span className="text-[11px] text-amber-700">Maior que o tamanho da área.</span> : null}
      </span>
    );
  };

  /** @param {string} id */
  const botaoRemover = (id) =>
    readOnly ? null : (
      <button type="button" className="tb-btn tb-btn-icon" aria-label={`Tirar ${rotuloDaArea(areaDe(id)) || "a área"}`} title="Tirar da atividade" onClick={() => remover(id)} data-testid={`areas-abertura-tirar-${id}`}>
        <X className="h-4 w-4" aria-hidden />
      </button>
    );

  const planejadaTotal = total.planejada ? `${formatarDecimalLinha(total.planejada)} ha` : "—";
  const tamanhoTotal = total.tamanho ? `${formatarDecimalLinha(total.tamanho)} ha` : "—";

  return (
    <div className="col-span-12 min-w-0" data-testid="areas-abertura">
      <p className="mb-1 text-[12px] font-semibold text-[var(--mg-text-1,#0f172a)]">
        Áreas{obrigatorio ? <span className="text-red-600"> *</span> : null}
      </p>
      <p className={`${NOTA} mb-2`}>
        Abra a lista e marque os pastos ou talhões desta atividade. Elas entram <strong>a iniciar</strong>: os lançamentos começam quando você inicia cada área, no card
        &quot;Áreas da atividade&quot;.
      </p>
      <CampoDeAreasParaMarcar
        ativas={ativas}
        escolhidas={escolhidas}
        onAlternar={(a) => onChange(alternarAreaNaAbertura(linhas, a))}
        resumo={resumo}
        temValor={linhas.length > 0}
        obrigatorio={obrigatorio}
        readOnly={readOnly}
        carregando={carregando}
        prefixo="areas-abertura"
      />
      {erros.areas ? (
        <p className="mt-1 text-[12px] text-red-700" role="alert" data-testid="areas-abertura-erro">
          {erros.areas}
        </p>
      ) : null}

      {linhas.length ? (
        celular ? (
          <ul className="mt-3 flex flex-col gap-2" data-testid="areas-abertura-escolhidas">
            {linhas.map((l) => {
              const a = areaDe(l.area_id);
              return (
                <li key={l.area_id} className="rounded-[10px] border border-[var(--mg-divider,#E8E7E2)] bg-white p-3" data-testid={`areas-abertura-linha-${l.area_id}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold">{rotuloDaArea(a) || l.area_id}</p>
                      <p className={NOTA}>{[rotuloDoTipo(a), a?.setor_nome, `Tamanho ${ha(a?.tamanho_hectares)}`].filter(Boolean).join(" · ")}</p>
                    </div>
                    {botaoRemover(l.area_id)}
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_120px] items-center gap-2">
                    <span className="text-[12px] text-[var(--mg-text-2,#475569)]">Hectares (ha)</span>
                    {campoPlanejada(l)}
                  </div>
                </li>
              );
            })}
            <li className="flex items-center justify-between rounded-[10px] bg-[var(--mg-surface-2,#F5F5F2)] px-3 py-2 text-[13px] font-semibold" data-testid="areas-abertura-total">
              <span>
                {linhas.length} {linhas.length === 1 ? "área" : "áreas"} · {tamanhoTotal}
              </span>
              <span>Planejada {planejadaTotal}</span>
            </li>
          </ul>
        ) : (
          <div className="b1-tipo-tabela__rolagem mt-3">
            <table className="b1-tipo-tabela" data-testid="areas-abertura-escolhidas">
              <thead>
                <tr>
                  <th scope="col">Área</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Setor</th>
                  <th scope="col" className="is-numero">
                    Tamanho (ha)
                  </th>
                  <th scope="col" className="is-numero" style={{ width: 160 }}>
                    Hectares (ha)
                  </th>
                  <th scope="col" className="b1-tipo-tabela__acoes" aria-label="Tirar" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const a = areaDe(l.area_id);
                  return (
                    <tr key={l.area_id} data-testid={`areas-abertura-linha-${l.area_id}`}>
                      <td className="is-nome">{rotuloDaArea(a) || l.area_id}</td>
                      <td>{rotuloDoTipo(a)}</td>
                      <td>{a?.setor_nome || "—"}</td>
                      <td className="is-numero">{ha(a?.tamanho_hectares)}</td>
                      <td className="is-numero">{campoPlanejada(l)}</td>
                      <td className="b1-tipo-tabela__acoes">{botaoRemover(l.area_id)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr data-testid="areas-abertura-total">
                  <td>
                    Total · {linhas.length} {linhas.length === 1 ? "área" : "áreas"}
                  </td>
                  <td />
                  <td />
                  <td className="is-numero">{tamanhoTotal}</td>
                  <td className="is-numero">{planejadaTotal}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}

/**
 * O campo "Áreas" para MARCAR as áreas ativas da fazenda: o botão (o resumo: "Selecione as áreas…", o nome da única ou
 * "N áreas selecionadas") abre a lista com busca e caixas. É o mesmo da abertura da atividade (D-PROD-249) e do
 * "Registrar serviço" de várias áreas (D-PROD-263). `travadas`: as áreas que não saem (a caixa fica marcada e
 * desabilitada). `prefixo` forma os testids (`<prefixo>-campo`, `-lista`, `-busca`, `-opcoes`, `-opcao-<id>`).
 * @param {{ ativas: any[], escolhidas: Set<string>, onAlternar: (area: any) => void, resumo: string, temValor: boolean,
 *   prefixo: string, obrigatorio?: boolean, readOnly?: boolean, carregando?: boolean, travadas?: Set<string>, limiteAtingido?: boolean,
 *   error?: string }} props `limiteAtingido`: as não marcadas ficam desabilitadas.
 */
export function CampoDeAreasParaMarcar({ ativas, escolhidas, onAlternar, resumo, temValor, prefixo, obrigatorio = false, readOnly = false, carregando = false, travadas = undefined, limiteAtingido = false, error = undefined }) {
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const filtradas = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase("pt-BR");
    if (!q) return ativas;
    return ativas.filter((a) => `${rotuloDaArea(a)} ${a.setor_nome ?? ""}`.toLocaleLowerCase("pt-BR").includes(q));
  }, [ativas, busca]);
  return (
    <B1Field label="Áreas" required={obrigatorio} span={12} hasValue={temValor} locked={readOnly} disabled={readOnly} error={error}>
      <Popover.Root open={aberto && !readOnly} onOpenChange={(o) => { setAberto(o); setBusca(""); }}>
        <Popover.Trigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={aberto}
            aria-haspopup="dialog"
            aria-label="Áreas"
            disabled={readOnly}
            className={`${B1_FIELD_CTL_CLS} b1-select-btn`}
            {...(temValor ? {} : { "data-placeholder": "" })}
            data-testid={`${prefixo}-campo`}
          >
            <span className="b1-select-btn__v">{resumo}</span>
            <ChevronDown aria-hidden className="b1-select-btn__c" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            side="bottom"
            sideOffset={5}
            collisionPadding={8}
            aria-label="Áreas da fazenda"
            className="mk-map-multi-popup"
            style={{ width: "var(--radix-popover-trigger-width)", minWidth: 240 }}
            data-testid={`${prefixo}-lista`}
          >
            <input
              type="search"
              placeholder="Pesquisar…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Pesquisar área"
              data-testid={`${prefixo}-busca`}
            />
            <div className="mk-map-multi-options" role="group" aria-label="Áreas da fazenda" data-testid={`${prefixo}-opcoes`}>
              {carregando ? <p className={`${NOTA} px-3 py-2`}>Carregando as áreas…</p> : null}
              {!carregando && !filtradas.length ? <p className={`${NOTA} px-3 py-2`}>{ativas.length ? "Nenhuma área com esse nome." : "Nenhuma área ativa nesta fazenda."}</p> : null}
              {filtradas.map((a) => {
                const id = String(a.id);
                const detalhe = [rotuloDoTipo(a), a.setor_nome, ha(a.tamanho_hectares)].filter((x) => x && x !== "—").join(" · ");
                return (
                  <label key={id}>
                    <span>
                      {rotuloDaArea(a) || id}
                      <small className="ml-2 text-[11px] opacity-70">{detalhe}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={escolhidas.has(id)}
                      disabled={travadas?.has(id) || (limiteAtingido && !escolhidas.has(id))}
                      onChange={() => onAlternar(a)}
                      data-testid={`${prefixo}-opcao-${id}`}
                    />
                  </label>
                );
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </B1Field>
  );
}
