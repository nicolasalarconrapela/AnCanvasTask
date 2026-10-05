import React, { useState } from 'react';
import {
  RotateCcw,
  Home,
  Download,
  Trash2,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Compass,
  ZapOff,
} from 'lucide-react';

export type ErrorType = '404' | '403' | '500' | '503' | 'network' | 'generic';

export interface SafeguardPageProps {
  type?: ErrorType;
  statusCode?: number | string;
  title?: string;
  message?: string;
  technicalDetails?: string;
  onRetry?: () => void;
  onGoHome?: () => void;
  onResetStorage?: () => void;
}

export const SafeguardPage: React.FC<SafeguardPageProps> = ({
  type = '404',
  statusCode,
  title,
  message,
  technicalDetails,
  onRetry,
  onGoHome,
  onResetStorage,
}) => {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);
  const [isExportingBackup, setIsExportingBackup] = useState<boolean>(false);

  const rawCode = String(statusCode || type);
  const is404 = rawCode === '404' || type === '404';
  const is403 = rawCode === '403' || type === '403';
  const is503 = rawCode === '503' || type === '503' || type === 'network';
  const is500 = !is404 && !is403 && !is503;

  // Metadata according to error type
  const getErrorMeta = () => {
    if (is404) {
      return {
        code: '404',
        badge: 'Error 404 · No encontrado',
        title: title || 'Página o documento no encontrado',
        desc:
          message ||
          'El workspace, tarea o ruta a la que intentas acceder no existe o ha sido movida.',
        themeColor: 'amber',
        accentBorder: 'border-amber-500/40',
        badgeBg: 'bg-amber-950/60 border-amber-700/60 text-amber-300',
        glowColor: 'rgba(245, 158, 11, 0.15)',
      };
    }

    if (is403) {
      return {
        code: '403',
        badge: 'Error 403 · Acceso restringido',
        title: title || 'Permiso denegado / Requiere autorización',
        desc:
          message ||
          'No tienes permisos para acceder a esta base de datos o espacio. Comprueba tu Token de Sanity.',
        themeColor: 'rose',
        accentBorder: 'border-rose-500/40',
        badgeBg: 'bg-rose-950/60 border-rose-700/60 text-rose-300',
        glowColor: 'rgba(244, 63, 94, 0.15)',
      };
    }

    if (is503) {
      return {
        code: '503',
        badge: 'Error 503 · Servicio no disponible',
        title: title || 'Conexión interrumpida con el servidor',
        desc:
          message ||
          'No se pudo comunicar con los servicios externos o la red de Sanity. Puedes trabajar en modo local.',
        themeColor: 'sky',
        accentBorder: 'border-sky-500/40',
        badgeBg: 'bg-sky-950/60 border-sky-700/60 text-sky-300',
        glowColor: 'rgba(56, 189, 248, 0.15)',
      };
    }

    return {
      code: '500',
      badge: 'Error 500 · Fallo interno',
      title: title || 'Error inesperado de ejecución',
      desc:
        message ||
        'Se ha interceptado una excepción en tiempo de ejecución para proteger tus datos.',
      themeColor: 'emerald',
      accentBorder: 'border-emerald-500/40',
      badgeBg: 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300',
      glowColor: 'rgba(16, 185, 129, 0.15)',
    };
  };

  const meta = getErrorMeta();

  // Export emergency backup
  const handleExportEmergencyBackup = () => {
    setIsExportingBackup(true);
    try {
      const dump: Record<string, string | null> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          dump[key] = localStorage.getItem(key);
        }
      }

      const blob = new Blob([JSON.stringify(dump, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `antask_emergency_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export emergency backup:', err);
    } finally {
      setIsExportingBackup(false);
    }
  };

  const handleDefaultGoHome = () => {
    if (onGoHome) {
      onGoHome();
    } else {
      window.location.href = '/';
    }
  };

  const handleDefaultRetry = () => {
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  };

  const handleDefaultReset = () => {
    if (
      window.confirm(
        '¿Deseas restablecer el almacenamiento local de la aplicación?',
      )
    ) {
      if (onResetStorage) {
        onResetStorage();
      } else {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch (e) {
          console.error(e);
        }
        window.location.href = '/';
      }
    }
  };

  return (
    <div
      id="safeguard-error-page"
      className="min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 bg-[#09090b] text-[#f4f4f5] font-sans antialiased select-none"
    >
      <style>{`
        @keyframes floatSlow {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
        @keyframes floatReverse {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(8px) rotate(-2deg); }
        }
        @keyframes pulseRing {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.08); opacity: 0.3; }
          100% { transform: scale(0.95); opacity: 0.8; }
        }
        @keyframes radarSweep {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes lockShake {
          0%, 100% { transform: rotate(0deg); }
          20% { transform: rotate(-8deg); }
          40% { transform: rotate(8deg); }
          60% { transform: rotate(-4deg); }
          80% { transform: rotate(4deg); }
        }
        @keyframes neonFlicker {
          0%, 100% { opacity: 1; filter: drop-shadow(0 0 15px rgba(244,63,94,0.6)); }
          50% { opacity: 0.85; filter: drop-shadow(0 0 8px rgba(244,63,94,0.3)); }
        }
        .anim-float { animation: floatSlow 4s ease-in-out infinite; }
        .anim-float-rev { animation: floatReverse 3.5s ease-in-out infinite; }
        .anim-pulse-ring { animation: pulseRing 3s ease-in-out infinite; }
        .anim-radar { animation: radarSweep 6s linear infinite; }
        .anim-lock { animation: lockShake 3s ease-in-out infinite; }
        .anim-flicker { animation: neonFlicker 2.5s ease-in-out infinite; }
      `}</style>

      <div
        id="safeguard-container"
        className="max-w-lg w-full flex flex-col items-center text-center gap-6"
      >
        {/* Animated Error Code Centerpiece */}
        <div className="relative flex items-center justify-center my-2">
          {/* Ambient Background Glow */}
          <div
            className="absolute -inset-10 rounded-full blur-3xl opacity-40 pointer-events-none"
            style={{ background: meta.glowColor }}
          />

          {/* 404 ANIMATION */}
          {is404 && (
            <div className="relative flex items-center gap-3 sm:gap-4 font-black font-mono text-7xl sm:text-8xl tracking-tight text-neutral-100">
              <span className="anim-float text-amber-400 drop-shadow-[0_0_20px_rgba(245,158,11,0.4)]">
                4
              </span>

              {/* Animated Compass / Radar zero */}
              <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full border-2 border-dashed border-amber-500/60 bg-amber-950/30 flex items-center justify-center anim-float-rev shadow-inner">
                <div className="absolute inset-2 rounded-full border border-amber-500/20 anim-pulse-ring" />
                <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-amber-400/80 to-transparent anim-radar" />
                <Compass className="w-10 h-10 text-amber-300 drop-shadow-md z-10" />
              </div>

              <span className="anim-float text-amber-400 drop-shadow-[0_0_20px_rgba(245,158,11,0.4)]">
                4
              </span>
            </div>
          )}

          {/* 403 ANIMATION */}
          {is403 && (
            <div className="relative flex items-center gap-3 sm:gap-4 font-black font-mono text-7xl sm:text-8xl tracking-tight text-neutral-100">
              <span className="anim-float text-rose-400 drop-shadow-[0_0_20px_rgba(244,63,94,0.4)]">
                4
              </span>

              {/* Animated Lock Shield Zero */}
              <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl border-2 border-rose-500/60 bg-rose-950/40 flex items-center justify-center anim-lock shadow-lg anim-flicker">
                <div className="absolute -inset-1 rounded-2xl border border-rose-500/30 anim-pulse-ring" />
                <KeyRound className="w-10 h-10 text-rose-300 drop-shadow-md z-10" />
              </div>

              <span className="anim-float text-rose-400 drop-shadow-[0_0_20px_rgba(244,63,94,0.4)]">
                3
              </span>
            </div>
          )}

          {/* 503 / 500 ANIMATION */}
          {(is500 || is503) && (
            <div className="relative flex items-center gap-3 sm:gap-4 font-black font-mono text-7xl sm:text-8xl tracking-tight text-neutral-100">
              <span className="anim-float text-emerald-400 drop-shadow-[0_0_20px_rgba(16,185,129,0.4)]">
                5
              </span>

              {/* Animated Zap energy Zero */}
              <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full border-2 border-emerald-500/60 bg-emerald-950/30 flex items-center justify-center anim-float-rev shadow-inner">
                <div className="absolute inset-1 rounded-full border border-emerald-500/30 anim-pulse-ring" />
                <ZapOff className="w-10 h-10 text-emerald-300 drop-shadow-md z-10" />
              </div>

              <span className="anim-float text-emerald-400 drop-shadow-[0_0_20px_rgba(16,185,129,0.4)]">
                0
              </span>
            </div>
          )}
        </div>

        {/* Badge & Title */}
        <div className="flex flex-col items-center gap-2 max-w-md">
          <span
            className={`px-3 py-1 rounded-full text-xs font-mono font-semibold border ${meta.badgeBg}`}
          >
            {meta.badge}
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-neutral-100 leading-tight">
            {meta.title}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-400 leading-relaxed">
            {meta.desc}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 flex-wrap justify-center w-full pt-1">
          <button
            id="btn-safeguard-home"
            type="button"
            onClick={handleDefaultGoHome}
            className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg hover:shadow-emerald-900/30 transition-all cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0"
          >
            <Home className="w-4 h-4" />
            <span>Volver al inicio</span>
          </button>

          <button
            id="btn-safeguard-retry"
            type="button"
            onClick={handleDefaultRetry}
            className="px-4 py-2.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs font-medium flex items-center gap-2 transition cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reintentar</span>
          </button>
        </div>

        {/* Secondary Utilities: Technical Details & Emergency Backup */}
        <div className="flex flex-col items-center gap-3 w-full pt-4 border-t border-neutral-800/80">
          <div className="flex items-center gap-4 text-xs text-neutral-400">
            <button
              id="btn-safeguard-download-backup"
              type="button"
              onClick={handleExportEmergencyBackup}
              disabled={isExportingBackup}
              className="hover:text-sky-300 flex items-center gap-1.5 transition cursor-pointer"
              title="Descargar volcado JSON del almacenamiento local actual"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isExportingBackup ? 'Descargando...' : 'Descargar respaldo'}</span>
            </button>

            <span>·</span>

            <button
              id="btn-safeguard-reset-state"
              type="button"
              onClick={handleDefaultReset}
              className="hover:text-rose-400 flex items-center gap-1.5 transition cursor-pointer"
              title="Limpiar almacenamiento local"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Restablecer</span>
            </button>

            {technicalDetails && (
              <>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                  className="hover:text-neutral-200 flex items-center gap-1 transition cursor-pointer"
                >
                  <span>Detalles</span>
                  {showTechnicalDetails ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
              </>
            )}
          </div>

          {technicalDetails && showTechnicalDetails && (
            <div className="w-full max-w-md p-3 rounded bg-black/80 border border-neutral-800 text-[11px] font-mono text-rose-300 text-left break-words max-h-36 overflow-y-auto">
              {technicalDetails}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
