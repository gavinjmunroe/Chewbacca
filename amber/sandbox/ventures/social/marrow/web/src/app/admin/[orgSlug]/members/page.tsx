'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { UserPlus, Mail, Trash2, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { AdminSidebar } from '@/components/nav/sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { getInitials, getFullName } from '@/lib/utils'
import type { Organization, OrgMember, Profile } from '@/types/database'

type MemberWithProfile = OrgMember & { profiles: Profile }

const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['admin', 'reviewer']),
})
type InviteInput = z.infer<typeof inviteSchema>

export default function MembersPage() {
  const params = useParams<{ orgSlug: string }>()
  const { orgSlug } = params
  const router = useRouter()
  const supabase = createClient()

  const [org, setOrg] = React.useState<Organization | null>(null)
  const [members, setMembers] = React.useState<MemberWithProfile[]>([])
  const [myRole, setMyRole] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<InviteInput>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'reviewer' },
  })

  React.useEffect(() => {
    async function load() {
      setIsLoading(true)

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      const { data: orgData } = await supabase
        .from('organizations')
        .select('*')
        .eq('slug', orgSlug)
        .single()

      if (!orgData) {
        router.push('/dashboard')
        return
      }
      const org = orgData as unknown as Organization
      setOrg(org)

      const sb = supabase as any
      const { data: membershipData } = await sb
        .from('org_members')
        .select('role')
        .eq('org_id', org.id)
        .eq('user_id', user.id)
        .single()

      if (!membershipData) {
        router.push('/dashboard')
        return
      }
      setMyRole((membershipData as { role: string }).role)

      const { data: membersData } = await sb
        .from('org_members')
        .select('*, profiles(*)')
        .eq('org_id', org.id)
        .order('invited_at', { ascending: true })

      setMembers((membersData ?? []) as unknown as MemberWithProfile[])
      setIsLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug])

  const sendInvite = async (data: InviteInput) => {
    if (!org) return
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: org.id, email: data.email, role: data.role }),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Failed to send invite')
      }
      const json = await res.json()
      if (json.added) {
        toast.success(`${data.email} has been added to the team`)
        // Reload members
        const sb = supabase as any
        const { data: membersData } = await sb
          .from('org_members')
          .select('*, profiles(*)')
          .eq('org_id', org.id)
          .order('invited_at', { ascending: true })
        setMembers((membersData ?? []) as unknown as MemberWithProfile[])
      } else {
        toast.success(`Invite sent to ${data.email}`)
      }
      reset()
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to send invite')
    }
  }

  const removeMember = async (memberId: string, memberName: string) => {
    if (!confirm(`Remove ${memberName} from this organization?`)) return
    const { error } = await (supabase as any).from('org_members').delete().eq('id', memberId)
    if (error) {
      toast.error('Failed to remove member')
      return
    }
    setMembers((prev) => prev.filter((m) => m.id !== memberId))
    toast.success(`${memberName} removed`)
  }

  if (isLoading || !org) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
      </div>
    )
  }

  const canManage = myRole === 'owner' || myRole === 'admin'

  return (
    <div className="flex flex-1 overflow-hidden">
      <AdminSidebar orgSlug={orgSlug} orgName={org.name} orgLogoUrl={org.logo_url ?? null} />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">Team Members</h1>
            <p className="text-sm text-stone-500 mt-0.5">
              {members.length} member{members.length !== 1 ? 's' : ''} · {org.name}
            </p>
          </div>

          {/* Member list */}
          <Card>
            <CardContent className="p-0">
              {members.map((m, i) => {
                const p = m.profiles as Profile
                const name = getFullName(p?.first_name ?? null, p?.last_name ?? null)
                return (
                  <div key={m.id}>
                    {i > 0 && <Separator />}
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="h-8 w-8 shrink-0">
                          {p?.avatar_url && <AvatarImage src={p.avatar_url} />}
                          <AvatarFallback className="text-xs bg-stone-100 text-stone-600">
                            {getInitials(p?.first_name ?? null, p?.last_name ?? null)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-stone-900 truncate">{name}</p>
                          <p className="text-xs text-stone-400 truncate">{p?.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        <span className="text-xs text-stone-500 capitalize bg-stone-100 px-2 py-0.5 rounded-full">
                          {m.role}
                        </span>
                        {m.role !== 'owner' && canManage && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-stone-400 hover:text-red-500"
                            onClick={() => removeMember(m.id, name)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          {/* Invite */}
          {canManage && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  Invite Member
                </CardTitle>
                <CardDescription>
                  Send an invite to add a reviewer or admin to your organization.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <form onSubmit={handleSubmit(sendInvite)} className="space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
                      <Input
                        {...register('email')}
                        className="pl-9"
                        placeholder="colleague@school.edu"
                        type="email"
                      />
                    </div>
                    <Select
                      defaultValue="reviewer"
                      onValueChange={(v) => setValue('role', v as 'admin' | 'reviewer')}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="reviewer">Reviewer</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? 'Sending…' : 'Send Invite'}
                    </Button>
                  </div>
                  {errors.email && (
                    <p className="text-xs text-red-500">{errors.email.message}</p>
                  )}
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
