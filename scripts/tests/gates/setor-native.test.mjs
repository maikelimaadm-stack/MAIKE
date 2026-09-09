/**
 * Provas do `gate:setor-native` (P4.1, D-PROD-25).
 *
 * A regra da P2-R1 governa este arquivo: uma invariante não está protegida
 * porque o código correto passa — ela está protegida quando o código
 * **mutilado reprova**, com o código de falha certo. Cada mutilação abaixo é um
 * defeito que já existiu ou que a P4.1 fecha pela primeira vez.
 *
 * E cada regra tem também um **controle positivo**: uma variação legítima que
 * precisa CONTINUAR passando. Sem eles o gate viraria um scanner ingênuo — o
 * erro que a P4.0 cometeu duas vezes no `gate:native-api`, reprovando a
 * definição de `getNativeApiUrl` e a fronteira legítima da Base44.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTempDir, cleanup, writeFile, runGate, GATES_DIR } from './helpers.mjs';

const GATE = 'gate-setor-native.mjs';

const rodar = (dir) => runGate(GATE, { env: { SETOR_NATIVE_ROOT: dir } });

const passa = (dir) => {
  const r = rodar(dir);
  assert.equal(r.status, 0, r.output);
};

const falhaCom = (dir, codigo) => {
  const r = rodar(dir);
  assert.equal(r.status, 1, `esperava reprovação, saiu 0:\n${r.output}`);
  assert.match(r.output, new RegExp(codigo), r.output);
};

// ---------------------------------------------------------------------------
// Fixtures — um projeto mínimo que o gate aprova
// ---------------------------------------------------------------------------

const SCHEMA_OK = `
model Cliente {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  setores   Setor[]
}

model Setor {
  id           String   @id @default(cuid())
  cliente_id   String   @db.VarChar(64)
  empresa_id   String   @db.VarChar(64)
  numero_setor String   @db.VarChar(32)
  nome         String   @db.VarChar(255)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  cliente Cliente @relation(fields: [cliente_id], references: [id], onDelete: Restrict)

  @@unique([cliente_id, numero_setor])
  @@unique([cliente_id, id])
  @@index([cliente_id, empresa_id])
}
`;

const MIGRATION_OK = 'CREATE TABLE "Setor" (\n  "id" TEXT NOT NULL\n);\n';

const ROTAS_OK = `
import { listar, criar, atualizar } from './setorService.js';

const CAMPOS = { nome: { type: 'string' } };

export const registrarSetorRoutes = async (app) => {
  app.get('/setores', { onRequest: [app.autenticar] }, async (request) => {
    return listar(request.contexto);
  });

  app.post('/setores', {
    onRequest: [app.autenticar],
    schema: { body: { type: 'object', additionalProperties: false, properties: CAMPOS } },
  }, async (request, reply) => {
    return reply.status(201).send(await criar(request.contexto, request.body));
  });

  app.patch('/setores/:id', {
    onRequest: [app.autenticar],
    schema: { body: { type: 'object', additionalProperties: false, properties: CAMPOS } },
  }, async (request) => {
    return atualizar(request.contexto, request.params.id, request.body);
  });
};
`;

const SERVICE_BACKEND_OK = `
import { getPrismaClient } from '../../database/prismaClient.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { inserirSetor } from './setorRepository.js';

export const listar = async (contexto) => [];

export const criar = async (contexto, entrada) => {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const numero = await reservarNumero(tx, {
      clienteId: contexto.auth.clienteId,
      entidade: 'Setor',
      escopoTipo: ESCOPO_TENANT,
    });
    const registro = await inserirSetor(tx, { ...entrada, numero_setor: String(numero) });
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'Setor', entidadeId: registro.id },
      tx
    );
    return registro;
  });
};

export const atualizar = async (contexto, id, entrada) => {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    await registrarEvento(
      contexto,
      { acao: 'update', entidade: 'Setor', entidadeId: id },
      tx
    );
    return { id };
  });
};
`;

const REPOSITORIO_OK = `
export const inserirSetor = async (tx, dados) => tx.setor.create({ data: dados });
`;

const PORTA_OK = `
import { nativeRequest } from '../_core/nativeHttpClient.js';
import { createOfflineEntityAdapter, offlineStorageDisponivel } from '@/lib/offline/offlineEntityRuntime';

const CAMPOS_DE_CRIACAO = ['empresa_id', 'nome', 'tipo'];

export const corpoDeEnvio = (dados, permitidos) => {
  const corpo = {};
  for (const campo of permitidos) {
    if (Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) corpo[campo] = dados[campo];
  }
  return corpo;
};

export const operacoesNativas = Object.freeze({
  list: () => nativeRequest('/setores', { autenticado: true }, { operation: 'listSetores', resource: 'Setor' }),
  create: (dados) => nativeRequest('/setores', {
    method: 'POST',
    body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO),
    autenticado: true,
  }, { operation: 'createSetor', resource: 'Setor' }),
  update: (id, dados) => nativeRequest(\`/setores/\${id}\`, {
    method: 'PATCH',
    body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO),
    autenticado: true,
  }, { operation: 'updateSetor', resource: 'Setor' }),
});

export const setorPort = createOfflineEntityAdapter({
  entityName: 'Setor',
  operations: operacoesNativas,
  enabled: offlineStorageDisponivel(),
  tenantScoped: true,
});
`;

const RUNTIME_OFFLINE_OK = `
import { getOfflineTenant } from '@/lib/offline/offlineTenant';

const tenantDe = (tenantScoped) => (tenantScoped ? getOfflineTenant() : undefined);

const destinoDaEntrada = (entrada, item, tenantAtual) => {
  if (!entrada.tenantScoped) return 'aplicar';
  if (!('cliente_id' in item)) return 'descartar';
  if ((item.cliente_id ?? null) !== tenantAtual) return 'pular';
  return 'aplicar';
};

export const createOfflineEntityAdapter = ({ entityName, operations, tenantScoped = false }) => {
  void tenantDe(tenantScoped);
  return operations;
};

export const syncOfflineEntityQueue = async () => {
  const tenantAtual = getOfflineTenant();
  void destinoDaEntrada({ tenantScoped: true }, {}, tenantAtual);
  return { success: true };
};
`;

const SESSAO_OK = `
import { clearNativeToken, setNativeToken } from '@/lib/auth/nativeTokenStorage';
import { setOfflineTenant, clearOfflineTenant } from '@/lib/offline/offlineTenant';

const descartarSessaoLocal = () => {
  clearNativeToken();
  clearOfflineTenant();
};

export const obterContexto = async () => {
  const corpo = { cliente_id: 'x' };
  setOfflineTenant(corpo.cliente_id);
  return corpo;
};

export const login = async () => { setNativeToken('t'); await obterContexto(); };
export const logout = () => { descartarSessaoLocal(); };
`;

const API_MODULO_OK = `
import { runProviderCall } from '../_core/normalizeApiError.js';
import { setorPort } from './setorNativePort.js';

export const listSetores = async () =>
  runProviderCall(() => setorPort.list(), { operation: 'listSetores', resource: 'Setor' });
`;

const SERVICE_FRONT_OK = `
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

export const excluirSetor = async (id) => {
  throw new ApiError(API_ERROR_CODES.SETOR_DELETE_UNAVAILABLE, {
    operation: 'excluirSetor',
    resource: 'Setor',
  });
};
`;

const PROVIDER_OK = `
const ENTITY_REGISTRY = Object.freeze({
  Empresa: comFronteira('Empresa', base44.entities.Empresa),
  AreaPastagem: comFronteira('AreaPastagem', base44.entities.AreaPastagem),
});

export const mapaProvider = Object.freeze({
  listAreas: (ordenacao) => endpointOf('AreaPastagem').list(ordenacao),
});
`;

const HTTP_CLIENT_OK = `
const erroDeIndisponibilidade = (contexto, cause) => new ApiError('API_PROVIDER_UNAVAILABLE', {});

export const nativeRequest = async (caminho, opcoes, contexto) => {
  const base = getNativeApiUrl();
  if (!base) throw erroDeIndisponibilidade(contexto, new Error('sem URL'));
  return null;
};
`;

/**
 * Projeto válido, com sobrescritas por arquivo.
 * @param {Record<string, string>} [sobrescritas]
 */
