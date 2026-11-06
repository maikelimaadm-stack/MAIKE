/**
 * Editar Informação da posição do rebanho (D-PROD-139).
 *
 * A posição é o grupo de animais que está numa área (controle por posições).
 * Aqui só se edita o que o mapa MOSTRA sobre o grupo: nome e identificação.
 * O cadastro da entrada (Cadastro de Lotes), o saldo, a área, o peso e a
 * classificação não são tocados — esses mudam por manejo (Mover, Pesar, Mudar
 * Categoria) ou no Cadastro de Lotes.
 *
 * Só online: não vai para a fila offline. Repetir o envio é seguro (grava os
 * mesmos valores; sem mudança, o servidor não grava nem audita).
 */
import { editarInformacaoPosicaoNoServidor } from '@/services/loteManejoService';

/** Campos que a tela pode mudar; o servidor recusa qualquer outro. */
export const CAMPOS_INFORMACAO_POSICAO = Object.freeze(['nome', 'identificador_nome', 'identificador_sigla', 'identificador_cor']);

const LIMITES = Object.freeze({ nome: 255, identificador_nome: 255, identificador_sigla: 32, identificador_cor: 32 });

/** Valores iniciais do formulário a partir da posição publicada pelo servidor. */
export const valoresDaPosicao = (posicao) => ({
  nome: posicao?.nome ?? '',
  identificador_nome: posicao?.identificador_nome ?? '',
  identificador_sigla: posicao?.identificador_sigla ?? '',
  identificador_cor: posicao?.identificador_cor ?? '',
});

/** Identificador em maiúsculas, como o Cadastro de Lotes grava (o filtro e o selo do mapa comparam exato). */
const MAIUSCULAS = new Set(['identificador_nome', 'identificador_sigla']);
/** Tamanho em caracteres (code points), como o servidor e a coluna contam — não em unidades UTF-16. */
const tamanho = (texto) => [...texto].length;

const normal = (campo, valor) => {
  const bruto = typeof valor === 'string' ? valor.trim() : '';
  const texto = MAIUSCULAS.has(campo) ? bruto.toUpperCase() : bruto;
  if (campo === 'nome') return texto;
  return texto ? texto : null;
};

/**
 * Corpo do PATCH com SÓ os campos que mudaram (mais a empresa).
 * @returns {{ corpo: Record<string, string|null>|null, erro: string|null }}
 */
export const corpoInformacaoPosicao = ({ posicao, valores, empresaId }) => {
  const nome = normal('nome', valores.nome);
  if (!nome) return { corpo: null, erro: 'Informe o nome do grupo.' };
  /** @type {Record<string, string|null>} */
  const mudancas = {};
  for (const campo of CAMPOS_INFORMACAO_POSICAO) {
    // Campo que o usuário não mexeu não vai (nem normalizado): um identificador
    // antigo em minúsculas não é regravado, e um valor longo já gravado não
    // bloqueia a edição de outro campo.
    const inicial = valoresDaPosicao(posicao)[campo];
    if (String(valores[campo] ?? '').trim() === String(inicial ?? '').trim()) continue;
    const novo = normal(campo, valores[campo]);
    const atual = campo === 'nome' ? (posicao?.nome ?? '') : (posicao?.[campo] ?? null);
    if (novo === atual) continue;
    if (novo && tamanho(novo) > LIMITES[campo]) return { corpo: null, erro: `Texto longo demais (máximo ${LIMITES[campo]} caracteres).` };
    mudancas[campo] = novo;
  }
  if (!Object.keys(mudancas).length) return { corpo: null, erro: null };
  return { corpo: { empresa_id: empresaId, ...mudancas }, erro: null };
};

export const MENSAGENS_INFORMACAO_POSICAO = Object.freeze({
  ACAO_NAO_PERMITIDA: 'Sua conta não tem permissão para editar informações do lote no mapa. Nada foi gravado.',
  POSICAO_REBANHO_NOT_FOUND: 'Este grupo não existe mais nesta área (foi movido ou o mapa está desatualizado). Recarregue o mapa. Nada foi gravado.',
  POSICAO_REBANHO_VAZIA: 'Este grupo não tem mais animais nesta área. Recarregue o mapa. Nada foi gravado.',
  REBANHO_LEDGER_INATIVO: 'Esta fazenda ainda não usa o controle por posições. Edite o lote no Cadastro de Lotes. Nada foi gravado.',
  REQUEST_VALIDATION_FAILED: 'Dados inválidos (confira o nome e os textos). Nada foi gravado.',
  TENANT_CONTEXT_REQUIRED: 'Sua sessão expirou. Entre de novo. Nada foi gravado.',
});

/** Mensagem precisa para a tela — nunca sucesso falso. */
export const mensagemErroInformacaoPosicao = (erro) => {
  const codigo = (typeof erro?.cause?.code === 'string' && erro.cause.code) || (typeof erro?.code === 'string' && erro.code) || null;
  if (codigo && MENSAGENS_INFORMACAO_POSICAO[codigo]) return MENSAGENS_INFORMACAO_POSICAO[codigo];
  return 'Não foi possível confirmar a gravação (conexão ou servidor). Tente de novo: repetir não duplica nada.';
};

/**
 * Envia a edição. Devolve a posição como o servidor gravou.
 * @param {{ posicao: any, valores: Record<string, string>, empresaId: string, enviar?: (id: string, corpo: object) => Promise<any> }} p
 * @returns {Promise<{ alterados: string[], posicao: any }>}
 */
export const salvarInformacaoPosicao = async ({ posicao, valores, empresaId, enviar = editarInformacaoPosicaoNoServidor }) => {
  const { corpo, erro } = corpoInformacaoPosicao({ posicao, valores, empresaId });
  if (erro) throw Object.assign(new Error(erro), { mensagemTela: erro });
  if (!corpo) return { alterados: [], posicao };
  return enviar(posicao.id, corpo);
};
