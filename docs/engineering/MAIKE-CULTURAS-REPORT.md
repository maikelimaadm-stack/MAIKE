# MAIKE-CULTURAS — Relatório

**Branch `claude/kind-knuth-tztu1v`** · Decisão: [D-PROD-215](./DECISIONS.md) ·
Runbook: [`MAIKE-CULTURAS-RUNBOOK-RELEASE.md`](./MAIKE-CULTURAS-RUNBOOK-RELEASE.md)

Primeiro passo da produção de forragem e das medições: o Cadastro de Culturas, com
as alturas de referência de entrada e de saída já numeradas na lista de referência.

## 1. Entrega

| Camada | O que entrou |
|---|---|
| Banco | `CADCULTURAS` (model `Cultura`), por fazenda: código (único na fazenda), tipo (CHECK `PASTAGEM \| CAPINEIRA \| LAVOURA \| SILAGEM`), nome (MAIÚSCULAS, único na fazenda), espécie, cultivar, `altura_entrada_cm` e `altura_saida_cm` (DECIMAL(6,1) anuláveis; CHECK > 0 e saída < entrada com as duas), observações, ativo; FKs compostas pelo tenant (Cliente e Empresa, `RESTRICT`); migration **EXPAND** `20261116400000_cadculturas` (SHA-256 `37a71c46…5715`), RLS/REVOKE. Nenhuma tabela antiga alterada, nenhum dado semeado |
| Release | manifesto e bloco RLS pinados (`MIGRATIONS_APROVADAS`, `DO_RLS_APROVADOS`); preflight de schema exige `CADCULTURAS.altura_entrada_cm`; runbook com caminhos A e B, ensaiado em banco local (SQL pronto fora do repositório, `aplicar214.sql`); testes do ferramental B31a/b/k (o B30m passa a representar o dia da D-PROD-211, sem a pasta nova) e contagens 62 → 63 migrations, 94 → 95 tabelas, 79 → 80 de tenant (premerge, preflight, SQL Editor 01–04 e o bootstrap, e os testes das migrations anteriores no padrão "no dia dela": a D-PROD-211 pelo espelho do runner, as demais com a nova fora da partida e subindo por último) |
| Backend | módulo `backend/src/modules/culturas/` (rotas, serviço, repositório): `GET /culturas`, `GET /culturas/:id`, `POST /culturas`, `PATCH /culturas/:id`, `DELETE /culturas/:id` e o comando idempotente `POST /culturas/comandos/lista-referencia`; corpo fechado; código automático (próximo número depois do maior, 3 dígitos); alturas pt-BR com `field`/`reason` no 400; conflitos 409 de nome e de código; auditoria; trava por fazenda nas escritas; tela `pec-culturas` (leitura incluída) sem concessão automática |
| Frontend | porta/API/service `culturas`; tela **Culturas** (Base1, como Estações e Formulações) no menu Manejo depois de Estações, com o botão **Incluir lista de referência**; formulário (Código automático no novo, Nome, Tipo, Espécie, Cultivar, Altura de entrada e de saída em cm, Ativo, Observações) e grade (código, nome, tipo, espécie, alturas em pt-BR, ativo); rotas `/culturas` e `/Culturas` no Vercel; ícone no menu do celular |
| Docs | D-PROD-215, este relatório, runbook, `CURRENT-STATE`, cobertura de endpoints da R2 |

## 2. A lista de referência

| Código | Nome | Espécie / cultivar | Entrada | Saída |
|---|---|---|---:|---:|
| 001 | BRACHIARIA BRIZANTHA CV. MARANDU | *Urochloa brizantha* Marandu | 25 | 15 |
| 002 | BRACHIARIA BRIZANTHA CV. XARAÉS | *Urochloa brizantha* Xaraés | 30 | 15 |
| 003 | BRACHIARIA BRIZANTHA CV. PIATÃ | *Urochloa brizantha* Piatã | 35 | 20 |
| 004 | BRACHIARIA BRIZANTHA CV. PAIAGUÁS | *Urochloa brizantha* Paiaguás | 30 | 15 |
| 005 | BRACHIARIA DECUMBENS | *Urochloa decumbens* Basilisk | 20 | 10 |
| 006 | BRACHIARIA HUMIDICOLA | *Urochloa humidicola* | 20 | 10 |
| 007 | PANICUM CV. MOMBAÇA | *Megathyrsus maximus* Mombaça | 90 | 45 |
| 008 | PANICUM CV. TANZÂNIA | *Megathyrsus maximus* Tanzânia | 70 | 35 |
| 009 | PANICUM CV. ZURI | *Megathyrsus maximus* Zuri | 75 | 35 |
| 010 | PANICUM CV. MASSAI | *Megathyrsus maximus* Massai | 55 | 25 |
| 011 | TIFTON 85 | *Cynodon* spp. Tifton 85 | 25 | 10 |

Alturas em cm, manejo rotacionado; todas `PASTAGEM`, com a observação "Valor de
referência (manejo rotacionado). Ajuste para a fazenda." O comando é idempotente
pelo nome: o que já existe é pulado (`ja_existiam`); se o código de referência já
for de outra cultura, usa o próximo número livre. Rodar de novo não duplica nada.

## 3. Validação local

- Backend `culturaNativo.test.mjs` (PostgreSQL real, 20 testes): funções puras
  (próximo código, alturas pt-BR, a lista), criação e formato público, código
  automático e normalizado, 409 de nome e de código na fazenda (permitidos em outra
  fazenda), corpo fechado, obrigatórios e tipo fechado, as 6 recusas de altura com
  `field`/`reason` (inclusive `true`, que o AJV coagiria para 1), PATCH com a
  coerência das alturas contra o valor gravado, DELETE e auditoria, isolamento entre
  tenants e entre fazendas, `EMPRESA_COM_VINCULOS`, a lista de referência (11, depois
  0; pula nome existente; código ocupado → próximo livre), permissões da tela e do
  comando, nome físico, RLS e os 2 CHECKs no banco.
- Smoke `culturas.test.jsx` (13 testes): campos e ordem, tipos, obrigatórios, envio,
  alturas, edição, leitura, grade e ordenação, tela, botão da lista e sem fazenda.
- Ensaio do caminho B (runbook §3): recusa o alvo de produção, aplica 62 → 63 com o
  local, `migrate status` em dia, `migrate diff` vazio, reexecução recusada.
- Print da tela com a lista de referência carregada (desktop 1280×900, escala 2),
  feito num harness temporário com o CSS real, fora do repositório.

## 4. Fora do escopo (próximas missões)

- Ligar a **Área** à Cultura (a Área continua com o texto de antes).
- **Altura de entrada no pasto** e **de saída no lote** (e o uso da referência da cultura).
- **Monitoramento de Forragem** (medições de altura e massa).
- **Calibragem** (altura × massa de forragem).

## 5. Verificação

Ver a PR: as etapas (gates, tipos, typecheck do backend, lint, testes dos gates,
backend, smoke, build, build do admin e o isolamento do admin) rodaram separadas,
com os resultados no corpo da PR.
