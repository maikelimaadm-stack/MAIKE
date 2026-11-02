/**
 * Comando atômico de manejo do rebanho — R2B-P1 (D-PROD-101).
 *
 * Nascimento, Pesagem e Mudança de Categoria deixam de ser uma sequência de
 * POST/PATCH do navegador (uma por linha, uma por lote). UMA confirmação da
 * tela é UMA transação PostgreSQL e UM movimento agregado, cancelável como
 * unidade:
 *   1. idempotência por (cliente, operation_id, `manejo_mapa_rebanho`) +
 *      fingerprint do conteúdo normalizado;
 *   2. empresa do tenant; trava `FOR UPDATE` da ÁREA (serializa manejos da
 *      mesma área: dois nascimentos simultâneos não criam dois lotes de
 *      filhotes) e depois dos lotes, em ordem de id;
 *   3. o SERVIDOR relê saldo, categoria, sexo e peso e calcula o pós-estado de
 *      cada lote — nada que o navegador diga sobre cabeças é verdade;
 *   4. cada lote alterado é gravado UMA vez, com UMA linha de AuditLog (âncora
 *      causal); lote novo é numerado pela sequência atual e auditado (create);
 *   5. o movimento guarda `lote_ids` (todos os participantes), `linhas`
 *      (legíveis na tela) e `efeito_servidor` (proveniência), campos
 *      reservados que POST/PATCH genéricos recusam.
 *
 * Falha em qualquer ponto → rollback integral: zero lote, movimento, auditoria
 * ou reserva de idempotência.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { documentoComoPublico } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero } from '../sequencias/entidadeCodigoService.js';
import { inserirLote } from '../lotes/loteRepository.js';
import { comoLotePublico, ENTIDADE_SEQUENCIA, escopoDaNumeracao } from '../lotes/loteService.js';
import { CAMPOS_MATERIAIS_LOTE, estadoDe } from './manejoMapaComandoService.js';

export const COMANDO_REBANHO = 'manejo_mapa_rebanho';
export const TIPO_OPERACAO_REBANHO = 'manejo_mapa_rebanho';
export const NASCIMENTO = 'Nascimento';
export const PESAGEM = 'Pesagem';
export const MUDANCA_CATEGORIA = 'Mudança de Categoria';
export const TIPOS_DO_COMANDO_REBANHO = Object.freeze([NASCIMENTO, PESAGEM, MUDANCA_CATEGORIA]);
export const MODOS_PESAGEM = Object.freeze(['por_lote', 'por_categoria', 'todos']);
export const MAX_LINHAS = 50;
/** Domínio aceito de peso médio por cabeça (kg). Acima disso é erro de digitação. */
export const PESO_MAXIMO_KG = 3000;

/**
 * Categorias oficiais (mesma lista do `FormularioMudancaCategoria`) e o sexo
 * que cada uma implica. Categoria fora desta lista não é aceita.
 */
export const CATEGORIAS_OFICIAIS = Object.freeze({
  'Bezerro 0 a 12 meses': 'Macho',
  'Bezerra 0 a 12 meses': 'Fêmea',
  'Garrote 13 a 24 meses': 'Macho',
  'Novilha 13 a 24 meses': 'Fêmea',
  'Boi 25 a 36 meses': 'Macho',
  'Vaca 25 a 36 meses': 'Fêmea',
  'Touro + 36 meses': 'Macho',
  'Vaca + 36 meses': 'Fêmea',
});
export const SEXOS = Object.freeze(['Macho', 'Fêmea']);

/**
 * Política materna (PR168-R2, D-PROD-101): só lotes FÊMEA de categoria oficial
 * de matriz podem ser "categoria da mãe". Novilha 13-24 entra porque o
 * produto já a oferece como mãe no formulário e é a novilha de primeira cria.
 * Bezerra e qualquer categoria masculina, nunca. Nome livre não vale.
 */
export const CATEGORIAS_MATERNAS = Object.freeze(['Vaca 25 a 36 meses', 'Vaca + 36 meses', 'Novilha 13 a 24 meses']);

