import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { console.error('view crashed:', err, info) }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="stack" style={{ padding: 16 }}>
        <div className="callout err">
          <div>
            <b>{this.props.title || 'This view could not be drawn'}</b>
            <div style={{ marginTop: 4 }}>{String(this.state.err.message || this.state.err)}</div>
            <div className="acts"><button className="btn" onClick={() => this.setState({ err: null })}>Try again</button></div>
          </div>
        </div>
      </div>
    )
  }
}
