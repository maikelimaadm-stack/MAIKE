/**
 * Serviço do Cadastro de Culturas (D-PROD-215), tabela física "CADCULTURAS".
 *
 * Uma cultura é o que está plantado num pasto ou numa área (PASTAGEM,
 * CAPINEIRA, LAVOURA ou SILAGEM), com um código de numeração da fazenda
 * ("001", "002"…), o nome, a espécie e a cultivar, e as alturas de referência
 * de pastejo (entrada e saída, em cm). Primeira fatia, SEM vínculo: nada lê as
 * culturas ainda (a Área continua com o texto de antes).
 *
 * Regras:
 *  - tenant só de `auth_context` (R11); a fazenda vem do corpo/query e precisa
 *    ser DESTE tenant (`exigirEmpresaDoTenant`: outra ou inexistente → 404);
 *  - nome em MAIÚSCULAS, único por fazenda (409 `CULTURA_NAME_CONFLICT`);
 *  - código único por fazenda (409 `CULTURA_CODIGO_CONFLICT`); sem código na
 *    criação, o serviço dá o próximo número de 3 dígitos ("012");
 *  - `tipo` ∈ PASTAGEM | CAPINEIRA | LAVOURA | SILAGEM (o banco tem CHECK);
 *  - alturas em cm, > 0, até 1 casa, pt-BR ("25,5"); com as duas, a de saída é
 *    menor que a de entrada (400 `altura_saida_maior_ou_igual`; o banco tem CHECK);
 *  - a lista de referência (Marandu, Mombaça…) entra por comando idempotente:
 *    o que já existe pelo NOME não é recriado; um código já ocupado por outra
 *    cultura faz a de referência ganhar o próximo número livre;
 *  - escritas da fazenda sob trava do escopo (tenant + fazenda), até o fim da
 *    transação;
 *  - exclusão física com auditoria (nada referencia CADCULTURAS nesta fatia).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { culturaNotFound, culturaNomeConflito, culturaCodigoConflito } from '../../shared/errors/AppError.js';
import { exigirEmpresaDoTenant, invalido, textoDoCorpo, travarEscopo, ehViolacaoDeUnique } from '../gestao/gestaoComum.js';
import {
  listarCulturas,
  buscarCultura,
  existeCulturaCom,
  codigosDaFazenda,
  inserirCultura,
  atualizarCulturaPorId,
  excluirCulturaPorId,
} from './culturaRepository.js';

export const TIPOS_CULTURA = Object.freeze(['PASTAGEM', 'CAPINEIRA', 'LAVOURA', 'SILAGEM']);

/** Altura máxima aceita, em cm (capineira alta cabe com folga). */
export const ALTURA_MAXIMA_CM = 1000;

const ENTIDADE = 'Cultura';
/** Largura das colunas VARCHAR (em caracteres, como o PostgreSQL conta). */
const LARGURA = Object.freeze({ codigo: 16, nome: 120, especie: 120, cultivar: 120, observacoes: 2000 });

const OBS_REFERENCIA = 'Valor de referência (manejo rotacionado). Ajuste para a fazenda.';

/**
 * Lista de referência (manejo rotacionado; Embrapa), ajustável pela fazenda.
 * Alturas em cm: [entrada, saída].
 */
export const LISTA_REFERENCIA = Object.freeze([
  { codigo: '001', nome: 'BRACHIARIA BRIZANTHA CV. MARANDU', especie: 'Urochloa brizantha', cultivar: 'Marandu', entrada: 25, saida: 15 },
  { codigo: '002', nome: 'BRACHIARIA BRIZANTHA CV. XARAÉS', especie: 'Urochloa brizantha', cultivar: 'Xaraés', entrada: 30, saida: 15 },
  { codigo: '003', nome: 'BRACHIARIA BRIZANTHA CV. PIATÃ', especie: 'Urochloa brizantha', cultivar: 'Piatã', entrada: 35, saida: 20 },
  { codigo: '004', nome: 'BRACHIARIA BRIZANTHA CV. PAIAGUÁS', especie: 'Urochloa brizantha', cultivar: 'Paiaguás', entrada: 30, saida: 15 },
  { codigo: '005', nome: 'BRACHIARIA DECUMBENS', especie: 'Urochloa decumbens', cultivar: 'Basilisk', entrada: 20, saida: 10 },
  { codigo: '006', nome: 'BRACHIARIA HUMIDICOLA', especie: 'Urochloa humidicola', cultivar: null, entrada: 20, saida: 10 },
  { codigo: '007', nome: 'PANICUM CV. MOMBAÇA', especie: 'Megathyrsus maximus', cultivar: 'Mombaça', entrada: 90, saida: 45 },
  { codigo: '008', nome: 'PANICUM CV. TANZÂNIA', especie: 'Megathyrsus maximus', cultivar: 'Tanzânia', entrada: 70, saida: 35 },
  { codigo: '009', nome: 'PANICUM CV. ZURI', especie: 'Megathyrsus maximus', cultivar: 'Zuri', entrada: 75, saida: 35 },
  { codigo: '010', nome: 'PANICUM CV. MASSAI', especie: 'Megathyrsus maximus', cultivar: 'Massai', entrada: 55, saida: 25 },
  { codigo: '011', nome: 'TIFTON 85', especie: 'Cynodon spp.', cultivar: 'Tifton 85', entrada: 25, saida: 10 },
].map((item) => Object.freeze({ ...item, tipo: 'PASTAGEM', observacoes: OBS_REFERENCIA })));

