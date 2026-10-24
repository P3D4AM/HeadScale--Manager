'use client'

/**
 * ویرایشگر کوچک فهرست دوربین‌های مداربسته (فیلد cameras از planInputsSchema —
 * نوع object[] با شکل هم‌ارز src/hem/cameras/registry.py).
 * هیچ رمز/نام‌کاربری دوربینی گرفته نمی‌شود — فقط مسیر شبکه (سیاست پروژه).
 */

import { useState } from 'react'
import { Camera, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { CameraDevice } from '@/lib/install/types'

const EMPTY: CameraDevice = { name: '', host: '', brand: '', notes: '' }

function num(v: string): number | undefined {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : undefined
}

export function CamerasEditor({
  value,
  onChange,
}: {
  value: CameraDevice[]
  onChange: (next: CameraDevice[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [form, setForm] = useState<CameraDevice>(EMPTY)
  const [ports, setPorts] = useState({ http: '', rtsp: '' })

  const openNew = () => {
    setEditIndex(null)
    setForm(EMPTY)
    setPorts({ http: '', rtsp: '' })
    setOpen(true)
  }

  const openEdit = (i: number) => {
    const c = value[i]
    setEditIndex(i)
    setForm({ ...c })
    setPorts({
      http: c.http_port ? String(c.http_port) : '',
      rtsp: c.rtsp_port ? String(c.rtsp_port) : '',
    })
    setOpen(true)
  }

  const save = () => {
    const name = form.name.trim()
    const host = form.host.trim()
    if (!name || !host) {
      toast.error('نام و آدرس دوربین الزامی است.')
      return
    }
    const cam: CameraDevice = { name, host }
    const hp = num(ports.http)
    const rp = num(ports.rtsp)
    if (ports.http.trim() && !hp) {
      toast.error('پورت HTTP باید عددی بین ۱ تا ۶۵۵۳۵ باشد.')
      return
    }
    if (ports.rtsp.trim() && !rp) {
      toast.error('پورت RTSP باید عددی بین ۱ تا ۶۵۵۳۵ باشد.')
      return
    }
    if (hp) cam.http_port = hp
    if (rp) cam.rtsp_port = rp
    if (form.brand?.trim()) cam.brand = form.brand.trim()
    if (form.notes?.trim()) cam.notes = form.notes.trim()

    const next = [...value]
    if (editIndex != null) next[editIndex] = cam
    else next.push(cam)
    onChange(next)
    setOpen(false)
  }

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2.5 text-[12px] leading-6 text-muted-foreground">
          دوربینی اضافه نشده — اختیاری است؛ بعد از نصب هم با دستور{' '}
          <code dir="ltr" className="rounded bg-muted px-1 font-mono text-[11px]">
            hsctl cameras add
          </code>{' '}
          شدنی است.
        </p>
      )}
      {value.map((c, i) => (
        <div
          key={`${c.name}-${i}`}
          className="flex items-center gap-3 rounded-lg border bg-card/70 px-3 py-2.5"
        >
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Camera className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-foreground">{c.name}</p>
            <p dir="ltr" className="truncate font-mono text-[11px] text-muted-foreground">
              {c.host}
              {c.http_port ? ` :${c.http_port}/http` : ''}
              {c.rtsp_port ? ` :${c.rtsp_port}/rtsp` : ''}
              {c.brand ? ` — ${c.brand}` : ''}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 text-muted-foreground hover:text-foreground"
            aria-label={`ویرایش دوربین ${c.name}`}
            onClick={() => openEdit(i)}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 text-muted-foreground hover:text-destructive"
            aria-label={`حذف دوربین ${c.name}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        className="h-11 w-full gap-2 rounded-xl font-bold"
        onClick={openNew}
      >
        <Plus className="size-4" />
        افزودن دوربین
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader className="text-right sm:text-right">
            <DialogTitle>
              {editIndex != null ? 'ویرایش دوربین' : 'افزودن دوربین/NVR'}
            </DialogTitle>
            <DialogDescription>
              هیچ رمز یا نام‌کاربری دوربینی خواسته نمی‌شود — این ابزار فقط «مسیر
              شبکه» را بررسی می‌کند.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label htmlFor="cam-name">نام دوربین (الزامی)</Label>
              <Input
                id="cam-name"
                className="h-11"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="مثلاً: ورودی انبار"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cam-host">آدرس/IP دوربین (الزامی)</Label>
              <Input
                id="cam-host"
                dir="ltr"
                className="h-11 text-left"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="192.168.1.108"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="cam-http">پورت HTTP (اختیاری)</Label>
                <Input
                  id="cam-http"
                  dir="ltr"
                  inputMode="numeric"
                  className="h-11 text-left"
                  value={ports.http}
                  onChange={(e) => setPorts({ ...ports, http: e.target.value })}
                  placeholder="80"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cam-rtsp">پورت RTSP (اختیاری)</Label>
                <Input
                  id="cam-rtsp"
                  dir="ltr"
                  inputMode="numeric"
                  className="h-11 text-left"
                  value={ports.rtsp}
                  onChange={(e) => setPorts({ ...ports, rtsp: e.target.value })}
                  placeholder="554"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cam-brand">برند (اختیاری)</Label>
              <Input
                id="cam-brand"
                className="h-11"
                value={form.brand ?? ''}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                placeholder="Hikvision / Dahua / …"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cam-notes">یادداشت (اختیاری)</Label>
              <Input
                id="cam-notes"
                className="h-11"
                value={form.notes ?? ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="مثلاً: NVR طبقهٔ دوم"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl font-bold"
              onClick={() => setOpen(false)}
            >
              انصراف
            </Button>
            <Button
              type="button"
              className="h-11 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
              onClick={save}
            >
              {editIndex != null ? 'ذخیرهٔ تغییرات' : 'افزودن'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
