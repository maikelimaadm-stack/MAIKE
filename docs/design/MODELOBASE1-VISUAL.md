# ModeloBase1 — visual conversacional

Referência: simplicidade visual de interfaces como o ChatGPT, adaptada à gestão rural. Não é uma reprodução do aplicativo instalado do usuário, que não estava acessível nesta sessão.

A implementação está em `src/styles/base1-conversacional.css`, importada após a tipografia no `src/index.css`. A classe existente `body.b1-tela` delimita as telas Base1 e seus portais. O Mapa Geral mantém o tema existente.

## Fundamentos

| Token | Valor | Uso |
| --- | --- | --- |
| Superfície | `#FFFFFF` | Cartões, campos e janelas |
| Fundo | `#F7F7F8` | Área de trabalho |
| Texto | `#242424` | Informações principais |
| Texto secundário | `#646468` | Rótulos e apoio |
| Divisor | `#E5E5E7` | Separação das informações |
| Ação principal | `#292929` | Criar e salvar |
| Foco | `#0F766E` | Teclado, foco e seleção |

Botões comuns permanecem brancos. Criar/salvar usam fundo escuro com texto branco; ações destrutivas mantêm sua indicação vermelha. Cores de estados do domínio permanecem nos componentes existentes.

Cartões têm raio de 14px; controles, 10px; janelas, 18px. A escala de espaçamento usa 4, 8, 12, 16 e 24px. A fonte de interface usa a família sem serifa do sistema operacional.

## Responsividade

- Desktop (a partir de 1024px): botões de pelo menos 34px, listagens de 13px e seções com 16px de respiro.
- Tablet (640–1023px): botões de pelo menos 40px e organização de painéis já definida pelo motor.
- Celular (até 639px): botões de pelo menos 44px, listagens de 14px e controles de texto de 16px para evitar zoom involuntário no iOS.

A preferência existente de posição dos rótulos e os comportamentos de tabela, navegação, validação e formulários são preservados. O foco do teclado continua visível e a redução de movimento é respeitada.

## Verificação visual

A prévia usa B1Field, Base1PanelTabs, PillBtn e B1Janela reais, com dados demonstrativos e o CSS compilado da aplicação. Não conecta a dados nem simula uma sessão autenticada. Conferir celular (390px), tablet (820px) e desktop (1440px), incluindo campos, abas e abertura/fechamento da janela.
