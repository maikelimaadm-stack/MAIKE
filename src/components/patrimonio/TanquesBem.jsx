import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { notifyWarning } from "@/lib/maikeNotify";
import { mensagemErroPatrimonio } from "@/lib/patrimonioErros";
import { CampoTexto } from "@/components/gestao/GestaoFormParts";
import { CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import { EscolhaMultipla } from "@/components/patrimonio/PatrimonioFormParts";
import { listarOpcoesCompletasBem } from "@/services/bemPatrimonialService";
import { CHAVE_OPCOES_PATRIMONIO, LIMITES_BEM, LIMITE_TANQUES_ATIVOS, LOCALE_BEM, novaChave } from "@/components/patrimonio/bemFormulario";

/** @typedef {import('./bemFormulario').TanqueForm} TanqueForm */

/** Nome do tanque para leitores de tela: o identificador ou o número da linha. @param {TanqueForm} t @param {number} i */
const nomeDoTanque = (t, i) => t.identificador.trim() || String(i + 1);

/**
 * Tanques de combustível de máquinas, veículos e equipamentos (D-PROD-156):
 * identificador, capacidade em litros, combustíveis aceitos (escolha múltipla —
 * o flex aceita mais de um) e observação. Neste slice só entram combustíveis
 * medidos em LITROS (GNV, em m³, fica fora do tanque).
 *
 * Tanque já gravado NUNCA sai da lista: ele é inativado (e pode ser reativado);
 * só o tanque novo, ainda não gravado, pode ser tirado. Até 10 tanques ativos.
 * Nada aqui calcula consumo nem mexe em estoque.
 *
 * @param {{
 *   tanques: TanqueForm[],
 *   onChange: (atualizar: (atual: TanqueForm[]) => TanqueForm[]) => void,
 *   readOnly: boolean,
 *   erros: Record<string, string>,
 *   limparErro: (chave: string) => void,
 * }} props
 */
export default function TanquesBem({ tanques, onChange, readOnly, erros, limparErro }) {
  const combustiveisQuery = useQuery({
    queryKey: [...CHAVE_OPCOES_PATRIMONIO, "combustiveis-completo"],
    queryFn: () => listarOpcoesCompletasBem("combustiveis", null),
    enabled: !readOnly,
    staleTime: 60 * 1000,
  });
  const emLitros = (combustiveisQuery.data?.itens ?? []).filter((c) => c?.unidade === "L");
  const ativos = tanques.filter((t) => t.ativo).length;

  /** @param {string} chave @param {Partial<TanqueForm>} mudanca */
  const alterar = (chave, mudanca) => onChange((atual) => atual.map((t) => (t.chave === chave ? { ...t, ...mudanca } : t)));

  const adicionar = () => {
    if (ativos >= LIMITE_TANQUES_ATIVOS) {
      notifyWarning("Atenção", `Um bem pode ter no máximo ${LIMITE_TANQUES_ATIVOS} tanques ativos.`);
      return;
    }
    onChange((atual) => [
      ...atual,
      { chave: novaChave("tanque"), id: null, identificador: "", capacidade: "", combustivel_ids: [], combustiveis: [], observacao: "", ativo: true },
    ]);
    limparErro("tanques");
  };

  /** @param {TanqueForm} t */
  const alternarSituacao = (t) => {
    if (!t.ativo && ativos >= LIMITE_TANQUES_ATIVOS) {
      notifyWarning("Atenção", `Um bem pode ter no máximo ${LIMITE_TANQUES_ATIVOS} tanques ativos.`);
      return;
    }
    alterar(t.chave, { ativo: !t.ativo });
    limparErro("tanques");
  };

  /** Os erros são por linha: tirar uma linha desalinha os índices, então eles saem todos. @param {string} chave */
  const tirar = (chave) => {
    onChange((atual) => atual.filter((t) => t.chave !== chave));
    limparErro("tanques");
  };

  /**
   * Opções do tanque: os combustíveis ativos em litros + os que o tanque já
   * tem (um combustível já vinculado e depois inativado pode continuar).
   * @param {TanqueForm} t
   */
  const opcoesDo = (t) => {
    const lista = readOnly ? [] : emLitros.map((c) => ({ value: String(c.id), label: String(c.nome ?? c.codigo ?? "") }));
    for (const c of t.combustiveis) {
      if (!lista.some((o) => o.value === c.id)) lista.push({ value: c.id, label: c.ativo ? c.nome : `${c.nome} (inativo)` });
    }
    return lista;
  };

  return (
    <div className="mg-b1-form-grid col-span-12 grid grid-cols-12 gap-x-3 gap-y-2" data-testid="bem-tanques">
      {tanques.length === 0 ? <p className="col-span-12 text-xs text-[var(--mg-text-2,#475569)]">Nenhum tanque de combustível.</p> : null}
      {tanques.map((t, i) => {
        const nome = nomeDoTanque(t, i);
        const travado = readOnly || !t.ativo;
        return (
          <div key={t.chave} className="col-span-12 grid grid-cols-12 gap-x-3 gap-y-2 rounded-md border border-[var(--mg-divider,#cbd5e1)] p-2" data-testid={`bem-tanque-${i}`}>
            <div className="col-span-12 flex min-h-8 flex-wrap items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1 break-words font-medium uppercase">
                Tanque {i + 1}
                {!t.ativo ? <span className="ml-2 normal-case text-[11px] text-amber-700">(inativo)</span> : null}
              </span>
              {!readOnly && t.id ? (
                <button
                  type="button"
                  aria-label={`${t.ativo ? "Inativar" : "Reativar"} o tanque ${nome}`}
                  onClick={() => alternarSituacao(t)}
                  className="min-h-8 rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-3 text-xs font-medium"
                >
                  {t.ativo ? "Inativar tanque" : "Reativar tanque"}
                </button>
              ) : null}
              {!readOnly && !t.id ? (
                <button
                  type="button"
                  aria-label={`Tirar o tanque ${nome} (ainda não gravado)`}
                  onClick={() => tirar(t.chave)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--mg-divider,#cbd5e1)]"
                >
                  <X aria-hidden size={14} />
                </button>
              ) : null}
            </div>
            <CampoTexto
              label="Identificador"
              required
              span={4}
              value={t.identificador}
              onChange={(v) => {
                alterar(t.chave, { identificador: v });
                limparErro(`tanques.${i}.identificador`);
              }}
              readOnly={travado}
              maxLength={40}
              placeholder="EX.: PRINCIPAL"
              error={erros[`tanques.${i}.identificador`]}
            />
            <CampoNumero
              label="Capacidade"
              sufixo="L"
              value={t.capacidade}
              onChange={(v) => {
                alterar(t.chave, { capacidade: v });
                limparErro(`tanques.${i}.capacidade`);
              }}
              locale={LOCALE_BEM}
              limites={LIMITES_BEM.MEDIDA}
              readOnly={travado}
              required
              span={4}
              error={erros[`tanques.${i}.capacidade`] || null}
              testId={`bem-tanque-capacidade-${i}`}
            />
            <CampoTexto label="Observação" span={4} value={t.observacao} onChange={(v) => alterar(t.chave, { observacao: v })} readOnly={travado} maxLength={255} />
            <EscolhaMultipla
              rotulo="Combustíveis aceitos"
              opcoes={opcoesDo(t)}
              valores={t.combustivel_ids}
              onChange={(valores) => {
                alterar(t.chave, { combustivel_ids: valores });
                limparErro(`tanques.${i}.combustiveis`);
              }}
              readOnly={travado}
              testId={`bem-tanque-combustiveis-${i}`}
              erro={erros[`tanques.${i}.combustiveis`] || null}
              ajuda={!travado ? "Marque todos os que o tanque aceita (flex: gasolina e etanol). Só combustíveis em litros." : null}
            />
          </div>
        );
      })}
      {!readOnly && combustiveisQuery.isLoading && tanques.length ? (
        <p className="col-span-12 text-[11px] text-[var(--mg-text-2,#475569)]" role="status">
          Carregando combustíveis…
        </p>
      ) : null}
      {!readOnly && combustiveisQuery.isError ? (
        <p className="col-span-12 text-[11px] text-red-700" role="alert">
          {mensagemErroPatrimonio(combustiveisQuery.error, "Não foi possível carregar os combustíveis.")}
        </p>
      ) : null}
      {!readOnly && combustiveisQuery.data && !combustiveisQuery.data.completo ? (
        <p className="col-span-12 text-[11px] text-amber-700" role="status">
          A lista de combustíveis é grande demais para mostrar inteira aqui: inative os que não usa no cadastro de Combustíveis.
        </p>
      ) : null}
      {erros.tanques ? (
        <p className="col-span-12 text-[11px] text-red-700" role="alert">
          {erros.tanques}
        </p>
      ) : null}
      {!readOnly && ativos < LIMITE_TANQUES_ATIVOS ? (
        <div className="col-span-12">
          <button
            type="button"
            onClick={adicionar}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-4 text-[13px] font-medium"
          >
            <Plus aria-hidden size={14} />
            Adicionar tanque
          </button>
        </div>
      ) : null}
    </div>
  );
}
