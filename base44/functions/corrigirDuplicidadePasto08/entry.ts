import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const EMPRESA_ID = '6919a4e8e69d63214d9356b8';
const AREA_KM_08_ID = '6995d17c690d6cacd330caa2';
const AREA_KM_08_C_ID = '6995d1865e49ff16dab0a274';
const AREA_CURRAL_ID = '69e7696f25714a2a820b369a';
const QUANTIDADE_DUPLICADA = 63;

function num(value) {
  return Number(value || 0);
}

function isBezerros(lote) {
  return String(lote.nome || '').toUpperCase().includes('BEZERRO');
}

function sameDay(value, target) {
  return String(value || '').slice(0, 10) === target;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const payload = await req.json().catch(() => ({}));
    const apply = payload.apply === true;

    const [lotesAll, movsAll] = await Promise.all([
      base44.asServiceRole.entities.Lote.list(),
      base44.asServiceRole.entities.MovimentacaoMapa.list(),
    ]);

    const lotesKm08 = lotesAll
      .filter((lote) => lote.empresa_id === EMPRESA_ID)
      .filter((lote) => lote.area_atual_id === AREA_KM_08_C_ID || lote.area_atual_nome === 'KM - 08 C' || lote.id === '69e22b4e68fbec70f61e8a17' || lote.id === '6a0b11714d44a24c5027428c')
      .filter((lote) => isBezerros(lote));

    const loteAtivo253 = lotesKm08.find((lote) => lote.status === 'Ativo' && num(lote.quantidade_cabecas) === QUANTIDADE_DUPLICADA);
    const lotesDuplicados = lotesKm08.filter((lote) => lote.id !== loteAtivo253?.id && num(lote.quantidade_cabecas) > 0);

    const movsSuspeitas = movsAll
      .filter((mov) => mov.empresa_id === EMPRESA_ID)
      .filter((mov) => mov.tipo === 'Transferência de Área')
      .filter((mov) => mov.area_origem_id === AREA_KM_08_C_ID || mov.area_destino_id === AREA_KM_08_C_ID || mov.area_origem_nome === 'KM - 08 C' || mov.area_destino_nome === 'KM - 08 C' || mov.area_origem_id === AREA_CURRAL_ID || mov.area_destino_id === AREA_CURRAL_ID || mov.area_origem_nome === 'CURRAL' || mov.area_destino_nome === 'CURRAL')
      .filter((mov) => sameDay(mov.data_movimentacao, '2026-05-14') || sameDay(mov.created_date, '2026-05-18'))
      .map((mov) => ({
        id: mov.id,
        lote_id: mov.lote_id,
        lote: mov.lote,
        quantidade_animais: mov.quantidade_animais,
        area_origem_nome: mov.area_origem_nome,
        area_destino_nome: mov.area_destino_nome,
        data_movimentacao: mov.data_movimentacao,
        created_date: mov.created_date,
        observacoes: mov.observacoes,
      }));

    const movsKm08 = movsAll
      .filter((mov) => mov.empresa_id === EMPRESA_ID)
      .filter((mov) => mov.tipo === 'Transferência de Área')
      .filter((mov) => mov.area_origem_id === AREA_KM_08_C_ID || mov.area_destino_id === AREA_KM_08_C_ID || mov.area_origem_nome === 'KM - 08 C' || mov.area_destino_nome === 'KM - 08 C')
      .map((mov) => ({
        id: mov.id,
        lote_id: mov.lote_id,
        lote: mov.lote,
        quantidade_animais: mov.quantidade_animais,
        area_origem_nome: mov.area_origem_nome,
        area_destino_nome: mov.area_destino_nome,
        data_movimentacao: mov.data_movimentacao,
        created_date: mov.created_date,
        observacoes: mov.observacoes,
      }));

    const movimentosDuplicadosKm08 = movsKm08.filter((mov) =>
      mov.area_origem_nome === 'KM - 08 C' &&
      mov.area_destino_nome === 'CURRAL' &&
      Number(mov.quantidade_animais || 0) === QUANTIDADE_DUPLICADA
    );

    const totalKm08Antes = lotesKm08.reduce((sum, lote) => sum + num(lote.quantidade_cabecas), 0);
    const actions = [];

    if (loteAtivo253) {
      actions.push({ type: 'zerar_saldo_indevido_km_08_c', id: loteAtivo253.id, nome: loteAtivo253.nome, quantidade: loteAtivo253.quantidade_cabecas, status_atual: loteAtivo253.status });
      if (apply) {
        await base44.asServiceRole.entities.Lote.update(loteAtivo253.id, {
          quantidade_cabecas: 0,
          status: 'Inativo',
          observacoes: `${loteAtivo253.observacoes || ''}\nZerado automaticamente para remover saldo duplicado de 63 cabeças no KM - 08 C, mantendo o saldo no CURRAL em 2026-05-18.`.trim(),
        });
      }
    }

    if (lotesDuplicados.length > 0) {
      for (const lote of lotesDuplicados) {
        actions.push({ type: 'manter_lote_duplicado_ja_zerado', id: lote.id, nome: lote.nome, quantidade: lote.quantidade_cabecas, status_atual: lote.status });
      }
    }

    const lotesDepois = apply ? await base44.asServiceRole.entities.Lote.list() : lotesAll;
    const totalKm08Depois = lotesDepois
      .filter((lote) => lote.empresa_id === EMPRESA_ID)
      .filter((lote) => lote.area_atual_id === AREA_KM_08_C_ID || lote.area_atual_nome === 'KM - 08 C' || lote.id === '69e22b4e68fbec70f61e8a17' || lote.id === '6a0b11714d44a24c5027428c')
      .filter((lote) => isBezerros(lote))
      .reduce((sum, lote) => sum + num(lote.quantidade_cabecas), 0);

    return Response.json({
      apply,
      totalKm08Antes,
      totalKm08Depois,
      loteMantido: loteAtivo253 ? { id: loteAtivo253.id, nome: loteAtivo253.nome, quantidade: loteAtivo253.quantidade_cabecas, status: loteAtivo253.status } : null,
      lotesKm08: lotesKm08.map((lote) => ({ id: lote.id, nome: lote.nome, quantidade: lote.quantidade_cabecas, status: lote.status, origem: lote.origem, created_date: lote.created_date })),
      movimentacoesKm08: movsKm08,
      movimentosDuplicadosKm08,
      movimentacoesSuspeitas: movsSuspeitas,
      actions,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});