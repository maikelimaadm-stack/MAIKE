/**
 * D-PROD-157 / D-PROD-162 / D-PROD-163 — catálogo PADRÃO do Patrimônio
 * (instalado pelo serviço, nunca por seed na migration).
 *
 * D-PROD-163 (SIMPLIFICA-02): o cadastro de família saiu da tela. O usuário
 * escolhe o "Tipo de bem" (a natureza: lista FIXA) e o "Tipo" (cadastro
 * editável). Por trás, cada natureza tem UMA família padrão (`FAMILIAS_PADRAO`,
 * agora 6 com `OUTROS`), GARANTIDA automaticamente no tenant por
 * `garantirCatalogoPadrao` — sem botão:
 *  - checagem barata primeiro (os 6 códigos padrão existem, em qualquer
 *    estado?); só abre transação e toma a trava do catálogo (A9) se faltar
 *    algum código, e então RELÊ sob a trava (corrida cria uma vez);
 *  - cria só as famílias padrão AUSENTES (por código). Nome já usado por outra
 *    família do tenant (ex.: família manual "Máquinas" com outro código) →
 *    a padrão nasce com nome alternativo ("Máquinas (padrão)"): o nome da
 *    família não aparece mais na tela, o código é a chave;
 *  - SÓ para a família criada naquela chamada, cria os tipos padrão dela,
 *    pulando (sem abortar) código já usado no tenant ou nome já usado no
 *    mesmo tipo de bem (natureza). Um tipo padrão que o usuário EXCLUIR não
 *    volta (a família dele já existe);
 *  - família padrão existente mas inativa ou com natureza divergente NÃO é
 *    alterada; para a resolução ela não vale (`familiaPadraoDaNatureza` →
 *    422 `PATRIMONIO_FAMILIA_PADRAO_INDISPONIVEL`).
 * Chamada antes de: listar tipos (gerenciar e opções do formulário), criar
 * tipo, criar/editar bem.
 *
 * O instalador explícito `POST /patrimonio-catalogo-padrao` continua
 * (idempotente, administrador): cria só o que falta, por `codigo`, sob a trava
 * do catálogo (A9):
 *  - item existente com o MESMO código conta como "existente" só se tiver a
 *    mesma natureza (família) ou família (tipo) E estiver ativo; senão vai a
 *    `conflitos` com o motivo (`natureza_divergente`, `familia_divergente` ou
 *    `inativo`) e nada é alterado nele;
 *  - tipo cuja família está em conflito é pulado com `dependencia_em_conflito`;
 *  - NOME já usado por outro código (sem diferenciar maiúsculas; no tipo,
 *    dentro da família) é pré-checado antes do INSERT → `nome_em_uso`: um
 *    P2002 nunca aborta a transação.
 * Resposta: `{ criados, existentes, conflitos }` (contagens por recurso:
 * familias, tipos). A tela não o chama mais (D-PROD-163).
 *
 * `BEBEDOURO_FIXO` é só um tipo de benfeitoria: não substitui nem se liga ao
 * Bebedouro do Mapa.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEventosEmLote } from '../auditoria/auditService.js';
import { ENTIDADE as ENTIDADE_FAMILIA, paraAuditoria as auditoriaFamilia } from './familiaPatrimonialService.js';
import { ENTIDADE as ENTIDADE_TIPO, paraAuditoria as auditoriaTipo } from './tipoPatrimonialService.js';
import { nomeIgual, travarCatalogo } from './patrimonioComum.js';
import { ROTULO_NATUREZA } from './patrimonioDominio.js';

/** Famílias padrão (vida útil padrão em meses): UMA por natureza (D-PROD-163). */
export const FAMILIAS_PADRAO = Object.freeze([
  Object.freeze({ codigo: 'BENFEITORIAS', nome: 'Benfeitorias e instalações', natureza: 'BENFEITORIA', vida_util_meses_padrao: 300, ordem: 1 }),
  Object.freeze({ codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA', vida_util_meses_padrao: 120, ordem: 2 }),
  Object.freeze({ codigo: 'VEICULOS', nome: 'Veículos', natureza: 'VEICULO', vida_util_meses_padrao: 60, ordem: 3 }),
  Object.freeze({ codigo: 'IMPLEMENTOS', nome: 'Implementos', natureza: 'IMPLEMENTO', vida_util_meses_padrao: 120, ordem: 4 }),
  Object.freeze({ codigo: 'EQUIPAMENTOS', nome: 'Equipamentos', natureza: 'EQUIPAMENTO', vida_util_meses_padrao: 120, ordem: 5 }),
  Object.freeze({ codigo: 'OUTROS', nome: 'Outros', natureza: 'OUTRO', vida_util_meses_padrao: 120, ordem: 6 }),
]);

/** Natureza → código da família padrão (derivado de `FAMILIAS_PADRAO`). */
export const FAMILIA_PADRAO_POR_NATUREZA = Object.freeze(Object.fromEntries(FAMILIAS_PADRAO.map((f) => [f.natureza, f.codigo])));

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

const CODIGOS_FAMILIAS_PADRAO = Object.freeze(FAMILIAS_PADRAO.map((f) => f.codigo));
/** Tentativas de nome alternativo da família padrão ("Nome (padrão)", "Nome (padrão 2)", ...). */
const MAX_NOMES_ALTERNATIVOS = 20;

const contadores = () => ({ familias: 0, tipos: 0 });

// ─── garantia automática (D-PROD-163) ───────────────────────────────────────

/**
 * 422: não há família padrão ATIVA desta natureza (ausente, inativa ou com
 * outra natureza no código padrão). Nada foi gravado.
 * @param {string} natureza @param {string|null} codigo @param {'ausente'|'inativa'|'natureza_divergente'} situacao
 */
export const familiaPadraoIndisponivel = (natureza, codigo, situacao) =>
  new AppError(
    'PATRIMONIO_FAMILIA_PADRAO_INDISPONIVEL',
    `o catálogo do tipo de bem "${ROTULO_NATUREZA[natureza] ?? natureza}" não está disponível: a classificação padrão (${codigo ?? '—'}) está ` +
      `${situacao === 'inativa' ? 'inativa' : situacao === 'natureza_divergente' ? 'cadastrada com outro tipo de bem' : 'ausente'} e não é alterada automaticamente; ` +
      'peça ao suporte para corrigi-la; nada foi gravado',
    { details: { field: 'natureza', reason: 'familia_padrao_indisponivel', natureza, codigo_familia: codigo, situacao } }
  );

/**
 * A família padrão UTILIZÁVEL da natureza (código padrão, mesma natureza,
 * ativa) ou 422 `PATRIMONIO_FAMILIA_PADRAO_INDISPONIVEL`. Tipo NOVO vai sempre
 * para ela.
 * @param {any} db @param {string} clienteId @param {string} natureza
 * @returns {Promise<{ id: string, codigo: string, natureza: string, ativo: boolean }>}
 */
export const familiaPadraoDaNatureza = async (db, clienteId, natureza) => {
  const codigo = FAMILIA_PADRAO_POR_NATUREZA[natureza] ?? null;
  const f = codigo
    ? await db.familiaPatrimonial.findFirst({ where: { cliente_id: clienteId, codigo }, select: { id: true, codigo: true, natureza: true, ativo: true } })
    : null;
  if (!f) throw familiaPadraoIndisponivel(natureza, codigo, 'ausente');
  if (f.natureza !== natureza) throw familiaPadraoIndisponivel(natureza, codigo, 'natureza_divergente');
  if (!f.ativo) throw familiaPadraoIndisponivel(natureza, codigo, 'inativa');
  return f;
};

/** Checagem barata (sem transação): os 6 códigos padrão existem no tenant, em qualquer estado? */
const catalogoCompleto = async (db, clienteId) =>
  (await db.familiaPatrimonial.count({ where: { cliente_id: clienteId, codigo: { in: [...CODIGOS_FAMILIAS_PADRAO] } } })) === CODIGOS_FAMILIAS_PADRAO.length;

/**
 * Nome livre (sem diferenciar maiúsculas) para a família padrão: o próprio ou
 * um alternativo. Sob a trava do catálogo.
 * @param {any} tx @param {string} clienteId @param {string} nome
 */
const nomeLivreDeFamilia = async (tx, clienteId, nome) => {
  for (let i = 0; i <= MAX_NOMES_ALTERNATIVOS; i += 1) {
    const candidato = i === 0 ? nome : i === 1 ? `${nome} (padrão)` : `${nome} (padrão ${i})`;
    if (!(await tx.familiaPatrimonial.findFirst({ where: { cliente_id: clienteId, nome: nomeIgual(candidato) }, select: { id: true } }))) return candidato;
  }
  return null;
};

/**
 * Completa o catálogo SOB a trava (relê tudo): famílias padrão ausentes e os
 * tipos padrão só delas. Devolve as contagens criadas.
 * @param {any} tx @param {any} contexto @param {string} clienteId
 */
const completarCatalogo = async (tx, contexto, clienteId) => {
  const criados = contadores();
  /** @type {Array<{ acao: string, entidade: string, entidadeId: string, dadosNovos: unknown }>} */
  const eventos = [];
  const presentes = new Set(
    (await tx.familiaPatrimonial.findMany({ where: { cliente_id: clienteId, codigo: { in: [...CODIGOS_FAMILIAS_PADRAO] } }, select: { codigo: true } })).map((f) => f.codigo)
  );
  for (const f of FAMILIAS_PADRAO) {
    if (presentes.has(f.codigo)) continue;
    const nome = await nomeLivreDeFamilia(tx, clienteId, f.nome);
    if (!nome) continue; // sem nome livre: a resolução responde 422 claro (família ausente)
    const familia = await tx.familiaPatrimonial.create({
      data: { cliente_id: clienteId, codigo: f.codigo, nome, natureza: f.natureza, vida_util_meses_padrao: f.vida_util_meses_padrao, ordem: f.ordem },
    });
    criados.familias += 1;
    eventos.push({ acao: 'create', entidade: ENTIDADE_FAMILIA, entidadeId: familia.id, dadosNovos: auditoriaFamilia(familia) });
    for (const t of TIPOS_PADRAO) {
      if (t.familia !== f.codigo) continue;
      const codigoUsado = await tx.tipoPatrimonial.findFirst({ where: { cliente_id: clienteId, codigo: t.codigo }, select: { id: true } });
      if (codigoUsado) continue;
      const nomeUsado = await tx.tipoPatrimonial.findFirst({
        where: { cliente_id: clienteId, nome: nomeIgual(t.nome), familia: { natureza: f.natureza } },
        select: { id: true },
      });
      if (nomeUsado) continue;
      const tipo = await tx.tipoPatrimonial.create({ data: { cliente_id: clienteId, familia_id: familia.id, codigo: t.codigo, nome: t.nome } });
      criados.tipos += 1;
      eventos.push({ acao: 'create', entidade: ENTIDADE_TIPO, entidadeId: tipo.id, dadosNovos: auditoriaTipo(tipo) });
    }
  }
  if (eventos.length) await registrarEventosEmLote(contexto, eventos, tx);
  return criados;
};

/**
 * Garante o catálogo padrão no tenant da sessão (idempotente, custo baixo:
 * uma contagem quando já está completo). Abre a PRÓPRIA transação curta só se
 * faltar algum código padrão.
 * @param {{ requestId: string, auth: any }} contexto
 * @returns {Promise<{ familias: number, tipos: number }>} o que foi criado agora
 */
export const garantirCatalogoPadrao = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  if (await catalogoCompleto(getPrismaClient(), cli)) return contadores();
  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      await travarCatalogo(tx, cli);
      return completarCatalogo(tx, contexto, cli);
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

// ─── instalador explícito (administrador; a tela não o chama mais) ──────────

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
