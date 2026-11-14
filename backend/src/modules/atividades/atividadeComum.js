/**
 * D-PROD-200 (Fatia 2 do Lançamento de Atividades) — peças COMUNS do cabeçalho
 * (`Atividade`) e do apontamento do dia/turno (`AtividadeApontamento`), contrato
 * `docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md`.
 *
 * Movidas e adaptadas do serviço do apontamento de linha única (D-PROD-190/193,
 * removido nesta fatia), sem importar nada dele. Pequenas e explícitas; não é
 * um runtime genérico. O serviço do cabeçalho e o do apontamento importam
 * daqui, e só daqui, o que os dois fazem igual:
 *  - constantes (entidade da sequência, status, turnos, origens, limites);
 *  - normalização do corpo (ids, decimais como TEXTO, dias, motivo) e a guarda
 *    anti-coerção dos decimais para o `preValidation` das rotas;
 *  - o "hoje" da fazenda (fuso da Empresa + relógio do servidor; sem fuso,
 *    falha fechado) e a recusa de dia futuro;
 *  - as regras de status e de versão (CAS) da atividade e do apontamento;
 *  - a escrita com a FK composta traduzida (cadastro que sumiu na corrida →
 *    422 do campo, nunca o 403 genérico do P2003);
 *  - as formas públicas (resumos ao lado de cada id; decimais com 4 casas;
 *    datas `AAAA-MM-DD`; instantes ISO) e a forma da ATIVIDADE (lista e
 *    detalhe), que o apontamento também devolve nas escritas;
 *  - a trava da linha da atividade, os totais do detalhe e a soma dos
 *    apontamentos CONFIRMADO (adaptador de dados, sem regra).
 *
 * Tenant SÓ do auth_context: toda função recebe o `clienteId` de quem chama
 * (que o tirou de `exigirAuthContext`), nunca de corpo, query, params,
 * cabeçalho ou cookie (R11).
 */

