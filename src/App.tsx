import {
  useState, useEffect, useRef, useId,
  type CSSProperties,
} from 'react'

/* ────────────────────────────────────────────────────────────────────
   PALETTE
──────────────────────────────────────────────────────────────────── */
const P = {
  coffee:      '#4B2615',
  berkeley:    '#7F5E3C',
  mountain:    '#867679',
  mojave:      '#B9A583',
  almond:      '#D8C8B1',
  sage:        '#9EBD9B',
  muted_sage:  '#ACBDB7',
  deep_green:  '#4E635E',
  charcoal:    '#676D6B',
  pale_butter: '#ECE9BE',
  dusty_rose:  '#E8D1DC',
  dusty_pink:  '#D6B1BB',
  blue_gray:   '#9CABC8',
  pale_blue:   '#CFDBE7',
  cream:       '#F5F0E7',
  paper:       '#F7F3EA',
  ink:         '#2A2318',
  muted:       '#867679',
  warm_sand:   '#D8C6A0',
  notebook:    '#FAF8F1',
  rosewood:    '#8F5960',
}

/* ────────────────────────────────────────────────────────────────────
   HOOKS
──────────────────────────────────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add('visible'); obs.disconnect() } },
      { threshold: 0.12 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return ref
}

function useJourneyLine() {
  const ref = useRef<SVGPathElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add('drawn'); obs.disconnect() } },
      { threshold: 0.25 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return ref
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const update = () => setMatches(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [query])
  return matches
}

// Respects the OS "reduce motion" setting — gates the cursor, steam, and
// scroll parallax. CSS handles the rest (marquees, reveals, journey line).
const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)')
// Touch devices get the native cursor — a synthetic one has nothing to track.
const useIsCoarsePointer     = () => useMediaQuery('(pointer: coarse)')

// Tiny scroll-linked offset for the hero's paper layers — each layer reads
// this with its own small multiplier so they drift at slightly different
// rates. Disabled entirely under reduced motion.
function useScrollY(): number {
  const reduceMotion = usePrefersReducedMotion()
  const [y, setY] = useState(0)
  useEffect(() => {
    if (reduceMotion) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setY(window.scrollY))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [reduceMotion])
  return reduceMotion ? 0 : y
}

/* ────────────────────────────────────────────────────────────────────
   CUSTOM CURSOR — a small, quiet dot with a short fading trail that
   drifts through the palette. Pure DOM refs + canvas, zero React state
   per frame: mousemove only writes to plain variables, and a single
   rAF loop reads them, so nothing here triggers a re-render.
──────────────────────────────────────────────────────────────────── */
function lerpHex(a: string, b: string, t: number): string {
  const h = (s: string) => [parseInt(s.slice(1,3),16), parseInt(s.slice(3,5),16), parseInt(s.slice(5,7),16)]
  const [ar,ag,ab] = h(a), [br,bg,bb] = h(b)
  return `rgb(${Math.round(ar+(br-ar)*t)},${Math.round(ag+(bg-ag)*t)},${Math.round(ab+(bb-ab)*t)})`
}
function paletteAt(t: number): string {
  const stops = [P.rosewood, P.dusty_pink, P.muted_sage, P.almond]
  const span = t * (stops.length - 1)
  const i = Math.min(Math.floor(span), stops.length - 2)
  return lerpHex(stops[i], stops[i + 1], span - i)
}

function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduceMotion = usePrefersReducedMotion()
  const coarsePointer = useIsCoarsePointer()
  const disabled = reduceMotion || coarsePointer

  useEffect(() => {
    if (disabled) return
    const dot = dotRef.current, canvas = canvasRef.current
    if (!dot || !canvas) return
    const ctx = canvas.getContext('2d')!
    let W = window.innerWidth, H = window.innerHeight
    canvas.width = W; canvas.height = H
    const onResize = () => { W = window.innerWidth; H = window.innerHeight; canvas.width = W; canvas.height = H }
    window.addEventListener('resize', onResize)

    let mx = -100, my = -100 // raw pointer target
    let px = -100, py = -100 // eased visual position — the "slightly magical" lag
    let active = false

    const onMove = (e: MouseEvent) => { mx = e.clientX; my = e.clientY; active = true }
    document.addEventListener('mousemove', onMove)

    // Hover reaction on interactive elements — plain classList toggling,
    // no React state, so it costs nothing beyond a CSS transition.
    const onOver = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('a, button')) dot.classList.add('cursor-hover')
    }
    const onOut = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('a, button')) dot.classList.remove('cursor-hover')
    }
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)

    type Pt = { x: number; y: number; age: number }
    const trail: Pt[] = []
    const MAX_AGE = 15

    let raf = 0
    const tick = () => {
      px += (mx - px) * 0.22
      py += (my - py) * 0.22
      if (active) dot.style.transform = `translate(${px}px, ${py}px)`

      trail.push({ x: px, y: py, age: 0 })
      ctx.clearRect(0, 0, W, H)
      for (let i = trail.length - 1; i >= 0; i--) {
        const p = trail[i]
        p.age++
        if (p.age > MAX_AGE) { trail.splice(i, 1); continue }
        const t = p.age / MAX_AGE
        ctx.globalAlpha = (1 - t) * 0.22
        ctx.fillStyle = paletteAt(t)
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2.6 * (1 - t * 0.6), 0, Math.PI * 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(raf)
    }
  }, [disabled])

  if (disabled) return null

  return (
    <>
      <canvas ref={canvasRef} id="cursor-canvas" aria-hidden="true" />
      <div ref={dotRef} aria-hidden="true" className="cursor-dot" style={{
        position: 'fixed', top: 0, left: 0, pointerEvents: 'none', zIndex: 9999, willChange: 'transform',
      }}>
        <div className="cursor-core" style={{
          width: 9, height: 9, borderRadius: '50%',
          background: P.rosewood,
          boxShadow: `0 0 7px ${P.dusty_pink}88`,
        }} />
      </div>
    </>
  )
}

/* ────────────────────────────────────────────────────────────────────
   SIGNATURE STAR MOTIF
──────────────────────────────────────────────────────────────────── */
function StarMark({
  size = 9, color = P.mojave, rotate = 0, spin = false,
}: { size?: number; color?: string; rotate?: number; spin?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true"
      style={{ display: 'inline-block', transform: `rotate(${rotate}deg)`, flexShrink: 0 }}
      className={spin ? 'star-spin' : ''}>
      <line x1="5" y1="0.6" x2="5" y2="9.4" stroke={color} strokeWidth="1.1" strokeLinecap="round"/>
      <line x1="0.6" y1="5" x2="9.4" y2="5" stroke={color} strokeWidth="1.1" strokeLinecap="round"/>
      <line x1="1.6" y1="1.6" x2="8.4" y2="8.4" stroke={color} strokeWidth="0.85" strokeLinecap="round"/>
      <line x1="8.4" y1="1.6" x2="1.6" y2="8.4" stroke={color} strokeWidth="0.85" strokeLinecap="round"/>
    </svg>
  )
}

