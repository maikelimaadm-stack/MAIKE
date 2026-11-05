/**
 * Autorização por TELA/AÇÃO e por ação do MAPA GERAL — fonte única no servidor.
 *
 * Antes, a tela de Permissões gravava `Permissao` (módulos, telas × ações,
 * permissões do Mapa Geral), mas NENHUMA rota de negócio a consultava: o
 * bloqueio era só visual no navegador. Uma requisição direta fazia tudo.
 *
 * Regras (fail-closed):
 *  - administrador da fazenda (`Usuario.papel_tenant = 'administrador'`, ativo,
 *    relido do banco a cada chamada) → tudo;
 *  - conta inativa ou inexistente → nada;
 *  - linha `Permissao` do PRÓPRIO login no MESMO tenant (vínculo canônico
 *    `cliente_id + user_email = login`; nada vem do corpo) com `is_admin = true`
 *    → todas as telas e ações (concessão EXPLÍCITA "acesso total a módulos,
 *    telas, ações e menu mobile" feita pelo administrador; NÃO dá autoridade de
 *    administrador da fazenda — as telas só-admin seguem exigindo o papel);
 *  - senão: módulo concedido E linha da tela presente com `visualizar = true` E
 *    a ação = true. Sem linha, sem módulo, sem tela ou ação ausente → NEGADO;
 *  - ação do Mapa Geral: tela `pec-mapa-geral` visível E a chave do mapa:
 *      · ação GRAVADORA (`ACOES_GRAVADORAS_MAPA`): só `=== true` (R2 — ausente,
 *        objeto do mapa ausente ou valor não booleano → NEGADO; registro
 *        parcial legado não ganha ação por padrão);
 *      · visualização: ausente = ligada (só exibição; a tela já é explícita).
 *    Mesma regra no navegador (`src/lib/mapaGeralPermissions.js`).
 *
 * Negação: 403 `ACAO_NAO_PERMITIDA`, antes de qualquer escrita (preHandler).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { AppError } from '../errors/AppError.js';
import { exigirAuthContext } from './authContext.js';
import { atorDoTenant, ehAdminTenantAtivo, tenantAdminRequired } from './exigirAdminTenant.js';

/** Telas do `menuConfig` (ids estáveis, os mesmos gravados em `permissoes_telas`). */
export const TELAS = Object.freeze({
  MAPA_GERAL: Object.freeze({ modulo: 'mapa', tela: 'pec-mapa-geral' }),
  MAPA_CADASTRO: Object.freeze({ modulo: 'mapa', tela: 'pec-mapa-cadastro' }),
  LOTES: Object.freeze({ modulo: 'manejo', tela: 'pec-lotes' }),
  SETORES: Object.freeze({ modulo: 'manejo', tela: 'pec-setores' }),
  CATEGORIAS_MANEJO: Object.freeze({ modulo: 'manejo', tela: 'pec-categorias-manejo' }),
  BEBEDOUROS: Object.freeze({ modulo: 'manejo', tela: 'pec-bebedouros' }),
  PRODUTOS: Object.freeze({ modulo: 'suporte-mapa', tela: 'sup-produtos' }),
  CATEGORIAS: Object.freeze({ modulo: 'suporte-mapa', tela: 'sup-categorias' }),
  MARCAS: Object.freeze({ modulo: 'suporte-mapa', tela: 'sup-marcas' }),
  UNIDADES: Object.freeze({ modulo: 'suporte-mapa', tela: 'sup-unidades' }),
  LOCAIS: Object.freeze({ modulo: 'suporte-mapa', tela: 'sup-locais' }),
  TIPOS_TAREFA: Object.freeze({ modulo: 'suporte-mapa', tela: 'sup-tipos-tarefa' }),
  GRUPOS_ATIVIDADE: Object.freeze({ modulo: 'suporte-mapa', tela: 'sup-grupos-atividades' }),
  EMPRESA: Object.freeze({ modulo: 'administracao', tela: 'adm-empresa' }),
});

export const ACOES = Object.freeze(['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar']);

/**
 * Ação do Mapa Geral exigida por um TIPO de movimentação/manejo. Tipo
 * desconhecido → null (o chamador decide; os guardas abaixo negam).
 * @param {unknown} tipo
 * @returns {string|null}
 */
