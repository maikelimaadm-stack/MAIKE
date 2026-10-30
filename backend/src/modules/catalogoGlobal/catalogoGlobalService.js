import { getPrismaClient } from '../../database/prismaClient.js';
import { catalogoGlobalInvalid, catalogoGlobalNotFound } from '../../shared/errors/AppError.js';
import { urlPublicaAssetCatalogo } from './catalogoAssetUrls.js';
import { validarBufferAssetCatalogo } from './catalogoAssetValidation.js';
import {
  caminhoObjetoCatalogo,
  exigirArmazenamentoCatalogoAoVivo,
  extensaoDeMime,
  novoIdentificadorAsset,
} from './catalogoAssetStorage.js';
import { registrarAuditoriaCatalogo } from './catalogoAuditoria.js';
import {
  assertRevisaoCatalogo,
  avancarRevisaoCatalogo,
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
    await avancarRevisaoCatalogo(tx, revisaoEsperada);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id ?? null,
      adminId: operador.admin_id ?? null,
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
    await avancarRevisaoCatalogo(tx, revisaoEsperada);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id ?? null,
      adminId: operador.admin_id ?? null,
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
    await avancarRevisaoCatalogo(tx, revisaoEsperada);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id ?? null,
      adminId: operador.admin_id ?? null,
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

/** Edita rótulo, ordem e estado. O `codigo` e o tipo são a identidade lógica: não mudam. */
export const atualizarCategoria = async ({ id, dados, revisaoEsperada, operador, requestId }) =>
  prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    const atual = await tx.catalogoCategoriaVisual.findUnique({ where: { id } });
    if (!atual) throw catalogoGlobalNotFound('categoria não encontrada');
    const cat = await tx.catalogoCategoriaVisual.update({
      where: { id },
      data: {
        ...(dados.nome !== undefined ? { nome: dados.nome.trim() } : {}),
        ...(dados.ordem !== undefined ? { ordem: dados.ordem } : {}),
        ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
      },
    });
    await avancarRevisaoCatalogo(tx, revisaoEsperada);
    await registrarAuditoriaCatalogo(
      {
        operadorId: operador.id ?? null,
        adminId: operador.admin_id ?? null,
        acao: 'atualizar',
        entidade: 'CatalogoCategoriaVisual',
        entidadeId: id,
        dados,
        requestId,
      },
      tx
    );
    return cat;
  });

/**
 * Fases de `registrarAsset`, registradas só no servidor (R3). Decidem o que a
 * compensação pode fazer com segurança:
 *
 *  - `upload_enviado`      gravação sem resposta conclusiva; banco nunca tocado.
 *  - `upload_confirmado`   objeto gravado; transação ainda não aberta.
 *  - `transacao_iniciada`  callback em curso. Se ele rejeita, o Prisma nunca
 *                          envia COMMIT: a transação não pode confirmar.
 *  - `callback_concluido`  callback terminou e o COMMIT foi enviado. Falha
 *                          aqui é AMBÍGUA (queda de conexão após o COMMIT é
 *                          indistinguível de rollback), qualquer que seja o
 *                          erro — não classificamos por código Prisma.
 *  - `commit_confirmado`   `$transaction` resolveu.
 */
const FASES_ASSET = Object.freeze({
  antesUpload: 'antes_upload',
  uploadEnviado: 'upload_enviado',
  uploadConfirmado: 'upload_confirmado',
  transacaoIniciada: 'transacao_iniciada',
  callbackConcluido: 'callback_concluido',
  commitConfirmado: 'commit_confirmado',
});

/** Motivo técnico sanitizado: só código/nome/status, nunca mensagem ou corpo. */
const motivoSanitizado = (erro) => ({
  motivo: erro?.code ?? erro?.name ?? 'erro',
  ...(erro?.details?.status ? { status: erro.details.status } : {}),
});

/**
 * Compensa o objeto de uma tentativa de `registrarAsset` que falhou.
 *
 * Política conservadora: remove só com evidência positiva de que nenhuma
 * transação pode ter confirmado E de que nenhum asset referencia o path. Na
 * dúvida o objeto fica — órfão é recuperável, link quebrado não. Todo
 * desfecho diferente de "removido" limpo vira evento `catalogo_asset_orfao`.
 *
 * Nunca lança: o erro original da operação é o que o chamador recebe.
 *
 * @param {object} p
 * @param {{ catalogoAsset: { findFirst: Function } }} p.client
 * @param {import('./catalogoAssetStorage.js').ArmazenamentoCatalogo} p.storage
 * @param {string} p.storagePath
 * @param {string} p.requestId
 * @param {string} [p.fase] uma de FASES_ASSET; default `transacao_iniciada`
 * @param {unknown} [p.erroOriginal]
 * @returns {Promise<'removido' | 'referenciado' | 'mantido_incerto' | 'falha_remocao' | 'commit_incerto' | 'upload_incerto'>}
 */
