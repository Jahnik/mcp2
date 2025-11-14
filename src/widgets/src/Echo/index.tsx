/**
 * Echo Widget Entry Point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Echo } from './Echo';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <Echo />
  </React.StrictMode>
);