import {
  atividadeApontamentoNotFound,
  atividadeDataInvalida,
  atividadeMotivoInvalido,
  atividadeNotFound,
  atividadeReferenciaInvalida,
  atividadeStatusInvalido,
  atividadeVersaoConflito,
} from '../../shared/errors/AppError.js';
import { fkDaAtividadeNaEscrita } from '../../shared/errors/vinculoAtividade.js';
import { CASAS_QUANTIDADE, dec } from '../financeiro/decimalFinanceiro.js';
import { invalido, iso, textoDoCorpo } from '../gestao/gestaoComum.js';
import { comoData, diaDe, ehDiaValido } from '../patrimonio/patrimonioComum.js';
import { agoraDoServidor, diaNoFuso, fusoDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';

/**
 * Reexportados para os dois serviços importarem as formas e as datas de um
 * lugar só: `diaDe` (Date de coluna `@db.Date` → `AAAA-MM-DD`), `comoData`
 * (`AAAA-MM-DD` → Date à meia-noite UTC, para gravar), `ehDiaValido` (o dia
 * existe no calendário) e `iso` (Date → instante ISO; nulo → null).
 */
export { comoData, diaDe, ehDiaValido, iso };

// ─── constantes ─────────────────────────────────────────────────────────────

/**
 * Entidade da sequência do tenant (`EntidadeCodigoSequencia`, `reservarNumero`)
 * e da auditoria do cabeçalho. EXATAMENTE `Atividade`: é o contador que a
 * migration `20261114500000_atividade_cabecalho` renomeia de
 * `ApontamentoAtividade` (as duas atividades convertidas mantêm os números 1 e
 * 2; a próxima é 3).
 */
export const ENTIDADE_ATIVIDADE = 'Atividade';

/** Entidade da auditoria do apontamento (ele não tem número: tem `sequencia`). */
export const ENTIDADE_APONTAMENTO = 'AtividadeApontamento';

/** Status da atividade (CHECK `Atividade_status_check`). */
export const STATUS_ATIVIDADE = Object.freeze({ ABERTA: 'ABERTA', CONCLUIDA: 'CONCLUIDA', CANCELADA: 'CANCELADA' });

/** Status do apontamento (CHECK `AtividadeApontamento_status_check`). */
export const STATUS_APONTAMENTO = Object.freeze({ CONFIRMADO: 'CONFIRMADO', CANCELADO: 'CANCELADO' });

/** Turnos do apontamento (CHECK `AtividadeApontamento_turno_check`; nulo também vale). */
export const TURNOS = Object.freeze(['MANHA', 'TARDE', 'NOITE']);

/** Origem do apontamento (CHECK `AtividadeApontamento_origem_check`). */
export const ORIGENS = Object.freeze(['WEB', 'APP']);

/** Origem quando o corpo não traz `origem`. */
export const ORIGEM_PADRAO = 'WEB';

/** Motivo (cancelar, reabrir): caracteres ÚTEIS, depois de aparado (§10 do contrato). */
export const MOTIVO_MINIMO = 3;
export const MOTIVO_MAXIMO = 500;

/** Decimal(14, 4) como TEXTO: até 10 dígitos inteiros e 4 casas, sem sinal (≥ 0). */
export const PADRAO_DECIMAL = /^\d{1,10}(\.\d{1,4})?$/;

/** Casas dos decimais na resposta e na gravação (área, produção). */
export const CASAS = CASAS_QUANTIDADE;

/** Decimais do corpo da atividade (abrir, editar). */
export const DECIMAIS_DA_ATIVIDADE = Object.freeze(['area_planejada']);

/** Decimais do corpo do apontamento (lançar, editar). */
export const DECIMAIS_DO_APONTAMENTO = Object.freeze(['area_executada_dia', 'quantidade_produzida_dia']);

/** Todos os decimais dos corpos das duas rotas (as chaves não colidem). */
export const DECIMAIS_DO_CORPO = Object.freeze([...DECIMAIS_DA_ATIVIDADE, ...DECIMAIS_DO_APONTAMENTO]);

/** Leitura consistente sem trava (detalhe: o registro e os totais no mesmo instante). */
export const TRANSACAO_LEITURA = Object.freeze({ maxWait: 2000, timeout: 9000, isolationLevel: /** @type {const} */ ('RepeatableRead') });

/**
 * Ação → status da ATIVIDADE em que ela vale (§3 do contrato). As palavras são
 * as das permissões, quando há uma (`reabrir`, `lancar_apontamento`,
 * `editar_apontamento`, `cancelar_apontamento`); repetir o último lançamento é
 * `lancar_apontamento`. Duplicar a atividade é uma abertura nova e não tem
 * regra de status.
 */
export const STATUS_EXIGIDO_DA_ATIVIDADE = Object.freeze({
  editar: STATUS_ATIVIDADE.ABERTA,
  concluir: STATUS_ATIVIDADE.ABERTA,
  cancelar: STATUS_ATIVIDADE.ABERTA,
  reabrir: STATUS_ATIVIDADE.CONCLUIDA,
  lancar_apontamento: STATUS_ATIVIDADE.ABERTA,
  editar_apontamento: STATUS_ATIVIDADE.ABERTA,
  cancelar_apontamento: STATUS_ATIVIDADE.ABERTA,
});

// ─── normalização do corpo ──────────────────────────────────────────────────

const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * O corpo traz a chave (mesmo com `null`)? Ausente ≠ null: no PATCH, null limpa.
 * @param {Record<string, unknown>} obj @param {string} chave
 */
export const temCampo = (obj, chave) => Object.prototype.hasOwnProperty.call(obj, chave);

/**
 * `preValidation` das rotas (antes do AJV, que COERGE número em texto já
 * corrompido pelo float): decimal presente, não nulo e não texto → 400
 * `REQUEST_VALIDATION_FAILED` reason `valor_deve_ser_texto` (`details.campo` =
 * a chave), como no módulo antigo e no Patrimônio.
 * @param {unknown} corpo
 * @param {readonly string[]} [chaves]  padrão: os decimais dos dois corpos
 */
export const recusarCoercao = (corpo, chaves = DECIMAIS_DO_CORPO) => {
  if (!ehObjeto(corpo)) return;
  const c = /** @type {Record<string, unknown>} */ (corpo);
  for (const chave of chaves) {
    if (!temCampo(c, chave)) continue;
    const v = c[chave];
    if (v !== null && v !== undefined && typeof v !== 'string') {
      throw invalido(`${chave} deve ser texto decimal (ex.: "12.5"), nunca número`, { field: chave, reason: 'valor_deve_ser_texto', campo: chave });
    }
  }
};

/**
 * Id de referência do corpo: aparado; `null` limpa; ausente → `undefined`;
 * vazio ou não texto → 400 `formato`.
 * @param {unknown} v @param {string} campo
 * @returns {string|null|undefined}
 */
export const idOuNulo = (v, campo) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string' || !v.trim()) throw invalido(`${campo} inválido`, { field: campo, reason: 'formato' });
  return v.trim();
};

