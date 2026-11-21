import React, { useMemo } from "react";
import { AlertCircle, X } from "lucide-react";
import { CampoDeAreasParaMarcar } from "@/components/lancamento-atividades/SeletorAreasDaAtividade";
import { formatarDecimalLinha } from "@/lib/atividadeLinhasRegras";
import { rotuloDaArea } from "@/lib/lancamentoAtividadesRegras";
import {
  AREAS_NO_REGISTRO_MAXIMO,
  alternarAreaNoRegistro,
  comHectaresDigitados,
  comPercentualDigitado,
  tamanhoDaArea,
  totaisDasAreasDoRegistro,
} from "@/lib/registroDeCampoRegras";

const NOTA = "min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";
const ENTRADA =
  "h-9 w-full min-w-0 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white px-2.5 text-right text-[13px] tabular-nums outline-none focus:border-emerald-500";

/** "38 ha" (sem valor, "—"). @param {string|null} v */
const ha = (v) => (v ? `${formatarDecimalLinha(v)} ha` : "—");

/**
 * D-PROD-263 — as ÁREAS do "Registrar serviço" (maquete "Nova realização"): o campo "Áreas" (busca + caixas, "N áreas
 * selecionadas") e, abaixo, a tabela das escolhidas — Área · Tamanho (ha) · % · Hectares (ha) · ✕ — com a linha de Total
 * (Σ tamanho e Σ hectares). % e Hectares andam juntos (% = hectares ÷ tamanho × 100): digitar um muda o outro; a área
 * entra com 100% do tamanho. A área presa (Detalhes da área no mapa) vem marcada e não sai; outras podem entrar. No
 * celular, cada área vira um cartão. Os hectares de cada área são os que vão ao servidor (`areas[].hectares`).
 *
 * Renderiza dois filhos da grade do formulário (o campo e a tabela), como os outros campos dele.
 *
 * @param {{
 *   areasDoMapa: any[],
 *   linhas: import("@/lib/registroDeCampoRegras").AreaDoRegistro[],
 *   onChange: (linhas: import("@/lib/registroDeCampoRegras").AreaDoRegistro[]) => void,
 *   erros?: Record<string, string>,
 *   travada?: string|null,
 *   celular?: boolean,
 *   readOnly?: boolean,
 *   carregando?: boolean,
 *   opcional?: boolean,
 * }} props `erros`: `areas` (nenhuma), `area:<id>` (os hectares ou a recusa do servidor naquela área) e `pct:<id>`.
 *   D-PROD-270: `opcional` (Manutenção e Outros) tira o asterisco e mostra "Nenhuma área" sem área escolhida.
 */
