/**
 * Fluxo do NOVO abastecimento e do cancelamento (D-PROD-159/162; D-PROD-211):
 * o estado do formulário, a revisão (prévia no servidor, sem escrita), a
 * confirmação com `operation_id` persistente e o cancelamento com estorno.
 *
 * É o MESMO fluxo da tela Abastecimentos, tirado dela para que o Lançamento de
 * Atividades abra o mesmo formulário já ligado a um lançamento (D-PROD-211),
 * sem um segundo caminho de gravação. Depois de cada escrita relê as listas de
 * abastecimentos, as consultas de estoque, o cache do Mapa, o bem e — quando o
 * abastecimento é de uma atividade — os lançamentos e os totais dela.
 *
 * Salvaguarda de Gestão: a resposta que chega depois de trocar de empresa não
 * mexe na tela (`daEmpresaAtual`).
 */
import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { notifySuccess, notifyWarning } from '@/lib/maikeNotify';
import { lerErroGestao } from '@/lib/gestaoErros';
import { mensagemErroAbastecimento } from '@/lib/patrimonioErros';
import { mensagemDeLoteVencido } from '@/lib/estoqueLotesRegras';
import {
  assinaturaDoFormulario,
  canonicoDoDigitado,
  ehExterno,
  formatarQuantidade,
  formularioVazio,
  LIMITES_CUSTO_EXTERNO,
  tanqueDoFormulario,
  unidadeDoFormulario,
  validarFormulario,
} from '@/lib/abastecimentoRegras';
import { chaveApontamentos } from '@/lib/atividadeApontamentoRegras';
import { chaveTotais } from '@/lib/atividadeLinhasRegras';
import { refreshMapaCacheEntry } from '@/services/mapaCacheService';
import {
  ACAO_CANCELAR,
  ACAO_CONFIRMAR,
  ALVO_NOVO_ABASTECIMENTO,
  cancelarAbastecimento,
  confirmarAbastecimento,
  detalharAbastecimento,
  limparPendenciaDoAbastecimento,
  listarAbastecimentosPagina,
  pendenciaDoAbastecimento,
  previaDoAbastecimento,
} from '@/services/abastecimentoService';

/** Raiz das consultas da tela Abastecimentos (lista, detalhe, opções do formulário e a lista do lançamento). */
export const QUERY_RAIZ_ABASTECIMENTOS = 'patrimonio-abastecimentos';
/** Opções dos seletores da tela (SeletorPaginadoGestao põe este prefixo). */
export const CHAVE_OPCOES_ABASTECIMENTO = ['lancamentos-financeiros-gestao', 'opcoes', 'patrimonio', 'abastecimento'];
/** Os abastecimentos ligados a UM lançamento da atividade (D-PROD-211). @param {string|null} empresaId @param {string|null} apontamentoId */
export const chaveAbastecimentosDoApontamento = (empresaId, apontamentoId) => [QUERY_RAIZ_ABASTECIMENTOS, 'apontamento', empresaId ?? null, apontamentoId ?? null];

/**
 * Consultas que as telas antigas de estoque invalidam depois de gravar (cópia
 * local do predicado da Central de Lançamentos) e, do cache do Mapa, a de lotes.
 * @param {unknown} chave
 */
const ehConsultaDeEstoque = (chave) =>
  Array.isArray(chave) &&
  ([
    'estoque-lotes-transferencia',
    'saldo-deposito',
    'lotes-nota-suplementacao',
    'produtos',
    'movimentacoes',
    'historico-deposito',
    'movimentacoes-deposito-detalhe',
    'mapa-estoque-lotes',
  ].includes(chave[0]) ||
    (chave[0] === 'mapa-cache' && chave[1] === 'estoqueLotes'));

/** Códigos que mudam a verdade da tela: relê tanques, saldos e opções. */
export const RELER_NOS_ERROS = new Set([
  'ESTOQUE_SALDO_INSUFICIENTE',
  'ABASTECIMENTO_TANQUE_INVALIDO',
  'ABASTECIMENTO_LOCAL_INVALIDO',
  'ABASTECIMENTO_BEM_INELEGIVEL',
  // D-PROD-162: o tanque deixou de aceitar o Produto (aceite retirado em Bens), o Produto ficou inativo
  // ou foi para outra fazenda, ou a unidade dele saiu de L/KG: a opção do formulário ficou velha;
  // relida, a reconciliação tira o Produto que saiu.
  'ABASTECIMENTO_PRODUTO_NAO_ACEITO',
  'ABASTECIMENTO_PRODUTO_INVALIDO',
  'ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL',
  'ABASTECIMENTO_STATUS_INVALIDO',
  'PATRIMONIO_VERSAO_CONFLITO',
  'ABASTECIMENTO_NAO_ENCONTRADO',
  'ABASTECIMENTO_CANCELAMENTO_BLOQUEADO',
  'MEDIDOR_LEITURA_REGRESSIVA',
  'MEDIDOR_LEITURA_ACIMA_POSTERIOR',
]);

