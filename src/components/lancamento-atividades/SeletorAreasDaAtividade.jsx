import React, { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useCelular } from "@/components/common/MobileSheet";
import { formatarDecimalLinha } from "@/lib/atividadeLinhasRegras";
import { rotuloDaArea } from "@/lib/lancamentoAtividadesRegras";
import { alternarAreaNaAbertura, hectaresCanonicos, planejadaMaiorQueArea, totaisDaAbertura } from "@/lib/atividadeAreasRegras";

const NOTA = "min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";
const ENTRADA =
  "h-9 w-full min-w-0 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white px-2.5 text-right text-[13px] tabular-nums outline-none focus:border-emerald-500";

/** "10 ha" (sem valor, "—"). @param {unknown} v */
const ha = (v) => {
  const c = hectaresCanonicos(v);
  return c === null ? "—" : `${formatarDecimalLinha(c)} ha`;
};

/**
 * D-PROD-238 — o campo "Áreas" da abertura da atividade: as áreas ativas da fazenda para MARCAR (busca + caixas) e,
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
  const [busca, setBusca] = useState("");
  const ativas = useMemo(() => areasDoMapa.filter((a) => a && a.id != null && a.ativo !== false), [areasDoMapa]);
  const filtradas = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase("pt-BR");
    if (!q) return ativas;
    return ativas.filter((a) => `${rotuloDaArea(a)} ${a.setor_nome ?? ""}`.toLocaleLowerCase("pt-BR").includes(q));
  }, [ativas, busca]);
  const escolhidas = new Set(linhas.map((l) => l.area_id));
  const total = totaisDaAbertura(linhas, ativas);
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
        Marque as áreas (pastos) desta atividade. Elas entram <strong>a iniciar</strong>: os lançamentos começam quando você inicia cada área, no card
        &quot;Áreas da atividade&quot;.
      </p>
      {!readOnly ? (
        <div className="b1-areas-seletor rounded-[10px] border border-[var(--mg-divider,#E8E7E2)] bg-white">
          <label className="flex items-center gap-2 border-b border-[var(--mg-divider,#E8E7E2)] px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-[var(--mg-text-3,#64748b)]" aria-hidden />
            <input
              type="search"
              className="h-8 w-full min-w-0 bg-transparent text-[13px] outline-none"
              placeholder="Pesquisar área ou setor…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Pesquisar área"
              data-testid="areas-abertura-busca"
            />
          </label>
          <ul className="max-h-[200px] overflow-y-auto py-1" role="group" aria-label="Áreas da fazenda" data-testid="areas-abertura-opcoes">
            {carregando ? <li className={`${NOTA} px-3 py-2`}>Carregando as áreas…</li> : null}
            {!carregando && !filtradas.length ? <li className={`${NOTA} px-3 py-2`}>{ativas.length ? "Nenhuma área com esse nome." : "Nenhuma área ativa nesta fazenda."}</li> : null}
            {filtradas.map((a) => {
              const id = String(a.id);
              const marcada = escolhidas.has(id);
              return (
                <li key={id}>
                  <label className={`flex min-h-10 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-[var(--mg-hover,#F5F5F2)]${marcada ? " bg-emerald-50/60" : ""}`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-emerald-600"
                      checked={marcada}
                      onChange={() => onChange(alternarAreaNaAbertura(linhas, a))}
                      data-testid={`areas-abertura-opcao-${id}`}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{rotuloDaArea(a) || id}</span>
                    <span className="shrink-0 text-[12px] text-[var(--mg-text-2,#475569)]">
                      {[a.setor_nome, ha(a.tamanho_hectares)].filter((x) => x && x !== "—").join(" · ")}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
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
                      <p className={NOTA}>{[a?.setor_nome, `Tamanho ${ha(a?.tamanho_hectares)}`].filter(Boolean).join(" · ")}</p>
                    </div>
                    {botaoRemover(l.area_id)}
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_120px] items-center gap-2">
                    <span className="text-[12px] text-[var(--mg-text-2,#475569)]">Área planejada (ha)</span>
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
                  <th scope="col">Setor</th>
                  <th scope="col" className="is-numero">
                    Tamanho (ha)
                  </th>
                  <th scope="col" className="is-numero" style={{ width: 160 }}>
                    Área planejada (ha)
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
