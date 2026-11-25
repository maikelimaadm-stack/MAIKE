/**
 * D-PROD-307 — quantas vezes uma leitura voltou com a CÓPIA do aparelho (sem
 * internet, ou a rede não respondeu a tempo) em vez da resposta do servidor.
 *
 * Quem grava uma leitura como "resposta do servidor" (cache do mapa, cache das
 * entidades) compara o contador antes e depois: se mudou, o que chegou pode ser
 * velho e não é gravado por cima do que o aparelho já tem (um lançamento feito
 * agora sumia do histórico com internet fraca). O contador é global: pode
 * acusar a cópia de OUTRA leitura feita ao mesmo tempo — aí só se deixa de
 * gravar (a próxima leitura tenta de novo); dado velho nunca é gravado.
 */
let copiasServidas = 0;

/** Chamado por `nativeRequest` quando devolve a cópia guardada. */
export const registrarCopiaServida = () => {
  copiasServidas += 1;
};

/** @returns {number} */
export const contadorDeCopiasDoAparelho = () => copiasServidas;
