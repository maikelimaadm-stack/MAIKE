/**
 * Serviço de AreaPastagem (P4.2, D-PROD-31).
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
 * ─── Ocupação (G4) ─────────────────────────────────────────────────────────
 *
 * `quantidade_atual` e `status_ocupacao` gravados nunca eram atualizados pelos
 * manejos (área com lote ativo seguia "Disponível"/0). Agora os dois são
 * DERIVADOS NA LEITURA, do mesmo gado que o Mapa Geral mostra na área
 * (`gadoPorArea`), numa consulta agregada por tenant. O valor gravado só
 * desempata quando há gado mas não há como medir a lotação.
 *
 * ─── Renomeação e troca de setor (G4) ──────────────────────────────────────
 *
 * Renomear a área reescreve, na MESMA transação, as cópias do nome casadas por
 * id (`DEPENDENTES_NOME_AREA` e as listas paralelas de cocho/bebedouro). Mudar
 * a área de setor leva junto o `setor_nome` das tarefas dela que seguiam o
 * setor da área.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT, resolverEscopoId } from '../sequencias/entidadeCodigoService.js';
import { garantirLinhaDaSequencia } from '../sequencias/entidadeCodigoRepository.js';
import { AppError, areaNotFound, setorNotFound } from '../../shared/errors/AppError.js';
import { buscarSetor } from '../setores/setorRepository.js';
import { DEPENDENTES_NOME_AREA, LISTAS_NOME_AREA } from '../referencias/propagationRules.js';
import {
  OPCOES_TRANSACAO,
  propagarDependentes,
  propagarNomeEmListas,
  juntarPropagacoes,
  registrarPropagacao,
} from '../referencias/syncEntityReferencesService.js';
import {
  listarAreas,
  buscarArea,
  inserirArea,
  atualizarAreaPorId,
  gadoPorArea,
  travarAreasPorIds,
  areasComCodigos,
  liberarCodigos,
  alinharSequenciaAoMaiorCodigo,
  propagarSetorDaAreaParaTarefas,
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

/** 1 UA = 450 kg de peso vivo — o mesmo divisor do Mapa Geral (mapaGeralDerivados). */
const KG_POR_UA = 450;

/** Enum de `status_ocupacao` (areaPastagemRoutes `OCUPACOES`). */
const OCUPACAO_DISPONIVEL = 'Disponível';
const OCUPACOES_COM_GADO = Object.freeze(['Médio', 'Alto', 'Sobrepastoreado']);

/**
 * Ocupação derivada do gado na área (G4) — a mesma regra do Mapa Geral
 * (`statusOcupacaoDaArea` em src/domain/mapa/mapaGeralDerivados.js):
 *
 *  - sem cabeças: "Disponível" (o enum não tem estado manual — descanso,
 *    manutenção — que devesse sobreviver sem gado);
 *  - com cabeças, capacidade (UA) e peso: UA / capacidade — até 70% "Médio",
 *    até 110% "Alto", acima "Sobrepastoreado";
 *  - com cabeças sem como medir: o valor gravado, se já for de área ocupada;
 *    senão "Médio".
 *
 * @param {{capacidade_maxima: unknown, status_ocupacao: unknown}} area
 * @param {{cabecas: number, kg: number} | undefined} gado
 * @returns {{quantidade_atual: number, status_ocupacao: string}}
 */
export const derivarOcupacao = (area, gado) => {
  const cabecas = Math.max(0, Math.round(Number(gado?.cabecas) || 0));
  if (cabecas <= 0) return { quantidade_atual: 0, status_ocupacao: OCUPACAO_DISPONIVEL };
  const ua = (Number(gado?.kg) || 0) / KG_POR_UA;
  const capacidade = Number(area?.capacidade_maxima) || 0;
  if (capacidade > 0 && ua > 0) {
    const pct = (ua / capacidade) * 100;
    const status = pct <= 70 ? 'Médio' : pct <= 110 ? 'Alto' : 'Sobrepastoreado';
    return { quantidade_atual: cabecas, status_ocupacao: status };
  }
  const gravado = typeof area?.status_ocupacao === 'string' ? area.status_ocupacao : '';
  return { quantidade_atual: cabecas, status_ocupacao: OCUPACOES_COM_GADO.includes(gravado) ? gravado : 'Médio' };
};

