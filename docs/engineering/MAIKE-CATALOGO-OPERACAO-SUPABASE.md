# Runbook — catálogo global de ícones: MAIKE Admin + Supabase

**Decisões:** D-PROD-70, D-PROD-71, D-PROD-72 (sobre D-PROD-57/60/62/69) · **Para:** proprietário do produto MAIKE.

Os ícones oficiais são dados globais do produto:

- os metadados ficam no Supabase PostgreSQL (`Catalogo*`);
- os bytes ficam no Supabase Storage (bucket `maike-catalogo-global`);
- a gestão é feita pelo **MAIKE Admin** (`apps/admin`), um app privado e separado da SPA dos clientes;
- os clientes só leem o que está publicado; nenhum tenant edita ícone, nem o admin do tenant.

> **Proibido sem aprovação separada e por escrito do proprietário:** em **produção**, aplicar migration, criar
> o proprietário, promover administrador de fazenda, criar bucket, enviar imagens, publicar o MAIKE Admin ou alterar variáveis. Este runbook vale
> primeiro para **local** e **staging**. Nunca cole senha, chave, código TOTP ou connection string em chat,
> issue, commit ou log.

## 0. Ambientes

| Ambiente | Banco | Storage | MAIKE Admin |
|---|---|---|---|
| Local | PostgreSQL local | adaptador em memória ou Storage falso | `npm run dev:admin` → http://localhost:5174 (proxy para a API em `:3333`) |
| Staging | projeto Supabase de staging | bucket de staging | projeto Vercel "maike-admin-staging" (§3) |
| Produção | projeto Supabase de produção | bucket de produção | só depois de aprovação separada |

## 0b. Rollout seguro da PR #145 — ordem pré-merge (D-PROD-72)

**Por que a ordem importa.** O projeto Vercel `maike` publica a `main` em produção **automaticamente** a cada merge, com SPA e API juntas (`/api/native` → `/api/fastify`). O build **não** roda migrations.

O backend desta PR sobre o banco atual responde **500** (Prisma P2022) em Usuários, Permissões e Categoria de Manejo, e `/health` continua `ok`. Prova local: `evidencias/catalogo-icones-lotes-01/rollout-r5/B-r4-sem-migration.txt`.

Já o código atual da `main`, sobre o banco **com** as migrations aditivas, funciona igual (`C-main-banco-migrado.txt`). Por isso:

- **as migrations vêm ANTES do merge**;
- voltar a aplicação para a `main` anterior é um rollback válido, sem desfazer o schema.

**Estado de produção lido em 29/10/2026** (só leitura; `rollout-r5/00-estado-producao-somente-leitura.txt`; revalidar na janela):

- faltam **7 migrations**: 4 já da `main` (`20261028250000`, `…250100`, `…250200`, `20261029100000`) e as 3 desta PR;
- não há bucket;
- não existem `ADMIN_MAIKE_CHAVE` nem `ADMIN_ORIGINS`;
- há 1 cliente com 1 usuário e 1 `Permissao.is_admin=true` legado, que **não** vira administrador.

Status: **FEITO** = provado; **PENDENTE** = ainda não executado; **—** = não se aplica. Nenhum passo de produção foi executado.

