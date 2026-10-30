/**
 * Reconciliação READ-ONLY do estoque pecuário legado (Lote + MovimentacaoMapa)
 * contra o contrato do ledger (L1-R2). Função PURA: recebe um dump já carregado
 * e devolve matriz + estado; não abre banco, não escreve, não "conserta" nada.
 *
 * Regras (CONTRATO.md §7):
 *  - ENTRADA histórica conta SEMPRE, qualquer que seja o status operacional
 *    atual (Ativo, Inativo, Vendido, Abatido, Transferido…): status é estado
 *    operacional, não prova de anulação. Status com cara de cancelamento sem
 *    mecanismo formal de anulação no legado → conta E vai para quarentena.
 *  - Origem do lote (classificarOrigemLote, mesma regra do serviço):
 *      cadastro → entrada; nascimento → entrada (fato real) + quarentena
 *      impeditiva (sem evento no L1); derivado_movimento → efeito de movimento,
 *      não é entrada; derivado_reversao / derivado_categoria → não é entrada +
 *      quarentena impeditiva (semântica não suportada no L1).
 *  - Categoria da ENTRADA = categoria HISTÓRICA (`categoria_manejo_entrada_id`),
 *    nunca a atual. Posição observada usa a categoria ATUAL. Lote que mudou de
 *    categoria → suspeita impeditiva (mudança de categoria não suportada).
 *  - Categoria da TRANSFERÊNCIA (R3, fail-closed): `dados.categoria_manejo_id`
 *    do evento (forma válida, sem conflito com o lote); senão a do lote de
 *    cadastro SÓ com histórico presente e igual ao atual; senão
 *    `mapeamento_categorias` explícito; senão quarentena (não aplica).
 *  - `apto_para_backfill` (geral e por empresa): true só se conciliada sem
 *    lacuna/suspeita/quarentena (`apto_matematico`) E com manifesto de snapshot
 *    externo válido e coerente (R4) — e mesmo assim não executa nada.
 *  - Integridade (R4): ID de lote/movimento vazio ou repetido, lote
 *    referenciado ambíguo e movimento de empresa ≠ empresa do lote →
 *    quarentena impeditiva; nada é escolhido nem corrigido.
 *  - Quantidades: inteiro estrito > 0 (número inteiro ou string só de dígitos).
 *    `10.5`, `NaN`, vazio, negativo ou lixo → quarentena, nunca truncado.
 *  - Só "Transferência de Área" é aplicada; outros tipos → quarentena impeditiva.
 *  - Estado por empresa e geral: `conciliada` | `reconciliacao_parcial` |
 *    `bloqueada_para_backfill`. Diferença zero com item em quarentena NUNCA é
 *    apresentada como conciliada.
 *  - IDs saem com hash curto por padrão; nomes de pessoas/usuários nunca saem.
 */

import { createHash } from 'node:crypto';

import { CATEGORIA_SEM, categoriaHistoricaDaEntrada, classificarOrigemLote } from '../../backend/src/modules/estoquePecuarioLedger/ledgerPecuarioContrato.js';

const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
const STATUS_COM_CARA_DE_ANULACAO = new Set(['CANCELADO', 'CANCELADA', 'EXCLUIDO', 'ESTORNADO', 'ANULADO']);
const ehAtivo = (lote) => semAcento(lote?.status || 'ATIVO') === 'ATIVO';

/**
 * Teto de quantidade de um REGISTRO histórico na auditoria: o maior inteiro que
 * cabe em `int4` (Int do Prisma / `integer` das colunas de fatos). O limite por
 * EVENTO do ledger é menor (`QUANTIDADE_MAXIMA_POR_EVENTO` = 1.000.000, no
 * contrato); acima dele o comando recusa, mas a auditoria ainda enxerga o
 * registro legado — e o que passa de int4 nem é representável: quarentena.
 */
export const QUANTIDADE_MAXIMA_REGISTRO_HISTORICO = 2_147_483_647;
const RE_ID_CATEGORIA = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Inteiro seguro estrito, 0 < n ≤ int4, sem truncar nem converter: 10 e "10"
 * valem; 10.5, "10.5", "", " ", NaN, -3, "1e3", "abc", 2^31 e
 * MAX_SAFE_INTEGER+1 não.
 * @param {unknown} v
 * @returns {number | null}
 */
export const inteiroPositivoEstrito = (v) => {
  /** @type {number} */
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d{1,10}$/.test(v)) n = Number(v);
  else return null;
  return Number.isSafeInteger(n) && n > 0 && n <= QUANTIDADE_MAXIMA_REGISTRO_HISTORICO ? n : null;
};

/**
 * @param {boolean} mostrarIds
 * @returns {(id: unknown) => string | null}
 */
