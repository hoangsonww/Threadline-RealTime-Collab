# ADR-0007: Remove email verification rather than ship a flow that silently sends nothing

## Status

Accepted

## Date

2026-08-14

## Context

Threadline has never had a transactional email provider. Anything that would send mail is handed to
`options.deliverAccountAction`, and `apps/api/src/index.ts` only constructs that callback when `AUTH_DELIVERY_WEBHOOK`
names an external service the operator supplies:

```ts
deliverAccountAction: deliveryWebhook ? async (input) => { /* POST to the webhook */ } : undefined,
```

`issueAccountAction` then guards its use with `if (options.deliverAccountAction)`. With the variable unset, a token is
written to Mongo and the call to deliver it is skipped.

The live deployment does not set `AUTH_DELIVERY_WEBHOOK` (it sets `AUTH_DELIVERY_SECRET`, which alone does nothing).
So in production the verification flow behaved like this:

1. The profile and settings pages showed an **Unverified** badge and a **Resend link** button.
2. Pressing it called `POST /v1/auth/email-verification/request`.
3. The API wrote a one-hour token and returned `202 Accepted` with _"If needed, a verification link is on its way."_
4. No mail was ever sent. The token expired unused. The badge stayed **Unverified** forever.

Registration did the same thing unprompted, minting a verification token for every new account that nobody could ever
receive.

Two pieces of documentation actively concealed this. `docs/deployment.md` claimed _"The API fails fast in production when
this delivery path is missing"_ and `docs/security.md` claimed the variables were _"required in production — the API
fails fast at boot without them."_ Neither was true: boot validation only rejects a webhook configured **without** its
secret, never the absence of both. The feature looked configured-or-loud, and was in fact silent.

## Decision

Remove the email-verification feature rather than leave an endpoint that reports success for work it did not do.

1. `POST /v1/auth/email-verification/request` and `/confirm` are deleted, along with their rate-limit mount, their
   OpenAPI operations, and the now-orphaned `VerificationTokenInput` schema.
2. Registration no longer issues an `email_verification` account action.
3. The `AccountActionToken` type union narrows to `"password_reset"` — the only action still issued. Rows of the removed
   type in an existing database are harmless and self-clean via the existing `expiresAt` TTL index.
4. All user-facing surfaces are gone: the Verified/Unverified badge, both "Resend link" rows, the `/verify-email` page,
   its `VerifyEmailForm`, and its `robots.ts`/`sitemap.ts` entries.
5. `Credential.emailVerifiedAt` **stays**, and so does the OIDC `email_verified` claim derived from it. The claim is part
   of the OpenID Connect contract, and removing it would be a breaking change to a different feature for no benefit.
   Nothing can set the timestamp any more, so the claim reads `false` for every account except one that verified while a
   delivery webhook happened to be configured. Those timestamps are deliberately **not** cleared: the verification did
   happen, and rewriting history to make a sentence like "always false" true would be the less honest option.
6. The false "fails fast" claims are corrected in `deployment.md` and `security.md`, and the real behaviour is documented
   in `README.md` and `api.md` under **Email delivery**.

## Alternatives considered

**Gate the endpoints on configuration and return `503` when no webhook is set.** Honest, and re-enabling would be one
environment variable. Rejected because it keeps a documented, publicly-discoverable operation in the API contract that
cannot succeed in any current deployment — the user-facing feature still has to be removed, so the endpoint would exist
only to return an error to callers who should never have been offered it.

**Leave it alone and just hide the UI.** Rejected: the endpoints stay in the published Swagger document, so the contract
keeps advertising a flow that silently does nothing. Hiding the symptom is what produced this situation.

**Add a mail provider now.** The correct long-term fix, but it is a real integration decision — an account, a domain, SPF
and DKIM records, deliverability monitoring, and a cost — not something to smuggle in under a UI cleanup.

## Consequences

- Nothing in the product claims an address is verified or unverified, because nothing can establish that it is.
- Nothing can set `emailVerified` on `GET /v1/auth/me` any more. It reads `false` for every account that did not already carry a timestamp, and the published schema says exactly that rather than promising a blanket `false` the data cannot guarantee.
- **Password recovery has the identical silent failure and is deliberately _not_ removed here.** `POST
  /v1/auth/password-reset/request` still answers `202` — it must, or it would disclose whether an account exists — and
  with no webhook the token expires undelivered, so account recovery does not complete in production. Verification could
  be deleted because nothing depends on it; recovery cannot, because deleting it would leave locked-out accounts with no
  path back at all. It is recorded as the top gap in [`../roadmap.md`](../roadmap.md) and resolves the moment
  `AUTH_DELIVERY_WEBHOOK` is configured.
- Re-enabling verification means restoring two handlers and their UI, not redesigning anything: the token machinery,
  `Credential.emailVerifiedAt`, and the delivery webhook contract are all still in place.
- A test asserts the feature stays absent — registration issues no verification action and both paths return `404` — so
  it cannot quietly return without the mail provider that would make it real.
