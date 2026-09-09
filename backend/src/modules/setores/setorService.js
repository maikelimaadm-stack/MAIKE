/**
 * Serviço de Setor (P4.1, D-PROD-25).
 *
 * A primeira capacidade de domínio a sair da Base44. O que muda de verdade não
 * é onde a linha é gravada — é quem decide três coisas:
 *
 *   tenant   vem de `auth_context`, nunca do corpo. A entrada HTTP não tem
 *            `cliente_id` (o schema da rota o rejeita na porta) e este arquivo
 *            nunca o lê de outro lugar;
 *   número   vem de `EntidadeCodigoSequencia`, na MESMA transação da criação.
 *            O `MAX + 1` que o frontend calculava deixou de existir — dois
 *            navegadores criando setor ao mesmo tempo liam a mesma lista e
 *            pediam o mesmo `numero_setor`, e o vencedor era quem gravasse
 *            primeiro;
 *   escopo   `tenant`. Ver `escopoDaNumeracao` abaixo.
 *
 * ─── O que este serviço NÃO faz: normalizar texto de produto ────────────────
 *
 * Nome em maiúsculas, sigla em maiúsculas, decimal com vírgula — isso continua
 * em `src/services/setorService.js`, onde sempre esteve. É convenção de
 * apresentação do cadastro, não invariante de dados, e duplicá-la aqui criaria
 * duas versões da mesma regra que divergiriam na primeira vez que uma das duas
 * mudasse.
 *
 * O que o backend valida é o **contrato**: forma, tamanho, tipo permitido,
 * campo desconhecido. Isso vive no schema da rota, onde falha vira 400 antes de
 * qualquer regra rodar.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { setorNotFound } from '../../shared/errors/AppError.js';
import {
  listarSetores,
  buscarSetor,
  inserirSetor,
  atualizarSetorPorId,
} from './setorRepository.js';

/** Nome da sequência. Literal, para não depender de nome de model do Prisma. */
export const ENTIDADE_SEQUENCIA = 'Setor';

/**
 * Escopo da numeração de `numero_setor`.
 *
 * `tenant`, e não `empresa`, apesar de o setor pertencer a uma empresa.
 *
 * O contrato oferece os dois escopos e manda a **capacidade** escolher. Numerar
 * por empresa exigiria que `escopo_id` fosse um id de Empresa — e `Empresa`
 * ainda é entidade da Base44 (nativa só na P6). O backend não tem como provar
 * que o `empresa_id` recebido existe, pertence a este tenant, ou não foi
 * inventado: ancorar uma sequência num identificador que ele não consegue
 * validar produziria uma sequência por string arbitrária, criada sob demanda
 * por quem chamasse a API.
 *
 * Escopo `tenant` numera um pouco mais largo — dois setores de empresas
 * diferentes não compartilham número — e é verificável hoje. Estreitar depois é
 * uma decisão da P6, com `Empresa` nativa; alargar depois seria migração de
 * dado.
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
 * Sem esta conversão, `area_total` sairia serializado como objeto interno da
 * biblioteca decimal (`{s, e, d}`) — tanto na resposta HTTP quanto no payload
 * de auditoria, que percorre objetos campo a campo.
 */
const comoNumero = (valor) => (valor === null || valor === undefined ? null : Number(valor));

/**
 * Registro do banco → objeto do contrato HTTP.
 *
 * `cliente_id` **não** sai daqui. Ele é contexto da sessão, não dado do
 * registro: quem chamou já sabe qual é o seu tenant, e devolvê-lo em cada item
 * só treinaria o frontend a lê-lo de uma resposta em vez da sessão — o começo
 * do caminho de volta para tenant vindo do payload.
 *
 * @param {Record<string, unknown>} registro
 */
