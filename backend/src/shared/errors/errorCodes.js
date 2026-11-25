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
  // D-PROD-146 — Gestão P1 (Parceiros e centros).
  FORNECEDOR_NOT_FOUND: { http: 404, meaning: 'id não identifica fornecedor deste tenant (rota legada /fornecedores)' },
  PARCEIRO_NOT_FOUND: { http: 404, meaning: 'id não identifica parceiro desta empresa neste tenant' },
  PARCEIRO_DOCUMENTO_INVALIDO: { http: 400, meaning: 'CPF ou CNPJ com dígitos verificadores inválidos; nada foi gravado' },
  PARCEIRO_EM_USO: { http: 409, meaning: 'fornecedor/parceiro referenciado por lote, nota, movimentação, lançamento financeiro/título (D-PROD-155), bem patrimonial como proprietário ou fornecedor (D-PROD-157) ou linha de serviço/mão de obra de atividade (D-PROD-207/208: details.servicos_atividade, details.mao_obra_atividade) não é excluído; inativar' },
  PARCEIRO_DOCUMENTO_DUPLICADO: { http: 409, meaning: 'já existe parceiro com este CPF/CNPJ nesta empresa; nada foi gravado' },
  // D-PROD-208 — dados do funcionário (tipo, cargo, custo por hora e por diária) só com o papel `funcionario`.
  PARCEIRO_FUNCIONARIO_SEM_PAPEL: { http: 422, meaning: 'dados do funcionário (details.field) informados num parceiro sem o papel funcionario (details.reason: exige_papel_funcionario); marque o papel ou não envie os campos; nada foi gravado' },
  CENTRO_CUSTO_NOT_FOUND: { http: 404, meaning: 'id não identifica centro de custo desta empresa neste tenant' },
  CENTRO_RESULTADO_NOT_FOUND: { http: 404, meaning: 'id não identifica centro de resultado desta empresa neste tenant' },
  CENTRO_NOME_CONFLITO: { http: 409, meaning: 'já existe centro com este nome nesta empresa; nada foi gravado' },
  CENTRO_HIERARQUIA_INVALIDA: { http: 409, meaning: 'pai inválido: ciclo, profundidade máxima, pai inativo ou fora da empresa; nada foi gravado' },
  CENTRO_COM_FILHOS_ATIVOS: { http: 409, meaning: 'o centro tem filhos ativos; inative-os antes; nada foi gravado' },
  CENTRO_LIMITE_ATIVOS: { http: 409, meaning: 'empresa atingiu o teto de centros ativos do tipo; inativar antes de criar ou reativar' },
  // D-PROD-153 — Gestão P2: naturezas financeiras gerenciais.
  NATUREZA_FINANCEIRA_NOT_FOUND: { http: 404, meaning: 'id não identifica natureza financeira desta empresa neste tenant' },
  NATUREZA_NOME_CONFLITO: { http: 409, meaning: 'já existe natureza com este nome e tipo nesta empresa; nada foi gravado' },
  NATUREZA_HIERARQUIA_INVALIDA: { http: 409, meaning: 'pai inválido (outro tipo/empresa, inativo, ciclo, autorreferência ou profundidade); nada foi gravado' },
  NATUREZA_COM_FILHOS_ATIVOS: { http: 409, meaning: 'natureza com filhas ativas não é inativada; inativar as filhas antes' },
  CENTRO_INATIVO: { http: 409, meaning: 'centro inativo não recebe vínculo novo; nada foi gravado' },
  // D-PROD-155 — Gestão P3-01: Central Única de Lançamentos gerenciais.
  OPERACAO_FINANCEIRA_NOT_FOUND: { http: 404, meaning: 'id não identifica lançamento financeiro desta empresa neste tenant' },
  TITULO_FINANCEIRO_NOT_FOUND: { http: 404, meaning: 'id não identifica título (parcela) desta empresa neste tenant' },
  LIQUIDACAO_FINANCEIRA_NOT_FOUND: { http: 404, meaning: 'id não identifica liquidação desta empresa neste tenant' },
  PERFIL_FINANCEIRO_NAO_CONFIGURADO: { http: 409, meaning: 'a empresa não tem perfil financeiro (moeda/país/locale); configure-o antes; nada foi gravado' },
  PERFIL_FINANCEIRO_MOEDA_EM_USO: { http: 409, meaning: 'a moeda do perfil não muda com lançamentos existentes ou custo de estoque legado em BRL (details.reason); nada foi gravado' },
  OPERACAO_STATUS_INVALIDO: { http: 409, meaning: 'a situação do lançamento não permite esta ação (details.status); nada foi gravado' },
  OPERACAO_VERSAO_CONFLITO: { http: 409, meaning: 'o rascunho mudou desde a leitura (versão diferente); recarregue; nada foi gravado' },
  OPERACAO_DOCUMENTO_DUPLICADO: { http: 409, meaning: 'já existe lançamento CONFIRMADO com este documento para o mesmo parceiro e direção nesta empresa, ou (reason documento_de_entrada_manual, D-PROD-261) o lançamento com produtos tem o documento de uma entrada manual confirmada; nada foi gravado' },
  OPERACAO_RATEIO_INVALIDO: { http: 422, meaning: 'rateio inválido (soma, linha duplicada ou linha com valor zero; details.reason); nada foi gravado' },
  OPERACAO_PARCELAS_INVALIDAS: { http: 422, meaning: 'parcelas inválidas (soma, quantidade, vencimento ou valor; details.reason); nada foi gravado' },
  OPERACAO_REFERENCIA_INVALIDA: { http: 422, meaning: 'parceiro, natureza, centro, produto, local ou método recusado (details.field/reason); nada foi gravado' },
  OPERACAO_VALORES_INVALIDOS: { http: 422, meaning: 'valor zero ou negativo, total não positivo, acima do limite das colunas ou unidade do produto fora de KG/SACO/L (details.reason); nada foi gravado' },
  OPERACAO_COM_LIQUIDACOES: { http: 409, meaning: 'lançamento com liquidação ativa não é cancelado; estorne as baixas antes; nada foi alterado' },
  ESTOQUE_JA_CONSUMIDO: { http: 409, meaning: 'o estoque movimentado pelo lançamento já foi consumido ou alterado; cancelamento recusado; nada foi alterado' },
  TITULO_NAO_LIQUIDAVEL: { http: 409, meaning: 'só título ABERTO ou PARCIAL de lançamento confirmado recebe liquidação (details.status); nada foi gravado' },
  LIQUIDACAO_EXCEDE_SALDO: { http: 422, meaning: 'o valor da liquidação é maior que o saldo do título (details.saldo); nada foi gravado' },
  LIQUIDACAO_JA_ESTORNADA: { http: 409, meaning: 'esta liquidação já foi estornada; nada foi gravado' },
  FINANCEIRO_DATA_FUTURA: { http: 422, meaning: 'data posterior a hoje no fuso da fazenda: só fato já ocorrido entra (details.data/hoje/fuso); nada foi gravado' },
  // D-PROD-158 — Gestão P3-03: retificação e exclusão lógica de lançamento confirmado.
  OPERACAO_RETIFICACAO_BLOQUEADA: {
    http: 409,
    meaning: 'a correção do lançamento confirmado não é permitida agora (details.motivos: liquidação, documento histórico, dependência física, moeda); nada foi alterado',
  },
  OPERACAO_EXCLUSAO_BLOQUEADA: {
    http: 409,
    meaning: 'a exclusão do lançamento confirmado não é permitida agora (details.motivos: liquidação, documento histórico, dependência física); nada foi alterado',
  },
  // D-PROD-157 / D-PROD-162 — Patrimônio: cadastros de inventário (famílias e tipos do tenant, bens da empresa,
  // tanques e os Produtos aceitos por tanque). D-PROD-162 tirou perfis, medições, combustíveis e o fator kg/L.
  PATRIMONIO_VERSAO_CONFLITO: { http: 409, meaning: 'o registro mudou desde a leitura (details.versao_atual/versao_informada); recarregue; nada foi gravado' },
  FAMILIA_PATRIMONIAL_NAO_ENCONTRADA: { http: 404, meaning: 'id não identifica família patrimonial deste tenant' },
  TIPO_PATRIMONIAL_NAO_ENCONTRADO: { http: 404, meaning: 'id não identifica tipo patrimonial deste tenant' },
  BEM_PATRIMONIAL_NAO_ENCONTRADO: { http: 404, meaning: 'id não identifica bem patrimonial desta empresa neste tenant' },
  PATRIMONIO_CODIGO_DUPLICADO: { http: 409, meaning: 'já existe item do catálogo com este código neste tenant; nada foi gravado' },
  PATRIMONIO_NOME_DUPLICADO: { http: 409, meaning: 'já existe item do catálogo com este nome neste tenant (no tipo: neste tipo de bem/natureza, D-PROD-169); nada foi gravado' },
  // D-PROD-169 (SIMPLIFICA-02) — catálogo garantido por "Tipo de bem" (natureza) e exclusão de tipo.
  BEM_PATRIMONIAL_EM_USO: { http: 409, meaning: 'D-PROD-287: o bem já foi usado (details: abastecimentos, atividades, lancamentos): não é excluído, só inativado; nada foi apagado' },
  PATRIMONIO_TIPO_EM_USO: { http: 409, meaning: 'o tipo é usado por bem(ns) ativo(s) ou inativo(s) (details.bens): troque o tipo desses bens antes de excluir; nada foi apagado' },
  PATRIMONIO_FAMILIA_PADRAO_INDISPONIVEL: { http: 422, meaning: 'não há família padrão ativa para o tipo de bem (details.natureza/codigo_familia): ela existe inativa ou com outra natureza e não é alterada automaticamente; nada foi gravado' },
  BEM_TIPO_NATUREZA_INCOMPATIVEL: { http: 422, meaning: 'o tipo escolhido é de outro tipo de bem (details.natureza/natureza_tipo); nada foi gravado' },
  BEM_REFERENCIA_INVALIDA: { http: 422, meaning: 'família, tipo, parceiro, responsável, centro, área ou tanque recusado (details.field/reason); nada foi gravado' },
  BEM_TIPO_FAMILIA_INCOMPATIVEL: { http: 422, meaning: 'o tipo não pertence à família informada; nada foi gravado' },
  BEM_NATUREZA_IMUTAVEL: { http: 409, meaning: 'a natureza do bem não muda: a família nova é de outra natureza; nada foi gravado' },
  BEM_CAMPO_NAO_APLICAVEL: { http: 422, meaning: 'campo não se aplica à natureza do bem (details.field/natureza); nada foi gravado' },
  BEM_CAMPO_INVALIDO: { http: 422, meaning: 'placa, UF, chassi, renavam ou ano em formato inválido (details.field); nada foi gravado' },
  BEM_CODIGO_FROTA_DUPLICADO: { http: 409, meaning: 'já existe bem com este código de frota nesta empresa; nada foi gravado' },
  BEM_CODIGO_FROTA_INVALIDO: { http: 422, meaning: 'código de frota fora do padrão (letras, números, hífen ou espaço); nada foi gravado' },
  BEM_CLASSIFICACAO_INATIVA: { http: 409, meaning: 'o bem não é reativado com família ou tipo inativo; reative a classificação antes; nada foi gravado' },
  MEDIDOR_OBRIGATORIO: { http: 422, meaning: 'a natureza do bem exige medidor (pode ser SEM_MEDIDOR); nada foi gravado' },
  MEDIDOR_TIPO_IMUTAVEL: { http: 409, meaning: 'o tipo de medidor com leitura ajustada não muda (troca de painel é operação futura); nada foi gravado' },
  MEDIDOR_LEITURA_INICIAL_IMUTAVEL: { http: 409, meaning: 'a leitura inicial não muda depois de um ajuste de leitura; nada foi gravado' },
  MEDIDOR_LEITURA_REGRESSIVA: { http: 422, meaning: 'a leitura atual informada é menor que a registrada; nada foi gravado' },
  MEDIDOR_DATA_REGRESSIVA: { http: 422, meaning: 'a data da leitura é anterior à da leitura registrada; nada foi gravado' },
  MEDIDOR_DATA_FUTURA: { http: 422, meaning: 'a data da leitura é posterior a hoje no fuso da fazenda; nada foi gravado' },
  MEDIDOR_LEITURA_INVALIDA: { http: 422, meaning: 'leitura do medidor ausente quando obrigatória, informada sem contador, ou leitura atual diferente da inicial no cadastro (details.reason: obrigatoria | sem_medidor | atual_diferente_da_inicial); nada foi gravado' },
  TANQUE_IDENTIFICADOR_DUPLICADO: { http: 422, meaning: 'dois tanques do bem com o mesmo identificador (sem diferenciar maiúsculas); nada foi gravado' },
  TANQUE_CAPACIDADE_INVALIDA: { http: 422, meaning: 'capacidade do tanque zero, negativa ou acima do limite; nada foi gravado' },
  TANQUE_REMOCAO_NAO_PERMITIDA: { http: 422, meaning: 'tanque existente não é removido do bem: inative o tanque; nada foi gravado' },
  TANQUE_LIMITE_EXCEDIDO: { http: 422, meaning: 'mais tanques ativos que o limite por bem; nada foi gravado' },
  TANQUE_PRODUTO_INVALIDO: { http: 422, meaning: 'Produto aceito recusado no tanque (details.field = tanques[i].produto_ids; reason: inexistente — também de outro tenant, sem oráculo — | outra_empresa | inativo | unidade_incompativel — fora de L/KG/SACO (+details.unidade) | repetido | limite (+details.maximo)); nada foi gravado' },
  DEPRECIACAO_BEM_NAO_PROPRIO: { http: 422, meaning: 'só bem de propriedade PROPRIO tem parâmetros de depreciação; nada foi gravado' },
  DEPRECIACAO_VIDA_UTIL_INVALIDA: { http: 422, meaning: 'vida útil fora de 1 a 1200 meses; nada foi gravado' },
  DEPRECIACAO_RESIDUAL_INVALIDO: { http: 422, meaning: 'valor residual maior que o custo do bem ou percentual fora de 0 a 100; nada foi gravado' },
  DEPRECIACAO_PARAMETROS_INVALIDOS: { http: 422, meaning: 'parâmetros de depreciação incompletos ou presentes em bem não depreciável (details.field); nada foi gravado' },
  PATRIMONIO_DATA_INVALIDA: { http: 422, meaning: 'data inexistente ou fora de ordem (disponibilidade antes da aquisição, início da depreciação antes da disponibilidade); nada foi gravado' },
  // D-PROD-257 — Estoque → Entradas (entrada manual documentada e saldo de implantação), pelo motor de estoque.
  ENTRADA_ESTOQUE_NOT_FOUND: { http: 404, meaning: 'id não identifica entrada de estoque desta fazenda neste tenant' },
  ENTRADA_ESTOQUE_INVALIDA: { http: 422, meaning: 'entrada recusada (details.field/reason: motivo, produto, depósito, unidade, fornecedor, centro ou documento); nada foi gravado' },
  ENTRADA_ESTOQUE_CUSTO_ZERO: { http: 422, meaning: 'custo zero só com a declaração explícita (custo_zero); nada foi gravado' },
  // OBSOLETO (D-PROD-271): o motivo muda na edição com substituição; o backend não responde mais este código.
  // Fica no catálogo porque a tela atual (`src/lib/estoqueEntradasRegras.js`) ainda o traduz.
  ENTRADA_ESTOQUE_MOTIVO_IMUTAVEL: { http: 422, meaning: 'OBSOLETO (D-PROD-271): não é mais respondido; o motivo muda pela edição com substituição' },
  ENTRADA_ESTOQUE_IMPLANTACAO_COM_HISTORICO: { http: 409, meaning: 'o produto já tem histórico físico ou implantação ativa (details.reason); a implantação só vale para produto sem histórico; nada foi gravado' },
  ENTRADA_ESTOQUE_DEPENDENCIAS_FISICAS: { http: 409, meaning: 'o estoque desta entrada já foi consumido, movimentado ou não se prova intocado (details.reason); exclusão ou edição com substituição (D-PROD-271) recusada; nada foi alterado' },
  ENTRADA_ESTOQUE_STATUS_INVALIDO: { http: 409, meaning: 'a situação da entrada não permite esta ação (details.status); nada foi alterado' },
  ENTRADA_ESTOQUE_VERSAO_CONFLITO: { http: 409, meaning: 'a entrada mudou desde a leitura (versão diferente); recarregue; nada foi alterado' },
  ENTRADA_ESTOQUE_DOCUMENTO_CONFLITANTE: { http: 409, meaning: 'já existe entrada confirmada ou lançamento confirmado com produtos com este documento nesta fazenda (details.reason); nada foi gravado' },
  // OBSOLETO (D-PROD-271): a edição física existe (SUBSTITUICAO); o backend não responde mais este código.
  // Fica no catálogo porque a tela atual (`src/lib/estoqueEntradasRegras.js`) ainda o traduz.
  ENTRADA_ESTOQUE_EDICAO_FISICA_NAO_SUPORTADA: { http: 409, meaning: 'OBSOLETO (D-PROD-271): não é mais respondido; a edição física é a substituição' },
  // D-PROD-259 — cadastro de motivos de entrada do estoque.
  MOTIVO_ENTRADA_NOT_FOUND: { http: 404, meaning: 'id não identifica motivo de entrada deste tenant' },
  MOTIVO_ENTRADA_DUPLICADO: { http: 409, meaning: 'já existe um motivo de entrada com este nome (sem diferença de maiúsculas e espaços); nada foi gravado' },
  MOTIVO_ENTRADA_PADRAO_FIXO: { http: 422, meaning: 'o motivo padrão "Saldo de implantação" não se renomeia nem se desativa; nada foi alterado' },
  // D-PROD-264 — Estoque → Novo movimento → Saída (saída manual documentada, custo médio, pelo motor de estoque).
  SAIDA_ESTOQUE_NOT_FOUND: { http: 404, meaning: 'id não identifica saída de estoque desta fazenda neste tenant' },
  SAIDA_ESTOQUE_INVALIDA: { http: 422, meaning: 'saída recusada (details.field/reason: motivo, produto, depósito, unidade, quantidade ou centro); nada foi gravado' },
  SAIDA_ESTOQUE_STATUS_INVALIDO: { http: 409, meaning: 'a situação da saída não permite esta ação (details.status); nada foi alterado' },
  SAIDA_ESTOQUE_VERSAO_CONFLITO: { http: 409, meaning: 'a saída mudou desde a leitura (versão diferente); recarregue; nada foi alterado' },
  // OBSOLETO (D-PROD-271): a edição física existe (SUBSTITUICAO); o backend não responde mais este código.
  // Fica no catálogo porque a tela atual (`src/lib/estoqueSaidasRegras.js`) ainda o traduz.
  SAIDA_ESTOQUE_EDICAO_FISICA_NAO_SUPORTADA: { http: 409, meaning: 'OBSOLETO (D-PROD-271): não é mais respondido; a edição física é a substituição' },
  SAIDA_ESTOQUE_MOVIMENTO_POSTERIOR: { http: 409, meaning: 'o produto teve outro movimento no depósito depois da saída; a exclusão ou a edição com substituição (D-PROD-271) não é possível (details.movimento_numero); nada foi alterado' },
  MOTIVO_SAIDA_NOT_FOUND: { http: 404, meaning: 'id não identifica motivo de saída deste tenant' },
  MOTIVO_SAIDA_DUPLICADO: { http: 409, meaning: 'já existe um motivo de saída com este nome (sem diferença de maiúsculas e espaços); nada foi gravado' },
  // D-PROD-272 — Estoque → Novo movimento → Ajuste (ajuste de inventário: contado × saldo; sobra a custo médio, falta).
  AJUSTE_ESTOQUE_NOT_FOUND: { http: 404, meaning: 'id não identifica ajuste de estoque desta fazenda neste tenant' },
  AJUSTE_ESTOQUE_INVALIDO: { http: 422, meaning: 'ajuste recusado (details.field/reason: produto, depósito, unidade, contagem, custo da sobra sem saldo ou centro); nada foi gravado' },
  AJUSTE_ESTOQUE_STATUS_INVALIDO: { http: 409, meaning: 'a situação do ajuste não permite esta ação (details.status); nada foi alterado' },
  AJUSTE_ESTOQUE_VERSAO_CONFLITO: { http: 409, meaning: 'o ajuste mudou desde a leitura (versão diferente); recarregue; nada foi alterado' },
  AJUSTE_ESTOQUE_EDICAO_FISICA_NAO_SUPORTADA: { http: 409, meaning: 'só a observação se edita; para mudar a contagem ou os centros exclua e faça outro ajuste; nada foi alterado' },
  AJUSTE_ESTOQUE_MOVIMENTO_POSTERIOR: { http: 409, meaning: 'um produto do ajuste teve outro movimento no depósito depois dele; a exclusão não é possível (details.movimento_numero); nada foi alterado' },
  // D-PROD-159 / D-PROD-162 — abastecimento e consumo: baixa EXATA da quantidade digitada, na unidade de estoque
  // do Produto (L ou KG; D-PROD-169: SACO abastece em KG), pelo motor de estoque; sem conversão nem fator.
  ABASTECIMENTO_NAO_ENCONTRADO: { http: 404, meaning: 'id não identifica abastecimento desta fazenda neste tenant' },
  ABASTECIMENTO_STATUS_INVALIDO: { http: 409, meaning: 'o abastecimento não está CONFIRMADO (details.status): já foi cancelado; nada foi alterado' },
  ABASTECIMENTO_BEM_INELEGIVEL: { http: 422, meaning: 'bem inativo ou de natureza sem tanque (details.reason: bem_inativo | natureza_sem_tanque); nada foi gravado' },
  ABASTECIMENTO_TANQUE_INVALIDO: { http: 422, meaning: 'tanque inexistente neste bem ou inativo (details.reason: tanque_inexistente | tanque_inativo); nada foi gravado' },
  ABASTECIMENTO_LOCAL_INVALIDO: { http: 422, meaning: 'local de estoque inexistente neste tenant ou inativo (details.reason: local_inexistente | local_inativo); nada foi gravado' },
  ABASTECIMENTO_PRODUTO_INVALIDO: { http: 422, meaning: 'Produto recusado no abastecimento (details.reason: inexistente — também de outro tenant, sem oráculo — | outra_empresa | inativo); nada foi gravado' },
  ABASTECIMENTO_PRODUTO_NAO_ACEITO: { http: 422, meaning: 'o tanque escolhido não aceita este Produto (details.reason: nao_aceito_pelo_tanque); nada foi gravado' },
  ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL: { http: 422, meaning: 'o estoque do Produto não está em L, KG nem SACO (details.unidade); nada foi gravado' },
  ABASTECIMENTO_EXCEDE_CAPACIDADE: { http: 422, meaning: 'a quantidade em litros passa da capacidade nominal do tanque (details.capacidade_litros); só conferida para Produto em L; nada foi gravado' },
  ABASTECIMENTO_DATA_FUTURA: { http: 422, meaning: 'data do abastecimento posterior a hoje no fuso da fazenda (details.hoje/fuso); nada foi gravado' },
  // D-PROD-268 — cancelamento do lançamento de cocho e da transferência entre depósitos.
  SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO: { http: 409, meaning: 'o lançamento de cocho não pode ser cancelado com segurança agora (details.reason); nada foi alterado' },
  SUPLEMENTACAO_REGISTRO_CANCELADO: { http: 409, meaning: 'o documento de suplementação foi cancelado e não aceita alteração; nada foi alterado' },
  LANCAMENTO_DESATUALIZADO: { http: 409, meaning: 'o cocho recebeu outro lançamento ou cancelamento enquanto a tela estava aberta (details.evento_anterior_id); recarregue; nada foi gravado' },
  // D-PROD-273 (fatia 3) — exclusão com recálculo do custo médio (prévia sem escrita; a exclusão vem nas fatias 4 e 5).
  ESTOQUE_EXCLUSAO_SALDO_NEGATIVO: { http: 409, meaning: 'refeita a sequência do produto sem o movimento, o saldo de um depósito ficaria negativo (details.local_estoque_id/movimento_id/movimento_numero/saldo); nada foi alterado' },
  ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR: { http: 409, meaning: 'há registro lançado depois deste movimento, no mesmo produto e depósito (origem ou destino), que ainda vale (details.posterior_id/posterior_numero/posterior_tipo/posterior_data/local_estoque_id/local_nome); exclua primeiro o mais recente; nada foi alterado (D-PROD-313)' },
  ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL: { http: 409, meaning: 'a exclusão com recálculo não é segura para este movimento (details.reason: movimento_ja_excluido | movimento_e_estorno | origem_nao_suportada | par_de_transferencia_incoerente | historico_nao_reproduzivel | replay_diverge_do_gravado | movimento_fora_do_historico | reatribuicao_de_camada | camada_nova_sem_origem | camada_fora_da_sequencia | cocho_fechamento_nao_reproduzivel | cocho_custo_divergente_do_movimento | recalculo_nao_confere | lote_consumido); nada foi alterado' },
  ESTOQUE_RECALCULO_VOLUME_EXCEDIDO: { http: 422, meaning: 'o produto tem movimentos demais para recalcular de uma vez (details.movimentos|afetados e details.teto); nada foi processado nem gravado' },
  TRANSFERENCIA_CANCELAMENTO_BLOQUEADO: { http: 409, meaning: 'a transferência entre depósitos não pode ser cancelada com segurança agora (details.reason); nada foi alterado' },
  ABASTECIMENTO_CANCELAMENTO_BLOQUEADO: { http: 409, meaning: 'o estorno exato não é seguro agora (details.reason: produto_mudou_de_fazenda | movimento_inexistente | movimento_estornado | fatias_inconsistentes | lote_indisponivel_para_devolucao | devolucao_excede_entrada | estoque_excede_limite | unidade_mudou | vinculo_divergente | camada_divergente); nada foi alterado' },
  MEDIDOR_LEITURA_ACIMA_POSTERIOR: { http: 422, meaning: 'a leitura informada é maior que uma leitura de data posterior do mesmo medidor (details.leitura_posterior/data_posterior/origem_posterior); nada foi gravado' },
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
  // D-PROD-197 — a FK RESTRICT do Tipo de Atividade barra apagar a unidade usada
  // como unidade de produção padrão (reconhecida pela FK; o módulo da unidade
  // nunca consulta TipoAtividade). O front já conhece o código (P1.4).
  // D-PROD-200 — também a FK da Atividade (unidade de produção herdada do tipo).
  UNIDADE_MEDIDA_DELETE_BLOCKED: {
    http: 409,
    meaning: 'unidade de medida usada como unidade de produção padrão de um tipo de atividade, como unidade de produção de uma atividade ou como unidade de um serviço (details.vinculo: tipo_atividade | atividade | servico); inative em vez de excluir; nada foi apagado',
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
    meaning: 'grupo possui tipos de tarefa ou de atividade, lançamentos de tarefa ou atividades (D-PROD-200) vinculados',
  },
  TIPO_TAREFA_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica tipo de tarefa deste tenant',
  },
  TIPO_TAREFA_NAME_CONFLICT: {
    http: 409,
    meaning: 'já existe tipo de tarefa com este nome no grupo',
  },
  // D-PROD-182 — Tipo de Atividade.
  TIPO_ATIVIDADE_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica tipo de atividade deste tenant',
  },
  TIPO_ATIVIDADE_NAME_CONFLICT: {
    http: 409,
    meaning: 'já existe tipo de atividade com este nome no grupo',
  },
  // D-PROD-190 — a FK RESTRICT do apontamento barrava a exclusão do tipo usado.
  // D-PROD-200 — agora é a FK da atividade (o apontamento é filho dela).
  TIPO_ATIVIDADE_DELETE_BLOCKED: {
    http: 409,
    meaning: 'tipo de atividade usado por atividade; inative em vez de excluir',
  },
  // D-PROD-197 — padrões do Tipo de Atividade, conferidos só quando o padrão muda.
  TIPO_ATIVIDADE_PADRAO_INVALIDO: {
    http: 422,
    meaning: 'padrão do tipo de atividade recusado (details.field: centro_custo_padrao_id | centro_resultado_padrao_id | unidade_producao_id | coeficiente_padrao; details.reason: nao_encontrado — também de outro tenant, sem oráculo — | inativo | empresas_diferentes | nao_positivo); nada foi gravado',
  },
  // D-PROD-200 — Lançamento de Atividades (Fatia 2): o CABEÇALHO (Atividade) e o
  // APONTAMENTO do dia/turno (AtividadeApontamento), contrato §10.
  ATIVIDADE_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica atividade desta empresa neste tenant',
  },
  ATIVIDADE_APONTAMENTO_NOT_FOUND: {
    http: 404,
    meaning: 'apontamentoId não identifica apontamento desta atividade, desta empresa e deste tenant',
  },
  // D-PROD-249 — várias áreas por atividade (AtividadeArea).
  ATIVIDADE_AREA_NOT_FOUND: {
    http: 404,
    meaning: 'areaId não identifica área desta atividade, desta empresa e deste tenant',
  },
  ATIVIDADE_AREA_COM_LANCAMENTOS: {
    http: 409,
    meaning: 'a área da atividade tem lançamento (confirmado ou cancelado) e não sai da atividade: nada com custo é apagado (details.confirmados/cancelados); conclua a área; nada foi apagado',
  },
  // D-PROD-267 — o registro de campo acharia a atividade aberta da operação na área, mas o último dia lançado nela foi há
  // mais de 30 dias: o servidor não junta sozinho. Reenvie com `nova_atividade` false (continuar) ou true (serviço novo).
  ATIVIDADE_SERVICO_PARADO: {
    http: 409,
    meaning: 'a atividade aberta da operação nesta área está parada há mais de 30 dias (details.atividade_id, atividade_nome, ultimo_dia, area_id, dias_parado, limite_dias): diga se o registro é continuação (nova_atividade: false) ou um serviço novo (nova_atividade: true); nada foi gravado',
  },
  ATIVIDADE_REFERENCIA_INVALIDA: {
    http: 422,
    meaning: 'tipo, grupo, área, setor, máquina, centro, unidade, tarefa ou operador recusado (details.field; details.reason: inexistente — também de outro tenant, sem oráculo — | inativo | outra_empresa | grupo_inativo | natureza — a máquina, bem_id, só MAQUINA, VEICULO ou EQUIPAMENTO; D-PROD-249: areas[n].area_id e area_id duplicada | ja_na_atividade | varias_areas | com_lancamentos, area_planejada varias_areas, atividade_area_id obrigatorio | inexistente | sem_areas; tipo_atividade_id em POST /atividades/registrar: abastecimento — o tipo Abastecimento é da máquina, não do registro de campo); nada foi gravado',
  },
  ATIVIDADE_EXIGIDA_PELO_TIPO: {
    http: 422,
    meaning: 'o tipo de atividade exige o campo (details.field: area_id | safra_ciclo | bem_id | quantidade_produzida; details.reason: a flag do tipo — exige_area | exige_safra | exige_maquina | exige_producao) ou, D-PROD-202, não permite a linha (details.field: produto_id | implemento_bem_id; details.reason: permite_produto | permite_implemento; D-PROD-207: servico_id → permite_servico; mão de obra, D-PROD-208: parceiro_id → permite_mao_obra); nada foi gravado',
  },
  ATIVIDADE_DATA_INVALIDA: {
    http: 422,
    meaning: 'data recusada (details.field; details.reason: futura — posterior a hoje no fuso da fazenda, com details.data/hoje/fuso — | antes_do_inicio | antes_do_inicio_da_area — D-PROD-249 — | periodo_invertido | data_inexistente | depois_do_termino — D-PROD-265 — | antes_do_ultimo_dia — D-PROD-267: a conclusão antes do último dia lançado, com details.ultimo_dia —); nada foi gravado',
  },
  ATIVIDADE_STATUS_INVALIDO: {
    http: 409,
    meaning: 'a ação não é permitida no status atual da atividade, do apontamento, da linha ou da área (details.status, details.acao, details.entidade: atividade | apontamento | linha_produto | linha_maquina | linha_mao_obra | linha_servico | area — D-PROD-249); nada foi alterado',
  },
  ATIVIDADE_VERSAO_CONFLITO: {
    http: 409,
    meaning: 'a atividade ou o apontamento mudou desde a leitura (details.versao_atual/versao_informada/entidade); recarregue; nada foi gravado',
  },
  ATIVIDADE_MOTIVO_INVALIDO: {
    http: 422,
    meaning: 'motivo ausente, curto ou longo, em caracteres úteis (details.reason: obrigatorio | curto | longo; details.minimo/maximo); nada foi gravado',
  },
  ATIVIDADE_VINCULADA: {
    http: 409,
    meaning: 'exclusão barrada pela FK RESTRICT de uma atividade ou de um apontamento de atividade, reconhecida pelo nome da FK (details.vinculo = coluna; details.entidade: atividade | apontamento); inative o cadastro; nada foi apagado',
  },
  // MAIKE-ENTREGA3 (D-PROD-276) — a reforma de pastagem (agrupador). As outras recusas dela usam os ATIVIDADE_* com
  // details.entidade = 'planejamento' (status, versão) ou details.field (referência, data).
  PLANEJAMENTO_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica reforma (planejamento) desta empresa neste tenant',
  },
  // D-PROD-202 — Lançamento de Atividades (Fatia 3): as linhas de produto e de máquina do apontamento.
  ATIVIDADE_LINHA_NOT_FOUND: {
    http: 404,
    meaning: 'linhaId não identifica linha (details.entidade: linha_produto | linha_maquina | linha_mao_obra | linha_servico) deste apontamento, desta atividade, desta empresa e deste tenant',
  },
  ATIVIDADE_LINHA_INVALIDA: {
    http: 422,
    meaning: 'linha de produto ou de máquina recusada (details.entidade; details.field/reason — produto: produto_id inexistente | outra_empresa | inativo | unidade_nao_aceita | combustivel_no_abastecimento, local_estoque_id inexistente | inativo, quantidade quantidade_nao_positiva; máquina: bem_id, implemento_bem_id (igual_a_maquina), leituras, quantidade_uso, sem_medidor, justificativa_salto; D-PROD-207/208 mão de obra: parceiro_id parceiro_invalido — inexistente, de outra fazenda, inativo ou sem o papel funcionario nem prestador_servico, sem oráculo —, tipo_medida obrigatorio, quantidade obrigatoria | nao_positiva | custo_excede_limite, custo_unitario obrigatorio | nao_aceito; serviço: servico_id inexistente | outra_empresa | inativo, fornecedor_parceiro_id parceiro_invalido — inexistente, de outra fazenda, inativo ou sem o papel prestador_servico, sem oráculo —, valor_unitario obrigatorio); nada foi gravado',
  },
  ATIVIDADE_SALTO_MEDIDOR: {
    http: 422,
    meaning: 'o uso da linha de máquina passa do teto de salto do medidor do tipo patrimonial: informe justificativa_salto (3..500); details.quantidade_uso/salto_maximo/medidor_unidade; nada foi gravado',
  },
  ATIVIDADE_ESTORNO_BLOQUEADO: {
    http: 409,
    meaning: 'o estorno exato da linha de produto não é seguro agora (details.reason: produto_mudou_de_fazenda | unidade_mudou | movimento_inexistente | movimento_estornado | fatias_inconsistentes | lote_indisponivel_para_devolucao | devolucao_excede_entrada | estoque_excede_limite | vinculo_divergente | camada_divergente; details.linha_id/linha_ordem/lote_id; details.motor = a explicação do motor); nada foi alterado',
  },
  ATIVIDADE_DATA_COM_LINHAS: {
    http: 409,
    meaning: 'a data do apontamento não muda com linha de produto, máquina, mão de obra ou serviço confirmada (details.linhas_produto/linhas_maquina/linhas_mao_obra/linhas_servico); cancele e lance de novo; nada foi gravado',
  },
  // D-PROD-188 — Estações da fazenda (tabela CADESTACOES).
  ESTACAO_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica estação desta fazenda neste tenant',
  },
  ESTACAO_NAME_CONFLICT: {
    http: 409,
    meaning: 'já existe estação com este nome nesta fazenda',
  },
  ESTACAO_PERIODO_SOBREPOSTO: {
    http: 409,
    meaning: 'o período se sobrepõe a outra estação ativa desta fazenda',
  },
  // D-PROD-215 — Cadastro de Culturas da fazenda (tabela CADCULTURAS).
  CULTURA_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica cultura desta fazenda neste tenant',
  },
  CULTURA_NAME_CONFLICT: {
    http: 409,
    meaning: 'já existe cultura com este nome nesta fazenda',
  },
  CULTURA_CODIGO_CONFLICT: {
    http: 409,
    meaning: 'já existe cultura com este código nesta fazenda',
  },
  // D-PROD-216 — a Área aponta para a cultura (FK RESTRICT).
  CULTURA_EM_USO: {
    http: 409,
    meaning: 'a cultura está ligada a áreas desta fazenda e não pode ser excluída (details.areas: quantas)',
  },
  // D-PROD-207 — cadastro de Serviço da fazenda (Fatia 4 do Lançamento de Atividades).
  // D-PROD-208: o código 404 do cadastro de Funcionário saiu com ele (o funcionário é papel do parceiro).
  SERVICO_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica serviço desta fazenda neste tenant',
  },
  SERVICO_REFERENCIA_INVALIDA: {
    http: 422,
    meaning: 'referência do serviço recusada (details.field: unidade_medida_id | centro_custo_padrao_id; details.reason: nao_encontrado — também de outro tenant ou de outra fazenda, sem oráculo — | inativo); nada foi gravado',
  },
  // D-PROD-189 — Curvas de Ganho de Peso da fazenda (tabela CADCURVAGANHO).
  CURVA_GANHO_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica curva de ganho desta fazenda neste tenant',
  },
  CURVA_GANHO_NAME_CONFLICT: {
    http: 409,
    meaning: 'já existe curva de ganho com este nome nesta fazenda',
  },
  // D-PROD-195 — a curva ligada a categoria de manejo (FK Restrict) não é excluída.
  CURVA_GANHO_EM_USO: {
    http: 409,
    meaning: 'a curva de ganho está ligada a categoria(s) de manejo (details.categorias): troque a curva dessas categorias antes de excluir; nada foi apagado',
  },
  // D-PROD-203 — Formulações de suplemento da fazenda (tabela CADFORMULACAO).
  FORMULACAO_NOT_FOUND: {
    http: 404,
    meaning: 'id não identifica formulação desta fazenda neste tenant',
  },
  FORMULACAO_NAME_CONFLICT: {
    http: 409,
    meaning: 'já existe formulação com este nome nesta fazenda',
  },
  FORMULACAO_EM_USO: {
    http: 409,
    meaning: 'a formulação já foi usada em lançamento(s) de suplementação (details.lancamentos): inative-a em vez de excluir; nada foi apagado',
  },
  // D-PROD-219 — Medição de Forragem (tabela MEDICAOFORRAGEM).
  MEDICAO_FORRAGEM_NOT_FOUND: { http: 404, meaning: 'id não identifica medição de forragem deste tenant' },
  // D-PROD-230 — Assistente só de leitura.
  ASSISTENTE_NAO_CONFIGURADO: { http: 503, meaning: 'assistente sem chave da API da Anthropic neste servidor (ANTHROPIC_API_KEY)' },
  ASSISTENTE_INDISPONIVEL: { http: 503, meaning: 'a API do assistente não respondeu; tentar de novo' },
  // D-PROD-205 — Leitura de cocho (tabela LEITURACOCHO).
  LEITURA_COCHO_NOT_FOUND: { http: 404, meaning: 'id não identifica leitura de cocho deste tenant' },
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
    meaning: 'produto possui movimentações de estoque, itens de lançamento financeiro (D-PROD-155) ou é aceito por tanque de bem do Patrimônio (D-PROD-162, details.vinculo = tanques do patrimônio) e não pode ser excluído',
  },
  // D-PROD-162 — Produto aceito por tanque do Patrimônio e unidade de estoque em litros (L).
  PRODUTO_EM_TANQUE_PATRIMONIO: { http: 409, meaning: 'Produto aceito (ativo) em tanque ativo de bem ativo do Patrimônio não muda de fazenda (details.tanques); tire-o dos Produtos aceitos do tanque antes; nada foi gravado' },
  PRODUTO_UNIDADE_EM_USO: { http: 409, meaning: 'a unidade de estoque do Produto não muda (details.reason: estoque | lotes | movimentos | lancamentos | aceito_em_tanque; details.de/para); nada foi gravado' },
  // R2A (D-PROD-99): declarados para o 404 entre tenants não virar 500.
  MOVIMENTACAOMAPA_NOT_FOUND: { http: 404, meaning: 'id não identifica movimentação do mapa deste tenant' },
  MOVIMENTACAOPECUARIA_NOT_FOUND: { http: 404, meaning: 'id não identifica movimentação pecuária deste tenant' },
  SUPLEMENTACAOLOTE_NOT_FOUND: { http: 404, meaning: 'id não identifica lote de suplementação deste tenant' },
  // D-PROD-137 (BEB-02/BEB-03): os services de bebedouro já lançavam estes
  // códigos, mas fora do catálogo eles viravam 500 ("erro interno").
  BEBEDOURO_NOT_FOUND: { http: 404, meaning: 'id não identifica bebedouro deste tenant (e desta empresa, no histórico)' },
  // D-PROD-214: exclusão do ponto do mapa com cocho/depósito/bebedouro ligado.
  BEBEDOURO_COM_HISTORICO: { http: 409, meaning: 'bebedouro com lançamentos de histórico ou sanidade não é excluído; nada foi apagado' },
  PONTO_SUPLEMENTACAO_NOT_FOUND: { http: 404, meaning: 'id não identifica ponto de suplementação (cocho/depósito) deste tenant' },
  PONTO_SUPLEMENTACAO_COM_HISTORICO: { http: 409, meaning: 'cocho/depósito com leituras, eventos de suplementação, movimentações ou saldo de estoque não é excluído; nada foi apagado' },
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
  // D-PROD-282 — controle de lote por produto.
  ESTOQUE_LOTE_OBRIGATORIO: {
    http: 422,
    meaning: 'o produto controla lote (ou validade): a entrada exige o lote (e a validade); nada foi gravado (details.reason: lote_obrigatorio | validade_obrigatoria)',
  },
  ESTOQUE_LOTE_INVALIDO: {
    http: 422,
    meaning: 'a escolha de lotes da linha não serve (details.reason: lotes_formato | lote_repetido | lote_indisponivel | lote_sem_saldo | lotes_nao_somam | produto_sem_controle_de_lote); nada foi gravado',
  },
  // D-PROD-310 — a quantidade numa unidade de conversão do produto (cocho, transferência e linha de produto da atividade).
  UNIDADE_LANCAMENTO_INVALIDA: {
    http: 422,
    meaning: 'a unidade de conversão do lançamento não serve (details.reason: unidade_inativa | unidade_nao_cadastrada | unidade_de_outro_produto | unidade_sem_uso | unidade_incompativel | peso_por_saco_ausente | quantidade_divergente | quantidade_estoque_zero | valor_excede_limite_estoque); nada foi gravado',
  },
  ESTOQUE_ESTORNO_MODO_LOTE_DIVERGENTE: {
    http: 409,
    meaning: 'o movimento foi gravado com o produto em outro controle de lote (o cadastro mudou depois): estorno e exclusão recusados (details.reason: movimento_sem_lote | movimento_com_lote); nada foi alterado',
  },
  PRODUTO_LOTE_TROCA_COM_SALDO: {
    http: 409,
    meaning: 'controla lote/validade só muda com o saldo do produto zero em todos os depósitos; nada foi gravado',
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
  // D-PROD-161 — Estoque P0: motor físico único; entrada ≠ movimentação.
  ESTOQUE_ESCRITA_DIRETA_RECUSADA: {
    http: 409,
    meaning: 'movimento e lote de estoque só nascem, mudam de saldo/custo/situação ou deixam de existir pelos comandos do motor físico (compra/venda confirmada, suplementação, transferência, abastecimento e seus cancelamentos); escrita direta recusada (details.entidade, details.operacao, details.campos); nada foi gravado',
  },
  PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL: {
    http: 422,
    meaning: 'estoque_atual é cache derivado das entradas e movimentações e não é campo do cadastro: POST só aceita 0 ou ausente e PATCH só o valor atual (sem efeito); details.field=estoque_atual, reason=somente_leitura; nada foi gravado',
  },
  PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA: {
    http: 409,
    meaning: 'produto com lote, movimento de estoque ou estoque_atual diferente de zero não muda de empresa (lotes e movimentos ficariam na fazenda antiga); details.lotes, details.movimentos; nada foi gravado',
  },
  ESTOQUE_LOCAL_INVALIDO: {
    http: 422,
    meaning: 'local de estoque do comando inexistente neste tenant (reason local_inexistente, também de outro tenant, sem oráculo) ou destino inativo (reason local_inativo); details.field=local_origem_id|local_destino_id; nada foi gravado',
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
  REBANHO_EXCLUSAO_REGISTRO_POSTERIOR: { http: 409, meaning: 'há registro posterior (movimentação, pesagem, nutrição, sanidade, tarefa) na origem ou no destino desta movimentação; exclua primeiro o mais recente; nada foi alterado (D-PROD-311)' },
  ID_DO_APARELHO_EM_USO: { http: 409, meaning: 'o id gerado no aparelho já está em uso; o app gera outro (D-PROD-308)' },
  ID_DO_APARELHO_EXCLUIDO: { http: 409, meaning: 'o registro com este id do aparelho foi criado e depois excluído; não é recriado (D-PROD-308)' },
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
  ADMIN_CLIENTE_EDICAO_CONCORRENTE: { http: 409, meaning: 'cliente alterado em outra sessão depois da leitura (ficha ou requisição); nada foi gravado' },
  ADMIN_REEMISSAO_SENHA_DESABILITADA: { http: 503, meaning: 'reemissão de senha pelo MAIKE Admin desligada neste ambiente (gate de ativação fechado)' },
  ADMIN_USUARIO_EDICAO_CONCORRENTE: { http: 409, meaning: 'conta do usuário alterada depois da leitura da ficha (ou outra operação venceu a corrida); nada foi gravado' },
  ADMIN_REVISAO_REQUERIDA: { http: 428, meaning: 'If-Match com a revisão (ETag) da ficha ausente ou malformado' },
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
