'use client'

/**
 * رجیستری سکشن‌های کنسول — نقطهٔ اتصال واحد برای همهٔ بخش‌ها.
 *
 * 🔌 راهنمای عامل‌های ۶-ب / ۶-ج:
 *  - کامپوننت سکشن جدید را در همین پوشه بسازید (مثلاً users-section.tsx).
 *  - در SECTIONS برای بخش مربوطه، مقدار `Component` را با کامپوننت واقعی
 *    جایگزین کنید و `status` را به 'ready' و `owner` را به شناسهٔ خودتان
 *    تغییر دهید. هیچ فایل دیگری نباید دست بخورد.
 *  - سکشن‌های ready باید خودشان وضعیت اتصال را از useConnectionStore بخوانند
 *    و در حالت قطع، راهنمای «اول اتصال» نشان دهند.
 */

import type { ComponentType } from 'react'
import {
  BookOpenCheck,
  CircleHelp,
  CloudUpload,
  FileCode2,
  Gauge,
  KeyRound,
  MonitorSmartphone,
  Plug,
  Rocket,
  Route,
  ServerCog,
  ShieldCheck,
  Users,
  Waypoints,
} from 'lucide-react'
import type { SectionId } from '@/lib/nav'
import { DashboardSection } from './dashboard-section'
import { ConnectSection } from './connect-section'
import { HelpSection } from './help-section'
import { LearnSection } from '@/components/home/sections/learn-section'
import { PlaceholderSection } from './placeholder-section'
import { ConfigSection } from './config-section'
import { ServerSection } from './server-section'
import { BackupSection } from './backup-section'
import { ConsoleSection } from './console-section'
import { InstallSection } from './install-section'
import { UsersSection } from './users-section'
import { NodesSection } from './nodes-section'
import { KeysSection } from './keys-section'
import { RoutesSection } from './routes-section'
import { PolicySection } from './policy-section'

export type SectionGroup = 'core' | 'manage' | 'install' | 'server' | 'learn'

export interface SectionMeta {
  id: SectionId
  /** عنوان کامل فارسی */
  title: string
  /** برچسب کوتاه برای ناوبری */
  navLabel: string
  group: SectionGroup
  icon: ComponentType<{ className?: string }>
  /** عامل مالک فعلی این سکشن */
  owner: string
  /** ready = کامل | placeholder = در انتظار ۶-ب/۶-ج */
  status: 'ready' | 'placeholder'
  description: string
  capabilities: string[]
  Component: ComponentType
}

/** کارخانهٔ سکشن جای‌نگه‌دار */
function placeholder(meta: {
  id: SectionId
  title: string
  navLabel: string
  group: SectionGroup
  icon: ComponentType<{ className?: string }>
  owner: string
  description: string
  capabilities: string[]
}): SectionMeta {
  return {
    ...meta,
    status: 'placeholder',
    Component: () => <PlaceholderSection meta={meta} />,
  }
}

