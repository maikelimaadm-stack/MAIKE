/**
 * Serviço de AreaPastagem (P4.2, D-PROD-30).
 *
 * Segunda capacidade de domínio nativa, e a primeira que **aponta para outra**.
 * O que ela acrescenta ao que a P4.1 estabeleceu:
 *
 *   vínculo      `setor_id` é verificado contra um setor DESTE tenant, dentro
 *                da transação, antes de gravar. Não é zelo redundante com a FK
 *                composta: a FK devolve erro do banco, e erro do banco vira 500
 *                genérico. A verificação existe para que "setor que não é seu"
 *                seja 404 com causa, não 500 sem;
 *   derivação    `setor_nome` é escrito a partir do setor lido — nunca do corpo
 *                da requisição. Ver abaixo;
 *   número       `numero_area` vem de `EntidadeCodigoSequencia`, escopo
 *                `tenant`, na mesma transação. Mesmo motivo do `numero_setor`:
 *                dois navegadores criando área ao mesmo tempo pediriam o mesmo
 *                número se quem contasse fosse o cliente.
 *
 * ─── Por que `setor_nome` é derivado, e não recebido ───────────────────────
 *
 * No legado, o frontend mandava `setor_nome` junto e a `syncEntityReferences`
 * da Base44 corrigia depois, quando o nome do setor mudasse. São duas fontes
 * para o mesmo fato, reconciliadas por uma varredura fora de transação — o
 * arranjo clássico em que a cópia diverge do original e ninguém percebe.
 *
 * Aqui o cliente não tem como enviar o campo: a rota o recusa com 400
 * (`additionalProperties: false`) e este arquivo o sobrescreve com o nome do
 * setor lido na mesma transação. Divergir passa a ser impossível na escrita.
 *
 * O que ainda **não** é resolvido: renomear um setor não reescreve as áreas que
 * o citam. Isso é a segunda metade do problema, e ela pertence à missão que
 * migrar `syncEntityReferences` — quando os seis destinos denormalizados forem
 * nativos (DBT-29). Até lá o campo fica correto no nascimento e no update, que
 * é estritamente melhor do que era, e a dívida está nomeada (DBT-32).
 *
 * ─── O que este serviço NÃO faz ────────────────────────────────────────────
 *
 * Não calcula ocupação, não deriva `status_ocupacao`, não soma UA. Isso depende
 * de `Lote`, que é P5. Derivar aqui exigiria consultar a Base44 do backend —
 * proibido — ou inventar o número.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { areaNotFound, setorNotFound } from '../../shared/errors/AppError.js';
import { buscarSetor } from '../setores/setorRepository.js';
import {
  listarAreas,
  buscarArea,
  inserirArea,
  atualizarAreaPorId,
} from './areaPastagemRepository.js';

/** Nome da sequência. Literal, para não depender de nome de model do Prisma. */
export const ENTIDADE_SEQUENCIA = 'AreaPastagem';

/**
 * Escopo da numeração de `numero_area`.
 *
 * `tenant`, pelo mesmo motivo de `Setor`: numerar por empresa exigiria ancorar
 * a sequência num `empresa_id` que o backend não consegue validar enquanto
 * `Empresa` não for nativa (P6). Sequência ancorada em string arbitrária é
 * sequência criada sob demanda por quem chamar a API.
 */
export const escopoDaNumeracao = () => ESCOPO_TENANT;

/** `''` e `'   '` viram `null`; o resto passa aparado. */
const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

/**
 * `Decimal` do Prisma → `number` do JSON.
 *
 * Sem isto, os sete campos decimais sairiam como objeto interno da biblioteca
 * (`{s, e, d}`) — na resposta HTTP e no payload de auditoria, que percorre o
 * objeto campo a campo.
 */
const comoNumero = (valor) => (valor === null || valor === undefined ? null : Number(valor));

/**
 * Registro do banco → objeto do contrato HTTP.
 *
 * `cliente_id` não sai daqui, pelo mesmo motivo de Setor: ele é contexto da
 * sessão, não dado do registro. Devolvê-lo treinaria o frontend a lê-lo de uma
 * resposta em vez da sessão.
 *
 * @param {Record<string, any>} registro
 */
export const comoAreaPublica = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  setor_id: registro.setor_id,
  setor_nome: registro.setor_nome,
  numero_area: registro.numero_area,
  nome: registro.nome,
  sigla: registro.sigla ?? null,
  tamanho_hectares: comoNumero(registro.tamanho_hectares),
  area_pastejada: comoNumero(registro.area_pastejada),
  capacidade_maxima: comoNumero(registro.capacidade_maxima),
  tipo_pastagem: registro.tipo_pastagem ?? null,
  aproveitamento_classificacao: registro.aproveitamento_classificacao,
  tipo_cultura: registro.tipo_cultura,
  cor: registro.cor ?? null,
  quantidade_atual: registro.quantidade_atual,
  status_ocupacao: registro.status_ocupacao,
  forragem_kg_ha: comoNumero(registro.forragem_kg_ha),
  taxa_crescimento_kg_ha_dia: comoNumero(registro.taxa_crescimento_kg_ha_dia),
  taxa_aproveitamento: comoNumero(registro.taxa_aproveitamento),
  periodo_estacao: registro.periodo_estacao ?? null,
  coordenadas: registro.coordenadas ?? null,
  observacoes: registro.observacoes ?? null,
  ativo: registro.ativo,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

