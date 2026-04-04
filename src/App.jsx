import { useState, useEffect } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function App() {
  const [health, setHealth] = useState(null)

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then(r => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'API 연결 실패' }))
  }, [])

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <h1>My App</h1>
      <p>API URL: <code>{API_URL}</code></p>
      <p>API 상태: <code>{health ? JSON.stringify(health) : '로딩 중...'}</code></p>
    </div>
  )
}

export default App
