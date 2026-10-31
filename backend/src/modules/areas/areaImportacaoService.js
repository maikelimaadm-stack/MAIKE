/**
 * Importação de áreas por arquivo KML/GeoJSON (D-PROD-90).
 *
 * Duas operações, com a MESMA validação:
 *
 *   conferir   lê o banco e devolve, item a item, o que impede a gravação.
 *              Não escreve nada — nem número de sequência, nem auditoria;
 *   importar   repete a conferência dentro de UMA transação e grava todas as
 *              áreas ou nenhuma. Um item reprovado no momento da gravação
 *              (setor desativado, área igual cadastrada por outra pessoa entre
 *              a prévia e o clique) desfaz o lote inteiro com 422 e o motivo
 *              por item.
 *
 * Retentativa: `operation_id` vai para `OperacaoIdempotente`. O mesmo pedido
 * reenviado (rede caiu depois do commit) devolve a resposta gravada em vez de
 * criar as áreas de novo. A trava `pg_advisory_xact_lock` por empresa fecha a
 * janela de duas importações simultâneas com as mesmas áreas passarem na
 * checagem de duplicidade ao mesmo tempo.
 *
 * Tenant e empresa: o tenant vem SÓ do `auth_context`; a empresa do corpo
 * precisa existir neste tenant, e cada setor precisa ser deste tenant, desta
 * empresa e estar ativo. `numero_area` e `setor_nome` continuam do servidor
 * (sequência e linha do setor), exatamente como na criação manual.
 *
 * O que NÃO acontece aqui: nenhuma atualização de área existente, nenhum lote,
 * movimentação, saldo, ponto ou linha.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { registrarEventosEmLote } from '../auditoria/auditService.js';
import { buscarRegistro as buscarEmpresa } from '../empresas/empresaRepository.js';
import { reservarNumeros } from '../sequencias/entidadeCodigoService.js';
import { inserirAreasEmLote } from './areaPastagemRepository.js';
import { comoAreaPublica, ENTIDADE_SEQUENCIA, escopoDaNumeracao } from './areaPastagemService.js';
import { chaveCanonicaDoContorno, nomeComparavel, validarAnel } from './areaImportacaoGeometria.js';
import { pendenciasDeCampos, textoLimpo } from './areaImportacaoRegras.js';

/** Limites do lote. Ver D-PROD-90: atomicidade real só dentro deles. */
export const LIMITES_IMPORTACAO = Object.freeze({
  maxItens: 100,
  maxVerticesPorArea: 5000,
  maxVerticesTotal: 50000,
});

export { TIPOS_USO, TIPOS_CULTURA, TIPOS_INFRAESTRUTURA, CORES_DA_PALETA, COR_PADRAO } from './areaImportacaoRegras.js';

const TIPO_OPERACAO = 'importacao_areas';
/** A importação grava até 100 áreas; o padrão de 5 s do Prisma não basta. */
const OPCOES_TRANSACAO = Object.freeze({ maxWait: 10000, timeout: 60000 });

const arredondar2 = (valor) => Math.round(valor * 100) / 100;


/**
 * @typedef {{campo: string, codigo: string, mensagem: string}} Pendencia
 * @typedef {{
 *   ref: string, nome?: string|null, sigla?: string|null, setor_id?: string|null,
 *   tipo_cultura?: string|null, tipo_pastagem?: string|null, area_pastejada?: number|null,
 *   aproveitamento_classificacao?: string|null, cor?: string|null, coords: unknown[]
 * }} ItemImportacao
 */

