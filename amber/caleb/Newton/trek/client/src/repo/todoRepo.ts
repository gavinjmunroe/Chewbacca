import { todoApi } from '../api/client'
import { offlineDb, upsertTodoItems } from '../db/offlineDb'
import type { TodoItem } from '../types'

export const todoRepo = {
  async list(tripId: number | string): Promise<{ items: TodoItem[] }> {
    if (!navigator.onLine) {
      const cached = await offlineDb.todoItems
        .where('trip_id')
        .equals(Number(tripId))
        .toArray()
      return { items: cached }
    }
    const result = await todoApi.list(tripId)
    upsertTodoItems(result.items)
    return result
  },
}