| # | Etapa | Pré-condição | Execução manual | Evidência | Rollback | Bloqueia merge? | Local / Staging / Produção |
|---|---|---|---|---|---|---|---|
| 1 | Aprovação escrita do proprietário | — | O proprietário registra, por escrito, a janela e cada ação: migrations, quem promover, envs, bucket, projeto do admin, bootstrap | registro da aprovação | — | **SIM** | — / PENDENTE / PENDENTE |
| 2 | Backup / PITR | 1 | Supabase → Database → Backups: confirmar o último backup ou o PITR ativo e anotar o horário | horário anotado | é o rollback de último recurso | **SIM** | — / PENDENTE / PENDENTE |
| 3 | Preflight "antes" (só leitura) | 1 | `DATABASE_URL=<conexão direta> node scripts/deploy/preflight-schema.mjs` (esperado: 7 pendentes, exit 1) | saída do preflight | — | não (diagnóstico) | FEITO (`preflight-antes.txt`) / PENDENTE / PENDENTE |
| 4 | Migrations aditivas | 2, 3 | `MIGRATION_DATABASE_URL=<conexão direta ou de sessão, porta 5432, nunca a 6543> npm run deploy:migrate`; repetir deve dizer "No pending migrations" | 7 "Applying migration", depois idempotente | A app da `main` segue compatível (passo 6). Reverter o schema só pelo SQL documentado no topo de cada migration, com a app já compatível; em último caso, PITR. **Nunca** `DROP` com dados | **SIM** | FEITO (`migrations-e-preflight-depois.txt`) / PENDENTE / PENDENTE |
| 5 | Auditoria só leitura | 4 | Preflight de novo (exit 0) + consultas do §1 (migrations, RLS, grants) | saída + consultas | — | **SIM** | FEITO / PENDENTE / PENDENTE |
| 6 | Backend atual com o schema expandido | 4 | Usar o MAIKE em produção **antes** do merge: login, Usuários, Permissões, Categoria de Manejo, lotes (criar/editar) | anotação do teste | — | **SIM** | FEITO (`C-main-banco-migrado.txt`) / PENDENTE / PENDENTE |
| 7 | Promover o administrador de cada fazenda (nominal) | 5 e aprovação que **nomeia** a pessoa | `DATABASE_URL=… PAPEL_TENANT_ALLOW_PRODUCTION=sim node scripts/auth/papel-tenant.mjs --cliente <codigo> --login <login> --papel administrador`, digitando `CONFIRMAR`. Depois `preflight-schema.mjs --exigir-admin-por-cliente` → exit 0 | id de auditoria `ops-papel-tenant-…` (não publicar o login) | `--papel usuario` (vale na hora) | **SIM** (sem isso, após o merge ninguém cria contas) | FEITO (`G2-provisionamento.txt`) / PENDENTE / PENDENTE |
| 8 | Merge MANUAL da PR #145 | 1–7 | Só o proprietário, no GitHub | commit de merge na `main` | Vercel → Deployments → *Instant Rollback* para o deploy anterior (`1344ffe2`): compatível com o schema novo (passo 6) | — | — / — / PENDENTE |
| 9 | Acompanhar o deploy automático e testar | 8 | Deploy da `main` READY. Positivos: login, lotes, Categoria de Manejo com ícone; o administrador cria uma conta. Negativos: o usuário comum recebe 403 ao criar conta e ao mexer em Permissões | anotação | passo 8 (rollback) | — | FEITO (`D-r4-banco-migrado.txt`, `G2`) / PENDENTE / PENDENTE |
| 10 | Projeto Vercel SEPARADO do MAIKE Admin | 9 e aprovação | §3: Root Directory `apps/admin`, domínio real, rewrite `/api/native` → backend real (**não está no repositório**; o endereço é decisão do proprietário) | URL real do admin | despublicar o projeto do admin; a SPA não depende dele | não | — / PENDENTE / PENDENTE |
| 11 | Variáveis server-only + bucket | 10 | No projeto **`maike`** (onde roda o backend): `ADMIN_MAIKE_CHAVE` (tipo *Sensitive*) e `ADMIN_ORIGINS` = a origin real do admin. No Supabase Storage: criar o bucket **público** `maike-catalogo-global` (o backend não cria; recomendado limitar no bucket os mesmos tipos e tamanho que o backend valida: PNG, JPEG, WebP, GIF, 512 KB) | nomes das variáveis (sem valor); bucket listado | remover a variável → o admin volta a 503 (falha fechada) | não | — / PENDENTE / PENDENTE |
| 12 | Smoke do deploy do admin | 10, 11 | `node scripts/admin/smoke-admin-deploy.mjs --url https://<endereço-real-do-admin>` sem falhas | saída do smoke | — | não | parcial local (`usuarios-r4/smoke-deploy-local.txt`) / PENDENTE / PENDENTE |
| 13 | Bootstrap do proprietário + MFA | 12 | §4: `DATABASE_URL=… ADMIN_BOOTSTRAP_ALLOW_PRODUCTION=sim npm run admin:bootstrap` (interativo); 1º login com inscrição TOTP; guardar os códigos | login no admin com MFA | §5 (recuperação manual) | não | FEITO (E2E admin 29/29) / PENDENTE / PENDENTE |
| 14 | Imagens reais do proprietário + publicação | 13 | §6, pelo MAIKE Admin; sem commit e sem deploy | aba Validação sem erros | desativar o ícone | não | FEITO com PNG sintéticos / PENDENTE / PENDENTE |
| 15 | Vincular a Categoria de Manejo no cliente | 14 | §8: o administrador da fazenda vincula; conferir a prévia no lote | captura | desvincular | não | FEITO (E2E R2 15/15) / PENDENTE / PENDENTE |

