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
  atividadeAreaNotFound,
  atividadeDataInvalida,
  atividadeMotivoInvalido,
  atividadeNotFound,
  atividadeReferenciaInvalida,
  atividadeStatusInvalido,
  atividadeVersaoConflito,
} from '../../shared/errors/AppError.js';
import { fkDaAtividadeNaEscrita } from '../../shared/errors/vinculoAtividade.js';
import { registrarEvento } from '../auditoria/auditService.js';
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
  // D-PROD-211 (Fatia 5): cancelar um abastecimento ligado à atividade (a concluída tem os totais fechados: reabra antes).
  cancelar_abastecimento: STATUS_ATIVIDADE.ABERTA,
  // D-PROD-249: as áreas da atividade só mudam com ela ABERTA.
  adicionar_area: STATUS_ATIVIDADE.ABERTA,
  iniciar_area: STATUS_ATIVIDADE.ABERTA,
  editar_area: STATUS_ATIVIDADE.ABERTA,
  concluir_area: STATUS_ATIVIDADE.ABERTA,
  reabrir_area: STATUS_ATIVIDADE.ABERTA,
  remover_area: STATUS_ATIVIDADE.ABERTA,
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
 * @param {'atividade'|'apontamento'|'area'} [entidade]
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
 *   acao: string, entidade?: 'atividade'|'apontamento'|'area', onde?: Record<string, unknown> }} pedido
 */
