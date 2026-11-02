/**
 * Comando atômico de JUNÇÃO DE LOTES — R2C-P1 (D-PROD-103).
 *
 * Substitui o fluxo do navegador (N PATCHes + PATCH do principal + POST
 * genérico "Entrada") por UMA transação PostgreSQL:
 *   1. idempotência `manejo_mapa_juncao_lotes` + fingerprint do conteúdo canônico;
 *   2. trava a ÁREA e depois os lotes (os da área + os pedidos) em ordem de id —
 *      mesma ordem do comando do rebanho (R2B), sem ciclo com R2A/#167;
 *   3. relê e valida tudo no servidor (área, ativo, não excluído, saldo > 0,
 *      categoria, sexo, categoria de manejo) e recusa evento posterior ativo
 *      (consulta completa no banco, sem teto);
 *   4. principal recebe a soma; cada origem fica 0/Inativo; uma linha de
 *      AuditLog por lote; UM movimento tipo 'Junção de Lotes' (nunca 'Entrada').
 *
 * Invariante: total antes = total depois. Nenhum lote é criado; entrada, área
 * de entrada, categoria de entrada, origem, compra e identificação ficam como
 * estão. Peso: média ponderada só com TODOS os pesos conhecidos; senão o
 * principal fica sem peso (null) — desconhecido nunca vale zero.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { documentoComoPublico } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { comoLotePublico } from '../lotes/loteService.js';
import {
  dataOperacionalValida,
  estadoRebanhoDe,
  falhaInjetadaNoEfeito,
  operavel,
  pesoNormal,
  travarAreaELotes,
  SEXOS,
} from './manejoRebanhoComandoService.js';
import { dependenciasPosteriores } from './movimentacaoMapaCancelamentoService.js';
import { COMANDO_JUNCAO, MAX_ORIGENS_JUNCAO, TIPO_JUNCAO, TIPO_OPERACAO_JUNCAO } from './juncaoConstantes.js';

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const normal = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
const invalido = (mensagem, details = {}) => new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details });
const recusa = (codigo, mensagem, details = {}) => new AppError(codigo, mensagem, { details });

/** Forma canônica (também é a base do fingerprint). */
export const lerEntradaJuncao = (entrada) => {
  const operationKey = texto(entrada?.operation_id);
  const empresaId = texto(entrada?.empresa_id);
  const areaId = texto(entrada?.area_id);
  const principalId = texto(entrada?.lote_principal_id);
  const dataMovimentacao = texto(entrada?.data_movimentacao);
  if (!operationKey || !empresaId || !areaId || !principalId || !dataMovimentacao) {
    throw invalido('operation_id, empresa_id, area_id, lote_principal_id e data_movimentacao são obrigatórios');
  }
  if (!dataOperacionalValida(dataMovimentacao)) throw invalido('data_movimentacao inválida', { field: 'data_movimentacao' });
  const brutos = entrada?.lote_origem_ids;
  if (!Array.isArray(brutos) || brutos.length < 1 || brutos.length > MAX_ORIGENS_JUNCAO) {
    throw invalido(`lote_origem_ids deve ter de 1 a ${MAX_ORIGENS_JUNCAO} lotes`, { field: 'lote_origem_ids' });
  }
  const origens = brutos.map(texto);
  if (origens.some((id) => !id)) throw invalido('lote_origem_ids com id vazio', { field: 'lote_origem_ids' });
  if (new Set(origens).size !== origens.length) throw invalido('lote repetido em lote_origem_ids', { field: 'lote_origem_ids' });
  if (origens.includes(principalId)) throw invalido('o lote principal não pode ser também origem', { field: 'lote_origem_ids' });
  const observacoes = typeof entrada?.observacoes === 'string' ? entrada.observacoes.trim() || null : null;
  return { operationKey, empresaId, areaId, principalId, origens, dataMovimentacao, observacoes };
};

