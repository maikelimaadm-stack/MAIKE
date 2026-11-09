import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { notifyWarning } from "@/lib/maikeNotify";
import { formatarMoeda, somar } from "@/lib/dinheiroDecimal";
import { mensagemErroPatrimonio } from "@/lib/patrimonioErros";
import { ROTULO_RESIDUAL_MODO } from "@/lib/patrimonioDominio";
import B1ChaveRow from "@/components/cadastro/base1/B1ChaveRow";
import { AvisoGestao, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero, EscolhaSegmentada, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import PreviaDepreciacaoBem from "@/components/patrimonio/PreviaDepreciacaoBem";
import { listarOpcoesBem, simularDepreciacao } from "@/services/bemPatrimonialService";
import { LIMITES_BEM, LOCALE_BEM, lerDecimal, parametrosDaPrevia, vidaEmMeses } from "@/components/patrimonio/bemFormulario";

/** @typedef {import('./bemFormulario').EstadoBem} EstadoBem */
/** @typedef {import('./bemFormulario').AquisicaoForm} AquisicaoForm */
/** @typedef {import('./bemFormulario').DepreciacaoForm} DepreciacaoForm */

const OPCOES_VIDA = [
  { value: "ANOS", label: "Anos" },
  { value: "MESES", label: "Meses" },
];
const OPCOES_RESIDUAL = [
  { value: "VALOR", label: ROTULO_RESIDUAL_MODO.VALOR },
  { value: "PERCENTUAL", label: ROTULO_RESIDUAL_MODO.PERCENTUAL },
];

/** O que a prévia usa: muda qualquer um → a prévia mostrada deixa de valer. @param {EstadoBem} e */
const assinaturaDaPrevia = (e) =>
  JSON.stringify([
    e.aquisicao.valor_aquisicao,
    e.aquisicao.custo_incorporacao,
    e.depreciacao.vida,
    e.depreciacao.vidaUnidade,
    e.depreciacao.residual_modo,
    e.depreciacao.valor_residual,
    e.depreciacao.residual_percentual,
    e.depreciacao.data_inicio_depreciacao,
  ]);

/**
 * Aquisição (datas, valores em R$, fornecedor, documento, garantia) e
 * parâmetros de depreciação LINEAR do bem (D-PROD-156): chave "Depreciável"
 * (só bem próprio), vida útil em meses ou anos (anos × 12 ao enviar), residual
 * por valor OU por percentual e início da depreciação.
 *
 * "Simular depreciação" pede ao servidor a prévia gerencial (nada é gravado) e
 * a mostra rotulada como prévia simulada. Nunca mostra valor contábil nem
 * consumo. No modo leitura, mostra a prévia que veio no detalhe do bem.
 *
 * @param {{
 *   estado: EstadoBem,
 *   alterarAquisicao: (mudanca: Partial<AquisicaoForm>) => void,
 *   alterarDepreciacao: (mudanca: Partial<DepreciacaoForm>) => void,
 *   marcarErros: (erros: Record<string, string>) => void,
 *   readOnly: boolean,
 *   erros: Record<string, string>,
 *   empresaId: string|null,
 *   previaGravada: any,
 * }} props
 */
export default function AquisicaoDepreciacaoBem({ estado, alterarAquisicao, alterarDepreciacao, marcarErros, readOnly, erros, empresaId, previaGravada }) {
  const aq = estado.aquisicao;
  const dp = estado.depreciacao;
  const proprio = estado.propriedade === "PROPRIO";
  const [previa, setPrevia] = useState(/** @type {{ assinatura: string, resultado: any }|null} */ (null));
  const [erroPrevia, setErroPrevia] = useState(/** @type {string|null} */ (null));
  const assinatura = assinaturaDaPrevia(estado);

  const previaMutation = useMutation({
    /** @param {{ parametros: any, assinatura: string }} v */
    mutationFn: ({ parametros }) => simularDepreciacao(empresaId, parametros),
    onSuccess: (resultado, v) => {
      setErroPrevia(null);
      setPrevia({ assinatura: v.assinatura, resultado });
    },
    onError: (err) => {
      setPrevia(null);
      setErroPrevia(mensagemErroPatrimonio(err, "Não foi possível simular a depreciação."));
    },
  });

  const simular = () => {
    const { erros: faltando, parametros } = parametrosDaPrevia(estado);
    if (!parametros) {
      marcarErros(faltando);
      notifyWarning("Atenção", "Preencha os campos destacados para simular a depreciação.");
      return;
    }
    setErroPrevia(null);
    previaMutation.mutate({ parametros, assinatura });
  };

  const valor = lerDecimal(aq.valor_aquisicao, LIMITES_BEM.DINHEIRO);
  const incorporacao = lerDecimal(aq.custo_incorporacao, LIMITES_BEM.DINHEIRO);
  const custoBase = valor.ok && valor.valor !== null ? somar([valor.valor, incorporacao.ok ? incorporacao.valor : null], 2) : null;
  const vida = vidaEmMeses(dp);
  const previaAtual = readOnly ? (dp.depreciavel ? previaGravada : null) : previa?.assinatura === assinatura ? previa.resultado : null;

  return (
    <div className="mg-b1-form-grid col-span-12 grid grid-cols-12 gap-x-3 gap-y-2" data-testid="bem-aquisicao-depreciacao">
      <SecaoForm titulo="Aquisição" />
      <CampoDia label="Data de aquisição" value={aq.data_aquisicao} onChange={(v) => alterarAquisicao({ data_aquisicao: v })} readOnly={readOnly} span={4} />
      <CampoDia
        label="Disponível desde"
        value={aq.data_disponibilidade}
        onChange={(v) => alterarAquisicao({ data_disponibilidade: v })}
        readOnly={readOnly}
        span={4}
        min={aq.data_aquisicao || undefined}
        error={erros["aquisicao.data_disponibilidade"] || null}
      />
      <CampoDia label="Garantia até" value={aq.garantia_ate} onChange={(v) => alterarAquisicao({ garantia_ate: v })} readOnly={readOnly} span={4} />
      <CampoNumero
        label="Valor de aquisição"
        sufixo="R$"
        value={aq.valor_aquisicao}
        onChange={(v) => alterarAquisicao({ valor_aquisicao: v })}
        locale={LOCALE_BEM}
        limites={LIMITES_BEM.DINHEIRO}
        casasMin={2}
        readOnly={readOnly}
        required={dp.depreciavel}
        span={4}
        error={erros["aquisicao.valor_aquisicao"] || null}
        testId="bem-valor-aquisicao"
      />
      <CampoNumero
        label="Custo de incorporação"
        sufixo="R$"
        value={aq.custo_incorporacao}
        onChange={(v) => alterarAquisicao({ custo_incorporacao: v })}
        locale={LOCALE_BEM}
        limites={LIMITES_BEM.DINHEIRO}
        casasMin={2}
        readOnly={readOnly}
        span={4}
        error={erros["aquisicao.custo_incorporacao"] || null}
        ajuda="Frete, montagem, instalação…"
        testId="bem-custo-incorporacao"
      />
      <ValorCalculado label="Custo do bem" valor={custoBase === null ? "—" : formatarMoeda(custoBase, { locale: LOCALE_BEM, moeda: "BRL" })} testId="bem-custo-base" />
      <SeletorPaginadoGestao
        rotulo="Fornecedor"
        testId="bem-seletor-fornecedor"
        chave={["patrimonio", "parceiros", empresaId]}
        buscar={({ q, cursor, limit }) => listarOpcoesBem("parceiros", empresaId, { q, cursor, limit })}
        value={aq.fornecedor}
        onChange={(o) => alterarAquisicao({ fornecedor: o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null })}
        readOnly={readOnly}
        permitirLimpar
        textoVazio="— Nenhum —"
        span={6}
      />
      <CampoTexto
        label="Documento de referência"
        span={6}
        value={aq.documento_referencia}
        onChange={(v) => alterarAquisicao({ documento_referencia: v })}
        readOnly={readOnly}
        maxLength={80}
        placeholder="EX.: NF 1234"
      />

      <SecaoForm titulo="Depreciação (linear)" />
      <B1ChaveRow
        label="Depreciável"
        span={4}
        checked={dp.depreciavel}
        onChange={readOnly || (!proprio && !dp.depreciavel) ? undefined : (v) => alterarDepreciacao({ depreciavel: v })}
        disabled={readOnly || (!proprio && !dp.depreciavel)}
        ariaLabel="Depreciável"
        showText
      />
      {!proprio ? (
        <p className="col-span-12 text-[11px] text-[var(--mg-text-2,#475569)] md:col-span-8">Só bens próprios são depreciados.</p>
      ) : null}
      {erros["depreciacao.depreciavel"] ? (
        <p className="col-span-12 text-[11px] text-red-700" role="alert">
          {erros["depreciacao.depreciavel"]}
        </p>
      ) : null}
      {dp.depreciavel ? (
        <>
          <CampoTexto
            label="Vida útil"
            required
            span={3}
            value={dp.vida}
            onChange={(v) => alterarDepreciacao({ vida: v })}
            readOnly={readOnly}
            inputMode="numeric"
            maxLength={4}
            error={erros["depreciacao.vida"]}
          />
          <EscolhaSegmentada
            rotulo="Vida útil em"
            opcoes={OPCOES_VIDA}
            value={dp.vidaUnidade}
            onChange={(v) => alterarDepreciacao({ vidaUnidade: v === "MESES" ? "MESES" : "ANOS" })}
            readOnly={readOnly}
            testId="bem-vida-unidade"
            span={6}
          />
          <ValorCalculado label="Vida útil em meses" valor={vida.ok && vida.meses !== null ? String(vida.meses) : "—"} span={3} testId="bem-vida-meses" />
          <EscolhaSegmentada
            rotulo="Residual"
            opcoes={OPCOES_RESIDUAL}
            value={dp.residual_modo}
            onChange={(v) => alterarDepreciacao({ residual_modo: v === "PERCENTUAL" ? "PERCENTUAL" : "VALOR" })}
            readOnly={readOnly}
            testId="bem-residual-modo"
            span={6}
          />
          {dp.residual_modo === "VALOR" ? (
            <CampoNumero
              label="Valor residual"
              sufixo="R$"
              value={dp.valor_residual}
              onChange={(v) => alterarDepreciacao({ valor_residual: v })}
              locale={LOCALE_BEM}
              limites={LIMITES_BEM.DINHEIRO}
              casasMin={2}
              readOnly={readOnly}
              required
              span={3}
              error={erros["depreciacao.valor_residual"] || null}
              testId="bem-valor-residual"
            />
          ) : (
            <CampoNumero
              label="Residual"
              sufixo="%"
              value={dp.residual_percentual}
              onChange={(v) => alterarDepreciacao({ residual_percentual: v })}
              locale={LOCALE_BEM}
              limites={LIMITES_BEM.PERCENTUAL}
              readOnly={readOnly}
              required
              span={3}
              error={erros["depreciacao.residual_percentual"] || null}
              testId="bem-residual-percentual"
            />
          )}
          <CampoDia
            label="Início da depreciação"
            value={dp.data_inicio_depreciacao}
            onChange={(v) => alterarDepreciacao({ data_inicio_depreciacao: v })}
            readOnly={readOnly}
            required
            span={3}
            min={aq.data_disponibilidade || aq.data_aquisicao || undefined}
            error={erros["depreciacao.data_inicio_depreciacao"] || null}
            testId="bem-inicio-depreciacao"
          />
          {!readOnly ? (
            <div className="col-span-12">
              <button
                type="button"
                onClick={simular}
                disabled={previaMutation.isPending || !empresaId}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-4 text-[13px] font-medium disabled:opacity-50"
              >
                <Calculator aria-hidden size={14} />
                {previaMutation.isPending ? "Simulando…" : "Simular depreciação"}
              </button>
            </div>
          ) : null}
          {erroPrevia && !readOnly ? (
            <div className="col-span-12">
              <AvisoGestao testId="bem-previa-erro">{erroPrevia}</AvisoGestao>
            </div>
          ) : null}
          <PreviaDepreciacaoBem previa={previaAtual} />
        </>
      ) : null}
    </div>
  );
}