export const erroDoCasPerdido = async (delegado, { clienteId, empresaId, id, versao, statusEsperado, acao, entidade = 'atividade', onde = {} }) => {
  const atual = await delegado.findFirst({
    where: { ...onde, cliente_id: clienteId, empresa_id: empresaId, id },
    select: { versao: true, status: true },
  });
  if (!atual) return entidade === 'apontamento' ? atividadeApontamentoNotFound() : entidade === 'area' ? atividadeAreaNotFound() : atividadeNotFound();
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
  // D-PROD-249: a área do lançamento (FK composta para AtividadeArea).
  'atividade_area_id',
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

/** D-PROD-249 — resumo da área de uma atividade de várias áreas (com o tamanho, para a área planejada padrão). */
export const AREA_DA_ATIVIDADE_RESUMO = Object.freeze({ select: { id: true, numero_area: true, nome: true, tamanho_hectares: true } });

/** D-PROD-249 — as áreas da atividade, na ordem em que entraram. */
export const INCLUIR_AREAS_DA_ATIVIDADE = Object.freeze({ orderBy: [{ ordem: 'asc' }, { id: 'asc' }], include: { area: AREA_DA_ATIVIDADE_RESUMO } });

/**
 * D-PROD-249 — forma pública de UMA área da atividade.
 * @param {any} r  registro de `AtividadeArea` com `area`
 */
export const comoAreaDaAtividadePublica = (r) => ({
  id: r.id,
  atividade_id: r.atividade_id,
  area_id: r.area_id,
  area: r.area ? { id: r.area.id, numero_area: r.area.numero_area, nome: r.area.nome, tamanho_hectares: t4(r.area.tamanho_hectares) } : null,
  setor_id: r.setor_id ?? null,
  setor_nome: r.setor_nome ?? null,
  area_planejada: t4(r.area_planejada),
  status: r.status,
  data_inicio: diaDe(r.data_inicio),
  data_conclusao: diaDe(r.data_conclusao),
  ordem: r.ordem,
  versao: r.versao,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

/** MAIKE-ENTREGA2 (D-PROD-270) — resumo da cultura (capim plantado e consórcio) do plantio. */
export const CULTURA_RESUMO = Object.freeze({ select: { id: true, codigo: true, nome: true, especie: true, cultivar: true, tipo: true } });

/** MAIKE-ENTREGA2 (D-PROD-270) — os dados do plantio de pastagem, com o resumo das culturas. */
export const PLANTIO_RESUMO = Object.freeze({
  select: {
    cultura_id: true, forma_plantio: true, semente_incrustada: true, cobertura: true, consorcio_cultura_id: true,
    cultura: CULTURA_RESUMO, consorcio: CULTURA_RESUMO,
  },
});

/** @param {any} c */
const culturaPublica = (c) => (c ? { id: c.id, codigo: c.codigo, nome: c.nome, especie: c.especie ?? null, cultivar: c.cultivar ?? null, tipo: c.tipo } : null);

/**
 * MAIKE-ENTREGA2 (D-PROD-270) — forma pública dos dados do plantio (nulo fora do Plantio de pastagem).
 * @param {any} p  registro de `AtividadePlantio` com `cultura` e `consorcio`
 */
export const plantioPublico = (p) =>
  p
    ? {
        cultura_id: p.cultura_id,
        cultura: culturaPublica(p.cultura),
        forma_plantio: p.forma_plantio ?? null,
        semente_incrustada: p.semente_incrustada ?? null,
        cobertura: p.cobertura ?? null,
        consorcio_cultura_id: p.consorcio_cultura_id ?? null,
        consorcio: culturaPublica(p.consorcio),
      }
    : null;

/** `include` da atividade: o resumo ao lado de cada id da forma pública. */
export const INCLUIR_ATIVIDADE = Object.freeze({
  // D-PROD-249: as áreas (várias áreas por atividade).
  areas: INCLUIR_AREAS_DA_ATIVIDADE,
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
  // MAIKE-ENTREGA2 (D-PROD-270): o capim plantado e os dados do plantio.
  plantio: PLANTIO_RESUMO,
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
  // D-PROD-249: as áreas da atividade (a 1ª é a `area_id` acima) e quantas são.
  areas: (r.areas ?? []).map(comoAreaDaAtividadePublica),
  areas_count: (r.areas ?? []).length,
  // MAIKE-ENTREGA2 (D-PROD-270): onde foi o serviço sem área (Manutenção e Outros) e o plantio (capim e dados).
  local: r.local ?? null,
  plantio: plantioPublico(r.plantio),
});

/**
 * @typedef {{ apontamentos_confirmados: number, apontamentos_cancelados: number, dias_com_apontamento: number }} TotaisDaAtividade
 */

/**
 * @typedef {{ pasto_liberado_em: string|null, carencia_dias: number|null }} PastoLiberado
 */

/**
 * D-PROD-270 — "Pasto liberado em": o fim do serviço (`AAAA-MM-DD`) mais a MAIOR carência (dias) entre os produtos. Sem
 * nenhuma carência cadastrada (ou sem fim), nulo: o sistema não inventa prazo.
 * @param {string|null|undefined} fim @param {Array<number|null|undefined>} carencias
 * @returns {PastoLiberado}
 */
export const pastoLiberadoEm = (fim, carencias) => {
  const validas = carencias.filter((c) => Number.isInteger(c) && /** @type {number} */ (c) >= 0).map(Number);
  if (!validas.length || typeof fim !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) return { pasto_liberado_em: null, carencia_dias: null };
  const maior = Math.max(...validas);
  const d = new Date(`${fim}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + maior);
  return { pasto_liberado_em: d.toISOString().slice(0, 10), carencia_dias: maior };
};

/**
 * D-PROD-270 (ajuste do teste de ponta a ponta) — o "Pasto liberado em" da ATIVIDADE, calculado na LEITURA (nunca
 * gravado): o último fim lançado (o maior `data_termino ?? data_operacional` dos apontamentos CONFIRMADO) mais a MAIOR
 * carência atual (cadastro do produto) dos produtos das linhas CONFIRMADO desses apontamentos. Uma instrução.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<PastoLiberado>}
 */
export const lerPastoLiberadoDaAtividade = async (db, clienteId, empresaId, atividadeId) => {
  const [r] = /** @type {Array<{ fim: Date|null, carencia: number|null }>} */ (
    await db.$queryRaw`SELECT
        (SELECT MAX(COALESCE(a.data_termino, a.data_operacional)) FROM "AtividadeApontamento" a
          WHERE a.cliente_id = ${clienteId} AND a.empresa_id = ${empresaId} AND a.atividade_id = ${atividadeId} AND a.status = 'CONFIRMADO') AS fim,
        (SELECT MAX(pr.carencia_dias) FROM "AtividadeApontamentoProduto" p
          JOIN "AtividadeApontamento" a ON a.cliente_id = p.cliente_id AND a.empresa_id = p.empresa_id AND a.id = p.apontamento_id
          JOIN "Produto" pr ON pr.cliente_id = p.cliente_id AND pr.id = p.produto_id
          WHERE p.cliente_id = ${clienteId} AND p.empresa_id = ${empresaId} AND a.atividade_id = ${atividadeId}
            AND p.status = 'CONFIRMADO' AND a.status = 'CONFIRMADO')::int AS carencia`
  );
  return pastoLiberadoEm(diaDe(r?.fim) ?? null, [r?.carencia ?? null]);
};

/**
 * DETALHE da atividade: a forma pública + `totais`. É o corpo do
 * `GET /atividades/:id`, de toda escrita do cabeçalho e o `atividade` das
 * escritas do apontamento.
 * D-PROD-270 (ajuste do teste de ponta a ponta): e o "pasto liberado em" (`pasto_liberado_em`, `carencia_dias`),
 * calculado na leitura (`lerPastoLiberadoDaAtividade`); sem ele (quem não leu), nulos.
 * @param {any} r  registro lido com `INCLUIR_ATIVIDADE` @param {TotaisDaAtividade} totais @param {PastoLiberado} [liberado]
 */
export const comoAtividadeDetalhe = (r, totais, liberado = { pasto_liberado_em: null, carencia_dias: null }) => ({
  ...comoAtividadePublica(r),
  totais,
  pasto_liberado_em: liberado.pasto_liberado_em,
  carencia_dias: liberado.carencia_dias,
});

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
  return comoAtividadeDetalhe(r, await lerTotaisDaAtividade(db, clienteId, empresaId, id), await lerPastoLiberadoDaAtividade(db, clienteId, empresaId, id));
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

// ─── D-PROD-202 (Fatia 3): linhas de PRODUTO e de MÁQUINA do apontamento ────
//
// Contrato `docs/engineering/MAIKE-ATIVIDADE-LINHAS-CONTRATO.md`. Peças comuns
// às duas linhas (`atividadeApontamentoProduto*.js` e
// `atividadeApontamentoMaquina*.js`) e a forma pública da linha de PRODUTO,
// que o apontamento passa a trazer em `produtos[]` (a de máquina é do serviço
// dela, `comoLinhaMaquinaPublica`).

/** Status da linha (CHECK `…_status_check` das duas tabelas). */
export const STATUS_LINHA = Object.freeze({ CONFIRMADO: 'CONFIRMADO', CANCELADO: 'CANCELADO' });

/**
 * Por que a linha foi cancelada (CHECK `cancelamento_origem`): pela própria
 * linha, pela EDIÇÃO (estorno exato + linha nova), pelo cancelamento do
 * apontamento ou pelo da atividade.
 */
export const ORIGEM_CANCELAMENTO_LINHA = Object.freeze({ LINHA: 'LINHA', EDICAO: 'EDICAO', APONTAMENTO: 'APONTAMENTO', ATIVIDADE: 'ATIVIDADE' });

/** `operation_id` (CHECK `…_textos_check` das duas tabelas e do recibo de idempotência). */
export const PADRAO_OPERATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Teto da chave do LANÇAMENTO com linhas (`POST …/apontamentos` e `…/duplicar`
 * com `produtos[]`/`maquinas[]`): cada linha grava a chave derivada
 * `<operation_id>:p<n>` ou `<operation_id>:m<n>` (`operationIdDaLinha`), que
 * tem de caber nos 128 do CHECK.
 */
export const OPERATION_ID_DO_LANCAMENTO_MAXIMO = 120;

/** Máximo de linhas de cada tipo num lançamento (o corpo do `POST …/apontamentos`). */
export const LINHAS_NO_LANCAMENTO_MAXIMO = 20;

/**
 * `operation_id` do corpo: texto no `PADRAO_OPERATION_ID` (8..128 de
 * `[A-Za-z0-9_.:-]`); senão 400 `formato`.
 * @param {unknown} v @param {number} [maximo]
 * @returns {string}
 */
export const operationIdDoCorpo = (v, maximo = 128) => {
  if (typeof v !== 'string' || !PADRAO_OPERATION_ID.test(v) || v.length > maximo) {
    throw invalido(`operation_id inválido: use de 8 a ${maximo} caracteres entre letras, dígitos, "_", ".", ":" e "-"`, { field: 'operation_id', reason: 'formato' });
  }
  return v;
};

/**
 * Letra da chave derivada de cada tipo de linha (`<operation_id>:<letra><n>`).
 * D-PROD-207 (Fatia 4): `o` = mão de obra, `s` = serviço.
 */
export const LETRA_DA_LINHA = Object.freeze({ produto: 'p', maquina: 'm', mao_obra: 'o', servico: 's' });

/**
 * Chave gravada na linha criada DENTRO de um lançamento (uma chave do corpo
 * para tudo; cada linha precisa da sua, pela unique `(cliente_id, operation_id)`).
 * @param {string} base  `operation_id` do lançamento @param {'produto'|'maquina'|'mao_obra'|'servico'} tipo @param {number} indice  0-based
 */
export const operationIdDaLinha = (base, tipo, indice) => `${base}:${LETRA_DA_LINHA[tipo] ?? 'p'}${indice + 1}`;

/**
 * TODAS as chaves que um lançamento com a chave `base` pode gravar nas linhas
 * de um tipo (`<base>:<letra>1` … `<base>:<letra>N`, N =
 * `LINHAS_NO_LANCAMENTO_MAXIMO`). A busca por elas é EXATA (`operation_id IN
 * (…)`): um prefixo (`LIKE '<base>:o%'`) faria do `_` da chave um curinga e
 * casaria a chave de outro lançamento que só começa igual.
 * @param {string} base @param {'produto'|'maquina'|'mao_obra'|'servico'} tipo
 * @returns {string[]}
 */
export const chavesDerivadasDasLinhas = (base, tipo) =>
  Array.from({ length: LINHAS_NO_LANCAMENTO_MAXIMO }, (_, i) => operationIdDaLinha(base, tipo, i));

/**
 * Status das escritas de linha: atividade ABERTA e apontamento CONFIRMADO;
 * senão 409 `ATIVIDADE_STATUS_INVALIDO` (`entidade` atividade ou apontamento,
 * `acao` `lancar_linha` | `editar_linha` | `cancelar_linha`).
 * @param {{ status: string }} atividade @param {{ status: string }} apontamento
 * @param {'lancar_linha'|'editar_linha'|'cancelar_linha'} acao
 */
export const exigirLinhaGravavel = (atividade, apontamento, acao) => {
  if (atividade.status !== STATUS_ATIVIDADE.ABERTA) throw atividadeStatusInvalido({ status: atividade.status, acao, entidade: 'atividade' });
  if (apontamento.status !== STATUS_APONTAMENTO.CONFIRMADO) throw atividadeStatusInvalido({ status: apontamento.status, acao, entidade: 'apontamento' });
};

/**
 * Editar e cancelar só linha CONFIRMADA; senão 409 `ATIVIDADE_STATUS_INVALIDO`
 * (`entidade` `linha_produto` | `linha_maquina` | `linha_mao_obra` | `linha_servico`).
 * @param {{ status: string }} linha @param {'editar_linha'|'cancelar_linha'} acao
 * @param {'linha_produto'|'linha_maquina'|'linha_mao_obra'|'linha_servico'} entidade
 */
export const exigirLinhaConfirmada = (linha, acao, entidade) => {
  if (linha.status !== STATUS_LINHA.CONFIRMADO) throw atividadeStatusInvalido({ status: linha.status, acao, entidade });
};

/**
 * `preValidation` das rotas com linhas: os decimais DENTRO de `produtos[]` e
 * `maquinas[]` só como texto (o AJV coergiria número em texto já corrompido
 * pelo float) → 400 `valor_deve_ser_texto` com `details.campo` = `produtos[0].quantidade`.
 * @param {unknown} corpo
 * @param {Readonly<Record<string, readonly string[]>>} listas  lista do corpo → decimais de cada item
 */
export const recusarCoercaoNasListas = (corpo, listas) => {
  if (!ehObjeto(corpo)) return;
  const c = /** @type {Record<string, unknown>} */ (corpo);
  for (const [lista, chaves] of Object.entries(listas)) {
    const itens = c[lista];
    if (!Array.isArray(itens)) continue;
    itens.forEach((item, i) => {
      if (!ehObjeto(item)) return;
      for (const chave of chaves) {
        if (!temCampo(item, chave)) continue;
        const v = item[chave];
        if (v !== null && v !== undefined && typeof v !== 'string') {
          const campo = `${lista}[${i}].${chave}`;
          throw invalido(`${campo} deve ser texto decimal (ex.: "12.5"), nunca número`, { field: campo, reason: 'valor_deve_ser_texto', campo });
        }
      }
    });
  }
};

/** Decimais da linha de PRODUTO (corpo da linha e itens de `produtos[]`). */
export const DECIMAIS_DA_LINHA_PRODUTO = Object.freeze(['quantidade', 'vc_percentual']);

/** Resumos das linhas (só exibição), no formato do `select` do Prisma. */
export const PRODUTO_RESUMO = Object.freeze({ select: { id: true, numero_produto: true, nome_produto: true, unidade_principal_estoque: true, carencia_dias: true } });
export const LOCAL_RESUMO = Object.freeze({ select: { id: true, numero_local: true, nome: true } });

/** @param {any} p */
export const produtoPublico = (p) => (p ? { id: p.id, numero: p.numero_produto, nome: p.nome_produto } : null);
/** @param {any} l */
export const localPublico = (l) => (l ? { id: l.id, numero: l.numero_local, nome: l.nome } : null);

/** `include` da linha de PRODUTO: resumos e as fatias FIFO (na ordem do motor). */
export const INCLUIR_LINHA_PRODUTO = Object.freeze({
  produto: PRODUTO_RESUMO,
  localEstoque: LOCAL_RESUMO,
  criadoPor: USUARIO_RESUMO,
  canceladoPor: USUARIO_RESUMO,
  consumos: { orderBy: { ordem: /** @type {const} */ ('asc') } },
});

/**
 * Forma pública da linha de PRODUTO (contrato §2 e §4). `unidade` é a efetiva
 * do estoque (L | KG); custos do FIFO do motor; `fatias` = de qual lote,
 * quanto e a que custo.
 * @param {any} r  registro lido com `INCLUIR_LINHA_PRODUTO`
 */
export const comoLinhaProdutoPublica = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  apontamento_id: r.apontamento_id,
  ordem: r.ordem,
  status: r.status,
  produto_id: r.produto_id,
  produto: produtoPublico(r.produto),
  local_estoque_id: r.local_estoque_id,
  local_estoque: localPublico(r.localEstoque),
  quantidade: t4(r.quantidade),
  unidade: r.unidade,
  dose_ha: t4(r.dose_ha),
  // MAIKE-ENTREGA2 (D-PROD-270): o VC (%) do saco de semente, 2 casas (nulo sem VC).
  vc_percentual: r.vc_percentual === null || r.vc_percentual === undefined ? null : dec(r.vc_percentual).toFixed(2),
  custo_unitario: t4(r.custo_unitario),
  custo_total: t4(r.custo_total),
  movimentacao_estoque_id: r.movimentacao_estoque_id,
  movimentacao_estorno_id: r.movimentacao_estorno_id ?? null,
  fatias: (r.consumos ?? []).map((/** @type {any} */ f) => ({ ordem: f.ordem, lote_id: f.estoque_lote_nota_id, quantidade: t4(f.quantidade), custo_unitario: t4(f.custo_unitario) })),
  observacao: r.observacao ?? null,
  criado_por: usuarioPublico(r.criadoPor),
  cancelado_em: iso(r.cancelado_em),
  cancelado_por: usuarioPublico(r.canceladoPor),
  motivo_cancelamento: r.motivo_cancelamento ?? null,
  cancelamento_origem: r.cancelamento_origem ?? null,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

/**
 * Reenvio conflitante (mesma `operation_id`, corpo diferente) auditado numa
 * transação PRÓPRIA, best-effort (molde do abastecimento e da D-PROD-193): a
 * resposta segue 409 `IDEMPOTENCY_CONFLICT` e nada foi gravado.
 * @param {any} contexto @param {string} entidade @param {string} operationId @param {string} tipoOperacao
 */
export const auditarReenvioConflitante = async (contexto, entidade, operationId, tipoOperacao) => {
  try {
    await registrarEvento(contexto, { acao: 'atividade.reenvio_conflitante', entidade, entidadeId: null, dadosNovos: { operation_id: operationId, tipo_operacao: tipoOperacao } });
  } catch {
    // best-effort documentado: a auditoria do conflito não muda a resposta 409.
  }
};
