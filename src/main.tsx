import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './globals.css'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { createMuiTheme } from './lib/muiTheme'
import { useThemeStore } from './stores/themeStore'

function Root() {
  const mode = useThemeStore((s) => s.resolvedMode)
  const init = useThemeStore((s) => s.init)

  React.useEffect(() => {
    init()
  }, [init])

  const theme = React.useMemo(() => createMuiTheme(mode), [mode])
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)