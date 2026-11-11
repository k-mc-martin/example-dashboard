import { catalog } from './security-lab/catalog.ts';
export const demoExercises = catalog.map((e) => ({
  ...e,
  id: e.n === 1 ? 'account-permissions' : 'exercise-' + e.n,
  description: e.question,
  testFiles:
    e.n === 1
      ? [
          'tests/demo-accounts-http.mjs',
          'tests/demo-login.test.mjs',
          'tests/hosted-sessions.test.mjs',
        ]
      : ['tests/security-campaign-http.mjs', 'tests/campaign-crypto.test.mjs'],
}));
export type DemoExercise = (typeof demoExercises)[number];
export function findExercise(id: unknown) {
  return demoExercises.find((e) => e.id === id || e.n === id);
}