/** @param {unknown} valor */
const decimalPublico = (valor) => (valor === null || valor === undefined ? null : Number(valor));

/** @param {Record<string, unknown>} registro */
export const comoCulturaPublica = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  codigo: registro.codigo,
  tipo: registro.tipo,
  nome: registro.nome,
  especie: registro.especie ?? null,
  cultivar: registro.cultivar ?? null,
  altura_entrada_cm: decimalPublico(registro.altura_entrada_cm),
  altura_saida_cm: decimalPublico(registro.altura_saida_cm),
  observacoes: registro.observacoes ?? null,
  ativo: registro.ativo,
  created_date: registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date: registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

/**
 * O schema da rota limita o texto ANTES das maiúsculas; algumas letras crescem
 * ao subir ('ß' → 'SS'). Confere de novo depois de normalizar.
 * @param {string|null|undefined} valor
 * @param {keyof typeof LARGURA} campo
 */
const caberNaColuna = (valor, campo) => {
  if (typeof valor === 'string' && [...valor].length > LARGURA[campo]) {
    throw invalido(`${campo} passa de ${LARGURA[campo]} caracteres depois de convertido para maiúsculas`, {
      field: campo,
      reason: 'tamanho_excedido',
    });
  }
  return valor;
};

/** @param {unknown} valor */
const tipoDoCorpo = (valor) => {
  if (valor === undefined) return undefined;
  if (typeof valor !== 'string' || !TIPOS_CULTURA.includes(valor)) {
    throw invalido(`tipo deve ser um de: ${TIPOS_CULTURA.join(', ')}`, { field: 'tipo', reason: 'tipo_invalido' });
  }
  return valor;
};

/** @param {unknown} valor */
const codigoDoCorpo = (valor) => {
  const texto = caberNaColuna(textoDoCorpo(valor, 'codigo', { maiusculas: true }), 'codigo');
  if (texto === undefined || texto === null) return texto;
  if (!/^[0-9A-Z][0-9A-Z.-]*$/.test(texto)) {
    throw invalido('codigo aceita só letras, números, ponto e hífen', { field: 'codigo', reason: 'codigo_invalido' });
  }
  return texto;
};

/**
 * Altura em cm: número ou texto pt-BR ("25", "25,5", "25.5"); > 0, até
 * ALTURA_MAXIMA_CM, 1 casa decimal. Vazio/null = sem altura.
 * @param {unknown} valor
 * @param {'altura_entrada_cm'|'altura_saida_cm'} campo
 * @returns {string|null|undefined}
 */
export const alturaDoCorpo = (valor, campo) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  let numero;
  if (typeof valor === 'number') numero = valor;
  else if (typeof valor === 'string' && /^\s*\d+([.,]\d+)?\s*$/.test(valor)) numero = Number(valor.trim().replace(',', '.'));
  else throw invalido(`${campo} deve ser um número em cm`, { field: campo, reason: 'altura_invalida' });
  if (!Number.isFinite(numero) || numero <= 0 || numero > ALTURA_MAXIMA_CM) {
    throw invalido(`${campo} deve ser maior que 0 e no máximo ${ALTURA_MAXIMA_CM} cm`, { field: campo, reason: 'altura_fora_da_faixa' });
  }
  const inteiro = Math.round(numero * 10);
  if (Math.abs(numero * 10 - inteiro) > 1e-6) {
    throw invalido(`${campo} aceita no máximo 1 casa decimal`, { field: campo, reason: 'altura_casas_decimais' });
  }
  return (inteiro / 10).toFixed(1);
};

/**
 * Campos editáveis do corpo, já normalizados. `empresa_id` NÃO está aqui: é o
 * escopo, conferido à parte e nunca alterado por PATCH.
 * @param {Record<string, unknown>} entrada
 */
