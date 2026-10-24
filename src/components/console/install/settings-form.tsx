'use client'

/**
 * فرم تنظیمات نصب — کاملاً از planInputsSchema «واقعی» agent رندر می‌شود
 * (۱۳ فیلد با برچسب/راهنمای فارسی). فیلدهای agentManaged نمایش داده نمی‌شوند
 * (خود agent مقدارشان را می‌دهد). پشتیبانی از انواع:
 *   string | number | boolean | enum | string[] | object[] (دوربین‌ها)
 */

import { useMemo } from 'react'
import { Info, ListPlus, RotateCcw, Trash2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CamerasEditor } from './cameras-editor'
import type { InstallPlanField, InstallSettings } from '@/lib/install/types'
import type { InstallFormValidation } from '@/lib/install/validation'
import { isValidFqdn } from '@/lib/install/validation'

/** برچسب فارسی مقادیر enum شناخته‌شده (caddy_mode) */
const ENUM_FA: Record<string, Record<string, string>> = {
  caddy_mode: {
    install: 'نصب Caddy جدید (توصیه‌شده)',
    reuse: 'استفاده از Caddy موجود',
    skip: 'بدون پروکسی — فقط تست',
  },
}

function fieldOptions(f: InstallPlanField): string[] {
  return f.enum ?? f.options ?? []
}

