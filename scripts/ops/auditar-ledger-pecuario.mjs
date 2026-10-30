#!/usr/bin/env node
/**
 * Auditoria READ-ONLY do estoque pecuário legado contra o contrato do ledger.
 *
 * Uso:
 *   node scripts/ops/auditar-ledger-pecuario.mjs --entrada dump.json [--saida relatorio.json] [--mostrar-ids] [--exigir-apto]
 *
 * `dump.json` = { "manifesto_snapshot": {...}, "lotes": [...Lote],
 *                "movimentacoes_mapa": [...MovimentacaoMapa],
 *                "mapeamento_categorias"?: { "BOI": "<categoria_manejo_id>" } }
 * Formato e manifesto v1: CONTRATO.md §7.1 (runbook local do dump).
 * O mapeamento é opcional, decidido e revisado por gente; vira trilha auditável.
 * O dump é exportado de um banco LOCAL/de teste pelo operador. O script NÃO
 * conecta em banco nenhum, não tem endereço de produção, não lê variáveis de
 * ambiente e nunca escreve fora do arquivo de saída pedido. Não "conserta"
 * dado: só aponta lacunas, suspeitas e itens em quarentena para revisão manual.
 * IDs saem com hash curto, a menos que `--mostrar-ids` seja passado.
 *
 * Saída (exit code):
 *   0 — auditoria executada (sem `--exigir-apto`, mesmo se não apta)
 *   1 — falha técnica (arquivo ilegível, JSON inválido, erro ao gravar a saída)
 *   2 — uso incorreto
 *   3 — com `--exigir-apto`: auditoria executada, mas `apto_para_backfill` é false
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { auditarLedgerPecuario } from './auditarLedgerPecuarioLib.mjs';

const USO = 'uso: node scripts/ops/auditar-ledger-pecuario.mjs --entrada dump.json [--saida relatorio.json] [--mostrar-ids] [--exigir-apto]';
const args = process.argv.slice(2);
const valor = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};

const entrada = valor('--entrada');
if (!entrada || entrada.startsWith('--')) {
  console.error(USO);
  process.exit(2);
}

let resultado;
try {
  resultado = auditarLedgerPecuario(JSON.parse(readFileSync(entrada, 'utf8')), { mostrarIds: args.includes('--mostrar-ids') });
  const saida = valor('--saida');
  if (saida) writeFileSync(saida, `${JSON.stringify(resultado, null, 2)}\n`);
} catch (e) {
  // Nunca ecoa o conteúdo do dump: só a classe do erro.
  console.error(`auditar-ledger-pecuario — FALHA TÉCNICA (${e instanceof SyntaxError ? 'JSON inválido' : e?.code ?? e?.name ?? 'erro'})`);
  process.exit(1);
}

const s = resultado.snapshot;
console.log(`auditar-ledger-pecuario — SOMENTE LEITURA — estado: ${resultado.estado} — apto_para_backfill: ${resultado.apto_para_backfill} (apto_matematico: ${resultado.apto_matematico})`);
console.log('manifesto do snapshot (declaração externa; conferência necessária, NÃO suficiente):');
console.log(JSON.stringify({ valido: s.valido, fontes: s.fontes, ...s.resumo }, null, 2));
console.table([
  { contagem: 'lotes', declarada: s.contagens.declaradas?.lotes ?? null, lida: s.contagens.lidas.lotes },
  { contagem: 'movimentacoes_mapa', declarada: s.contagens.declaradas?.movimentacoes_mapa ?? null, lida: s.contagens.lidas.movimentacoes_mapa },
]);
console.log(`empresas do escopo: ${s.empresas.declaradas.join(', ') || '(nenhuma)'}; sem registros: ${s.empresas.sem_registros.join(', ') || '(nenhuma)'}; fora do escopo: ${s.empresas.fora_do_escopo.join(', ') || '(nenhuma)'}`);
if (resultado.motivos_bloqueio_backfill.length) console.log(`motivos de bloqueio: ${resultado.motivos_bloqueio_backfill.join(', ')}`);
if (s.avisos.length) console.table(s.avisos);
console.log(JSON.stringify(resultado.resumo, null, 2));
console.table(
  resultado.por_empresa.map((e) => ({
    empresa: e.empresa,
    estado: e.estado,
    apto_matematico: e.apto_matematico,
    apto_para_backfill: e.apto_para_backfill,
    total_entradas: e.total_entradas,
    total_observado: e.total_observado,
    linhas_com_lacuna: e.linhas_com_lacuna,
  }))
);
console.table(resultado.matriz);
if (resultado.suspeitas.length) console.table(resultado.suspeitas);
if (resultado.quarentena.length) console.table(resultado.quarentena);
process.exit(args.includes('--exigir-apto') && resultado.apto_para_backfill !== true ? 3 : 0);
