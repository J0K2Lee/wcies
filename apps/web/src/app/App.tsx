import { Route, Routes } from 'react-router';
import { HealthTestPage } from '../pages/HealthTestPage';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/health-test" element={<HealthTestPage />} />
    </Routes>
  );
}
