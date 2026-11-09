/**
 * D-PROD-156 — catálogo PADRÃO do Patrimônio (instalado pelo serviço, nunca
 * por seed na migration) e o instalador IDEMPOTENTE `POST /patrimonio-catalogo-padrao`.
 *
 * Cria só o que falta, por `codigo`, sob a trava do catálogo do tenant (A9):
 *  - item existente com o MESMO código conta como "existente" só se tiver a
 *    mesma natureza (família), dimensão (perfil), família (tipo) ou unidade
 *    (combustível) E estiver ativo; senão vai a `conflitos` com o motivo
 *    (`natureza_divergente`, `dimensao_divergente`, `familia_divergente`,
 *    `unidade_divergente` ou `inativo`) e nada é alterado nele;
 *  - tipo cuja família ou algum perfil está em conflito é pulado com
 *    `dependencia_em_conflito`;
 *  - NOME já usado por outro código (sem diferenciar maiúsculas; no tipo,
 *    dentro da família) é pré-checado antes do INSERT → `nome_em_uso`: um
 *    P2002 nunca aborta a transação.
 * Resposta: `{ criados, existentes, conflitos }` (contagens por recurso:
 * familias, tipos, perfis, combustiveis).
 *
 * Fora do padrão de propósito: `CAPACIDADE_CARGA` (A9). `BEBEDOURO_FIXO` é só
 * um tipo de benfeitoria: não substitui nem se liga ao Bebedouro do Mapa.
 * GNV (m3) fica no catálogo sem poder ser vinculado a tanque neste slice.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEventosEmLote } from '../auditoria/auditService.js';
import { ENTIDADE as ENTIDADE_COMBUSTIVEL, paraAuditoria as auditoriaCombustivel } from './tipoCombustivelService.js';
import { ENTIDADE as ENTIDADE_FAMILIA, paraAuditoria as auditoriaFamilia } from './familiaPatrimonialService.js';
import { ENTIDADE as ENTIDADE_PERFIL, paraAuditoria as auditoriaPerfil } from './perfilMedicaoService.js';
import { ENTIDADE as ENTIDADE_TIPO, paraAuditoria as auditoriaTipo, sincronizarPerfisDoTipo } from './tipoPatrimonialService.js';
import { travarCatalogo } from './patrimonioComum.js';
import { unidadeCanonicaDe } from './unidadesFisicas.js';

/** Perfis de medição padrão (unidades na ordem da dimensão, canônica primeiro). */
export const PERFIS_PADRAO = Object.freeze([
  Object.freeze({ codigo: 'EXTENSAO', nome: 'Extensão', dimensao: 'EXTENSAO', finalidade: 'DIMENSAO', unidades_permitidas: Object.freeze(['m', 'km']) }),
  Object.freeze({ codigo: 'AREA', nome: 'Área', dimensao: 'AREA', finalidade: 'DIMENSAO', unidades_permitidas: Object.freeze(['m2', 'ha']) }),
  Object.freeze({ codigo: 'VOLUME', nome: 'Volume', dimensao: 'VOLUME', finalidade: 'CAPACIDADE', unidades_permitidas: Object.freeze(['L', 'm3']) }),
  Object.freeze({ codigo: 'CAPACIDADE_ANIMAL', nome: 'Capacidade animal', dimensao: 'CABECAS', finalidade: 'CAPACIDADE', unidades_permitidas: Object.freeze(['cab']) }),
  Object.freeze({ codigo: 'QUANTIDADE', nome: 'Quantidade', dimensao: 'QUANTIDADE', finalidade: 'DIMENSAO', unidades_permitidas: Object.freeze(['un']) }),
]);