export function SettingsForm({
  schema,
  settings,
  validation,
  onChange,
  onResetDefaults,
  loading,
}: {
  schema: InstallPlanField[] | null
  settings: InstallSettings | null
  validation: InstallFormValidation | null
  onChange: (next: InstallSettings) => void
  onResetDefaults: () => void
  loading: boolean
}) {
  const visibleFields = useMemo(
    () => (schema ?? []).filter((f) => !f.agentManaged),
    [schema]
  )

  if (loading || !schema || !settings) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="در حال دریافت فرم تنظیمات">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-11 w-1/2" />
        <p className="text-sm text-muted-foreground">
          فرم از روی پاسخ واقعی سرور ساخته می‌شود…
        </p>
      </div>
    )
  }

  const set = <K extends keyof InstallSettings>(key: K, value: InstallSettings[K]) => {
    onChange({ ...settings, [key]: value })
  }

  const domain = (settings.domain ?? '').trim()
  const magicSuggestion = domain && isValidFqdn(domain) ? `ts.${domain}` : null
  const caddySkip = settings.caddy_mode === 'skip'

  return (
    <div className="space-y-5">
      {/* نکتهٔ فیلدهای agent-managed */}
      {schema.some((f) => f.agentManaged) && (
        <Alert className="border-emerald-500/30 bg-emerald-500/[0.05]">
          <Info className="size-4 text-emerald-600 dark:text-emerald-400" />
          <AlertTitle className="text-sm font-bold">فیلدهای اجرایی</AlertTitle>
          <AlertDescription className="text-[13px] leading-6">
            فیلد «{schema.filter((f) => f.agentManaged).map((f) => f.label).join('، ')}»
            توسط سرویس مدیریت خودش مقداردهی می‌شود و در فرم نمی‌آید.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {visibleFields.map((f) => {
          const err = validation?.fieldErrors[f.key]
          const hint = f.hint ?? f.help
          return (
            <div
              key={f.key}
              className={cn(
                'grid gap-2 rounded-xl border bg-card/60 p-4',
                err ? 'border-destructive/50' : 'border-border/70'
              )}
              data-field={f.key}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor={`fld-${f.key}`} className="text-sm font-bold">
                  {f.label}
                </Label>
                {f.required && (
                  <Badge variant="outline" className="rounded-full border-red-500/40 bg-red-500/10 px-2 py-0 text-[10px] text-red-700 dark:text-red-300">
                    الزامی
                  </Badge>
                )}
                {f.type === 'string[]' && <Badge variant="secondary" className="text-[10px]">لیستی</Badge>}
                {f.type === 'enum' && <Badge variant="secondary" className="text-[10px]">انتخابی</Badge>}
              </div>

              {/* ── string ── */}
              {f.type === 'string' && (
                <>
                  <Input
                    id={`fld-${f.key}`}
                    dir={isLatinKey(f.key) ? 'ltr' : undefined}
                    className={cn('h-11', isLatinKey(f.key) && 'text-left')}
                    value={String(settings[f.key as keyof InstallSettings] ?? '')}
                    placeholder={placeholderFor(f.key)}
                    aria-invalid={Boolean(err)}
                    onChange={(e) => set(f.key as keyof InstallSettings, e.target.value as never)}
                  />
                  {f.key === 'magic_dns_base' && magicSuggestion && !(settings.magic_dns_base ?? '').trim() && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 w-fit gap-2 rounded-lg text-xs font-bold"
                      onClick={() => set('magic_dns_base', magicSuggestion)}
                    >
                      <Wand2 className="size-3.5" />
                      پیشنهاد: <span dir="ltr" className="font-mono">{magicSuggestion}</span>
                    </Button>
                  )}
                </>
              )}

              {/* ── number ── */}
              {f.type === 'number' && (
                <Input
                  id={`fld-${f.key}`}
                  dir="ltr"
                  inputMode="numeric"
                  className="h-11 text-left"
                  value={String(settings[f.key as keyof InstallSettings] ?? '')}
                  placeholder={placeholderFor(f.key)}
                  aria-invalid={Boolean(err)}
                  onChange={(e) => {
                    const raw = e.target.value.trim()
                    if (raw === '') {
                      set(f.key as keyof InstallSettings, '' as never)
                    } else if (/^\d+$/.test(raw)) {
                      set(f.key as keyof InstallSettings, Number(raw) as never)
                    }
                  }}
                />
              )}

              {/* ── boolean ── */}
              {f.type === 'boolean' && (
                <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/50 px-3">
                  <span className="text-[13px] text-muted-foreground">
                    {settings[f.key as keyof InstallSettings] ? 'فعال' : 'غیرفعال'}
                  </span>
                  <Switch
                    id={`fld-${f.key}`}
                    checked={Boolean(settings[f.key as keyof InstallSettings])}
                    onCheckedChange={(v) => set(f.key as keyof InstallSettings, v as never)}
                    aria-invalid={Boolean(err)}
                    className="data-[state=checked]:bg-emerald-600 dark:data-[state=checked]:bg-emerald-500"
                  />
                </div>
              )}

              {/* ── enum ── */}
              {f.type === 'enum' && (
                <Select
                  value={String(settings[f.key as keyof InstallSettings] ?? '')}
                  onValueChange={(v) => set(f.key as keyof InstallSettings, v as never)}
                >
                  <SelectTrigger
                    id={`fld-${f.key}`}
                    className="h-11 w-full rounded-lg"
                    aria-invalid={Boolean(err)}
                  >
                    <SelectValue placeholder="انتخاب کنید…" />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    {fieldOptions(f).map((opt) => (
                      <SelectItem key={opt} value={opt} className="min-h-11">
                        <span className="font-bold">{ENUM_FA[f.key]?.[opt] ?? opt}</span>
                        <span dir="ltr" className="ms-2 font-mono text-[11px] text-muted-foreground">
                          {opt}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* ── string[] ── */}
              {f.type === 'string[]' && (
                <StringListEditor
                  values={(settings[f.key as keyof InstallSettings] as string[]) ?? []}
                  error={err}
                  onChange={(next) => set(f.key as keyof InstallSettings, next as never)}
                />
              )}

              {/* ── object[] → دوربین‌ها ── */}
              {f.type === 'object[]' &&
                (f.key === 'cameras' ? (
                  <CamerasEditor
                    value={(settings.cameras as InstallSettings['cameras']) ?? []}
                    onChange={(next) => set('cameras', next)}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    این فیلد ({f.label}) از نوع ساختارمند است و در این نسخه ویرایشگر
                    اختصاصی ندارد.
                  </p>
                ))}

              {hint && (
                <p className={cn('text-[12px] leading-6', caddySkip && f.key === 'acme_email' ? 'text-muted-foreground/70 line-through decoration-muted-foreground/40' : 'text-muted-foreground')}>
                  {hint}
                </p>
              )}
              {f.key === 'acme_email' && !caddySkip && !String(settings.acme_email ?? '').trim() && (
                <p className="text-[12px] font-bold leading-6 text-amber-700 dark:text-amber-300">
                  در حالت HTTPS (Caddy فعال) ایمیل گواهی الزامی است.
                </p>
              )}
              {err && (
                <p role="alert" className="text-[12px] font-bold leading-6 text-destructive">
                  {err}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-2 rounded-xl font-bold"
          onClick={() => {
            onResetDefaults()
            toast.success('پیش‌فرض‌های نصب‌کننده بارگذاری شد.')
          }}
        >
          <RotateCcw className="size-4" />
          بارگذاری پیش‌فرض‌ها
        </Button>
        <p className="text-[12px] text-muted-foreground">
          تغییرات به‌صورت خودکار به‌عنوان پیش‌نویس در همین مرورگر ذخیره می‌شود.
        </p>
      </div>
    </div>
  )
}

/** ویرایشگر لیست رشته‌ای (dns_nameservers) */
function StringListEditor({
  values,
  error,
  onChange,
}: {
  values: string[]
  error?: string
  onChange: (next: string[]) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            dir="ltr"
            className="inline-flex min-h-[44px] items-center rounded-full border border-border/70 bg-muted/50 ps-3 font-mono text-[13px]"
          >
            {v}
            <button
              type="button"
              aria-label={`حذف ${v}`}
              className="flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onChange(values.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <ListPlusInput onAdd={(v) => onChange([...values, v])} />
      </div>
      {error && (
        <p role="alert" className="text-[12px] font-bold text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function ListPlusInput({ onAdd }: { onAdd: (v: string) => void }) {
  return (
    <form
      className="flex w-full gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const input = e.currentTarget.elements.namedItem('ns') as HTMLInputElement | null
        const v = input?.value.trim() ?? ''
        if (!v) return
        onAdd(v)
        if (input) input.value = ''
      }}
    >
      <Input
        name="ns"
        dir="ltr"
        className="h-11 text-left"
        placeholder="IP جدید — مثلاً 9.9.9.9"
        inputMode="text"
      />
      <Button
        type="submit"
        variant="outline"
        className="h-11 shrink-0 gap-1.5 rounded-xl font-bold"
        aria-label="افزودن به لیست"
      >
        <ListPlus className="size-4" />
        افزودن
      </Button>
    </form>
  )
}

/** فیلدهایی که مقدارشان لاتین است */
function isLatinKey(key: string): boolean {
  return ['domain', 'magic_dns_base', 'install_dir', 'acme_email', 'headscale_version'].includes(
    key
  )
}

function placeholderFor(key: string): string {
  switch (key) {
    case 'domain':
      return 'hs.example.com'
    case 'magic_dns_base':
      return 'ts.example.com'
    case 'acme_email':
      return 'you@example.com'
    case 'install_dir':
      return '/opt/headscale-easy-manager'
    case 'headscale_version':
      return '0.29.5 (خالی = نسخهٔ پین‌شده)'
    case 'first_user':
      return 'admin'
    case 'ssh_port':
      return 'خالی = تشخیص خودکار'
    default:
      return ''
  }
}