const projeto = (sobrescritas = {}) => {
  const dir = makeTempDir('maike-setor-native-');
  const arquivos = {
    'backend/prisma/schema.prisma': SCHEMA_OK,
    'backend/prisma/migrations/20260101000000_p4_1_setor_native/migration.sql': MIGRATION_OK,
    'backend/src/modules/setores/setorRoutes.js': ROTAS_OK,
    'backend/src/modules/setores/setorService.js': SERVICE_BACKEND_OK,
    'backend/src/modules/setores/setorRepository.js': REPOSITORIO_OK,
    'src/apis/setores/setorNativePort.js': PORTA_OK,
    'src/apis/setores/setoresApi.js': API_MODULO_OK,
    'src/services/setorService.js': SERVICE_FRONT_OK,
    'src/apis/_providers/base44Provider.js': PROVIDER_OK,
    'src/apis/_core/nativeHttpClient.js': HTTP_CLIENT_OK,
    'src/lib/offline/offlineEntityRuntime.js': RUNTIME_OFFLINE_OK,
    'src/apis/session/nativeSessionApi.js': SESSAO_OK,
    ...sobrescritas,
  };

  for (const [rel, conteudo] of Object.entries(arquivos)) writeFile(dir, rel, conteudo);
  return dir;
};

// ---------------------------------------------------------------------------

