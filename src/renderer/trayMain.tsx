import './styles.css'
import { RegistryProvider } from '@effect/atom-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '#ui/tooltip'
import { RendererErrors } from './features/diagnostics/RendererErrors'
import { TrayPanel } from './features/tray/TrayPanel'

const root = document.getElementById('root')

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <RegistryProvider>
        <RendererErrors source="tray" />
        <TooltipProvider>
          <TrayPanel />
        </TooltipProvider>
      </RegistryProvider>
    </StrictMode>,
  )
}