/** Regra existente do frontend (`categoriaDoFilhote`), agora no servidor. */
export const categoriaDoFilhote = (sexo) => (sexo === 'Macho' ? 'Bezerro 0 a 12 meses' : 'Bezerra 0 a 12 meses');

/**
 * Campos que o cancelamento R2B exige iguais ao pós-estado e devolve ao
 * pré-estado: os materiais da R2A mais classificação completa e peso.
 */
export const CAMPOS_REBANHO_LOTE = Object.freeze([...CAMPOS_MATERIAIS_LOTE, 'categoria_manejo_nome', 'sexo', 'peso_medio_kg']);

/** Peso normalizado na precisão da coluna (Decimal 14,4); ausente = null. */
export const pesoNormal = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? Number(n.toFixed(4)) : NaN;
};

export const estadoRebanhoDe = (lote) => ({
  ...estadoDe(lote),
  categoria_manejo_nome: lote.categoria_manejo_nome ?? null,
  sexo: lote.sexo ?? null,
  peso_medio_kg: pesoNormal(lote.peso_medio_kg),
});

/** Igualdade estrita campo a campo (peso numérico); `undefined` nunca casa. */
export const divergenciasRebanho = (a, b) =>
  CAMPOS_REBANHO_LOTE.filter((k) => {
    const va = a?.[k];
    const vb = b?.[k];
    if (va === undefined || vb === undefined) return true;
    if (k === 'peso_medio_kg') return pesoNormal(va) !== pesoNormal(vb);
    return (va ?? null) !== (vb ?? null);
  });

const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const normal = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
const invalido = (mensagem, details = {}) => new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details });
const recusa = (codigo, mensagem, details = {}) => new AppError(codigo, mensagem, { details });

const categoriaOficial = (valor) => Object.keys(CATEGORIAS_OFICIAIS).find((c) => normal(c) === normal(valor)) ?? null;

/** Data operacional estrita (mesma regra do comando R2A). */
const dataOperacionalValida = (valor) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(valor || '');
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia && !Number.isNaN(new Date(valor).getTime());
};

const pesoDaEntrada = (valor, campo, obrigatorio) => {
  if (valor === null || valor === undefined || valor === '') {
    if (obrigatorio) throw invalido('peso obrigatório', { field: campo });
    return null;
  }
  const n = typeof valor === 'number' ? valor : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > PESO_MAXIMO_KG) {
    throw invalido(`peso deve ser número positivo até ${PESO_MAXIMO_KG} kg`, { field: campo });
  }
  return Number(n.toFixed(4));
};

const inteiroPositivo = (valor, campo) => {
  if (!Number.isInteger(valor) || valor <= 0) throw invalido('quantidade deve ser inteiro positivo', { field: campo });
  return valor;
};

/**
 * Valida e normaliza a forma. A ordem das linhas é preservada (é o que o
 * usuário viu); o fingerprint usa esta forma normalizada.
 */
