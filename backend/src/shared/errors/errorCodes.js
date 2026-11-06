/**
 * Vocabulário de erro do contrato ModeloBase1 Pecuário.
 *
 * Os oito códigos e o mapeamento HTTP vêm de
 * `config/modelobase1-pecuario.json` → `errorCodes`. Este arquivo é a
 * materialização backend desse contrato, prevista em
 * `errorNamespace.backend = "backend/src/shared/errors/"`.
 *
 * Eles NÃO foram adicionados a `src/apis/_core/ApiError.js` nesta missão: a P3
 * não altera `src/` (P3-G0.3). A sincronização com o catálogo do frontend fica
 * declaradamente adiada para a primeira missão que autorizar tocar em `src/`.
 * O campo `errorNamespace.addedToFrontendCatalogInPhase = "P3"` do contrato,
 * portanto, **não** foi cumprido — e o contrato não foi alterado para esconder
 * isso.
 */

/** @type {Readonly<Record<string, {http: number, meaning: string}>>} */
export const ERROR_CODES = Object.freeze({
  TENANT_CONTEXT_REQUIRED: {
    http: 401,
    meaning: 'requisição sem contexto de tenant autenticado',
  },
  TENANT_SCOPE_VIOLATION: {
    http: 403,
    meaning: 'recurso pertence a outro cliente_id',
  },
  SEQUENCE_SCOPE_INVALID: {
    http: 400,
    meaning: 'escopo de sequência não declarado pela capacidade',
  },
  SEQUENCE_CONFLICT: {
    http: 409,
    meaning: 'reserva de número não pôde ser concluída',
  },
  ATTACHMENT_INVALID: {
    http: 400,
    meaning: 'mime, tamanho ou nome de anexo reprovado',
  },
  ATTACHMENT_OWNER_INVALID: {
    http: 404,
    meaning: 'entidade + entidade_id não identificam registro do tenant',
  },
  AUDIT_WRITE_FAILED: {
    http: 500,
    meaning: 'falha crítica de auditoria; observável, nunca silenciosa',
  },
  CONCURRENCY_CONFLICT: {
    http: 409,
    meaning: 'unique constraint barrou escrita concorrente',
  },
});

/** Códigos do contrato, em ordem estável. */
export const CODIGOS_DO_CONTRATO = Object.freeze(Object.keys(ERROR_CODES));

/**
 * Códigos próprios do backend, **além** do mínimo do contrato.
 *
 * O contrato chama os oito acima de "vocabulário futuro mínimo" — mínimo, não
 * exaustivo. O backend precisa de dois códigos que ele não previu:
 *
 *  - `AUTH_INVALID_CREDENTIALS`: falha de login. Não é
 *    `TENANT_CONTEXT_REQUIRED`, que descreve requisição sem contexto, e forçar
 *    um no outro tornaria os dois imprecisos;
 *  - `INTERNAL_ERROR`: erro não previsto, sempre 500 com corpo genérico.
 *
 * Esta lista fica separada de propósito: `ERROR_CODES` continua sendo
 * exatamente o conjunto do contrato, verificável por teste, sem diluição.
 */
