MAIKE-NUMERO-DECISAO (D-PROD-277) · `claude/tipo-tarefa-drop-colunas-1aznvv` · PR (a abrir)

# MAIKE — Número de decisão conferido antes da PR e antes do merge

Decisão: [D-PROD-277](./DECISIONS.md).

## Problema
Várias sessões trabalham no MAIKE ao mesmo tempo e cada uma pegava o número do marcador
`Próxima decisão` da `main`. Quem mergeava primeiro ficava com o número; as outras tinham de
renumerar, juntar a `main`, testar e enviar de novo. A Entrega 2 passou por isso seis vezes.

## O que mudou
- `scripts/dev/proxima-decisao.mjs`: imprime o próximo número livre, olhando o marcador da
  `origin/main` e os números já citados em títulos de PRs abertas. Só leitura.
- Regra **A5** em `docs/constitution/08-REGRAS-DE-IA.md`: rodar o script antes de abrir a PR e
  antes do merge; o número vai no título da PR (é assim que as outras sessões o veem reservado).
- Testes `scripts/tests/gates/proxima-decisao.test.mjs` (PD-1 a PD-3).

## Uso
```bash
node scripts/dev/proxima-decisao.mjs            # → D-PROD-NNN (+ motivo no stderr)
node scripts/dev/proxima-decisao.mjs --sem-prs  # só o marcador, sem consultar o GitHub
```

## Verificação
Ver a PR. Sem migration e sem mudança de tela ou servidor.