export const lerEntradaRebanho = (entrada) => {
  const tipo = texto(entrada?.tipo);
  if (!TIPOS_DO_COMANDO_REBANHO.includes(tipo)) throw invalido('tipo de manejo não suportado pelo comando', { field: 'tipo' });
  const operationKey = texto(entrada?.operation_id);
  const empresaId = texto(entrada?.empresa_id);
  const areaId = texto(entrada?.area_id);
  const dataMovimentacao = texto(entrada?.data_movimentacao);
  if (!operationKey || !empresaId || !areaId || !dataMovimentacao) {
    throw invalido('operation_id, empresa_id, area_id e data_movimentacao são obrigatórios');
  }
  if (!dataOperacionalValida(dataMovimentacao)) throw invalido('data_movimentacao inválida', { field: 'data_movimentacao' });
  const linhasBrutas = entrada?.linhas;
  if (!Array.isArray(linhasBrutas) || linhasBrutas.length === 0 || linhasBrutas.length > MAX_LINHAS) {
    throw invalido(`linhas deve ter de 1 a ${MAX_LINHAS} itens`, { field: 'linhas' });
  }
  const observacoes = typeof entrada?.observacoes === 'string' ? entrada.observacoes.trim() || null : null;
  const modoPesagem = tipo === PESAGEM ? texto(entrada?.modo_pesagem) ?? 'por_lote' : null;
  if (modoPesagem && !MODOS_PESAGEM.includes(modoPesagem)) throw invalido('modo_pesagem inválido', { field: 'modo_pesagem' });

  const linhas = linhasBrutas.map((l, i) => {
    const campo = (k) => `linhas[${i}].${k}`;
    if (!l || typeof l !== 'object') throw invalido('linha inválida', { field: `linhas[${i}]` });
    if (tipo === NASCIMENTO) {
      const sexo = texto(l.sexo);
      if (!SEXOS.includes(sexo)) throw invalido('sexo deve ser Macho ou Fêmea', { field: campo('sexo') });
      const categoriaMae = texto(l.categoria_mae);
      if (!categoriaMae) throw invalido('categoria da mãe obrigatória', { field: campo('categoria_mae') });
      return {
        sexo,
        categoria_mae: categoriaMae,
        quantidade: inteiroPositivo(l.quantidade, campo('quantidade')),
        peso_medio_kg: pesoDaEntrada(l.peso_medio_kg, campo('peso_medio_kg'), false),
      };
    }
    if (tipo === PESAGEM) {
      const loteId = texto(l.lote_id);
      if (!loteId) throw invalido('lote_id obrigatório', { field: campo('lote_id') });
      return { lote_id: loteId, categoria: texto(l.categoria), peso_medio_kg: pesoDaEntrada(l.peso_medio_kg, campo('peso_medio_kg'), true) };
    }
    const atual = texto(l.categoria_atual);
    const nova = categoriaOficial(l.categoria_nova);
    if (!atual) throw invalido('categoria atual obrigatória', { field: campo('categoria_atual') });
    if (!nova) throw invalido('categoria nova fora das categorias oficiais', { field: campo('categoria_nova') });
    if (normal(atual) === normal(nova)) throw invalido('categoria nova igual à atual', { field: campo('categoria_nova') });
    return {
      categoria_atual: atual,
      categoria_nova: nova,
      quantidade: inteiroPositivo(l.quantidade, campo('quantidade')),
      categoria_manejo_id_novo: texto(l.categoria_manejo_id_novo),
      peso_medio_kg: pesoDaEntrada(l.peso_medio_kg, campo('peso_medio_kg'), false),
    };
  });
  if (tipo === PESAGEM) {
    const ids = linhas.map((l) => l.lote_id);
    if (new Set(ids).size !== ids.length) throw invalido('lote repetido na pesagem', { field: 'linhas' });
  }
  return { operationKey, tipo, empresaId, areaId, dataMovimentacao, observacoes, modoPesagem, linhas };
};

// ─── Ganchos de teste (só com NODE_ENV=test) ───────────────────────────────

/** Falha injetada ao gravar o N-ésimo efeito (1 = primeiro). Prova de rollback. */
const ganchos = { falharNoEfeito: 0 };
export const definirFalhaInjetadaR2B = (n) => {
  if (process.env.NODE_ENV !== 'test') throw new Error('gancho de teste fora de NODE_ENV=test');
  ganchos.falharNoEfeito = n;
};

// ─── Leitura com trava ─────────────────────────────────────────────────────

const travarAreaELotes = async (tx, clienteId, empresaId, areaId, idsExtras) => {
  await tx.$queryRaw`SELECT id FROM "AreaPastagem" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND id = ${areaId} FOR UPDATE`;
  const area = await tx.areaPastagem.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: areaId },
    select: { id: true, nome: true, setor_id: true, setor_nome: true },
  });
  if (!area) throw new AppError('AREA_NOT_FOUND', 'área não encontrada nesta empresa');
  const extras = [...new Set(idsExtras)];
  await tx.$queryRaw`
    SELECT id FROM "Lote"
     WHERE cliente_id = ${clienteId}
       AND (id = ANY(${extras}::text[]) OR (empresa_id = ${empresaId} AND area_atual_id = ${areaId}))
     ORDER BY id FOR UPDATE`;
  const lotes = await tx.lote.findMany({
    where: { cliente_id: clienteId, OR: [{ id: { in: extras } }, { empresa_id: empresaId, area_atual_id: areaId }] },
    orderBy: { id: 'asc' },
  });
  return { area, lotes };
};

