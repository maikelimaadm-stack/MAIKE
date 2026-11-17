import React, { useId } from "react";
import { urlIconeDeposito } from "@/assets/icones/deposito-sal";
import MedidorLimiteOperacional from "./MedidorLimiteOperacional";
import { Aviso, Cartao, Celula, Grade, Nivel } from "./detalhes-lote/blocos";
import { formatDecimal } from "../suplementacao/formatters";
import { MENSAGENS_NIVEL, descreverUsoDoLimite, formatarKgNivel } from "@/domain/suplementacao/nivelSuplementacao";
import { COR_FAROL } from "@/domain/suplementacao/leituraCocho";
import "@/styles/mk-dp-deposito.css";

const ROTULO_NIVEL = "Nível do depósito";
const ROTULO_OCUPACAO_LIMITE = "Ocupação do limite operacional";
const ROTULO_ESTOQUE_MINIMO = "Estoque mínimo";
const AVISO_PRODUTOS_EM_LITROS = "Produtos em litros ficam fora do saldo em kg e do percentual.";
/** Bolinhas do v12: âmbar da reposição e o verde do farol; cinza no texto do que falta configurar. */
const COR_ALERTA = "#f59e0b";
const COR_OK = COR_FAROL.verde;
const COR_NEUTRA = "#6b7280";

/**
 * Nível do DEPÓSITO no detalhe (D-PROD-178), no desenho do Detalhes do Lote
 * v12 (D-PROD-220): a região "Nível do depósito" com o bloco `Nivel`, os
 * avisos e um cartão com a grade dos números. Só exibe o nível do SSOT
 * (`calcularNivelDeposito`, `src/domain/suplementacao/nivelSuplementacao.js`):
 * nenhuma conta de saldo ou percentual acontece aqui.
 *
 *  1. Ocupação do LIMITE OPERACIONAL (`capacidade_cocho_kg`): o subícone do
 *     depósito (o dos detalhes, sem o pino do mapa, D-PROD-225) preenche com
 *     `fracaoParaSvg` (≤ 100%, a mesma fração do marcador do mapa) e o
 *     percentual BRUTO (pode passar de 100%) é o número grande do `Nivel` e o
 *     da célula do medidor acessível (`role="meter"`), com o saldo, o limite e
 *     o excesso em kg. Sem limite não há percentual: o `Nivel` mostra o rótulo
 *     neutro do SSOT ("Sem limite") com a mensagem e o que fazer, e o medidor
 *     fica neutro (sem `role="meter"`) — o texto não se repete na grade.
 *  2. Estoque mínimo: LIMIAR independente (acima, no mínimo ou abaixo, com a
 *     margem em kg). Nunca é divisor nem teto do percentual. Saldo no mínimo
 *     ou abaixo (a regra do alerta do mapa) também vira o aviso do v12.
 *
 * Avisos de hoje: unidade de algum lote não confirmada e produtos em litros
 * fora do kg (D-PROD-162, P-11).
 *
 * `saldoSacos` (soma dos sacos do "Saldo por produto") entra como célula
 * quando vem; o resto é todo do nível.
 *
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelDeposito, saldoSacos?: number | null }} props
 */
export default function DepositoNivel({ nivel, saldoSacos = null }) {
  const idTitulo = useId();
  const limite = nivel.limiteOperacionalKg;
  const uso = limite != null && nivel.ocupacaoPercentual != null
    ? descreverUsoDoLimite({ percentual: nivel.ocupacaoPercentual, saldoKg: nivel.saldoKg, limiteKg: limite, excessoKg: nivel.excessoKg })
    : null;
  const acimaDoLimite = Boolean(uso && nivel.excessoKg != null && nivel.excessoKg > 0);

  const linhas = uso && limite != null
    ? [`${formatarKgNivel(nivel.saldoKg)} de ${formatarKgNivel(limite)} (limite operacional)`, `Necessidade de reposição: ${formatarKgNivel(nivel.necessidadeReposicaoKg)}`]
    : [nivel.mensagemLimite || MENSAGENS_NIVEL.limiteNaoConfiguradoDeposito, MENSAGENS_NIVEL.orientacaoLimite];

  return (
    <section aria-labelledby={idTitulo} className="mk-dp-deposito__nivel">
      {/* O v12 não mostra título acima do nível: o rótulo do bloco faz esse papel na tela. */}
      <h3 id={idTitulo} className="mk-dp-deposito__oculto">
        {ROTULO_NIVEL}
      </h3>
      <Nivel
        data-testid="nivel-do-deposito"
        // Decorativo: o número e o medidor da grade trazem o nível ao leitor de tela.
        // O subícone do depósito, o desenho dos detalhes (sem o pino do mapa), como o do cocho (D-PROD-225).
        figura={<img data-deposito-icone="" src={urlIconeDeposito(nivel.fracaoParaSvg)} alt="" aria-hidden="true" />}
        rotulo={<span aria-hidden="true">{ROTULO_NIVEL}</span>}
        valor={
          uso ? (
            <span className={acimaDoLimite ? "mk-dp-deposito__excesso" : undefined}>{nivel.rotuloCurto}</span>
          ) : (
            // Ícone vazio sem limite não é "depósito vazio": o rótulo neutro diz o porquê (como o cocho).
            <span data-deposito-rotulo-neutro="" className="mk-dp-deposito__neutro">
              {nivel.rotuloCurto}
            </span>
          )
        }
        linhas={linhas}
      />

      {nivel.abaixoMinimo && nivel.estoqueMinimoKg != null ? <Aviso>{fraseDoMinimo(nivel)}</Aviso> : null}
      {nivel.mensagemUnidade ? <Aviso>{nivel.mensagemUnidade}</Aviso> : null}
      {nivel.lotesEmLitrosIgnorados > 0 ? <Aviso tom="neutro">{AVISO_PRODUTOS_EM_LITROS}</Aviso> : null}

      <Cartao>
        <Grade>
          <MedidorLimiteOperacional
            estilo="v12"
            percentualBruto={uso ? nivel.ocupacaoPercentual : null}
            rotulo={ROTULO_OCUPACAO_LIMITE}
            descricao={uso ? uso.descricao : ""}
            textoAcessivel={uso?.textoAcessivel}
            orientacao={null}
          />
          <CelulaEstoqueMinimo nivel={nivel} />
          <Celula rotulo="Saldo atual kg" valor={formatarKgNivel(nivel.saldoKg)} />
          {saldoSacos != null ? <Celula rotulo="Saldo em sacos" valor={`${formatDecimal(saldoSacos)} sacos`} /> : null}
          <Celula rotulo="Necessidade reposição kg" valor={formatarKgNivel(nivel.necessidadeReposicaoKg)} />
        </Grade>
      </Cartao>
    </section>
  );
}

