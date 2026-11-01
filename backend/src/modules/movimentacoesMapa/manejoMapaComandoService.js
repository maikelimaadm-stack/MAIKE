/**
 * Comando atômico de manejo do mapa — R2A-R1 (D-PROD-99a).
 *
 * Morte, Abate e Transferência de Área deixam de ser "grava o movimento, depois
 * o navegador faz PATCH absoluto no lote". Numa transação PostgreSQL:
 *   1. idempotência por (cliente, operation_id, `manejo_mapa_lote`) + fingerprint;
 *   2. empresa do tenant; trava `FOR UPDATE` dos lotes em ordem de id;
 *   3. o SERVIDOR lê saldo, área e status e calcula o efeito (delta), nunca o
 *      valor absoluto vindo do navegador;
 *   4. aplica o efeito nos lotes, cria o lote derivado se for o caso, grava o
 *      movimento com `efeito_servidor` (proveniência causal) e audita tudo.
 *
 * `efeito_servidor`, `modo_transferencia` e `lote_destino_id` são campos
 * reservados: POST/bulk/PATCH genéricos os recusam. Só este comando os escreve,
 * e o cancelamento confere a operação idempotente que os gerou.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { documentoComoPublico } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero } from '../sequencias/entidadeCodigoService.js';
import { inserirLote } from '../lotes/loteRepository.js';
import { comoLotePublico, ENTIDADE_SEQUENCIA, escopoDaNumeracao } from '../lotes/loteService.js';

export const TIPO_OPERACAO_MANEJO = 'manejo_mapa_lote';
export const COMANDO_MANEJO = 'manejo_mapa_lote';
export const TIPOS_DO_COMANDO = Object.freeze(['Morte', 'Abate', 'Transferência de Área']);

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** Mesma regra do `encontrarLoteDestinoCompativel` do frontend (maiúsculas). */
const normal = (v) => String(v || '').toUpperCase();
const recusa = (codigo, mensagem, details = {}) => new AppError(codigo, mensagem, { details });

/**
 * Campos MATERIAIS do lote (R2A-R2, D-PROD-99b): o que muda saldo, posição,
 * situação ou classificação. O cancelamento exige que todos continuem iguais
 * ao pós-estado gravado aqui, e que nenhuma alteração material não comprovada
 * tenha ocorrido no meio (nem ida e volta).
 */
export const CAMPOS_MATERIAIS_LOTE = Object.freeze([
  'quantidade_cabecas',
  'status',
  'area_atual_id',
  'categoria',
  'categoria_manejo_id',
  'empresa_id',
]);

/**
 * Identificação do lote (R2A-R3, D-PROD-99c): não é material — não muda saldo
 * nem bloqueia cancelamento —, mas a UNIFICAÇÃO a sobrescreve no destino. O
 * efeito guarda antes/depois para o cancelamento devolver o que era do destino.
 */
export const CAMPOS_IDENTIFICACAO_LOTE = Object.freeze(['identificador_nome', 'identificador_sigla', 'identificador_cor']);
export const identificacaoDe = (lote) => ({
  identificador_nome: lote.identificador_nome ?? null,
  identificador_sigla: lote.identificador_sigla ?? null,
  identificador_cor: lote.identificador_cor ?? null,
});
/** Efeito com prova material + snapshot de identificação (antes/depois). */
const efeitoDe = (loteId, criado, auditoriaId, antes, depois) => ({
  lote_id: loteId,
  criado,
  auditoria_id: auditoriaId,
  antes: estadoDe(antes),
  depois: estadoDe(depois),
  identificacao: { antes: identificacaoDe(antes), depois: identificacaoDe(depois) },
});

export const estadoDe = (lote) => ({
  quantidade_cabecas: lote.quantidade_cabecas,
  status: lote.status,
  area_atual_id: lote.area_atual_id ?? null,
  categoria: lote.categoria ?? null,
  categoria_manejo_id: lote.categoria_manejo_id ?? null,
  empresa_id: lote.empresa_id ?? null,
});

const travarLotes = async (tx, clienteId, ids) => {
  const ordenados = [...new Set(ids.filter(Boolean))].sort();
  if (ordenados.length) {
    await tx.$queryRaw`SELECT id FROM "Lote" WHERE cliente_id = ${clienteId} AND id = ANY(${ordenados}::text[]) ORDER BY id FOR UPDATE`;
  }
  const lotes = await tx.lote.findMany({ where: { cliente_id: clienteId, id: { in: ordenados } } });
  return new Map(lotes.map((l) => [l.id, l]));
};

