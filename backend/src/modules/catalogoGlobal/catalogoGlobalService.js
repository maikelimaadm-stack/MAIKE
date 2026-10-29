import { getPrismaClient } from '../../database/prismaClient.js';
import { catalogoGlobalInvalid, catalogoGlobalNotFound } from '../../shared/errors/AppError.js';
import { urlPublicaAssetCatalogo } from './catalogoAssetUrls.js';
import { validarBufferAssetCatalogo } from './catalogoAssetValidation.js';
import {
  exigirArmazenamentoCatalogoAoVivo,
  extensaoDeMime,
  novoIdentificadorAsset,
} from './catalogoAssetStorage.js';
import { registrarAuditoriaCatalogo } from './catalogoAuditoria.js';
import {
  assertRevisaoCatalogo,
  avancarRevisaoCatalogo,
  incrementarRevisaoCatalogo,
} from './catalogoRevisao.js';
import {
  exigirAssetPublicado,
  exigirCategoriaDoTipo,
  exigirTipoAtivo,
} from './catalogoValidacao.js';

const ESTADOS_PUBLICADOS = ['publicado'];

const prisma = () => getPrismaClient();

export const obterManifesto = async () => {
  const meta = await prisma().catalogoMeta.findUnique({ where: { chave: 'global' } });
  const revisao = meta?.revisao ?? 0;
  return { revisao, etag: `"catalogo-${revisao}"` };
};

/** @param {{ tipo_id?: string }} [filtro] */
export const listarCategoriasPublicadas = async (filtro = {}) => {
  const tipo_id = filtro.tipo_id;
  return prisma().catalogoCategoriaVisual.findMany({
    where: { ativo: true, ...(tipo_id ? { tipo_id } : {}) },
    orderBy: [{ ordem: 'asc' }, { codigo: 'asc' }],
    select: { id: true, tipo_id: true, codigo: true, nome: true, ordem: true },
  });
};

export const listarTiposPublicados = async () =>
  prisma().catalogoTipoEntidade.findMany({
    where: { ativo: true },
    orderBy: [{ ordem: 'asc' }, { codigo: 'asc' }],
    select: { id: true, codigo: true, nome: true, ordem: true },
  });

export const listarIconesPublicados = async () => {
  const icones = await prisma().catalogoIcone.findMany({
    where: { ativo: true, estado: { in: ESTADOS_PUBLICADOS } },
    orderBy: [{ tipo_id: 'asc' }, { categoria_id: 'asc' }],
    include: {
      assetPrincipal: true,
      assetSubicone: true,
    },
  });

  return icones.map((i) => ({
    id: i.id,
    tipo_id: i.tipo_id,
    categoria_id: i.categoria_id,
    cor_fallback: i.cor_fallback,
    revisao: i.revisao,
    asset_principal_id: i.asset_principal_id,
    asset_subicone_id: i.asset_subicone_id,
    asset_principal_url: urlPublicaAssetCatalogo(i.assetPrincipal),
    asset_subicone_url: urlPublicaAssetCatalogo(i.assetSubicone),
  }));
};

export const listarRegrasMistoPublicadas = async () => {
  const regras = await prisma().catalogoRegraMisto.findMany({
    where: { ativo: true, estado: { in: ESTADOS_PUBLICADOS } },
    orderBy: [{ prioridade: 'desc' }, { especificidade: 'desc' }, { id: 'asc' }],
    include: {
      categorias: { orderBy: { ordem: 'asc' }, select: { categoria_id: true, ordem: true } },
    },
  });
  return regras.map((r) => ({
    id: r.id,
    tipo_id: r.tipo_id,
    icone_id: r.icone_id,
    prioridade: r.prioridade,
    especificidade: r.especificidade,
    categoria_ids: r.categorias.map((c) => c.categoria_id),
  }));
};

export const criarTipo = async ({ dados, revisaoEsperada, operador, requestId }) => {
  const criado = await prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    const tipo = await tx.catalogoTipoEntidade.create({
      data: {
        codigo: dados.codigo.trim(),
        nome: dados.nome.trim(),
        ordem: dados.ordem ?? 0,
        ativo: dados.ativo ?? true,
      },
    });
    await incrementarRevisaoCatalogo(tx);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id,
      acao: 'criar',
      entidade: 'CatalogoTipoEntidade',
      entidadeId: tipo.id,
      dados: { codigo: tipo.codigo },
      requestId,
      },
      tx
    );
    return tipo;
  });
  return criado;
};

