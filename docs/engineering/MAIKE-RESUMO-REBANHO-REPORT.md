# MAIKE — Resumo do Rebanho no Mapa Geral (D-PROD-213)

## 1. Pedido

O proprietário pediu um resultado rápido para mostrar: a relação do rebanho atual por categoria, com peso, peso projetado, ganho e peso em arrobas. O conteúdo foi aprovado num modelo visual; o visual tinha de ser **igual ao padrão original do sistema**.

## 2. O que mudou

- **Entrada:** o cartão do resumo inferior do Mapa Geral (Animais · Peso méd. · Áreas) abre o diálogo "Resumo do Rebanho", com uma seta discreta à direita. Só com a permissão `visualizar_lotes` do mapa; sem ela o cartão é só informativo.
- **Diálogo:** `LancLoteDialogo` (`largo somenteLeitura`) com a casca do Detalhes do Lote v8 (`.mk-dl.mk-dl8[data-modo]`): menu de abas Rebanho / Pastos, cartões `CartaoDl`, `PilulaTitulo`, cores `COR`, seletor em pílula de fazenda igual ao "Ver como" da aba Lotes. O componente importa `mk-detalhes-lote.css` (antes só o `DetalhesLote` importava).
- **Aba Rebanho:** 4 cartões (Cabeças; Peso médio projetado hoje; Arrobas = peso vivo ÷ 30; Em 90 dias = +@ e peso médio) e lista por categoria de manejo (Cabeças, Peso hoje, Em 90 dias), ordenada pela idade mínima da faixa.
- **Aba Pastos:** lista ordenada pela lotação (UA/ha, UA = 450 kg), com cabeças, peso, fazenda e barra.
- **Filtro de fazenda:** "Todas" + um botão por `setor_nome` das áreas com rebanho (sem o prefixo "FAZENDA "); aparece com duas fazendas ou mais.

## 3. Contas (`src/domain/rebanho/resumoDoRebanho.js`, puras)

- Peso de hoje = `projecao_peso.peso_kg` (servidor, D-PROD-197/198). Sem projeção: `peso_medio_kg`, e a cabeça entra em "sem projeção" (rodapé).
- Peso em 90 dias = `pesoProjetadoNoDia`: interpolação linear entre hoje e os fins de mês de `projecao_mensal`. O GMD da curva é constante no mês, então a reta é a própria curva. Além do último fim de mês: sem valor (o horizonte de 90 dias cabe nos 12 meses do servidor).
- Médias ponderadas pelas cabeças com peso; arrobas = kg ÷ 30; UA/ha = kg ÷ 450 ÷ hectares do pasto (sem hectares: sem lotação).
- Fonte: as posições (`lotes` do mapa) e áreas já carregadas, SEM os filtros de exibição do mapa.

## 4. Testes

- `tests/smoke/resumoRebanho.test.jsx`: interpolação (dentro do mês, fim de mês, +90 dias, além do horizonte), totais, médias, @, ganho em 90 dias com posição sem projeção, UA/ha e ordenação, filtro de fazenda, posição sem peso, fazenda sem fuso; o painel nos modos celular, tablet e desktop (casca `.mk-dl8`, abas, filtro, listas).
- `tests/smoke/mapaPreferenciasIntegrada.test.jsx`: o cartão abre o diálogo com `visualizar_lotes`; sem a permissão, o cartão não vira botão.

## 5. Prints

Tirados do componente real (harness temporário com as CSS do app, não commitado), Playwright, deviceScaleFactor 2: desktop 1280×900 (Rebanho e Pastos), tablet 834×1112 (Rebanho), celular 390×844 (Rebanho e Pastos).

## 6. Fora do escopo

Ganho real (segunda pesagem), exportar PDF/planilha, valor em R$, @ de carcaça.
