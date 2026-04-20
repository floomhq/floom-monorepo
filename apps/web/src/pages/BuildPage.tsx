// /build — creator composer. Rebuilt 2026-04-17 to match wireframes.floom.dev
// v11 Screen 5. Multi-ramp entry:
//   1. GitHub import (PRIMARY, full width, functional — transforms repo URL
//      to raw openapi.yaml|json on the fly before calling the detect API).
//   2. OpenAPI URL paste (fallback, functional — the previous behavior).
//   3. Describe it (coming soon — AI generation is deferred per
//      project_floom_positioning.md).
//   4. Connect a tool (coming soon — deferred post-launch).
//   5. Docker image (coming soon — registry pulling ships after v1).
//
// Once a spec is detected the existing review/publish UI runs unchanged.
//
// 2026-04-20: decomposed from a single 1,882-line file into focused
// sub-components under components/studio/build/. This file stays as the
// route-level component that owns state and composes the pieces. Progressive
// disclosure: custom slug + category now live in a collapsed "Advanced
// settings" details element; the review step keeps name, description, slug
// preview, and public/private visibility visible by default.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { CustomRendererPanel } from '../components/CustomRendererPanel';
import { useSession } from '../hooks/useSession';
import * as api from '../api/client';
import type { DetectedApp } from '../lib/types';
import { BuildHeader, type Step } from '../components/studio/build/BuildHeader';
import {
  SourceInput,
  type DetectError,
  type GithubDetectAttempt,
  type GithubErrorKind,
} from '../components/studio/build/SourceInput';
import { DetectedSummary } from '../components/studio/build/DetectedSummary';
import { PublishForm } from '../components/studio/build/PublishForm';
import { AdvancedSettings } from '../components/studio/build/AdvancedSettings';
import { PublishActions } from '../components/studio/build/PublishActions';
import {
  ComingSoonRampModal,
  ShareableUrl,
  SignupToPublishModal,
} from '../components/studio/build/shared';

// localStorage key for persisting a pending detection across the
// signup redirect so anonymous visitors don't lose their work. Cleared
// once the publish succeeds or the user manually goes back to ramp.
const PENDING_KEY = 'floom:pending-publish';

type PendingPublish = {
  detected: DetectedApp;
  name: string;
  slug: string;
  description: string;
  category: string;
  /** Who can see / run the app in the directory */
  visibility: 'public' | 'private' | 'auth-required';
  source: 'github' | 'openapi';
};

interface BuildPageProps {
  /** Wrapper component used for the outer layout. Defaults to PageShell
   *  (store surface). Studio wraps with StudioLayout. */
  layout?: React.ComponentType<{ children: React.ReactNode; title?: string }>;
  /** Where the "Back" breadcrumb links to. Defaults to /creator (store).
   *  Studio passes /studio. */
  backHref?: string;
  /** Redirect target after publish — Studio sends to /studio/:slug. */
  postPublishHref?: (slug: string) => string;
}

