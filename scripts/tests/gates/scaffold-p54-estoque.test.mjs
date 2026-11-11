/**
 * Resíduo W30 da Estoque P0 (D-PROD-161): os geradores `scripts/scaffold/p54-*.mjs`
 * não podem regenerar escritor genérico de estoque físico.
 *
 * Uma execução normal desses geradores, antes da guarda, sobrescrevia em silêncio
 * os módulos blindados do estoque: `POST`/`DELETE` genéricos de `EstoqueLoteNota`
 * e `MovimentacaoEstoque`, `create`/`delete` nas portas do front, sumiço das rotas
 * de comando do motor e, com `Produto` na lista, o cache `estoque_atual` gravável
 * por `PATCH` de corpo livre.
 *
 * Cada teste copia os geradores (e os insumos que eles leem) para um diretório
 * temporário e os executa lá. A raiz dos geradores é `import.meta.dirname/../..`,
 * então nada toca a árvore real. A detecção de escrita de estoque abaixo é
 * própria deste teste: não reaproveita os padrões da guarda, para que uma guarda
 * enfraquecida não enfraqueça a prova.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT, makeTempDir, cleanup } from './helpers.mjs';

const SCAFFOLD = join(REPO_ROOT, 'scripts/scaffold');
const ENTIDADES_JSONC = join(REPO_ROOT, 'base44/entities');
const GUARDA = join(SCAFFOLD, 'p54-guarda-estoque.mjs');

/** Saída de recusa da guarda (diferente do 1 de uma exceção não tratada). */
const SAIDA_RECUSA = 2;

