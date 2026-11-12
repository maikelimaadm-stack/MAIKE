import React, { useId } from "react";
import { urlIconeDeposito } from "@/assets/icones/deposito-sal";
import MedidorLimiteOperacional from "./MedidorLimiteOperacional";
import { MENSAGENS_NIVEL, descreverUsoDoLimite, formatarKgNivel } from "@/domain/suplementacao/nivelSuplementacao";

const ROTULO_OCUPACAO_LIMITE = "Ocupação do limite operacional";
const ROTULO_ESTOQUE_MINIMO = "Estoque mínimo";
const AVISO_PRODUTOS_EM_LITROS = "Produtos em litros ficam fora do saldo em kg e do percentual.";

/**
 * Nível do DEPÓSITO no detalhe (D-PROD-178). Só exibe o nível do SSOT
 * (`calcularNivelDeposito`, `src/domain/suplementacao/nivelSuplementacao.js`):
 * nenhuma conta de saldo ou percentual acontece aqui.
 *
 *  1. Ocupação do LIMITE OPERACIONAL (`capacidade_cocho_kg`): o ícone preenche
 *     com `fracaoParaSvg` (≤ 100%, o mesmo desenho do marcador do mapa) e o
 *     percentual BRUTO (pode passar de 100%) aparece como número fora do ícone,
 *     no medidor acessível (`role="meter"`), com o saldo, o limite e o excesso
 *     em kg — o mesmo padrão do cocho ("600 kg de 300 kg · 300 kg acima do
 *     limite"). Sem limite, não há percentual: o ícone vazio leva o rótulo
 *     neutro "Sem limite" (como o cocho) e o medidor neutro diz o que fazer.
 *  2. Estoque mínimo: LIMIAR independente (acima, no mínimo ou abaixo, com a
 *     margem em kg). Nunca é divisor nem teto do percentual.
 *
 * Avisos: unidade de algum lote não confirmada e produtos em litros fora do kg
 * (D-PROD-162, P-11).
 *
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelDeposito }} props
 */
export default function DepositoNivel({ nivel }) {
  const limite = nivel.limiteOperacionalKg;
  const uso = limite != null && nivel.ocupacaoPercentual != null ?
  descreverUsoDoLimite({ percentual: nivel.ocupacaoPercentual, saldoKg: nivel.saldoKg, limiteKg: limite, excessoKg: nivel.excessoKg }) :
  null;

  return (
    <div className="space-y-1">
      {/* Celular: um painel embaixo do outro; a partir de 768 px, lado a lado. */}
      <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
        <div className="flex min-w-0 flex-col items-center gap-1.5 rounded-lg border border-slate-200 bg-[#FAFCFE] p-2">
          {/* Decorativo: o medidor logo abaixo traz o número e o texto ao leitor de tela. */}
          <img
            data-deposito-icone=""
            src={urlIconeDeposito(nivel.fracaoParaSvg)}
            alt=""
            aria-hidden="true"
            className="h-auto w-[132px] max-w-full" />
          {nivel.neutro && <span data-deposito-rotulo-neutro="" aria-hidden="true" className="text-xs font-medium text-slate-500">{nivel.rotuloCurto}</span>}
          <MedidorLimiteOperacional
            className="self-stretch"
            percentualBruto={uso ? nivel.ocupacaoPercentual : null}
            rotulo={ROTULO_OCUPACAO_LIMITE}
            descricao={uso ? uso.descricao : nivel.mensagemLimite || MENSAGENS_NIVEL.limiteNaoConfiguradoDeposito}
            textoAcessivel={uso?.textoAcessivel}
            orientacao={uso ? null : MENSAGENS_NIVEL.orientacaoLimite} />
        </div>
        <PainelEstoqueMinimo nivel={nivel} />
      </div>
      {(nivel.mensagemUnidade || nivel.lotesEmLitrosIgnorados > 0) &&
      <ul className="space-y-0.5 text-[10px] leading-snug">
          {nivel.mensagemUnidade && <li className="rounded border border-amber-200 bg-amber-50 px-2 py-1 font-medium text-amber-900">{nivel.mensagemUnidade}</li>}
          {nivel.lotesEmLitrosIgnorados > 0 && <li className="px-1 text-slate-500">{AVISO_PRODUTOS_EM_LITROS}</li>}
        </ul>
      }
    </div>);

}

/**
 * Estoque mínimo como limiar: "Mínimo 100 kg · 50 kg acima do mínimo",
 * "Mínimo 100 kg · abaixo do mínimo (faltam 10 kg)" ou "Mínimo 100 kg · no
 * mínimo". `abaixoMinimo` é a mesma regra do alerta do mapa (saldo ≤ mínimo).
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelDeposito }} props
 */
function PainelEstoqueMinimo({ nivel }) {
  const idRotulo = useId();
  const minimo = nivel.estoqueMinimoKg;
  const margem = nivel.margemMinimoKg;

  /** @type {'nao_configurado'|'acima'|'no_minimo'|'abaixo'} */
  let estado = "nao_configurado";
  let texto = nivel.mensagemMinimo || MENSAGENS_NIVEL.minimoNaoConfigurado;
  if (minimo != null && margem != null) {
    estado = margem > 0 ? "acima" : margem === 0 ? "no_minimo" : "abaixo";
    const situacao = estado === "acima" ?
    `${formatarKgNivel(margem)} acima do mínimo` :
    estado === "no_minimo" ? "no mínimo" : `abaixo do mínimo (faltam ${formatarKgNivel(-margem)})`;
    texto = `Mínimo ${formatarKgNivel(minimo)} · ${situacao}`;
  }

  const corTexto = estado === "nao_configurado" ? "font-medium text-slate-600" : nivel.abaixoMinimo ? "font-semibold text-amber-800" : "font-semibold text-emerald-700";

  return (
    <div role="group" aria-labelledby={idRotulo} data-estado-minimo={estado} className="flex min-w-0 flex-col justify-center gap-1 rounded-lg border border-slate-200 bg-[#FAFCFE] p-2">
      <span id={idRotulo} className="text-[10px] font-medium text-slate-500">{ROTULO_ESTOQUE_MINIMO}</span>
      <span className={`text-[11px] leading-snug ${corTexto}`}>{texto}</span>
      {nivel.abaixoMinimo ?
      <span className="text-[10px] font-medium text-amber-800">Reposição recomendada.</span> :
      <span className="text-[10px] leading-snug text-slate-500">
          {estado === "nao_configurado" ? "Configure o estoque mínimo no cadastro do ponto para o mapa avisar a reposição." : "Abaixo deste saldo o mapa avisa para repor."}
        </span>
      }
    </div>);

}
