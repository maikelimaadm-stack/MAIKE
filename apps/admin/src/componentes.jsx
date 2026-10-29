/** Peças de interface do MAIKE Admin (sem dependência da SPA dos clientes). */
import React from 'react';

export const Aviso = ({ tipo = 'info', children, onFechar }) =>
  children ? (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      <span>{children}</span>
      {onFechar ? (
        <button type="button" className="aviso-fechar" aria-label="Fechar aviso" onClick={onFechar}>
          ×
        </button>
      ) : null}
    </div>
  ) : null;

export const Campo = ({ rotulo, dica, children, id }) => (
  <label className="campo" htmlFor={id}>
    <span className="campo-rotulo">{rotulo}</span>
    {children}
    {dica ? <span className="campo-dica">{dica}</span> : null}
  </label>
);

export const Botao = ({ variante = 'primario', ocupado = false, children, ...resto }) => (
  // `disabled` DEPOIS do spread: um `disabled` vindo de fora não pode reabilitar o botão ocupado.
  <button type="button" className={`botao botao-${variante}`} {...resto} disabled={ocupado || resto.disabled}>
    {ocupado ? 'Aguarde…' : children}
  </button>
);

const ROTULO_ESTADO = { rascunho: 'Rascunho', publicado: 'Publicado', inativo: 'Inativo' };
export const Estado = ({ estado }) => <span className={`estado estado-${estado}`}>{ROTULO_ESTADO[estado] ?? estado}</span>;

export const Miniatura = ({ url, rotulo, cor }) => (
  <span className="miniatura" style={!url && cor ? { background: cor } : undefined}>
    {url ? <img src={url} alt={rotulo} /> : <span className="miniatura-vazia">{cor ? '' : 'sem imagem'}</span>}
  </span>
);

/** Id curto e copiável (para runbook/suporte); nunca caminho de Storage. */
export const IdCurto = ({ id }) => (
  <code className="id-curto" title={id}>
    {id.slice(0, 8)}…
  </code>
);

export const Carregando = ({ texto = 'Carregando…' }) => (
  <div className="carregando" role="status">
    <span className="girador" aria-hidden="true" />
    {texto}
  </div>
);
