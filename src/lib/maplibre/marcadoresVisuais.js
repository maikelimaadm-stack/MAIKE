/** Medidas compartilhadas pelos cochos, depósitos e tarefas do mapa. */
export const TAMANHO_PONTO_MAPA_PX = 36;

/** @param {string} fundo @param {string} [texto] @param {number} [fonte] */
export function estiloSeloPonto(fundo, texto = '#ffffff', fonte = 10) {
  return `position:absolute;left:calc(50% + 13px);top:calc(50% - 14px);transform:translate(-50%,-50%);width:16px;height:16px;box-sizing:border-box;border-radius:9999px;border:2px solid #fff;background:${fundo};color:${texto};display:flex;align-items:center;justify-content:center;font-size:${fonte}px;font-weight:700;font-family:Inter,Arial,sans-serif;line-height:1;box-shadow:0 1px 2px rgba(0,0,0,.35);pointer-events:none;`;
}

/** @param {string} cor */
export function estiloFarolPonto(cor) {
  return `position:absolute;left:calc(50% + 13px);top:calc(50% + 12px);transform:translate(-50%,-50%);width:12px;height:12px;box-sizing:border-box;border-radius:9999px;border:2px solid #fff;background:${cor};box-shadow:0 1px 2px rgba(0,0,0,.35);pointer-events:none;`;
}
