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
// D-PROD-319: as tarefas presas no armazenamento antigo do aparelho sobem nas passadas da sincronização.
import {
  listarTarefasGuardadasNoAparelho,
  tentarDeNovoTarefaGuardada,
  excluirTarefaGuardadaNoAparelho,
} from '@/services/tarefasGuardadasNoAparelhoService';
// D-PROD-324: as fotos de tarefa tiradas sem internet sobem nas passadas da sincronização.
import {
  EVENTO_FOTOS_DE_TAREFA,
  listarFotosAguardandoEnvio,
  tentarDeNovoFotosDaTarefa,
  excluirFotoGuardada,
} from '@/services/fotosDeTarefaAguardandoService';
import {
  getOfflineSyncEventName,
  listarItensDaFilaDeEntidades,
  tentarDeNovoNaFilaDeEntidades,
  excluirDaFilaDeEntidades,
} from '@/lib/offline/offlineEntityRuntime';

/**
 * D-PROD-328 — a FILA ÚNICA. Antes, a janela "Sincronização" mostrava só a fila do motor (cochos, depósitos) e os
 * cadastros recusados; o resto (cadastros esperando, tarefas e fotos guardadas) era um número ou nem aparecia, e um
 * item que não subia ficava preso para sempre, sem botão. Agora tudo que espera envio entra numa lista só, cada item
 * com o que é, quando foi feito, a situação, o motivo (quando há) e as ações: "Tentar de novo" e "Excluir".
 *
 * Origens (o id da lista diz de onde o item vem):
 *  - motor        (id do motor)          lançamento e leitura de cocho, transferência entre depósitos…
 *  - cadastro:<n>                         a fila antiga, por entidade (criação, alteração, exclusão)
 *  - foto:<tarefa>                        as fotos de uma tarefa tiradas sem internet
 *  - tarefa-antiga:<chave>                tarefa do armazenamento antigo do aparelho
 *
 * `estado`: "aguardando" (vai sozinho), "confirmando" (tentou e o servidor não respondeu), "esperando" (espera outro
 * registro subir antes), "atencao" (precisa da pessoa).
 *
 * @typedef {{ id: string, origem: 'motor'|'cadastro'|'foto'|'tarefa-antiga', tipo: string, rotulo: string,
 *   estado: 'aguardando'|'confirmando'|'esperando'|'atencao', motivo: string|null, criado_em: string,
 *   tentativas: number, ultimaTentativaEm: string|null, podeTentar: boolean, avisoAoExcluir: string|null,
 *   detalhes: Array<{ rotulo: string, valor: string }>, confirmando: boolean, progresso: Record<string, any>,
 *   ultimo_erro: { mensagem: string } | null }} ItemDaFilaUnica
 */

const PREFIXO_CADASTRO = 'cadastro:';
const PREFIXO_FOTO = 'foto:';
const PREFIXO_TAREFA_ANTIGA = 'tarefa-antiga:';
const OPERACAO = { create: 'Cadastro', update: 'Alteração', delete: 'Exclusão' };
/** "CategoriaManejo" → "categoria manejo". */
const nomeDaEntidade = (nome) =>
  String(nome || 'registro')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
/** @param {string} id @param {string} prefixo */
const semPrefixo = (id, prefixo) => (String(id).startsWith(prefixo) ? String(id).slice(prefixo.length) : null);
/** O id do IndexedDB é numérico; o da lista é texto. */
const comoIdDaFila = (texto) => (/^\d+$/.test(texto) ? Number(texto) : texto);

