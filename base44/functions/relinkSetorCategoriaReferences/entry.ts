import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function isRateLimitError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('429') || message.includes('rate limit');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateWithRetry(entityApi, id, patch) {
  let lastError = null;

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      await entityApi.update(id, patch);
      await sleep(120);
      return;
    } catch (error) {
      lastError = error;
      const isRateLimit = isRateLimitError(error);

      if (!isRateLimit || attempt === 8) {
        throw error;
      }

      await sleep(900 * attempt + Math.floor(Math.random() * 300));
    }
  }

  throw lastError;
}

function buildUniqueMap(records, getKeys) {
  const buckets = new Map();

  for (const record of records) {
    const keys = getKeys(record).filter(Boolean);
    for (const key of keys) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(record);
    }
  }

  const uniqueMap = new Map();
  for (const [key, matches] of buckets.entries()) {
    if (matches.length === 1) uniqueMap.set(key, matches[0]);
  }

  return uniqueMap;
}

function sameEmpresa(record, empresaId) {
  if (!empresaId) return true;
  if (!record?.empresa_id) return true;
  return record.empresa_id === empresaId;
}

function pushPatchIfChanged(patch, field, nextValue, currentValue) {
  if (nextValue === undefined) return;
  if (currentValue === nextValue) return;
  patch[field] = nextValue;
}

async function relinkSetores(base44, empresaId, maxUpdates, entityTargets = null) {
  let haltedDueToRateLimit = false;
  const setorApi = base44.asServiceRole.entities.Setor;
  const targetConfigs = [
    { entity: 'AreaPastagem', links: [{ idField: 'setor_id', nameField: 'setor_nome' }] },
    { entity: 'PontoSuplementacao', links: [{ idField: 'setor_id', nameField: 'setor_nome' }] },
    { entity: 'Lote', links: [{ idField: 'setor_id', nameField: 'setor_nome' }] },
    { entity: 'ControleArea', links: [{ idField: 'setor_id', nameField: 'setor_nome' }] },
    { entity: 'OperacaoAgricola', links: [{ idField: 'setor_id', nameField: 'setor_nome' }] },
    {
      entity: 'MovimentacaoMapa',
      links: [
        { idField: 'setor_id', nameField: 'setor_nome' },
        { idField: 'setor_origem_id', nameField: 'setor_origem_nome', transferField: 'transferencia_origem' },
        { idField: 'setor_destino_id', nameField: 'setor_destino_nome', transferField: 'transferencia_destino' },
      ],
    },
    {
      entity: 'MovimentacaoPecuaria',
      links: [
        { idField: 'setor_id', nameField: 'setor_nome' },
        { idField: 'setor_origem_id', nameField: 'setor_origem_nome', transferField: 'transferencia_origem' },
        { idField: 'setor_destino_id', nameField: 'setor_destino_nome', transferField: 'transferencia_destino' },
      ],
    },
  ];

  const filteredConfigs = entityTargets?.size
    ? targetConfigs.filter((config) => entityTargets.has(config.entity))
    : targetConfigs;

  const setores = empresaId
    ? await setorApi.filter({ empresa_id: empresaId }, '-created_date', 5000)
    : await setorApi.list('-created_date', 5000);

  const setoresEmpresa = setores.filter((item) => sameEmpresa(item, empresaId));
  const setorById = new Map(setoresEmpresa.map((setor) => [setor.id, setor]));
  const setorByName = buildUniqueMap(setoresEmpresa, (setor) => [normalizeValue(setor?.nome)]);

  let updated = 0;
  const results = [];

  for (const config of filteredConfigs) {
    const entityApi = base44.asServiceRole.entities[config.entity];
    if (!entityApi) continue;

    const records = empresaId
      ? await entityApi.filter({ empresa_id: empresaId }, '-created_date', 5000)
      : await entityApi.list('-created_date', 5000);

    let entityUpdated = 0;

    for (const record of records) {
      if (!sameEmpresa(record, empresaId)) continue;
      const patch = {};

      for (const link of config.links) {
        const nameKey = normalizeValue(record?.[link.nameField]);
        const matchedSetor = setorById.get(record?.[link.idField]) || setorByName.get(nameKey);
        if (!matchedSetor) continue;

        pushPatchIfChanged(patch, link.idField, matchedSetor.id, record?.[link.idField] ?? null);
        pushPatchIfChanged(patch, link.nameField, matchedSetor.nome, record?.[link.nameField] ?? null);

        if (link.transferField && record?.[link.transferField] !== undefined) {
          pushPatchIfChanged(patch, link.transferField, matchedSetor.nome, record?.[link.transferField] ?? null);
        }
      }

      if (!Object.keys(patch).length) continue;
      if (updated >= maxUpdates) continue;

      try {
        await updateWithRetry(entityApi, record.id, patch);
        updated += 1;
        entityUpdated += 1;
      } catch (error) {
        if (isRateLimitError(error)) {
          haltedDueToRateLimit = true;
          break;
        }
        throw error;
      }
    }

    results.push({ entity: config.entity, updated_count: entityUpdated });
    if (haltedDueToRateLimit || updated >= maxUpdates) break;
    await sleep(500);
  }

  return { updated, results, halted_due_to_rate_limit: haltedDueToRateLimit };
}