describe('gate:setor-native — o projeto correto passa', () => {
  test('SN-00 fixture completa é aprovada', () => {
    const d = projeto();
    passa(d);
    cleanup(d);
  });
});

describe('SN-01 · P41-SETOR-MODEL', () => {
  test('SN-01a schema sem model Setor reprova', () => {
    const d = projeto({ 'backend/prisma/schema.prisma': 'model Cliente {\n  id String @id\n}\n' });
    falhaCom(d, 'P41-SETOR-MODEL');
    cleanup(d);
  });

  test('SN-01b Setor sem @@unique([cliente_id, numero_setor]) reprova', () => {
    const d = projeto({
      'backend/prisma/schema.prisma': SCHEMA_OK.replace('@@unique([cliente_id, numero_setor])', ''),
    });
    falhaCom(d, 'P41-SETOR-MODEL');
    cleanup(d);
  });

  test('SN-01c unique de numero_setor SEM o tenant na frente reprova', () => {
    const d = projeto({
      'backend/prisma/schema.prisma': SCHEMA_OK.replace(
        '@@unique([cliente_id, numero_setor])',
        '@@unique([numero_setor, cliente_id])'
      ),
    });
    falhaCom(d, 'P41-SETOR-MODEL');
    cleanup(d);
  });

  test('SN-01d empresa_id como relação para model inexistente reprova', () => {
    const d = projeto({
      'backend/prisma/schema.prisma': SCHEMA_OK.replace(
        'empresa_id   String   @db.VarChar(64)',
        'empresa_id   Empresa  @db.VarChar(64)'
      ),
    });
    falhaCom(d, 'P41-SETOR-MODEL');
    cleanup(d);
  });

  test('SN-01e model sem migration versionada reprova', () => {
    const d = projeto({
      'backend/prisma/migrations/20260101000000_p4_1_setor_native/migration.sql':
        'CREATE TABLE "Outra" ("id" TEXT);\n',
    });
    falhaCom(d, 'P41-SETOR-MODEL');
    cleanup(d);
  });

  test('SN-01f controle positivo: índice extra tenant-first continua passando', () => {
    const d = projeto({
      'backend/prisma/schema.prisma': SCHEMA_OK.replace(
        '@@index([cliente_id, empresa_id])',
        '@@index([cliente_id, empresa_id])\n  @@index([cliente_id, nome])'
      ),
    });
    passa(d);
    cleanup(d);
  });
});

