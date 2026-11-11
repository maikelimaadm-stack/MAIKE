/**
 * Guarda dos geradores P5.4 contra escritor genérico de estoque físico (D-PROD-161).
 *
 * Os geradores `p54-*.mjs` foram de uso único na P5.4 e emitem CRUD genérico:
 * POST/PATCH/DELETE com corpo livre no backend, `create`/`delete` nas portas do
 * front e models Prisma derivados do legado. Desde a Estoque P0 (D-PROD-161), o
 * estoque físico só é escrito pelo motor
 * (`backend/src/modules/estoqueFisico/estoqueFisicoMotor.js`) e pelos comandos
 * de `movimentacoesEstoque`. A ENTRADA documentada cria lote e custo. As
 * movimentações só consomem ou transferem saldo que já existe. O cache
 * `Produto.estoque_atual` só muda por `{increment}`/`{decrement}` do motor.
 *
 * Uma execução normal dos geradores, antes desta guarda, sobrescrevia em
 * silêncio os módulos blindados (resíduo W30 da P0). Ela reabria o POST e o
 * DELETE de lote e de movimento, apagava as rotas de comando do motor e recolocava
 * `create`/`delete` nas portas. Com `Produto` na lista, deixava `estoque_atual`
 * gravável por PATCH de corpo livre.
 *
 * Duas camadas, as duas antes de qualquer escrita e as duas fail-closed:
 *  1. `violacoesDeEntidades`: recusa o descritor quando qualquer campo de texto
 *     nomeia entidade, delegate Prisma, rota, pasta, porta ou insumo do estoque.
 *     Um apelido no `model` não basta para passar.
 *  2. `violacoesDeSaida`: recusa o que foi renderizado. Cobre escrita Prisma em
 *     tabela de estoque, escrita genérica em Produto, rota ou porta de escrita
 *     sobre estoque ou produto, model Prisma de estoque, `estoque_atual` e
 *     destino dentro de pasta protegida.
 * Qualquer violação recusa a execução inteira: nem as entidades seguras saem.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DECISAO = 'D-PROD-161';
export const CODIGO_RECUSA = 'SCAFFOLD_ESTOQUE_RECUSADO';
/** Código de saída da recusa (1 fica para exceção não tratada). */
export const SAIDA_RECUSA = 2;

const PROTEGIDOS = Object.freeze([
  {
    chaves: ['estoquelotenota', 'estoquelotesnota', 'estoquelotenotaport', 'estoquelotenotanativeport'],
    motivo:
      'EstoqueLoteNota: o lote nasce só de ENTRADA documentada ou de transferência, pelo motor; CRUD genérico fabricaria ou apagaria saldo',
  },
  {
    chaves: ['movimentacaoestoque', 'movimentacoesestoque', 'movimentacaoestoqueport', 'movimentacaoestoquenativeport'],
    motivo:
      'MovimentacaoEstoque: o fato é gravado só pelo motor; CRUD genérico forjaria movimento, apagaria histórico e removeria as rotas de comando',
  },
  {
    chaves: ['produto', 'produtos', 'produtoport', 'produtonativeport'],
    motivo:
      'Produto.estoque_atual: cache derivado que só o motor escreve; o template genérico grava corpo livre e deixaria o campo gravável',
  },
  {
    chaves: ['estoquefisico'],
    motivo: 'estoqueFisico: módulo do motor, nunca gerado',
  },
]);

const ESCRITA_PRISMA = 'create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany';
const ESCRITA_PRISMA_SEM_DELETE = 'create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert';

