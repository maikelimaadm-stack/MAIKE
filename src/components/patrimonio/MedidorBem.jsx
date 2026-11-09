import React from "react";
import { AvisoGestao, CampoSelect } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import { MEDIDOR_TIPOS, ROTULO_MEDIDOR, UNIDADE_DO_MEDIDOR, ehMedidorContador } from "@/lib/patrimonioDominio";
import { LIMITES_BEM, LOCALE_BEM } from "@/components/patrimonio/bemFormulario";

/** @typedef {import('./bemFormulario').MedidorForm} MedidorForm */

/**
 * Medidor do bem (D-PROD-157, A2): tipo (com "Sem medidor"), leitura inicial,
 * leitura atual (só na edição de um contador já gravado) e data da leitura.
 *
 * Máquinas, veículos e equipamentos EXIGEM medidor; implementos e "outros" o
 * têm como opcional. Depois do primeiro ajuste de leitura, o tipo e a leitura
 * inicial ficam fixos (a troca de painel é operação futura); antes disso, ainda
 * dá para corrigir o cadastro — e a leitura atual acompanha a inicial.
 *
 * @param {{
 *   medidor: MedidorForm,
 *   onChange: (mudanca: Partial<MedidorForm>) => void,
 *   regra: 'OBRIGATORIO'|'OPCIONAL',
 *   comLeituraAtual: boolean,
 *   tipoFixo: boolean,
 *   readOnly: boolean,
 *   erros: Record<string, string>,
 *   hoje: string,
 * }} props
 */
export default function MedidorBem({ medidor, onChange, regra, comLeituraAtual, tipoFixo, readOnly, erros, hoje }) {
  const contador = ehMedidorContador(medidor.tipo);
  const unidade = contador ? /** @type {Record<string, string|null>} */ (UNIDADE_DO_MEDIDOR)[medidor.tipo] : null;
  const fixo = readOnly || tipoFixo;

  /** @param {string} tipo */
  const escolherTipo = (tipo) => {
    if (ehMedidorContador(tipo)) onChange({ tipo, data_leitura: medidor.data_leitura || hoje });
    else onChange({ tipo, leitura_inicial: "", leitura_atual: "", data_leitura: "" });
  };

  /** Enquanto a leitura atual é igual à inicial (nenhum ajuste), ela acompanha a correção. @param {string} v */
  const mudarInicial = (v) => {
    if (comLeituraAtual && !tipoFixo && medidor.leitura_atual === medidor.leitura_inicial) onChange({ leitura_inicial: v, leitura_atual: v });
    else onChange({ leitura_inicial: v });
  };

  return (
    <div className="mg-b1-form-grid col-span-12 grid grid-cols-12 gap-x-3 gap-y-2" data-testid="bem-medidor">
      <CampoSelect
        label="Medidor"
        value={medidor.tipo}
        onChange={escolherTipo}
        options={MEDIDOR_TIPOS.map((t) => ({ value: t, label: ROTULO_MEDIDOR[t] }))}
        placeholder={regra === "OBRIGATORIO" ? "— Escolha o medidor —" : "Não se aplica"}
        readOnly={fixo}
        required={regra === "OBRIGATORIO"}
        span={4}
        error={erros["medidor.tipo"]}
      />
      {contador ? (
        <>
          <CampoNumero
            label="Leitura inicial"
            sufixo={unidade}
            value={medidor.leitura_inicial}
            onChange={mudarInicial}
            locale={LOCALE_BEM}
            limites={LIMITES_BEM.MEDIDA}
            readOnly={fixo}
            required
            span={comLeituraAtual ? 2 : 4}
            error={erros["medidor.leitura_inicial"] || null}
            testId="bem-medidor-leitura-inicial"
          />
          {comLeituraAtual ? (
            <CampoNumero
              label="Leitura atual"
              sufixo={unidade}
              value={medidor.leitura_atual}
              onChange={(v) => onChange({ leitura_atual: v })}
              locale={LOCALE_BEM}
              limites={LIMITES_BEM.MEDIDA}
              readOnly={readOnly}
              required
              span={2}
              error={erros["medidor.leitura_atual"] || null}
              testId="bem-medidor-leitura-atual"
            />
          ) : null}
          <CampoDia
            label="Data da leitura"
            value={medidor.data_leitura}
            onChange={(v) => onChange({ data_leitura: v })}
            readOnly={readOnly}
            required
            span={4}
            max={hoje}
            error={erros["medidor.data_leitura"] || null}
            testId="bem-medidor-data"
          />
        </>
      ) : null}
      {contador && unidade ? (
        <p className="col-span-12 text-[11px] text-[var(--mg-text-2,#475569)]">
          Leituras em {unidade === "h" ? "horas (h)" : unidade === "km" ? "quilômetros (km)" : "ciclos"}.
          {comLeituraAtual && !readOnly ? " Ao mudar a leitura atual, informe a data dessa leitura (não pode ser futura nem anterior à última)." : ""}
        </p>
      ) : null}
      {tipoFixo && !readOnly ? (
        <div className="col-span-12">
          <AvisoGestao tone="blue" testId="bem-medidor-fixo">
            Já houve ajuste de leitura: o tipo do medidor e a leitura inicial não mudam mais. A troca de painel será uma operação própria.
          </AvisoGestao>
        </div>
      ) : null}
    </div>
  );
}