/**
 * Áreas públicas com a ocupação derivada (uma consulta agregada, sem N+1).
 *
 * @param {string} clienteId
 * @param {Record<string, any>[]} publicas
 * @param {{todas?: boolean, tx?: import('@prisma/client').Prisma.TransactionClient}} [opcoes]
 */
const comOcupacao = async (clienteId, publicas, { todas = false, tx } = {}) => {
  const gado = await gadoPorArea(clienteId, { areaIds: todas ? null : publicas.map((a) => a.id), tx });
  return publicas.map((a) => ({ ...a, ...derivarOcupacao(a, gado.get(a.id)) }));
};

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
  return comOcupacao(auth.clienteId, registros.map(comoAreaPublica), { todas: true });
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

    const [comGado] = await comOcupacao(auth.clienteId, [publico], { tx });
    return comGado;
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

    await propagarMudancasDaArea(contexto, tx, auth.clienteId, anterior, registro);

    const [comGado] = await comOcupacao(auth.clienteId, [publico], { tx });
    return comGado;
  }, OPCOES_TRANSACAO);
};

/**
 * Cópias do nome e do setor da área nos registros que a citam (G4), na
 * transação do PATCH. Comparação contra o valor anterior do banco: PATCH que
 * reenvia o mesmo nome não varre nada. Tudo casado por id, no tenant do
 * auth_context e na empresa da área; um evento-resumo na auditoria.
 *
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {Record<string, any>} anterior
 * @param {Record<string, any>} registro
 */
const propagarMudancasDaArea = async (contexto, tx, clienteId, anterior, registro) => {
  const resultados = [];
  const escopo = { clienteId, empresaId: String(registro.empresa_id), id: String(registro.id) };

  if (registro.nome !== anterior.nome) {
    resultados.push(await propagarDependentes(tx, escopo, DEPENDENTES_NOME_AREA, registro));
    resultados.push(await propagarNomeEmListas(tx, escopo, LISTAS_NOME_AREA, String(registro.nome)));
  }

  if (registro.setor_id !== anterior.setor_id && registro.setor_nome !== anterior.setor_nome) {
    const tarefas = await propagarSetorDaAreaParaTarefas(tx, clienteId, {
      areaId: escopo.id,
      setorNomeAnterior: anterior.setor_nome,
      setorNomeNovo: registro.setor_nome,
    });
    if (tarefas.length) {
      resultados.push({
        porTabela: { LancamentoTarefa: tarefas.length },
        ids: { LancamentoTarefa: tarefas },
        valores: { 'LancamentoTarefa.setor_nome': registro.setor_nome },
      });
    }
  }

  if (!resultados.length) return;
  await registrarPropagacao(contexto, 'AreaPastagem', escopo.id, juntarPropagacoes(...resultados), tx);
};

/** Erro 400 de renumeração, com mensagem em português para a tela. */
const renumeracaoInvalida = (mensagem, details) =>
  new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details: { field: 'numero_area', ...details } });

/**
 * Reatribui `numero_area` de uma ou várias áreas do tenant (G4), numa
 * transação só.
 *
 * O código continua sendo do servidor no PATCH genérico (que o recusa com 400):
 * esta é a operação própria e explícita de renumerar. Ela:
 *
 *  - trava as áreas pedidas e recusa id que não é deste tenant (404);
 *  - recusa código repetido na própria lista e código que já pertence a uma
 *    área FORA da lista (o unique `[cliente_id, numero_area]` vale para o
 *    tenant inteiro, inativas incluídas) — 400 com o código e a área;
 *  - aceita trocas entre as áreas da lista (1↔2) sem colisão intermediária:
 *    primeiro libera os códigos com um valor temporário por área, depois grava
 *    os definitivos;
 *  - mantém a sequência à frente do maior código numérico, para a próxima
 *    criação não colidir;
 *  - audita cada área alterada.
 *
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{itens: Array<{id: string, numero_area: string}>}} entrada
 */
