'use client'

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { CalendarIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cycleSchema, type CycleInput } from '@/lib/validations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function NewCyclePage() {
  const router = useRouter()
  const params = useParams()
  const orgSlug = params.orgSlug as string
  const supabase = createClient()
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CycleInput>({
    resolver: zodResolver(cycleSchema),
    defaultValues: {
      name: '',
      description: '',
      is_public: true,
      max_applicants: null,
      target_class_size: null,
      application_open_at: null,
      application_close_at: null,
    },
  })

  const isPublic = watch('is_public')

  const onSubmit = async (data: CycleInput) => {
    setIsSubmitting(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        toast.error('You must be signed in')
        return
      }

      // Get org ID from slug
      const { data: org } = await supabase
        .from('organizations')
        .select('id')
        .eq('slug', orgSlug)
        .single()

      if (!org) {
        toast.error('Organization not found')
        return
      }

      const { data: cycle, error } = await supabase
        .from('cycles')
        .insert({
          org_id: org.id,
          name: data.name,
          description: data.description || null,
          application_open_at: data.application_open_at || null,
          application_close_at: data.application_close_at || null,
          max_applicants: data.max_applicants || null,
          target_class_size: data.target_class_size || null,
          is_public: data.is_public,
          created_by: user.id,
          settings: {},
        })
        .select()
        .single()

      if (error) {
        toast.error('Failed to create cycle')
        setIsSubmitting(false)
        return
      }

      toast.success('Cycle created! Now set up your stages.')
      router.push(`/admin/${orgSlug}/cycles/${cycle.id}/stages`)
    } catch {
      toast.error('Something went wrong')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="text-xs text-stone-400 hover:text-stone-600 mb-4 flex items-center gap-1"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-semibold text-stone-900">Create Recruiting Cycle</h1>
          <p className="mt-1 text-sm text-stone-500">
            A cycle is one full recruiting season: Fall Rush, Spring Rush, etc.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cycle Details</CardTitle>
              <CardDescription>Define the name and purpose of this cycle.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">
                  Cycle Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="e.g. Fall 2026 Rush"
                  {...register('name')}
                />
                {errors.name && (
                  <p className="text-xs text-red-600">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  rows={3}
                  placeholder="Describe what applicants can expect during this cycle..."
                  {...register('description')}
                />
                {errors.description && (
                  <p className="text-xs text-red-600">{errors.description.message}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Dates */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Application Window</CardTitle>
              <CardDescription>
                Set when applications open and close. You can leave these blank and set them later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="open_date">
                    <CalendarIcon className="inline h-3.5 w-3.5 mr-1 text-stone-400" />
                    Opens
                  </Label>
                  <Input
                    id="open_date"
                    type="datetime-local"
                    {...register('application_open_at')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="close_date">
                    <CalendarIcon className="inline h-3.5 w-3.5 mr-1 text-stone-400" />
                    Closes
                  </Label>
                  <Input
                    id="close_date"
                    type="datetime-local"
                    {...register('application_close_at')}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Capacity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Capacity</CardTitle>
              <CardDescription>
                Optionally cap the number of applications or set a target class size.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="max_applicants">Max Applicants</Label>
                  <Input
                    id="max_applicants"
                    type="number"
                    min={1}
                    placeholder="Unlimited"
                    {...register('max_applicants', { valueAsNumber: true })}
                  />
                  {errors.max_applicants && (
                    <p className="text-xs text-red-600">{errors.max_applicants.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="target_class_size">Target Class Size</Label>
                  <Input
                    id="target_class_size"
                    type="number"
                    min={1}
                    placeholder="e.g. 20"
                    {...register('target_class_size', { valueAsNumber: true })}
                  />
                  {errors.target_class_size && (
                    <p className="text-xs text-red-600">{errors.target_class_size.message}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Visibility */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Visibility</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-stone-900">Public cycle</p>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {isPublic
                      ? 'Anyone can discover and apply to this cycle'
                      : 'Only people with the link can apply'}
                  </p>
                </div>
                <Switch
                  checked={isPublic}
                  onCheckedChange={(val) => setValue('is_public', val)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Cycle & Build Stages →'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
