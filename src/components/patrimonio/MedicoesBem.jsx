import React from "react";
import { X } from "lucide-react";
import { notifyWarning } from "@/lib/maikeNotify";
import { CampoSelect, CampoTexto } from "@/components/gestao/GestaoFormParts";
import { CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { listarOpcoesBem } from "@/services/bemPatrimonialService";
import { ROTULO_DIMENSAO, rotuloDaUnidade } from "@/lib/patrimonioDominio";
import { LIMITE_MEDICOES, LOCALE_BEM, limitesDaMedicao, medicaoDoPerfil } from "@/components/patrimonio/bemFormulario";

/** @typedef {import('./bemFormulario').MedicaoForm} MedicaoForm */

/** @param {MedicaoForm} m */
const nomeDaMedicao = (m) => m.perfil.nome || m.perfil.codigo || "Medição";

/**
 * Medições físicas da benfeitoria (D-PROD-157): perfil de medição + valor +
 * unidade (só as permitidas pelo perfil) + rótulo + principal. Quantidade e
 * cabeças em número inteiro. Até 20 medições, sem perfil repetido; no máximo
 * uma principal (sem nenhuma, o servidor faz da primeira a principal).
 *
 * As unidades vêm do perfil ATIVO (`perfisAtivos`); medição gravada de perfil
 * que não está mais ativo mantém só a unidade dela.
 *
 * @param {{
 *   medicoes: MedicaoForm[],
 *   onChange: (atualizar: (atual: MedicaoForm[]) => MedicaoForm[]) => void,
 *   perfisAtivos: Map<string, any>|null,
 *   readOnly: boolean,
 *   erros: Record<string, string>,
 *   limparErro: (chave: string) => void,
 * }} props
 */
export default function MedicoesBem({ medicoes, onChange, perfisAtivos, readOnly, erros, limparErro }) {
  /** @param {MedicaoForm} m @returns {string[]} */
  const unidadesDe = (m) => {
    const ativo = perfisAtivos?.get(m.perfil.id);
    const permitidas = m.perfil.unidades_permitidas ?? (Array.isArray(ativo?.unidades_permitidas) ? ativo.unidades_permitidas.map(String) : null);
    if (permitidas?.length) return permitidas.includes(m.unidade) || !m.unidade ? permitidas : [...permitidas, m.unidade];
    return m.unidade ? [m.unidade] : [];
  };

  /** @param {string} chave @param {Partial<MedicaoForm>} mudanca */
  const alterar = (chave, mudanca) => onChange((atual) => atual.map((m) => (m.chave === chave ? { ...m, ...mudanca } : m)));

  const adicionar = (opcao) => {
    if (!opcao || readOnly) return;
    if (medicoes.some((m) => m.perfil.id === String(opcao.id))) {
      notifyWarning("Atenção", "Este perfil de medição já está no bem: altere a medição existente.");
      return;
    }
    if (medicoes.length >= LIMITE_MEDICOES) {
      notifyWarning("Atenção", `Um bem pode ter no máximo ${LIMITE_MEDICOES} medições.`);
      return;
    }
    onChange((atual) => [...atual, medicaoDoPerfil(opcao, !atual.some((m) => m.principal))]);
    limparErro("medicoes");
  };

  /** @param {string} chave */
  const alternarPrincipal = (chave) => onChange((atual) => atual.map((m) => ({ ...m, principal: m.chave === chave ? !m.principal : false })));

  /** @param {string} chave */
  const tirar = (chave) => {
    onChange((atual) => atual.filter((m) => m.chave !== chave));
    limparErro("medicoes");
  };

  return (
    <div className="mg-b1-form-grid col-span-12 grid grid-cols-12 gap-x-3 gap-y-2" data-testid="bem-medicoes">
      {medicoes.length === 0 ? (
        <p className="col-span-12 text-xs text-[var(--mg-text-2,#475569)]">
          Nenhuma medição. Informe o tamanho ou a capacidade da benfeitoria (área, extensão, volume, cabeças…).
        </p>
      ) : null}
      {medicoes.map((m, i) => {
        const nome = nomeDaMedicao(m);
        const unidades = unidadesDe(m);
        const limites = limitesDaMedicao(m);
        return (
          <div key={m.chave} className="col-span-12 grid grid-cols-12 gap-x-3 gap-y-2 rounded-md border border-[var(--mg-divider,#cbd5e1)] p-2" data-testid={`bem-medicao-${i}`}>
            <div className="col-span-12 flex min-h-8 flex-wrap items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1 break-words font-medium uppercase">
                {nome}
                {m.perfil.dimensao ? <span className="ml-2 normal-case text-[11px] text-[var(--mg-text-2,#475569)]">{ROTULO_DIMENSAO[m.perfil.dimensao] ?? m.perfil.dimensao}</span> : null}
                {!m.perfil.ativo ? <span className="ml-2 normal-case text-[11px] text-amber-700">(perfil inativo)</span> : null}
              </span>
              <button
                type="button"
                aria-pressed={m.principal}
                aria-label={`Medição principal: ${nome}`}
                disabled={readOnly}
                onClick={() => alternarPrincipal(m.chave)}
                className={`min-h-8 rounded-full border px-3 text-xs font-medium ${
                  m.principal ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-[var(--mg-divider,#cbd5e1)] bg-white"
                }`}
              >
                Principal
              </button>
              {!readOnly ? (
                <button
                  type="button"
                  aria-label={`Tirar a medição ${nome}`}
                  onClick={() => tirar(m.chave)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--mg-divider,#cbd5e1)]"
                >
                  <X aria-hidden size={14} />
                </button>
              ) : null}
            </div>
            <CampoNumero
              label="Valor"
              value={m.valor}
              onChange={(v) => {
                alterar(m.chave, { valor: v });
                limparErro(`medicoes.${i}.valor`);
              }}
              locale={LOCALE_BEM}
              limites={limites}
              readOnly={readOnly}
              required
              span={4}
              error={erros[`medicoes.${i}.valor`] || null}
              ajuda={limites.casas === 0 ? "Número inteiro" : null}
              testId={`bem-medicao-valor-${i}`}
            />
            <CampoSelect
              label="Unidade"
              value={m.unidade}
              onChange={(v) => {
                alterar(m.chave, { unidade: v });
                limparErro(`medicoes.${i}.unidade`);
              }}
              options={unidades.map((u) => ({ value: u, label: rotuloDaUnidade(u) }))}
              readOnly={readOnly || unidades.length <= 1}
              required
              span={4}
              error={erros[`medicoes.${i}.unidade`] || undefined}
            />
            <CampoTexto label="Rótulo" value={m.rotulo} onChange={(v) => alterar(m.chave, { rotulo: v })} readOnly={readOnly} span={4} maxLength={80} placeholder="EX.: ÁREA COBERTA" />
          </div>
        );
      })}
      {erros.medicoes ? (
        <p className="col-span-12 text-[11px] text-red-700" role="alert">
          {erros.medicoes}
        </p>
      ) : null}
      {!readOnly && medicoes.length < LIMITE_MEDICOES ? (
        <SeletorPaginadoGestao
          rotulo="Adicionar medição"
          testId="bem-seletor-perfil"
          chave={["patrimonio", "perfis-medicao"]}
          buscar={({ q, cursor, limit }) => listarOpcoesBem("perfis-medicao", null, { q, cursor, limit })}
          value={null}
          onChange={adicionar}
          detalheDaOpcao={(o) => /** @type {Record<string, string>} */ (ROTULO_DIMENSAO)[o?.dimensao] ?? null}
          textoVazio="— Escolha um perfil de medição —"
          span={12}
        />
      ) : null}
    </div>
  );
}
