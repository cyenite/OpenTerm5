import { useCallback, useRef, useSyncExternalStore } from 'react';

export class Store<T extends object> {
  private listeners = new Set<() => void>();
  private state: T;

  constructor(initial: T) {
    this.state = initial;
  }

  get = (): T => this.state;

  set(patch: Partial<T> | ((state: T) => Partial<T>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

function isShallowEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  }
  return false;
}

export function useStore<T extends object, S>(store: Store<T>, select: (state: T) => S): S {
  // Selectors that derive arrays (filtered lists) return a fresh reference on every
  // call; useSyncExternalStore treats that as a change and re-renders forever.
  const cache = useRef<{ state: T; select: (state: T) => S; selected: S } | null>(null);
  const snapshot = useCallback(() => {
    const state = store.get();
    if (cache.current?.state === state && cache.current.select === select) {
      return cache.current.selected;
    }
    const selected = select(state);
    const previous = cache.current?.selected;
    cache.current = { state, select, selected: cache.current && isShallowEqual(previous, selected) ? (previous as S) : selected };
    return cache.current.selected;
  }, [store, select]);
  return useSyncExternalStore(store.subscribe, snapshot);
}
