/**
 * D-PROD-338 — o que a tarefa aceita de foto, conferido NA HORA da escolha (antes de salvar).
 *
 * As fotos vão dentro da tarefa (endereço `data:`), e o servidor recusa a tarefa acima de 4 MB
 * (`LIMITE_CORPO_TAREFA`, D-PROD-327). E só aceita JPEG, PNG, WebP e GIF. Antes nada era conferido:
 *  - a tarefa com muitas fotos passava do limite: com internet dava erro ao salvar; sem internet a foto ficava
 *    "precisa de atenção" para sempre;
 *  - a foto HEIC (Samsung "alta eficiência", foto vinda do iPhone) ou sem tipo era recusada pelo servidor sem
 *    explicação.
 */

/** Tipos que o servidor aceita como foto. */
export const TIPOS_DE_FOTO_ACEITOS = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const TIPO_PELA_EXTENSAO = Object.freeze({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' });

/** Folga para os outros campos da tarefa e o envelope do pedido, dentro dos 4 MB do servidor. */
export const LIMITE_DAS_FOTOS_NA_TAREFA = Math.floor(3.5 * 1024 * 1024);

/** Foto original maior que isto nem tenta abrir (o celular pode travar ao decodificar). */
export const MAIOR_FOTO_ACEITA = 40 * 1024 * 1024;

/** Quanto um arquivo de `bytes` ocupa dentro da tarefa (base64 ~4/3 + o cabeçalho `data:`). @param {number} bytes */
export const tamanhoNaTarefa = (bytes) => Math.ceil((Number(bytes) || 0) / 3) * 4 + 40;

/** @param {number} bytes */
export const emMegas = (bytes) => `${(Math.max(0, bytes) / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;

/**
 * A foto pode entrar na tarefa? Arquivo sem tipo, com extensão conhecida, ganha o tipo (o celular às vezes não diz).
 * @param {File} arquivo
 * @returns {{ ok: true, arquivo: File } | { ok: false, motivo: string }}
 */
export const conferirFotoEscolhida = (arquivo) => {
  const nome = String(arquivo?.name || 'foto');
  let tipo = String(arquivo?.type || '').toLowerCase();
  const extensao = (nome.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (tipo === 'image/heic' || tipo === 'image/heif' || extensao === 'heic' || extensao === 'heif') {
    return {
      ok: false,
      motivo: `"${nome}" está no formato HEIC, que o sistema não aceita. Na câmera do celular, escolha o formato JPEG ("Mais compatível") e tire a foto de novo.`,
    };
  }
  let final = arquivo;
  if (!tipo && TIPO_PELA_EXTENSAO[extensao] && typeof File === 'function') {
    tipo = TIPO_PELA_EXTENSAO[extensao];
    final = new File([arquivo], nome, { type: tipo });
  }
  if (!TIPOS_DE_FOTO_ACEITOS.includes(tipo)) {
    return { ok: false, motivo: `"${nome}" não é uma foto que o sistema aceita (use JPEG, PNG ou WebP).` };
  }
  if (Number(arquivo?.size) > MAIOR_FOTO_ACEITA) {
    return { ok: false, motivo: `"${nome}" é grande demais (${emMegas(arquivo.size)}). Escolha uma foto menor.` };
  }
  return { ok: true, arquivo: final };
};

/**
 * As fotos cabem na tarefa? Conta as que já estão nela (endereços), as guardadas no celular (que sobem depois e somam
 * no servidor) e as novas.
 * @param {{ salvas?: string[], guardadas?: Array<{ tamanho?: number }>, novas?: Array<Blob> }} fotos
 * @returns {{ cabe: boolean, total: number, limite: number }}
 */
export const fotosCabemNaTarefa = ({ salvas = [], guardadas = [], novas = [] }) => {
  const total =
    salvas.reduce((s, url) => s + String(url ?? '').length, 0) +
    guardadas.reduce((s, g) => s + tamanhoNaTarefa(g?.tamanho ?? 0), 0) +
    novas.reduce((s, f) => s + tamanhoNaTarefa(f?.size ?? 0), 0);
  return { cabe: total <= LIMITE_DAS_FOTOS_NA_TAREFA, total, limite: LIMITE_DAS_FOTOS_NA_TAREFA };
};

/** O aviso de quando as fotos não cabem. @param {number} total */
export const avisoDeFotosDemais = (total) =>
  `As fotos passam do tamanho que a tarefa aceita (${emMegas(total)} de ${emMegas(LIMITE_DAS_FOTOS_NA_TAREFA)}). Tire alguma foto desta tarefa ou registre o resto em outra tarefa.`;
