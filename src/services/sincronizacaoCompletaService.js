/**
 * D-PROD-329 — sincronização nos dois sentidos, com a porcentagem.
 *
 * Ao voltar a internet (e ao abrir o app, se faz tempo), o app:
 *  1. ENVIA o que foi feito no celular (celular → sistema): as filas de sempre (`sincronizarTudo`);
 *  2. BAIXA o que mudou no sistema (sistema → celular): mapa, cadastros e telas (`baixarDadosParaOffline`).
 *
 * O andamento sai num evento (`EVENTO_PROGRESSO_DA_SINCRONIA`) que o círculo do canto mostra em porcentagem:
 * envio 0–25 %, mapa 25–55 %, cadastros 55–80 %, telas 80–100 %. Uma de cada vez: quem pede durante uma recebe a
 * mesma (e acompanha o progresso dela).
 *
 * D-PROD-379 (como o AgriWebb): a sincronização automática (abrir, voltar a internet, relógio) é LEVE e SEM CARTÃO —
 * envia e baixa só o que mudou (`baixarSoOQueMudou`). A baixa completa fica para a primeira vez, o formato velho, o
 * "Sincronizar agora" e, por baixo e sem cartão, quando a última completa passou de `BAIXAR_TUDO_APOS_MS`. O cartão do
 * meio da tela (`visivel`) só aparece quando a pessoa pede ("Sincronizar agora").
 */
import { sincronizarTudo } from '@/lib/offline/sincronizacao/gatilhosDeSincronizacao';
import { baixarDadosParaOffline, baixarSoOQueMudou, estaSemInternet } from '@/services/dadosOfflineService';

export const EVENTO_PROGRESSO_DA_SINCRONIA = 'maike:progresso-da-sincronia';

/** Faixa de cada etapa na porcentagem (início, fim). */
export const FAIXAS_DA_SINCRONIA = Object.freeze({
  envio: [0, 25],
  mapa: [25, 55],
  cadastros: [55, 80],
  telas: [80, 100],
});

/** Quanto tempo o círculo fica mostrando "pronto" antes de sumir. */
export const MOSTRAR_PRONTO_MS = 2500;

/**
 * Porcentagem total a partir de uma etapa e de quanto dela já foi feito.
 * @param {keyof typeof FAIXAS_DA_SINCRONIA} etapa @param {number} feitas @param {number} total
 */
export const percentualDaSincronia = (etapa, feitas, total) => {
  const [inicio, fim] = FAIXAS_DA_SINCRONIA[etapa] ?? [0, 100];
  const fracao = total > 0 ? Math.min(1, Math.max(0, feitas / total)) : 0;
  return Math.round(inicio + (fim - inicio) * fracao);
};

/**
 * `visivel`: a pessoa pediu (o cartão do meio da tela mostra); a automática roda com `visivel: false` (D-PROD-379).
 * @typedef {{ ativo: boolean, visivel: boolean, fase: 'enviando'|'baixando'|'pronto'|'incompleto'|null, percentual: number, titulo: string }} ProgressoDaSincronia
 */

/** @type {ProgressoDaSincronia} */
let estado = { ativo: false, visivel: false, fase: null, percentual: 0, titulo: '' };
/** @type {ReturnType<typeof setTimeout>|null} */
let esconder = null;

/** O andamento atual (para quem monta depois de começar). */
export const lerProgressoDaSincronia = () => estado;

/** @param {Partial<ProgressoDaSincronia>} novo */
const emitir = (novo) => {
  // A porcentagem só anda para a frente durante a mesma sincronização; uma nova começa do zero.
  const comecando = novo.ativo === true && !estado.ativo;
  let percentual = novo.percentual ?? estado.percentual;
  if (novo.ativo === false) {
    percentual = 0;
    novo = { ...novo, visivel: false };
  }
  else if (!comecando) percentual = Math.max(percentual, estado.percentual);
  estado = { ...estado, ...novo, percentual };
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_PROGRESSO_DA_SINCRONIA, { detail: estado }));
  } catch {
    // sem window: nada a avisar
  }
};

/** @type {Promise<{ok: boolean, falhas: number, em: number|null}>|null} */
let emCurso = null;

/** D-PROD-343: o mapa relê a cópia nova (sem pedir de novo ao servidor) e as outras telas abertas releem. Nunca lança. */
const avisarTelasAbertas = () => {
  try {
    window.dispatchEvent(new CustomEvent('atualizar-mapa', { detail: { jaBuscado: true } }));
  } catch {
    // sem window
  }
  import('@/lib/query-client')
    .then((m) => m.queryClientInstance.invalidateQueries({ predicate: (q) => q.queryKey?.[0] !== 'mapa-cache' }))
    .catch(() => undefined);
};

/** Quantos registros desta sessão ainda não chegaram ao servidor (aguardando + precisa de atenção). */
const quantosFicaramNoCelular = async () => {
  try {
    // Sob demanda: a fila única junta motor, cadastros e fotos (e quem a carrega já carregou este módulo).
    const { lerFilaDeEnvio } = await import('@/services/sincronizacaoService');
    const r = await lerFilaDeEnvio();
    return Number(r?.aguardando ?? 0) + Number(r?.atencao ?? 0);
  } catch {
    return 0;
  }
};

/**
 * Envia e depois baixa, com a porcentagem.
 *
 * D-PROD-379: `modo` "tudo" (a baixa completa de sempre) ou "leve" (só o que mudou); `mostrar` liga o cartão do meio
 * da tela (só quando a pessoa pediu). Pedir com `mostrar` durante uma automática passa a mostrar a que está em curso.
 * @param {{ empresaId: string|null, aoAvancar?: (p: {titulo: string, feitas: number, total: number}) => void, modo?: 'tudo'|'leve', mostrar?: boolean }} opcoes
 * @returns {Promise<{ok: boolean, falhas: number, em: number|null}>}
 */