/** Chave das opções de Produto do bem (`FormularioAbastecimento`; prefixo da tela: confirmar/cancelar/recusas invalidam). @param {string|null} empresaId @param {string|null} bemId */
export const chaveProdutosDoBem = (empresaId, bemId) => [QUERY_RAIZ_ABASTECIMENTOS, 'produtos-do-bem', empresaId, bemId];

/**
 * Depois de confirmar ou cancelar: lista e detalhes de abastecimento, opções,
 * detalhe do bem (leitura do medidor), consultas de estoque, refresh FORÇADO do
 * cache do Mapa e o evento "atualizar-mapa"; e, se o abastecimento é de uma
 * atividade (D-PROD-211), os lançamentos e os totais dela.
 * @param {import('@tanstack/react-query').QueryClient} queryClient @param {any} registro @param {string} emp
 */
export const avisarAbastecimentoGravado = (queryClient, registro, emp) => {
  queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ_ABASTECIMENTOS] });
  queryClient.invalidateQueries({ queryKey: CHAVE_OPCOES_ABASTECIMENTO });
  const bemId = registro?.bem?.id;
  if (bemId) queryClient.invalidateQueries({ queryKey: ['bens-patrimoniais', 'detalhe', emp, String(bemId)] });
  const atividadeId = registro?.atividade?.id ?? null;
  if (atividadeId) {
    queryClient.invalidateQueries({ queryKey: chaveTotais(emp, String(atividadeId)) });
    queryClient.invalidateQueries({ queryKey: chaveApontamentos(emp, String(atividadeId)) });
  }
  queryClient.invalidateQueries({ predicate: (q) => ehConsultaDeEstoque(q.queryKey) });
  Promise.all([refreshMapaCacheEntry('estoqueLotes', emp, { force: true }), refreshMapaCacheEntry('movimentacaoEstoque', emp, { force: true })]).catch(() => {});
  window.dispatchEvent(new CustomEvent('atualizar-mapa', { detail: { cacheKeys: ['estoqueLotes'] } }));
};

/**
 * O aviso de sucesso: a quantidade na unidade GRAVADA (L ou kg); o posto
 * externo não baixa nem devolve estoque (D-PROD-211).
 * @param {any} registro @param {'confirmar'|'cancelar'} tipo
 */
const notificarComando = (registro, tipo) => {
  const repetido = registro?.replay === true ? ' (envio repetido: nada foi duplicado)' : '';
  const quantidade = formatarQuantidade(registro?.quantidade, registro?.unidade);
  const numero = `Abastecimento nº ${registro?.numero ?? ''}`;
  if (ehExterno(registro)) {
    if (tipo === 'confirmar') notifySuccess('Abastecimento confirmado', `${numero} confirmado: ${quantidade} no posto externo, sem baixa do estoque.${repetido}`);
    else notifySuccess('Abastecimento cancelado', `${numero} cancelado: deixa de contar no consumo e nos custos.${repetido}`);
    return;
  }
  if (tipo === 'confirmar') notifySuccess('Abastecimento confirmado', `${numero} confirmado: ${quantidade} baixados do estoque.${repetido}`);
  else notifySuccess('Abastecimento cancelado', `${numero} cancelado: ${quantidade} devolvidos aos lotes de origem.${repetido}`);
};

/**
 * @typedef {{ seq: number, assinatura: string, form: any, resposta: { plano: any, bloqueios: any[] }, empresaId: string }} PreviaDoFluxo
 */

/**
 * @param {{
 *   empresaId: string|null,
 *   hoje: string,
 *   podeCriar: boolean,
 *   escopo: string,
 *   onConcluido?: (registro: any, emp: string, tipo: 'confirmar'|'cancelar') => void,
 *   onNaoEncontrado?: () => void,
 * }} p `onConcluido` só é chamado com a empresa ainda selecionada; `onNaoEncontrado`, quando a recusa diz que o
 *   abastecimento sumiu (a tela fecha o registro aberto).
 */
