'use client'

import {
  AppWindow,
  BookOpen,
  Building2,
  Cctv,
  FileText,
  Globe,
  GraduationCap,
  Languages,
  LayoutDashboard,
  Lock,
  MonitorSmartphone,
  Network,
  Rocket,
  Shield,
  Smartphone,
  Stethoscope,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/** نگاشت نام آیکن frontmatter فصل‌ها به کامپوننت‌های lucide */
export const CHAPTER_ICONS: Record<string, LucideIcon> = {
  Shield,
  Network,
  BookOpen,
  Rocket,
  Smartphone,
  Building2,
  Globe,
  Wrench,
  Stethoscope,
  Lock,
  Languages,
  GraduationCap,
  Cctv,
  Zap,
  AppWindow,
  LayoutDashboard,
  MonitorSmartphone,
}

export function chapterIcon(name: string): LucideIcon {
  return CHAPTER_ICONS[name] ?? FileText
}

/** قالب‌بندی اعداد فارسی */
export function faNum(n: number): string {
  return new Intl.NumberFormat('fa-IR').format(n)
}
