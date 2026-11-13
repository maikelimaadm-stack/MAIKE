/**
 * Divisão do `test:backend` em shards para a CI paralela (MAIKE-CI-PARALELO-PR02).
 *
 * Cada shard roda num job próprio, com PostgreSQL efêmero próprio, então os
 * arquivos de um shard nunca disputam o banco com os de outro. Dentro do shard
 * o runner continua com `--test-concurrency=1` (ver run-backend-tests.mjs).
 *
 * Garantias (provadas em scripts/tests/gates/backend-shards.test.mjs):
 *   - cada arquivo cai em exatamente um shard (nenhum some, nenhum repete);
 *   - a divisão é determinística (mesma entrada → mesmos shards);
 *   - arquivo novo, sem peso medido, entra com o peso mediano: só o equilíbrio
 *     pode piorar, nunca a cobertura.
 *
 * Os pesos (`backend-test-pesos.json`) são milissegundos medidos rodando cada
 * arquivo sozinho num PostgreSQL local. Servem só para equilibrar.
 */

import { readFileSync } from 'node:fs';

/** Lê `i/n` (1 ≤ i ≤ n ≤ 20). Devolve null se inválido. */
export function lerEspecificacao(texto) {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(texto ?? '').trim());
  if (!m) return null;
  const indice = Number(m[1]);
  const total = Number(m[2]);
  if (total < 1 || total > 20 || indice < 1 || indice > total) return null;
  return { indice, total };
}

const mediana = (valores) => {
  if (valores.length === 0) return 1;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
};

/**
 * Divide `arquivos` em `total` grupos pelo maior peso primeiro (LPT), sempre no
 * grupo mais leve; empates pelo nome e pelo índice, para ser determinístico.
 * @param {string[]} arquivos nomes (basename) dos arquivos de teste
 * @param {number} total quantidade de shards
 * @param {Record<string, number>} pesos ms por arquivo
 * @returns {string[][]} grupos, cada um em ordem alfabética
 */
export function dividirArquivos(arquivos, total, pesos = {}) {
  if (!Number.isInteger(total) || total < 1) throw new Error(`total de shards inválido: ${total}`);
  const unicos = [...new Set(arquivos)];
  if (unicos.length !== arquivos.length) throw new Error('arquivo repetido na lista de testes');
  const conhecidos = unicos.map((a) => pesos[a]).filter((p) => Number.isFinite(p) && p > 0);
  const padrao = mediana(conhecidos);
  const peso = (a) => (Number.isFinite(pesos[a]) && pesos[a] > 0 ? pesos[a] : padrao);

  const ordem = [...unicos].sort((a, b) => peso(b) - peso(a) || a.localeCompare(b));
  const grupos = Array.from({ length: total }, () => ({ soma: 0, itens: [] }));
  for (const arquivo of ordem) {
    let alvo = 0;
    for (let i = 1; i < total; i += 1) if (grupos[i].soma < grupos[alvo].soma) alvo = i;
    grupos[alvo].soma += peso(arquivo);
    grupos[alvo].itens.push(arquivo);
  }
  return grupos.map((g) => g.itens.sort((a, b) => a.localeCompare(b)));
}

/** Pesos versionados ao lado deste arquivo; ausente ou ilegível → sem pesos (só piora o equilíbrio). */
export function carregarPesos(url = new URL('./backend-test-pesos.json', import.meta.url)) {
  try {
    const dados = JSON.parse(readFileSync(url, 'utf8'));
    return dados && typeof dados.pesos === 'object' ? dados.pesos : {};
  } catch {
    return {};
  }
}

/**
 * Arquivos do shard pedido.
 * @param {string[]} arquivos basenames
 * @param {string} especificacao `i/n`
 */
export function selecionarShard(arquivos, especificacao, pesos = carregarPesos()) {
  const spec = lerEspecificacao(especificacao);
  if (!spec) throw new Error(`TEST_BACKEND_SHARD inválido: "${especificacao}" (formato i/n, 1 ≤ i ≤ n ≤ 20)`);
  return dividirArquivos(arquivos, spec.total, pesos)[spec.indice - 1];
}
