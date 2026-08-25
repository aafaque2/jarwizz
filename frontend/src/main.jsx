import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import OrbApp from './routes/OrbApp.jsx'

const route = window.location.hash.replace('#', '') || 'dashboard'

if (route === 'orb' || route === 'gateway') {
  document.documentElement.classList.add('route-transparent')
}

function GatewayStub() {
  return <div className="h-screen bg-bg-void" />
}

const Root =
  route === 'orb' ? OrbApp : route === 'gateway' ? GatewayStub : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
