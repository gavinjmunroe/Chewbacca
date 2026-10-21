'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Trash2,
  UserPlus,
  Mail,
  Globe,
  Building2,
  ImagePlus,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { organizationSchema, type OrganizationInput } from '@/lib/validations'
import { cn, getInitials, getFullName, ORG_CATEGORIES } from '@/lib/utils'
import type { Organization, OrgMember, Profile } from '@/types/database'

type MemberWithProfile = OrgMember & { profiles: Profile }
type PendingInvite = { id: string; email: string; role: string; invited_at: string }

const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['admin', 'reviewer']),
})
type InviteInput = z.infer<typeof inviteSchema>

export default function OrgSettingsPage() {
  const params = useParams<{ orgSlug: string }>()
  const { orgSlug } = params
  const router = useRouter()
  const supabase = createClient()

  const [org, setOrg] = React.useState<Organization | null>(null)
  const [members, setMembers] = React.useState<MemberWithProfile[]>([])
  const [pendingInvites, setPendingInvites] = React.useState<PendingInvite[]>([])
  const [myRole, setMyRole] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isArchiveOpen, setIsArchiveOpen] = React.useState(false)
  const [archiveConfirm, setArchiveConfirm] = React.useState('')
  const [logoFile, setLogoFile] = React.useState<File | null>(null)
  const [coverFile, setCoverFile] = React.useState<File | null>(null)
  const logoInputRef = React.useRef<HTMLInputElement>(null)
  const coverInputRef = React.useRef<HTMLInputElement>(null)

  const {
    register,
    handleSubmit,
    reset: resetOrgForm,
    formState: { errors: orgErrors },
  } = useForm<OrganizationInput>({
    resolver: zodResolver(organizationSchema),
  })

  const {
    register: registerInvite,
    handleSubmit: handleInviteSubmit,
    reset: resetInviteForm,
    setValue: setInviteValue,
    watch: watchInvite,
    formState: { errors: inviteErrors, isSubmitting: isInviting },
  } = useForm<InviteInput>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'reviewer' },
  })

  // ── Load ─────────────────────────────────────────────────────────────────────

  React.useEffect(() => {
    async function load() {
      setIsLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: orgDataRaw } = await supabase
        .from('organizations')
        .select('*')
        .eq('slug', orgSlug)
        .single()

      if (!orgDataRaw) { router.push('/dashboard'); return }
      const orgData = orgDataRaw as unknown as Organization
      setOrg(orgData)

      // Check membership
      const { data: membershipRaw } = await supabase
        .from('org_members')
        .select('role')
        .eq('org_id', orgData.id)
        .eq('user_id', user.id)
        .single()

      const membership = membershipRaw as unknown as { role: string } | null
      if (!membership || membership.role === 'reviewer') {
        router.push(`/admin/${orgSlug}`)
        return
      }
      setMyRole(membership.role)

      resetOrgForm({
        name: orgData.name,
        slug: orgData.slug,
        description: orgData.description ?? '',
        school: orgData.school ?? '',
        category: orgData.category ?? '',
        website: orgData.website ?? '',
      })

      // Members
      const { data: membersData } = await supabase
        .from('org_members')
        .select('*, profiles(*)')
        .eq('org_id', orgData.id)
        .order('invited_at', { ascending: true })

      setMembers((membersData ?? []) as unknown as MemberWithProfile[])

      setIsLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug])

  // ── Save org settings ─────────────────────────────────────────────────────────

  const saveSettings = async (data: OrganizationInput) => {
    if (!org) return
    setIsSaving(true)
    try {
      let logoUrl = org.logo_url
      let coverUrl = org.cover_url

      // Upload logo
      if (logoFile) {
        const ext = logoFile.name.split('.').pop()
        const path = `orgs/${org.id}/logo.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('media')
          .upload(path, logoFile, { upsert: true })
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from('media').getPublicUrl(path)
          logoUrl = urlData.publicUrl
        }
      }

      // Upload cover
      if (coverFile) {
        const ext = coverFile.name.split('.').pop()
        const path = `orgs/${org.id}/cover.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('media')
          .upload(path, coverFile, { upsert: true })
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from('media').getPublicUrl(path)
          coverUrl = urlData.publicUrl
        }
      }

      const sb = supabase as any
      const { error } = await sb
        .from('organizations')
        .update({
          name: data.name,
          description: data.description ?? null,
          school: data.school ?? null,
          category: data.category ?? null,
          website: data.website ?? null,
          logo_url: logoUrl,
          cover_url: coverUrl,
        })
        .eq('id', org.id)

      if (error) throw error
      toast.success('Settings saved.')

      // Refresh org data
      const { data: updatedRaw } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', org.id)
        .single()
      if (updatedRaw) setOrg(updatedRaw as unknown as Organization)
    } catch {
      toast.error('Failed to save settings.')
    } finally {
      setIsSaving(false)
    }
  }

  // ── Invite member ─────────────────────────────────────────────────────────────

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
      toast.success(`Invite sent to ${data.email}`)
      resetInviteForm()
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to send invite.')
    }
  }

  // ── Remove member ─────────────────────────────────────────────────────────────

  const removeMember = async (memberId: string, memberName: string) => {
    if (!confirm(`Remove ${memberName} from this organization?`)) return
    const { error } = await supabase.from('org_members').delete().eq('id', memberId)
    if (error) { toast.error('Failed to remove member.'); return }
    setMembers((prev) => prev.filter((m) => m.id !== memberId))
    toast.success(`${memberName} removed.`)
  }

  // ── Archive org ───────────────────────────────────────────────────────────────

  const archiveOrg = async () => {
    if (!org || archiveConfirm !== org.name) return
    const sb2 = supabase as any
    const { error } = await sb2
      .from('organizations')
      .update({ is_active: false })
      .eq('id', org.id)
    if (error) { toast.error('Failed to archive.'); return }
    toast.success('Organization archived.')
    router.push('/dashboard')
  }

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
      </div>
    )
  }

  if (!org) return null

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">Organization Settings</h1>
        <p className="text-sm text-stone-500 mt-1">{org.name}</p>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="w-full justify-start border-b border-stone-200 bg-transparent rounded-none pb-0 gap-0">
          {['general', 'team', 'danger'].map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className={cn(
                'rounded-none border-b-2 border-transparent px-4 pb-3 pt-1 text-sm capitalize data-[state=active]:border-stone-900 data-[state=active]:text-stone-900 data-[state=active]:shadow-none'
              )}
            >
              {tab === 'danger' ? 'Danger Zone' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── General ── */}
        <TabsContent value="general" className="pt-6 space-y-6">
          <form onSubmit={handleSubmit(saveSettings)} className="space-y-5">
            {/* Logo + Cover upload */}
            <div className="flex gap-6 items-start">
              <div className="space-y-2">
                <Label className="text-xs text-stone-500">Logo</Label>
                <div
                  className="relative h-20 w-20 rounded-xl border-2 border-dashed border-stone-200 cursor-pointer hover:border-stone-400 transition-colors overflow-hidden"
                  onClick={() => logoInputRef.current?.click()}
                >
                  {logoFile ? (
                    <img
                      src={URL.createObjectURL(logoFile)}
                      alt="Logo preview"
                      className="h-full w-full object-cover"
                    />
                  ) : org.logo_url ? (
                    <img src={org.logo_url} alt="Logo" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <ImagePlus className="h-6 w-6 text-stone-300" />
                    </div>
                  )}
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>

              <div className="flex-1 space-y-2">
                <Label className="text-xs text-stone-500">Cover Image</Label>
                <div
                  className="relative h-20 w-full rounded-xl border-2 border-dashed border-stone-200 cursor-pointer hover:border-stone-400 transition-colors overflow-hidden"
                  onClick={() => coverInputRef.current?.click()}
                >
                  {coverFile ? (
                    <img
                      src={URL.createObjectURL(coverFile)}
                      alt="Cover preview"
                      className="h-full w-full object-cover"
                    />
                  ) : org.cover_url ? (
                    <img src={org.cover_url} alt="Cover" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center gap-2 text-stone-300">
                      <ImagePlus className="h-6 w-6" />
                      <span className="text-sm">Add cover image</span>
                    </div>
                  )}
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Organization Name</Label>
                <Input
                  id="name"
                  {...register('name')}
                  placeholder="e.g. USC Finance Club"
                />
                {orgErrors.name && (
                  <p className="text-xs text-red-500">{orgErrors.name.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="school">School</Label>
                <Input
                  id="school"
                  {...register('school')}
                  placeholder="e.g. University of Southern California"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                {...register('description')}
                placeholder="Tell applicants about your organization…"
                className="min-h-[100px] resize-y"
              />
              {orgErrors.description && (
                <p className="text-xs text-red-500">{orgErrors.description.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="website">Website</Label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
                  <Input
                    id="website"
                    {...register('website')}
                    className="pl-9"
                    placeholder="https://yourorg.com"
                  />
                </div>
                {orgErrors.website && (
                  <p className="text-xs text-red-500">{orgErrors.website.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category">Category</Label>
                <Select
                  defaultValue={org.category ?? ''}
                  onValueChange={(v) => {
                    // patch the form field manually
                    const el = document.getElementById('category-hidden') as HTMLInputElement
                    if (el) el.value = v
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {ORG_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  id="category-hidden"
                  type="hidden"
                  defaultValue={org.category ?? ''}
                  {...register('category')}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" isLoading={isSaving} loadingText="Saving…">
                Save Changes
              </Button>
            </div>
          </form>
        </TabsContent>

        {/* ── Team ── */}
        <TabsContent value="team" className="pt-6 space-y-6">
          {/* Current members */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Team Members</CardTitle>
              <CardDescription>{members.length} member{members.length !== 1 ? 's' : ''}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-0">
              {members.map((m, i) => {
                const p = m.profiles as Profile
                return (
                  <div key={m.id}>
                    {i > 0 && <Separator />}
                    <div className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          {p?.avatar_url && <AvatarImage src={p.avatar_url} />}
                          <AvatarFallback className="text-xs bg-stone-100 text-stone-600">
                            {getInitials(p?.first_name ?? null, p?.last_name ?? null)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium text-stone-800">
                            {getFullName(p?.first_name ?? null, p?.last_name ?? null)}
                          </p>
                          <p className="text-xs text-stone-400">{p?.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-stone-500 capitalize bg-stone-100 px-2 py-0.5 rounded-full">
                          {m.role}
                        </span>
                        {m.role !== 'owner' && myRole === 'owner' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-stone-400 hover:text-red-500"
                            onClick={() => removeMember(m.id, getFullName(p?.first_name ?? null, p?.last_name ?? null))}
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
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                Invite Member
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <form onSubmit={handleInviteSubmit(sendInvite)} className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
                    <Input
                      {...registerInvite('email')}
                      className="pl-9"
                      placeholder="colleague@school.edu"
                      type="email"
                    />
                  </div>
                  <Select
                    defaultValue="reviewer"
                    onValueChange={(v) => setInviteValue('role', v as 'admin' | 'reviewer')}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reviewer">Reviewer</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="submit" isLoading={isInviting} loadingText="Sending…">
                    Send Invite
                  </Button>
                </div>
                {inviteErrors.email && (
                  <p className="text-xs text-red-500">{inviteErrors.email.message}</p>
                )}
              </form>
            </CardContent>
          </Card>

          {/* Pending invites */}
          {pendingInvites.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-stone-500">Pending Invitations</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {pendingInvites.map((invite) => (
                  <div key={invite.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm text-stone-700">{invite.email}</p>
                      <p className="text-xs text-stone-400 capitalize">{invite.role}</p>
                    </div>
                    <span className="text-xs text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full">
                      Pending
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Danger Zone ── */}
        <TabsContent value="danger" className="pt-6">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-red-800">Archive Organization</h3>
                <p className="text-sm text-red-600 mt-1">
                  Archiving will deactivate this organization and hide it from public listings.
                  All cycles and applications will be preserved. This action can be reversed by
                  an Marrow administrator.
                </p>
              </div>
            </div>
            <Button
              variant="destructive"
              onClick={() => setIsArchiveOpen(true)}
            >
              Archive {org.name}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* Archive confirmation dialog */}
      <Dialog open={isArchiveOpen} onOpenChange={setIsArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Organization</DialogTitle>
            <DialogDescription>
              This will deactivate <strong>{org.name}</strong>. To confirm, type the
              organization name exactly as shown below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-medium text-stone-700 bg-stone-100 rounded-md px-3 py-2">
              {org.name}
            </p>
            <Input
              value={archiveConfirm}
              onChange={(e) => setArchiveConfirm(e.target.value)}
              placeholder={`Type "${org.name}" to confirm`}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsArchiveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={archiveConfirm !== org.name}
              onClick={archiveOrg}
            >
              Archive Organization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
