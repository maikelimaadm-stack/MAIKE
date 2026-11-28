/**
 * "Baixar dados para usar sem internet" (D-PROD-294).
 *
 * Com internet, baixa de uma vez o que o app precisa para abrir no campo:
 *   1. mapa (áreas, pontos, linhas, ícones, lotes e o que o mapa mostra);
 *   2. cadastros e demais entidades com cache no aparelho;
 *   3. as leituras que cada tela faz ao abrir (registradas pelas portas dos
 *      módulos) e as já guardadas no aparelho.
 * Depois disso, sem internet, as telas leem do aparelho. Só leitura: gravar
 * sem internet é outra etapa (sincronização), fora deste serviço.
 */

import { baixarLeiturasDasTelas, baixarEntidadesParaOffline, carregarTodasAsPortas } from '@/apis/offline';
import { CACHE_KEYS, refreshMapaCacheEntryDetalhado } from '@/services/mapaCacheService';
import { getOfflineTenant } from '@/lib/offline/offlineTenant';
import { naVezDaSincronia } from '@/lib/offline/sincronizacao/vezDaSincronia';
import { sincronizarTudo } from '@/lib/offline/sincronizacao/gatilhosDeSincronizacao';
import { esquecerRespostasDoTenant } from '@/lib/offline/respostasOffline';
import { isAppNativo } from '@/config/runtimeConfig';
import { listEmpresas } from '@/services/empresaService';
import { lerEmpresaSelecionadaIdArmazenada, persistirEmpresaSelecionada } from '@/hooks/useEmpresaSelecionadaId';

const PREFIXO = 'maike_dados_offline_em:';
/** D-PROD-301: como foi cada parte na última baixa (mapa, cadastros, telas). */
const PREFIXO_PARTES = 'maike_dados_offline_partes:';
const PREFIXO_FORMATO = 'maike_dados_offline_formato:';
/** D-PROD-380: quando foi a última sincronização leve (envia + só o que mudou). */
const PREFIXO_LEVE = 'maike_sincronia_leve_em:';

/**
 * D-PROD-307 — formato do que fica guardado no aparelho. Sobe quando uma versão do app passa a
 * guardar algo em outro lugar (ex.: oito cadastros passaram a ser guardados por cliente): a
 * primeira abertura com internet depois da atualização baixa tudo de novo, sem esperar as 6 h.
 */
export const FORMATO_DOS_DADOS = 2;

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

/** D-PROD-307 — a última baixa deste aparelho já está no formato desta versão do app? */
export const dadosNoFormatoAtual = () => {
  const tenant = getOfflineTenant();
  if (!tenant) return false;
  try {
    return Number(window.localStorage.getItem(`${PREFIXO_FORMATO}${tenant}`)) === FORMATO_DOS_DADOS;
  } catch {
    return true; // sem armazenamento: não força baixa a cada abertura
  }
};

const marcarBaixa = (quando, tenant = getOfflineTenant()) => {
  const k = tenant ? `${PREFIXO}${tenant}` : null;
  if (!k) return;
  try {
    window.localStorage.setItem(k, String(quando));
    window.localStorage.setItem(`${PREFIXO_FORMATO}${tenant}`, String(FORMATO_DOS_DADOS));
  } catch {
    // Sem armazenamento só não lembra a data.
  }
};

