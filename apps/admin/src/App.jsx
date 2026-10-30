/**
 * MAIKE Admin — aplicação privada do proprietário (D-PROD-70).
 *
 * Separada da SPA dos clientes: build, porta e sessão próprios. Toda
 * autorização é do backend; esta UI só reflete o que a sessão permite.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { aoExpirarSessao, api, definirCsrf, ehConflitoRevisao, mensagemDeErro } from './api.js';
import { Aviso, Carregando } from './componentes.jsx';
import { Entrar, InscreverMfa, SegundoFator } from './telas/Acesso.jsx';
import Icones from './telas/Icones.jsx';
import Categorias from './telas/Categorias.jsx';
import RegrasMisto from './telas/RegrasMisto.jsx';
import Validacao from './telas/Validacao.jsx';
import Conta from './telas/Conta.jsx';

const ABAS = [
  ['icones', 'Ícones'],
  ['categorias', 'Tipos e categorias'],
  ['misto', 'Regras MISTO'],
  ['validacao', 'Validação'],
  ['conta', 'Minha conta'],
];

export default function App() {
  const [etapa, setEtapa] = useState('carregando');
  const [admin, setAdmin] = useState(null);
  const [aba, setAba] = useState('icones');
  const [dados, setDados] = useState(null);
  const [erroCarga, setErroCarga] = useState('');
  const [aviso, setAviso] = useState({ tipo: 'info', texto: '' });

  const aplicarEtapa = useCallback((r) => {
    definirCsrf(r?.csrf_token);
    setAdmin(r?.admin ?? null);
    setEtapa(r?.etapa ?? 'entrar');
  }, []);

  const paraEntrar = useCallback(() => {
    definirCsrf('');
    setAdmin(null);
    setDados(null);
    setAba('icones');
    setEtapa('entrar');
  }, []);

  useEffect(() => {
    aoExpirarSessao(paraEntrar);
    api.sessao().then(aplicarEtapa, paraEntrar);
  }, [aplicarEtapa, paraEntrar]);

  const recarregar = useCallback(async () => {
    setErroCarga('');
    try {
      setDados(await api.catalogo());
    } catch (e) {
      setErroCarga(mensagemDeErro(e));
    }
  }, []);

  useEffect(() => {
    if (etapa === 'ok') recarregar();
  }, [etapa, recarregar]);

  /** Executa uma ação de escrita com aviso legível; 409 recarrega sem sobrescrever. */
  const executar = useCallback(
    async (acao, sucesso) => {
      setAviso({ tipo: 'info', texto: '' });
      try {
        const r = await acao();
        await recarregar();
        if (sucesso) setAviso({ tipo: 'sucesso', texto: sucesso });
        return r;
      } catch (e) {
        if (ehConflitoRevisao(e)) await recarregar();
        setAviso({ tipo: 'erro', texto: mensagemDeErro(e) });
        throw e;
      }
    },
    [recarregar]
  );

  const sair = async () => {
    try {
      await api.sair();
    } finally {
      paraEntrar();
    }
  };

  if (etapa === 'carregando') return <Carregando texto="Verificando sessão…" />;
  if (etapa === 'entrar') return <Entrar onEtapa={aplicarEtapa} />;
  if (etapa === 'mfa') return <SegundoFator onEtapa={aplicarEtapa} onVoltar={paraEntrar} />;
  if (etapa === 'inscrever_mfa') return <InscreverMfa onEtapa={aplicarEtapa} onVoltar={sair} />;

  const props = { dados, executar, recarregar, avisar: (tipo, texto) => setAviso({ tipo, texto }) };
  return (
    <div className="app">
      <header className="topo">
        <div>
          <p className="marca">MAIKE Admin</p>
          <p className="topo-sub">Catálogo global de ícones · dados oficiais do produto</p>
        </div>
        <div className="topo-acoes">
          <span className="topo-login" title="Administrador principal">
            {admin?.login}
          </span>
          <button type="button" className="botao botao-secundario" onClick={sair}>
            Sair
          </button>
        </div>
      </header>
      <nav className="abas" aria-label="Seções">
        {ABAS.map(([id, rotulo]) => (
          <button key={id} type="button" className={`aba ${aba === id ? 'aba-ativa' : ''}`} aria-current={aba === id ? 'page' : undefined} onClick={() => setAba(id)}>
            {rotulo}
          </button>
        ))}
      </nav>
      <main className="conteudo">
        <Aviso tipo={aviso.tipo} onFechar={() => setAviso({ tipo: 'info', texto: '' })}>
          {aviso.texto}
        </Aviso>
        {aba === 'conta' ? (
          <Conta admin={admin} onSessaoEncerrada={paraEntrar} avisar={props.avisar} />
        ) : erroCarga ? (
          <div className="vazio">
            <Aviso tipo="erro">{erroCarga}</Aviso>
            <button type="button" className="botao botao-primario" onClick={recarregar}>
              Tentar novamente
            </button>
          </div>
        ) : !dados ? (
          <Carregando texto="Carregando catálogo…" />
        ) : aba === 'icones' ? (
          <Icones {...props} />
        ) : aba === 'categorias' ? (
          <Categorias {...props} />
        ) : aba === 'misto' ? (
          <RegrasMisto {...props} />
        ) : (
          <Validacao {...props} />
        )}
      </main>
    </div>
  );
}
