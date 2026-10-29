/**
 * Reconciliação READ-ONLY do estoque pecuário legado (Lote + MovimentacaoMapa)
 * contra o contrato do ledger (L1). Função PURA: recebe um dump já carregado
 * e devolve a matriz; não abre banco, não escreve, não "conserta" nada.
 *
 * Regras (CONTRATO.md §G):
 *  - ENTRADA = Lote cujo `origem` NÃO é "MOVIMENTAÇÃO" e não está cancelado;
 *    conta `quantidade_entrada` na `area_entrada_id` (fato histórico).
 *  - Lote com origem "MOVIMENTAÇÃO" é efeito colateral de movimento parcial do
 *    legado — NUNCA conta como compra; vai para a lista de gerados.
 *  - Só "Transferência de Área" é aplicada (−origem / +destino). Outros tipos
 *    (morte, abate, nascimento, junção, pesagem, mudança de categoria) têm
 *    semântica de saldo não comprovada no legado → QUARENTENA (revisão manual).
 *  - Posição observada = soma de `quantidade_cabecas` dos lotes ativos em
 *    `area_atual_id`. Lacuna = observada − esperada.
 *  - Suspeitas: movimento com origem == destino (self-target), duplicatas por
 *    assinatura (lote, quantidade, origem, destino, data), saldo esperado
 *    negativo, categoria só textual (sem categoria_manejo_id).
 *  - IDs saem com hash curto por padrão; nomes de pessoas/usuários nunca saem.
 */

import { createHash } from 'node:crypto';

const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
const ehMovimentacaoGerada = (lote) => semAcento(lote?.origem) === 'MOVIMENTACAO';
const ehCancelado = (lote) => ['CANCELADO', 'INATIVO', 'EXCLUIDO'].includes(semAcento(lote?.status));
const ehAtivo = (lote) => semAcento(lote?.status || 'ATIVO') === 'ATIVO';
const inteiro = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
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

/**
 * Chave de categoria do legado: ID de CategoriaManejo quando existe; texto
 * marcado como `texto:` (não canônico, vira suspeita) quando só há nome.
 * @param {Record<string, any> | undefined} lote
 * @param {unknown} categoriaTexto
 */
const chaveCategoria = (lote, categoriaTexto) => {
  if (lote?.categoria_manejo_id) return { chave: `cm:${lote.categoria_manejo_id}`, canonica: true };
  const t = semAcento(categoriaTexto ?? lote?.categoria);
  return t ? { chave: `texto:${t}`, canonica: false } : { chave: 'SEM_CATEGORIA', canonica: true };
};

/**
 * @param {{ lotes?: Array<Record<string, any>>, movimentacoes_mapa?: Array<Record<string, any>> }} dump
 * @param {{ mostrarIds?: boolean }} [opcoes]
 */
