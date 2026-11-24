/**
 * Leituras que o "Baixar dados para usar sem internet" faz (D-PROD-288).
 *
 * São exatamente os GETs que cada tela faz ao abrir, com os filtros padrão:
 * guardadas no aparelho, as telas abrem sem internet mesmo sem terem sido
 * visitadas antes. `{empresa}` é trocado pela fazenda/empresa selecionada.
 *
 * Gerada por `scripts/dev/descobrir-leituras-offline.mjs` (abre todas as telas
 * com backend falso e anota as leituras). Tela nova ou filtro padrão novo:
 * rode o script e atualize esta lista. Fora de propósito: telas só de
 * administração (usuários e permissões).
 */
export const LEITURAS_PARA_OFFLINE = Object.freeze([
  '/areas-pastagem',
  '/atividades?empresa_id={empresa}&limit=100',
  '/bebedouros',
  '/bebedouros-historico',
  '/bebedouros-sanidade',
  '/bens-patrimoniais?empresa_id={empresa}&ativo=true&limit=100',
  '/categorias',
  '/categorias-manejo',
  '/categorias-manejo-opcoes/curvas-ganho?empresa_id={empresa}',
  '/centros-custo?empresa_id={empresa}&limit=100&ativo=true',
  '/centros-resultado?empresa_id={empresa}&limit=100&ativo=true',
  '/configuracao-icones',
  '/culturas?empresa_id={empresa}',
  '/curvas-ganho?empresa_id={empresa}',
  '/empresas',
  '/estacoes?empresa_id={empresa}',
  '/estoque-lotes-nota',
  '/estoque/opcoes/locais?limit=100',
  '/estoque/saldo?empresa_id={empresa}&limit=100',
  '/formulacoes?empresa_id={empresa}',
  '/grupos-atividade',
  '/lancamentos-tarefa',
  '/leituras-cocho',
  '/linhas-geograficas',
  '/locais-estoque/page?limit=100',
  '/lotes',
  '/manejos-tecnico-rebanho?limit=500',
  '/marcas?limit=100&empresa_id={empresa}',
  '/movimentacoes-mapa?limit=500',
  '/movimentacoes-pecuaria?limit=5000',
  '/naturezas-financeiras?empresa_id={empresa}&tipo=DESPESA&ativo=true&limit=100',
  '/operacoes-financeiras?empresa_id={empresa}&limit=100',
  '/parceiros?empresa_id={empresa}&limit=100&ativo=true',
  '/patrimonio-abastecimentos?empresa_id={empresa}&limit=100',
  '/perfis-financeiros-empresa?empresa_id={empresa}',
  '/planejamentos?empresa_id={empresa}',
  '/pontos-referencia',
  '/pontos-suplementacao',
  '/produtos',
  '/produtos/page?empresa_id={empresa}&limit=100',
  '/rebanho/posicoes?empresa_id={empresa}',
  '/servicos?empresa_id={empresa}&limit=100&ativo=true',
  '/setores',
  '/setores/page?empresa_id={empresa}&limit=100',
  '/suplementacao-eventos',
  '/suplementacao-lotes?limit=500',
  '/tipos-atividade',
  '/tipos-tarefa',
  '/unidades-medida/page?limit=100',
]);
