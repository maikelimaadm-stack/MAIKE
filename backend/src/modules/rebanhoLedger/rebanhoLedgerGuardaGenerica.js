/**
 * PR174-R2 (D-PROD-107) — numa empresa ATIVADA no ledger, fato que muda
 * saldo, classificação, peso ou estado do rebanho só entra pelos comandos
 * certificados (transação + idempotência + partidas). O POST genérico
 * (`/movimentacoes-mapa`, `/movimentacoes-pecuaria`, unitário ou em lote no
 * service) não grava "histórico de manejo" sem efeito no ledger.
 *
 * Contrato (whitelist FECHADA de documentação informativa, por FORMATO):
 *  - MovimentacaoMapa `tipo: 'Entrada'` + `motivo: 'Renomear Lote'` com SOMENTE
 *    os campos da renomeação (`lote_id` do CADASTRO, `lote` = nome novo,
 *    `observacoes`, `data_movimentacao`, `usuario_responsavel`). Qualquer outro
 *    campo com valor (quantidade, área, categoria, peso, linhas…) faz o
 *    documento ser material — mesmo com os rótulos de renomeação (PR174-R3).
 *    `lote_id` de POSIÇÃO também é material (renomear é do cadastro).
 * Todo o resto, numa empresa ativada → 409 REBANHO_LEDGER_SOMENTE_POR_COMANDO,
 * antes de inserir, auditar ou reservar chave.
 *
 * A empresa vem do documento E de cada lote/posição citado (cadastro ou
 * posição): informar outra empresa no corpo não contorna a guarda. Tenant só
 * do auth_context. Empresa LEGADA: comportamento aprovado intacto.
 */
import { AppError } from '../../shared/errors/AppError.js';
import { normal } from './rebanhoLedgerNucleo.js';

const CAMPOS_ID = Object.freeze(['lote_id', 'lote_destino_id', 'posicao_id', 'posicao_destino_id']);
const CAMPOS_LISTA = Object.freeze(['lote_ids', 'posicao_ids']);

/** @param {Record<string, any>} dados */
export const CAMPOS_DA_RENOMEACAO = Object.freeze(['empresa_id', 'tipo', 'motivo', 'lote', 'lote_id', 'observacoes', 'data_movimentacao', 'usuario_responsavel']);
const vazio = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
export const ehInformativo = (entidade, dados) =>
  entidade === 'MovimentacaoMapa' && normal(dados?.tipo) === 'ENTRADA' && normal(dados?.motivo) === 'RENOMEAR LOTE'
  && typeof dados?.lote_id === 'string' && dados.lote_id.trim() !== ''
  && Object.entries(dados).every(([k, v]) => CAMPOS_DA_RENOMEACAO.includes(k) || vazio(v));

const idsCitados = (dados) => {
  const ids = [];
  for (const c of CAMPOS_ID) if (typeof dados?.[c] === 'string' && dados[c].trim()) ids.push(dados[c].trim());
  for (const c of CAMPOS_LISTA) if (Array.isArray(dados?.[c])) for (const v of dados[c]) if (typeof v === 'string' && v.trim()) ids.push(v.trim());
  return ids;
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {Array<{empresa_id?: string|null, dados?: Record<string, any>}>} documentos já montados
 * @param {'MovimentacaoMapa'|'MovimentacaoPecuaria'} entidade
 */
export const exigirFatoGenericoForaDoLedger = async (tx, clienteId, documentos, entidade) => {
  // Renomeação só cita o CADASTRO (posição ou id desconhecido ⇒ material)…
  const informativos = documentos.filter((d) => ehInformativo(entidade, d?.dados));
  const idsInformativos = informativos.map((d) => d.dados.lote_id.trim());
  // …e só cita um cadastro EXISTENTE do mesmo tenant e da mesma empresa do documento.
  const cadastros = idsInformativos.length
    ? new Map((await tx.lote.findMany({ where: { cliente_id: clienteId, id: { in: idsInformativos } }, select: { id: true, empresa_id: true } })).map((l) => [l.id, l.empresa_id]))
    : new Map();
  const renomeacaoValida = (d) => cadastros.get(d.dados.lote_id.trim()) === d.empresa_id;
  const materiais = documentos.filter((d) => !ehInformativo(entidade, d?.dados) || !renomeacaoValida(d));
  if (!materiais.length) return;
  const empresas = new Set(materiais.map((d) => d?.empresa_id).filter((v) => typeof v === 'string' && v));
  const ids = [...new Set(materiais.flatMap((d) => idsCitados(d?.dados)))];
  if (ids.length) {
    const [lotes, posicoes] = await Promise.all([
      tx.lote.findMany({ where: { cliente_id: clienteId, id: { in: ids } }, select: { empresa_id: true } }),
      tx.posicaoRebanho.findMany({ where: { cliente_id: clienteId, id: { in: ids } }, select: { empresa_id: true } }),
    ]);
    for (const x of [...lotes, ...posicoes]) empresas.add(x.empresa_id);
  }
  if (!empresas.size) return;
  // Serializa com a ativação (que trava a Empresa FOR UPDATE): sem janela em
  // que o POST lê "não ativada" e a ativação lê "sem histórico" ao mesmo tempo.
  await tx.$queryRaw`SELECT id FROM "Empresa" WHERE cliente_id = ${clienteId} AND id = ANY(${[...empresas].sort()}::text[]) ORDER BY id FOR SHARE`;
  const ativa = await tx.rebanhoLedgerAtivacao.findFirst({ where: { cliente_id: clienteId, empresa_id: { in: [...empresas] } }, select: { empresa_id: true } });
  if (ativa) {
    throw new AppError('REBANHO_LEDGER_SOMENTE_POR_COMANDO', 'nesta empresa o rebanho é controlado por posições: registre o manejo pelo comando certificado (nada foi gravado)', {
      details: {
        empresa_id: ativa.empresa_id,
        entidade,
        comandos: ['/rebanho/comandos/transferencia', '/movimentacoes-mapa/comandos/baixa-rebanho', '/movimentacoes-mapa/comandos/manejo-rebanho', '/movimentacoes-mapa/comandos/juncao-lotes', '/movimentacoes-mapa/comandos/manejo-lote'],
      },
    });
  }
};