**NO-GO**, ou seja, não fazer o merge, se qualquer um destes faltar:

- aprovação (1);
- backup confirmado (2);
- preflight exit 0 depois das migrations (5);
- o teste do passo 6;
- administrador provisionado para cada fazenda com usuários ativos (7).

A ação mais curta para destravar é sempre o primeiro passo pendente da tabela.

**Previews da PR usam o banco de produção.** `DATABASE_URL` vale para `production` e `preview` no projeto Vercel. Os previews:

- ficam atrás da proteção SSO da Vercel;
- não rodam migrations;
- respondem 500 nas rotas que dependem das colunas novas até o passo 4.

Não use preview para testar escrita.

**Preview × produção — achado de 30/10/2026 (G3, só leitura).** Os previews recebem os mesmos valores de produção:

- `DATABASE_URL` e `MIGRATION_DATABASE_URL`;
- `AUTH_SECRET`;
- `VITE_MAIKE_API_URL`, que aponta para a API de **produção**.

Consequências:

- **Testar escrita num preview é escrever em produção.** A SPA do preview grava pela API real.
- **Um JWT emitido por um preview vale em produção.** Os dois usam o mesmo segredo.
- **Uma PR poderia migrar produção antes do merge.** Basta mudar o `buildCommand`, já que o preview tem `MIGRATION_DATABASE_URL`.

A única mitigação hoje é o SSO da Vercel nos previews.

**Proposta**, para executar só com aprovação específica:

1. Retirar `MIGRATION_DATABASE_URL` do alvo `preview`.
2. Apontar o `DATABASE_URL` de `preview` para um banco de staging ou descartável, por exemplo um branch do Supabase.
3. Dar ao `preview` um `AUTH_SECRET` próprio.
4. Dar ao `preview` um `VITE_MAIKE_API_URL` que aponte para a API do próprio preview, ou para staging.

Até lá vale: **nenhum E2E de escrita em preview**.

**Gate de backup (A6).** O plano Pro inclui backups diários; o PITR é um add-on. O conector usado pelo agente não lista backups. Antes da etapa 4, o proprietário confirma no painel (Database → Backups):

- o horário do último backup diário;
- se o PITR está ativo.

Sem essa confirmação: **NO-GO**. Para provar que o backup restaura de fato, a opção é o "restore to new project", que só roda com aprovação própria e não toca no projeto de produção.

**Checksums (A2).** As 14 migrations aplicadas com checksum são idênticas aos arquivos do repositório. Quatro constam como `manual`, aplicadas à mão no histórico: `p3_foundation`, `p4_1_setor_native`, `p4_1_r2_setor_tipo_default` e `p4_marcas_native`. O `migrate deploy` não as reaplica.

## 1. Migrations, grants e RLS (antes de tudo)

**Ordem obrigatória:**

1. backup;
2. migrations;
3. backend;
4. MAIKE Admin.

Um backend novo sobre banco antigo falha: ele grava `catalogo_categoria_visual_id` e usa as tabelas `*AdminMaike`.