export const auditarLedgerPecuario = (dump, opcoes = {}) => {
  const rot = fabricaRotulo(opcoes.mostrarIds === true);
  const lotes = Array.isArray(dump?.lotes) ? dump.lotes : [];
  const movs = Array.isArray(dump?.movimentacoes_mapa) ? dump.movimentacoes_mapa : [];
  const lotePorId = new Map(lotes.map((l) => [l.id, l]));

  /** @type {Map<string, { empresa: string, area: string, categoria: string, entradas: number, transf_in: number, transf_out: number, observada: number }>} */
  const linhas = new Map();
  const linha = (empresa, area, categoria) => {
    const k = `${empresa}|${area}|${categoria}`;
    if (!linhas.has(k)) linhas.set(k, { empresa, area, categoria, entradas: 0, transf_in: 0, transf_out: 0, observada: 0 });
    return /** @type {any} */ (linhas.get(k));
  };
  /** @type {Array<Record<string, unknown>>} */
  const suspeitas = [];
  /** @type {Array<Record<string, unknown>>} */
  const quarentena = [];
  /** @type {Array<Record<string, unknown>>} */
  const lotesGerados = [];
  const categoriasTextuais = new Set();

  for (const lote of lotes) {
    const cat = chaveCategoria(lote, lote.categoria_entrada ?? lote.categoria);
    if (!cat.canonica) categoriasTextuais.add(cat.chave);
    if (ehMovimentacaoGerada(lote)) {
      lotesGerados.push({ lote: rot(lote.id), quantidade_entrada: inteiro(lote.quantidade_entrada), area_entrada: rot(lote.area_entrada_id) });
    } else if (!ehCancelado(lote)) {
      const q = inteiro(lote.quantidade_entrada);
      if (!(q > 0) || !lote.area_entrada_id) {
        quarentena.push({ motivo: 'entrada_sem_quantidade_ou_area', lote: rot(lote.id) });
      } else {
        linha(rot(lote.empresa_id), rot(lote.area_entrada_id), cat.chave).entradas += q;
      }
    }
    if (ehAtivo(lote) && lote.area_atual_id) {
      const catAtual = chaveCategoria(lote, lote.categoria);
      const q = inteiro(lote.quantidade_cabecas);
      if (q > 0) linha(rot(lote.empresa_id), rot(lote.area_atual_id), catAtual.chave).observada += q;
    }
  }

  const assinaturas = new Map();
  for (const mov of movs) {
    const d = mov?.dados && typeof mov.dados === 'object' ? mov.dados : {};
    const tipo = semAcento(d.tipo);
    const q = inteiro(d.quantidade_animais);
    const lote = lotePorId.get(d.lote_id);
    const cat = chaveCategoria(lote, d.categoria_animal);
    if (!cat.canonica) categoriasTextuais.add(cat.chave);
    const empresa = rot(mov.empresa_id ?? lote?.empresa_id);

    if (tipo !== 'TRANSFERENCIA DE AREA') {
      quarentena.push({ motivo: 'tipo_nao_aplicado', tipo: d.tipo ?? null, movimentacao: rot(mov.id), quantidade: Number.isNaN(q) ? null : q });
      continue;
    }
    if (!(q > 0) || !d.area_origem_id || !d.area_destino_id) {
      quarentena.push({ motivo: 'transferencia_incompleta', movimentacao: rot(mov.id) });
      continue;
    }
    if (d.area_origem_id === d.area_destino_id) {
      suspeitas.push({ tipo: 'origem_igual_destino', movimentacao: rot(mov.id), lote: rot(d.lote_id), quantidade: q });
      continue; // neutra no saldo; registrada para revisão
    }
    const assinatura = [d.lote_id, q, d.area_origem_id, d.area_destino_id, String(d.data_movimentacao ?? '').slice(0, 10)].join('|');
    const anteriores = assinaturas.get(assinatura) ?? [];
    if (anteriores.length) {
      suspeitas.push({ tipo: 'possivel_duplicata', movimentacao: rot(mov.id), igual_a: anteriores.map(rot), quantidade: q });
    }
    assinaturas.set(assinatura, [...anteriores, mov.id]);
    linha(empresa, rot(d.area_origem_id), cat.chave).transf_out += q;
    linha(empresa, rot(d.area_destino_id), cat.chave).transf_in += q;
  }

  const matriz = [...linhas.values()]
    .map((l) => {
      const esperada = l.entradas + l.transf_in - l.transf_out;
      return { ...l, esperada, lacuna: l.observada - esperada };
    })
    .sort((a, b) => `${a.empresa}|${a.area}|${a.categoria}`.localeCompare(`${b.empresa}|${b.area}|${b.categoria}`));

  for (const l of matriz) {
    if (l.esperada < 0) suspeitas.push({ tipo: 'saldo_esperado_negativo', empresa: l.empresa, area: l.area, categoria: l.categoria, esperada: l.esperada });
  }
  for (const c of categoriasTextuais) suspeitas.push({ tipo: 'categoria_somente_texto', categoria: c });

  const totalEntradas = matriz.reduce((t, l) => t + l.entradas, 0);
  const totalObservado = matriz.reduce((t, l) => t + l.observada, 0);
  return {
    modo: 'somente-leitura',
    resumo: {
      lotes: lotes.length,
      movimentacoes: movs.length,
      total_entradas: totalEntradas,
      total_observado: totalObservado,
      diferenca_total: totalObservado - totalEntradas,
      linhas_com_lacuna: matriz.filter((l) => l.lacuna !== 0).length,
      suspeitas: suspeitas.length,
      quarentena: quarentena.length,
      lotes_gerados_por_movimento: lotesGerados.length,
    },
    matriz,
    suspeitas,
    quarentena,
    lotes_gerados_por_movimento: lotesGerados,
  };
};
