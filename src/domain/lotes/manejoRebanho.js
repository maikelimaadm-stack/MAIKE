/**
 * Corpo do comando atômico do rebanho (R2B-P1, D-PROD-101) a partir dos
 * formulários do Mapa. Funções puras: nada de rede, cache ou React.
 *
 * O navegador só DESCREVE a intenção (linhas, ids, pesos digitados). Cabeças,
 * categorias de destino, lotes de filhotes e derivados são decididos pelo
 * servidor numa transação — nada aqui é verdade sobre saldo.
 */

export const NASCIMENTO = 'Nascimento';
export const JUNCAO = 'Junção de Lotes';
export const PESAGEM = 'Pesagem';
export const MUDANCA_CATEGORIA = 'Mudança de Categoria';
export const TIPOS_MANEJO_REBANHO = Object.freeze([NASCIMENTO, PESAGEM, MUDANCA_CATEGORIA]);

const SEM_CATEGORIA = 'SEM CATEGORIA';

/** Política materna (PR168-R2) — espelho de `CATEGORIAS_MATERNAS` do servidor. */
export const CATEGORIAS_MATERNAS = Object.freeze(['Vaca 25 a 36 meses', 'Vaca + 36 meses', 'Novilha 13 a 24 meses']);
const semAcento = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
/** Lote pode ser "categoria da mãe"? Categoria oficial de matriz E sexo Fêmea. */
export const ehLoteDeMatriz = (lote) =>
  CATEGORIAS_MATERNAS.some((c) => semAcento(c) === semAcento(lote?.categoria)) && semAcento(lote?.sexo) === 'FEMEA';