const fabricaRotulo = (mostrarIds) => (id) => {
  if (id === undefined || id === null || id === '') return null;
  if (mostrarIds) return String(id);
  return `#${createHash('sha256').update(String(id)).digest('hex').slice(0, 10)}`;
};

/** Categoria atual do lote para a POSIÇÃO observada (não confundir com a da entrada). */
const categoriaAtual = (lote) => {
  if (lote?.categoria_manejo_id) return { chave: `cm:${lote.categoria_manejo_id}`, confiavel: true };
  const t = semAcento(lote?.categoria);
  return t ? { chave: `texto:${t}`, confiavel: false } : { chave: CATEGORIA_SEM, confiavel: true };
};

export const VERSAO_MANIFESTO_SNAPSHOT = 1;
const MODOS_CONSISTENCIA = new Set(['snapshot_transacional', 'export_consistente_equivalente']);
const RE_DATA_HORA_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
/** Faixa de ano aceita em `capturado_em` (CONTRATO §7.1). */
export const ANO_MINIMO_CAPTURADO_EM = 1900;
export const ANO_MAXIMO_CAPTURADO_EM = 9999;
/** Tolerância de relógio para `capturado_em` no futuro. */
export const TOLERANCIA_FUTURO_CAPTURADO_EM_MS = 5 * 60_000;

/**
 * Instante UTC REAL, sem normalização: `AAAA-MM-DDTHH:MM:SS[.mmm]Z`, data
 * civil existente (bissexto gregoriano), hora 00–23, minuto 00–59, segundo
 * 00–59 (sem leap second). `Date.parse` sozinho não serve: normaliza
 * `2026-02-30` para 2 de março. Retorna epoch ms ou `null`.
 * @param {unknown} v
 * @returns {number | null}
 */
export const instanteUtcEstrito = (v) => {
  if (typeof v !== 'string') return null;
  const m = RE_DATA_HORA_UTC.exec(v);
  if (!m) return null;
  const [ano, mes, dia, hora, minuto, segundo] = m.slice(1, 7).map(Number);
  const ms = m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0'));
  if (ano < ANO_MINIMO_CAPTURADO_EM || ano > ANO_MAXIMO_CAPTURADO_EM) return null;
  if (mes < 1 || mes > 12 || hora > 23 || minuto > 59 || segundo > 59) return null;
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  const diasNoMes = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
  if (dia < 1 || dia > diasNoMes) return null;
  // setUTCFullYear não reinterpreta anos 0–99 como 19xx (Date.UTC faria).
  const d = new Date(0);
  d.setUTCFullYear(ano, mes - 1, dia);
  d.setUTCHours(hora, minuto, segundo, ms);
  const confere =
    d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia &&
    d.getUTCHours() === hora && d.getUTCMinutes() === minuto && d.getUTCSeconds() === segundo && d.getUTCMilliseconds() === ms;
  return confere ? d.getTime() : null;
};
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ehContagem = (v) => Number.isSafeInteger(v) && v >= 0;
const textoNaoVazio = (v, max = 128) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
/** Origem com cara de credencial/URL privada nunca é aceita nem ecoada. */
const pareceSensivel = (v) => /:\/\/|@|senha|password|secret|token|apikey|api_key/i.test(String(v ?? ''));

/**
 * Estado de uma coleção do dump: `ausente` (propriedade omitida — NUNCA é
 * "zero comprovado"), `malformada` (não-array ou com linha que não é objeto)
 * ou `presente` (array de objetos; `[]` vale como zero quando o manifesto o
 * declara).
 * @param {unknown} v
 * @returns {'ausente' | 'malformada' | 'presente'}
 */
export const estadoDaFonte = (v) => {
  if (v === undefined) return 'ausente';
  if (!Array.isArray(v) || v.some((x) => !ehObjeto(x))) return 'malformada';
  return 'presente';
};

/**
 * CONFERE (não produz) o manifesto externo do snapshot — contrato v1, ver
 * CONTRATO.md §7.1. Puro: só lê. O manifesto é uma DECLARAÇÃO de quem extraiu
 * o dump; não é prova criptográfica e não substitui conferência humana da
 * extração e do ambiente. Nada aqui gera manifesto a partir dos próprios
 * arrays (isso só repetiria um recorte incompleto).
 * @param {Record<string, any>} dump
 * @param {(id: unknown) => string | null} rot
 */
