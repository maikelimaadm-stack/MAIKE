# MAIKE-SAAS-ADMIN-S04-P3 PR01 — Reemissão segura de senha temporária

Decisão: **D-PROD-145**. Base: `main` `05dda652cdf97f4e989c1a5ec11d5dce93be5e44` (S04-P2, PR #221).
Branch: `claude/maike-s04-p3-pr01-reemissao-senha-segura`.

**Sem migration e sem mudança no schema Prisma.**

## 1. Contrato

`POST /admin-maike/clientes/:id/usuarios/:usuarioId/reemitir-senha`

### Barreiras, na ordem

0. **Gate de ativação (R1), fail-closed:** `ADMIN_REEMISSAO_SENHA_HABILITADA` precisa ser exatamente `true`.
   - Ausente, vazia ou qualquer outro valor (`TRUE`, `1`, ` true`…) → 503 `ADMIN_REEMISSAO_SENHA_DESABILITADA`.
   - É o primeiro hook da rota: nada de sessão, corpo, limite, TOTP, consulta ou escrita. A resposta é idêntica para qualquer alvo, sem oráculo de existência. O service confere de novo.
   - A listagem `GET /admin-maike/clientes/:id/usuarios` devolve `reemissao_disponivel` (gate ligado **e** conta ativa). O MAIKE Admin só mostra o botão com esse campo `true` vindo do servidor. Não há flag no navegador (`VITE_*`, localStorage ou URL).
1. **Sessão do proprietário com MFA** (`exigirSessaoAdmin()`).
   - Bearer de fazenda ou o token restrito do S04-P2 sem o cookie de sessão admin → 403 `ADMIN_PRINCIPAL_REQUIRED`.
   - Sem cookie → 401.
   - Sessão pré-MFA → 403 `ADMIN_MFA_REQUIRED`.
2. **Origin permitida e CSRF da sessão.** Faltando qualquer um → 403 `ADMIN_ORIGEM_RECUSADA`.
3. **Limite por IP:** 10 tentativas em 15 min.
4. **Schema fechado.**
   - `:id` e `:usuarioId` seguem `PADRAO_ID`.
   - Corpo `{justificativa (10–500), senha_admin_atual, codigo_mfa}` com `additionalProperties: false`.
   - Senha escolhida, ids, papel, época, pendência ou hash no corpo → 400.
5. **If-Match com a revisão DA CONTA** (`"u1-…"`). Ausente ou malformado → 428 `ADMIN_REVISAO_REQUERIDA`.
6. **Reautenticação** (`reautenticarAdmin`): senha atual + TOTP NOVO.
   - Errado ou código repetido → 401 `ADMIN_CREDENCIAIS_INVALIDAS`.
   - A falha conta para o bloqueio da conta e gera um evento `sucesso: false`.
7. **Conta localizada por `id` E `cliente_id`.**
   - Conta de outro cliente ou inexistente → 422, com a mesma mensagem nos dois casos (sem oráculo).
   - Cliente suspenso → 422. Conta inativa → 422.
   - Revisão diferente da atual → 409 `ADMIN_USUARIO_EDICAO_CONCORRENTE`.
8. **Senha gerada no servidor** (`gerarSenhaTemporaria`, o CSPRNG do S03) e hash `gerarSenhaHash` (bcrypt, o SSOT do `authService`).
9. **Uma transação:**
   - `updateMany` com CAS na linha lida (mesmo `updatedAt`, mesmo hash, mesma época, conta e cliente ativos): grava `senha_hash` nova e `troca_senha_pendente = true`. Se `count ≠ 1` → 409.
   - `revogarSessoesUsuario`: época +1 (S04-P1).
   - `EventoSegurancaAdminMaike` com `acao: usuario_senha_reemitir`, ator real e os dados abaixo. Nada de senha, hash, token, CSRF ou TOTP.

     ```json
     {
       "cliente_id": "…",
       "usuario": { "id": "…", "login": "…" },
       "justificativa": "…",
       "troca_senha_obrigatoria": true,
       "sessoes_revogadas": true,
       "sessao_epoca": { "antes": 0, "depois": 1 }
     }
     ```

   Qualquer falha desfaz tudo.
10. **Resposta** `200 {senha_temporaria, usuario: {id, nome, login}, troca_senha_obrigatoria: true, sessoes_revogadas: true}`, com `Cache-Control: no-store`. Não emite sessão.

### Revisão da conta

`revisaoUsuario` = `"u1-" + sha256(JSON[id, cliente_id, updatedAt, ativo, papel_tenant, troca_senha_pendente, época])`, em base64url.

- **O que muda a revisão:**
  - qualquer atualização da linha feita pelo Prisma (`updatedAt`);
  - a época, que o S04-P1 incrementa por SQL cru sem tocar `updatedAt`.
- **O que ela não carrega:** hash, senha nem dado de terceiro.
- **Onde é servida:** em `GET /admin-maike/clientes/:id/usuarios`, campo novo `revisao` (extensão do contrato da S01, testes GES-09/consulta atualizados).
- **Onde é conferida:** duas vezes, na leitura e no CAS da escrita.

## 2. Por que não quebra S04-P1/P2 nem o tenant

- **Época:** só o helper do S04-P1 a incrementa, na mesma transação. Sessões normais e qualquer token restrito do S04-P2 morrem.
- **Próximo login:**
  - a senha antiga recebe 401;
  - a temporária nova só abre a etapa restrita do S04-P2;
  - a conclusão da troca incrementa a época de novo e exige novo login (RS-02).
- **Tenant:** a conta é localizada por `id` + `cliente_id` vindos da rota, no MAIKE Admin, que não tem sessão de fazenda. Contas e clientes vizinhos ficam intactos: o RS-01 compara a assinatura completa de clientes, contas vizinhas, empresas, permissões e AuditLog antes e depois.
- **Domínio:** papel, `ativo`, nome, login, `Cliente`, empresas e permissões não mudam.

## 3. Interface (MAIKE Admin → Clientes → ficha → Usuários)

- **Botão "Reemitir senha temporária"** só na linha de conta ativa de cliente ativo.
- **Formulário:**
  - aviso explícito: todas as sessões são encerradas, inclusive com risco para lançamentos offline não sincronizados;
  - confirmação nominal (checkbox com o login);
  - justificativa, senha atual do proprietário e código do autenticador (`one-time-code`);
  - botão bloqueado até tudo estar preenchido;
  - um envio por clique;
  - senha e código limpos a cada envio.
- **Sucesso:** painel "Nova senha temporária", mostrado uma única vez, com "Copiar senha" e aviso da área de transferência. Fechar descarta o estado. Nada vai para storage, URL, aviso, console ou `document.title`. A lista é relida, para trazer a revisão nova.
- **Erros:**

  | Resposta | O que a tela faz |
  |---|---|
  | 401 / 422 | mensagem no formulário, que pode ser corrigido |
  | 409 / 428 | fecha o formulário, mostra a orientação e relê a lista |
  | rede / 5xx | fecha, avisa que "a senha anterior pode já ter sido invalidada" e relê a lista, **sem repetir o POST** |

## 4. Testes

| Suíte | Tipo | Resultado |
|---|---|---|
| `backend/tests/adminReemitirSenhaS04P3.test.mjs` RS-01..RS-12 | PostgreSQL real + Fastify + MAIKE Admin com MFA | 12/12 GREEN |
| a mesma suíte sobre o `backend/src` da `main` | prova RED | 12/12 falham |
| `adminClientesGestao`, `adminClientesConsulta` (projeção + `revisao`) | PG | 17/17, 10/10 |
| `adminMaikeSeguranca`, `trocaSenhaInicialS04P2`, `sessaoTenantRevogacaoS04P1` | PG | verdes |
| `tests/smoke/maikeAdminReemitirSenhaS04P3.test.jsx` RU-01..RU-06 | React + transporte real do admin até o `fetch` | 10/10 |
| `tests/smoke/maikeAdminClientesGestao.test.jsx` | React | 11/11 |
| R1: RS-00a (só o literal `true` liga; ausência = fechado, em processo filho isolado) e RS-00b (desligado = 503 para dono, HTTP direto e alvo inexistente; senha, pendência, época, auditoria, TOTP, sessão e limitador intactos; a lista não oferece) | PG | 2/2 |
| R1: RU-00 (sem `reemissao_disponivel === true` do servidor não há botão, mesmo com localStorage/URL) | React | 1/1 |

Os testes ligam o gate só no objeto `env` do processo de teste e restauram o valor em `afterEach`. `process.env` não é alterado.

## 5. Release

- **Sem migration.** Os campos usados (`senha_hash`, `troca_senha_pendente`, `sessao_epoca`, `updatedAt`) já existem na produção (S04-P1/P2 aplicadas).
- **Merge seguro:** o runtime novo usa só colunas existentes. O campo novo da listagem é calculado no servidor.
- **Gate de ativação (R1):** o merge publica o código com a função **desligada**. A variável não existe em Production nem em Preview, e ausência = fechado.
  - **CODE_MERGE_READY:** pode ser SIM com o gate fechado, testes e CI verdes.
  - **OPERATIONAL_RELEASE_READY:** NÃO.
  - Criar `ADMIN_REEMISSAO_SENHA_HABILITADA=true` na Vercel é operação futura, separada, que exige o S02 concluído operacionalmente **e** aprovação específica do proprietário. Nunca nesta PR.
- **Uso em produção depende do S02:** MAIKE Admin publicado com `ADMIN_MAIKE_CHAVE`, `ADMIN_ORIGINS`, `trustProxy` e rate limit distribuído. O limitador por IP desta rota é por processo.

## 6. Limites

- O limite de tentativas é por processo. O rate limit distribuído é do S02.
- Não há "reemitir para mim mesmo" do proprietário: a recuperação de conta do proprietário é outro slice.
- Sem convite por e-mail, reset público, troca de papel, desativação ou CRUD de contas (slices futuros).
