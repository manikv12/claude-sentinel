import { createTheme } from '@mui/material/styles'

export function createMuiTheme(mode: 'light' | 'dark') {
  return createTheme({
    palette: {
      mode,
      primary: { 
        main: mode === 'dark' ? '#adb5bd' : '#6c757d',
        light: '#e9ecef',
        dark: '#495057'
      },
      secondary: {
        main: mode === 'dark' ? '#f8f9fa' : '#343a40',
        light: '#ffffff',
        dark: '#212529'
      },
      background: {
        default: mode === 'dark' ? '#0b0f14' : '#ffffff',
        paper: mode === 'dark' ? '#1a1f25' : '#f8f9fa'
      },
      text: {
        primary: mode === 'dark' ? '#f8f9fa' : '#212529',
        secondary: mode === 'dark' ? '#adb5bd' : '#6c757d'
      },
      divider: mode === 'dark' ? '#495057' : '#dee2e6'
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