/**
 * Decimal do corpo, TEXTO → texto canônico com 4 casas (`"12.5"` → `"12.5000"`,
 * sem float; é o valor que se grava e se compara). `null` limpa; ausente →
 * `undefined`; fora de `PADRAO_DECIMAL` (inclusive negativo) → 400 `formato`.
 * Para fazer conta, `dec(valor)` de `financeiro/decimalFinanceiro.js`.
 * @param {unknown} v @param {string} campo
 * @returns {string|null|undefined}
 */
export const decimalDoCorpo = (v, campo) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string' || !PADRAO_DECIMAL.test(v)) {
    throw invalido(`${campo} tem formato inválido: use texto decimal não negativo, com até 10 dígitos e 4 casas (ex.: "12.5")`, { field: campo, reason: 'formato' });
  }
  return dec(v).toFixed(CASAS);
};

/**
 * Dia do CORPO (`AAAA-MM-DD`) que existe no calendário. `null` limpa; ausente
 * → `undefined`; inexistente (ex.: 2026-02-30) → 422 `ATIVIDADE_DATA_INVALIDA`
 * reason `data_inexistente` do campo. O formato já vem conferido pelo schema.
 * @param {unknown} v @param {string} campo  ex.: `data_inicio`, `data_operacional`
 * @returns {string|null|undefined}
 */
export const diaDoCorpo = (v, campo) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!ehDiaValido(v)) throw atividadeDataInvalida(campo, 'data_inexistente');
  return /** @type {string} */ (v);
};

/**
 * Dia de FILTRO da querystring (`data_de`, `data_ate`): inexistente → 400
 * `REQUEST_VALIDATION_FAILED` reason `data_inexistente`, como os filtros do
 * módulo antigo (filtro malformado é pedido inválido, não dado recusado).
 * @param {unknown} v @param {string} campo
 * @returns {string}
 */
export const diaDoFiltro = (v, campo) => {
  if (!ehDiaValido(v)) throw invalido(`${campo} não existe; use AAAA-MM-DD`, { field: campo, reason: 'data_inexistente' });
  return /** @type {string} */ (v);
};

/**
 * Motivo do cancelamento ou da reabertura: aparado, sem caractere de controle
 * nem marcação (senão 400, `textoDoCorpo`), com `MOTIVO_MINIMO`..`MOTIVO_MAXIMO`
 * caracteres úteis. Ausente, vazio ou só espaços → 422
 * `ATIVIDADE_MOTIVO_INVALIDO` reason `obrigatorio`; curto → `curto`; longo → `longo`.
 * @param {unknown} v
 * @returns {string}
 */