/**
 * Campos de negócio aceitos numa escrita, com o tratamento de cada um.
 *
 * Mapa literal em vez de spread da entrada: o que não está aqui não é gravado,
 * mesmo que o schema da rota um dia deixe passar. `id`, `cliente_id`,
 * `numero_area` e **`setor_nome`** não aparecem de propósito — os quatro são
 * atribuídos pelo servidor.
 */
const CAMPOS_EDITAVEIS = Object.freeze({
  empresa_id: (v) => textoOuNulo(v),
  setor_id: (v) => textoOuNulo(v),
  nome: (v) => textoOuNulo(v),
  sigla: (v) => textoOuNulo(v),
  tipo_pastagem: (v) => textoOuNulo(v),
  aproveitamento_classificacao: (v) => textoOuNulo(v),
  tipo_cultura: (v) => textoOuNulo(v),
  cor: (v) => textoOuNulo(v),
  status_ocupacao: (v) => textoOuNulo(v),
  periodo_estacao: (v) => textoOuNulo(v),
  observacoes: (v) => textoOuNulo(v),
  tamanho_hectares: (v) => (v === null || v === undefined ? null : v),
  area_pastejada: (v) => (v === null || v === undefined ? null : v),
  capacidade_maxima: (v) => (v === null || v === undefined ? null : v),
  forragem_kg_ha: (v) => (v === null || v === undefined ? null : v),
  taxa_crescimento_kg_ha_dia: (v) => (v === null || v === undefined ? null : v),
  taxa_aproveitamento: (v) => (v === null || v === undefined ? null : v),
  quantidade_atual: (v) => (v === null || v === undefined ? undefined : v),
  coordenadas: (v) => (v === undefined ? undefined : v),
  ativo: (v) => (v === undefined ? undefined : Boolean(v)),
});

/**
 * Extrai só os campos editáveis presentes na entrada.
 *
 * @param {Record<string, unknown>} entrada
 * @returns {Record<string, unknown>}
 */
const camposDe = (entrada) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const [campo, tratar] of Object.entries(CAMPOS_EDITAVEIS)) {
    if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
    const valor = tratar(entrada[campo]);
    if (valor !== undefined) saida[campo] = valor;
  }
  return saida;
};

/**
 * Lê o setor do tenant ou falha com 404.
 *
 * A leitura acontece dentro da transação de quem chama — e é dela que sai o
 * `setor_nome` gravado.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} setorId
 */
const exigirSetorDoTenant = async (tx, clienteId, setorId) => {
  const setor = await buscarSetor(clienteId, setorId, tx);
  if (!setor) throw setorNotFound('setor vinculado não encontrado');
  return setor;
};

/**
 * Lista as áreas do tenant autenticado.
 *
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarAreas(auth.clienteId);
  return registros.map(comoAreaPublica);
};

/**
 * Cria uma área de pastagem.
 *
 * Tudo numa transação só: verificação do setor, reserva do número, gravação e
 * auditoria. Se a auditoria falhar, a linha não fica — o inverso seria um
 * registro que ninguém sabe de onde veio.
 *
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const campos = camposDe(entrada);
    const setor = await exigirSetorDoTenant(tx, auth.clienteId, String(campos.setor_id ?? ''));

    const numero = await reservarNumero(tx, {
      clienteId: auth.clienteId,
      entidade: ENTIDADE_SEQUENCIA,
      escopoTipo: escopoDaNumeracao(),
    });

    const registro = await inserirArea(tx, {
      ...campos,
      cliente_id: auth.clienteId,
      numero_area: String(numero),
      // Derivado, sempre. O corpo da requisição não tem voz aqui.
      setor_nome: setor.nome,
    });

    const publico = comoAreaPublica(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'create',
        entidade: 'AreaPastagem',
        entidadeId: registro.id,
        dadosNovos: publico,
      },
      tx
    );

    return publico;
  });
};

/**
 * Atualiza uma área do tenant.
 *
 * A leitura anterior acontece **dentro** da transação e pelo unique composto
 * `[cliente_id, id]`: é ela que transforma "id de outro cliente" em "não
 * existe", e dela sai o `dados_anteriores` da auditoria.
 *
 * Trocar `setor_id` é permitido — mover uma área de setor é operação de mapa
 * corriqueira, ao contrário de mover um setor de empresa. Quando acontece, o
 * `setor_nome` é rederivado do setor novo na mesma transação.
 *
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {Record<string, unknown>} entrada
 */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const anterior = await buscarArea(auth.clienteId, id, tx);
    if (!anterior) throw areaNotFound();

    const campos = camposDe(entrada);

    if (Object.prototype.hasOwnProperty.call(campos, 'setor_id')) {
      const setor = await exigirSetorDoTenant(tx, auth.clienteId, String(campos.setor_id ?? ''));
      campos.setor_nome = setor.nome;
    }

    const registro = Object.keys(campos).length
      ? await atualizarAreaPorId(tx, auth.clienteId, id, campos)
      : anterior;

    const publico = comoAreaPublica(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'AreaPastagem',
        entidadeId: id,
        dadosAnteriores: comoAreaPublica(anterior),
        dadosNovos: publico,
      },
      tx
    );

    return publico;
  });
};
