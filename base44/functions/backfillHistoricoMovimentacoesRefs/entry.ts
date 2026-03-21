import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const payload = await req.json().catch(() => ({}));
    const empresaId = payload?.empresaId;

    if (!empresaId) {
      return Response.json({ error: 'empresaId é obrigatório' }, { status: 400 });
    }

    const [movimentacoes, setores, categorias] = await Promise.all([
      base44.asServiceRole.entities.MovimentacaoPecuaria.filter({ empresa_id: empresaId }, '-created_date', 5000),
      base44.asServiceRole.entities.Setor.filter({ empresa_id: empresaId }, '-created_date', 5000),
      base44.asServiceRole.entities.CategoriaManejo.filter({ empresa_id: empresaId }, '-created_date', 5000),
    ]);

    const setoresById = Object.fromEntries(setores.map((setor) => [setor.id, setor]));

    const categoriaAliases = [];
    for (const categoria of categorias) {
      if (categoria?.nome) {
        categoriaAliases.push({ alias: normalizeValue(categoria.nome), canonical: categoria.nome });
      }
      if (categoria?.categoria_oficial) {
        categoriaAliases.push({ alias: normalizeValue(categoria.categoria_oficial), canonical: categoria.nome || categoria.categoria_oficial });
      }
    }

    const maxUpdates = Number(payload?.maxUpdates || 25);
    let updated = 0;
    let remaining = 0;

    for (const mov of movimentacoes) {
      const patch = {};

      const setorPrincipal = mov.setor_id ? setoresById[mov.setor_id] : null;
      const setorOrigem = mov.setor_origem_id ? setoresById[mov.setor_origem_id] : null;
      const setorDestino = mov.setor_destino_id ? setoresById[mov.setor_destino_id] : null;

      if (setorPrincipal?.nome && mov.setor_nome !== setorPrincipal.nome) {
        patch.setor_nome = setorPrincipal.nome;
      }
      if (setorOrigem?.nome && mov.setor_origem_nome !== setorOrigem.nome) {
        patch.setor_origem_nome = setorOrigem.nome;
      }
      if (setorDestino?.nome && mov.setor_destino_nome !== setorDestino.nome) {
        patch.setor_destino_nome = setorDestino.nome;
      }
      if (setorOrigem?.nome && mov.transferencia_origem && mov.setor_origem_id && mov.transferencia_origem !== setorOrigem.nome) {
        patch.transferencia_origem = setorOrigem.nome;
      }
      if (setorDestino?.nome && mov.transferencia_destino && mov.setor_destino_id && mov.transferencia_destino !== setorDestino.nome) {
        patch.transferencia_destino = setorDestino.nome;
      }

      for (const field of ['categoria_animal', 'categoria_nova', 'transferencia_origem', 'transferencia_destino']) {
        const currentValue = mov[field];
        if (!currentValue) continue;
        const found = categoriaAliases.find((item) => item.alias === normalizeValue(currentValue));
        if (found && currentValue !== found.canonical) {
          patch[field] = found.canonical;
        }
      }

      if (!Object.keys(patch).length) continue;

      if (updated >= maxUpdates) {
        remaining += 1;
        continue;
      }

      await base44.asServiceRole.entities.MovimentacaoPecuaria.update(mov.id, patch);
      updated += 1;
    }

    return Response.json({ success: true, updated, remaining, total: movimentacoes.length, hasMore: remaining > 0 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});