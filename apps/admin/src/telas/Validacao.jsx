/**
 * Validação e prévia completa do catálogo — só leitura (não altera nada e
 * não toca no mapa). Mostra o que impede publicar com segurança e como os
 * clientes verão os ícones publicados.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api, mensagemDeErro } from '../api.js';
import { Aviso, Botao, Carregando, Miniatura } from '../componentes.jsx';

export default function Validacao({ dados }) {
  const [r, setR] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const validar = useCallback(async () => {
    setOcupado(true);
    setErro('');
    try {
      setR(await api.validacao());
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }, []);
  useEffect(() => {
    validar();
  }, [validar, dados]);
  const nomeCat = new Map(dados.categorias.map((c) => [c.id, c.nome]));
  const publicados = dados.icones.filter((i) => i.estado === 'publicado' && i.ativo);
  return (
    <section aria-labelledby="titulo-validacao">
      <div className="cabecalho-secao">
        <h2 id="titulo-validacao">Validação do catálogo</h2>
        <Botao variante="secundario" ocupado={ocupado} onClick={validar}>
          Validar agora
        </Botao>
      </div>
      <Aviso tipo="erro">{erro}</Aviso>
      {!r ? (
        <Carregando />
      ) : (
        <div className="painel" data-testid="resultado-validacao" data-ok={String(r.ok)}>
          <Aviso tipo={r.ok ? 'sucesso' : 'erro'}>
            {r.ok ? 'Nenhum erro: o catálogo publicado está consistente.' : `${r.erros.length} erro(s) precisam de correção.`}
          </Aviso>
          {[...r.erros.map((p) => ['erro', p]), ...r.avisos.map((p) => ['aviso', p])].map(([nivel, p], i) => (
            <p key={i} className={`problema problema-${nivel}`}>
              <strong>{nivel === 'erro' ? 'Erro' : 'Atenção'}:</strong> {p.mensagem}
            </p>
          ))}
        </div>
      )}
      <div className="painel">
        <h3>Como os clientes verão (publicados)</h3>
        {publicados.length === 0 ? (
          <p className="vazio">Nada publicado ainda.</p>
        ) : (
          <div className="previa-publicados">
            {publicados.map((i) => (
              <figure key={i.id}>
                <Miniatura url={i.asset_principal?.public_url} rotulo={`Publicado: ${nomeCat.get(i.categoria_id)}`} cor={i.cor_fallback} />
                <figcaption>{nomeCat.get(i.categoria_id)}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
