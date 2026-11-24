# MAIKE-DETALHES-AREA-V13 — relatório

**Decisão:** [D-PROD-289](./DECISIONS.md) · **Data:** 2026-11-24 · **Banco:** sem migration · **Servidor:** sem mudança

## O que mudou

| Antes | Agora |
|---|---|
| Abas Detalhes · Histórico (· Abate) | Detalhes · Forragem · Manejos · Custos (· Abate) |
| Detalhes empilhava área, atividades, custos e forragem | Detalhes: cartão da área + Resumo (Manejos, Custos) que leva à aba |
| "Cultura / forragem" cortado na grade | capim em destaque no cabeçalho do cartão, situação em chip |
| Atividades em linhas | aba Manejos, com barra do feito (laranja em andamento, verde finalizada, cinza planejada) |
| Histórico (registros de campo) | aba Manejos, seção "Já feito" (mesmo componente, mesmo filtro e "Excluir registro") |
| Custos em 4 linhas | aba Custos: total e por hectare em destaque, barra de composição com % |
| Forragem no fim do Detalhes | aba Forragem (mesmo painel, sem redesenho) |

## Arquivos

- `src/components/mapa/DetalhesArea.jsx` — abas novas e montagem de cada aba.
- `src/components/mapa/detalhes-area/AbaDetalhesDaArea.jsx` — `secao` = detalhes | manejos | custos; `BlocoDeCustos`; `proporcaoFeita`.
- `src/styles/mk-dp-area-v13.css` — barra do feito, resumo e custos (`mk-da13-*`).
- Testes ajustados: `detalhesAreaHistorico`, `detalhesAreaCancelarRegistro`, `mapaAtividadeAcoes`, `medicaoForragem`, `reformaPastagem`.

## Verificação

- Testes da área: 98/98. Smoke completo e `verify:all` estático no CI.

## Fora (próximas missões)

- Medições de forragem também nos Detalhes do Lote; gráfico de altura e barra de descanso.
- Tela própria para lavoura (soja, milho): plantio, colheita, produção.