describe('SN-02 · P41-SETOR-NUMBERING', () => {
  test('SN-02a service que não chama reservarNumero reprova', () => {
    const d = projeto({
      'backend/src/modules/setores/setorService.js': SERVICE_BACKEND_OK.replace(
        /const numero = await reservarNumero\([\s\S]*?\);/,
        "const numero = 1;"
      ),
    });
    falhaCom(d, 'P41-SETOR-NUMBERING');
    cleanup(d);
  });

  test('SN-02b reserva fora de transação reprova', () => {
    const d = projeto({
      'backend/src/modules/setores/setorService.js': SERVICE_BACKEND_OK.replace(
        /prisma\.\$transaction/g,
        'prisma.semTransacao'
      ),
    });
    falhaCom(d, 'P41-SETOR-NUMBERING');
    cleanup(d);
  });

  test('SN-02c MAX() no repositório reprova', () => {
    const d = projeto({
      'backend/src/modules/setores/setorRepository.js':
        'export const proximo = (tx) => tx.$queryRaw`SELECT MAX(numero_setor) FROM "Setor"`;\n',
    });
    falhaCom(d, 'P41-SETOR-NUMBERING');
    cleanup(d);
  });

  test('SN-02d Math.max no service do frontend reprova', () => {
    const d = projeto({
      'src/services/setorService.js':
        SERVICE_FRONT_OK + '\nexport const proximo = (l) => Math.max(...l.map((s) => s.n));\n',
    });
    falhaCom(d, 'P41-SETOR-NUMBERING');
    cleanup(d);
  });

  test('SN-02e proximoNumeroSetor de volta no frontend reprova', () => {
    const d = projeto({
      'src/services/setorService.js':
        SERVICE_FRONT_OK + '\nexport const proximoNumeroSetor = (setores) => String(setores.length + 1);\n',
    });
    falhaCom(d, 'P41-SETOR-NUMBERING');
    cleanup(d);
  });

  test('SN-02f controle positivo: a prosa pode CITAR MAX + 1 sem reprovar', () => {
    const d = projeto({
      'src/services/setorService.js':
        '// O MAX + 1 saiu daqui na P4.1: Math.max sobre a lista carregada era uma\n' +
        '// fotografia, e dois navegadores liam o mesmo número.\n' +
        SERVICE_FRONT_OK,
    });
    passa(d);
    cleanup(d);
  });
});

describe('SN-03 · P41-SETOR-DELETE', () => {
  test('SN-03a rota DELETE reprova', () => {
    const d = projeto({
      'backend/src/modules/setores/setorRoutes.js':
        ROTAS_OK.replace(
          '};\n',
          "  app.delete('/setores/:id', { onRequest: [app.autenticar] }, async () => ({}));\n};\n"
        ),
    });
    falhaCom(d, 'P41-SETOR-DELETE');
    cleanup(d);
  });

  test('SN-03b DELETE declarado por app.route({method}) também reprova', () => {
    const d = projeto({
      'backend/src/modules/setores/setorRoutes.js':
        ROTAS_OK + "\napp.route({ method: ['DELETE'], url: '/setores/:id' });\n",
    });
    falhaCom(d, 'P41-SETOR-DELETE');
    cleanup(d);
  });

  test('SN-03c deleteSetor exportado no módulo de API reprova', () => {
    const d = projeto({
      'src/apis/setores/setoresApi.js': API_MODULO_OK + '\nexport const deleteSetor = async (id) => null;\n',
    });
    falhaCom(d, 'P41-SETOR-DELETE');
    cleanup(d);
  });

  test('SN-03d recusa sem código próprio reprova', () => {
    const d = projeto({
      'src/services/setorService.js':
        "export const excluirSetor = async () => { throw new Error('nao da'); };\n",
    });
    falhaCom(d, 'P41-SETOR-DELETE');
    cleanup(d);
  });

  test('SN-03e recusar com SETOR_DELETE_BLOCKED — vínculo não verificado — reprova', () => {
    const d = projeto({
      'src/services/setorService.js':
        SERVICE_FRONT_OK.replace('SETOR_DELETE_UNAVAILABLE', 'SETOR_DELETE_BLOCKED'),
    });
    falhaCom(d, 'P41-SETOR-DELETE');
    cleanup(d);
  });
});