export const sincronizarNosDoisSentidos = ({ empresaId, aoAvancar, modo = 'tudo', mostrar = true }) => {
  if (emCurso) {
    if (mostrar && estado.ativo && !estado.visivel) emitir({ visivel: true });
    return emCurso;
  }
  if (estaSemInternet()) return Promise.resolve({ ok: false, falhas: 0, em: null });
  if (esconder) clearTimeout(esconder);
  emCurso = (async () => {
    if (estado.ativo) emitir({ ativo: false, fase: null, titulo: '' });
    emitir({ ativo: true, visivel: mostrar, fase: 'enviando', percentual: 2, titulo: 'Enviando o que foi feito no celular' });
    // D-PROD-337: a internet voltou (ou o app abriu): o que esperava por falta de rede tenta já.
    await sincronizarTudo({ jaEmVoltaDaRede: true }).catch(() => undefined);
    emitir({ percentual: FAIXAS_DA_SINCRONIA.envio[1], titulo: 'Baixando os dados do sistema' });
    /** @type {{ok: boolean, falhas: number, em: number|null}} */
    let r = { ok: false, falhas: 0, em: null };
    try {
      r =
        modo === 'leve'
          ? await baixarSoOQueMudou({ empresaId })
          : await baixarDadosParaOffline({
              empresaId,
              aoAvancar: (p) => {
                emitir({ fase: 'baixando', titulo: `Baixando: ${p.titulo}`, percentual: percentualDaSincronia(p.etapa, p.feitas, p.total) });
                aoAvancar?.({ titulo: p.titulo, feitas: p.feitas, total: p.total });
              },
            });
      // D-PROD-343: as telas abertas passam a mostrar o que acabou de chegar. Antes só o cartão dizia "Tudo
      // sincronizado"; o mapa aberto sem internet continuava com a cópia de ontem até ser reaberto.
      if (r.em) avisarTelasAbertas();
    } finally {
      // D-PROD-337: "Tudo sincronizado" só quando nada ficou no celular. Antes valia só a baixa: com registros parados
      // na fila (sem rede no envio, recusados), o cartão dizia "Tudo sincronizado" e a pessoa ia embora.
      const restantes = await quantosFicaramNoCelular();
      const completo = r.ok && restantes === 0;
      const titulo = completo
        ? 'Tudo sincronizado'
        : restantes > 0
          ? `${restantes} ${restantes === 1 ? 'registro ficou' : 'registros ficaram'} no celular`
          : 'Sincronizado em parte';
      emitir({ fase: completo ? 'pronto' : 'incompleto', percentual: 100, titulo });
      esconder = setTimeout(() => {
        esconder = null;
        if (!emCurso) emitir({ ativo: false, fase: null, titulo: '' });
      }, MOSTRAR_PRONTO_MS);
    }
    return r;
  })().finally(() => {
    emCurso = null;
  });
  return emCurso;
};

/**
 * D-PROD-379 — a baixa COMPLETA (mapa inteiro, cadastros e telas) por baixo, sem cartão, só quando a última passou disto.
 * Antes: ao abrir depois de 10 min, ao voltar a internet depois de 3 min e a cada 6 h — e sempre com o cartão
 * "Sincronizando" no meio da tela. O dia a dia agora é a leve (só o que mudou).
 */
export const BAIXAR_TUDO_APOS_MS = 12 * 60 * 60 * 1000;
/** Ao abrir, voltar ao app ou voltar a internet: a leve, se a última sincronização (leve ou completa) tem mais que isto. */
export const SINCRONIA_LEVE_APOS_MS = 2 * 60 * 1000;
/** Com o app aberto (relógio de 15 min): a leve, se a última tem mais que isto. */
export const SINCRONIA_LEVE_PARADO_APOS_MS = 15 * 60 * 1000;

/**
 * O que sincronizar sozinho (o app já preparado), D-PROD-379:
 *  - "tudo" (por baixo, sem cartão): dados no formato antigo, ou a última baixa completa tem mais de 12 h;
 *  - "leve" (envia + só o que mudou, sem cartão): ao abrir / voltar ao app / voltar a internet, se a última
 *    sincronização tem mais de 2 min; com o app aberto ("relogio"), se tem mais de 15 min;
 *  - `null`: nada a fazer agora (sem internet, ainda não preparado, ou acabou de sincronizar).
 * O ENVIO do que está no celular não depende disto: os gatilhos da fila enviam sempre (`gatilhosDeSincronizacao`).
 * @param {'voltou'|'abriu'|'relogio'} motivo
 * @param {{ ultima: number|null, ultimaLeve?: number|null, agora: number, formatoAtual: boolean, semInternet: boolean }} situacao
 * @returns {'tudo'|'leve'|null}
 */
export const deveSincronizarSozinho = (motivo, { ultima, ultimaLeve = null, agora, formatoAtual, semInternet }) => {
  if (!ultima || semInternet) return null;
  if (!formatoAtual) return 'tudo';
  if (agora - ultima > BAIXAR_TUDO_APOS_MS) return 'tudo';
  const ultimaQualquer = Math.max(ultima, ultimaLeve ?? 0);
  const espera = motivo === 'relogio' ? SINCRONIA_LEVE_PARADO_APOS_MS : SINCRONIA_LEVE_APOS_MS;
  return agora - ultimaQualquer > espera ? 'leve' : null;
};
