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
        <p className="eyebrow">OPERATIONS DASHBOARD DEMO</p>
        <h1>Explore an exercise</h1>
        <p>
          Choose a scenario to explore access, payments, releases, or recovery.
          Each exercise opens a fresh workspace with fictional business data.
        </p>
      </header>
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
      <SuiteReview />
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