export const compensarObjetoAssetCatalogo = async ({
  client,
  storage,
  storagePath,
  requestId,
  fase = FASES_ASSET.transacaoIniciada,
  erroOriginal,
}) => {
  const reportar = (desfecho, extra = {}) => {
    console.warn(
      JSON.stringify({
        evento: 'catalogo_asset_orfao',
        desfecho,
        fase,
        storage_path: storagePath,
        request_id: requestId,
        ...(erroOriginal ? { erro_original: motivoSanitizado(erroOriginal) } : {}),
        ...extra,
      })
    );
    return desfecho;
  };

  // COMMIT enviado e resposta perdida/erro: não há prova de rollback.
  if (fase === FASES_ASSET.callbackConcluido) return reportar('commit_incerto');

  // Upload sem resposta conclusiva. O banco nunca foi tocado e o path é
  // exclusivo desta tentativa (assetId novo): nenhuma linha pode referenciá-lo,
  // então tentar remover é seguro (404 conta como removido). Sempre logado.
  if (fase === FASES_ASSET.uploadEnviado) {
    try {
      await storage.remover(storagePath);
      return reportar('upload_incerto', { remocao: 'removido' });
    } catch (erro) {
      return reportar('upload_incerto', { remocao: 'falhou', ...motivoSanitizado(erro) });
    }
  }

  let referenciado;
  try {
    referenciado = await client.catalogoAsset.findFirst({
      where: { storage_path: storagePath },
      select: { id: true },
    });
  } catch (erro) {
    return reportar('mantido_incerto', motivoSanitizado(erro));
  }
  if (referenciado) return reportar('referenciado', { asset_id: referenciado.id });

  try {
    await storage.remover(storagePath);
    return 'removido';
  } catch (erro) {
    return reportar('falha_remocao', motivoSanitizado(erro));
  }
};

/**
 * Registra um asset do catálogo (R2/R3 — integridade transacional).
 *
 *  1. Lê a revisão (CAS) e o dedupe `(sha256, revisao)` fora de transação.
 *  2. Fixa `assetId` e o path exclusivo da tentativa ANTES da rede; grava o
 *     objeto sem transação aberta.
 *  3. Numa única transação: cria o asset, grava a auditoria e avança a revisão
 *     com CAS estrito (sempre, mesmo sem `revisao_esperada`: o path é versionado
 *     pela revisão lida). Tudo ou nada.
 *  4. Falhou: compensa conforme a fase (ver FASES_ASSET).
 *  5. Corrida de dois uploads idênticos `(sha256, revisao)`: o perdedor recebe a
 *     linha vencedora (mesma semântica do dedupe), sem tocar no objeto dela.
 */
