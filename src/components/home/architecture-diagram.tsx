'use client'

import { motion } from 'framer-motion'

/**
 * دیاگرام معماری متحرک:
 * مسیر کنترل (emerald) از VPS عبور می‌کند؛ مسیر داده (amber) معمولاً مستقیم بین
 * دستگاه‌هاست (رمزنگاری‌شده با WireGuard) — با خطوط چین متحرک نمایش داده می‌شود.
 */

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <svg width="34" height="8" aria-hidden>
          <line
            x1="0"
            y1="4"
            x2="34"
            y2="4"
            strokeWidth="2.5"
            strokeDasharray="5 4"
            className="stroke-emerald-500"
          />
        </svg>
        مسیر کنترل — هماهنگی اتصال‌ها (از VPS)
      </span>
      <span className="inline-flex items-center gap-2">
        <svg width="34" height="8" aria-hidden>
          <line
            x1="0"
            y1="4"
            x2="34"
            y2="4"
            strokeWidth="2.5"
            strokeDasharray="5 4"
            className="stroke-amber-500"
          />
        </svg>
        مسیر داده — مستقیم بین دستگاه‌ها (WireGuard)
      </span>
    </div>
  )
}

function ServerIcon({ x, y }: { x: number; y: number }) {
  return (
    <g className="stroke-emerald-600 dark:stroke-emerald-400" strokeWidth="2" fill="none">
      <rect x={x} y={y} width="26" height="10" rx="2.5" />
      <rect x={x} y={y + 14} width="26" height="10" rx="2.5" />
      <circle cx={x + 5.5} cy={y + 5} r="1.2" fill="currentColor" className="fill-emerald-600 dark:fill-emerald-400" stroke="none" />
      <circle cx={x + 5.5} cy={y + 19} r="1.2" fill="currentColor" className="fill-emerald-600 dark:fill-emerald-400" stroke="none" />
    </g>
  )
}

function PhoneIcon({ x, y }: { x: number; y: number }) {
  return (
    <g className="stroke-foreground/80" strokeWidth="2" fill="none">
      <rect x={x} y={y} width="13" height="22" rx="3" />
      <path d={`M ${x + 4.5} ${y + 18.5} h 4`} strokeLinecap="round" />
    </g>
  )
}

function LaptopIcon({ x, y }: { x: number; y: number }) {
  return (
    <g className="stroke-foreground/80" strokeWidth="2" fill="none">
      <rect x={x} y={y} width="22" height="14" rx="2" />
      <path d={`M ${x - 3} ${y + 18} h 28`} strokeLinecap="round" />
    </g>
  )
}

function BuildingIcon({ x, y }: { x: number; y: number }) {
  return (
    <g className="stroke-foreground/80" strokeWidth="2" fill="none">
      <rect x={x} y={y} width="24" height="20" rx="2" />
      <path d={`M ${x + 6} ${y + 20} v 4 M ${x + 18} ${y + 20} v 4 M ${x + 2} ${y + 24} h 20`} strokeLinecap="round" />
      <path d={`M ${x + 7} ${y + 5} h 4 M ${x + 13} ${y + 5} h 4 M ${x + 7} ${y + 10} h 4 M ${x + 13} ${y + 10} h 4`} strokeWidth="1.4" />
    </g>
  )
}

