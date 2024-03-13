/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ApolloClient,
  ApolloError,
  ApolloQueryResult,
  DocumentNode,
  ObservableQuery,
  TypedDocumentNode,
  WatchQueryFetchPolicy,
  useApolloClient,
} from "@apollo/client";
import { Modifiers } from "@apollo/client/cache";
import equal from "@wry/equality";
import { useLayoutEffect, useRef, useState } from "react";

export type AnyFunc = (...args: any[]) => any;

export type OperationDefBase = { fetchPolicy?: WatchQueryFetchPolicy };

export type TypedDefinitionOptions<TData, TVariables> = OperationDefBase & {
  gql: TypedDocumentNode<TData, TVariables>;
};

export type TypedOperationOptionsArgs<TVariables> = {} extends TVariables
  ? [options?: OperationDefBase]
  : [options: { variables: TVariables } & OperationDefBase];

/**
 * infer type of query data from query options
 */
export type OperationResult<TOptions> = TOptions extends
  | null
  | false
  | undefined
  ? OperationResult<Exclude<TOptions, null | false | undefined>> | undefined
  : TOptions extends TypedDefinitionOptions<infer D, any>
  ? D
  : undefined;

export type VariablesOverride<
  TQueries extends Record<string, TypedDefinitionOptions<any, any>>,
  TOverride
> = TOverride extends { $: infer TQuery } & infer TVariables
  ? TQuery extends keyof TQueries
    ? TQueries[TQuery] extends TypedDefinitionOptions<
        infer TData,
        infer TFullVariables
      >
      ? TVariables extends Partial<TFullVariables>
        ? TData
        : never
      : never
    : never
  : never;

export type UpdateData<T> = T | ((prev: T) => T | void);

export type GraphAPI<
  TDefinitions extends Record<string, TypedDefinitionOptions<any, any>>
> = {
  refetch(fresh?: boolean): void;

  refetch(
    filter: (key: keyof TDefinitions, variables: any) => boolean,
    fresh?: boolean
  ): void;

  refetch(
    key: keyof TDefinitions | (keyof TDefinitions)[],
    fresh?: boolean
  ): void;

  preload(key: keyof TDefinitions | (keyof TDefinitions)[]): Promise<void>;

  get<
    TArgs extends readonly (keyof TDefinitions | { $: keyof TDefinitions })[]
  >(
    ...args: TArgs
  ): {
    [key in keyof TArgs]: TArgs[key] extends keyof TDefinitions
      ? OperationResult<TDefinitions[TArgs[key]]>
      : VariablesOverride<TDefinitions, TArgs[key]>;
  };

  peek<
    TArgs extends readonly (keyof TDefinitions | { $: keyof TDefinitions })[]
  >(
    ...args: TArgs
  ): {
    [key in keyof TArgs]: TArgs[key] extends keyof TDefinitions
      ? OperationResult<TDefinitions[TArgs[key]]>
      : VariablesOverride<TDefinitions, TArgs[key]>;
  };

  read<
    TArgs extends readonly (keyof TDefinitions | { $: keyof TDefinitions })[]
  >(
    ...args: TArgs
  ): {
    [key in keyof TArgs]?: TArgs[key] extends keyof TDefinitions
      ? OperationResult<TDefinitions[TArgs[key]]>
      : VariablesOverride<TDefinitions, TArgs[key]>;
  };

  evict(entity: Record<string, any>): void;

  write<TKey extends keyof TDefinitions>(
    key: TKey,
    data: UpdateData<
      TDefinitions[TKey] extends TypedDefinitionOptions<infer TData, any>
        ? TData
        : never
    >,
    overrideVariables?: TDefinitions[TKey] extends TypedDefinitionOptions<
      any,
      infer TVariables
    >
      ? Partial<TVariables>
      : {}
  ): VoidFunction;

  write<T extends Record<string, any>>(
    target: T,
    changes: { [key in keyof T]?: UpdateData<T[key]> }
  ): VoidFunction;
};

type QueryRefOptions = OperationDefBase & {
  gql: DocumentNode;
  variables?: any;
};

class QueryRef<T> {
  public observable: ObservableQuery<T>;
  private _state: ReturnType<typeof this.createState> | undefined;
  private _data: T | undefined;
  private _disposeTimeout: any;

