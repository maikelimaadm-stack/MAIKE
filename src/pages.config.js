import Dashboard from './pages/Dashboard';
import Relatorios from './pages/Relatorios';
import Usuarios from './pages/Usuarios';
import Fornecedores from './pages/Fornecedores';
import Produtos from './pages/Produtos';
import RelatorioPesagens from './pages/RelatorioPesagens';
import RelatorioFornecedores from './pages/RelatorioFornecedores';
import RelatorioProdutos from './pages/RelatorioProdutos';
import Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "Relatorios": Relatorios,
    "Usuarios": Usuarios,
    "Fornecedores": Fornecedores,
    "Produtos": Produtos,
    "RelatorioPesagens": RelatorioPesagens,
    "RelatorioFornecedores": RelatorioFornecedores,
    "RelatorioProdutos": RelatorioProdutos,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: Layout,
};