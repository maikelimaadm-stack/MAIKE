import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import '@/lib/installToastsDoSistema'
import '@/lib/installDeleteDialogInterceptor'
import { iniciarAtualizacaoAutomatica } from '@/lib/app/atualizacaoAutomatica'

ReactDOM.createRoot(document.getElementById('root')).render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>,
)

// D-PROD-290: app Android/iOS — avisa que este pacote abriu e confere versão nova.
iniciarAtualizacaoAutomatica()

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:beforeUpdate' }, '*');
  });
  import.meta.hot.on('vite:afterUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:afterUpdate' }, '*');
  });
}