/** Famílias padrão (vida útil padrão em meses). */
export const FAMILIAS_PADRAO = Object.freeze([
  Object.freeze({ codigo: 'BENFEITORIAS', nome: 'Benfeitorias e instalações', natureza: 'BENFEITORIA', vida_util_meses_padrao: 300, ordem: 1 }),
  Object.freeze({ codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA', vida_util_meses_padrao: 120, ordem: 2 }),
  Object.freeze({ codigo: 'VEICULOS', nome: 'Veículos', natureza: 'VEICULO', vida_util_meses_padrao: 60, ordem: 3 }),
  Object.freeze({ codigo: 'IMPLEMENTOS', nome: 'Implementos', natureza: 'IMPLEMENTO', vida_util_meses_padrao: 120, ordem: 4 }),
  Object.freeze({ codigo: 'EQUIPAMENTOS', nome: 'Equipamentos', natureza: 'EQUIPAMENTO', vida_util_meses_padrao: 120, ordem: 5 }),
]);

/** Tipos padrão: família e perfis por CÓDIGO; o primeiro perfil é o principal. */
export const TIPOS_PADRAO = Object.freeze([
  Object.freeze({ codigo: 'CURRAL', nome: 'Curral', familia: 'BENFEITORIAS', perfis: Object.freeze(['AREA', 'CAPACIDADE_ANIMAL']) }),
  Object.freeze({ codigo: 'GALPAO', nome: 'Galpão', familia: 'BENFEITORIAS', perfis: Object.freeze(['AREA']) }),
  Object.freeze({ codigo: 'CERCA_ARAME', nome: 'Cerca de arame', familia: 'BENFEITORIAS', perfis: Object.freeze(['EXTENSAO']) }),
  Object.freeze({ codigo: 'CERCA_ELETRICA', nome: 'Cerca elétrica', familia: 'BENFEITORIAS', perfis: Object.freeze(['EXTENSAO']) }),
  Object.freeze({ codigo: 'RESERVATORIO', nome: 'Reservatório', familia: 'BENFEITORIAS', perfis: Object.freeze(['VOLUME']) }),
  Object.freeze({ codigo: 'BEBEDOURO_FIXO', nome: 'Bebedouro fixo', familia: 'BENFEITORIAS', perfis: Object.freeze(['VOLUME']) }),
  Object.freeze({ codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', familia: 'MAQUINAS', perfis: Object.freeze([]) }),
  Object.freeze({ codigo: 'TRATOR_ESTEIRAS', nome: 'Trator de esteiras', familia: 'MAQUINAS', perfis: Object.freeze([]) }),
  Object.freeze({ codigo: 'CAMINHONETE', nome: 'Caminhonete', familia: 'VEICULOS', perfis: Object.freeze([]) }),
  Object.freeze({ codigo: 'CAMINHAO', nome: 'Caminhão', familia: 'VEICULOS', perfis: Object.freeze([]) }),
  Object.freeze({ codigo: 'ROCADEIRA', nome: 'Roçadeira', familia: 'IMPLEMENTOS', perfis: Object.freeze([]) }),
  Object.freeze({ codigo: 'GERADOR', nome: 'Gerador', familia: 'EQUIPAMENTOS', perfis: Object.freeze([]) }),
  Object.freeze({ codigo: 'BALANCA', nome: 'Balança', familia: 'EQUIPAMENTOS', perfis: Object.freeze([]) }),
]);

/** Combustíveis padrão. */
export const COMBUSTIVEIS_PADRAO = Object.freeze([
  Object.freeze({ codigo: 'DIESEL_S10', nome: 'Diesel S10', unidade: 'L' }),
  Object.freeze({ codigo: 'DIESEL_S500', nome: 'Diesel S500', unidade: 'L' }),
  Object.freeze({ codigo: 'GASOLINA', nome: 'Gasolina', unidade: 'L' }),
  Object.freeze({ codigo: 'ETANOL', nome: 'Etanol', unidade: 'L' }),
  Object.freeze({ codigo: 'GNV', nome: 'GNV', unidade: 'm3' }),
]);

const contadores = () => ({ familias: 0, tipos: 0, perfis: 0, combustiveis: 0 });

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
        Boolean(await delegado.findFirst({ where: { cliente_id: cli, nome: { equals: nome, mode: 'insensitive' }, ...extra }, select: { id: true } }));

      /** código → id dos perfis e famílias utilizáveis pelos tipos */
      const perfisOk = new Map();
      for (const p of PERFIS_PADRAO) {
        const atual = await tx.perfilMedicao.findFirst({ where: { cliente_id: cli, codigo: p.codigo }, select: { id: true, dimensao: true, ativo: true } });
        if (atual) {
          if (atual.dimensao !== p.dimensao) conflito('perfis', p.codigo, 'dimensao_divergente');
          else if (!atual.ativo) conflito('perfis', p.codigo, 'inativo');
          else {
            existentes.perfis += 1;
            perfisOk.set(p.codigo, atual.id);
          }
          continue;
        }
        if (await nomeEmUso(tx.perfilMedicao, p.nome)) {
          conflito('perfis', p.codigo, 'nome_em_uso');
          continue;
        }
        const r = await tx.perfilMedicao.create({
          data: { cliente_id: cli, codigo: p.codigo, nome: p.nome, dimensao: p.dimensao, finalidade: p.finalidade, unidade_canonica: unidadeCanonicaDe(p.dimensao), unidades_permitidas: [...p.unidades_permitidas] },
        });
        criados.perfis += 1;
        perfisOk.set(p.codigo, r.id);
        eventos.push({ acao: 'create', entidade: ENTIDADE_PERFIL, entidadeId: r.id, dadosNovos: auditoriaPerfil(r) });
      }

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
        if (!familiaId || t.perfis.some((codigo) => !perfisOk.has(codigo))) {
          conflito('tipos', t.codigo, 'dependencia_em_conflito');
          continue;
        }
        if (await nomeEmUso(tx.tipoPatrimonial, t.nome, { familia_id: familiaId })) {
          conflito('tipos', t.codigo, 'nome_em_uso');
          continue;
        }
        const r = await tx.tipoPatrimonial.create({ data: { cliente_id: cli, familia_id: familiaId, codigo: t.codigo, nome: t.nome } });
        const perfis = t.perfis.map((codigo, ordem) => ({ perfil_id: /** @type {string} */ (perfisOk.get(codigo)), principal: ordem === 0, ordem }));
        if (perfis.length) await sincronizarPerfisDoTipo(tx, cli, r.id, perfis, []);
        criados.tipos += 1;
        eventos.push({ acao: 'create', entidade: ENTIDADE_TIPO, entidadeId: r.id, dadosNovos: auditoriaTipo({ ...r, perfis }) });
      }

      for (const c of COMBUSTIVEIS_PADRAO) {
        const atual = await tx.tipoCombustivel.findFirst({ where: { cliente_id: cli, codigo: c.codigo }, select: { id: true, unidade: true, ativo: true } });
        if (atual) {
          if (atual.unidade !== c.unidade) conflito('combustiveis', c.codigo, 'unidade_divergente');
          else if (!atual.ativo) conflito('combustiveis', c.codigo, 'inativo');
          else existentes.combustiveis += 1;
          continue;
        }
        if (await nomeEmUso(tx.tipoCombustivel, c.nome)) {
          conflito('combustiveis', c.codigo, 'nome_em_uso');
          continue;
        }
        const r = await tx.tipoCombustivel.create({ data: { cliente_id: cli, codigo: c.codigo, nome: c.nome, unidade: c.unidade } });
        criados.combustiveis += 1;
        eventos.push({ acao: 'create', entidade: ENTIDADE_COMBUSTIVEL, entidadeId: r.id, dadosNovos: auditoriaCombustivel(r) });
      }

      if (eventos.length) await registrarEventosEmLote(contexto, eventos, tx);
      return { criados, existentes, conflitos };
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};