/* ────────────────────────────────────────────────────────────────────
   SECTION LABEL
──────────────────────────────────────────────────────────────────── */
function Label({ idx, text }: { idx: string; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <StarMark size={7} color={P.mojave} rotate={22} />
      <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.62rem', color: P.muted, letterSpacing: '0.12em' }}>
        {idx} / {text}
      </span>
      <div style={{ width: 36, height: 1, background: P.almond }} />
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────
   HERO HEADLINE — the site's main visual statement. "Hi, I'm" arrives
   as a fast, editorial character reveal (no blinking cursor — just
   opacity + a small settle, ~350ms total across the phrase); "Aditi."
   follows with a soft fade + horizontal drift. Whole thing lands in
   about a second, then holds still as a big, confident poster headline.
──────────────────────────────────────────────────────────────────── */
const HI_IM_CHARS = "Hi, I’m".split('')

function HeroHeadline() {
  return (
    <h1 style={{ margin: 0, lineHeight: 0.88, display: 'flex', flexDirection: 'column' }}>
      <span style={{
        fontFamily: 'DM Sans, sans-serif', fontWeight: 700,
        fontSize: 'clamp(2.4rem, 6vw, 6rem)', color: P.ink, letterSpacing: '-0.025em',
      }}>
        {HI_IM_CHARS.map((ch, i) => (
          <span key={i} className="char-reveal" style={{ display: 'inline-block', animationDelay: `${220 + i * 30}ms` }}>
            {ch === ' ' ? ' ' : ch}
          </span>
        ))}
      </span>
      <span className="anim-fade-drift delay-500" style={{ display: 'inline-block', marginTop: 4 }}>
        <span style={{
          fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontWeight: 300,
          fontSize: 'clamp(3.6rem, 9vw, 8.2rem)', letterSpacing: '-0.02em',
          textShadow: '1px 2px 3px rgba(42,35,24,0.16)',
          WebkitTextStroke: '0.5px rgba(42,35,24,0.28)',
          background: `linear-gradient(115deg, ${P.dusty_pink} 0%, ${P.almond} 50%, ${P.muted_sage} 100%)`,
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>Aditi.</span>
      </span>
    </h1>
  )
}

/* ────────────────────────────────────────────────────────────────────
   TECH LOGOS
──────────────────────────────────────────────────────────────────── */
function TechLogo({ name, color }: { name: string; color: string }) {
  const s: CSSProperties = { display: 'block' }
  switch (name) {
    case 'React':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <ellipse cx="30" cy="30" rx="27" ry="10" stroke={color} strokeWidth="1.8"/>
        <ellipse cx="30" cy="30" rx="27" ry="10" stroke={color} strokeWidth="1.8" transform="rotate(60 30 30)"/>
        <ellipse cx="30" cy="30" rx="27" ry="10" stroke={color} strokeWidth="1.8" transform="rotate(120 30 30)"/>
        <circle cx="30" cy="30" r="3.5" fill={color}/>
      </svg>)
    case 'Python':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <path d="M30 8 C22 8 16 13 16 21 L16 26 L44 26 L44 30 L16 30 L16 40 C16 48 22 52 30 52 C38 52 44 47 44 40 L44 34 L16 34 L16 30" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
        <circle cx="23" cy="20" r="2.5" fill={color}/>
        <circle cx="37" cy="40" r="2.5" fill={color}/>
      </svg>)
    case 'TypeScript':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} aria-hidden="true">
        <rect x="8" y="8" width="44" height="44" rx="7" fill={color} opacity="0.15"/>
        <text x="30" y="39" textAnchor="middle" fontFamily="JetBrains Mono" fontWeight="700" fontSize="20" fill={color}>TS</text>
      </svg>)
    case 'JavaScript':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} aria-hidden="true">
        <rect x="8" y="8" width="44" height="44" rx="7" fill={color} opacity="0.2"/>
        <text x="30" y="39" textAnchor="middle" fontFamily="JetBrains Mono" fontWeight="700" fontSize="20" fill={color}>JS</text>
      </svg>)
    case 'C++':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} aria-hidden="true">
        <text x="8" y="37" fontFamily="JetBrains Mono" fontWeight="700" fontSize="19" fill={color}>C++</text>
        <line x1="8" y1="43" x2="40" y2="43" stroke={color} strokeWidth="1.2" opacity="0.35"/>
      </svg>)
    case 'Java':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <path d="M24 14 Q30 8 36 14 L36 36 Q36 44 30 48 Q24 44 24 36 Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
        <path d="M18 52 Q30 47 42 52" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
      </svg>)
    case 'Node.js':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <path d="M30 10 L48 20 L48 40 L30 50 L12 40 L12 20 Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
        <path d="M30 22 L30 38" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
        <circle cx="30" cy="30" r="3" fill={color}/>
      </svg>)
    case 'FastAPI':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <circle cx="30" cy="30" r="20" stroke={color} strokeWidth="1.8"/>
        <path d="M30 14 L24 30 L30 30 L24 46" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>)
    case 'MongoDB':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <path d="M30 8 Q39 20 39 33 Q39 45 30 52 Q21 45 21 33 Q21 20 30 8 Z" stroke={color} strokeWidth="1.8"/>
        <line x1="30" y1="40" x2="30" y2="54" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
      </svg>)
    case 'PostgreSQL':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <ellipse cx="30" cy="18" rx="18" ry="8" stroke={color} strokeWidth="1.8"/>
        <path d="M12 18 L12 38 Q12 50 30 50 Q48 50 48 38 L48 18" stroke={color} strokeWidth="1.8"/>
        <line x1="30" y1="10" x2="30" y2="50" stroke={color} strokeWidth="1.2" opacity="0.35"/>
      </svg>)
    case 'MySQL':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <path d="M12 20 L12 40 Q12 48 30 48" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M48 20 L48 28 Q48 36 36 40" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
        <ellipse cx="30" cy="20" rx="18" ry="7" stroke={color} strokeWidth="1.8"/>
      </svg>)
    case 'Express':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} aria-hidden="true">
        <text x="7" y="33" fontFamily="JetBrains Mono" fontSize="11" fontWeight="500" fill={color} letterSpacing="1">exp</text>
        <path d="M7 40 Q20 36 33 40 Q46 44 53 40" stroke={color} strokeWidth="1.3" fill="none" strokeLinecap="round"/>
      </svg>)
    case 'Git':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <circle cx="18" cy="18" r="5" stroke={color} strokeWidth="1.8"/>
        <circle cx="42" cy="18" r="5" stroke={color} strokeWidth="1.8"/>
        <circle cx="18" cy="44" r="5" stroke={color} strokeWidth="1.8"/>
        <line x1="18" y1="23" x2="18" y2="39" stroke={color} strokeWidth="1.8"/>
        <path d="M23 18 Q30 18 30 26 L30 44 L37 44" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>)
    case 'React Native':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <rect x="18" y="6" width="24" height="48" rx="6" stroke={color} strokeWidth="1.8"/>
        <line x1="18" y1="14" x2="42" y2="14" stroke={color} strokeWidth="1.4" opacity="0.5"/>
        <line x1="18" y1="46" x2="42" y2="46" stroke={color} strokeWidth="1.4" opacity="0.5"/>
        <ellipse cx="30" cy="30" rx="13" ry="5.5" stroke={color} strokeWidth="1.4" transform="rotate(30 30 30)"/>
        <ellipse cx="30" cy="30" rx="13" ry="5.5" stroke={color} strokeWidth="1.4" transform="rotate(-30 30 30)"/>
        <circle cx="30" cy="30" r="2.6" fill={color}/>
      </svg>)
    case 'ChromaDB':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <circle cx="24" cy="24" r="13" stroke={color} strokeWidth="1.6" opacity="0.8"/>
        <circle cx="38" cy="24" r="13" stroke={color} strokeWidth="1.6" opacity="0.8"/>
        <circle cx="31" cy="38" r="13" stroke={color} strokeWidth="1.6" opacity="0.8"/>
      </svg>)
    case 'LangGraph':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <circle cx="15" cy="16" r="6" stroke={color} strokeWidth="1.6"/>
        <circle cx="45" cy="16" r="6" stroke={color} strokeWidth="1.6"/>
        <circle cx="30" cy="34" r="7" stroke={color} strokeWidth="1.6"/>
        <circle cx="15" cy="50" r="5" stroke={color} strokeWidth="1.6"/>
        <circle cx="45" cy="50" r="5" stroke={color} strokeWidth="1.6"/>
        <path d="M19 20 L26 29 M41 20 L34 29 M25 39 L18 46 M35 39 L42 46" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
      </svg>)
    case 'WebSocket':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <path d="M12 22 Q30 10 48 22" stroke={color} strokeWidth="1.7" strokeLinecap="round"/>
        <path d="M42 17 L48 22 L42 27" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M48 38 Q30 50 12 38" stroke={color} strokeWidth="1.7" strokeLinecap="round"/>
        <path d="M18 33 L12 38 L18 43" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>)
    case 'Tailwind':
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} fill="none" aria-hidden="true">
        <path d="M10 24 Q15 14 25 14 Q35 14 38 22 Q34 16 27 19 Q20 22 17 28 Q14 34 8 32 Q11 26 10 24 Z" fill={color} opacity="0.18"/>
        <path d="M10 24 Q15 14 25 14 Q35 14 38 22 Q34 16 27 19 Q20 22 17 28 Q14 34 8 32" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M22 38 Q27 28 37 28 Q47 28 50 36 Q46 30 39 33 Q32 36 29 42 Q26 48 20 46 Q23 40 22 38 Z" fill={color} opacity="0.18"/>
        <path d="M22 38 Q27 28 37 28 Q47 28 50 36 Q46 30 39 33 Q32 36 29 42 Q26 48 20 46" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>)
    default:
      return (<svg viewBox="0 0 60 60" width="34" height="34" style={s} aria-hidden="true">
        <text x="30" y="36" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="13" fontWeight="500" fill={color}>{name.slice(0,3)}</text>
      </svg>)
  }
}