export default function AreasDoRegistro({ areasDoMapa, linhas, onChange, erros = {}, travada = null, celular = false, readOnly = false, carregando = false, opcional = false }) {
  const ativas = useMemo(() => areasDoMapa.filter((a) => a && a.id != null && a.ativo !== false), [areasDoMapa]);
  const travadas = useMemo(() => new Set(travada ? [String(travada)] : []), [travada]);
  const escolhidas = new Set(linhas.map((l) => l.area_id));
  const areaDe = (/** @type {string} */ id) => ativas.find((a) => String(a.id) === id) ?? areasDoMapa.find((a) => String(a?.id) === id) ?? null;
  const total = totaisDasAreasDoRegistro(linhas, areasDoMapa);
  const resumo = !linhas.length
    ? opcional ? "Nenhuma área" : "Selecione as áreas…"
    : linhas.length === 1
      ? rotuloDaArea(areaDe(linhas[0].area_id)) || "1 área"
      : `${linhas.length} áreas selecionadas`;

  /** @param {string} id @param {(l: any) => any} f */
  const mudar = (id, f) => onChange(linhas.map((l) => (l.area_id === id ? f(l) : l)));
  /** @param {string} id */
  const remover = (id) => onChange(alternarAreaNoRegistro(linhas, areaDe(id) ?? { id }, { travadas }));

  /** @param {import("@/lib/registroDeCampoRegras").AreaDoRegistro} l */
  const campoPercentual = (l) => {
    const a = areaDe(l.area_id);
    const semTamanho = !tamanhoDaArea(a);
    const erro = erros[`pct:${l.area_id}`];
    return (
      <span className="flex min-w-0 flex-col gap-0.5">
        <input
          type="text"
          inputMode="decimal"
          className={`${ENTRADA}${erro ? " border-red-400" : ""}`}
          value={semTamanho ? "" : l.percentual}
          placeholder={semTamanho ? "—" : undefined}
          onChange={(e) => mudar(l.area_id, (x) => comPercentualDigitado(x, e.target.value, a))}
          readOnly={readOnly || semTamanho}
          disabled={semTamanho}
          title={semTamanho ? "A área não tem tamanho cadastrado: informe os hectares." : undefined}
          aria-label={`% de ${rotuloDaArea(a) || "a área"}`}
          aria-invalid={erro ? true : undefined}
          data-testid={`registro-areas-percentual-${l.area_id}`}
        />
        {erro ? <span className="text-[11px] text-red-700">{erro}</span> : null}
      </span>
    );
  };

  /** @param {import("@/lib/registroDeCampoRegras").AreaDoRegistro} l */
  const campoHectares = (l) => {
    const a = areaDe(l.area_id);
    const erro = erros[`area:${l.area_id}`];
    return (
      <input
        type="text"
        inputMode="decimal"
        className={`${ENTRADA}${erro ? " border-red-400" : ""}`}
        value={l.hectares}
        onChange={(e) => mudar(l.area_id, (x) => comHectaresDigitados(x, e.target.value, a))}
        readOnly={readOnly}
        aria-label={`Hectares feitos em ${rotuloDaArea(a) || "a área"}`}
        aria-invalid={erro ? true : undefined}
        data-testid={`registro-areas-hectares-${l.area_id}`}
      />
    );
  };

  /** @param {string} id */
  const erroDaLinha = (id) =>
    erros[`area:${id}`] ? (
      <p role="alert" className="whitespace-normal break-words text-[12px] text-red-700" data-testid={`registro-areas-linha-${id}-erro`}>
        {erros[`area:${id}`]}
      </p>
    ) : null;

  /** @param {string} id */
  const botaoRemover = (id) =>
    readOnly || travadas.has(id) ? null : (
      <button type="button" className="tb-btn tb-btn-icon" aria-label={`Tirar ${rotuloDaArea(areaDe(id)) || "a área"}`} title="Tirar do registro" onClick={() => remover(id)} data-testid={`registro-areas-tirar-${id}`}>
        <X className="h-4 w-4" aria-hidden />
      </button>
    );

  const rotuloTotal = `${linhas.length} ${linhas.length === 1 ? "área" : "áreas"}`;

  return (
    <>
      <CampoDeAreasParaMarcar
        ativas={ativas}
        escolhidas={escolhidas}
        onAlternar={(a) => onChange(alternarAreaNoRegistro(linhas, a, { travadas }))}
        resumo={resumo}
        // D-PROD-270: opcional sem área, o rótulo sobe e "Nenhuma área" fica no lugar do valor (não por baixo do rótulo).
        temValor={linhas.length > 0 || opcional}
        obrigatorio={!opcional}
        readOnly={readOnly}
        carregando={carregando}
        travadas={travadas}
        limiteAtingido={linhas.length >= AREAS_NO_REGISTRO_MAXIMO}
        error={erros.areas}
        prefixo="registro-areas"
      />
      {linhas.length ? (
        celular ? (
          <ul className="col-span-12 flex min-w-0 flex-col gap-2" aria-label="Áreas do registro" data-testid="registro-areas-escolhidas">
            {linhas.map((l) => {
              const a = areaDe(l.area_id);
              const erro = erros[`area:${l.area_id}`];
              return (
                <li key={l.area_id} className={`b1-tipo-card${erro ? " is-recusada" : ""}`} data-testid={`registro-areas-linha-${l.area_id}`}>
                  <div className="b1-tipo-card__topo">
                    <div className="min-w-0 flex-1">
                      <p className="b1-tipo-card__titulo inline-flex min-w-0 items-center gap-1.5 break-words">
                        {erro ? <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden /> : null}
                        {rotuloDaArea(a) || l.area_id}
                      </p>
                      <p className={NOTA}>Tamanho {ha(tamanhoDaArea(a))}</p>
                    </div>
                    {botaoRemover(l.area_id)}
                  </div>
                  <div className="mt-2 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-2">
                    <label className="flex min-w-0 flex-col gap-0.5 text-[12px] text-[var(--mg-text-2,#475569)]">
                      %{campoPercentual(l)}
                    </label>
                    <label className="flex min-w-0 flex-col gap-0.5 text-[12px] text-[var(--mg-text-2,#475569)]">
                      Hectares (ha){campoHectares(l)}
                    </label>
                  </div>
                  {erroDaLinha(l.area_id)}
                </li>
              );
            })}
            <li className="flex items-center justify-between gap-2 rounded-[10px] bg-[var(--mg-surface-2,#F5F5F2)] px-3 py-2 text-[13px] font-semibold" data-testid="registro-areas-total">
              <span className="flex min-w-0 flex-col">
                <span className="break-words">Total · {rotuloTotal}</span>
                <span className="text-[12px] font-normal text-[var(--mg-text-2,#475569)]">Tamanho {ha(total.tamanho)}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span>{ha(total.hectares)}</span>
                <span className="text-[12px] font-normal text-[var(--mg-text-2,#475569)]">feitos</span>
              </span>
            </li>
          </ul>
        ) : (
          <div className="col-span-12 min-w-0 b1-tipo-tabela__rolagem">
            <table className="b1-tipo-tabela" aria-label="Áreas do registro" data-testid="registro-areas-escolhidas">
              <thead>
                <tr>
                  <th scope="col">Área</th>
                  <th scope="col" className="is-numero">
                    Tamanho (ha)
                  </th>
                  <th scope="col" className="is-numero" style={{ width: 96 }}>
                    %
                  </th>
                  <th scope="col" className="is-numero" style={{ width: 140 }}>
                    Hectares (ha)
                  </th>
                  <th scope="col" className="b1-tipo-tabela__acoes">
                    <span className="sr-only">Tirar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const a = areaDe(l.area_id);
                  const erro = erros[`area:${l.area_id}`];
                  return (
                    <React.Fragment key={l.area_id}>
                      <tr className={erro ? "is-recusada" : undefined} data-recusada={erro ? "" : undefined} data-testid={`registro-areas-linha-${l.area_id}`}>
                        <td className="is-nome">
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            {erro ? <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden /> : null}
                            {rotuloDaArea(a) || l.area_id}
                          </span>
                        </td>
                        <td className="is-numero">{ha(tamanhoDaArea(a))}</td>
                        <td className="is-numero">{campoPercentual(l)}</td>
                        <td className="is-numero">{campoHectares(l)}</td>
                        <td className="b1-tipo-tabela__acoes">{botaoRemover(l.area_id)}</td>
                      </tr>
                      {erro ? (
                        <tr className="is-recusada">
                          <td colSpan={5}>{erroDaLinha(l.area_id)}</td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr data-testid="registro-areas-total">
                  <td>Total · {rotuloTotal}</td>
                  <td className="is-numero">{ha(total.tamanho)}</td>
                  <td />
                  <td className="is-numero">{ha(total.hectares)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      ) : null}
    </>
  );
}