export const chaveMapaDoTipo = (tipo) => {
  const t = String(tipo ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (t === 'transferencia de area' || t === 'transferencia') return 'mover_lotes';
  if (t === 'morte') return 'registrar_morte';
  if (t === 'abate') return 'registrar_abate';
  if (t === 'nascimento') return 'registrar_nascimento';
  if (t === 'pesagem') return 'pesar_lotes';
  if (t === 'mudanca de categoria') return 'mudar_categoria_lotes';
  if (t === 'renomear lote') return 'renomear_lotes';
  if (t === 'juncao de lotes' || t === 'juncao') return 'juntar_lotes';
  return null;
};

/**
 * Chaves do Mapa Geral que GRAVAM (manejo, suplementação, depósitos). Mesma
 * lista de `MAPA_GERAL_ACOES_GRAVADORAS` no navegador (teste de paridade).
 */
export const ACOES_GRAVADORAS_MAPA = Object.freeze([
  'mover_lotes', 'pesar_lotes', 'mudar_categoria_lotes', 'registrar_nascimento', 'registrar_morte',
  'registrar_abate', 'renomear_lotes', 'juntar_lotes', 'lancar_suplementacao', 'movimentar_depositos',
]);

const semAcento = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/**
 * R2 — `POST /movimentacoes-mapa` genérico: allowlist tipada. Devolve a chave
 * do mapa exigida, ou `null` = "sem contrato" (só o administrador real).
 *  - registro informativo do Renomear Lote (tipo 'Entrada' ou 'Renomear Lote'
 *    + motivo 'Renomear Lote') → `renomear_lotes`;
 *  - tipo conhecido (por qualquer grafia normalizada) → a chave do tipo;
 *  - qualquer outro tipo/alias → null.
 * @param {Record<string, unknown>|undefined|null} corpo
 */
export const chaveMapaDoGenerico = (corpo) => {
  const tipo = semAcento(corpo?.tipo);
  const motivo = semAcento(corpo?.motivo);
  if (motivo === 'renomear lote' && (tipo === 'entrada' || tipo === 'renomear lote')) return 'renomear_lotes';
  if (motivo && motivo !== tipo) return null;
  return chaveMapaDoTipo(corpo?.tipo);
};

/** @param {Record<string, unknown>} details */
export const acaoNaoPermitida = (details) =>
  new AppError('ACAO_NAO_PERMITIDA', 'você não tem permissão para esta ação', { details });

const lista = (v) => (Array.isArray(v) ? v : []);

/**
 * Quem pede e o que tem, relido do banco (nunca do token, corpo ou navegador).
 * @param {{auth: import('./authContext.js').AuthContext}} contexto
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 * @returns {Promise<{ ativo: boolean, adminReal: boolean, registro: any|null }>}
 */
export const carregarAutorizacao = async (contexto, tx) => {
  const auth = exigirAuthContext(contexto?.auth);
  const ator = await atorDoTenant(contexto, tx);
  if (!ator?.ativo) return { ativo: false, adminReal: false, registro: null };
  if (ehAdminTenantAtivo(ator)) return { ativo: true, adminReal: true, registro: null };
  const registro = await (tx ?? getPrismaClient()).permissao.findUnique({
    where: { cliente_id_user_email: { cliente_id: auth.clienteId, user_email: auth.login } },
  });
  return { ativo: true, adminReal: false, registro };
};

/** Avaliação pura (testável sem banco). */
export const telaPermite = (aut, { modulo, tela }, acao) => {
  if (!aut?.ativo) return false;
  if (aut.adminReal) return true;
  const r = aut.registro;
  if (!r) return false;
  if (r.is_admin === true) return true;
  if (!lista(r.modulos_permitidos).includes(modulo)) return false;
  const linha = lista(r.permissoes_telas).find((t) => t && t.tela_id === tela);
  if (!linha || linha.visualizar !== true) return false;
  return acao === 'visualizar' ? true : linha[acao] === true;
};

/** Ação do Mapa Geral (chave de `mapa_geral_permissoes`). */
export const mapaPermite = (aut, chave) => {
  if (!telaPermite(aut, TELAS.MAPA_GERAL, 'visualizar')) return false;
  if (aut.adminReal || aut.registro?.is_admin === true) return true;
  const mapa = aut.registro?.mapa_geral_permissoes;
  const valor = mapa && typeof mapa === 'object' && !Array.isArray(mapa) ? mapa[chave] : undefined;
  if (ACOES_GRAVADORAS_MAPA.includes(chave)) return valor === true;
  return valor !== false;
};

/** preHandler: só o administrador REAL da fazenda (papel relido do banco). */
export const apenasAdminTenant = () => async (request) => {
  const aut = await carregarAutorizacao(request.contexto);
  if (!aut.adminReal) throw tenantAdminRequired();
};

/**
 * @param {{auth: import('./authContext.js').AuthContext}} contexto
 * @param {{ modulo: string, tela: string }} alvo
 * @param {string} acao
 */
export const exigirTela = async (contexto, alvo, acao, tx) => {
  const aut = await carregarAutorizacao(contexto, tx);
  if (!telaPermite(aut, alvo, acao)) throw acaoNaoPermitida({ tela: alvo.tela, acao });
  return aut;
};

/** @param {{auth: import('./authContext.js').AuthContext}} contexto @param {string} chave */
export const exigirMapa = async (contexto, chave, tx) => {
  const aut = await carregarAutorizacao(contexto, tx);
  if (!mapaPermite(aut, chave)) throw acaoNaoPermitida({ tela: TELAS.MAPA_GERAL.tela, mapa: chave });
  return aut;
};

/**
 * preHandler Fastify: decide pela requisição (corpo já validado pelo schema).
 * `decidir(request, aut)` devolve `true` ou um objeto de detalhes da negação.
 * @param {(request: any, aut: Awaited<ReturnType<typeof carregarAutorizacao>>) => true | Record<string, unknown>} decidir
 */
export const autorizar = (decidir) => async (request) => {
  const aut = await carregarAutorizacao(request.contexto);
  const r = decidir(request, aut);
  if (r !== true) throw acaoNaoPermitida(r);
};

/** preHandler: exige a ação na tela. */
export const porTela = (alvo, acao) =>
  autorizar((_req, aut) => (telaPermite(aut, alvo, acao) ? true : { tela: alvo.tela, acao }));

/**
 * preHandler "qualquer uma de": a ação passa se UMA das concessões valer — a
 * tela do cadastro ou a tela de onde a interface faz o cadastro rápido. Cada
 * item é `[alvo, acao]` (tela) ou `{ mapa: chave }` (ação do Mapa Geral).
 * @param {...any} opcoes  `[alvo, acao]`, `{ mapa }` ou `{ de, campos }`
 */
export const porQualquer = (...opcoes) =>
  autorizar((req, aut) =>
    acessoTotal(aut) || opcoes.some((o) => opcaoPermite(req, aut, o))
      ? true
      : { exige: opcoes.map(rotuloDaOpcao) });

/**
 * Uma opção de `porQualquer`:
 *  - `[alvo, acao]` — tela/ação;  `{ mapa }` — ação do Mapa Geral;
 *  - `{ de: <opção>, campos: [...] }` — R3: a concessão só vale se o corpo
 *    tocar APENAS esses campos (fluxo de tela cruzada: renomear o depósito a
 *    partir de Locais, desvincular cochos ao excluir no Mapa Cadastro…).
 */
const opcaoPermite = (req, aut, o) => {
  if (Array.isArray(o)) return telaPermite(aut, o[0], o[1]);
  if (o && o.de) return somenteCampos(req?.body, o.campos) && opcaoPermite(req, aut, o.de);
  return mapaPermite(aut, o.mapa);
};
const rotuloDaOpcao = (o) =>
  Array.isArray(o) ? `${o[0].tela}:${o[1]}` : o?.de ? `${rotuloDaOpcao(o.de)}[${o.campos.join(',')}]` : `mapa:${o.mapa}`;

/** Administrador real ou a concessão `is_admin` da linha (todas as telas e ações). */
export const acessoTotal = (aut) => Boolean(aut?.adminReal || (aut?.ativo && aut.registro?.is_admin === true));

/**
 * O corpo é um objeto não vazio que só traz chaves desta lista.
 * @param {unknown} corpo @param {readonly string[]} campos
 */
export const somenteCampos = (corpo, campos) =>
  Boolean(corpo) && typeof corpo === 'object' && !Array.isArray(corpo) &&
  Object.keys(corpo).length > 0 && Object.keys(corpo).every((k) => campos.includes(k));

/** preHandler: administrador real OU a concessão explícita `is_admin` da linha (todas as telas). */
export const porAcessoTotal = () =>
  autorizar((_req, aut) => (acessoTotal(aut) ? true : { exige: ['acesso_total'] }));

/** preHandler: exige a chave do mapa (fixa ou derivada da requisição). */
export const porMapa = (chaveOuFn) =>
  autorizar((req, aut) => {
    const chave = typeof chaveOuFn === 'function' ? chaveOuFn(req) : chaveOuFn;
    return chave && mapaPermite(aut, chave) ? true : { tela: TELAS.MAPA_GERAL.tela, mapa: chave ?? null };
  });
