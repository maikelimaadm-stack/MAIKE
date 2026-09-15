/**
 * Provas do `gate:area-pastagem-native` (P4.2, D-PROD-30).
 *
 * A regra da P2-R1 governa este arquivo: uma invariante não está protegida
 * porque o código correto passa — ela está protegida quando o código
 * **mutilado reprova**, com o código de falha certo.
 *
 * E cada regra tem também **controle positivo**: uma variação legítima que
 * precisa CONTINUAR passando. Sem eles o gate viraria um scanner ingênuo — erro
 * que este repositório já cometeu cinco vezes, a última no próprio regex de
 * medição da P4.1-R2.
 *
 * As duas mutilações que mais importam aqui são as que a P4.2 fecha pela
 * primeira vez:
 *
 *   AN-02  FK só por `setor_id`. Continua listando, criando e passando em todo
 *          teste de navegador único — e aceita, no banco, área de um cliente
 *          apontando para setor de outro;
 *   AN-04  `setor_nome` vindo do corpo. Funciona perfeitamente até alguém
 *          renomear um setor.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanup, writeFile, runGate } from './helpers.mjs';

const GATE = 'gate-area-pastagem-native.mjs';

const rodar = (dir) => runGate(GATE, { env: { AREA_NATIVE_ROOT: dir } });

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
  areas     AreaPastagem[]
}

model Setor {
  id         String   @id @default(cuid())
  cliente_id String   @db.VarChar(64)
  nome       String   @db.VarChar(255)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  cliente Cliente        @relation(fields: [cliente_id], references: [id], onDelete: Restrict)
  areas   AreaPastagem[]

  @@unique([cliente_id, id])
}

model AreaPastagem {
  id          String   @id @default(cuid())
  cliente_id  String   @db.VarChar(64)
  empresa_id  String   @db.VarChar(64)
  setor_id    String   @db.VarChar(64)
  setor_nome  String   @db.VarChar(255)
  numero_area String   @db.VarChar(32)
  nome        String   @db.VarChar(255)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  cliente Cliente @relation(fields: [cliente_id], references: [id], onDelete: Restrict)
  setor   Setor   @relation(fields: [cliente_id, setor_id], references: [cliente_id, id], onDelete: Restrict)

  @@unique([cliente_id, numero_area])
  @@unique([cliente_id, id])
  @@index([cliente_id, empresa_id])
  @@index([cliente_id, setor_id])
}
`;

const MIGRATION_OK = 'CREATE TABLE "AreaPastagem" (\n  "id" TEXT NOT NULL\n);\n';

const ROTAS_OK = `
import { listar, criar, atualizar } from './areaPastagemService.js';

const CAMPOS = { nome: { type: 'string' } };

export const registrarAreaPastagemRoutes = async (app) => {
  app.get('/areas-pastagem', { onRequest: [app.autenticar] }, async (request) => {
    return listar(request.contexto);
  });

  app.post('/areas-pastagem', {
    onRequest: [app.autenticar],
    schema: { body: { type: 'object', additionalProperties: false, properties: CAMPOS } },
  }, async (request, reply) => {
    return reply.status(201).send(await criar(request.contexto, request.body));
  });

  app.patch('/areas-pastagem/:id', {
    onRequest: [app.autenticar],
    schema: {
      params: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } } },
      body: { type: 'object', additionalProperties: false, properties: CAMPOS },
    },
  }, async (request) => {
    return atualizar(request.contexto, request.params.id, request.body);
  });
};
`;

const SERVICE_BACKEND_OK = `
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { buscarSetor } from '../setores/setorRepository.js';
import { inserirArea } from './areaPastagemRepository.js';

const CAMPOS_EDITAVEIS = Object.freeze({
  empresa_id: (v) => v,
  setor_id: (v) => v,
  nome: (v) => v,
});

export const listar = async (contexto) => [];

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto.auth);
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const setor = await buscarSetor(auth.clienteId, entrada.setor_id, tx);
    const numero = await reservarNumero(tx, {
      clienteId: auth.clienteId,
      entidade: 'AreaPastagem',
      escopoTipo: ESCOPO_TENANT,
    });
    const registro = await inserirArea(tx, {
      cliente_id: auth.clienteId,
      numero_area: String(numero),
      setor_nome: setor.nome,
    });
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'AreaPastagem', entidadeId: registro.id },
      tx
    );
    return registro;
  });
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto.auth);
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    await registrarEvento(
      contexto,
      { acao: 'update', entidade: 'AreaPastagem', entidadeId: id },
      tx
    );
    return { id };
  });
};
`;

const SERVICE_SETOR_OK = `
import { propagarNomeDoSetor } from '../areas/areaPastagemRepository.js';

export const atualizar = async (contexto, id, entrada) => {
  await propagarNomeDoSetor(null, 'c', id, entrada.nome);
  return { id };
};
`;

const REPOSITORIO_OK = `
export const inserirArea = async (tx, dados) => tx.areaPastagem.create({ data: dados });

export const buscarArea = async (clienteId, id, tx) =>
  tx.areaPastagem.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } });

export const propagarNomeDoSetor = async (tx, clienteId, setorId, setorNome) =>
  tx.areaPastagem.updateMany({
    where: { cliente_id: clienteId, setor_id: setorId },
    data: { setor_nome: setorNome },
  });
`;

const PORTA_OK = `
import { nativeRequest } from '../_core/nativeHttpClient.js';
import { createOfflineEntityAdapter, offlineStorageDisponivel } from '@/lib/offline/offlineEntityRuntime';

const CAMPOS_DE_CRIACAO = ['empresa_id', 'setor_id', 'nome'];

export const corpoDeEnvio = (dados, permitidos) => {
  const corpo = {};
  for (const campo of permitidos) {
    if (Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) corpo[campo] = dados[campo];
  }
  return corpo;
};

export const filtrarEmMemoria = (registros, criterio) =>
  registros.filter((r) => Object.entries(criterio ?? {}).every(([c, v]) => r?.[c] === v));

export const operacoesNativas = Object.freeze({
  list: () => nativeRequest('/areas-pastagem', { autenticado: true }, { operation: 'listAreas', resource: 'AreaPastagem' }),
  create: (dados) => nativeRequest('/areas-pastagem', {
    method: 'POST',
    body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO),
    autenticado: true,
  }, { operation: 'createArea', resource: 'AreaPastagem' }),
  update: (id, dados) => nativeRequest(\`/areas-pastagem/\${id}\`, {
    method: 'PATCH',
    body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO),
    autenticado: true,
  }, { operation: 'updateArea', resource: 'AreaPastagem' }),
});

export const areaPastagemPort = createOfflineEntityAdapter({
  entityName: 'AreaPastagem',
  operations: operacoesNativas,
  enabled: offlineStorageDisponivel(),
  tenantScoped: true,
});
`;

const API_MODULO_OK = `
import { runProviderCall } from '../_core/normalizeApiError.js';
import { areaPastagemPort, filtrarEmMemoria } from './areaPastagemNativePort.js';

export const listAreas = async () =>
  runProviderCall(() => areaPastagemPort.list(), { operation: 'listAreas', resource: 'AreaPastagem' });

export const filterAreas = async (criterio) =>
  filtrarEmMemoria(await listAreas(), criterio);
`;

const MAPA_API_OK = `
import { mapaProvider } from '../_providers/base44Provider.js';

export { listAreas, filterAreas, createArea, updateArea } from '@/apis/areas';

export const listPontos = async () => mapaProvider.listPontos();
`;

const SUPLEMENTACAO_API_OK = `
export { listAreas } from '@/apis/areas';
`;

const PROVIDER_OK = `
const ENTITY_REGISTRY = Object.freeze({
  PontoReferencia: comFronteira('PontoReferencia', base44.entities.PontoReferencia),
});

export const mapaProvider = Object.freeze({
  listPontos: (ordenacao) => endpointOf('PontoReferencia').list(ordenacao),
});
`;

/** Monta o projeto mínimo aprovado e devolve o diretório. */
const projetoOk = () => {
  const dir = makeTempDir('maike-area-gate-');
  writeFile(dir, 'backend/prisma/schema.prisma', SCHEMA_OK);
  writeFile(dir, 'backend/prisma/migrations/20260910190000_p4_2/migration.sql', MIGRATION_OK);
  writeFile(dir, 'backend/src/modules/areas/areaPastagemRoutes.js', ROTAS_OK);
  writeFile(dir, 'backend/src/modules/areas/areaPastagemService.js', SERVICE_BACKEND_OK);
  writeFile(dir, 'backend/src/modules/areas/areaPastagemRepository.js', REPOSITORIO_OK);
  writeFile(dir, 'backend/src/modules/setores/setorService.js', SERVICE_SETOR_OK);
  writeFile(dir, 'src/apis/areas/areaPastagemNativePort.js', PORTA_OK);
  writeFile(dir, 'src/apis/areas/areasApi.js', API_MODULO_OK);
  writeFile(dir, 'src/apis/mapa/mapaApi.js', MAPA_API_OK);
  writeFile(dir, 'src/apis/suplementacao/suplementacaoApi.js', SUPLEMENTACAO_API_OK);
  writeFile(dir, 'src/apis/_providers/base44Provider.js', PROVIDER_OK);
  return dir;
};