const camposDe = (entrada) => {
  /** @type {Record<string, unknown>} */
  const campos = {};
  const nome = caberNaColuna(textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true, maiusculas: true }), 'nome');
  if (nome !== undefined) campos.nome = nome;
  const codigo = codigoDoCorpo(entrada.codigo);
  if (codigo !== undefined) campos.codigo = codigo;
  const tipo = tipoDoCorpo(entrada.tipo);
  if (tipo !== undefined) campos.tipo = tipo;
  for (const campo of /** @type {const} */ (['especie', 'cultivar'])) {
    const texto = caberNaColuna(textoDoCorpo(entrada[campo], campo), campo);
    if (texto !== undefined) campos[campo] = texto;
  }
  for (const campo of /** @type {const} */ (['altura_entrada_cm', 'altura_saida_cm'])) {
    const altura = alturaDoCorpo(entrada[campo], campo);
    if (altura !== undefined) campos[campo] = altura;
  }
  const observacoes = caberNaColuna(textoDoCorpo(entrada.observacoes, 'observacoes'), 'observacoes');
  if (observacoes !== undefined) campos.observacoes = observacoes;
  if (entrada.ativo !== undefined) campos.ativo = Boolean(entrada.ativo);
  return campos;
};

/**
 * Com as duas alturas, a de saída é menor que a de entrada.
 * @param {unknown} entrada
 * @param {unknown} saida
 */
const exigirAlturasCoerentes = (entrada, saida) => {
  if (entrada === null || entrada === undefined || saida === null || saida === undefined) return;
  if (Number(saida) >= Number(entrada)) {
    throw invalido('altura_saida_cm deve ser menor que altura_entrada_cm', {
      field: 'altura_saida_cm',
      reason: 'altura_saida_maior_ou_igual',
    });
  }
};

/**
 * Próximo número livre de 3 dígitos ("012"), depois do maior código numérico da fazenda.
 * @param {string[]} usados
 */
export const proximoCodigo = (usados) => {
  const ocupados = new Set(usados);
  const numeros = usados.filter((c) => /^\d+$/.test(c)).map(Number);
  let n = (numeros.length ? Math.max(...numeros) : 0) + 1;
  while (ocupados.has(String(n).padStart(3, '0'))) n += 1;
  return String(n).padStart(3, '0');
};

/** Trava das escritas de culturas de UMA fazenda (tenant + empresa). */
const travarFazenda = (tx, clienteId, empresaId) => travarEscopo(tx, `culturas:${clienteId}:${empresaId}`);

/**
 * @template T
 * @param {() => Promise<T>} executar
 * @returns {Promise<T>}
 */
const comConflitoEstavel = async (executar) => {
  try {
    return await executar();
  } catch (erro) {
    // Corrida perdida contra um unique (código ou nome): 409, nunca 500.
    if (ehViolacaoDeUnique(erro)) {
      const alvo = JSON.stringify(/** @type {any} */ (erro)?.meta ?? '');
      throw alvo.includes('codigo') ? culturaCodigoConflito() : culturaNomeConflito();
    }
    throw erro;
  }
};

/**
 * @typedef {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} Contexto
 */

/**
 * @param {Contexto} contexto
 * @param {{ empresa_id?: unknown }} consulta
 */
export const listar = async (contexto, consulta) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, consulta?.empresa_id);
  const registros = await listarCulturas(auth.clienteId, empresaId);
  return registros.map(comoCulturaPublica);
};

/**
 * @param {Contexto} contexto
 * @param {string} id
 * @param {{ empresa_id?: unknown }} consulta
 */
export const obter = async (contexto, id, consulta) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, consulta?.empresa_id);
  const registro = await buscarCultura(auth.clienteId, empresaId, id);
  if (!registro) throw culturaNotFound();
  return comoCulturaPublica(registro);
};

