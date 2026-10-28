import { getPrismaClient } from '../../database/prismaClient.js';
import {
  catalogoGlobalInvalid,
  catalogoGlobalNotFound,
  concurrencyConflict,
} from '../../shared/errors/AppError.js';
import { validarBufferAssetCatalogo } from './catalogoAssetValidation.js';
import {
  criarArmazenamentoCatalogo,
  extensaoDeMime,
  novoIdentificadorAsset,
} from './catalogoAssetStorage.js';
import { registrarAuditoriaCatalogo } from './catalogoAuditoria.js';

const ESTADOS_PUBLICADOS = ['publicado'];

const prisma = () => getPrismaClient();

const incrementarRevisao = async (tx) =>
  tx.catalogoMeta.upsert({
    where: { chave: 'global' },
    create: { chave: 'global', revisao: 1 },
    update: { revisao: { increment: 1 } },
  });

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

export const listarIconesPublicados = async () =>
  prisma().catalogoIcone.findMany({
    where: { ativo: true, estado: { in: ESTADOS_PUBLICADOS } },
    orderBy: [{ tipo_id: 'asc' }, { categoria_id: 'asc' }],
    select: {
      id: true,
      tipo_id: true,
      categoria_id: true,
      cor_fallback: true,
      revisao: true,
      asset_principal_id: true,
      asset_subicone_id: true,
    },
  });

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

export const criarTipo = async ({ dados, operador, requestId }) => {
  const criado = await prisma().$transaction(async (tx) => {
    const tipo = await tx.catalogoTipoEntidade.create({
      data: {
        codigo: dados.codigo.trim(),
        nome: dados.nome.trim(),
        ordem: dados.ordem ?? 0,
        ativo: dados.ativo ?? true,
      },
    });
    await incrementarRevisao(tx);
    return tipo;
  });
  await registrarAuditoriaCatalogo({
    operadorId: operador.id,
    acao: 'criar',
    entidade: 'CatalogoTipoEntidade',
    entidadeId: criado.id,
    dados: { codigo: criado.codigo },
    requestId,
  });
  return criado;
};

export const atualizarTipo = async ({ id, dados, revisaoEsperada, operador, requestId }) => {
  const atualizado = await prisma().$transaction(async (tx) => {
    const meta = await tx.catalogoMeta.findUnique({ where: { chave: 'global' } });
    if (revisaoEsperada != null && meta && meta.revisao !== revisaoEsperada) {
      throw concurrencyConflict('revisão do catálogo divergente');
    }
    const tipo = await tx.catalogoTipoEntidade.update({
      where: { id },
      data: {
        ...(dados.nome !== undefined ? { nome: dados.nome.trim() } : {}),
        ...(dados.ordem !== undefined ? { ordem: dados.ordem } : {}),
        ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
      },
    });
    await incrementarRevisao(tx);
    return tipo;
  });
  await registrarAuditoriaCatalogo({
    operadorId: operador.id,
    acao: 'atualizar',
    entidade: 'CatalogoTipoEntidade',
    entidadeId: id,
    dados,
    requestId,
  });
  return atualizado;
};

export const criarCategoria = async ({ dados, operador, requestId }) => {
  const tipo = await prisma().catalogoTipoEntidade.findUnique({ where: { id: dados.tipo_id } });
  if (!tipo) throw catalogoGlobalNotFound('tipo não encontrado');

  const criada = await prisma().$transaction(async (tx) => {
    const cat = await tx.catalogoCategoriaVisual.create({
      data: {
        tipo_id: dados.tipo_id,
        codigo: dados.codigo.trim(),
        nome: dados.nome.trim(),
        ordem: dados.ordem ?? 0,
        ativo: dados.ativo ?? true,
      },
    });
    await incrementarRevisao(tx);
    return cat;
  });
  await registrarAuditoriaCatalogo({
    operadorId: operador.id,
    acao: 'criar',
    entidade: 'CatalogoCategoriaVisual',
    entidadeId: criada.id,
    dados: { codigo: criada.codigo, tipo_id: criada.tipo_id },
    requestId,
  });
  return criada;
};

export const registrarAsset = async ({ buffer, mimeDeclarado, operador, requestId }) => {
  const metaValidacao = validarBufferAssetCatalogo(buffer, mimeDeclarado);
  const storage = criarArmazenamentoCatalogo();
  const revisao = 1;
  const extensao = extensaoDeMime(metaValidacao.mime);

  const { registro, upload } = await prisma().$transaction(async (tx) => {
    const uploadResult = await storage.gravar({
      buffer,
      sha256: metaValidacao.sha256,
      revisao,
      extensao,
    });
    const asset = await tx.catalogoAsset.create({
      data: {
        id: novoIdentificadorAsset(),
        bucket: uploadResult.bucket,
        storage_path: uploadResult.storage_path,
        mime: metaValidacao.mime,
        bytes: metaValidacao.bytes,
        sha256: metaValidacao.sha256,
        largura: metaValidacao.largura,
        altura: metaValidacao.altura,
        revisao,
        estado: 'publicado',
      },
    });
    await incrementarRevisao(tx);
    return { registro: asset, upload: uploadResult };
  });

  await registrarAuditoriaCatalogo({
    operadorId: operador.id,
    acao: 'registrar_asset',
    entidade: 'CatalogoAsset',
    entidadeId: registro.id,
    dados: { storage_path: registro.storage_path, mime: registro.mime },
    requestId,
  });

  return { ...registro, public_url: upload.publicUrl ?? null };
};

