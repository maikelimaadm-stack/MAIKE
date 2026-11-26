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
 */
import { sincronizarTudo } from '@/lib/offline/sincronizacao/gatilhosDeSincronizacao';
import { baixarDadosParaOffline, estaSemInternet } from '@/services/dadosOfflineService';

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
 * @typedef {{ ativo: boolean, fase: 'enviando'|'baixando'|'pronto'|'incompleto'|null, percentual: number, titulo: string }} ProgressoDaSincronia
 */

/** @type {ProgressoDaSincronia} */
let estado = { ativo: false, fase: null, percentual: 0, titulo: '' };
/** @type {ReturnType<typeof setTimeout>|null} */
let esconder = null;

/** O andamento atual (para quem monta depois de começar). */
export const lerProgressoDaSincronia = () => estado;

/** @param {Partial<ProgressoDaSincronia>} novo */
const emitir = (novo) => {
  // A porcentagem só anda para a frente durante a mesma sincronização; uma nova começa do zero.
  const comecando = novo.ativo === true && !estado.ativo;
  let percentual = novo.percentual ?? estado.percentual;
  if (novo.ativo === false) percentual = 0;
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

/**
 * Envia e depois baixa, mostrando a porcentagem.
 * @param {{ empresaId: string|null, aoAvancar?: (p: {titulo: string, feitas: number, total: number}) => void }} opcoes
 * @returns {Promise<{ok: boolean, falhas: number, em: number|null}>}
 */
export const sincronizarNosDoisSentidos = ({ empresaId, aoAvancar }) => {
  if (emCurso) return emCurso;
  if (estaSemInternet()) return Promise.resolve({ ok: false, falhas: 0, em: null });
  if (esconder) clearTimeout(esconder);
  emCurso = (async () => {
    if (estado.ativo) emitir({ ativo: false, fase: null, titulo: '' });
    emitir({ ativo: true, fase: 'enviando', percentual: 2, titulo: 'Enviando o que foi feito no celular' });
    await sincronizarTudo().catch(() => undefined);
    emitir({ percentual: FAIXAS_DA_SINCRONIA.envio[1], titulo: 'Baixando os dados do sistema' });
    /** @type {{ok: boolean, falhas: number, em: number|null}} */
    let r = { ok: false, falhas: 0, em: null };
    try {
      r = await baixarDadosParaOffline({
        empresaId,
        aoAvancar: (p) => {
          emitir({ fase: 'baixando', titulo: `Baixando: ${p.titulo}`, percentual: percentualDaSincronia(p.etapa, p.feitas, p.total) });
          aoAvancar?.({ titulo: p.titulo, feitas: p.feitas, total: p.total });
        },
      });
    } finally {
      const completo = r.ok;
      emitir({ fase: completo ? 'pronto' : 'incompleto', percentual: 100, titulo: completo ? 'Tudo sincronizado' : 'Sincronizado em parte' });
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

/** Ao abrir ou voltar ao app: sincroniza se a última baixa tem mais que isto. */
export const SINCRONIZAR_AO_ABRIR_APOS_MS = 10 * 60 * 1000;
/** Com o app aberto: sincroniza sozinho depois deste tempo. */
export const SINCRONIZAR_PARADO_APOS_MS = 6 * 60 * 60 * 1000;

/**
 * Quando sincronizar sozinho (o app já preparado):
 *  - "voltou": a internet voltou → sempre;
 *  - "abriu": abriu ou voltou ao app → se a última baixa tem mais de 10 min (ou os dados estão no formato antigo);
 *  - "relogio": a cada 15 min com o app aberto → se tem mais de 6 h.
 * @param {'voltou'|'abriu'|'relogio'} motivo
 * @param {{ ultima: number|null, agora: number, formatoAtual: boolean, semInternet: boolean }} situacao
 */
export const deveSincronizarSozinho = (motivo, { ultima, agora, formatoAtual, semInternet }) => {
  if (!ultima || semInternet) return false;
  if (!formatoAtual || motivo === 'voltou') return true;
  const idade = agora - ultima;
  return motivo === 'abriu' ? idade > SINCRONIZAR_AO_ABRIR_APOS_MS : idade > SINCRONIZAR_PARADO_APOS_MS;
};
