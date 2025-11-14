/**
 * TypeScript type definitions for window.openai API
 * This API is provided by ChatGPT to widgets running in iframes
 */

export interface WindowOpenAI {
  // Initial data from tool output
  toolOutput: {
    structuredContent?: any;
    content?: any[];
    _meta?: Record<string, any>;
    result?: {
      structuredContent?: any;
      text?: string;
      [key: string]: any;
    };
    [key: string]: any;
  };

  // Initial tool input arguments
  toolInput: Record<string, any>;

  // Additional metadata that might be present
  toolResponseMetadata?: {
    structuredContent?: any;
    [key: string]: any;
  };

  widget?: {
    structuredContent?: any;
    [key: string]: any;
  };

  // Persisted widget state (survives across conversation turns)
  widgetState: any;

  // Theme and display settings
  theme: 'light' | 'dark';
  displayMode: 'inline' | 'pip' | 'fullscreen';
  locale: string;

  // Layout constraints
  maxHeight?: number;
  safeArea?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };

  // User agent and capabilities
  userAgent?: string;
  capabilities?: {
    navigation?: boolean;
    resize?: boolean;
  };

  // Methods for interacting with ChatGPT

  /**
   * Call an MCP tool from the widget
   * @param name - Tool name
   * @param args - Tool arguments
   * @returns Tool response
   */
  callTool: (name: string, args: Record<string, any>) => Promise<any>;

  /**
   * Send a follow-up message to the conversation
   * @param params - Message parameters
   */
  sendFollowUpMessage: (params: { prompt: string }) => void;

  /**
   * Open an external link or redirect
   * @param params - Link parameters
   */
  openExternal: (params: { href: string }) => void;

  /**
   * Request a display mode change
   * @param params - Display mode parameters
   */
  requestDisplayMode: (params: { mode: 'inline' | 'pip' | 'fullscreen' }) => void;

  /**
   * Persist widget state (survives conversation turns)
   * @param state - State to persist
   */
  setWidgetState: (state: any) => void;
}

declare global {
  interface Window {
    openai: WindowOpenAI;
  }

  interface WindowEventMap {
    'openai:set_globals': CustomEvent<Partial<WindowOpenAI>>;
  }
}

export {};
