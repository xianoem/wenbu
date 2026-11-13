import './styles.css'
import { RegistryProvider } from '@effect/atom-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '#ui/tooltip'
import { RendererErrors } from './features/diagnostics/RendererErrors'
import { LiveControlsPage } from './features/livecontrols/LiveControlsPage'

const root = document.getElementById('root')

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <RegistryProvider>
        <RendererErrors source="livecontrols" />
        <TooltipProvider>
          <LiveControlsPage />
        </TooltipProvider>
      </RegistryProvider>
    </StrictMode>,
  )
}
