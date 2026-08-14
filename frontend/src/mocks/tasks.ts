import type { OpsTask } from '@/types/domain'

export const MOCK_TASKS: Record<string, OpsTask[]> = {
  'abc-motors': [
    { id: 'task-1', clientId: 'abc-motors', title: 'Shoot walkaround video — 2023 Mazda CX-5', assignee: 'Content Creator', dueDate: '2026-08-15', status: 'in_progress', recurring: false, overdue: false },
    { id: 'task-2', clientId: 'abc-motors', title: 'Publish inspection PDF — 6 remaining listings', assignee: 'Content Creator', dueDate: '2026-08-14', status: 'todo', recurring: false, overdue: true },
    { id: 'task-3', clientId: 'abc-motors', title: 'Weekly GBP post — proof angle', assignee: 'Content Creator', dueDate: '2026-08-18', status: 'todo', recurring: true, overdue: false },
    { id: 'task-4', clientId: 'abc-motors', title: 'Client approval — Angle B reel', assignee: 'Dave Ranford (Client)', dueDate: '2026-08-14', status: 'awaiting_approval', recurring: false, overdue: false },
    { id: 'task-5', clientId: 'abc-motors', title: 'Draft warranty claims SLA doc', assignee: 'Operations', dueDate: '2026-08-20', status: 'blocked', recurring: false, overdue: false },
    { id: 'task-6', clientId: 'abc-motors', title: 'Monthly performance report', assignee: 'Strategist', dueDate: '2026-08-31', status: 'todo', recurring: true, overdue: false },
  ],
  'apni-dukaan': [],
  'smplee-packaging': [],
}
