#!/usr/bin/env node
/**
 * Gate: tenancy do schema Prisma e do backend.
 *
 * Absoluto, como os gates da P2: sem `--update`, sem baseline, sem correção
 * automática. Ele nunca escreve no schema nem em qualquer arquivo.
 *
 * A regra herdada da auditoria P2-R1 governa o desenho: uma invariante não está
 * protegida porque o schema correto passa — ela está protegida quando o schema
 * **mutilado reprova** com o código certo. Cada exigência daqui tem prova
 * negativa própria em `scripts/tests/gates/tenancy.test.mjs`.
 *
 * Códigos:
 *   P3-TEN-SCHEMA-MISSING · P3-TEN-ROOT-CONTRACT · P3-TEN-FIELD
 *   P3-TEN-RELATION · P3-TEN-CROSS-RELATION · P3-TEN-BUSINESS-UNIQUE
 *   P3-TEN-SOURCE · P3-TEN-BASE44 · P3-TEN-IDENTITY · P3-TEN-TIMESTAMPS
 *   P3-TEN-RUNTIME-IDENTITY
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { lerModels, campo } from './lib/prisma-schema.mjs';

const ROOT = process.env.TENANCY_ROOT || process.cwd();
const SCHEMA = process.env.TENANCY_SCHEMA || 'backend/prisma/schema.prisma';
const BACKEND_SRC = process.env.TENANCY_BACKEND_SRC || 'backend/src';
const CONTRATO = process.env.TENANCY_CONTRACT || 'config/modelobase1-pecuario.json';

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push({ codigo, mensagem });

const reprovar = () => {
  console.error('gate:tenancy — FALHOU\n');
  falhas.forEach((f) => console.error(`  - [${f.codigo}] ${f.mensagem}`));
  console.error(`\n  ${falhas.length} violação(ões) de tenancy.`);
  console.error('  O gate é absoluto: não existe --update, baseline nem correção automática.');
  process.exit(1);
};

// ---------------------------------------------------------------------------
// Contrato — a fonte das constantes, para o gate não inventar regra própria
// ---------------------------------------------------------------------------

const lerContrato = () => {
  const caminho = join(ROOT, CONTRATO);
  if (!existsSync(caminho)) return null;
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
};

const contrato = lerContrato();
const tenancyDoContrato = contrato?.tenancy || {};

const ROOT_MODEL = tenancyDoContrato.rootModel || 'Cliente';
const TENANT_FIELD = tenancyDoContrato.tenantField || 'cliente_id';
const EXCECOES_AUTORIZADAS = Array.isArray(tenancyDoContrato.modelsWithoutTenantField)
  ? tenancyDoContrato.modelsWithoutTenantField
  : [ROOT_MODEL];
/** As CINCO fontes proibidas de tenant. Distintas das quatro do ator. */
const FONTES_PROIBIDAS_DE_TENANT = Array.isArray(tenancyDoContrato.forbiddenTenantSources)
  ? tenancyDoContrato.forbiddenTenantSources
  : ['body', 'query', 'params', 'headers', 'cookie'];

// ---------------------------------------------------------------------------
// 1. Schema presente e legível
// ---------------------------------------------------------------------------

const caminhoSchema = join(ROOT, SCHEMA);

if (!existsSync(caminhoSchema)) {
  registrar('P3-TEN-SCHEMA-MISSING', `schema Prisma ausente: ${SCHEMA}`);
  reprovar();
}

let models;
try {
  models = lerModels(readFileSync(caminhoSchema, 'utf8'));
} catch (error) {
  registrar('P3-TEN-SCHEMA-MISSING', `não foi possível interpretar ${SCHEMA}: ${error.message}`);
  reprovar();
}

if (!models.length) {
  registrar('P3-TEN-SCHEMA-MISSING', `${SCHEMA} não declara nenhum model`);
  reprovar();
}

const nomesDeModel = new Set(models.map((m) => m.nome));