/** @param {string} prefixo @returns {number|null} */
const lerInstante = (prefixo) => {
  const tenant = getOfflineTenant();
  if (!tenant) return null;
  try {
    const v = Number(window.localStorage.getItem(`${prefixo}${tenant}`));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};

/** D-PROD-380: quando foi a última sincronização leve neste aparelho (ms), ou `null`. */
export const ultimaSincronizacaoLeve = () => lerInstante(PREFIXO_LEVE);

/**
 * @typedef {{ em: number, total: number, falhas: number }} SituacaoDaParte
 * @typedef {{ mapa?: SituacaoDaParte, cadastros?: SituacaoDaParte, telas?: SituacaoDaParte }} SituacaoDaBaixa
 */

/** D-PROD-301 — como veio cada parte na última baixa deste aparelho (ou `null`). @returns {SituacaoDaBaixa|null} */
export const situacaoDaBaixa = () => {
  const tenant = getOfflineTenant();
  if (!tenant) return null;
  try {
    const v = JSON.parse(window.localStorage.getItem(`${PREFIXO_PARTES}${tenant}`) || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};

/** @param {SituacaoDaBaixa} partes @param {string|null} [tenant] */
const marcarPartes = (partes, tenant = getOfflineTenant()) => {
  if (!tenant) return;
  try {
    const anteriores = JSON.parse(window.localStorage.getItem(`${PREFIXO_PARTES}${tenant}`) || 'null') ?? {};
    window.localStorage.setItem(`${PREFIXO_PARTES}${tenant}`, JSON.stringify({ ...anteriores, ...partes }));
  } catch {
    // Sem armazenamento só não lembra.
  }
};

/**
 * O app (Android/iOS) ainda não foi preparado para esta fazenda? Na primeira
 * entrada ele baixa tudo ANTES de abrir; depois, só sincroniza (D-PROD-294).
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

/** @type {Promise<{ok: boolean, falhas: number, em: number|null}>|null} */
let baixaEmCurso = null;
/** @type {string|null} */
let empresaDaBaixaEmCurso = null;
/** @type {Set<(p: ProgressoDaBaixa) => void>} */
const quemAcompanha = new Set();

/**
 * Baixa tudo. Uma parte que falha não para as outras.
 *
 * D-PROD-307:
 *  - uma baixa de cada vez: quem pede durante uma baixa recebe a MESMA (e acompanha o
 *    progresso dela) — antes, a automática de 6 h e o "Sincronizar agora" baixavam juntas;
 *  - antes de baixar, envia o que está no aparelho; e baixa e envio nunca rodam juntos
 *    (`vezDaSincronia`): a baixa não grava uma resposta de antes de um envio;
 *  - presa à conta de quando começou: se outra conta entrar no meio, para e não marca nada
 *    (antes podia marcar a outra conta como "já preparada");
 *  - se nada veio (todas as partes falharam), não marca "baixado".
 *
 * @param {{empresaId: string|null, aoAvancar?: (p: ProgressoDaBaixa) => void}} opcoes
 * @returns {Promise<{ok: boolean, falhas: number, em: number|null}>}
 */
export const baixarDadosParaOffline = ({ empresaId, aoAvancar }) => {
  // Pediu outra fazenda durante a baixa: espera esta acabar e baixa a pedida (não devolve a errada).
  if (baixaEmCurso && empresaDaBaixaEmCurso !== (empresaId ?? null)) {
    return baixaEmCurso.catch(() => undefined).then(() => baixarDadosParaOffline({ empresaId, aoAvancar }));
  }
  if (aoAvancar) quemAcompanha.add(aoAvancar);
  if (!baixaEmCurso) {
    empresaDaBaixaEmCurso = empresaId ?? null;
    const avisar = (/** @type {ProgressoDaBaixa} */ p) => quemAcompanha.forEach((fn) => fn(p));
    baixaEmCurso = (async () => {
      if (estaSemInternet()) return { ok: false, falhas: 0, em: null };
      // Primeiro o que está no aparelho vai ao servidor (a baixa já traz o resultado).
      await sincronizarTudo().catch(() => undefined);
      // D-PROD-343: a vez da sincronia é tomada POR PARTE (mapa, cadastros, telas), não pela baixa inteira: entre
      // uma parte e outra, o envio que estava esperando passa. Antes a baixa (minutos, no sinal fraco) segurava a vez
      // e o que se fazia no celular nesse tempo não subia, mesmo com o sinal de volta.
      return baixarJa({ empresaId, aoAvancar: avisar });
    })().finally(() => {
      baixaEmCurso = null;
      empresaDaBaixaEmCurso = null;
      quemAcompanha.clear();
    });
  }
  return baixaEmCurso;
};

/**
 * @param {{empresaId: string|null, aoAvancar?: (p: ProgressoDaBaixa) => void}} opcoes
 * @returns {Promise<{ok: boolean, falhas: number, em: number|null}>}
 */
const baixarJa = async ({ empresaId, aoAvancar }) => {
  if (estaSemInternet()) return { ok: false, falhas: 0, em: null };
  const tenant = getOfflineTenant();
  const mesmaConta = () => getOfflineTenant() === tenant;
  const contaTrocou = () => ({ ok: false, falhas: 0, em: null });
  let falhas = 0;
  let falhasMapa = 0;

  // Mapa: 6 leituras por vez (antes, uma de cada vez deixava o preparo lento).
  let feitasMapa = 0;
  aoAvancar?.({ etapa: 'mapa', titulo: 'Mapa', feitas: 0, total: CACHE_KEYS.length });
  const filaMapa = [...CACHE_KEYS];
  const trabalharMapa = async () => {
    while (filaMapa.length) {
      const cacheKey = /** @type {string} */ (filaMapa.shift());
      const r = await refreshMapaCacheEntryDetalhado(cacheKey, empresaId, { force: true });
      if (r.erro && r.erro !== 'SEM_CAPACIDADE') falhasMapa += 1;
      feitasMapa += 1;
      aoAvancar?.({ etapa: 'mapa', titulo: 'Mapa', feitas: feitasMapa, total: CACHE_KEYS.length });
    }
  };
  await naVezDaSincronia(() => Promise.all(Array.from({ length: 6 }, trabalharMapa)));
  if (!mesmaConta()) return contaTrocou();
  falhas += falhasMapa;
  marcarPartes({ mapa: { em: Date.now(), total: CACHE_KEYS.length, falhas: falhasMapa } }, tenant);

  // D-PROD-304: as telas carregam sob demanda; as portas (que registram as entidades e as
  // leituras de cada módulo) carregam todas aqui, antes de baixar.
  await carregarTodasAsPortas();
  const cadastros = await naVezDaSincronia(() =>
    baixarEntidadesParaOffline((p) => aoAvancar?.({ etapa: 'cadastros', titulo: 'Cadastros', feitas: p.feitas, total: p.total }))
  );
  if (!mesmaConta()) return contaTrocou();
  falhas += cadastros.falhas.length;
  marcarPartes({ cadastros: { em: Date.now(), total: Number(cadastros.total) || 0, falhas: cadastros.falhas.length } }, tenant);

  const telas = await naVezDaSincronia(() =>
    baixarLeiturasDasTelas(empresaId, (p) => aoAvancar?.({ etapa: 'telas', titulo: 'Telas do sistema', feitas: p.feitas, total: p.total }))
  );
  if (!mesmaConta()) return contaTrocou();
  falhas += telas.falhas;
  marcarPartes({ telas: { em: Date.now(), total: Number(telas.total) || 0, falhas: Number(telas.falhas) || 0 } }, tenant);

  const total = CACHE_KEYS.length + (Number(cadastros.total) || 0) + (Number(telas.total) || 0);
  // Nada veio: não marca "baixado" (o preparo e a janela continuam pedindo para baixar).
  if (total > 0 && falhas >= total) return { ok: false, falhas, em: null };
  const em = Date.now();
  marcarBaixa(em, tenant);
  return { ok: falhas === 0, falhas, em };
};

/**
 * D-PROD-380 — o que a sincronização leve atualiza do mapa: as listas que o servidor entrega pelo que mudou
 * (`/…/mudancas`, D-PROD-309 e D-PROD-345: lotes, pontos de referência, cochos, linhas, eventos de suplementação,
 * leituras de cocho, tarefas). Os lotes do mapa vêm das posições do rebanho (uma leitura por fazenda). O resto do
 * mapa, os cadastros e as telas ficam para a baixa completa (rara) e para a própria tela, quando abre.
 */
export const CHAVES_DA_SINCRONIA_LEVE = Object.freeze(['lotes', 'pontos', 'pontosSuplementacao', 'linhas', 'eventosSuplementacao', 'leiturasCocho', 'tarefas']);

/**
 * D-PROD-380 — a sincronização do dia a dia, como no AgriWebb: envia o que está no celular e baixa SÓ o que mudou
 * (as listas incrementais do mapa). Sem as telas nem os cadastros inteiros: isso é da baixa completa.
 * Não marca "baixado" (a baixa completa segue com a data dela); marca a sincronização leve.
 * @param {{ empresaId: string|null }} opcoes
 * @returns {Promise<{ok: boolean, falhas: number, em: number|null}>}
 */
export const baixarSoOQueMudou = async ({ empresaId }) => {
  if (estaSemInternet()) return { ok: false, falhas: 0, em: null };
  const tenant = getOfflineTenant();
  await sincronizarTudo().catch(() => undefined);
  if (estaSemInternet()) return { ok: false, falhas: 0, em: null };
  let falhas = 0;
  await naVezDaSincronia(() =>
    Promise.all(
      CHAVES_DA_SINCRONIA_LEVE.map(async (cacheKey) => {
        const r = await refreshMapaCacheEntryDetalhado(cacheKey, empresaId, { force: true });
        if (r.erro && r.erro !== 'SEM_CAPACIDADE') falhas += 1;
      })
    )
  );
  // Outra conta entrou no meio: não marca nada nela.
  if (!tenant || getOfflineTenant() !== tenant) return { ok: false, falhas, em: null };
  if (falhas >= CHAVES_DA_SINCRONIA_LEVE.length) return { ok: false, falhas, em: null };
  const em = Date.now();
  try {
    window.localStorage.setItem(`${PREFIXO_LEVE}${tenant}`, String(em));
  } catch {
    // Sem armazenamento só não lembra.
  }
  return { ok: falhas === 0, falhas, em };
};

/** Logout: apaga as leituras guardadas do tenant que sai e a data da baixa. Nunca lança. */
export const esquecerDadosOfflineDoTenant = (tenant) => {
  if (!tenant) return;
  try {
    window.localStorage.removeItem(`${PREFIXO}${tenant}`);
    window.localStorage.removeItem(`${PREFIXO_LEVE}${tenant}`);
    window.localStorage.removeItem(`${PREFIXO_PARTES}${tenant}`);
    window.localStorage.removeItem(`${PREFIXO_FORMATO}${tenant}`);
  } catch {
    // ignora
  }
  esquecerRespostasDoTenant(tenant).catch(() => {});
};