1. Confirme o backup ou o PITR (Database → Backups).
2. Aplique as migrations pela conexão direta, nunca pelo pooler: `MIGRATION_DATABASE_URL=… npm run deploy:migrate`. O build da Vercel **não** roda migrations.
3. Confira com consultas só de leitura:
   ```sql
   SELECT migration_name, finished_at FROM "_prisma_migrations"
    WHERE migration_name LIKE '20261028250%' OR migration_name LIKE '20261029%' ORDER BY 1;
   -- esperado: 20261028250000/250100/250200, 20261029100000, 20261029200000, 20261029300000, 20261029400000
   SELECT papel_tenant, count(*) FROM "Usuario" GROUP BY 1;                              -- logo após a migration: só 'usuario'
   SELECT relname, relrowsecurity FROM pg_class
    WHERE relname IN ('CatalogoIcone','AuditoriaCatalogoGlobal','AdminPrincipalMaike','SessaoAdminMaike',
                      'CodigoRecuperacaoAdminMaike','EventoSegurancaAdminMaike');          -- todos com RLS = t
   SELECT table_name, grantee FROM information_schema.role_table_grants
    WHERE table_name IN ('CatalogoIcone','AdminPrincipalMaike','SessaoAdminMaike')
      AND grantee IN ('anon','authenticated');                                            -- deve vir vazio
   ```

## 2. Variáveis server-only do backend

As variáveis abaixo são só do servidor, nunca `VITE_`, e não aparecem em nenhum bundle (`gate:admin-isolation`).

| Variável | Para quê |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Upload no Storage. Em produção, configuração parcial é recusada. |
| `CATALOGO_STORAGE_BUCKET` | Opcional; padrão `maike-catalogo-global`. O bucket **precisa existir** e ser **público** (os clientes leem pela URL pública versionada); o backend não o cria. Em 29/10/2026 produção não tinha bucket nenhum. |
| `ADMIN_MAIKE_CHAVE` | Chave-mestra (base64, ≥ 32 bytes) que cifra o segredo TOTP e assina o CSRF. **Obrigatória em produção.** Gere com `openssl rand -base64 32` direto no painel. Trocá-la invalida os autenticadores inscritos: exige nova inscrição. Ausente ou inválida em produção, **todo** o MAIKE Admin responde 503 `ADMIN_INDISPONIVEL` ("configuração do servidor incompleta"), sem criar sessão: falha fechada, sem chave derivada. |
| `ADMIN_ORIGINS` | Origins exatas do MAIKE Admin (a URL real do projeto, sem barra final). Vazio em produção = nenhuma mutação admin (403 `ADMIN_ORIGEM_RECUSADA`, inclusive o login). |
| `ADMIN_SESSAO_HORAS` / `ADMIN_SESSAO_OCIOSA_MINUTOS` | Opcionais; padrões 8 h e 30 min. |

## 3. Implantar o MAIKE Admin (projeto Vercel separado)

1. Crie um **novo projeto** Vercel apontando para o mesmo repositório, com **Root Directory = `apps/admin`**.
   - O `apps/admin/vercel.json` já define install/build (`npm run build:admin`), a saída `dist` e os cabeçalhos de segurança: CSP, `frame-ancestors 'none'`, HSTS e `noindex`.
   - Não reutilize o projeto da SPA dos clientes.
2. **Mesma origin para a API.** Acrescente ao `apps/admin/vercel.json`, **antes** do fallback da SPA, o rewrite para o backend real do ambiente:
   ```json
   { "source": "/api/native/:path*", "destination": "https://<backend-do-ambiente>/api/native/:path*" }
   ```
   Com isso o cookie da sessão é first-party do domínio do admin. Não se relaxa CORS nem `SameSite`.
