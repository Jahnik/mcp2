/**
 * Echo Widget Component
 * Simple widget that displays the text provided by the user
 */

import { useOpenAi } from '../hooks/useOpenAi';
import './styles.css';

export function Echo() {
  const { toolOutput, toolInput, theme } = useOpenAi();

  // Extract text from all possible locations
  // Note: ChatGPT flattens structuredContent to the top level of toolOutput
  const echoText = toolOutput?.text ||                          // Primary: flattened structuredContent
                   toolOutput?.structuredContent?.text ||       // Fallback: nested structuredContent
                   toolInput?.text ||                           // Fallback: from tool input
                   'No text provided';

  const timestamp = toolOutput?._meta?.timestamp || new Date().toISOString();

  return (
    <div className={`echo-widget theme-${theme}`}>
      <div className="echo-header">
        <span className="echo-icon">💬</span>
        <h2>Echo</h2>
      </div>
      <div className="echo-content">
        <div className="echo-text">{echoText}</div>
        <div className="echo-meta">
          <span className="echo-timestamp">
            {new Date(timestamp).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}
