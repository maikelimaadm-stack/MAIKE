/**
 * Constantes da Junção de Lotes (R2C-P1, D-PROD-104). Módulo sem dependências
 * para ser importado pelo comando, pelo cancelamento e pela guarda do POST
 * genérico sem ciclo de imports.
 */
export const TIPO_JUNCAO = 'Junção de Lotes';
export const COMANDO_JUNCAO = 'manejo_mapa_juncao_lotes';
export const TIPO_OPERACAO_JUNCAO = 'manejo_mapa_juncao_lotes';
/** Teto de lotes absorvidos numa confirmação (a tela mostra os lotes de UMA área e categoria). */
export const MAX_ORIGENS_JUNCAO = 20;
/** Marcador do fluxo legado do navegador (snapshot em observações). */
export const MARCADOR_JUNCAO_LEGADO = '[JUNCAO_LOTES]';
