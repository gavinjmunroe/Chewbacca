import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Navbar } from '@/components/nav/navbar'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?next=/admin')
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <Navbar />
      <div className="flex h-[calc(100vh-3.5rem)]">{children}</div>
    </div>
  )
}
