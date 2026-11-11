/**
 * D-PROD-157 / D-PROD-162 — catálogo PADRÃO do Patrimônio (instalado pelo
 * serviço, nunca por seed na migration) e o instalador IDEMPOTENTE
 * `POST /patrimonio-catalogo-padrao`. D-PROD-162: só famílias e tipos (perfis
 * de medição e combustíveis saíram do produto).
 *
 * Cria só o que falta, por `codigo`, sob a trava do catálogo do tenant (A9):
 *  - item existente com o MESMO código conta como "existente" só se tiver a
 *    mesma natureza (família) ou família (tipo) E estiver ativo; senão vai a
 *    `conflitos` com o motivo (`natureza_divergente`, `familia_divergente` ou
 *    `inativo`) e nada é alterado nele;
 *  - tipo cuja família está em conflito é pulado com `dependencia_em_conflito`;
 *  - NOME já usado por outro código (sem diferenciar maiúsculas; no tipo,
 *    dentro da família) é pré-checado antes do INSERT → `nome_em_uso`: um
 *    P2002 nunca aborta a transação.
 * Resposta: `{ criados, existentes, conflitos }` (contagens por recurso:
 * familias, tipos).
 *
 * `BEBEDOURO_FIXO` é só um tipo de benfeitoria: não substitui nem se liga ao
 * Bebedouro do Mapa.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEventosEmLote } from '../auditoria/auditService.js';
import { ENTIDADE as ENTIDADE_FAMILIA, paraAuditoria as auditoriaFamilia } from './familiaPatrimonialService.js';
import { ENTIDADE as ENTIDADE_TIPO, paraAuditoria as auditoriaTipo } from './tipoPatrimonialService.js';
import { nomeIgual, travarCatalogo } from './patrimonioComum.js';

/** Famílias padrão (vida útil padrão em meses). */
export const FAMILIAS_PADRAO = Object.freeze([
  Object.freeze({ codigo: 'BENFEITORIAS', nome: 'Benfeitorias e instalações', natureza: 'BENFEITORIA', vida_util_meses_padrao: 300, ordem: 1 }),
  Object.freeze({ codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA', vida_util_meses_padrao: 120, ordem: 2 }),
  Object.freeze({ codigo: 'VEICULOS', nome: 'Veículos', natureza: 'VEICULO', vida_util_meses_padrao: 60, ordem: 3 }),
  Object.freeze({ codigo: 'IMPLEMENTOS', nome: 'Implementos', natureza: 'IMPLEMENTO', vida_util_meses_padrao: 120, ordem: 4 }),
  Object.freeze({ codigo: 'EQUIPAMENTOS', nome: 'Equipamentos', natureza: 'EQUIPAMENTO', vida_util_meses_padrao: 120, ordem: 5 }),
]);

/** Tipos padrão: família por CÓDIGO. */
export const TIPOS_PADRAO = Object.freeze([
  Object.freeze({ codigo: 'CURRAL', nome: 'Curral', familia: 'BENFEITORIAS' }),
  Object.freeze({ codigo: 'GALPAO', nome: 'Galpão', familia: 'BENFEITORIAS' }),
  Object.freeze({ codigo: 'CERCA_ARAME', nome: 'Cerca de arame', familia: 'BENFEITORIAS' }),
  Object.freeze({ codigo: 'CERCA_ELETRICA', nome: 'Cerca elétrica', familia: 'BENFEITORIAS' }),
  Object.freeze({ codigo: 'RESERVATORIO', nome: 'Reservatório', familia: 'BENFEITORIAS' }),
  Object.freeze({ codigo: 'BEBEDOURO_FIXO', nome: 'Bebedouro fixo', familia: 'BENFEITORIAS' }),
  Object.freeze({ codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', familia: 'MAQUINAS' }),
  Object.freeze({ codigo: 'TRATOR_ESTEIRAS', nome: 'Trator de esteiras', familia: 'MAQUINAS' }),
  Object.freeze({ codigo: 'CAMINHONETE', nome: 'Caminhonete', familia: 'VEICULOS' }),
  Object.freeze({ codigo: 'CAMINHAO', nome: 'Caminhão', familia: 'VEICULOS' }),
  Object.freeze({ codigo: 'ROCADEIRA', nome: 'Roçadeira', familia: 'IMPLEMENTOS' }),
  Object.freeze({ codigo: 'GERADOR', nome: 'Gerador', familia: 'EQUIPAMENTOS' }),
  Object.freeze({ codigo: 'BALANCA', nome: 'Balança', familia: 'EQUIPAMENTOS' }),
]);

const contadores = () => ({ familias: 0, tipos: 0 });

/**
 * Instala o que falta do catálogo padrão no tenant da sessão (idempotente).
 * @param {{ requestId: string, auth: any }} contexto
 * @returns {Promise<{ criados: Record<string, number>, existentes: Record<string, number>, conflitos: Array<{ recurso: string, codigo: string, motivo: string }> }>}
 */
export const instalarCatalogoPadrao = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      await travarCatalogo(tx, cli);
      const criados = contadores();
      const existentes = contadores();
      /** @type {Array<{ recurso: string, codigo: string, motivo: string }>} */
      const conflitos = [];
      /** @type {Array<{ acao: string, entidade: string, entidadeId: string, dadosNovos: unknown }>} */
      const eventos = [];
      const conflito = (recurso, codigo, motivo) => conflitos.push({ recurso, codigo, motivo });
      const nomeEmUso = async (delegado, nome, extra = {}) =>
        Boolean(await delegado.findFirst({ where: { cliente_id: cli, nome: nomeIgual(nome), ...extra }, select: { id: true } }));

      /** código → id das famílias utilizáveis pelos tipos */
      const familiasOk = new Map();
      for (const f of FAMILIAS_PADRAO) {
        const atual = await tx.familiaPatrimonial.findFirst({ where: { cliente_id: cli, codigo: f.codigo }, select: { id: true, natureza: true, ativo: true } });
        if (atual) {
          if (atual.natureza !== f.natureza) conflito('familias', f.codigo, 'natureza_divergente');
          else if (!atual.ativo) conflito('familias', f.codigo, 'inativo');
          else {
            existentes.familias += 1;
            familiasOk.set(f.codigo, atual.id);
          }
          continue;
        }
        if (await nomeEmUso(tx.familiaPatrimonial, f.nome)) {
          conflito('familias', f.codigo, 'nome_em_uso');
          continue;
        }
        const r = await tx.familiaPatrimonial.create({
          data: { cliente_id: cli, codigo: f.codigo, nome: f.nome, natureza: f.natureza, vida_util_meses_padrao: f.vida_util_meses_padrao, ordem: f.ordem },
        });
        criados.familias += 1;
        familiasOk.set(f.codigo, r.id);
        eventos.push({ acao: 'create', entidade: ENTIDADE_FAMILIA, entidadeId: r.id, dadosNovos: auditoriaFamilia(r) });
      }

      for (const t of TIPOS_PADRAO) {
        const familiaId = familiasOk.get(t.familia);
        const atual = await tx.tipoPatrimonial.findFirst({ where: { cliente_id: cli, codigo: t.codigo }, select: { id: true, familia_id: true, ativo: true } });
        if (atual) {
          if (!familiaId || atual.familia_id !== familiaId) conflito('tipos', t.codigo, familiaId ? 'familia_divergente' : 'dependencia_em_conflito');
          else if (!atual.ativo) conflito('tipos', t.codigo, 'inativo');
          else existentes.tipos += 1;
          continue;
        }
        if (!familiaId) {
          conflito('tipos', t.codigo, 'dependencia_em_conflito');
          continue;
        }
        if (await nomeEmUso(tx.tipoPatrimonial, t.nome, { familia_id: familiaId })) {
          conflito('tipos', t.codigo, 'nome_em_uso');
          continue;
        }
        const r = await tx.tipoPatrimonial.create({ data: { cliente_id: cli, familia_id: familiaId, codigo: t.codigo, nome: t.nome } });
        criados.tipos += 1;
        eventos.push({ acao: 'create', entidade: ENTIDADE_TIPO, entidadeId: r.id, dadosNovos: auditoriaTipo(r) });
      }

      if (eventos.length) await registrarEventosEmLote(contexto, eventos, tx);
      return { criados, existentes, conflitos };
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};
