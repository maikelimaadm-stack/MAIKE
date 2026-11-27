import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import '@/lib/installToastsDoSistema'
import '@/lib/installDeleteDialogInterceptor'
import { iniciarAtualizacaoAutomatica } from '@/lib/app/atualizacaoAutomatica'
import { pedirArmazenamentoPersistente } from '@/lib/offline/armazenamentoPersistente'

ReactDOM.createRoot(document.getElementById('root')).render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>,
)

// D-PROD-294: app Android/iOS — avisa que este pacote abriu e confere versão nova.
iniciarAtualizacaoAutomatica()

// D-PROD-343: o que foi feito sem internet não é apagado pelo sistema quando o celular fica sem espaço.
void pedirArmazenamentoPersistente()

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:beforeUpdate' }, '*');
  });
  import.meta.hot.on('vite:afterUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:afterUpdate' }, '*');
  });
}