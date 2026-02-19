// Re-export everything from json-render
export {
  defineCatalog,
  defineSchema,
  createSpecStreamCompiler,
  createMixedStreamParser,
  compileSpecStream,
  nestedToFlat,
  validateSpec,
  autoFixSpec,
  formatSpecIssues,
  visibility,
  action,
  check,
} from '@json-render/core';

export type {
  Catalog,
  Schema,
  SchemaDefinition,
  Spec,
  UIElement,
  ActionDefinition,
  JsonPatch,
  VisibilityCondition,
  ValidationConfig,
} from '@json-render/core';

export {
  Renderer,
  defineRegistry,
  useStateStore,
  StateProvider,
  useActions,
  useAction,
  useVisibility,
  useIsVisible,
  useStateValue,
  useStateBinding,
  schema,
} from '@json-render/react';

export type {
  ComponentRegistry,
  RendererProps,
  BaseComponentProps,
  DefineRegistryResult,
} from '@json-render/react';

// Agentstage specific exports
export { BridgeStateProvider, useBridgeStateContext, useBridgeState } from './bridge-state-provider.js';
export { jsonToTsx, specToComponent } from './json-to-tsx.js';
