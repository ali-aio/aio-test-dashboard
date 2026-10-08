import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import '../app.css'

// Two boundaries: this one is the backstop for the shell, and App puts another around the
// view area so one broken chart cannot take the navigation down with it.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary title="The dashboard could not start">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