/** Lote em condição de manejo nesta área (vivo, ativo, com cabeças, mesma empresa). */
const operavel = (lote, empresaId, areaId) =>
  !!lote && !lote.excluido_em && lote.empresa_id === empresaId && lote.area_atual_id === areaId && lote.status === 'Ativo' && lote.quantidade_cabecas > 0;

/**
 * Categoria de manejo da empresa para uma categoria oficial. Com id: precisa
 * existir, estar ativa e ser DESSA categoria oficial. Sem id: a única ativa
 * dessa categoria; nenhuma → sem categoria de manejo; mais de uma → ambíguo,
 * o formulário precisa escolher (não se adivinha).
 */
const resolverCategoriaManejo = async (tx, clienteId, empresaId, oficial, idPedido) => {
  if (idPedido) {
    const c = await tx.categoriaManejo.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id: idPedido, ativo: true } });
    if (!c || normal(c.categoria_oficial) !== normal(oficial)) {
      throw recusa('MANEJO_CATEGORIA_INVALIDA', 'categoria de manejo inexistente, inativa ou de outra categoria oficial', { categoria_manejo_id: idPedido });
    }
    return c;
  }
  const candidatas = (await tx.categoriaManejo.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId, ativo: true } })).filter(
    (c) => normal(c.categoria_oficial) === normal(oficial)
  );
  if (candidatas.length > 1) {
    throw recusa('MANEJO_CATEGORIA_AMBIGUA', 'há mais de uma categoria de manejo ativa para esta categoria; escolha uma', { categoria: oficial });
  }
  return candidatas[0] ?? null;
};

// ─── Planos por tipo (só memória; nada gravado) ────────────────────────────

/**
 * Estado de trabalho: `atual` começa igual ao banco e acumula as mudanças;
 * `novos` são lotes a criar. Cada lote é gravado uma única vez no fim.
 */
const novoPlano = (lotes) => ({
  porId: new Map(lotes.map((l) => [l.id, { original: l, atual: { ...l } }])),
  novos: /** @type {Array<{chave: string, dados: Record<string, any>}>} */ ([]),
});