  createState() {
    let data: T | undefined;
    let error: ApolloError | undefined;
    let loading: boolean;
    let promise: Promise<void>;
    let resolve: VoidFunction | undefined;
    let reject: VoidFunction | undefined;
    const listeners = new Array<VoidFunction>();

    const lastResult = this.observable.getLastResult();
    if (!lastResult?.loading) {
      data = lastResult?.data;
      error = lastResult?.error;
      this._data = data;
    }
    const fetchPolicy =
      this.observable.options.nextFetchPolicy ||
      this.observable.options.fetchPolicy;
    if (fetchPolicy === "network-only" || fetchPolicy === "no-cache") {
      data = undefined;
      error = undefined;
    }
    if (data) {
      loading = false;
    } else if (error) {
      loading = false;
    } else {
      loading = true;
      promise = new Promise((...args) => {
        [resolve, reject] = args;
      });
    }

    const notify = () => listeners.slice().forEach((x) => x());
    const handleResult = (result: ApolloQueryResult<T>) => {
      if (result.loading) return;
      data = result.data;
      this._data = data;
      error = undefined;
      loading = false;
      resolve?.();
      promise = Promise.resolve();
      notify();
    };
    const handleError = (e: ApolloError) => {
      error = e;
      loading = false;
      reject?.();
      promise = Promise.reject(e);
      notify();
    };
    const subscription = this.observable
      .filter((result) => {
        return !equal(result.data, {}) && !equal(result.data, this._data);
      })
      .subscribe(handleResult, handleError);

    return {
      get loading() {
        return loading;
      },
      get data() {
        return data;
      },
      get error() {
        return error;
      },
      get promise() {
        return promise;
      },
      refetch: (fresh = false) => {
        if (fresh) {
          this._data = undefined;
          loading = true;
          promise = new Promise((...args) => {
            [resolve, reject] = args;
          });
          notify();
        }
        this.observable.refetch().then(handleResult, handleError);
      },
      dispose() {
        listeners.length = 0;
        subscription.unsubscribe();
      },
      notify,
      subscribe: (listener: VoidFunction): VoidFunction => {
        clearTimeout(this._disposeTimeout);
        listeners.push(listener);
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          const i = listeners.indexOf(listener);
          if (i !== -1) {
            listeners.splice(i, 1);
            if (!listeners.length) {
              this.disposeState();
            }
          }
        };
      },
    };
  }

  get state() {
    if (!this._state) {
      this._state = this.createState();
    }
    return this._state;
  }

  constructor(observable: ObservableQuery<T>) {
    this.observable = observable;
  }

  private disposeState() {
    this._disposeTimeout = setTimeout(() => {
      this._state?.dispose();
      this._state = undefined;
    }, 5 * 1000);
  }
}

export const NOOP = () => {
  //
};

const stringifyReplacer = (_: string, value: any) => {
  // We sort object properties to ensure that multiple objects with identical properties yield the same stringify results.
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const props = Object.keys(value);
      return props.map((prop) => [prop, value[prop]]);
    }
  }

  return value;
};

const queryCacheProp = Symbol("queryCache");
const getQueryRef = (
  client: ApolloClient<unknown>,
  { fetchPolicy = "cache-first", gql, variables = {} }: QueryRefOptions
) => {
  let documentCache = (client as any)[queryCacheProp] as WeakMap<
    DocumentNode,
    Map<string, QueryRef<unknown>>
  >;

  if (!documentCache) {
    documentCache = new WeakMap();
    (client as any)[queryCacheProp] = documentCache;
  }

  let queryCache = documentCache.get(gql);
  if (!queryCache) {
    queryCache = new Map();
    documentCache.set(gql, queryCache);
  }

  const queryKey = `${fetchPolicy}:${JSON.stringify(
    variables,
    stringifyReplacer
  )}`;
  let queryRef = queryCache.get(queryKey);
  if (!queryRef) {
    queryRef = new QueryRef(
      client.watchQuery({
        query: gql,
        variables,
        fetchPolicy,
        notifyOnNetworkStatusChange: true,
      })
    );
    queryCache.set(queryKey, queryRef);
  }

  return queryRef;
};