/** Roda um cenário sobre uma cópia do projeto e limpa depois. */
const cenario = (mutilar, verificar) => {
  const dir = projetoOk();
  try {
    if (mutilar) mutilar(dir);
    verificar(dir);
  } finally {
    cleanup(dir);
  }
};

// ---------------------------------------------------------------------------

describe('AN-00 — o projeto correto passa', () => {
  test('AN-T00 fixture íntegra é aprovada', () => {
    cenario(null, passa);
  });
});

describe('AN-01 · P42-AREA-MODEL', () => {
  test('AN-T01 model ausente reprova', () => {
    cenario(
      (dir) => writeFile(dir, 'backend/prisma/schema.prisma', 'model Cliente {\n  id String @id\n}\n'),
      (dir) => falhaCom(dir, 'P42-AREA-MODEL')
    );
  });

  test('AN-T02 sem @@unique([cliente_id, numero_area]) reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/prisma/schema.prisma',
          SCHEMA_OK.replace('  @@unique([cliente_id, numero_area])\n', '')
        ),
      (dir) => falhaCom(dir, 'P42-AREA-MODEL')
    );
  });

  test('AN-T03 sem migration que cria a tabela reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/prisma/migrations/20260910190000_p4_2/migration.sql',
          'CREATE TABLE "OutraCoisa" ("id" TEXT);\n'
        ),
      (dir) => falhaCom(dir, 'P42-AREA-MODEL')
    );
  });

  test('AN-T04 empresa_id como relação reprova (Empresa nativa é P6)', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/prisma/schema.prisma',
          SCHEMA_OK.replace(
            '  empresa_id  String   @db.VarChar(64)',
            '  empresa_id  Empresa  @relation(fields: [x], references: [id])'
          )
        ),
      (dir) => falhaCom(dir, 'P42-AREA-MODEL')
    );
  });
});

