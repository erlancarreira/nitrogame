"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { TEXTS, type Language } from "@/lib/game/i18n";

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string;
  lang: Language;
}

/**
 * Error Boundary that catches crashes in the 3D Canvas / Physics pipeline.
 *
 * Three.js and Rapier can crash from:
 * - NaN/Infinity in physics (WASM panic)
 * - WebGL context lost
 * - Shader compilation failures
 * - Out of memory on low-end devices
 *
 * Without this, the entire page goes white with no feedback.
 * With this, players see a friendly recovery screen.
 */
export class GameErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { userLanguage?: string }) : undefined;
    const userLang = nav?.language || nav?.userLanguage;
    const lang = userLang && userLang.toLowerCase().includes("pt") ? "pt" : "en";

    this.state = { hasError: false, error: null, errorInfo: "", lang };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log for debugging — in production you'd send this to Sentry/LogRocket
    console.error("[GameErrorBoundary] Crash caught:", error);
    console.error("[GameErrorBoundary] Component stack:", errorInfo.componentStack);

    this.setState({
      errorInfo: errorInfo.componentStack?.slice(0, 500) || "",
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: "" });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      const t = TEXTS[this.state.lang];
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-50">
          <div className="text-center max-w-md p-8">
            <div className="text-6xl mb-4">💥</div>
            <h2 className="text-2xl font-bold text-white mb-2">
              {t.errorTitle}
            </h2>
            <p className="text-gray-400 mb-6 text-sm">
              {this.state.error?.message?.includes("unreachable")
                ? t.errorPhys
                : this.state.error?.message?.includes("context")
                  ? t.errorContext
                  : t.errorGeneric}
            </p>

            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                {t.errorRetry}
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
              >
                {t.errorReload}
              </button>
            </div>

            {/* Debug info (collapsed by default) */}
            {process.env.NODE_ENV !== "production" && this.state.error && (
              <details className="mt-6 text-left">
                <summary className="text-gray-500 cursor-pointer text-xs hover:text-gray-300">
                  Detalhes do erro (dev only)
                </summary>
                <pre className="mt-2 text-xs text-red-400 bg-gray-900 p-3 rounded overflow-auto max-h-40">
                  {this.state.error.message}
                  {"\n"}
                  {this.state.errorInfo}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
