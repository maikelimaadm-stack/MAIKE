/**
 * Catálogo FECHADO da propagação de referências desnormalizadas (D-PROD-137).
 *
 * Cada origem diz de onde relê o registro (`tabela`/`delegate`), se é por
 * empresa e quais dependentes guardam uma cópia de valores dela. Um dependente
 * é casado SÓ por id — coluna de FK (`chave`) ou chave de id dentro do JSON
 * `dados` (`documento: true`) — e recebe os valores ATUAIS da origem, lidos do
 * banco: `valores(origem)` repete a derivação de quem grava o dependente.
 *
 * Por que não há mais regra por nome (antes `matchType: 'value'`):
 *  - o nome antigo vinha do corpo (`old_data`): bastava mandar o nome de outro
 *    setor para reescrever área, lote, cocho e movimentação dele, e as entradas
 *    `setor_id: 'id'` ainda re-apontavam a FK com par forjado (REF-01/F4);
 *  - `Setor.nome` não é único: mesmo com o nome antigo verdadeiro, o casamento
 *    por nome reescrevia o homônimo de outra empresa ou da mesma (REF-03);
 *  - `transferencia_origem/destino` também guardam nome de categoria.
 * Registro legado sem id (só o nome) não tem vínculo verificável e fica como
 * está. O que só existe por nome com chave ÚNICA — `nome_produto` por empresa —
 * é propagado dentro da transação do PATCH do produto, com o nome antigo lido do
 * banco (ver `propagacaoPorChaveUnica.js`); a tarefa, que não tem `setor_id`,
 * acompanha a renomeação do setor pela área, no PATCH do setor.
 *
 * Tabelas, colunas e chaves daqui entram no SQL como identificador: são
 * constantes deste arquivo, nunca dado de requisição, e passam pela checagem de
 * formato no fim do arquivo.
 */

/** @typedef {{tabela: string, chave: string, documento?: boolean, valores: (origem: any) => Record<string, string | null>}} Dependente */
/** @typedef {{tabela: string, delegate: string, porEmpresa: boolean, dependentes: Dependente[]}} Origem */

const nomeDoSetor = (campo) => (o) => ({ [campo]: o.nome });

/** @type {Readonly<Record<string, Origem>>} */
export const ORIGENS = Object.freeze({
  Setor: {
    tabela: 'Setor',
    delegate: 'setor',
    porEmpresa: true,
    dependentes: [
      { tabela: 'AreaPastagem', chave: 'setor_id', valores: nomeDoSetor('setor_nome') },
      { tabela: 'PontoSuplementacao', chave: 'setor_id', valores: nomeDoSetor('setor_nome') },
      { tabela: 'Lote', chave: 'setor_id', valores: nomeDoSetor('setor_nome') },
      { tabela: 'MovimentacaoMapa', documento: true, chave: 'setor_id', valores: nomeDoSetor('setor_nome') },
      { tabela: 'MovimentacaoMapa', documento: true, chave: 'setor_origem_id', valores: nomeDoSetor('setor_origem_nome') },
      { tabela: 'MovimentacaoMapa', documento: true, chave: 'setor_destino_id', valores: nomeDoSetor('setor_destino_nome') },
      { tabela: 'MovimentacaoPecuaria', documento: true, chave: 'setor_id', valores: nomeDoSetor('setor_nome') },
      { tabela: 'MovimentacaoPecuaria', documento: true, chave: 'setor_origem_id', valores: nomeDoSetor('setor_origem_nome') },
      { tabela: 'MovimentacaoPecuaria', documento: true, chave: 'setor_destino_id', valores: nomeDoSetor('setor_destino_nome') },
    ],
  },
  GrupoAtividade: {
    tabela: 'GrupoAtividade',
    delegate: 'grupoAtividade',
    porEmpresa: false,
    dependentes: [
      { tabela: 'TipoTarefa', chave: 'grupo_atividade_id', valores: (o) => ({ grupo_atividade_nome: o.nome_grupo }) },
      { tabela: 'LancamentoTarefa', chave: 'grupo_atividade_id', valores: (o) => ({ grupo_atividade_nome: o.nome_grupo }) },
    ],
  },
  TipoTarefa: {
    tabela: 'TipoTarefa',
    delegate: 'tipoTarefa',
    porEmpresa: false,
    dependentes: [
      // O grupo da tarefa É o grupo do tipo dela (lancamentoTarefaService
      // resolverTipoTarefa; o corpo da tarefa não grava grupo). Copiá-lo do tipo
      // relido do banco não dá autoridade nova: só segue o que o PATCH do tipo,
      // que já exige a tela do tipo, decidiu.
      {
        tabela: 'LancamentoTarefa',
        chave: 'tipo_tarefa_id',
        valores: (o) => ({ tipo_tarefa_nome: o.nome_tipo, grupo_atividade_id: o.grupo_atividade_id, grupo_atividade_nome: o.grupo_atividade_nome }),
      },
    ],
  },
  Lote: {
    tabela: 'Lote',
    delegate: 'lote',
    porEmpresa: true,
    // Ordem deliberada (documentos JSON antes da tarefa): o teste de falha no
    // meio prova que o que já foi escrito é desfeito.
    dependentes: [
      { tabela: 'MovimentacaoMapa', documento: true, chave: 'lote_id', valores: (o) => ({ lote: o.nome }) },
      { tabela: 'SuplementacaoLote', documento: true, chave: 'lote_id', valores: (o) => ({ lote_nome: o.nome }) },
      { tabela: 'LancamentoTarefa', chave: 'lote_id', valores: (o) => ({ lote_nome: o.nome }) },
    ],
  },
  Produto: {
    tabela: 'Produto',
    delegate: 'produto',
    porEmpresa: true,
    dependentes: [
      // Mesma derivação da baixa (movimentacaoEstoqueComandoService): código
      // interno, senão o de barras. Copiar só `codigo_interno` apagaria o código
      // de barras dos movimentos de produto sem código interno.
      {
        tabela: 'MovimentacaoEstoque',
        chave: 'produto_id',
        valores: (o) => ({ produto_nome: o.nome_produto, produto_codigo: o.codigo_interno || o.codigo_barras || '', produto_categoria: o.categoria ?? null }),
      },
      { tabela: 'SuplementacaoEvento', documento: true, chave: 'produto_id', valores: (o) => ({ produto: o.nome_produto }) },
    ],
  },
});

// Identificador fora do formato quebra no carregamento do módulo, não em SQL.
const IDENTIFICADOR = /^[A-Za-z][A-Za-z0-9_]*$/;
for (const origem of Object.values(ORIGENS)) {
  for (const nome of [origem.tabela, ...origem.dependentes.flatMap((d) => [d.tabela, d.chave])]) {
    if (!IDENTIFICADOR.test(nome)) throw new Error(`propagationRules: identificador inválido ${nome}`);
  }
}