describe('SN-04 · P41-SETOR-BASE44', () => {
  test('SN-04a Setor de volta no registry da Base44 reprova', () => {
    const d = projeto({
      'src/apis/_providers/base44Provider.js':
        PROVIDER_OK.replace(
          'AreaPastagem: comFronteira',
          "Setor: comFronteira('Setor', base44.entities.Setor),\n  AreaPastagem: comFronteira"
        ),
    });
    falhaCom(d, 'P41-SETOR-BASE44');
    cleanup(d);
  });

  test('SN-04b endpointOf("Setor") reprova mesmo sem tocar base44.entities', () => {
    const d = projeto({
      'src/apis/_providers/base44Provider.js':
        PROVIDER_OK + "\nexport const lerSetores = () => endpointOf('Setor').list();\n",
    });
    falhaCom(d, 'P41-SETOR-BASE44');
    cleanup(d);
  });

  test('SN-04c setoresProvider reintroduzido reprova', () => {
    const d = projeto({
      'src/apis/_providers/base44Provider.js':
        PROVIDER_OK + '\nexport const setoresProvider = Object.freeze({});\n',
    });
    falhaCom(d, 'P41-SETOR-BASE44');
    cleanup(d);
  });

  test('SN-04d porta nativa que importa a Base44 reprova', () => {
    const d = projeto({
      'src/apis/setores/setorNativePort.js':
        "import { base44 } from '@/api/base44Client';\n" + PORTA_OK,
    });
    falhaCom(d, 'P41-SETOR-BASE44');
    cleanup(d);
  });

  test('SN-04e controle positivo: o provider continua servindo as OUTRAS entidades', () => {
    const d = projeto({
      'src/apis/_providers/base44Provider.js':
        PROVIDER_OK + "\nexport const areasProvider = Object.freeze({ list: () => endpointOf('AreaPastagem').list() });\n",
    });
    passa(d);
    cleanup(d);
  });
});

describe('SN-05 · P41-SETOR-PORT', () => {
  test('SN-05a segundo arquivo montando /setores reprova', () => {
    const d = projeto({
      'src/services/outroCaminho.js':
        "export const listar = () => fetch('/setores');\n",
    });
    falhaCom(d, 'P41-SETOR-PORT');
    cleanup(d);
  });

  test('SN-05b porta sem composição offline reprova', () => {
    const d = projeto({
      'src/apis/setores/setorNativePort.js':
        PORTA_OK.replace(/export const setorPort = createOfflineEntityAdapter\([\s\S]*?\);/, 'export const setorPort = operacoesNativas;'),
    });
    falhaCom(d, 'P41-SETOR-PORT');
    cleanup(d);
  });

  test('SN-05c operação delete na porta reprova', () => {
    const d = projeto({
      'src/apis/setores/setorNativePort.js':
        PORTA_OK.replace(
          '  update: (id, dados)',
          "  delete: (id) => nativeRequest('/x', { method: 'DELETE' }, {}),\n  update: (id, dados)"
        ),
    });
    falhaCom(d, 'P41-SETOR-PORT');
    cleanup(d);
  });
});

describe('SN-06 · P41-SETOR-TENANT-SOURCE', () => {
  test('SN-06a porta que envia cliente_id reprova', () => {
    const d = projeto({
      'src/apis/setores/setorNativePort.js':
        PORTA_OK.replace("['empresa_id', 'nome', 'tipo']", "['empresa_id', 'cliente_id', 'nome', 'tipo']"),
    });
    falhaCom(d, 'P41-SETOR-TENANT-SOURCE');
    cleanup(d);
  });

  test('SN-06b rota que aceita cliente_id no schema reprova', () => {
    const d = projeto({
      'backend/src/modules/setores/setorRoutes.js':
        ROTAS_OK.replace("const CAMPOS = { nome: { type: 'string' } };", "const CAMPOS = { nome: { type: 'string' }, cliente_id: { type: 'string' } };"),
    });
    falhaCom(d, 'P41-SETOR-TENANT-SOURCE');
    cleanup(d);
  });

  test('SN-06c schema aberto (sem additionalProperties: false) reprova', () => {
    const d = projeto({
      'backend/src/modules/setores/setorRoutes.js':
        ROTAS_OK.replace(/additionalProperties: false, /g, ''),
    });
    falhaCom(d, 'P41-SETOR-TENANT-SOURCE');
    cleanup(d);
  });
});