export const registrarAsset = async ({ buffer, mimeDeclarado, revisaoEsperada, operador, requestId }) => {
  const metaValidacao = validarBufferAssetCatalogo(buffer, mimeDeclarado);
  const storage = exigirArmazenamentoCatalogoAoVivo();
  const extensao = extensaoDeMime(metaValidacao.mime);

  const revisaoCatalogo = await assertRevisaoCatalogo(prisma(), revisaoEsperada);
  const dedupe = { sha256: metaValidacao.sha256, revisao: revisaoCatalogo };
  const existente = await prisma().catalogoAsset.findFirst({ where: dedupe });
  if (existente) {
    // Dedupe: nada foi gravado nem alterado, então nada é auditado.
    return { ...existente, public_url: urlPublicaAssetCatalogo(existente) ?? null };
  }

  const assetId = novoIdentificadorAsset();
  const storagePath = caminhoObjetoCatalogo({ ...dedupe, extensao, idObjeto: assetId });
  /** @type {string} */
  let fase = FASES_ASSET.uploadEnviado;

  const compensar = (erroOriginal) =>
    compensarObjetoAssetCatalogo({
      client: prisma(),
      storage,
      storagePath,
      requestId,
      fase,
      erroOriginal,
    });

  let upload;
  try {
    upload = await storage.gravar({ buffer, ...dedupe, extensao, idObjeto: assetId });
  } catch (erro) {
    // Recusa explícita do Storage (resposta 4xx recebida): nada foi gravado.
    if (!erro?.gravacaoRecusada) await compensar(erro);
    throw erro;
  }
  if (upload.storage_path !== storagePath) {
    // Adaptador fora do contrato de caminhoObjetoCatalogo: não confiar no path.
    const erro = new Error('adaptador de Storage devolveu path fora do contrato');
    await compensar(erro);
    throw erro;
  }
  fase = FASES_ASSET.uploadConfirmado;

  try {
    const registro = await prisma().$transaction(async (tx) => {
      fase = FASES_ASSET.transacaoIniciada;
      const asset = await tx.catalogoAsset.create({
        data: {
          id: assetId,
          bucket: upload.bucket,
          storage_path: storagePath,
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
          operadorId: operador.id ?? null,
      adminId: operador.admin_id ?? null,
          acao: 'registrar_asset',
          entidade: 'CatalogoAsset',
          entidadeId: asset.id,
          dados: { storage_path: asset.storage_path, mime: asset.mime },
          requestId,
        },
        tx
      );
      await avancarRevisaoCatalogo(tx, revisaoCatalogo);
      fase = FASES_ASSET.callbackConcluido;
      return asset;
    });
    fase = FASES_ASSET.commitConfirmado;
    return { ...registro, public_url: upload.publicUrl ?? urlPublicaAssetCatalogo(registro) ?? null };
  } catch (erro) {
    await compensar(erro);
    if (erro?.code === 'P2002' && fase === FASES_ASSET.transacaoIniciada) {
      const vencedor = await prisma().catalogoAsset.findFirst({ where: dedupe });
      if (vencedor) return { ...vencedor, public_url: urlPublicaAssetCatalogo(vencedor) ?? null };
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
    await avancarRevisaoCatalogo(tx, revisaoEsperada);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id ?? null,
      adminId: operador.admin_id ?? null,
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

    await avancarRevisaoCatalogo(tx, revisaoEsperada);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id ?? null,
      adminId: operador.admin_id ?? null,
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
      // Republicar um ícone desativado o reativa (mesmo id lógico).
      data: { estado: 'publicado', ativo: true, revisao: { increment: 1 } },
    });
    await avancarRevisaoCatalogo(tx, revisaoEsperada);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id ?? null,
      adminId: operador.admin_id ?? null,
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
    if (!(await tx.catalogoIcone.findUnique({ where: { id } }))) throw catalogoGlobalNotFound('ícone não encontrado');
    const icone = await tx.catalogoIcone.update({
      where: { id },
      data: { ativo: false, estado: 'inativo' },
    });
    await avancarRevisaoCatalogo(tx, revisaoEsperada);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id ?? null,
      adminId: operador.admin_id ?? null,
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

/**
 * Duas regras vivas (rascunho/publicada) do mesmo tipo com o MESMO conjunto
 * de categorias são ambíguas: recusa (D-PROD-70). Empates por sobreposição
 * são apontados em `/admin-maike/catalogo/validacao`, não bloqueiam.
 */
const exigirConjuntoMistoUnico = async (tx, tipoId, ids, excetoId) => {
  const vivas = await tx.catalogoRegraMisto.findMany({
    where: { tipo_id: tipoId, ativo: true, estado: { not: 'inativo' }, ...(excetoId ? { id: { not: excetoId } } : {}) },
    include: { categorias: true },
  });
  const chave = ids.join(',');
  const dup = vivas.find((r) => normalizarCategoriaIdsMisto(r.categorias.map((c) => c.categoria_id)).join(',') === chave);
  if (dup) throw catalogoGlobalInvalid('já existe regra MISTO para este mesmo conjunto de categorias', { regra_id: dup.id });
};

/** Categorias existentes, ativas e do tipo da regra. */
const exigirCategoriasMisto = async (db, tipoId, ids) => {
  if (ids.length < 2) throw catalogoGlobalInvalid('regra MISTO exige ao menos duas categorias');
  const categorias = await db.catalogoCategoriaVisual.findMany({ where: { id: { in: ids } } });
  if (categorias.length !== ids.length) throw catalogoGlobalInvalid('categoria inexistente');
  if (categorias.some((c) => c.tipo_id !== tipoId)) throw catalogoGlobalInvalid('categoria incompatível com o tipo da regra');
  if (categorias.some((c) => !c.ativo)) throw catalogoGlobalInvalid('categoria inativa não entra em regra MISTO');
};

/** O ícone resultado de uma regra publicada precisa estar publicado e ativo. */
const exigirIconeResultadoPublicado = (icone) => {
  if (!icone?.ativo || icone.estado !== 'publicado') {
    throw catalogoGlobalInvalid('o ícone resultado da regra MISTO precisa estar publicado');
  }
};

export const criarRegraMisto = async ({ dados, revisaoEsperada, operador, requestId }) => {
  const ids = normalizarCategoriaIdsMisto(dados.categoria_ids ?? []);
  if (ids.length < 2) throw catalogoGlobalInvalid('regra MISTO exige ao menos duas categorias');

  await exigirTipoAtivo(prisma(), dados.tipo_id);
  await exigirCategoriasMisto(prisma(), dados.tipo_id, ids);

  const icone = await prisma().catalogoIcone.findUnique({ where: { id: dados.icone_id } });
  if (!icone) throw catalogoGlobalNotFound('ícone não encontrado');
  if (icone.tipo_id !== dados.tipo_id) {
    throw catalogoGlobalInvalid('ícone incompatível com o tipo da regra MISTO');
  }

  const criada = await prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    await exigirConjuntoMistoUnico(tx, dados.tipo_id, ids);
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
    await avancarRevisaoCatalogo(tx, revisaoEsperada);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id ?? null,
      adminId: operador.admin_id ?? null,
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
    if (!regra.ativo || regra.estado === 'inativo') throw catalogoGlobalInvalid('regra MISTO desativada');
    exigirIconeResultadoPublicado(regra.icone);
    await validarIconePublicavel(regra.icone_id, tx);
    await exigirConjuntoMistoUnico(
      tx,
      regra.tipo_id,
      normalizarCategoriaIdsMisto(regra.categorias.map((c) => c.categoria_id)),
      regra.id
    );
    const atualizada = await tx.catalogoRegraMisto.update({
      where: { id },
      data: { estado: 'publicado' },
    });
    await avancarRevisaoCatalogo(tx, revisaoEsperada);
    await registrarAuditoriaCatalogo(
      {
      operadorId: operador.id ?? null,
      adminId: operador.admin_id ?? null,
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

/**
 * Edita ícone resultado, prioridade e/ou conjunto de categorias de uma regra
 * MISTO. O id da regra é estável. Se estiver publicada, continua publicada e
 * precisa seguir válida (ícone publicado, sem duplicata).
 */
export const atualizarRegraMisto = async ({ id, dados, revisaoEsperada, operador, requestId }) =>
  prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    const regra = await tx.catalogoRegraMisto.findUnique({ where: { id }, include: { categorias: true } });
    if (!regra) throw catalogoGlobalNotFound('regra MISTO não encontrada');
    if (!regra.ativo || regra.estado === 'inativo') throw catalogoGlobalInvalid('regra MISTO desativada não é editável');

    const ids =
      dados.categoria_ids !== undefined
        ? normalizarCategoriaIdsMisto(dados.categoria_ids)
        : normalizarCategoriaIdsMisto(regra.categorias.map((c) => c.categoria_id));
    await exigirCategoriasMisto(tx, regra.tipo_id, ids);
    await exigirConjuntoMistoUnico(tx, regra.tipo_id, ids, regra.id);

    const iconeId = dados.icone_id ?? regra.icone_id;
    const icone = await tx.catalogoIcone.findUnique({ where: { id: iconeId } });
    if (!icone) throw catalogoGlobalNotFound('ícone não encontrado');
    if (icone.tipo_id !== regra.tipo_id) throw catalogoGlobalInvalid('ícone incompatível com o tipo da regra MISTO');
    if (regra.estado === 'publicado') exigirIconeResultadoPublicado(icone);

    if (dados.categoria_ids !== undefined) {
      await tx.catalogoRegraMistoCategoria.deleteMany({ where: { regra_id: id } });
      await tx.catalogoRegraMistoCategoria.createMany({
        data: ids.map((categoria_id, ordem) => ({ regra_id: id, categoria_id, ordem })),
      });
    }
    const atualizada = await tx.catalogoRegraMisto.update({
      where: { id },
      data: {
        icone_id: iconeId,
        especificidade: ids.length,
        ...(dados.prioridade !== undefined ? { prioridade: dados.prioridade } : {}),
      },
      include: { categorias: true },
    });
    await avancarRevisaoCatalogo(tx, revisaoEsperada);
    await registrarAuditoriaCatalogo(
      {
        operadorId: operador.id ?? null,
        adminId: operador.admin_id ?? null,
        acao: 'atualizar',
        entidade: 'CatalogoRegraMisto',
        entidadeId: id,
        dados: { ...dados, categoria_ids: ids },
        requestId,
      },
      tx
    );
    return atualizada;
  });

/** Soft delete: a regra some da leitura publicada; registro e auditoria ficam. */
export const desativarRegraMisto = async ({ id, revisaoEsperada, operador, requestId }) =>
  prisma().$transaction(async (tx) => {
    await assertRevisaoCatalogo(tx, revisaoEsperada);
    const regra = await tx.catalogoRegraMisto.findUnique({ where: { id } });
    if (!regra) throw catalogoGlobalNotFound('regra MISTO não encontrada');
    const atualizada = await tx.catalogoRegraMisto.update({ where: { id }, data: { ativo: false, estado: 'inativo' } });
    await avancarRevisaoCatalogo(tx, revisaoEsperada);
    await registrarAuditoriaCatalogo(
      {
        operadorId: operador.id ?? null,
        adminId: operador.admin_id ?? null,
        acao: 'desativar',
        entidade: 'CatalogoRegraMisto',
        entidadeId: id,
        dados: null,
        requestId,
      },
      tx
    );
    return atualizada;
  });
