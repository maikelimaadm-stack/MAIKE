# App Android e iOS (Capacitor)

O MAIKE roda como app nativo pelo Capacitor 8: o mesmo frontend (`dist/`) vai empacotado dentro do app, então ele **abre sem internet**. Os dados continuam vindo da API de produção.

## Configuração

- `capacitor.config.json`: `appId` `com.makgestao.app`, nome "MAK Gestão", `webDir` `dist`.
- Projetos nativos: `android/` e `ios/` (gerados por `npx cap add`). O que é gerado em build (`android/app/src/main/assets/public`, `android/**/build`, `ios/App/App/public`, `ios/App/Pods`) fica fora do Git.
- Origens do app no backend: `https://localhost` (Android) e `capacitor://localhost` (iOS) precisam estar em `FRONTEND_ORIGINS` na Vercel. Sem isso, o CORS responde 404 e o app não loga.

## Gerar o APK de teste (Android)

Pré-requisitos: Node 22+, JDK 21 e Android SDK (plataforma 36, build-tools 36) com `ANDROID_HOME` apontando para ele.

Variáveis de build (não versionar; R4):

- `VITE_MAIKE_API_URL=https://www.makgestao.com/api/native`: no app o endereço precisa ser completo, porque o relativo `/api/native` do site não existe dentro do APK;
- `VITE_GOOGLE_MAPS_API_KEY`: a mesma chave do site (satélite).

```bash
npm run app:apk
```

O APK sai em `android/app/build/outputs/apk/debug/app-debug.apk`. É de teste (assinado com a chave de debug): instala por arquivo no Android, não serve para a Play Store.

## iOS

`npm run app:build` atualiza `ios/`. O build do iOS (IPA) só roda num Mac com Xcode: abrir `ios/App/App.xcworkspace`, escolher a equipe de assinatura e rodar no aparelho ou exportar.

## Sem internet

- Abre: telas, código e ícones estão dentro do app.
- Mostra: os dados do mapa já guardados no aparelho (`mapaCacheService`, IndexedDB).
- Precisa de internet: o primeiro login, satélite de áreas nunca abertas e gravar no servidor.
