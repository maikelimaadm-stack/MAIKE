/**
 * Upload de assets do catálogo global para Supabase Storage (server-only).
 *
 * Sem credenciais configuradas, `criarArmazenamentoCatalogo` devolve adaptador
 * em memória — suficiente para testes de contrato; Storage live fica PENDING.
 */

import { randomUUID } from 'node:crypto';

import { env } from '../../config/env.js';
import { catalogoAssetInvalid } from '../../shared/errors/AppError.js';

/**
 * @typedef {object} ResultadoUpload
 * @property {string} bucket
 * @property {string} storage_path
 * @property {string} [publicUrl]
 */

/**
 * @typedef {object} ArmazenamentoCatalogo
 * @property {(params: { buffer: Buffer, sha256: string, revisao: number, extensao: string }) => Promise<ResultadoUpload>} gravar
 * @property {(storage_path: string) => Promise<void>} remover
 * @property {boolean} aoVivo
 */

/** @type {Map<string, Buffer>} */
const memoria = new Map();

/** @returns {ArmazenamentoCatalogo} */
const armazenamentoMemoria = () => ({
  aoVivo: false,
  async gravar({ buffer, sha256, revisao, extensao }) {
    const bucket = env.catalogoStorageBucket;
    const storage_path = `v${revisao}/${sha256.slice(0, 16)}.${extensao}`;
    memoria.set(`${bucket}/${storage_path}`, buffer);
    return { bucket, storage_path };
  },
  async remover(storage_path) {
    memoria.delete(`${env.catalogoStorageBucket}/${storage_path}`);
  },
});

/** @returns {ArmazenamentoCatalogo} */
const armazenamentoSupabase = () => {
  const base = env.supabaseUrl?.replace(/\/+$/, '');
  const key = env.supabaseServiceRoleKey;
  if (!base || !key) return armazenamentoMemoria();

  return {
    aoVivo: true,
    async gravar({ buffer, sha256, revisao, extensao }) {
      const bucket = env.catalogoStorageBucket;
      const storage_path = `v${revisao}/${sha256.slice(0, 16)}.${extensao}`;
      const url = `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${storage_path}`;
      const resposta = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          'Content-Type': 'application/octet-stream',
          'x-upsert': 'false',
        },
        body: buffer,
      });
      if (!resposta.ok) {
        const texto = await resposta.text().catch(() => '');
        throw catalogoAssetInvalid('falha ao gravar objeto no Storage', {
          status: resposta.status,
          detalhe: texto.slice(0, 200),
        });
      }
      return {
        bucket,
        storage_path,
        publicUrl: `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${storage_path}`,
      };
    },
    async remover(storage_path) {
      const bucket = env.catalogoStorageBucket;
      const url = `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${storage_path}`;
      await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${key}`, apikey: key },
      });
    },
  };
};

let instancia = /** @type {ArmazenamentoCatalogo | null} */ (null);

/** @param {ArmazenamentoCatalogo} [substituto] testes */
export const criarArmazenamentoCatalogo = (substituto) => {
  if (substituto) {
    instancia = substituto;
    return substituto;
  }
  if (!instancia) {
    instancia = armazenamentoSupabase();
  }
  return instancia;
};

export const extensaoDeMime = (mime) => {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'bin';
};

export const novoIdentificadorAsset = () => randomUUID();
