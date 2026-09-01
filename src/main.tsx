import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initI18n, loadNamespace } from './i18n'

// Namespaces needed for the always-visible chrome (nav/footer, wallet
// panel, first-run onboarding, search page, and its error copy) are loaded
// once at boot alongside `common` — small enough that deferring them would
// only add flash-of-untranslated-content risk for no real bundle-size win.
// `docs` is deliberately excluded here: it's only ever needed if the user
// opens the docs page, so DocsPage lazy-loads it itself (#345).
async function bootstrap() {
  await initI18n()
  await Promise.all(
    (['wallet', 'onboarding', 'errors', 'search'] as const).map(loadNamespace),
  )

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

bootstrap()
