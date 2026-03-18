import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Lista consolidada de entidades conhecidas no app
    const entityNames = [
      'Pesagem','Fornecedor','Produto','UnidadeMedida','Categoria','LocalEstoque','Empresa','Safra','CustoSafra','HistoricoEntrega','MovimentacaoEstoque','CentroCusto','LancamentoFinanceiro','BaixaFinanceira','PlanoContas','GrupoFinanceiro','LivroFiscal','Cidade','ContaBancaria','MovimentacaoBancaria',
      'AtivoFixo','FormaPagamento','Permissao','AreaPastagem','MovimentacaoPecuaria','EventoSanitario','PontoReferencia','Lote','ConfiguracaoIcone','LinhaGeografica','PontoSuplementacao','SuplementacaoEvento','SuplementacaoLote','FatorConsumoCategoria','CategoriaManejo','Maquina','ManutencaoMaquina','AbastecimentoMaquina','OperacaoAgricola','ControleArea','TarefaMapa','Setor','PesagemIndividual','Apartacao','LoteApartacao','FichaPersonalizada','SanidadeAnimal','ConfiguracaoSanidade','ItemSanidade','ProdutoCotacao','LoteAnimaisCotacao','AplicacaoMedicamento','PlanoAcao','Implemento','GrupoAtividade','TipoTarefa','LancamentoTarefa','Embarque','DocumentoEmbarque','EstoqueLoteNota'
    ];

    const data = {};
    const schemas = {};
    const counts = {};
    const exported = [];

    for (const name of entityNames) {
      try {
        // Tenta listar registros (usa escopo de usuário; se necessário, usa service role)
        let list = [];
        try { list = await base44.entities[name].list(); } catch (_) {
          try { list = await base44.asServiceRole.entities[name].list(); } catch (_) { list = []; }
        }
        data[name] = list || [];
        counts[name] = (list || []).length;
        exported.push(name);

        // Tenta obter schema
        try {
          const s = await base44.entities[name].schema();
          schemas[name] = s;
        } catch (_) {
          try {
            const s2 = await base44.asServiceRole.entities[name].schema();
            schemas[name] = s2;
          } catch (_) { /* ignore */ }
        }
      } catch (_) {
        // Entidade ausente ou sem acesso - ignora
      }
    }

    const payload = {
      exported_at: new Date().toISOString(),
      exported_by: { id: user.id, email: user.email },
      entities_requested: entityNames,
      entities_exported: exported,
      counts,
      schemas,
      data,
    };

    const body = JSON.stringify(payload);
    const filename = `backup_dados_${new Date().toISOString().slice(0,10)}.json`;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});