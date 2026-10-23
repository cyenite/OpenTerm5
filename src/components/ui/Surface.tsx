import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// The window a piece of UI is shown in: the main window, or a chart's pop-out window. Listeners
// and viewport sizes must come from it, since `window` is always the main one.
const SurfaceContext = createContext<Window>(window);

export function useSurface(): Window {
  return useContext(SurfaceContext);
}

export const viewOf = (node: Node | null | undefined): Window => node?.ownerDocument?.defaultView ?? window;

interface SurfacePortalProps {
  view: Window | null;
  children: ReactNode;
}

// Renders into another window's body, or in place for the main window.
export function SurfacePortal({ view, children }: SurfacePortalProps) {
  if (!view || view === window) return <>{children}</>;
  return createPortal(<SurfaceContext.Provider value={view}>{children}</SurfaceContext.Provider>, view.document.body);
}

interface SurfaceProviderProps {
  view: Window;
  children: ReactNode;
}

export function SurfaceProvider({ view, children }: SurfaceProviderProps) {
  return <SurfaceContext.Provider value={view}>{children}</SurfaceContext.Provider>;
}