3. Use um domínio exclusivo (ex.: `admin-staging.<seu-domínio>`) e só HTTPS. Coloque-o em `ADMIN_ORIGINS` no backend.
4. Ter o endereço não autoriza nada: toda leitura e escrita passa pela guarda do backend (sessão + MFA + Origin + CSRF).
5. **Smoke pós-deploy (obrigatório antes do bootstrap):**
   ```bash
   node scripts/admin/smoke-admin-deploy.mjs --url https://<endereço-real-do-admin>
   ```
   Só leitura, sem credencial; o único POST é um login com login aleatório inexistente (não bloqueia a conta real). Confere HTTPS, a página do admin, CSP `frame-ancestors 'none'`, `X-Frame-Options`, HSTS, `noindex`, o proxy `/api/native` até o backend, `ADMIN_ORIGINS` contendo esta origin, a API de tenant fechada e o bundle sem credencial server-only. Cada falha vem com o diagnóstico:
   - resposta HTML em `/api/native/...` → falta o rewrite do passo 2 (caiu no fallback da SPA);
   - 503 `ADMIN_INDISPONIVEL` → backend sem `ADMIN_MAIKE_CHAVE` válida;
   - 403 `ADMIN_ORIGEM_RECUSADA` → `ADMIN_ORIGINS` sem esta origin.

   Sai com código ≠ 0 se algo falhar. Contra o Vite local os cabeçalhos falham por definição (o Vite não aplica `vercel.json`); use `--permitir-http` só para ensaio local.

## 4. Criar o proprietário (uma única vez por ambiente)

```bash
DATABASE_URL=… npm run admin:bootstrap
```

- O comando é interativo: pede o login e a senha (oculta, duas vezes, mínimo de 12 caracteres) e a confirmação `CRIAR PROPRIETARIO`.
- Não existe admin padrão nem senha no código, em argumento ou em variável.
- A segunda execução é recusada (proprietário único).
- Em `NODE_ENV=production` **ou com banco fora desta máquina** (produção, staging), o comando recusa sem `ADMIN_BOOTSTRAP_ALLOW_PRODUCTION=sim`, e esse passo exige aprovação separada.

**Primeiro login no MAIKE Admin:**

1. Informe login e senha. O admin então obriga a **inscrição do segundo fator**: cadastre a chave mostrada num aplicativo autenticador e confirme com o código de 6 dígitos.
2. Os **10 códigos de recuperação** aparecem uma única vez. Guarde-os fora do computador.
3. Sem MFA confirmado, nenhuma rota de catálogo responde (403 `ADMIN_MFA_REQUIRED`).

## 4b. Administrador da fazenda (tenant) — não confundir com o proprietário

São dois papéis diferentes (D-PROD-71):

| Papel | Onde vive | Pode | Não pode |
|---|---|---|---|
| **Proprietário do produto** | `AdminPrincipalMaike` (`papel = 'proprietario'`), MAIKE Admin | catálogo oficial e a própria segurança | ver ou alterar dados de qualquer fazenda |
| **Administrador da fazenda** | `Usuario.papel_tenant = 'administrador'`, SPA dos clientes | criar contas, trocar senha ou desativar **outros** usuários, gerir Permissões, tudo no próprio tenant | catálogo oficial, outras fazendas |

- `Permissao.is_admin` **não** dá poder de administrar contas: é um dado editável e não é autoridade.
- A migration `20261029400000` cria a coluna com `'usuario'` para todos e **não promove ninguém**. Logo depois do deploy, nenhuma fazenda tem administrador: ninguém cria contas até o passo abaixo. Isso é intencional (falha fechada).
- O único caminho de elevação é o script, por quem tem acesso ao banco. Não existe endpoint:
  ```bash
  DATABASE_URL=… node scripts/auth/papel-tenant.mjs --cliente <codigo-do-cliente> --login <login> --papel administrador
  ```
  - Um usuário por vez. Mostra fazenda, usuário e papel atual → novo e exige `CONFIRMAR` digitado.
  - Recusa usuário desativado. Grava `AuditLog` (`acao = 'papel_tenant'`) na mesma transação.
  - Revogar: o mesmo comando com `--papel usuario`. Vale na próxima ação privilegiada, sem novo login (o servidor relê o papel no banco).
  - Em `NODE_ENV=production` **ou com banco fora desta máquina**, recusa sem `PAPEL_TENANT_ALLOW_PRODUCTION=sim`, antes de qualquer conexão. **Produção exige aprovação separada do proprietário, por fazenda e por pessoa.**
