import React, { useId } from "react";
import { urlIconeDeposito } from "@/assets/icones/deposito-sal";
import { Aviso } from "./detalhes-lote/blocos";
import { formatDecimal } from "../suplementacao/formatters";
import { MENSAGENS_NIVEL, descreverUsoDoLimite, formatarKgNivel } from "@/domain/suplementacao/nivelSuplementacao";
import "@/styles/mk-dp-deposito.css";
import "@/styles/mk-dp-deposito-v13.css";

const ROTULO_NIVEL = "Nível do depósito";
const ROTULO_OCUPACAO_LIMITE = "Ocupação do limite operacional";
const ROTULO_ESTOQUE_MINIMO = "Estoque mínimo";
const AVISO_PRODUTOS_EM_LITROS = "Produtos em litros ficam fora do saldo em kg e do percentual.";
/** D-PROD-371: produto com estoque noutra unidade (SC, UN...) também fica fora, até o cocho contar pelo peso dela. */
const AVISO_PRODUTOS_FORA_DO_KG = "Produtos com estoque em outra unidade (não kg) ficam fora do saldo em kg e do percentual.";
const ORIENTACAO_SEM_MINIMO = "Configure o estoque mínimo no cadastro do ponto para o mapa avisar a reposição.";

/**
 * Distância mínima (em % da largura da régua) entre o centro do rótulo do saldo e o do mínimo
 * para os dois caberem na mesma linha; e a posição a partir da qual o rótulo do saldo encosta no
 * "limite N kg" do fim da régua. Medidas a 342 px (celular de 390 px): "1.400 kg" ≈ 15%,
 * "mínimo 500 kg" ≈ 22%, "limite 2.000 kg" ≈ 25%.
 */
const PERTO_DO_MINIMO = 22;
const PERTO_DO_FIM = 62;
/** O rótulo do mínimo encosta no "limite N kg" do fim a partir daqui: sobe também. */
const MINIMO_PERTO_DO_FIM = 70;

/** @param {number} v */
const limitar = (v) => Math.max(0, Math.min(100, v));
/** @param {number} v */
const arred = (v) => Math.round(v * 100) / 100;

/**
 * Régua do depósito (v13), conta só de desenho sobre os números do SSOT: 0 → limite operacional
 * (sem limite, 0 → max(saldo, mínimo) × 1,25), com a marca do mínimo e o marcador do saldo, e a
 * decisão de subir o rótulo do saldo (ou o do mínimo) para cima da régua quando encostaria em outro.
 * Sem limite, sem saldo e sem mínimo, não há régua (`null`).
 * @param {import("@/domain/suplementacao/nivelSuplementacao").NivelDeposito} nivel
 */
export function reguaDoDeposito(nivel) {
  const saldo = Math.max(0, Number(nivel?.saldoKg) || 0);
  const limite = nivel?.limiteOperacionalKg != null && nivel.limiteOperacionalKg > 0 ? nivel.limiteOperacionalKg : null;
  const minimo = nivel?.estoqueMinimoKg != null && nivel.estoqueMinimoKg > 0 ? nivel.estoqueMinimoKg : null;
  const escala = limite ?? Math.max(saldo, minimo ?? 0) * 1.25;
  if (!(escala > 0)) return null;
  const posSaldo = arred(limitar((saldo / escala) * 100));
  const posMinimo = minimo != null ? arred(limitar((minimo / escala) * 100)) : null;
  const temFim = limite != null;
  const minimoAcima = temFim && posMinimo != null && posMinimo > MINIMO_PERTO_DO_FIM;
  const pertoDoMinimo = posMinimo != null && !minimoAcima && Math.abs(posSaldo - posMinimo) < PERTO_DO_MINIMO;
  const pertoDoFim = temFim && posSaldo > PERTO_DO_FIM;
  return {
    escalaKg: escala,
    temLimite: temFim,
    posSaldo,
    posMinimo,
    excesso: limite != null && saldo > limite,
    abaixoMinimo: Boolean(nivel?.abaixoMinimo),
    saldoAcima: pertoDoMinimo || pertoDoFim,
    minimoAcima,
  };
}