describe('AN-02 · P42-AREA-FK — a mutilação que passa em verde', () => {
  test('AN-T05 FK só por setor_id reprova', () => {
    // O defeito: `@relation(fields: [setor_id], references: [id])`. Lista,
    // cria, edita e passa em todo teste de navegador único — e aceita área de
    // um cliente vinculada a setor de outro.
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/prisma/schema.prisma',
          SCHEMA_OK.replace(
            'setor   Setor   @relation(fields: [cliente_id, setor_id], references: [cliente_id, id], onDelete: Restrict)',
            'setor   Setor   @relation(fields: [setor_id], references: [id], onDelete: Restrict)'
          )
        ),
      (dir) => falhaCom(dir, 'P42-AREA-FK')
    );
  });

  test('AN-T06 FK composta na ORDEM ERRADA reprova', () => {
    // `[setor_id, cliente_id]` contém exatamente os mesmos caracteres da forma
    // correta. Só a ordem casa com `references: [cliente_id, id]` — um gate que
    // procurasse substring aprovaria isto.
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/prisma/schema.prisma',
          SCHEMA_OK.replace(
            'fields: [cliente_id, setor_id], references: [cliente_id, id]',
            'fields: [setor_id, cliente_id], references: [id, cliente_id]'
          )
        ),
      (dir) => falhaCom(dir, 'P42-AREA-FK')
    );
  });

  test('AN-T07 onDelete Cascade reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/prisma/schema.prisma',
          SCHEMA_OK.replace(
            'references: [cliente_id, id], onDelete: Restrict)\n\n  @@unique([cliente_id, numero_area])',
            'references: [cliente_id, id], onDelete: Cascade)\n\n  @@unique([cliente_id, numero_area])'
          )
        ),
      (dir) => falhaCom(dir, 'P42-AREA-FK')
    );
  });

  test('AN-T08 sem @@index([cliente_id, setor_id]) reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/prisma/schema.prisma',
          SCHEMA_OK.replace('  @@index([cliente_id, setor_id])\n', '')
        ),
      (dir) => falhaCom(dir, 'P42-AREA-FK')
    );
  });
});