- Cada usuário continua trocando a **própria** senha na tela Usuários, informando a senha atual.

## 5. Conta e segurança (tela "Minha conta")

- **Trocar senha ou login:** exige senha atual + código do autenticador e encerra **todas** as sessões. Entre de novo depois.
- **Encerrar outras sessões:** use se suspeitar de acesso indevido.
- **Perdi o autenticador:** na tela do segundo fator, escolha "usar código de recuperação". Cada código vale uma vez e encerra as outras sessões. Depois, gere novos códigos em "Minha conta".
- **Perdi senha e códigos:** não há reset por e-mail. Quem tem acesso ao banco, com aprovação, faz em transação: `UPDATE "AdminPrincipalMaike" SET ativo = false, chave_proprietario = NULL WHERE chave_proprietario = 'proprietario';` e revoga as sessões (`UPDATE "SessaoAdminMaike" SET revogada_em = now(), motivo_revogacao = 'recuperacao_manual' WHERE revogada_em IS NULL;`). Depois roda um novo bootstrap. A linha antiga e o histórico de auditoria ficam.
- **Bloqueio:**
  - 5 falhas seguidas de senha ou código bloqueiam a conta por 15 minutos;
  - rajadas por IP recebem 429;
  - a mensagem é sempre genérica.

## 6. Cadastrar e trocar ícones (via MAIKE Admin)

As imagens são **as do proprietário, sem alteração**: o admin envia os bytes como estão.

- Formatos: PNG, JPEG, WebP e GIF. **SVG é recusado.**
- Limite: 512 KB (`CATALOGO_ASSET_MAX_BYTES`). Acima disso, exporte menor; o limite não é aumentado em silêncio.

1. **Tipos e categorias:**
   - crie o tipo `lote` (o único que a Categoria de Manejo dos clientes vincula);
   - crie as categorias com **código lógico estável** (minúsculas, números e `_`). O código não muda depois; rótulo, ordem e estado podem mudar;
   - nada é apagado: "Desativar" tira a categoria da leitura dos clientes.
2. **Ícones → Novo ícone:**
   - escolha tipo e categoria, a **imagem principal** e, se houver, o **subícone** (dois arquivos distintos);
   - a cor de fallback é opcional;
   - a prévia local aparece antes do envio; deixe "Publicar em seguida" marcado ou publique depois.
3. **Trocar uma imagem:** use "Trocar imagem" ou "Trocar subícone" no cartão do ícone.
   - O **id do ícone se mantém**; só o asset, a URL versionada e a revisão mudam.
   - Não precisa de commit nem de deploy. Os clientes veem a imagem nova em até 60 s.
4. **Desativar e reativar:** "Desativar" é soft delete (registro e imagens ficam); "Publicar" de novo reativa o mesmo id.
5. **Precedência:** mantenha um ícone publicado por categoria. Se houver mais de um, vale o de maior revisão, e a aba Validação avisa.
6. **Conflito:** se outra sessão alterou o catálogo, a tela mostra "alterado em outra sessão" e recarrega. Nada é sobrescrito (CAS / 409).
7. **Falha no meio do cadastro** (rede caiu entre a imagem principal, o subícone e o ícone): a tela mostra "Já concluído: …" e o botão **Tentar de novo** reenvia só o que faltou, reaproveitando as imagens já enviadas e o ícone já criado. Trocar o arquivo ou a categoria refaz só a parte afetada.
8. **Imagem sem uso:** a aba Validação avisa `ASSET_SEM_USO` para imagens enviadas sem ícone associado (troca de imagem, cadastro interrompido). É inofensivo para os clientes e **nada é apagado automaticamente**.

