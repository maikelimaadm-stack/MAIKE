#!/usr/bin/env node
/**
 * Gate: ModeloBase1 Pecuário — contrato base de persistência e domínio.
 *
 * O contrato vive em `config/modelobase1-pecuario.json` e é o SSOT executável
 * das regras que a P3 vai implementar em Prisma: identidade, tenancy,
 * timestamps, auditoria, numeração, anexos, exclusão, concorrência, vocabulário
 * de erro e padrões proibidos.
 *
 * O gate é **absoluto**: não há `--update`, não há baseline e não há modo de
 * correção. Ele nunca escreve no arquivo — nem quando o arquivo está inválido.
 * Contrato quebrado se conserta no contrato, com revisão humana.
 *
 * Códigos:
 *   P2-MB1-CONTRACT-MISSING · P2-MB1-CONTRACT-INVALID · P2-MB1-CONTRACT-VERSION
 *   P2-MB1-CONTRACT-SHAPE   · P2-MB1-TENANCY          · P2-MB1-IDENTITY
 *   P2-MB1-AUDIT            · P2-MB1-NUMBERING        · P2-MB1-ATTACHMENT
 *   P2-MB1-PROHIBITED       · P2-MB1-HANDOFF
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.MB1_ROOT || process.cwd();
const CONTRATO = process.env.MB1_CONTRACT || 'config/modelobase1-pecuario.json';

// ---------------------------------------------------------------------------
// Constantes do contrato — o que o gate exige, literalmente.
// ---------------------------------------------------------------------------

const VERSAO_EXIGIDA = 1;
const STATUS_EXIGIDO = 'official';
const CONTRACT_ID_EXIGIDO = 'modelobase1-pecuario';
const MEANING_EXIGIDO = 'persistence-domain-contract';
const PRODUCT_SCOPE_EXIGIDO = 'pecuaria-mapa-geral-manejo';

const SECOES_OBRIGATORIAS = [
  'identity',
  'tenancy',
  'timestamps',
  'audit',
  'numbering',
  'attachments',
  'deletion',
  'concurrency',
  'errorCodes',
  'prohibitedPatterns',
  'p3Handoff',
];

const ROOT_MODEL = 'Cliente';
const TENANT_FIELD = 'cliente_id';
const AUTH_CONTEXT = 'auth_context';
const FONTES_DE_REQUEST = ['body', 'query', 'params'];

const ESTRATEGIA_NUMERACAO = 'atomic-database-sequence';
const ESTRATEGIAS_PROIBIDAS = ['max_plus_one', 'count_plus_one'];

const ANEXO_IDENTIDADE = 'storage_key';

const CODIGOS_DE_ERRO_MINIMOS = [
  'TENANT_CONTEXT_REQUIRED',
  'TENANT_SCOPE_VIOLATION',
  'SEQUENCE_SCOPE_INVALID',
  'SEQUENCE_CONFLICT',
  'ATTACHMENT_INVALID',
  'ATTACHMENT_OWNER_INVALID',
  'AUDIT_WRITE_FAILED',
  'CONCURRENCY_CONFLICT',
];

const PADROES_PROIBIDOS_MINIMOS = [
  'tenant_from_request_payload',
  'business_unique_without_tenant',
  'tenant_index_without_tenant_prefix',
  'max_plus_one_numbering',
  'count_plus_one_numbering',
  'provider_url_as_attachment_identity',
  'global_soft_delete_by_default',
  'frontend_timestamp_as_authority',
  'client_supplied_primary_id',
  'base44_contract_in_backend',
];

const HANDOFF_CRIACOES_MINIMAS = [
  'backend/',
  'Fastify',
  'Prisma',
  'PostgreSQL',
  'Cliente',
  'Usuario',
  'AuditLog',
  'EntidadeCodigoSequencia',
  'RegistroAnexo',
];
const HANDOFF_GATES_MINIMOS = ['gate:tenancy', 'gate:indices'];
const HANDOFF_OPERACIONAL_MINIMO = ['health-check', 'migrations-versionadas'];

const AUDIT_CAMPOS_MINIMOS = [
  'id',
  'cliente_id',
  'usuario_id',
  'acao',
  'entidade',
  'entidade_id',
  'dados_anteriores',
  'dados_novos',
  'request_id',
  'createdAt',
];

const SEQUENCIA_CAMPOS_MINIMOS = [
  'id',
  'cliente_id',
  'entidade',
  'escopo_tipo',
  'escopo_id',
  'proximo_valor',
  'createdAt',
  'updatedAt',
];

const ANEXO_CAMPOS_MINIMOS = [
  'id',
  'cliente_id',
  'entidade',
  'entidade_id',
  'nome_original',
  'storage_key',
  'mime_type',
  'tamanho_bytes',
  'criado_por',
  'createdAt',
];

// ---------------------------------------------------------------------------
// Utilidades de verificação
// ---------------------------------------------------------------------------

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push({ codigo, mensagem });

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Nomes de campo declarados numa lista `[{name}]`. */
const nomesDeCampo = (lista) =>
  Array.isArray(lista) ? lista.filter(ehObjeto).map((c) => c.name).filter((n) => typeof n === 'string') : [];

