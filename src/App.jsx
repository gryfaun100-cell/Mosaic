import { useState, useRef, useCallback, useEffect } from 'react'
import './App.css'

const PREVIEW_CANVAS_SIZE = 800

function App() {
  const [theme, setTheme] = useState('dark')
  const [uploadedImage, setUploadedImage] = useState(null)
  const [imageFile, setImageFile] = useState(null)
  const [word, setWord] = useState('')
  const [detailLevel, setDetailLevel] = useState(6)
  const [colorMode, setColorMode] = useState('monochrome')
  const [fontSize, setFontSize] = useState(14)
  const [background, setBackground] = useState('black')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isGenerated, setIsGenerated] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [progress, setProgress] = useState(0)

  const fileInputRef = useRef(null)
  const canvasRef = useRef(null)
  const offscreenRef = useRef(null)

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      setUploadedImage(e.target.result)
      setIsGenerated(false)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    handleFile(file)
  }, [handleFile])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => setIsDragging(false), [])

  const generateMosaic = useCallback(async () => {
    if (!uploadedImage || !word.trim()) return
    setIsGenerating(true)
    setProgress(0)
    setIsGenerated(false)

    await new Promise(r => setTimeout(r, 50))

    const img = new Image()
    img.src = uploadedImage
    await new Promise(r => { img.onload = r })

    // Determine canvas dimensions maintaining aspect ratio with max dimension bounding
    const aspect = img.width / img.height
    let canvasW, canvasH
    if (aspect > 1) {
      canvasW = PREVIEW_CANVAS_SIZE
      canvasH = Math.round(PREVIEW_CANVAS_SIZE / aspect)
    } else {
      canvasH = PREVIEW_CANVAS_SIZE
      canvasW = Math.round(PREVIEW_CANVAS_SIZE * aspect)
    }

    const canvas = canvasRef.current
    canvas.width = canvasW
    canvas.height = canvasH
    const ctx = canvas.getContext('2d')

    // Draw background
    ctx.fillStyle = background === 'black' ? '#0a0a0a' : background === 'white' ? '#ffffff' : '#1a1a2e'
    ctx.fillRect(0, 0, canvasW, canvasH)

    // Offscreen canvas for pixel sampling
    const off = document.createElement('canvas')
    const offSize = Math.min(img.width, 800)
    off.width = offSize
    off.height = Math.round(offSize / aspect)
    const offCtx = off.getContext('2d')
    offCtx.drawImage(img, 0, 0, off.width, off.height)
    const pixelData = offCtx.getImageData(0, 0, off.width, off.height)

    const getPixelBrightness = (nx, ny) => {
      const px = Math.floor(nx * off.width)
      const py = Math.floor(ny * off.height)
      const clamped_px = Math.max(0, Math.min(px, off.width - 1))
      const clamped_py = Math.max(0, Math.min(py, off.height - 1))
      const idx = (clamped_py * off.width + clamped_px) * 4
      const r = pixelData.data[idx]
      const g = pixelData.data[idx + 1]
      const b = pixelData.data[idx + 2]
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255
    }

    const getPixelColor = (nx, ny) => {
      const px = Math.floor(nx * off.width)
      const py = Math.floor(ny * off.height)
      const clamped_px = Math.max(0, Math.min(px, off.width - 1))
      const clamped_py = Math.max(0, Math.min(py, off.height - 1))
      const idx = (clamped_py * off.width + clamped_px) * 4
      return {
        r: pixelData.data[idx],
        g: pixelData.data[idx + 1],
        b: pixelData.data[idx + 2],
      }
    }

    // Mapping detailLevel (1-10) to grid density
    const gridStep = Math.max(4, Math.round(40 - detailLevel * 3.2))

    const textToUse = word.trim() || 'A'
    // Split into words, or if it's a very long string without spaces, chunk it
    let tokens = textToUse.split(/\s+/)
    if (tokens.length === 1 && tokens[0].length > 10) {
      tokens = tokens[0].match(/.{1,6}/g) || [tokens[0]]
    }

    const wordsToPlace = []
    let tokenIndex = 0
    let row = 0

    // Build word placement list
    for (let y = 0; y < canvasH; y += gridStep) {
      for (let x = 0; x < canvasW; x += gridStep) {
        const nx = x / canvasW
        const ny = y / canvasH
        const brightness = getPixelBrightness(nx, ny)
        const color = getPixelColor(nx, ny)

        // Skip very bright areas (near-white) for dark backgrounds — sparse
        // For light bg, skip near-dark
        const threshold = background === 'white' ? 0.85 : 0.08

        if (background === 'white' && brightness > threshold) continue
        if (background !== 'white' && brightness < threshold) continue

        // Vary font size based on brightness
        const brightnessFactor = background === 'white'
          ? 1 - brightness  // darker areas = larger text on white bg
          : brightness       // brighter areas = larger text on dark bg

        const minFs = Math.max(fontSize - 4, 6)
        const maxFs = fontSize + 6
        const wordFontSize = Math.round(minFs + brightnessFactor * (maxFs - minFs))

        // Slightly vary rotation for organic feel
        const seed = (x * 31 + y * 17) % 1000
        const rotation = (Math.sin(seed) * 8) // -8 to +8 degrees subtle tilt

        // Opacity based on image density
        const opacity = background === 'white'
          ? 0.15 + brightnessFactor * 0.85
          : 0.15 + brightnessFactor * 0.85

        // Color
        let fillColor
        if (colorMode === 'monochrome') {
          const v = background === 'white'
            ? Math.round((1 - brightness) * 220)
            : Math.round(brightness * 255)
          fillColor = `rgba(${v},${v},${v},${opacity.toFixed(2)})`
        } else if (colorMode === 'color') {
          fillColor = `rgba(${color.r},${color.g},${color.b},${opacity.toFixed(2)})`
        } else if (colorMode === 'duotone') {
          // Purple to cyan duotone
          const t = brightness
          const dr = Math.round(170 * (1 - t) + 0 * t)
          const dg = Math.round(59 * (1 - t) + 212 * t)
          const db = Math.round(255 * (1 - t) + 255 * t)
          fillColor = `rgba(${dr},${dg},${db},${opacity.toFixed(2)})`
        } else {
          // Neon glow — bright green/purple
          const t = brightness
          const nr = Math.round(0 + t * 180)
          const ng = Math.round(255 * t)
          const nb = Math.round(100 + t * 155)
          fillColor = `rgba(${nr},${ng},${nb},${opacity.toFixed(2)})`
        }

        const currentToken = tokens[tokenIndex % tokens.length]
        tokenIndex++

        wordsToPlace.push({ x, y, fontSize: wordFontSize, rotation, fillColor, text: currentToken })
      }
      row++
    }

    // Render in batches for progress
    const totalRows = wordsToPlace.length
    const batchSize = Math.ceil(totalRows / 20)

    for (let i = 0; i < wordsToPlace.length; i += batchSize) {
      const batch = wordsToPlace.slice(i, i + batchSize)
      for (const w of batch) {
        ctx.save()
        ctx.translate(w.x, w.y)
        ctx.rotate((w.rotation * Math.PI) / 180)
        ctx.font = `bold ${w.fontSize}px 'Inter', 'Segoe UI', sans-serif`
        ctx.fillStyle = w.fillColor
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(w.text, 0, 0)
        ctx.restore()
      }
      setProgress(Math.round(((i + batchSize) / wordsToPlace.length) * 100))
      // Yield to browser
      await new Promise(r => setTimeout(r, 0))
    }

    setProgress(100)
    setIsGenerating(false)
    setIsGenerated(true)
  }, [uploadedImage, word, detailLevel, colorMode, fontSize, background])

  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `mosaic-${word.trim() || 'portrait'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }, [word])

  const handleReset = useCallback(() => {
    setUploadedImage(null)
    setImageFile(null)
    setIsGenerated(false)
    setIsGenerating(false)
    setProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  return (
    <div className={`app-wrapper ${theme}`}>
      {/* Header */}
      <header className="app-header">
        <div className="logo-mark">
          <span className="logo-icon">T</span>
          <div className="logo-text">
            <span className="logo-title">TextMosaic</span>
            <span className="logo-sub">Typographic portraits</span>
          </div>
        </div>
        <nav className="header-nav">
          <div className="theme-toggle-wrapper">
            <span className="theme-label">Dark</span>
            <label className="theme-switch" title="Toggle Light/Dark Mode">
              <input 
                type="checkbox" 
                checked={theme === 'light'} 
                onChange={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')} 
              />
              <span className="slider"></span>
            </label>
            <span className="theme-label">Light</span>
          </div>
          <a href="#how-it-works" className="nav-link">How it works</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="hero-section">
        <h1 className="hero-title">
          Turn any photo into<br />
          <span className="hero-accent">words</span>
        </h1>
        <p className="hero-sub">
          Upload a portrait. Choose a word. Get a stunning typographic<br />
          mosaic where every detail is made of text.
        </p>
        <div className="hero-scroll">
          <a href="#main-controls" className="scroll-arrow">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
               <path d="M7 13l5 5 5-5M7 6l5 5 5-5"/>
            </svg>
          </a>
        </div>
      </section>

      {/* Main Controls */}
      <main id="main-controls" className="main-content">
        {/* Left: Upload */}
        <div className="panel upload-panel">
          <div className="panel-label">01 · UPLOAD</div>
          <div
            className={`drop-zone ${isDragging ? 'dragging' : ''} ${uploadedImage ? 'has-image' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => !uploadedImage && fileInputRef.current?.click()}
          >
            {uploadedImage ? (
              <>
                <img
                  src={uploadedImage}
                  alt="Uploaded preview"
                  className="upload-preview"
                />
                <button className="remove-image-btn" onClick={(e) => { e.stopPropagation(); handleReset() }}>
                  ✕ Remove
                </button>
              </>
            ) : (
              <div className="drop-placeholder">
                <div className="upload-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <p className="drop-title">Drop your photo here</p>
                <p className="drop-sub">or click to browse · PNG, JPG, WEBP</p>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </div>

        {/* Right: Customize */}
        <div className="panel customize-panel">
          <div className="panel-label">02 · CUSTOMIZE</div>
          <div className="controls-card">

            <div className="control-group">
              <label className="control-label" htmlFor="word-input">Your Word / Message</label>
              <textarea
                id="word-input"
                className="control-input"
                placeholder="Enter a word or a long sweet message..."
                value={word}
                onChange={(e) => setWord(e.target.value)}
                maxLength={1000}
                rows={3}
                style={{ resize: 'vertical', minHeight: '80px', lineHeight: '1.5' }}
              />
            </div>

            <div className="control-group">
              <label className="control-label">
                Detail Level
                <span className="control-value">{detailLevel}</span>
              </label>
              <input
                type="range"
                className="control-range"
                min="1"
                max="10"
                value={detailLevel}
                onChange={(e) => setDetailLevel(Number(e.target.value))}
              />
              <div className="range-labels">
                <span>Coarse</span>
                <span>Fine</span>
              </div>
            </div>

            <div className="control-group">
              <label className="control-label" htmlFor="color-mode-select">Color Mode</label>
              <select
                id="color-mode-select"
                className="control-select"
                value={colorMode}
                onChange={(e) => setColorMode(e.target.value)}
              >
                <option value="monochrome">Monochrome</option>
                <option value="color">Full Color</option>
                <option value="duotone">Duotone</option>
                <option value="neon">Neon Glow</option>
              </select>
            </div>

            <div className="control-group">
              <label className="control-label">
                Font Size
                <span className="control-value">{fontSize}px</span>
              </label>
              <input
                type="range"
                className="control-range"
                min="6"
                max="28"
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
              />
              <div className="range-labels">
                <span>Small</span>
                <span>Large</span>
              </div>
            </div>

            <div className="control-group">
              <label className="control-label" htmlFor="background-select">Background</label>
              <select
                id="background-select"
                className="control-select"
                value={background}
                onChange={(e) => setBackground(e.target.value)}
              >
                <option value="black">Black</option>
                <option value="white">White</option>
                <option value="dark-purple">Dark Purple</option>
              </select>
            </div>
          </div>
        </div>
      </main>

      {/* Generate Button */}
      <div className="generate-row">
        <button
          id="generate-btn"
          className={`generate-btn ${isGenerating ? 'generating' : ''}`}
          onClick={generateMosaic}
          disabled={!uploadedImage || !word.trim() || isGenerating}
        >
          {isGenerating ? (
            <>
              <svg className="spin-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
              Generating… {progress}%
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              Generate Mosaic
            </>
          )}
        </button>
      </div>

      {/* Progress bar */}
      {isGenerating && (
        <div className="progress-bar-wrapper">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* Result Canvas Container */}
      <section className="result-section">
        <div className="result-header">
          <h2 className="result-title">Your Typographic Portrait</h2>
          {isGenerated && (
            <button id="download-btn" className="download-btn" onClick={handleDownload}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download PNG
            </button>
          )}
        </div>
        <div className={`canvas-wrapper ${!isGenerated && !isGenerating ? 'empty' : ''}`}>
          {!isGenerated && !isGenerating && (
            <div className="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <p>Your generated mosaic will appear here.</p>
            </div>
          )}
          <canvas ref={canvasRef} className="result-canvas" style={{ display: (isGenerated || isGenerating) ? 'block' : 'none' }} />
          {isGenerating && (
            <div className="canvas-overlay">
              <div className="generating-pulse">Rendering mosaic…</div>
            </div>
          )}
        </div>
        {isGenerated && (
          <p className="result-hint">
            💡 Zoom in to see the words · Download to get full resolution
          </p>
        )}
      </section>

      {/* How it works */}
      <section id="how-it-works" className="how-section">
        <div className="how-step">
          <span className="how-num">01</span>
          <h3>Upload Photo</h3>
          <p>Drop any portrait or image — face, silhouette, or object.</p>
        </div>
        <div className="how-divider" />
        <div className="how-step">
          <span className="how-num">02</span>
          <h3>Choose Your Word</h3>
          <p>Type any word or phrase. It becomes the building block.</p>
        </div>
        <div className="how-divider" />
        <div className="how-step">
          <span className="how-num">03</span>
          <h3>Generate & Download</h3>
          <p>Get a stunning high-resolution typographic mosaic instantly.</p>
        </div>
      </section>

      <footer className="app-footer">
        <span>TextMosaic · Typographic Portraits</span>
        <br />
        <span className="dev-name">Design & Developer: Robert Hermoso</span>
      </footer>
    </div>
  )
}

export default App