// ---------------------------------------------------------------------------
// 2. Root: exatamente as exceções autorizadas — nem mais, nem outras
// ---------------------------------------------------------------------------

if (!nomesDeModel.has(ROOT_MODEL)) {
  registrar('P3-TEN-ROOT-CONTRACT', `model raiz "${ROOT_MODEL}" não existe no schema`);
}

const semTenantField = models
  .filter((m) => !campo(m, TENANT_FIELD))
  .map((m) => m.nome)
  .sort();

const excecoesNaoAutorizadas = semTenantField.filter((n) => !EXCECOES_AUTORIZADAS.includes(n));
if (excecoesNaoAutorizadas.length) {
  registrar(
    'P3-TEN-ROOT-CONTRACT',
    `model(s) sem ${TENANT_FIELD} além da raiz autorizada: ${excecoesNaoAutorizadas.join(', ')}. ` +
      `Única exceção permitida: ${EXCECOES_AUTORIZADAS.join(', ')} (D-PROD-22)`
  );
}

// A raiz não pode ter cliente_id autorreferente — proibição explícita da D-PROD-22.
const rootModel = models.find((m) => m.nome === ROOT_MODEL);
if (rootModel && campo(rootModel, TENANT_FIELD)) {
  registrar(
    'P3-TEN-ROOT-CONTRACT',
    `"${ROOT_MODEL}" é a raiz do tenant e não pode declarar ${TENANT_FIELD} autorreferente`
  );
}

const tenantModels = models.filter((m) => !EXCECOES_AUTORIZADAS.includes(m.nome));

// ---------------------------------------------------------------------------
// 3. cliente_id obrigatório e não nulo em todo model tenant-scoped
// ---------------------------------------------------------------------------

for (const model of tenantModels) {
  const tenant = campo(model, TENANT_FIELD);
  if (!tenant) {
    registrar('P3-TEN-FIELD', `${model.nome} não declara ${TENANT_FIELD}`);
    continue;
  }
  if (tenant.opcional) {
    registrar(
      'P3-TEN-FIELD',
      `${model.nome}.${TENANT_FIELD} é opcional (${tenant.tipo}?) — precisa ser obrigatório`
    );
  }
  if (tenant.tipo !== 'String') {
    registrar(
      'P3-TEN-FIELD',
      `${model.nome}.${TENANT_FIELD} deve ser String — encontrado ${tenant.tipo}`
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Relação com a raiz, declarada sobre cliente_id
// ---------------------------------------------------------------------------

for (const model of tenantModels) {
  if (!campo(model, TENANT_FIELD)) continue;

  const relacao = model.campos.find(
    (c) => c.tipo === ROOT_MODEL && !c.lista && new RegExp(`fields:\\s*\\[\\s*${TENANT_FIELD}\\s*\\]`).test(c.atributos)
  );

  if (!relacao) {
    registrar(
      'P3-TEN-RELATION',
      `${model.nome} não declara relação com ${ROOT_MODEL} sobre ${TENANT_FIELD}`
    );
    continue;
  }

  if (relacao.opcional) {
    registrar(
      'P3-TEN-RELATION',
      `${model.nome}.${relacao.nome} é opcional — a relação com a raiz do tenant não pode ser nullable`
    );
  }
}

// ---------------------------------------------------------------------------
// 4b. Relação entre models tenant-scoped não pode cruzar clientes
//
// O contrato declara `crossTenantRelationsAllowed = false`, e manda a
// constraint ser a última barreira. Uma FK de model tenant-scoped para outro
// model tenant-scoped precisa carregar `cliente_id` na chave — senão o banco
// aceita um registro do Cliente A apontando para uma linha do Cliente B, e a
// única coisa que impede é o service estar certo. Regra que depende disso não é
// barreira, é convenção.
// ---------------------------------------------------------------------------

const RELACAO_FIELDS = /fields:\s*\[([^\]]*)\]/;
const RELACAO_REFERENCES = /references:\s*\[([^\]]*)\]/;

const colunasDe = (texto, regex) => {
  const match = regex.exec(texto);
  if (!match) return null;
  return match[1]
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean);
};

