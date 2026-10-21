interface ItemWithId {
  id: number
  [key: string]: unknown
}

export function swapItems(items: ItemWithId[], index: number, direction: 'up' | 'down'): number[] | null {
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= items.length) return null
  const ids = items.map((a) => a.id)
  ;[ids[index], ids[target]] = [ids[target], ids[index]]
  return ids
}