/**
 * Aviso do v12 quando o saldo chega ao mínimo: "Saldo 400 kg abaixo do mínimo
 * configurado (500 kg)." — no mínimo exato, "no mínimo configurado".
 * @param {import("@/domain/suplementacao/nivelSuplementacao").NivelDeposito} nivel
 */
function fraseDoMinimo(nivel) {
  const minimo = formatarKgNivel(/** @type {number} */ (nivel.estoqueMinimoKg));
  const onde = nivel.margemMinimoKg === 0 ? "no mínimo" : "abaixo do mínimo";
  return `Saldo ${formatarKgNivel(nivel.saldoKg)} ${onde} configurado (${minimo}).`;
}

/**
 * Estoque mínimo como limiar, numa célula da grade: "Mínimo 100 kg · 50 kg
 * acima do mínimo", "Mínimo 100 kg · abaixo do mínimo (faltam 10 kg)" ou
 * "Mínimo 100 kg · no mínimo". `abaixoMinimo` é a mesma regra do alerta do mapa
 * (saldo ≤ mínimo). A célula é um grupo nomeado "Estoque mínimo", com o estado
 * em `data-estado-minimo`.
 * @param {{ nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelDeposito }} props
 */
function CelulaEstoqueMinimo({ nivel }) {
  const idRotulo = useId();
  const minimo = nivel.estoqueMinimoKg;
  const margem = nivel.margemMinimoKg;

  /** @type {'nao_configurado'|'acima'|'no_minimo'|'abaixo'} */
  let estado = "nao_configurado";
  let texto = nivel.mensagemMinimo || MENSAGENS_NIVEL.minimoNaoConfigurado;
  if (minimo != null && margem != null) {
    estado = margem > 0 ? "acima" : margem === 0 ? "no_minimo" : "abaixo";
    const situacao = estado === "acima"
      ? `${formatarKgNivel(margem)} acima do mínimo`
      : estado === "no_minimo" ? "no mínimo" : `abaixo do mínimo (faltam ${formatarKgNivel(-margem)})`;
    texto = `Mínimo ${formatarKgNivel(minimo)} · ${situacao}`;
  }

  // Como as células de estado do v12 ("%PV real × esperado"): bolinha da situação,
  // texto escuro e a orientação embaixo; sem mínimo configurado, sem bolinha.
  const bolinha = estado === "nao_configurado" ? null : nivel.abaixoMinimo ? COR_ALERTA : COR_OK;
  const orientacao = nivel.abaixoMinimo ? (
    <span className="mk-dp-deposito__alerta">Reposição recomendada.</span>
  ) : estado === "nao_configurado" ? (
    "Configure o estoque mínimo no cadastro do ponto para o mapa avisar a reposição."
  ) : (
    "Abaixo deste saldo o mapa avisa para repor."
  );

  // O grupo nomeado fica DENTRO do dd do valor: um filho do <dl> com role="group"
  // quebra a lista de definição (axe: definition-list/dlitem).
  return (
    <Celula
      rotulo={<span id={idRotulo}>{ROTULO_ESTOQUE_MINIMO}</span>}
      valor={
        <span role="group" aria-labelledby={idRotulo} data-estado-minimo={estado} className="mk-dp-deposito__minimo">
          <span className="mk-dp-deposito__minimo-linha">
            {bolinha ? <span className="mk-dp-bolinha" style={{ background: bolinha }} aria-hidden="true" /> : null}
            {texto}
          </span>
          <span className="mk-dp-deposito__orientacao">{orientacao}</span>
        </span>
      }
      cor={estado === "nao_configurado" ? COR_NEUTRA : null}
    />
  );
}
