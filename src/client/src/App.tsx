import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AuthorizePage from './routes/AuthorizePage';
import ErrorPage from './routes/ErrorPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/authorize" element={<AuthorizePage />} />
        <Route path="/error" element={<ErrorPage />} />
        <Route path="/" element={<Navigate to="/authorize" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
