import React, { useState } from "react";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import MovimentosEstoque from "@/components/estoque/MovimentosEstoque";
import SaldoEstoque from "@/components/estoque/SaldoEstoque";
import { useAcoesTelaEstoque, useEmpresaRealSelecionadaId } from "@/hooks/useEstoqueSessao";

/**
 * Estoque (D-PROD-255) — Saldo e Movimentos, SOMENTE CONSULTA, da fazenda selecionada.
 *
 * Uma tela, duas abas Base1: Saldo (produto × depósito, das camadas disponíveis) e Movimentos (kardex). Clicar numa
 * linha do Saldo abre os Movimentos daquele produto e depósito. Entrada, ajuste de inventário e saída manual são
 * decisões futuras (D-PROD-255) e não têm aba nem botão. Sem permissão `visualizar` da tela `sup-estoque` nada é lido.
 * Trocar de fazenda descarta filtros e a linha aberta (as abas voltam do zero, pela `key`).
 */
export default function EstoqueTela() {
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaEstoque();
  const [aba, setAba] = useState(/** @type {'saldo'|'movimentos'} */ ("saldo"));
  const [alvo, setAlvo] = useState(/** @type {{ produto: { id: string, nome: string }, deposito: { id: string, nome: string } } | null} */ (null));
  // Cada vez que o Saldo abre os Movimentos, a aba nasce de novo com o filtro daquela linha.
  const [rodada, setRodada] = useState(0);

  if (acoes.carregando) return null;
  if (!acoes.ver) {
    return <AvisoGestao testId="estoque-sem-permissao">Você não tem permissão para consultar o estoque.</AvisoGestao>;
  }

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
    <MovimentosEstoque key={`mov-${empresaId}-${rodada}`} empresaId={empresaId} aba={aba} onAba={trocarAba} inicial={alvo} />
  );
}