export const comoSetorPublico = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  numero_setor: registro.numero_setor,
  nome: registro.nome,
  sigla: registro.sigla ?? null,
  tipo: registro.tipo,
  responsavel: registro.responsavel ?? null,
  telefone: registro.telefone ?? null,
  endereco: registro.endereco ?? null,
  cidade: registro.cidade ?? null,
  estado: registro.estado ?? null,
  area_total: comoNumero(registro.area_total),
  capacidade_animais: registro.capacidade_animais ?? null,
  observacoes: registro.observacoes ?? null,
  ativo: registro.ativo,
  created_date: registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date: registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

/**
 * Campos de negócio aceitos numa escrita, com o tratamento de cada um.
 *
 * Mapa literal em vez de spread da entrada: o que não está aqui não é gravado,
 * mesmo que o schema da rota um dia deixe passar. `numero_setor`, `id` e
 * `cliente_id` não aparecem de propósito — os três são atribuídos pelo servidor.
 */
const CAMPOS_EDITAVEIS = Object.freeze({
  empresa_id: (v) => textoOuNulo(v),
  nome: (v) => textoOuNulo(v),
  sigla: (v) => textoOuNulo(v),
  tipo: (v) => textoOuNulo(v),
  responsavel: (v) => textoOuNulo(v),
  telefone: (v) => textoOuNulo(v),
  endereco: (v) => textoOuNulo(v),
  cidade: (v) => textoOuNulo(v),
  estado: (v) => textoOuNulo(v),
  observacoes: (v) => textoOuNulo(v),
  area_total: (v) => (v === null || v === undefined ? null : v),
  capacidade_animais: (v) => (v === null || v === undefined ? null : v),
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
 * Lista os setores do tenant autenticado.
 *
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarSetores(auth.clienteId);
  return registros.map(comoSetorPublico);
};

/**
 * Cria um setor.
 *
 * Tudo numa transação só: reserva do número, gravação e auditoria. Se a
 * auditoria falhar, a linha não fica — é o que o contrato quer dizer com
 * "falha crítica de auditoria é observável, nunca silenciosa". O inverso
 * — gravar e perder o rastro — seria um registro que ninguém sabe de onde veio.
 *
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  const criado = await prisma.$transaction(async (tx) => {
    const numero = await reservarNumero(tx, {
      clienteId: auth.clienteId,
      entidade: ENTIDADE_SEQUENCIA,
      escopoTipo: escopoDaNumeracao(),
    });

    const registro = await inserirSetor(tx, {
      ...camposDe(entrada),
      cliente_id: auth.clienteId,
      numero_setor: String(numero),
    });

    const publico = comoSetorPublico(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'create',
        entidade: 'Setor',
        entidadeId: registro.id,
        dadosNovos: publico,
      },
      tx
    );

    return publico;
  });

  return criado;
};

/**
 * Atualiza um setor do tenant.
 *
 * A leitura anterior acontece **dentro** da transação e pelo unique composto
 * `[cliente_id, id]`: é ela que transforma "id de outro cliente" em "não
 * existe", e é dela que sai o `dados_anteriores` da auditoria.
 *
 * O código é `SETOR_NOT_FOUND`, não `TENANT_SCOPE_VIOLATION`. Os dois
 * descreveriam o caso do id alheio, mas o 403 **confirma** que o registro
 * existe em outro tenant — devolve informação sobre dado que o chamador não
 * pode ver. E `ATTACHMENT_OWNER_INVALID`, apesar de ser o 404 do contrato, fala
 * de anexo: usá-lo aqui só para evitar criar um código próprio tornaria o
 * vocabulário mentiroso.
 *
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {Record<string, unknown>} entrada
 */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const anterior = await buscarSetor(auth.clienteId, id, tx);
    if (!anterior) throw setorNotFound();

    const campos = camposDe(entrada);
    const registro = Object.keys(campos).length
      ? await atualizarSetorPorId(tx, auth.clienteId, id, campos)
      : anterior;

    const publico = comoSetorPublico(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'Setor',
        entidadeId: id,
        dadosAnteriores: comoSetorPublico(anterior),
        dadosNovos: publico,
      },
      tx
    );

    return publico;
  });
};
