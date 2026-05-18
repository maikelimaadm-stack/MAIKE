import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const norm = (value) => String(value || '').trim().toUpperCase();
const isKm08 = (name) => norm(name).includes('KM - 08');
const isKm08C = (name) => norm(name).includes('KM - 08 C');
const isCurral = (name) => norm(name).includes('CURRAL');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { apply = false, empresaId = null } = await req.json().catch(() => ({}));

    const [lotesAll, movsAll] = await Promise.all([
      base44.asServiceRole.entities.Lote.list(),
      base44.asServiceRole.entities.MovimentacaoMapa.list('-created_date'),
    ]);

    const lotes = lotesAll.filter((lote) => !empresaId || lote.empresa_id === empresaId);
    const movs = movsAll.filter((mov) => !empresaId || mov.empresa_id === empresaId);

    const lotesBezerrosAtivos = lotes
      .filter((lote) => norm(lote.nome) === 'BEZERROS' && lote.status === 'Ativo' && Number(lote.quantidade_cabecas || 0) > 0)
      .map((lote) => ({
        id: lote.id,
        nome: lote.nome,
        area_atual_nome: lote.area_atual_nome,
        area_atual_id: lote.area_atual_id,
        categoria: lote.categoria,
        quantidade_cabecas: Number(lote.quantidade_cabecas || 0),
        origem: lote.origem,
        created_date: lote.created_date,
        updated_date: lote.updated_date,
      }));

    const lotesKm08 = lotesBezerrosAtivos.filter((lote) => isKm08(lote.area_atual_nome));
    const lotesKm08C = lotesBezerrosAtivos.filter((lote) => isKm08C(lote.area_atual_nome));
    const lotesCurral = lotesBezerrosAtivos.filter((lote) => isCurral(lote.area_atual_nome));
    const lotesRelacionados = lotes
      .filter((lote) => norm(lote.nome) === 'BEZERROS')
      .filter((lote) => isKm08C(lote.area_atual_nome) || isCurral(lote.area_atual_nome) || lote.id === '69e22b4e68fbec70f61e8a17')
      .map((lote) => ({
        id: lote.id,
        area_atual_nome: lote.area_atual_nome,
        quantidade_cabecas: Number(lote.quantidade_cabecas || 0),
        status: lote.status,
        origem: lote.origem,
        created_date: lote.created_date,
        updated_date: lote.updated_date,
      }));

    const movsKm08C = movs
      .filter((mov) => norm(mov.lote) === 'BEZERROS')
      .filter((mov) => isKm08C(mov.area_origem_nome) || isKm08C(mov.area_destino_nome))
      .slice(0, 50)
      .map((mov) => ({
        id: mov.id,
        lote_id: mov.lote_id,
        tipo: mov.tipo,
        quantidade_animais: Number(mov.quantidade_animais || 0),
        area_origem_nome: mov.area_origem_nome,
        area_destino_nome: mov.area_destino_nome,
        categoria_animal: mov.categoria_animal,
        data_movimentacao: mov.data_movimentacao,
        created_date: mov.created_date,
        observacoes: mov.observacoes,
      }));

    const movimentosRetornoCurral = movsKm08C.filter((mov) => isKm08C(mov.area_origem_nome) && isCurral(mov.area_destino_nome));
    const movimentosEntradaKm08C = movsKm08C.filter((mov) => isCurral(mov.area_origem_nome) && isKm08C(mov.area_destino_nome));

    const suspeitas = [];
    if (lotesKm08C.length > 0 && movimentosRetornoCurral.length === 0) {
      suspeitas.push('Existe saldo ativo no KM - 08 C, mas não existe mais a movimentação de retorno KM - 08 C → CURRAL.');
    }
    if (lotesKm08C.length > 0 && lotesCurral.length > 0) {
      suspeitas.push('Existe saldo ativo simultâneo no KM - 08 C e no CURRAL para BEZERROS; pode ser duplicação após exclusão/reversão.');
    }

    const actions = [];

    return Response.json({
      apply,
      resumo: {
        totalBezerrosKm08: lotesKm08.reduce((sum, lote) => sum + lote.quantidade_cabecas, 0),
        totalBezerrosKm08C: lotesKm08C.reduce((sum, lote) => sum + lote.quantidade_cabecas, 0),
        totalBezerrosCurral: lotesCurral.reduce((sum, lote) => sum + lote.quantidade_cabecas, 0),
      },
      lotesKm08,
      lotesKm08C,
      lotesCurral,
      movimentosEntradaKm08C,
      movimentosRetornoCurral,
      movimentosKm08C: movsKm08C,
      suspeitas,
      actions,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});