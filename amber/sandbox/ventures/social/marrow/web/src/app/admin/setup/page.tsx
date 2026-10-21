'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Building2, Upload, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { organizationSchema, type OrganizationInput } from '@/lib/validations'
import { slugify, ORG_CATEGORIES } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export default function SetupPage() {
  const router = useRouter()
  const supabase = createClient()
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [logoPreview, setLogoPreview] = React.useState<string | null>(null)
  const [logoFile, setLogoFile] = React.useState<File | null>(null)
  const [slugManuallyEdited, setSlugManuallyEdited] = React.useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<OrganizationInput>({
    resolver: zodResolver(organizationSchema),
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      school: '',
      category: '',
      website: '',
    },
  })

  const nameValue = watch('name')

  React.useEffect(() => {
    if (!slugManuallyEdited && nameValue) {
      setValue('slug', slugify(nameValue), { shouldValidate: true })
    }
  }, [nameValue, slugManuallyEdited, setValue])

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be under 2 MB')
      return
    }
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = () => setLogoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const removeLogo = () => {
    setLogoFile(null)
    setLogoPreview(null)
  }

  const onSubmit = async (data: OrganizationInput) => {
    setIsSubmitting(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        toast.error('You must be signed in')
        router.push('/login')
        return
      }

      // Upload logo if present
      let logoUrl: string | null = null
      if (logoFile) {
        const ext = logoFile.name.split('.').pop()
        const path = `org-logos/${data.slug}-${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('assets')
          .upload(path, logoFile, { upsert: true })
        if (uploadError) {
          toast.error('Failed to upload logo')
          setIsSubmitting(false)
          return
        }
        const { data: urlData } = supabase.storage.from('assets').getPublicUrl(path)
        logoUrl = urlData.publicUrl
      }

      // Create org
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .insert({
          name: data.name,
          slug: data.slug,
          description: data.description || null,
          school: data.school || null,
          category: data.category || null,
          website: data.website || null,
          logo_url: logoUrl,
          created_by: user.id,
        })
        .select()
        .single()

      if (orgError) {
        if (orgError.code === '23505') {
          toast.error('That slug is already taken. Please choose a different one.')
        } else {
          toast.error('Failed to create organization')
        }
        setIsSubmitting(false)
        return
      }

      // Add creator as owner
      const { error: memberError } = await supabase.from('org_members').insert({
        org_id: org.id,
        user_id: user.id,
        role: 'owner',
        invited_by: user.id,
        accepted_at: new Date().toISOString(),
      })

      if (memberError) {
        toast.error('Organization created but failed to set up membership')
      }

      toast.success('Organization created!')
      router.push(`/admin/${org.slug}`)
    } catch {
      toast.error('Something went wrong. Please try again.')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-900 mb-4">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-stone-900">Create your organization</h1>
          <p className="mt-1 text-sm text-stone-500">
            Set up your club or organization on Marrow to start managing your recruiting process.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Basic Information</CardTitle>
              <CardDescription>How your organization appears to applicants.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Logo */}
              <div className="space-y-2">
                <Label>Logo</Label>
                {logoPreview ? (
                  <div className="relative inline-flex">
                    <img
                      src={logoPreview}
                      alt="Logo preview"
                      className="h-20 w-20 rounded-lg object-cover border border-stone-200"
                    />
                    <button
                      type="button"
                      onClick={removeLogo}
                      className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-stone-900 text-white flex items-center justify-center hover:bg-stone-700"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-stone-200 hover:border-stone-400 hover:bg-stone-50 transition-colors">
                    <Upload className="h-5 w-5 text-stone-400" />
                    <span className="mt-1 text-xs text-stone-400">Upload</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={handleLogoChange}
                    />
                  </label>
                )}
                <p className="text-xs text-stone-400">PNG, JPG up to 2 MB</p>
              </div>

              <Separator />

              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="name">
                  Organization Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="e.g. Trojan Consulting Group"
                  {...register('name')}
                />
                {errors.name && (
                  <p className="text-xs text-red-600">{errors.name.message}</p>
                )}
              </div>

              {/* Slug */}
              <div className="space-y-1.5">
                <Label htmlFor="slug">
                  URL Slug <span className="text-red-500">*</span>
                </Label>
                <div className="flex items-center gap-0">
                  <span className="inline-flex h-9 items-center rounded-l-md border border-r-0 border-stone-200 bg-stone-50 px-3 text-sm text-stone-500">
                    marrow.app/
                  </span>
                  <Input
                    id="slug"
                    className="rounded-l-none"
                    placeholder="trojan-consulting-group"
                    {...register('slug', {
                      onChange: () => setSlugManuallyEdited(true),
                    })}
                  />
                </div>
                {errors.slug && (
                  <p className="text-xs text-red-600">{errors.slug.message}</p>
                )}
                <p className="text-xs text-stone-400">
                  Lowercase letters, numbers, and hyphens only. Cannot be changed later.
                </p>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  rows={3}
                  placeholder="Tell applicants what your organization is about..."
                  {...register('description')}
                />
                {errors.description && (
                  <p className="text-xs text-red-600">{errors.description.message}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Organization Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* School */}
              <div className="space-y-1.5">
                <Label htmlFor="school">School / University</Label>
                <Input
                  id="school"
                  placeholder="e.g. University of Southern California"
                  {...register('school')}
                />
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select onValueChange={(val) => setValue('category', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {ORG_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Website */}
              <div className="space-y-1.5">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  type="url"
                  placeholder="https://your-org.com"
                  {...register('website')}
                />
                {errors.website && (
                  <p className="text-xs text-red-600">{errors.website.message}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Organization'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