export const motivoDoCorpo = (v) => {
  const motivo = textoDoCorpo(v, 'motivo');
  const limites = { minimo: MOTIVO_MINIMO, maximo: MOTIVO_MAXIMO };
  if (!motivo) throw atividadeMotivoInvalido('obrigatorio', limites);
  const tamanho = [...motivo].length;
  if (tamanho < MOTIVO_MINIMO) throw atividadeMotivoInvalido('curto', limites);
  if (tamanho > MOTIVO_MAXIMO) throw atividadeMotivoInvalido('longo', limites);
  return motivo;
};

// ─── o "hoje" da fazenda ────────────────────────────────────────────────────

/**
 * Relógio da fazenda num instante só: o "agora" e o "hoje" saem do MESMO
 * `agoraDoServidor()` (fixável só em NODE_ENV=test), no fuso IANA da Empresa,
 * lido com a Empresa FOR SHARE (uma troca de fuso em andamento termina antes).
 * Sem fuso configurado, falha fechado: 409 `EMPRESA_FUSO_NAO_CONFIGURADO`.
 * Chame dentro da transação da escrita, ANTES de travar a atividade (ordem
 * canônica das travas: Empresa FOR SHARE → Atividade FOR UPDATE).
 * @param {any} tx @param {string} clienteId  do auth_context @param {string} empresaId  já conferida no tenant
 * @returns {Promise<{ agora: Date, hoje: string, fuso: string }>}
 */
export const tempoDaFazenda = async (tx, clienteId, empresaId) => {
  const fuso = await fusoDaEmpresa(tx, clienteId, empresaId);
  const agora = agoraDoServidor();
  return { agora, hoje: diaNoFuso(agora, fuso), fuso };
};

/**
 * Só o que já aconteceu: dia posterior a "hoje" na fazenda → 422
 * `ATIVIDADE_DATA_INVALIDA` reason `futura` (com `data`, `hoje` e `fuso`).
 * @param {{ hoje: string, fuso: string }} tempo  de `tempoDaFazenda`
 * @param {string} dia  `AAAA-MM-DD`
 * @param {string} [campo]  `data_inicio`, `data_conclusao`, `data_operacional`…
 */
export const exigirDiaNaoFuturo = ({ hoje, fuso }, dia, campo = 'data_operacional') => {
  if (dia > hoje) throw atividadeDataInvalida(campo, 'futura', { data: dia, hoje, fuso });
};

// ─── status e versão (CAS) ──────────────────────────────────────────────────

/**
 * A ação só vale no status de `STATUS_EXIGIDO_DA_ATIVIDADE` (ex.: lançar só em
 * ABERTA; reabrir só em CONCLUIDA); senão 409 `ATIVIDADE_STATUS_INVALIDO` com
 * `details.status`/`acao`/`entidade = 'atividade'`. Ação sem regra é defeito de
 * programação (erro comum → 500).
 * @param {{ status: string }} atividade
 * @param {keyof typeof STATUS_EXIGIDO_DA_ATIVIDADE} acao
 */
export const exigirStatusDaAtividade = (atividade, acao) => {
  const exigido = STATUS_EXIGIDO_DA_ATIVIDADE[acao];
  if (!exigido) throw new Error(`atividadeComum: ação sem regra de status (${String(acao)})`);
  if (atividade.status !== exigido) throw atividadeStatusInvalido({ status: atividade.status, acao, entidade: 'atividade' });
};

/**
 * Editar e cancelar só apontamento CONFIRMADO; senão 409
 * `ATIVIDADE_STATUS_INVALIDO` com `entidade = 'apontamento'`. (O status da
 * atividade se confere à parte, com `exigirStatusDaAtividade`.)
 * @param {{ status: string }} apontamento
 * @param {'editar_apontamento'|'cancelar_apontamento'} acao
 */
