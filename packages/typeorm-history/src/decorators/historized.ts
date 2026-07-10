import { HistorizedOptions, registerHistorized } from '../metadata/registry';

/**
 * Marks a TypeORM entity for history tracking. Combined with
 * {@link historyEntities} and {@link HistorySubscriber}, every insert,
 * update, and delete on the entity writes a snapshot row to a generated
 * `<table>_history` shadow table.
 */
export function Historized(options: HistorizedOptions = {}): ClassDecorator {
  return (target) => {
    registerHistorized(target, options);
  };
}
