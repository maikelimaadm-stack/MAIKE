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
 * @property {(params: { buffer: Buffer, sha256: string, revisao: number, extensao: string, idObjeto: string }) => Promise<ResultadoUpload>} gravar
 * @property {(storage_path: string) => Promise<void>} remover
 * @property {boolean} aoVivo
 */

/**
 * Path versionado pela revisão e exclusivo da tentativa (`idObjeto` = id do
 * asset). Cada upload escreve num objeto que só ele possui: a compensação de
 * uma tentativa falha nunca alcança objeto de outra, nem um já referenciado.
 *
 * @param {{ sha256: string, revisao: number, extensao: string, idObjeto: string }} p
 */
export const caminhoObjetoCatalogo = ({ sha256, revisao, extensao, idObjeto }) =>
  `v${revisao}/${sha256.slice(0, 16)}-${idObjeto}.${extensao}`;

/** @type {Map<string, Buffer>} */
const memoria = new Map();

/** @returns {ArmazenamentoCatalogo} */
const armazenamentoMemoria = () => ({
  aoVivo: false,
  async gravar({ buffer, sha256, revisao, extensao, idObjeto }) {
    const bucket = env.catalogoStorageBucket;
    const storage_path = caminhoObjetoCatalogo({ sha256, revisao, extensao, idObjeto });
    memoria.set(`${bucket}/${storage_path}`, buffer);
    return { bucket, storage_path };
  },
  async remover(storage_path) {
    memoria.delete(`${env.catalogoStorageBucket}/${storage_path}`);
  },
});

const supabaseConfiguracaoParcial = () => {
  const temUrl = Boolean(env.supabaseUrl?.trim());
  const temKey = Boolean(env.supabaseServiceRoleKey?.trim());
  return temUrl !== temKey;
};

/** Falha em produção se Storage live não estiver disponível (fail-closed). */
export const exigirArmazenamentoCatalogoAoVivo = () => {
  if (supabaseConfiguracaoParcial()) {
    throw catalogoAssetInvalid(
      'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem estar ambos configurados ou ambos ausentes'
    );
  }
  const storage = criarArmazenamentoCatalogo();
  if (process.env.NODE_ENV === 'production' && !storage.aoVivo) {
    throw catalogoAssetInvalid(
      'Storage do catálogo indisponível: configure Supabase server-side em produção'
    );
  }
  return storage;
};

/** @returns {ArmazenamentoCatalogo} */
const armazenamentoSupabase = () => {
  const base = env.supabaseUrl?.replace(/\/+$/, '');
  const key = env.supabaseServiceRoleKey;
  if (!base || !key) return armazenamentoMemoria();

  return {
    aoVivo: true,
    async gravar({ buffer, sha256, revisao, extensao, idObjeto }) {
      const bucket = env.catalogoStorageBucket;
      const storage_path = caminhoObjetoCatalogo({ sha256, revisao, extensao, idObjeto });
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
      const resposta = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${key}`, apikey: key },
      });
      if (!resposta.ok && resposta.status !== 404) {
        throw catalogoAssetInvalid('falha ao remover objeto do Storage', { status: resposta.status });
      }
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
