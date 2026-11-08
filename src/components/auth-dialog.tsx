'use client'

import { useState } from 'react'
import { login, register } from '@/lib/actions/auth'
import { useApp } from '@/components/store'
import { useToast } from '@/hooks/use-toast'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'

const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@demo.stream' },
  { label: 'Producer', email: 'producer@demo.stream' },
  { label: 'Viewer (Premium)', email: 'viewer@demo.stream' },
]
const DEMO_PW = 'demo1234'

export function AuthDialog() {
  const { authOpen, authTab, closeAuth, setSession, authRedirectWatch, openWatch } = useApp()
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'VIEWER' | 'PRODUCER'>('VIEWER')
  const [busy, setBusy] = useState(false)

  const finish = (result: Awaited<ReturnType<typeof login>>) => {
    if (!result.ok || !result.data) return
    setSession(result.data.user, result.data.membership)
    closeAuth()
    toast({ title: `Welcome, ${result.data.user.name}` })
    if (authRedirectWatch) openWatch(authRedirectWatch)
  }

  const handleLogin = async () => {
    setBusy(true)
    const r = await login({ email, password })
    setBusy(false)
    if (!r.ok) {
      toast({ title: 'Sign in failed', description: r.error, variant: 'destructive' })
      return
    }
    finish(r)
  }

  const handleRegister = async () => {
    setBusy(true)
    const r = await register({ name, email, password, role })
    setBusy(false)
    if (!r.ok) {
      toast({ title: 'Registration failed', description: r.error, variant: 'destructive' })
      return
    }
    finish(r)
  }

  const fill = (e: string) => {
    setEmail(e)
    setPassword(DEMO_PW)
  }

  return (
    <Dialog open={authOpen} onOpenChange={(o) => (!o ? closeAuth() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome to StreamRoots</DialogTitle>
          <DialogDescription>
            Sign in to watch — every playback is watermarked to your account.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={authTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="register">Create account</TabsTrigger>
          </TabsList>

          <TabsContent value="signin" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="li-email">Email</Label>
              <Input id="li-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="li-pw">Password</Label>
              <Input id="li-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <Button onClick={handleLogin} disabled={busy} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sign in
            </Button>
            <div className="rounded-lg border border-dashed border-white/15 bg-white/5 p-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Demo accounts (password {DEMO_PW})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DEMO_ACCOUNTS.map((a) => (
                  <Button key={a.email} variant="outline" size="sm" className="h-7 text-xs" onClick={() => fill(a.email)}>
                    {a.label}
                  </Button>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="register" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="rg-name">Full name</Label>
              <Input id="rg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Amara Diallo" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rg-email">Email</Label>
              <Input id="rg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rg-pw">Password</Label>
              <Input id="rg-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </div>
            <div className="space-y-1.5">
              <Label>I am joining as a…</Label>
              <Select value={role} onValueChange={(v) => setRole(v as 'VIEWER' | 'PRODUCER')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIEWER">Viewer — watch and subscribe</SelectItem>
                  <SelectItem value="PRODUCER">Producer — publish my videos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleRegister} disabled={busy} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create account
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