const planejarNascimento = async (tx, clienteId, e, area, plano) => {
  const vivos = [...plano.porId.values()].map((x) => x.original).filter((l) => operavel(l, e.empresaId, area.id));
  const linhas = [];
  for (const [i, l] of e.linhas.entries()) {
    const oficial = CATEGORIAS_MATERNAS.find((cat) => normal(cat) === normal(l.categoria_mae));
    if (!oficial) {
      throw recusa('MANEJO_CATEGORIA_MAE_INVALIDA', 'categoria da mãe não é categoria oficial de matriz', { linha: i, categoria_mae: l.categoria_mae, aceitas: CATEGORIAS_MATERNAS });
    }
    // Lotes de matrizes: mesma categoria oficial E sexo Fêmea (lote sem sexo ou Macho não é mãe).
    const maes = vivos.filter((m) => normal(m.categoria) === normal(oficial) && normal(m.sexo) === normal('Fêmea'));
    if (!maes.length) {
      throw recusa('MANEJO_CATEGORIA_MAE_INVALIDA', 'não há lote ativo de fêmeas desta categoria de matriz nesta área', { linha: i, categoria_mae: oficial });
    }
    linhas.push({ ...l, categoria_mae: oficial, categoria_filhote: categoriaDoFilhote(l.sexo), maes });
  }
  // Agrupa por sexo: duas linhas do mesmo sexo vão para o MESMO lote de filhotes.
  for (const sexo of SEXOS) {
    const grupo = linhas.filter((l) => l.sexo === sexo);
    if (!grupo.length) continue;
    const quantidade = grupo.reduce((t, l) => t + l.quantidade, 0);
    // Peso dos recém-nascidos: média ponderada das linhas — só se TODAS informaram peso.
    const pesoEntrada = grupo.every((l) => l.peso_medio_kg !== null)
      ? Number((grupo.reduce((t, l) => t + l.quantidade * l.peso_medio_kg, 0) / quantidade).toFixed(4))
      : null;
    const categoria = categoriaDoFilhote(sexo);
    // Destino (PR168-R2): mesma categoria E mesmo sexo; lote sem sexo ou do
    // sexo oposto nunca recebe (fica intacto). Dois compatíveis = ambíguo: não
    // se unifica implicitamente. Nenhum compatível = lote novo coerente.
    const compativeis = vivos.filter((l) => normal(l.categoria) === normal(categoria) && normal(l.sexo) === normal(sexo));
    if (compativeis.length > 1) {
      throw recusa('MANEJO_DESTINO_AMBIGUO', 'há mais de um lote de filhotes compatível nesta área; não há unificação implícita', {
        sexo,
        categoria,
        lote_ids: compativeis.map((l) => l.id),
      });
    }
    const alvo = compativeis[0] ?? null;
    if (alvo) {
      const x = plano.porId.get(alvo.id);
      const pesoAnterior = pesoNormal(x.atual.peso_medio_kg);
      const qAnterior = x.atual.quantidade_cabecas;
      // Política de peso (D-PROD-101): média ponderada quando os dois pesos são
      // conhecidos; peso do nascimento desconhecido mantém o do lote; lote sem
      // peso continua sem peso (não se inventa a média do lote inteiro).
      const pesoNovo = pesoEntrada !== null && pesoAnterior !== null
        ? Number(((qAnterior * pesoAnterior + quantidade * pesoEntrada) / (qAnterior + quantidade)).toFixed(4))
        : pesoAnterior;
      x.atual.quantidade_cabecas = qAnterior + quantidade;
      x.atual.peso_medio_kg = pesoNovo;
      for (const l of grupo) Object.assign(l, { lote_id: alvo.id, lote_criado: false });
    } else {
      const catManejo = await resolverCategoriaManejo(tx, clienteId, e.empresaId, categoria, null);
      const base = grupo[0].maes[0];
      const chave = `nascimento:${sexo}`;
      plano.novos.push({
        chave,
        dados: {
          nome: `${categoria.split(' ')[0].toUpperCase()} - ${area.nome}`,
          quantidade_cabecas: quantidade,
          quantidade_entrada: quantidade,
          categoria,
          categoria_entrada: categoria,
          categoria_manejo_id: catManejo?.id ?? null,
          categoria_manejo_nome: catManejo?.nome ?? null,
          categoria_manejo_entrada_id: catManejo?.id ?? null,
          categoria_manejo_entrada_nome: catManejo?.nome ?? null,
          sexo,
          peso_medio_kg: pesoEntrada,
          peso_entrada_kg: pesoEntrada,
          idade_media_meses: 0,
          raca_predominante: base.raca_predominante ?? null,
          sistema_produtivo: base.sistema_produtivo ?? null,
          motivo_outros: 'Nascimento',
          origem: 'Nascimento',
        },
      });
      for (const l of grupo) Object.assign(l, { lote_chave: chave, lote_criado: true });
    }
  }
  return linhas.map(({ maes, ...l }) => ({ ...l, maes_lote_ids: maes.map((m) => m.id) }));
};

