'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Upload,
  Trash2,
  Star,
  FileText,
  Loader2,
  FolderOpen,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { formatDate, formatFileSize, ARTIFACT_TYPE_LABELS } from '@/lib/utils'
import type { Artifact } from '@/types/database'

type ArtifactType = Artifact['artifact_type']

const ARTIFACT_TYPES: { value: ArtifactType; label: string }[] = [
  { value: 'resume', label: 'Resume' },
  { value: 'transcript', label: 'Transcript' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'writing_sample', label: 'Writing Sample' },
  { value: 'other', label: 'Other' },
]

const TYPE_ORDER: ArtifactType[] = [
  'resume',
  'transcript',
  'portfolio',
  'writing_sample',
  'other',
]

function groupByType(artifacts: Artifact[]): Record<ArtifactType, Artifact[]> {
  const groups: Partial<Record<ArtifactType, Artifact[]>> = {}
  for (const artifact of artifacts) {
    if (!groups[artifact.artifact_type]) {
      groups[artifact.artifact_type] = []
    }
    groups[artifact.artifact_type]!.push(artifact)
  }
  return groups as Record<ArtifactType, Artifact[]>
}

export default function VaultPage() {
  const router = useRouter()
  const supabase = createClient()

  const [artifacts, setArtifacts] = React.useState<Artifact[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [uploadDialogOpen, setUploadDialogOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<Artifact | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)

  // Upload form state
  const [uploadFile, setUploadFile] = React.useState<File | null>(null)
  const [uploadType, setUploadType] = React.useState<ArtifactType>('resume')
  const [uploadName, setUploadName] = React.useState('')
  const [isUploading, setIsUploading] = React.useState(false)

  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const loadArtifacts = React.useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data } = await supabase
      .from('artifacts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    setArtifacts(data ?? [])
    setIsLoading(false)
  }, [supabase, router])

  React.useEffect(() => {
    loadArtifacts()
  }, [loadArtifacts])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    if (!uploadName) {
      setUploadName(file.name.replace(/\.[^.]+$/, ''))
    }
  }

  const handleUpload = async () => {
    if (!uploadFile) {
      toast.error('Please select a file')
      return
    }
    if (!uploadName.trim()) {
      toast.error('Please enter a name for this artifact')
      return
    }

    setIsUploading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const formData = new FormData()
      formData.append('file', uploadFile)
      formData.append('bucket', 'artifacts')

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Upload failed')
      }

      const { url } = await res.json()

      const { error } = await supabase.from('artifacts').insert({
        user_id: user.id,
        artifact_type: uploadType,
        name: uploadName.trim(),
        file_url: url,
        file_size: uploadFile.size,
        mime_type: uploadFile.type,
      })

      if (error) throw error

      toast.success('Artifact uploaded successfully')
      setUploadDialogOpen(false)
      setUploadFile(null)
      setUploadName('')
      setUploadType('resume')
      await loadArtifacts()
    } catch (err: any) {
      toast.error(err.message ?? 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  const handleSetPrimary = async (artifact: Artifact) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      // Unset all primaries of same type
      await supabase
        .from('artifacts')
        .update({ is_primary: false })
        .eq('user_id', user.id)
        .eq('artifact_type', artifact.artifact_type)

      // Set this one as primary
      const { error } = await supabase
        .from('artifacts')
        .update({ is_primary: true })
        .eq('id', artifact.id)

      if (error) throw error

      toast.success(`Set as primary ${ARTIFACT_TYPE_LABELS[artifact.artifact_type]}`)
      await loadArtifacts()
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to update')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      const { error } = await supabase
        .from('artifacts')
        .delete()
        .eq('id', deleteTarget.id)

      if (error) throw error

      toast.success('Artifact deleted')
      setDeleteTarget(null)
      await loadArtifacts()
    } catch (err: any) {
      toast.error(err.message ?? 'Delete failed')
    } finally {
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
      </div>
    )
  }

  const grouped = groupByType(artifacts)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">My Vault</h1>
          <p className="text-sm text-stone-500 mt-1">
            Upload once, attach to any application. Your primary artifacts are pre-selected automatically.
          </p>
        </div>
        <Button onClick={() => setUploadDialogOpen(true)}>
          <Upload className="h-4 w-4" />
          Upload New
        </Button>
      </div>

      {/* Empty state */}
      {artifacts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FolderOpen className="h-12 w-12 text-stone-300 mb-4" />
            <p className="font-medium text-stone-700">Your vault is empty</p>
            <p className="text-sm text-stone-400 mt-1 mb-4">
              Upload your resume, transcripts, and more to reuse across applications.
            </p>
            <Button onClick={() => setUploadDialogOpen(true)}>
              <Upload className="h-4 w-4" />
              Upload Your First Artifact
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {TYPE_ORDER.map((type) => {
            const items = grouped[type]
            if (!items || items.length === 0) return null

            return (
              <div key={type}>
                <h2 className="text-sm font-semibold text-stone-700 mb-3 flex items-center gap-2">
                  {ARTIFACT_TYPE_LABELS[type]}
                  <span className="text-stone-400 font-normal">({items.length})</span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {items.map((artifact) => (
                    <Card
                      key={artifact.id}
                      className={artifact.is_primary ? 'border-stone-900 ring-1 ring-stone-900' : ''}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="p-2 bg-stone-100 rounded-lg shrink-0">
                            <FileText className="h-5 w-5 text-stone-600" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-stone-900 text-sm truncate">
                                {artifact.name}
                              </p>
                              {artifact.is_primary && (
                                <Badge variant="secondary" className="text-xs shrink-0">
                                  Primary
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-stone-400">
                              <span>{formatFileSize(artifact.file_size)}</span>
                              <span>·</span>
                              <span>{formatDate(artifact.created_at)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mt-3">
                          <a
                            href={artifact.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-stone-500 hover:text-stone-900 underline underline-offset-2"
                          >
                            View file
                          </a>
                          <div className="ml-auto flex items-center gap-1.5">
                            {!artifact.is_primary && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleSetPrimary(artifact)}
                                className="h-7 text-xs gap-1"
                              >
                                <Star className="h-3 w-3" />
                                Set Primary
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteTarget(artifact)}
                              className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 gap-1"
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Artifact</DialogTitle>
            <DialogDescription>
              Add a document to your vault. Accepted formats: PDF, DOC, DOCX.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>File</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                {uploadFile ? uploadFile.name : 'Choose file'}
              </Button>
              {uploadFile && (
                <p className="text-xs text-stone-400">{formatFileSize(uploadFile.size)}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="artifact_type">Type</Label>
              <Select
                value={uploadType}
                onValueChange={(val) => setUploadType(val as ArtifactType)}
              >
                <SelectTrigger id="artifact_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ARTIFACT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="artifact_name">Name</Label>
              <Input
                id="artifact_name"
                placeholder="e.g. Resume Spring 2026"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setUploadDialogOpen(false)
                setUploadFile(null)
                setUploadName('')
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              isLoading={isUploading}
              loadingText="Uploading..."
              disabled={!uploadFile || !uploadName.trim()}
            >
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Artifact</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              isLoading={isDeleting}
              loadingText="Deleting..."
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
