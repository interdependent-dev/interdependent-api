# Counsel v2: private runtime source packages

This opt-in adapter extends the existing authenticated `POST /counsel` and
existing model lane. `counsel.v1` and legacy requests retain their separate
behavior. No corpus text, transcripts, agent memory, credential or new service
is added to this public repository. The registry contains identity, hashes and
structural clause offsets only.

## Paired Studio request

The private Studio **server** selects exact reviewed sections, after validating
the member's existing admission. It must ignore any browser-supplied packages,
hash registry, attribution or clause ranges. It must not import its package into
a client component, static asset, source map served to browsers, or public Git.

```json
{
  "contractVersion": "counsel.v2",
  "target": {
    "sourceId": "oa-v1.9.0-review",
    "digest": "116fa863a49a6e42fbe6579d4dc6b2df966a41a0cf916e3cfe6228facc4b0208",
    "packageDigest": "d9b108f28d4fb1e3f39f046d880bd484503adbee517645b092bae5712559feca",
    "sectionId": "oa-s3",
    "clause": "3.13.8"
  },
  "question": "Explain the selected provision.",
  "selection": null,
  "runtimePackages": [
    {
      "source": {
        "sourceId": "eap-v1.2.0-review",
        "document": "EAP",
        "version": "1.2.0",
        "sourceKind": "economic-policy",
        "status": "review-candidate",
        "digest": "fd02062212b1aa34b76811f205b6129aac2e2e5d77ea2b769b99ebd5f662f7b4",
        "packageDigest": "c758d8381dac54ebcc650468c572d88e3d3a32f30fc4e0f18db1207eb1c9ad1f"
      },
      "sections": [{ "sectionId": "eap-xii", "text": "<exact private server-owned section bytes>" }]
    }
  ],
  "context": []
}
```

The example deliberately omits private text and is not an executable fixture.
Use a subset of the private package's actual `sections` array without trimming,
normalizing, paraphrasing or appending text. OA targets are resolved from the
existing API corpus. An EAP target uses the same target shape with its EAP source
hashes and supplied section ID. A registered package cannot be uploaded as a
replacement OA corpus. Missing target text is a refusal, not a retrieval fallback.

The EAP package contains exact numbered sections I–XVII, excluding frontmatter,
preamble, table of contents and the defined-terms index. Its raw document hash
identifies the original review file; the package hash is SHA-256 of UTF-8
`JSON.stringify({source, sections})` **before** adding `packageDigest` to source.
The private extraction fixes this object/array order. Each included text is
independently checked against its registered full section hash. Whole-package
identity alone never authorizes arbitrary excerpt bytes.

Studio owns relevance selection: use explicit cross-reference hints for the
member's target clause and keep the supplied set stable through its follow-up.
Do not send the whole policy, infer a legal relationship from an ambiguous
mention, or silently drop necessary sources to fit the ceiling. Unseen referenced
sections remain unavailable to the answer. The API validates approved source
identity and scope, not a semantic judgment that a chosen section is relevant.

## Bounds and receipts

- At most two runtime packages and **four total sections**, including the
  API-resolved OA target; no duplicate package/section IDs.
- Normalized JSON request: at most **96 KiB** UTF-8; existing app parser remains
  **100 KiB** on the wire. Oversize parser errors now return sanitized 413.
- Resolved source text (including server OA): at most **128 KiB** UTF-8.
- Question: 3–2,000 characters; selection: 1–4,000 when present. Three prior
  turns maximum, each question 3–2,000 and answer 1–8,000 characters.
- Existing portal auth and 20-asks/IP/10-minute rate limit remain. V2 uses the
  existing bounded model ladder with 1,800 output tokens per attempt.

Successful responses contain `ok`, `contractVersion`, `answer`, `support`,
`target`, `model`, `availability` and `receipt`; no raw package or full section
text is returned. `support` is `cited` or `insufficient-source`, as in V1.

```text
receipt = {
  contractVersion: "counsel.v2",
  promptVersion: "matlock-runtime-source.v2",
  verification: "source-and-quote-only",
  scopeDigest: <full SHA-256 of canonical {target,sources}>,
  target: <the verified target>,
  sources: [<registered source identity + sectionId + sectionDigest>],
  citations: [{sourceId, sectionId, clause: <registered ID or null>, quote}]
}
```

Source entries are sorted by the ordinal JSON `[sourceId,sectionId]` key. Only
the API-owned manifest supplies identities and clause ranges. Quotes must occur
inside the named verified section/clause; 1–8 citations are required for `cited`.
`insufficient-source` requires none. The route repeats service validation before
issuing a receipt. Neither a quote match nor a source hash certifies semantic
correctness, legal effect or adoption.

History consists of `{question,answer,receipt}`. The complete V2 target, sorted
source set, scope digest, prompt version and quotes must still match. Adding or
removing a source, changing target/clause or changing a source revision starts a
new wire context. Keep older local turns readable, but do not silently relabel
V1/legacy turns as V2 or send incompatible turns. Prior prose remains untrusted,
not authenticated by its matching receipt.

`availability.EAP` is `supplied-sections` or `not-supplied`. Founder intent is
`unavailable`: **no intent source is registered**. A future registered intent
source must be `recorded-intent`/`verified-historical`, with server-owned author,
date, locator, verified-human-source basis and supersession metadata. No browser
attribution or agent-memory claim can create that authority.

## Refusals and rollout

Malformed requests/duplicate IDs/unknown section or clause: 400. Identity,
section-byte, target, selection or history mismatch: 409. Byte ceilings: 413.
Auth/rate refusal: existing 401/429. Invalid manifest/intent authority: 503.
Invalid model JSON/citations: 502; provider failures return a generic 502 without
echoing arbitrary upstream details that could contain private source text.

V2 responses are private/no-store. Existing request logging records method,
path, status and latency, not source/question bodies. Preserve that boundary.
No private source is persisted by this API adapter. This does not change the
existing model provider's processing arrangements.

Tests use synthetic text and code-owned synthetic registries; no private source
or quotes are test fixtures. Real package/section proof is a separate private
local check. No configuration, deployment, paid answer, browser integration,
adoption or full Counsel readiness is established by this patch.
