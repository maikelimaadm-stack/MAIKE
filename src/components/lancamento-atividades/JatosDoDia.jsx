import React from "react";
import { SecaoForm } from "@/components/gestao/GestaoFormParts";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { jatosDosItens, jatosIguais, linhasDoJato, rotuloDoTanque, totaisDosJatos } from "@/lib/jatosRegras";

/**
 * D-PROD-283 (MAIKE-INSUMO-POR-JATO) — "Jatos de hoje", no lugar da seção Insumos quando o implemento do registro é de um
 * tipo "por jato". Cada jato é um cartão com os produtos e as quantidades e o botão "Editar"; um jato igual ao anterior
 * vira uma linha só ("Jato 2 · igual ao jato 1"). Embaixo, "+ Repetir o jato anterior" (copia produtos e quantidades) e
 * "+ Jato diferente" (abre um jato vazio), e o total de cada produto no dia. Os hectares não são perguntados aqui: só ao
 * finalizar a área. Com um jato aberto, `secaoAberta` (a seção de insumos de sempre, só com as linhas dele) e "Pronto".
 *
 * @param {{
 *   tanque: { capacidade: string, unidade: string|null },
 *   produtos: Array<{ chave: string, form: any }>,
 *   jatoAberto: number|null,
 *   secaoAberta: React.ReactNode,
 *   bloqueado: boolean,
 *   onEditar: (numero: number) => void,
 *   onRepetir: () => void,
 *   onNovo: () => void,
 *   onPronto: () => void,
 * }} props
 */
export default function JatosDoDia({ tanque, produtos, jatoAberto, secaoAberta, bloqueado, onEditar, onRepetir, onNovo, onPronto }) {
  const tanqueTexto = rotuloDoTanque(tanque);
  if (jatoAberto !== null) {
    return (
      <>
        <SecaoForm titulo={`Jato ${jatoAberto} · o que foi no tanque${tanqueTexto ? ` (${tanqueTexto})` : ""}`} />
        {secaoAberta}
        <div className="col-span-12 min-w-0">
          <button type="button" className={BOTAO_PRIMARIO} onClick={onPronto} disabled={bloqueado} data-testid="jatos-pronto">
            Pronto
          </button>
        </div>
      </>
    );
  }
  const jatos = jatosDosItens(produtos);
  const totais = totaisDosJatos(produtos);
  return (
    <>
      <SecaoForm titulo="Jatos de hoje" />
      {jatos.length ? null : (
        <p className="col-span-12 min-w-0 text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="jatos-vazio">
          Nenhum jato ainda. Tanque de {tanqueTexto}.
        </p>
      )}
      {jatos.map((j, k) => {
        const igual = k > 0 && jatosIguais(j, jatos[k - 1]);
        return (
          <div key={j.numero} className="col-span-12 min-w-0 b1-jato" data-testid={`jato-${j.numero}`}>
            <div className="b1-jato__topo">
              <strong>{igual ? `Jato ${j.numero} · igual ao jato ${jatos[k - 1].numero}` : `Jato ${j.numero} · ${tanqueTexto}`}</strong>
              <button type="button" className={BOTAO_SECUNDARIO} onClick={() => onEditar(j.numero)} disabled={bloqueado} data-testid={`jato-${j.numero}-editar`}>
                Editar
              </button>
            </div>
            {igual
              ? null
              : linhasDoJato(j.itens).map((l) => (
                  <div key={l.chave} className="b1-jato__linha">
                    <span>{l.rotulo}</span>
                    <b>{l.texto}</b>
                  </div>
                ))}
          </div>
        );
      })}
      <div className="col-span-12 min-w-0 b1-jato__botoes">
        {jatos.length ? (
          <button type="button" className={BOTAO_PRIMARIO} onClick={onRepetir} disabled={bloqueado} data-testid="jatos-repetir">
            + Repetir o jato anterior
          </button>
        ) : null}
        <button type="button" className={jatos.length ? BOTAO_SECUNDARIO : BOTAO_PRIMARIO} onClick={onNovo} disabled={bloqueado} data-testid="jatos-novo">
          {jatos.length ? "+ Jato diferente" : "+ Jato"}
        </button>
      </div>
      {totais.length ? (
        <p className="col-span-12 min-w-0 b1-jato__total" data-testid="jatos-total">
          Hoje: {jatos.length === 1 ? "1 jato" : `${jatos.length} jatos`} · {totais.map((t) => `${t.rotulo.toLowerCase()} ${t.texto}`).join(" · ")}
        </p>
      ) : null}
      <p className="col-span-12 min-w-0 text-[12px] text-[var(--mg-text-2,#475569)]">Os hectares só são perguntados quando terminar a área.</p>
    </>
  );
}
