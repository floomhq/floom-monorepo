import { Link } from 'react-router-dom';
import { StepBadge } from './shared';

export type Step = 'ramp' | 'review' | 'publishing' | 'done';

export function BuildHeader({
  editSlug,
  backHref,
  step,
}: {
  editSlug: string | null;
  backHref: string;
  step: Step;
}) {
  return (
    <>
      <div style={{ marginBottom: 32 }}>
        <Link
          to={backHref}
          style={{
            fontSize: 13,
            color: 'var(--muted)',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginBottom: 12,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M8 2L4 6l4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Creator dashboard
        </Link>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            margin: '0 0 8px',
            color: 'var(--ink)',
            letterSpacing: '-0.02em',
          }}
        >
          {editSlug ? `Edit ${editSlug}` : 'Publish a Floom app'}
        </h1>
        <p
          style={{
            fontSize: 15,
            color: 'var(--muted)',
            margin: 0,
            maxWidth: 620,
            lineHeight: 1.55,
          }}
        >
          Start from an idea or a tool you already use. Floom handles the boring stuff for you:
          sign-in, who can use it, history, versions, and a public page. From day one.
        </p>
      </div>

      {step !== 'ramp' && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 28,
            fontSize: 12,
            color: 'var(--muted)',
            flexWrap: 'wrap',
          }}
        >
          <StepBadge active={false} done={true} label="1. Find your app" />
          <StepBadge
            active={step === 'review'}
            done={step === 'publishing' || step === 'done'}
            label="2. Review"
          />
          <StepBadge active={step === 'publishing'} done={step === 'done'} label="3. Publish" />
        </div>
      )}
    </>
  );
}
