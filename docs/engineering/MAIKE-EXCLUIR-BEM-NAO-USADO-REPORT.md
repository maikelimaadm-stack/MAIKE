MAIKE-EXCLUIR-BEM-NAO-USADO (D-PROD-287) · `claude/tipo-tarefa-drop-colunas-1aznvv` · PR (a abrir)

# Relatório — excluir de vez o bem patrimonial que nunca foi usado

Pedido do proprietário (2026-11-24): "porque não consigo excluir um patrimonio?" … "eu quero excluir também". Até
aqui o bem só era inativado (D-PROD-157). Agora o bem **nunca usado** (um cadastro feito errado) pode ser excluído de
vez; o que tem histórico continua só podendo ser inativado (regra do proprietário: não apagar o que tem custo).

## O que mudou

- **Servidor:** `DELETE /bens-patrimoniais/:id?empresa_id=&versao=` → 204. Sob o `FOR UPDATE` do bem, confere a versão
  e o uso: abastecimentos (qualquer situação, cancelado também), atividades com o bem no cabeçalho e lançamentos de
  máquina (como máquina ou implemento). Com uso → 409 `BEM_PATRIMONIAL_EM_USO` (`details`: as três contagens) e nada
  sai. Sem uso: saem os produtos aceitos dos tanques, os tanques e o bem; fica a auditoria `delete` com o bem inteiro.
  Uma referência que a conferência não conheça é barrada pelo próprio banco (FK `RESTRICT`) e vira o mesmo 409.
- **Permissão:** a ação padrão **"excluir"** da tela Bens Patrimoniais (Administração › Permissões); o administrador já
  tem. Inativar continua com a ação "inativar".
- **Tela:** o botão **"Excluir"** aparece na barra da lista (com a permissão). Confirmação: "Excluir este bem de vez? Só
  sai o bem que nunca foi usado…". O que já foi usado não sai, e o aviso diz: "<nome>: já foi usado (abastecimento,
  atividade ou lançamento) e não pode ser excluído. Use "Inativar bem patrimonial" no menu ⋯."
- **Banco:** nenhuma migration.

## Verificação

- `backend/tests/bemPatrimonialExcluir.test.mjs` (Postgres real): 3/3 — bem novo com tanque e aceite sai inteiro; com
  abastecimento (cancelado) → 409 e nada sai; versão velha 409, outra fazenda 404, sem "excluir" 403. Com
  `patrimonioP1Bens` e `patrimonioP1Catalogos`: 34/34.
- Navegador real (tela + servidor + PostgreSQL local): dois bens, "Trator errado" selecionado → "Excluir" → confirmação →
  some da lista; "Trator bom" fica.
- Smoke de permissões ajustado (a ação `excluir` no mapa de ações da tela).
