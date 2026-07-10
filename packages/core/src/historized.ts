import { HistorizedOptions, registerHistorized } from './registry';

/**
 * Marks an entity for history tracking. Combined with the adapter's
 * `historyEntities` and `HistorySubscriber`, every insert, update, and
 * delete on the entity writes a snapshot row to a generated
 * `<table>_history` shadow table.
 */
export function Historized(options: HistorizedOptions = {}): ClassDecorator {
  return (target) => {
    registerHistorized(target, options);
  };
}
