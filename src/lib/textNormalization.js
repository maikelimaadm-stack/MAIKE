function normalizeWhitespace(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function toTitleCase(value = "") {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function capitalizeFirst(value = "") {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : normalized;
}

function shouldSkipStorageNormalization(key = "") {
  return /(^id$|_id$|_ids$|url|uri|token|secret|file_|coordenadas)/i.test(key);
}

function shouldKeepDisplayAsIs(key = "") {
  return /(^id$|_id$|_ids$|url|uri|token|secret|file_|coordenadas|email)/i.test(key);
}

function shouldUppercaseDisplay(key = "") {
  return /(sigla|codigo|cpf|cnpj|rg|cep|cfop|gta|placa|renavam|chassi|nfe|uf$|estado$)/i.test(key);
}

function shouldCapitalizeStatus(key = "") {
  return /(status)/i.test(key);
}

function shouldTitleCaseDisplay(key = "") {
  return /(nome|titulo|apelido|razao_social|cidade|categoria|subcategoria|responsavel|cliente_nome|fornecedor_nome|produto_nome|safra_nome|grupo_nome|setor_nome|area_nome|lote_nome|maquina_nome|implemento_nome|nome_ponto|tipo$|tipo_|motivo|origem|destino)/i.test(key);
}

export function normalizeDataForStorage(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDataForStorage(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, normalizeDataForStorage(entryValue, entryKey)])
    );
  }

  if (typeof value !== "string") return value;

  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return "";
  if (shouldSkipStorageNormalization(key)) return trimmed;
  return trimmed.toLowerCase();
}

export function formatDataForDisplay(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((item) => formatDataForDisplay(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, formatDataForDisplay(entryValue, entryKey)])
    );
  }

  if (typeof value !== "string") return value;

  const normalized = normalizeWhitespace(value);
  if (!normalized) return "";
  if (shouldKeepDisplayAsIs(key)) return normalized;
  if (shouldUppercaseDisplay(key)) return normalized.toUpperCase();
  if (shouldCapitalizeStatus(key)) return capitalizeFirst(normalized);
  if (shouldTitleCaseDisplay(key)) return toTitleCase(normalized);
  return normalized;
}

function wrapAsyncResult(fn, transformInput, transformOutput) {
  return async (...args) => {
    const nextArgs = transformInput ? transformInput(args) : args;
    const result = await fn(...nextArgs);
    return transformOutput ? transformOutput(result) : result;
  };
}

export function installTextNormalization(base44Client) {
  Object.values(base44Client.entities || {}).forEach((entityApi) => {
    if (!entityApi || entityApi.__textNormalizationApplied) return;

    if (typeof entityApi.create === "function") {
      const original = entityApi.create.bind(entityApi);
      entityApi.create = wrapAsyncResult(
        original,
        (args) => [normalizeDataForStorage(args[0])],
        (result) => formatDataForDisplay(result)
      );
    }

    if (typeof entityApi.update === "function") {
      const original = entityApi.update.bind(entityApi);
      entityApi.update = wrapAsyncResult(
        original,
        (args) => [args[0], normalizeDataForStorage(args[1])],
        (result) => formatDataForDisplay(result)
      );
    }

    if (typeof entityApi.bulkCreate === "function") {
      const original = entityApi.bulkCreate.bind(entityApi);
      entityApi.bulkCreate = wrapAsyncResult(
        original,
        (args) => [normalizeDataForStorage(args[0])],
        (result) => formatDataForDisplay(result)
      );
    }

    if (typeof entityApi.list === "function") {
      const original = entityApi.list.bind(entityApi);
      entityApi.list = wrapAsyncResult(original, null, (result) => formatDataForDisplay(result));
    }

    if (typeof entityApi.filter === "function") {
      const original = entityApi.filter.bind(entityApi);
      entityApi.filter = wrapAsyncResult(original, null, (result) => formatDataForDisplay(result));
    }

    if (typeof entityApi.get === "function") {
      const original = entityApi.get.bind(entityApi);
      entityApi.get = wrapAsyncResult(original, null, (result) => formatDataForDisplay(result));
    }

    if (typeof entityApi.subscribe === "function") {
      const original = entityApi.subscribe.bind(entityApi);
      entityApi.subscribe = (callback, ...args) => {
        return original((event) => {
          callback({
            ...event,
            data: formatDataForDisplay(event?.data),
            old_data: formatDataForDisplay(event?.old_data),
          });
        }, ...args);
      };
    }

    entityApi.__textNormalizationApplied = true;
  });

  if (base44Client.auth && !base44Client.auth.__textNormalizationApplied) {
    if (typeof base44Client.auth.me === "function") {
      const original = base44Client.auth.me.bind(base44Client.auth);
      base44Client.auth.me = wrapAsyncResult(original, null, (result) => formatDataForDisplay(result));
    }

    if (typeof base44Client.auth.updateMe === "function") {
      const original = base44Client.auth.updateMe.bind(base44Client.auth);
      base44Client.auth.updateMe = wrapAsyncResult(
        original,
        (args) => [normalizeDataForStorage(args[0])],
        (result) => formatDataForDisplay(result)
      );
    }

    base44Client.auth.__textNormalizationApplied = true;
  }
}