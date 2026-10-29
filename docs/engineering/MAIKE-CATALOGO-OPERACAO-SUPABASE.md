# Runbook — catálogo global de ícones: MAIKE Admin + Supabase

**Decisões:** D-PROD-70 (sobre D-PROD-57/60/62/69) · **Para:** proprietário do produto MAIKE.

Os ícones oficiais são dados globais do produto:

- os metadados ficam no Supabase PostgreSQL (`Catalogo*`);
- os bytes ficam no Supabase Storage (bucket `maike-catalogo-global`);
- a gestão é feita pelo **MAIKE Admin** (`apps/admin`), um app privado e separado da SPA dos clientes;
- os clientes só leem o que está publicado; nenhum tenant edita ícone, nem o admin do tenant.

> **Proibido sem aprovação separada e por escrito do proprietário:** em **produção**, aplicar migration, criar
> o proprietário, criar bucket, enviar imagens, publicar o MAIKE Admin ou alterar variáveis. Este runbook vale
> primeiro para **local** e **staging**. Nunca cole senha, chave, código TOTP ou connection string em chat,
> issue, commit ou log.

## 0. Ambientes

| Ambiente | Banco | Storage | MAIKE Admin |
|---|---|---|---|
| Local | PostgreSQL local | adaptador em memória ou Storage falso | `npm run dev:admin` → http://localhost:5174 (proxy para a API em `:3333`) |
| Staging | projeto Supabase de staging | bucket de staging | projeto Vercel "maike-admin-staging" (§3) |
| Produção | projeto Supabase de produção | bucket de produção | só depois de aprovação separada |

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
   -- esperado: 20261028250000/250100/250200, 20261029100000, 20261029200000, 20261029300000
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
| `CATALOGO_STORAGE_BUCKET` | Opcional; padrão `maike-catalogo-global`. |
| `ADMIN_MAIKE_CHAVE` | Chave-mestra (base64, ≥ 32 bytes) que cifra o segredo TOTP e assina o CSRF. **Obrigatória em produção.** Gere com `openssl rand -base64 32` direto no painel. Trocá-la invalida os autenticadores inscritos: exige nova inscrição. |
| `ADMIN_ORIGINS` | Origins exatas do MAIKE Admin, ex.: `https://admin-staging.<seu-domínio>`. Vazio em produção = nenhuma mutação admin. |
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

## 4. Criar o proprietário (uma única vez por ambiente)

```bash
DATABASE_URL=… npm run admin:bootstrap
```

- O comando é interativo: pede o login e a senha (oculta, duas vezes, mínimo de 12 caracteres) e a confirmação `CRIAR PROPRIETARIO`.
- Não existe admin padrão nem senha no código, em argumento ou em variável.
- A segunda execução é recusada (proprietário único).
- Em `NODE_ENV=production`, o comando recusa sem `ADMIN_BOOTSTRAP_ALLOW_PRODUCTION=sim`, e esse passo exige aprovação separada.

**Primeiro login no MAIKE Admin:**

1. Informe login e senha. O admin então obriga a **inscrição do segundo fator**: cadastre a chave mostrada num aplicativo autenticador e confirme com o código de 6 dígitos.
2. Os **10 códigos de recuperação** aparecem uma única vez. Guarde-os fora do computador.
3. Sem MFA confirmado, nenhuma rota de catálogo responde (403 `ADMIN_MFA_REQUIRED`).

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
- [ ] Proprietário criado uma vez, MFA ativo e códigos guardados (§4).
- [ ] Produção: **aprovação separada do proprietário** registrada.

**Rollback:**

- **Ícone ou regra:** desativar. Os lotes voltam ao aviso, sem erro.
- **MAIKE Admin:** despublicar o projeto Vercel do admin. A SPA dos clientes não depende dele.
- **Schema:** reversão manual, documentada no topo de cada migration (`20261029200000`, `20261029300000`). Antes, volte o backend para uma versão que não use as colunas e tabelas.

## 12. Portabilidade (limite atual)

- O frontend nunca fala com o Storage para escrever: a API é a barreira.
- A URL pública dos assets ainda é a do Supabase Storage (`catalogoAssetUrls.js`, `catalogoAssetStorage.js`). Trocar de provedor exige um adaptador novo nesses dois módulos e a migração dos objetos.
- Esta PR não promete portabilidade total.