/**
 * @param {Contexto} contexto
 * @param {Record<string, unknown>} entrada
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);
  if (!campos.tipo) throw invalido('tipo é obrigatório', { field: 'tipo' });
  exigirAlturasCoerentes(campos.altura_entrada_cm, campos.altura_saida_cm);
  const ativo = campos.ativo === undefined ? true : Boolean(campos.ativo);

  return comConflitoEstavel(() =>
    prisma.$transaction(async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
      await travarFazenda(tx, auth.clienteId, empresaId);

      const codigo = campos.codigo || proximoCodigo(await codigosDaFazenda(tx, auth.clienteId, empresaId));
      if (await existeCulturaCom(tx, auth.clienteId, empresaId, 'codigo', String(codigo))) throw culturaCodigoConflito();
      if (await existeCulturaCom(tx, auth.clienteId, empresaId, 'nome', String(campos.nome))) throw culturaNomeConflito();

      const registro = await inserirCultura(tx, {
        ...campos,
        codigo,
        ativo,
        cliente_id: auth.clienteId,
        empresa_id: empresaId,
      });
      const publico = comoCulturaPublica(registro);
      await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: publico }, tx);
      return publico;
    })
  );
};

/**
 * @param {Contexto} contexto
 * @param {string} id
 * @param {Record<string, unknown>} entrada
 */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);
  if (entrada.codigo !== undefined && !campos.codigo) {
    throw invalido('codigo é obrigatório', { field: 'codigo' });
  }

  return comConflitoEstavel(() =>
    prisma.$transaction(async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
      await travarFazenda(tx, auth.clienteId, empresaId);

      const anterior = await buscarCultura(auth.clienteId, empresaId, id, tx);
      if (!anterior) throw culturaNotFound();

      exigirAlturasCoerentes(
        campos.altura_entrada_cm !== undefined ? campos.altura_entrada_cm : anterior.altura_entrada_cm,
        campos.altura_saida_cm !== undefined ? campos.altura_saida_cm : anterior.altura_saida_cm
      );
      if (campos.codigo !== undefined && campos.codigo !== anterior.codigo) {
        if (await existeCulturaCom(tx, auth.clienteId, empresaId, 'codigo', String(campos.codigo), id)) throw culturaCodigoConflito();
      }
      if (campos.nome !== undefined && campos.nome !== anterior.nome) {
        if (await existeCulturaCom(tx, auth.clienteId, empresaId, 'nome', String(campos.nome), id)) throw culturaNomeConflito();
      }

      const registro = Object.keys(campos).length ? await atualizarCulturaPorId(tx, auth.clienteId, id, campos) : anterior;
      const publico = comoCulturaPublica(registro);
      await registrarEvento(
        contexto,
        { acao: 'update', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: comoCulturaPublica(anterior), dadosNovos: publico },
        tx
      );
      return publico;
    })
  );
};

/**
 * Exclusão física: nesta fatia nada referencia CADCULTURAS (D-PROD-215). Quando a
 * Área passar a apontar para a cultura, a FK com RESTRICT barra a exclusão.
 * @param {Contexto} contexto
 * @param {string} id
 * @param {{ empresa_id?: unknown }} consulta
 */
export const excluir = async (contexto, id, consulta) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, consulta?.empresa_id);
    await travarFazenda(tx, auth.clienteId, empresaId);

    const anterior = await buscarCultura(auth.clienteId, empresaId, id, tx);
    if (!anterior) throw culturaNotFound();

    await excluirCulturaPorId(tx, auth.clienteId, id);
    await registrarEvento(contexto, { acao: 'delete', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: comoCulturaPublica(anterior) }, tx);
  });
};

/**
 * Inclui a lista de referência na fazenda, numa transação, sem duplicar:
 * cultura de referência cujo NOME já existe na fazenda é pulada; código já usado
 * por outra cultura → a de referência ganha o próximo número livre.
 * @param {Contexto} contexto
 * @param {{ empresa_id?: unknown }} entrada
 * @returns {Promise<{ criadas: number, ja_existiam: number, culturas: ReturnType<typeof comoCulturaPublica>[] }>}
 */
export const incluirListaReferencia = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return comConflitoEstavel(() =>
    prisma.$transaction(async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada?.empresa_id);
      await travarFazenda(tx, auth.clienteId, empresaId);

      const existentes = await listarCulturas(auth.clienteId, empresaId, tx);
      const nomes = new Set(existentes.map((c) => c.nome));
      const codigos = existentes.map((c) => c.codigo);
      let criadas = 0;
      let jaExistiam = 0;
      for (const ref of LISTA_REFERENCIA) {
        if (nomes.has(ref.nome)) {
          jaExistiam += 1;
          continue;
        }
        const codigo = codigos.includes(ref.codigo) ? proximoCodigo(codigos) : ref.codigo;
        const registro = await inserirCultura(tx, {
          cliente_id: auth.clienteId,
          empresa_id: empresaId,
          codigo,
          tipo: ref.tipo,
          nome: ref.nome,
          especie: ref.especie,
          cultivar: ref.cultivar,
          altura_entrada_cm: ref.entrada.toFixed(1),
          altura_saida_cm: ref.saida.toFixed(1),
          observacoes: ref.observacoes,
          ativo: true,
        });
        codigos.push(codigo);
        nomes.add(ref.nome);
        criadas += 1;
        await registrarEvento(
          contexto,
          { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: { ...comoCulturaPublica(registro), origem: 'lista_referencia' } },
          tx
        );
      }
      const culturas = (await listarCulturas(auth.clienteId, empresaId, tx)).map(comoCulturaPublica);
      return { criadas, ja_existiam: jaExistiam, culturas };
    })
  );
};
