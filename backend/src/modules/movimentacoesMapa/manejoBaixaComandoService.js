/**
 * Comando atômico de BAIXA multi-lote (Morte / Abate) — R2D-P1 (D-PROD-105).
 *
 * Antes: `DetalhesLote.handleMorte/handleAbate` percorria os lotes da
 * categoria e mandava UM comando R2A por lote — cada um na sua transação. Se a
 * 2ª ou 3ª chamada falhava, as anteriores já estavam gravadas (RED na main
 * 52bc804). Agora UMA confirmação do formulário (todas as categorias dela) é:
 *   1. UMA reserva idempotente `manejo_mapa_baixa_rebanho` + fingerprint
 *      canônico (replay idêntico devolve o mesmo resultado; mesma chave com
 *      conteúdo diferente → 409);
 *   2. trava da ÁREA e depois de TODOS os lotes da área em ordem de id (mesma
 *      ordem do R2B/R2C: sem ciclo com junção, rebanho, R2A ou exclusão #167);
 *   3. o SERVIDOR escolhe os lotes e a distribuição — política determinística
 *      `numero_lote` crescente (numérico antes de texto/vazio), depois `id`.
 *      O navegador manda só categoria e quantidade por linha e, opcionalmente,
 *      `lotes_selecionados` (os lotes que a tela mostrava): é apenas FILTRO —
 *      cada id é relido e revalidado; lote fora da área, inativo ou excluído
 *      simplesmente não entra na conta, e id de outro tenant/empresa é 404;
 *   4. saldo insuficiente na categoria, classificação incoerente ou registro
 *      ativo posterior → 409 e ZERO alteração;
 *   5. cada lote participante é gravado UMA vez (mesmo que várias linhas o
 *      usem), com UMA linha de AuditLog; zerado fica Inativo (nunca apagado);
 *      peso médio, entrada, origem e identificação não mudam;
 *   6. UM movimento tipo 'Morte' ou 'Abate' com `lote_ids`, `linhas`
 *      (distribuição real por lote) e `efeito_servidor` (proveniência).
 *
 * Metadados: causa (Morte) e peso vivo/carcaça/destino (Abate) são TOTAIS DA
 * LINHA como digitados — ficam na linha, nunca multiplicados nem rateados por
 * lote. Nada aqui é Entrada: nenhum lote é criado.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { documentoComoPublico } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirModoLegado } from '../rebanhoLedger/rebanhoLedgerService.js';
import { comoLotePublico } from '../lotes/loteService.js';
import {
  CATEGORIAS_OFICIAIS,
  dataOperacionalValida,
  estadoRebanhoDe,
  falhaInjetadaNoEfeito,
  operavel,
  travarAreaELotes,
} from './manejoRebanhoComandoService.js';
import { registrosAtivosPosteriores } from './guardaTemporalComando.js';
import {
  ABATE,
  CAUSAS_MORTE,
  COMANDO_BAIXA,
  DESTINOS_ABATE,
  DESTINOS_COM_NOME,
  MAX_LINHAS_BAIXA,
  MAX_LOTES_SELECIONADOS,
  MORTE,
  PESO_MAXIMO_POR_CABECA_KG,
  POLITICA_ALOCACAO,
  TIPO_OPERACAO_BAIXA,
  TIPOS_BAIXA,
} from './baixaConstantes.js';

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const normal = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
const invalido = (mensagem, details = {}) => new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details });
const recusa = (codigo, mensagem, details = {}) => new AppError(codigo, mensagem, { details });
const ausente = (v) => v === null || v === undefined || v === '';

const pesoTotal = (valor, campo, quantidade) => {
  if (ausente(valor)) return null;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || valor > quantidade * PESO_MAXIMO_POR_CABECA_KG) {
    throw invalido(`peso total deve ser número positivo até ${PESO_MAXIMO_POR_CABECA_KG} kg por cabeça`, { field: campo });
  }
  return Number(valor.toFixed(4));
};

/** Forma canônica (também é a base do fingerprint). Nada de saldo, lote ou efeito do cliente. */
export const lerEntradaBaixa = (entrada) => {
  const operationKey = texto(entrada?.operation_id);
  const tipo = texto(entrada?.tipo);
  const empresaId = texto(entrada?.empresa_id);
  const areaId = texto(entrada?.area_id);
  const dataMovimentacao = texto(entrada?.data_movimentacao);
  if (!operationKey || !empresaId || !areaId || !dataMovimentacao) {
    throw invalido('operation_id, tipo, empresa_id, area_id, data_movimentacao e linhas são obrigatórios');
  }
  if (!TIPOS_BAIXA.includes(tipo)) throw invalido('tipo deve ser Morte ou Abate', { field: 'tipo' });
  if (!dataOperacionalValida(dataMovimentacao)) throw invalido('data_movimentacao inválida', { field: 'data_movimentacao' });
  const brutas = entrada?.linhas;
  if (!Array.isArray(brutas) || brutas.length < 1 || brutas.length > MAX_LINHAS_BAIXA) {
    throw invalido(`linhas deve ter de 1 a ${MAX_LINHAS_BAIXA} itens`, { field: 'linhas' });
  }
  const linhas = brutas.map((l, i) => {
    const campo = (k) => `linhas[${i}].${k}`;
    if (!l || typeof l !== 'object' || Array.isArray(l)) throw invalido('linha inválida', { field: `linhas[${i}]` });
    const categoria = texto(l.categoria);
    if (!categoria) throw invalido('categoria obrigatória', { field: campo('categoria') });
    const quantidade = l.quantidade;
    if (!Number.isInteger(quantidade) || quantidade <= 0) throw invalido('quantidade deve ser inteiro positivo', { field: campo('quantidade') });
    if (tipo === MORTE) {
      for (const k of ['peso_vivo_total_kg', 'peso_carcaca_total_kg', 'destino', 'destino_nome']) {
        if (!ausente(l[k])) throw invalido('campo de abate em registro de morte', { field: campo(k) });
      }
      const causa = texto(l.causa_morte);
      if (!causa || !CAUSAS_MORTE.includes(causa)) throw invalido('causa_morte obrigatória e de uma das opções do formulário', { field: campo('causa_morte') });
      return { categoria, quantidade, causa_morte: causa };
    }
    if (!ausente(l.causa_morte)) throw invalido('causa de morte em registro de abate', { field: campo('causa_morte') });
    const pesoVivo = pesoTotal(l.peso_vivo_total_kg, campo('peso_vivo_total_kg'), quantidade);
    const pesoCarcaca = pesoTotal(l.peso_carcaca_total_kg, campo('peso_carcaca_total_kg'), quantidade);
    if (pesoVivo !== null && pesoCarcaca !== null && pesoCarcaca > pesoVivo) {
      throw invalido('peso de carcaça maior que o peso vivo', { field: campo('peso_carcaca_total_kg') });
    }
    const destino = texto(l.destino);
    if (destino && !DESTINOS_ABATE.includes(destino)) throw invalido('destino fora das opções do formulário', { field: campo('destino') });
    const destinoNome = texto(l.destino_nome);
    if (destinoNome && !destino) throw invalido('destino_nome sem destino', { field: campo('destino_nome') });
    if (destino && DESTINOS_COM_NOME.includes(destino) && !destinoNome) throw invalido('nome do frigorífico/cliente obrigatório para este destino', { field: campo('destino_nome') });
    return { categoria, quantidade, peso_vivo_total_kg: pesoVivo, peso_carcaca_total_kg: pesoCarcaca, destino, destino_nome: destinoNome ? destinoNome.toUpperCase() : null };
  });
  let selecionados = null;
  if (entrada?.lotes_selecionados !== undefined) {
    const brutos = entrada.lotes_selecionados;
    if (!Array.isArray(brutos) || brutos.length < 1 || brutos.length > MAX_LOTES_SELECIONADOS || brutos.some((id) => !texto(id))) {
      throw invalido(`lotes_selecionados deve ter de 1 a ${MAX_LOTES_SELECIONADOS} ids`, { field: 'lotes_selecionados' });
    }
    selecionados = [...new Set(brutos.map(texto))].sort();
  }
  const observacoes = typeof entrada?.observacoes === 'string' ? entrada.observacoes.trim() || null : null;
  return { operationKey, tipo, empresaId, areaId, dataMovimentacao, observacoes, linhas, selecionados };
};

