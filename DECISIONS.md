# Decisões

Registro append-only. Decisão nunca é apagada — é superada por outra.

Formato: `D-xx` · data · decisão · justificativa · consequência

---

## D-01 — Tenancy: cliente único

**Decisão:** o sistema hoje atende um único cliente (operação própria).

**Consequência:** a migração de dados atribui o mesmo `cliente_id` a todos os
registros. Não há etapa de desambiguação.

**Importante:** isto **não** dispensa `cliente_id` nos models. Ver D-02.

---

## D-02 — `cliente_id` obrigatório desde o primeiro model

**Decisão:** todo model Prisma tem `cliente_id`, mesmo com um cliente único.

**Justificativa:** retrofitar multi-tenancy em 87 models depois é ordens de
grandeza mais caro e arriscado que fazer certo desde o início.

**Consequência:** travado por `gate:tenancy` e `gate:indices`.

---

## D-03 — PROJETOMG como molde arquitetural

**Decisão:** o repositório PROJETOMG é a referência de arquitetura. Não se
inventa padrão novo.

**Consequência:** divergência do molde exige justificativa escrita nesta lista.

---

## D-04 — Shim de compatibilidade antes de migrar componentes

**Decisão:** criar um cliente com assinatura idêntica à do SDK da Base44 antes
de tocar em qualquer componente.

**Justificativa:** são 2.696 chamadas espalhadas em componentes. Reescrever tudo
de uma vez é inviável e impossível de revisar.

**Consequência:** a Fase 3 vem antes da Fase 4.

---

## D-05 — Independência monotônica

**Decisão:** o acoplamento com a Base44 nunca aumenta, nem temporariamente.

**Consequência:** travado por `gate:base44` com baseline versionado.

---

## D-06 — Meta-entidades de layout avaliadas contra MDP

**Decisão:** as 11 meta-entidades de layout (`LayoutCampo`, `FormPanel`,
`CampoPersonalizado` e correlatas) não são portadas automaticamente. Cada uma é
avaliada contra o motor MDP do PROJETOMG antes de virar model próprio.

**Consequência:** escopo real cai de ~87 para ~76 entidades de domínio.

<!-- Próxima decisão: D-07 -->
