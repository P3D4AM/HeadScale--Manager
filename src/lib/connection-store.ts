'use client'

/**
 * استور وضعیت اتصال به سرور (zustand + persist).
 *
 * اصل امنیتی: هیچ رمز/کلید/passphrase هرگز در این استور یا localStorage
 * ذخیره نمی‌شود — اسرار فقط در agent (مخزن اسرار ویندوز/فایل 0600) یا
 * حافظهٔ موقت فراخوانی API باقی می‌مانند. آنچه ذخیره می‌شود فقط «نمای UI»
 * است: پروفایل فعال و snapshot نشست برای بازگرداندن وضعیت پس از رفرش.
 */

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  agentSocket,
  agentGet,
  type ConnectInlineInput,
  type ConnectResponse,
  type HostKeyChangeDetail,
  type HostKeyFingerprint,
  type HsMode,
  type SessionInfo,
  type SessionStatus,
  type SessionsResponse,
  type SudoMode,
} from '@/lib/agent'

/** نمای ذخیره‌شدهٔ نشست (بدون هیچ سری) */
export interface SessionSnapshot {
  sessionId: string
  host: string
  port: number
  username: string
  profileId: string | null
  hsMode: HsMode
  connectedAt: string | null
}

export interface ConnectionError {
  code: string
  message: string
}

interface ConnectionStore {
  /** وضعیت جاری */
  status: SessionStatus
  sessionId: string | null
  host: string | null
  port: number | null
  username: string | null
  profileId: string | null
  hsMode: HsMode | null
  sudoMode: SudoMode | null
  connectedAt: string | null

  /** اثرانگشت در انتظار تأیید (TOFU) */
  fingerprint: HostKeyFingerprint | null
  /** جریان هشدار مغایرت کلید میزبان (409) */
  hostKeyChange: HostKeyChangeDetail | null
  lastError: ConnectionError | null

  /** سوکت زنده به agent (نشانگر keepalive) */
  socketAlive: boolean

  /** پارامترهای inline اتصال اخیر — فقط حافظه (برای تلاش مجدد پس از فراموشی کلید) */
  lastInline: ConnectInlineInput | null
  /** آیا lastInline حاوی راز است (برای پاک‌سازی در devTools) */
  hasInlineSecret: boolean

  /** ذخیره‌شده (persist) */
  activeProfileId: string | null
  lastSession: SessionSnapshot | null

  /** نرمال‌سازی پس از rehydrate — session فعلی از سرور پرسیده می‌شود */
  verifiedOnLoad: boolean

  // ---------------------------------------------------------------- actions
  beginConnect: (inline?: ConnectInlineInput, profileId?: string | null) => void
  handleConnectResponse: (res: ConnectResponse) => void
  setError: (code: string, message: string) => void
  setHostKeyChange: (detail: HostKeyChangeDetail, message: string) => void
  clearHostKeyChange: () => void
  markDisconnected: (detail?: string) => void
  setSocketAlive: (alive: boolean) => void
  setActiveProfileId: (id: string | null) => void
  verifyOnLoad: () => Promise<void>
  refreshSessionInfo: () => Promise<void>
}

function snapshotOf(
  s: Pick<
    ConnectionStore,
    'sessionId' | 'host' | 'port' | 'username' | 'profileId' | 'hsMode' | 'connectedAt'
  >
): SessionSnapshot | null {
  if (!s.sessionId || !s.host || !s.username) return null
  return {
    sessionId: s.sessionId,
    host: s.host,
    port: s.port ?? 22,
    username: s.username,
    profileId: s.profileId,
    hsMode: s.hsMode ?? 'system-sudo',
    connectedAt: s.connectedAt,
  }
}