/** Limites que tornam o pedido inteiro inválido (não é pendência de linha). */
const exigirLimites = (itens) => {
  if (itens.length > LIMITES_IMPORTACAO.maxItens) {
    throw new AppError('AREA_IMPORT_LIMIT_EXCEEDED', `No máximo ${LIMITES_IMPORTACAO.maxItens} áreas por importação`, {
      details: { field: 'itens', reason: 'max_itens', limite: LIMITES_IMPORTACAO.maxItens },
    });
  }
  let total = 0;
  const refs = new Set();
  for (const item of itens) {
    total += Array.isArray(item.coords) ? item.coords.length : 0;
    if (refs.has(item.ref)) {
      throw new AppError('REQUEST_VALIDATION_FAILED', 'ref repetida no pedido', {
        details: { field: 'itens.ref', reason: 'duplicate' },
      });
    }
    refs.add(item.ref);
  }
  if (total > LIMITES_IMPORTACAO.maxVerticesTotal) {
    throw new AppError('AREA_IMPORT_LIMIT_EXCEEDED', 'Vértices demais nesta importação', {
      details: { field: 'itens.coords', reason: 'max_vertices_total', limite: LIMITES_IMPORTACAO.maxVerticesTotal },
    });
  }
};

/**
 * Lê empresa, setores citados e áreas ativas da empresa (para duplicidade).
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
const carregarReferencias = async (db, clienteId, empresaId, itens) => {
  const empresa = await buscarEmpresa(clienteId, empresaId, /** @type {any} */ (db));
  if (!empresa) {
    throw new AppError('EMPRESA_NOT_FOUND', 'Empresa não encontrada neste tenant', {
      details: { field: 'empresa_id', reason: 'not_found' },
    });
  }
  const idsDeSetor = [...new Set(itens.map((i) => textoLimpo(i.setor_id)).filter(Boolean))];
  // Uma ida ao banco para todos os setores citados (D-PROD-90 R2): com o banco
  // longe da função, cada consulta custa ~100 ms.
  const linhasDeSetor = idsDeSetor.length
    ? await db.setor.findMany({
        where: { cliente_id: clienteId, id: { in: idsDeSetor } },
        select: { id: true, nome: true, empresa_id: true, ativo: true },
      })
    : [];
  /** @type {Map<string, any>} */
  const setores = new Map(linhasDeSetor.map((setor) => [setor.id, setor]));
  const existentes = await db.areaPastagem.findMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, ativo: true },
    select: { id: true, nome: true, setor_id: true, numero_area: true, coordenadas: true },
  });
  /** @type {Map<string, any>} */
  const porGeometria = new Map();
  /** @type {Map<string, any>} */
  const porNomeESetor = new Map();
  for (const area of existentes) {
    const coords = /** @type {any} */ (area.coordenadas)?.coords;
    const chave = chaveCanonicaDoContorno(coords);
    if (chave && !porGeometria.has(chave)) porGeometria.set(chave, area);
    porNomeESetor.set(`${area.setor_id}|${nomeComparavel(area.nome)}`, area);
  }
  return { setores, porGeometria, porNomeESetor };
};

/**
 * Valida um item contra as regras do cadastro manual e contra o banco.
 * Devolve as pendências e, quando não há nenhuma, o registro pronto.
 */