/**
 * Âncora horizontal de um rótulo na régua: centrado na marca, mas preso às bordas para não
 * passar da régua.
 * @param {number} pos
 */
const ancora = (pos) => (pos < 12 ? "inicio" : pos > 88 ? "fim" : "meio");

/**
 * Nível do DEPÓSITO no detalhe (D-PROD-178), no desenho v13 aprovado pelo proprietário (o topo
 * "ficava quebrado" no celular): um cartão com
 *  1. o subícone do depósito (o dos detalhes, D-PROD-225) com o percentual BRUTO do limite
 *     operacional dentro, e ao lado SÓ o saldo atual, grande e numa linha, com os sacos embaixo;
 *  2. a régua 0 → limite operacional com a marca do mínimo e o marcador do saldo
 *     (`role="meter"`, o mesmo valor e texto acessível de antes); sem limite, a régua vai até
 *     max(saldo, mínimo) × 1,25, sem percentual (`role="img"`), com a mensagem e o que fazer;
 *  3. duas caixas lado a lado: "Necessidade de reposição" (até o limite) e o estoque mínimo como
 *     LIMIAR independente — acima (verde), no mínimo, abaixo (vermelho) ou não configurado.
 * Só exibe o nível do SSOT (`calcularNivelDeposito`): nenhuma conta de saldo ou percentual aqui.
 * Avisos de hoje (unidade não confirmada, produtos em litros fora do kg) depois do cartão.
 *
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelDeposito, saldoSacos?: number | null, necessidadeSacos?: number | null }} props
 */
export default function DepositoNivel({ nivel, saldoSacos = null, necessidadeSacos = null }) {
  const idTitulo = useId();
  const limite = nivel.limiteOperacionalKg;
  const uso = limite != null && nivel.ocupacaoPercentual != null
    ? descreverUsoDoLimite({ percentual: nivel.ocupacaoPercentual, saldoKg: nivel.saldoKg, limiteKg: limite, excessoKg: nivel.excessoKg })
    : null;
  const acimaDoLimite = Boolean(uso && nivel.excessoKg != null && nivel.excessoKg > 0);
  const linhasSemLimite = uso && limite != null
    ? []
    : [nivel.mensagemLimite || MENSAGENS_NIVEL.limiteNaoConfiguradoDeposito, MENSAGENS_NIVEL.orientacaoLimite];

  return (
    <section aria-labelledby={idTitulo} className="mk-dp-dep13">
      <h3 id={idTitulo} className="mk-dp-deposito__oculto">
        {ROTULO_NIVEL}
      </h3>
      <div className="mk-dp-cartao mk-dp-dep13__cartao">
        <div data-testid="nivel-do-deposito" className="mk-dp-dep13__topo">
          <span className="mk-dp-deposito__fig mk-dp-dep13__fig">
            <img data-deposito-icone="" src={urlIconeDeposito(nivel.fracaoParaSvg)} alt="" aria-hidden="true" />
            {uso ? (
              <strong aria-hidden="true" className={acimaDoLimite ? "mk-dp-deposito__pct mk-dp-deposito__excesso" : "mk-dp-deposito__pct"}>
                {nivel.rotuloCurto}
              </strong>
            ) : (
              <strong data-deposito-rotulo-neutro="" className="mk-dp-deposito__pct mk-dp-deposito__neutro">
                {nivel.rotuloCurto}
              </strong>
            )}
          </span>
          <div className="mk-dp-dep13__saldo">
            <span className="mk-dp-dep13__rot">Saldo atual</span>
            <strong className="mk-dp-dep13__grande">{formatarKgNivel(nivel.saldoKg)}</strong>
            {saldoSacos != null ? <small className="mk-dp-dep13__sub">{`${formatDecimal(saldoSacos)} sacos`}</small> : null}
            {linhasSemLimite.map((linha, i) => (
              <small key={i} className="mk-dp-dep13__linha">
                {linha}
              </small>
            ))}
          </div>
        </div>

        <ReguaDeposito nivel={nivel} uso={uso} />

        <div className="mk-dp-dep13__caixas">
          <CaixaNecessidade nivel={nivel} necessidadeSacos={necessidadeSacos} />
          <CaixaMinimo nivel={nivel} />
        </div>
      </div>

      {nivel.mensagemUnidade ? <Aviso>{nivel.mensagemUnidade}</Aviso> : null}
      {nivel.lotesEmLitrosIgnorados > 0 ? <Aviso tom="neutro">{AVISO_PRODUTOS_EM_LITROS}</Aviso> : null}
      {nivel.lotesForaDoKgIgnorados > 0 ? <Aviso tom="neutro">{AVISO_PRODUTOS_FORA_DO_KG}</Aviso> : null}
    </section>
  );
}