export function BuildPage({
  layout: Layout = PageShell,
  backHref = '/creator',
  postPublishHref,
}: BuildPageProps = {}) {
  const [searchParams] = useSearchParams();
  const editSlug = searchParams.get('edit');
  // Landing hero hands off the pasted URL via /studio/build?ingest_url=<url>.
  // Legacy: ?openapi=<url> is still accepted so older hero builds and
  // external links keep working. Both pre-populate the matching ramp input
  // and (for ingest_url) auto-trigger detect so the user lands mid-flow
  // with candidate operations already visible.
  const ingestUrlParam = searchParams.get('ingest_url') ?? '';
  const legacyOpenapiParam = searchParams.get('openapi') ?? '';
  const navigate = useNavigate();
  const { isAuthenticated } = useSession();
  const [signupPrompt, setSignupPrompt] = useState(false);

  // Classify the hero-provided URL. A github.com URL goes in the GitHub
  // ramp; anything else goes in the OpenAPI ramp. The regex matches both
  // the GitHub owner/repo shape and the direct repo URL.
  const heroUrl = ingestUrlParam || legacyOpenapiParam;
  const heroIsGithub = /github\.com[/:][^/]+\/[^/]+/i.test(heroUrl);

  // Inputs shared across ramps
  const [githubUrl, setGithubUrl] = useState(heroIsGithub ? heroUrl : '');
  const [openapiUrl, setOpenapiUrl] = useState(
    !heroIsGithub && heroUrl ? heroUrl : '',
  );
  // Tracks whether we've already kicked off the auto-detect for this
  // mount so we don't re-run it on every render (e.g. when the user
  // manually edits the input after auto-detect).
  const [heroAutoDetected, setHeroAutoDetected] = useState(false);

  // Which ramp submitted last — controls the review heading
  const [source, setSource] = useState<'github' | 'openapi' | null>(null);

  // Detection result
  const [detected, setDetected] = useState<DetectedApp | null>(null);
  const [githubAttempts, setGithubAttempts] = useState<GithubDetectAttempt>(null);

  // State machine
  const [step, setStep] = useState<Step>('ramp');
  const [error, setError] = useState<DetectError>(null);
  const [githubError, setGithubError] = useState<GithubErrorKind>(null);
  // Slug-taken recovery (audit 2026-04-20, Fix 2). When the publish
  // request 409s with `slug_taken`, the server returns three suggestions
  // (numeric / version / random suffix). We surface them as clickable
  // pills above the submit button — one click populates the slug field
  // and the user can resubmit. Cleared whenever the user edits the slug
  // manually or after a successful publish.
  const [slugSuggestions, setSlugSuggestions] = useState<string[] | null>(null);

  // Editable metadata (populated after detect)
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  // Issue #129 (2026-04-19): default to Public so the post-publish "share
  // the link" copy matches reality. Creators can still pick Private on the
  // Review step, and can flip it later from /studio/:slug. The old default
  // ('private') contradicted the success banner's "anyone with the link can
  // run this" language.
  const [visibility, setVisibility] = useState<'public' | 'private' | 'auth-required'>(
    'public',
  );

  // Coming-soon state. Round 2 polish: describe/connect ramps removed
  // from the ramp page, so only docker remains as a coming-soon modal
  // target.
  const [comingSoon, setComingSoon] = useState<'docker' | null>(null);

  // Pre-fill if we got here via /build?edit=slug
  useEffect(() => {
    if (!editSlug) return;
    api
      .getApp(editSlug)
      .then((existing) => {
        if (existing) {
          setName(existing.name);
          setSlug(existing.slug);
          setDescription(existing.description);
          setCategory(existing.category || '');
          setStep('ramp');
        }
      })
      .catch(() => {
        /* ignore — show the ramp step */
      });
  }, [editSlug]);

  // Restore a pending detection after signup redirect. Anonymous users can
  // detect + review a spec, then get prompted to sign up when they click
  // Publish — on return, we hydrate the review step from localStorage so
  // they just click Publish again.
  useEffect(() => {
    if (editSlug) return;
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(PENDING_KEY) : null;
    if (!raw) return;
    try {
      const p = JSON.parse(raw) as PendingPublish;
      setDetected(p.detected);
      setName(p.name);
      setSlug(p.slug);
      setDescription(p.description);
      setCategory(p.category || '');
      setVisibility(p.visibility || 'public');
      setSource(p.source);
      setStep('review');
      // Hydrated from localStorage — don't re-run auto-detect.
      setHeroAutoDetected(true);
    } catch {
      window.localStorage.removeItem(PENDING_KEY);
    }
  }, [editSlug]);

  /** Transforms a GitHub repo URL into candidate raw OpenAPI URLs. */
  function githubCandidates(raw: string): string[] {
    const m = raw.trim().match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i);
    if (!m) return [];
    const [, owner, repo] = m;
    const bases = [
      `https://raw.githubusercontent.com/${owner}/${repo}/main`,
      `https://raw.githubusercontent.com/${owner}/${repo}/master`,
    ];
    const paths = ['openapi.yaml', 'openapi.yml', 'openapi.json', 'docs/openapi.yaml', 'api/openapi.yaml'];
    const urls: string[] = [];
    for (const b of bases) for (const p of paths) urls.push(`${b}/${p}`);
    return urls;
  }

  /**
   * Run detect against all GitHub raw-URL candidates, in order. Returns
   * true on success (state updated to `review`); false means every
   * candidate failed and `githubError` was set. Shared between the
   * manual GitHub ramp form and the hero-URL auto-detect on mount.
   */
  async function runGithubDetect(inputUrl: string): Promise<boolean> {
    setError(null);
    setGithubError(null);
    const candidates = githubCandidates(inputUrl);
    if (candidates.length === 0) {
      setGithubError('unreachable');
      return false;
    }
    setGithubAttempts({ attemptedUrls: candidates });
    for (const candidate of candidates) {
      try {
        const result = await api.detectApp(candidate);
        setDetected(result);
        setName(result.name);
        setSlug(result.slug);
        setDescription(result.description);
        setSource('github');
        setStep('review');
        return true;
      } catch {
        // try next
      }
    }
    // All failed. Distinguish private-repo (403/404 on all raw urls) from
    // missing OpenAPI. Without a HEAD request we can't tell reliably, so
    // show the no-openapi hint by default.
    setGithubError('no-openapi');
    return false;
  }

  /**
   * Run detect against an OpenAPI URL. Returns true on success; false
   * sets the inline `error` state. Shared between the manual OpenAPI
   * ramp form and the hero-URL auto-detect on mount.
   *
   * Error classification matches the protocol's error taxonomy (§
   * types.ts ErrorType):
   *   - network_unreachable: fetch failed before any response landed
   *   - user_input_error: upstream 4xx (bad URL, non-JSON content, etc.)
   *   - upstream_outage: upstream 5xx (transient)
   */
  async function runOpenapiDetect(inputUrl: string): Promise<boolean> {
    setError(null);
    try {
      const result = await api.detectApp(inputUrl, name || undefined, slug || undefined);
      setDetected(result);
      setName(result.name);
      setSlug(result.slug);
      setDescription(result.description);
      setSource('openapi');
      setStep('review');
      return true;
    } catch (err) {
      const apiErr = err instanceof api.ApiError ? err : null;
      const is404 = apiErr?.status === 404;

      // Map the raw error to taxonomy-aware copy. The detect endpoint
      // returns 400 with a code when the URL is reachable but the body
      // isn't a valid spec; 0/5xx means the network hop itself failed.
      let message: string;
      if (is404) {
        message = "We couldn't find that spec. Check the URL or try the GitHub ramp.";
      } else if (!apiErr || apiErr.status === 0) {
        message =
          "We couldn't reach that URL. Check the link and try again, or paste your openapi.json directly.";
      } else if (apiErr.status >= 400 && apiErr.status < 500) {
        message =
          apiErr.message ||
          "That URL didn't return a valid OpenAPI spec. Double-check the link.";
      } else {
        message = 'The server returned an error. Try again in a moment.';
      }

      setError({
        message,
        details: (err as Error).message || undefined,
      });
      return false;
    }
  }

  async function handleGithubDetect(e: React.FormEvent) {
    e.preventDefault();
    await runGithubDetect(githubUrl);
  }

  async function handleOpenapiDetect(e: React.FormEvent) {
    e.preventDefault();
    await runOpenapiDetect(openapiUrl);
  }

  // Auto-detect from hero-provided URL (2026-04-20 audit fix). When the
  // landing hero hands off a URL via ?ingest_url=<url>, we pre-fill the
  // matching ramp above and immediately kick off detect so the user
  // sees detected operations without a second click. The conversion
  // killer the audit flagged was a blank /studio/build form after the
  // user typed a URL in the hero. This effect closes that gap.
  //
  // Guards:
  //   - Skip if the user came in via /build?edit=<slug> (already mid-
  //     edit of an existing app).
  //   - Skip if localStorage already re-hydrated a pending detection
  //     (setHeroAutoDetected(true) from the effect above).
  //   - Run exactly once per mount per URL.
  useEffect(() => {
    if (editSlug) return;
    if (!heroUrl) return;
    if (heroAutoDetected) return;
    // Defer the detect until the next tick so any localStorage-hydrate
    // effect above has a chance to set heroAutoDetected first.
    let cancelled = false;
    setHeroAutoDetected(true);
    (async () => {
      if (cancelled) return;
      if (heroIsGithub) {
        await runGithubDetect(heroUrl);
      } else {
        await runOpenapiDetect(heroUrl);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSlug, heroUrl, heroIsGithub]);

  async function handlePublish() {
    if (!detected) return;
    // Anonymous users get prompted to sign up before publishing. We
    // persist the review state so they can resume right after auth.
    if (!isAuthenticated) {
      const pending: PendingPublish = {
        detected,
        name,
        slug,
        description,
        category,
        visibility,
        source: source ?? 'openapi',
      };
      try {
        window.localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      } catch {
        /* storage can fail in private mode; fall back to redirect without resume */
      }
      setSignupPrompt(true);
      return;
    }
    setStep('publishing');
    setError(null);
    setSlugSuggestions(null);
    try {
      await api.ingestApp({
        openapi_url: detected.openapi_spec_url,
        name,
        slug,
        description,
        category: category || undefined,
        visibility,
      });
      try {
        window.localStorage.removeItem(PENDING_KEY);
      } catch {
        /* ignore */
      }
      setStep('done');
      // Redirect removed on 2026-04-17: give creators a chance to upload
      // a custom renderer (W2.2) before heading to the permalink. The
      // "Open app" button on the done step handles navigation manually.
    } catch (err) {
      setStep('review');
      // Slug-taken: server returns 409 with suggestions (audit 2026-04-20,
      // Fix 2). Render the three pills above the submit button and let
      // the user pick one or keep editing. Any other error keeps the
      // generic inline red message.
      if (err instanceof api.ApiError && err.status === 409 && err.code === 'slug_taken') {
        const payload = err.payload as { suggestions?: string[] } | undefined;
        const suggestions = Array.isArray(payload?.suggestions)
          ? payload!.suggestions.slice(0, 3)
          : [];
        setSlugSuggestions(suggestions.length > 0 ? suggestions : null);
        setError({
          message: `That slug is already taken. Pick one of the suggestions below, or edit the slug field above.`,
          details: err.message,
        });
        return;
      }
      setError({
        message: 'Publish failed.',
        details: (err as Error).message || undefined,
      });
    }
  }

  // Apply one of the slug-taken suggestions and immediately retry publish.
  // Wipes the suggestion list so a second collision (vanishingly rare, but
  // possible under concurrent writes) gets a fresh batch.
  async function handleApplySlugSuggestion(next: string) {
    setSlug(next);
    setSlugSuggestions(null);
    // Wait one microtask so React state has committed the new slug before
    // the publish reads from it.
    await Promise.resolve();
    // handlePublish reads from component state which won't see the freshly
    // set `slug` until the next render. We replicate the core publish with
    // the explicit new slug to avoid the stale-state trap.
    if (!detected) return;
    setStep('publishing');
    setError(null);
    try {
      await api.ingestApp({
        openapi_url: detected.openapi_spec_url,
        name,
        slug: next,
        description,
        category: category || undefined,
        visibility,
      });
      try {
        window.localStorage.removeItem(PENDING_KEY);
      } catch {
        /* ignore */
      }
      setStep('done');
    } catch (err) {
      setStep('review');
      if (err instanceof api.ApiError && err.status === 409 && err.code === 'slug_taken') {
        const payload = err.payload as { suggestions?: string[] } | undefined;
        const suggestions = Array.isArray(payload?.suggestions)
          ? payload!.suggestions.slice(0, 3)
          : [];
        setSlugSuggestions(suggestions.length > 0 ? suggestions : null);
        setError({
          message: `That slug is also taken. Pick another suggestion or edit manually.`,
          details: err.message,
        });
        return;
      }
      setError({
        message: 'Publish failed.',
        details: (err as Error).message || undefined,
      });
    }
  }

  // The editable slug input (inside Advanced settings) preserves the
  // original normalizer and the suggestion-clearing side effect so a
  // manual edit drops any stale collision pills.
  function handleSlugChange(raw: string) {
    setSlug(raw.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
    if (slugSuggestions) setSlugSuggestions(null);
  }

  function handleBackToRamp() {
    try {
      window.localStorage.removeItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
    setStep('ramp');
  }

  return (
    <Layout title="Publish an app | Floom">
      <div data-testid="build-page" style={{ maxWidth: 1040, margin: '0 auto' }}>
        <BuildHeader editSlug={editSlug} backHref={backHref} step={step} />

        {step === 'ramp' && (
          <SourceInput
            githubUrl={githubUrl}
            setGithubUrl={setGithubUrl}
            openapiUrl={openapiUrl}
            setOpenapiUrl={setOpenapiUrl}
            onGithubSubmit={handleGithubDetect}
            onOpenapiSubmit={handleOpenapiDetect}
            githubError={githubError}
            githubAttempts={githubAttempts}
            error={error}
            onComingSoonClick={(target) => setComingSoon(target)}
          />
        )}

        {step === 'review' && detected && (
          <div data-testid="build-step-review">
            <DetectedSummary detected={detected} source={source} />
            <PublishForm
              name={name}
              setName={setName}
              description={description}
              setDescription={setDescription}
              slug={slug}
              visibility={visibility}
              setVisibility={setVisibility}
            />
            <AdvancedSettings
              slug={slug}
              onSlugChange={handleSlugChange}
              category={category}
              setCategory={setCategory}
            />
            <PublishActions
              error={error}
              slugSuggestions={slugSuggestions}
              onApplySlugSuggestion={handleApplySlugSuggestion}
              onBack={handleBackToRamp}
              onPublish={handlePublish}
              canPublish={Boolean(name && slug)}
            />
          </div>
        )}

        {step === 'publishing' && (
          <div data-testid="build-step-publishing" style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: 'var(--muted)' }}>Publishing...</p>
          </div>
        )}

        {step === 'done' && (
          <div data-testid="build-step-done">
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                background: '#e6f4ea',
                border: '1px solid #b5dcc4',
                borderRadius: 12,
                marginBottom: 20,
              }}
            >
              <div style={{ color: '#1a7f37', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
                Published
              </div>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px' }}>
                {visibility === 'private'
                  ? 'Your app is live. Only you can run it while signed in. You can flip it to Public later if you want to share.'
                  : 'Your app is live. Share the link or add it to Claude Desktop to start running it.'}
              </p>
              {/* Shareable full URL + copy button. Before this fix the
                  banner only showed "/p/slug" relative path, which is not
                  shareable outside the current tab. */}
              <ShareableUrl slug={slug} />
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                <button
                  type="button"
                  onClick={() => navigate(`/p/${slug}`)}
                  className="btn-primary"
                  data-testid="build-open-app"
                  style={{ padding: '9px 16px', fontSize: 13 }}
                >
                  Open app
                </button>
                <Link
                  to={postPublishHref ? postPublishHref(slug) : `/me/apps/${slug}`}
                  className="btn-ghost"
                  data-testid="build-install-claude"
                  style={{
                    padding: '9px 14px',
                    fontSize: 13,
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    textDecoration: 'none',
                  }}
                >
                  {postPublishHref ? 'Manage in Studio' : 'Install in Claude'}
                </Link>
                {!postPublishHref && (
                  <Link
                    to={`/creator/${slug}`}
                    className="btn-ghost"
                    style={{
                      padding: '9px 14px',
                      fontSize: 13,
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      textDecoration: 'none',
                    }}
                  >
                    View in creator dashboard
                  </Link>
                )}
              </div>
            </div>

            <div
              style={{
                background: 'var(--card)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                padding: 20,
              }}
            >
              <CustomRendererPanel slug={slug} />
            </div>
          </div>
        )}
      </div>

      {comingSoon && (
        <ComingSoonRampModal target={comingSoon} onClose={() => setComingSoon(null)} />
      )}

      {signupPrompt && (
        <SignupToPublishModal
          onClose={() => setSignupPrompt(false)}
          onContinue={() => navigate('/signup?next=' + encodeURIComponent('/build'))}
          onSignIn={() => navigate('/login?next=' + encodeURIComponent('/build'))}
        />
      )}
    </Layout>
  );
}