const validarItem = (item, empresaId, refs, vistosNoPedido) => {
  const geometria = validarAnel(item.coords);
  const totalHa = geometria.ok ? arredondar2(geometria.hectares) : null;
  const { pendencias, valores } = pendenciasDeCampos(item, totalHa);
  const { nome, sigla, uso, tipo, pastejada, aproveitamento, cor } = valores;

  const setorId = textoLimpo(item.setor_id);
  const setor = setorId ? refs.setores.get(setorId) : null;
  if (setorId && !setor) pendencias.push({ campo: 'setor_id', codigo: 'SETOR_INVALIDO', mensagem: 'Setor não encontrado.' });
  else if (setor && setor.empresa_id !== empresaId) {
    pendencias.push({ campo: 'setor_id', codigo: 'SETOR_DE_OUTRA_EMPRESA', mensagem: 'O setor não pertence a esta empresa.' });
  } else if (setor && setor.ativo === false) {
    pendencias.push({ campo: 'setor_id', codigo: 'SETOR_INATIVO', mensagem: 'O setor está inativo.' });
  }

  if ('codigo' in geometria) pendencias.push({ campo: 'coords', codigo: geometria.codigo, mensagem: geometria.mensagem });
  /** @type {Pendencia[]} */
  const avisos =
    geometria.ok && geometria.seCruza
      ? [
          {
            campo: 'coords',
            codigo: 'CONTORNO_SE_CRUZA',
            mensagem: 'O contorno se cruza ou passa duas vezes pelo mesmo ponto; importado como está no arquivo.',
          },
        ]
      : [];

  // Duplicidade: contra o banco (só áreas ativas desta empresa) e dentro do pedido.
  if (geometria.ok) {
    const chave = chaveCanonicaDoContorno(item.coords);
    const existente = chave ? refs.porGeometria.get(chave) : null;
    if (existente) {
      pendencias.push({
        campo: 'coords',
        codigo: 'AREA_DUPLICADA',
        mensagem: `Contorno idêntico ao da área ${existente.numero_area} (${existente.nome}) já cadastrada.`,
      });
    } else if (chave && vistosNoPedido.geometria.has(chave)) {
      pendencias.push({
        campo: 'coords',
        codigo: 'AREA_DUPLICADA_NO_ARQUIVO',
        mensagem: `Contorno idêntico ao do item ${vistosNoPedido.geometria.get(chave)} desta importação.`,
      });
    } else if (chave) {
      vistosNoPedido.geometria.set(chave, item.ref);
    }
  }
  if (nome && setor) {
    const chaveNome = `${setor.id}|${nomeComparavel(nome)}`;
    const existente = refs.porNomeESetor.get(chaveNome);
    if (existente) {
      pendencias.push({
        campo: 'nome',
        codigo: 'NOME_DUPLICADO_NO_SETOR',
        mensagem: `Já existe a área ${existente.numero_area} com este nome neste setor.`,
      });
    } else if (vistosNoPedido.nome.has(chaveNome)) {
      pendencias.push({
        campo: 'nome',
        codigo: 'NOME_DUPLICADO_NO_ARQUIVO',
        mensagem: `Mesmo nome e setor do item ${vistosNoPedido.nome.get(chaveNome)} desta importação.`,
      });
    } else {
      vistosNoPedido.nome.set(chaveNome, item.ref);
    }
  }

  if (pendencias.length > 0 || !geometria.ok || !setor) {
    return { ref: item.ref, ok: false, tamanho_hectares_geodesico: totalHa, pendencias, avisos };
  }

  const infraestrutura = uso === 'Infraestrutura';
  return {
    ref: item.ref,
    ok: true,
    tamanho_hectares_geodesico: totalHa,
    pendencias,
    avisos,
    registro: {
      empresa_id: empresaId,
      setor_id: setor.id,
      nome,
      sigla: sigla || null,
      // Mesma regra do formulário manual: infraestrutura grava 0 ha cadastrais;
      // o contorno continua íntegro em `coordenadas`.
      tamanho_hectares: infraestrutura ? 0 : totalHa,
      area_pastejada: infraestrutura ? 0 : pastejada,
      tipo_cultura: uso,
      tipo_pastagem: tipo || null,
      aproveitamento_classificacao: aproveitamento,
      cor,
      coordenadas: {
        coords: geometria.anel.map((v) => [v.lat, v.lng]),
        cor,
      },
      quantidade_atual: 0,
      status_ocupacao: 'Disponível',
      ativo: true,
    },
  };
};

const conferirItens = (empresaId, itens, refs) => {
  const vistos = { geometria: new Map(), nome: new Map() };
  return itens.map((item) => validarItem(item, empresaId, refs, vistos));
};

const resumoPublico = (resultados) => ({
  total: resultados.length,
  validas: resultados.filter((r) => r.ok).length,
  com_pendencia: resultados.filter((r) => !r.ok).length,
  itens: resultados.map(({ ref, ok, tamanho_hectares_geodesico, pendencias, avisos }) => ({
    ref,
    ok,
    tamanho_hectares_geodesico,
    pendencias,
    avisos,
  })),
});

