'use client';
import { SuiteReview } from './suite-review';
import { useState } from 'react';
import { catalog, type Exercise } from '@/lib/security-lab/catalog';
export function ExercisePicker({
  choose,
  cancel,
  pending,
  error,
}: {
  choose: (n: number) => void;
  cancel?: () => void;
  pending: boolean;
  error: string;
}) {
  const [filter, setFilter] = useState('All');
  return (
    <main className="exercise-picker">
      <header>
        <p className="eyebrow">SECDASH / SECURITY LAB</p>
        <h1>Choose an exercise</h1>
        <p>
          Explore a security question in a fictional business. Every exercise
          starts a fresh workspace. You decide which actions to try.
        </p>
      </header>
      <SuiteReview />
      <h2>Explore an exercise yourself</h2>
      <p>Choose a card below. Each exercise includes a downloadable report of its server responses.</p>
      <nav aria-label="Filter exercises">
        {['All', 'Dashboard', 'Connector', 'Evidence'].map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
        {cancel && <button onClick={cancel}>Back to my session</button>}
      </nav>
      {error && <p role="alert">{error}</p>}
      <div className="exercise-grid">
        {catalog
          .filter((e) => filter === 'All' || e.category === filter)
          .map((e) => (
            <article key={e.n}>
              <small>
                {e.category.toUpperCase()} / {String(e.n).padStart(2, '0')}
              </small>
              <h2>{e.title}</h2>
              <p>{e.question}</p>
              <button disabled={pending} onClick={() => choose(e.n)}>
                {e.category === 'Evidence'
                  ? 'Inspect evidence'
                  : 'Start exercise'}{' '}
                →
              </button>
            </article>
          ))}
      </div>
    </main>
  );
}
export function ExerciseHeading({ exercise }: { exercise: Exercise }) {
  return (
    <>
      <p className="eyebrow">
        EXERCISE {String(exercise.n).padStart(2, '0')} / {exercise.category}
      </p>
      <h2>{exercise.title}</h2>
      <p>{exercise.guide}</p>
    </>
  );
}
