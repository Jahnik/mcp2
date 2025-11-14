/**
 * React hook for managing persisted widget state
 * State survives across conversation turns
 */

import { useState, useCallback } from 'react';

export function useWidgetState<T>(initialState: () => T) {
  const [state, setState] = useState<T>(
    () => window.openai.widgetState ?? initialState()
  );

  const setWidgetState = useCallback((updater: T | ((prev: T) => T)) => {
    setState((prev) => {
      const newState = typeof updater === 'function' ? (updater as (prev: T) => T)(prev) : updater;
      window.openai.setWidgetState(newState);
      return newState;
    });
  }, []);

  return [state, setWidgetState] as const;
}
