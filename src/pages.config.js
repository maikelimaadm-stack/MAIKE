/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AplicacoesMedicamentos from './pages/AplicacoesMedicamentos';
import AreasPastagem from './pages/AreasPastagem';
import AtivosFixos from './pages/AtivosFixos';
import Backup from './pages/Backup';
import CadastroLotes from './pages/CadastroLotes';
import CadastroMaquinas from './pages/CadastroMaquinas';
import CadastroSetores from './pages/CadastroSetores';
import CaixaBancos from './pages/CaixaBancos';
import Categorias from './pages/Categorias';
import CategoriasManejo from './pages/CategoriasManejo';
import CentrosCusto from './pages/CentrosCusto';
import ConfiguracaoFatoresConsumo from './pages/ConfiguracaoFatoresConsumo';
import ConfiguracoesGerais from './pages/ConfiguracoesGerais';
import ControleAreas from './pages/ControleAreas';
import ControlePecuaria from './pages/ControlePecuaria';
import CotacoesPecuaria from './pages/CotacoesPecuaria';
import CustosSafra from './pages/CustosSafra';
import Dashboard from './pages/Dashboard';
import DashboardSuplementacao from './pages/DashboardSuplementacao';
import EditorVisualSistema from './pages/EditorVisualSistema';
import Empresa from './pages/Empresa';
import FichaControleCombustivel from './pages/FichaControleCombustivel';
import FichaOperador from './pages/FichaOperador';
import FichaOperadorImpressao from './pages/FichaOperadorImpressao';
import FichasPersonalizadas from './pages/FichasPersonalizadas';
import FluxoCaixa from './pages/FluxoCaixa';
import FormasPagamento from './pages/FormasPagamento';
import Fornecedores from './pages/Fornecedores';
import GerenciarCidades from './pages/GerenciarCidades';
import GerenciarSafras from './pages/GerenciarSafras';
import GrupoAtividadeForm from './pages/GrupoAtividadeForm';
import GruposAtividades from './pages/GruposAtividades';
import GruposFinanceiros from './pages/GruposFinanceiros';
import HistoricoMovimentacoesPecuaria from './pages/HistoricoMovimentacoesPecuaria';
import Home from './pages/Home';
import LancamentoFinanceiro from './pages/LancamentoFinanceiro';
import LancamentoPesagensIndividuais from './pages/LancamentoPesagensIndividuais';
import LancamentoPesagensMobile from './pages/LancamentoPesagensMobile';
import LancamentoProdutosEstoque from './pages/LancamentoProdutosEstoque';
import LancamentoTarefaForm from './pages/LancamentoTarefaForm';
import LancamentosTarefas from './pages/LancamentosTarefas';
import LivroCaixa from './pages/LivroCaixa';
import LivrosFiscais from './pages/LivrosFiscais';
import LocaisEstoque from './pages/LocaisEstoque';
import LotesAnimaisCotacao from './pages/LotesAnimaisCotacao';
import MapaCadastro from './pages/MapaCadastro';
import MapaGeral from './pages/MapaGeral';
import MovimentacoesEstoque from './pages/MovimentacoesEstoque';
import OperacoesAgricolas from './pages/OperacoesAgricolas';
import Pesagens from './pages/Pesagens';
import PesagensIndividuais from './pages/PesagensIndividuais';
import PlanoContas from './pages/PlanoContas';
import PopularCidades from './pages/PopularCidades';
import Produtos from './pages/Produtos';
import RelatorioConsumoPeriodo from './pages/RelatorioConsumoPeriodo';
import RelatorioCustosSafra from './pages/RelatorioCustosSafra';
import RelatorioEntradasFornecedor from './pages/RelatorioEntradasFornecedor';
import RelatorioEstoque from './pages/RelatorioEstoque';
import RelatorioExtratoMovimentacoes from './pages/RelatorioExtratoMovimentacoes';
import RelatorioFinanceiro from './pages/RelatorioFinanceiro';
import RelatorioFornecedores from './pages/RelatorioFornecedores';
import RelatorioHistoricoEntregas from './pages/RelatorioHistoricoEntregas';
import RelatorioKardex from './pages/RelatorioKardex';
import RelatorioMapaPastos from './pages/RelatorioMapaPastos';
import RelatorioMovimentacoesPecuaria from './pages/RelatorioMovimentacoesPecuaria';
import RelatorioPerdasAnalitico from './pages/RelatorioPerdasAnalitico';
import RelatorioPesagens from './pages/RelatorioPesagens';
import RelatorioPesagensIndividuais from './pages/RelatorioPesagensIndividuais';
import RelatorioProdutos from './pages/RelatorioProdutos';
import RelatorioSaldoAtual from './pages/RelatorioSaldoAtual';
import RelatorioSuplementacao from './pages/RelatorioSuplementacao';
import Relatorios from './pages/Relatorios';
import RelatoriosEstoque from './pages/RelatoriosEstoque';
import RemoverDuplicados from './pages/RemoverDuplicados';
import SimulacaoResultados from './pages/SimulacaoResultados';
import TipoTarefaForm from './pages/TipoTarefaForm';
import TiposTarefa from './pages/TiposTarefa';
import UnidadesMedida from './pages/UnidadesMedida';
import Usuarios from './pages/Usuarios';
import VisualizarFicha from './pages/VisualizarFicha';
import RelatorioGestaoTarefas from './pages/RelatorioGestaoTarefas';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AplicacoesMedicamentos": AplicacoesMedicamentos,
    "AreasPastagem": AreasPastagem,
    "AtivosFixos": AtivosFixos,
    "Backup": Backup,
    "CadastroLotes": CadastroLotes,
    "CadastroMaquinas": CadastroMaquinas,
    "CadastroSetores": CadastroSetores,
    "CaixaBancos": CaixaBancos,
    "Categorias": Categorias,
    "CategoriasManejo": CategoriasManejo,
    "CentrosCusto": CentrosCusto,
    "ConfiguracaoFatoresConsumo": ConfiguracaoFatoresConsumo,
    "ConfiguracoesGerais": ConfiguracoesGerais,
    "ControleAreas": ControleAreas,
    "ControlePecuaria": ControlePecuaria,
    "CotacoesPecuaria": CotacoesPecuaria,
    "CustosSafra": CustosSafra,
    "Dashboard": Dashboard,
    "DashboardSuplementacao": DashboardSuplementacao,
    "EditorVisualSistema": EditorVisualSistema,
    "Empresa": Empresa,
    "FichaControleCombustivel": FichaControleCombustivel,
    "FichaOperador": FichaOperador,
    "FichaOperadorImpressao": FichaOperadorImpressao,
    "FichasPersonalizadas": FichasPersonalizadas,
    "FluxoCaixa": FluxoCaixa,
    "FormasPagamento": FormasPagamento,
    "Fornecedores": Fornecedores,
    "GerenciarCidades": GerenciarCidades,
    "GerenciarSafras": GerenciarSafras,
    "GrupoAtividadeForm": GrupoAtividadeForm,
    "GruposAtividades": GruposAtividades,
    "GruposFinanceiros": GruposFinanceiros,
    "HistoricoMovimentacoesPecuaria": HistoricoMovimentacoesPecuaria,
    "Home": Home,
    "LancamentoFinanceiro": LancamentoFinanceiro,
    "LancamentoPesagensIndividuais": LancamentoPesagensIndividuais,
    "LancamentoPesagensMobile": LancamentoPesagensMobile,
    "LancamentoProdutosEstoque": LancamentoProdutosEstoque,
    "LancamentoTarefaForm": LancamentoTarefaForm,
    "LancamentosTarefas": LancamentosTarefas,
    "LivroCaixa": LivroCaixa,
    "LivrosFiscais": LivrosFiscais,
    "LocaisEstoque": LocaisEstoque,
    "LotesAnimaisCotacao": LotesAnimaisCotacao,
    "MapaCadastro": MapaCadastro,
    "MapaGeral": MapaGeral,
    "MovimentacoesEstoque": MovimentacoesEstoque,
    "OperacoesAgricolas": OperacoesAgricolas,
    "Pesagens": Pesagens,
    "PesagensIndividuais": PesagensIndividuais,
    "PlanoContas": PlanoContas,
    "PopularCidades": PopularCidades,
    "Produtos": Produtos,
    "RelatorioConsumoPeriodo": RelatorioConsumoPeriodo,
    "RelatorioCustosSafra": RelatorioCustosSafra,
    "RelatorioEntradasFornecedor": RelatorioEntradasFornecedor,
    "RelatorioEstoque": RelatorioEstoque,
    "RelatorioExtratoMovimentacoes": RelatorioExtratoMovimentacoes,
    "RelatorioFinanceiro": RelatorioFinanceiro,
    "RelatorioFornecedores": RelatorioFornecedores,
    "RelatorioHistoricoEntregas": RelatorioHistoricoEntregas,
    "RelatorioKardex": RelatorioKardex,
    "RelatorioMapaPastos": RelatorioMapaPastos,
    "RelatorioMovimentacoesPecuaria": RelatorioMovimentacoesPecuaria,
    "RelatorioPerdasAnalitico": RelatorioPerdasAnalitico,
    "RelatorioPesagens": RelatorioPesagens,
    "RelatorioPesagensIndividuais": RelatorioPesagensIndividuais,
    "RelatorioProdutos": RelatorioProdutos,
    "RelatorioSaldoAtual": RelatorioSaldoAtual,
    "RelatorioSuplementacao": RelatorioSuplementacao,
    "Relatorios": Relatorios,
    "RelatoriosEstoque": RelatoriosEstoque,
    "RemoverDuplicados": RemoverDuplicados,
    "SimulacaoResultados": SimulacaoResultados,
    "TipoTarefaForm": TipoTarefaForm,
    "TiposTarefa": TiposTarefa,
    "UnidadesMedida": UnidadesMedida,
    "Usuarios": Usuarios,
    "VisualizarFicha": VisualizarFicha,
    "RelatorioGestaoTarefas": RelatorioGestaoTarefas,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};