# MAIKE — Detalhe do cocho e do depósito no desenho v13 (D-PROD-284)

**Data:** 2026-11-24 · **Decisão:** [D-PROD-284](./DECISIONS.md) · **Branch:** `claude/kind-knuth-tztu1v`

## O que foi pedido

Levar ao detalhe do cocho e do depósito as mesmas personalizações aprovadas no Detalhes do Lote (D-PROD-280). O proprietário aprovou as sete abas comparando atual × proposto e pediu um ajuste: o topo do depósito quebrava no celular.

## O que mudou

Só apresentação: os mesmos dados, as mesmas ações, nenhuma chamada nova ao servidor.

| Tela | Aba | Mudança |
|---|---|---|
| Cocho | Detalhes | Saldo em destaque, barra de uso do limite operacional, barra do ciclo (lançamento → hoje → acaba), leitura em grade |
| Cocho | Fechamentos | Consumo real e desvio em destaque, régua do desvio, grade, gráfico esperado × real por fechamento |
| Cocho | Informações | Cadastro em grade, barras do limite, régua mín · ideal · máx do consumo por cabeça |
| Cocho | Histórico | Cartões curtos com kg e sacos em destaque; leituras com etiqueta da situação |
| Depósito | Detalhes | Saldo sozinho no topo, régua 0 → limite com mínimo e saldo, caixas de reposição e de mínimo, barra por produto |
| Depósito | Informações | Pastos atendidos com etiqueta da leitura e barra de nível; cadastro em grade |
| Depósito | Histórico | Cartões curtos: entrada em verde, saída em vermelho |

## Arquivos principais

- Cocho: `src/components/mapa/DetalhesPontoSuplementacao.jsx`, `src/components/mapa/cochoV13.js` (novo), `src/styles/mk-dp-cocho-v13.css` (novo), `src/components/mapa/detalhes-lote/LinhaDoTempo.jsx` (o cartão aceita `sub` e `destaque` prontos; os outros painéis não mudam)
- Depósito: `src/components/mapa/DetalhesDepositoSuplementacao.jsx`, `src/components/mapa/DepositoNivel.jsx` (`reguaDoDeposito`), `src/components/mapa/deposito/LinhaDoTempoDeposito.jsx` (novo), `src/styles/mk-dp-deposito-v13.css` (novo)

## Diferenças em relação ao protótipo aprovado

- **"Consumido (kg)" no cartão de fechamento do cocho:** não entrou. O evento só tem o consumo do grupo de cochos; mostrar esse número como do cocho estaria errado.
- **"% do lançamento" ao lado do saldo do cocho:** não entrou; o percentual já aparece uma vez, dentro do desenho (teste CV-3).
- **Régua do depósito sem limite cadastrado:** vai até max(saldo, mínimo) × 1,25, sem percentual.

## Verificação

- Suíte smoke completa depois de juntar as duas frentes: 327 arquivos, 4.122 testes, todos passando.
- Depósito conferido em tela em 360, 390 e 1280 px (normal, perto do mínimo, abaixo do mínimo, sem limite, acima do limite). Cocho conferido nas quatro abas em 390 px e na aba Detalhes em 1280 px.
- `verify:all` no CI da PR.

## Pendências

- Em `src/styles/mk-detalhes-pasto.css` ficaram regras do layout antigo do nível do depósito (`.mk-dp-deposito__nivel`, `__painel-nivel`, `__metricas`) sem uso; não foram apagadas por ser arquivo compartilhado.
- Fechamentos, Informações e Histórico do cocho no computador não foram abertos em tela.
