/**
 * D-PROD-207 (Fatia 4 do Lançamento de Atividades) — peças comuns às LINHAS DE
 * MÃO DE OBRA e DE SERVIÇO do apontamento (`atividadeApontamentoMaoObra*.js` e
 * `atividadeApontamentoServico*.js`), no molde da linha de máquina da Fatia 3
 * (`atividadeApontamentoMaquinaService.js`: `escreverLinha`,
 * `comAuditoriaDoConflito`, `respostaDaLinha`). Contrato
 * `docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md` §5.
 *
 * O esqueleto da escrita pela rota: idempotência por `operation_id`
 * (`executarComIdempotencia`: o recibo é conferido ANTES da versão, então o
 * reenvio igual devolve a resposta gravada mesmo com a versão já incrementada;
 * corpo diferente → 409), travas na ordem canônica (Empresa FOR SHARE →
 * Atividade FOR UPDATE), atividade ABERTA, apontamento CONFIRMADO, CAS pela
 * `versao` do apontamento (incrementada uma vez) e a resposta
 * `{ apontamento, atividade, alertas, <linha> }`. Tenant SÓ do auth_context.
 * Nada aqui toca o financeiro.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  AppError,
  atividadeApontamentoNotFound,
  atividadeNotFound,
  atividadeStatusInvalido,
  concurrencyConflict,
} from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { Dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido } from '../gestao/gestaoComum.js';
import {
  STATUS_APONTAMENTO,
  STATUS_ATIVIDADE,
  atualizarComVersao,
  carregarAtividadeDetalhe,
  diaDe,
  erroDoCasPerdido,
  exigirVersao,
  tempoDaFazenda,
  travarAtividade,
} from './atividadeComum.js';
import { buscarApontamento, lerAtividadeBase } from './atividadeApontamentoRepository.js';
import { lerApontamentoDaLinha } from './atividadeApontamentoMaquinaRepository.js';
import { comoApontamentoPublico } from './atividadeApontamentoService.js';
import { exigirAreaDoApontamentoEmAndamento } from './atividadeAreaService.js';

/** Limite de Decimal(14, 4) (custo/valor total da linha). */
export const LIMITE_DECIMAL_14_4 = new Dec('9999999999.9999');

/** Motivo gravado na linha substituída por uma edição (o CHECK exige motivo no cancelado). */
export const MOTIVO_DA_EDICAO = 'linha editada: substituída por uma linha nova';

/**
 * A unique `(cliente_id, operation_id)` da linha é a rede do banco: a mesma
 * chave já usada por OUTRA operação de linha → 409 de idempotência; a unique
 * `(apontamento, ordem)` fora da trava → 409 de concorrência (nunca 500).
 */
export const UNICOS_DA_LINHA = Object.freeze({
  operation_id: () => new AppError('IDEMPOTENCY_CONFLICT', 'operation_id reutilizado com payload diferente'),
  apontamento_ordem: () => concurrencyConflict(MENSAGEM_CONFLITO_SEM_CHAVE),
});

/**
 * Reenvio conflitante (mesma `operation_id`, corpo diferente): a resposta segue
 * 409 `IDEMPOTENCY_CONFLICT` e o fato é auditado numa transação PRÓPRIA,
 * best-effort.
 * @template T
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ entidade: string, acao: string, operationId: unknown, tipoOperacao: string }} alvo @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
const comAuditoriaDoConflito = async (contexto, { entidade, acao, operationId, tipoOperacao }, fn) => {
  try {
    return await fn();
  } catch (erro) {
    if (/** @type {any} */ (erro)?.code === 'IDEMPOTENCY_CONFLICT') {
      try {
        await registrarEvento(contexto, { acao, entidade, entidadeId: null, dadosNovos: { operation_id: operationId, tipo_operacao: tipoOperacao } });
      } catch {
        // best-effort: a auditoria do conflito não muda a resposta 409.
      }
    }
    throw erro;
  }
};

/**
 * Corpo das escritas da linha: `{ apontamento, atividade, alertas, [chave] }` —
 * o apontamento relido (forma pública do serviço do apontamento, com as quatro
 * listas de linhas), a atividade no formato do DETALHE, `alertas` (sempre `[]`:
 * a data não muda) e a linha escrita.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string} apontamentoId
 * @param {string} chave @param {unknown} linhaPublica
 */
const respostaDaLinha = async (tx, clienteId, empresaId, atividadeId, apontamentoId, chave, linhaPublica) => {
  const registro = await buscarApontamento(tx, clienteId, empresaId, atividadeId, apontamentoId);
  if (!registro) throw atividadeApontamentoNotFound();
  return {
    apontamento: comoApontamentoPublico(registro),
    atividade: await carregarAtividadeDetalhe(tx, clienteId, empresaId, atividadeId),
    alertas: [],
    [chave]: linhaPublica,
  };
};

