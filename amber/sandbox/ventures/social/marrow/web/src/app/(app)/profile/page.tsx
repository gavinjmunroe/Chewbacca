'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2, Upload, ExternalLink, Github, Linkedin, Globe } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { profileSchema, type ProfileInput } from '@/lib/validations'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { getInitials, getFullName } from '@/lib/utils'
import type { Profile } from '@/types/database'

const GRAD_YEARS = Array.from({ length: 12 }, (_, i) => 2020 + i)

export default function ProfilePage() {
  const router = useRouter()
  const supabase = createClient()

  const [profile, setProfile] = React.useState<Profile | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = React.useState(false)
  const [avatarPreview, setAvatarPreview] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty },
    reset,
  } = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      headline: '',
      school: '',
      graduation_year: null,
      major: '',
      bio: '',
      linkedin_url: '',
      github_url: '',
      website_url: '',
    },
  })

  const watchedValues = watch()

  React.useEffect(() => {
    const loadProfile = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (data) {
        setProfile(data)
        setAvatarPreview(data.avatar_url)
        reset({
          first_name: data.first_name ?? '',
          last_name: data.last_name ?? '',
          headline: data.headline ?? '',
          school: data.school ?? '',
          graduation_year: data.graduation_year ?? null,
          major: data.major ?? '',
          bio: data.bio ?? '',
          linkedin_url: data.linkedin_url ?? '',
          github_url: data.github_url ?? '',
          website_url: data.website_url ?? '',
        })
      }
      setIsLoading(false)
    }

    loadProfile()
  }, [supabase, router, reset])

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('bucket', 'avatars')

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Upload failed')
      }

      const { url } = await res.json()
      setAvatarPreview(url)

      // Save avatar_url immediately
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from('profiles')
          .update({ avatar_url: url })
          .eq('id', user.id)
      }

      toast.success('Profile photo updated')
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to upload photo')
    } finally {
      setIsUploadingAvatar(false)
    }
  }

  const onSubmit = async (data: ProfileInput) => {
    setIsSaving(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('profiles')
        .update({
          ...data,
          headline: data.headline || null,
          school: data.school || null,
          major: data.major || null,
          bio: data.bio || null,
          linkedin_url: data.linkedin_url || null,
          github_url: data.github_url || null,
          website_url: data.website_url || null,
        })
        .eq('id', user.id)

      if (error) throw error

      toast.success('Profile saved')
      router.refresh()
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to save profile')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
      </div>
    )
  }

  const previewName = getFullName(watchedValues.first_name || null, watchedValues.last_name || null)
  const previewInitials = getInitials(watchedValues.first_name || null, watchedValues.last_name || null)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Edit Profile</h1>
        <p className="text-sm text-stone-500 mt-1">
          Your profile is visible to organizations you apply to.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form — 2 cols */}
          <div className="lg:col-span-2 space-y-6">
            {/* Avatar */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Profile Photo</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  {avatarPreview && <AvatarImage src={avatarPreview} alt="Avatar" />}
                  <AvatarFallback className="text-base font-semibold bg-stone-900 text-stone-50">
                    {previewInitials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleAvatarUpload}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    isLoading={isUploadingAvatar}
                    loadingText="Uploading..."
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload Photo
                  </Button>
                  <p className="text-xs text-stone-400 mt-1.5">JPG, PNG, WebP · max 5 MB</p>
                </div>
              </CardContent>
            </Card>

            {/* Basic Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="first_name">First Name *</Label>
                    <Input
                      id="first_name"
                      placeholder="Jane"
                      {...register('first_name')}
                    />
                    {errors.first_name && (
                      <p className="text-xs text-red-500">{errors.first_name.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="last_name">Last Name *</Label>
                    <Input
                      id="last_name"
                      placeholder="Smith"
                      {...register('last_name')}
                    />
                    {errors.last_name && (
                      <p className="text-xs text-red-500">{errors.last_name.message}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="headline">Headline</Label>
                  <Input
                    id="headline"
                    placeholder="e.g. Junior at USC studying Computer Science"
                    {...register('headline')}
                  />
                  {errors.headline && (
                    <p className="text-xs text-red-500">{errors.headline.message}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="school">School</Label>
                    <Input
                      id="school"
                      placeholder="University of Southern California"
                      {...register('school')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="graduation_year">Graduation Year</Label>
                    <Select
                      value={watchedValues.graduation_year?.toString() ?? ''}
                      onValueChange={(val) =>
                        setValue('graduation_year', val ? parseInt(val) : null, {
                          shouldDirty: true,
                        })
                      }
                    >
                      <SelectTrigger id="graduation_year">
                        <SelectValue placeholder="Select year" />
                      </SelectTrigger>
                      <SelectContent>
                        {GRAD_YEARS.map((yr) => (
                          <SelectItem key={yr} value={yr.toString()}>
                            {yr}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="major">Major</Label>
                  <Input
                    id="major"
                    placeholder="Computer Science"
                    {...register('major')}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="bio">Bio</Label>
                  <Textarea
                    id="bio"
                    placeholder="Tell organizations a bit about yourself..."
                    rows={4}
                    {...register('bio')}
                  />
                  <p className="text-xs text-stone-400">
                    {watchedValues.bio?.length ?? 0}/500 characters
                  </p>
                  {errors.bio && (
                    <p className="text-xs text-red-500">{errors.bio.message}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Links */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Links</CardTitle>
                <CardDescription>
                  Share your online presence with organizations.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="linkedin_url" className="flex items-center gap-1.5">
                    <Linkedin className="h-3.5 w-3.5" />
                    LinkedIn
                  </Label>
                  <Input
                    id="linkedin_url"
                    placeholder="https://linkedin.com/in/yourname"
                    {...register('linkedin_url')}
                  />
                  {errors.linkedin_url && (
                    <p className="text-xs text-red-500">{errors.linkedin_url.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="github_url" className="flex items-center gap-1.5">
                    <Github className="h-3.5 w-3.5" />
                    GitHub
                  </Label>
                  <Input
                    id="github_url"
                    placeholder="https://github.com/yourname"
                    {...register('github_url')}
                  />
                  {errors.github_url && (
                    <p className="text-xs text-red-500">{errors.github_url.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="website_url" className="flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5" />
                    Website
                  </Label>
                  <Input
                    id="website_url"
                    placeholder="https://yoursite.com"
                    {...register('website_url')}
                  />
                  {errors.website_url && (
                    <p className="text-xs text-red-500">{errors.website_url.message}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
              <Button
                type="submit"
                isLoading={isSaving}
                loadingText="Saving..."
                disabled={!isDirty}
              >
                Save Profile
              </Button>
            </div>
          </div>

          {/* Preview Card */}
          <div className="lg:col-span-1">
            <div className="sticky top-24">
              <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-3">
                Preview
              </p>
              <Card>
                <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                  <Avatar className="h-16 w-16">
                    {avatarPreview && <AvatarImage src={avatarPreview} alt="Avatar" />}
                    <AvatarFallback className="text-base font-semibold bg-stone-900 text-stone-50">
                      {previewInitials}
                    </AvatarFallback>
                  </Avatar>

                  <div>
                    <p className="font-semibold text-stone-900">{previewName}</p>
                    {watchedValues.headline && (
                      <p className="text-xs text-stone-500 mt-0.5">{watchedValues.headline}</p>
                    )}
                  </div>

                  {(watchedValues.school || watchedValues.graduation_year || watchedValues.major) && (
                    <div className="text-xs text-stone-500 space-y-0.5">
                      {watchedValues.school && <p>{watchedValues.school}</p>}
                      {watchedValues.major && (
                        <p>
                          {watchedValues.major}
                          {watchedValues.graduation_year
                            ? ` · ${watchedValues.graduation_year}`
                            : ''}
                        </p>
                      )}
                    </div>
                  )}

                  {watchedValues.bio && (
                    <>
                      <Separator />
                      <p className="text-xs text-stone-500 text-left w-full line-clamp-4">
                        {watchedValues.bio}
                      </p>
                    </>
                  )}

                  {(watchedValues.linkedin_url ||
                    watchedValues.github_url ||
                    watchedValues.website_url) && (
                    <>
                      <Separator />
                      <div className="flex items-center gap-3">
                        {watchedValues.linkedin_url && (
                          <a
                            href={watchedValues.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-stone-400 hover:text-stone-700 transition-colors"
                          >
                            <Linkedin className="h-4 w-4" />
                          </a>
                        )}
                        {watchedValues.github_url && (
                          <a
                            href={watchedValues.github_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-stone-400 hover:text-stone-700 transition-colors"
                          >
                            <Github className="h-4 w-4" />
                          </a>
                        )}
                        {watchedValues.website_url && (
                          <a
                            href={watchedValues.website_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-stone-400 hover:text-stone-700 transition-colors"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
