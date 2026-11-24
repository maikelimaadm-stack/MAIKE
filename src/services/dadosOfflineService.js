/**
 * "Baixar dados para usar sem internet" (D-PROD-289).
 *
 * Com internet, baixa de uma vez o que o app precisa para abrir no campo:
 *   1. mapa (áreas, pontos, linhas, ícones, lotes e o que o mapa mostra);
 *   2. cadastros e demais entidades com cache no aparelho;
 *   3. as leituras que cada tela faz ao abrir (registradas pelas portas dos
 *      módulos) e as já guardadas no aparelho.
 * Depois disso, sem internet, as telas leem do aparelho. Só leitura: gravar
 * sem internet é outra etapa (sincronização), fora deste serviço.
 */

import { baixarLeiturasDasTelas, baixarEntidadesParaOffline } from '@/apis/offline';
import { CACHE_KEYS, refreshMapaCacheEntryDetalhado } from '@/services/mapaCacheService';
import { getOfflineTenant } from '@/lib/offline/offlineTenant';
import { esquecerRespostasDoTenant } from '@/lib/offline/respostasOffline';
import { isAppNativo } from '@/config/runtimeConfig';
import { listEmpresas } from '@/services/empresaService';
import { lerEmpresaSelecionadaIdArmazenada, persistirEmpresaSelecionada } from '@/hooks/useEmpresaSelecionadaId';

const PREFIXO = 'maike_dados_offline_em:';

const chave = () => {
  const tenant = getOfflineTenant();
  return tenant ? `${PREFIXO}${tenant}` : null;
};

/** Quando os dados foram baixados neste aparelho (ms), ou `null`. */
export const ultimaBaixaDosDados = () => {
  const k = chave();
  if (!k) return null;
  try {
    const v = Number(window.localStorage.getItem(k));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};

const marcarBaixa = (quando) => {
  const k = chave();
  if (!k) return;
  try {
    window.localStorage.setItem(k, String(quando));
  } catch {
    // Sem armazenamento só não lembra a data.
  }
};

/**
 * O app (Android/iOS) ainda não foi preparado para esta fazenda? Na primeira
 * entrada ele baixa tudo ANTES de abrir; depois, só sincroniza (D-PROD-289).
 */
export const appPrecisaPreparar = () => isAppNativo() && ultimaBaixaDosDados() === null;

/**
 * Empresa para baixar os dados na primeira entrada: a escolhida, ou a primeira
 * da lista (a mesma regra do menu), ou o próprio tenant. Grava a escolha.
 *
 * @param {string|null} clienteId
 * @returns {Promise<string|null>}
 */
export const garantirEmpresaSelecionada = async (clienteId) => {
  const atual = lerEmpresaSelecionadaIdArmazenada(clienteId);
  if (atual) return atual;
  let escolhida = null;
  try {
    const empresas = await listEmpresas();
    escolhida = Array.isArray(empresas) && empresas[0]?.id ? empresas[0].id : null;
  } catch {
    escolhida = null;
  }
  escolhida = escolhida || clienteId || null;
  if (escolhida) persistirEmpresaSelecionada(escolhida, clienteId);
  return escolhida;
};

export const estaSemInternet = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * @typedef {{etapa: 'mapa'|'cadastros'|'telas', titulo: string, feitas: number, total: number}} ProgressoDaBaixa
 */

/**
 * Baixa tudo. Uma parte que falha não para as outras.
 *
 * @param {{empresaId: string|null, aoAvancar?: (p: ProgressoDaBaixa) => void}} opcoes
 * @returns {Promise<{ok: boolean, falhas: number, em: number|null}>}
 */
export const baixarDadosParaOffline = async ({ empresaId, aoAvancar }) => {
  if (estaSemInternet()) return { ok: false, falhas: 0, em: null };
  let falhas = 0;

  // Mapa: 6 leituras por vez (antes, uma de cada vez deixava o preparo lento).
  let feitasMapa = 0;
  aoAvancar?.({ etapa: 'mapa', titulo: 'Mapa', feitas: 0, total: CACHE_KEYS.length });
  const filaMapa = [...CACHE_KEYS];
  const trabalharMapa = async () => {
    while (filaMapa.length) {
      const cacheKey = /** @type {string} */ (filaMapa.shift());
      const r = await refreshMapaCacheEntryDetalhado(cacheKey, empresaId, { force: true });
      if (r.erro && r.erro !== 'SEM_CAPACIDADE') falhas += 1;
      feitasMapa += 1;
      aoAvancar?.({ etapa: 'mapa', titulo: 'Mapa', feitas: feitasMapa, total: CACHE_KEYS.length });
    }
  };
  await Promise.all(Array.from({ length: 6 }, trabalharMapa));

  const cadastros = await baixarEntidadesParaOffline((p) =>
    aoAvancar?.({ etapa: 'cadastros', titulo: 'Cadastros', feitas: p.feitas, total: p.total })
  );
  falhas += cadastros.falhas.length;

  const telas = await baixarLeiturasDasTelas(empresaId, (p) =>
    aoAvancar?.({ etapa: 'telas', titulo: 'Telas do sistema', feitas: p.feitas, total: p.total })
  );
  falhas += telas.falhas;

  const em = Date.now();
  marcarBaixa(em);
  return { ok: falhas === 0, falhas, em };
};

/** Logout: apaga as leituras guardadas do tenant que sai e a data da baixa. Nunca lança. */
export const esquecerDadosOfflineDoTenant = (tenant) => {
  if (!tenant) return;
  try {
    window.localStorage.removeItem(`${PREFIXO}${tenant}`);
  } catch {
    // ignora
  }
  esquecerRespostasDoTenant(tenant).catch(() => {});
};