/* ────────────────────────────────────────────────────────────────────
   NAVBAR
──────────────────────────────────────────────────────────────────── */
function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 24)
    window.addEventListener('scroll', h)
    return () => window.removeEventListener('scroll', h)
  }, [])
  return (
    <header>
      <nav className="fixed top-4 left-1/2 z-50 anim-fade delay-200"
        style={{ transform: 'translateX(-50%)', width: 'min(920px, calc(100vw - 2rem))' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 20px', borderRadius: 14,
          background: scrolled ? 'rgba(247,243,234,0.98)' : 'rgba(247,243,234,0.9)',
          border: `1px solid rgba(135,118,102,${scrolled ? '0.2' : '0.12'})`,
          boxShadow: scrolled ? '0 4px 18px rgba(75,38,21,0.08)' : '0 2px 10px rgba(75,38,21,0.04)',
          backdropFilter: 'blur(6px)', transition: 'all 0.3s ease',
        }}>
          <span style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontWeight: 300, fontSize: '1.1rem', color: P.coffee }}>
            aditi.
          </span>
          <div className="hidden md:flex items-center gap-5">
            {['Home','About','Projects','Skills','Journey','Contact'].map(l => (
              <a key={l} href={`#${l.toLowerCase()}`} className="nav-link"
                style={{ fontSize: '0.82rem', fontWeight: 500, color: P.ink, opacity: 0.62, textDecoration: 'none', transition: 'opacity 0.2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.62' }}
              >{l}</a>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: P.sage, display: 'inline-block', boxShadow: `0 0 6px ${P.sage}` }} />
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.62rem', color: P.muted, letterSpacing: '0.03em' }}>available for internships</span>
          </div>
        </div>
      </nav>
    </header>
  )
}