export const exigirApontamentoConfirmado = (apontamento, acao) => {
  if (apontamento.status !== STATUS_APONTAMENTO.CONFIRMADO) {
    throw atividadeStatusInvalido({ status: apontamento.status, acao, entidade: 'apontamento' });
  }
};

/**
 * A `versao` do corpo tem de ser a do registro lido (antes de qualquer
 * escrita); senão 409 `ATIVIDADE_VERSAO_CONFLITO` com `versao_atual`,
 * `versao_informada` e `entidade`.
 * @param {{ versao: number }} registro @param {unknown} versaoInformada
 * @param {'atividade'|'apontamento'} [entidade]
 */
export const exigirVersao = (registro, versaoInformada, entidade = 'atividade') => {
  if (registro.versao !== versaoInformada) throw atividadeVersaoConflito(registro.versao, versaoInformada, { entidade });
};

/**
 * UPDATE com CAS por `versao` E pelo status esperado, no escopo
 * (cliente_id, empresa_id, id); incrementa a `versao` uma vez. Devolve a
 * contagem (0 = perdeu a corrida ou mudou de status: ver `erroDoCasPerdido`).
 * @param {any} delegado  `tx.atividade` ou `tx.atividadeApontamento`
 * @param {{ clienteId: string, empresaId: string, id: string, versao: number, statusEsperado: string,
 *   dados: Record<string, unknown>, onde?: Record<string, unknown> }} pedido
 *   `onde`: filtro a mais (ex.: `{ atividade_id }` no apontamento); o escopo vence
 * @returns {Promise<number>}
 */
export const atualizarComVersao = async (delegado, { clienteId, empresaId, id, versao, statusEsperado, dados, onde = {} }) => {
  const r = await delegado.updateMany({
    where: { ...onde, cliente_id: clienteId, empresa_id: empresaId, id, versao, status: statusEsperado },
    data: { ...dados, versao: { increment: 1 } },
  });
  return r.count;
};

/**
 * CAS perdido (`atualizarComVersao` devolveu 0): relê versão e status e
 * devolve o erro certo — 404 (sumiu), 409 `ATIVIDADE_STATUS_INVALIDO` (mudou
 * de status) ou 409 `ATIVIDADE_VERSAO_CONFLITO` (outra versão).
 * @param {any} delegado  `tx.atividade` ou `tx.atividadeApontamento`
 * @param {{ clienteId: string, empresaId: string, id: string, versao: number, statusEsperado: string,
 *   acao: string, entidade?: 'atividade'|'apontamento', onde?: Record<string, unknown> }} pedido
 */
export const erroDoCasPerdido = async (delegado, { clienteId, empresaId, id, versao, statusEsperado, acao, entidade = 'atividade', onde = {} }) => {
  const atual = await delegado.findFirst({
    where: { ...onde, cliente_id: clienteId, empresa_id: empresaId, id },
    select: { versao: true, status: true },
  });
  if (!atual) return entidade === 'apontamento' ? atividadeApontamentoNotFound() : atividadeNotFound();
  if (atual.status !== statusEsperado) return atividadeStatusInvalido({ status: atual.status, acao, entidade });
  return atividadeVersaoConflito(atual.versao, versao, { entidade });
};

// ─── escrita com a FK traduzida ─────────────────────────────────────────────

/** Colunas cujo cadastro vem do corpo ou é herdado (tipo, área): FK violada → 422 do campo. */
const CAMPOS_DE_REFERENCIA = Object.freeze([
  'tipo_atividade_id',
  'grupo_atividade_id',
  'area_id',
  'setor_id',
  'bem_id',
  'centro_custo_id',
  'centro_resultado_id',
  'unidade_producao_id',
  'lancamento_tarefa_id',
  'operador_usuario_id',
]);