export const validarManifestoSnapshot = (dump, rot = (x) => (x === undefined || x === null ? null : String(x)), agoraMs = Date.now()) => {
  /** @type {Array<{ codigo: string } & Record<string, unknown>>} */
  const impedimentos = [];
  /** @type {Array<{ codigo: string } & Record<string, unknown>>} */
  const avisos = [];
  const impedir = (codigo, extra = {}) => impedimentos.push({ codigo, ...extra });
  const fontes = { lotes: estadoDaFonte(dump?.lotes), movimentacoes_mapa: estadoDaFonte(dump?.movimentacoes_mapa) };
  for (const [nome, estado] of Object.entries(fontes)) {
    if (estado !== 'presente') impedir(`fonte_${nome}_${estado}`);
  }
  const lotes = fontes.lotes === 'presente' ? dump.lotes : [];
  const movs = fontes.movimentacoes_mapa === 'presente' ? dump.movimentacoes_mapa : [];
  const lidas = { lotes: Array.isArray(dump?.lotes) ? dump.lotes.length : null, movimentacoes_mapa: Array.isArray(dump?.movimentacoes_mapa) ? dump.movimentacoes_mapa.length : null };

  const m = dump?.manifesto_snapshot;
  /** @type {Record<string, unknown>} */
  const resumo = { presente: m !== undefined };
  if (m === undefined) {
    impedir('manifesto_ausente');
    return { valido: false, fontes, resumo, contagens: { declaradas: null, lidas }, empresas: { declaradas: [], sem_registros: [], fora_do_escopo: [] }, impedimentos, avisos, escopoEmpresasRotuladas: new Set() };
  }
  if (!ehObjeto(m)) {
    impedir('manifesto_malformado');
    return { valido: false, fontes, resumo, contagens: { declaradas: null, lidas }, empresas: { declaradas: [], sem_registros: [], fora_do_escopo: [] }, impedimentos, avisos, escopoEmpresasRotuladas: new Set() };
  }
  if (m.versao !== VERSAO_MANIFESTO_SNAPSHOT) impedir('manifesto_versao_nao_suportada', { versao: m.versao ?? null });
  if (!textoNaoVazio(m.snapshot_id)) impedir('manifesto_snapshot_id_invalido');
  const capturadoEmMs = instanteUtcEstrito(m.capturado_em);
  if (capturadoEmMs === null) {
    impedir('manifesto_capturado_em_invalido');
  } else if (capturadoEmMs > agoraMs + TOLERANCIA_FUTURO_CAPTURADO_EM_MS) {
    impedir('manifesto_capturado_em_no_futuro');
  }
  const escopo = ehObjeto(m.escopo) ? m.escopo : null;
  const clienteId = escopo && textoNaoVazio(escopo.cliente_id, 64) ? escopo.cliente_id : null;
  if (!clienteId) impedir('manifesto_escopo_cliente_invalido');
  const empresasDecl = escopo && Array.isArray(escopo.empresas) ? escopo.empresas : null;
  const empresasValidas = Array.isArray(empresasDecl) && empresasDecl.length > 0 && empresasDecl.every((e) => textoNaoVazio(e, 64)) && new Set(empresasDecl).size === empresasDecl.length;
  if (!empresasValidas) impedir('manifesto_escopo_empresas_invalido');
  const escopoEmpresas = new Set(empresasValidas ? empresasDecl : []);

  const cont = ehObjeto(m.contagens) ? m.contagens : null;
  const declaradas = cont ? { lotes: cont.lotes, movimentacoes_mapa: cont.movimentacoes_mapa } : null;
  if (!cont || !ehContagem(cont.lotes) || !ehContagem(cont.movimentacoes_mapa)) {
    impedir('manifesto_contagens_invalidas');
  } else {
    if (lidas.lotes !== cont.lotes) impedir('contagem_lotes_divergente', { declarada: cont.lotes, lida: lidas.lotes });
    if (lidas.movimentacoes_mapa !== cont.movimentacoes_mapa) impedir('contagem_movimentacoes_divergente', { declarada: cont.movimentacoes_mapa, lida: lidas.movimentacoes_mapa });
  }

  // Escopo por empresa: registro fora do escopo bloqueia; empresa declarada
  // sem nenhum registro só é aceita se `por_empresa` declarar ZERO explícito.
  const lidosPorEmpresa = new Map();
  const somar = (emp, campo) => {
    const k = emp ?? null;
    if (!lidosPorEmpresa.has(k)) lidosPorEmpresa.set(k, { lotes: 0, movimentacoes_mapa: 0 });
    lidosPorEmpresa.get(k)[campo] += 1;
  };
  for (const l of lotes) somar(l.empresa_id, 'lotes');
  for (const mv of movs) somar(mv.empresa_id ?? null, 'movimentacoes_mapa');
  const foraDoEscopo = [...lidosPorEmpresa.keys()].filter((e) => e === null || !escopoEmpresas.has(e));
  for (const e of foraDoEscopo) impedir('registro_fora_do_escopo', { empresa: e === null ? '(sem_empresa)' : rot(e) });

  const porEmpresaDecl = cont && cont.por_empresa !== undefined ? cont.por_empresa : undefined;
  if (porEmpresaDecl !== undefined && !ehObjeto(porEmpresaDecl)) impedir('manifesto_por_empresa_malformado');
  const semRegistros = [];
  for (const e of escopoEmpresas) {
    const lido = lidosPorEmpresa.get(e) ?? { lotes: 0, movimentacoes_mapa: 0 };
    const decl = ehObjeto(porEmpresaDecl) ? porEmpresaDecl[e] : undefined;
    if (decl !== undefined) {
      if (!ehObjeto(decl) || !ehContagem(decl.lotes) || !ehContagem(decl.movimentacoes_mapa)) impedir('manifesto_por_empresa_malformado', { empresa: rot(e) });
      else if (decl.lotes !== lido.lotes || decl.movimentacoes_mapa !== lido.movimentacoes_mapa) {
        impedir('contagem_por_empresa_divergente', { empresa: rot(e), declarada: { lotes: decl.lotes, movimentacoes_mapa: decl.movimentacoes_mapa }, lida: lido });
      }
    }
    if (lido.lotes === 0 && lido.movimentacoes_mapa === 0) {
      semRegistros.push(rot(e));
      if (!(ehObjeto(decl) && decl.lotes === 0 && decl.movimentacoes_mapa === 0)) impedir('empresa_do_escopo_sem_prova_de_zero', { empresa: rot(e) });
    }
  }
  if (ehObjeto(porEmpresaDecl)) {
    for (const e of Object.keys(porEmpresaDecl)) if (!escopoEmpresas.has(e)) impedir('manifesto_por_empresa_fora_do_escopo', { empresa: rot(e) });
  }

  // Tenant (R5): TODA linha precisa trazer cliente_id texto igual ao do
  // escopo. Ausente, vazio ou só espaços → impedimento (linha não verificável:
  // nunca prova de isolamento); outro tipo → inválido; outro valor →
  // divergente. Nada é inferido de empresa, lote ou do próprio manifesto.
  // Só contagens saem no resultado, nunca o valor cru.
  let semCliente = 0;
  let clienteInvalido = 0;
  let clienteDivergente = 0;
  for (const r of [...lotes, ...movs]) {
    const c = r.cliente_id;
    if (c === undefined || c === null || (typeof c === 'string' && c.trim() === '')) semCliente += 1;
    else if (typeof c !== 'string') clienteInvalido += 1;
    else if (clienteId && c !== clienteId) clienteDivergente += 1;
  }
  if (semCliente > 0) {
    avisos.push({ codigo: 'cliente_nao_verificado_em_linhas', linhas: semCliente });
    impedir('cliente_ausente_em_linhas', { linhas: semCliente });
  }
  if (clienteInvalido > 0) impedir('cliente_invalido_em_linhas', { linhas: clienteInvalido });
  if (clienteDivergente > 0) impedir('cliente_divergente_do_escopo', { linhas: clienteDivergente });

  const consist = ehObjeto(m.consistencia) ? m.consistencia : null;
  if (!consist || !MODOS_CONSISTENCIA.has(consist.modo) || consist.confirmado !== true) impedir('manifesto_consistencia_nao_declarada');
  const origem = ehObjeto(m.origem) ? m.origem : null;
  const origemSensivel = origem && (pareceSensivel(origem.tipo) || pareceSensivel(origem.referencia));
  if (!origem || !textoNaoVazio(origem.tipo, 64)) impedir('manifesto_origem_ausente');
  else if (origemSensivel) impedir('manifesto_origem_com_dado_sensivel');

  Object.assign(resumo, {
    versao: m.versao ?? null,
    snapshot_id: textoNaoVazio(m.snapshot_id) ? rot(m.snapshot_id) : null,
    capturado_em: capturadoEmMs === null ? null : m.capturado_em,
    cliente: clienteId ? rot(clienteId) : null,
    consistencia: consist && MODOS_CONSISTENCIA.has(consist.modo) ? consist.modo : null,
    origem_tipo: origem && textoNaoVazio(origem.tipo, 64) && !origemSensivel ? origem.tipo : null,
  });
  return {
    valido: impedimentos.length === 0,
    fontes,
    resumo,
    contagens: { declaradas, lidas },
    empresas: { declaradas: [...escopoEmpresas].map(rot), sem_registros: semRegistros, fora_do_escopo: foraDoEscopo.map((e) => (e === null ? '(sem_empresa)' : rot(e))) },
    impedimentos,
    avisos,
    escopoEmpresasRotuladas: new Set([...escopoEmpresas].map(rot)),
  };
};