describe('AN-03 · P42-AREA-NUMBERING', () => {
  test('AN-T09 service sem reservarNumero reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/areas/areaPastagemService.js',
          SERVICE_BACKEND_OK.replace(/const numero = await reservarNumero\([\s\S]*?\}\);/, 'const numero = 1;')
        ),
      (dir) => falhaCom(dir, 'P42-AREA-NUMBERING')
    );
  });

  test('AN-T10 service sem $transaction reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/areas/areaPastagemService.js',
          SERVICE_BACKEND_OK.split('$transaction').join('semTransacao')
        ),
      (dir) => falhaCom(dir, 'P42-AREA-NUMBERING')
    );
  });

  test('AN-T11 MAX + 1 de volta no frontend reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'src/apis/areas/areasApi.js',
          `${API_MODULO_OK}\nexport const proximo = (lista) => ({ numero_area: Math.max(...lista) + 1 });\n`
        ),
      (dir) => falhaCom(dir, 'P42-AREA-NUMBERING')
    );
  });
});

describe('AN-04 · P42-AREA-SETOR-NOME — a divergência silenciosa', () => {
  test('AN-T12 service que não lê o setor reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/areas/areaPastagemService.js',
          SERVICE_BACKEND_OK.replace(
            'const setor = await buscarSetor(auth.clienteId, entrada.setor_id, tx);',
            'const setor = { nome: entrada.setor_nome };'
          )
        ),
      (dir) => falhaCom(dir, 'P42-AREA-SETOR-NOME')
    );
  });

  test('AN-T13 setor_nome entre os campos editáveis reprova', () => {
    // É a forma exata do defeito: o corpo volta a mandar no valor derivado.
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/areas/areaPastagemService.js',
          SERVICE_BACKEND_OK.replace('  nome: (v) => v,\n', '  nome: (v) => v,\n  setor_nome: (v) => v,\n')
        ),
      (dir) => falhaCom(dir, 'P42-AREA-SETOR-NOME')
    );
  });

  test('AN-T14 rota que aceita setor_nome reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/areas/areaPastagemRoutes.js',
          ROTAS_OK.replace(
            "const CAMPOS = { nome: { type: 'string' } };",
            "const CAMPOS = { nome: { type: 'string' }, setor_nome: { type: 'string' } };"
          )
        ),
      (dir) => falhaCom(dir, 'P42-AREA-SETOR-NOME')
    );
  });

  test('AN-T15 porta que envia setor_nome reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'src/apis/areas/areaPastagemNativePort.js',
          PORTA_OK.replace(
            "const CAMPOS_DE_CRIACAO = ['empresa_id', 'setor_id', 'nome'];",
            "const CAMPOS_DE_CRIACAO = ['empresa_id', 'setor_id', 'setor_nome', 'nome'];"
          )
        ),
      (dir) => falhaCom(dir, 'P42-AREA-SETOR-NOME')
    );
  });

  test('AN-T16 renomear setor sem propagar reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/setores/setorService.js',
          'export const atualizar = async (contexto, id) => ({ id });\n'
        ),
      (dir) => falhaCom(dir, 'P42-AREA-SETOR-NOME')
    );
  });

  test('AN-T16b CONTROLE POSITIVO: prosa citando setor_nome não reprova', () => {
    // O gate remove comentários antes de decidir. Sem isso, esta base de código
    // — que documenta a forma proibida para impedi-la — reprovaria a si mesma.
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/areas/areaPastagemRoutes.js',
          `/**\n * O cliente NUNCA manda setor_nome: o servidor o deriva.\n */\n${ROTAS_OK}`
        ),
      passa
    );
  });
});