/* ────────────────────────────────────────────────────────────────────
   HERO NOTEBOOK — a physical paper note, not a UI card. Fixed slight
   rotation (no pointer tracking), real code, no motivational text.
──────────────────────────────────────────────────────────────────── */
function NotebookSketch() {
  const [hov, setHov] = useState(false)
  return (
    <div className="note-settle">
      <div role="img" aria-label="A small paper note with a code snippet, sitting slightly rotated on the desk, with a folded corner and a v1.2 tag"
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{
          transform: hov ? 'rotate(1.1deg) translateY(-3px)' : 'rotate(0deg)',
          transition: 'transform 0.45s cubic-bezier(0.22,1,0.36,1)',
        }}>
        <div style={{
          background: P.notebook, borderRadius: '9px 12px 10px 11px',
          border: '1.5px solid rgba(135,118,102,0.16)',
          padding: '26px 28px 28px', width: 330,
          boxShadow: hov
            ? '5px 12px 32px rgba(75,38,21,0.13), 0 1px 3px rgba(75,38,21,0.06)'
            : '4px 9px 26px rgba(75,38,21,0.1), 0 1px 3px rgba(75,38,21,0.05)',
          transition: 'box-shadow 0.45s ease',
          position: 'relative',
          backgroundImage: 'linear-gradient(rgba(135,118,102,0.048) 1px, transparent 1px)',
          backgroundSize: '100% 28px', backgroundPositionY: '48px',
        }}>
          {/* Folded corner */}
          <div aria-hidden="true" style={{
            position: 'absolute', top: 0, right: 0, width: 0, height: 0,
            borderStyle: 'solid', borderWidth: '0 20px 20px 0',
            borderColor: `transparent ${P.almond} transparent transparent`,
            opacity: 0.55, filter: 'drop-shadow(-1px 1px 1.5px rgba(75,38,21,0.1))',
          }} />
          {/* Margin line */}
          <div style={{ position: 'absolute', left: 46, top: 0, bottom: 0, width: 1, background: 'rgba(214,177,187,0.48)' }} />
          {/* Tape — two pieces, two pastel tones */}
          <div style={{ position: 'absolute', top: 4, left: -10, width: 50, height: 11, background: 'rgba(236,233,190,0.62)', borderRadius: 2, transform: 'rotate(-6deg)', boxShadow: 'inset 0 0 4px rgba(0,0,0,0.04)' }} />
          <div style={{ position: 'absolute', bottom: 40, right: -8, width: 34, height: 10, background: 'rgba(232,209,220,0.55)', borderRadius: 2, transform: 'rotate(8deg)', boxShadow: 'inset 0 0 3px rgba(0,0,0,0.04)' }} />
          {/* Punched holes */}
          <div style={{ position: 'absolute', left: 14, top: '30%', width: 7, height: 7, borderRadius: '50%', border: '1px solid rgba(135,118,102,0.2)', background: 'rgba(247,243,234,0.8)' }} />
          <div style={{ position: 'absolute', left: 14, top: '62%', width: 7, height: 7, borderRadius: '50%', border: '1px solid rgba(135,118,102,0.2)', background: 'rgba(247,243,234,0.8)' }} />

          <div style={{ paddingLeft: 26, fontFamily: 'JetBrains Mono', fontSize: '0.76rem', lineHeight: 2 }}>
            <div style={{ color: P.sage }}>{'// task pipeline'}</div>
            {[
              { name: 'idea',    val: 'curiosity;' },
              { name: 'problem', val: 'solve(idea);' },
              { name: 'result',  val: 'ship(problem);' },
            ].map(({ name, val }) => (
              <div key={name}>
                <span style={{ color: P.coffee }}>const </span>
                <span style={{ color: P.ink }}>{name}</span>
                <span style={{ color: P.blue_gray }}>{' = '}</span>
                <span style={{ color: P.dusty_rose }}>{val}</span>
              </div>
            ))}
            <div style={{ marginTop: 7, color: P.sage }}>{'// TODO: refactor this'}</div>
            <div><span style={{ color: P.coffee }}>while </span><span style={{ color: P.almond }}>{'(!done) {'}</span></div>
            <div style={{ paddingLeft: 16 }}>
              <div><span style={{ color: P.dusty_rose }}>{'build();'}</span></div>
              <div><span style={{ color: P.dusty_rose }}>{'test();'}</span></div>
              <div><span style={{ color: P.dusty_rose }}>{'debug();'}</span></div>
            </div>
            <div style={{ color: P.almond }}>{'}'}</div>
            <div style={{ marginTop: 7 }}>
              <span style={{ color: P.mojave }}>{'> '}</span>
              <span className="cursor-blink" style={{ color: P.deep_green }}>▌</span>
            </div>
          </div>

          {/* Version tag — bottom-left, clear of the coffee cup at bottom-right */}
          <div style={{ position: 'absolute', bottom: 12, left: 30, display: 'flex', alignItems: 'center', gap: 5 }}>
            <StarMark size={7} color={P.dusty_rose} rotate={12} />
            <span style={{ fontFamily: 'Caveat', fontSize: '0.82rem', color: P.mountain, opacity: 0.75 }}>v1.2</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────
   COFFEE CUP — small, hand-drawn, sits beside the note. Gentle steam.
──────────────────────────────────────────────────────────────────── */
function CoffeeCup() {
  const gid = useId()
  return (
    <svg aria-hidden="true" width="52" height="52" viewBox="0 0 52 52" fill="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={P.cream}/>
          <stop offset="100%" stopColor={P.sage}/>
        </linearGradient>
      </defs>
      <path className="steam" style={{ animationDelay: '0s' }}   d="M18 15 Q16 11 18 7"  stroke={`url(#${gid})`} strokeWidth="1.2" strokeLinecap="round"/>
      <path className="steam" style={{ animationDelay: '0.9s' }} d="M25 15 Q27 10 24 6"  stroke={`url(#${gid})`} strokeWidth="1.2" strokeLinecap="round"/>
      <path className="steam" style={{ animationDelay: '1.8s' }} d="M32 15 Q30 11 32 7"  stroke={`url(#${gid})`} strokeWidth="1.2" strokeLinecap="round"/>
      <ellipse cx="25" cy="43" rx="19" ry="3.4" fill={P.almond} opacity="0.45"/>
      {/* Rounder, cuter mug body — a soft bulging barrel instead of a trapezoid */}
      <path d="M11.5 21 Q10.5 33 14 37 Q18.5 40.5 25 40.5 Q31.5 40.5 36 37 Q39.5 33 38.5 21 Z" fill={P.cream} stroke={P.coffee} strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M37.5 24 Q47 22.5 46.5 30 Q46 36.5 37 34.5" stroke={P.coffee} strokeWidth="1.4" fill="none" strokeLinecap="round"/>
      <ellipse cx="25" cy="21" rx="13.5" ry="2.6" fill={P.coffee} opacity="0.82"/>
    </svg>
  )
}

/* ────────────────────────────────────────────────────────────────────
   COLOR WASH — a large, soft, irregular watercolor-like tint. Purely
   atmospheric: sits behind everything, never reads as a UI shape.
──────────────────────────────────────────────────────────────────── */
function ColorWash({ color, size, style }: { color: string; size: number; style: CSSProperties }) {
  return (
    <div aria-hidden="true" style={{
      position: 'absolute', width: size, height: size,
      background: `radial-gradient(circle, ${color}70 0%, ${color}38 45%, transparent 72%)`,
      borderRadius: '42% 58% 65% 35% / 45% 40% 60% 55%',
      filter: 'blur(28px)',
      pointerEvents: 'none', willChange: 'transform',
      ...style,
    }} />
  )
}

/* ────────────────────────────────────────────────────────────────────
   HERO
──────────────────────────────────────────────────────────────────── */
function Hero() {
  const scrollY = useScrollY()
  const drift = (factor: number, max: number) => Math.min(scrollY * factor, max)

  return (
    <section id="home"
      className="graph-paper relative min-h-screen flex items-center pt-28 pb-20 overflow-hidden">
      {/* Soft pastel washes — large, confidently visible fields of colour
          rather than 5%-opacity accents. This IS the palette showing up. */}
      <ColorWash color={P.dusty_rose}  size={440} style={{ left: '0%', top: '8%', transform: `translateY(${drift(0.02, 10)}px)` }} />
      <ColorWash color={P.sage}        size={400} style={{ right: '4%', top: '22%', transform: `translateY(${drift(0.025, 12)}px)` }} />
      <ColorWash color={P.pale_butter} size={280} style={{ right: '0%', bottom: '8%', transform: `translateY(${drift(0.015, 8)}px)` }} />
      <ColorWash color={P.blue_gray}   size={340} style={{ left: '6%', bottom: '2%', transform: `translateY(${drift(0.02, 10)}px)` }} />
      <ColorWash color={P.dusty_pink}  size={300} style={{ left: '30%', top: '0%', transform: `translateY(${drift(0.018, 9)}px)` }} />
      <ColorWash color={P.pale_blue}   size={260} style={{ right: '28%', bottom: '0%', transform: `translateY(${drift(0.022, 11)}px)` }} />

      <div className="relative z-10 w-full max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <div className="anim-fade delay-100"><Label idx="01" text="INTRODUCTION" /></div>

            <HeroHeadline />

            <p className="anim-fade-up delay-800" style={{ color: P.charcoal, fontSize: '1.2rem', lineHeight: 1.6, marginTop: 22, maxWidth: 440 }}>
              Computer Science student building full-stack applications,<br />
              AI-powered systems, and things that make me curious.
            </p>
            <div className="anim-fade-up delay-1000 flex flex-wrap gap-3 mt-8">
              <a href="#projects" className="btn-mag" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: P.coffee, color: '#FDF8F2',
                padding: '11px 22px', borderRadius: 8,
                fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: '0.78rem', letterSpacing: '0.05em',
                textDecoration: 'none', transition: 'background 0.22s ease, transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = P.deep_green }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = P.coffee }}
              >VIEW MY WORK →</a>
              <a href="#contact" className="btn-mag" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: P.cream, color: P.coffee,
                padding: '11px 22px', borderRadius: 8,
                fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: '0.78rem', letterSpacing: '0.05em',
                textDecoration: 'none', border: `1.5px solid rgba(75,38,21,0.2)`,
                transition: 'background 0.2s, border-color 0.2s, transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
              }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = P.almond; el.style.borderColor = 'rgba(75,38,21,0.38)' }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = P.cream; el.style.borderColor = 'rgba(75,38,21,0.2)' }}
              >LET'S CONNECT →</a>
            </div>
          </div>
          <div className="anim-fade delay-700 hidden md:flex justify-center items-center">
            <div style={{ position: 'relative', width: 380, height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* Paper layers — the note and cup sit among these, not beside them */}
              <div aria-hidden="true" style={{
                position: 'absolute', left: -10, top: 26,
                width: 220, height: 160, borderRadius: 10,
                background: 'linear-gradient(135deg, #EEF7EE, #DFF0DF)',
                border: '1px solid rgba(158,189,155,0.35)',
                transform: `rotate(-6deg) translateY(${drift(0.05, 12)}px)`,
              }} />
              <div aria-hidden="true" style={{
                position: 'absolute', right: -14, top: 10,
                width: 86, height: 56, borderRadius: 7,
                background: 'linear-gradient(135deg, #FDF6F8, #F5EAEF)',
                border: '1px solid rgba(214,177,187,0.4)',
                transform: `rotate(10deg) translateY(${drift(0.04, 10)}px)`,
              }} />
              <div style={{ transform: `translateY(${drift(0.08, 16)}px)` }}>
                <NotebookSketch />
              </div>
              <div style={{ position: 'absolute', right: 4, bottom: -10, transform: `rotate(-4deg) translateY(${drift(0.03, 8)}px)` }}>
                <CoffeeCup />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="hidden md:block anim-fade delay-1200" aria-hidden="true"
        style={{ position: 'absolute', left: '50%', bottom: 26, transform: 'translateX(-50%)' }}>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.68rem', color: P.mountain, opacity: 0.6 }}>
          {'// scroll to explore '}
        </span>
        <span className="scroll-arrow" style={{ fontFamily: 'JetBrains Mono', fontSize: '0.68rem', color: P.dusty_pink, opacity: 0.75, display: 'inline-block' }}>↓</span>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────
   PROJECT SKETCHES
──────────────────────────────────────────────────────────────────── */
function SkillSwapSketch({ hov }: { hov: boolean }) {
  return (
    <svg viewBox="0 0 160 88" width="160" height="88" fill="none" role="img"
      aria-label="Sketch of two people linked by dashed lines, exchanging skills to learn and teach"
      style={{ opacity: hov ? 1 : 0.52, transition: 'opacity 0.3s, transform 0.3s', transform: hov ? 'scale(1.04)' : 'scale(1)' }}>
      <circle cx="28" cy="44" r="15" stroke={P.dusty_pink} strokeWidth="1.4"/>
      <circle cx="132" cy="44" r="15" stroke={P.mojave} strokeWidth="1.4"/>
      <circle cx="80" cy="22" r="11" stroke={P.deep_green} strokeWidth="1.4"/>
      <path d="M43 44 L68 44" stroke={P.almond} strokeWidth="1.1" strokeDasharray="4 3"/>
      <path d="M92 44 L117 44" stroke={P.almond} strokeWidth="1.1" strokeDasharray="4 3"/>
      <path d="M43 40 L72 27" stroke={P.almond} strokeWidth="1.1" strokeDasharray="4 3"/>
      <path d="M88 27 L117 41" stroke={P.almond} strokeWidth="1.1" strokeDasharray="4 3"/>
      <text x="21" y="48" fontFamily="Caveat" fontSize="8.5" fill={P.dusty_pink}>learn</text>
      <text x="118" y="48" fontFamily="Caveat" fontSize="8.5" fill={P.mojave}>teach</text>
      <text x="68" y="27" fontFamily="Caveat" fontSize="8.5" fill={P.deep_green}>you</text>
      <path d="M70 68 Q80 64 90 68" stroke={P.mountain} strokeWidth="0.9" strokeLinecap="round" strokeDasharray="3 2"/>
      <text x="70" y="79" fontFamily="Caveat" fontSize="7" fill={P.charcoal}>// edge case?</text>
    </svg>
  )
}

function VeritySketch({ hov }: { hov: boolean }) {
  return (
    <svg viewBox="0 0 160 88" width="160" height="88" fill="none" role="img"
      aria-label="Sketch of a barcode next to a price tag showing a discounted price"
      style={{ opacity: hov ? 1 : 0.52, transition: 'opacity 0.3s, transform 0.3s', transform: hov ? 'scale(1.04)' : 'scale(1)' }}>
      {[20,24,29,32,37,40,44,48,52,55,59,62].map((x, i) => (
        <rect key={i} x={x} y={18} width={i % 3 === 0 ? 3 : 1.5} height={48} fill={P.deep_green} opacity={0.65}/>
      ))}
      <text x="28" y="78" fontFamily="JetBrains Mono" fontSize="6.5" fill={P.mountain} letterSpacing="2">4901234</text>
      <path d="M88 26 L132 26 L146 44 L132 62 L88 62 Z" stroke={P.sage} strokeWidth="1.4"/>
      <circle cx="94" cy="33" r="3" stroke={P.sage} strokeWidth="1.1"/>
      <text x="102" y="46" fontFamily="Caveat" fontSize="13" fill={P.deep_green}>₹449</text>
      <text x="102" y="57" fontFamily="Caveat" fontSize="8.5" fill={P.mountain}>↓ from ₹699</text>
      <path d="M68 44 L83 44" stroke={P.almond} strokeWidth="1.3" strokeDasharray="3 2"/>
      <path d="M79 41 L85 44 L79 47" fill={P.almond}/>
    </svg>
  )
}

function SafeGridSketch({ hov }: { hov: boolean }) {
  return (
    <svg viewBox="0 0 160 88" width="160" height="88" fill="none" role="img"
      aria-label="Sketch of a central risk-orchestrator node correlating IoT, SCADA, permit, and log data"
      style={{ opacity: hov ? 1 : 0.52, transition: 'opacity 0.3s, transform 0.3s', transform: hov ? 'scale(1.04)' : 'scale(1)' }}>
      <rect x="8"   y="14" width="28" height="17" rx="3" stroke={P.sage}       strokeWidth="1.3"/>
      <rect x="8"   y="57" width="28" height="17" rx="3" stroke={P.dusty_pink} strokeWidth="1.3"/>
      <rect x="124" y="14" width="28" height="17" rx="3" stroke={P.mojave}     strokeWidth="1.3"/>
      <rect x="124" y="57" width="28" height="17" rx="3" stroke={P.mountain}   strokeWidth="1.3"/>
      <circle cx="80" cy="44" r="15" stroke={P.blue_gray} strokeWidth="1.5"/>
      <path d="M36 25 L66 38" stroke={P.almond} strokeWidth="1.1" strokeDasharray="3 2"/>
      <path d="M36 63 L66 50" stroke={P.almond} strokeWidth="1.1" strokeDasharray="3 2"/>
      <path d="M94 38 L124 25" stroke={P.almond} strokeWidth="1.1" strokeDasharray="3 2"/>
      <path d="M94 50 L124 63" stroke={P.almond} strokeWidth="1.1" strokeDasharray="3 2"/>
      <text x="12" y="26" fontFamily="Caveat" fontSize="7.5" fill={P.sage}>IoT</text>
      <text x="12" y="69" fontFamily="Caveat" fontSize="7.5" fill={P.dusty_pink}>permits</text>
      <text x="128" y="26" fontFamily="Caveat" fontSize="7.5" fill={P.mojave}>SCADA</text>
      <text x="128" y="69" fontFamily="Caveat" fontSize="7.5" fill={P.mountain}>logs</text>
      <text x="71" y="47" fontFamily="Caveat" fontSize="8.5" fill={P.blue_gray}>risk</text>
      {hov && <circle cx="80" cy="44" r="20" stroke={P.blue_gray} strokeWidth="0.8" opacity="0.35"/>}
    </svg>
  )
}

/* ────────────────────────────────────────────────────────────────────
   PROJECTS
──────────────────────────────────────────────────────────────────── */
const PROJECTS = [
  {
    num: '01', name: 'SkillSwap',
    desc: 'Full-stack MERN platform for peer-to-peer skill exchange, with skill-based matching and real-time messaging.',
    tech: ['React', 'Node.js', 'MongoDB', 'Express'],
    cardBg: 'linear-gradient(145deg, #FDF6F8 0%, #F3E9D8 100%)',
    borderColor: 'rgba(214,177,187,0.55)',
    accentColor: P.dusty_pink,
    accentText: P.berkeley,
    Sketch: SkillSwapSketch,
  },
  {
    num: '02', name: 'Verity',
    desc: 'Cross-platform mobile app for barcode lookup, price comparison, and price-history tracking.',
    tech: ['React Native', 'TypeScript', 'FastAPI', 'PostgreSQL'],
    cardBg: 'linear-gradient(145deg, #F5F8E8 0%, #E9F0D0 100%)',
    borderColor: 'rgba(158,189,155,0.5)',
    accentColor: P.sage,
    accentText: P.deep_green,
    Sketch: VeritySketch,
  },
  {
    num: '03', name: 'Safe Grid',
    desc: 'Six-agent LangGraph system that correlates IoT and safety data to surface industrial risks, with a live digital-twin dashboard.',
    tech: ['Python', 'LangGraph', 'React', 'FastAPI'],
    cardBg: 'linear-gradient(145deg, #EEF4FA 0%, #E6F2E8 100%)',
    borderColor: 'rgba(156,171,200,0.45)',
    accentColor: P.blue_gray,
    accentText: P.deep_green,
    Sketch: SafeGridSketch,
  },
]

function ProjectCard({ p, index }: { p: typeof PROJECTS[0]; index: number }) {
  const [hov, setHov] = useState(false)
  const ref = useReveal()
  const Sketch = p.Sketch
  return (
    <div ref={ref} className="reveal" style={{ transitionDelay: `${index * 100}ms` }}>
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? p.cardBg : '#FFFEF9',
        border: `1.5px solid ${hov ? p.borderColor : 'rgba(135,118,102,0.1)'}`,
        borderRadius: 14, padding: '26px 22px',
        transform: hov ? 'translateY(-6px)' : 'none',
        boxShadow: hov ? '0 18px 50px rgba(75,38,21,0.08)' : '0 2px 8px rgba(75,38,21,0.03)',
        transition: 'all 0.32s cubic-bezier(0.22,1,0.36,1)',
        display: 'flex', flexDirection: 'column',
        position: 'relative', overflow: 'hidden',
      }}>
      <div style={{ height: 2, borderRadius: 4, marginBottom: 18, background: p.accentColor, width: hov ? '100%' : '26%', transition: 'width 0.4s ease' }} />
      <div aria-hidden="true" style={{ position: 'absolute', top: 18, right: 18, transform: hov ? 'rotate(45deg)' : 'rotate(0deg)', transition: 'transform 0.4s ease' }}>
        <StarMark size={8} color={p.accentColor} rotate={0} />
      </div>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: '0.6rem', color: P.muted, letterSpacing: '0.1em', marginBottom: 8 }}>{p.num} — PROJECT</div>
      <h3 className="pastel-hl" style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 700, fontSize: '1.3rem', color: P.ink, letterSpacing: '-0.02em', marginBottom: 10 }}>{p.name}</h3>
      <p style={{ color: P.charcoal, fontSize: '0.84rem', lineHeight: 1.65, marginBottom: 18, flex: 1 }}>{p.desc}</p>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16, transform: hov ? 'translate(2px, -2px)' : 'none', transition: 'transform 0.35s cubic-bezier(0.22,1,0.36,1)' }}>
        <Sketch hov={hov} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {p.tech.map(t => (
            <span key={t} style={{ fontSize: '0.64rem', color: p.accentText, padding: '3px 8px', background: `${p.accentColor}18`, borderRadius: 5, fontFamily: 'JetBrains Mono' }}>{t}</span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {['GitHub','Live'].map(l => (
            <a key={l} href="#"
              aria-label={l === 'GitHub' ? `View ${p.name} source on GitHub` : `View live demo of ${p.name}`}
              style={{ fontSize: '0.64rem', color: P.muted, padding: '3px 8px', border: '1px solid rgba(135,118,102,0.18)', borderRadius: 5, textDecoration: 'none', fontFamily: 'JetBrains Mono', transition: 'color 0.2s, border-color 0.2s' }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = P.ink; el.style.borderColor = 'rgba(135,118,102,0.4)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = P.muted; el.style.borderColor = 'rgba(135,118,102,0.18)' }}
            >{l}</a>
          ))}
        </div>
      </div>
    </div>
    </div>
  )
}

function Projects() {
  const ref = useReveal()
  return (
    <section id="projects" className="graph-paper py-24 px-6 relative">
      <div className="max-w-6xl mx-auto">
        <div ref={ref} className="reveal">
          <Label idx="02" text="SELECTED WORK" />
          <h2 style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontWeight: 300, fontSize: 'clamp(2rem,5vw,3.4rem)', color: P.ink, letterSpacing: '-0.02em', marginBottom: 44 }}>
            things I've built.
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
          {PROJECTS.map((p, i) => <ProjectCard key={p.num} p={p} index={i} />)}
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────
   SKILLS — full palette tile colors
──────────────────────────────────────────────────────────────────── */
const ROW1 = [
  { name: 'Python',       cat: 'LANGUAGE',  tileBg: 'linear-gradient(135deg,#FCFBEA,#F5F2D2)', logoColor: P.pale_butter, num: '01' },
  { name: 'C++',          cat: 'LANGUAGE',  tileBg: 'linear-gradient(135deg,#FBF0F4,#F4E4EB)', logoColor: P.dusty_rose, num: '02' },
  { name: 'Java',         cat: 'LANGUAGE',  tileBg: 'linear-gradient(135deg,#FAF5EE,#F2E8DA)', logoColor: P.almond,     num: '03' },
  { name: 'JavaScript',   cat: 'LANGUAGE',  tileBg: 'linear-gradient(135deg,#F8F3E6,#F0E7D0)', logoColor: P.warm_sand,  num: '04' },
  { name: 'TypeScript',   cat: 'LANGUAGE',  tileBg: 'linear-gradient(135deg,#EEF7EE,#DFF0DF)', logoColor: P.sage,       num: '05' },
  { name: 'React',        cat: 'FRONTEND',  tileBg: 'linear-gradient(135deg,#EEF4FA,#DDE9F6)', logoColor: P.blue_gray,  num: '06' },
  { name: 'React Native', cat: 'FRONTEND',  tileBg: 'linear-gradient(135deg,#FDF6F8,#F5EAEF)', logoColor: P.dusty_pink, num: '07' },
  { name: 'Node.js',      cat: 'BACKEND',   tileBg: 'linear-gradient(135deg,#EAF2EC,#D8EADB)', logoColor: P.deep_green, num: '08' },
  { name: 'Git',          cat: 'TOOL',      tileBg: 'linear-gradient(135deg,#F5EDE6,#EBDFD2)', logoColor: P.coffee,     num: '09' },
]
const ROW2 = [
  { name: 'Express',      cat: 'BACKEND',   tileBg: 'linear-gradient(135deg,#F7F1E8,#EEE4D4)', logoColor: P.berkeley,    num: '10' },
  { name: 'FastAPI',      cat: 'BACKEND',   tileBg: 'linear-gradient(135deg,#EDF6F3,#DCF0E9)', logoColor: P.muted_sage,  num: '11' },
  { name: 'MongoDB',      cat: 'DATABASE',  tileBg: 'linear-gradient(135deg,#EEF7EE,#DFF0DF)', logoColor: P.sage,        num: '12' },
  { name: 'PostgreSQL',   cat: 'DATABASE',  tileBg: 'linear-gradient(135deg,#EEF4FA,#DDE9F6)', logoColor: P.blue_gray,   num: '13' },
  { name: 'MySQL',        cat: 'DATABASE',  tileBg: 'linear-gradient(135deg,#F8F3E9,#EFE6D6)', logoColor: P.mojave,      num: '14' },
  { name: 'ChromaDB',     cat: 'AI / DATA', tileBg: 'linear-gradient(135deg,#F0F5FA,#E3EDF5)', logoColor: P.pale_blue,   num: '15' },
  { name: 'LangGraph',    cat: 'AI / DATA', tileBg: 'linear-gradient(135deg,#FDF6F8,#F5EAEF)', logoColor: P.dusty_pink,  num: '16' },
  { name: 'WebSocket',    cat: 'TOOL',      tileBg: 'linear-gradient(135deg,#EFF1F0,#E1E5E2)', logoColor: P.charcoal,    num: '17' },
  { name: 'Tailwind',     cat: 'TOOL',      tileBg: 'linear-gradient(135deg,#EAF2EC,#D8EADB)', logoColor: P.deep_green,  num: '18' },
]

function SkillTile({ t }: { t: typeof ROW1[0] }) {
  const [hov, setHov] = useState(false)
  return (
    <div className="skill-tile"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 144,
        background: hov ? t.tileBg : '#FFFEF9',
        border: `1.5px solid rgba(135,118,102,${hov ? '0.18' : '0.08'})`,
        borderRadius: 12, padding: '18px 14px 14px', margin: '0 8px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
        boxShadow: hov ? `0 14px 36px rgba(75,38,21,0.09), 0 0 0 1.5px ${t.logoColor}1A` : '0 1px 5px rgba(75,38,21,0.03)',
        position: 'relative', overflow: 'hidden',
      }}>
      <span aria-hidden="true" style={{ position: 'absolute', top: 8, left: 10, fontFamily: 'JetBrains Mono', fontSize: '0.5rem', color: `${t.logoColor}55`, letterSpacing: '0.05em' }}>{t.num}</span>
      <div aria-hidden="true" style={{ position: 'absolute', bottom: -12, right: -12, width: 42, height: 42, borderRadius: '50%', border: `1.5px solid ${t.logoColor}`, opacity: hov ? 0.3 : 0.07, transform: hov ? 'scale(1.3)' : 'scale(1)', transition: 'opacity 0.3s, transform 0.3s' }} />
      <div style={{ transform: hov ? 'scale(1.12)' : 'scale(1)', transition: 'transform 0.3s ease' }}>
        <TechLogo name={t.name} color={t.logoColor} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 700, fontSize: '0.82rem', color: P.ink }}>{t.name}</div>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: '0.5rem', color: P.muted, letterSpacing: '0.1em', marginTop: 3 }}>{t.cat}</div>
      </div>
    </div>
  )
}

