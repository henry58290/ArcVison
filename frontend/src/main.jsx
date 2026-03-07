import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { ThemeProvider } from './components/ThemeProvider.jsx'

import '@rainbow-me/rainbowkit/styles.css'
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ['https://arc-testnet.drpc.org'] },
    public: { http: ['https://arc-testnet.drpc.org'] },
  },
  blockExplorers: {
    default: {
      name: 'ArcScan',
      url: 'https://testnet.arcscan.app',
    },
  },
  testnet: true,
}

const wcProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID

if (!wcProjectId) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg)',
        color: 'var(--color-fg)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
        fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 720 }}>
        <h1 style={{ marginTop: 0, marginBottom: 12 }}>
          Missing WalletConnect Project ID
        </h1>
        <p style={{ color: 'var(--color-fg-muted)', marginTop: 0, marginBottom: 12 }}>
          Create a free project ID at Reown (WalletConnect) and set it in your
          frontend environment.
        </p>
        <pre
          style={{
            background: 'var(--color-surface)',
            padding: 12,
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            overflowX: 'auto',
            color: 'var(--color-fg)',
          }}
        >
          VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here
        </pre>
        <p style={{ color: 'var(--color-fg-muted)', marginBottom: 0 }}>
          Put it in <code>.env</code> (see <code>.env.example</code>), then
          restart <code>npm run dev</code>.
        </p>
      </div>
    </div>,
  )
} else {
const config = getDefaultConfig({
  appName: 'ArcVison',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
  chains: [arcTestnet],
})

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
)
}
