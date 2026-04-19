// /legal (and /imprint for back-compat) — Floom, Inc. company info.
//
// Floom is a Delaware C-Corp (Floom, Inc., filed via Every.io 2026-04-17).
// US entities don't use a German "Impressum / §5 TMG" frame. This page is a
// plain "who we are + how to reach us" card that EU users (used to seeing an
// Impressum link) and US users both understand.

import { PageShell } from '../components/PageShell';
import { LegalPageHeader, LegalSection } from '../components/LegalPageChrome';

export function ImprintPage() {
  return (
    <PageShell title="Legal · Floom">
      <article style={{ maxWidth: 720, margin: '0 auto' }}>
        <LegalPageHeader title="Legal" updated="2026-04-20" lang="en" />

        <LegalSection id="company" title="Company">
          <p>
            <strong>Floom, Inc.</strong>
            <br />
            A Delaware C-Corp
            <br />
            1207 Delaware Ave, Suite 226
            <br />
            Wilmington, DE 19806
            <br />
            United States
          </p>
        </LegalSection>

        <LegalSection id="contact" title="Contact">
          <p>
            Email: <a href="mailto:team@floom.dev">team@floom.dev</a>
          </p>
        </LegalSection>

        <LegalSection id="policies" title="Policies">
          <p>
            See the <a href="/terms">Terms of Service</a>,{' '}
            <a href="/privacy">Privacy Policy</a>, and{' '}
            <a href="/cookies">Cookie Policy</a> for details on how Floom operates.
          </p>
        </LegalSection>
      </article>
    </PageShell>
  );
}