export function useFluxoAbastecimento({ empresaId, hoje, podeCriar, escopo, onConcluido, onNaoEncontrado }) {
  const queryClient = useQueryClient();
  const [form, setFormEstado] = useState(() => formularioVazio(hoje));
  const setForm = useCallback((/** @type {(f: any) => any} */ atualizar) => setFormEstado(atualizar), []);
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const limparErro = useCallback((/** @type {string} */ campo) => setErros((e) => (e[campo] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== campo)) : e)), []);
  const [previa, setPrevia] = useState(/** @type {PreviaDoFluxo | null} */ (null));
  const seqPrevia = useRef(0);
  const [previaAberta, setPreviaAberta] = useState(false);
  const [previando, setPreviando] = useState(false);
  const previandoRef = useRef(false);
  const [cancelando, setCancelando] = useState(/** @type {any} */ (null));

  const empresaAtual = useRef(empresaId);
  empresaAtual.current = empresaId;
  /** @param {string|null} emp */
  const daEmpresaAtual = (emp) => Boolean(emp) && emp === empresaAtual.current;

  /** Formulário novo (em branco ou já ligado a um lançamento): sem revisão nem erros. @param {any} inicial */
  const iniciar = useCallback((inicial) => {
    setFormEstado(inicial);
    setErros({});
    setPrevia(null);
  }, []);
  /** Troca de empresa: nada da anterior continua aberto. */
  const reiniciar = useCallback(() => {
    setPrevia(null);
    setPreviaAberta(false);
    setCancelando(null);
    setErros({});
  }, []);

  /** @param {any} registro @param {string} emp @param {'confirmar'|'cancelar'} tipo */
  const concluirComando = (registro, emp, tipo) => {
    avisarAbastecimentoGravado(queryClient, registro, emp);
    notificarComando(registro, tipo);
    if (!daEmpresaAtual(emp)) return;
    if (tipo === 'confirmar') {
      setPreviaAberta(false);
      setPrevia(null);
    } else setCancelando(null);
    onConcluido?.(registro, emp, tipo);
  };

  /** Recusa que muda a verdade da tela: relê o que depende dela. @param {unknown} erro @param {string} emp */
  const reagirAoErro = (erro, emp) => {
    const { code } = lerErroGestao(erro);
    if (!code || !RELER_NOS_ERROS.has(code)) return;
    queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ_ABASTECIMENTOS] });
    queryClient.invalidateQueries({ queryKey: CHAVE_OPCOES_ABASTECIMENTO });
    if (code === 'ABASTECIMENTO_NAO_ENCONTRADO' && daEmpresaAtual(emp)) {
      setCancelando(null);
      onNaoEncontrado?.();
    }
  };

  // ─── Prévia e confirmação ────────────────────────────────────────────
  /** @type {'nenhuma'|'valida'|'invalidada'} */
  const situacaoPrevia = !previa ? 'nenhuma' : previa.assinatura === assinaturaDoFormulario(form) ? 'valida' : 'invalidada';

  const pedirPrevia = async () => {
    if (!empresaId || !podeCriar || previandoRef.current) return;
    // Capacidade (litros) do tanque escolhido entre os que aceitam o Produto (opção do servidor): só vale para Produto em L.
    const v = validarFormulario(form, { hoje, capacidadeLitros: tanqueDoFormulario(form)?.capacidade_litros ?? null, unidade: unidadeDoFormulario(form) });
    setErros(v.erros);
    if (Object.keys(v.erros).length) {
      notifyWarning('Atenção', 'Revise os campos destacados.');
      return;
    }
    previandoRef.current = true;
    setPreviando(true);
    const emp = empresaId;
    const snapshot = form;
    const assinatura = assinaturaDoFormulario(form);
    try {
      const resposta = await previaDoAbastecimento(emp, snapshot);
      if (!daEmpresaAtual(emp)) return;
      seqPrevia.current += 1;
      setPrevia({ seq: seqPrevia.current, assinatura, form: snapshot, resposta, empresaId: emp });
      // Bloqueio que muda a verdade da tela (aceite retirado, Produto inativo, tanque inativo…) relê como a
      // recusa da confirmação: a reconciliação do formulário tira a escolha que saiu e oferece a nova.
      const unidadeServidor = resposta.plano?.produto?.unidade_principal_estoque ?? null;
      if ((Array.isArray(resposta.bloqueios) ? resposta.bloqueios : []).some((b) => RELER_NOS_ERROS.has(String(b?.code ?? '')))) {
        queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ_ABASTECIMENTOS] });
        queryClient.invalidateQueries({ queryKey: CHAVE_OPCOES_ABASTECIMENTO });
      } else if (unidadeServidor && unidadeServidor !== (snapshot.produto?.unidade_principal_estoque ?? null)) {
        // Sem bloqueio, mas a unidade do Produto que o servidor leu agora difere da opção do formulário (L ↔ KG):
        // relê só as opções do bem (a reconciliação reaplica a opção nova; a revisão já mostra a unidade do servidor).
        queryClient.invalidateQueries({ queryKey: chaveProdutosDoBem(emp, snapshot.bem?.id ? String(snapshot.bem.id) : null) });
      }
      setPreviaAberta(true);
    } catch (erro) {
      reagirAoErro(erro, emp);
      notifyWarning('Atenção', mensagemErroAbastecimento(erro, 'Não foi possível calcular a revisão. Nada foi gravado.'));
    } finally {
      previandoRef.current = false;
      setPreviando(false);
    }
  };

  /** @param {unknown} _arg @param {{ retentativa: boolean }} opcoes */
  const confirmarDaPrevia = async (_arg, { retentativa }) => {
    const p = previa;
    if (!p) return;
    const emp = p.empresaId;
    try {
      const registro = await confirmarAbastecimento(emp, p.form, p.resposta.plano, { escopo, retentativa });
      concluirComando(registro, emp, 'confirmar');
      // D-PROD-282: o servidor nunca recusa lote vencido; quando o abastecimento saiu de um, avisa.
      const alertaVencido = mensagemDeLoteVencido(/** @type {any} */ (registro)?.avisos);
      if (alertaVencido) notifyWarning('Lote vencido', alertaVencido);
    } catch (erro) {
      reagirAoErro(erro, emp);
      throw erro;
    }
  };

  /** "Consultar" depois do resultado incerto: procura o abastecimento pela chave pendente. */
  const consultarConfirmacao = async () => {
    const emp = previa?.empresaId ?? empresaId;
    if (!emp) return 'Selecione a fazenda.';
    const pendencia = pendenciaDoAbastecimento(escopo, ACAO_CONFIRMAR, emp, ALVO_NOVO_ABASTECIMENTO);
    if (!pendencia) return 'Não há envio pendente deste abastecimento: confira a lista.';
    try {
      const pagina = await listarAbastecimentosPagina(emp, { operationId: pendencia.operation_id, limit: 1 });
      const achado = pagina.items?.[0];
      if (!achado?.id) return 'O envio não foi gravado. Você pode repetir o mesmo envio.';
      // A pendência só sai DEPOIS do detalhe: se ele falhar, repetir manda a MESMA chave (replay), nunca um 2º abastecimento.
      let registro;
      try {
        registro = await detalharAbastecimento(emp, String(achado.id));
      } catch {
        const numero = achado.numero ? ` nº ${achado.numero}` : '';
        return `O abastecimento${numero} foi gravado, mas não foi possível abri-lo agora. Consulte de novo ou abra pela lista; repetir o mesmo envio não grava outro.`;
      }
      limparPendenciaDoAbastecimento(escopo, ACAO_CONFIRMAR, emp, ALVO_NOVO_ABASTECIMENTO);
      concluirComando(registro, emp, 'confirmar');
      return null;
    } catch (erro) {
      return mensagemErroAbastecimento(erro, 'Não foi possível consultar agora. Tente de novo.');
    }
  };

  // ─── Cancelamento ───────────────────────────────────────────────────
  /** @param {string} motivo @param {{ retentativa: boolean }} opcoes */
  const enviarCancelamento = async (motivo, { retentativa }) => {
    const registro = cancelando;
    const emp = empresaId;
    if (!registro || !emp) return;
    try {
      const r = await cancelarAbastecimento(emp, registro, { motivo, escopo, retentativa });
      concluirComando(r, emp, 'cancelar');
    } catch (erro) {
      reagirAoErro(erro, emp);
      throw erro;
    }
  };

  const consultarCancelamento = async () => {
    const registro = cancelando;
    const emp = empresaId;
    if (!registro || !emp) return null;
    try {
      const atual = /** @type {any} */ (await detalharAbastecimento(emp, String(registro.id)));
      if (atual?.status !== 'CANCELADO') return 'O cancelamento não foi gravado. Você pode repetir o mesmo envio.';
      limparPendenciaDoAbastecimento(escopo, ACAO_CANCELAR, emp, String(registro.id));
      concluirComando(atual, emp, 'cancelar');
      return null;
    } catch (erro) {
      return mensagemErroAbastecimento(erro, 'Não foi possível consultar agora. Tente de novo.');
    }
  };

  // Posto externo: a revisão mostra o valor da nota digitado (o servidor não baixa estoque).
  const formDaPrevia = previa?.form ?? null;
  const custoExternoDaPrevia = formDaPrevia && ehExterno(formDaPrevia) ? canonicoDoDigitado(formDaPrevia.custo_total, LIMITES_CUSTO_EXTERNO) : null;

  return {
    form,
    setForm,
    iniciar,
    reiniciar,
    erros,
    limparErro,
    previa,
    previaAberta,
    setPreviaAberta,
    previando,
    situacaoPrevia,
    pedirPrevia,
    confirmarDaPrevia,
    consultarConfirmacao,
    origemDaPrevia: formDaPrevia?.origem ?? null,
    custoExternoDaPrevia,
    cancelando,
    setCancelando,
    enviarCancelamento,
    consultarCancelamento,
  };
}