export const atualizarTipo = async ({ id, dados, revisaoEsperada, operador, requestId }) => {
  const atualizado = await prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    const tipo = await tx.catalogoTipoEntidade.update({
      where: { id },
      data: {
        ...(dados.nome !== undefined ? { nome: dados.nome.trim() } : {}),
        ...(dados.ordem !== undefined ? { ordem: dados.ordem } : {}),
        ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
      },
    });
    await incrementarRevisaoCatalogo(tx);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id,
      acao: 'atualizar',
      entidade: 'CatalogoTipoEntidade',
      entidadeId: id,
      dados,
      requestId,
      },
      tx
    );
    return tipo;
  });
  return atualizado;
};

export const criarCategoria = async ({ dados, revisaoEsperada, operador, requestId }) => {
  await exigirTipoAtivo(prisma(), dados.tipo_id);

  const criada = await prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    const cat = await tx.catalogoCategoriaVisual.create({
      data: {
        tipo_id: dados.tipo_id,
        codigo: dados.codigo.trim(),
        nome: dados.nome.trim(),
        ordem: dados.ordem ?? 0,
        ativo: dados.ativo ?? true,
      },
    });
    await incrementarRevisaoCatalogo(tx);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id,
      acao: 'criar',
      entidade: 'CatalogoCategoriaVisual',
      entidadeId: cat.id,
      dados: { codigo: cat.codigo, tipo_id: cat.tipo_id },
      requestId,
      },
      tx
    );
    return cat;
  });
  return criada;
};

/**
 * Compensa o objeto gravado por uma tentativa de `registrarAsset` que falhou.
 *
 * Só remove quando o banco confirma que NENHUM asset referencia o objeto. Se
 * o resultado do commit é incerto (ex.: conexão caiu no COMMIT) ou a própria
 * verificação falha, o objeto fica — órfão é recuperável, link quebrado não.
 * Todo desfecho diferente de "removido" vira evento `catalogo_asset_orfao`
 * no log, com o path para limpeza manual (ver relatório R2).
 *
 * Nunca lança: o erro original da operação é o que o chamador recebe.
 *
 * @param {object} p
 * @param {{ catalogoAsset: { findFirst: Function } }} p.client
 * @param {import('./catalogoAssetStorage.js').ArmazenamentoCatalogo} p.storage
 * @param {string} p.storagePath
 * @param {string} p.requestId
 * @returns {Promise<'removido' | 'referenciado' | 'mantido_incerto' | 'falha_remocao'>}
 */
export const compensarObjetoAssetCatalogo = async ({ client, storage, storagePath, requestId }) => {
  const reportar = (desfecho, extra = {}) => {
    console.warn(
      JSON.stringify({
        evento: 'catalogo_asset_orfao',
        desfecho,
        storage_path: storagePath,
        request_id: requestId,
        ...extra,
      })
    );
    return desfecho;
  };

  let referenciado;
  try {
    referenciado = await client.catalogoAsset.findFirst({
      where: { storage_path: storagePath },
      select: { id: true },
    });
  } catch (erro) {
    return reportar('mantido_incerto', { motivo: erro?.code ?? erro?.name ?? 'erro' });
  }
  if (referenciado) return reportar('referenciado', { asset_id: referenciado.id });

  try {
    await storage.remover(storagePath);
    return 'removido';
  } catch (erro) {
    return reportar('falha_remocao', { motivo: erro?.code ?? erro?.name ?? 'erro' });
  }
};

/**
 * Registra um asset do catálogo (R2 — integridade transacional).
 *
 *  1. Lê a revisão (CAS) e o dedupe `(sha256, revisao)` fora de transação.
 *  2. Grava o objeto num path exclusivo desta tentativa — sem transação aberta
 *     durante a rede.
 *  3. Numa única transação: revalida revisão e dedupe, cria o asset, grava a
 *     auditoria e avança a revisão com CAS. Tudo ou nada.
 *  4. Falhou depois do upload: compensa o objeto, só se nada o referencia.
 */