export const criarIcone = async ({ dados, operador, requestId }) => {
  const criado = await prisma().$transaction(async (tx) => {
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
    await incrementarRevisao(tx);
    return icone;
  });
  await registrarAuditoriaCatalogo({
    operadorId: operador.id,
    acao: 'criar',
    entidade: 'CatalogoIcone',
    entidadeId: criado.id,
    dados: { tipo_id: criado.tipo_id, categoria_id: criado.categoria_id },
    requestId,
  });
  return criado;
};

const validarIconePublicavel = async (iconeId, tx) => {
  const icone = await tx.catalogoIcone.findUnique({
    where: { id: iconeId },
    include: { assetPrincipal: true },
  });
  if (!icone) throw catalogoGlobalNotFound('ícone não encontrado');
  if (!icone.asset_principal_id || !icone.assetPrincipal) {
    throw catalogoGlobalInvalid('ícone sem asset principal publicado');
  }
  if (icone.assetPrincipal.estado !== 'publicado') {
    throw catalogoGlobalInvalid('asset principal não está publicado');
  }
  return icone;
};

export const publicarIcone = async ({ id, revisaoEsperada, operador, requestId }) => {
  const publicado = await prisma().$transaction(async (tx) => {
    const meta = await tx.catalogoMeta.findUnique({ where: { chave: 'global' } });
    if (revisaoEsperada != null && meta && meta.revisao !== revisaoEsperada) {
      throw concurrencyConflict('revisão do catálogo divergente');
    }
    await validarIconePublicavel(id, tx);
    const icone = await tx.catalogoIcone.update({
      where: { id },
      data: { estado: 'publicado', revisao: { increment: 1 } },
    });
    await incrementarRevisao(tx);
    return icone;
  });
  await registrarAuditoriaCatalogo({
    operadorId: operador.id,
    acao: 'publicar',
    entidade: 'CatalogoIcone',
    entidadeId: id,
    dados: null,
    requestId,
  });
  return publicado;
};

export const desativarIcone = async ({ id, operador, requestId }) => {
  const atualizado = await prisma().$transaction(async (tx) => {
    const icone = await tx.catalogoIcone.update({
      where: { id },
      data: { ativo: false, estado: 'inativo' },
    });
    await incrementarRevisao(tx);
    return icone;
  });
  await registrarAuditoriaCatalogo({
    operadorId: operador.id,
    acao: 'desativar',
    entidade: 'CatalogoIcone',
    entidadeId: id,
    dados: null,
    requestId,
  });
  return atualizado;
};

export const criarRegraMisto = async ({ dados, operador, requestId }) => {
  const ids = dados.categoria_ids ?? [];
  if (ids.length < 2) throw catalogoGlobalInvalid('regra MISTO exige ao menos duas categorias');
  const unicos = new Set(ids);
  if (unicos.size !== ids.length) throw catalogoGlobalInvalid('categorias duplicadas na regra MISTO');

  const categorias = await prisma().catalogoCategoriaVisual.findMany({
    where: { id: { in: ids } },
  });
  if (categorias.length !== ids.length) throw catalogoGlobalInvalid('categoria inexistente');
  if (categorias.some((c) => c.tipo_id !== dados.tipo_id)) {
    throw catalogoGlobalInvalid('categoria incompatível com o tipo da regra');
  }

  const criada = await prisma().$transaction(async (tx) => {
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
    await incrementarRevisao(tx);
    return regra;
  });

  await registrarAuditoriaCatalogo({
    operadorId: operador.id,
    acao: 'criar',
    entidade: 'CatalogoRegraMisto',
    entidadeId: criada.id,
    dados: { categoria_ids: ids },
    requestId,
  });
  return criada;
};

export const publicarRegraMisto = async ({ id, revisaoEsperada, operador, requestId }) => {
  const publicada = await prisma().$transaction(async (tx) => {
    const meta = await tx.catalogoMeta.findUnique({ where: { chave: 'global' } });
    if (revisaoEsperada != null && meta && meta.revisao !== revisaoEsperada) {
      throw concurrencyConflict('revisão do catálogo divergente');
    }
    const regra = await tx.catalogoRegraMisto.findUnique({
      where: { id },
      include: { categorias: true, icone: true },
    });
    if (!regra) throw catalogoGlobalNotFound('regra MISTO não encontrada');
    if (regra.categorias.length < 2) throw catalogoGlobalInvalid('regra MISTO incompleta');
    await validarIconePublicavel(regra.icone_id, tx);
    const atualizada = await tx.catalogoRegraMisto.update({
      where: { id },
      data: { estado: 'publicado' },
    });
    await incrementarRevisao(tx);
    return atualizada;
  });
  await registrarAuditoriaCatalogo({
    operadorId: operador.id,
    acao: 'publicar',
    entidade: 'CatalogoRegraMisto',
    entidadeId: id,
    dados: null,
    requestId,
  });
  return publicada;
};