/** Campos que não ajudam a pessoa a reconhecer o registro. */
const CAMPOS_INTERNOS = new Set(['id', 'cliente_id', 'empresa_id', 'usuario_id', 'created_by', 'versao_esperada', 'historico_evento', 'historico_descricao', 'historico_data_evento']);
/** "data_prevista" → "Data prevista". @param {string} k */
const rotuloDoCampo = (k) => {
  const t = String(k).replace(/_id$/, '').replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
/**
 * O conteúdo do registro em linhas simples (para o "Ver detalhes"): só campos de texto, número e sim/não, sem os
 * internos nem os enormes (fotos em `data:`).
 * @param {unknown} dados
 * @returns {Array<{ rotulo: string, valor: string }>}
 */
export const detalhesDoConteudo = (dados) => {
  if (!dados || typeof dados !== 'object') return [];
  const linhas = [];
  const visitar = (obj, prefixo = '') => {
    for (const [k, v] of Object.entries(obj)) {
      if (linhas.length >= 12) return;
      if (CAMPOS_INTERNOS.has(k) || k.startsWith('_')) continue;
      if (v && typeof v === 'object' && !Array.isArray(v) && !prefixo) {
        visitar(v, `${rotuloDoCampo(k)} › `);
        continue;
      }
      if (Array.isArray(v)) {
        if (v.length && k === 'fotos') linhas.push({ rotulo: 'Fotos', valor: String(v.length) });
        continue;
      }
      if (v === null || v === undefined || v === '') continue;
      if (typeof v === 'boolean') linhas.push({ rotulo: `${prefixo}${rotuloDoCampo(k)}`, valor: v ? 'Sim' : 'Não' });
      else if (typeof v === 'number' || (typeof v === 'string' && v.length <= 120 && !v.startsWith('data:'))) {
        linhas.push({ rotulo: `${prefixo}${rotuloDoCampo(k)}`, valor: String(v) });
      }
    }
  };
  visitar(/** @type {Record<string, unknown>} */ (dados));
  return linhas;
};

/** Nome que a pessoa reconhece no registro (título, nome, código). @param {any} dados */
const nomeDoRegistro = (dados) => {
  const n = dados?.titulo || dados?.nome || dados?.nome_tipo || dados?.nome_grupo || dados?.codigo || dados?.identificacao;
  return typeof n === 'string' && n.trim() ? n.trim() : '';
};

/** Eventos que avisam mudança em alguma das filas. */
export const eventosDaFilaDeEnvio = () => [EVENTO_FILA_DE_ENVIO, getOfflineSyncEventName(), EVENTO_FOTOS_DE_TAREFA];

const SEM_DATA = new Date(0).toISOString();

/**
 * A fila única desta sessão.
 * @returns {Promise<{aguardando: number, atencao: number, enviando: boolean, itens: ItemDaFilaUnica[], outrosAguardando: number}>}
 */
export const lerFilaDeEnvio = async () => {
  const [motor, cadastros, fotos, tarefasAntigas] = await Promise.all([
    resumoDaFila(),
    listarItensDaFilaDeEntidades().catch(() => []),
    listarFotosAguardandoEnvio().catch(() => []),
    listarTarefasGuardadasNoAparelho().catch(() => []),
  ]);

  /** @type {ItemDaFilaUnica[]} */
  const itens = [];
  for (const i of motor.itens) {
    const confirmando = Boolean(i.confirmando);
    const baixaFeita = i.progresso?.saida_feita;
    itens.push({
      id: i.id,
      origem: 'motor',
      tipo: i.tipo,
      rotulo: i.rotulo,
      estado: i.estado === 'atencao' ? 'atencao' : confirmando ? 'confirmando' : 'aguardando',
      motivo: i.ultimo_erro?.mensagem ?? null,
      criado_em: i.criado_em,
      tentativas: Number(i.tentativas ?? 0),
      ultimaTentativaEm: i.ultimo_erro?.em ?? null,
      podeTentar: true,
      avisoAoExcluir: baixaFeita
        ? `A baixa de ${baixaFeita.quantidade} kg no estoque JÁ FOI FEITA e não será desfeita: depois, ajuste o estoque. Prefira "Tentar de novo".`
        : confirmando
          ? 'Ele já foi enviado uma vez e o sistema não respondeu: pode já ter chegado. Se chegou, continua lá — confira depois.'
          : null,
      detalhes: detalhesDoConteudo(i.payload),
      confirmando,
      progresso: i.progresso ?? {},
      ultimo_erro: i.ultimo_erro ?? null,
    });
  }
  for (const c of cadastros) {
    const nome = nomeDoRegistro(c.dados);
    itens.push({
      id: `${PREFIXO_CADASTRO}${c.id}`,
      origem: 'cadastro',
      tipo: 'cadastro',
      rotulo: `${OPERACAO[c.operacao] ?? 'Registro'} de ${nomeDaEntidade(c.entidade)}${nome ? `: ${nome}` : ''}`,
      estado: c.situacao === 'aguardando' ? 'aguardando' : 'atencao',
      motivo: c.motivo,
      criado_em: c.criado_em ?? SEM_DATA,
      tentativas: c.tentativas,
      ultimaTentativaEm: c.ultimaTentativaEm,
      podeTentar: c.situacao !== 'retido',
      avisoAoExcluir: c.operacao === 'create' ? 'O registro some do celular, junto com as alterações feitas nele depois.' : null,
      detalhes: detalhesDoConteudo(c.dados),
      confirmando: false,
      progresso: {},
      ultimo_erro: c.situacao === 'aguardando' ? null : { mensagem: c.motivo ?? '' },
    });
  }
  /** @type {Map<string, typeof fotos>} */
  const fotosPorTarefa = new Map();
  for (const f of fotos) fotosPorTarefa.set(f.tarefaId, [...(fotosPorTarefa.get(f.tarefaId) ?? []), f]);
  for (const [tarefaId, lista] of fotosPorTarefa) {
    const atencao = lista.some((f) => f.situacao === 'atencao');
    const esperando = lista.every((f) => f.situacao === 'esperando');
    const comErro = lista.find((f) => f.motivo);
    let bytes = 0;
    for (const f of lista) bytes += Number(f.tamanho || 0);
    const kb = Math.round(bytes / 1024);
    itens.push({
      id: `${PREFIXO_FOTO}${tarefaId}`,
      origem: 'foto',
      tipo: 'foto',
      rotulo: lista.length === 1 ? 'Foto de tarefa' : `${lista.length} fotos de tarefa`,
      estado: atencao ? 'atencao' : esperando ? 'esperando' : 'aguardando',
      motivo: comErro?.motivo ?? (esperando ? 'Espera a tarefa chegar ao sistema.' : null),
      criado_em: lista.map((f) => f.criado_em).filter(Boolean).sort()[0] ?? SEM_DATA,
      tentativas: Math.max(...lista.map((f) => f.tentativas)),
      ultimaTentativaEm: comErro?.ultimaTentativaEm ?? null,
      podeTentar: true,
      avisoAoExcluir: 'As fotos saem do celular e não vão para a tarefa.',
      detalhes: [
        { rotulo: 'Fotos', valor: String(lista.length) },
        { rotulo: 'Tamanho', valor: `${kb.toLocaleString('pt-BR')} KB` },
      ],
      confirmando: false,
      progresso: {},
      ultimo_erro: comErro ? { mensagem: comErro.motivo ?? '' } : null,
    });
  }
  for (const t of tarefasAntigas) {
    itens.push({
      id: `${PREFIXO_TAREFA_ANTIGA}${t.chave}`,
      origem: 'tarefa-antiga',
      tipo: 'tarefa',
      rotulo: `${t.operacao === 'update' ? 'Alteração da tarefa' : 'Tarefa'}: ${t.titulo}`,
      estado: t.situacao,
      motivo: t.motivo,
      criado_em: t.criado_em ?? SEM_DATA,
      tentativas: t.tentativas,
      ultimaTentativaEm: t.ultimaTentativaEm,
      podeTentar: true,
      avisoAoExcluir: t.fotos ? `A tarefa e as ${t.fotos} foto(s) dela saem do celular.` : 'A tarefa sai do celular.',
      detalhes: detalhesDoConteudo(t.dados),
      confirmando: false,
      progresso: {},
      ultimo_erro: t.motivo ? { mensagem: t.motivo } : null,
    });
  }
  // Primeiro o que precisa da pessoa; depois, do mais antigo para o mais novo.
  itens.sort((a, b) => Number(b.estado === 'atencao') - Number(a.estado === 'atencao') || String(a.criado_em).localeCompare(String(b.criado_em)));
  const atencao = itens.filter((i) => i.estado === 'atencao').length;
  return {
    aguardando: itens.length - atencao,
    atencao,
    enviando: motor.enviando,
    itens,
    outrosAguardando: cadastros.filter((c) => c.situacao === 'aguardando').length,
  };
};

/** "Enviar agora". */
export const enviarAgora = () => sincronizarTudo({ jaEmVoltaDaRede: true });

/** "Tentar de novo" em qualquer item da fila única. @param {string} id */
export const tentarEnviarDeNovo = async (id) => {
  const cadastro = semPrefixo(id, PREFIXO_CADASTRO);
  if (cadastro !== null) {
    await tentarDeNovoNaFilaDeEntidades(comoIdDaFila(cadastro));
    return sincronizarTudo();
  }
  const foto = semPrefixo(id, PREFIXO_FOTO);
  if (foto !== null) return tentarDeNovoFotosDaTarefa(foto);
  const antiga = semPrefixo(id, PREFIXO_TAREFA_ANTIGA);
  if (antiga !== null) return tentarDeNovoTarefaGuardada(comoIdDaFila(antiga));
  return tentarDeNovo(id);
};

/** "Excluir" qualquer item da fila única (a pessoa decidiu que ele não vai ao sistema). @param {string} id */
export const descartarRegistroNaoEnviado = async (id) => {
  const cadastro = semPrefixo(id, PREFIXO_CADASTRO);
  if (cadastro !== null) {
    const item = (await listarItensDaFilaDeEntidades()).find((i) => String(i.id) === String(comoIdDaFila(cadastro)));
    const excluidos = await excluirDaFilaDeEntidades(comoIdDaFila(cadastro));
    if (item?.entidade === 'LancamentoTarefa') {
      // D-PROD-337: a tarefa criada no aparelho que a pessoa excluiu da fila leva junto as fotos guardadas dela (antes
      // ficavam no celular, falhavam e iam para "precisa de atenção"), e o mapa tira o pino na hora.
      if (item.operacao === 'create' && item.registroId) {
        for (const f of (await listarFotosAguardandoEnvio()).filter((x) => x.tarefaId === item.registroId)) await excluirFotoGuardada(f.chave);
      }
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('atualizar-mapa', { detail: { cacheKeys: ['tarefas'] } }));
    }
    return excluidos > 0;
  }
  const foto = semPrefixo(id, PREFIXO_FOTO);
  if (foto !== null) {
    for (const f of (await listarFotosAguardandoEnvio()).filter((x) => x.tarefaId === foto)) await excluirFotoGuardada(f.chave);
    return true;
  }
  const antiga = semPrefixo(id, PREFIXO_TAREFA_ANTIGA);
  if (antiga !== null) return excluirTarefaGuardadaNoAparelho(comoIdDaFila(antiga));
  return descartarDaFila(id, { mesmoSemResposta: true });
};

/** Registros do motor que citam este (é preciso excluir antes o mais recente). @param {string} id */
export const dependentesDoRegistro = async (id) =>
  [PREFIXO_CADASTRO, PREFIXO_FOTO, PREFIXO_TAREFA_ANTIGA].some((p) => String(id).startsWith(p)) ? [] : dependentesNaFila(id);

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
 * D-PROD-311 — nutrição feita sem internet (lançamento de cocho, com rateio aos lotes) que ainda
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
