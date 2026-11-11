export const demoExercises = [
  {
    id: 'account-permissions',
    title: 'Account permissions',
    description: 'Compare three roles in the same workspace. Explore which sections each can open and which actions the server allows.',
    testFiles: ['tests/demo-accounts-http.mjs', 'tests/demo-login.test.mjs', 'tests/hosted-sessions.test.mjs'],
  },
] as const;
export type DemoExercise = typeof demoExercises[number];
export function findExercise(id: unknown) {
  return demoExercises.find(exercise => exercise.id === id);
}
