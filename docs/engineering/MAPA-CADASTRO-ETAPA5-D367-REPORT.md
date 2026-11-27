# Relatório: cadastrar no mapa como no AgriWebb, etapa 5 — KMZ e exclusão sem internet (D-PROD-367)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-367](./DECISIONS.md)

## Pedido

O proprietário pediu o mapa como no AgriWebb, "já confirma também offline". O levantamento da etapa 1 achou duas lacunas:
- a importação só aceitava KML/GeoJSON, sem o KMZ que o Google Earth e o AgriWebb exportam;
- excluir pasto sem internet falhava com erro genérico, porque o histórico da área só pode ser conferido no servidor.

## O que mudou

| Onde | Mudança |
|---|---|
| `src/lib/geografia/kmz.js` (novo) | `kmlDoKmz`: abre o KMZ no aparelho (`fflate`) e lê o KML de dentro, só `.kml` e com o limite de tamanho. `eKmz` |
| `src/components/mapa/importacaoAreas/ImportarAreasDialog.jsx` | Aceita `.kmz`; o KML de dentro passa pela mesma leitura do `.kml` |
| `src/services/mapaService.js` | Sem internet: `excluirArea` e `excluirPontoComCascata` (ponto ligado a cocho/depósito/bebedouro ativo) avisam que precisam de conexão (`OFFLINE_DELETE_FORBIDDEN`) e não fazem nada. Ponto simples segue para a fila |

## Como fica sem internet (cadastro no mapa)

| Ação | Sem internet |
|---|---|
| Criar pasto, ponto e linha (toque, mira, caminhando) | sim: fica no aparelho e sobe depois, sem duplicar (id do aparelho) |
| Editar forma, mover ponto, editar dados | sim: sobe depois com a versão vista (sem apagar a edição de outra pessoa) |
| Excluir linha e ponto simples | sim, pela fila |
| Excluir pasto e ponto ligado a cocho/depósito/bebedouro | não: avisa que precisa de conexão e nada muda |
| Régua e GPS | sim |
| Satélite | o já visto no app fica guardado por até 30 dias |
| Importar arquivo de áreas | não: a gravação em lote é só com conexão, como antes |

## Verificação

- `tests/smoke/excluirSemInternetKmzD367.test.js`:
  - EK-03, EX-01 e EX-03 falham no código antigo;
  - EK-01 e EK-02 são do módulo novo;
  - EX-02 e EX-04 garantem que nada mudou com internet e no ponto simples sem internet.
