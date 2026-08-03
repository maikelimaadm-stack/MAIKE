# 00 — Constituição MAKGESTAO

**Status:** Oficial · **Versão:** 1.0.0

---

## 1. Missão

Construir o MAIKE como um sistema nativo, escalável e exclusivamente focado em
**Pecuária — Mapa Geral + Manejo**, com o padrão arquitetural validado no
PROJETOMG, removendo integralmente a dependência da Base44.

## 2. Princípios fundadores

### P1 — Memória é o repositório
Nenhuma decisão vive apenas no chat. Toda decisão vai para `DECISIONS.md` com
identificador `D-xx`. Sessão nova começa lendo o repositório, não relembrando conversa.

### P2 — O molde já existe, mas é parcial
O PROJETOMG resolveu esta migração. Não se inventa arquitetura nova; replica-se a
disciplina que já funciona. Divergência do molde exige justificativa escrita.
O molde **não** inclui Studio, MDP/MMM, marketplace, runtime universal ou
low-code — ver D-PROD-03.

### P3 — Tenancy desde o primeiro dia
`cliente_id` entra em todo model desde o início, mesmo com um cliente único.
Retrofitar tenancy depois é o erro mais caro possível do projeto.

### P4 — Independência é monotônica
O acoplamento com a Base44 só pode diminuir. Nunca aumentar. Nem temporariamente.

### P5 — Regra sem gate é sugestão
Toda regra estrutural precisa de script que reprove. Regra que depende de alguém
lembrar não é regra.

### P6 — Uma fase por vez
Fase misturada é fase perdida. Uma fase, um PR, um relatório.

### P7 — Evidência acima de afirmação
"O gate passou" só vale com a saída do comando colada. "O código faz X" só vale
com caminho de arquivo.

## 3. Hierarquia normativa

1. Esta constituição
2. `docs/constitution/07-DO-NOT-DO.md` — proibições explícitas
3. `docs/constitution/08-REGRAS-DE-IA.md` — restrições adicionais para agentes
4. `docs/engineering/DECISIONS.md` — decisões registradas
5. `docs/engineering/ROADMAP.md` — plano de execução
6. `config/mapa-manejo-scope.json` — escopo executável do produto

Em conflito, prevalece o documento de menor número.

## 4. Emenda

Alterar esta constituição exige: registro em `docs/engineering/DECISIONS.md`, justificativa escrita
e aprovação explícita do responsável pelo projeto. Agente de IA **não emenda a
constituição** — apenas propõe.