/**
 * Régua única do depósito. Com limite: `role="meter"` com o percentual bruto (pode passar de
 * 100%) e o texto acessível de `descreverUsoDoLimite`; o preenchimento para em 100%. Sem limite:
 * a régua é só desenho do saldo e do mínimo, com `role="img"` e um texto que diz isso.
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelDeposito, uso: null | { descricao: string, textoAcessivel: string } }} props
 */
function ReguaDeposito({ nivel, uso }) {
  const r = reguaDoDeposito(nivel);
  if (!r) return null;
  const saldoTxt = formatarKgNivel(nivel.saldoKg);
  const minimoTxt = nivel.estoqueMinimoKg != null ? formatarKgNivel(nivel.estoqueMinimoKg) : null;
  const percentual = nivel.ocupacaoPercentual;
  const comMedidor = Boolean(uso && percentual != null);
  const papel = comMedidor
    ? {
        role: "meter",
        "aria-label": ROTULO_OCUPACAO_LIMITE,
        "aria-valuemin": 0,
        "aria-valuemax": Math.max(100, arred(percentual)),
        "aria-valuenow": arred(percentual),
        "aria-valuetext": uso?.textoAcessivel,
      }
    : {
        role: "img",
        "aria-label": `Saldo de ${saldoTxt}${minimoTxt ? `, mínimo de ${minimoTxt}` : ""}; limite operacional não configurado.`,
      };
  const rotuloSaldo = (
    <span className="mk-dp-dep13__marca-rot mk-dp-dep13__marca-rot--saldo" data-ancora={ancora(r.posSaldo)} style={{ left: `${r.posSaldo}%` }}>
      {saldoTxt}
    </span>
  );
  const rotuloMinimo = r.posMinimo != null && minimoTxt ? (
    <span className="mk-dp-dep13__marca-rot mk-dp-dep13__marca-rot--minimo" data-ancora={ancora(r.posMinimo)} style={{ left: `${r.posMinimo}%` }}>
      {`mínimo ${minimoTxt}`}
    </span>
  ) : null;
  return (
    <div className="mk-dp-dep13__regua" data-saldo-acima={String(r.saldoAcima)} data-minimo-acima={String(r.minimoAcima)}>
      {r.saldoAcima || r.minimoAcima ? (
        <div className="mk-dp-dep13__rotulos mk-dp-dep13__rotulos--cima" aria-hidden="true">
          {r.saldoAcima ? rotuloSaldo : null}
          {r.minimoAcima ? rotuloMinimo : null}
        </div>
      ) : null}
      <div className="mk-dp-dep13__trilho" {...papel} data-variante={comMedidor ? (r.excesso ? "excesso" : "normal") : "neutro"}>
        <span
          data-medidor-preenchimento=""
          className={r.excesso ? "mk-dp-dep13__preench mk-dp-dep13__preench--excesso" : "mk-dp-dep13__preench"}
          style={{ width: `${r.posSaldo}%` }}
        />
        {r.posMinimo != null ? <span className="mk-dp-dep13__marca-min" data-regua-minimo="" style={{ left: `${r.posMinimo}%` }} /> : null}
        <span className="mk-dp-dep13__marca-saldo" data-regua-saldo="" style={{ left: `${r.posSaldo}%` }} />
      </div>
      <div className="mk-dp-dep13__rotulos" aria-hidden="true">
        {!r.minimoAcima ? rotuloMinimo : null}
        {!r.saldoAcima ? rotuloSaldo : null}
        {r.temLimite ? (
          <span className="mk-dp-dep13__marca-rot mk-dp-dep13__marca-rot--limite" data-ancora="fim" style={{ left: "100%" }}>
            {`limite ${formatarKgNivel(/** @type {number} */ (nivel.limiteOperacionalKg))}`}
          </span>
        ) : null}
      </div>
      {r.excesso && uso ? <small className="mk-dp-dep13__excesso">{uso.descricao}</small> : null}
    </div>
  );
}

