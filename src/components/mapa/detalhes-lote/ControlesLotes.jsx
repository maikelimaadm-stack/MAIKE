import { useEffect, useId } from 'react';
import { SECOES_LOTE } from '@/components/mapa/detalhes-lote/catalogo';
import { COR, TIPO, useAlturaPopup, useDlUi } from '@/components/mapa/detalhes-lote/pecas';

/** @typedef {import('./useEstadoLotes').EstadoLotes} EstadoLotes */
/** @typedef {import('./useEstadoLotes').Vista} Vista */
/** @typedef {import('./useEstadoLotes').FiltroAlerta} FiltroAlerta */
/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */

/** Verde do quadradinho marcado (mockup `seletor()`). */
const VERDE_CHECK = '#32d65e';

/** @type {Array<{ id: Vista, rotulo: string }>} */
const VISTAS = [
  { id: 'resumo', rotulo: 'Resumo' },
  { id: 'lote', rotulo: 'Lote' },
  { id: 'lista', rotulo: 'Lista' },
];

/** Texto do seletor de informações: 'Todas' / 'Nenhuma' / 1 nome / 'N selecionadas'. */
function textoSecoes(/** @type {string[]} */ secoes) {
  if (SECOES_LOTE.every((s) => secoes.includes(s))) return 'Todas';
  if (!secoes.length) return 'Nenhuma';
  if (secoes.length === 1) return secoes[0];
  return `${secoes.length} selecionadas`;
}

/** @param {{ on: boolean, rotulo: string, primeira: boolean, linhaToque: string, onClick: () => void }} props */
function OpcaoCheck({ on, rotulo, primeira, linhaToque, onClick }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={on}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: linhaToque,
        padding: '6px 8px', border: 0, borderTop: `1px solid ${primeira ? 'transparent' : COR.divisor}`,
        background: 'transparent', color: COR.texto, ...TIPO.texto, textAlign: 'left', cursor: 'pointer',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, flex: '0 0 14px',
          border: `1px solid ${on ? VERDE_CHECK : COR.marcador}`, borderRadius: 4, background: on ? VERDE_CHECK : '#fff',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
          <path d="m2 6 3 3 5-6" />
        </svg>
      </span>
      {rotulo}
    </button>
  );
}

/**
 * Linha de controles da aba Lotes: pílula [Resumo | Lote | Lista] + card "Filtrar"
 * com popup único (INFORMAÇÕES + ALERTAS). Mockup v8 linhas 200–230.
 *
 * @param {{ modelo: ModeloDetalhes, estado: EstadoLotes }} props
 */
