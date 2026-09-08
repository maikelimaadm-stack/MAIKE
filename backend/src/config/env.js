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

export const env = {
  nodeEnv: texto('NODE_ENV') || 'development',
  port: inteiro('PORT', 3333),
  host: texto('HOST') || '0.0.0.0',
  databaseUrl: texto('DATABASE_URL'),
  authSecret: texto('AUTH_SECRET'),
  authTokenTtl: texto('AUTH_TOKEN_TTL') || '8h',
  anexoTamanhoMaximoBytes: inteiro('ANEXO_TAMANHO_MAXIMO_BYTES', 25 * 1024 * 1024),
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