function Skills() {
  const ref = useReveal()
  return (
    <section id="skills" className="py-24 overflow-hidden graph-paper-alt">
      <div className="max-w-6xl mx-auto px-6">
        <div ref={ref} className="reveal">
          <Label idx="03" text="TOOLBOX" />
          <h2 style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontWeight: 300, fontSize: 'clamp(2rem,5vw,3.4rem)', color: P.ink, letterSpacing: '-0.02em', marginBottom: 44 }}>
            things I build with.
          </h2>
        </div>
      </div>
      <div aria-hidden="true" style={{ overflow: 'hidden', marginBottom: 14, padding: '6px 0' }}>
        <div className="marquee-fwd" style={{ display: 'flex', alignItems: 'stretch' }}>
          {[...ROW1, ...ROW1].map((t, i) => <SkillTile key={i} t={t} />)}
        </div>
      </div>
      <div aria-hidden="true" style={{ overflow: 'hidden', padding: '6px 0' }}>
        <div className="marquee-rev" style={{ display: 'flex', alignItems: 'stretch' }}>
          {[...ROW2, ...ROW2].map((t, i) => <SkillTile key={i} t={t} />)}
        </div>
      </div>
      <p className="sr-only">
        Toolbox: {[...ROW1, ...ROW2].map(t => t.name).join(', ')}.
      </p>
      <div className="max-w-6xl mx-auto px-6 mt-10 flex items-center gap-3">
        <span style={{ fontFamily: 'Caveat', fontSize: '0.95rem', color: P.mountain }}>// still learning, always curious</span>
        <svg viewBox="0 0 30 10" width="30" height="10" fill="none" aria-hidden="true">
          <path d="M2 5 Q12 2 22 5 Q26 6 28 5" stroke={P.muted_sage} strokeWidth="1.2" strokeLinecap="round"/>
          <path d="M24 2 L28 5 L24 8" stroke={P.muted_sage} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────
   ABOUT — info cards with distinct gradient colors (not brown)