/**
 * Caixa "Necessidade de reposição": quanto falta até o limite operacional (SSOT), com os sacos.
 * Acima do limite: 0 kg e o excesso; sem limite: "—".
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelDeposito, necessidadeSacos: number | null }} props
 */
function CaixaNecessidade({ nivel, necessidadeSacos }) {
  const semLimite = nivel.limiteOperacionalKg == null;
  const excesso = nivel.excessoKg != null && nivel.excessoKg > 0;
  let sub = "até o limite";
  if (semLimite) sub = "sem limite operacional";
  else if (excesso) sub = `${formatarKgNivel(/** @type {number} */ (nivel.excessoKg))} acima do limite`;
  else if (necessidadeSacos != null && necessidadeSacos > 0) sub = `${formatDecimal(necessidadeSacos)} sacos · até o limite`;
  return (
    <div className="mk-dp-dep13__caixa" data-caixa="necessidade">
      <span className="mk-dp-dep13__rot">Necessidade de reposição</span>
      <strong className="mk-dp-dep13__val">{semLimite ? "—" : formatarKgNivel(nivel.necessidadeReposicaoKg)}</strong>
      <small className={excesso ? "mk-dp-dep13__sub mk-dp-dep13__sub--excesso" : "mk-dp-dep13__sub"}>{sub}</small>
    </div>
  );
}

/**
 * Estoque mínimo como LIMIAR independente (nunca divisor nem teto do percentual), numa caixa
 * nomeada "Estoque mínimo" com o estado em `data-estado-minimo`. `abaixoMinimo` é a regra do
 * alerta do mapa (saldo ≤ mínimo).
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelDeposito }} props
 */
function CaixaMinimo({ nivel }) {
  const minimo = nivel.estoqueMinimoKg;
  const margem = nivel.margemMinimoKg;
  /** @type {'nao_configurado'|'acima'|'no_minimo'|'abaixo'} */
  let estado = "nao_configurado";
  if (minimo != null && margem != null) estado = margem > 0 ? "acima" : margem === 0 ? "no_minimo" : "abaixo";

  /** @type {{ rotulo: string, valor: string, sub: React.ReactNode, tom: string }} */
  let c;
  if (estado === "acima") {
    c = { rotulo: "Acima do mínimo", valor: formatarKgNivel(/** @type {number} */ (margem)), sub: `mínimo de ${formatarKgNivel(/** @type {number} */ (minimo))}`, tom: "ok" };
  } else if (estado === "no_minimo") {
    c = { rotulo: "No mínimo", valor: formatarKgNivel(/** @type {number} */ (minimo)), sub: "Reposição recomendada.", tom: "atencao" };
  } else if (estado === "abaixo") {
    c = {
      rotulo: "Abaixo do mínimo",
      valor: formatarKgNivel(-(/** @type {number} */ (margem))),
      sub: `mínimo de ${formatarKgNivel(/** @type {number} */ (minimo))} · Reposição recomendada.`,
      tom: "perigo",
    };
  } else {
    c = { rotulo: ROTULO_ESTOQUE_MINIMO, valor: "—", sub: nivel.mensagemMinimo || MENSAGENS_NIVEL.minimoNaoConfigurado, tom: "neutro" };
  }
  return (
    <div className="mk-dp-dep13__caixa" role="group" aria-label={ROTULO_ESTOQUE_MINIMO} data-estado-minimo={estado} data-tom={c.tom}>
      <span className="mk-dp-dep13__rot">{c.rotulo}</span>
      <strong className="mk-dp-dep13__val">{c.valor}</strong>
      <small className="mk-dp-dep13__sub">{c.sub}</small>
      {estado === "nao_configurado" ? <small className="mk-dp-dep13__sub">{ORIENTACAO_SEM_MINIMO}</small> : null}
    </div>
  );
}