async function relinkCategorias(base44, empresaId, maxUpdates, currentUpdated, entityTargets = null) {
  let haltedDueToRateLimit = false;
  const categoriaApi = base44.asServiceRole.entities.CategoriaManejo;
  const targetConfigs = [
    {
      entity: 'Lote',
      links: [
        {
          idField: 'categoria_manejo_id',
          nameField: 'categoria_manejo_nome',
          oficialField: 'categoria',
        },
        {
          idField: 'categoria_manejo_entrada_id',
          nameField: 'categoria_manejo_entrada_nome',
          oficialField: 'categoria_entrada',
        },
      ],
    },
    {
      entity: 'MovimentacaoPecuaria',
      normalizeFields: ['categoria_animal', 'categoria_nova', 'transferencia_origem', 'transferencia_destino'],
    },
    {
      entity: 'ManejoTecnicoRebanho',
      normalizeFields: ['categoria'],
    },
    {
      entity: 'FatorConsumoCategoria',
      normalizeFields: ['categoria'],
    },
    {
      entity: 'SuplementacaoLote',
      normalizeFields: ['categoria'],
    },
  ];

  const filteredConfigs = entityTargets?.size
    ? targetConfigs.filter((config) => entityTargets.has(config.entity))
    : targetConfigs;

  const categorias = empresaId
    ? await categoriaApi.filter({ empresa_id: empresaId }, '-created_date', 5000)
    : await categoriaApi.list('-created_date', 5000);

  const categoriasEmpresa = categorias.filter((item) => sameEmpresa(item, empresaId));
  const categoriaById = new Map(categoriasEmpresa.map((categoria) => [categoria.id, categoria]));
  const categoriaByAlias = buildUniqueMap(categoriasEmpresa, (categoria) => [
    normalizeValue(categoria?.nome),
    normalizeValue(categoria?.categoria_oficial),
  ]);

  let updated = currentUpdated;
  const results = [];

  for (const config of filteredConfigs) {
    const entityApi = base44.asServiceRole.entities[config.entity];
    if (!entityApi) continue;

    const records = empresaId
      ? await entityApi.filter({ empresa_id: empresaId }, '-created_date', 5000)
      : await entityApi.list('-created_date', 5000);

    let entityUpdated = 0;

    for (const record of records) {
      if (!sameEmpresa(record, empresaId)) continue;
      const patch = {};

      for (const link of config.links || []) {
        const keyFromName = normalizeValue(record?.[link.nameField]);
        const keyFromOficial = normalizeValue(record?.[link.oficialField]);
        const matchedCategoria = categoriaById.get(record?.[link.idField]) || categoriaByAlias.get(keyFromName) || categoriaByAlias.get(keyFromOficial);
        if (!matchedCategoria) continue;

        pushPatchIfChanged(patch, link.idField, matchedCategoria.id, record?.[link.idField] ?? null);
        pushPatchIfChanged(patch, link.nameField, matchedCategoria.nome || null, record?.[link.nameField] ?? null);

        if (link.oficialField && matchedCategoria.categoria_oficial) {
          pushPatchIfChanged(patch, link.oficialField, matchedCategoria.categoria_oficial, record?.[link.oficialField] ?? null);
        }
      }

      for (const field of config.normalizeFields || []) {
        const currentValue = record?.[field];
        const matchedCategoria = categoriaByAlias.get(normalizeValue(currentValue));
        if (!matchedCategoria || !currentValue) continue;
        pushPatchIfChanged(patch, field, matchedCategoria.nome || currentValue, currentValue);
      }

      if (!Object.keys(patch).length) continue;
      if (updated >= maxUpdates) continue;

      try {
        await updateWithRetry(entityApi, record.id, patch);
        updated += 1;
        entityUpdated += 1;
      } catch (error) {
        if (isRateLimitError(error)) {
          haltedDueToRateLimit = true;
          break;
        }
        throw error;
      }
    }

    results.push({ entity: config.entity, updated_count: entityUpdated });
    if (haltedDueToRateLimit || updated >= maxUpdates) break;
    await sleep(500);
  }

  return { updated, results, halted_due_to_rate_limit: haltedDueToRateLimit };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const payload = await req.json().catch(() => ({}));
    const empresaId = payload?.empresaId || null;
    const maxUpdates = Number(payload?.maxUpdates || 100);
    const entityTargets = Array.isArray(payload?.entityTargets) && payload.entityTargets.length
      ? new Set(payload.entityTargets)
      : null;

    const setorResult = await relinkSetores(base44, empresaId, maxUpdates, entityTargets);
    const categoriaResult = await relinkCategorias(base44, empresaId, maxUpdates, setorResult.updated, entityTargets);

    return Response.json({
      success: true,
      empresaId,
      maxUpdates,
      total_updated: categoriaResult.updated,
      halted_due_to_rate_limit: Boolean(setorResult.halted_due_to_rate_limit || categoriaResult.halted_due_to_rate_limit),
      setor_results: setorResult.results,
      categoria_results: categoriaResult.results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});