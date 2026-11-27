# Relatório: cadastrar no mapa como no AgriWebb, etapa 4 — régua (D-PROD-364)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-364](./DECISIONS.md)

## Pedido

O proprietário pediu o mapa como o do AgriWebb, que tem uma ferramenta para medir distância e área sem cadastrar nada. Aqui, o único jeito era desenhar no cadastro e descartar.

## O que mudou

| Onde | Mudança |
|---|---|
| `src/pages/MapaGeral.jsx` | Botão "Medir no mapa" (régua) na coluna da direita, em qualquer aba. Abre `MapaDesenho` em `soMedir`, carregado sob demanda |
| `src/components/mapa/MapaDesenho.jsx` | `soMedir`/`onTrocarMedida`: escolha Distância · Área; perímetro já com a área aberta; sem Terminar/Salvar nem formulário; fechar sem perguntar; mensagem de área fechada sem "clique Salvar" |
| `src/styles/mapa-geral.css` | Botão da régua |

## Verificação

- `tests/smoke/reguaNoMapaD364.test.jsx`:
  - RG-01 e RG-02 falham no código antigo;
  - RG-03 garante que, fora da régua, o editor ainda pergunta ao sair com desenho.
- `tests/smoke/mapaFocoBarraV12.test.jsx` BARRA-10 falha no código antigo: a régua aparece nas abas Lotes e Pontos, abre só para medir, troca para área e fecha.

## Teste instável corrigido junto (fora do mapa)

`tests/smoke/diarioAbastecimento.test.jsx` (b), da D-PROD-359, falhava 2 em 5 também na `main` e derrubou o CI desta PR. O teste lia "Disponível neste local" logo depois de ver o Produto, mas o saldo dos locais chega por outra consulta, um instante depois. Agora o teste espera esse texto (`findByTestId`). Nada mudou no código do Diário. Passou 15 de 15.
