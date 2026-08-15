// Minimal ambient typings for the two Node builtins the test suite touches.
// Deliberate alternative to adding @types/node: the project invariant limits
// dev dependencies to vite, typescript, and vitest.

declare module 'node:fs' {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: string): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
