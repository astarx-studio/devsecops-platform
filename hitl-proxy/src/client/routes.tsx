import { Navigate, Route, Routes } from 'react-router-dom';

import { App } from './App';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/s/:sessionId" element={<App />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
