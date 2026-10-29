/**
 * Leitura administrativa do catálogo global para o MAIKE Admin (D-PROD-70).
 *
 * Diferente das leituras publicadas, inclui rascunhos e inativos — por isso só
 * é servida sob `exigirSessaoAdmin()` (`/admin-maike/catalogo*`). Nunca expõe
 * `storage_path`, bucket, chave ou dados de tenant; a imagem vai pela URL
 * pública versionada do asset.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { urlPublicaAssetCatalogo } from './catalogoAssetUrls.js';
import { limitesUploadCatalogo } from './catalogoAssetValidation.js';

const prisma = () => getPrismaClient();

const comoAsset = (a) =>
  a
    ? {
        id: a.id,
        mime: a.mime,
        bytes: a.bytes,
        largura: a.largura,
        altura: a.altura,
        estado: a.estado,
        revisao: a.revisao,
        public_url: urlPublicaAssetCatalogo(a),
      }
    : null;

const carregar = async () => {
  const db = prisma();
  const [meta, tipos, categorias, icones, regras] = await Promise.all([
    db.catalogoMeta.findUnique({ where: { chave: 'global' } }),
    db.catalogoTipoEntidade.findMany({ orderBy: [{ ordem: 'asc' }, { codigo: 'asc' }] }),
    db.catalogoCategoriaVisual.findMany({ orderBy: [{ tipo_id: 'asc' }, { ordem: 'asc' }, { codigo: 'asc' }] }),
    db.catalogoIcone.findMany({
      orderBy: [{ tipo_id: 'asc' }, { categoria_id: 'asc' }, { createdAt: 'asc' }],
      include: { assetPrincipal: true, assetSubicone: true },
    }),
    db.catalogoRegraMisto.findMany({
      orderBy: [{ tipo_id: 'asc' }, { prioridade: 'desc' }, { especificidade: 'desc' }, { id: 'asc' }],
      include: { categorias: { orderBy: { ordem: 'asc' } } },
    }),
  ]);
  return { revisao: meta?.revisao ?? 0, tipos, categorias, icones, regras };
};

export const obterVisaoAdminCatalogo = async () => {
  const { revisao, tipos, categorias, icones, regras } = await carregar();
  return {
    revisao,
    limites: limitesUploadCatalogo(),
    tipos: tipos.map((t) => ({ id: t.id, codigo: t.codigo, nome: t.nome, ordem: t.ordem, ativo: t.ativo })),
    categorias: categorias.map((c) => ({
      id: c.id,
      tipo_id: c.tipo_id,
      codigo: c.codigo,
      nome: c.nome,
      ordem: c.ordem,
      ativo: c.ativo,
    })),
    icones: icones.map((i) => ({
      id: i.id,
      tipo_id: i.tipo_id,
      categoria_id: i.categoria_id,
      estado: i.estado,
      ativo: i.ativo,
      revisao: i.revisao,
      cor_fallback: i.cor_fallback,
      asset_principal: comoAsset(i.assetPrincipal),
      asset_subicone: comoAsset(i.assetSubicone),
      atualizado_em: i.updatedAt.toISOString(),
    })),
    regras_misto: regras.map((r) => ({
      id: r.id,
      tipo_id: r.tipo_id,
      icone_id: r.icone_id,
      prioridade: r.prioridade,
      especificidade: r.especificidade,
      estado: r.estado,
      ativo: r.ativo,
      categoria_ids: r.categorias.map((c) => c.categoria_id),
    })),
  };
};

/** Regras que ainda valem (rascunho ou publicada). */
const regraViva = (r) => r.ativo && r.estado !== 'inativo';
const iconePublicado = (i) => i?.ativo && i.estado === 'publicado';
const chaveConjunto = (r) => `${r.tipo_id}|${r.categorias.map((c) => c.categoria_id).sort().join(',')}`;

/**
 * Diagnóstico do catálogo (não altera nada, não toca no mapa).
 * `erros` impedem publicar com segurança; `avisos` pedem atenção.
 */
export const validarCatalogoAdmin = async () => {
  const { revisao, tipos, categorias, icones, regras } = await carregar();
  /** @type {Array<{codigo: string, mensagem: string, ids: string[]}>} */
  const erros = [];
  /** @type {Array<{codigo: string, mensagem: string, ids: string[]}>} */
  const avisos = [];
  const nomeCat = new Map(categorias.map((c) => [c.id, c.nome]));
  const iconePorId = new Map(icones.map((i) => [i.id, i]));
  const tiposAtivos = new Set(tipos.filter((t) => t.ativo).map((t) => t.id));

  for (const c of categorias.filter((x) => x.ativo && tiposAtivos.has(x.tipo_id))) {
    const publicados = icones.filter((i) => i.categoria_id === c.id && iconePublicado(i));
    if (publicados.length === 0) {
      avisos.push({ codigo: 'CATEGORIA_SEM_ICONE', mensagem: `"${c.nome}" não tem ícone publicado`, ids: [c.id] });
    } else if (publicados.length > 1) {
      const vencedor = [...publicados].sort((a, b) => b.revisao - a.revisao || (a.id < b.id ? -1 : 1))[0];
      avisos.push({
        codigo: 'ICONES_PUBLICADOS_MULTIPLOS',
        mensagem: `"${c.nome}" tem ${publicados.length} ícones publicados; vale o de maior revisão (${vencedor.id})`,
        ids: publicados.map((i) => i.id),
      });
    }
  }
  for (const i of icones.filter(iconePublicado)) {
    if (!i.assetPrincipal || i.assetPrincipal.estado !== 'publicado') {
      erros.push({ codigo: 'ICONE_SEM_IMAGEM', mensagem: 'ícone publicado sem imagem principal publicada', ids: [i.id] });
    }
  }

  const vivas = regras.filter(regraViva);
  const porConjunto = new Map();
  for (const r of vivas) {
    const k = chaveConjunto(r);
    porConjunto.set(k, [...(porConjunto.get(k) ?? []), r]);
    const ic = iconePorId.get(r.icone_id);
    if (!iconePublicado(ic)) {
      (r.estado === 'publicado' ? erros : avisos).push({
        codigo: 'MISTO_ICONE_NAO_PUBLICADO',
        mensagem: 'regra MISTO aponta para ícone que não está publicado',
        ids: [r.id],
      });
    }
  }
  for (const grupo of porConjunto.values()) {
    if (grupo.length > 1) {
      const nomes = grupo[0].categorias.map((c) => nomeCat.get(c.categoria_id) ?? c.categoria_id).join(' + ');
      erros.push({ codigo: 'MISTO_DUPLICADA', mensagem: `regras MISTO duplicadas para ${nomes}`, ids: grupo.map((r) => r.id) });
    }
  }
  for (let a = 0; a < vivas.length; a += 1) {
    for (let b = a + 1; b < vivas.length; b += 1) {
      const ra = vivas[a];
      const rb = vivas[b];
      if (ra.tipo_id !== rb.tipo_id || chaveConjunto(ra) === chaveConjunto(rb)) continue;
      if (ra.prioridade !== rb.prioridade || ra.especificidade !== rb.especificidade) continue;
      const setA = new Set(ra.categorias.map((c) => c.categoria_id));
      if (rb.categorias.some((c) => setA.has(c.categoria_id))) {
        avisos.push({
          codigo: 'MISTO_EMPATE',
          mensagem: 'duas regras MISTO com mesma prioridade e especificidade se sobrepõem; defina prioridades diferentes',
          ids: [ra.id, rb.id],
        });
      }
    }
  }
  return { revisao, ok: erros.length === 0, erros, avisos };
};