/**
 * Atualiza e audita. Devolve também o id do AuditLog: ele entra no efeito
 * (`auditoria_id`) e é a âncora causal que o cancelamento confere (R2A-R2).
 */
const atualizarLoteAuditado = async (tx, contexto, clienteId, anterior, dados) => {
  const atualizado = await tx.lote.update({ where: { cliente_id_id: { cliente_id: clienteId, id: anterior.id } }, data: dados });
  const auditoria = await registrarEvento(
    contexto,
    { acao: 'update', entidade: 'Lote', entidadeId: anterior.id, dadosAnteriores: comoLotePublico(anterior), dadosNovos: comoLotePublico(atualizado) },
    tx
  );
  return { atualizado, auditoriaId: auditoria.id };
};

/**
 * Data operacional estrita: AAAA-MM-DD (opcionalmente com hora ISO) e dia que
 * existe no calendário. "2026-02-30" ou "ontem" não criam movimento.
 */
const dataOperacionalValida = (valor) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(valor || '');
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia && !Number.isNaN(new Date(valor).getTime());
};

/** Valida a forma; tudo que importa para saldo é relido do servidor. */
const lerEntrada = (entrada) => {
  const tipo = texto(entrada?.tipo);
  if (!TIPOS_DO_COMANDO.includes(tipo)) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'tipo de manejo não suportado pelo comando', { details: { field: 'tipo' } });
  }
  const q = Number(entrada?.quantidade_animais);
  if (!Number.isInteger(q) || q <= 0) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'quantidade_animais deve ser inteiro positivo', { details: { field: 'quantidade_animais' } });
  }
  return {
    operationKey: texto(entrada?.operation_id),
    tipo,
    empresaId: texto(entrada?.empresa_id),
    loteId: texto(entrada?.lote_id),
    quantidade: q,
    dataMovimentacao: texto(entrada?.data_movimentacao),
    areaDestinoId: texto(entrada?.area_destino_id),
    loteDestinoId: texto(entrada?.lote_destino_id),
    observacoes: typeof entrada?.observacoes === 'string' ? entrada.observacoes : null,
    categoriaAnimal: texto(entrada?.categoria_animal),
    usuarioResponsavel: texto(entrada?.usuario_responsavel),
  };
};

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext, requestId: string}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const executarManejoLote = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const e = lerEntrada(entrada);
  if (!e.operationKey || !e.empresaId || !e.loteId || !e.dataMovimentacao) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'operation_id, empresa_id, lote_id e data_movimentacao são obrigatórios');
  }
  if (!dataOperacionalValida(e.dataMovimentacao)) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'data_movimentacao inválida', { details: { field: 'data_movimentacao' } });
  }
  const ehTransferencia = e.tipo === 'Transferência de Área';
  if (ehTransferencia && !e.areaDestinoId) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'transferência exige area_destino_id', { details: { field: 'area_destino_id' } });
  }
  const fingerprint = fingerprintDePayload({ ...e, operationKey: undefined });

  const prisma = getPrismaClient();
  const resultado = await prisma.$transaction(async (tx) =>
    executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey: e.operationKey,
      tipoOperacao: TIPO_OPERACAO_MANEJO,
      fingerprint,
      executar: async () => {
        const empresa = await tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: e.empresaId } }, select: { id: true } });
        if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada');

        const lotes = await travarLotes(tx, auth.clienteId, [e.loteId, ehTransferencia ? e.loteDestinoId : null]);
        const origem = lotes.get(e.loteId);
        // Lote excluído do cadastro (MAIKE-LOTES-R1) não existe para manejo.
        if (!origem || origem.empresa_id !== e.empresaId || origem.excluido_em) throw new AppError('LOTE_NOT_FOUND', 'lote não encontrado nesta empresa');
        if (origem.status !== 'Ativo' || !origem.area_atual_id) {
          throw recusa('MANEJO_ESTADO_INVALIDO', 'lote inativo ou sem área atual');
        }
        if (origem.quantidade_cabecas < e.quantidade) {
          throw recusa('MANEJO_SALDO_INSUFICIENTE', 'o lote não tem cabeças suficientes', { disponivel: origem.quantidade_cabecas, pedido: e.quantidade });
        }
        // Categoria: a fonte é o lote, nunca o formulário (R2A-R2, P0-C).
        if (e.categoriaAnimal && normal(e.categoriaAnimal) !== normal(origem.categoria)) {
          throw recusa('MANEJO_ESTADO_INVALIDO', 'categoria informada não confere com a categoria do lote', { categoria_lote: origem.categoria ?? null });
        }
        const areaOrigem = await tx.areaPastagem.findFirst({
          where: { cliente_id: auth.clienteId, empresa_id: e.empresaId, id: origem.area_atual_id },
          select: { id: true, nome: true },
        });
        if (!areaOrigem) throw recusa('MANEJO_ESTADO_INVALIDO', 'área atual do lote não pertence a esta empresa');

        /** @type {Array<{lote_id: string, criado: boolean, auditoria_id: string, antes: object, depois: object, identificacao: {antes: object, depois: object}}>} */
        const efeitos = [];
        /** @type {Array<any>} */
        const lotesResultado = [];
        let modo = null;
        let destinoId = null;
        let areaDestino = null;

        const saldoOrigem = origem.quantidade_cabecas - e.quantidade;
        if (!ehTransferencia) {
          const { atualizado: depois, auditoriaId } = await atualizarLoteAuditado(tx, contexto, auth.clienteId, origem, {
            quantidade_cabecas: saldoOrigem,
            status: saldoOrigem > 0 ? origem.status : 'Inativo',
          });
          efeitos.push(efeitoDe(origem.id, false, auditoriaId, origem, depois));
          lotesResultado.push(depois);
        } else {
          areaDestino = await tx.areaPastagem.findFirst({
            where: { cliente_id: auth.clienteId, empresa_id: e.empresaId, id: e.areaDestinoId },
            select: { id: true, nome: true, setor_id: true, setor_nome: true },
          });
          if (!areaDestino) throw new AppError('AREA_NOT_FOUND', 'área de destino não encontrada nesta empresa');
          if (areaDestino.id === origem.area_atual_id) throw recusa('MANEJO_ESTADO_INVALIDO', 'área de destino igual à de origem');

          let destino = null;
          if (e.loteDestinoId) {
            destino = lotes.get(e.loteDestinoId);
            const compativel =
              destino &&
              !destino.excluido_em &&
              destino.id !== origem.id &&
              destino.empresa_id === e.empresaId &&
              destino.status === 'Ativo' &&
              destino.area_atual_id === areaDestino.id &&
              normal(destino.nome) === normal(origem.nome) &&
              normal(destino.categoria) === normal(origem.categoria);
            if (!compativel) throw recusa('MANEJO_ESTADO_INVALIDO', 'lote de destino incompatível (área, nome, categoria ou status)');
          }
          const total = e.quantidade === origem.quantidade_cabecas;
          const identificador = {
            identificador_nome: origem.identificador_nome ?? null,
            identificador_sigla: origem.identificador_sigla ?? null,
            identificador_cor: origem.identificador_cor ?? null,
          };

          if (total && !destino) {
            modo = 'total_no_lugar';
            destinoId = origem.id;
            const { atualizado: depois, auditoriaId } = await atualizarLoteAuditado(tx, contexto, auth.clienteId, origem, {
              area_atual_id: areaDestino.id,
              area_atual_nome: areaDestino.nome,
            });
            efeitos.push(efeitoDe(origem.id, false, auditoriaId, origem, depois));
            lotesResultado.push(depois);
          } else if (destino) {
            modo = total ? 'total_unificado' : 'parcial_unificado';
            destinoId = destino.id;
            const { atualizado: destDepois, auditoriaId: audDestino } = await atualizarLoteAuditado(tx, contexto, auth.clienteId, destino, {
              quantidade_cabecas: destino.quantidade_cabecas + e.quantidade,
              ...identificador,
            });
            const { atualizado: origDepois, auditoriaId: audOrigem } = await atualizarLoteAuditado(tx, contexto, auth.clienteId, origem, {
              quantidade_cabecas: saldoOrigem,
              status: saldoOrigem > 0 ? origem.status : 'Inativo',
            });
            efeitos.push(efeitoDe(origem.id, false, audOrigem, origem, origDepois));
            efeitos.push(efeitoDe(destino.id, false, audDestino, destino, destDepois));
            lotesResultado.push(origDepois, destDepois);
          } else {
            modo = 'parcial_novo_lote';
            const numero = await reservarNumero(tx, { clienteId: auth.clienteId, entidade: ENTIDADE_SEQUENCIA, escopoTipo: escopoDaNumeracao() });
            const data = new Date(e.dataMovimentacao);
            const novo = await inserirLote(tx, {
              cliente_id: auth.clienteId,
              empresa_id: e.empresaId,
              numero_lote: String(numero),
              nome: origem.nome,
              ...identificador,
              quantidade_cabecas: e.quantidade,
              quantidade_entrada: e.quantidade,
              categoria: origem.categoria,
              categoria_entrada: origem.categoria_entrada || origem.categoria,
              categoria_manejo_id: origem.categoria_manejo_id,
              categoria_manejo_nome: origem.categoria_manejo_nome,
              categoria_manejo_entrada_id: origem.categoria_manejo_entrada_id || origem.categoria_manejo_id,
              categoria_manejo_entrada_nome: origem.categoria_manejo_entrada_nome || origem.categoria_manejo_nome,
              sexo: origem.sexo,
              peso_medio_kg: origem.peso_medio_kg,
              peso_entrada_kg: origem.peso_entrada_kg || origem.peso_medio_kg,
              idade_media_meses: origem.idade_media_meses,
              setor_id: areaDestino.setor_id ?? origem.setor_id ?? null,
              setor_nome: areaDestino.setor_nome ?? origem.setor_nome ?? null,
              area_entrada_id: areaDestino.id,
              area_entrada_nome: areaDestino.nome,
              area_atual_id: areaDestino.id,
              area_atual_nome: areaDestino.nome,
              raca_predominante: origem.raca_predominante,
              sistema_produtivo: origem.sistema_produtivo,
              data_entrada: Number.isNaN(data.getTime()) ? null : data,
              motivo_entrada: 'Outros',
              motivo_outros: 'Movimentação parcial',
              origem: 'MOVIMENTAÇÃO',
              status: 'Ativo',
            });
            const audNovo = await registrarEvento(contexto, { acao: 'create', entidade: 'Lote', entidadeId: novo.id, dadosNovos: comoLotePublico(novo) }, tx);
            destinoId = novo.id;
            const { atualizado: origDepois, auditoriaId: audOrigem } = await atualizarLoteAuditado(tx, contexto, auth.clienteId, origem, {
              quantidade_cabecas: saldoOrigem,
              status: saldoOrigem > 0 ? origem.status : 'Inativo',
            });
            efeitos.push(efeitoDe(origem.id, false, audOrigem, origem, origDepois));
            // Derivado: não é ENTRADA no rebanho (origem 'MOVIMENTAÇÃO'); o
            // "antes" é o lote vazio e inativo que o cancelamento deixa.
            efeitos.push({
              ...efeitoDe(novo.id, true, audNovo.id, novo, novo),
              antes: { ...estadoDe(novo), quantidade_cabecas: 0, status: 'Inativo' },
            });
            lotesResultado.push(origDepois, novo);
          }
        }

        const dados = {
          tipo: e.tipo,
          lote: origem.nome,
          lote_id: origem.id,
          quantidade_animais: e.quantidade,
          data_movimentacao: e.dataMovimentacao,
          area_origem_id: origem.area_atual_id,
          area_origem_nome: areaOrigem?.nome ?? origem.area_atual_nome ?? null,
          ...(ehTransferencia
            ? { area_destino_id: areaDestino.id, area_destino_nome: areaDestino.nome, modo_transferencia: modo, lote_destino_id: destinoId }
            : {}),
          categoria_animal: origem.categoria ?? null,
          ...(e.observacoes ? { observacoes: e.observacoes } : {}),
          ...(e.usuarioResponsavel ? { usuario_responsavel: e.usuarioResponsavel } : {}),
          efeito_servidor: {
            comando: COMANDO_MANEJO,
            operation_id: e.operationKey,
            registrado_em: new Date().toISOString(),
            registrado_por_usuario_id: auth.usuarioId,
            ...(modo ? { modo } : {}),
            efeitos,
          },
        };
        const mov = await tx.movimentacaoMapa.create({ data: { cliente_id: auth.clienteId, empresa_id: e.empresaId, dados } });
        await registrarEvento(contexto, { acao: 'create', entidade: 'MovimentacaoMapa', entidadeId: mov.id, dadosNovos: documentoComoPublico(mov) }, tx);
        return {
          httpStatus: 201,
          body: { movimentacao: documentoComoPublico(mov), lotes: lotesResultado.map(comoLotePublico) },
        };
      },
    })
  );
  return { status: resultado.httpStatus, body: { ...resultado.body, replay: resultado.replay } };
};
