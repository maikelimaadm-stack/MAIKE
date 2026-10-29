#!/usr/bin/env node
/**
 * Auditoria READ-ONLY do estoque pecuário legado contra o contrato do ledger.
 *
 * Uso:
 *   node scripts/ops/auditar-ledger-pecuario.mjs --entrada dump.json [--saida relatorio.json] [--mostrar-ids]
 *
 * `dump.json` = { "lotes": [...Lote], "movimentacoes_mapa": [...MovimentacaoMapa],
 *                "mapeamento_categorias"?: { "BOI": "<categoria_manejo_id>" } }
 * (o mapeamento é opcional, decidido e revisado por gente; vira trilha auditável).
 * exportado de um banco LOCAL/de teste pelo operador. O script NÃO conecta em
 * banco nenhum, não tem endereço de produção, não lê variáveis de ambiente e
 * nunca escreve fora do arquivo de saída pedido. Não "conserta" dado: só
 * aponta lacunas, suspeitas e itens em quarentena para revisão manual.
 * IDs saem com hash curto, a menos que `--mostrar-ids` seja passado.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { auditarLedgerPecuario } from './auditarLedgerPecuarioLib.mjs';

const args = process.argv.slice(2);
const valor = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};

const entrada = valor('--entrada');
if (!entrada) {
  console.error('uso: node scripts/ops/auditar-ledger-pecuario.mjs --entrada dump.json [--saida relatorio.json] [--mostrar-ids]');
  process.exit(2);
}

const resultado = auditarLedgerPecuario(JSON.parse(readFileSync(entrada, 'utf8')), { mostrarIds: args.includes('--mostrar-ids') });
const saida = valor('--saida');
if (saida) writeFileSync(saida, `${JSON.stringify(resultado, null, 2)}\n`);

console.log(`auditar-ledger-pecuario — SOMENTE LEITURA — estado: ${resultado.estado}`);
console.log(JSON.stringify(resultado.resumo, null, 2));
console.table(resultado.por_empresa.map((e) => ({ empresa: e.empresa, estado: e.estado, total_entradas: e.total_entradas, total_observado: e.total_observado, linhas_com_lacuna: e.linhas_com_lacuna })));
console.table(resultado.matriz);
if (resultado.suspeitas.length) console.table(resultado.suspeitas);
if (resultado.quarentena.length) console.table(resultado.quarentena);
process.exit(0);