const planejarPesagem = (e, area, plano) =>
  e.linhas.map((l, i) => {
    const x = plano.porId.get(l.lote_id);
    if (!x || !operavel(x.original, e.empresaId, area.id)) {
      throw new AppError('LOTE_NOT_FOUND', 'lote não encontrado ativo nesta área', { details: { linha: i, lote_id: l.lote_id } });
    }
    if (l.categoria && normal(l.categoria) !== normal(x.original.categoria)) {
      throw recusa('MANEJO_ESTADO_INVALIDO', 'categoria informada não confere com a do lote', { linha: i, lote_id: l.lote_id, categoria_lote: x.original.categoria ?? null });
    }
    const anterior = pesoNormal(x.original.peso_medio_kg);
    x.atual.peso_medio_kg = l.peso_medio_kg;
    return {
      lote_id: l.lote_id,
      lote_nome: x.original.nome,
      categoria: x.original.categoria ?? null,
      quantidade_cabecas: x.original.quantidade_cabecas,
      peso_anterior_kg: anterior,
      peso_novo_kg: l.peso_medio_kg,
      ganho_kg: anterior === null ? null : Number((l.peso_medio_kg - anterior).toFixed(4)),
    };
  });

const planejarMudanca = async (tx, clienteId, e, area, plano) => {
  const preexistentes = [...plano.porId.values()].filter((x) => operavel(x.original, e.empresaId, area.id));
  /** Lotes que já trocaram de categoria por inteiro neste comando: não são mais origem. */
  const convertidos = new Set();
  const saida = [];
  for (const [i, l] of e.linhas.entries()) {
    const catManejo = await resolverCategoriaManejo(tx, clienteId, e.empresaId, l.categoria_nova, l.categoria_manejo_id_novo);
    const sexoNovo = catManejo?.sexo || CATEGORIAS_OFICIAIS[l.categoria_nova];
    const origens = preexistentes.filter(
      (x) => !convertidos.has(x.original.id) && normal(x.original.categoria) === normal(l.categoria_atual) && x.atual.quantidade_cabecas > 0
    );
    const disponivel = origens.reduce((t, x) => t + x.atual.quantidade_cabecas, 0);
    if (disponivel < l.quantidade) {
      throw recusa('MANEJO_SALDO_INSUFICIENTE', 'saldo insuficiente na categoria atual', { linha: i, categoria: l.categoria_atual, disponivel, pedido: l.quantidade });
    }
    let restante = l.quantidade;
    const partes = [];
    for (const x of origens) {
      if (restante <= 0) break;
      const lote = x.atual;
      if (SEXOS.includes(lote.sexo) && sexoNovo && lote.sexo !== sexoNovo) {
        throw recusa('MANEJO_CATEGORIA_INCOMPATIVEL', 'categoria nova incompatível com o sexo do lote', { linha: i, lote_id: lote.id, sexo_lote: lote.sexo, sexo_categoria: sexoNovo });
      }
      const qtd = Math.min(restante, lote.quantidade_cabecas);
      const classificacao = {
        categoria: l.categoria_nova,
        categoria_manejo_id: catManejo?.id ?? null,
        categoria_manejo_nome: catManejo?.nome ?? null,
        sexo: sexoNovo ?? lote.sexo ?? null,
      };
      if (qtd === lote.quantidade_cabecas) {
        Object.assign(lote, classificacao, l.peso_medio_kg !== null ? { peso_medio_kg: l.peso_medio_kg } : {});
        convertidos.add(lote.id);
        partes.push({ modo: 'total', lote_origem_id: lote.id, lote_destino_id: lote.id, quantidade: qtd });
      } else {
        lote.quantidade_cabecas -= qtd;
        const chave = `mudanca:${i}:${lote.id}`;
        plano.novos.push({
          chave,
          dados: {
            nome: lote.nome,
            identificador_nome: lote.identificador_nome ?? null,
            identificador_sigla: lote.identificador_sigla ?? null,
            identificador_cor: lote.identificador_cor ?? null,
            quantidade_cabecas: qtd,
            quantidade_entrada: qtd,
            ...classificacao,
            categoria_entrada: lote.categoria_entrada || l.categoria_nova,
            categoria_manejo_entrada_id: lote.categoria_manejo_entrada_id || classificacao.categoria_manejo_id,
            categoria_manejo_entrada_nome: lote.categoria_manejo_entrada_nome || classificacao.categoria_manejo_nome,
            peso_medio_kg: l.peso_medio_kg ?? pesoNormal(lote.peso_medio_kg),
            peso_entrada_kg: pesoNormal(lote.peso_entrada_kg) ?? pesoNormal(lote.peso_medio_kg),
            idade_media_meses: lote.idade_media_meses ?? null,
            raca_predominante: lote.raca_predominante ?? null,
            sistema_produtivo: lote.sistema_produtivo ?? null,
            motivo_outros: 'Mudança de Categoria',
            // Derivado: cabeças que já existiam — não é COMPRA nem entrada do Cadastro.
            origem: 'Mudança de Categoria',
          },
        });
        partes.push({ modo: 'parcial', lote_origem_id: lote.id, lote_chave: chave, quantidade: qtd });
      }
      restante -= qtd;
    }
    saida.push({
      categoria_atual: l.categoria_atual,
      categoria_nova: l.categoria_nova,
      quantidade: l.quantidade,
      categoria_manejo_id: catManejo?.id ?? null,
      categoria_manejo_nome: catManejo?.nome ?? null,
      sexo_novo: sexoNovo ?? null,
      peso_medio_kg: l.peso_medio_kg,
      partes,
    });
  }
  return saida;
};

