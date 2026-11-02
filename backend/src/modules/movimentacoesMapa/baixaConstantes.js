/**
 * Constantes da baixa multi-lote (Morte/Abate) — R2D-P1 (D-PROD-105). Módulo
 * sem dependências: importado pelo comando, pelo cancelamento e pelas rotas
 * sem ciclo de imports.
 */
export const COMANDO_BAIXA = 'manejo_mapa_baixa_rebanho';
export const TIPO_OPERACAO_BAIXA = 'manejo_mapa_baixa_rebanho';
export const MORTE = 'Morte';
export const ABATE = 'Abate';
export const TIPOS_BAIXA = Object.freeze([MORTE, ABATE]);
/** Uma linha por categoria escolhida no formulário (a mesma categoria pode repetir com outra causa/destino). */
export const MAX_LINHAS_BAIXA = 20;
/** Lotes que a tela mostrava (seleção opcional): só FILTRO, revalidado no servidor. */
export const MAX_LOTES_SELECIONADOS = 200;
/** Opções dos formulários atuais (FormularioMorte / FormularioAbate). */
export const CAUSAS_MORTE = Object.freeze(['Doença', 'Acidente', 'Predador', 'Natural', 'Desconhecida', 'Outra']);
export const DESTINOS_ABATE = Object.freeze(['Frigorífico', 'Açougue', 'Consumo Próprio', 'Venda Direta', 'Outro']);
/** Destinos em que o formulário exige o nome do frigorífico/cliente. */
export const DESTINOS_COM_NOME = Object.freeze(['Frigorífico', 'Açougue', 'Venda Direta', 'Outro']);
/** Teto do peso TOTAL por cabeça baixada (kg): acima disso é erro de digitação. */
export const PESO_MAXIMO_POR_CABECA_KG = 3000;
/** Política de alocação (documentada no movimento e em D-PROD-105). */
export const POLITICA_ALOCACAO = 'numero_lote_crescente_depois_id';
