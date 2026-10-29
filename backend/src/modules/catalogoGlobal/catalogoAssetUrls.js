import { env } from '../../config/env.js';

/**
 * @param {{ bucket: string, storage_path: string } | null | undefined} asset
 * @returns {string | null}
 */
export const urlPublicaAssetCatalogo = (asset) => {
  if (!asset?.storage_path) return null;
  const base = env.supabaseUrl?.replace(/\/+$/, '');
  if (!base) return null;
  const bucket = asset.bucket || env.catalogoStorageBucket;
  return `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${asset.storage_path}`;
};
