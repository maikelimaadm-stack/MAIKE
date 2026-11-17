import React from "react";
import { useLancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import { CabecalhoProprio } from "./blocos";
import { useModoPasto } from "./pastoContexto";

/*
 * Casca v12 dos detalhes de UMA tela abertos pelo mapa — cocho, depósito,
 * bebedouro e tarefa (D-PROD-220), no mesmo desenho do Detalhes do Lote
 * (`PainelPasto`, D-PROD-218), sem abas:
 *
 *   div.mk-dp[data-modo] > div.mk-dp__corpo.mk-dp__corpo--cards|--lista + div.mk-dp__rodape
 *
 * A raiz é filha direta do `.mk-ll` do `LancLoteDialogo` (o CSS do popup a
 * partir de 768 px depende disso: `popupDesde="tablet"`). O título, o
 * subtítulo e o ‹ Voltar vão para o cabeçalho do diálogo (`setCabecalho`);
 * fora do diálogo (ex.: página de cadastro) a casca desenha o
 * `CabecalhoProprio`, salvo `semCabecalho`.
 *
 * Telas empilhadas (ex.: depósito › cocho) são da própria tela: ela troca
 * `chaveTela` e passa `onVoltar`; a casca anima a troca (`anim`) e o Esc do
 * diálogo chama o ‹ Voltar. Num formulário empilhado passe `escVolta={false}`:
 * o ‹ Voltar fica e o Esc é ignorado, para um Esc sem querer não apagar o que
 * foi digitado. Lançamentos e históricos dos detalhes do mapa não empilham:
 * abrem num `LancLoteDialogo` por cima do detalhe (D-PROD-221).
 *
 * `cabecalhoDoCorpo` entra entre o cabeçalho e o corpo, fora da rolagem (ex.:
 * as `Abas` do curral: Abate · Histórico da Área); `propsDoCorpo` vai para o
 * corpo (ex.: `role="tabpanel"` + `aria-labelledby` da aba ativa).
 */

/**
 * @param {{
 *   titulo: string,
 *   sub?: string,
 *   onVoltar?: (() => void) | null,
 *   escVolta?: boolean,
 *   corpo?: "cards" | "lista",
 *   rodape?: React.ReactNode,
 *   chaveTela?: string,
 *   anim?: "empurrar" | "voltar" | "troca" | "aba-dir" | "aba-esq" | null,
 *   semCabecalho?: boolean,
 *   cabecalhoDoCorpo?: React.ReactNode,
 *   propsDoCorpo?: React.HTMLAttributes<HTMLDivElement> & Record<string, any>,
 *   className?: string,
 *   children: React.ReactNode,
 * } & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "className">} props
 */
export default function CascaDetalhe({
  titulo,
  sub = "",
  onVoltar = null,
  escVolta = true,
  corpo = "cards",
  rodape = null,
  chaveTela = "principal",
  anim = null,
  semCabecalho = false,
  cabecalhoDoCorpo = null,
  propsDoCorpo = undefined,
  className,
  children,
  ...resto
}) {
  const modo = useModoPasto();
  const dialogo = useLancLoteDialogo();
  const setCabecalho = dialogo?.setCabecalho || null;

  // O ‹ Voltar publicado é estável: quem chama passa funções novas a cada
  // render, e o cabeçalho só muda quando muda o título, o sub ou a presença do voltar.
  const voltarRef = React.useRef(onVoltar);
  voltarRef.current = onVoltar;
  const temVoltar = typeof onVoltar === "function";
  const voltarEstavel = React.useCallback(() => voltarRef.current?.(), []);

  React.useEffect(() => {
    if (!setCabecalho) return undefined;
    setCabecalho(
      titulo
        ? { titulo, sub: sub || "", voltar: temVoltar ? voltarEstavel : null, ...(escVolta === false ? { escVolta: false } : {}) }
        : null
    );
    return () => setCabecalho(null);
  }, [setCabecalho, titulo, sub, temVoltar, voltarEstavel, escVolta]);

  const classesCorpo = ["mk-dp__corpo", `mk-dp__corpo--${corpo === "lista" ? "lista" : "cards"}`, anim ? `mk-dp-anim--${anim}` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={["mk-dp", className].filter(Boolean).join(" ")} data-modo={modo} translate="no" {...resto}>
      {!setCabecalho && !semCabecalho ? <CabecalhoProprio titulo={titulo} sub={sub} onVoltar={temVoltar ? voltarEstavel : null} /> : null}
      {cabecalhoDoCorpo}
      <div key={chaveTela} className={classesCorpo} {...propsDoCorpo}>
        {children}
      </div>
      <div className="mk-dp__rodape">{rodape}</div>
    </div>
  );
}