const numeroPositivo = (valor) => {
  const n = typeof valor === 'number' ? valor : parseFloat(String(valor ?? ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Meio-dia UTC da data local (mesma convenção dos demais manejos). */
export const dataOperacional = (data) => `${String(data).slice(0, 10)}T12:00:00.000Z`;

const base = ({ tipo, empresaId, areaId, data, observacoes }) => ({
  tipo,
  empresa_id: empresaId,
  area_id: areaId,
  data_movimentacao: dataOperacional(data),
  ...(typeof observacoes === 'string' && observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
});

/**
 * @param {{ empresaId: string, areaId: string, formData: { data_nascimento: string, observacoes?: string,
 *   linhas: Array<{ categoria_mae: string, quantidade: number, sexo: string, peso_medio?: number|null }> } }} p
 */
export const corpoNascimento = ({ empresaId, areaId, formData }) => ({
  ...base({ tipo: NASCIMENTO, empresaId, areaId, data: formData.data_nascimento, observacoes: formData.observacoes }),
  linhas: (formData.linhas || []).map((l) => ({
    sexo: l.sexo,
    categoria_mae: l.categoria_mae,
    quantidade: Number(l.quantidade),
    peso_medio_kg: numeroPositivo(l.peso_medio),
  })),
});

/**
 * Pesagem nos três modos do formulário. Cada lote recebe a SUA linha (lotes da
 * mesma categoria nunca viram "um lote só"). No modo por lote, só entram os
 * lotes com peso digitado — nada de peso da categoria como substituto.
 *
 * @param {{ empresaId: string, areaId: string, lotes: any[], formData: any }} p
 */
export const corpoPesagem = ({ empresaId, areaId, lotes, formData }) => {
  const elegiveis = (lotes || []).filter((l) => l?.status === 'Ativo' && Number(l.quantidade_cabecas) > 0 && l.area_atual_id === areaId);
  const modo = formData.modo === 'todos' ? 'todos' : formData.modo === 'por_lote' ? 'por_lote' : 'por_categoria';
  /** @type {Array<{lote_id: string, categoria?: string, peso_medio_kg: number}>} */
  const linhas = [];
  if (modo === 'por_lote') {
    for (const [loteId, valor] of Object.entries(formData.pesos_por_lote || {})) {
      const peso = numeroPositivo(valor);
      if (peso === null) continue;
      linhas.push({ lote_id: loteId, peso_medio_kg: peso });
    }
  } else {
    for (const categoria of formData.categorias_selecionadas || []) {
      const peso = numeroPositivo((formData.pesos_por_categoria || {})[categoria]);
      if (peso === null) continue;
      for (const lote of elegiveis.filter((l) => (l.categoria || SEM_CATEGORIA) === categoria)) {
        linhas.push({ lote_id: lote.id, ...(lote.categoria ? { categoria: lote.categoria } : {}), peso_medio_kg: peso });
      }
    }
  }
  return {
    ...base({ tipo: PESAGEM, empresaId, areaId, data: formData.data_pesagem, observacoes: formData.observacoes }),
    modo_pesagem: modo,
    linhas,
  };
};

/**
 * @param {{ empresaId: string, areaId: string, formData: { data_mudanca: string, observacoes?: string, mudancas: any[] } }} p
 */
export const corpoMudancaCategoria = ({ empresaId, areaId, formData }) => ({
  ...base({ tipo: MUDANCA_CATEGORIA, empresaId, areaId, data: formData.data_mudanca, observacoes: formData.observacoes }),
  linhas: (formData.mudancas || []).map((m) => ({
    categoria_atual: m.categoria_atual,
    categoria_nova: m.categoria_nova,
    quantidade: Number(m.quantidade),
    ...(m.categoria_manejo_id_novo ? { categoria_manejo_id_novo: m.categoria_manejo_id_novo } : {}),
    peso_medio_kg: numeroPositivo(m.peso_medio),
  })),
});

/**
 * Junção de Lotes (R2C-P1): só ids, data e observação — saldo, peso e efeitos
 * são do servidor.
 * @param {{ empresaId: string, areaId: string, principalId: string, origemIds: string[], data: string, observacoes?: string }} p
 */
export const corpoJuncao = ({ empresaId, areaId, principalId, origemIds, data, observacoes }) => ({
  empresa_id: empresaId,
  area_id: areaId,
  lote_principal_id: principalId,
  lote_origem_ids: [...new Set(origemIds)].filter((id) => id && id !== principalId),
  data_movimentacao: dataOperacional(data),
  ...(typeof observacoes === 'string' && observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
});

/** Prévia da junção na tela (o servidor recalcula): total e se o peso médio é demonstrável. */
export const previaJuncao = (lotes) => {
  const lista = Array.isArray(lotes) ? lotes : [];
  const total = lista.reduce((t, l) => t + (Number(l?.quantidade_cabecas) || 0), 0);
  const pesoConhecido = lista.length > 0 && lista.every((l) => typeof l?.peso_medio_kg === 'number' && Number.isFinite(l.peso_medio_kg));
  const pesoMedio = pesoConhecido && total > 0 ? Number((lista.reduce((t, l) => t + l.quantidade_cabecas * l.peso_medio_kg, 0) / total).toFixed(2)) : null;
  return { total, pesoConhecido, pesoMedio };
};

/** Lotes de matrizes considerados no nascimento (categoria/área; não é a mãe individual). */
export const idsDeMatrizesDoMovimento = (mov) => [
  ...new Set((Array.isArray(mov?.linhas) ? mov.linhas : []).flatMap((l) => (Array.isArray(l?.maes_lote_ids) ? l.maes_lote_ids : [])).filter((id) => typeof id === 'string' && id)),
];

/** Participantes de um movimento (agregado R2B ou simples): primário + `lote_ids` + efeitos. */
export const idsDeLotesDoMovimento = (mov) => {
  const ids = new Set();
  if (typeof mov?.lote_id === 'string' && mov.lote_id) ids.add(mov.lote_id);
  for (const id of Array.isArray(mov?.lote_ids) ? mov.lote_ids : []) if (typeof id === 'string' && id) ids.add(id);
  for (const ef of Array.isArray(mov?.efeito_servidor?.efeitos) ? mov.efeito_servidor.efeitos : []) {
    if (typeof ef?.lote_id === 'string' && ef.lote_id) ids.add(ef.lote_id);
  }
  return [...ids];
};

const kg = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${Number(v.toFixed(2))} kg` : '—');

/** Linhas legíveis do movimento agregado para o histórico (uma string por linha). */
export const descreverLinhasDoMovimento = (mov) => {
  const linhas = Array.isArray(mov?.linhas) ? mov.linhas : [];
  if (mov?.tipo === NASCIMENTO) {
    return linhas.map(
      (l) => `${l.quantidade} ${l.sexo === 'Macho' ? 'macho(s)' : 'fêmea(s)'} de ${l.categoria_mae} → ${l.categoria_filhote}${l.peso_medio_kg ? ` (${kg(l.peso_medio_kg)})` : ''}${l.lote_criado ? ' · lote novo' : ''}`
    );
  }
  if (mov?.tipo === PESAGEM) {
    return linhas.map(
      (l) => `${l.lote_nome} (${l.quantidade_cabecas} cab): ${kg(l.peso_anterior_kg)} → ${kg(l.peso_novo_kg)}${typeof l.ganho_kg === 'number' ? ` (${l.ganho_kg >= 0 ? '+' : ''}${kg(l.ganho_kg)})` : ''}`
    );
  }
  if (mov?.tipo === JUNCAO) {
    const j = mov.juncao || {};
    const saida = linhas.map((l) => `${l.nome} (${l.quantidade} cab${typeof l.peso_medio_kg === 'number' ? `, ${kg(l.peso_medio_kg)}` : ', peso desconhecido'}) → ${j.principal?.nome || mov.lote || 'lote principal'}`);
    if (j.principal) {
      saida.push(`${j.principal.nome}: ${j.principal.quantidade_antes} → ${j.principal.quantidade_depois} cab`);
      saida.push(j.politica_peso === 'media_ponderada' ? `Peso médio: ${kg(j.principal.peso_antes_kg)} → ${kg(j.principal.peso_depois_kg)}` : 'Peso médio não demonstrável (algum lote sem peso): ficou sem peso');
    }
    return saida;
  }
  if (mov?.tipo === MUDANCA_CATEGORIA) {
    return linhas.map((l) => {
      const partes = (l.partes || []).map((p) => (p.modo === 'total' ? `${p.quantidade} no mesmo lote` : `${p.quantidade} para lote novo`)).join(', ');
      return `${l.quantidade} de ${l.categoria_atual} → ${l.categoria_nova}${l.categoria_manejo_nome ? ` (${l.categoria_manejo_nome})` : ''}${partes ? ` · ${partes}` : ''}`;
    });
  }
  return [];
};
