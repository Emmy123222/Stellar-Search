/// <reference types="vite/client" />

declare module '*.css' {
  const content: string
  export default content
}

declare module 'lucide-react' {
  import * as React from 'react'
  export interface LucideProps extends React.SVGProps<SVGSVGElement> {
    size?: string | number
    color?: string
    strokeWidth?: string | number
    className?: string
  }
  export type LucideIcon = React.ForwardRefExoticComponent<
    LucideProps & React.RefAttributes<SVGSVGElement>
  >
  export const Activity: LucideIcon
  export const AlertCircle: LucideIcon
  export const AlertTriangle: LucideIcon
  export const ArrowDown: LucideIcon
  export const ArrowRight: LucideIcon
  export const ArrowUp: LucideIcon
  export const BarChart2: LucideIcon
  export const BookOpen: LucideIcon
  export const Bookmark: LucideIcon
  export const Bot: LucideIcon
  export const Calendar: LucideIcon
  export const Check: LucideIcon
  export const CheckCheck: LucideIcon
  export const CheckCircle2: LucideIcon
  export const ChevronDown: LucideIcon
  export const ChevronRight: LucideIcon
  export const Circle: LucideIcon
  export const Clock: LucideIcon
  export const Coins: LucideIcon
  export const Copy: LucideIcon
  export const Download: LucideIcon
  export const ExternalLink: LucideIcon
  export const FileJson: LucideIcon
  export const FileSpreadsheet: LucideIcon
  export const GitBranch: LucideIcon
  export const Github: LucideIcon
  export const Globe: LucideIcon
  export const HelpCircle: LucideIcon
  export const History: LucideIcon
  export const Image: LucideIcon
  export const Info: LucideIcon
  export const Loader2: LucideIcon
  export const LogOut: LucideIcon
  export const Newspaper: LucideIcon
  export const RefreshCw: LucideIcon
  export const Search: LucideIcon
  export const Send: LucideIcon
  export const Server: LucideIcon
  export const Shield: LucideIcon
  export const ShieldAlert: LucideIcon
  export const ShieldCheck: LucideIcon
  export const Sparkles: LucideIcon
  export const Star: LucideIcon
  export const Tag: LucideIcon
  export const Trash2: LucideIcon
  export const TrendingUp: LucideIcon
  export const Wallet: LucideIcon
  export const X: LucideIcon
  export const Zap: LucideIcon
}
