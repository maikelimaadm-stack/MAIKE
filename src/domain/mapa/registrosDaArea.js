/**
 * D-PROD-254 — os registros de campo de uma área (Gradeação, Aplicação, Abastecimento…) como a linha do tempo da aba
 * Histórico dos detalhes da área. Só desenho: os números vêm do servidor (`GET /atividades-por-area/:id/registros`) e aqui só
 * se formatam em pt-BR. Nada é somado nem inventado.
 */

import { formatarDecimalLinha } from '@/lib/atividadeLinhasRegras';
import { iconeDoTipoAtividade } from '@/lib/iconesTipoAtividade';
import { periodoDoServico } from '@/lib/registroDeCampoRegras';
import { rotuloDoDia } from '@/components/mapa/detalhes-lote/historicoDoPasto';

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

const UNIDADES = Object.freeze(/** @type {Record<string, string>} */ ({ H: 'h', HORA: 'h', HORAS: 'h', HR: 'h', KM: 'km', L: 'L', KG: 'kg', CICLOS: 'ciclos' }));
/** "H" → "h", "L" → "L"; o que não conhece segue como veio. @param {unknown} u */
const unidadeCurta = (u) => UNIDADES[texto(u).toUpperCase()] ?? texto(u);

/** "6,5 h" / "7 ha"; vazio sem valor. @param {unknown} valor @param {unknown} unidade */
const comUnidade = (valor, unidade) => {
  const n = formatarDecimalLinha(valor);
  if (!n) return '';
  const u = unidadeCurta(unidade);
  return u ? `${n} ${u}` : n;
};

/** @param {Array<string>} partes */
const juntar = (partes) => partes.filter(Boolean).join(', ');

/**
 * As linhas rótulo/valor de UM registro (só as que têm valor).
 * @param {Record<string, any>} r
 * @returns {Array<{ rotulo: string, valor: string }>}
 */
export const linhasDoRegistro = (r) => {
  /** @type {Array<{ rotulo: string, valor: string }>} */
  const linhas = [];
  /** @param {string} rotulo @param {string} valor */
  const poe = (rotulo, valor) => {
    if (valor) linhas.push({ rotulo, valor });
  };
  const maquinas = Array.isArray(r.maquinas) ? r.maquinas : [];
  const produtos = Array.isArray(r.produtos) ? r.produtos : [];
  const maoObra = Array.isArray(r.mao_obra) ? r.mao_obra : [];
  const servicos = Array.isArray(r.servicos) ? r.servicos : [];
  // D-PROD-265: o serviço de vários dias mostra o período ("10/11 a 12/11").
  poe('Período', periodoDoServico(r.data_operacional, r.data_termino));
  poe('Máquina', juntar(maquinas.map((m) => texto(m.bem_nome))));
  poe('Implemento', juntar(maquinas.map((m) => texto(m.implemento_nome))));
  poe('Horas', juntar(maquinas.map((m) => comUnidade(m.quantidade_uso, m.unidade))));
  poe('Produto', juntar(produtos.map((p) => [texto(p.produto_nome), comUnidade(p.quantidade, p.unidade)].filter(Boolean).join(' · '))));
  poe('Dose', juntar(produtos.map((p) => (p.dose_ha ? comUnidade(p.dose_ha, `${unidadeCurta(p.unidade)}/ha`) : ''))));
  poe('Feito', comUnidade(r.area_executada_dia, 'ha'));
  poe('Operador', texto(r.operador_nome));
  poe('Mão de obra', juntar(maoObra.map((m) => texto(m.nome))));
  poe('Serviço', juntar(servicos.map((s) => texto(s.nome))));
  poe('Observação', texto(r.observacao));
  return linhas;
};

/**
 * Os registros (já do mais novo ao mais antigo) viram os dias da linha do tempo: um cartão por registro.
 * @param {Array<Record<string, any>>} itens
 * @returns {Array<{ chave: string, rotulo: string, cartoes: Array<{ chave: string, Icone: any, titulo: string, linhas: Array<{ rotulo: string, valor: string }> }> }>}
 */
export const diasDosRegistros = (itens) => {
  /** @type {Array<{ chave: string, rotulo: string, cartoes: any[] }>} */
  const dias = [];
  for (const r of Array.isArray(itens) ? itens : []) {
    const chave = texto(r.data_operacional);
    let dia = dias[dias.length - 1];
    if (!dia || dia.chave !== chave) {
      dia = { chave, rotulo: rotuloDoDia(chave), cartoes: [] };
      dias.push(dia);
    }
    dia.cartoes.push({ chave: String(r.id), Icone: iconeDoTipoAtividade({ nome_tipo: r.tipo_atividade_nome }), titulo: texto(r.tipo_atividade_nome) || 'Registro', linhas: linhasDoRegistro(r) });
  }
  return dias;
};