/** نسخهٔ دسکتاپ */
function DesktopDiagram() {
  return (
    <svg
      viewBox="0 0 880 470"
      className="h-auto w-full"
      role="img"
      aria-label="دیاگرام معماری شبکه: گوشی و لپ‌تاپ از طریق مسیر کنترل به VPS و از طریق مسیر داده مستقیماً به شبکه دفتر وصل می‌شوند"
    >
      <defs>
        <marker id="arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 8 5 L 0 9 z" className="fill-emerald-500" />
        </marker>
        <marker id="arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 8 5 L 0 9 z" className="fill-amber-500" />
        </marker>
      </defs>

      {/* خطوط مسیر کنترل — emerald */}
      <line x1="655" y1="100" x2="562" y2="100" strokeWidth="2.5" className="animated-dash stroke-emerald-500" markerEnd="url(#arrow-emerald)" />
      <path d="M 655 255 C 600 250, 585 210, 560 165" fill="none" strokeWidth="2.5" className="animated-dash stroke-emerald-500" markerEnd="url(#arrow-emerald)" />
      <text x="608" y="78" textAnchor="middle" className="fill-emerald-600 dark:fill-emerald-400" fontSize="13" fontWeight="700">
        مسیر کنترل
      </text>
      <text x="628" y="235" textAnchor="middle" className="fill-emerald-600 dark:fill-emerald-400" fontSize="12">
        هماهنگی اتصال‌ها
      </text>

      {/* خط مسیر داده — amber (مستقیم، بدون عبور از VPS) */}
      <path d="M 735 150 C 790 300, 640 430, 425 395" fill="none" strokeWidth="2.5" className="animated-dash stroke-amber-500" markerEnd="url(#arrow-amber)" />
      <text x="700" y="345" textAnchor="middle" className="fill-amber-600 dark:fill-amber-400" fontSize="13" fontWeight="700">
        مسیر داده — مستقیم و رمزنگاری‌شده
      </text>
      <text x="700" y="365" textAnchor="middle" className="fill-amber-600/80 dark:fill-amber-400/80" fontSize="11.5">
        (معمولاً بدون عبور از VPS)
      </text>

      {/* جعبهٔ VPS */}
      <g>
        <rect x="330" y="45" width="225" height="125" rx="16" className="fill-card stroke-emerald-500/50" strokeWidth="1.6" />
        <ServerIcon x={429} y={58} />
        <text x="442" y="102" textAnchor="middle" className="fill-foreground" fontSize="15" fontWeight="800">
          VPS شما
        </text>
        <text x="442" y="124" textAnchor="middle" className="fill-muted-foreground" fontSize="12">
          Headscale + Caddy
        </text>
        <text x="442" y="145" textAnchor="middle" className="fill-muted-foreground" fontSize="10.5">
          هماهنگ‌کنندهٔ شبکه (Control Plane)
        </text>
      </g>

      {/* گوشی */}
      <g>
        <rect x="655" y="45" width="135" height="110" rx="16" className="fill-card stroke-border" strokeWidth="1.6" />
        <PhoneIcon x={716} y={62} />
        <text x="722" y="112" textAnchor="middle" className="fill-foreground" fontSize="13.5" fontWeight="700">
          گوشی
        </text>
        <text x="722" y="132" textAnchor="middle" className="fill-muted-foreground" fontSize="10">
          هر جای دنیا
        </text>
      </g>

      {/* لپ‌تاپ */}
      <g>
        <rect x="655" y="205" width="135" height="105" rx="16" className="fill-card stroke-border" strokeWidth="1.6" />
        <LaptopIcon x={711} y={224} />
        <text x="722" y="270" textAnchor="middle" className="fill-foreground" fontSize="13.5" fontWeight="700">
          لپ‌تاپ
        </text>
        <text x="722" y="290" textAnchor="middle" className="fill-muted-foreground" fontSize="10">
          خانه یا سفر
        </text>
      </g>

      {/* شبکهٔ دفتر */}
      <g>
        <rect x="70" y="305" width="350" height="150" rx="16" className="fill-card stroke-amber-500/40" strokeWidth="1.6" />
        <BuildingIcon x={233} y={320} />
        <text x="245" y="364" textAnchor="middle" className="fill-foreground" fontSize="14" fontWeight="800">
          شبکهٔ دفتر (LAN)
        </text>
        <text x="245" y="386" textAnchor="middle" className="fill-muted-foreground" fontSize="11.5">
          ساب‌نت‌روتر · CRM 192.168.1.220 · NVR دوربین‌ها
        </text>
        <text x="245" y="407" textAnchor="middle" className="fill-muted-foreground" fontSize="10.5">
          192.168.1.0/24 — پشت روتر دفتر، بدون پورت باز روی اینترنت
        </text>
      </g>
    </svg>
  )
}

