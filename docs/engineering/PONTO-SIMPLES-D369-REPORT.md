# Relatório: cadastro de ponto simples (D-PROD-369)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-369](./DECISIONS.md)

## Pedido

O proprietário pediu: "no cadastro de novo ponto seja cocho ou depósito precisa ser algo simples e correto, hoje tenho muita informação… não preciso de instruções de campos, não preciso de alertas mas em cocho… reposição etc, não preciso de campo de observações, e também veja o que pode melhorar para não ficar confuso".

## O que mudou na tela (`src/components/mapa/FormularioPonto.jsx`)

| Antes | Agora |
|---|---|
| "Ponto de referência" (o tipo) | **Tipo do ponto** |
| Campo Observações | sai da tela (o que já estava gravado continua) |
| Cocho: "Dias de alerta para reposição" e "Alerta sem lançamento" | saem da tela (padrões 3 e 10 dias no novo; os gravados continuam no editado) |
| Textos de instrução embaixo de limite, mínimo, reposição e pastos | saem |
| Caixas: área detectada, cadastre um depósito, local de estoque criado/atual, Gestão de Bebedouros | saem |
| Aviso "estoque mínimo ≥ limite" | sai |
| "Limite operacional do cocho/depósito (kg)" | **Limite do cocho/depósito (kg)** (também nas mensagens) |
| "Áreas vinculadas" / "Pastos vinculados" | **Pastos do cocho** / **Pastos do bebedouro** |
| "Depósito vinculado" | **Depósito de onde sai o produto**; sem depósito, o campo diz "Nenhum depósito cadastrado" |

Nada muda no que é gravado, nas validações e no que o mapa calcula.

## Verificação

- `tests/smoke/formularioPontoLimiteOperacional.test.jsx`:
  - FP-1 a FP-3 foram mudados de propósito para a tela nova;
  - PS-1 e PS-2 são novos e confirmam que não sobrou texto de instrução, caixa de aviso nem Observações, e que os rótulos novos aparecem;
  - FP-1 a FP-3, PS-1 e PS-2 falham no código antigo.
- `tests/smoke/g2FormularioPontoLigacoes.test.jsx`: só os nomes dos campos mudaram.
