import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Buscar todas as pesagens do dia 02/12/2025
    const todasPesagens = await base44.asServiceRole.entities.PesagemIndividual.filter({
      data_pesagem: "2025-12-02"
    });

    // Agrupar por numero_animal
    const grupos = {};
    todasPesagens.forEach(p => {
      const key = p.numero_animal;
      if (!grupos[key]) {
        grupos[key] = [];
      }
      grupos[key].push(p);
    });

    // Identificar duplicados (manter o primeiro, excluir o resto)
    const paraExcluir = [];
    
    Object.entries(grupos).forEach(([numero, registros]) => {
      if (registros.length > 1) {
        // Ordenar por created_date (manter o mais antigo)
        registros.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        // Marcar todos exceto o primeiro para exclusão
        for (let i = 1; i < registros.length; i++) {
          paraExcluir.push(registros[i].id);
        }
      }
    });

    // Excluir duplicados
    let excluidos = 0;
    for (const id of paraExcluir) {
      await base44.asServiceRole.entities.PesagemIndividual.delete(id);
      excluidos++;
    }

    return Response.json({
      success: true,
      total_encontrados: todasPesagens.length,
      duplicados_removidos: excluidos,
      registros_mantidos: todasPesagens.length - excluidos
    });
    
  } catch (error) {
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});