export const useConnectionStore = create<ConnectionStore>()(
  persist(
    (set, get) => ({
      status: 'disconnected',
      sessionId: null,
      host: null,
      port: null,
      username: null,
      profileId: null,
      hsMode: null,
      sudoMode: null,
      connectedAt: null,

      fingerprint: null,
      hostKeyChange: null,
      lastError: null,

      socketAlive: false,

      lastInline: null,
      hasInlineSecret: false,

      activeProfileId: null,
      lastSession: null,

      verifiedOnLoad: false,

      beginConnect: (inline, profileId) => {
        set({
          status: 'connecting',
          fingerprint: null,
          hostKeyChange: null,
          lastError: null,
          profileId: profileId ?? null,
          ...(inline
            ? {
                host: inline.host,
                port: inline.port ?? 22,
                username: inline.username,
                hsMode: inline.hsMode ?? 'system-sudo',
                lastInline: inline,
                hasInlineSecret: Boolean(inline.password || inline.passphrase),
              }
            : {}),
        })
      },

      handleConnectResponse: (res) => {
        if (res.status === 'fingerprint-required') {
          set({
            status: 'fingerprint-required',
            sessionId: res.sessionId,
            fingerprint: res.fingerprint ?? null,
          })
          return
        }
        if (res.status === 'connected') {
          set({
            status: 'connected',
            sessionId: res.sessionId,
            fingerprint: res.fingerprint ?? null,
            sudoMode: res.sudoMode ?? null,
            connectedAt: new Date().toISOString(),
            lastError: null,
            hostKeyChange: null,
            activeProfileId: get().profileId ?? get().activeProfileId,
          })
          // snapshot برای بازگرداندن UI پس از رفرش (بدون سری)
          set({ lastSession: snapshotOf(get()) })
          // عضویت در اتاق رویدادهای همین نشست
          try {
            agentSocket().emit('subscribe', `sid:${res.sessionId}`)
          } catch {
            /* سوکت در دسترس نیست — REST همچنان کار می‌کند */
          }
          return
        }
        // declined
        set({
          status: 'disconnected',
          sessionId: null,
          fingerprint: null,
          lastInline: null,
          hasInlineSecret: false,
        })
      },

      setError: (code, message) => {
        set({ status: 'error', lastError: { code, message }, fingerprint: null })
      },

      setHostKeyChange: (detail, message) => {
        set({
          status: 'error',
          hostKeyChange: detail,
          fingerprint: null,
          lastError: { code: 'HOSTKEY_CHANGED', message },
        })
      },

      clearHostKeyChange: () => {
        set({ hostKeyChange: null, lastError: null, status: 'disconnected' })
      },

      markDisconnected: (detail) => {
        const prev = get().status
        set({
          status: 'disconnected',
          sessionId: null,
          fingerprint: null,
          hostKeyChange: null,
          connectedAt: null,
          sudoMode: null,
          lastError: detail ? { code: 'CONN_LOST', message: detail } : prev === 'error' ? get().lastError : null,
          lastInline: null,
          hasInlineSecret: false,
          lastSession: null,
        })
      },

      setSocketAlive: (alive) => set({ socketAlive: alive }),

      setActiveProfileId: (id) => set({ activeProfileId: id }),

      /** پس از رفرش صفحه: اگر نشست هنوز در agent زنده است، UI را متصل می‌کند */
      verifyOnLoad: async () => {
        const snap = get().lastSession
        set({ verifiedOnLoad: true })
        if (!snap) return
        try {
          const res = await agentGet<SessionsResponse>('/api/sessions')
          const alive = res.sessions.find(
            (s) => s.id === snap.sessionId && s.status === 'connected'
          )
          if (alive) {
            set({
              status: 'connected',
              sessionId: alive.id,
              host: alive.host,
              port: alive.port,
              username: alive.username,
              profileId: alive.profileId ?? null,
              hsMode: alive.hsMode,
              sudoMode: alive.sudoMode ?? null,
              connectedAt: alive.connectedAt ?? null,
              lastError: null,
            })
            try {
              agentSocket().emit('subscribe', `sid:${alive.id}`)
            } catch {
              /* ignore */
            }
          } else {
            // نشست مرده — snapshot پاک شود
            set({ lastSession: null, sessionId: null, status: 'disconnected' })
          }
        } catch {
          // agent در دسترس نیست؛ وضعیت قطع صادقانه
          set({ lastSession: null, status: 'disconnected' })
        }
      },

      refreshSessionInfo: async () => {
        const sid = get().sessionId
        if (!sid) return
        try {
          const res = await agentGet<SessionsResponse>('/api/sessions')
          const me = res.sessions.find((s: SessionInfo) => s.id === sid)
          if (!me || me.status !== 'connected') {
            get().markDisconnected(me?.lastError ?? undefined)
          } else {
            set({
              status: 'connected',
              host: me.host,
              port: me.port,
              username: me.username,
              profileId: me.profileId ?? null,
              hsMode: me.hsMode,
              sudoMode: me.sudoMode ?? null,
              connectedAt: me.connectedAt ?? null,
              lastSession: {
                sessionId: me.id,
                host: me.host,
                port: me.port,
                username: me.username,
                profileId: me.profileId ?? null,
                hsMode: me.hsMode,
                connectedAt: me.connectedAt ?? null,
              },
            })
          }
        } catch {
          /* شبکه موقتاً قطع است — بی‌صدا */
        }
      },
    }),
    {
      name: 'hem-connection',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      // فقط نمای UI ذخیره می‌شود — هرگز وضعیت موقت/سری/خطا
      partialize: (s) => ({
        activeProfileId: s.activeProfileId,
        lastSession: s.lastSession,
      }),
    }
  )
)