// ─── Comando ───────────────────────────────────────────────────────────────

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext, requestId: string}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const executarManejoRebanho = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const e = lerEntradaRebanho(entrada);
  const fingerprint = fingerprintDePayload({ comando: COMANDO_REBANHO, ...e, operationKey: undefined });

  const prisma = getPrismaClient();
  const resultado = await prisma.$transaction(async (tx) =>
    executarComIdempotencia(tx, {
      clienteId: auth.clienteId,
      operationKey: e.operationKey,
      tipoOperacao: TIPO_OPERACAO_REBANHO,
      fingerprint,
      executar: async () => {
        const empresa = await tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: e.empresaId } }, select: { id: true } });
        if (!empresa) throw new AppError('EMPRESA_NOT_FOUND', 'empresa não encontrada');

        const extras = e.tipo === PESAGEM ? e.linhas.map((l) => l.lote_id) : [];
        const { area, lotes } = await travarAreaELotes(tx, auth.clienteId, e.empresaId, e.areaId, extras);
        const plano = novoPlano(lotes);

        let linhas;
        if (e.tipo === NASCIMENTO) linhas = await planejarNascimento(tx, auth.clienteId, e, area, plano);
        else if (e.tipo === PESAGEM) linhas = planejarPesagem(e, area, plano);
        else linhas = await planejarMudanca(tx, auth.clienteId, e, area, plano);

        // ── Grava: cada lote alterado uma vez, cada criação auditada ──
        const data = new Date(e.dataMovimentacao);
        const efeitos = [];
        const lotesResultado = [];
        const idPorChave = new Map();
        let n = 0;
        const talvezFalhar = () => {
          n += 1;
          if (ganchos.falharNoEfeito && ganchos.falharNoEfeito === n) throw new Error(`falha injetada no efeito ${n}`);
        };
        // Pesagem que repete o peso continua sendo um fato do lote: grava e audita.
        const pesados = new Set(e.tipo === PESAGEM ? e.linhas.map((l) => l.lote_id) : []);
        for (const x of plano.porId.values()) {
          const antes = estadoRebanhoDe(x.original);
          const depois = estadoRebanhoDe(x.atual);
          if (!divergenciasRebanho(antes, depois).length && !pesados.has(x.original.id)) continue;
          talvezFalhar();
          const atualizado = await tx.lote.update({
            where: { cliente_id_id: { cliente_id: auth.clienteId, id: x.original.id } },
            data: {
              quantidade_cabecas: x.atual.quantidade_cabecas,
              status: x.atual.status,
              categoria: x.atual.categoria ?? null,
              categoria_manejo_id: x.atual.categoria_manejo_id ?? null,
              categoria_manejo_nome: x.atual.categoria_manejo_nome ?? null,
              sexo: x.atual.sexo ?? null,
              peso_medio_kg: pesoNormal(x.atual.peso_medio_kg),
            },
          });
          const auditoria = await registrarEvento(
            contexto,
            { acao: 'update', entidade: 'Lote', entidadeId: x.original.id, dadosAnteriores: comoLotePublico(x.original), dadosNovos: comoLotePublico(atualizado) },
            tx
          );
          efeitos.push({ lote_id: x.original.id, criado: false, auditoria_id: auditoria.id, antes, depois: estadoRebanhoDe(atualizado) });
          lotesResultado.push(atualizado);
        }
        for (const novo of plano.novos) {
          talvezFalhar();
          const numero = await reservarNumero(tx, { clienteId: auth.clienteId, entidade: ENTIDADE_SEQUENCIA, escopoTipo: escopoDaNumeracao() });
          const criado = await inserirLote(tx, {
            cliente_id: auth.clienteId,
            empresa_id: e.empresaId,
            numero_lote: String(numero),
            ...novo.dados,
            setor_id: area.setor_id ?? null,
            setor_nome: area.setor_nome ?? null,
            area_entrada_id: area.id,
            area_entrada_nome: area.nome,
            area_atual_id: area.id,
            area_atual_nome: area.nome,
            data_entrada: Number.isNaN(data.getTime()) ? null : data,
            motivo_entrada: 'Outros',
            status: 'Ativo',
          });
          const auditoria = await registrarEvento(contexto, { acao: 'create', entidade: 'Lote', entidadeId: criado.id, dadosNovos: comoLotePublico(criado) }, tx);
          idPorChave.set(novo.chave, criado.id);
          const depois = estadoRebanhoDe(criado);
          // "antes" do lote criado = vazio e inativo: é o que o cancelamento deixa (sem exclusão física).
          efeitos.push({ lote_id: criado.id, criado: true, auditoria_id: auditoria.id, antes: { ...depois, quantidade_cabecas: 0, status: 'Inativo' }, depois });
          lotesResultado.push(criado);
        }

        // Liga as linhas aos lotes criados (ids só existem agora).
        for (const l of linhas) {
          if (l.lote_chave) {
            l.lote_id = idPorChave.get(l.lote_chave);
            delete l.lote_chave;
          }
          for (const p of l.partes ?? []) {
            if (p.lote_chave) {
              p.lote_destino_id = idPorChave.get(p.lote_chave);
              delete p.lote_chave;
            }
          }
        }

        // Conservação: pesagem e mudança não criam nem somem com cabeças;
        // nascimento soma exatamente os filhotes.
        const total = (k) => efeitos.reduce((t, x) => t + x[k].quantidade_cabecas, 0);
        const esperado = e.tipo === NASCIMENTO ? e.linhas.reduce((t, l) => t + l.quantidade, 0) : 0;
        if (total('depois') - total('antes') !== esperado) {
          throw new AppError('INTERNAL_ERROR', 'conservação de cabeças violada no plano do manejo');
        }
        if (!efeitos.length) throw recusa('MANEJO_ESTADO_INVALIDO', 'o manejo não altera nenhum lote');

        const participantes = efeitos.map((x) => x.lote_id);
        const nomes = new Map(lotesResultado.map((l) => [l.id, l.nome]));
        const primario = participantes[0];
        const quantidade =
          e.tipo === PESAGEM ? linhas.reduce((t, l) => t + l.quantidade_cabecas, 0) : e.linhas.reduce((t, l) => t + l.quantidade, 0);
        const dados = {
          tipo: e.tipo,
          lote: nomes.get(primario) ?? null,
          lote_id: primario,
          lote_ids: participantes,
          quantidade_animais: quantidade,
          data_movimentacao: e.dataMovimentacao,
          ...(e.tipo === NASCIMENTO
            ? { area_destino_id: area.id, area_destino_nome: area.nome }
            : { area_origem_id: area.id, area_origem_nome: area.nome }),
          ...(e.tipo === PESAGEM ? { modo_pesagem: e.modoPesagem } : {}),
          linhas,
          ...(e.observacoes ? { observacoes: e.observacoes } : {}),
          efeito_servidor: {
            comando: COMANDO_REBANHO,
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
