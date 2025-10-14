export class DashboardServer {
  constructor({ enabled = false, port = 8787, statsProvider = null }) {
    this.enabled = enabled;
    this.port = port;
    this.statsProvider = statsProvider;
    this.server = null;
  }

  async start() {
    if (!this.enabled || this.server) return;

    try {
      const expressModule = await import('express');
      const express = expressModule.default;
      const app = express();

      app.get('/health', (_req, res) => res.json({ status: 'ok' }));
      app.get('/stats', (_req, res) => {
        try {
          const stats = this.statsProvider ? this.statsProvider() : {};
          res.json({ status: 'ok', stats });
        } catch (error) {
          res.status(500).json({ status: 'error', message: error.message });
        }
      });

      app.get('/', (_req, res) => {
        const stats = this.statsProvider ? this.statsProvider() : {};
        res.send(`<!doctype html>
<html><head><title>Mempool Scanner Dashboard</title>
<style>
body{font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;padding:2rem;}
.card{background:#1e293b;padding:1.5rem;border-radius:12px;max-width:720px;margin:0 auto;}
table{width:100%;border-collapse:collapse;margin-top:1rem;}
th,td{padding:0.5rem;text-align:left;border-bottom:1px solid #334155;}
.title{font-size:1.5rem;margin-bottom:1rem;}
</style></head>
<body><div class="card">
  <div class="title">🚀 Scanner Dashboard</div>
  <div>Active Trades: ${(stats.activeTrades || []).length}</div>
  <div>Total Attempts: ${stats.attempts ?? 0}</div>
  <div>Profitable: ${stats.profitable ?? 0}</div>
  <div>Losing: ${stats.losing ?? 0}</div>
  <div>Aborted: ${stats.aborted ?? 0}</div>
  <div>Total Profit (ETH): ${(stats.totalProfitEth ?? 0).toFixed?.(4) ?? stats.totalProfitEth}</div>
  <div>Total Loss (ETH): ${(stats.totalLossEth ?? 0).toFixed?.(4) ?? stats.totalLossEth}</div>
  <h3 style="margin-top:1.5rem;">Active Trades</h3>
  <table><thead><tr><th>Token</th><th>Status</th><th>PNL%</th></tr></thead>
    <tbody>
    ${(stats.activeTrades || []).map(trade => `<tr><td>${trade.token}</td><td>${trade.status}</td><td>${trade.pnlPct ?? 'N/A'}</td></tr>`).join('')}
    </tbody>
  </table>
</div></body></html>`);
      });

      this.server = await new Promise((resolve, reject) => {
        const srv = app.listen(this.port, () => resolve(srv));
        srv.on('error', reject);
      });

      console.log(`[Dashboard] Listening on http://localhost:${this.port}`);
    } catch (error) {
      console.warn('[Dashboard] Failed to start:', error.message);
    }
  }

  async stop() {
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }
}

