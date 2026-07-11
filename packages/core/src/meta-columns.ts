/** Column names used on every generated history table. */
export const META = {
  id: 'history_id',
  type: 'history_type',
  date: 'history_date',
  user: 'history_user_id',
  reason: 'history_change_reason',
} as const;

/** The value of `history_type` on a history row. */
export type HistoryType = 'create' | 'update' | 'delete';
