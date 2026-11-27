/**
 * A janela do lançamento por tipo (`JanelaLancamentoPorTipo`, D-PROD-233/252) aberta direto no teste.
 *
 * Os botões "+" por tipo da tela da área saíram (D-PROD-377): na tela de Lançamento de atividades, lançar é pelo
 * Diário das atividades. A janela continua viva no mapa (o "Só …" da área, `AcoesDaAtividadeDaArea`), então os testes
 * do comportamento dela (criar o dia, a rota da linha, repetir o envio, "Salvar e abastecer") abrem a janela por aqui,
 * com as mesmas props que o mapa passa, montada AO LADO da tela, no mesmo QueryClient: o que ela grava relê a tabela da
 * área que está atrás.
 */
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import JanelaLancamentoPorTipo from "@/components/lancamento-atividades/JanelaLancamentoPorTipo";
import { useAcoesTelaAtividades } from "@/hooks/useLancamentoAtividadesSessao";
import { useAuth } from "@/lib/AuthContext";
import { areasDaAtividade } from "@/lib/atividadeAreasRegras";
import { LINHA_MAQUINA, flagsDoTipoDaAtividade } from "@/lib/atividadeLinhasRegras";
import { REGISTRO_IMPLEMENTO } from "@/lib/atividadeFluxoCampo";
import { listarTiposAtividade, obterAtividade } from "@/services/lancamentoAtividadesService";

/** @type {{ abrir: null | ((pedido: { atividadeId: string, tipo: string, areaId: string|null, chave: number }) => void) }} */
const controle = { abrir: null };

/**
 * Pede a janela do tipo sobre a atividade. Implemento abre o formulário da máquina (o implemento se escolhe junto).
 * @param {string} atividadeId @param {string} tipo @param {string|null} [areaId] sem área: a única da atividade
 */
export const abrirJanelaDireta = (atividadeId, tipo, areaId = null) => {
  if (!controle.abrir) throw new Error("JanelaDireta não está montada");
  controle.abrir({ atividadeId, tipo: tipo === REGISTRO_IMPLEMENTO ? LINHA_MAQUINA : tipo, areaId, chave: Date.now() });
};

/** Monte ao lado da tela, dentro do mesmo QueryClientProvider. */
export function JanelaDireta() {
  const [pedido, setPedido] = useState(/** @type {{ atividadeId: string, tipo: string, areaId: string|null, chave: number } | null} */ (null));
  useEffect(() => {
    controle.abrir = setPedido;
    return () => {
      controle.abrir = null;
    };
  }, []);
  const queryClient = useQueryClient();
  const acoes = useAcoesTelaAtividades();
  const { clienteId } = useAuth();
  const { data: tipos } = useQuery({ queryKey: ["teste-janela-direta", "tipos"], queryFn: () => listarTiposAtividade(), enabled: Boolean(pedido) });
  const { data: atividade } = useQuery({
    queryKey: ["teste-janela-direta", "atividade", pedido?.atividadeId ?? null, pedido?.chave ?? 0],
    queryFn: () => obterAtividade(String(pedido?.atividadeId)),
    enabled: Boolean(pedido),
  });
  if (!pedido || !tipos || !atividade) return null;
  const areas = areasDaAtividade(atividade);
  const areaInicial = pedido.areaId ?? (areas.length === 1 ? String(areas[0].id) : null);
  return (
    <JanelaLancamentoPorTipo
      key={pedido.chave}
      atividade={atividade}
      tipo={pedido.tipo}
      acoes={acoes}
      flags={flagsDoTipoDaAtividade(atividade, /** @type {any[]} */ (tipos))}
      escopo={`${clienteId || "sem-tenant"}:${acoes?.login || "sem-login"}`}
      onFechar={() => setPedido(null)}
      onAtividadeAtualizada={() => void queryClient.invalidateQueries()}
      areaInicial={areaInicial}
    />
  );
}