export default function ControlesLotes({ modelo: _modelo, estado }) {
  const ui = useDlUi();
  const celular = ui.celular;
  const idCampo = useId();
  const idPopup = useId();
  const { popupAberto, setPopupAberto } = estado;
  const { ancora, estilo: estiloRolagem } = useAlturaPopup(popupAberto);

  // Esc fecha o popup (além de tocar fora).
  useEffect(() => {
    if (!popupAberto) return undefined;
    const aoTeclar = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') setPopupAberto(false);
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [popupAberto, setPopupAberto]);

  const todas = SECOES_LOTE.every((s) => estado.secoes.includes(s));
  const textoCampo = `${celular ? 'Filtrar' : textoSecoes(estado.secoes)}${estado.alertaAtivo ? ` · ${estado.textoAlerta}` : ''}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div
        role="group"
        aria-label="Ver como"
        style={{
          display: 'inline-flex', flex: '0 0 auto', gap: 2, padding: 3, height: 36, borderRadius: 999,
          background: '#fff', boxShadow: ui.sombraBtn, boxSizing: 'border-box',
        }}
      >
        {VISTAS.map((v) => {
          const ativa = estado.vista === v.id;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={ativa}
              onClick={() => estado.setVista(v.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '100%',
                padding: `0 ${celular ? 12 : 16}px`, border: 0, borderRadius: 999,
                background: ativa ? COR.ativo : 'transparent', color: COR.titulo,
                fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
              }}
            >
              {v.rotulo}
            </button>
          );
        })}
      </div>

      <div style={{ position: 'relative', flex: celular ? '1 1 auto' : '0 0 auto', minWidth: 0 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, height: 36, padding: `0 ${celular ? 6 : 10}px`,
            borderRadius: 12, background: '#fff', boxShadow: ui.sombra, boxSizing: 'border-box',
          }}
        >
          {!celular && (
            <label
              htmlFor={idCampo}
              style={{ whiteSpace: 'nowrap', ...TIPO.rotulo, lineHeight: 1.25, color: COR.texto }}
            >
              Filtrar
            </label>
          )}
          <button
            ref={ancora}
            id={idCampo}
            type="button"
            role="combobox"
            aria-expanded={popupAberto}
            aria-controls={idPopup}
            aria-haspopup="listbox"
            aria-label="Filtrar"
            onClick={() => setPopupAberto(!popupAberto)}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
              flex: '1 1 auto', width: celular ? '100%' : 240, minWidth: 0, height: 30, padding: '0 8px',
              border: 0, borderRadius: 8, background: COR.fundo, color: COR.texto, ...TIPO.texto,
              textAlign: 'left', cursor: 'pointer',
            }}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {textoCampo}
            </span>
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={COR.meta} strokeWidth="2.25"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>

        {popupAberto && (
          <>
            <div
              aria-hidden="true"
              onClick={() => setPopupAberto(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 20 }}
            />
            <div
              id={idPopup}
              role="group"
              aria-label="Filtrar"
              style={{
                position: 'absolute', top: 'calc(100% + 5px)', right: 0, zIndex: 21,
                width: celular ? 350 : 268, maxWidth: celular ? 'none' : 'calc(100% - 16px)',
                padding: 6, borderRadius: 12, background: '#fff', boxShadow: '0 6px 24px rgba(15, 23, 42, .14)',
                boxSizing: 'border-box',
                ...estiloRolagem,
              }}
            >
              <div role="listbox" aria-label="Informações" aria-multiselectable="true">
                <OpcaoCheck
                  on={todas}
                  rotulo="Todas"
                  primeira
                  linhaToque={ui.linhaToque}
                  onClick={estado.alternarTodas}
                />
                {SECOES_LOTE.map((s) => (
                  <OpcaoCheck
                    key={s}
                    on={estado.secoes.includes(s)}
                    rotulo={s}
                    primeira={false}
                    linhaToque={ui.linhaToque}
                    onClick={() => estado.alternarSecao(s)}
                  />
                ))}
              </div>
              <div
                style={{
                  marginTop: 6, padding: '8px 8px 2px', borderTop: `1px solid ${COR.divisor}`,
                  ...TIPO.grupo, color: COR.meta,
                }}
              >
                Alertas
              </div>
              <div role="listbox" aria-label="Alertas">
                {estado.opcoesAlerta.map((op, i) => {
                  const on = estado.alerta === op.id;
                  return (
                    <button
                      key={op.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => estado.setAlerta(/** @type {FiltroAlerta} */ (op.id))}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: ui.linhaToque,
                        padding: '6px 8px', border: 0, borderTop: `1px solid ${i === 0 ? 'transparent' : COR.divisor}`,
                        background: 'transparent', color: COR.texto, ...TIPO.texto, textAlign: 'left', cursor: 'pointer',
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 9, height: 9, flex: '0 0 auto', border: `1px solid ${COR.marcador}`,
                          borderRadius: 999, background: op.cor, boxSizing: 'border-box',
                        }}
                      />
                      <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {op.rotulo}
                      </span>
                      <span
                        style={{
                          flex: '0 0 auto', ...TIPO.selo, color: COR.meta,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {String(op.qtd)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