/** نسخهٔ موبایل — عمودی و ساده‌تر */
function MobileDiagram() {
  return (
    <svg
      viewBox="0 0 380 660"
      className="mx-auto h-auto w-full max-w-[340px]"
      role="img"
      aria-label="دیاگرام سادهٔ معماری شبکه در حالت عمودی"
    >
      <defs>
        <marker id="arrow-emerald-m" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 8 5 L 0 9 z" className="fill-emerald-500" />
        </marker>
        <marker id="arrow-amber-m" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 8 5 L 0 9 z" className="fill-amber-500" />
        </marker>
      </defs>

      {/* مسیر کنترل */}
      <path d="M 105 108 C 115 150, 140 160, 155 178" fill="none" strokeWidth="2.5" className="animated-dash stroke-emerald-500" markerEnd="url(#arrow-emerald-m)" />
      <path d="M 275 108 C 265 150, 240 160, 225 178" fill="none" strokeWidth="2.5" className="animated-dash stroke-emerald-500" markerEnd="url(#arrow-emerald-m)" />

      {/* مسیر داده — کنار زدن VPS */}
      <path d="M 60 108 C 18 230, 18 380, 66 470" fill="none" strokeWidth="2.5" className="animated-dash stroke-amber-500" markerEnd="url(#arrow-amber-m)" />

      <text x="188" y="150" textAnchor="middle" className="fill-emerald-600 dark:fill-emerald-400" fontSize="12" fontWeight="700">
        مسیر کنترل
      </text>
      <text x="30" y="320" textAnchor="middle" className="fill-amber-600 dark:fill-amber-400" fontSize="11.5" fontWeight="700" transform="rotate(-90 30 320)">
        مسیر داده — مستقیم (WireGuard)
      </text>

      {/* گوشی */}
      <g>
        <rect x="35" y="25" width="140" height="83" rx="14" className="fill-card stroke-border" strokeWidth="1.5" />
        <PhoneIcon x={93} y={38} />
        <text x="105" y="86" textAnchor="middle" className="fill-foreground" fontSize="13" fontWeight="700">
          گوشی
        </text>
      </g>

      {/* لپ‌تاپ */}
      <g>
        <rect x="205" y="25" width="140" height="83" rx="14" className="fill-card stroke-border" strokeWidth="1.5" />
        <LaptopIcon x={253} y={40} />
        <text x="275" y="86" textAnchor="middle" className="fill-foreground" fontSize="13" fontWeight="700">
          لپ‌تاپ
        </text>
      </g>

      {/* VPS */}
      <g>
        <rect x="95" y="180" width="190" height="100" rx="14" className="fill-card stroke-emerald-500/50" strokeWidth="1.5" />
        <ServerIcon x={177} y={192} />
        <text x="190" y="232" textAnchor="middle" className="fill-foreground" fontSize="13.5" fontWeight="800">
          VPS شما
        </text>
        <text x="190" y="252" textAnchor="middle" className="fill-muted-foreground" fontSize="10.5">
          Headscale + Caddy
        </text>
      </g>

      {/* شبکهٔ دفتر */}
      <g>
        <rect x="60" y="472" width="260" height="130" rx="14" className="fill-card stroke-amber-500/40" strokeWidth="1.5" />
        <BuildingIcon x={178} y={486} />
        <text x="190" y="528" textAnchor="middle" className="fill-foreground" fontSize="13" fontWeight="800">
          شبکهٔ دفتر (LAN)
        </text>
        <text x="190" y="550" textAnchor="middle" className="fill-muted-foreground" fontSize="10.5">
          ساب‌نت‌روتر · CRM · NVR
        </text>
        <text x="190" y="568" textAnchor="middle" className="fill-muted-foreground" fontSize="10">
          192.168.1.0/24
        </text>
      </g>
    </svg>
  )
}

export function ArchitectureDiagram() {
  return (
    <motion.figure
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5 }}
      className="rounded-2xl border bg-card/60 p-4 sm:p-6"
    >
      <div className="hidden md:block">
        <DesktopDiagram />
      </div>
      <div className="md:hidden">
        <MobileDiagram />
      </div>
      <Legend />
    </motion.figure>
  )
}
