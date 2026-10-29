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
import { assertRevisaoCatalogo, incrementarRevisaoCatalogo } from './catalogoRevisao.js';
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

export const registrarAsset = async ({ buffer, mimeDeclarado, revisaoEsperada, operador, requestId }) => {
  const metaValidacao = validarBufferAssetCatalogo(buffer, mimeDeclarado);
  const storage = exigirArmazenamentoCatalogoAoVivo();
  const extensao = extensaoDeMime(metaValidacao.mime);

  /** @type {import('./catalogoAssetStorage.js').ResultadoUpload | undefined} */
  let uploadResult;

  try {
    const { registro, upload } = await prisma().$transaction(async (tx) => {
      const revisaoCatalogo = await assertRevisaoCatalogo(tx, revisaoEsperada);

      const existente = await tx.catalogoAsset.findFirst({
        where: { sha256: metaValidacao.sha256, revisao: revisaoCatalogo },
      });
      if (existente) {
        return { registro: existente, upload: null };
      }

      uploadResult = await storage.gravar({
        buffer,
        sha256: metaValidacao.sha256,
        revisao: revisaoCatalogo,
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
          revisao: revisaoCatalogo,
          estado: 'publicado',
        },
      });
      await incrementarRevisaoCatalogo(tx);
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

    const public_url =
      upload?.publicUrl ?? urlPublicaAssetCatalogo(registro) ?? null;
    return { ...registro, public_url };
  } catch (erro) {
    if (uploadResult?.storage_path) {
      await storage.remover(uploadResult.storage_path).catch(() => {});
    }
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
    return iconeAtualizado;
  });

  await registrarAuditoriaCatalogo({
    operadorId: operador.id,
    acao: 'atualizar',
    entidade: 'CatalogoIcone',
    entidadeId: id,
    dados,
    requestId,
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

export const desativarIcone = async ({ id, revisaoEsperada, operador, requestId }) => {
  const atualizado = await prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    const icone = await tx.catalogoIcone.update({
      where: { id },
      data: { ativo: false, estado: 'inativo' },
    });
    await incrementarRevisaoCatalogo(tx);
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
