import React, { Component, ErrorInfo, ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { I18nProvider } from '@lingui/react';
import App from './App.tsx';
import './index.css';
import { initI18n } from './i18n';
import { SafeguardPage } from './components/SafeguardPage';

// Ensure browser compatibility polyfills for libraries expecting Node/global conventions
if (typeof window !== 'undefined') {
  (window as unknown as { global: unknown }).global = window;
  (window as unknown as { process: unknown }).process =
    (window as unknown as { process: unknown }).process || { env: {} };

  // Clean up any stale service workers from previous apps on this origin (e.g. localhost)
  if ('serviceWorker' in navigator && import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    });
  }
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class RootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled application error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = window.location.origin + window.location.pathname;
  };

  handleResetState = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // ignore storage access errors
    }
    window.location.href = window.location.origin + window.location.pathname;
  };

  render() {
    if (this.state.hasError) {
      return (
        <SafeguardPage
          type="500"
          statusCode={500}
          title="Error de inicialización de la aplicación"
          message="Se ha interceptado una excepción en tiempo de ejecución para evitar un fallo crítico. Puedes recargar o descargar un respaldo de tus datos."
          technicalDetails={this.state.error?.stack || this.state.error?.message || 'Error desconocido'}
          onRetry={this.handleReload}
          onGoHome={this.handleGoHome}
          onResetStorage={this.handleResetState}
        />
      );
    }

    return this.props.children;
  }
}

async function renderApp() {
  await initI18n();
  const rootElement = document.getElementById('root');
  if (rootElement) {
    createRoot(rootElement).render(
      <StrictMode>
        <RootErrorBoundary>
          <I18nProvider i18n={i18n}>
            <App />
          </I18nProvider>
        </RootErrorBoundary>
      </StrictMode>,
    );
  }
}

renderApp();
