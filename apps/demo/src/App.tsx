import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Home } from './pages/Home';
import { ProsemirrorDemo } from './pages/ProsemirrorDemo';
import { StressTestDemo } from './pages/StressTestDemo';
import './styles.css';

const App = () => {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className="app-shell">
      <nav className="main-nav">
        <div className="nav-brand">
          <Link to="/">Y-Kafka Collab</Link>
        </div>
        <div className="nav-links">
          <Link
            to="/prosemirror"
            className={location.pathname === '/prosemirror' ? 'active' : ''}
          >
            Prosemirror
          </Link>
          <Link
            to="/stress"
            className={location.pathname === '/stress' ? 'active' : ''}
          >
            Stress Test
          </Link>
        </div>
      </nav>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/prosemirror" element={<ProsemirrorDemo />} />
          <Route path="/stress" element={<StressTestDemo />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
