import React, { useState } from "react";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import MovimentosEstoque from "@/components/estoque/MovimentosEstoque";
import SaldoEstoque from "@/components/estoque/SaldoEstoque";
import { useAcoesTelaEstoque, useEmpresaRealSelecionadaId } from "@/hooks/useEstoqueSessao";

/**
 * Estoque da fazenda selecionada. Uma tela, duas abas Base1: Saldo (produto × depósito, das camadas disponíveis) e
 * Movimentos (kardex). D-PROD-259: o lançamento fica DENTRO de Movimentos ("Novo movimento", em que se escolhe o tipo:
 * Entrada, Saída, Ajuste ou Transferência); não há aba separada de Entradas. Clicar numa linha do Saldo abre os Movimentos
 * daquele produto e depósito. Entrada e Transferência exigem a ação `entrada` da tela; a Saída manual (D-PROD-264), a
 * ação `saida`; o Ajuste de inventário (D-PROD-267), a ação `ajuste` (o servidor bloqueia de fato). Sem permissão `visualizar` da tela `sup-estoque` nada é lido.
 * Trocar de fazenda remonta a tela (`key` da fazenda) e descarta filtros e a linha aberta.
 */
export default function EstoqueTela() {
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaEstoque();

  if (acoes.carregando) return null;
  if (!acoes.ver) {
    return <AvisoGestao testId="estoque-sem-permissao">Você não tem permissão para consultar o estoque.</AvisoGestao>;
  }
  return <EstoqueDaFazenda key={empresaId ?? "sem-empresa"} empresaId={empresaId} podeLancar={acoes.entrada} podeSaida={acoes.saida} podeAjuste={acoes.ajuste} />;
}

/**
 * Estado da consulta de uma fazenda. A `key` no pai garante que trocar de fazenda começa do zero.
 * @param {{ empresaId: string|null, podeLancar: boolean, podeSaida: boolean, podeAjuste: boolean }} props
 */
function EstoqueDaFazenda({ empresaId, podeLancar, podeSaida, podeAjuste }) {
  const [aba, setAba] = useState(/** @type {'saldo'|'movimentos'} */ ("saldo"));
  const [alvo, setAlvo] = useState(/** @type {{ produto: { id: string, nome: string }, deposito: { id: string, nome: string } } | null} */ (null));
  // Cada vez que o Saldo abre os Movimentos, a aba nasce de novo com o filtro daquela linha.
  const [rodada, setRodada] = useState(0);

  /** @param {typeof alvo} novo */
  const abrirMovimentos = (novo) => {
    setAlvo(novo);
    setRodada((n) => n + 1);
    setAba("movimentos");
  };
  /** @param {'saldo'|'movimentos'} proxima */
  const trocarAba = (proxima) => {
    if (proxima === "movimentos") setAlvo(null);
    setAba(proxima);
  };

  return aba === "saldo" ? (
    <SaldoEstoque key={`saldo-${empresaId}`} empresaId={empresaId} aba={aba} onAba={trocarAba} onAbrirMovimentos={abrirMovimentos} />
  ) : (
    <MovimentosEstoque key={`mov-${empresaId}-${rodada}`} empresaId={empresaId} aba={aba} onAba={trocarAba} podeLancar={podeLancar} podeSaida={podeSaida} podeAjuste={podeAjuste} inicial={alvo} />
  );
}