/**
 * Esqueleto das três escritas da rota (lançar, editar, cancelar).
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ atividadeId: string, apontamentoId: string, corpo: Record<string, any>, tipoOperacao: string,
 *   acao: 'lancar_linha'|'editar_linha'|'cancelar_linha', httpStatus: number, fingerprint: Record<string, unknown>,
 *   entidade: string, acaoConflito: string, chave: string, publica: (linha: any) => unknown,
 *   executar: (tx: any, estado: { clienteId: string, empresaId: string, agora: Date, dia: string }) => Promise<any> }} pedido
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export const escreverLinhaDoApontamento = async (contexto, pedido) => {
  const { atividadeId, apontamentoId, corpo, tipoOperacao, acao, httpStatus, fingerprint, entidade, acaoConflito, chave, publica, executar } = pedido;
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const versao = corpo.versao;
  const r = await comAuditoriaDoConflito(contexto, { entidade, acao: acaoConflito, operationId: corpo.operation_id, tipoOperacao }, () =>
    emTransacao(
      TRANSACAO_CURTA,
      (tx) =>
        executarComIdempotencia(tx, {
          clienteId: cli,
          operationKey: corpo.operation_id,
          tipoOperacao,
          fingerprint: fingerprintDePayload({ atividade_id: atividadeId, apontamento_id: apontamentoId, empresa_id: corpo.empresa_id, versao, ...fingerprint }),
          executar: async () => {
            const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
            const { agora } = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
            if (!(await travarAtividade(tx, cli, empresaId, atividadeId))) throw atividadeNotFound(); // Atividade FOR UPDATE
            const atividade = await lerAtividadeBase(tx, cli, empresaId, atividadeId);
            if (!atividade) throw atividadeNotFound();
            if (atividade.status !== STATUS_ATIVIDADE.ABERTA) throw atividadeStatusInvalido({ status: atividade.status, acao, entidade: 'atividade' });
            const apontamento = await lerApontamentoDaLinha(tx, cli, empresaId, atividadeId, apontamentoId);
            if (!apontamento) throw atividadeApontamentoNotFound();
            if (apontamento.status !== STATUS_APONTAMENTO.CONFIRMADO) throw atividadeStatusInvalido({ status: apontamento.status, acao, entidade: 'apontamento' });
            // D-PROD-238: a linha NOVA só entra em lançamento de área EM_ANDAMENTO.
            if (acao === 'lancar_linha') await exigirAreaDoApontamentoEmAndamento(tx, cli, empresaId, atividadeId, apontamentoId);
            exigirVersao(apontamento, versao, 'apontamento');
            const linha = await executar(tx, { clienteId: cli, empresaId, agora, dia: /** @type {string} */ (diaDe(apontamento.data_operacional)) });
            const alvo = { clienteId: cli, empresaId, id: apontamentoId, versao, statusEsperado: STATUS_APONTAMENTO.CONFIRMADO, onde: { atividade_id: atividadeId } };
            if ((await atualizarComVersao(tx.atividadeApontamento, { ...alvo, dados: {} })) !== 1) {
              throw await erroDoCasPerdido(tx.atividadeApontamento, { ...alvo, acao, entidade: 'apontamento' });
            }
            return { httpStatus, body: await respostaDaLinha(tx, cli, empresaId, atividadeId, apontamentoId, chave, publica(linha)) };
          },
        }),
      UNICOS_DA_LINHA,
      MENSAGEM_CONFLITO_SEM_CHAVE
    )
  );
  return { status: r.httpStatus, body: r.body };
};

/**
 * Lista de linhas do corpo do lançamento (`mao_obra[]`, `servicos[]`): ausente
 * ou nula → `[]`; não lista → 400; cada item tem de ser objeto.
 * @param {unknown} linhas @param {string} campo
 * @returns {Record<string, any>[]}
 */
export const itensDaLista = (linhas, campo) => {
  if (linhas === undefined || linhas === null) return [];
  if (!Array.isArray(linhas)) throw invalido(`${campo} deve ser uma lista`, { field: campo, reason: 'formato' });
  return linhas.map((l, i) => {
    if (!l || typeof l !== 'object' || Array.isArray(l)) {
      throw invalido(`cada item de ${campo} deve ser um objeto`, { field: `${campo}[${i}]`, reason: 'formato' });
    }
    return /** @type {Record<string, any>} */ (l);
  });
};