describe('SN-07 · P41-SETOR-OFFLINE-ID', () => {
  test('SN-07a corpo montado por spread reprova', () => {
    const d = projeto({
      'src/apis/setores/setorNativePort.js':
        PORTA_OK.replace(/body: corpoDeEnvio\(dados, CAMPOS_DE_CRIACAO\),/g, 'body: { ...dados },'),
    });
    falhaCom(d, 'P41-SETOR-OFFLINE-ID');
    cleanup(d);
  });

  test('SN-07b numero_setor na lista de campos enviados reprova', () => {
    const d = projeto({
      'src/apis/setores/setorNativePort.js':
        PORTA_OK.replace("['empresa_id', 'nome', 'tipo']", "['empresa_id', 'nome', 'tipo', 'numero_setor']"),
    });
    falhaCom(d, 'P41-SETOR-OFFLINE-ID');
    cleanup(d);
  });

  test('SN-07c _isOffline na lista de campos enviados reprova', () => {
    const d = projeto({
      'src/apis/setores/setorNativePort.js':
        PORTA_OK.replace("['empresa_id', 'nome', 'tipo']", "['empresa_id', 'nome', 'tipo', '_isOffline']"),
    });
    falhaCom(d, 'P41-SETOR-OFFLINE-ID');
    cleanup(d);
  });
});

describe('SN-08 · P41-SETOR-FALLBACK', () => {
  test('SN-08a catch silencioso na porta reprova', () => {
    const d = projeto({
      'src/apis/setores/setorNativePort.js':
        PORTA_OK + '\nexport const seguro = async () => { try { return await setorPort.list(); } catch {} };\n',
    });
    falhaCom(d, 'P41-SETOR-FALLBACK');
    cleanup(d);
  });

  test('SN-08b queda para a Base44 em caso de erro reprova', () => {
    const d = projeto({
      'src/apis/setores/setoresApi.js':
        API_MODULO_OK +
        '\nexport const listarComFallback = async () => {\n' +
        '  try { return await setorPort.list(); }\n' +
        '  catch (erro) { return setoresProvider.list(); }\n' +
        '};\n',
    });
    falhaCom(d, 'P41-SETOR-FALLBACK');
    cleanup(d);
  });

  test('SN-08c transporte que deixa de sinalizar indisponibilidade reprova', () => {
    const d = projeto({
      'src/apis/_core/nativeHttpClient.js':
        'export const nativeRequest = async () => (getNativeApiUrl() ? null : []);\n',
    });
    falhaCom(d, 'P41-SETOR-FALLBACK');
    cleanup(d);
  });

  test('SN-08d controle positivo: catch que RELANÇA continua passando', () => {
    const d = projeto({
      'src/apis/setores/setoresApi.js':
        API_MODULO_OK +
        '\nexport const listarComContexto = async () => {\n' +
        '  try { return await setorPort.list(); }\n' +
        '  catch (erro) { throw erro; }\n' +
        '};\n',
    });
    passa(d);
    cleanup(d);
  });
});

describe('SN-09 · P41-SETOR-AUDIT', () => {
  test('SN-09a escrita sem auditoria reprova', () => {
    const d = projeto({
      'backend/src/modules/setores/setorService.js':
        SERVICE_BACKEND_OK.replace(/await registrarEvento\([\s\S]*?\n    \);/g, '')
          .replace(/import \{ registrarEvento \}.*\n/, ''),
    });
    falhaCom(d, 'P41-SETOR-AUDIT');
    cleanup(d);
  });

  test('SN-09b auditoria fora da transação da escrita reprova', () => {
    const d = projeto({
      'backend/src/modules/setores/setorService.js':
        SERVICE_BACKEND_OK.replace(/\n      tx\n    \);/g, '\n    );'),
    });
    falhaCom(d, 'P41-SETOR-AUDIT');
    cleanup(d);
  });
});

describe('SN-10 · P41-SETOR-ROUTE-AUTH', () => {
  test('SN-10a rota de leitura pública reprova', () => {
    const d = projeto({
      'backend/src/modules/setores/setorRoutes.js':
        ROTAS_OK.replace("app.get('/setores', { onRequest: [app.autenticar] }", "app.get('/setores', { }"),
    });
    falhaCom(d, 'P41-SETOR-ROUTE-AUTH');
    cleanup(d);
  });

  test('SN-10b rota de escrita pública reprova', () => {
    const d = projeto({
      'backend/src/modules/setores/setorRoutes.js':
        ROTAS_OK.replace("  app.post('/setores', {\n    onRequest: [app.autenticar],\n", "  app.post('/setores', {\n"),
    });
    falhaCom(d, 'P41-SETOR-ROUTE-AUTH');
    cleanup(d);
  });
});