/**
 * create typed query options
 * @param gql
 * @param args
 * @returns
 */
export const typed = <TData, TVariables = {}>(
  gql: TypedDocumentNode<TData, TVariables> | DocumentNode,
  ...args: TypedOperationOptionsArgs<TVariables>
): TypedDefinitionOptions<TData, TVariables> => {
  return { gql, ...args[0] };
};

const createGraphAPI = (
  client: ApolloClient<any>,
  definitions: { current: Record<string, TypedDefinitionOptions<any, any>> },
  handleUpdate: VoidFunction,
  isRendering: () => boolean
) => {
  const queryCache: { key: string; variables: any; query: QueryRef<any> }[] =
    [];
  const resultCache = new Map<any, any>();
  const unsubscribeAll = new Set<VoidFunction>();

  const notAllowed = (apiName: string) => {
    if (!isRendering()) {
      throw new Error(
        `The API ${apiName} is permitted for use during the rendering phase.`
      );
    }
  };

  const getOptions = (
    key: string,
    overrideVariables?: any
  ): QueryRefOptions => {
    const options = definitions.current[key] as QueryRefOptions;
    if (!options) {
      throw new Error(`No named definition ${key}`);
    }
    if (overrideVariables) {
      return {
        ...options,
        variables: { ...options.variables, ...overrideVariables },
      };
    }
    return options;
  };

  const write = (...args: any[]) => {
    // write query
    if (typeof args[0] === "string") {
      const [key, data, overrideVariables] = args;
      const options = getOptions(key, overrideVariables);
      const writeOptions = {
        query: options.gql,
        variables: options.variables,
      };
      const prevData = client.cache.readQuery(writeOptions);

      if (typeof data === "function") {
        const next = data(prevData);
        if (!next) return;
        client.writeQuery({ ...writeOptions, data: next });
      } else {
        client.writeQuery({ ...writeOptions, data });
      }

      return () => {
        if (prevData) {
          client.writeQuery({ ...writeOptions, data: prevData });
        }
      };
    }
    const [target, changes] = args;
    const fields: Modifiers = {};
    const prevFields: Record<string, any> = {};
    Object.entries(changes).forEach(([key, value]) => {
      fields[key] = (prev) => {
        prevFields[key] = prev;
        if (typeof value === "function") {
          return value(prev);
        }
        return value;
      };
    });
    client.cache.modify({
      id: client.cache.identify(target),
      fields: fields,
    });

    // restore function
    return () => {
      write(target, prevFields);
    };
  };

  const query = (
    args: any[],
    subscribeChanges: boolean,
    resolve: (results: any[], pending: boolean) => any
  ) => {
    notAllowed("get");
    const results: any[] = [];
    let pending = false;
    const subscribeActions: VoidFunction[] = [];
    args.forEach((keyOrOverrideVariables, index) => {
      const key =
        typeof keyOrOverrideVariables === "string"
          ? keyOrOverrideVariables
          : keyOrOverrideVariables.$;
      let options = definitions.current[key] as QueryRefOptions;
      if (!options) {
        throw new Error(`No named query definition ${key}`);
      }

      if (typeof keyOrOverrideVariables === "object") {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { $, ...overrideVariables } = keyOrOverrideVariables;
        options = {
          ...options,
          variables: { ...options.variables, ...overrideVariables },
        };
      }

      const noVars =
        !options.variables || !Object.keys(options.variables).length;

      if (noVars && resultCache.has(key)) {
        results[index] = resultCache.get(key);
        return;
      }

      let data: any;
      const query = getQueryRef(client, options);

      if (!query.state.loading) {
        if (query.state.error) {
          throw query.state.error;
        }
        subscribeActions.push(() =>
          unsubscribeAll.add(query.state.subscribe(handleUpdate))
        );
        data = query.state.data;
        // save query for later use
        queryCache.push({ query, key, variables: options.variables });
      } else {
        pending = true;
        results[index] = query.state.promise;
      }

      results[index] = data;
    });

    const result = resolve(results, pending);
    if (subscribeChanges) {
      subscribeActions.forEach((x) => x());
    }

    return result;
  };

  return {
    cleanup() {
      resultCache.clear();
      unsubscribeAll.forEach((x) => x());
      unsubscribeAll.clear();
    },
    unsubscribeAll,
    peek(...args: any[]) {
      try {
        return query(args, false, (results) => {
          return Promise.all(results);
        });
      } catch (ex) {
        return Promise.reject(ex);
      }
    },
    get(...args: any[]) {
      notAllowed("get");
      return query(args, true, (results, pending) => {
        if (pending) {
          throw Promise.all(results);
        }

        return results;
      });
    },
    write,
    preload(...args: any[]) {
      const keys: string[] = [];
      const promises: Promise<any>[] = [];
      // overload: refetch(query, fresh?)
      if (typeof args[0] === "string") {
        keys.push(args[0]);
      }
      // overload: refetch(queries, fresh?)
      else if (Array.isArray(args[0])) {
        keys.push(...args[0]);
      }
      keys.forEach((key) => {
        const options = definitions.current[key];
        if (!options) {
          throw new Error(`No named query definition "${key}" found`);
        }
        promises.push(getQueryRef(client, options).state.promise);
      });
      return Promise.all(promises);
    },
    read(...args: any[]) {
      return args.map((keyOrVariables) => {
        const key =
          typeof keyOrVariables === "string"
            ? keyOrVariables
            : keyOrVariables.$;
        const { $, ...overrideVariables } =
          typeof keyOrVariables === "object" ? keyOrVariables : ({} as any);
        const options = getOptions(key, overrideVariables);
        return client.readQuery({
          query: options.gql,
          variables: options.variables,
        });
      });
    },
    refetch(...args: any[]) {
      let fresh = false;
      const keys: string[] = [];
      let filter: (key: string, variables: any) => boolean = (key) => {
        return keys.includes(key);
      };
      // overload: refetch(fresh?)
      if (args.length === 1 && typeof args[0] !== "string") {
        fresh = !!args[0];
      } else {
        fresh = !!args[1];
        // overload: refetch(query, fresh?)
        if (typeof args[0] === "string") {
          keys.push(args[0]);
        }
        // overload: refetch(queries, fresh?)
        else if (Array.isArray(args[0])) {
          keys.push(...args[0]);
        }
        // overload: refetch(filter, fresh?)
        else if (typeof args[0] === "function") {
          filter = args[0];
        }
      }

      queryCache.forEach((x) => {
        if (filter(x.key, x.variables ?? {})) {
          x.query.state.refetch(fresh);
        }
      });
    },
    evict(target: any) {
      client.cache.evict({ id: client.cache.identify(target) });
    },
  };
};