──────────────────────────────────────────────────────────────────── */
const INFO_CARDS = [
  { label: 'EDUCATION', items: ['B.E. Computer Science', 'BMS College of Engineering'], bg: 'linear-gradient(135deg,#FAF5EE,#F2E8DA)', rotate: '-0.4deg', dot: P.mojave },
  { label: 'FOCUS',     items: ['Agentic AI', 'Full-Stack Systems', 'LLM Engineering'], bg: 'linear-gradient(135deg,#EEF7EE,#DFF0DF)', rotate: '0.5deg',  dot: P.sage },
  { label: 'INTERESTS', items: ['Building things', 'Breaking things', 'Fixing them'],   bg: 'linear-gradient(135deg,#FBF0F4,#F4E4EB)', rotate: '-0.3deg', dot: P.dusty_pink },
  { label: 'CURRENTLY', items: ['Building Safe Grid', 'Google GenAI Academy'],          bg: 'linear-gradient(135deg,#EEF4FA,#DDE9F6)', rotate: '0.4deg',  dot: P.blue_gray },
]

function About() {
  const ref = useReveal()
  return (
    <section id="about" className="graph-paper py-24 px-6 relative">
      <div className="max-w-6xl mx-auto">
        <div ref={ref} className="reveal"><Label idx="04" text="ABOUT" /></div>
        <div className="grid md:grid-cols-2 gap-16 items-start mt-8">
          <div>
            <h2 style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontWeight: 300, fontSize: 'clamp(1.7rem,4vw,2.6rem)', color: P.ink, lineHeight: 1.3, letterSpacing: '-0.02em', marginBottom: 20 }}>
              I like understanding<br />how things work —<br />and then building them.
            </h2>
            <p style={{ color: P.charcoal, lineHeight: 1.8, fontSize: '0.92rem', maxWidth: 400 }}>
              I'm Aditi, a CS student with a bias for building. Lately that means agentic AI —
              multi-agent systems, RAG, and LLMs that reason over real data — but I go toward
              anything that rewards curiosity, from a tricky algorithm to a full-stack app.
              I believe software should be both{' '}
              <span style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: P.ink }}>useful</span>{' '}
              and{' '}
              <span style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: P.ink }}>beautiful</span>.
            </p>
            <div style={{ marginTop: 22, padding: '12px 16px', border: '1px solid rgba(172,189,183,0.4)', borderRadius: 8, background: 'linear-gradient(135deg,#EEF6EE,#E4EFE4)', position: 'relative' }}>
              <div aria-hidden="true" style={{ position: 'absolute', top: -6, left: 14, width: 42, height: 10, background: 'rgba(236,233,190,0.72)', borderRadius: 2, transform: 'rotate(-2deg)' }} />
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: '0.68rem', color: P.deep_green }}>{'// B.E. CS · Year 3 · Bengaluru'}</div>
              <div style={{ fontFamily: 'Caveat', fontSize: '0.88rem', color: P.mountain, marginTop: 4 }}>open to internships + interesting problems</div>
            </div>
            <div style={{ marginTop: 24 }}>
              <svg viewBox="0 0 200 16" width="200" height="16" fill="none" aria-hidden="true">
                <path d="M4 11 Q40 7 80 10 Q120 13 160 8 Q180 6 196 10" stroke={P.almond} strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {INFO_CARDS.map((card, i) => (
              <div key={card.label} style={{
                background: card.bg,
                border: '1.5px solid rgba(135,118,102,0.1)',
                borderRadius: 11, padding: '16px 14px',
                transform: `rotate(${card.rotate})`,
                position: 'relative',
              }}>
                <div aria-hidden="true" style={{ position: 'absolute', top: 8, right: 10 }}>
                  <StarMark size={6} color={card.dot} rotate={i * 22} />
                </div>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: '0.58rem', color: P.muted, letterSpacing: '0.1em', marginBottom: 10 }}>{card.label}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {card.items.map(item => (
                    <div key={item} style={{ fontSize: '0.8rem', color: P.ink, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div aria-hidden="true" style={{ width: 3, height: 3, borderRadius: '50%', background: card.dot, flexShrink: 0 }} />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────
   JOURNEY — palette nodes
──────────────────────────────────────────────────────────────────── */
const TIMELINE = [
  { year: '2024', tag: 'LEARNING', desc: 'Foundations: data structures, algorithms, first real projects. A lot of things breaking.', color: P.sage },
  { year: '2025', tag: 'BUILDING', desc: 'Full-stack apps, AI experiments, open source contributions, learning to ship.',            color: P.dusty_rose },
  { year: '2026', tag: 'SHIPPING', desc: 'Real products. Verity, Safe Grid, an agentic notification router — and more on the way.', color: P.warm_sand },
  { year: 'NEXT', tag: '?',        desc: 'Internships, collaborations, and whatever interesting problem finds me next.',               color: P.blue_gray },
]

function Journey() {
  const ref = useReveal()
  const lineRef = useJourneyLine()
  return (
    <section id="journey" className="py-24 px-6 graph-paper-alt">
      <div className="max-w-6xl mx-auto">
        <div ref={ref} className="reveal">
          <Label idx="05" text="JOURNEY" />
          <h2 style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontWeight: 300, fontSize: 'clamp(2rem,5vw,3.4rem)', color: P.ink, letterSpacing: '-0.02em', marginBottom: 52 }}>
            where I've been.
          </h2>
        </div>
        <div style={{ position: 'relative', paddingLeft: 34 }}>
          <svg aria-hidden="true" style={{ position: 'absolute', left: 8, top: 8, width: 6, height: 'calc(100% - 16px)', overflow: 'visible' }}
            viewBox="0 0 6 600" preserveAspectRatio="none">
            <path ref={lineRef} d="M3 0 Q4 80 2 160 Q4 240 3 320 Q2 400 4 480 Q3 540 3 600"
              stroke={P.berkeley} strokeWidth="1.5" fill="none" className="journey-line" strokeLinecap="round"/>
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 44 }}>
            {TIMELINE.map((t, i) => (
              <div key={t.year} style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 22 }}>
                <div aria-hidden="true" style={{ position: 'absolute', left: -34, top: 6, width: 12, height: 12, borderRadius: '50%', background: t.color, border: '2px solid #EDE8DD', boxShadow: `0 0 10px ${t.color}88`, zIndex: 2 }} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 7 }}>
                    <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 500, fontSize: '1.05rem', color: P.ink }}>{t.year}</span>
                    <span style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 700, fontSize: '0.7rem', letterSpacing: '0.09em', color: t.color, padding: '2px 9px', background: `${t.color}22`, borderRadius: 20 }}>{t.tag}</span>
                    {t.year === 'NEXT' && <span style={{ fontFamily: 'Caveat', fontSize: '0.9rem', color: P.mountain }}>↩ TBD</span>}
                    {i === 2 && <span style={{ fontFamily: 'Caveat', fontSize: '0.82rem', color: P.muted }}>this one was fun</span>}
                  </div>
                  <p style={{ color: P.charcoal, fontSize: '0.88rem', lineHeight: 1.65, maxWidth: 460 }}>{t.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────
   CONTACT
──────────────────────────────────────────────────────────────────── */
function Contact() {
  const ref = useReveal()
  return (
    <section id="contact" className="graph-paper py-28 px-6 relative overflow-hidden">
      <div aria-hidden="true" style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%,-50%)', width: 520, height: 380, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(172,189,183,0.08) 0%, rgba(232,209,220,0.05) 40%, transparent 68%)', pointerEvents: 'none' }} />
      <div className="max-w-5xl mx-auto relative z-10">
        <div ref={ref} className="reveal text-center">
          <Label idx="06" text="CONTACT" />
          <h2 style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: 700, fontSize: 'clamp(2.6rem,7vw,5.5rem)', color: P.ink, letterSpacing: '-0.04em', lineHeight: 0.9, marginTop: 14, marginBottom: 20 }}>
            LET'S BUILD<br />
            <span style={{
              fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontWeight: 300, letterSpacing: '-0.02em',
              textShadow: '1px 2px 3px rgba(42,35,24,0.16)',
              WebkitTextStroke: '0.5px rgba(42,35,24,0.28)',
              background: `linear-gradient(115deg, ${P.dusty_pink} 0%, ${P.almond} 50%, ${P.muted_sage} 100%)`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>SOMETHING</span><br />
            INTERESTING.
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 28 }}>
            <span style={{ fontFamily: 'Caveat', fontSize: '1.05rem', color: P.muted_sage }}>open to internships + collaborations</span>
            <svg viewBox="0 0 20 10" width="20" height="10" fill="none" aria-hidden="true">
              <path d="M2 5 Q10 2 17 5" stroke={P.muted_sage} strokeWidth="1.1" strokeLinecap="round"/>
              <path d="M13 2 L17 5 L13 8" stroke={P.muted_sage} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 52 }}>
            {[
              { label: 'GitHub',   href: 'https://github.com/pixel-pudding' },
              { label: 'LinkedIn', href: 'https://linkedin.com/in/aditi-anand' },
              { label: 'Email',    href: 'mailto:aditianandkumar@gmail.com' },
            ].map(({ label, href }) => (
              <a key={label} href={href} className="btn-mag" style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '10px 22px', borderRadius: 9,
                border: '1.5px solid rgba(135,118,102,0.18)',
                color: P.ink, fontSize: '0.82rem', fontWeight: 500,
                letterSpacing: '0.04em', textDecoration: 'none',
                background: '#FFFEF9', transition: 'all 0.22s ease',
              }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = P.deep_green; el.style.background = '#EEF6EE' }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'rgba(135,118,102,0.18)'; el.style.background = '#FFFEF9' }}
              >{label} →</a>
            ))}
          </div>
          <div style={{ display: 'inline-block', background: P.ink, color: P.pale_butter, borderRadius: 9, padding: '11px 18px', fontFamily: 'JetBrains Mono', fontSize: '0.7rem' }}>
            {'$ echo "let\'s build something"'}
            <span className="cursor-blink" aria-hidden="true" style={{ color: P.sage, marginLeft: 4 }}>▌</span>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────
   FOOTER