describe('AN-05 · P42-AREA-BASE44', () => {
  test('AN-T17 provider que ainda resolve endpoint de AreaPastagem reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'src/apis/_providers/base44Provider.js',
          `${PROVIDER_OK}\nexport const x = () => endpointOf('AreaPastagem').list();\n`
        ),
      (dir) => falhaCom(dir, 'P42-AREA-BASE44')
    );
  });

  test('AN-T18 registry com AreaPastagem reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'src/apis/_providers/base44Provider.js',
          PROVIDER_OK.replace(
            '  PontoReferencia:',
            "  AreaPastagem: comFronteira('AreaPastagem', base44.entities.AreaPastagem),\n  PontoReferencia:"
          )
        ),
      (dir) => falhaCom(dir, 'P42-AREA-BASE44')
    );
  });

  test('AN-T19 consumidor que volta a chamar mapaProvider.listAreas reprova', () => {
    cenario(
      (dir) => writeFile(dir, 'src/services/mapaService.js', 'export const x = () => mapaProvider.listAreas();\n'),
      (dir) => falhaCom(dir, 'P42-AREA-BASE44')
    );
  });
});

describe('AN-06 · P42-AREA-PORT', () => {
  test('AN-T20 porta sem nativeRequest reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'src/apis/areas/areaPastagemNativePort.js',
          PORTA_OK.split('nativeRequest').join('fetchQualquer')
        ),
      (dir) => falhaCom(dir, 'P42-AREA-PORT')
    );
  });

  test('AN-T21 porta que declara delete reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'src/apis/areas/areaPastagemNativePort.js',
          PORTA_OK.replace('  update: (id, dados)', "  delete: (id) => nativeRequest('/x'),\n  update: (id, dados)")
        ),
      (dir) => falhaCom(dir, 'P42-AREA-PORT')
    );
  });
});

describe('AN-07 · P42-AREA-TENANT-SOURCE', () => {
  test('AN-T22 tenant vindo do body reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/areas/areaPastagemService.js',
          SERVICE_BACKEND_OK.replace('cliente_id: auth.clienteId,', 'cliente_id: contexto.body.cliente_id,')
        ),
      (dir) => falhaCom(dir, 'P42-AREA-TENANT-SOURCE')
    );
  });

  test('AN-T23 repositório lendo por id solto reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/areas/areaPastagemRepository.js',
          REPOSITORIO_OK.replace(
            'tx.areaPastagem.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } })',
            'tx.areaPastagem.findUnique({ where: { id } })'
          )
        ),
      (dir) => falhaCom(dir, 'P42-AREA-TENANT-SOURCE')
    );
  });

  test('AN-T24 service sem exigirAuthContext reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/areas/areaPastagemService.js',
          SERVICE_BACKEND_OK.split('exigirAuthContext').join('pegarAuth')
        ),
      (dir) => falhaCom(dir, 'P42-AREA-TENANT-SOURCE')
    );
  });
});

