/**
 * Provas do `gate:map-geography-native` (P4.3, D-PROD-32).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanup, writeFile, runGate } from './helpers.mjs';

const GATE = 'gate-map-geography-native.mjs';
const rodar = (dir) => runGate(GATE, { env: { MAP_GEOGRAPHY_NATIVE_ROOT: dir } });
const passa = (dir) => {
  const r = rodar(dir);
  assert.equal(r.status, 0, r.output);
};
const falhaCom = (dir, codigo) => {
  const r = rodar(dir);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, new RegExp(codigo), r.output);
};

const SCHEMA_BASE = `
model Cliente {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  icones    ConfiguracaoIcone[]
  pontos    PontoReferencia[]
  linhas    LinhaGeografica[]
}

model ConfiguracaoIcone {
  id            String   @id @default(cuid())
  cliente_id    String   @db.VarChar(64)
  tipo_entidade String   @db.VarChar(64)
  categoria     String   @db.VarChar(255)
  ativo         Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  cliente Cliente @relation(fields: [cliente_id], references: [id], onDelete: Restrict)
  @@unique([cliente_id, id])
  @@index([cliente_id, ativo])
}

model PontoReferencia {
  id           String   @id @default(cuid())
  cliente_id   String   @db.VarChar(64)
  empresa_id   String   @db.VarChar(64)
  numero_ponto String   @db.VarChar(32)
  nome         String   @db.VarChar(255)
  tipo         String   @db.VarChar(128)
  ativo        Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  cliente Cliente @relation(fields: [cliente_id], references: [id], onDelete: Restrict)
  @@unique([cliente_id, numero_ponto])
  @@unique([cliente_id, id])
  @@index([cliente_id, empresa_id])
}

model LinhaGeografica {
  id           String   @id @default(cuid())
  cliente_id   String   @db.VarChar(64)
  empresa_id   String   @db.VarChar(64)
  numero_linha String   @db.VarChar(32)
  nome         String   @db.VarChar(255)
  tipo         String   @db.VarChar(64)
  ativo        Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  cliente Cliente @relation(fields: [cliente_id], references: [id], onDelete: Restrict)
  @@unique([cliente_id, numero_linha])
  @@unique([cliente_id, id])
  @@index([cliente_id, empresa_id])
}
`;

const MIGRATION_OK = `
CREATE TABLE "ConfiguracaoIcone" ("id" TEXT NOT NULL);
CREATE TABLE "PontoReferencia" ("id" TEXT NOT NULL);
CREATE TABLE "LinhaGeografica" ("id" TEXT NOT NULL);
`;

const SERVICE_PONTO_OK = `
import { reservarNumero } from '../sequencias/entidadeCodigoService.js';
import { registrarEvento } from '../auditoria/auditService.js';
const gravar = { cliente_id: auth.clienteId };
export const criar = async () => prisma.$transaction(async (tx) => {
  await reservarNumero(tx, {});
  await registrarEvento({}, { acao: 'create', entidade: 'PontoReferencia' }, tx);
});
export const atualizar = async () => prisma.$transaction(async (tx) => {
  await registrarEvento({}, { acao: 'update', entidade: 'PontoReferencia' }, tx);
});
export const excluir = async () => prisma.$transaction(async (tx) => {
  await registrarEvento({}, { acao: 'delete', entidade: 'PontoReferencia' }, tx);
});
`;

const SERVICE_LINHA_OK = `
import { reservarNumero } from '../sequencias/entidadeCodigoService.js';
import { registrarEvento } from '../auditoria/auditService.js';
const gravar = { cliente_id: auth.clienteId };
export const criar = async () => prisma.$transaction(async (tx) => {
  await reservarNumero(tx, {});
  await registrarEvento({}, { acao: 'create', entidade: 'LinhaGeografica' }, tx);
});
export const atualizar = async () => prisma.$transaction(async (tx) => {
  await registrarEvento({}, { acao: 'update', entidade: 'LinhaGeografica' }, tx);
});
`;

const SERVICE_ICONE_OK = `
import { registrarEvento } from '../auditoria/auditService.js';
export const criar = async () => prisma.$transaction(async (tx) => {
  await registrarEvento({}, { acao: 'create', entidade: 'ConfiguracaoIcone' }, tx);
});
export const atualizar = async () => prisma.$transaction(async (tx) => {
  await registrarEvento({}, { acao: 'update', entidade: 'ConfiguracaoIcone' }, tx);
});
`;

const ROTAS_OK = `
export const registrarMapGeographyRoutes = async (app) => {
  app.get('/configuracao-icones', { onRequest: [app.autenticar] }, () => {});
  app.post('/configuracao-icones', { onRequest: [app.autenticar], schema: { body: { additionalProperties: false, type: 'object', properties: {} } } }, () => {});
  app.patch('/configuracao-icones/:id', { onRequest: [app.autenticar], schema: { params: { additionalProperties: false, type: 'object', properties: { id: { type: 'string' } } }, body: { additionalProperties: false, type: 'object', properties: {} } } }, () => {});
  app.get('/pontos-referencia', { onRequest: [app.autenticar] }, () => {});
  app.post('/pontos-referencia', { onRequest: [app.autenticar], schema: { body: { additionalProperties: false, type: 'object', properties: {} } } }, () => {});
  app.patch('/pontos-referencia/:id', { onRequest: [app.autenticar], schema: { params: { additionalProperties: false, type: 'object', properties: { id: { type: 'string' } } }, body: { additionalProperties: false, type: 'object', properties: {} } } }, () => {});
  app.delete('/pontos-referencia/:id', { onRequest: [app.autenticar], schema: { params: { additionalProperties: false, type: 'object', properties: { id: { type: 'string' } } } } }, () => {});
  app.get('/linhas-geograficas', { onRequest: [app.autenticar] }, () => {});
  app.post('/linhas-geograficas', { onRequest: [app.autenticar], schema: { body: { additionalProperties: false, type: 'object', properties: {} } } }, () => {});
  app.patch('/linhas-geograficas/:id', { onRequest: [app.autenticar], schema: { params: { additionalProperties: false, type: 'object', properties: { id: { type: 'string' } } }, body: { additionalProperties: false, type: 'object', properties: {} } } }, () => {});
};
`;

const PORTA_OK = `
import { nativeRequest } from '../_core/nativeHttpClient.js';
const operacoesIcone = Object.freeze({
  list: () => nativeRequest('/configuracao-icones', {}, {}),
  create: () => nativeRequest('/configuracao-icones', {}, {}),
  update: () => nativeRequest('/configuracao-icones/x', {}, {}),
});
export const configuracaoIconePort = createOfflineEntityAdapter({ entityName: 'ConfiguracaoIcone', operations: operacoesIcone, tenantScoped: true });
const operacoesPonto = Object.freeze({
  list: () => nativeRequest('/pontos-referencia', {}, {}),
  create: () => nativeRequest('/pontos-referencia', {}, {}),
  update: () => nativeRequest('/pontos-referencia/x', {}, {}),
  delete: () => nativeRequest('/pontos-referencia/x', { method: 'DELETE' }, { operation: 'deletePonto' }),
});
export const pontoReferenciaPort = createOfflineEntityAdapter({ entityName: 'PontoReferencia', operations: operacoesPonto, tenantScoped: true });
const operacoesLinha = Object.freeze({
  list: () => nativeRequest('/linhas-geograficas', {}, {}),
  create: () => nativeRequest('/linhas-geograficas', {}, {}),
  update: () => nativeRequest('/linhas-geograficas/x', {}, {}),
});
export const linhaGeograficaPort = createOfflineEntityAdapter({ entityName: 'LinhaGeografica', operations: operacoesLinha, tenantScoped: true });
function createOfflineEntityAdapter(x) { return x; }
`;

const MAPA_API_OK = `
export { listPontos, createPonto, updatePonto, deletePonto, listLinhas, createLinha, updateLinha, listIcones, createIcone, updateIcone } from '@/apis/mapaGeografia';
`;

const PROVIDER_OK = `
const ENTITY_REGISTRY = { Empresa: {} };
export const mapaProvider = { listBebedouros: () => {} };
`;

const montarOk = () => {
  const dir = makeTempDir();
  writeFile(dir, 'backend/prisma/schema.prisma', SCHEMA_BASE);
  writeFile(dir, 'backend/prisma/migrations/20261023180000_p4_3/migration.sql', MIGRATION_OK);
  writeFile(dir, 'backend/src/modules/mapGeography/mapGeographyRoutes.js', ROTAS_OK);
  writeFile(dir, 'backend/src/modules/mapGeography/pontoReferenciaService.js', SERVICE_PONTO_OK);
  writeFile(dir, 'backend/src/modules/mapGeography/linhaGeograficaService.js', SERVICE_LINHA_OK);
  writeFile(dir, 'backend/src/modules/mapGeography/configuracaoIconeService.js', SERVICE_ICONE_OK);
  writeFile(dir, 'src/apis/mapaGeografia/mapaGeografiaNativePort.js', PORTA_OK);
  writeFile(dir, 'src/apis/mapaGeografia/mapaGeografiaApi.js', 'export const listPontos = () => {};');
  writeFile(dir, 'src/apis/mapa/mapaApi.js', MAPA_API_OK);
  writeFile(dir, 'src/apis/_providers/base44Provider.js', PROVIDER_OK);
  return dir;
};

describe('gate:map-geography-native', () => {
  test('controle positivo — fixture mínima passa', () => {
    const dir = montarOk();
    try {
      passa(dir);
    } finally {
      cleanup(dir);
    }
  });

  test('P43-MAP-MODEL — falta @@unique numero_ponto', () => {
    const dir = montarOk();
    try {
      writeFile(
        dir,
        'backend/prisma/schema.prisma',
        SCHEMA_BASE.replace('@@unique([cliente_id, numero_ponto])', '')
      );
      falhaCom(dir, 'P43-MAP-MODEL');
    } finally {
      cleanup(dir);
    }
  });

  test('P43-MAP-BASE44 — registry ainda tem PontoReferencia', () => {
    const dir = montarOk();
    try {
      writeFile(
        dir,
        'src/apis/_providers/base44Provider.js',
        PROVIDER_OK + "\nPontoReferencia: comFronteira('PontoReferencia', {}),"
      );
      falhaCom(dir, 'P43-MAP-BASE44');
    } finally {
      cleanup(dir);
    }
  });

  test('P43-MAP-NO-DELETE-LINHA — DELETE de linha reprova', () => {
    const dir = montarOk();
    try {
      writeFile(
        dir,
        'backend/src/modules/mapGeography/mapGeographyRoutes.js',
        ROTAS_OK + "\napp.delete('/linhas-geograficas/:id', () => {});"
      );
      falhaCom(dir, 'P43-MAP-NO-DELETE-LINHA');
    } finally {
      cleanup(dir);
    }
  });

  test('P43-MAP-SINGLE-OWNER — mapaApi sem reexport reprova', () => {
    const dir = montarOk();
    try {
      writeFile(dir, 'src/apis/mapa/mapaApi.js', 'export const listPontos = () => mapaProvider.listPontos();');
      falhaCom(dir, 'P43-MAP-SINGLE-OWNER');
    } finally {
      cleanup(dir);
    }
  });
});
