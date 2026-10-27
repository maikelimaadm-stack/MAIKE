export const PROPAGATION_RULES = {
  Produto: [
    {
      entity: 'MovimentacaoEstoque',
      matchType: 'id',
      queryField: 'produto_id',
      fieldMap: {
        produto_nome: 'nome_produto',
        produto_codigo: 'codigo_interno',
        produto_categoria: 'categoria',
      },
    },
    {
      entity: 'SuplementacaoEvento',
      matchType: 'id',
      queryField: 'produto_id',
      fieldMap: {
        produto: 'nome_produto',
      },
    },
    {
      entity: 'ManejoTecnicoRebanho',
      matchType: 'value',
      sourceField: 'nome_produto',
      matchFields: ['produto', 'produto_utilizado'],
      fieldMap: {
        produto: 'nome_produto',
        produto_utilizado: 'nome_produto',
      },
    },
    {
      entity: 'PontoSuplementacao',
      matchType: 'value',
      sourceField: 'nome_produto',
      matchFields: ['produto_padrao'],
      fieldMap: {
        produto_padrao: 'nome_produto',
      },
    },
  ],
  GrupoAtividade: [
    {
      entity: 'TipoTarefa',
      matchType: 'id',
      queryField: 'grupo_atividade_id',
      fieldMap: {
        grupo_atividade_nome: 'nome_grupo',
      },
    },
    {
      entity: 'LancamentoTarefa',
      matchType: 'id',
      queryField: 'grupo_atividade_id',
      fieldMap: {
        grupo_atividade_nome: 'nome_grupo',
      },
    },
  ],
  TipoTarefa: [
    {
      entity: 'LancamentoTarefa',
      matchType: 'id',
      queryField: 'tipo_tarefa_id',
      fieldMap: {
        tipo_tarefa_nome: 'nome_tipo',
        grupo_atividade_id: 'grupo_atividade_id',
        grupo_atividade_nome: 'grupo_atividade_nome',
      },
    },
  ],
  Setor: [
    {
      entity: 'AreaPastagem',
      matchType: 'id',
      queryField: 'setor_id',
      fieldMap: {
        setor_nome: 'nome',
      },
    },
    {
      entity: 'AreaPastagem',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['setor_nome'],
      fieldMap: {
        setor_nome: 'nome',
        setor_id: 'id',
      },
      targetMatchFieldMap: {
        setor_id: 'setor_nome',
      },
    },
    {
      entity: 'PontoSuplementacao',
      matchType: 'id',
      queryField: 'setor_id',
      fieldMap: {
        setor_nome: 'nome',
      },
    },
    {
      entity: 'PontoSuplementacao',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['setor_nome'],
      fieldMap: {
        setor_nome: 'nome',
        setor_id: 'id',
      },
      targetMatchFieldMap: {
        setor_id: 'setor_nome',
      },
    },
    {
      entity: 'Lote',
      matchType: 'id',
      queryField: 'setor_id',
      fieldMap: {
        setor_nome: 'nome',
      },
    },
    {
      entity: 'Lote',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['setor_nome'],
      fieldMap: {
        setor_nome: 'nome',
        setor_id: 'id',
      },
      targetMatchFieldMap: {
        setor_id: 'setor_nome',
      },
    },
    {
      entity: 'LancamentoTarefa',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['setor_nome'],
      fieldMap: {
        setor_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoMapa',
      matchType: 'id',
      queryField: 'setor_id',
      fieldMap: {
        setor_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoMapa',
      matchType: 'id',
      queryField: 'setor_origem_id',
      fieldMap: {
        setor_origem_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoMapa',
      matchType: 'id',
      queryField: 'setor_destino_id',
      fieldMap: {
        setor_destino_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoMapa',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['setor_nome', 'setor_origem_nome', 'setor_destino_nome', 'transferencia_origem', 'transferencia_destino'],
      fieldMap: {
        setor_nome: 'nome',
        setor_origem_nome: 'nome',
        setor_destino_nome: 'nome',
        transferencia_origem: 'nome',
        transferencia_destino: 'nome',
        setor_id: 'id',
        setor_origem_id: 'id',
        setor_destino_id: 'id',
      },
      targetMatchFieldMap: {
        setor_id: 'setor_nome',
        setor_origem_id: 'setor_origem_nome',
        setor_destino_id: 'setor_destino_nome',
      },
    },
    {
      entity: 'MovimentacaoPecuaria',
      matchType: 'id',
      queryField: 'setor_id',
      fieldMap: {
        setor_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoPecuaria',
      matchType: 'id',
      queryField: 'setor_origem_id',
      fieldMap: {
        setor_origem_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoPecuaria',
      matchType: 'id',
      queryField: 'setor_destino_id',
      fieldMap: {
        setor_destino_nome: 'nome',
      },
    },
    {
      entity: 'MovimentacaoPecuaria',
      matchType: 'value',
      sourceField: 'nome',
      matchFields: ['setor_nome', 'setor_origem_nome', 'setor_destino_nome', 'transferencia_origem', 'transferencia_destino'],
      fieldMap: {
        setor_nome: 'nome',
        setor_origem_nome: 'nome',
        setor_destino_nome: 'nome',
        transferencia_origem: 'nome',
        transferencia_destino: 'nome',
        setor_id: 'id',
        setor_origem_id: 'id',
        setor_destino_id: 'id',
      },
      targetMatchFieldMap: {
        setor_id: 'setor_nome',
        setor_origem_id: 'setor_origem_nome',
        setor_destino_id: 'setor_destino_nome',
      },
    },
  ],
  Lote: [
    {
      entity: 'MovimentacaoMapa',
      matchType: 'id',
      queryField: 'lote_id',
      fieldMap: {
        lote: 'nome',
      },
    },
    {
      entity: 'SuplementacaoLote',
      matchType: 'id',
      queryField: 'lote_id',
      fieldMap: {
        lote_nome: 'nome',
      },
    },
    {
      entity: 'LancamentoTarefa',
      matchType: 'id',
      queryField: 'lote_id',
      fieldMap: {
        lote_nome: 'nome',
      },
    },
  ],
};
