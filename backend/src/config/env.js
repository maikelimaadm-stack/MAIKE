/**
 * Configuração por ambiente.
 *
 * Uma única porta de leitura de `process.env` no backend. O resto do código
 * importa daqui — nunca lê variável de ambiente direto, pelo mesmo motivo que a
 * P1 centralizou `runtimeConfig` no frontend: variável lida em vinte lugares é
 * vinte contratos implícitos.
 *
 * Nenhum valor padrão de segredo. Ausência de segredo em produção é falha
 * dura, não fallback silencioso.
 */

import { config as carregarDotenv } from 'dotenv';

carregarDotenv();

const texto = (nome) => {
  const valor = process.env[nome];
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
};

const inteiro = (nome, padrao) => {
  const bruto = texto(nome);
  if (bruto === null) return padrao;
  const valor = Number.parseInt(bruto, 10);
  return Number.isFinite(valor) ? valor : padrao;
};

/**
 * Lista de origins separada por vírgula (P4.0).
 *
 * Normaliza espaços e descarta entradas vazias, para que
 * `"http://a, ,http://b,"` não vire três origins, uma delas string vazia — e
 * origin vazia comparada por igualdade casaria com um `Origin:` ausente.
 *
 * A barra final é removida porque o header `Origin` do navegador nunca a tem:
 * `http://localhost:5173/` no `.env` jamais casaria com o que chega.
 *
 * @param {string} nome
 * @returns {string[]}
 */
const listaDeOrigins = (nome) => {
  const bruto = texto(nome);
  if (bruto === null) return [];
  return bruto
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter((item) => item.length > 0);
};

export const env = {
  nodeEnv: texto('NODE_ENV') || 'development',
  port: inteiro('PORT', 3333),
  host: texto('HOST') || '0.0.0.0',
  databaseUrl: texto('DATABASE_URL'),
  authSecret: texto('AUTH_SECRET'),
  authTokenTtl: texto('AUTH_TOKEN_TTL') || '8h',
  anexoTamanhoMaximoBytes: inteiro('ANEXO_TAMANHO_MAXIMO_BYTES', 25 * 1024 * 1024),
  /**
   * Origins do navegador autorizadas a chamar esta API (P4.0, D-PROD-24).
   *
   * Vazio significa **nenhuma origin de navegador autorizada**, não "todas".
   * Essa é a diferença entre configuração ausente virar porta fechada ou porta
   * aberta, e é o tipo de padrão que só se percebe errado depois do incidente.
   */
  frontendOrigins: listaDeOrigins('FRONTEND_ORIGINS'),
};

export const ehProducao = () => env.nodeEnv === 'production';

/**
 * Variáveis sem as quais o processo não pode servir requisição.
 * @returns {string[]} nomes ausentes
 */
export const variaveisObrigatoriasAusentes = () => {
  const ausentes = [];
  if (!env.databaseUrl) ausentes.push('DATABASE_URL');
  if (!env.authSecret) ausentes.push('AUTH_SECRET');
  return ausentes;
};

/** Falha dura quando falta configuração obrigatória. */
export const exigirConfiguracaoCompleta = () => {
  const ausentes = variaveisObrigatoriasAusentes();
  if (ausentes.length) {
    throw new Error(
      `configuração de ambiente incompleta: ${ausentes.join(', ')}. ` +
        'Veja .env.example. Nenhum valor padrão é assumido para segredo.'
    );
  }
};
