# MAIKE-SAAS-ADMIN-S04-P2 — Troca obrigatória da senha temporária (PR01)

Decisão: **D-PROD-144**. Base: `main` `f765177215a16ecf63a26c4435ff578750fdf7aa` (S04-P1, PR #217, já publicada).
Branch: `claude/maike-s04-p2-troca-inicial-obrigatoria`.

## 1. Problema

A fazenda criada pelo MAIKE Admin (S03) nasce com um administrador e uma senha temporária. Essa senha é gerada no servidor por CSPRNG e mostrada uma única vez, com `no-store`. Até esta PR, ela abria a sessão normal da fazenda, sem obrigar a troca.

## 2. Contrato implementado

### 2.1 Estado durável

| Item | Valor |
|---|---|
| Coluna | `Usuario.troca_senha_pendente BOOLEAN` anulável, sem DEFAULT, sem índice |
| Migration | `20261107200000_s04_p2_troca_senha_inicial` (EXPAND puro, uma instrução) |
| SHA-256 | `1236460b8daf00784a4a44b80f611701749a29f0f5e2294844d297ee594d87fb` (em `MIGRATIONS_APROVADAS`) |
| `NULL` | concluída (todas as contas anteriores) |
| Quem grava `true` | só `criarCliente` (S03), na transação Cliente + Usuario + auditoria |
| Quem grava `false` | só `POST /auth/troca-senha-inicial` |

Nenhuma conta existente muda: não há UPDATE retroativo.

### 2.2 Login limitado (`POST /auth/login`)

- O corpo da requisição não muda: `login`, `senha` e `lembrar`.
- Com a senha certa **e a troca pendente**, a resposta é `200`, com `Cache-Control: no-store` e o corpo:

  ```json
  { "troca_senha_obrigatoria": true, "token_troca_senha": "<jwt>", "expira_em_segundos": 600 }
  ```

  - Não traz `token`, `cliente_id` nem `usuario`.
  - Um frontend antigo trata essa resposta como fora do contrato e não abre sessão (falha fechada).
- O token restrito tem três proteções:
  1. **Chave própria.** É um HS256 com chave `HMAC-SHA256(AUTH_SECRET, "maike:s04-p2:troca-senha-inicial:v1")`. A assinatura não confere na guarda normal, nem vice-versa.
  2. **Escopo.** O payload traz `escopo: "troca_senha_inicial"`, mais `cliente_id`, `usuario_id`, `login` e as duas épocas do S04-P1.
  3. **Validade curta.** 10 minutos, sem renovação.
- Senha errada continua dando `401 AUTH_INVALID_CREDENTIALS`, genérico. Uma conta pendente não é distinguível de uma inexistente antes de a credencial conferir.

### 2.3 Guarda normal (`app.autenticar`)

Na mesma consulta única de revalidação, a guarda recusa:

- token com qualquer `escopo`;
- conta com `troca_senha_pendente = true`. O filtro é `OR [NULL, false]`, então `NULL` passa.

Consequência: um token normal forjado com o segredo real e as épocas certas, para uma conta pendente, recebe 401 (TP-04).

### 2.4 Conclusão (`POST /auth/troca-senha-inicial`)

- **Entrada:**
  - `Authorization: Bearer <token_troca_senha>`;
  - corpo `{senha_atual, nova_senha}` com `additionalProperties: false`. `cliente_id`, `usuario_id`, papel ou qualquer outro campo → 400.
- **Validação do token** (`onRequest`): `jwtVerify` com a chave própria, só HS256, e escopo exato.
- **Validação da conta:** relida no banco. Precisa estar ativa, com `troca_senha_pendente = true`, no mesmo cliente, com o cliente ativo e com as épocas do token iguais às do banco. Senão 401.
- **Senha temporária:** conferida por bcrypt no servidor. Se errada, 403 `USUARIO_SENHA_ATUAL_INVALIDA`. Nada é gravado, o token não é consumido e a conta não trava.
- **Política da senha nova:**
  - pelo menos 8 caracteres, o mesmo mínimo da troca comum (`usuarioRoutes`);
  - diferente da senha temporária;
  - diferente do login, sem diferenciar maiúsculas;
  - caso contrário, 400.
- **Escrita** (uma transação):
  1. `updateMany` com CAS na linha lida (pendente, mesmo `senha_hash`, mesmas épocas, cliente ativo). Grava `senha_hash` nova e `troca_senha_pendente = false`. Se `count ≠ 1`, devolve 409 `CONCURRENCY_CONFLICT`.
  2. `revogarSessoesUsuario`: época da conta +1. O próprio token restrito morre.
  3. `AuditLog`: `acao: update`, `entidade: Usuario`, `dados_novos: {troca_senha_pendente: false, sessoes_revogadas: true, origem: "troca_senha_inicial"}`, sem senha.

  Qualquer falha desfaz as três.
- **Saída:** `200 {senha_alterada: true, novo_login_obrigatorio: true}`, com `no-store`. **Não emite sessão.**

### 2.5 Interface

- **`NativeLoginForm`:**
  - quando `entrar()` devolve `{trocaSenhaObrigatoria: true}`, mostra `TrocaSenhaObrigatoriaForm`;
  - `AuthContext.entrar` não marca a sessão como autenticada;
  - não chama `/auth/contexto`;
  - não toca no token, no tenant offline nem no cache.
- **`nativeSessionApi`:**
  - o token restrito fica numa variável de módulo, nunca em storage;
  - `concluirTrocaSenhaInicial` faz UMA chamada (`nativeRequest` com `tokenDeEtapa`) e descarta a etapa em sucesso, 401, 409 ou resultado incerto;
  - mantém a etapa em 403 e 400, para a pessoa poder corrigir.
- **Tela:**
  - campos: senha temporária, nova senha e confirmação, com `autocomplete` `current-password`/`new-password`;
  - validação local antes de enviar;
  - os três campos são limpos a cada envio;
  - responsiva, com o mesmo padrão visual do login e safe-area no celular.
- **Mensagens:**

  | Resultado | O que a tela faz |
  |---|---|
  | sucesso | volta ao login com "Senha alterada. Entre com o seu usuário e a nova senha." |
  | 403 | continua na troca: "A senha temporária não confere" |
  | 400 | continua na troca e mostra as regras da senha nova |
  | 401 | volta ao login: "A etapa de troca de senha expirou" |
  | 409 | volta ao login: "A senha temporária já foi trocada" |
  | rede, timeout, 5xx ou fora do contrato | volta ao login: "Não foi possível confirmar a troca de senha", **sem repetir** |

- **MAIKE Admin:** o aviso da senha única agora diz que o primeiro acesso exige a troca.

## 3. Modelo de ameaça

| Ameaça | Barreira | Prova |
|---|---|---|
| Usar a senha temporária como sessão normal | o login não emite `token` com a troca pendente | TP-02, GES-03 |
| Usar o token restrito nas APIs da fazenda | chave diferente, recusa de `escopo` na guarda, conta pendente recusada | TP-03 |
| Forjar sessão normal para uma conta pendente | guarda relê `troca_senha_pendente` | TP-04 |
| Forjar ou alterar o token restrito (escopo, época, conta de outro tenant, expirado) | `jwtVerify` com a chave própria, escopo exato, épocas e estado relidos | TP-05 |
| Replay do token restrito depois da troca | época da conta +1 na mesma transação | TP-08 |
| Corrida ou dupla submissão | CAS no UPDATE (READ COMMITTED reavalia o WHERE) | TP-09 |
| Gravação parcial | transação única com auditoria; trigger de falha prova o rollback | TP-10 |
| Fazenda suspensa ou conta desativada no meio da troca | épocas do S04-P1 e `ativo` relidos | TP-11 |
| Identidade ou atributos autoritativos no corpo | schema fechado e barreira global de `cliente_id`/`cliente` | TP-07 |
| Enumeração de usuários | falha de credencial genérica; nada da etapa antes de a senha conferir | TP-02 |
| Segredo em storage, DOM, auditoria ou resposta | memória de módulo, limpeza dos campos, `sanitizarPayload`, sem eco | TS-01, TS-03, TS-05, TP-07, TP-08 |
| Repetição automática em erro incerto | uma chamada; etapa descartada | TS-05 |

## 4. Invariantes de tenant e época

- O tenant e a conta vêm do token restrito verificado, nunca do corpo.
- A conta é relida sempre com `id`, `cliente_id`, `ativo`, cliente ativo e as épocas S04-P1.
- A conclusão incrementa a época da conta. Sessões normais anteriores (que não existem para uma conta pendente) e o token restrito morrem.
- Contas com `troca_senha_pendente` `NULL` ou `false` seguem exatamente como no S04-P1 (TP-01, TP-12).

## 5. Erros

| Status / código | Quando |
|---|---|
| 200 `troca_senha_obrigatoria` | login com a senha temporária |
| 401 `AUTH_INVALID_CREDENTIALS` | credencial errada (genérico) |
| 401 `TENANT_CONTEXT_REQUIRED` | token restrito ausente, inválido, expirado ou de época velha; conta inativa; cliente suspenso; troca já concluída (no reuso) |
| 403 `USUARIO_SENHA_ATUAL_INVALIDA` | senha temporária errada |
| 400 `REQUEST_VALIDATION_FAILED` | senha nova curta, igual à temporária ou ao login; campos extras ou faltando |
| 409 `CONCURRENCY_CONFLICT` | corrida perdida |
| 500 `INTERNAL_ERROR` | falha interna, por exemplo da auditoria (nada fica gravado) |

Nenhum código novo no catálogo.

## 6. Manual do primeiro acesso

1. O proprietário do produto cria a fazenda no MAIKE Admin e entrega usuário e senha temporária por um canal seguro.
2. O administrador da fazenda entra no MAK Gestão com esse usuário e essa senha.
3. Aparece a tela "Troca obrigatória de senha". Ele informa a senha temporária e a nova senha duas vezes.
4. Com "Senha alterada", volta ao login e entra com a senha nova. A senha temporária deixa de funcionar.
5. Se a tela disser "Não foi possível confirmar", ele tenta entrar com a senha nova. Se não entrar, entra com a temporária: a troca não foi gravada e a tela aparece de novo.
6. Se a etapa expirar (10 min), basta entrar de novo com a senha temporária.

## 7. Offline

- O caminho da troca não chama `setOfflineTenant`/`clearOfflineTenant`.
- Não grava nem apaga token.
- Não limpa caches nem filas.
- Uma conta nova não tem fila offline. Contas existentes não passam por esta tela.
- O motor offline não foi alterado.

## 8. Testes

| Suíte | Tipo | Resultado |
|---|---|---|
| `backend/tests/trocaSenhaInicialS04P2.test.mjs` (TP-01..TP-12) | PostgreSQL real + Fastify + MAIKE Admin real (MFA) | 12/12 GREEN |
| a mesma suíte sobre o `backend/src` da `main` | prova RED | 11/12 falham (TP-12 é de preservação) |
| `adminClientesGestao` (GES-03 atualizado para o contrato novo) | PG | 17/17 |
| `sessaoTenantRevogacaoS04P1`, `sessaoTenantRevalidada`, `usuariosAutorizacaoTenant`, `foundation` | PG | verdes |
| `tests/smoke/trocaSenhaObrigatoriaS04P2.test.jsx` (TS-01..TS-08) | React, cadeia real até o `fetch` | 11/11 |
| `loginTela`, `sessaoNativa`, `sessaoShell`, `usuariosSenhaSessaoS04P1`, `usuariosSenhaHttp500S04P1`, `maikeAdminClientesGestao` | React | verdes |

**Compatibilidade**, em PostgreSQL local descartável:

- **Runtime antigo + schema novo:** com o `backend/src` da `main` sobre o banco migrado, `foundation` deu 47/47, `sessaoTenantRevogacaoS04P1` 12/12, `adminClientesGestao` 17/17 e `usuariosAutorizacaoTenant` 10/10.
- **Runtime novo + schema antigo:** sem a coluna, o login responde `500 INTERNAL_ERROR`, sem vazar o nome da coluna. `preflight-schema` diz "colunas ausentes: Usuario.troca_senha_pendente … NÃO publique".

## 9. Release (NÃO executado nesta PR)

A ordem é obrigatória, porque todo merge na `main` publica produção automaticamente:

1. Checkout do SHA aprovado e `node scripts/deploy/premerge-migrate.mjs --sha <SHA>` (análise local).
2. Conferir o alvo com `conferir-alvo-banco.mjs` e `premerge-migrate --verificar-alvo`, no ambiente protegido do operador. O esperado é **1 pendente** (esta migration).
3. Backup atualizado e restauração testada. A decisão do S04-P1 de seguir sem backup novo **não** vale para esta release.
4. Autorização explícita do proprietário, e então `premerge-migrate --aplicar` (runner oficial).
5. `preflight-schema` no mesmo banco: precisa sair verde.
6. Merge manual. Conferir produção `READY` no SHA do merge.
7. **Rollback:** voltar ao deployment anterior da Vercel. O banco migrado atende o runtime antigo. Não restaurar o banco.

**Efeito em produção:**

- Nenhum usuário atual é afetado e não há logout global.
- Só fazendas criadas pelo MAIKE Admin depois da migration exigem a troca.
- As duas fazendas existentes ficam com `NULL` e não são afetadas.

## 10. Limitações e próximos passos

- **Sem limite de tentativas no login e na troca** (não existe rate limit de fazenda hoje). A senha temporária tem cerca de 93 bits, e a troca exige o token restrito, que já pressupõe a senha temporária. Rate limit distribuído é S02.
- **Senha temporária esquecida ou vencida:** o proprietário precisa de outro caminho de reemissão (S04-P3). Hoje existe só `scripts/auth/reset-password.mjs`, que não mexe na pendência: a conta continua obrigada a trocar.
- **Contas criadas por `POST /usuarios`** (o administrador da fazenda cria um colega com senha definida por ele) não entram na troca obrigatória. Isso é gestão de usuários, S04-P3.
- **Sem convite por e-mail, recuperação de conta ou reset público** (S04-P3).
- **S02** (ADMIN_MAIKE_CHAVE, ADMIN_ORIGINS, IP confiável, rate limit) continua pendente.

## 11. Migration aplicada na produção (07/11/2026) — registro operacional

O proprietário autorizou por escrito, em 07/11/2026: "autorizo aplicar a migration do S04-P2".

A aplicação foi feita pelo conector Supabase, no mesmo formato do S04-P1 (§13 do doc S04-P1), e **não** pelo `premerge-migrate --aplicar`.

**Alvo**
- Supabase MAIKE `uuemcasqcdjucflulkne`, database `postgres`, `system_identifier` 7692130048193495360.
- Vínculo com a Vercel Production já demonstrado por correlação na release S04-P1.

**Antes**
- 31 migrations, 0 com falha; a última era `20261106200000_s04_p1_sessao_epoca`.
- A coluna nova não existia.
- 2 clientes, 4 usuários.

**Execução: uma transação**
- Guardas que abortariam se:
  - o `system_identifier` não fosse o esperado;
  - a migration já estivesse registrada;
  - o histórico não tivesse exatamente 31 migrations concluídas.
- `lock_timeout` de 5 s.
- `ALTER TABLE "Usuario" ADD COLUMN "troca_senha_pendente" BOOLEAN;`
- INSERT em `_prisma_migrations` com o checksum `1236460b…87fb` e `applied_steps_count = 1`.

**Depois** (só leitura)
- Coluna: `boolean`, anulável, sem default, 0 índices, 0 constraints.
- Registro concluído e não revertido.
- 32 migrations, 0 com falha.
- 2 clientes e 4 usuários; nenhuma conta marcada (todas `NULL`).
- `avaliarPreflight` (scripts/deploy/preflightSchemaLib.mjs): `ok: true`, 32/32, 0 pendentes, 0 falhas, 0 avisos. O CLI `preflight-schema` não foi rodado, por falta de conexão direta.
- Assinatura do schema público da produção = assinatura do banco gerado pelas 32 migrations do repositório: 804 colunas (md5 `a141791b…`) e 247 índices (md5 `6da52ea5…`).
- Produção no ar (main `f7651772`): `/api/native/health` = 200.

**Desvios em relação ao §9**
- Sem backup lógico novo nem restauração testada; a proteção são os backups automáticos do Supabase.
- Sem `conferir-alvo-banco.mjs`.

Os dois foram decisão do proprietário.

| Item | Estado |
|---|---|
| `SCHEMA_APPLIED_PRODUCTION` | **SIM** |
| `PREFLIGHT_PRODUCTION` | **SIM** (avaliador oficial sobre dados lidos) |
| `MERGE_READY` | **CANDIDATO**: o merge manual já é seguro do ponto de vista de schema |
