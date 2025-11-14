/**
 * ListView Widget Entry Point
 * This file is the entry point for the ListView widget bundle
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ListView } from './ListView';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <ListView />
  </React.StrictMode>
);