/**
 * @param {{
 *   lotes?: Array<Record<string, any>>,
 *   movimentacoes_mapa?: Array<Record<string, any>>,
 *   mapeamento_categorias?: Record<string, string>,
 *   manifesto_snapshot?: Record<string, any>,
 * }} dump `mapeamento_categorias`: texto (ex.: "BOI") → categoria_manejo_id, decidido e
 *   revisado por gente; vira `fonte: 'mapeamento'` no resultado.
 * @param {{ mostrarIds?: boolean }} [opcoes]
 */
export const auditarLedgerPecuario = (dump, opcoes = {}) => {
  const rot = fabricaRotulo(opcoes.mostrarIds === true);
  // Só linhas-objeto entram; fonte ausente/malformada fica registrada no
  // `snapshot` e torna a aptidão impossível (nunca vira "zero").
  const lotes = Array.isArray(dump?.lotes) ? dump.lotes.filter(ehObjeto) : [];
  const movs = Array.isArray(dump?.movimentacoes_mapa) ? dump.movimentacoes_mapa.filter(ehObjeto) : [];
  const mapeamento = dump?.mapeamento_categorias && typeof dump.mapeamento_categorias === 'object' ? dump.mapeamento_categorias : {};
  const snapshot = validarManifestoSnapshot(dump ?? {}, rot);
  // ID repetido torna o Map ambíguo: o lote vira `null` (nunca "a última
  // linha vence") e todo movimento que o cite fica sem prova.
  const contagemIds = (lista) => lista.reduce((mp, x) => mp.set(x.id, (mp.get(x.id) ?? 0) + 1), new Map());
  const idsLote = contagemIds(lotes);
  const idsMov = contagemIds(movs);
  const idVazio = (id) => id === undefined || id === null || String(id).trim() === '';
  /** @type {Map<unknown, Record<string, any> | null>} */
  const lotePorId = new Map();
  for (const l of lotes) if (!idVazio(l.id)) lotePorId.set(l.id, idsLote.get(l.id) > 1 ? null : l);

  /** @type {Map<string, { empresa: string, area: string, categoria: string, entradas: number, transf_in: number, transf_out: number, observada: number }>} */
  const linhas = new Map();
  const linha = (empresa, area, categoria) => {
    const k = `${empresa}|${area}|${categoria}`;
    if (!linhas.has(k)) linhas.set(k, { empresa, area, categoria, entradas: 0, transf_in: 0, transf_out: 0, observada: 0 });
    return /** @type {any} */ (linhas.get(k));
  };
  /** @type {Array<Record<string, unknown> & { empresa: string | null, impeditiva: boolean }>} */
  const suspeitas = [];
  /** @type {Array<Record<string, unknown> & { empresa: string | null, impeditiva: boolean }>} */
  const quarentena = [];
  /** @type {Array<Record<string, unknown>>} */
  const lotesGerados = [];
  /** @type {Array<{ movimentacao: string | null, fonte: 'evento' | 'lote_estavel' | 'mapeamento', categoria: string, texto?: string }>} */
  const proveniencia = [];
  const suspeitar = (empresa, tipo, impeditiva, extra = {}) => suspeitas.push({ tipo, empresa, impeditiva, ...extra });
  const quarentenar = (empresa, motivo, impeditiva, extra = {}) => quarentena.push({ motivo, empresa, impeditiva, ...extra });

  for (const [id, n] of idsLote) if (!idVazio(id) && n > 1) quarentenar(null, 'lote_id_duplicado', true, { lote: rot(id), ocorrencias: n });
  for (const [id, n] of idsMov) if (!idVazio(id) && n > 1) quarentenar(null, 'movimentacao_id_duplicada', true, { movimentacao: rot(id), ocorrencias: n });

  for (const lote of lotes) {
    if (idVazio(lote.id)) quarentenar(rot(lote.empresa_id), 'lote_id_ausente', true, {});
    const empresa = rot(lote.empresa_id);
    if (!empresa) {
      // Sem empresa não há linha onde contar: nunca vira sucesso silencioso.
      quarentenar(null, 'empresa_ausente', true, { lote: rot(lote.id) });
      continue;
    }
    const classe = classificarOrigemLote(lote.origem);
    const ehEntrada = classe === 'cadastro' || classe === 'nascimento';

    if (!ehEntrada) {
      lotesGerados.push({ lote: rot(lote.id), classe, quantidade_entrada: inteiroPositivoEstrito(lote.quantidade_entrada), area_entrada: rot(lote.area_entrada_id) });
      if (classe !== 'derivado_movimento') quarentenar(empresa, `lote_${classe}_sem_evento_no_l1`, true, { lote: rot(lote.id) });
    } else {
      const q = inteiroPositivoEstrito(lote.quantidade_entrada);
      const cat = categoriaHistoricaDaEntrada(lote);
      if (q === null) {
        quarentenar(empresa, 'quantidade_entrada_invalida', true, { lote: rot(lote.id), valor: lote.quantidade_entrada ?? null });
      } else if (!lote.area_entrada_id) {
        quarentenar(empresa, 'entrada_sem_area', true, { lote: rot(lote.id) });
      } else {
        // Categoria histórica não comprovável: a entrada é real e CONTA (sob a
        // chave textual), mas a linha fica impeditiva para backfill.
        const chave = cat.confiavel ? /** @type {string} */ (cat.chave) : `texto:${semAcento(lote.categoria_entrada ?? lote.categoria) || 'SEM_TEXTO'}`;
        if (!cat.confiavel) suspeitar(empresa, 'categoria_somente_texto', true, { lote: rot(lote.id), onde: 'entrada' });
        linha(empresa, rot(lote.area_entrada_id), chave).entradas += q;
        if (classe === 'nascimento') quarentenar(empresa, 'nascimento_sem_contrato_l1', true, { lote: rot(lote.id), quantidade: q });
        if (STATUS_COM_CARA_DE_ANULACAO.has(semAcento(lote.status))) {
          quarentenar(empresa, 'status_de_anulacao_sem_prova_formal', true, { lote: rot(lote.id), status: lote.status });
        }
      }
    }

    if (lote.categoria_manejo_entrada_id && lote.categoria_manejo_id && lote.categoria_manejo_entrada_id !== lote.categoria_manejo_id) {
      suspeitar(empresa, 'mudanca_categoria_nao_suportada', true, { lote: rot(lote.id) });
    }

    if (ehAtivo(lote) && lote.area_atual_id) {
      const qAtual = lote.quantidade_cabecas === 0 || lote.quantidade_cabecas === '0' ? 0 : inteiroPositivoEstrito(lote.quantidade_cabecas);
      if (qAtual === null) {
        quarentenar(empresa, 'quantidade_cabecas_invalida', true, { lote: rot(lote.id), valor: lote.quantidade_cabecas ?? null });
      } else if (qAtual > 0) {
        const cat = categoriaAtual(lote);
        if (!cat.confiavel) suspeitar(empresa, 'categoria_somente_texto', true, { lote: rot(lote.id), onde: 'posicao_atual' });
        linha(empresa, rot(lote.area_atual_id), cat.chave).observada += qAtual;
      }
    }
  }

  const assinaturas = new Map();
  for (const mov of movs) {
    const d = mov?.dados && typeof mov.dados === 'object' ? mov.dados : {};
    const lote = lotePorId.get(d.lote_id) ?? undefined;
    const empresa = rot(mov.empresa_id ?? lote?.empresa_id);
    if (idVazio(mov.id)) quarentenar(empresa, 'movimentacao_id_ausente', true, {});
    if (!empresa) {
      quarentenar(null, 'empresa_ausente', true, { movimentacao: rot(mov.id) });
      continue;
    }
    if (lotePorId.has(d.lote_id) && lotePorId.get(d.lote_id) === null) {
      quarentenar(empresa, 'lote_referenciado_ambiguo', true, { movimentacao: rot(mov.id), lote: rot(d.lote_id) });
      continue;
    }
    // Vínculo cruzado: movimento de uma empresa sobre lote de outra. Não
    // aplica, não "corrige" a empresa para fechar saldo.
    if (lote && mov.empresa_id && lote.empresa_id && mov.empresa_id !== lote.empresa_id) {
      quarentenar(empresa, 'movimento_empresa_divergente_do_lote', true, { movimentacao: rot(mov.id), lote: rot(d.lote_id), empresa_do_lote: rot(lote.empresa_id) });
      continue;
    }
    if (semAcento(d.tipo) !== 'TRANSFERENCIA DE AREA') {
      quarentenar(empresa, 'tipo_nao_aplicado', true, { tipo: d.tipo ?? null, movimentacao: rot(mov.id) });
      continue;
    }
    const q = inteiroPositivoEstrito(d.quantidade_animais);
    if (q === null) {
      quarentenar(empresa, 'quantidade_movimento_invalida', true, { movimentacao: rot(mov.id), valor: d.quantidade_animais ?? null });
      continue;
    }
    if (!d.area_origem_id || !d.area_destino_id) {
      quarentenar(empresa, 'transferencia_incompleta', true, { movimentacao: rot(mov.id) });
      continue;
    }
    if (d.area_origem_id === d.area_destino_id) {
      suspeitar(empresa, 'origem_igual_destino', false, { movimentacao: rot(mov.id), lote: rot(d.lote_id), quantidade: q });
      continue; // neutra no saldo; revisão manual
    }

    // Categoria do movimento (R3, fail-closed). Só três fontes contam:
    //  1. `evento`: `dados.categoria_manejo_id` com forma de ID válida e sem
    //     conflito com as categorias conhecidas do lote;
    //  2. `lote_estavel`: lote de CADASTRO com `categoria_manejo_entrada_id`
    //     presente E igual à `categoria_manejo_id` atual (prova de que não
    //     mudou). Ausência do histórico NÃO prova nada — vai para quarentena;
    //     lote derivado (MOVIMENTAÇÃO etc.) nunca serve de prova;
    //  3. `mapeamento`: texto → ID explícito, revisado por gente.
    // Sem prova: quarentena impeditiva e o movimento NÃO entra na matriz.
    /** @type {string | null} */
    let catMov = null;
    /** @type {null | { motivo: string }} */
    let recusa = null;
    const idEvento = typeof d.categoria_manejo_id === 'string' ? d.categoria_manejo_id.trim() : '';
    if (idEvento) {
      const conhecidas = new Set([lote?.categoria_manejo_entrada_id, lote?.categoria_manejo_id].filter((x) => typeof x === 'string' && x.trim()));
      if (!RE_ID_CATEGORIA.test(idEvento)) recusa = { motivo: 'categoria_do_movimento_invalida' };
      else if (conhecidas.size > 0 && !conhecidas.has(idEvento)) recusa = { motivo: 'categoria_do_movimento_conflitante' };
      else {
        catMov = `cm:${idEvento}`;
        proveniencia.push({ movimentacao: rot(mov.id), fonte: 'evento', categoria: catMov });
      }
    } else if (
      lote &&
      classificarOrigemLote(lote.origem) === 'cadastro' &&
      typeof lote.categoria_manejo_entrada_id === 'string' &&
      lote.categoria_manejo_entrada_id.trim() &&
      lote.categoria_manejo_entrada_id === lote.categoria_manejo_id
    ) {
      catMov = `cm:${lote.categoria_manejo_id}`;
      proveniencia.push({ movimentacao: rot(mov.id), fonte: 'lote_estavel', categoria: catMov });
    } else {
      const t = semAcento(d.categoria_animal ?? (lote && !lote.categoria_manejo_id && !lote.categoria_manejo_entrada_id ? lote.categoria : null));
      const mapeado = t ? mapeamento[t] : undefined;
      if (mapeado !== undefined && !(typeof mapeado === 'string' && RE_ID_CATEGORIA.test(mapeado))) {
        recusa = { motivo: 'mapeamento_categoria_invalido' };
      } else if (mapeado) {
        catMov = `cm:${mapeado}`;
        proveniencia.push({ movimentacao: rot(mov.id), fonte: 'mapeamento', categoria: catMov, texto: t });
      }
    }
    if (catMov === null) {
      quarentenar(empresa, recusa?.motivo ?? 'categoria_do_movimento_nao_comprovavel', true, { movimentacao: rot(mov.id), lote: rot(d.lote_id) });
      continue;
    }

    const assinatura = [d.lote_id, q, d.area_origem_id, d.area_destino_id, String(d.data_movimentacao ?? '').slice(0, 10)].join('|');
    const anteriores = assinaturas.get(assinatura) ?? [];
    if (anteriores.length) {
      suspeitar(empresa, 'possivel_duplicata', true, { movimentacao: rot(mov.id), igual_a: anteriores.map(rot), quantidade: q });
    }
    assinaturas.set(assinatura, [...anteriores, mov.id]);
    linha(empresa, rot(d.area_origem_id), catMov).transf_out += q;
    linha(empresa, rot(d.area_destino_id), catMov).transf_in += q;
  }

  const matriz = [...linhas.values()]
    .map((l) => {
      const esperada = l.entradas + l.transf_in - l.transf_out;
      return { ...l, esperada, lacuna: l.observada - esperada };
    })
    .sort((a, b) => `${a.empresa}|${a.area}|${a.categoria}`.localeCompare(`${b.empresa}|${b.area}|${b.categoria}`));

  for (const l of matriz) {
    if (l.esperada < 0) suspeitar(l.empresa, 'saldo_esperado_negativo', true, { area: l.area, categoria: l.categoria, esperada: l.esperada });
  }

  /** Estado: bloqueada se há item impeditivo; parcial se há qualquer lacuna/suspeita/quarentena. */
  const estadoDe = (lacunas, itens) =>
    itens.some((i) => i.impeditiva) ? 'bloqueada_para_backfill' : lacunas > 0 || itens.length > 0 ? 'reconciliacao_parcial' : 'conciliada';
  const contar = (lista, campo) => lista.reduce((m, i) => ({ ...m, [String(i[campo])]: (m[String(i[campo])] ?? 0) + 1 }), /** @type {Record<string, number>} */ ({}));

  // Toda empresa citada em matriz, quarentena OU suspeita entra (inclusive a
  // "sem empresa"): nenhuma linha órfã sai como sucesso.
  const empresas = [...new Set([...matriz.map((l) => l.empresa), ...quarentena.map((q) => q.empresa), ...suspeitas.map((s) => s.empresa)])].sort((a, b) =>
    String(a ?? '').localeCompare(String(b ?? ''))
  );
  /**
   * Aptidão para backfill — FAIL-CLOSED: true só com estado `conciliada`, zero
   * lacunas, zero suspeitas, zero quarentena, empresa identificada e dados
   * presentes. Mesmo `true` não executa nada: é só o pré-requisito mínimo
   * para uma revisão humana (contrato §5).
   */
  const aptoMatematico = ({ empresa, estado, lacunas, qs, ss, linhasMatriz }) =>
    empresa !== null && estado === 'conciliada' && lacunas === 0 && qs === 0 && ss === 0 && linhasMatriz > 0;
  const porEmpresa = empresas.map((empresa) => {
    const m = matriz.filter((l) => l.empresa === empresa);
    const qs = quarentena.filter((q) => q.empresa === empresa);
    const ss = suspeitas.filter((s) => s.empresa === empresa);
    const lacunas = m.filter((l) => l.lacuna !== 0).length;
    const totalEntradas = m.reduce((t, l) => t + l.entradas, 0);
    const totalObservado = m.reduce((t, l) => t + l.observada, 0);
    const estado = estadoDe(lacunas, [...qs, ...ss]);
    const apto_matematico = aptoMatematico({ empresa, estado, lacunas, qs: qs.length, ss: ss.length, linhasMatriz: m.length });
    const noEscopo = empresa !== null && snapshot.escopoEmpresasRotuladas.has(empresa);
    return {
      empresa: empresa ?? '(sem_empresa)',
      estado,
      // R4: conta conciliada SEM snapshot comprovado nunca é apta.
      apto_matematico,
      apto_para_backfill: apto_matematico && snapshot.valido && noEscopo,
      total_entradas: totalEntradas,
      total_observado: totalObservado,
      diferenca_total: totalObservado - totalEntradas,
      linhas_com_lacuna: lacunas,
      quarentena_por_motivo: contar(qs, 'motivo'),
      suspeitas_por_tipo: contar(ss, 'tipo'),
    };
  });

  const totalEntradas = matriz.reduce((t, l) => t + l.entradas, 0);
  const totalObservado = matriz.reduce((t, l) => t + l.observada, 0);
  const lacunasTotais = matriz.filter((l) => l.lacuna !== 0).length;
  const estadoGeral = lotes.length === 0 ? 'sem_dados' : estadoDe(lacunasTotais, [...quarentena, ...suspeitas]);
  const aptoMatematicoGeral =
    estadoGeral === 'conciliada' && porEmpresa.length > 0 && porEmpresa.every((e) => e.apto_matematico) && lacunasTotais === 0 && quarentena.length === 0 && suspeitas.length === 0;
  /** Motivos estáveis de a aptidão ser false (vazio só quando apta). */
  const motivosBloqueio = [
    ...(estadoGeral === 'sem_dados' ? ['sem_dados'] : []),
    ...(!aptoMatematicoGeral && estadoGeral !== 'sem_dados' ? ['reconciliacao_nao_conciliada'] : []),
    ...snapshot.impedimentos.map((i) => i.codigo),
  ];
  const snapshotPublico = { ...snapshot };
  delete snapshotPublico.escopoEmpresasRotuladas;
  return {
    modo: 'somente-leitura',
    estado: estadoGeral,
    apto_matematico: aptoMatematicoGeral,
    apto_para_backfill: aptoMatematicoGeral && snapshot.valido && porEmpresa.every((e) => e.apto_para_backfill),
    motivos_bloqueio_backfill: [...new Set(motivosBloqueio)],
    snapshot: snapshotPublico,
    resumo: {
      lotes: lotes.length,
      movimentacoes: movs.length,
      total_entradas: totalEntradas,
      total_observado: totalObservado,
      diferenca_total: totalObservado - totalEntradas,
      linhas_com_lacuna: lacunasTotais,
      suspeitas: suspeitas.length,
      quarentena: quarentena.length,
      itens_impeditivos: [...quarentena, ...suspeitas].filter((i) => i.impeditiva).length,
      lotes_gerados_pelo_legado: lotesGerados.length,
    },
    por_empresa: porEmpresa,
    matriz,
    suspeitas,
    quarentena,
    lotes_gerados_pelo_legado: lotesGerados,
    proveniencia_categoria_movimento: proveniencia,
    categorias_por_mapeamento: proveniencia.filter((p) => p.fonte === 'mapeamento').map((p) => ({ movimentacao: p.movimentacao, texto: p.texto })),
  };
};