const PADROES_DE_SAIDA = Object.freeze([
  {
    motivo: 'escrita Prisma direta em tabela de estoque',
    casa: (t) => new RegExp(`\\b(estoqueLoteNota|movimentacaoEstoque)\\s*\\.\\s*(${ESCRITA_PRISMA})\\s*\\(`).test(t),
  },
  {
    motivo: 'escrita Prisma genérica em Produto (Produto.estoque_atual gravável)',
    casa: (t) => new RegExp(`\\bproduto\\s*\\.\\s*(${ESCRITA_PRISMA_SEM_DELETE})\\s*\\(`).test(t),
  },
  {
    motivo: 'rota HTTP genérica de escrita sobre estoque ou produto',
    casa: (t) => /\.(post|put|patch|delete)\(\s*['"`]\/(estoque-lotes-nota|movimentacoes-estoque|produtos)\b/.test(t),
  },
  {
    motivo: 'porta do front com escrita genérica sobre estoque ou produto',
    casa: (t) =>
      /CAMINHO\s*=\s*['"`]\/(estoque-lotes-nota|movimentacoes-estoque|produtos)['"`]/.test(t) &&
      /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/.test(t),
  },
  {
    motivo: 'model Prisma de estoque fora de migration versionada',
    casa: (t) => /^\s*model\s+(EstoqueLoteNota|MovimentacaoEstoque|Produto)\s*\{/m.test(t),
  },
  {
    motivo: 'Produto.estoque_atual em artefato gerado',
    casa: (t) => /\bestoque_atual\b/.test(t),
  },
]);

/** Chaves comparáveis de um texto: cada segmento de caminho, sem extensão, só letras e dígitos. */
const chavesDe = (texto) =>
  String(texto)
    .split(/[\\/]/)
    .map((segmento) => segmento.split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);

const protegidoPor = (texto) => {
  const chaves = chavesDe(texto);
  return PROTEGIDOS.find((p) => p.chaves.some((c) => chaves.includes(c)));
};

/** Pares [campo, texto] de todos os valores de texto de um descritor, inclusive em listas. */
const textosDe = (descritor) =>
  Object.entries(descritor ?? {}).flatMap(([campo, valor]) => {
    if (typeof valor === 'string') return [[campo, valor]];
    if (Array.isArray(valor)) return valor.filter((v) => typeof v === 'string').map((v) => [campo, v]);
    return [];
  });

export class RecusaScaffoldEstoque extends Error {
  /**
   * @param {string} gerador
   * @param {string[]} violacoes
   */
  constructor(gerador, violacoes) {
    super(
      [
        `[${CODIGO_RECUSA}] ${gerador}: geração recusada (${DECISAO}). Nada foi escrito.`,
        'O estoque físico só é escrito pelo motor (backend/src/modules/estoqueFisico/estoqueFisicoMotor.js) e pelos',
        'comandos de movimentacoesEstoque. Este gerador emite artefato genérico (CRUD de corpo livre ou model derivado',
        'do legado), que desfaria essa blindagem.',
        'Violações:',
        ...violacoes.map((v) => `  - ${v}`),
        'Não regenere esses módulos. O código atual é o contrato (docs/engineering/MAIKE-ESTOQUE-P0-01-REPORT.md).',
      ].join('\n')
    );
    this.name = 'RecusaScaffoldEstoque';
    this.codigo = CODIGO_RECUSA;
    this.gerador = gerador;
    this.violacoes = violacoes;
  }
}

/**
 * Camada 1: descritores de entidade do gerador.
 * @param {object[]} descritores
 * @returns {string[]} uma violação por descritor recusado
 */
export const violacoesDeEntidades = (descritores) =>
  descritores.flatMap((descritor) => {
    const casados = textosDe(descritor)
      .map(([campo, texto]) => ({ campo, texto, protegido: protegidoPor(texto) }))
      .filter((c) => c.protegido);
    if (casados.length === 0) return [];
    const rotulo = descritor.model ?? descritor.entity ?? descritor.file ?? casados[0].texto;
    const campos = casados.map((c) => `${c.campo}=${c.texto}`).join(', ');
    return [`${casados[0].protegido.motivo} [descritor ${rotulo}; campos: ${campos}]`];
  });

/**
 * Camada 2: arquivos renderizados, antes de gravar.
 * @param {Array<{caminho: string, conteudo: string}>} arquivos caminho relativo à raiz do repositório
 * @returns {string[]}
 */
export const violacoesDeSaida = (arquivos) =>
  arquivos.flatMap(({ caminho, conteudo }) => {
    const violacoes = PADROES_DE_SAIDA.filter((p) => p.casa(String(conteudo))).map((p) => `${caminho}: ${p.motivo}`);
    const destino = protegidoPor(caminho);
    if (destino) violacoes.push(`${caminho}: destino protegido — ${destino.motivo}`);
    return violacoes;
  });

const exigir = (gerador, violacoes) => {
  if (violacoes.length > 0) throw new RecusaScaffoldEstoque(gerador, violacoes);
};

/**
 * Roda um gerador P5.4 com as duas camadas da guarda e só grava no fim.
 * Na recusa, imprime o motivo, define `process.exitCode = SAIDA_RECUSA` e não grava nada.
 *
 * @param {{
 *   gerador: string,
 *   raiz: string,
 *   entidades: object[],
 *   renderizar: (entidades: object[]) => Array<{caminho: string, conteudo: string}>,
 * }} opcoes
 * @returns {boolean} true se gravou; false se recusou
 */
export const gerarSemEscritaDeEstoque = ({ gerador, raiz, entidades, renderizar }) => {
  try {
    exigir(gerador, violacoesDeEntidades(entidades));
    const arquivos = renderizar(entidades);
    exigir(gerador, violacoesDeSaida(arquivos));
    for (const { caminho, conteudo } of arquivos) {
      const absoluto = join(raiz, caminho);
      mkdirSync(dirname(absoluto), { recursive: true });
      writeFileSync(absoluto, conteudo);
    }
    return true;
  } catch (erro) {
    if (!(erro instanceof RecusaScaffoldEstoque)) throw erro;
    console.error(erro.message);
    process.exitCode = SAIDA_RECUSA;
    return false;
  }
};