export const renumerar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const itens = (Array.isArray(entrada?.itens) ? entrada.itens : []).map((item) => ({
    id: String(item?.id ?? '').trim(),
    numero: String(item?.numero_area ?? '').trim(),
  }));
  if (!itens.length) throw renumeracaoInvalida('informe ao menos uma área para renumerar', { reason: 'lista_vazia' });

  const ids = itens.map((i) => i.id);
  const repetidoId = ids.find((id, i) => ids.indexOf(id) !== i);
  if (repetidoId) throw renumeracaoInvalida('a mesma área aparece mais de uma vez na renumeração', { reason: 'area_repetida', id: repetidoId });
  for (const item of itens) {
    if (!item.numero) throw renumeracaoInvalida('o código da área não pode ficar vazio', { reason: 'codigo_vazio', id: item.id });
    if (item.numero.startsWith('#')) throw renumeracaoInvalida('o código da área não pode começar com #', { reason: 'codigo_reservado', id: item.id });
  }
  const numeros = itens.map((i) => i.numero);
  const repetidoNumero = numeros.find((n, i) => numeros.indexOf(n) !== i);
  if (repetidoNumero) {
    throw renumeracaoInvalida(`o código ${repetidoNumero} foi pedido para mais de uma área`, { reason: 'codigo_repetido', codigo: repetidoNumero });
  }

  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const atuais = await travarAreasPorIds(tx, auth.clienteId, ids);
    const porId = new Map(atuais.map((a) => [a.id, a]));
    const ausente = ids.find((id) => !porId.has(id));
    if (ausente) throw areaNotFound(undefined, { details: { id: ausente } });

    const ocupados = await areasComCodigos(tx, auth.clienteId, numeros, ids);
    if (ocupados.length) {
      const primeiro = ocupados[0];
      throw renumeracaoInvalida(
        `o código ${primeiro.numero_area} já pertence à área ${primeiro.nome}${primeiro.ativo ? '' : ' (inativa)'}, que não está na renumeração`,
        { reason: 'codigo_em_uso', codigos: ocupados.map((a) => a.numero_area) }
      );
    }

    const mudam = itens.filter((item) => porId.get(item.id).numero_area !== item.numero);
    if (mudam.length) {
      await liberarCodigos(tx, auth.clienteId, mudam.map((i) => i.id));
      for (const item of mudam) {
        const anterior = porId.get(item.id);
        const registro = await atualizarAreaPorId(tx, auth.clienteId, item.id, { numero_area: item.numero });
        porId.set(item.id, registro);
        await registrarEvento(
          contexto,
          {
            acao: 'update',
            entidade: 'AreaPastagem',
            entidadeId: item.id,
            dadosAnteriores: comoAreaPublica(anterior),
            dadosNovos: comoAreaPublica(registro),
          },
          tx
        );
      }
      const chave = {
        clienteId: auth.clienteId,
        entidade: ENTIDADE_SEQUENCIA,
        escopoTipo: escopoDaNumeracao(),
        escopoId: resolverEscopoId({ clienteId: auth.clienteId, escopoTipo: escopoDaNumeracao() }),
      };
      await garantirLinhaDaSequencia(tx, chave);
      await alinharSequenciaAoMaiorCodigo(tx, chave);
    }

    const publicas = ids.map((id) => comoAreaPublica(porId.get(id)));
    return { itens: await comOcupacao(auth.clienteId, publicas, { tx }) };
  }, OPCOES_TRANSACAO);
};