// ---------------------------------------------------------------------------
// سیم‌کشی socket.io — یک‌بار در طول عمر برنامه
// ---------------------------------------------------------------------------

let socketBound = false

/** نشست‌هایی که قطع‌شدن‌شان توسط خود کاربر انجام شده (توست تکراری نده) */
const expectedDisconnects = new Set<string>()

/** قطع‌کردن موردانتظار را ثبت کن (قبل از فراخوانی API قطع) */
export function expectDisconnect(sessionId: string): void {
  expectedDisconnects.add(sessionId)
}

/** رویدادهای conn:status از agent را به استور وصل می‌کند (یک‌بار فراخوانی شود) */
export function bindAgentSocket(): () => void {
  if (socketBound) return () => undefined
  socketBound = true

  const socket = agentSocket()

  const onStatus = (evt: ConnStatusEvt) => {
    const st = useConnectionStore.getState()
    const expected = expectedDisconnects.delete(evt.sessionId)
    if (evt.sessionId !== st.sessionId) return
    if (evt.status === 'connected') return
    // disconnected | error
    const wasConnected = st.status === 'connected'
    // جزئیات فارسیِ عامل را نشان بده؛ رشته‌های فنی (مثل user-disconnect) را ترجمهٔ خودمان جایگزین کن
    const FA_RE = /[\u0600-\u06FF]/
    const friendly =
      evt.detail && FA_RE.test(evt.detail)
        ? evt.detail
        : evt.status === 'error'
          ? 'اتصال SSH به دلیل خطا قطع شد.'
          : 'نشست SSH بسته شد. برای ادامه، از مرکز اتصال دوباره وصل شوید.'
    st.markDisconnected(expected ? undefined : friendly)
    if (!expected && wasConnected) {
      // قطع ناگهانی (نه با دکمهٔ خود برنامه) — کاربر باید ببیند
      import('sonner').then(({ toast }) =>
        toast.error('اتصال به سرور قطع شد.', { description: friendly })
      ).catch(() => undefined)
    }
  }

  socket.on('conn:status', onStatus)
  socket.on('connect', () => useConnectionStore.getState().setSocketAlive(true))
  socket.on('disconnect', () => useConnectionStore.getState().setSocketAlive(false))

  if (socket.connected) {
    useConnectionStore.getState().setSocketAlive(true)
  }

  return () => {
    socket.off('conn:status', onStatus)
    socketBound = false
  }
}

interface ConnStatusEvt {
  sessionId: string
  status: 'connected' | 'disconnected' | 'error'
  detail?: string
}