describe('AN-08 · P42-AREA-FALLBACK', () => {
  test('AN-T25 catch que cai para a Base44 reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'src/apis/areas/areasApi.js',
          `${API_MODULO_OK}\nexport const resiliente = async () => {\n  try { return await listAreas(); } catch { return mapaProvider.listAreas(); }\n};\n`
        ),
      (dir) => falhaCom(dir, 'P42-AREA-FALLBACK')
    );
  });

  test('AN-T25b CONTROLE POSITIVO: catch que não cai para a Base44 passa', () => {
    // `try/catch` não é proibido — cair para o sistema antigo é.
    cenario(
      (dir) =>
        writeFile(
          dir,
          'src/apis/areas/areasApi.js',
          `${API_MODULO_OK}\nexport const seguro = async () => {\n  try { return await listAreas(); } catch (e) { throw e; }\n};\n`
        ),
      passa
    );
  });
});

describe('AN-09 · P42-AREA-AUDIT', () => {
  test('AN-T26 atualização sem auditoria reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/areas/areaPastagemService.js',
          SERVICE_BACKEND_OK.replace(
            /export const atualizar[\s\S]*$/,
            'export const atualizar = async (contexto, id) => ({ id });\n'
          )
        ),
      (dir) => falhaCom(dir, 'P42-AREA-AUDIT')
    );
  });
});

describe('AN-10 · P42-AREA-ROUTE-AUTH', () => {
  test('AN-T27 rota anônima reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/areas/areaPastagemRoutes.js',
          ROTAS_OK.replace("app.get('/areas-pastagem', { onRequest: [app.autenticar] }", "app.get('/areas-pastagem', {}")
        ),
      (dir) => falhaCom(dir, 'P42-AREA-ROUTE-AUTH')
    );
  });

  test('AN-T28 DELETE de área reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/areas/areaPastagemRoutes.js',
          `${ROTAS_OK}\nexport const extra = (app) => app.delete('/areas-pastagem/:id', { onRequest: [app.autenticar] }, async () => ({}));\n`
        ),
      (dir) => falhaCom(dir, 'P42-AREA-ROUTE-AUTH')
    );
  });

  test('AN-T29 schema aberto reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'backend/src/modules/areas/areaPastagemRoutes.js',
          ROTAS_OK.replace('additionalProperties: false', 'additionalProperties: true')
        ),
      (dir) => falhaCom(dir, 'P42-AREA-ROUTE-AUTH')
    );
  });
});

describe('AN-11 · P42-AREA-OFFLINE-TENANT', () => {
  test('AN-T30 fila offline sem dono reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'src/apis/areas/areaPastagemNativePort.js',
          PORTA_OK.replace('  tenantScoped: true,\n', '')
        ),
      (dir) => falhaCom(dir, 'P42-AREA-OFFLINE-TENANT')
    );
  });
});

describe('AN-12 · P42-AREA-SINGLE-OWNER', () => {
  test('AN-T31 mapa com leitura própria de área reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'src/apis/mapa/mapaApi.js',
          "import { mapaProvider } from '../_providers/base44Provider.js';\n\nexport const listAreas = async () => mapaProvider.listPontos();\n"
        ),
      (dir) => falhaCom(dir, 'P42-AREA-SINGLE-OWNER')
    );
  });

  test('AN-T32 suplementação com leitura própria de área reprova', () => {
    cenario(
      (dir) =>
        writeFile(
          dir,
          'src/apis/suplementacao/suplementacaoApi.js',
          'export const listAreas = async () => [];\n'
        ),
      (dir) => falhaCom(dir, 'P42-AREA-SINGLE-OWNER')
    );
  });
});