/**
 * Escrita na atividade ou no apontamento. A FK composta é a rede do banco: um
 * cadastro que sumiu entre a conferência e o INSERT/UPDATE (corrida) vira 422
 * `ATIVIDADE_REFERENCIA_INVALIDA` do campo, reason `inexistente`; a atividade
 * do apontamento, 404 `ATIVIDADE_NOT_FOUND`. Nunca o 403 genérico do P2003.
 * Outras FKs (empresa, usuários da autoria) e qualquer outro erro seguem.
 * Chame dentro da transação, em volta de UMA escrita (depois do erro, a
 * transação do PostgreSQL já está abortada).
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export const comFkTraduzida = async (fn) => {
  try {
    return await fn();
  } catch (erro) {
    const fk = fkDaAtividadeNaEscrita(erro);
    if (fk?.campo === 'atividade_id') throw atividadeNotFound(undefined, { cause: erro });
    if (fk && CAMPOS_DE_REFERENCIA.includes(fk.campo)) {
      throw atividadeReferenciaInvalida(/** @type {any} */ (fk.campo), 'inexistente', { cause: erro });
    }
    throw erro;
  }
};

// ─── formas públicas ────────────────────────────────────────────────────────

/** Decimal → texto com 4 casas; nulo → null. @param {unknown} v @returns {string|null} */
export const t4 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(CASAS));

/** Usuário: só `{ id, nome }` (o login é credencial e nunca sai). @param {any} u */
export const usuarioPublico = (u) => (u ? { id: u.id, nome: u.nome } : null);

/** @param {any} b */
export const bemPublico = (b) => (b ? { id: b.id, numero: b.numero, codigo_frota: b.codigo_frota ?? null, nome: b.nome, natureza: b.natureza } : null);

/** @param {any} c */
export const centroPublico = (c) => (c ? { id: c.id, numero: c.numero, nome: c.nome } : null);

/** @param {any} a */
export const areaPublica = (a) => (a ? { id: a.id, numero_area: a.numero_area, nome: a.nome } : null);

/** Unidade de produção (`UnidadeMedida`). @param {any} u */
export const unidadePublica = (u) => (u ? { id: u.id, sigla: u.sigla, descricao: u.descricao } : null);

/**
 * Tarefa de origem (`LancamentoTarefa`): o resumo do módulo antigo,
 * `{ id, titulo, status }` (o model não tem número nem nome).
 * @param {any} t
 */
export const tarefaPublica = (t) => (t ? { id: t.id, titulo: t.titulo, status: t.status } : null);

/** Resumos dos cadastros apontados (só exibição), no formato do `select` do Prisma. */
export const BEM_RESUMO = Object.freeze({ select: { id: true, numero: true, codigo_frota: true, nome: true, natureza: true } });
export const USUARIO_RESUMO = Object.freeze({ select: { id: true, nome: true } });
export const CENTRO_RESUMO = Object.freeze({ select: { id: true, numero: true, nome: true } });
export const AREA_RESUMO = Object.freeze({ select: { id: true, numero_area: true, nome: true } });
export const UNIDADE_RESUMO = Object.freeze({ select: { id: true, sigla: true, descricao: true } });
export const TAREFA_RESUMO = Object.freeze({ select: { id: true, titulo: true, status: true } });

/** `include` da atividade: o resumo ao lado de cada id da forma pública. */
export const INCLUIR_ATIVIDADE = Object.freeze({
  area: AREA_RESUMO,
  bem: BEM_RESUMO,
  centroCusto: CENTRO_RESUMO,
  centroResultado: CENTRO_RESUMO,
  unidadeProducao: UNIDADE_RESUMO,
  lancamentoTarefa: TAREFA_RESUMO,
  criadoPor: USUARIO_RESUMO,
  concluidaPor: USUARIO_RESUMO,
  canceladoPor: USUARIO_RESUMO,
  reabertaPor: USUARIO_RESUMO,
});

/**
 * Forma pública da ATIVIDADE (lista e detalhe, §10 do contrato): as colunas e,
 * ao lado de cada id, o resumo do cadastro para exibir.
 * @param {any} r  registro lido com `INCLUIR_ATIVIDADE`
 */
