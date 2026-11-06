import React, { useState } from "react";
import { toast } from "sonner";
import { Input as InputBase } from "@/components/ui/input";
import B1Select from "@/components/cadastro/base1/B1Select";
import { LancLoteForm, LancLoteRodape, LancLoteAviso, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import LancField from "@/components/cadastro/base1/LancField";
import { CORES_DISPONIVEIS } from "@/domain/areas/regrasCadastroArea";
import { mensagemErroInformacaoPosicao, salvarInformacaoPosicao, valoresDaPosicao } from "@/services/informacaoPosicaoService";

const FL = LancField;
/** O Input do shadcn não declara as props nativas no JSDoc. */
const Input = /** @type {any} */ (InputBase);

const texto = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
const dataBr = (iso) => {
  if (!iso || typeof iso !== "string") return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : "—";
};

/**
 * Editar Informação de UMA posição do rebanho (controle por posições) — D-PROD-139.
 *
 * Duas partes visualmente separadas:
 *  - "Informações do grupo (editáveis)": nome e identificação da posição, que é o
 *    que o mapa mostra sobre este grupo nesta área.
 *  - "Origem e cadastro da entrada (somente leitura)": de onde o grupo veio e o
 *    estado que só muda por manejo (Mover, Pesar, Mudar Categoria) ou no Cadastro
 *    de Lotes.
 * Não escreve no Cadastro de Lotes, não cria movimentação e não mexe em saldo.
 *
 * @param {{ posicao: any, empresaSelecionadaId: string, onSalvo: (posicao: any) => void, onCancel: () => void, enviar?: (id: string, corpo: object) => Promise<any> }} props
 */
export default function EditarInformacaoPosicaoForm({ posicao, empresaSelecionadaId, onSalvo, onCancel, enviar }) {
  const [valores, setValores] = useState(() => valoresDaPosicao(posicao));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const mudar = (campo) => (e) => {
    setErro(null);
    setValores((v) => ({ ...v, [campo]: e.target.value }));
  };
  const corAtualForaDaLista = valores.identificador_cor && !CORES_DISPONIVEIS.some((c) => c.cor === valores.identificador_cor);

  const handleSalvar = async () => {
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await salvarInformacaoPosicao({ posicao, valores, empresaId: empresaSelecionadaId, ...(enviar ? { enviar } : {}) });
      if (!r.alterados?.length) toast.info("Nada mudou. Nada foi gravado.");
      else toast.success("Informações do grupo salvas.");
      onSalvo(r.posicao ?? posicao);
    } catch (e) {
      const mensagem = e?.mensagemTela || mensagemErroInformacaoPosicao(e);
      setErro(mensagem);
      toast.error(mensagem);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <LancLoteForm onSubmit={(e) => { e.preventDefault(); handleSalvar(); }}>
      <p className="mk-ll__texto" data-testid="info-posicao-alvo">
        Grupo: <strong>{posicao.nome}</strong> · Área: <strong>{texto(posicao.area_atual_nome)}</strong> · {posicao.quantidade_cabecas ?? 0} cab · {texto(posicao.categoria)}
      </p>

      <fieldset className="mk-ll__grade" aria-label="Informações do grupo (editáveis)">
        <legend className="mk-ll__texto"><strong>Informações do grupo (editáveis)</strong></legend>
        <FL label="Nome do grupo" required>
          <Input value={valores.nome} onChange={mudar("nome")} className={LL_CTL} aria-label="Nome do grupo" />
        </FL>
        <FL label="Identificador (nome)">
          <Input value={valores.identificador_nome} onChange={mudar("identificador_nome")} className={LL_CTL} aria-label="Identificador (nome)" />
        </FL>
        <FL label="Identificador (sigla)">
          <Input value={valores.identificador_sigla} onChange={mudar("identificador_sigla")} className={LL_CTL} aria-label="Identificador (sigla)" />
        </FL>
        <FL label="Identificador (cor)">
          <B1Select value={valores.identificador_cor} onChange={mudar("identificador_cor")} className={LL_CTL} aria-label="Identificador (cor)">
            <option value="">Sem cor</option>
            {corAtualForaDaLista && <option value={valores.identificador_cor}>{valores.identificador_cor}</option>}
            {CORES_DISPONIVEIS.map((c) => <option key={c.cor} value={c.cor}>{c.nome}</option>)}
          </B1Select>
        </FL>
      </fieldset>

      <fieldset className="mk-ll__grade" aria-label="Origem e cadastro da entrada (somente leitura)" data-testid="info-posicao-somente-leitura">
        <legend className="mk-ll__texto"><strong>Origem e cadastro da entrada (somente leitura)</strong></legend>
        <dl className="mk-ll__texto grid grid-cols-2 gap-x-3 gap-y-1">
          <dt>Nº do lote</dt><dd>{texto(posicao.numero_lote)}</dd>
          <dt>Categoria</dt><dd>{texto(posicao.categoria)}</dd>
          <dt>Sexo</dt><dd>{texto(posicao.sexo)}</dd>
          <dt>Categoria de manejo</dt><dd>{texto(posicao.categoria_manejo_nome)}</dd>
          <dt>Cabeças</dt><dd>{texto(posicao.quantidade_cabecas)}</dd>
          <dt>Peso médio (kg)</dt><dd>{texto(posicao.peso_medio_kg)}</dd>
          <dt>Raça predominante</dt><dd>{texto(posicao.raca_predominante)}</dd>
          <dt>Sistema produtivo</dt><dd>{texto(posicao.sistema_produtivo)}</dd>
          <dt>Data de entrada</dt><dd>{dataBr(posicao.data_entrada)}</dd>
        </dl>
      </fieldset>

      <LancLoteAviso tom="ambar">
        <p className="text-[11px]">Muda só este grupo nesta área. Não altera o Cadastro de Lotes, o saldo nem o histórico. Quantidade, área, peso e categoria mudam por Mover, Pesar ou Mudar Categoria. Se o nome for trocado depois no Cadastro de Lotes, ele volta a valer para os grupos desta entrada.</p>
      </LancLoteAviso>

      {erro && <p role="alert" className="mk-ll__texto text-red-700">{erro}</p>}

      <LancLoteRodape onCancelar={onCancel} cancelarDesabilitado={enviando} textoAcao="Salvar" textoEnviando="Salvando..." enviando={enviando} />
    </LancLoteForm>
  );
}
