import { Inject } from '@nestjs/common';

/** DI token for the resolved `HistoryModuleOptions`. */
export const HISTORY_MODULE_OPTIONS = Symbol('HISTORY_MODULE_OPTIONS');

/** How a target MikroORM instance is referenced: by `contextName`. Omit for the default one. */
export type HistoryContextRef = string | undefined;

function contextNameOf(contextName?: HistoryContextRef): string {
  return contextName ?? 'default';
}

// Tokens are strings built from the bare class name, so two classes that
// happen to share a name would silently shadow each other in the DI
// container. Remember which class owns each token and fail loudly instead.
const tokenOwners = new Map<string, Function>();

/** DI token for the `HistoryRepository<Entity>` provided by `HistoryModule.forFeature([Entity], contextName?)`. */
export function getHistoryRepositoryToken(entity: Function, contextName?: HistoryContextRef): string {
  const ctx = contextNameOf(contextName);
  const token =
    ctx === 'default' ? `HISTORY_REPOSITORY_${entity.name}` : `HISTORY_REPOSITORY_${ctx}_${entity.name}`;
  const owner = tokenOwners.get(token);
  if (owner && owner !== entity)
    throw new Error(
      `[entity-history] two different classes named '${entity.name}' resolve to the same ` +
        `injection token '${token}'. Rename one of the classes.`,
    );
  tokenOwners.set(token, entity);
  return token;
}

/** Injects the `HistoryRepository<Entity>` registered via `HistoryModule.forFeature([Entity], contextName?)`. */
export function InjectHistoryRepository(entity: Function, contextName?: HistoryContextRef): ParameterDecorator {
  return Inject(getHistoryRepositoryToken(entity, contextName));
}
