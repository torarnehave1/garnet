import {
  AppWindow,
  BookOpen,
  Bot,
  Braces,
  Building2,
  Calendar,
  ChartLine,
  ChartPie,
  ChartScatter,
  Check,
  Clock,
  Code,
  Coins,
  CreditCard,
  Database,
  FileText,
  GraduationCap,
  Heading,
  Image,
  Info,
  Languages,
  LayoutGrid,
  Link,
  Lock,
  Mail,
  Map as MapIcon,
  MessagesSquare,
  Mic,
  Music,
  Newspaper,
  Play,
  Presentation,
  Quote,
  Route,
  ScanSearch,
  Sparkles,
  StickyNote,
  Tag,
  User,
  Waypoints,
  Video,
  Workflow,
  type IconNode,
} from 'lucide'

// One icon per node type, from Lucide (the icon set Knowledge Editor uses). A type that is not
// listed is drawn as a plain dot, as before.
const ICONS: Record<string, IconNode> = {
  'mermaid-diagram': Workflow,
  fulltext: FileText,
  info: Info,
  title: Heading,
  worknote: StickyNote,
  'wnote-node': StickyNote,
  'micro-story': BookOpen,
  'samtale-rapport': MessagesSquare,
  keyword: Tag,
  link: Link,
  imagequote: Quote,
  'youtube-video': Play,
  'youtube-live': Play,
  video: Video,
  'album-video': Play,
  'cloudflare-video': Video,
  'cloudflare-live': Video,
  'realtime-video': Video,
  audio: Music,
  'audio-portfolio-selector': Music,
  'audio-transcription': Mic,
  image: Image,
  'markdown-image': Image,
  'portfolio-image': Image,
  'image-analysis': ScanSearch,
  slideshow: Presentation,
  'html-node': AppWindow,
  'app-viewer': AppWindow,
  component: Code,
  'css-node': Code,
  'json-node': Braces,
  'data-node': Database,
  chart: ChartLine,
  linechart: ChartLine,
  piechart: ChartPie,
  bubblechart: ChartScatter,
  timeline: Clock,
  map: MapIcon,
  swot: LayoutGrid,
  oppgave: Check,
  flow: Route,
  'flow-step': Route,
  'flow-digest': Route,
  'agent-config': Bot,
  'agent-contract': Bot,
  'agent-run': Bot,
  'ai-prompt': Sparkles,
  kursbeskrivelse: GraduationCap,
  'kurs-steg': GraduationCap,
  kursmodul: GraduationCap,
  'kursmodul-2': GraduationCap,
  nyhetsbrev: Newspaper,
  'sanskrit-ord': Languages,
  kohesjon: Waypoints,
  'email-template': Mail,
  'email-manager': Mail,
  'email-signature': Mail,
  'email-brand': Mail,
  'person-profile': User,
  'company-card': Building2,
  innbetaling: Coins,
  'stripe-button': CreditCard,
  subscription: CreditCard,
  arrangement: Calendar,
  'arrangement-2': Calendar,
  'arrangement-3': Calendar,
  'password-protection': Lock,
}

const num = (v: string | number | undefined) => +(v ?? 0) || 0

// A Lucide icon (24 × 24, drawn as strokes) as one canvas path.
function toPath(icon: IconNode): Path2D {
  const p = new Path2D()
  for (const [tag, a] of icon) {
    if (tag === 'path') p.addPath(new Path2D(String(a.d || '')))
    else if (tag === 'circle') {
      p.moveTo(num(a.cx) + num(a.r), num(a.cy))
      p.arc(num(a.cx), num(a.cy), num(a.r), 0, Math.PI * 2)
    } else if (tag === 'ellipse') {
      p.moveTo(num(a.cx) + num(a.rx), num(a.cy))
      p.ellipse(num(a.cx), num(a.cy), num(a.rx), num(a.ry), 0, 0, Math.PI * 2)
    } else if (tag === 'rect') {
      const r = num(a.rx ?? a.ry)
      if (r && typeof p.roundRect === 'function') p.roundRect(num(a.x), num(a.y), num(a.width), num(a.height), r)
      else p.rect(num(a.x), num(a.y), num(a.width), num(a.height))
    } else if (tag === 'line') {
      p.moveTo(num(a.x1), num(a.y1))
      p.lineTo(num(a.x2), num(a.y2))
    } else if (tag === 'polyline' || tag === 'polygon') {
      const n = String(a.points || '')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
      for (let i = 0; i + 1 < n.length; i += 2) {
        if (i === 0) p.moveTo(n[i], n[i + 1])
        else p.lineTo(n[i], n[i + 1])
      }
      if (tag === 'polygon') p.closePath()
    }
  }
  return p
}

const paths = new Map<string, Path2D | null>()

/** The icon of a node type as a path in a 24 × 24 box, or null when the type has none. */
export function typeIcon(type: string): Path2D | null {
  let p = paths.get(type)
  if (p === undefined) {
    const icon = ICONS[type]
    p = icon ? toPath(icon) : null
    paths.set(type, p)
  }
  return p
}