/** Identificação do lote (fica no histórico; nunca é sobrescrita pela junção). */
const identificacao = (l) => ({
  nome: l.nome,
  numero_lote: l.numero_lote ?? null,
  identificador_nome: l.identificador_nome ?? null,
  identificador_sigla: l.identificador_sigla ?? null,
  identificador_cor: l.identificador_cor ?? null,
});

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext, requestId: string}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const executarJuncaoLotes = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const e = lerEntradaJuncao(entrada);
  const fingerprint = fingerprintDePayload({ comando: COMANDO_JUNCAO, ...e, operationKey: undefined });

  const prisma = getPrismaClient();
  const resultado = await prisma.$transaction(async (tx) =>
    executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey: e.operationKey,
      tipoOperacao: TIPO_OPERACAO_JUNCAO,
      fingerprint,
      executar: async () => {
        const empresa = await tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: e.empresaId } }, select: { id: true } });
        if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada');

        const ids = [e.principalId, ...e.origens];
        const { area, lotes } = await travarAreaELotes(tx, auth.clienteId, e.empresaId, e.areaId, ids);
        const porId = new Map(lotes.map((l) => [l.id, l]));

        // ── Existência no tenant/empresa e condição de manejo na área ──
        for (const id of ids) {
          const l = porId.get(id);
          if (!l || l.empresa_id !== e.empresaId || l.excluido_em) {
            throw new AppError('LOTE_NOT_FOUND', 'lote não encontrado nesta empresa', { details: { lote_id: id } });
          }
          if (!operavel(l, e.empresaId, area.id)) {
            throw recusa('JUNCAO_LOTE_INELEGIVEL', 'lote fora da área, inativo ou sem cabeças; junte só lotes ativos da mesma área (outra área exige transferência antes)', {
              lote_id: id,
              area_atual_id: l.area_atual_id ?? null,
              status: l.status,
              quantidade_cabecas: l.quantidade_cabecas,
            });
          }
        }
        const principal = porId.get(e.principalId);
        const origens = e.origens.map((id) => porId.get(id));

        // ── Classificação idêntica: categoria, sexo definido, categoria de manejo ──
        if (!SEXOS.some((s) => normal(s) === normal(principal.sexo))) {
          throw recusa('JUNCAO_CLASSIFICACAO_DIVERGENTE', 'o lote principal não tem sexo definido (Macho/Fêmea)', { lote_id: principal.id, campo: 'sexo' });
        }
        for (const o of origens) {
          const campos = [];
          if (!principal.categoria || normal(o.categoria) !== normal(principal.categoria)) campos.push('categoria');
          if (normal(o.sexo) !== normal(principal.sexo)) campos.push('sexo');
          if ((o.categoria_manejo_id ?? null) !== (principal.categoria_manejo_id ?? null)) campos.push('categoria_manejo_id');
          if (campos.length) {
            throw recusa('JUNCAO_CLASSIFICACAO_DIVERGENTE', 'os lotes não têm a mesma classificação; não se junta lote de categoria, sexo ou categoria de manejo diferente', {
              lote_id: o.id,
              campos,
            });
          }
        }

        // ── Data: nada posterior ATIVO em nenhum participante (consulta completa, cancelados fora) ──
        const pseudo = { id: '', empresa_id: e.empresaId, createdAt: new Date('9999-12-31T00:00:00Z'), dados: { data_movimentacao: e.dataMovimentacao } };
        const posteriores = await dependenciasPosteriores(tx, auth.clienteId, pseudo, {
          loteIds: ids,
          nomes: ids.map((id) => porId.get(id)?.nome),
          areaIds: [],
        });
        if (posteriores.length) {
          throw recusa('JUNCAO_DATA_RETROATIVA', 'há registro ativo posterior à data da junção num dos lotes; use data igual ou posterior', { dependencias: posteriores });
        }

        // ── Plano: soma, peso, origens zeradas ──
        const participantes = [principal, ...origens];
        const total = participantes.reduce((t, l) => t + l.quantidade_cabecas, 0);
        const pesos = participantes.map((l) => pesoNormal(l.peso_medio_kg));
        const pesoConhecido = pesos.every((p) => p !== null);
        const pesoFinal = pesoConhecido
          ? Number((participantes.reduce((t, l, i) => t + l.quantidade_cabecas * pesos[i], 0) / total).toFixed(4))
          : null;

        const efeitos = [];
        const lotesResultado = [];
        let n = 0;
        const gravar = async (anterior, dados) => {
          n += 1;
          if (falhaInjetadaNoEfeito() === n) throw new Error(`falha injetada no efeito ${n}`);
          const atualizado = await tx.lote.update({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: anterior.id } }, data: dados });
          const auditoria = await registrarEvento(
            contexto,
            { acao: 'update', entidade: 'Lote', entidadeId: anterior.id, dadosAnteriores: comoLotePublico(anterior), dadosNovos: comoLotePublico(atualizado) },
            tx
          );
          efeitos.push({ lote_id: anterior.id, criado: false, auditoria_id: auditoria.id, antes: estadoRebanhoDe(anterior), depois: estadoRebanhoDe(atualizado) });
          lotesResultado.push(atualizado);
        };
        // Ordem dos efeitos = ordem de `lote_ids` (principal primeiro): o cancelamento confere.
        await gravar(principal, { quantidade_cabecas: total, peso_medio_kg: pesoFinal });
        for (const o of origens) await gravar(o, { quantidade_cabecas: 0, status: 'Inativo' });
        n += 1;
        if (falhaInjetadaNoEfeito() === n) throw new Error('falha injetada antes do movimento');

        const totalDepois = efeitos.reduce((t, x) => t + x.depois.quantidade_cabecas, 0);
        if (totalDepois !== total) throw new AppError('INTERNAL_ERROR', 'conservação de cabeças violada na junção');

        const dados = {
          tipo: TIPO_JUNCAO,
          lote: principal.nome,
          lote_id: principal.id,
          lote_ids: participantes.map((l) => l.id),
          quantidade_animais: total - principal.quantidade_cabecas,
          data_movimentacao: e.dataMovimentacao,
          area_origem_id: area.id,
          area_origem_nome: area.nome,
          categoria_animal: principal.categoria ?? null,
          juncao: {
            principal: {
              lote_id: principal.id,
              ...identificacao(principal),
              quantidade_antes: principal.quantidade_cabecas,
              quantidade_depois: total,
              peso_antes_kg: pesos[0],
              peso_depois_kg: pesoFinal,
            },
            politica_peso: pesoConhecido ? 'media_ponderada' : 'desconhecido_sem_media',
            total_cabecas: total,
          },
          // Contribuição de cada lote absorvido; raça/sistema divergentes ficam
          // registrados aqui (o principal mantém os seus — nada é sobrescrito).
          linhas: origens.map((o) => ({
            lote_id: o.id,
            ...identificacao(o),
            quantidade: o.quantidade_cabecas,
            peso_medio_kg: pesoNormal(o.peso_medio_kg),
            raca_predominante: o.raca_predominante ?? null,
            sistema_produtivo: o.sistema_produtivo ?? null,
          })),
          ...(e.observacoes ? { observacoes: e.observacoes } : {}),
          efeito_servidor: {
            comando: COMANDO_JUNCAO,
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