## 7. Regras MISTO

- São uma regra **visual** do catálogo: um conjunto de categorias (2 ou mais, do mesmo tipo) → um ícone resultado.
  **Não** é o sexo "Misto" do lote, e **não altera o mapa atual** (o renderer segue no legado `ConfiguracaoIcone`, congelado).
- A regra é criada como rascunho. Só publica com o ícone resultado publicado. Pode ser editada (conjunto, ícone, prioridade; o id fica) e desativada.
- Um conjunto duplicado é recusado.
- A aba **Validação** aponta:
  - duplicatas;
  - empates (mesma prioridade e especificidade com sobreposição);
  - regra com ícone não publicado;
  - categoria sem ícone;
  - ícone publicado sem imagem.

## 8. Associação à Categoria de Manejo (clientes)

- No MAIKE dos clientes, o formulário **Categoria de Manejo** tem o campo "Ícone oficial (catálogo MAIKE)". Ele lista só categorias publicadas do tipo `lote`.
- O `FormularioLote` mostra a prévia ao criar, editar e duplicar. Sem vínculo, mostra um aviso discreto. Se o catálogo estiver fora do ar, o lote salva assim mesmo.

## 9. CLI de contingência (opcional)

`scripts/catalogo/importar-icones.mjs` usa a mesma sessão do proprietário: senha + TOTP (`MAIKE_ADMIN_TOTP` ou pergunta no terminal).

- O padrão é **dry-run**.
- `--apply` exige `--confirmar=<host>` e **só roda contra API local**. Em staging ou produção, use o MAIKE Admin.
- A CLI é idempotente pelo hash da imagem e reaproveita um rascunho de execução interrompida.

## 10. Validação em staging

1. Faça login no MAIKE Admin com MFA. Confirme a inscrição, os códigos e o 401 depois de "Sair".
2. Crie o tipo `lote` e as categorias. Envie um ícone com principal + subícone, publique, troque a principal e confirme que o id é o mesmo.
3. Crie uma regra MISTO, publique, e veja a aba Validação sem erros.
4. Prova negativa: um usuário de tenant e um admin de tenant recebem 403 em `/catalogo-global/admin/*` e não entram no MAIKE Admin.
5. No MAIKE dos clientes, vincule uma Categoria de Manejo e confira a prévia no lote (novo, editar, duplicar), no desktop e no celular.

## 11. Backup, rollback e checklist

- [ ] Backup/PITR antes de qualquer migration.
- [ ] Grants e RLS conferidos (§1).
- [ ] `ADMIN_MAIKE_CHAVE`, `ADMIN_ORIGINS` e Storage configurados só no servidor (§2).
- [ ] Projeto Vercel do admin separado, HTTPS, domínio exclusivo e rewrite same-origin (§3).
- [ ] `smoke-admin-deploy.mjs` sem falhas contra o endereço real (§3.5).
- [ ] Proprietário criado uma vez, MFA ativo e códigos guardados (§4).
- [ ] Administrador de cada fazenda provisionado com `papel-tenant.mjs`, com aprovação (§4b).
- [ ] Produção: **aprovação separada do proprietário** registrada.

**Rollback:**

- **Ícone ou regra:** desativar. Os lotes voltam ao aviso, sem erro.
- **MAIKE Admin:** despublicar o projeto Vercel do admin. A SPA dos clientes não depende dele.
- **Schema:** reversão manual, documentada no topo de cada migration (`20261029200000`, `20261029300000`, `20261029400000`). Antes, volte o backend para uma versão que não use as colunas e tabelas.

## 12. Portabilidade (limite atual)

- O frontend nunca fala com o Storage para escrever: a API é a barreira.
- A URL pública dos assets ainda é a do Supabase Storage (`catalogoAssetUrls.js`, `catalogoAssetStorage.js`). Trocar de provedor exige um adaptador novo nesses dois módulos e a migração dos objetos.
- Esta PR não promete portabilidade total.