/**
 * Conferência sem gravação.
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{empresa_id: string, itens: ItemImportacao[]}} entrada
 */
export const conferirImportacao = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const empresaId = textoLimpo(entrada.empresa_id);
  const itens = entrada.itens ?? [];
  exigirLimites(itens);
  const refs = await carregarReferencias(getPrismaClient(), auth.clienteId, empresaId, itens);
  return { empresa_id: empresaId, ...resumoPublico(conferirItens(empresaId, itens, refs)) };
};

/**
 * Importação atômica: todas as áreas do pedido ou nenhuma.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{operation_id: string, empresa_id: string, itens: ItemImportacao[]}} entrada
 */
export const importarAreas = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const empresaId = textoLimpo(entrada.empresa_id);
  const operationKey = textoLimpo(entrada.operation_id);
  const itens = entrada.itens ?? [];
  exigirLimites(itens);
  const fingerprint = fingerprintDePayload({ empresa_id: empresaId, itens });

  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const resultado = await executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey,
      tipoOperacao: TIPO_OPERACAO,
      fingerprint,
      executar: async () => {
        // Uma importação por empresa de cada vez: a checagem de duplicidade
        // abaixo só é confiável se ninguém gravar a mesma área no intervalo.
        await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${`areas-import:${auth.clienteId}:${empresaId}`}))) AS trava`;

        const refs = await carregarReferencias(tx, auth.clienteId, empresaId, itens);
        const resultados = conferirItens(empresaId, itens, refs);
        const reprovados = resultados.filter((r) => !r.ok);
        if (reprovados.length > 0) {
          throw new AppError('AREA_IMPORT_VALIDATION_FAILED', 'Há áreas com pendência; nada foi gravado', {
            details: { ...resumoPublico(resultados), gravadas: 0 },
          });
        }

        // Gravação em bloco (D-PROD-90 R2): número de idas ao banco fixo,
        // não proporcional às áreas — faixa de números, um INSERT com
        // RETURNING e uma auditoria em lote. Antes eram ~4 idas por área, e
        // com o banco a ~120 ms da função 100 áreas levavam ~50 s.
        const numeros = await reservarNumeros(
          tx,
          { clienteId: auth.clienteId, entidade: ENTIDADE_SEQUENCIA, escopoTipo: escopoDaNumeracao() },
          resultados.length
        );
        const refPorNumero = new Map();
        const linhas = resultados.map((r, i) => {
          const numero = String(numeros[i]);
          refPorNumero.set(numero, r.ref);
          return {
            ...r.registro,
            cliente_id: auth.clienteId,
            numero_area: numero,
            setor_nome: refs.setores.get(r.registro.setor_id).nome,
          };
        });
        const criadas = await inserirAreasEmLote(tx, linhas);
        if (criadas.length !== linhas.length) {
          throw new AppError('INTERNAL_ERROR', 'inserção em lote incompleta');
        }
        const publicas = criadas.map(comoAreaPublica);
        await registrarEventosEmLote(
          contexto,
          publicas.map((publico) => ({
            acao: 'create',
            entidade: 'AreaPastagem',
            entidadeId: publico.id,
            dadosNovos: { ...publico, origem: 'importacao_arquivo', operation_id: operationKey },
          })),
          tx
        );
        const ordem = new Map(resultados.map((r, i) => [r.ref, i]));
        const importadas = publicas
          .map((publico) => ({
            ref: refPorNumero.get(publico.numero_area),
            id: publico.id,
            numero_area: publico.numero_area,
            nome: publico.nome,
            setor_id: publico.setor_id,
            setor_nome: publico.setor_nome,
            tamanho_hectares: publico.tamanho_hectares,
          }))
          .sort((a, b) => ordem.get(a.ref) - ordem.get(b.ref));

        return {
          httpStatus: 201,
          body: { operation_id: operationKey, empresa_id: empresaId, gravadas: importadas.length, importadas },
        };
      },
    });
    return { ...resultado.body, replay: resultado.replay };
  }, OPCOES_TRANSACAO);
};
