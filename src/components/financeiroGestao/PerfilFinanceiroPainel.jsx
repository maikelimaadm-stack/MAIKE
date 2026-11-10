import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import B1Select from "@/components/cadastro/base1/B1Select";
import { formatarMoeda } from "@/lib/dinheiroDecimal";
import { PERFIL_PADRAO, ROTULO_LOCALE, ROTULO_PAIS } from "@/services/operacaoFinanceiraService";

const CTL = "flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white px-3 text-left text-[14px]";

/**
 * Perfil financeiro da empresa (§2.1/§8.6): país (só metadado, sem efeito
 * fiscal), moeda (fixa depois do 1º lançamento) e formato de números/datas.
 * Sem perfil não há lançamento. Só o administrador grava; os demais veem o
 * aviso. Padrões EXPLICADOS: Brasil, Real (BRL) e português do Brasil.
 *
 * @param {{
 *   catalogo: { moedas: Array<{ codigo: string, casas: number }>, paises: string[], locales: string[] },
 *   perfilAtual?: { pais: string, moeda: string, locale: string } | null,
 *   podeEditar: boolean,
 *   onSalvar: (dados: { pais: string, moeda: string, locale: string }) => void,
 *   salvando?: boolean,
 *   erro?: string|null,
 *   onFechar?: (() => void) | null,
 * }} props
 */
export default function PerfilFinanceiroPainel({ catalogo, perfilAtual = null, podeEditar, onSalvar, salvando = false, erro = null, onFechar = null }) {
  const [pais, setPais] = useState(perfilAtual?.pais ?? PERFIL_PADRAO.pais);
  const [moeda, setMoeda] = useState(perfilAtual?.moeda ?? PERFIL_PADRAO.moeda);
  const [locale, setLocale] = useState(perfilAtual?.locale ?? PERFIL_PADRAO.locale);
  const casas = catalogo.moedas.find((m) => m.codigo === moeda)?.casas ?? 2;
  const exemplo = formatarMoeda(casas > 0 ? "1234.5" : "1234", { locale, moeda, casas });
  const novo = !perfilAtual;

  if (!podeEditar) {
    return (
      <div role="status" data-testid="perfil-financeiro-aviso" className="cadastro-b1 mg-card mb-2 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        {novo
          ? "Esta empresa ainda não tem perfil financeiro (país, moeda e formato). Peça ao administrador da fazenda para configurá-lo; sem ele não há lançamentos."
          : "Somente o administrador da fazenda altera o perfil financeiro."}
      </div>
    );
  }

  return (
    <section data-testid="perfil-financeiro-painel" aria-label="Configurar perfil financeiro da empresa" className="cadastro-b1 mg-card mb-2 border border-sky-200 bg-white p-3 text-[13px]">
      <h3 className="text-[13px] font-semibold uppercase">{novo ? "Configurar perfil financeiro da empresa" : "Perfil financeiro da empresa"}</h3>
      {!novo ? (
        <p className="mt-1 text-[12px] font-medium text-amber-800">País e formato podem mudar; a moeda fica fixa depois do primeiro lançamento.</p>
      ) : null}
      <p className="mt-1 text-[12px] text-[var(--mg-text-2,#475569)]">
        Padrão sugerido: Brasil, Real (BRL) e português do Brasil — o comum para fazendas no Brasil. O país é só informativo (sem efeito fiscal); a moeda vale para
        todos os lançamentos desta empresa e não pode ser trocada depois que houver lançamentos; o formato define como números e datas aparecem e são digitados.
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="min-w-0 text-[12px]">
          País
          <B1Select className={CTL} value={pais} onChange={(e) => setPais(e.target.value)} aria-label="País">
            {catalogo.paises.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PAIS[/** @type {keyof typeof ROTULO_PAIS} */ (p)] ?? p}
              </option>
            ))}
          </B1Select>
        </label>
        <label className="min-w-0 text-[12px]">
          Moeda
          <B1Select className={CTL} value={moeda} onChange={(e) => setMoeda(e.target.value)} aria-label="Moeda">
            {catalogo.moedas.map((m) => (
              <option key={m.codigo} value={m.codigo}>
                {m.codigo} ({m.casas} {m.casas === 1 ? "casa" : "casas"})
              </option>
            ))}
          </B1Select>
        </label>
        <label className="min-w-0 text-[12px]">
          Formato de números e datas
          <B1Select className={CTL} value={locale} onChange={(e) => setLocale(e.target.value)} aria-label="Formato de números e datas">
            {catalogo.locales.map((l) => (
              <option key={l} value={l}>
                {ROTULO_LOCALE[/** @type {keyof typeof ROTULO_LOCALE} */ (l)] ?? l}
              </option>
            ))}
          </B1Select>
        </label>
      </div>
      <p className="mt-2 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="perfil-exemplo">
        Exemplo: {exemplo}. {pais === "BR" && moeda === "BRL" ? "Pix fica disponível como forma de pagamento." : "Pix só existe para Brasil com Real."}
      </p>
      {erro ? (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-[12px] text-red-800">
          {erro}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => onSalvar({ pais, moeda, locale })}
        disabled={salvando}
        data-testid="botao-confirmar-perfil"
        className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {salvando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
        {novo ? "Confirmar perfil" : "Salvar perfil"}
      </button>
      {onFechar ? (
        <button
          type="button"
          onClick={onFechar}
          disabled={salvando}
          className="ml-2 mt-2 inline-flex min-h-10 items-center rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-4 text-[13px] font-medium hover:bg-slate-50 disabled:opacity-60"
        >
          Fechar
        </button>
      ) : null}
    </section>
  );
}
