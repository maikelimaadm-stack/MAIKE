import React, { useState } from "react";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import EntradasEstoque from "@/components/estoque/EntradasEstoque";
import MovimentosEstoque from "@/components/estoque/MovimentosEstoque";
import SaldoEstoque from "@/components/estoque/SaldoEstoque";
import { useAcoesTelaEstoque, useEmpresaRealSelecionadaId } from "@/hooks/useEstoqueSessao";

/**
 * Estoque da fazenda selecionada. Uma tela, três abas Base1: Saldo (produto × depósito, das camadas disponíveis) e
 * Movimentos (kardex), SOMENTE CONSULTA (D-PROD-255), e Entradas (D-PROD-257): entrada manual documentada e saldo de
 * implantação, com os três motivos fechados. Clicar numa linha do Saldo abre os Movimentos daquele produto e depósito.
 * Lançar e excluir entrada exige a ação `entrada` da tela (o servidor bloqueia de fato); ajuste de inventário e saída
 * manual seguem sem aba nem botão. Sem permissão `visualizar` da tela `sup-estoque` nada é lido.
 * Trocar de fazenda remonta a tela (`key` da fazenda) e descarta filtros e a linha aberta.
 */
export default function EstoqueTela() {
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaEstoque();

  if (acoes.carregando) return null;
  if (!acoes.ver) {
    return <AvisoGestao testId="estoque-sem-permissao">Você não tem permissão para consultar o estoque.</AvisoGestao>;
  }
  return <EstoqueDaFazenda key={empresaId ?? "sem-empresa"} empresaId={empresaId} podeLancar={acoes.entrada} />;
}

/**
 * Estado da consulta de uma fazenda. A `key` no pai garante que trocar de fazenda começa do zero.
 * @param {{ empresaId: string|null, podeLancar: boolean }} props
 */
function EstoqueDaFazenda({ empresaId, podeLancar }) {
  const [aba, setAba] = useState(/** @type {'saldo'|'movimentos'|'entradas'} */ ("saldo"));
  const [alvo, setAlvo] = useState(/** @type {{ produto: { id: string, nome: string }, deposito: { id: string, nome: string } } | null} */ (null));
  // Cada vez que o Saldo abre os Movimentos, a aba nasce de novo com o filtro daquela linha.
  const [rodada, setRodada] = useState(0);

  /** @param {typeof alvo} novo */
  const abrirMovimentos = (novo) => {
    setAlvo(novo);
    setRodada((n) => n + 1);
    setAba("movimentos");
  };
  /** @param {'saldo'|'movimentos'|'entradas'} proxima */
  const trocarAba = (proxima) => {
    if (proxima === "movimentos") setAlvo(null);
    setAba(proxima);
  };

  if (aba === "entradas") {
    return <EntradasEstoque key={`entradas-${empresaId}`} empresaId={empresaId} aba={aba} onAba={trocarAba} podeLancar={podeLancar} />;
  }
  return aba === "saldo" ? (
    <SaldoEstoque key={`saldo-${empresaId}`} empresaId={empresaId} aba={aba} onAba={trocarAba} onAbrirMovimentos={abrirMovimentos} />
  ) : (
    <MovimentosEstoque key={`mov-${empresaId}-${rodada}`} empresaId={empresaId} aba={aba} onAba={trocarAba} inicial={alvo} />
  );
}
