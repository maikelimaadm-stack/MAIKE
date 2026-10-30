# MAIKE Admin — colocar no ar (guia do proprietário, D-PROD-78)

O **MAIKE Admin** é o painel onde se cadastram os **ícones do mapa** (catálogo oficial):
- é separado do MAIKE da fazenda, com endereço e login próprios (senha + código do celular);
- não aparece no menu de ninguém.

**Já feito:**
- o código (primeiro acesso pela web e encaminhamento da API);
- a pasta de imagens no Supabase (`maike-catalogo-global`).

**Antes de começar:** a PR com este código precisa estar mesclada na `main`.

## 1. Criar o projeto do painel no Vercel (≈ 2 min)

1. Vercel → **Add New… → Project** → importe o repositório **MAIKE**.
2. **Project Name:** `maike-admin`.
3. **Root Directory:** `apps/admin`. Deixe o resto como está.
4. **Deploy.** Anote o endereço gerado, por exemplo `https://maike-admin.vercel.app`.

## 2. Variáveis no projeto **`maike`**, o do MAIKE normal (≈ 3 min)

Vercel → projeto **maike** → **Settings → Environment Variables** → ambiente **Production**:

| Nome | Valor | Tipo |
|---|---|---|
| `ADMIN_MAIKE_CHAVE` | uma senha **aleatória de 40+ caracteres**, sem espaços, gerada no seu gerenciador de senhas. **Guarde-a**: você vai usá-la uma vez no primeiro acesso | Sensitive |
| `ADMIN_ORIGINS` | o endereço do passo 1, sem barra no final (ex.: `https://maike-admin.vercel.app`) | normal |
| `SUPABASE_URL` | `https://uuemcasqcdjucflulkne.supabase.co` (se ainda não existir) | normal |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → projeto MAIKE → **Settings → API Keys → service_role** (se ainda não existir) | Sensitive |

Depois: **Deployments → último deploy de Production → Redeploy**. As variáveis só valem depois disso.

Nunca cole nenhum desses valores em chat.

## 3. Primeiro acesso (≈ 3 min)

1. Abra o endereço do passo 1. Aparece **Primeiro acesso**.
2. Cole a `ADMIN_MAIKE_CHAVE`, escolha o login e uma senha (mínimo 12 caracteres) e clique **Criar proprietário**.
3. Entre com o login e a senha. O painel pede para cadastrar o **autenticador** (Google Authenticator, Microsoft Authenticator…): leia a chave mostrada e confirme com o código de 6 dígitos.
4. Guarde os **10 códigos de recuperação** fora do computador.
5. Pronto: menu **Ícones** → cadastre os ícones do mapa.

A tela de primeiro acesso some para sempre depois do passo 2.

## Se algo der errado

| Mensagem no painel | Causa | O que fazer |
|---|---|---|
| "configuração do servidor incompleta" | `ADMIN_MAIKE_CHAVE` ausente, curta ou com espaço, ou sem Redeploy | refaça o passo 2 e o Redeploy |
| "origem não autorizada" | `ADMIN_ORIGINS` diferente do endereço do painel | corrija o valor (sem barra final) e faça o Redeploy |
| erro ao enviar imagem de ícone | faltam `SUPABASE_URL` ou `SUPABASE_SERVICE_ROLE_KEY` | refaça o passo 2 |
