import { Component, useEffect, useState, type ReactNode } from 'react';
import type { CharacterDoc } from '@ps2cc/core';
import { backend } from './backend';
import { AtlasEditor } from './components/AtlasEditor';
import { DropTarget } from './components/DropTarget';
import { CharacterBrowser } from './components/CharacterBrowser';
import { CreditsDialog } from './components/CreditsDialog';
import { FirstRunSetup } from './components/FirstRunSetup';
import { GarmentImportDialog } from './components/GarmentImportDialog';
import { RecoveryPrompt } from './components/RecoveryPrompt';
import { BudgetBar } from './components/BudgetBar';
import { Dock } from './components/workspace/Dock';
import { TopBar } from './components/workspace/TopBar';
import { Toasts } from './components/Toasts';
import { ViewportPanel } from './components/ViewportPanel';
import { DataFolderDialog } from './components/DataFolderDialog';
import { useShortcuts } from './shortcuts';
import { loadLibraryPrefs, refreshUserLibrary } from './state/library';
import { StudioContext } from './state/hooks';
import { Studio } from './state/studio';
import { useUi } from './state/ui';

/** One studio per page load, even if React mounts the app twice (StrictMode, fast refresh). */
let studioPromise: Promise<Studio> | null = null;
const createStudioOnce = (onProgress: (s: string) => void) => (studioPromise ??= Studio.create(onProgress));

export function App() {
  const [studio, setStudio] = useState<Studio | null>(null);
  const [step, setStep] = useState('starting');
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createStudioOnce((s) => !cancelled && setStep(s))
      .then(async (s) => {
        if (cancelled) return;
        const settings = await backend.settings();
        useUi.setState({ curated: settings.curatedView, symmetry: settings.symmetry });
        s.settings = settings;
        loadLibraryPrefs(settings);
        // A data folder on a drive that is not connected: the app runs on the default one and says so.
        void backend.dataFolder().then((f) => f.fallback && useUi.getState().error(`${f.fallback[0]!.toUpperCase()}${f.fallback.slice(1)}. Reconnect it and restart, or choose another in File → Data folder.`));
        void refreshUserLibrary(s);
        if (new URLSearchParams(window.location.search).has('e2e') || navigator.webdriver) {
          // Under test automation the GPU is SwiftShader (a CPU): tests start bakes themselves (studio.runBake) at small sizes,
          // and exports, which must bake, bake 128 px maps with 8 rays unless a test asks for more.
          s.autoBake = false;
          s.bakeOverride = { size: 128, rays: 8 };
        }
        s.loadText(JSON.stringify(s.newDocument((s.engine.doc as CharacterDoc).name)));
        s.startAutosave(settings.autosaveMinutes);
        // Test hook for Playwright screenshot tests: dev server, or any build opened with ?e2e (the desktop app never is).
        if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e')) {
          (window as unknown as { __ps2cc?: Studio }).__ps2cc = s;
          void import('./testHooks').then((m) => ((window as unknown as { __ps2ccTest?: unknown }).__ps2ccTest = m.testHooks));
        }
        setStudio(s);
      })
      .catch((err: unknown) => {
        backend.log('error', `startup failed: ${String(err)}`);
        setFatal(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (fatal) {
    return (
      <div className="splash">
        <h1>PS2CC could not start</h1>
        <p className="error-text">{fatal}</p>
        <p>Compiled assets are created with <code>pnpm build:assets</code> and <code>pnpm build:meshes</code>.</p>
      </div>
    );
  }
  if (!studio) {
    return (
      <div className="splash">
        <h1>PS2CC</h1>
        <p>Loading {step}…</p>
      </div>
    );
  }
  return (
    <StudioContext.Provider value={studio}>
      <ErrorBoundary>
        <Shell />
      </ErrorBoundary>
    </StudioContext.Provider>
  );
}

function Shell() {
  useShortcuts();
  const browserOpen = useUi((s) => s.browserOpen);
  const setBrowserOpen = useUi((s) => s.setBrowserOpen);
  const creditsOpen = useUi((s) => s.creditsOpen);
  const setCreditsOpen = useUi((s) => s.setCreditsOpen);
  return (
    <div className="shell">
      <TopBar />
      <main className="stage">
        <DropTarget>
          <ViewportPanel />
        </DropTarget>
      </main>
      <Dock />
      <BudgetBar />
      <Toasts />
      <RecoveryPrompt />
      <FirstRunSetup />
      {browserOpen && <CharacterBrowser onClose={() => setBrowserOpen(false)} />}
      {creditsOpen && <CreditsDialog onClose={() => setCreditsOpen(false)} />}
      <AtlasEditor />
      <DataFolderDialog />
      <GarmentImportDialog />
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    backend.log('error', `UI crash: ${error.stack ?? error.message}`);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="splash">
          <h1>Something went wrong</h1>
          <p className="error-text">{this.state.error.message}</p>
          <button onClick={() => navigator.clipboard.writeText(this.state.error?.stack ?? '')}>Copy details</button>
          <button onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
