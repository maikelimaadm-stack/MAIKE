/**
 * Envio dos registros feitos sem internet (D-PROD-295) — o que as telas usam.
 *
 * As telas não falam com o motor nem com as filas diretamente: daqui saem o
 * resumo ("N aguardando envio", "N precisam de atenção"), o "Enviar agora", o
 * "Tentar de novo" e o "Descartar".
 */

import {
  registrosAguardandoDoTipo,
  resumoDaFila,
  tentarDeNovo,
  descartarDaFila,
  dependentesNaFila,
  definirSessaoDaFila,
  EVENTO_FILA_DE_ENVIO,
} from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { sincronizarTudo, iniciarSincronizacaoAutomatica } from '@/lib/offline/sincronizacao/gatilhosDeSincronizacao';
import { TIPO_LANCAMENTO_COCHO } from '@/lib/offline/sincronizacao/tiposDeEnvio';
import {
  contarPendenciasDaFilaDeEntidades,
  getOfflineSyncEventName,
  listarRecusadosDaFilaDeEntidades,
  descartarRecusadoDaFilaDeEntidades,
  tentarDeNovoRecusadoDaFilaDeEntidades,
} from '@/lib/offline/offlineEntityRuntime';

/** D-PROD-307 — itens da fila antiga (cadastros) entram na lista com este prefixo no id. */
const PREFIXO_CADASTRO = 'cadastro:';
const OPERACAO = { create: 'Cadastro', update: 'Alteração', delete: 'Exclusão' };
/** "CategoriaManejo" → "categoria manejo". */
const nomeDaEntidade = (nome) =>
  String(nome || 'registro')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
const idDoCadastro = (id) => (String(id).startsWith(PREFIXO_CADASTRO) ? String(id).slice(PREFIXO_CADASTRO.length) : null);
/** O id do IndexedDB é numérico; o da lista é texto. */
const comoIdDaFila = (texto) => (/^\d+$/.test(texto) ? Number(texto) : texto);

/** Eventos que avisam mudança em alguma das filas. */
export const eventosDaFilaDeEnvio = () => [EVENTO_FILA_DE_ENVIO, getOfflineSyncEventName()];

/**
 * Resumo das duas filas desta sessão.
 * @returns {Promise<{aguardando: number, atencao: number, enviando: boolean,
 *   itens: Awaited<ReturnType<typeof resumoDaFila>>['itens'], outrosAguardando: number}>}
 */
export const lerFilaDeEnvio = async () => {
  const [motor, outros, recusados] = await Promise.all([
    resumoDaFila(),
    contarPendenciasDaFilaDeEntidades(),
    listarRecusadosDaFilaDeEntidades().catch(() => []),
  ]);
  // D-PROD-307: cadastro que o servidor recusou de vez aparece como "precisa de atenção",
  // com o motivo — antes ele voltava a cada minuto e travava a fila inteira, sem aparecer.
  const itensRecusados = recusados.map((r) => ({
    id: `${PREFIXO_CADASTRO}${r.id}`,
    tipo: 'cadastro',
    rotulo: `${OPERACAO[r.operacao] ?? 'Registro'} de ${nomeDaEntidade(r.entidade)}`,
    estado: 'atencao',
    criado_em: r.em ?? new Date().toISOString(),
    tentativas: 1,
    ultimo_erro: { codigo: 'RECUSADO_PELO_SERVIDOR', mensagem: r.motivo, em: r.em ?? '' },
    esperando: false,
    confirmando: false,
    progresso: {},
  }));
  return {
    ...motor,
    aguardando: motor.aguardando + outros,
    atencao: motor.atencao + itensRecusados.length,
    itens: [...motor.itens, ...itensRecusados],
    outrosAguardando: outros,
  };
};

/** "Enviar agora". */
export const enviarAgora = () => sincronizarTudo();

/** @param {string} id */
export const tentarEnviarDeNovo = async (id) => {
  const cadastro = idDoCadastro(id);
  if (cadastro === null) return tentarDeNovo(id);
  await tentarDeNovoRecusadoDaFilaDeEntidades(comoIdDaFila(cadastro));
  return sincronizarTudo();
};

/** @param {string} id */
export const descartarRegistroNaoEnviado = (id) => {
  const cadastro = idDoCadastro(id);
  return cadastro === null ? descartarDaFila(id) : descartarRecusadoDaFilaDeEntidades(comoIdDaFila(cadastro));
};

/** Registros que citam este (vão para "precisa de atenção" se ele for excluído). @param {string} id */
export const dependentesDoRegistro = async (id) => (idDoCadastro(id) === null ? dependentesNaFila(id) : []);

/** Há algo desta sessão que ainda não chegou ao servidor? */
export const temRegistroNaoEnviado = async () => {
  const r = await lerFilaDeEnvio();
  return r.aguardando + r.atencao > 0;
};

/**
 * Dono da fila (chamado quando a sessão muda) e disparos automáticos.
 * @param {{clienteId: string|null, usuarioId: string|null}|null} sessao
 */
export const ligarEnvioDaSessao = (sessao) => {
  definirSessaoDaFila(sessao?.clienteId ? { cliente_id: sessao.clienteId, usuario_id: sessao.usuarioId } : null);
  if (sessao?.clienteId) {
    iniciarSincronizacaoAutomatica();
    void sincronizarTudo();
  }
};

/**
 * D-PROD-310 — nutrição feita sem internet (lançamento de cocho, com rateio aos lotes) que ainda
 * não chegou ao servidor, desta fazenda. A exclusão de uma movimentação de lote fica bloqueada
 * enquanto houver: o servidor não vê o que está só no aparelho, e o lançamento subiria citando
 * um lote que a exclusão desfez.
 * @param {string|null|undefined} empresaId
 * @returns {Promise<Array<{id: string, rotulo: string}>>}
 */
export const nutricaoAguardandoEnvio = async (empresaId) =>
  (await registrosAguardandoDoTipo(TIPO_LANCAMENTO_COCHO))
    .filter((r) => !empresaId || /** @type {any} */ (r.payload)?.evento?.empresa_id === empresaId)
    .map((r) => ({ id: r.operationId, rotulo: 'Nutrição aguardando envio' }));
