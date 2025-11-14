/**
 * ListView Widget Component
 * Displays a list of items with interactive actions
 */

import { useOpenAi } from '../hooks/useOpenAi';
import { useWidgetState } from '../hooks/useWidgetState';
import './styles.css';

interface Item {
  id: string;
  title: string;
  description?: string;
  actionable?: boolean;
  metadata?: Record<string, any>;
}

interface WidgetState {
  selectedId: string | null;
  loading: boolean;
  loadingItemId: string | null;
}

export function ListView() {
  const { toolOutput, theme, callTool } = useOpenAi();
  const [widgetState, setWidgetState] = useWidgetState<WidgetState>(() => ({
    selectedId: null,
    loading: false,
    loadingItemId: null,
  }));

  // ChatGPT flattens structuredContent to the top level of toolOutput
  const items: Item[] = toolOutput?.items || toolOutput?.structuredContent?.items || [];

  const handleAction = async (itemId: string, action: string = 'default') => {
    setWidgetState((prev) => ({
      ...prev,
      loading: true,
      loadingItemId: itemId,
    }));

    try {
      const result = await callTool('perform-item-action', { itemId, action });
      console.log('Action result:', result);

      // Update widget state
      setWidgetState((prev) => ({
        ...prev,
        selectedId: itemId,
        loading: false,
        loadingItemId: null,
      }));
    } catch (error) {
      console.error('Action failed:', error);
      setWidgetState((prev) => ({
        ...prev,
        loading: false,
        loadingItemId: null,
      }));
    }
  };

  const handleSelect = (itemId: string) => {
    setWidgetState((prev) => ({
      ...prev,
      selectedId: prev.selectedId === itemId ? null : itemId,
    }));
  };

  if (items.length === 0) {
    return (
      <div className={`list-view theme-${theme}`}>
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <h3>No Items Found</h3>
          <p>There are no items to display at this time.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`list-view theme-${theme}`}>
      <div className="list-header">
        <h2>Items ({items.length})</h2>
      </div>
      <div className="list-container">
        {items.map((item) => {
          const isSelected = widgetState.selectedId === item.id;
          const isLoading = widgetState.loadingItemId === item.id;

          return (
            <div
              key={item.id}
              className={`list-item ${isSelected ? 'selected' : ''} ${isLoading ? 'loading' : ''}`}
              onClick={() => handleSelect(item.id)}
            >
              <div className="item-content">
                <h3 className="item-title">{item.title}</h3>
                {item.description && (
                  <p className="item-description">{item.description}</p>
                )}
                {item.metadata && Object.keys(item.metadata).length > 0 && (
                  <div className="item-metadata">
                    {Object.entries(item.metadata).map(([key, value]) => (
                      <span key={key} className="metadata-tag">
                        {key}: {String(value)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {item.actionable && (
                <div className="item-actions">
                  <button
                    className="action-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAction(item.id, 'perform');
                    }}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Loading...' : 'Action'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
