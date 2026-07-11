import { Inject } from '@nestjs/common';
import type { DataSource, DataSourceOptions } from 'typeorm';

/** DI token for the resolved `HistoryModuleOptions`. */
export const HISTORY_MODULE_OPTIONS = Symbol('HISTORY_MODULE_OPTIONS');

/** How a target `DataSource` is referenced, mirroring `@nestjs/typeorm`: by name, options, or instance. Omit for the default one. */
export type HistoryDataSourceRef = DataSource | DataSourceOptions | string;

function dataSourceName(dataSource?: HistoryDataSourceRef): string {
  if (!dataSource) return 'default';
  if (typeof dataSource === 'string') return dataSource;
  return ((dataSource as DataSourceOptions).name as string | undefined) ?? 'default';
}

// Tokens are strings built from the bare class name, so two classes that
// happen to share a name would silently shadow each other in the DI
// container. Remember which class owns each token and fail loudly instead.
const tokenOwners = new Map<string, Function>();

/** DI token for the `HistoryRepository<Entity>` provided by `HistoryModule.forFeature([Entity], dataSource?)`. */
export function getHistoryRepositoryToken(entity: Function, dataSource?: HistoryDataSourceRef): string {
  const ds = dataSourceName(dataSource);
  const token =
    ds === 'default' ? `HISTORY_REPOSITORY_${entity.name}` : `HISTORY_REPOSITORY_${ds}_${entity.name}`;
  const owner = tokenOwners.get(token);
  if (owner && owner !== entity)
    throw new Error(
      `[entity-history] two different classes named '${entity.name}' resolve to the same ` +
        `injection token '${token}'. Rename one of the classes.`,
    );
  tokenOwners.set(token, entity);
  return token;
}

/** Injects the `HistoryRepository<Entity>` registered via `HistoryModule.forFeature([Entity], dataSource?)`. */
export function InjectHistoryRepository(entity: Function, dataSource?: HistoryDataSourceRef): ParameterDecorator {
  return Inject(getHistoryRepositoryToken(entity, dataSource));
}