for (const model of tenantModels) {
  for (const c of model.campos) {
    // Só relações declaradas (com `fields:`) para OUTRO model tenant-scoped.
    if (c.lista || !nomesDeModel.has(c.tipo)) continue;
    if (c.tipo === ROOT_MODEL) continue;
    if (EXCECOES_AUTORIZADAS.includes(c.tipo)) continue;
    if (!/@relation\s*\(/.test(c.atributos)) continue;

    const fields = colunasDe(c.atributos, RELACAO_FIELDS);
    const references = colunasDe(c.atributos, RELACAO_REFERENCES);
    if (!fields || !references) continue;

    if (!fields.includes(TENANT_FIELD) || !references.includes(TENANT_FIELD)) {
      registrar(
        'P3-TEN-CROSS-RELATION',
        `${model.nome}.${c.nome} -> ${c.tipo}: @relation(fields: [${fields.join(', ')}], ` +
          `references: [${references.join(', ')}]) não é tenant-aware. Relação entre models ` +
          `tenant-scoped precisa incluir ${TENANT_FIELD} nos dois lados, senão o banco aceita ` +
          'registro de um cliente apontando para linha de outro'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Unique de negócio inclui o tenant
// ---------------------------------------------------------------------------

for (const model of tenantModels) {
  for (const colunas of model.uniques) {
    if (!colunas.includes(TENANT_FIELD)) {
      registrar(
        'P3-TEN-BUSINESS-UNIQUE',
        `${model.nome}: @@unique([${colunas.join(', ')}]) não inclui ${TENANT_FIELD}`
      );
    }
  }

  // `@unique` de campo, em model tenant-scoped, é unique global disfarçado.
  for (const c of model.campos) {
    if (/(^|\s)@unique\b/.test(c.atributos)) {
      registrar(
        'P3-TEN-BUSINESS-UNIQUE',
        `${model.nome}.${c.nome} usa @unique isolado — em model tenant-scoped o unique precisa ser @@unique([${TENANT_FIELD}, …])`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Identidade: String + cuid(), nunca vinda do cliente
// ---------------------------------------------------------------------------

for (const model of models) {
  const id = model.campos.find((c) => /(^|\s)@id\b/.test(c.atributos));
  if (!id) {
    registrar('P3-TEN-IDENTITY', `${model.nome} não declara chave primária @id`);
    continue;
  }
  if (id.nome !== 'id') {
    registrar('P3-TEN-IDENTITY', `${model.nome}: a chave primária deve se chamar "id" — encontrado "${id.nome}"`);
  }
  if (id.tipo !== 'String') {
    registrar('P3-TEN-IDENTITY', `${model.nome}.${id.nome} deve ser String — encontrado ${id.tipo}`);
  }
  if (!/@default\(\s*cuid\(\)\s*\)/.test(id.atributos)) {
    registrar('P3-TEN-IDENTITY', `${model.nome}.${id.nome} deve usar @default(cuid())`);
  }

  // UUID paralelo: uma segunda identidade técnica ao lado da PK. O contrato o
  // proíbe (`identity.parallelUuidField = false`) porque duas identidades
  // técnicas para a mesma linha viram duas fontes de verdade — e alguém acaba
  // referenciando a errada.
  const uuidParalelo = model.campos.find(
    (c) => c.nome !== id.nome && /@default\(\s*uuid\(\)\s*\)/.test(c.atributos)
  );
  if (uuidParalelo) {
    registrar(
      'P3-TEN-IDENTITY',
      `${model.nome}.${uuidParalelo.nome} é UUID paralelo à chave primária — proibido pelo contrato`
    );
  }

  // ID numérico global como PK já é barrado pelo tipo; um autoincremento em
  // qualquer campo indica identidade técnica alternativa pela porta dos fundos.
  const autoincremento = model.campos.find((c) => /@default\(\s*autoincrement\(\)\s*\)/.test(c.atributos));
  if (autoincremento) {
    registrar(
      'P3-TEN-IDENTITY',
      `${model.nome}.${autoincremento.nome} usa autoincrement() — identidade numérica não é permitida nesta fundação`
    );
  }
}

// ---------------------------------------------------------------------------
// 7. Timestamps em todo model persistente
// ---------------------------------------------------------------------------

for (const model of models) {
  const createdAt = campo(model, 'createdAt');
  const updatedAt = campo(model, 'updatedAt');

  if (!createdAt || !/@default\(\s*now\(\)\s*\)/.test(createdAt.atributos)) {
    registrar('P3-TEN-TIMESTAMPS', `${model.nome} não declara createdAt DateTime @default(now())`);
  }
  if (!updatedAt || !/@updatedAt\b/.test(updatedAt.atributos)) {
    registrar('P3-TEN-TIMESTAMPS', `${model.nome} não declara updatedAt DateTime @updatedAt`);
  }
}

// ---------------------------------------------------------------------------
// 8. Backend: tenant nunca vem da requisição, e zero Base44
// ---------------------------------------------------------------------------

const arquivosJs = (dir) => {
  const absoluto = join(ROOT, dir);
  if (!existsSync(absoluto)) return [];
  const saida = [];
  const andar = (atual) => {
    for (const entrada of readdirSync(atual)) {
      const caminho = join(atual, entrada);
      if (statSync(caminho).isDirectory()) andar(caminho);
      else if (/\.(js|mjs|cjs)$/.test(entrada)) saida.push(caminho);
    }
  };
  andar(absoluto);
  return saida;
};

const arquivosDoBackend = arquivosJs(BACKEND_SRC);

if (!arquivosDoBackend.length) {
  registrar('P3-TEN-SCHEMA-MISSING', `nenhum arquivo executável em ${BACKEND_SRC}`);
}

/**
 * Atribuição de tenant a partir de uma fonte de requisição.
 *
 * Casa `cliente_id = request.body.cliente_id`, `clienteId: req.query.cliente_id`,
 * `const clienteId = params.cliente_id`, `headers['cliente_id']`, `cookie.cliente_id`
 * e as variações com aspas — em qualquer espaçamento.
 *
 * O que NÃO casa, de propósito: a mesma fonte usada para algo que não é tenant.
 * `request.body.nome` é dado de entrada legítimo.
 */
const padroesDeFonteProibida = (fonte) => [
  // …body.cliente_id  /  …body?.cliente_id
  new RegExp(`\\b${fonte}\\s*\\??\\.\\s*${TENANT_FIELD}\\b`),
  // …body['cliente_id']  /  …body["cliente_id"]
  new RegExp(`\\b${fonte}\\s*\\??\\[\\s*['"\`]${TENANT_FIELD}['"\`]\\s*\\]`),
  // desestruturação: const { cliente_id } = request.body
  new RegExp(
    `\\{[^}]*\\b${TENANT_FIELD}\\b[^}]*\\}\\s*=\\s*[A-Za-z_$][\\w$]*\\s*\\??\\.\\s*${fonte}\\b`
  ),
];

const ehArquivoDeTeste = (caminho) => /\/(tests?|__tests__)\//.test(caminho);

for (const arquivo of arquivosDoBackend) {
  const rel = relative(ROOT, arquivo);
  const conteudo = readFileSync(arquivo, 'utf8');

  for (const fonte of FONTES_PROIBIDAS_DE_TENANT) {
    for (const padrao of padroesDeFonteProibida(fonte)) {
      if (padrao.test(conteudo)) {
        registrar(
          'P3-TEN-SOURCE',
          `${rel}: ${TENANT_FIELD} lido de "${fonte}" — o tenant vem exclusivamente de auth_context`
        );
        break;
      }
    }
  }

  // Base44 não existe no backend, em nenhuma forma de carregamento.
  if (!ehArquivoDeTeste(rel)) {
    const base44 =
      /from\s+['"]@base44\/[^'"]*['"]/.test(conteudo) ||
      /require\s*\(\s*['"]@base44\/[^'"]*['"]\s*\)/.test(conteudo) ||
      /import\s*\(\s*['"]@base44\/[^'"]*['"]\s*\)/.test(conteudo) ||
      /\bbase44Client\b/.test(conteudo);

    if (base44) {
      registrar('P3-TEN-BASE44', `${rel}: backend não pode referenciar Base44 em nenhuma forma`);
    }
  }

  // -------------------------------------------------------------------------
  // Identidade em RUNTIME.
  //
  // O schema declarar `@default(cuid())` não garante que a linha gravada use
  // cuid: um INSERT em SQL cru pode preencher a PK com outra coisa, e o gate
  // que só lê o schema aprova. Foi o que aconteceu na primeira versão da P3 —
  // `garantirLinhaDaSequencia` gravava `replace(gen_random_uuid()::text,'-','')`
  // no `id`.
  //
  // A varredura é sintática, não textual: comentário e string de documentação
  // são removidos antes, para a menção ao defeito neste próprio arquivo — e nos
  // comentários que explicam a correção — não virar falso positivo.
  // -------------------------------------------------------------------------
  const semComentarios = conteudo
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((linha) => {
      const pos = linha.indexOf('//');
      return pos === -1 ? linha : linha.slice(0, pos);
    })
    .join('\n');

  // A regra é "o runtime não fornece a chave primária" — NÃO "o backend não
  // gera UUID". A distinção importa: `requestContext.js` usa `randomUUID()`
  // para o correlation id, que o contrato exige como campo `request_id`. Um
  // gate que proibisse qualquer UUID reprovaria código correto, e a primeira
  // reação de quem trombasse nele seria afrouxar o gate.
  //
  // Por isso a detecção olha a POSIÇÃO DE IDENTIDADE, não a mera presença do
  // gerador.

  // (a) INSERT cru preenchendo a coluna "id".
  const insertComId = /INSERT\s+INTO[\s\S]{0,400}?\(\s*"?id"?\s*[,)]/i;
  if (insertComId.test(semComentarios)) {
    registrar(
      'P3-TEN-RUNTIME-IDENTITY',
      `${rel}: INSERT cru preenchendo a coluna "id" — a PK vem do @default(cuid()) do Prisma. ` +
        'Use o client (create/createMany) e omita o id'
    );
  }

  // (b) `id:` recebendo valor de gerador, em qualquer objeto de escrita.
  const idDeGerador =
    /(^|[{,\s])["']?id["']?\s*:\s*(?:await\s+)?[\w.]*\b(?:gen_random_uuid|randomUUID|uuidv4|uuid|nanoid|createId)\s*\(/;
  if (idDeGerador.test(semComentarios)) {
    registrar(
      'P3-TEN-RUNTIME-IDENTITY',
      `${rel}: atribui "id" a partir de um gerador do runtime — a PK é produzida pelo Prisma`
    );
  }

  // (c) `gen_random_uuid` existe só para gerar identidade no PostgreSQL. Não há
  // uso legítimo dele nesta fundação, e deixá-lo passar reabriria exatamente o
  // caminho que a primeira versão da P3 usou.
  if (/\bgen_random_uuid\s*\(/.test(semComentarios)) {
    registrar(
      'P3-TEN-RUNTIME-IDENTITY',
      `${rel}: usa gen_random_uuid() — identidade é responsabilidade do @default(cuid()) do Prisma`
    );
  }
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

if (falhas.length) reprovar();

console.log(
  `gate:tenancy — PASSOU (${models.length} model(s); raiz "${ROOT_MODEL}"; ` +
    `${tenantModels.length} tenant-scoped; ${FONTES_PROIBIDAS_DE_TENANT.length} fontes de tenant proibidas; ` +
    `${arquivosDoBackend.length} arquivo(s) de backend varrido(s))`
);