export const registrarAsset = async ({ buffer, mimeDeclarado, revisaoEsperada, operador, requestId }) => {
  const metaValidacao = validarBufferAssetCatalogo(buffer, mimeDeclarado);
  const storage = exigirArmazenamentoCatalogoAoVivo();
  const extensao = extensaoDeMime(metaValidacao.mime);

  const revisaoCatalogo = await assertRevisaoCatalogo(prisma(), revisaoEsperada);
  const existente = await prisma().catalogoAsset.findFirst({
    where: { sha256: metaValidacao.sha256, revisao: revisaoCatalogo },
  });
  if (existente) {
    // Dedupe: nada foi gravado nem alterado, então nada é auditado.
    return { ...existente, public_url: urlPublicaAssetCatalogo(existente) ?? null };
  }

  const assetId = novoIdentificadorAsset();
  const upload = await storage.gravar({
    buffer,
    sha256: metaValidacao.sha256,
    revisao: revisaoCatalogo,
    extensao,
    idObjeto: assetId,
  });

  try {
    const registro = await prisma().$transaction(async (tx) => {
      await assertRevisaoCatalogo(tx, revisaoCatalogo);
      const asset = await tx.catalogoAsset.create({
        data: {
          id: assetId,
          bucket: upload.bucket,
          storage_path: upload.storage_path,
          mime: metaValidacao.mime,
          bytes: metaValidacao.bytes,
          sha256: metaValidacao.sha256,
          largura: metaValidacao.largura,
          altura: metaValidacao.altura,
          revisao: revisaoCatalogo,
          estado: 'publicado',
        },
      });
      await registrarAuditoriaCatalogo(
        {
          operadorId: operador.id,
          acao: 'registrar_asset',
          entidade: 'CatalogoAsset',
          entidadeId: asset.id,
          dados: { storage_path: asset.storage_path, mime: asset.mime },
          requestId,
        },
        tx
      );
      await avancarRevisaoCatalogo(tx, revisaoCatalogo);
      return asset;
    });
    return { ...registro, public_url: upload.publicUrl ?? urlPublicaAssetCatalogo(registro) ?? null };
  } catch (erro) {
    await compensarObjetoAssetCatalogo({
      client: prisma(),
      storage,
      storagePath: upload.storage_path,
      requestId,
    });
    throw erro;
  }
};

export const criarIcone = async ({ dados, revisaoEsperada, operador, requestId }) => {
  await exigirTipoAtivo(prisma(), dados.tipo_id);
  await exigirCategoriaDoTipo(prisma(), dados.tipo_id, dados.categoria_id);
  await exigirAssetPublicado(prisma(), dados.asset_principal_id, 'asset principal');
  await exigirAssetPublicado(prisma(), dados.asset_subicone_id, 'subícone');

  const criado = await prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    const icone = await tx.catalogoIcone.create({
      data: {
        tipo_id: dados.tipo_id,
        categoria_id: dados.categoria_id,
        asset_principal_id: dados.asset_principal_id ?? null,
        asset_subicone_id: dados.asset_subicone_id ?? null,
        cor_fallback: dados.cor_fallback ?? null,
        estado: 'rascunho',
        ativo: true,
      },
    });
    await incrementarRevisaoCatalogo(tx);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id,
      acao: 'criar',
      entidade: 'CatalogoIcone',
      entidadeId: icone.id,
      dados: { tipo_id: icone.tipo_id, categoria_id: icone.categoria_id },
      requestId,
      },
      tx
    );
    return icone;
  });
  return criado;
};

export const atualizarIcone = async ({ id, dados, revisaoEsperada, operador, requestId }) => {
  const atualizado = await prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    const icone = await tx.catalogoIcone.findUnique({ where: { id } });
    if (!icone) throw catalogoGlobalNotFound('ícone não encontrado');

    if (dados.asset_principal_id !== undefined) {
      await exigirAssetPublicado(tx, dados.asset_principal_id, 'asset principal');
    }
    if (dados.asset_subicone_id !== undefined) {
      await exigirAssetPublicado(tx, dados.asset_subicone_id, 'subícone');
    }

    const iconeAtualizado = await tx.catalogoIcone.update({
      where: { id },
      data: {
        ...(dados.asset_principal_id !== undefined
          ? { asset_principal_id: dados.asset_principal_id }
          : {}),
        ...(dados.asset_subicone_id !== undefined ? { asset_subicone_id: dados.asset_subicone_id } : {}),
        ...(dados.cor_fallback !== undefined ? { cor_fallback: dados.cor_fallback } : {}),
        revisao: { increment: 1 },
      },
    });

    if (
      icone.estado === 'publicado' &&
      (dados.asset_principal_id !== undefined ||
        dados.asset_subicone_id !== undefined ||
        dados.cor_fallback !== undefined)
    ) {
      await validarIconePublicavel(id, tx);
    }

    await incrementarRevisaoCatalogo(tx);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id,
      acao: 'atualizar',
      entidade: 'CatalogoIcone',
      entidadeId: id,
      dados,
      requestId,
      },
      tx
    );
    return iconeAtualizado;
  });
  return atualizado;
};