describe('gate:setor-native — contrato do gate', () => {
  test('SN-11 o gate é absoluto: não lê flag e não escreve arquivo', () => {
    const fonte = readFileSync(join(GATES_DIR, GATE), 'utf8');

    // A verificação é sobre o que o gate **faz**, não sobre as palavras que ele
    // usa. O cabeçalho dele diz "sem `--update`" e a mensagem de reprovação
    // repete a frase para quem trombar no gate; casar com o texto reprovaria a
    // documentação escrita para explicar a regra — a mesma armadilha que
    // `semComentarios` evita dentro do próprio gate.
    for (const forma of [
      'process.argv',
      'writeFileSync',
      'writeJsonAtomic',
      'appendFileSync',
      'mkdirSync',
      'rmSync',
    ]) {
      assert.equal(fonte.includes(forma), false, `o gate usa "${forma}" — ele nunca lê flag nem escreve`);
    }
  });

  test('SN-12 o repositório real passa no gate', () => {
    const r = runGate(GATE);
    assert.equal(r.status, 0, r.output);
  });
});

/**
 * SN-13–SN-18 · P41-SETOR-OFFLINE-TENANT (P4.1-R1).
 *
 * Regra que veio de revisão, não de análise: a P4.1 fez o replay mandar
 * `Authorization: Bearer` do MAIKE, e cache e fila continuavam particionados só
 * por `entidade::empresa`. Como `logout()` não limpa o IndexedDB, a operação
 * enfileirada por um cliente era aplicada dentro do próximo que entrasse — o
 * backend grava pelo tenant do token (R11), e quem errou foi o cliente.
 *
 * A regra exige as **três** pontas: a porta declara o escopo, o runtime decide
 * o destino de cada entrada, e a sessão marca e descarta o dono. Cobrir só uma
 * seria decorativo — daí uma mutilação por ponta.
 */
describe('P41-SETOR-OFFLINE-TENANT', () => {
  test('SN-13 porta sem tenantScoped reprova', () => {
    const d = projeto({
      'src/apis/setores/setorNativePort.js': PORTA_OK.replace('  tenantScoped: true,\n', ''),
    });
    falhaCom(d, 'P41-SETOR-OFFLINE-TENANT');
    cleanup(d);
  });

  test('SN-14 tenantScoped: false reprova — declarar não basta, tem de ser true', () => {
    const d = projeto({
      'src/apis/setores/setorNativePort.js': PORTA_OK.replace('tenantScoped: true', 'tenantScoped: false'),
    });
    falhaCom(d, 'P41-SETOR-OFFLINE-TENANT');
    cleanup(d);
  });

  test('SN-15 runtime que não lê o dono da sessão reprova', () => {
    const d = projeto({
      'src/lib/offline/offlineEntityRuntime.js':
        RUNTIME_OFFLINE_OK.replaceAll('getOfflineTenant(', 'semDono('),
    });
    falhaCom(d, 'P41-SETOR-OFFLINE-TENANT');
    cleanup(d);
  });

  test('SN-16 runtime que não decide o destino da entrada reprova', () => {
    // A mutilação que mais parece inofensiva: o runtime continua sabendo o
    // tenant, mas volta a despachar tudo que está na fila.
    const d = projeto({
      'src/lib/offline/offlineEntityRuntime.js':
        RUNTIME_OFFLINE_OK.replaceAll('destinoDaEntrada(', 'aplicarSempre('),
    });
    falhaCom(d, 'P41-SETOR-OFFLINE-TENANT');
    cleanup(d);
  });

  test('SN-17 sessão que não descarta o dono no logout reprova', () => {
    const d = projeto({
      'src/apis/session/nativeSessionApi.js':
        SESSAO_OK.replaceAll('clearOfflineTenant(', 'naoLimpa('),
    });
    falhaCom(d, 'P41-SETOR-OFFLINE-TENANT');
    cleanup(d);
  });

  test('SN-18 CONTROLE POSITIVO: a fixture correta não emite o código', () => {
    // Sem este caso a regra poderia estar reprovando por scanner ingênuo — o
    // erro que este projeto já cometeu quatro vezes.
    const d = projeto();
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    assert.doesNotMatch(r.output, /P41-SETOR-OFFLINE-TENANT/);
    cleanup(d);
  });
});