const ESCRITA_DE_ESTOQUE = [
  {
    motivo: 'delegate Prisma de estoque com escrita',
    casa: (t) =>
      /\b(estoqueLoteNota|movimentacaoEstoque)\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\s*\(/.test(t),
  },
  {
    motivo: 'delegate Prisma de Produto com escrita genérica (estoque_atual gravável)',
    casa: (t) => /\bproduto\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert)\s*\(/.test(t),
  },
  {
    motivo: 'rota HTTP de escrita sobre estoque ou produto',
    casa: (t) => /\.(post|put|patch|delete)\(\s*['"`]\/(estoque-lotes-nota|movimentacoes-estoque|produtos)\b/.test(t),
  },
  {
    motivo: 'porta do front com escrita sobre estoque ou produto',
    casa: (t) =>
      /CAMINHO\s*=\s*['"`]\/(estoque-lotes-nota|movimentacoes-estoque|produtos)['"`]/.test(t) &&
      /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/.test(t),
  },
  {
    motivo: 'model Prisma de estoque gerado fora de migration',
    casa: (t) => /^\s*model\s+(EstoqueLoteNota|MovimentacaoEstoque|Produto)\s*\{/m.test(t),
  },
  { motivo: 'estoque_atual em artefato gerado', casa: (t) => /\bestoque_atual\b/.test(t) },
];

const listarArquivos = (raiz) => {
  const saida = [];
  const andar = (dir) => {
    for (const nome of readdirSync(dir)) {
      const abs = join(dir, nome);
      if (statSync(abs).isDirectory()) andar(abs);
      else saida.push(abs);
    }
  };
  andar(raiz);
  return saida.sort();
};

const fotografar = (raiz) =>
  new Map(listarArquivos(raiz).map((abs) => [relative(raiz, abs), readFileSync(abs, 'utf8')]));

/** Arquivos criados ou alterados pela execução: `[{caminho, conteudo}]`. */
const produzidos = (raiz, antes) =>
  [...fotografar(raiz)]
    .filter(([caminho, conteudo]) => antes.get(caminho) !== conteudo)
    .map(([caminho, conteudo]) => ({ caminho, conteudo }));

const escritasDeEstoque = (arquivos) =>
  arquivos.flatMap(({ caminho, conteudo }) =>
    ESCRITA_DE_ESTOQUE.filter((p) => p.casa(conteudo)).map((p) => `${caminho}: ${p.motivo}`)
  );

/** Insumos que `p54-generate` lê. Se o legado sair do repositório, o teste usa fixture mínima própria. */
const INSUMOS = [
  'Empresa',
  'Permissao',
  'Fornecedor',
  'CategoriaManejo',
  'Bebedouro',
  'PontoSuplementacao',
  'EstoqueLoteNota',
  'MovimentacaoEstoque',
  'Produto',
];

const insumoMinimo = (nome) =>
  JSON.stringify(
    {
      name: nome,
      type: 'object',
      properties: {
        empresa_id: { type: 'string' },
        nome: { type: 'string' },
        ...(nome === 'Produto' ? { estoque_atual: { type: 'number' } } : {}),
      },
      required: ['nome'],
    },
    null,
    2
  );

/** Copia os geradores e os insumos para um diretório temporário isolado. */
const prepararCopia = () => {
  const raiz = makeTempDir('maike-scaffold-p54-');
  const destinoScaffold = join(raiz, 'scripts/scaffold');
  mkdirSync(destinoScaffold, { recursive: true });
  for (const nome of readdirSync(SCAFFOLD).filter((n) => n.endsWith('.mjs'))) {
    copyFileSync(join(SCAFFOLD, nome), join(destinoScaffold, nome));
  }
  const destinoEntidades = join(raiz, 'base44/entities');
  mkdirSync(destinoEntidades, { recursive: true });
  if (existsSync(ENTIDADES_JSONC)) {
    for (const nome of readdirSync(ENTIDADES_JSONC)) {
      copyFileSync(join(ENTIDADES_JSONC, nome), join(destinoEntidades, nome));
    }
  }
  for (const nome of INSUMOS) {
    const arquivo = join(destinoEntidades, `${nome}.jsonc`);
    if (!existsSync(arquivo)) writeFileSync(arquivo, insumoMinimo(nome));
  }
  return raiz;
};

/**
 * Troca a lista de entidades da cópia do gerador pelas entradas dadas.
 * Simula quem edita o gerador para contornar a recusa.
 */
const trocarLista = (raiz, gerador, entradas) => {
  const arquivo = join(raiz, 'scripts/scaffold', `${gerador.nome}.mjs`);
  const fonte = readFileSync(arquivo, 'utf8');
  const inicio = fonte.indexOf(gerador.lista);
  assert.ok(inicio >= 0, `${gerador.nome}: não achei "${gerador.lista}" na cópia`);
  const fim = fonte.indexOf('\n];', inicio);
  assert.ok(fim > inicio, `${gerador.nome}: não achei o fim da lista na cópia`);
  writeFileSync(arquivo, `${fonte.slice(0, inicio)}${gerador.lista}\n${entradas.join('\n')}${fonte.slice(fim)}`);
};

/** Troca um trecho do template na cópia: simula quem edita o template do gerador. */
const adulterarTemplate = (raiz, gerador) => {
  const arquivo = join(raiz, 'scripts/scaffold', `${gerador.nome}.mjs`);
  const fonte = readFileSync(arquivo, 'utf8');
  const [de, para] = gerador.adulterado;
  assert.ok(fonte.includes(de), `${gerador.nome}: não achei o trecho do template na cópia`);
  writeFileSync(arquivo, fonte.replace(de, para));
};

const executar = (raiz, gerador) => {
  const r = spawnSync(process.execPath, [join(raiz, 'scripts/scaffold', `${gerador.nome}.mjs`)], {
    cwd: raiz,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  return { status: r.status, saida: `${r.stdout || ''}${r.stderr || ''}` };
};

const GERADORES = [
  {
    nome: 'p54-backend',
    lista: 'const ENTITIES = [',
    segura: `  { model: 'Bebedouro', singular: 'bebedouro', folder: 'bebedouros', path: '/bebedouros', prisma: 'bebedouro', sequencia: null, filterFields: ['empresa_id'], listLimit: false },`,
    produto: `  { model: 'Produto', singular: 'produto', folder: 'produtos', path: '/produtos', prisma: 'produto', sequencia: null, filterFields: ['empresa_id'], listLimit: false },`,
    apelido: `  { model: 'LoteNotaLegado', singular: 'loteNotaLegado', folder: 'lotesNotaLegado', path: '/lotes-nota-legado', prisma: 'estoqueLoteNota', sequencia: null, filterFields: [], listLimit: false },`,
    adulterado: ['tx.${e.prisma}.create({ data: dados })', 'tx.estoqueLoteNota.create({ data: dados })'],
  },
  {
    nome: 'p54-native',
    lista: 'const PORTS = [',
    segura: `  { entity: 'Bebedouro', port: 'bebedouroPort', path: '/bebedouros', dir: 'bebedouros' },`,
    produto: `  { entity: 'Produto', port: 'produtoPort', path: '/produtos', dir: 'produtos' },`,
    apelido: `  { entity: 'LoteNotaLegado', port: 'loteNotaLegadoPort', path: '/estoque-lotes-nota', dir: 'lotes-nota-legado' },`,
    adulterado: ["const CAMINHO = '${p.path}';", "const CAMINHO = '/movimentacoes-estoque';"],
  },
  {
    nome: 'p54-generate',
    lista: 'const ENTITIES = [',
    segura: `  { file: 'Bebedouro.jsonc', model: 'Bebedouro', numero: null },`,
    produto: `  { file: 'Produto.jsonc', model: 'Produto', numero: null },`,
    apelido: `  { file: 'MovimentacaoEstoque.jsonc', model: 'MovEstoqueLegado', numero: null },`,
    adulterado: ['const lines = [`model ${ent.model} {`', 'const lines = [`model MovimentacaoEstoque {`'],
  },
];

/** Recusa fail-closed: sem escrita de estoque, saída 2, D-PROD-161 citada, nada gravado. */
const exigirRecusa = (raiz, antes, r, citacoes) => {
  const arquivos = produzidos(raiz, antes);
  assert.deepEqual(escritasDeEstoque(arquivos), [], `o gerador produziu escrita de estoque:\n${r.saida}`);
  assert.equal(r.status, SAIDA_RECUSA, `esperava recusa (saída ${SAIDA_RECUSA}):\n${r.saida}`);
  assert.match(r.saida, /D-PROD-161/);
  for (const texto of citacoes) assert.ok(r.saida.includes(texto), `a recusa não cita "${texto}":\n${r.saida}`);
  assert.deepEqual(
    arquivos.map((a) => a.caminho),
    [],
    'a recusa tem de vir antes de qualquer escrita (nem as entidades seguras saem)'
  );
};

describe('scaffold p54 × estoque físico (D-PROD-161, resíduo W30)', () => {
  for (const gerador of GERADORES) {
    test(`${gerador.nome}: a execução normal recusa, cita D-PROD-161 e não escreve nada`, () => {
      const raiz = prepararCopia();
      try {
        const antes = fotografar(raiz);
        const r = executar(raiz, gerador);
        exigirRecusa(raiz, antes, r, ['EstoqueLoteNota', 'MovimentacaoEstoque']);
      } finally {
        cleanup(raiz);
      }
    });

    test(`${gerador.nome}: Produto na lista é recusado (Produto.estoque_atual é cache do motor)`, () => {
      const raiz = prepararCopia();
      try {
        trocarLista(raiz, gerador, [gerador.segura, gerador.produto]);
        const antes = fotografar(raiz);
        const r = executar(raiz, gerador);
        exigirRecusa(raiz, antes, r, ['Produto.estoque_atual']);
      } finally {
        cleanup(raiz);
      }
    });

    test(`${gerador.nome}: apelido que aponta para tabela, rota ou insumo de estoque é recusado`, () => {
      const raiz = prepararCopia();
      try {
        trocarLista(raiz, gerador, [gerador.segura, gerador.apelido]);
        const antes = fotografar(raiz);
        const r = executar(raiz, gerador);
        exigirRecusa(raiz, antes, r, []);
      } finally {
        cleanup(raiz);
      }
    });

    test(`${gerador.nome}: template adulterado que escreve estoque para entidade segura é recusado (2ª camada)`, () => {
      const raiz = prepararCopia();
      try {
        trocarLista(raiz, gerador, [gerador.segura]);
        adulterarTemplate(raiz, gerador);
        const antes = fotografar(raiz);
        const r = executar(raiz, gerador);
        exigirRecusa(raiz, antes, r, []);
      } finally {
        cleanup(raiz);
      }
    });

    test(`${gerador.nome}: sem entidade de estoque o gerador continua gerando (a guarda é dirigida)`, () => {
      const raiz = prepararCopia();
      try {
        trocarLista(raiz, gerador, [gerador.segura]);
        const antes = fotografar(raiz);
        const r = executar(raiz, gerador);
        assert.equal(r.status, 0, r.saida);
        const arquivos = produzidos(raiz, antes);
        assert.ok(arquivos.length > 0, 'a entidade segura deveria ter sido gerada');
        assert.deepEqual(escritasDeEstoque(arquivos), []);
      } finally {
        cleanup(raiz);
      }
    });
  }
});

describe('guarda do scaffold p54 (p54-guarda-estoque.mjs)', () => {
  const carregar = () => import(pathToFileURL(GUARDA).href);

  test('recusa descritor por qualquer campo que nomeie entidade, delegate, rota ou insumo de estoque', async () => {
    const { violacoesDeEntidades } = await carregar();
    const bloqueados = [
      { model: 'EstoqueLoteNota' },
      { entity: 'MovimentacaoEstoque' },
      { model: 'Produto' },
      { model: 'Apelido', prisma: 'estoqueLoteNota' },
      { model: 'Apelido', path: '/movimentacoes-estoque' },
      { model: 'Apelido', folder: 'estoqueLotesNota' },
      { model: 'Apelido', dir: 'produtos' },
      { model: 'Apelido', file: 'EstoqueLoteNota.jsonc' },
      { model: 'Apelido', port: 'movimentacaoEstoquePort' },
      { model: 'Apelido', folder: 'estoqueFisico' },
    ];
    for (const d of bloqueados) {
      assert.equal(violacoesDeEntidades([d]).length, 1, `deveria recusar ${JSON.stringify(d)}`);
    }
    const livres = [
      { model: 'Bebedouro', filterFields: ['empresa_id', 'produto_id'] },
      { model: 'PontoSuplementacao', sequencia: 'PontoSuplementacao' },
      { entity: 'Fornecedor', path: '/fornecedores' },
    ];
    assert.deepEqual(violacoesDeEntidades(livres), []);
  });

  test('recusa saída com escrita de estoque, produto genérico, model de estoque, estoque_atual ou destino protegido', async () => {
    const { violacoesDeSaida } = await carregar();
    const recusadas = [
      { caminho: 'backend/src/modules/x/r.js', conteudo: 'export const f = (tx, d) => tx.estoqueLoteNota.create({ data: d });' },
      { caminho: 'backend/src/modules/x/r.js', conteudo: 'tx.movimentacaoEstoque.delete({ where })' },
      { caminho: 'backend/src/modules/x/r.js', conteudo: 'tx.produto.update({ where, data: { ...entrada } })' },
      { caminho: 'backend/src/modules/x/routes.js', conteudo: "app.post('/estoque-lotes-nota', {}, h)" },
      {
        caminho: 'src/apis/x/p.js',
        conteudo: "const CAMINHO = '/movimentacoes-estoque';\nnativeRequest(CAMINHO, { method: 'DELETE' })",
      },
      { caminho: 'scripts/scaffold/snippet.txt', conteudo: 'model MovimentacaoEstoque {\n  id String @id\n}' },
      { caminho: 'scripts/scaffold/snippet.txt', conteudo: '  estoque_atual Decimal? @db.Decimal(14, 4)' },
      { caminho: 'backend/src/modules/estoqueLotesNota/qualquer.js', conteudo: '// vazio' },
      { caminho: 'src/apis/movimentacoes-estoque/qualquer.js', conteudo: '// vazio' },
      { caminho: 'backend/src/modules/produtos/qualquer.js', conteudo: '// vazio' },
      { caminho: 'backend/src/modules/estoqueFisico/qualquer.js', conteudo: '// vazio' },
    ];
    for (const a of recusadas) {
      assert.ok(violacoesDeSaida([a]).length >= 1, `deveria recusar ${a.caminho}: ${a.conteudo}`);
    }
    const livre = {
      caminho: 'backend/src/modules/bebedouros/bebedouroRepository.js',
      conteudo: "tx.bebedouro.create({ data })\napp.post('/bebedouros', {}, h)\n// produto_id é só filtro",
    };
    assert.deepEqual(violacoesDeSaida([livre]), []);
  });

  test('a mensagem de recusa cita D-PROD-161, o gerador e cada violação, e diz que nada foi escrito', async () => {
    const { RecusaScaffoldEstoque } = await carregar();
    const erro = new RecusaScaffoldEstoque('p54-teste', ['EstoqueLoteNota: lote só nasce do motor']);
    assert.equal(erro.codigo, 'SCAFFOLD_ESTOQUE_RECUSADO');
    assert.match(erro.message, /D-PROD-161/);
    assert.match(erro.message, /p54-teste/);
    assert.match(erro.message, /EstoqueLoteNota: lote só nasce do motor/);
    assert.match(erro.message, /[Nn]ada foi escrito/);
  });
});
