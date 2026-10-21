import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Allowed MIME types per bucket category
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

// Buckets that accept images vs. documents
const IMAGE_BUCKETS = new Set(['avatars', 'org-assets'])
const DOCUMENT_BUCKETS = new Set(['artifacts'])

const MAX_IMAGE_SIZE = 5 * 1024 * 1024    // 5 MB
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024 // 10 MB

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9._-]/gi, '_').toLowerCase()
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Auth check
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const bucket = formData.get('bucket') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!bucket) {
      return NextResponse.json({ error: 'No bucket specified' }, { status: 400 })
    }

    const isImageBucket = IMAGE_BUCKETS.has(bucket)
    const isDocumentBucket = DOCUMENT_BUCKETS.has(bucket)

    if (!isImageBucket && !isDocumentBucket) {
      return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 })
    }

    // MIME validation
    if (isImageBucket && !IMAGE_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: jpg, png, gif, webp' },
        { status: 400 }
      )
    }
    if (isDocumentBucket && !DOCUMENT_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: pdf, doc, docx' },
        { status: 400 }
      )
    }

    // Size validation
    const maxSize = isImageBucket ? MAX_IMAGE_SIZE : MAX_DOCUMENT_SIZE
    if (file.size > maxSize) {
      const maxMB = maxSize / (1024 * 1024)
      return NextResponse.json(
        { error: `File too large. Maximum size is ${maxMB}MB` },
        { status: 400 }
      )
    }

    // Build storage path: {userId}/{timestamp}_{sanitizedName}
    const timestamp = Date.now()
    const safeName = sanitizeFilename(file.name)
    const storagePath = `${user.id}/${timestamp}_${safeName}`

    const buffer = await file.arrayBuffer()

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('[upload] storage error:', uploadError.message)
      return NextResponse.json(
        { error: 'Upload failed', details: uploadError.message },
        { status: 500 }
      )
    }

    // Get public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from(bucket).getPublicUrl(uploadData.path)

    return NextResponse.json({
      url: publicUrl,
      path: uploadData.path,
      size: file.size,
    })
  } catch (err) {
    console.error('[upload] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