const ausentes = (exigidos, presentes) => exigidos.filter((e) => !presentes.includes(e));

/** Exige que `valor` seja exatamente `esperado`. */
const exigirIgual = (codigo, caminho, valor, esperado) => {
  if (valor !== esperado) {
    registrar(codigo, `${caminho} deve ser ${JSON.stringify(esperado)} — encontrado ${JSON.stringify(valor)}`);
    return false;
  }
  return true;
};

/** Exige que a lista contenha todos os itens obrigatórios. */
const exigirContem = (codigo, caminho, lista, obrigatorios) => {
  if (!Array.isArray(lista)) {
    registrar(codigo, `${caminho} deve ser lista — encontrado ${JSON.stringify(lista)}`);
    return false;
  }
  const faltando = ausentes(obrigatorios, lista);
  if (faltando.length) {
    registrar(codigo, `${caminho} não declara: ${faltando.join(', ')}`);
    return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const caminhoAbsoluto = join(ROOT, CONTRATO);

const reprovar = () => {
  console.error('gate:modelobase1-pecuario — FALHOU\n');
  falhas.forEach((f) => console.error(`  - [${f.codigo}] ${f.mensagem}`));
  console.error(`\n  ${falhas.length} violação(ões) do contrato base pecuário.`);
  console.error('  O gate é absoluto: não existe --update, baseline nem correção automática.');
  process.exit(1);
};

if (!existsSync(caminhoAbsoluto)) {
  registrar('P2-MB1-CONTRACT-MISSING', `contrato ausente: ${CONTRATO}`);
  reprovar();
}

let bruto;
try {
  bruto = readFileSync(caminhoAbsoluto, 'utf8');
} catch (error) {
  registrar('P2-MB1-CONTRACT-INVALID', `não foi possível ler ${CONTRATO}: ${error.message}`);
  reprovar();
}

let contrato;
try {
  contrato = JSON.parse(bruto);
} catch (error) {
  registrar('P2-MB1-CONTRACT-INVALID', `${CONTRATO} não é JSON válido: ${error.message}`);
  reprovar();
}

if (!ehObjeto(contrato)) {
  registrar('P2-MB1-CONTRACT-INVALID', `${CONTRATO} deve ser um objeto JSON na raiz`);
  reprovar();
}

// ---------------------------------------------------------------------------
// 1. Cabeçalho: versão, status e identidade do contrato
// ---------------------------------------------------------------------------

exigirIgual('P2-MB1-CONTRACT-VERSION', 'version', contrato.version, VERSAO_EXIGIDA);
exigirIgual('P2-MB1-CONTRACT-VERSION', 'status', contrato.status, STATUS_EXIGIDO);
exigirIgual('P2-MB1-CONTRACT-SHAPE', 'contractId', contrato.contractId, CONTRACT_ID_EXIGIDO);
exigirIgual('P2-MB1-CONTRACT-SHAPE', 'meaning', contrato.meaning, MEANING_EXIGIDO);
exigirIgual('P2-MB1-CONTRACT-SHAPE', 'productScope', contrato.productScope, PRODUCT_SCOPE_EXIGIDO);

// ---------------------------------------------------------------------------
// 2. Seções obrigatórias
// ---------------------------------------------------------------------------

for (const secao of SECOES_OBRIGATORIAS) {
  const valor = contrato[secao];
  const esperaLista = secao === 'errorCodes' || secao === 'prohibitedPatterns';
  if (valor === undefined) {
    registrar('P2-MB1-CONTRACT-SHAPE', `seção obrigatória ausente: ${secao}`);
    continue;
  }
  if (esperaLista && !Array.isArray(valor)) {
    registrar('P2-MB1-CONTRACT-SHAPE', `seção ${secao} deve ser lista`);
  } else if (!esperaLista && !ehObjeto(valor)) {
    registrar('P2-MB1-CONTRACT-SHAPE', `seção ${secao} deve ser objeto`);
  }
}

const identity = ehObjeto(contrato.identity) ? contrato.identity : {};
const tenancy = ehObjeto(contrato.tenancy) ? contrato.tenancy : {};
const timestamps = ehObjeto(contrato.timestamps) ? contrato.timestamps : {};
const audit = ehObjeto(contrato.audit) ? contrato.audit : {};
const numbering = ehObjeto(contrato.numbering) ? contrato.numbering : {};
const attachments = ehObjeto(contrato.attachments) ? contrato.attachments : {};
const deletion = ehObjeto(contrato.deletion) ? contrato.deletion : {};
const concurrency = ehObjeto(contrato.concurrency) ? contrato.concurrency : {};
const handoff = ehObjeto(contrato.p3Handoff) ? contrato.p3Handoff : {};

// ---------------------------------------------------------------------------
// 3. Identidade
// ---------------------------------------------------------------------------

exigirIgual('P2-MB1-IDENTITY', 'identity.primaryKeyField', identity.primaryKeyField, 'id');
exigirIgual('P2-MB1-IDENTITY', 'identity.logicalType', identity.logicalType, 'String');
exigirIgual('P2-MB1-IDENTITY', 'identity.prismaGenerator', identity.prismaGenerator, 'cuid()');
exigirIgual('P2-MB1-IDENTITY', 'identity.clientSupplied', identity.clientSupplied, false);
exigirIgual('P2-MB1-IDENTITY', 'identity.immutable', identity.immutable, true);
exigirIgual('P2-MB1-IDENTITY', 'identity.parallelUuidField', identity.parallelUuidField, false);
exigirIgual(
  'P2-MB1-IDENTITY',
  'identity.numericGlobalIdAsPrimaryKey',
  identity.numericGlobalIdAsPrimaryKey,
  false
);
if (ehObjeto(identity.businessIdentifiers)) {
  exigirIgual(
    'P2-MB1-IDENTITY',
    'identity.businessIdentifiers.isPrimaryKey',
    identity.businessIdentifiers.isPrimaryKey,
    false
  );
} else {
  registrar('P2-MB1-IDENTITY', 'identity.businessIdentifiers deve ser objeto');
}

// ---------------------------------------------------------------------------
// 4. Tenancy
// ---------------------------------------------------------------------------

exigirIgual('P2-MB1-TENANCY', 'tenancy.rootModel', tenancy.rootModel, ROOT_MODEL);
exigirIgual('P2-MB1-TENANCY', 'tenancy.tenantField', tenancy.tenantField, TENANT_FIELD);
exigirIgual(
  'P2-MB1-TENANCY',
  'tenancy.tenantFieldRequiredOnTenantModels',
  tenancy.tenantFieldRequiredOnTenantModels,
  true
);

// Cliente é a ÚNICA exceção estrutural sem cliente_id.
if (!Array.isArray(tenancy.modelsWithoutTenantField)) {
  registrar('P2-MB1-TENANCY', 'tenancy.modelsWithoutTenantField deve ser lista');
} else {
  const excecoes = tenancy.modelsWithoutTenantField;
  if (excecoes.length !== 1 || excecoes[0] !== ROOT_MODEL) {
    const extras = excecoes.filter((m) => m !== ROOT_MODEL);
    registrar(
      'P2-MB1-TENANCY',
      `tenancy.modelsWithoutTenantField deve conter apenas ["${ROOT_MODEL}"] — ` +
        (extras.length
          ? `exceção não autorizada: ${extras.join(', ')}`
          : `encontrado ${JSON.stringify(excecoes)}`)
    );
  }
}

// Catálogo global adicional permanece vazio nesta fundação.
if (!Array.isArray(tenancy.globalCatalogModels)) {
  registrar('P2-MB1-TENANCY', 'tenancy.globalCatalogModels deve ser lista');
} else if (tenancy.globalCatalogModels.length > 0) {
  registrar(
    'P2-MB1-TENANCY',
    `tenancy.globalCatalogModels deve estar vazio na P2 — encontrado: ${tenancy.globalCatalogModels.join(', ')}`
  );
}

exigirIgual('P2-MB1-TENANCY', 'tenancy.tenantSource', tenancy.tenantSource, AUTH_CONTEXT);
exigirContem(
  'P2-MB1-TENANCY',
  'tenancy.forbiddenTenantSources',
  tenancy.forbiddenTenantSources,
  FONTES_DE_REQUEST
);
exigirIgual(
  'P2-MB1-TENANCY',
  'tenancy.businessUniqueIncludesTenant',
  tenancy.businessUniqueIncludesTenant,
  true
);
exigirIgual(
  'P2-MB1-TENANCY',
  'tenancy.tenantIndexFirstColumn',
  tenancy.tenantIndexFirstColumn,
  TENANT_FIELD
);
exigirIgual(
  'P2-MB1-TENANCY',
  'tenancy.crossTenantRelationsAllowed',
  tenancy.crossTenantRelationsAllowed,
  false
);
exigirIgual(
  'P2-MB1-TENANCY',
  'tenancy.clienteDeletePolicy',
  tenancy.clienteDeletePolicy,
  'explicit-reviewed'
);
exigirIgual(
  'P2-MB1-TENANCY',
  'tenancy.clienteDeleteCascadeWithoutReview',
  tenancy.clienteDeleteCascadeWithoutReview,
  false
);
if (!ehObjeto(tenancy.modelKinds)) {
  registrar('P2-MB1-TENANCY', 'tenancy.modelKinds deve distinguir root, tenant e systemCatalog');
} else {
  for (const tipo of ['root', 'tenant', 'systemCatalog']) {
    if (typeof tenancy.modelKinds[tipo] !== 'string' || !tenancy.modelKinds[tipo].trim()) {
      registrar('P2-MB1-TENANCY', `tenancy.modelKinds.${tipo} deve descrever o tipo de model`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Timestamps
// ---------------------------------------------------------------------------

for (const [campo, prisma] of [
  ['createdAt', 'DateTime @default(now())'],
  ['updatedAt', 'DateTime @updatedAt'],
]) {
  const decl = timestamps[campo];
  if (!ehObjeto(decl)) {
    registrar('P2-MB1-CONTRACT-SHAPE', `timestamps.${campo} deve ser objeto {field, prisma}`);
    continue;
  }
  exigirIgual('P2-MB1-CONTRACT-SHAPE', `timestamps.${campo}.field`, decl.field, campo);
  exigirIgual('P2-MB1-CONTRACT-SHAPE', `timestamps.${campo}.prisma`, decl.prisma, prisma);
}
exigirIgual(
  'P2-MB1-CONTRACT-SHAPE',
  'timestamps.requiredOnPersistentModels',
  timestamps.requiredOnPersistentModels,
  true
);
exigirIgual('P2-MB1-CONTRACT-SHAPE', 'timestamps.authority', timestamps.authority, 'database');
exigirIgual(
  'P2-MB1-CONTRACT-SHAPE',
  'timestamps.frontendTimestampIsAuthority',
  timestamps.frontendTimestampIsAuthority,
  false
);

// ---------------------------------------------------------------------------
// 6. Auditoria
// ---------------------------------------------------------------------------

exigirContem('P2-MB1-AUDIT', 'audit.layers', audit.layers, ['model-timestamps', 'central-audit-log']);

const auditLog = ehObjeto(audit.auditLogModel) ? audit.auditLogModel : null;
if (!auditLog) {
  registrar('P2-MB1-AUDIT', 'audit.auditLogModel deve ser objeto');
} else {
  exigirIgual('P2-MB1-AUDIT', 'audit.auditLogModel.name', auditLog.name, 'AuditLog');
  exigirIgual('P2-MB1-AUDIT', 'audit.auditLogModel.tenantScoped', auditLog.tenantScoped, true);

  const campos = nomesDeCampo(auditLog.fields);
  const faltando = ausentes(AUDIT_CAMPOS_MINIMOS, campos);
  if (faltando.length) {
    registrar('P2-MB1-AUDIT', `audit.auditLogModel.fields não declara: ${faltando.join(', ')}`);
  }

  const clienteIdField = (Array.isArray(auditLog.fields) ? auditLog.fields : [])
    .filter(ehObjeto)
    .find((c) => c.name === TENANT_FIELD);
  if (clienteIdField && clienteIdField.required !== true) {
    registrar(
      'P2-MB1-AUDIT',
      `audit.auditLogModel.fields.${TENANT_FIELD}.required deve ser true — AuditLog é tenant-scoped`
    );
  }
}

exigirIgual('P2-MB1-AUDIT', 'audit.actorSource', audit.actorSource, AUTH_CONTEXT);
exigirContem('P2-MB1-AUDIT', 'audit.forbiddenActorSources', audit.forbiddenActorSources, FONTES_DE_REQUEST);
exigirContem('P2-MB1-AUDIT', 'audit.forbiddenPayloadContent', audit.forbiddenPayloadContent, [
  'senha',
  'credencial',
  'segredo',
  'conteudo_binario',
]);
exigirIgual('P2-MB1-AUDIT', 'audit.silentFunctionalChange', audit.silentFunctionalChange, false);
exigirIgual('P2-MB1-AUDIT', 'audit.criticalFailureObservable', audit.criticalFailureObservable, true);

// ---------------------------------------------------------------------------
// 7. Numeração
// ---------------------------------------------------------------------------

exigirIgual('P2-MB1-NUMBERING', 'numbering.strategy', numbering.strategy, ESTRATEGIA_NUMERACAO);
exigirContem(
  'P2-MB1-NUMBERING',
  'numbering.forbiddenStrategies',
  numbering.forbiddenStrategies,
  ESTRATEGIAS_PROIBIDAS
);
if (Array.isArray(numbering.forbiddenStrategies) && ESTRATEGIAS_PROIBIDAS.includes(numbering.strategy)) {
  registrar(
    'P2-MB1-NUMBERING',
    `numbering.strategy não pode ser uma estratégia proibida — encontrado ${JSON.stringify(numbering.strategy)}`
  );
}
exigirIgual('P2-MB1-NUMBERING', 'numbering.transactional', numbering.transactional, true);
exigirIgual('P2-MB1-NUMBERING', 'numbering.atomicIncrement', numbering.atomicIncrement, true);
exigirIgual('P2-MB1-NUMBERING', 'numbering.reuseAfterDelete', numbering.reuseAfterDelete, false);
exigirContem('P2-MB1-NUMBERING', 'numbering.scopeTypes', numbering.scopeTypes, ['tenant']);

const sequencia = ehObjeto(numbering.sequenceModel) ? numbering.sequenceModel : null;
if (!sequencia) {
  registrar('P2-MB1-NUMBERING', 'numbering.sequenceModel deve ser objeto');
} else {
  exigirIgual('P2-MB1-NUMBERING', 'numbering.sequenceModel.tenantScoped', sequencia.tenantScoped, true);

  const campos = nomesDeCampo(sequencia.fields);
  const faltando = ausentes(SEQUENCIA_CAMPOS_MINIMOS, campos);
  if (faltando.length) {
    registrar('P2-MB1-NUMBERING', `numbering.sequenceModel.fields não declara: ${faltando.join(', ')}`);
  }

  if (!Array.isArray(sequencia.uniqueKey)) {
    registrar('P2-MB1-NUMBERING', 'numbering.sequenceModel.uniqueKey deve ser lista');
  } else {
    if (sequencia.uniqueKey[0] !== TENANT_FIELD) {
      registrar(
        'P2-MB1-NUMBERING',
        `numbering.sequenceModel.uniqueKey deve começar por ${TENANT_FIELD} — encontrado ${JSON.stringify(sequencia.uniqueKey)}`
      );
    }
    const faltandoChave = ausentes(['cliente_id', 'entidade', 'escopo_tipo', 'escopo_id'], sequencia.uniqueKey);
    if (faltandoChave.length) {
      registrar('P2-MB1-NUMBERING', `numbering.sequenceModel.uniqueKey não declara: ${faltandoChave.join(', ')}`);
    }
  }

  // O cuidado com NULL em unique do PostgreSQL precisa estar resolvido por
  // desenho — não pode virar descoberta de produção na P3.
  const perigo = ehObjeto(sequencia.nullScopeHazard) ? sequencia.nullScopeHazard : null;
  if (!perigo) {
    registrar(
      'P2-MB1-NUMBERING',
      'numbering.sequenceModel.nullScopeHazard deve documentar o risco de NULL em unique do PostgreSQL'
    );
  } else {
    if (typeof perigo.problem !== 'string' || !perigo.problem.trim()) {
      registrar('P2-MB1-NUMBERING', 'numbering.sequenceModel.nullScopeHazard.problem deve descrever o risco');
    }
    if (!Array.isArray(perigo.acceptedRepresentations) || perigo.acceptedRepresentations.length === 0) {
      registrar(
        'P2-MB1-NUMBERING',
        'numbering.sequenceModel.nullScopeHazard.acceptedRepresentations deve listar ao menos uma representação segura'
      );
    }
    exigirIgual(
      'P2-MB1-NUMBERING',
      'numbering.sequenceModel.nullScopeHazard.forbiddenRepresentation',
      perigo.forbiddenRepresentation,
      'nullable-escopo-id-in-plain-unique'
    );
  }
}

// ---------------------------------------------------------------------------
// 8. Anexos
// ---------------------------------------------------------------------------

exigirIgual('P2-MB1-ATTACHMENT', 'attachments.identityField', attachments.identityField, ANEXO_IDENTIDADE);
exigirIgual('P2-MB1-ATTACHMENT', 'attachments.urlAsIdentity', attachments.urlAsIdentity, false);
exigirIgual('P2-MB1-ATTACHMENT', 'attachments.publicUrlIsEphemeral', attachments.publicUrlIsEphemeral, true);
exigirContem('P2-MB1-ATTACHMENT', 'attachments.ownerFields', attachments.ownerFields, [
  'entidade',
  'entidade_id',
]);
exigirIgual('P2-MB1-ATTACHMENT', 'attachments.binaryInDatabase', attachments.binaryInDatabase, false);
exigirIgual(
  'P2-MB1-ATTACHMENT',
  'attachments.physicalDeletionPolicy',
  attachments.physicalDeletionPolicy,
  'explicit'
);
exigirIgual('P2-MB1-ATTACHMENT', 'attachments.base44Provider', attachments.base44Provider, false);

if (!ehObjeto(attachments.validation)) {
  registrar('P2-MB1-ATTACHMENT', 'attachments.validation deve ser objeto');
} else {
  for (const chave of ['mimeValidatedInBackend', 'sizeValidatedInBackend', 'originalNameSanitized']) {
    exigirIgual('P2-MB1-ATTACHMENT', `attachments.validation.${chave}`, attachments.validation[chave], true);
  }
}

const anexo = ehObjeto(attachments.model) ? attachments.model : null;
if (!anexo) {
  registrar('P2-MB1-ATTACHMENT', 'attachments.model deve ser objeto');
} else {
  exigirIgual('P2-MB1-ATTACHMENT', 'attachments.model.tenantScoped', anexo.tenantScoped, true);
  const campos = nomesDeCampo(anexo.fields);
  const faltando = ausentes(ANEXO_CAMPOS_MINIMOS, campos);
  if (faltando.length) {
    registrar('P2-MB1-ATTACHMENT', `attachments.model.fields não declara: ${faltando.join(', ')}`);
  }
  if (campos.length && !campos.includes(attachments.identityField)) {
    registrar(
      'P2-MB1-ATTACHMENT',
      `attachments.identityField (${attachments.identityField}) não existe em attachments.model.fields`
    );
  }
}

// ---------------------------------------------------------------------------
// 9. Exclusão e concorrência
// ---------------------------------------------------------------------------

exigirIgual('P2-MB1-CONTRACT-SHAPE', 'deletion.globalSoftDelete', deletion.globalSoftDelete, false);
exigirIgual(
  'P2-MB1-CONTRACT-SHAPE',
  'deletion.universalDeletedAtField',
  deletion.universalDeletedAtField,
  false
);
exigirIgual(
  'P2-MB1-CONTRACT-SHAPE',
  'deletion.ativoFieldReplacesDeletionPolicy',
  deletion.ativoFieldReplacesDeletionPolicy,
  false
);
exigirIgual(
  'P2-MB1-CONTRACT-SHAPE',
  'deletion.lifecycleDecidedPerCapability',
  deletion.lifecycleDecidedPerCapability,
  true
);
exigirIgual(
  'P2-MB1-CONTRACT-SHAPE',
  'deletion.auditRegistersRelevantDeletions',
  deletion.auditRegistersRelevantDeletions,
  true
);

exigirIgual(
  'P2-MB1-CONTRACT-SHAPE',
  'concurrency.criticalCompositeOperationsUseTransaction',
  concurrency.criticalCompositeOperationsUseTransaction,
  true
);
exigirIgual(
  'P2-MB1-NUMBERING',
  'concurrency.numberingTransactional',
  concurrency.numberingTransactional,
  true
);
exigirIgual(
  'P2-MB1-CONTRACT-SHAPE',
  'concurrency.uniqueConstraintsAsLastBarrier',
  concurrency.uniqueConstraintsAsLastBarrier,
  true
);
exigirIgual('P2-MB1-CONTRACT-SHAPE', 'concurrency.sagaFramework', concurrency.sagaFramework, false);

// ---------------------------------------------------------------------------
// 10. Códigos de erro
// ---------------------------------------------------------------------------

const codigos = Array.isArray(contrato.errorCodes)
  ? contrato.errorCodes.filter(ehObjeto).map((e) => e.code)
  : [];
const codigosFaltando = ausentes(CODIGOS_DE_ERRO_MINIMOS, codigos);
if (codigosFaltando.length) {
  registrar('P2-MB1-CONTRACT-SHAPE', `errorCodes não declara: ${codigosFaltando.join(', ')}`);
}
if (Array.isArray(contrato.errorCodes)) {
  for (const entrada of contrato.errorCodes) {
    if (!ehObjeto(entrada)) {
      registrar('P2-MB1-CONTRACT-SHAPE', 'cada item de errorCodes deve ser objeto {code, http, meaning}');
      continue;
    }
    if (!Number.isInteger(entrada.http) || entrada.http < 400 || entrada.http > 599) {
      registrar(
        'P2-MB1-CONTRACT-SHAPE',
        `errorCodes.${entrada.code}.http deve ser status HTTP de erro — encontrado ${JSON.stringify(entrada.http)}`
      );
    }
    if (typeof entrada.meaning !== 'string' || !entrada.meaning.trim()) {
      registrar('P2-MB1-CONTRACT-SHAPE', `errorCodes.${entrada.code}.meaning deve descrever a falha`);
    }
  }
}

// ---------------------------------------------------------------------------
// 11. Padrões proibidos
// ---------------------------------------------------------------------------

const padroes = Array.isArray(contrato.prohibitedPatterns)
  ? contrato.prohibitedPatterns.filter(ehObjeto).map((p) => p.id)
  : [];
const padroesFaltando = ausentes(PADROES_PROIBIDOS_MINIMOS, padroes);
if (padroesFaltando.length) {
  registrar('P2-MB1-PROHIBITED', `prohibitedPatterns não declara: ${padroesFaltando.join(', ')}`);
}
if (Array.isArray(contrato.prohibitedPatterns)) {
  for (const entrada of contrato.prohibitedPatterns) {
    if (!ehObjeto(entrada) || typeof entrada.description !== 'string' || !entrada.description.trim()) {
      registrar(
        'P2-MB1-PROHIBITED',
        `cada item de prohibitedPatterns precisa de {id, description} — inválido: ${JSON.stringify(entrada)}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 12. Handoff para a P3
// ---------------------------------------------------------------------------

exigirIgual('P2-MB1-HANDOFF', 'p3Handoff.authorizedInP2', handoff.authorizedInP2, false);
exigirContem('P2-MB1-HANDOFF', 'p3Handoff.creates', handoff.creates, HANDOFF_CRIACOES_MINIMAS);
exigirContem('P2-MB1-HANDOFF', 'p3Handoff.gates', handoff.gates, HANDOFF_GATES_MINIMOS);
exigirContem('P2-MB1-HANDOFF', 'p3Handoff.operational', handoff.operational, HANDOFF_OPERACIONAL_MINIMO);
exigirIgual('P2-MB1-HANDOFF', 'p3Handoff.domainMigrationStartsIn', handoff.domainMigrationStartsIn, 'P4');
exigirIgual(
  'P2-MB1-HANDOFF',
  'p3Handoff.migrationBlockedUntilContractMerged',
  handoff.migrationBlockedUntilContractMerged,
  true
);

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

if (falhas.length) reprovar();

console.log(
  `gate:modelobase1-pecuario — PASSOU (${CONTRATO}: ${SECOES_OBRIGATORIAS.length} seções, ` +
    `${codigos.length} códigos de erro, ${padroes.length} padrões proibidos)`
);
