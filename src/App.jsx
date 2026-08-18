import { useMemo, useState } from 'react';

const sampleData = [
  { name: 'Kel. A', score: 72, access: 68, equity: 80 },
  { name: 'Kel. B', score: 81, access: 75, equity: 88 },
  { name: 'Kel. C', score: 64, access: 58, equity: 71 },
  { name: 'Kel. D', score: 90, access: 86, equity: 92 },
];

function App() {
  const [selectedArea, setSelectedArea] = useState('Kel. B');

  const activeArea = useMemo(
    () => sampleData.find((item) => item.name === selectedArea) ?? sampleData[0],
    [selectedArea]
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">GeoTransit Insight</p>
          <h1>Transit Priority Dashboard</h1>
        </div>

        <nav className="nav-list">
          {sampleData.map((item) => (
            <button
              key={item.name}
              className={item.name === selectedArea ? 'nav-item active' : 'nav-item'}
              onClick={() => setSelectedArea(item.name)}
            >
              <span>{item.name}</span>
              <strong>{item.score}</strong>
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow muted">Area insight</p>
            <h2>{activeArea.name}</h2>
          </div>
          <div className="chip">Status: Ready for data integration</div>
        </header>

        <section className="stats-grid">
          <div className="stat-card">
            <label>CAI Score</label>
            <strong>{activeArea.score}</strong>
            <small>Composite access index</small>
          </div>
          <div className="stat-card">
            <label>Access</label>
            <strong>{activeArea.access}</strong>
            <small>Coverage reach</small>
          </div>
          <div className="stat-card">
            <label>Equity</label>
            <strong>{activeArea.equity}</strong>
            <small>Distribution fairness</small>
          </div>
        </section>

        <section className="content-grid">
          <div className="panel map-panel">
            <h3>Map Preview</h3>
            <div className="map-placeholder">
              <span>MAPID Map / MapLibre placeholder</span>
            </div>
          </div>

          <div className="panel ai-panel">
            <h3>AI Insight</h3>
            <p>
              Area {activeArea.name} menunjukkan tingkat akses transit yang relatif kuat,
              dengan skor utama {activeArea.score}/100. Prioritas intervensi tetap pada
              segmentasi pelayanan yang belum menjangkau kelompok dengan kebutuhan lebih tinggi.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