/** Ordem determinística: numero_lote numérico crescente, depois texto/vazio, depois id. */
export const ordemDeAlocacao = (a, b) => {
  const chave = (l) => {
    const t = String(l.numero_lote ?? '').trim();
    const n = /^\d+$/.test(t) ? Number(t) : null;
    return [n === null ? 1 : 0, n ?? 0, t, l.id];
  };
  const [x, y] = [chave(a), chave(b)];
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] < y[i]) return -1;
    if (x[i] > y[i]) return 1;
  }
  return 0;
};

/**
 * Distribuição pura (sem banco): para cada linha, consome os lotes elegíveis
 * da categoria na ordem da política, compartilhando o saldo entre linhas da
 * mesma categoria. Saldo insuficiente → recusa com o disponível.
 * @param {Array<any>} lotesDaArea lotes operáveis da área
 * @param {Array<{categoria: string, quantidade: number}>} linhas
 */
export const distribuirBaixa = (lotesDaArea, linhas) => {
  const saldo = new Map(lotesDaArea.map((l) => [l.id, l.quantidade_cabecas]));
  const pedidoPorCategoria = new Map();
  for (const linha of linhas) pedidoPorCategoria.set(normal(linha.categoria), (pedidoPorCategoria.get(normal(linha.categoria)) ?? 0) + linha.quantidade);
  for (const [cat, pedido] of pedidoPorCategoria) {
    const disponivel = lotesDaArea.filter((l) => normal(l.categoria) === cat).reduce((t, l) => t + l.quantidade_cabecas, 0);
    if (disponivel < pedido) {
      throw recusa('BAIXA_SALDO_INSUFICIENTE', 'a categoria não tem cabeças suficientes nos lotes ativos desta área; nada foi baixado', {
        categoria: linhas.find((l) => normal(l.categoria) === cat).categoria,
        disponivel,
        pedido,
      });
    }
  }
  return linhas.map((linha) => {
    let restante = linha.quantidade;
    const distribuicao = [];
    for (const l of lotesDaArea.filter((x) => normal(x.categoria) === normal(linha.categoria)).sort(ordemDeAlocacao)) {
      if (restante <= 0) break;
      const q = Math.min(restante, saldo.get(l.id));
      if (q <= 0) continue;
      saldo.set(l.id, saldo.get(l.id) - q);
      restante -= q;
      distribuicao.push({ lote_id: l.id, quantidade: q });
    }
    return { ...linha, distribuicao };
  });
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext, requestId: string}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const executarBaixaRebanho = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const e = lerEntradaBaixa(entrada);
  const fingerprint = fingerprintDePayload({ comando: COMANDO_BAIXA, ...e, operationKey: undefined });

  const prisma = getPrismaClient();
  const resultado = await prisma.$transaction(async (tx) =>
    executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey: e.operationKey,
      tipoOperacao: TIPO_OPERACAO_BAIXA,
      fingerprint,
      executar: async () => {
        const empresa = await tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: e.empresaId } }, select: { id: true } });
        if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada');
        await exigirModoLegado(tx, auth.clienteId, e.empresaId, 'baixa-rebanho');

        // Trava a área e TODOS os lotes dela (ordem de id) antes de ler saldo.
        const { area, lotes } = await travarAreaELotes(tx, auth.clienteId, e.empresaId, e.areaId, e.selecionados ?? []);
        if (e.selecionados) {
          const existentes = new Map(lotes.map((l) => [l.id, l]));
          const fora = e.selecionados.find((id) => existentes.get(id)?.empresa_id !== e.empresaId);
          if (fora) throw new AppError('LOTE_NOT_FOUND', 'lote selecionado não encontrado nesta empresa', { details: { lote_id: fora } });
        }
        const filtro = e.selecionados ? new Set(e.selecionados) : null;
        const elegiveis = lotes.filter((l) => operavel(l, e.empresaId, area.id) && (!filtro || filtro.has(l.id)));

        // Classificação: categoria oficial implica sexo; lote com sexo contrário não é baixado às cegas.
        for (const linha of e.linhas) {
          const oficial = Object.keys(CATEGORIAS_OFICIAIS).find((c) => normal(c) === normal(linha.categoria));
          if (!oficial) continue;
          const divergente = elegiveis.find((l) => normal(l.categoria) === normal(linha.categoria) && l.sexo && normal(l.sexo) !== normal(CATEGORIAS_OFICIAIS[oficial]));
          if (divergente) {
            throw recusa('BAIXA_CLASSIFICACAO_DIVERGENTE', 'há lote desta categoria com sexo incompatível; corrija o cadastro antes de baixar', {
              lote_id: divergente.id,
              categoria: linha.categoria,
              sexo: divergente.sexo,
            });
          }
        }

        const linhas = distribuirBaixa(elegiveis, e.linhas);
        const porId = new Map(elegiveis.map((l) => [l.id, l]));
        /** Baixa total por lote, na ordem em que cada lote aparece pela primeira vez. */
        const baixaPorLote = new Map();
        for (const linha of linhas) for (const d of linha.distribuicao) baixaPorLote.set(d.lote_id, (baixaPorLote.get(d.lote_id) ?? 0) + d.quantidade);
        const participantes = [...baixaPorLote.keys()].map((id) => porId.get(id));

        // Data: nada ATIVO posterior em nenhum participante (guarda de comando novo, R2C-R3).
        const posteriores = await registrosAtivosPosteriores(tx, auth.clienteId, e.empresaId, {
          loteIds: participantes.map((l) => l.id),
          nomes: participantes.map((l) => l.nome),
          data: e.dataMovimentacao,
        });
        if (posteriores.length) {
          throw recusa('BAIXA_DATA_RETROATIVA', 'há registro ativo posterior à data escolhida num dos lotes; use data igual ou posterior', { dependencias: posteriores });
        }

        const totalPedido = e.linhas.reduce((t, l) => t + l.quantidade, 0);
        const totalAntes = participantes.reduce((t, l) => t + l.quantidade_cabecas, 0);
        const efeitos = [];
        const lotesResultado = [];
        let n = 0;
        for (const lote of participantes) {
          n += 1;
          if (falhaInjetadaNoEfeito() === n) throw new Error(`falha injetada no efeito ${n}`);
          const saldo = lote.quantidade_cabecas - baixaPorLote.get(lote.id);
          if (saldo < 0) throw new AppError('INTERNAL_ERROR', 'baixa deixaria saldo negativo');
          const atualizado = await tx.lote.update({
            where: { cliente_id_id: { cliente_id: auth.clienteId, id: lote.id } },
            data: { quantidade_cabecas: saldo, status: saldo > 0 ? lote.status : 'Inativo' },
          });
          const auditoria = await registrarEvento(
            contexto,
            { acao: 'update', entidade: 'Lote', entidadeId: lote.id, dadosAnteriores: comoLotePublico(lote), dadosNovos: comoLotePublico(atualizado) },
            tx
          );
          efeitos.push({ lote_id: lote.id, criado: false, auditoria_id: auditoria.id, antes: estadoRebanhoDe(lote), depois: estadoRebanhoDe(atualizado) });
          lotesResultado.push(atualizado);
        }
        n += 1;
        if (falhaInjetadaNoEfeito() === n) throw new Error('falha injetada antes do movimento');

        const totalDepois = efeitos.reduce((t, x) => t + x.depois.quantidade_cabecas, 0);
        if (totalAntes - totalDepois !== totalPedido) throw new AppError('INTERNAL_ERROR', 'baixa não confere com a quantidade pedida');

        const descricao = (id) => {
          const l = porId.get(id);
          return { nome: l.nome, numero_lote: l.numero_lote ?? null };
        };
        const categorias = [...new Set(e.linhas.map((l) => l.categoria))];
        const primeiro = participantes[0];
        const dados = {
          tipo: e.tipo,
          lote: primeiro.nome,
          lote_id: primeiro.id,
          lote_ids: participantes.map((l) => l.id),
          quantidade_animais: totalPedido,
          data_movimentacao: e.dataMovimentacao,
          area_origem_id: area.id,
          area_origem_nome: area.nome,
          categoria_animal: categorias.join(', '),
          baixa: {
            politica_alocacao: POLITICA_ALOCACAO,
            total_cabecas: totalPedido,
            lotes: participantes.map((l, i) => ({
              lote_id: l.id,
              ...descricao(l.id),
              quantidade: baixaPorLote.get(l.id),
              saldo_antes: l.quantidade_cabecas,
              saldo_depois: efeitos[i].depois.quantidade_cabecas,
              status_depois: efeitos[i].depois.status,
            })),
          },
          linhas: linhas.map((l) => ({ ...l, distribuicao: l.distribuicao.map((d) => ({ ...d, ...descricao(d.lote_id) })) })),
          ...(e.observacoes ? { observacoes: e.observacoes } : {}),
          efeito_servidor: {
            comando: COMANDO_BAIXA,
            operation_id: e.operationKey,
            registrado_em: new Date().toISOString(),
            registrado_por_usuario_id: auth.usuarioId,
            efeitos,
          },
        };
        const mov = await tx.movimentacaoMapa.create({ data: { cliente_id: auth.clienteId, empresa_id: e.empresaId, dados } });
        await registrarEvento(contexto, { acao: 'create', entidade: 'MovimentacaoMapa', entidadeId: mov.id, dadosNovos: documentoComoPublico(mov) }, tx);
        return { httpStatus: 201, body: { movimentacao: documentoComoPublico(mov), lotes: lotesResultado.map(comoLotePublico) } };
      },
    })
  );
  return { status: resultado.httpStatus, body: { ...resultado.body, replay: resultado.replay } };
};

export { ABATE, MORTE };
