import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          height: '100%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-1)',
        }}>
          <div style={{ fontSize: 28 }}>⚠</div>
          <div>3D view crashed (likely a lost WebGL context).</div>
          <button className="primary" onClick={() => this.setState({ error: null })}>
            Reload 3D view
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
