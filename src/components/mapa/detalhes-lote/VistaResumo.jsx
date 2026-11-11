import React from "react";
import {
  useDlUi,
  COR,
  TIPO,
  CartaoDl,
  PilulaTitulo,
  TituloSecao,
  GradeCampos,
  NumerosDl,
} from "@/components/mapa/detalhes-lote/pecas";
import { totaisPorSecao } from "@/components/mapa/detalhes-lote/catalogo";
import LinhaLote from "@/components/mapa/detalhes-lote/LinhaLote";
import { CorpoCartaoLote } from "@/components/mapa/detalhes-lote/CartaoLote";

/** @typedef {import('./catalogo').LoteVm} LoteVm */
/** @typedef {import('./catalogo').ModeloDetalhes} ModeloDetalhes */

/**
 * O que a vista Resumo lê do estado da aba Lotes (useEstadoLotes).
 * @typedef {import('./CartaoLote').EstadoCartao & {
 *   alertaAtivo: boolean,
 *   lotesVisiveis: LoteVm[],
 *   alternarExpandido: (id: string) => void,
 *   expandido: (id: string) => boolean,
 * }} EstadoResumo
 */

/**
 * Vista Resumo da aba Lotes (mockup v8, linhas 231–291): UM card "Lotes da área · N"
 * com faixa da lotação, os 4 números da área, a lista em acordeão (um lote aberto por
 * vez, o corpo do card logo abaixo da linha) e o rodapé "Total da área".
 * Com 1 lote só: sem os 4 números, sem faixa e sem Total; o lote já vem aberto.
 *
 * @param {{ modelo: ModeloDetalhes, estado: EstadoResumo }} props
 */
export default function VistaResumo({ modelo, estado }) {
  const ui = useDlUi();
  const temVarios = modelo.temVarios;
  const total = modelo.lotes.length;
  const visiveis = estado.lotesVisiveis;
  const contagem = estado.alertaAtivo ? `${visiveis.length} de ${total}` : String(total);
  const totais = temVarios ? totaisPorSecao(modelo, estado.secoes) : [];

  const numeros = [
    { rotulo: "Peso médio (kg)", texto: modelo.resumo.pesoMedio },
    { rotulo: "Cabeças", texto: modelo.resumo.cab },
    { rotulo: "UA/ha", texto: modelo.resumo.uaHa },
    { rotulo: "kg PV/ha", texto: modelo.resumo.kgPvHa },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <CartaoDl gap={0} padding="4px 10px">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0 4px" }}>
          <PilulaTitulo>{`Lotes da área · ${contagem}`}</PilulaTitulo>
          {temVarios ? (
            <span style={{ ...TIPO.selo, color: COR.meta, whiteSpace: "nowrap" }}>{modelo.resumo.faixa}</span>
          ) : null}
        </div>

        {temVarios ? <NumerosDl itens={numeros} /> : null}

        {visiveis.map((lote, i) => {
          const aberto = estado.expandido(lote.id);
          return (
            <React.Fragment key={lote.id}>
              <LinhaLote
                lote={lote}
                expandido={aberto}
                primeira={i === 0 && !temVarios}
                onClick={() => estado.alternarExpandido(lote.id)}
              />
              {aberto ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "2px 0 10px" }}>
                  <CorpoCartaoLote lote={lote} estado={estado} />
                </div>
              ) : null}
            </React.Fragment>
          );
        })}

        {visiveis.length === 0 ? (
          <div style={{ padding: "8px 0", ...TIPO.rotulo, color: COR.meta }}>
            {estado.alertaAtivo ? "Nenhum lote com esse alerta." : "Nenhum lote na área."}
          </div>
        ) : null}

        {totais.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0 6px", borderTop: `1px solid ${COR.divisor}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <PilulaTitulo>Total da área</PilulaTitulo>
            </div>
            {totais.map((sc) => (
              <div key={sc.titulo}>
                <TituloSecao>{sc.titulo}</TituloSecao>
                <GradeCampos campos={sc.campos} colunas={ui.infoCols} variante="topico" />
              </div>
            ))}
          </div>
        ) : null}
      </CartaoDl>
    </div>
  );
}