export const comoAtividadePublica = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  numero: r.numero,
  nome: r.nome,
  status: r.status,
  versao: r.versao,
  tipo_atividade_id: r.tipo_atividade_id,
  tipo_atividade_nome: r.tipo_atividade_nome,
  grupo_atividade_id: r.grupo_atividade_id,
  grupo_atividade_nome: r.grupo_atividade_nome,
  area_id: r.area_id ?? null,
  area: areaPublica(r.area),
  setor_id: r.setor_id ?? null,
  setor_nome: r.setor_nome ?? null,
  bem_id: r.bem_id ?? null,
  bem: bemPublico(r.bem),
  safra_ciclo: r.safra_ciclo ?? null,
  centro_custo_id: r.centro_custo_id ?? null,
  centro_custo: centroPublico(r.centroCusto),
  centro_resultado_id: r.centro_resultado_id ?? null,
  centro_resultado: centroPublico(r.centroResultado),
  unidade_producao_id: r.unidade_producao_id ?? null,
  unidade_producao_sigla: r.unidade_producao_sigla ?? null,
  unidade_producao: unidadePublica(r.unidadeProducao),
  data_inicio: diaDe(r.data_inicio),
  data_prevista_fim: diaDe(r.data_prevista_fim),
  data_conclusao: diaDe(r.data_conclusao),
  area_planejada: t4(r.area_planejada),
  area_executada: t4(r.area_executada),
  quantidade_produzida: t4(r.quantidade_produzida),
  lancamento_tarefa_id: r.lancamento_tarefa_id ?? null,
  lancamento_tarefa: tarefaPublica(r.lancamentoTarefa),
  observacao: r.observacao ?? null,
  concluida_em: iso(r.concluida_em),
  concluida_por: usuarioPublico(r.concluidaPor),
  cancelada_em: iso(r.cancelada_em),
  cancelado_por: usuarioPublico(r.canceladoPor),
  motivo_cancelamento: r.motivo_cancelamento ?? null,
  reaberta_em: iso(r.reaberta_em),
  reaberta_por: usuarioPublico(r.reabertaPor),
  motivo_reabertura: r.motivo_reabertura ?? null,
  criado_por: usuarioPublico(r.criadoPor),
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

/**
 * @typedef {{ apontamentos_confirmados: number, apontamentos_cancelados: number, dias_com_apontamento: number }} TotaisDaAtividade
 */

/**
 * DETALHE da atividade: a forma pública + `totais`. É o corpo do
 * `GET /atividades/:id`, de toda escrita do cabeçalho e o `atividade` das
 * escritas do apontamento.
 * @param {any} r  registro lido com `INCLUIR_ATIVIDADE` @param {TotaisDaAtividade} totais
 */
export const comoAtividadeDetalhe = (r, totais) => ({ ...comoAtividadePublica(r), totais });

// ─── leituras e trava (adaptador de dados, sem regra) ───────────────────────

/**
 * Atividade da EMPRESA com os resumos (`INCLUIR_ATIVIDADE`). Outra empresa e
 * outro tenant dão o mesmo `null` (sem oráculo).
 * @param {any} db  cliente Prisma ou transação
 * @param {string} clienteId @param {string} empresaId @param {string} id
 */
export const buscarAtividade = (db, clienteId, empresaId, id) =>
  db.atividade.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, include: INCLUIR_ATIVIDADE });

/**
 * Trava a linha da atividade (`FOR UPDATE`) ANTES de ler ou escrever os
 * apontamentos dela: serializa lançar, editar e cancelar apontamento (a
 * `sequencia` = máx + 1 é calculada sob esta trava) com concluir, reabrir,
 * cancelar e editar o cabeçalho. Ordem canônica: Empresa FOR SHARE
 * (`tempoDaFazenda`, quando a escrita usa o "hoje") → Atividade FOR UPDATE →
 * apontamentos. Outra empresa e outro tenant = inexistente (`false`).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} id
 * @returns {Promise<boolean>}
 */
