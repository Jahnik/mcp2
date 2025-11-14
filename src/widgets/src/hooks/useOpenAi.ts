/**
 * React hook for accessing window.openai API
 * Uses useSyncExternalStore to properly sync with external window.openai store
 */

import { useSyncExternalStore } from 'react';
import type { WindowOpenAI } from '../types/openai';

const SET_GLOBALS_EVENT = 'openai:set_globals';

export function useOpenAi() {
  // Subscribe to window.openai changes using React's recommended external store hook
  const globals = useSyncExternalStore(
    // Subscribe function: called once when component mounts
    (onChange) => {
      if (typeof window === 'undefined') {
        return () => {};
      }

      const handler = () => {
        console.log('[useOpenAi] openai:set_globals event received');
        onChange();
      };

      window.addEventListener(SET_GLOBALS_EVENT, handler, { passive: true });
      console.log('[useOpenAi] Subscribed to', SET_GLOBALS_EVENT);

      return () => {
        window.removeEventListener(SET_GLOBALS_EVENT, handler);
        console.log('[useOpenAi] Unsubscribed from', SET_GLOBALS_EVENT);
      };
    },
    // Get snapshot: reads current value directly from window.openai
    () => {
      console.log('[useOpenAi] Reading MY NEW FANCY snapshot, toolOutput exists:', !!window.openai?.toolOutput);
      return window.openai?.toolOutput;
    },
    // Server snapshot: fallback for SSR
    () => ({} as WindowOpenAI)
  );

  // Convenience methods that call window.openai directly
  const callTool = async (name: string, args: Record<string, any>) => {
    try {
      return await window.openai.callTool(name, args);
    } catch (error) {
      console.error(`Failed to call tool ${name}:`, error);
      throw error;
    }
  };

  const sendMessage = (prompt: string) => {
    window.openai.sendFollowUpMessage({ prompt });
  };

  const openLink = (href: string) => {
    window.openai.openExternal({ href });
  };

  const requestFullscreen = () => {
    window.openai.requestDisplayMode({ mode: 'fullscreen' });
  };

  const requestPiP = () => {
    window.openai.requestDisplayMode({ mode: 'pip' });
  };

  const requestInline = () => {
    window.openai.requestDisplayMode({ mode: 'inline' });
  };

  return {
    // All globals from window.openai (read directly, not copied)
    ...globals,

    // Convenience methods
    callTool,
    sendMessage,
    openLink,
    requestFullscreen,
    requestPiP,
    requestInline,
  };
}
