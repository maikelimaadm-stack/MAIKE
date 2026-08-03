/**
 * Validações de manejo — superfície preservada para os consumidores da P1.3.
 *
 * A regra e o carregamento saíram daqui na P1.2: a regra pura vive em
 * `@/domain/lotes/ordemTemporal` e o carregamento em `@/services/loteManejoService`,
 * por API explícita. Este arquivo deixou de falar com o provider — era o único
 * motivo de ele existir em `src/components` com acesso a dados.
 */

export {
  validarOrdemTemporalLote,
  validarOrdemTemporalLotes,
  validarSemRegistrosPosteriores,
} from '@/services/loteManejoService';