export const useGQL = <
  TDefinitions extends Record<string, TypedDefinitionOptions<any, any>> = {}
>(
  definitions?: TDefinitions
): {
  [key in keyof TDefinitions]: OperationResult<TDefinitions[key]>;
} & GraphAPI<TDefinitions> => {
  const client = useApolloClient();
  const rerender = useState({})[1];
  const inputQueriesRef = useRef(definitions ?? {});
  const [ref] = useState(() => {
    const state = {
      rendering: false,
      mounted: false,
    };
    const api = createGraphAPI(
      client,
      inputQueriesRef,
      () => state.mounted && rerender({}),
      () => state.rendering
    );

    return {
      api,
      state,
      proxy: new Proxy(
        {},
        {
          get(_target, prop) {
            if (typeof prop !== "string") return undefined;
            if (prop in api) return api[prop as keyof typeof api];
            // predefined query
            if (!state.rendering) {
              throw new Error(
                "Predefined query cannot access outside component rendering phase"
              );
            }
            return api.get(prop)[0];
          },
          set() {
            return false;
          },
          deleteProperty() {
            return false;
          },
        }
      ),
    };
  });
  ref.state.rendering = true;
  inputQueriesRef.current = definitions ?? {};
  ref.api.cleanup();

  useLayoutEffect(() => {
    ref.state.mounted = true;
    ref.state.rendering = false;
  });

  useLayoutEffect(() => {
    return () => {
      ref.api.cleanup();
    };
  }, [ref]);

  return ref.proxy as any;
};

/**
 * features:
 * straightforward code
 * fix some refetching issue: no loading status
 * strict refetching way
 */
