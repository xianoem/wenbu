import './styles.css'
import { RegistryProvider } from '@effect/atom-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '#ui/tooltip'
import { RendererErrors } from './features/diagnostics/RendererErrors'
import { QuickTranslateCard } from './features/quicktranslate/QuickTranslateCard'

const root = document.getElementById('root')

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <RegistryProvider>
        <RendererErrors source="quick-translate" />
        <TooltipProvider>
          <QuickTranslateCard />
        </TooltipProvider>
      </RegistryProvider>
    </StrictMode>,
  )
}