export const travarAtividade = async (tx, clienteId, empresaId, id) => {
  const linhas = /** @type {any[]} */ (
    await tx.$queryRaw`SELECT id FROM "Atividade" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`
  );
  return linhas.length === 1;
};

/**
 * Totais do detalhe: apontamentos CONFIRMADO, CANCELADO e dias distintos com
 * ao menos um apontamento CONFIRMADO (o cancelado não é trabalho feito). Uma
 * instrução, pelo índice (cliente_id, empresa_id, atividade_id).
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<TotaisDaAtividade>}
 */
export const lerTotaisDaAtividade = async (db, clienteId, empresaId, atividadeId) => {
  const [r] = /** @type {Array<{ confirmados: number, cancelados: number, dias: number }>} */ (
    await db.$queryRaw`SELECT
        COUNT(*) FILTER (WHERE status = 'CONFIRMADO')::int AS confirmados,
        COUNT(*) FILTER (WHERE status = 'CANCELADO')::int AS cancelados,
        (COUNT(DISTINCT data_operacional) FILTER (WHERE status = 'CONFIRMADO'))::int AS dias
      FROM "AtividadeApontamento"
      WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND atividade_id = ${atividadeId}`
  );
  return {
    apontamentos_confirmados: r?.confirmados ?? 0,
    apontamentos_cancelados: r?.cancelados ?? 0,
    dias_com_apontamento: r?.dias ?? 0,
  };
};

/**
 * Detalhe relido (registro + totais). Chame dentro de uma transação — a da
 * escrita, ou `TRANSACAO_LEITURA` no GET — para as duas leituras verem o mesmo
 * instante. Sem a atividade (outra empresa ou tenant) → 404 `ATIVIDADE_NOT_FOUND`.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} id
 */
export const carregarAtividadeDetalhe = async (db, clienteId, empresaId, id) => {
  const r = await buscarAtividade(db, clienteId, empresaId, id);
  if (!r) throw atividadeNotFound();
  return comoAtividadeDetalhe(r, await lerTotaisDaAtividade(db, clienteId, empresaId, id));
};

/**
 * Σ `area_executada_dia` e Σ `quantidade_produzida_dia` dos apontamentos
 * CONFIRMADO, como texto com 4 casas; nenhum confirmado com valor → `null`.
 * É também a "produção somada" que `exige_producao` confere ao concluir.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<{ area_executada: string|null, quantidade_produzida: string|null }>}
 */
export const somarApontamentosConfirmados = async (db, clienteId, empresaId, atividadeId) => {
  const r = await db.atividadeApontamento.aggregate({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, status: STATUS_APONTAMENTO.CONFIRMADO },
    _sum: { area_executada_dia: true, quantidade_produzida_dia: true },
  });
  return { area_executada: t4(r._sum.area_executada_dia), quantidade_produzida: t4(r._sum.quantidade_produzida_dia) };
};

/**
 * Recalcula `area_executada` e `quantidade_produzida` do cabeçalho como a soma
 * dos apontamentos CONFIRMADO (§3 do contrato), na transação de quem chama e
 * SOB `travarAtividade`. Não mexe na `versao` do cabeçalho: os totais são
 * derivados (o PATCH não os edita) e a corrida com concluir/cancelar é
 * resolvida pela trava. Devolve as somas gravadas.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 */
export const recalcularTotaisDaAtividade = async (tx, clienteId, empresaId, atividadeId) => {
  const somas = await somarApontamentosConfirmados(tx, clienteId, empresaId, atividadeId);
  await tx.atividade.updateMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId },
    data: { area_executada: somas.area_executada, quantidade_produzida: somas.quantidade_produzida },
  });
  return somas;
};