const validarIconePublicavel = async (iconeId, tx) => {
  const icone = await tx.catalogoIcone.findUnique({
    where: { id: iconeId },
    include: { assetPrincipal: true, assetSubicone: true },
  });
  if (!icone) throw catalogoGlobalNotFound('ícone não encontrado');
  if (!icone.asset_principal_id || !icone.assetPrincipal) {
    throw catalogoGlobalInvalid('ícone sem asset principal publicado');
  }
  if (icone.assetPrincipal.estado !== 'publicado') {
    throw catalogoGlobalInvalid('asset principal não está publicado');
  }
  if (icone.asset_subicone_id) {
    if (!icone.assetSubicone || icone.assetSubicone.estado !== 'publicado') {
      throw catalogoGlobalInvalid('subícone não está publicado');
    }
  }
  return icone;
};

export const publicarIcone = async ({ id, revisaoEsperada, operador, requestId }) => {
  const publicado = await prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    await validarIconePublicavel(id, tx);
    const icone = await tx.catalogoIcone.update({
      where: { id },
      data: { estado: 'publicado', revisao: { increment: 1 } },
    });
    await incrementarRevisaoCatalogo(tx);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id,
      acao: 'publicar',
      entidade: 'CatalogoIcone',
      entidadeId: id,
      dados: null,
      requestId,
      },
      tx
    );
    return icone;
  });
  return publicado;
};

export const desativarIcone = async ({ id, revisaoEsperada, operador, requestId }) => {
  const atualizado = await prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    const icone = await tx.catalogoIcone.update({
      where: { id },
      data: { ativo: false, estado: 'inativo' },
    });
    await incrementarRevisaoCatalogo(tx);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id,
      acao: 'desativar',
      entidade: 'CatalogoIcone',
      entidadeId: id,
      dados: null,
      requestId,
      },
      tx
    );
    return icone;
  });
  return atualizado;
};

const normalizarCategoriaIdsMisto = (ids) => [...new Set(ids)].sort();

export const criarRegraMisto = async ({ dados, revisaoEsperada, operador, requestId }) => {
  const ids = normalizarCategoriaIdsMisto(dados.categoria_ids ?? []);
  if (ids.length < 2) throw catalogoGlobalInvalid('regra MISTO exige ao menos duas categorias');

  await exigirTipoAtivo(prisma(), dados.tipo_id);

  const categorias = await prisma().catalogoCategoriaVisual.findMany({
    where: { id: { in: ids } },
  });
  if (categorias.length !== ids.length) throw catalogoGlobalInvalid('categoria inexistente');
  if (categorias.some((c) => c.tipo_id !== dados.tipo_id)) {
    throw catalogoGlobalInvalid('categoria incompatível com o tipo da regra');
  }

  const icone = await prisma().catalogoIcone.findUnique({ where: { id: dados.icone_id } });
  if (!icone) throw catalogoGlobalNotFound('ícone não encontrado');
  if (icone.tipo_id !== dados.tipo_id) {
    throw catalogoGlobalInvalid('ícone incompatível com o tipo da regra MISTO');
  }

  const criada = await prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    const regra = await tx.catalogoRegraMisto.create({
      data: {
        tipo_id: dados.tipo_id,
        icone_id: dados.icone_id,
        prioridade: dados.prioridade ?? 0,
        especificidade: ids.length,
        estado: 'rascunho',
        ativo: true,
        categorias: {
          create: ids.map((categoria_id, ordem) => ({ categoria_id, ordem })),
        },
      },
      include: { categorias: true },
    });
    await incrementarRevisaoCatalogo(tx);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id,
      acao: 'criar',
      entidade: 'CatalogoRegraMisto',
      entidadeId: regra.id,
      dados: { categoria_ids: ids },
      requestId,
      },
      tx
    );
    return regra;
  });
  return criada;
};

export const publicarRegraMisto = async ({ id, revisaoEsperada, operador, requestId }) => {
  const publicada = await prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    const regra = await tx.catalogoRegraMisto.findUnique({
      where: { id },
      include: { categorias: true, icone: true },
    });
    if (!regra) throw catalogoGlobalNotFound('regra MISTO não encontrada');
    if (regra.categorias.length < 2) throw catalogoGlobalInvalid('regra MISTO incompleta');
    if (regra.icone.tipo_id !== regra.tipo_id) {
      throw catalogoGlobalInvalid('ícone incompatível com o tipo da regra MISTO');
    }
    await validarIconePublicavel(regra.icone_id, tx);
    const atualizada = await tx.catalogoRegraMisto.update({
      where: { id },
      data: { estado: 'publicado' },
    });
    await incrementarRevisaoCatalogo(tx);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id,
      acao: 'publicar',
      entidade: 'CatalogoRegraMisto',
      entidadeId: id,
      dados: null,
      requestId,
      },
      tx
    );
    return atualizada;
  });
  return publicada;
};
