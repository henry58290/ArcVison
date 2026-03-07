import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./App.css";
import Navbar from "./components/Navbar";
import Dashboard from "./pages/Dashboard";
import MarketDetail from "./pages/MarketDetail";
import Swap from "./pages/Swap";

function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
        <Navbar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/market/:id" element={<MarketDetail />} />
          <Route path="/swap" element={<Swap />} />
          <Route path="/resolve" element={<Navigate to="/?tab=resolved" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