──────────────────────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="graph-paper" style={{ borderTop: '1px solid rgba(135,118,102,0.12)', padding: '24px' }}>
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <StarMark size={8} color={P.mojave} rotate={0} spin />
          <span style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontWeight: 300, fontSize: '1.05rem', color: P.coffee }}>aditi.</span>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'Caveat', fontSize: '0.92rem', color: P.muted }}>made with curiosity.</div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: '0.57rem', color: P.muted, marginTop: 2, letterSpacing: '0.05em' }}>C++ · React · Python · AI</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: P.sage, display: 'inline-block', boxShadow: `0 0 5px ${P.sage}` }} />
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.57rem', color: P.muted, letterSpacing: '0.07em' }}>ONLINE</span>
          </div>
          <a href="#home" className="nav-link" style={{ fontFamily: 'JetBrains Mono', fontSize: '0.57rem', color: P.muted, letterSpacing: '0.07em', textDecoration: 'none' }}>
            BACK TO TOP ↑
          </a>
        </div>
      </div>
    </footer>
  )
}

/* ────────────────────────────────────────────────────────────────────
   ROOT
──────────────────────────────────────────────────────────────────── */
export default function App() {
  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif', background: P.paper }}>
      <CustomCursor />
      <Navbar />
      <main>
        <Hero />
        <Projects />
        <Skills />
        <About />
        <Journey />
        <Contact />
      </main>
      <Footer />
    </div>
  )
}