export const SECTIONS: SectionMeta[] = [
  // ───────────────────────── بخش‌های کامل (۶-الف) ─────────────────────────
  {
    id: 'dashboard',
    title: 'داشبورد',
    navLabel: 'داشبورد',
    group: 'core',
    icon: Gauge,
    owner: '6-a',
    status: 'ready',
    description: 'نمای کلی سرور، سلامت سه‌لایه، آمار واقعی و شروع سریع.',
    capabilities: [],
    Component: DashboardSection,
  },
  {
    id: 'connect',
    title: 'مرکز اتصال',
    navLabel: 'اتصال',
    group: 'core',
    icon: Plug,
    owner: '6-a',
    status: 'ready',
    description: 'مدیریت پروفایل‌های SSH و جریان امن اتصال دومرحله‌ای.',
    capabilities: [],
    Component: ConnectSection,
  },
  {
    id: 'learn',
    title: 'مرکز آموزش — ۱۴ فصل فارسی',
    navLabel: 'آموزش',
    group: 'learn',
    icon: BookOpenCheck,
    owner: '6-a',
    status: 'ready',
    description: 'دورهٔ کامل فارسی از «VPN چیست؟» تا پروژهٔ عملی.',
    capabilities: [],
    Component: LearnSection,
  },
  {
    id: 'help',
    title: 'راهنما و عیب‌یابی',
    navLabel: 'راهنما',
    group: 'learn',
    icon: CircleHelp,
    owner: '6-a',
    status: 'ready',
    description: 'عیب‌یابی ۱۴ خطای رایج، مرجع دستورات و چک‌لیست دوربین‌ها.',
    capabilities: [],
    Component: HelpSection,
  },

  // ───────────────────────── بخش‌های کامل (۶-ب) ─────────────────────────
  {
    id: 'install',
    title: 'نصب و راه‌اندازی Headscale',
    navLabel: 'نصب',
    group: 'install',
    icon: Rocket,
    owner: '6-b',
    status: 'ready',
    description:
      'ویزارد نصب خودکار Headscale روی سرور شما: آپلود مخزن نصب، پرسش تنظیمات (دامنه، DNS، گواهی HTTPS، فایروال)، پیش‌نمایش برنامهٔ ۱۷ گامی با Dry-Run بدون تغییر واقعی، و اجرای نهایی با خروجی زنده و honest.',
    capabilities: [],
    Component: InstallSection,
  },
  {
    id: 'users',
    title: 'مدیریت کاربران',
    navLabel: 'کاربران',
    group: 'manage',
    icon: Users,
    owner: '6-c',
    status: 'ready',
    description:
      'فهرست واقعی کاربران Headscale از سرور شما با ساخت، تغییر نام و حذف ایمن (با تأیید تایپی و نام واقعی).',
    capabilities: [],
    Component: UsersSection,
  },
  {
    id: 'nodes',
    title: 'مدیریت دستگاه‌ها',
    navLabel: 'دستگاه‌ها',
    group: 'manage',
    icon: MonitorSmartphone,
    owner: '6-c',
    status: 'ready',
    description:
      'دستگاه‌های متصل به شبکهٔ شما: وضعیت آنلاین/آفلاین/منقضی، آدرس IP، برچسب‌ها و عملیات مدیریت با تأیید صریح.',
    capabilities: [],
    Component: NodesSection,
  },
  {
    id: 'keys',
    title: 'کلیدهای احراز هویت',
    navLabel: 'کلیدها',
    group: 'manage',
    icon: KeyRound,
    owner: '6-c',
    status: 'ready',
    description:
      'ساخت و مدیریت PreAuthKey (برای عضوکردن دستگاه‌ها) و API Key — کلید کامل فقط یک‌بار در کارت امن نمایش داده می‌شود.',
    capabilities: [],
    Component: KeysSection,
  },
  {
    id: 'routes',
    title: 'مسیرها و Exit Node',
    navLabel: 'مسیرها',
    group: 'manage',
    icon: Route,
    owner: '6-c',
    status: 'ready',
    description:
      'مدیریت Subnet Router و Exit Node: تأیید مسیرهای اعلام‌شده توسط دستگاه‌ها و لغو آن‌ها — فقط مسیرهای واقعی.',
    capabilities: [],
    Component: RoutesSection,
  },
  {
    id: 'policy',
    title: 'سیاست دسترسی (ACL)',
    navLabel: 'سیاست دسترسی',
    group: 'manage',
    icon: ShieldCheck,
    owner: '6-c',
    status: 'ready',
    description:
      'ویرایش امن سیاست ACL شبکه: اعتبارسنجی واقعی روی سرور قبل از اعمال و تأیید صریح در پایان.',
    capabilities: [],
    Component: PolicySection,
  },
  {
    id: 'config',
    title: 'پیکربندی Headscale',
    navLabel: 'پیکربندی',
    group: 'server',
    icon: FileCode2,
    owner: '6-d',
    status: 'ready',
    description:
      'ویرایش فایل config.yaml سرور با ویرایشگر امن: configtest واقعی قبل از نوشتن، پشتیبان خودکار، ری‌استارت سرویس و بازگردانی خودکار در صورت شکست.',
    capabilities: [],
    Component: ConfigSection,
  },
  {
    id: 'server',
    title: 'سرور و لاگ',
    navLabel: 'سرور و لاگ',
    group: 'server',
    icon: ServerCog,
    owner: '6-d',
    status: 'ready',
    description:
      'وضعیت سرویس‌های headscale و caddy (با fallback صادقانهٔ فرایند)، لاگ زنده، پورت‌های باز، منابع و فایروال.',
    capabilities: [],
    Component: ServerSection,
  },
  {
    id: 'backup',
    title: 'پشتیبان، بازیابی و ارتقا',
    navLabel: 'پشتیبان و ارتقا',
    group: 'server',
    icon: CloudUpload,
    owner: '6-d',
    status: 'ready',
    description:
      'پشتیبان‌گیری کامل با راستی‌آزمایی per-file، بازیابی ایمن با تأیید تایپی، و ارتقای Headscale با خروجی زنده و بازگشت خودکار — یا توضیح صادقانهٔ «پس از نصب».',
    capabilities: [],
    Component: BackupSection,
  },
  {
    id: 'console',
    title: 'کنسول پیشرفته',
    navLabel: 'کنسول',
    group: 'server',
    icon: Waypoints,
    owner: '6-d',
    status: 'ready',
    description:
      'اجرای دستورهای مجاز (فهرست سفید امن) روی سرور: headscale، hsctl، journalctl، curl و… — بدون شل آزاد، با پیش‌نمایش دقیق پیش از اجرا.',
    capabilities: [],
    Component: ConsoleSection,
  },
]

/** نقشهٔ سریع id → متا */
export const SECTION_BY_ID: Record<SectionId, SectionMeta> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s])
) as Record<SectionId, SectionMeta>

/** گروه‌های ناوبری هدر */
export const NAV_GROUPS: { key: SectionGroup; label: string; items: SectionMeta[] }[] = [
  { key: 'core', label: 'اصلی', items: SECTIONS.filter((s) => s.group === 'core') },
  { key: 'manage', label: 'مدیریت', items: SECTIONS.filter((s) => s.group === 'manage') },
  { key: 'install', label: 'نصب', items: SECTIONS.filter((s) => s.group === 'install') },
  { key: 'server', label: 'سرور', items: SECTIONS.filter((s) => s.group === 'server') },
  { key: 'learn', label: 'آموزش', items: SECTIONS.filter((s) => s.group === 'learn') },
]
