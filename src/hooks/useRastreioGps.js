import { useEffect, useSyncExternalStore } from 'react';
import {
  assinarRastreio,
  encerrarRastreioDoDia,
  estadoDoRastreio,
  iniciarRastreio,
  pararRastreio,
  retomarSeHouver,
} from '@/lib/trajetoGpsControlador';

/**
 * O rastreio do trajeto (GPS, Diário da máquina) para a tela. Uma leitura fina do controlador (`trajetoGpsControlador`):
 * o GPS fica ligado no controlador, não no componente, então fechar o Diário não para o rastreio sozinho.
 *
 * Ao montar com uma atividade, retoma o trajeto aberto DESTA atividade (guardado no aparelho) se ele estava gravando.
 * Nunca liga o GPS por conta própria na primeira vez: só o toque do operador em "Iniciar rastreio" faz isso.
 *
 * @param {string|null|undefined} atividadeId
 */
export function useRastreioGps(atividadeId) {
  const estado = useSyncExternalStore(assinarRastreio, estadoDoRastreio, estadoDoRastreio);

  useEffect(() => {
    if (atividadeId) retomarSeHouver(String(atividadeId));
  }, [atividadeId]);

  const aberto = Boolean(estado.trajeto);
  const abertoNestaAtividade = aberto && String(estado.trajeto?.atividadeId) === String(atividadeId ?? '');

  return {
    ...estado,
    /** Há trajeto aberto no servidor (desta atividade ou não). */
    aberto,
    /** O trajeto aberto é desta atividade (a faixa e os botões só falam dele). */
    abertoNestaAtividade,
    /** Distância acumulada do trajeto aberto (m). */
    distanciaM: estado.trajeto?.distanciaM ?? 0,
    /** Toque em "Iniciar rastreio". Lança erro de negócio/rede; `{estado:'indisponivel'}` quando a rota não existe. */
    iniciar: iniciarRastreio,
    /** Toque em "Parar rastreio": desliga o GPS e envia o que falta. O trajeto continua aberto. */
    parar: pararRastreio,
    /** "Encerrar o dia": para, envia e encerra o trajeto. Nunca lança. */
    encerrarDia: encerrarRastreioDoDia,
  };
}

const SEM_LINHA = Object.freeze([]);

/**
 * A linha do trajeto aberto para o mapa (vazia quando não há trajeto aberto). Só lê; não liga GPS nem retoma nada.
 * @returns {ReadonlyArray<{ lat: number, lng: number }>}
 */
export function useLinhaDoTrajetoAberto() {
  const estado = useSyncExternalStore(assinarRastreio, estadoDoRastreio, estadoDoRastreio);
  return estado.trajeto ? estado.linha : SEM_LINHA;
}

export default useRastreioGps;
