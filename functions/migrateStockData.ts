import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    // Carregar Locais de Estoque
    const locais = await base44.asServiceRole.entities.LocalEstoque.list();
    const locaisById = new Map(locais.map(l => [l.id, l]));
    const locaisByNome = new Map(
      locais.map(l => [String(l.nome || '').trim().toLowerCase(), l])
    );

    // Carregar Movimentações
    const movimentacoes = await base44.asServiceRole.entities.MovimentacaoEstoque.list();

    let corrigidos = 0;
    let semMudanca = 0;
    let comErro = 0;

    for (const m of movimentacoes) {
      const upd = {};

      // 1) Migrar campos legados *_id -> local_estoque_* (se alvo vazio)
      if (!m.local_estoque_origem && m.local_estoque_origem_id) {
        upd.local_estoque_origem = m.local_estoque_origem_id;
      }
      if (!m.local_estoque_destino && m.local_estoque_destino_id) {
        upd.local_estoque_destino = m.local_estoque_destino_id;
      }

      // 2) Migrar campos legados *_nome -> local_* (se alvo vazio)
      if (!m.local_origem && m.local_estoque_origem_nome) {
        upd.local_origem = m.local_estoque_origem_nome;
      }
      if (!m.local_destino && m.local_estoque_destino_nome) {
        upd.local_destino = m.local_estoque_destino_nome;
      }

      // 3) Se local_estoque_* contiver NOME (não id), tentar resolver para id real via LocalEstoque
      const norm = (s) => String(s || '').trim().toLowerCase();

      const origemVal = upd.local_estoque_origem ?? m.local_estoque_origem;
      if (origemVal && !locaisById.has(origemVal)) {
        const poss = locaisByNome.get(norm(origemVal));
        if (poss) upd.local_estoque_origem = poss.id;
      }

      const destinoVal = upd.local_estoque_destino ?? m.local_estoque_destino;
      if (destinoVal && !locaisById.has(destinoVal)) {
        const poss = locaisByNome.get(norm(destinoVal));
        if (poss) upd.local_estoque_destino = poss.id;
      }

      // 4) Se nomes vazios mas temos ids, preencher nomes para cache/display
      const origemIdFinal = upd.local_estoque_origem ?? m.local_estoque_origem;
      const destinoIdFinal = upd.local_estoque_destino ?? m.local_estoque_destino;

      if (!m.local_origem && origemIdFinal && locaisById.get(origemIdFinal)?.nome) {
        upd.local_origem = locaisById.get(origemIdFinal).nome;
      }
      if (!m.local_destino && destinoIdFinal && locaisById.get(destinoIdFinal)?.nome) {
        upd.local_destino = locaisById.get(destinoIdFinal).nome;
      }

      // 5) Remover campos inválidos do registro não é necessário aqui (schema ignora),
      //    mas garantimos não gravá-los novamente.

      if (Object.keys(upd).length > 0) {
        try {
          await base44.asServiceRole.entities.MovimentacaoEstoque.update(m.id, upd);
          corrigidos += 1;
        } catch (err) {
          comErro += 1;
          console.error('Erro ao atualizar', m.id, err?.message);
        }
      } else {
        semMudanca += 1;
      }
    }

    return Response.json({ status: 'ok', total: movimentacoes.length, corrigidos, semMudanca, comErro });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});