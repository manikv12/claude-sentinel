import { createTheme } from '@mui/material/styles'

export function createMuiTheme(mode: 'light' | 'dark') {
  return createTheme({
    palette: {
      mode,
      primary: { main: '#2563eb' },
      background: {
        default: mode === 'dark' ? '#0f172a' : '#ffffff',
        paper: mode === 'dark' ? '#1e293b' : '#ffffff'
      },
      text: {
        primary: mode === 'dark' ? '#f8fafc' : '#0f172a',
        secondary: mode === 'dark' ? '#cbd5e1' : '#64748b'
      }
    },
    shape: {
      borderRadius: 12
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            overscrollBehavior: 'none'
          }
        }
      }
    }
  })
}