export const BACKEND_ONLY_CODES = Object.freeze({
  AUTH_INVALID_CREDENTIALS: { http: 401, meaning: 'credenciais inválidas' },
  REQUEST_VALIDATION_FAILED: { http: 400, meaning: 'corpo ou parâmetro fora do schema' },
  REQUEST_REJECTED: { http: 400, meaning: 'requisição recusada pelo framework' },
  // P4.1: o contrato tem um 404 — `ATTACHMENT_OWNER_INVALID` —, mas ele fala de
  // anexo; reaproveitá-lo para setor só para evitar um código novo tornaria o
  // vocabulário mentiroso. E `TENANT_SCOPE_VIOLATION` seria pior que impreciso:
  // o 403 confirma que o registro existe em outro cliente, entregando
  // informação sobre dado que quem perguntou não pode ver.
  SETOR_NOT_FOUND: { http: 404, meaning: 'id não identifica setor deste tenant' },
  // P4.2: mesmo raciocínio do anterior, para área de pastagem. São dois códigos
  // e não um `RECURSO_NAO_ENCONTRADO` genérico porque a tela reage diferente:
  // setor sumido invalida o vínculo do formulário de área, área sumida invalida
  // só a linha. Um código único obrigaria o frontend a inspecionar `details`
  // para descobrir do que o servidor está falando.
  AREA_NOT_FOUND: { http: 404, meaning: 'id não identifica área de pastagem deste tenant' },
  CONFIGURACAO_ICONE_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica configuração de ícone deste tenant',
  },
  PONTO_REFERENCIA_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica ponto de referência deste tenant',
  },
  LINHA_GEOGRAFICA_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica linha geográfica deste tenant',
  },
  USUARIO_NOT_FOUND: { http: 404, meaning: 'id não identifica usuário deste tenant' },
  USUARIO_LOGIN_DUPLICADO: { http: 409, meaning: 'login já cadastrado neste cliente' },
  PERMISSAO_NOT_FOUND: { http: 404, meaning: 'id não identifica permissão deste tenant' },
  USUARIO_SELF_DEACTIVATE: { http: 400, meaning: 'conta autenticada não pode se desativar' },
  EMPRESA_NOT_FOUND: { http: 404, meaning: 'id não identifica empresa deste tenant' },
  EMPRESA_NAME_CONFLICT: {
    http: 409,
    meaning: 'já existe empresa com este nome neste tenant',
  },
  // D-PROD-137 (EMP-01): a maioria dos models guarda `empresa_id` sem FK; excluir
  // a empresa deixava setores, áreas, cochos, produtos, tarefas e lotes órfãos.
  // `details.vinculos = [{ entidade, total }]`; nada é apagado.
  EMPRESA_COM_VINCULOS: {
    http: 409,
    meaning: 'a empresa tem registros vinculados (details.vinculos) e não pode ser excluída; nada foi apagado',
  },
  MARCA_NOT_FOUND: { http: 404, meaning: 'id não identifica marca deste tenant' },
  MARCA_NAME_CONFLICT: {
    http: 409,
    meaning: 'já existe marca com este nome nesta empresa',
  },
  UNIDADE_MEDIDA_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica unidade de medida deste tenant',
  },
  UNIDADE_MEDIDA_SIGLA_CONFLICT: {
    http: 409,
    meaning: 'já existe unidade de medida com esta sigla',
  },
  GRUPO_ATIVIDADE_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica grupo de atividade deste tenant',
  },
  GRUPO_ATIVIDADE_NAME_CONFLICT: {
    http: 409,
    meaning: 'já existe grupo de atividade com este nome',
  },
  GRUPO_ATIVIDADE_DELETE_BLOCKED: {
    http: 409,
    meaning: 'grupo possui tipos de tarefa vinculados',
  },
  TIPO_TAREFA_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica tipo de tarefa deste tenant',
  },
  TIPO_TAREFA_NAME_CONFLICT: {
    http: 409,
    meaning: 'já existe tipo de tarefa com este nome no grupo',
  },
  LOTE_NOT_FOUND: { http: 404, meaning: 'id não identifica lote deste tenant' },
  CATEGORIA_MANEJO_NOT_FOUND: { http: 404, meaning: 'id não identifica categoria de manejo deste tenant' },
  LOTE_DELETE_BLOCKED: {
    http: 409,
    meaning: 'lote possui registros vinculados e não pode ser excluído',
  },
  LOTE_EXCLUIDO: {
    http: 409,
    meaning: 'o lote foi excluído do cadastro (exclusão lógica) e não recebe novos registros',
  },
  // R1 — correção atômica da entrada original: há registro dependente (details.motivo).
  LOTE_CORRECAO_ENTRADA_BLOQUEADA: { http: 409, meaning: 'a entrada do lote não pode ser corrigida: existe evento, movimentação ou registro dependente (ver details.motivo); nada foi gravado' },
  LOTE_UPDATE_BLOCKED: {
    http: 409,
    meaning: 'lote já tem movimentação, manejo ou registro depois da entrada e não pode ser editado pelo cadastro',
  },
  CATEGORIA_NOT_FOUND: { http: 404, meaning: 'id não identifica categoria deste tenant' },
  CATEGORIA_PAI_NOT_FOUND: { http: 404, meaning: 'categoria pai não pertence a este tenant' },
  CATEGORIA_DELETE_BLOCKED: {
    http: 409,
    meaning: 'categoria possui subcategorias vinculadas',
  },
  LOCAL_ESTOQUE_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica local de estoque deste tenant',
  },
  LOCAL_ESTOQUE_DELETE_BLOCKED: {
    http: 409,
    meaning: 'local de estoque possui registros vinculados e não pode ser excluído',
  },
  PRODUTO_NOT_FOUND: { http: 404, meaning: 'id não identifica produto deste tenant' },
  PRODUTO_NAME_CONFLICT: {
    http: 409,
    meaning: 'já existe produto com este nome nesta empresa',
  },
  PRODUTO_DELETE_BLOCKED: {
    http: 409,
    meaning: 'produto possui movimentações de estoque e não pode ser excluído',
  },
  // R2A (D-PROD-99): declarados para o 404 entre tenants não virar 500.
  MOVIMENTACAOMAPA_NOT_FOUND: { http: 404, meaning: 'id não identifica movimentação do mapa deste tenant' },
  MOVIMENTACAOPECUARIA_NOT_FOUND: { http: 404, meaning: 'id não identifica movimentação pecuária deste tenant' },
  SUPLEMENTACAOLOTE_NOT_FOUND: { http: 404, meaning: 'id não identifica lote de suplementação deste tenant' },
  // D-PROD-137 (BEB-02/BEB-03): os services de bebedouro já lançavam estes
  // códigos, mas fora do catálogo eles viravam 500 ("erro interno").
  BEBEDOURO_NOT_FOUND: { http: 404, meaning: 'id não identifica bebedouro deste tenant (e desta empresa, no histórico)' },
  BEBEDOUROHISTORICO_NOT_FOUND: { http: 404, meaning: 'id não identifica lançamento de bebedouro deste tenant' },
  BEBEDOUROHISTORICO_SOMENTE_ULTIMO: {
    http: 409,
    meaning: 'só o lançamento mais recente do bebedouro pode ser excluído (há lançamento posterior); nada foi apagado',
  },
  MOVIMENTACAO_ESTOQUE_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica movimentação de estoque deste tenant',
  },
  ESTOQUE_LOTE_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica lote de nota deste tenant',
  },
  ESTOQUE_SALDO_INSUFICIENTE: {
    http: 422,
    meaning: 'saldo ou FIFO insuficiente para a operação',
  },
  // D-PROD-90 — importação de áreas por arquivo. 422: o pedido é bem formado,
  // mas ao menos uma área tem pendência; NADA foi gravado (details.itens).
  AREA_IMPORT_VALIDATION_FAILED: {
    http: 422,
    meaning: 'importação de áreas recusada por pendência em ao menos um item; nada gravado',
  },
  AREA_IMPORT_LIMIT_EXCEEDED: {
    http: 413,
    meaning: 'importação de áreas acima do limite de itens ou vértices por pedido',
  },
  // R2A (D-PROD-99) — registros operacionais não se apagam nem se reescrevem
  // por rota genérica; o caminho é o cancelamento server-side.
  MOVIMENTO_CANCELAMENTO_OBRIGATORIO: {
    http: 409,
    meaning: 'movimento operacional não é excluído nem alterado diretamente; use o cancelamento',
  },
  REGISTRO_OPERACIONAL_IMUTAVEL: {
    http: 409,
    meaning: 'campo operacional (quantidade, tipo, vínculo, data, custo, saldo) não é alterável por PATCH genérico',
  },
  CAMPO_RESERVADO_CANCELAMENTO: {
    http: 400,
    meaning: 'campos de situação/cancelamento são do servidor e não aceitos no corpo',
  },
  NOME_LOCAL_DIVERGENTE: {
    http: 422,
    meaning: 'nome de local informado não corresponde ao local de estoque vinculado ao movimento',
  },
  CANCELAMENTO_TIPO_NAO_SUPORTADO: {
    http: 409,
    meaning: 'tipo de movimentação ainda sem cancelamento seguro; nada foi alterado',
  },
  CANCELAMENTO_VINCULO_AMBIGUO: {
    http: 409,
    meaning: 'não há prova do lote de destino/origem do movimento; nada foi alterado',
  },
  CANCELAMENTO_DEPENDENCIA_POSTERIOR: {
    http: 409,
    meaning: 'há registro posterior ligado ao lote ou à área; cancele-o antes; nada foi alterado',
  },
  CANCELAMENTO_JA_REALIZADO: {
    http: 409,
    meaning: 'a movimentação já está cancelada',
  },
  CANCELAMENTO_ESTADO_DIVERGENTE: {
    http: 409,
    meaning: 'o estado atual dos lotes não corresponde ao efeito do movimento; nada foi alterado',
  },
  CANCELAMENTO_ALTERACAO_POSTERIOR: {
    http: 409,
    meaning: 'um lote do movimento teve alteração material posterior fora de manejo comprovado (correção direta, ida e volta); a reversão não é comprovável e nada foi alterado',
  },
  CANCELAMENTO_EFEITO_NAO_COMPROVADO: {
    http: 409,
    meaning: 'não há registro de auditoria provando que o movimento alterou os lotes; nada foi alterado',
  },
  // R2A-R1 (D-PROD-99a) — comando atômico de manejo e escrita de lote com estado esperado.
  MANEJO_SALDO_INSUFICIENTE: {
    http: 409,
    meaning: 'o lote não tem cabeças suficientes no servidor para o manejo; nada foi gravado',
  },
  MANEJO_ESTADO_INVALIDO: {
    http: 409,
    meaning: 'lote, área ou destino em estado que não permite o manejo; nada foi gravado',
  },
  // R2B-P1 (D-PROD-101) — comando do rebanho (Nascimento, Pesagem, Mudança de Categoria).
  MANEJO_CATEGORIA_MAE_INVALIDA: {
    http: 409,
    meaning: 'não há lote ativo da categoria da mãe na área; nada foi gravado',
  },
  MANEJO_CATEGORIA_INVALIDA: {
    http: 409,
    meaning: 'categoria de manejo inexistente, inativa, de outra empresa ou de outra categoria oficial; nada foi gravado',
  },
  MANEJO_CATEGORIA_AMBIGUA: {
    http: 409,
    meaning: 'mais de uma categoria de manejo ativa corresponde à categoria oficial; o formulário precisa escolher; nada foi gravado',
  },
  // R2C-P1 (D-PROD-104) — Junção de Lotes.
  JUNCAO_LOTE_INELEGIVEL: {
    http: 409,
    meaning: 'lote da junção fora da área, inativo ou sem cabeças; nada foi gravado',
  },
  JUNCAO_CLASSIFICACAO_DIVERGENTE: {
    http: 409,
    meaning: 'lotes com categoria, sexo ou categoria de manejo diferentes (ou sexo indefinido); nada foi gravado',
  },
  JUNCAO_DATA_RETROATIVA: {
    http: 409,
    meaning: 'há registro ativo posterior à data da junção num dos lotes; nada foi gravado',
  },
  JUNCAO_SOMENTE_POR_COMANDO: {
    http: 409,
    meaning: 'junção de lotes só pelo comando /movimentacoes-mapa/comandos/juncao-lotes; o POST genérico recusa; nada foi gravado',
  },
  // R2E-P1 (D-PROD-107) — ledger do rebanho por posição.
  POSICAO_REBANHO_NOT_FOUND: { http: 404, meaning: 'posição do rebanho não encontrada nesta empresa' },
  POSICAO_REBANHO_VAZIA: { http: 409, meaning: 'a posição não tem cabeças (não aparece no mapa); nada foi gravado' },
  REBANHO_LEDGER_INATIVO: { http: 409, meaning: 'o ledger de posições não está ativo nesta empresa' },
  REBANHO_LEDGER_JA_ATIVO: { http: 409, meaning: 'o ledger de posições já está ativo nesta empresa' },
  REBANHO_LEDGER_OPERACAO_NAO_MIGRADA: { http: 409, meaning: 'empresa no ledger: esta operação ainda não foi migrada para ele e foi recusada sem gravar nada' },
  REBANHO_LEDGER_SALDO_SOMENTE_POR_EVENTO: { http: 409, meaning: 'empresa no ledger: saldo, área, status e classificação do lote só mudam por evento' },
  REBANHO_SALDO_HISTORICO_NEGATIVO: { http: 409, meaning: 'o fato deixaria saldo negativo em alguma data; nada foi gravado' },
  CANCELAMENTO_SALDO_HISTORICO_NEGATIVO: { http: 409, meaning: 'cancelar deixaria saldo negativo em alguma data (fato posterior depende); nada mudou' },
  REBANHO_ANTES_DO_CORTE: { http: 409, meaning: 'data anterior ao início do ledger nesta empresa' },
  // D-PROD-122 (S1/H1) — só fatos realizados: o "hoje" é o da fazenda (fuso IANA da Empresa).
  REBANHO_DATA_FUTURA: { http: 409, meaning: 'data operacional posterior a hoje no fuso da fazenda; só fatos realizados entram no rebanho; nada foi gravado' },
  EMPRESA_FUSO_NAO_CONFIGURADO: { http: 409, meaning: 'fuso horário da fazenda não configurado: escrita nova do rebanho recusada (falha fechada); nada foi gravado' },
  EMPRESA_FUSO_INVALIDO: { http: 400, meaning: 'fuso horário não é um nome IANA válido (ex.: America/Cuiaba)' },
  // D-PROD-123 (H2) — cursor do histórico por ocorrência: v1, malformado, adulterado ou de outro escopo.
  HISTORICO_CURSOR_INVALIDO: { http: 400, meaning: 'cursor do histórico inválido (versão antiga, malformado, adulterado ou de outra consulta); recomece do início' },
  REBANHO_DESTINO_IGUAL_ORIGEM: { http: 409, meaning: 'área de destino igual à de origem' },
  REBANHO_AREA_INATIVA: { http: 409, meaning: 'área de destino inativa' },
  REBANHO_ATIVACAO_LOTE_SEM_AREA: { http: 409, meaning: 'há lote ativo com cabeças e sem área válida; corrija antes de ativar' },
  // D-PROD-110 — exclusão definitiva segura de movimentação do rebanho.
  IDEMPOTENCY_EFEITO_EXCLUIDO: { http: 409, meaning: 'o fato gerado por esta chave foi excluído definitivamente; não há replay nem recriação — lance a operação correta com chave nova' },
  EXCLUSAO_JA_REALIZADA: { http: 409, meaning: 'esta movimentação já foi excluída definitivamente; nada foi alterado' },
  EXCLUSAO_MOVIMENTO_LEGADO: { http: 409, meaning: 'movimento sem evento certificado do ledger (anterior ao controle por posições) não é excluído; nada foi alterado' },
  EXCLUSAO_MOVIMENTO_CANCELADO: { http: 409, meaning: 'movimento já cancelado pelo mecanismo anterior não é apagado retroativamente; nada foi alterado' },
  EXCLUSAO_REFERENCIA_DOCUMENTAL: { http: 409, meaning: 'há documento de outro módulo (mesmo cancelado) que cita esta movimentação por id; apagar deixaria referência órfã; nada foi alterado' },
  IDEMPOTENCY_EFEITO_DESFEITO: { http: 409, meaning: 'a operação com esta chave teve o efeito desfeito por reset controlado de dados de teste; não há replay — envie como operação nova' },
  REBANHO_LEDGER_SOMENTE_POR_COMANDO: { http: 409, meaning: 'empresa no ledger: fato que muda saldo, classificação, peso ou estado do rebanho só entra pelos comandos certificados; o POST genérico não grava' },
  REBANHO_CANCELAMENTO_VINCULO_POSTERIOR: { http: 409, meaning: 'cancelamento recusado: lançamento de outro módulo cita (por id) a posição criada pela movimentação ou o próprio movimento' },
  REBANHO_CUTOVER_PENDENTE: { http: 409, meaning: 'empresa ainda não migrada para o controle por posições; manejo bloqueado até o cutover administrativo (scripts/ops/cutover-rebanho.mjs)' },
  LOTE_CADASTRO_SOMENTE_ENTRADAS: { http: 409, meaning: 'o cadastro de lotes guarda só entradas; manejo (inclusive no modelo legado) não cria lote derivado — ative o controle por posições' },
  REBANHO_DEPENDENCIA_FATO_SEM_SALDO: { http: 409, meaning: 'um fato posterior sem movimento de cabeças (pesagem ou nascimento) perderia a pré-condição na data dele; cancele-o antes' },
  REBANHO_PESO_DEPENDENCIA_CAUSAL: { http: 409, meaning: 'a mudança alteraria o peso calculado por um fato posterior; desfaça os fatos dependentes na ordem inversa antes' },
  REBANHO_LEDGER_CANCELAMENTO_LEGADO: { http: 409, meaning: 'empresa no ledger: movimento anterior à ativação fica no histórico e não é desfeito pelo modelo antigo; registre a correção como manejo novo' },
  REBANHO_ATIVACAO_ENTRADAS_COM_HISTORICO: { http: 409, meaning: 'reconstrução pelas entradas exige empresa sem movimentação legada ativa e lotes no estado da própria entrada' },
  REBANHO_ATIVACAO_CORTE_ANTERIOR_AO_HISTORICO: { http: 409, meaning: 'há movimentação legada ativa depois da data de corte' },
  // R2D-P1 (D-PROD-105) — baixa multi-lote (Morte/Abate).
  BAIXA_SALDO_INSUFICIENTE: {
    http: 409,
    meaning: 'a categoria não tem cabeças suficientes nos lotes ativos da área; nada foi baixado',
  },
  BAIXA_CLASSIFICACAO_DIVERGENTE: {
    http: 409,
    meaning: 'há lote da categoria com sexo incompatível com a categoria oficial; nada foi baixado',
  },
  BAIXA_DATA_RETROATIVA: {
    http: 409,
    meaning: 'há registro ativo posterior à data da baixa num dos lotes; nada foi baixado',
  },
  MANEJO_DESTINO_AMBIGUO: {
    http: 409,
    meaning: 'há mais de um lote de filhotes compatível (categoria e sexo) na área; sem unificação implícita; nada foi gravado',
  },
  MANEJO_CATEGORIA_INCOMPATIVEL: {
    http: 409,
    meaning: 'a categoria nova não é compatível com o sexo do lote; nada foi gravado',
  },
  LOTE_ESTADO_CONFLITO: {
    http: 409,
    meaning: 'o lote mudou desde a leitura (estado esperado divergente); recarregue e refaça; nada foi gravado',
  },
  CANCELAMENTO_SALDO_INSUFICIENTE: {
    http: 409,
    meaning: 'o lote não tem saldo para devolver as cabeças; nada foi alterado',
  },
  IDEMPOTENCY_CONFLICT: {
    http: 409,
    meaning: 'operation_id reutilizado com intenção diferente',
  },
  IDEMPOTENCY_IN_PROGRESS: {
    http: 409,
    meaning: 'mesma operation_id ainda em processamento',
  },
  SUPLEMENTACAOEVENTO_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica evento de suplementação deste tenant',
  },
  PRODUCT_OPERATOR_REQUIRED: {
    http: 403,
    meaning: 'identidade não autorizada a alterar o catálogo global do produto',
  },
  CATALOGO_GLOBAL_INVALID: {
    http: 422,
    meaning: 'dados do catálogo global inválidos ou incompletos para publicação',
  },
  CATALOGO_GLOBAL_NOT_FOUND: {
    http: 404,
    meaning: 'recurso do catálogo global não encontrado',
  },
  // Permissões — autorização por tela/ação e por ação do Mapa Geral (servidor).
  ACAO_NAO_PERMITIDA: { http: 403, meaning: 'a conta não tem permissão para esta tela/ação (configurada em Permissões); nada foi gravado' },
  TENANT_ADMIN_REQUIRED: {
    http: 403,
    meaning: 'ação restrita ao administrador da fazenda (Usuario.papel_tenant server-owned, ativo)',
  },
  USUARIO_INATIVO: { http: 403, meaning: 'conta desativada não altera dados (JWT antigo não basta)' },
  USUARIO_SENHA_ATUAL_INVALIDA: { http: 403, meaning: 'senha atual ausente ou incorreta para trocar a própria senha' },
  ADMIN_INDISPONIVEL: { http: 503, meaning: 'MAIKE Admin indisponível: configuração do servidor incompleta' },
  ADMIN_SESSAO_REQUIRED: { http: 401, meaning: 'sessão do MAIKE Admin ausente, expirada ou revogada' },
  ADMIN_PRINCIPAL_REQUIRED: {
    http: 403,
    meaning: 'credencial não é de administrador principal do produto (tenant, admin de tenant ou operador legado)',
  },
  ADMIN_MFA_REQUIRED: { http: 403, meaning: 'sessão do MAIKE Admin sem segundo fator verificado' },
  ADMIN_CREDENCIAIS_INVALIDAS: { http: 401, meaning: 'credenciais do MAIKE Admin inválidas (mensagem genérica)' },
  ADMIN_ORIGEM_RECUSADA: { http: 403, meaning: 'mutação admin sem Origin permitido ou sem token CSRF da sessão' },
  ADMIN_RATE_LIMITED: { http: 429, meaning: 'tentativas demais; aguarde antes de tentar de novo' },
  ADMIN_ENTRADA_INVALIDA: { http: 422, meaning: 'dados do MAIKE Admin inválidos' },
  ADMIN_JA_CONFIGURADO: { http: 409, meaning: 'proprietário ou MFA já configurado' },
  // MAIKE-SAAS-ADMIN-S03 — gestão de clientes pelo MAIKE Admin.
  ADMIN_CLIENTE_CODIGO_DUPLICADO: { http: 409, meaning: 'já existe cliente com este código' },
  ADMIN_LOGIN_DUPLICADO: { http: 409, meaning: 'login já usado por uma conta ativa (em qualquer cliente)' },
  CATALOGO_ASSET_INVALID: {
    http: 400,
    meaning: 'asset visual reprovado (mime, tamanho ou conteúdo)',
  },
  INTERNAL_ERROR: { http: 500, meaning: 'erro não previsto' },
});

/**
 * Status HTTP de um código conhecido.
 * @param {string} codigo
 * @returns {number} 500 para código desconhecido
 */
export const statusHttpDe = (codigo) =>
  ERROR_CODES[codigo]?.http ?? BACKEND_ONLY_CODES[codigo]?.http ?? 500;

/** Verdadeiro só para os oito códigos do contrato. */
export const ehCodigoDoContrato = (codigo) =>
  Object.prototype.hasOwnProperty.call(ERROR_CODES, codigo);

/** Verdadeiro para qualquer código que o backend saiba traduzir em HTTP. */
export const ehCodigoConhecido = (codigo) =>
  ehCodigoDoContrato(codigo) || Object.prototype.hasOwnProperty.call(BACKEND_ONLY_CODES, codigo);
